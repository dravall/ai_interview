import { EventEmitter } from "node:events";
import { afterAll, afterEach, describe, expect, jest, mock, test } from "bun:test";

// A stand-in for the `ws` client: tests drive it by emitting events.
class FakeWebSocket extends EventEmitter {
    static instances: FakeWebSocket[] = [];
    constructor(public url: string) {
        super();
        FakeWebSocket.instances.push(this);
    }
    close() {
        this.emit("close");
    }
    receive(event: object) {
        this.emit("message", Buffer.from(JSON.stringify(event)));
    }
}

const log: string[] = [];
const saved: { type: string; message: string; itemId?: string; spokenAt: Date }[] = [];
let insertDelayMs = 0;

// Only `ws` is mocked: Bun's mock.module is process-wide, and no other test file
// uses ws. Persistence is swapped through sidebandStore instead of mocking ./db.
mock.module("ws", () => ({ default: FakeWebSocket }));
process.env.OPENAI_API_KEY ||= "test-key";

const { initSideband, endInterview, hasOpenSideband, sidebandStore } = await import("./sideband");

// Test files share one process, so restore the real store for the files that run after this one.
const realStore = { ...sidebandStore };
afterAll(() => Object.assign(sidebandStore, realStore));

sidebandStore.saveMessage = async ({ type, message, itemId, spokenAt }) => {
    await new Promise((resolve) => setTimeout(resolve, insertDelayMs));
    saved.push({ type, message, itemId, spokenAt });
    log.push(`insert ${type}: ${message}`);
};
sidebandStore.markEnded = async () => {
    log.push("status Ended");
};

afterEach(() => {
    log.length = 0;
    saved.length = 0;
    insertDelayMs = 0;
    FakeWebSocket.instances.length = 0;
    jest.useRealTimers();
});

/** Lets async work started by a fired timer (endInterview's DB calls) finish. */
async function flushAsync() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}

function connect(interviewId: string) {
    initSideband("rtc_test", interviewId);
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emit("open");
    return ws;
}

describe("sideband", () => {
    test("saves candidate and interviewer transcripts", async () => {
        const ws = connect("i1");
        ws.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: " Hello " });
        ws.receive({
            type: "response.done",
            response: { output: [{ id: "a1", content: [{ type: "output_audio", transcript: "Hi there" }] }] },
        });
        await endInterview("i1", 0);

        expect(log).toEqual(["insert User: Hello", "insert Assistant: Hi there", "status Ended"]);
        expect(saved.map((m) => m.itemId)).toEqual(["u1", "a1"]);
    });

    test("ignores empty barge-in responses and malformed frames", async () => {
        const ws = connect("i2");
        ws.emit("message", Buffer.from("not json"));
        ws.receive({ type: "response.done", response: { output: [{ content: [{ type: "output_audio", transcript: "" }] }] } });
        await endInterview("i2", 0);

        expect(log).toEqual(["status Ended"]);
    });

    test("stamps each turn with when it was spoken, not when its transcript arrived", async () => {
        const ws = connect("i3");
        ws.receive({ type: "conversation.item.added", item: { id: "u1", type: "message" } });
        await new Promise((resolve) => setTimeout(resolve, 5));
        ws.receive({ type: "conversation.item.added", item: { id: "a1", type: "message" } });

        // The reply's transcript lands before the candidate's.
        ws.receive({ type: "response.done", response: { output: [{ id: "a1", content: [{ type: "output_audio", transcript: "Why?" }] }] } });
        ws.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "Because." });
        await endInterview("i3", 0);

        const user = saved.find((m) => m.type === "User")!;
        const assistant = saved.find((m) => m.type === "Assistant")!;
        expect(log.slice(0, 2)).toEqual(["insert Assistant: Why?", "insert User: Because."]);
        expect(user.spokenAt.getTime()).toBeLessThan(assistant.spokenAt.getTime());
    });

    test("end waits for in-flight transcript saves before marking the interview Ended", async () => {
        insertDelayMs = 50;
        const ws = connect("i4");
        ws.receive({ type: "conversation.item.input_audio_transcription.completed", transcript: "last answer" });
        setTimeout(() => ws.emit("close"), 10); // OpenAI closes the call shortly after the browser hangs up

        await endInterview("i4", 1_000);

        expect(log).toEqual(["insert User: last answer", "status Ended"]);
        expect(hasOpenSideband("i4")).toBe(false);
    });

    test("a dropped sideband reconnects to the same call and the interview continues", async () => {
        jest.useFakeTimers();
        const ws = connect("i5");
        ws.emit("close"); // socket dropped, call still live

        jest.advanceTimersByTime(1_000);
        const retry = FakeWebSocket.instances.at(-1)!;
        expect(retry).not.toBe(ws);
        expect(retry.url).toContain("call_id=rtc_test");
        retry.emit("open");

        jest.advanceTimersByTime(120_000);
        await flushAsync();
        expect(log).toEqual([]);
        expect(hasOpenSideband("i5")).toBe(true);
        await endInterview("i5", 0);
    });

    test("after 3 failed reconnects the call is treated as over and ends after the grace period", async () => {
        jest.useFakeTimers();
        const ws = connect("i6");
        ws.emit("close");

        for (const delay of [1_000, 2_000, 4_000]) {
            jest.advanceTimersByTime(delay);
            FakeWebSocket.instances.at(-1)!.emit("close"); // the ended call refuses the connection
        }
        expect(FakeWebSocket.instances).toHaveLength(4);

        jest.advanceTimersByTime(29_000);
        await flushAsync();
        expect(log).toEqual([]);
        jest.advanceTimersByTime(2_000);
        await flushAsync();
        expect(log).toEqual(["status Ended"]);
    });

    test("a browser reconnect within the grace period keeps the interview going", async () => {
        jest.useFakeTimers();
        const first = connect("i7");
        first.emit("close");
        jest.advanceTimersByTime(500);

        connect("i7"); // browser reconnected with a new call
        const sockets = FakeWebSocket.instances.length;
        jest.advanceTimersByTime(60_000);
        await flushAsync();

        expect(log).toEqual([]);
        expect(FakeWebSocket.instances).toHaveLength(sockets); // the old call isn't retried
        expect(hasOpenSideband("i7")).toBe(true);
        await endInterview("i7", 0);
    });

    test("End during a sideband reconnect finishes promptly and stops reconnecting", async () => {
        const ws = connect("i8");
        ws.emit("close"); // a reconnect is now scheduled for 1 s
        const started = Date.now();

        await endInterview("i8", 5_000);

        expect(Date.now() - started).toBeLessThan(500);
        expect(log).toEqual(["status Ended"]);
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    test("doesn't log the empty-buffer response to End's commit, but logs real errors", async () => {
        const logged: unknown[] = [];
        const realError = console.error;
        console.error = (...args: unknown[]) => { logged.push(args); };
        try {
            const ws = connect("i9");
            ws.receive({ type: "error", error: { code: "input_audio_buffer_commit_empty" } });
            expect(logged).toHaveLength(0);
            ws.receive({ type: "error", error: { code: "session_expired" } });
            expect(logged).toHaveLength(1);
            await endInterview("i9", 0);
        } finally {
            console.error = realError;
        }
    });
});
