import { describe, expect, mock, test } from "bun:test";
import request from "supertest";

mock.module("./scrapers/github", () => ({
    scrapeGithub: async () => [
        { description: "demo", name: "demo-repo", fullName: "user/demo-repo", starCount: 3 },
    ],
}));

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

    test("GET /api/v1/result/:id 404s for an unknown interview", async () => {
        const res = await request(app).get("/api/v1/result/00000000-0000-0000-0000-000000000000");
        expect(res.status).toBe(404);
    });
});
