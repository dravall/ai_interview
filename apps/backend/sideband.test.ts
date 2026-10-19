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
let insertDelayMs = 0;

// Only `ws` is mocked: Bun's mock.module is process-wide, and no other test file
// uses ws. Persistence is swapped through sidebandStore instead of mocking ./db.
mock.module("ws", () => ({ default: FakeWebSocket }));
process.env.OPENAI_API_KEY ||= "test-key";

const { initSideband, endInterview, hasOpenSideband, sidebandStore } = await import("./sideband");

// Test files share one process, so restore the real store for the files that run after this one.
const realStore = { ...sidebandStore };
afterAll(() => Object.assign(sidebandStore, realStore));

sidebandStore.saveMessage = async (_id, type, message) => {
    await new Promise((resolve) => setTimeout(resolve, insertDelayMs));
    log.push(`insert ${type}: ${message}`);
};
sidebandStore.markEnded = async () => {
    log.push("status Ended");
};

afterEach(() => {
    log.length = 0;
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
        ws.receive({ type: "conversation.item.input_audio_transcription.completed", transcript: " Hello " });
        ws.receive({
            type: "response.done",
            response: { output: [{ content: [{ type: "output_audio", transcript: "Hi there" }] }] },
        });
        await endInterview("i1", 0);

        expect(log).toEqual(["insert User: Hello", "insert Assistant: Hi there", "status Ended"]);
    });

    test("ignores empty barge-in responses and malformed frames", async () => {
        const ws = connect("i2");
        ws.emit("message", Buffer.from("not json"));
        ws.receive({ type: "response.done", response: { output: [{ content: [{ type: "output_audio", transcript: "" }] }] } });
        await endInterview("i2", 0);

        expect(log).toEqual(["status Ended"]);
    });

    test("end waits for in-flight transcript saves before marking the interview Ended", async () => {
        insertDelayMs = 50;
        const ws = connect("i3");
        ws.receive({ type: "conversation.item.input_audio_transcription.completed", transcript: "last answer" });
        setTimeout(() => ws.emit("close"), 10); // OpenAI closes the call shortly after the browser hangs up

        await endInterview("i3", 1_000);

        expect(log).toEqual(["insert User: last answer", "status Ended"]);
        expect(hasOpenSideband("i3")).toBe(false);
    });

    test("a call that closes on its own ends the interview after the reconnect grace period", async () => {
        jest.useFakeTimers();
        const ws = connect("i4");
        ws.emit("close");

        jest.advanceTimersByTime(29_000);
        await flushAsync();
        expect(log).toEqual([]);
        jest.advanceTimersByTime(2_000);
        await flushAsync();
        expect(log).toEqual(["status Ended"]);
    });

    test("a reconnect within the grace period keeps the interview going", async () => {
        jest.useFakeTimers();
        const first = connect("i5");
        first.emit("close");
        jest.advanceTimersByTime(5_000);

        connect("i5"); // browser reconnected with a new call
        jest.advanceTimersByTime(60_000);
        await flushAsync();

        expect(log).toEqual([]);
        expect(hasOpenSideband("i5")).toBe(true);
    });

    test("doesn't log the empty-buffer response to End's commit, but logs real errors", async () => {
        const logged: unknown[] = [];
        const realError = console.error;
        console.error = (...args: unknown[]) => { logged.push(args); };
        try {
            const ws = connect("i6");
            ws.receive({ type: "error", error: { code: "input_audio_buffer_commit_empty" } });
            expect(logged).toHaveLength(0);
            ws.receive({ type: "error", error: { code: "session_expired" } });
            expect(logged).toHaveLength(1);
            await endInterview("i6", 0);
        } finally {
            console.error = realError;
        }
    });
});
