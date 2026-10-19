import { describe, expect, mock, test } from "bun:test";
import request from "supertest";
import type { Prisma } from "./generated/prisma/client";

mock.module("./scrapers/github", () => ({
    scrapeGithub: async (username: string) => {
        if (username === "missing-user") throw Object.assign(new Error("not found"), { kind: "not-found" });
        if (username === "busy-user") throw Object.assign(new Error("rate limited"), { kind: "rate-limited" });
        return [{ description: "demo", name: "demo-repo", fullName: "user/demo-repo", starCount: 3 }];
    },
}));

// The suite makes more intake calls than the production limit of 5 per window.
process.env.INTAKE_RATE_LIMIT ??= "50";
// Lets tests act as different clients via X-Forwarded-For.
process.env.TRUST_PROXY ??= "1";

// Grading is mocked; tests swap `grade` to simulate slow or failing graders.
const defaultGrade = async () => ({ feedback: "Nice work overall.", score: 7 });
let grade = defaultGrade;
let gradeCalls = 0;
mock.module("./result", () => ({
    calculateResult: async () => {
        gradeCalls++;
        return grade();
    },
}));

const { app } = await import("./index");
const { prisma } = await import("./db");

/** Creates an interview directly in the DB, owned by a fresh session; returns that session's agent. */
async function createInterview(data: Partial<Prisma.InterviewUncheckedCreateInput> = {}) {
    const agent = request.agent(app);
    const first = await agent.get("/api/v1/result/00000000-0000-0000-0000-000000000000");
    const sid = /sid=([^;]+)/.exec(String(first.headers["set-cookie"]))![1];
    const interview = await prisma.interview.create({
        data: { githubMetadata: "[]", status: "Pre", ownerId: sid, ...data }
    });
    return { agent, id: interview.id };
}

// Requires a real Postgres reachable via DATABASE_URL — skipped locally when
// unset, always run in CI (see .github/workflows/ci.yml).
describe.skipIf(!process.env.DATABASE_URL)("API integration", () => {
    test("POST /api/v1/pre-interview creates an interview and sets a session cookie", async () => {
        const res = await request(app)
            .post("/api/v1/pre-interview")
            .send({ github: "https://github.com/someone" });

        expect(res.status).toBe(200);
        expect(typeof res.body.id).toBe("string");
        expect(res.headers["set-cookie"]).toBeDefined();
    });

    test("POST /api/v1/pre-interview rejects an invalid body", async () => {
        const res = await request(app).post("/api/v1/pre-interview").send({});
        expect(res.status).toBe(400);
    });

    test("POST /api/v1/pre-interview rejects repository links and non-GitHub URLs", async () => {
        for (const github of ["https://github.com/someone/some-repo", "https://gitlab.com/someone", "a b"]) {
            const res = await request(app).post("/api/v1/pre-interview").send({ github });
            expect(res.status).toBe(400);
        }
    });

    test("POST /api/v1/pre-interview maps GitHub errors to 404 and 503", async () => {
        const missing = await request(app).post("/api/v1/pre-interview").send({ github: "github.com/missing-user" });
        expect(missing.status).toBe(404);

        const busy = await request(app).post("/api/v1/pre-interview").send({ github: "busy-user" });
        expect(busy.status).toBe(503);
    });

    test("POST /api/v1/pre-interview is rate-limited", async () => {
        const res = await request(app)
            .post("/api/v1/pre-interview")
            .send({ github: "https://github.com/someone" });

        expect(res.headers["ratelimit-limit"]).toBeDefined();
    });

    test("owner can end, grade and read their own interview result", async () => {
        const agent = request.agent(app);

        const created = await agent
            .post("/api/v1/pre-interview")
            .send({ github: "https://github.com/someone" });

        const ended = await agent.post(`/api/v1/interview/${created.body.id}/end`);
        expect(ended.status).toBe(204);

        const result = await agent.get(`/api/v1/result/${created.body.id}`);

        expect(result.status).toBe(200);
        expect(result.body.status).toBe("Done");
        expect(result.body.score).toBe(7);
        expect(result.body.feedback).toBe("Nice work overall.");
    });

    test("a different session is forbidden from reading someone else's result", async () => {
        const owner = request.agent(app);
        const stranger = request.agent(app);

        const created = await owner
            .post("/api/v1/pre-interview")
            .send({ github: "https://github.com/someone" });

        const res = await stranger.get(`/api/v1/result/${created.body.id}`);

        expect(res.status).toBe(403);
    });

    test("result transcript comes back in spoken order regardless of insert order", async () => {
        const { agent, id: interviewId } = await createInterview();

        // Insert the later turn first so physical row order disagrees with time.
        await prisma.message.create({
            data: { interviewId, type: "User", message: "second", createdAt: new Date("2026-01-01T00:00:02Z") }
        });
        await prisma.message.create({
            data: { interviewId, type: "Assistant", message: "first", createdAt: new Date("2026-01-01T00:00:01Z") }
        });

        const result = await agent.get(`/api/v1/result/${interviewId}`);

        expect(result.body.transcript.map((m: { content: string }) => m.content)).toEqual(["first", "second"]);
    });

    test("an interview whose call is still live isn't graded", async () => {
        const { agent, id } = await createInterview({ status: "InProgress" });
        const before = gradeCalls;

        const res = await agent.get(`/api/v1/result/${id}`);

        expect(res.body.status).toBe("InProgress");
        expect(gradeCalls).toBe(before);
    });

    test("an idle interview with no live call is ended and graded", async () => {
        const { agent, id } = await createInterview({ status: "InProgress" });
        await prisma.$executeRaw`UPDATE "Interview" SET "updatedAt" = now() - interval '2 minutes' WHERE id = ${id}`;

        const res = await agent.get(`/api/v1/result/${id}`);

        expect(res.body.status).toBe("Done");
    });

    test("concurrent result polls grade an interview exactly once", async () => {
        const { agent, id } = await createInterview({ status: "Ended" });
        grade = async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            return defaultGrade();
        };
        const before = gradeCalls;

        const responses = await Promise.all([
            agent.get(`/api/v1/result/${id}`),
            agent.get(`/api/v1/result/${id}`),
            agent.get(`/api/v1/result/${id}`),
        ]);
        grade = defaultGrade;

        expect(gradeCalls - before).toBe(1);
        expect(responses.map((r) => r.body.status)).toContain("Done");
    });

    test("a stale grading lease is reclaimed, a fresh one is left alone", async () => {
        const stale = await createInterview({ status: "Grading", gradingStartedAt: new Date(Date.now() - 10 * 60_000) });
        expect((await stale.agent.get(`/api/v1/result/${stale.id}`)).body.status).toBe("Done");

        const fresh = await createInterview({ status: "Grading", gradingStartedAt: new Date() });
        const before = gradeCalls;
        expect((await fresh.agent.get(`/api/v1/result/${fresh.id}`)).body.status).toBe("Grading");
        expect(gradeCalls).toBe(before);
    });

    test("grading stops after 3 failed attempts until the user retries", async () => {
        const { agent, id } = await createInterview({ status: "Ended" });
        grade = async () => { throw new Error("grader down"); };
        const before = gradeCalls;

        const statuses = [];
        for (let i = 0; i < 4; i++) statuses.push((await agent.get(`/api/v1/result/${id}`)).body.status);

        expect(statuses).toEqual(["Grading", "Grading", "Failed", "Failed"]);
        expect(gradeCalls - before).toBe(3);

        grade = defaultGrade;
        expect((await agent.post(`/api/v1/result/${id}/retry`)).status).toBe(204);
        expect((await agent.get(`/api/v1/result/${id}`)).body.status).toBe("Done");
    });

    test("only the owner can end an interview or retry its grading", async () => {
        const { id } = await createInterview();
        const stranger = request.agent(app);

        expect((await stranger.post(`/api/v1/interview/${id}/end`)).status).toBe(403);
        expect((await stranger.post(`/api/v1/result/${id}/retry`)).status).toBe(403);
    });

    test("interviews without an owner are closed to everyone", async () => {
        const { agent, id } = await createInterview({ ownerId: null });

        expect((await agent.get(`/api/v1/result/${id}`)).status).toBe(403);
        expect((await request(app).get(`/api/v1/result/${id}`)).status).toBe(403);
    });

    test("rate limits are per client IP (behind a proxy) and per endpoint", async () => {
        const unknown = "/api/v1/realtime/client-secret/00000000-0000-0000-0000-000000000000";
        const remaining = (res: { headers: Record<string, string> }) => Number(res.headers["ratelimit-remaining"]);

        const a1 = await request(app).post(unknown).set("X-Forwarded-For", "203.0.113.7");
        const a2 = await request(app).post(unknown).set("X-Forwarded-For", "203.0.113.7");
        const b1 = await request(app).post(unknown).set("X-Forwarded-For", "198.51.100.9");
        expect(remaining(a2)).toBe(remaining(a1) - 1);
        expect(remaining(b1)).toBe(remaining(a1));

        // Sideband registrations come out of a different bucket.
        const sideband = await request(app)
            .post("/api/v1/realtime/sideband/00000000-0000-0000-0000-000000000000")
            .set("X-Forwarded-For", "203.0.113.7");
        expect(Number(sideband.headers["ratelimit-limit"])).toBe(20);
        expect(Number(a1.headers["ratelimit-limit"])).toBe(10);
    });

    test("API responses carry security headers and don't advertise Express", async () => {
        const res = await request(app).get("/api/v1/result/00000000-0000-0000-0000-000000000000");

        expect(res.headers["x-content-type-options"]).toBe("nosniff");
        expect(res.headers["x-frame-options"]).toBe("DENY");
        expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
        expect(res.headers["referrer-policy"]).toBe("no-referrer");
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.headers["x-powered-by"]).toBeUndefined();
    });

    test("GET /api/v1/result/:id 404s for an unknown interview", async () => {
        const res = await request(app).get("/api/v1/result/00000000-0000-0000-0000-000000000000");
        expect(res.status).toBe(404);
    });
});
