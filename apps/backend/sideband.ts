import WebSocket from "ws";
import { prisma } from "./db";
import { getOpenAIKey } from "./realtime";

// When a call closes without an explicit "end", the browser may be about to
// reconnect (its retries back off 1 s, 2 s, 4 s). Wait this long for a new
// sideband before treating the interview as over.
const RECONNECT_GRACE_MS = 30_000;

/** Persistence used by the sideband; replaceable in tests. */
export const sidebandStore = {
    saveMessage: (interviewId: string, type: "User" | "Assistant", message: string): Promise<unknown> =>
        prisma.message.create({ data: { interviewId, type, message } }),
    markEnded: (interviewId: string): Promise<unknown> =>
        prisma.interview.updateMany({
            where: { id: interviewId, status: { in: ["Pre", "InProgress"] } },
            data: { status: "Ended" },
        }),
};

type Sideband = {
    ws: WebSocket;
    open: boolean;
    /** Set when we close the socket ourselves (reconnect or end), so its close isn't treated as the call ending. */
    closeExpected: boolean;
    /** Transcript inserts still in flight; the end flow waits for them. */
    pending: Set<Promise<unknown>>;
    closed: Promise<void>;
};

// One sideband per interview, in this process. A reconnect opens a new call,
// so the socket for the old (dead) call is closed rather than left dangling.
const sidebands = new Map<string, Sideband>();
const endTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function hasOpenSideband(interviewId: string) {
    return sidebands.get(interviewId)?.open ?? false;
}

export function initSideband(callId: string, interviewId: string) {
    clearEndTimer(interviewId);
    const previous = sidebands.get(interviewId);
    if (previous) {
        previous.closeExpected = true;
        previous.ws.close();
    }

    const url = "wss://api.openai.com/v1/realtime?call_id=" + callId;
    const ws = new WebSocket(url, {
        headers: {
            Authorization: "Bearer " + getOpenAIKey(),
        },
    });

    let resolveClosed!: () => void;
    const sideband: Sideband = {
        ws,
        open: false,
        closeExpected: false,
        pending: new Set(),
        closed: new Promise((resolve) => (resolveClosed = resolve)),
    };
    sidebands.set(interviewId, sideband);

    const save = (type: "User" | "Assistant", message: string) => {
        const insert = sidebandStore
            .saveMessage(interviewId, type, message)
            .catch((error) => console.error(`Failed to save ${type} message (interview ${interviewId}):`, error));
        sideband.pending.add(insert);
        insert.finally(() => sideband.pending.delete(insert));
    };

    ws.on("open", () => {
        sideband.open = true;
        console.log(`Sideband connected (interview ${interviewId}, call ${callId})`);
    });

    ws.on("error", (error) => {
        console.error(`Sideband error (interview ${interviewId}):`, error);
    });

    ws.on("close", () => {
        sideband.open = false;
        resolveClosed();
        if (sideband.closeExpected) return;

        // The call ended: the user clicked End, closed the tab, or the
        // connection dropped and the browser may reconnect. End the interview
        // unless a new sideband registers within the grace period.
        endTimers.set(interviewId, setTimeout(() => {
            endTimers.delete(interviewId);
            void endInterview(interviewId, 0).catch((error) =>
                console.error(`Failed to end interview ${interviewId}:`, error));
        }, RECONNECT_GRACE_MS));
    });

    ws.on("message", (message) => {
        let parsedMessage;
        try {
            parsedMessage = JSON.parse(message.toString());
        } catch {
            return;
        }

        if (parsedMessage.type == "conversation.item.input_audio_transcription.completed") {
            const transcript = parsedMessage.transcript?.trim();
            if (transcript) save("User", transcript);
        } else if (parsedMessage.type == "response.done") {
            let contents: {type: string, transcript: string}[] = [];

            parsedMessage.response.output.map((x: { content: { type: string; transcript: string }[] }) => contents = [...contents, ...x.content]);
            const assistantMessage = contents.filter(x => x.type === "output_audio").map(x => x.transcript).join(" ").trim();
            // A response cancelled by barge-in before any audio has no transcript.
            if (assistantMessage) save("Assistant", assistantMessage);
        } else if (parsedMessage.type == "error") {
            // Expected: on End the browser commits any half-finished answer, and
            // OpenAI reports an empty buffer when the candidate wasn't speaking.
            if (parsedMessage.error?.code === "input_audio_buffer_commit_empty") return;
            console.error(`Realtime error (interview ${interviewId}):`, parsedMessage.error);
        }
    });
}

/**
 * Marks the interview Ended once its transcript has settled: waits up to
 * `timeoutMs` for OpenAI to close the call's sideband, then for any transcript
 * inserts still in flight. Safe to call more than once.
 */
export async function endInterview(interviewId: string, timeoutMs: number) {
    clearEndTimer(interviewId);
    const sideband = sidebands.get(interviewId);

    if (sideband) {
        if (sideband.open && timeoutMs > 0) {
            await Promise.race([sideband.closed, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
        }
        await Promise.allSettled([...sideband.pending]);
        sideband.closeExpected = true;
        sideband.ws.close();
        if (sidebands.get(interviewId) === sideband) sidebands.delete(interviewId);
    }

    await sidebandStore.markEnded(interviewId);
}

function clearEndTimer(interviewId: string) {
    const timer = endTimers.get(interviewId);
    if (timer) clearTimeout(timer);
    endTimers.delete(interviewId);
}
