import { api } from "@/lib/api";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { isAxiosError } from "axios";
import { CircleAlert, LoaderCircle, MessageSquare, Plus, RotateCcw, SearchX, WifiOff } from "lucide-react";
import { Button } from "./ui/button";
import { Brand } from "./Brand";
import { cn } from "@/lib/utils";

interface ResultData {
    transcript: { type: "Assistant" | "User"; content: string; createdAt: string }[];
    score: number;
    feedback: string;
    status: "Done" | "InProgress" | "Pre" | "Grading" | "Failed";
}

const SLOW_GRADING_MS = 90_000;

export function Result() {
    const { interviewId } = useParams();
    const [result, setResult] = useState<ResultData>({
        score: 0,
        feedback: "",
        transcript: [],
        status: "Pre",
    });
    const [retryKey, setRetryKey] = useState(0);
    const [slow, setSlow] = useState(false);
    // "not-found": the id is unknown or belongs to another browser session (404/403).
    // "network": the request itself failed; polling keeps going.
    const [loadError, setLoadError] = useState<"not-found" | "network" | null>(null);
    const tryAgainRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const fetchResult = async () => {
            try {
                const response = await api.get(`/api/v1/result/${interviewId}`);
                setResult(response.data);
                setLoadError(null);
                const s = response.data.status as ResultData["status"];
                if (s === "Done" || s === "Failed") clearInterval(intervalId);
            } catch (error) {
                const status = isAxiosError(error) ? error.response?.status : undefined;
                if (status === 404 || status === 403) {
                    setLoadError("not-found");
                    clearInterval(intervalId);
                } else {
                    setLoadError("network");
                }
            }
        };

        setLoadError(null);
        const intervalId = setInterval(fetchResult, 5000);
        fetchResult();

        setSlow(false);
        const slowTimer = setTimeout(() => setSlow(true), SLOW_GRADING_MS);

        return () => {
            clearInterval(intervalId);
            clearTimeout(slowTimer);
        };
    }, [interviewId, retryKey]);

    const ready = result.status === "Done";
    const failed = result.status === "Failed";

    useEffect(() => {
        if (failed) tryAgainRef.current?.focus();
    }, [failed]);

    return (
        <div className="flex min-h-dvh flex-col">
            <header className="flex h-[60px] shrink-0 items-center justify-between border-b px-4 sm:px-6">
                <Brand />
                <Button asChild variant="outline" size="sm">
                    <Link to="/">
                        <Plus />
                        <span className="sm:hidden">New</span>
                        <span className="hidden sm:inline">New interview</span>
                    </Link>
                </Button>
            </header>

            <main className="mx-auto w-full max-w-[640px] px-4 py-14">
                {loadError === "not-found" ? (
                    <div role="alert" className="flex flex-col items-center rounded-xl border px-6 py-16 text-center">
                        <span className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
                            <SearchX aria-hidden className="size-6" />
                        </span>
                        <h1 className="mt-5 text-xl font-semibold">Interview not found</h1>
                        <p className="mt-2 max-w-[400px] text-sm leading-relaxed text-muted-foreground">
                            This link doesn’t match an interview started in this browser. Results are only
                            visible to the browser that ran the interview.
                        </p>
                        <Button asChild size="lg" className="mt-6">
                            <Link to="/">Start a new interview</Link>
                        </Button>
                    </div>
                ) : failed ? (
                    <div role="alert" className="flex flex-col items-center rounded-xl border px-6 py-16 text-center">
                        <span className="grid size-14 place-items-center rounded-full bg-destructive-subtle text-destructive-text">
                            <CircleAlert aria-hidden className="size-6" />
                        </span>
                        <h1 className="mt-5 text-xl font-semibold">We couldn’t grade this interview</h1>
                        <p className="mt-2 max-w-[400px] text-sm leading-relaxed text-muted-foreground">
                            Something went wrong while scoring. Your conversation was recorded, so you can try
                            grading it again.
                        </p>
                        <div className="mt-6 flex flex-wrap justify-center gap-3">
                            <Button ref={tryAgainRef} size="lg" onClick={() => setRetryKey((k) => k + 1)}>
                                <RotateCcw />
                                Try again
                            </Button>
                            <Button asChild variant="outline" size="lg">
                                <Link to="/">New interview</Link>
                            </Button>
                        </div>
                    </div>
                ) : !ready ? (
                    <Grading slow={slow} offline={loadError === "network"} />
                ) : (
                    <Done result={result} />
                )}
            </main>
        </div>
    );
}

function Grading({ slow, offline }: { slow: boolean; offline: boolean }) {
    return (
        <div>
            <h1 className="sr-only">Interview results</h1>
            <div role="status" className="flex items-start gap-3">
                <LoaderCircle aria-hidden className="mt-0.5 size-5 shrink-0 animate-spin text-primary" />
                <div>
                    <p className="text-lg font-semibold">Analyzing your interview…</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        We’re scoring your answers and writing feedback. This page updates by itself, usually
                        within a minute.
                    </p>
                    {offline ? (
                        <p className="mt-2 flex items-center gap-1.5 text-sm text-destructive-text">
                            <WifiOff aria-hidden className="size-3.5" />
                            Can’t reach the server. Retrying…
                        </p>
                    ) : (
                        slow && (
                            <p className="mt-2 text-sm text-muted-foreground">
                                Taking longer than usual. You can leave this page and come back.
                            </p>
                        )
                    )}
                </div>
            </div>

            {/* Skeleton in the shape of the finished page. */}
            <div aria-hidden className="mt-14 animate-skeleton">
                <div className="h-24 w-[168px] rounded-xl bg-muted" />
                <div className="mt-6 h-1.5 w-full max-w-[320px] rounded-full bg-muted" />
                <div className="mt-14 h-5 w-32 rounded-md bg-muted" />
                <div className="mt-5 space-y-3">
                    <div className="h-3.5 w-full rounded bg-muted" />
                    <div className="h-3.5 w-full rounded bg-muted" />
                    <div className="h-3.5 w-11/12 rounded bg-muted" />
                    <div className="h-3.5 w-2/3 rounded bg-muted" />
                </div>
            </div>
        </div>
    );
}

function Done({ result }: { result: ResultData }) {
    const paragraphs = result.feedback.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const turns = result.transcript.length;

    return (
        <div className="flex flex-col gap-14">
            <section>
                <p className="font-mono text-xs uppercase tracking-[0.04em] text-muted-foreground">
                    Interview complete
                </p>
                <h1
                    aria-label={`Score: ${result.score} out of 10`}
                    className="mt-4 flex items-baseline gap-2"
                >
                    <span className="text-[96px] leading-[0.9] font-semibold tracking-[-0.06em] tabular-nums sm:text-[120px]">
                        {result.score}
                    </span>
                    <span className="text-[28px] text-muted-foreground">/10</span>
                </h1>
                <div aria-hidden className="mt-6 flex w-full gap-1 sm:w-[320px]">
                    {Array.from({ length: 10 }, (_, i) => (
                        <span
                            key={i}
                            className={cn("h-1.5 flex-1 rounded-full", i < result.score ? "bg-foreground" : "bg-border")}
                        />
                    ))}
                </div>
            </section>

            <section>
                <h2 className="text-lg font-semibold">Feedback</h2>
                <div className="mt-4 space-y-4 text-[15px] leading-[1.7]">
                    {paragraphs.map((p, i) => (
                        <p key={i} className="whitespace-pre-line">{p}</p>
                    ))}
                </div>
            </section>

            <section>
                <div className="flex items-baseline justify-between">
                    <h2 className="text-lg font-semibold">Transcript</h2>
                    {turns > 0 && (
                        <span className="font-mono text-xs uppercase tracking-[0.04em] text-muted-foreground">
                            {turns} {turns === 1 ? "turn" : "turns"}
                        </span>
                    )}
                </div>

                {turns === 0 ? (
                    <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed p-10 text-center">
                        <MessageSquare aria-hidden className="size-6 text-muted-foreground" />
                        <p className="mt-3 text-sm font-semibold">No transcript for this interview</p>
                        <p className="mt-1 text-[13px] text-muted-foreground">
                            The call ended before anything was said, so there’s nothing to show here.
                        </p>
                    </div>
                ) : (
                    <ol className="mt-4 border-t">
                        {result.transcript.map((m, i) => {
                            const isAi = m.type === "Assistant";
                            return (
                                <li key={i} className="grid grid-cols-1 gap-2 border-b py-4 sm:grid-cols-[104px_1fr] sm:gap-4">
                                    <span className="pt-0.5">
                                        <span
                                            className={cn(
                                                "font-mono text-xs uppercase tracking-[0.04em]",
                                                isAi
                                                    ? "text-muted-foreground"
                                                    : "rounded bg-primary-subtle px-1.5 py-0.5 text-primary",
                                            )}
                                        >
                                            {isAi ? "Interviewer" : "You"}
                                        </span>
                                    </span>
                                    <p className="text-[15px] leading-[1.65]">{m.content}</p>
                                </li>
                            );
                        })}
                    </ol>
                )}
            </section>

            <div className="flex justify-center">
                <Button asChild size="lg" className="w-full sm:w-auto">
                    <Link to="/">New interview</Link>
                </Button>
            </div>
        </div>
    );
}
