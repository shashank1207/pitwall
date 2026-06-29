import { useEffect, useRef } from "react";
import { useTelemetryStream } from "../hooks/useTelemetryStream";

const formatLapTime = (ms) => {
  if (ms <= 0) return "0:00.000";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  const paddedSeconds = String(seconds).padStart(2, "0");
  const paddedMillis = String(millis).padStart(3, "0");
  return `${minutes}:${paddedSeconds}.${paddedMillis}`;
};

export function LapTimes() {
  const { liveFrameRef, previousLapCompletedTimeRef } = useTelemetryStream();
  const currentRef = useRef(null);
  const previousRef = useRef(null);
  const deltaRef = useRef(null);

  useEffect(() => {
    let animationId;
    let lastRenderedTs = 0;

    const refreshTimes = () => {
      const frame = liveFrameRef.current;
      if (!frame) {
        animationId = requestAnimationFrame(refreshTimes);
        return;
      }
      if (frame.ts === lastRenderedTs) {
        animationId = requestAnimationFrame(refreshTimes);
        return;
      }
      lastRenderedTs = frame.ts;
      const currentLapTimeMs = frame.lap_time_ms;

      if (currentRef.current) {
        currentRef.current.textContent = formatLapTime(currentLapTimeMs);
      }

      const previousTime = previousLapCompletedTimeRef.current;

      if (previousRef.current && deltaRef.current) {
        if (previousTime !== null && previousTime > 0) {
          previousRef.current.textContent = `LAP ${frame.lap - 1} · ${formatLapTime(previousTime)}`;
          previousRef.current.style.display = "block";

          const diffMs = currentLapTimeMs - previousTime;
          const absSeconds = Math.abs(diffMs) / 1000;
          const sign = diffMs > 0 ? "+" : diffMs < 0 ? "-" : "";
          deltaRef.current.textContent = sign + absSeconds.toFixed(1);

          if (diffMs < 0) {
            deltaRef.current.style.color = "var(--throttle)";
          } else if (diffMs > 0) {
            deltaRef.current.style.color = "var(--brake)";
          } else {
            deltaRef.current.style.color = "var(--text-dim)";
          }
          deltaRef.current.style.display = "inline-block";
        } else {
          previousRef.current.style.display = "none";
          deltaRef.current.style.display = "none";
        }
      }

      animationId = requestAnimationFrame(refreshTimes);
    };

    animationId = requestAnimationFrame(refreshTimes);

    return () => cancelAnimationFrame(animationId);
  }, [liveFrameRef, previousLapCompletedTimeRef]);

  return (
    <div style={{ textAlign: "center", padding: "6px 0" }}>
      <div
        ref={currentRef}
        style={{
          fontSize: 36,
          fontFamily: "var(--font-data)",
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          color: "var(--text)",
          lineHeight: 1.1,
        }}
      >
        0:00.000
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 8,
          marginTop: 2,
        }}
      >
        <div
          ref={deltaRef}
          style={{
            fontSize: 13,
            fontFamily: "var(--font-data)",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 500,
            display: "none",
          }}
        />
        <div
          ref={previousRef}
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            fontFamily: "var(--font-data)",
            fontVariantNumeric: "tabular-nums",
            display: "none",
          }}
        />
      </div>
    </div>
  );
}
