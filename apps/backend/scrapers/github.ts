import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

const httpsAgent = process.env.PROXY_URL ? new HttpsProxyAgent(process.env.PROXY_URL) : undefined;

interface GithubRepo {
    description: string | null;
    name: string;
    full_name: string;
    stargazers_count: number;
}

export async function scrapeGithub(username: string) {
    const userRepos = await axios.request<GithubRepo[]>({url: `https://api.github.com/users/${username}/repos`, httpsAgent});
    return userRepos.data.map((x) => ({
        description: x.description,
        name: x.name,
        fullName: x.full_name,
        starCount: x.stargazers_count
    }))

}