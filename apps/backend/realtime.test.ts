import { describe, expect, test } from "bun:test";
import { buildInstructions, isValidCallId, REALTIME_MODEL, safetyIdentifier, turnDetection } from "./realtime";

describe("realtime", () => {
    test("defaults to gpt-realtime-2.1-mini", () => {
        if (!process.env.OPENAI_REALTIME_MODEL) {
            expect(REALTIME_MODEL).toBe("gpt-realtime-2.1-mini");
        }
    });

    test("isValidCallId accepts OpenAI call ids and rejects anything else", () => {
        expect(isValidCallId("rtc_abc123_DEF-9")).toBe(true);
        expect(isValidCallId("rtc_")).toBe(false);
        expect(isValidCallId("abc123")).toBe(false);
        expect(isValidCallId("rtc_abc&model=x")).toBe(false);
        expect(isValidCallId("rtc_../../v1/models")).toBe(false);
        expect(isValidCallId(undefined)).toBe(false);
        expect(isValidCallId(42)).toBe(false);
    });

    test("buildInstructions embeds github metadata, stringifying JSON values", () => {
        expect(buildInstructions('{"repos":["a"]}')).toContain('{"repos":["a"]}');
        expect(buildInstructions({ repos: ["b"] })).toContain('{"repos":["b"]}');
        expect(buildInstructions("{}")).not.toContain("Interview so far");
    });

    test("buildInstructions replays prior turns after a reconnect", () => {
        const instructions = buildInstructions("{}", [
            { type: "Assistant", message: "Tell me about your compiler." },
            { type: "User", message: "It targets WASM." },
        ]);

        expect(instructions).toContain("Interview so far");
        expect(instructions).toContain("Interviewer: Tell me about your compiler.");
        expect(instructions).toContain("Candidate: It targets WASM.");
    });

    test("safetyIdentifier is a stable hash that doesn't leak the session id", () => {
        const id = safetyIdentifier("session-123");
        expect(id).toBe(safetyIdentifier("session-123"));
        expect(id).not.toContain("session-123");
        expect(id).toMatch(/^[0-9a-f]{64}$/);
    });

    test("turn detection lets candidates pause by default and keeps barge-in in both modes", () => {
        expect(turnDetection(undefined)).toMatchObject({ type: "semantic_vad", eagerness: "low", interrupt_response: true });
        expect(turnDetection("server")).toMatchObject({ type: "server_vad", threshold: 0.7, interrupt_response: true });
    });
});
