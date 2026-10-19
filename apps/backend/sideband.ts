import WebSocket from "ws";
import { prisma } from "./db";
import { getOpenAIKey } from "./realtime";

// One live sideband per interview. A reconnect opens a new call, so the
// socket for the old (dead) call is closed rather than left dangling.
const activeSidebands = new Map<string, WebSocket>();

export function initSideband(callId: string, interviewId: string) {
    activeSidebands.get(interviewId)?.close();

    const url = "wss://api.openai.com/v1/realtime?call_id=" + callId;
    const ws = new WebSocket(url, {
        headers: {
            Authorization: "Bearer " + getOpenAIKey(),
        },
    });
    activeSidebands.set(interviewId, ws);

    ws.on("open", () => {
        console.log(`Sideband connected (interview ${interviewId}, call ${callId})`);
    });

    ws.on("error", (error) => {
        console.error(`Sideband error (interview ${interviewId}):`, error);
    });

    ws.on("close", () => {
        if (activeSidebands.get(interviewId) === ws) activeSidebands.delete(interviewId);
    });

    ws.on("message", async function incoming(message) {
        const parsedMessage = JSON.parse(message.toString());
        if (parsedMessage.type == "conversation.item.input_audio_transcription.completed") {
            const transcript = parsedMessage.transcript?.trim();
            if (transcript) {
                await prisma.message.create({
                    data: {
                        interviewId,
                        type: "User",
                        message: transcript
                    }
                })
            }
        } else if (parsedMessage.type == "response.done") {
            let contents: {type: string, transcript: string}[] = [];

            parsedMessage.response.output.map((x: { content: { type: string; transcript: string }[] }) => contents = [...contents, ...x.content]);
            const assistantMessage = contents.filter(x => x.type === "output_audio").map(x => x.transcript).join(" ").trim();
            // A response cancelled by barge-in before any audio has no transcript.
            if (!assistantMessage) return;
            await prisma.message.create({
                data: {
                    interviewId,
                    type: "Assistant",
                    message: assistantMessage
                }
            })
        } else if (parsedMessage.type == "error") {
            console.error(`Realtime error (interview ${interviewId}):`, parsedMessage.error);
        }
    });
}
