import { AudioLines, MicOff, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceLevel } from "@/hooks/useVoiceLevel";

type Phase = "connecting" | "live" | "reconnecting" | "ending" | "error";

interface VoiceTileProps {
  who: "interviewer" | "you";
  /** Returns the latest raw 0–1 level. Read from a ref; this is called every frame. */
  getLevel: () => number;
  phase: Phase;
  muted?: boolean; // "you" only
  compact?: boolean; // 375px layout
}

export function VoiceTile({ who, getLevel, phase, muted = false, compact = false }: VoiceTileProps) {
  const active = phase === "live";
  const { ref, speaking: rawSpeaking } = useVoiceLevel(getLevel, muted || !active);
  const speaking = active && !muted && rawSpeaking;
  const Icon = who === "interviewer" ? AudioLines : UserRound;

  const label =
    phase === "reconnecting" ? "Paused"
    : phase !== "live" ? ""
    : muted ? "Muted"
    : speaking ? "Speaking"
    : "Listening";

  return (
    <div
      className={cn(
        "flex flex-col items-center",
        compact ? "w-[120px] gap-3" : "w-[150px] gap-3.5",
        (phase === "connecting" || phase === "ending") && "opacity-45",
      )}
    >
      <div
        ref={ref}
        data-speaking={speaking}
        data-muted={muted}
        aria-hidden="true"
        className={cn(
          "relative",
          compact ? "size-[88px]" : "size-28",
          phase === "reconnecting" && "opacity-45",
        )}
      >
        <div className="voice-halo" />
        <div
          className={cn(
            "absolute inset-0 grid place-items-center rounded-full border bg-card text-muted-foreground",
            "transition-colors duration-150 ease-out",
            speaking && "border-2 border-primary bg-primary-subtle text-primary",
            muted && "border-dashed bg-muted",
          )}
        >
          <Icon className={compact ? "size-[26px]" : "size-[30px]"} strokeWidth={1.75} />
        </div>
        {muted && (
          <span
            className={cn(
              "absolute right-0.5 bottom-0.5 grid place-items-center rounded-full",
              "bg-foreground text-background ring-[3px] ring-background",
              compact ? "size-[26px]" : "size-[30px]",
            )}
          >
            <MicOff className="size-3.5" />
          </span>
        )}
      </div>
      <span className={cn("font-semibold leading-none", compact ? "text-[13px]" : "text-sm")}>
        {who === "interviewer" ? "Interviewer" : "You"}
      </span>
      <span
        className={cn(
          "min-h-3 font-mono uppercase leading-none tracking-[0.04em]",
          compact ? "text-[11px]" : "text-xs",
          speaking ? "text-primary" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}
