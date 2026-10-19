import { describe, expect, test } from "bun:test";
import { PreInterviewBody } from "./types";

describe("PreInterviewBody", () => {
    test("accepts a github url string", () => {
        const result = PreInterviewBody.safeParse({ github: "https://github.com/someone" });
        expect(result.success).toBe(true);
    });

    test("rejects a missing github field", () => {
        const result = PreInterviewBody.safeParse({});
        expect(result.success).toBe(false);
    });

    test("rejects a non-string github field", () => {
        const result = PreInterviewBody.safeParse({ github: 12345 });
        expect(result.success).toBe(false);
    });
});
