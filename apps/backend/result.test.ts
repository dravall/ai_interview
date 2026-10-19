import { afterAll, describe, expect, test } from "bun:test";

type Choice = { finish_reason: string, message: { content: string | null, refusal?: string | null } };

let nextStatus = 200;
let nextBody: { choices?: Choice[], error?: { message: string } } = {};

const realFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response(JSON.stringify(nextBody), { status: nextStatus })) as unknown as typeof fetch;
afterAll(() => { globalThis.fetch = realFetch; });

const { calculateResult } = await import("./result");

function respond(choice: Choice, status = 200) {
    nextStatus = status;
    nextBody = { choices: [choice] };
}

describe("calculateResult", () => {
    test("returns the parsed feedback + score", async () => {
        respond({
            finish_reason: "stop",
            message: { content: JSON.stringify({ feedback: "Solid answers, clear communication.", score: 8 }) },
        });

        const result = await calculateResult([
            { type: "Assistant", message: "Tell me about a project.", createdAt: new Date() },
            { type: "User", message: "I built a...", createdAt: new Date() },
        ]);

        expect(result).toEqual({ feedback: "Solid answers, clear communication.", score: 8 });
    });

    test("rejects when the model response couldn't be parsed", async () => {
        respond({ finish_reason: "length", message: { content: '{"feedback": "trunc' } });

        await expect(
            calculateResult([{ type: "User", message: "hi", createdAt: new Date() }])
        ).rejects.toThrow();
    });

    test("rejects when the model response is missing a required field", async () => {
        respond({ finish_reason: "stop", message: { content: JSON.stringify({ feedback: "Good effort." }) } });

        await expect(
            calculateResult([{ type: "User", message: "hi", createdAt: new Date() }])
        ).rejects.toThrow();
    });

    test("rejects when the model refuses", async () => {
        respond({ finish_reason: "stop", message: { content: null, refusal: "declined" } });

        await expect(
            calculateResult([{ type: "User", message: "hi", createdAt: new Date() }])
        ).rejects.toThrow("Grading refused");
    });

    test("rejects when OpenRouter returns an error", async () => {
        nextStatus = 401;
        nextBody = { error: { message: "No auth credentials found" } };

        await expect(
            calculateResult([{ type: "User", message: "hi", createdAt: new Date() }])
        ).rejects.toThrow("Grading request failed (401)");
    });
});
