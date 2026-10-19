import z from "zod";

export const PreInterviewBody = z.object({
    github: z.string()
})

declare global {
    // `namespace` is required here — this is TypeScript's standard pattern for
    // augmenting a third-party global (Express.Request); there's no ES-module form.
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            sessionId: string;
        }
    }
}