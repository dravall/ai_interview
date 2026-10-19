import { api } from "@/lib/api";
import { connectRealtime, waitForOpen, type RealtimeConnection, type RealtimeServerEvent } from "@/lib/realtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { isAxiosError } from "axios";
import { CircleAlert, LoaderCircle, Mic, MicOff, PhoneOff, RotateCcw, WifiOff } from "lucide-react";
import { Button } from "./ui/button";
import { Brand } from "./Brand";
import { StatusPill, type InterviewStatus } from "./interview/StatusPill";
import { VoiceTile } from "./interview/VoiceTile";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

const MAX_RECONNECT_ATTEMPTS = 3;
// The mic stays off while the interviewer's opening plays: browser echo
// cancellation needs a few seconds to adapt, and until then the interviewer
// can hear itself through the speakers and interrupt its own greeting.
const GREETING_GUARD_MAX_MS = 30_000;
// On End, how long to wait for the transcript of a half-finished answer.
const FINAL_TRANSCRIPT_WAIT_MS = 3_000;

type ErrorInfo = { kind: "mic" | "service" | "network"; title: string; body: string };

/** Attaches an analyser to a stream and returns a getter for its current 0..1 volume level. */
function createLevelMeter(ctx: AudioContext, stream: MediaStream) {
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    return () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            const v = (data[i]! - 128) / 128;
            sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        // Boost and clamp so normal speech fills most of the range.
        return Math.min(1, rms * 3.2);
    };
}

const NETWORK_ERROR: ErrorInfo = {
    kind: "network",
    title: "We couldn’t reconnect",
    body: "The connection kept dropping. Check your network, then try again.",
};

function classifyError(error: unknown): ErrorInfo {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
        return {
            kind: "mic",
            title: "Microphone access was blocked",
            body: "Click the microphone icon in your browser’s address bar, set it to Allow, then try again.",
        };
    }
    if (error instanceof DOMException && error.name === "NotFoundError") {
        return { kind: "mic", title: "No microphone found", body: "Connect a microphone, then try again." };
    }
    // Our backend (client secret) or OpenAI (SDP exchange) refused the call.
    if (isAxiosError(error) || (error instanceof Error && error.message.startsWith("Realtime call rejected"))) {
        return {
            kind: "service",
            title: "The interview service is unavailable",
            body: "We couldn’t start a voice session. Wait a moment, then try again.",
        };
    }
    return NETWORK_ERROR;
}

function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function Interview() {
    const { interviewId } = useParams();
    const navigate = useNavigate();
    const compact = useMediaQuery("(max-width: 639px)");

    const [status, setStatus] = useState<InterviewStatus>("connecting");
    const [error, setError] = useState<ErrorInfo | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [muted, setMuted] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [aiSpeaking, setAiSpeaking] = useState(false);
    const [userSpeaking, setUserSpeaking] = useState(false);
    const [aiHasSpoken, setAiHasSpoken] = useState(false);
    const [userHasSpoken, setUserHasSpoken] = useState(false);
    const [announcement, setAnnouncement] = useState("");
    const [greeting, setGreeting] = useState(false);

    // Live across reconnects: the mic, audio graph and output element.
    // Only the RTCPeerConnection is replaced when a call drops.
    const connRef = useRef<RealtimeConnection | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const aiMeterRef = useRef<(() => number) | null>(null);
    const userMeterRef = useRef<(() => number) | null>(null);
    const retryRef = useRef<() => void>(() => {});
    const stopRef = useRef<() => void>(() => {});
    const tryAgainRef = useRef<HTMLButtonElement>(null);
    const audioElRef = useRef<HTMLAudioElement | null>(null);
    const mutedRef = useRef(false);
    const greetingRef = useRef(false);
    // Extra listeners for data-channel events (used by the End flow).
    const eventListenersRef = useRef(new Set<(event: RealtimeServerEvent) => void>());

    /** The mic sends audio only when the user isn't muted and the greeting guard is off. */
    const applyMic = useCallback(() => {
        const track = micStreamRef.current?.getAudioTracks()[0];
        if (track) track.enabled = !mutedRef.current && !greetingRef.current;
    }, []);

    useEffect(() => {
        if (!interviewId) return;

        let stopped = false;
        let attempts = 0;
        let lastError: ErrorInfo = NETWORK_ERROR;
        // Bumped per connection attempt so a failure reported twice (e.g. the
        // data channel closing *and* waitForOpen rejecting) retries only once.
        let generation = 0;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;

        const audioEl = document.createElement("audio");
        audioEl.autoplay = true;
        audioElRef.current = audioEl;
        let greetingTimer: ReturnType<typeof setTimeout> | null = null;

        function endGreetingGuard() {
            if (greetingTimer) clearTimeout(greetingTimer);
            greetingTimer = null;
            greetingRef.current = false;
            setGreeting(false);
            applyMic();
        }

        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;

        function handleDrop(gen: number, reason: string, info?: ErrorInfo) {
            if (stopped || gen !== generation) return;
            generation += 1;
            connRef.current?.close();
            connRef.current = null;
            aiMeterRef.current = null;
            console.warn("Realtime call dropped:", reason);
            if (info) lastError = info;

            attempts += 1;
            if (info?.kind === "mic" || attempts > MAX_RECONNECT_ATTEMPTS) {
                setError(lastError);
                setStatus("error");
                return;
            }

            setAttempt(attempts);
            setStatus("reconnecting");
            retryTimer = setTimeout(connect, 1000 * 2 ** (attempts - 1));
        }

        async function connect() {
            const gen = ++generation;
            try {
                if (!micStreamRef.current) {
                    const mic = await navigator.mediaDevices.getUserMedia({
                        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                    });
                    if (stopped) {
                        mic.getTracks().forEach((t) => t.stop());
                        return;
                    }
                    micStreamRef.current = mic;
                    userMeterRef.current = createLevelMeter(audioCtx, mic);
                }
                audioCtx.resume().catch(() => {});

                const conn = await connectRealtime({
                    interviewId: interviewId!,
                    micTrack: micStreamRef.current.getAudioTracks()[0]!,
                    onRemoteStream: (stream) => {
                        audioEl.srcObject = stream;
                        aiMeterRef.current = createLevelMeter(audioCtx, stream);
                    },
                    onEvent: (event) => {
                        eventListenersRef.current.forEach((listener) => listener(event));
                        // WebRTC-only event: the interviewer's audio finished playing.
                        if (greetingRef.current && (event.type === "output_audio_buffer.stopped" || event.type === "output_audio_buffer.cleared")) {
                            endGreetingGuard();
                        }
                        if (event.type !== "error") return;
                        const err = event.error as { code?: string; message?: string } | undefined;
                        console.error("Realtime error event:", err);
                        // Sessions have a maximum duration; when one expires,
                        // start a fresh call (the backend replays the transcript).
                        if (err?.code?.includes("expired")) handleDrop(gen, err.message ?? "Session expired");
                    },
                    onDisconnect: (reason) => handleDrop(gen, reason),
                });

                if (stopped || gen !== generation) {
                    conn.close();
                    return;
                }
                connRef.current = conn;

                await waitForOpen(conn.dc);
                // The interviewer speaks first (or, after a reconnect, picks
                // the conversation back up), with the mic held off until it's done.
                greetingRef.current = true;
                setGreeting(true);
                applyMic();
                greetingTimer = setTimeout(endGreetingGuard, GREETING_GUARD_MAX_MS);
                conn.send({ type: "response.create" });

                attempts = 0;
                setError(null);
                setStatus("live");
            } catch (err) {
                handleDrop(gen, err instanceof Error ? err.message : String(err), classifyError(err));
            }
        }

        retryRef.current = () => {
            attempts = 0;
            setError(null);
            setStatus("connecting");
            connect();
        };

        stopRef.current = () => {
            stopped = true;
            if (retryTimer) clearTimeout(retryTimer);
            if (greetingTimer) clearTimeout(greetingTimer);
            connRef.current?.close();
            connRef.current = null;
            micStreamRef.current?.getTracks().forEach((t) => t.stop());
            micStreamRef.current = null;
            aiMeterRef.current = null;
            userMeterRef.current = null;
            audioEl.pause();
            audioEl.srcObject = null;
            audioCtx.close().catch(() => {});
        };

        connect();

        return () => stopRef.current();
    }, [interviewId, applyMic]);

    // The clock runs only while live: paused during reconnects, frozen on end.
    useEffect(() => {
        if (status !== "live") return;
        const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
        return () => clearInterval(timer);
    }, [status]);

    useEffect(() => {
        if (status === "error") tryAgainRef.current?.focus();
    }, [status]);

    const toggleMute = useCallback(() => {
        if (!micStreamRef.current) return;
        // A disabled track sends silence, so server VAD sees no speech.
        mutedRef.current = !muted;
        applyMic();
        setMuted(!muted);
        setAnnouncement(muted ? "Microphone on" : "Microphone muted");
    }, [muted, applyMic]);

    // M toggles mute, unless the user is typing somewhere.
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key.toLowerCase() !== "m" || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
            const target = e.target as HTMLElement | null;
            if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
            if (status !== "live") return;
            e.preventDefault();
            toggleMute();
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [status, toggleMute]);

    /**
     * With "let the candidate pause" turn detection, an answer cut off by End
     * hasn't been committed as a turn yet, so it would never be transcribed.
     * Commit it explicitly and give the transcription a moment to arrive.
     */
    async function finalizeTranscript() {
        const conn = connRef.current;
        if (!conn || conn.dc.readyState !== "open") return;

        if (audioElRef.current) audioElRef.current.muted = true;
        conn.send({ type: "input_audio_buffer.commit" });
        greetingRef.current = true; // reuse the guard to stop sending mic audio
        applyMic();

        await new Promise<void>((resolve) => {
            const listeners = eventListenersRef.current;
            const finish = () => {
                listeners.delete(onEvent);
                clearTimeout(timer);
                resolve();
            };
            const onEvent = (event: RealtimeServerEvent) => {
                const code = (event.error as { code?: string } | undefined)?.code ?? "";
                if (
                    event.type === "conversation.item.input_audio_transcription.completed" ||
                    event.type === "conversation.item.input_audio_transcription.failed" ||
                    // Nothing pending (e.g. the answer was already complete).
                    (event.type === "error" && code.includes("buffer"))
                ) finish();
            };
            const timer = setTimeout(finish, FINAL_TRANSCRIPT_WAIT_MS);
            listeners.add(onEvent);
        });
    }

    async function endInterview() {
        setStatus("ending");
        await finalizeTranscript();
        stopRef.current();
        // Lets the server wait for the last transcript events before grading.
        // If it fails, the server still ends the interview when the call closes.
        await api.post(`/api/v1/interview/${interviewId}/end`).catch(() => {});
        navigate(`/result/${interviewId}`);
    }

    const getAiLevel = useCallback(() => aiMeterRef.current?.() ?? 0, []);
    const getUserLevel = useCallback(() => userMeterRef.current?.() ?? 0, []);
    const onAiSpeaking = useCallback((speaking: boolean) => {
        setAiSpeaking(speaking);
        if (speaking) setAiHasSpoken(true);
    }, []);
    const onUserSpeaking = useCallback((speaking: boolean) => {
        setUserSpeaking(speaking);
        if (speaking) setUserHasSpoken(true);
    }, []);

    let caption: string | null = null;
    let sub: string | null = null;
    if (status === "connecting") {
        caption = "Setting up your interview & microphone…";
        sub = "Your browser will ask for microphone access. Choose Allow.";
    } else if (status === "ending") {
        caption = "Wrapping up…";
        sub = "Taking you to your results.";
    } else if (status === "live") {
        if (greeting) {
            caption = "The interviewer is introducing the interview";
            sub = "Your microphone turns on when it finishes.";
        } else if (muted) caption = "You’re muted. Unmute to answer.";
        else if (userSpeaking) caption = "Go ahead, the interviewer is listening";
        else if (aiSpeaking) {
            caption = "Interviewer is speaking";
            if (!userHasSpoken) sub = "Jump in anytime. Just start talking.";
        } else if (!aiHasSpoken) caption = "The interviewer will start in a moment";
        else caption = "Go ahead, the interviewer is listening";
    }

    const timer =
        status === "reconnecting" ? `${formatTime(elapsed)} · paused`
        : status === "error" ? "—"
        : formatTime(elapsed);

    return (
        <main className="flex h-dvh w-full flex-col overflow-hidden">
            {/* Top bar */}
            <header className="grid h-[60px] shrink-0 grid-cols-[1fr_auto] items-center gap-4 border-b px-4 sm:grid-cols-3 sm:px-6">
                <div className="flex items-center gap-4">
                    <Brand className="hidden sm:flex" />
                    <StatusPill status={status} announcement={announcement} />
                </div>
                <div className="hidden sm:block" />
                <span className="justify-self-end font-mono text-[13px] text-muted-foreground tabular-nums">
                    {timer}
                </span>
            </header>

            {/* Stage */}
            <div className="relative flex flex-1 flex-col items-center justify-center px-4">
                {status === "reconnecting" && (
                    <div className="absolute top-4 right-4 left-4 mx-auto flex max-w-[720px] items-start gap-3 rounded-xl border bg-muted p-3.5 text-sm">
                        <WifiOff aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <p className="flex-1">
                            Connection dropped. We’re reconnecting, and the interview picks up where it left off.
                        </p>
                        <span className="hidden shrink-0 font-mono text-xs uppercase tracking-[0.04em] text-muted-foreground sm:inline">
                            Attempt {attempt} of {MAX_RECONNECT_ATTEMPTS}
                        </span>
                    </div>
                )}

                {status === "error" && error ? (
                    <div role="alert" className="flex max-w-[420px] flex-col items-center text-center">
                        <span className="grid size-14 place-items-center rounded-full bg-destructive-subtle text-destructive-text">
                            {error.kind === "mic" ? (
                                <MicOff aria-hidden className="size-6" />
                            ) : error.kind === "network" ? (
                                <WifiOff aria-hidden className="size-6" />
                            ) : (
                                <CircleAlert aria-hidden className="size-6" />
                            )}
                        </span>
                        <h2 className="mt-5 text-xl font-semibold">{error.title}</h2>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error.body}</p>
                        <div className="mt-6 flex flex-wrap justify-center gap-3">
                            <Button ref={tryAgainRef} size="lg" onClick={() => retryRef.current()}>
                                <RotateCcw />
                                Try again
                            </Button>
                            <Button asChild variant="outline" size="lg">
                                <Link to="/">Back to start</Link>
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex w-full max-w-[720px] flex-col items-center">
                        <div className={cn("flex items-start justify-center", compact ? "gap-9" : "gap-16")}>
                            <VoiceTile
                                who="interviewer"
                                getLevel={getAiLevel}
                                phase={status}
                                compact={compact}
                                onSpeakingChange={onAiSpeaking}
                            />
                            <VoiceTile
                                who="you"
                                getLevel={getUserLevel}
                                phase={status}
                                muted={muted}
                                compact={compact}
                                onSpeakingChange={onUserSpeaking}
                            />
                        </div>

                        <div className="mt-10 flex min-h-12 flex-col items-center text-center">
                            {caption && (
                                <p className="flex items-center gap-2 text-[15px]">
                                    {status === "ending" && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
                                    {caption}
                                </p>
                            )}
                            {sub && <p className="mt-1 text-[13px] text-muted-foreground">{sub}</p>}
                        </div>
                    </div>
                )}
            </div>

            {/* Controls */}
            {status !== "error" && (
                <footer className="flex shrink-0 justify-center gap-3 border-t px-4 pt-5 pb-[calc(20px+env(safe-area-inset-bottom))]">
                    <Button
                        variant="outline"
                        size="lg"
                        onClick={toggleMute}
                        disabled={status !== "live"}
                        aria-pressed={muted}
                        aria-keyshortcuts="M"
                        className={cn(
                            "flex-1 sm:w-[136px] sm:flex-none",
                            muted && "border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background",
                        )}
                    >
                        {muted ? <MicOff /> : <Mic />}
                        {muted ? "Unmute" : "Mute"}
                    </Button>
                    <Button
                        variant="destructive"
                        size="lg"
                        onClick={endInterview}
                        disabled={status === "connecting" || status === "ending"}
                        aria-label="End interview"
                        className="flex-1 sm:flex-none"
                    >
                        <PhoneOff />
                        {compact ? "End" : "End interview"}
                    </Button>
                </footer>
            )}
        </main>
    );
}
