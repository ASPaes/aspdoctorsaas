import { useState, useEffect } from "react";

export interface PauseTimerValues {
  /** Total time paused since pause_started_at (ms) */
  pausedTotalMs: number;
  /** Time remaining until pause_expected_end_at (ms), 0 if expired */
  remainingMs: number;
  /** Time exceeded past pause_expected_end_at (ms), 0 if not expired */
  exceededMs: number;
  /** Whether the pause timer has expired */
  timerExpired: boolean;
}

export function usePauseTimer(
  status: string,
  pauseStartedAt: string | null | undefined,
  pauseExpectedEndAt: string | null | undefined
): PauseTimerValues {
  const [values, setValues] = useState<PauseTimerValues>({
    pausedTotalMs: 0,
    remainingMs: 0,
    exceededMs: 0,
    timerExpired: false,
  });

  useEffect(() => {
    if (status !== "paused" || !pauseStartedAt) {
      setValues({ pausedTotalMs: 0, remainingMs: 0, exceededMs: 0, timerExpired: false });
      return;
    }

    const update = () => {
      const now = Date.now();
      const startedAt = new Date(pauseStartedAt).getTime();
      const pausedTotalMs = Math.max(0, now - startedAt);

      let remainingMs = 0;
      let exceededMs = 0;
      let timerExpired = false;

      if (pauseExpectedEndAt) {
        const endAt = new Date(pauseExpectedEndAt).getTime();
        const diff = endAt - now;
        if (diff > 0) {
          remainingMs = diff;
        } else {
          exceededMs = Math.abs(diff);
          timerExpired = true;
        }
      }

      setValues({ pausedTotalMs, remainingMs, exceededMs, timerExpired });
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [status, pauseStartedAt, pauseExpectedEndAt]);

  return values;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00";
  const totalSeconds = Math.ceil(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
