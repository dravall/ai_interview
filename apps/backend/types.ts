import z from "zod";

export const PreInterviewBody = z.object({
    github: z.string().max(200)
})

// GitHub's own rule: 1–39 alphanumerics or single hyphens, not starting/ending with "-".
const GITHUB_USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/**
 * Accepts github.com/user, https://github.com/user (optionally www., trailing
 * slash, query or hash) or a bare username. Returns null for anything else,
 * including repository links, so the value is safe to put in a GitHub API path.
 */
export function parseGithubUsername(input: string): string | null {
    const value = input.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");

    let path: string;
    if (/^github\.com(\/|$)/i.test(value)) path = value.slice("github.com".length);
    else if (!value.includes("/") && !value.includes(".")) path = value;
    else return null;

    const segments = path.split(/[?#]/)[0]!.split("/").filter(Boolean);
    const username = segments[0];
    if (segments.length !== 1 || !username || !GITHUB_USERNAME.test(username)) return null;
    return username;
}

declare global {
    // `namespace` is required here — this is TypeScript's standard pattern for
    // augmenting a third-party global (Express.Request); there's no ES-module form.
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            sessionId: string;
        }
    }
}
