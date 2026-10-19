import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

const httpsAgent = process.env.PROXY_URL ? new HttpsProxyAgent(process.env.PROXY_URL) : undefined;

interface GithubRepo {
    description: string | null;
    name: string;
    full_name: string;
    stargazers_count: number;
}

export type GithubLookupErrorKind = "not-found" | "rate-limited" | "unavailable";

/** Thrown by scrapeGithub; `kind` tells the route which status to return. */
export class GithubLookupError extends Error {
    constructor(public kind: GithubLookupErrorKind, message: string) {
        super(message);
    }
}

export async function scrapeGithub(username: string) {
    try {
        const userRepos = await axios.request<GithubRepo[]>({
            url: `https://api.github.com/users/${encodeURIComponent(username)}/repos`,
            // Default is 30 repos in creation order; take the 100 most recently updated.
            params: { per_page: 100, sort: "updated" },
            headers: {
                Accept: "application/vnd.github+json",
                // Optional: lifts GitHub's limit from 60 to 5,000 requests/hour.
                ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
            },
            httpsAgent,
        });
        return userRepos.data.map((x) => ({
            description: x.description,
            name: x.name,
            fullName: x.full_name,
            starCount: x.stargazers_count
        }));
    } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status === 404) throw new GithubLookupError("not-found", `GitHub user ${username} not found`);
        if (status === 403 || status === 429) throw new GithubLookupError("rate-limited", "GitHub rate limit reached");
        throw new GithubLookupError("unavailable", `GitHub request failed: ${String(error)}`);
    }
}
