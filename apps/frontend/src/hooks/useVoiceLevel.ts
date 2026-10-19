import { useEffect, useRef, useState } from "react";

/**
 * Drives a VoiceTile from a 0–1 audio level without re-rendering React every frame.
 * Writes `--level` (0–1, smoothed and perceptually curved) onto the element and
 * returns `speaking`, which only changes when the debounced state flips.
 *
 * `getLevel` should read the latest raw level (e.g. from a ref the audio code updates).
 */
export function useVoiceLevel(getLevel: () => number, muted = false) {
    const ref = useRef<HTMLDivElement>(null);
    const [speaking, setSpeaking] = useState(false);
    const getLevelRef = useRef(getLevel);
    getLevelRef.current = getLevel;

    useEffect(() => {
        let raf = 0;
        let smooth = 0;
        let on = false;
        let pending = performance.now();

        const tick = (t: number) => {
            const raw = muted ? 0 : clamp(getLevelRef.current() ?? 0, 0, 1);
            smooth += (raw - smooth) * (raw > smooth ? 0.5 : 0.12); // fast attack, slow release
            const v = Math.pow(clamp((smooth - 0.02) / 0.5, 0, 1), 0.6); // gate + curve
            const want = v > 0.08;

            // Hold 120ms before turning on, 350ms before turning off, so the
            // state doesn't flicker between words.
            if (want === on) pending = t;
            else if (t - pending > (want ? 120 : 350)) {
                on = want;
                pending = t;
                setSpeaking(on);
            }

            ref.current?.style.setProperty("--level", v.toFixed(3));
            raf = requestAnimationFrame(tick);
        };

        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [muted]);

    useEffect(() => {
        if (muted) setSpeaking(false);
    }, [muted]);

    return { ref, speaking };
}

function clamp(n: number, min: number, max: number) {
    return Math.min(Math.max(n, min), max);
}
