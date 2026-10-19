import { api } from "@/lib/api";

const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export type RealtimeServerEvent = { type: string; [key: string]: unknown };

export type RealtimeConnection = {
    pc: RTCPeerConnection;
    dc: RTCDataChannel;
    /** Sends a client event over the `oai-events` data channel. */
    send: (event: Record<string, unknown>) => void;
    close: () => void;
};

type ConnectOptions = {
    interviewId: string;
    micTrack: MediaStreamTrack;
    onRemoteStream: (stream: MediaStream) => void;
    onEvent: (event: RealtimeServerEvent) => void;
    /** Fired once when the call drops for any reason other than close(). */
    onDisconnect: (reason: string) => void;
};

/**
 * Opens one Realtime call over WebRTC:
 * 1. backend mints a short-lived client secret (the API key stays server-side),
 * 2. the browser exchanges SDP with OpenAI directly using that secret,
 * 3. the call id from OpenAI's Location header goes back to the backend so it
 *    can attach its sideband (transcript capture) to the same call.
 */
export async function connectRealtime(opts: ConnectOptions): Promise<RealtimeConnection> {
    const { data: secret } = await api.post<{ clientSecret: string; expiresAt: number }>(
        `/api/v1/realtime/client-secret/${opts.interviewId}`
    );

    const pc = new RTCPeerConnection();
    const dc = pc.createDataChannel("oai-events");
    let closed = false;

    const close = () => {
        if (closed) return;
        closed = true;
        dc.close();
        // Leave the mic track running: it's owned by the caller and reused
        // across reconnects.
        pc.getSenders().forEach((s) => pc.removeTrack(s));
        pc.close();
    };

    const drop = (reason: string) => {
        if (closed) return;
        close();
        opts.onDisconnect(reason);
    };

    pc.ontrack = (e) => {
        const stream = e.streams[0];
        if (stream) opts.onRemoteStream(stream);
    };

    pc.onconnectionstatechange = () => {
        // "disconnected" can recover on its own; "failed" can't.
        if (pc.connectionState === "failed") drop("connection failed");
    };

    dc.onclose = () => drop("session closed");
    dc.onmessage = (e) => {
        try {
            opts.onEvent(JSON.parse(e.data));
        } catch {
            // Ignore non-JSON frames.
        }
    };

    try {
        pc.addTrack(opts.micTrack);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const sdpResponse = await fetch(OPENAI_CALLS_URL, {
            method: "POST",
            body: offer.sdp,
            headers: {
                Authorization: `Bearer ${secret.clientSecret}`,
                "Content-Type": "application/sdp",
            },
        });

        if (!sdpResponse.ok) {
            throw new Error(`Realtime call rejected (${sdpResponse.status}): ${await sdpResponse.text()}`);
        }

        const callId = sdpResponse.headers.get("Location")?.split("/").pop();
        await pc.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });

        if (!callId) throw new Error("OpenAI did not return a call id");
        await api.post(`/api/v1/realtime/sideband/${opts.interviewId}`, { callId });
    } catch (error) {
        closed = true;
        pc.close();
        throw error;
    }

    return {
        pc,
        dc,
        send: (event) => {
            if (dc.readyState === "open") dc.send(JSON.stringify(event));
        },
        close,
    };
}

/** Resolves once the data channel can carry client events. */
export function waitForOpen(dc: RTCDataChannel, timeoutMs = 10_000): Promise<void> {
    if (dc.readyState === "open") return Promise.resolve();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out opening the data channel")), timeoutMs);
        dc.addEventListener("open", () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
        dc.addEventListener("close", () => {
            clearTimeout(timer);
            reject(new Error("Data channel closed before opening"));
        }, { once: true });
    });
}
