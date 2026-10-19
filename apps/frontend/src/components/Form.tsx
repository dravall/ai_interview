import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { isAxiosError } from "axios";
import { ArrowRight, CircleAlert, Github, LoaderCircle, Mic, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Brand } from "./Brand";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** Accepts github.com/user, https://github.com/user or a bare username. */
function parseGithubProfile(input: string): { url: string } | { error: string } {
    const value = input.trim();
    if (!value) return { error: "Enter your GitHub profile URL to start." };

    const withoutProtocol = value.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    let path: string;
    if (/^github\.com(\/|$)/i.test(withoutProtocol)) {
        path = withoutProtocol.slice("github.com".length);
    } else if (!withoutProtocol.includes("/") && !withoutProtocol.includes(".")) {
        path = withoutProtocol;
    } else {
        return { error: "That doesn’t look like a GitHub profile. Paste one like github.com/octocat." };
    }

    const segments = path.split(/[?#]/)[0]!.split("/").filter(Boolean);
    if (segments.length > 1) {
        return { error: "That’s a repository link. Paste your profile instead, like github.com/octocat." };
    }
    const username = segments[0];
    if (!username || !USERNAME.test(username)) {
        return { error: "That doesn’t look like a GitHub profile. Paste one like github.com/octocat." };
    }
    return { url: `https://github.com/${username}` };
}

function describeRequestError(error: unknown): string {
    if (isAxiosError(error)) {
        if (error.response?.status === 404) return "No GitHub user at that address.";
        if (error.response?.status === 429) return "Too many interviews started. Try again in a few minutes.";
    }
    return "Check that the profile is public, then try again.";
}

const STEPS = [
    ["Connect GitHub", "We read your public repos"],
    ["Talk", "2–3 questions, by voice"],
    ["Get feedback", "Score /10 and written notes"],
] as const;

export function Form() {
    const navigate = useNavigate();
    const inputRef = useRef<HTMLInputElement>(null);
    const [github, setGithub] = useState("");
    const [fieldError, setFieldError] = useState<string | null>(null);
    const [requestError, setRequestError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [slow, setSlow] = useState(false);

    // Desktop only: autofocus would pop the keyboard over the copy on phones.
    useEffect(() => {
        if (window.matchMedia("(min-width: 640px)").matches) inputRef.current?.focus();
    }, []);

    useEffect(() => {
        if (!loading) return setSlow(false);
        const timer = setTimeout(() => setSlow(true), 600);
        return () => clearTimeout(timer);
    }, [loading]);

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (loading) return;

        const parsed = parseGithubProfile(github);
        if ("error" in parsed) {
            setFieldError(parsed.error);
            inputRef.current?.focus();
            return;
        }

        setFieldError(null);
        setRequestError(null);
        setLoading(true);
        try {
            const response = await api.post("/api/v1/pre-interview", { github: parsed.url });
            navigate(`/interview/${response.data.id}`);
        } catch (error) {
            setRequestError(describeRequestError(error));
            setLoading(false);
        }
    }

    function onChange(value: string) {
        setGithub(value);
        // Once an error is showing, re-validate as the user fixes it.
        if (fieldError) {
            const parsed = parseGithubProfile(value);
            setFieldError("error" in parsed ? parsed.error : null);
        }
    }

    return (
        <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 pt-10 pb-8">
            <Brand />

            <div className="mt-16 mb-12">
                <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.025em] sm:text-[32px]">
                    Rehearse your technical interview out loud.
                </h1>
                <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
                    Paste your GitHub profile. An AI interviewer asks you 2–3 questions about your own
                    repos, live by voice, then scores you out of 10 with written feedback.
                </p>

                <form onSubmit={onSubmit} noValidate className="mt-10">
                    {requestError && (
                        <div
                            role="alert"
                            className="mb-5 flex gap-3 rounded-lg border border-destructive-text/25 bg-destructive-subtle p-3.5 text-sm"
                        >
                            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive-text" />
                            <div>
                                <p className="font-semibold">Couldn’t start the interview</p>
                                <p className="mt-0.5 text-muted-foreground">{requestError}</p>
                            </div>
                        </div>
                    )}

                    <Label htmlFor="github">GitHub profile URL</Label>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        <div className="relative flex-1">
                            <Github
                                aria-hidden
                                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                            />
                            <Input
                                ref={inputRef}
                                id="github"
                                name="github"
                                inputMode="url"
                                autoComplete="url"
                                autoCapitalize="none"
                                spellCheck={false}
                                placeholder="github.com/username"
                                value={github}
                                onChange={(e) => onChange(e.target.value)}
                                readOnly={loading}
                                aria-invalid={fieldError ? true : undefined}
                                aria-describedby="github-hint"
                                className={cn("pl-9", loading && "bg-muted")}
                            />
                        </div>
                        <Button
                            type="submit"
                            size="lg"
                            disabled={loading}
                            className="w-full sm:w-[166px]"
                        >
                            {loading ? (
                                <>
                                    <LoaderCircle className="animate-spin" />
                                    Starting…
                                </>
                            ) : requestError ? (
                                <>
                                    <RotateCcw />
                                    Try again
                                </>
                            ) : (
                                <>
                                    Start interview
                                    <ArrowRight />
                                </>
                            )}
                        </Button>
                    </div>

                    {/* One slot for hint / error / progress so the layout never jumps. */}
                    <div
                        id="github-hint"
                        role={loading ? "status" : undefined}
                        className={cn(
                            "mt-3 flex min-h-5 items-start gap-1.5 text-[13px] leading-normal",
                            fieldError ? "text-destructive-text" : "text-muted-foreground",
                        )}
                    >
                        {fieldError ? (
                            <>
                                <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                                {fieldError}
                            </>
                        ) : loading ? (
                            slow && "Reading your public repos. This takes a few seconds."
                        ) : (
                            <>
                                <Mic aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                                We’ll ask for microphone access once the interview starts.
                            </>
                        )}
                    </div>
                </form>
            </div>

            <ol className="mt-auto grid grid-cols-1 gap-4 border-t pt-6 sm:grid-cols-3 sm:gap-6">
                {STEPS.map(([title, body], i) => (
                    <li key={title} className="flex gap-3 sm:flex-col sm:gap-2">
                        <span
                            aria-hidden
                            className="grid size-[22px] shrink-0 place-items-center rounded-md bg-muted font-mono text-xs"
                        >
                            {i + 1}
                        </span>
                        <div>
                            <p className="text-sm font-semibold">{title}</p>
                            <p className="text-[13px] text-muted-foreground">{body}</p>
                        </div>
                    </li>
                ))}
            </ol>
        </main>
    );
}
