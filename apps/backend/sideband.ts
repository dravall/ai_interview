import WebSocket from "ws";
import { prisma } from "./db";
import { getOpenAIKey } from "./realtime";

// When a call closes without an explicit "end", the browser may be about to
// reconnect (its retries back off 1 s, 2 s, 4 s). Wait this long for a new
// sideband before treating the interview as over.
const RECONNECT_GRACE_MS = 30_000;
// If the sideband itself drops while the call may still be live, retry the
// same call this many times (1 s, 2 s, 4 s) before giving up on it.
const SIDEBAND_RECONNECT_ATTEMPTS = 3;

type SaveMessage = {
    interviewId: string;
    type: "User" | "Assistant";
    message: string;
    /** OpenAI's conversation item id, when known; saving is idempotent per item. */
    itemId?: string;
    /** When the turn happened (item creation), not when its transcript arrived. */
    spokenAt: Date;
};

/** Persistence used by the sideband; replaceable in tests. */
export const sidebandStore = {
    saveMessage: ({ interviewId, type, message, itemId, spokenAt }: SaveMessage): Promise<unknown> => {
        const data = { interviewId, type, message, itemId, createdAt: spokenAt };
        return itemId
            ? prisma.message.upsert({ where: { itemId }, create: data, update: {} })
            : prisma.message.create({ data });
    },
    markEnded: (interviewId: string): Promise<unknown> =>
        prisma.interview.updateMany({
            where: { id: interviewId, status: { in: ["Pre", "InProgress"] } },
            data: { status: "Ended" },
        }),
};

type Sideband = {
    interviewId: string;
    callId: string;
    ws: WebSocket;
    open: boolean;
    /** Set when we close the socket on purpose (replaced by a new call, or ended). */
    closeExpected: boolean;
    /** Set once End has been requested: a close now means the call is over. */
    ending: boolean;
    reconnectAttempts: number;
    reconnectTimer: ReturnType<typeof setTimeout> | null;
    /** Transcript inserts still in flight; the end flow waits for them. */
    pending: Set<Promise<unknown>>;
    /** When each conversation item was created, keyed by item id. */
    itemTimes: Map<string, Date>;
    /** Resolves once the sideband is closed for good (no more reconnects). */
    closed: Promise<void>;
    resolveClosed: () => void;
};

// One sideband per interview, in this process. A browser reconnect opens a new
// call, so the sideband for the old (dead) call is closed rather than left dangling.
const sidebands = new Map<string, Sideband>();
const endTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function hasOpenSideband(interviewId: string) {
    return sidebands.get(interviewId)?.open ?? false;
}

export function initSideband(callId: string, interviewId: string) {
    clearEndTimer(interviewId);
    const previous = sidebands.get(interviewId);
    if (previous) stopSideband(previous);

    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => (resolveClosed = resolve));
    const sideband: Sideband = {
        interviewId,
        callId,
        ws: undefined as unknown as WebSocket,
        open: false,
        closeExpected: false,
        ending: false,
        reconnectAttempts: 0,
        reconnectTimer: null,
        pending: new Set(),
        itemTimes: new Map(),
        closed,
        resolveClosed,
    };
    sidebands.set(interviewId, sideband);
    connect(sideband);
}

function connect(sideband: Sideband) {
    const { interviewId, callId } = sideband;
    const ws = new WebSocket("wss://api.openai.com/v1/realtime?call_id=" + callId, {
        headers: {
            Authorization: "Bearer " + getOpenAIKey(),
        },
    });
    sideband.ws = ws;

    ws.on("open", () => {
        if (ws !== sideband.ws) return;
        sideband.open = true;
        const again = sideband.reconnectAttempts > 0 ? "reconnected" : "connected";
        sideband.reconnectAttempts = 0;
        console.log(`Sideband ${again} (interview ${interviewId}, call ${callId})`);
    });

    ws.on("error", (error) => {
        console.error(`Sideband error (interview ${interviewId}):`, error);
    });

    ws.on("close", () => {
        if (ws !== sideband.ws) return;
        sideband.open = false;
        if (sideband.closeExpected || sideband.ending) {
            sideband.resolveClosed();
            return;
        }

        // Either the call ended (End, tab closed, browser connection lost) or
        // only this socket dropped while the call is still live. Retry the same
        // call first; an ended call refuses the connection, so we then give up.
        if (sideband.reconnectAttempts < SIDEBAND_RECONNECT_ATTEMPTS) {
            const delay = 1000 * 2 ** sideband.reconnectAttempts;
            sideband.reconnectAttempts++;
            sideband.reconnectTimer = setTimeout(() => {
                sideband.reconnectTimer = null;
                if (!sideband.closeExpected) connect(sideband);
            }, delay);
            return;
        }

        // The call is gone. End the interview unless the browser registers a
        // new call (reconnect) within the grace period.
        sideband.resolveClosed();
        endTimers.set(interviewId, setTimeout(() => {
            endTimers.delete(interviewId);
            void endInterview(interviewId, 0).catch((error) =>
                console.error(`Failed to end interview ${interviewId}:`, error));
        }, RECONNECT_GRACE_MS));
    });

    ws.on("message", (message) => {
        let event;
        try {
            event = JSON.parse(message.toString());
        } catch {
            return;
        }
        handleEvent(sideband, event);
    });
}

/** The subset of OpenAI Realtime server events the sideband reads. */
type RealtimeEvent = {
    type?: string;
    item?: { id?: string; type?: string };
    item_id?: string;
    transcript?: string;
    response?: { output?: { id?: string; content?: { type: string; transcript?: string }[] }[] };
    error?: { code?: string };
};

function handleEvent(sideband: Sideband, event: RealtimeEvent) {
    const { interviewId } = sideband;

    const save = (type: "User" | "Assistant", message: string, itemId: string | undefined) => {
        const spokenAt = (itemId && sideband.itemTimes.get(itemId)) || new Date();
        const insert = sidebandStore
            .saveMessage({ interviewId, type, message, itemId, spokenAt })
            .catch((error) => console.error(`Failed to save ${type} message (interview ${interviewId}):`, error));
        sideband.pending.add(insert);
        insert.finally(() => sideband.pending.delete(insert));
    };

    switch (event.type) {
        // A user turn is added when it's committed (they stopped speaking), an
        // assistant turn when the reply starts. Transcripts arrive later and in
        // either order, so this timestamp is what keeps the transcript in order.
        case "conversation.item.added":
        case "conversation.item.created": {
            const item = event.item;
            if (item?.type === "message" && item.id && !sideband.itemTimes.has(item.id)) {
                sideband.itemTimes.set(item.id, new Date());
            }
            break;
        }
        case "conversation.item.input_audio_transcription.completed": {
            const transcript = event.transcript?.trim();
            if (transcript) save("User", transcript, event.item_id);
            break;
        }
        case "response.done": {
            const items = event.response?.output ?? [];
            const transcript = items
                .flatMap((item) => item.content ?? [])
                .filter((part) => part.type === "output_audio")
                .map((part) => part.transcript ?? "")
                .join(" ")
                .trim();
            // A response cancelled by barge-in before any audio has no transcript.
            if (transcript) save("Assistant", transcript, items.find((item) => item.id)?.id);
            break;
        }
        case "error":
            // Expected: on End the browser commits any half-finished answer, and
            // OpenAI reports an empty buffer when the candidate wasn't speaking.
            if (event.error?.code === "input_audio_buffer_commit_empty") return;
            console.error(`Realtime error (interview ${interviewId}):`, event.error);
            break;
    }
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
        // The browser has hung up, so a drop now means the call ended: don't
        // try to reconnect, and don't wait for a socket that's already gone.
        if (sideband.reconnectTimer) {
            clearTimeout(sideband.reconnectTimer);
            sideband.reconnectTimer = null;
        }
        sideband.ending = true;
        if (!sideband.open) sideband.resolveClosed();

        if (sideband.open && timeoutMs > 0) {
            await Promise.race([sideband.closed, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
        }
        await Promise.allSettled([...sideband.pending]);
        stopSideband(sideband);
        if (sidebands.get(interviewId) === sideband) sidebands.delete(interviewId);
    }

    await sidebandStore.markEnded(interviewId);
}

function stopSideband(sideband: Sideband) {
    sideband.closeExpected = true;
    if (sideband.reconnectTimer) clearTimeout(sideband.reconnectTimer);
    sideband.reconnectTimer = null;
    sideband.ws.close();
    sideband.resolveClosed();
}

function clearEndTimer(interviewId: string) {
    const timer = endTimers.get(interviewId);
    if (timer) clearTimeout(timer);
    endTimers.delete(interviewId);
}
