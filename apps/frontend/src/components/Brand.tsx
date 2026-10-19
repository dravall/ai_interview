import { AudioLines } from "lucide-react";
import { cn } from "@/lib/utils";

export function Brand({ className }: { className?: string }) {
    return (
        <div className={cn("flex items-center gap-2", className)}>
            <span aria-hidden className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
                <AudioLines className="size-3.5" strokeWidth={2} />
            </span>
            <span className="text-sm font-semibold">AI Interview Kickstart</span>
        </div>
    );
}
