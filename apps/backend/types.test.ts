import { describe, expect, test } from "bun:test";
import { parseGithubUsername, PreInterviewBody } from "./types";

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

describe("parseGithubUsername", () => {
    test("accepts profile URLs in the common shapes", () => {
        for (const input of [
            "octocat",
            "github.com/octocat",
            "https://github.com/octocat",
            "https://www.github.com/octocat/",
            "  http://github.com/octocat?tab=repositories ",
            "github.com/octo-cat",
        ]) {
            expect(parseGithubUsername(input)).toBe(input.includes("octo-cat") ? "octo-cat" : "octocat");
        }
    });

    test("rejects repository links, other hosts and invalid usernames", () => {
        for (const input of [
            "",
            "github.com/octocat/hello-world",
            "https://gitlab.com/octocat",
            "evil.com/octocat",
            "-octocat",
            "octo--cat",
            "a".repeat(40),
            "../orgs/x",
        ]) {
            expect(parseGithubUsername(input)).toBeNull();
        }
    });
});
