import { describe, expect, mock, test } from "bun:test";
import request from "supertest";

mock.module("./scrapers/github", () => ({
    scrapeGithub: async (username: string) => {
        if (username === "missing-user") throw Object.assign(new Error("not found"), { kind: "not-found" });
        if (username === "busy-user") throw Object.assign(new Error("rate limited"), { kind: "rate-limited" });
        return [{ description: "demo", name: "demo-repo", fullName: "user/demo-repo", starCount: 3 }];
    },
}));

// The suite makes more intake calls than the production limit of 5 per window.
process.env.INTAKE_RATE_LIMIT ??= "50";

mock.module("./result", () => ({
    calculateResult: async () => ({ feedback: "Nice work overall.", score: 7 }),
}));

const { app } = await import("./index");

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

    test("owner can grade and read their own interview result", async () => {
        const agent = request.agent(app);

        const created = await agent
            .post("/api/v1/pre-interview")
            .send({ github: "https://github.com/someone" });

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
        const { prisma } = await import("./db");
        const agent = request.agent(app);

        // Create the row directly: earlier tests already used up the intake
        // rate limit (5 per window) for this test run.
        const first = await agent.get("/api/v1/result/00000000-0000-0000-0000-000000000000");
        const sid = /sid=([^;]+)/.exec(String(first.headers["set-cookie"]))![1];
        const { id: interviewId } = await prisma.interview.create({
            data: { githubMetadata: "[]", status: "Pre", ownerId: sid }
        });

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

    test("GET /api/v1/result/:id 404s for an unknown interview", async () => {
        const res = await request(app).get("/api/v1/result/00000000-0000-0000-0000-000000000000");
        expect(res.status).toBe(404);
    });
});
