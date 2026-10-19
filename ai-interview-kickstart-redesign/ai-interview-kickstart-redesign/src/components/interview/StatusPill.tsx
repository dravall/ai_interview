import { CircleAlert, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type InterviewStatus = "connecting" | "live" | "reconnecting" | "error" | "ending";

const LABEL: Record<InterviewStatus, string> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  error: "Interview stopped",
  ending: "Ending",
};

/** The interview screen's single polite live region. Errors are announced by the error card (role="alert"). */
export function StatusPill({ status }: { status: InterviewStatus }) {
  const busy = status === "connecting" || status === "reconnecting" || status === "ending";
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-full border bg-background px-3 text-xs font-medium",
        status === "error" && "border-destructive-text/35",
      )}
    >
      {busy && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
      {status === "live" && <span aria-hidden className="size-2 rounded-full bg-primary animate-live" />}
      {status === "error" && <CircleAlert aria-hidden className="size-3.5 text-destructive-text" />}
      {LABEL[status]}
    </div>
  );
}
