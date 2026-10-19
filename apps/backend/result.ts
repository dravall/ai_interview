import { z } from "zod";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Any OpenRouter model slug that supports structured outputs works here.
const MODEL = process.env.OPENROUTER_MODEL || "qwen/qwen3.8-flash";

const outputSchema = z.object({
    feedback: z.string().describe("Feedback for the user"),
    score: z.int().describe("Score out of 10 for their interview"),
});

// Hand-written rather than z.toJSONSchema(): zod emits integer min/max bounds
// that some providers reject under strict structured outputs.
const outputJsonSchema = {
    type: "object",
    properties: {
        feedback: { type: "string", description: "Feedback for the user" },
        score: { type: "integer", description: "Score out of 10 for their interview" },
    },
    required: ["feedback", "score"],
    additionalProperties: false,
};

const RESULT_PROMPT = `
    You are an expert evaluator. Your job is to evaluate the users interview. Give them a score out of 10
    and also let them know any feedback you have about thier interview.

    {{USER_TRANSCRIPT}}
`

type ChatCompletion = {
    choices?: {
        finish_reason: string | null,
        message: { content: string | null, refusal?: string | null },
    }[],
    error?: { message: string },
};

export async function calculateResult(messages: {type: "Assistant" | "User", message: string, createdAt: Date}[]) {
    const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 16000,
            messages: [
                { role: "user", content: RESULT_PROMPT.replace(`{{USER_TRANSCRIPT}}`, JSON.stringify(messages)) },
            ],
            response_format: {
                type: "json_schema",
                json_schema: { name: "interview_result", strict: true, schema: outputJsonSchema },
            },
            // Only route to providers that honour response_format.
            provider: { require_parameters: true },
        }),
    });

    const body = await res.json() as ChatCompletion;
    if (!res.ok || body.error) {
        throw new Error(`Grading request failed (${res.status}): ${body.error?.message ?? "unknown error"}`);
    }

    const choice = body.choices?.[0];
    if (choice?.message.refusal || choice?.finish_reason === "content_filter") {
        throw new Error(`Grading refused: ${choice.message.refusal ?? "no explanation"}`);
    }
    if (!choice?.message.content) {
        throw new Error(`Grading returned no output (finish_reason: ${choice?.finish_reason})`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(choice.message.content);
    } catch {
        throw new Error(`Grading returned no parseable output (finish_reason: ${choice.finish_reason})`);
    }
    return outputSchema.parse(parsed);
}
