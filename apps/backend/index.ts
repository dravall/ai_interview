import express from "express";
import type { RequestHandler } from "express";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { parseGithubUsername, PreInterviewBody } from "./types";
import { scrapeGithub, type GithubLookupError } from "./scrapers/github";
import cors from "cors";
import { prisma } from "./db";
import { endInterview, hasOpenSideband, initSideband } from "./sideband";
import { calculateResult } from "./result";
import {
  buildInstructions,
  createClientSecret,
  isValidCallId,
  OpenAIRequestError,
  REALTIME_MODEL
} from "./realtime";

const app = express();
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  credentials: true
}));
app.use(cookieParser());
app.use(express.json());

const SESSION_COOKIE = "sid";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Same-site local dev (any localhost ports) works with the SameSite=Lax
// default. A cross-domain deployment (frontend and backend on different top-
// level domains) needs COOKIE_SAMESITE=none, which forces Secure — that in
// turn requires HTTPS, true for any real host's default edge but not for
// local/Docker testing over plain HTTP.
const COOKIE_SAMESITE = process.env.COOKIE_SAMESITE === "none" ? "none" : "lax";
const COOKIE_SECURE = COOKIE_SAMESITE === "none" || process.env.NODE_ENV === "production";

const ensureSession: RequestHandler = (req, res, next) => {
  let sessionId = req.cookies[SESSION_COOKIE];

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    res.cookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: COOKIE_SAMESITE,
      secure: COOKIE_SECURE,
      maxAge: SESSION_MAX_AGE_MS,
      path: "/"
    });
  }

  req.sessionId = sessionId;
  next();
};

app.use(ensureSession);

// Only the browser session that created an interview can read or act on it.
const requireOwner: RequestHandler<{ interviewId: string }> = async (req, res, next) => {
  const interview = await prisma.interview.findFirst({
    where: { id: req.params.interviewId }
  });

  if (!interview) {
    res.status(404).json({ message: "Interview not found" });
    return;
  }

  // Interviews created before ownership existed have no owner; nobody can
  // prove they own them, so they're closed too (there's no production data).
  if (interview.ownerId !== req.sessionId) {
    res.status(403).json({ message: "Forbidden" });
    return;
  }

  next();
};

const preInterviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Each intake costs a GitHub API call; override for load tests or a GITHUB_TOKEN setup.
  limit: Number(process.env.INTAKE_RATE_LIMIT) || 5,
  standardHeaders: true,
  legacyHeaders: false
});

// Interview lifecycle and grading (see the state diagram in ARCHITECTURE.md).
const END_SETTLE_MS = 5_000;            // max wait for the last transcript events on End
const IDLE_END_MS = 60_000;             // no live call + no activity this long => ended
const GRADING_LEASE_MS = 2 * 60_000;    // a Grading claim older than this can be re-claimed
const MAX_GRADING_ATTEMPTS = 3;         // automatic attempts before the user must retry

const sessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

app.post("/api/v1/pre-interview", preInterviewLimiter, async (req, res) => {
    const { success, data } = PreInterviewBody.safeParse(req.body) ;

    if (!success) {
        res.status(400).json({
            message: "Incorrect body"
        });
        return
    }

    const githubUsername = parseGithubUsername(data.github);

    if (!githubUsername) {
        res.status(400).json({
            message: "Enter a GitHub profile URL like github.com/octocat"
        });
        return
    }

    let githubData: Awaited<ReturnType<typeof scrapeGithub>>;
    try {
        githubData = await scrapeGithub(githubUsername);
    } catch (error) {
        // Checked by `kind` rather than instanceof so tests can mock the scraper module.
        const kind = (error as Partial<GithubLookupError>).kind;
        if (kind === "not-found") {
            res.status(404).json({ message: "No GitHub user at that address" });
        } else {
            console.error("GitHub lookup failed:", error);
            res.status(503).json({ message: "GitHub is unavailable right now. Try again in a minute." });
        }
        return
    }

    const interview = await prisma.interview.create({
        data: {
            githubMetadata: JSON.stringify(githubData),
            status: "Pre",
            ownerId: req.sessionId
        }
    })

    res.json({ id: interview.id });
})

// Mints a short-lived Realtime client secret. The browser uses it to do the
// WebRTC SDP exchange with OpenAI directly; OPENAI_API_KEY never leaves the
// server. Instructions, model and turn detection are fixed here, server-side.
app.post("/api/v1/realtime/client-secret/:interviewId", sessionLimiter, requireOwner, async (req, res) => {
    const interview = await prisma.interview.findFirst({
        where: { id: req.params.interviewId },
        include: { conversations: { orderBy: { createdAt: "asc" } } }
    });

    if (!interview) {
        res.status(404).json({ message: "Interview not found" });
        return;
    }

    try {
        const secret = await createClientSecret({
            instructions: buildInstructions(interview.githubMetadata, interview.conversations),
            sessionId: req.sessionId
        });

        res.set("Cache-Control", "no-store");
        res.json({ clientSecret: secret.value, expiresAt: secret.expiresAt, model: REALTIME_MODEL });
    } catch (error) {
        console.error("Client secret error:", error);

        // Upstream auth failures are our misconfiguration, not the client's;
        // rate limits are worth retrying.
        const status = error instanceof OpenAIRequestError && error.status === 429 ? 503 : 502;
        res.status(status).json({ message: "Could not start a voice session. Please try again." });
    }
});

// The browser relays the call id from OpenAI's SDP answer so the server can
// attach a sideband socket to the same call and persist the transcript.
app.post("/api/v1/realtime/sideband/:interviewId", sessionLimiter, requireOwner, async (req, res) => {
    const { callId } = req.body ?? {};

    if (!isValidCallId(callId)) {
        res.status(400).json({ message: "Invalid call id" });
        return;
    }

    // "Ended" is included so a reconnect after a long drop revives the interview
    // instead of leaving it graded on a partial transcript.
    await prisma.interview.updateMany({
        where: { id: req.params.interviewId, status: { in: ["Pre", "InProgress", "Ended"] } },
        data: { status: "InProgress" }
    });

    initSideband(callId, req.params.interviewId);
    res.status(204).end();
});

// Called by the browser when the candidate clicks End. Waits (up to 5 s) for the
// call's last transcript events to be saved, then marks the interview Ended so
// it becomes gradeable. If this request never arrives (tab closed), the
// sideband's close handler ends the interview instead.
app.post("/api/v1/interview/:interviewId/end", requireOwner, async (req, res) => {
    await endInterview(req.params.interviewId, END_SETTLE_MS);
    res.status(204).end();
});

// Manual retry after grading has failed MAX_GRADING_ATTEMPTS times in a row.
app.post("/api/v1/result/:interviewId/retry", sessionLimiter, requireOwner, async (req, res) => {
    await prisma.interview.updateMany({
        where: { id: req.params.interviewId, status: "Failed" },
        data: { status: "Ended", gradingAttempts: 0 }
    });
    res.status(204).end();
});

app.get("/api/v1/result/:interviewId", requireOwner, async (req, res) => {
  const interviewId = req.params.interviewId;
  const interview = await prisma.interview.findFirst({
    where: {
      id: interviewId
    },
    include: {
      // Without an explicit order Postgres may return rows in any order, which
      // would scramble both the graded transcript and the one shown to the user.
      conversations: { orderBy: { createdAt: "asc" } }
    }
  })

  if (!interview) {
    res.status(404).json({
      message: "Interview not found"
    })
    return
  }

  // Recovery for interviews that never got an explicit end and whose close
  // timer was lost (e.g. the server restarted): no live call and nothing new
  // for a while means it's over.
  if ((interview.status === "Pre" || interview.status === "InProgress") && !hasOpenSideband(interviewId)) {
    const lastMessage = interview.conversations.at(-1);
    const lastActivity = Math.max(interview.updatedAt.getTime(), lastMessage?.createdAt.getTime() ?? 0);
    if (Date.now() - lastActivity > IDLE_END_MS) {
      await endInterview(interviewId, 0);
    }
  }

  // Atomically claim the row before grading so concurrent polls can't both
  // trigger a (paid) grading call. Claimable: ended interviews, failed ones
  // with attempts left, and Grading rows whose lease is stale because the
  // process grading them died.
  const now = new Date();
  const claim = await prisma.interview.updateMany({
    where: {
      id: interviewId,
      OR: [
        { status: "Ended" },
        { status: "Failed", gradingAttempts: { lt: MAX_GRADING_ATTEMPTS } },
        { status: "Grading", gradingStartedAt: { lt: new Date(now.getTime() - GRADING_LEASE_MS) } }
      ]
    },
    data: { status: "Grading", gradingStartedAt: now, gradingAttempts: { increment: 1 } }
  });

  if (claim.count === 1) {
    // Writes are guarded by this attempt's lease, so a slow attempt whose lease
    // was reclaimed can't overwrite a newer one.
    const lease = { id: interviewId, status: "Grading" as const, gradingStartedAt: now };
    try {
      const result = await calculateResult(interview.conversations);
      await prisma.interview.updateMany({
        where: lease,
        data: { status: "Done", feedback: result.feedback, score: result.score }
      });
    } catch (error) {
      console.error("Grading failed:", error);
      await prisma.interview.updateMany({ where: lease, data: { status: "Failed" } });
    }
  }

  const current = await prisma.interview.findFirst({ where: { id: interviewId } });
  if (!current) {
    res.status(404).json({ message: "Interview not found" })
    return
  }

  // A failure with attempts left will be retried on the next poll, so to the
  // client it's still grading. "Failed" means the user has to press Try again.
  const status = current.status === "Failed" && current.gradingAttempts < MAX_GRADING_ATTEMPTS
    ? "Grading"
    : current.status;

  res.json({
    score: current.score,
    feedback: current.feedback,
    transcript: interview.conversations.map(c => ({
      type: c.type,
      content: c.message,
      createdAt: c.createdAt
    })),
    status
  })
})

export { app };

if (import.meta.main) {
  app.listen(3001);
}
