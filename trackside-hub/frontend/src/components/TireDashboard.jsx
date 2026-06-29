import { useEffect, useRef } from "react";
import { useTelemetryStream } from "../hooks/useTelemetryStream";

const TIRE_LABELS = { 0: "FL", 1: "FR", 2: "RL", 3: "RR" };
const TIRE_INDICES = [0, 1, 2, 3];

const coreTempColor = (degC) => {
  if (degC < 75) return "var(--text-faint)";
  if (degC < 90) return "var(--speed)";
  if (degC < 100) return "var(--throttle)";
  if (degC < 108) return "#ffc107";
  return "var(--brake)";
};

const surfaceTempColor = (degC) => {
  if (degC < 50) return "var(--text-faint)";
  if (degC < 70) return "var(--speed)";
  if (degC < 85) return "var(--throttle)";
  if (degC < 95) return "#ffc107";
  return "var(--brake)";
};

const safeValue = (arr, index) => {
  if (!arr || index >= arr.length) return null;
  return arr[index];
};

const CELL_STYLE = {
  padding: "8px 6px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 1,
};

const TIRE_LABEL_STYLE = {
  fontSize: 9,
  color: "var(--text-faint)",
  fontFamily: "var(--font-label)",
  letterSpacing: 1.5,
  textTransform: "uppercase",
  lineHeight: 1,
};

const PRESSURE_STYLE = {
  fontSize: 20,
  fontWeight: 500,
  fontFamily: "var(--font-data)",
  fontVariantNumeric: "tabular-nums",
  color: "var(--text)",
  lineHeight: 1.2,
};

const SUB_LABEL_STYLE = {
  fontSize: 7,
  color: "var(--text-faint)",
  fontFamily: "var(--font-label)",
  letterSpacing: 1,
  textTransform: "uppercase",
};

const SUB_VALUE_STYLE = {
  fontSize: 14,
  fontWeight: 500,
  fontFamily: "var(--font-data)",
  fontVariantNumeric: "tabular-nums",
  color: "var(--text)",
  lineHeight: 1.1,
};

const PAIR_STYLE = {
  display: "flex",
  gap: 16,
  alignItems: "flex-start",
};

export function TireDashboard() {
  const { liveFrameRef } = useTelemetryStream();

  const pressureRefs = useRef(Array(4).fill(null));
  const coreRefs = useRef(Array(4).fill(null));
  const surfaceRefs = useRef(Array(4).fill(null));

  const setPressureRef = (i) => (el) => { pressureRefs.current[i] = el; };
  const setCoreRef = (i) => (el) => { coreRefs.current[i] = el; };
  const setSurfaceRef = (i) => (el) => { surfaceRefs.current[i] = el; };

  useEffect(() => {
    let id;
    let lastRenderedTs = 0;
    const refresh = () => {
      const frame = liveFrameRef.current;
      if (!frame) { id = requestAnimationFrame(refresh); return; }
      if (frame.ts === lastRenderedTs) { id = requestAnimationFrame(refresh); return; }
      lastRenderedTs = frame.ts;
      for (const i of TIRE_INDICES) {
        const p = safeValue(frame.wheel_pressure, i);
        const c = safeValue(frame.core_temp, i);
        const s = safeValue(frame.surface_temp, i);

        if (pressureRefs.current[i]) {
          pressureRefs.current[i].textContent = p !== null ? p.toFixed(1) : "\u2014";
        }
        if (coreRefs.current[i]) {
          coreRefs.current[i].textContent = c !== null ? `${c.toFixed(0)}\u00b0` : "\u2014";
          coreRefs.current[i].style.color = c !== null ? coreTempColor(c) : "var(--text-faint)";
        }
        if (surfaceRefs.current[i]) {
          surfaceRefs.current[i].textContent = s !== null ? `${s.toFixed(0)}\u00b0` : "\u2014";
          surfaceRefs.current[i].style.color = s !== null ? surfaceTempColor(s) : "var(--text-faint)";
        }
      }

      id = requestAnimationFrame(refresh);
    };
    id = requestAnimationFrame(refresh);
    return () => cancelAnimationFrame(id);
  }, [liveFrameRef]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
      {TIRE_INDICES.map((i) => (
        <div key={i} style={CELL_STYLE}>
          <span style={TIRE_LABEL_STYLE}>{TIRE_LABELS[i]}</span>
          <div ref={setPressureRef(i)} style={PRESSURE_STYLE}>{"\u2014"}</div>
          <div style={PAIR_STYLE}>
            <div>
              <span style={SUB_LABEL_STYLE}>CORE</span>
              <div ref={setCoreRef(i)} style={SUB_VALUE_STYLE}>{"\u2014"}</div>
            </div>
            <div>
              <span style={SUB_LABEL_STYLE}>SURF</span>
              <div ref={setSurfaceRef(i)} style={SUB_VALUE_STYLE}>{"\u2014"}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
