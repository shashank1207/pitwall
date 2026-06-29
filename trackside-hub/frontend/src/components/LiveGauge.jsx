import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { useTelemetryStream } from "../hooks/useTelemetryStream";

const GAUGE_MAX_RPM = 8000;
const SHIFT_SEG_COUNT = 10;

const buildGaugeOption = () => ({
  series: [
    {
      type: "gauge",
      startAngle: 210,
      endAngle: -30,
      min: 0,
      max: GAUGE_MAX_RPM,
      radius: "92%",
      center: ["50%", "58%"],
      animation: false,
      progress: { show: false },
      pointer: {
        length: "58%",
        width: 3,
        itemStyle: { color: "#e8eaed" },
      },
      anchor: {
        show: true,
        size: 7,
        itemStyle: { color: "#e8eaed" },
      },
      axisLine: {
        lineStyle: {
          width: 6,
          color: [
            [0.999, "rgba(255,255,255,0.10)"],
            [1, "#ff3b30"],
          ],
        },
      },
      axisTick: {
        distance: -16,
        splitNumber: 5,
        length: 4,
        lineStyle: { width: 1, color: "rgba(232,234,237,0.25)" },
      },
      splitLine: {
        distance: -18,
        length: 10,
        lineStyle: { width: 1.5, color: "rgba(232,234,237,0.45)" },
      },
      axisLabel: {
        distance: 26,
        color: "rgba(232,234,237,0.4)",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
        formatter: (v) => (v / 1000).toFixed(0),
      },
      detail: {
        offsetCenter: [0, "14%"],
        formatter: () => {
          const frame = liveFrameForGaugeRef.current;
          const kmh = frame ? Math.ceil(frame.speed) : 0;
          return kmh + "\n{unit|km/h}";
        },
        rich: {
          unit: {
            fontSize: 11,
            fontFamily: "Oswald",
            color: "rgba(232,234,237,0.5)",
            padding: [6, 0, 0, 0],
          },
        },
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 38,
        fontWeight: 500,
        color: "#e8eaed",
      },
      title: { show: false },
      data: [{ value: 0 }],
    },
  ],
});

const liveFrameForGaugeRef = { current: null };

const setShiftLightColor = (seg, index) => {
  if (index < 4) {
    seg.style.background = "var(--speed)";
  } else if (index < 8) {
    seg.style.background = "#e8eaed";
  } else {
    seg.style.background = "var(--redline)";
  }
};

const clearShiftLight = (seg) => {
  seg.style.background = "rgba(255,255,255,0.06)";
};

const updateShiftLights = (rpm) => {
  const row = document.getElementById("shiftLightRow");
  if (!row) return;
  const segs = row.children;
  const lit = Math.round((rpm / GAUGE_MAX_RPM) * segs.length);
  for (let i = 0; i < segs.length; i++) {
    if (i < lit) {
      setShiftLightColor(segs[i], i);
    } else {
      clearShiftLight(segs[i]);
    }
  }
};

export function LiveGauge() {
  const { liveFrameRef } = useTelemetryStream();
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    chartRef.current = echarts.init(containerRef.current, undefined, {
      renderer: "svg",
    });
    chartRef.current.setOption(buildGaugeOption());

    let animationId;
    let lastRenderedTs = 0;

    const refreshGauge = () => {
      const frame = liveFrameRef.current;
      if (frame) {
        liveFrameForGaugeRef.current = frame;
      }
      if (!frame || !chartRef.current) {
        animationId = requestAnimationFrame(refreshGauge);
        return;
      }
      if (frame.ts === lastRenderedTs) {
        animationId = requestAnimationFrame(refreshGauge);
        return;
      }
      lastRenderedTs = frame.ts;
      chartRef.current.setOption({
        series: [{ data: [{ value: Math.ceil(frame.rpm) }] }],
      });
      updateShiftLights(frame.rpm);
      animationId = requestAnimationFrame(refreshGauge);
    };

    animationId = requestAnimationFrame(refreshGauge);

    return () => {
      cancelAnimationFrame(animationId);
      if (chartRef.current) chartRef.current.dispose();
    };
  }, [liveFrameRef]);

  return (
    <div>
      <div
        id="shiftLightRow"
        style={{
          display: "flex",
          gap: 3,
          justifyContent: "center",
          marginBottom: 6,
        }}
      >
        {Array.from({ length: SHIFT_SEG_COUNT }, (_, i) => (
          <div
            key={i}
            className="shift-seg"
            style={{
              width: 18,
              height: 6,
              borderRadius: 1,
              background: "rgba(255,255,255,0.06)",
              transition: "background 80ms linear",
            }}
          />
        ))}
      </div>
      <div ref={containerRef} style={{ width: "100%", height: "240px" }} />
    </div>
  );
}
