import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { useTelemetryStream } from "../hooks/useTelemetryStream";

const lineStyle = (color, width, isDashed) => ({
  color,
  width,
  type: isDashed ? "dashed" : "solid",
  opacity: isDashed ? 0.45 : 1,
});

const emptySeries = () => ({ type: "line", data: [], showSymbol: false });

const GRID_LEFT = 48;
const GRID_RIGHT = 18;

const buildStackOption = () => ({
  animation: false,
  grid: [
    { left: GRID_LEFT, right: GRID_RIGHT, top: "6%", height: "22%" },
    { left: GRID_LEFT, right: GRID_RIGHT, top: "39%", height: "22%" },
    { left: GRID_LEFT, right: GRID_RIGHT, top: "72%", height: "22%" },
  ],
  xAxis: [
    {
      type: "value", gridIndex: 0, min: 0, max: 1,
      axisLine: { lineStyle: { color: "rgba(232,234,237,0.12)" } },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false },
    },
    {
      type: "value", gridIndex: 1, min: 0, max: 1,
      axisLine: { lineStyle: { color: "rgba(232,234,237,0.12)" } },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false },
    },
    {
      type: "value", gridIndex: 2, min: 0, max: 1,
      axisLine: { lineStyle: { color: "rgba(232,234,237,0.12)" } },
      axisTick: { show: false },
      axisLabel: {
        color: "rgba(232,234,237,0.35)",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
        formatter: (v) => v.toFixed(1),
      },
      splitLine: { show: false },
    },
  ],
  yAxis: [
    {
      type: "value", gridIndex: 0, min: 0, max: 100,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: {
        color: "rgba(232,234,237,0.3)",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
      },
      splitLine: { lineStyle: { color: "rgba(232,234,237,0.06)" } },
    },
    {
      type: "value", gridIndex: 1, min: 0, max: 300,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: {
        color: "rgba(232,234,237,0.3)",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
      },
      splitLine: { lineStyle: { color: "rgba(232,234,237,0.06)" } },
    },
    {
      type: "value", gridIndex: 2, min: 0, max: 100,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: {
        color: "rgba(232,234,237,0.3)",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
      },
      splitLine: { lineStyle: { color: "rgba(232,234,237,0.06)" } },
    },
  ],
  tooltip: {
    trigger: "item",
    backgroundColor: "#121417",
    borderColor: "#23262b",
    textStyle: { color: "#e8eaed", fontSize: 10, fontFamily: "JetBrains Mono, monospace" },
  },
  series: [
    { ...emptySeries(), name: "Throttle", xAxisIndex: 0, yAxisIndex: 0, lineStyle: lineStyle("#00e676", 1.5, false) },
    { ...emptySeries(), name: "Speed",    xAxisIndex: 1, yAxisIndex: 1, lineStyle: lineStyle("#00e5ff", 1.5, false) },
    { ...emptySeries(), name: "Brake",    xAxisIndex: 2, yAxisIndex: 2, lineStyle: lineStyle("#ff5252", 1.5, false) },
  ],
});

const getSortedLapNumbers = (dictionary) =>
  Object.keys(dictionary).map(Number).sort((a, b) => b - a);

const positionCaptions = () => {
  const el = document.getElementById("telemChartContainer");
  if (!el) return;
  const h = el.clientHeight;
  const lbls = ["lblThrottle", "lblSpeed", "lblBrake"];
  const tops = [h * 0.03, h * 0.36, h * 0.69];
  lbls.forEach((id, i) => {
    const lbl = document.getElementById(id);
    if (lbl) lbl.style.top = tops[i] + "px";
  });
};

export function TelemetryStack() {
  const { sessionLapsRef } = useTelemetryStream();
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    chartRef.current = echarts.init(containerRef.current, undefined);
    chartRef.current.setOption(buildStackOption());

    let animationId;
    let lastRenderedTs = 0;
    let lastLap = 0;

    const refreshChart = () => {
      const dictionary = sessionLapsRef.current;
      const lapNumbers = getSortedLapNumbers(dictionary);
      if (lapNumbers.length === 0) {
        animationId = requestAnimationFrame(refreshChart);
        return;
      }

      const currentLap = lapNumbers[0];

      if (currentLap !== lastLap) {
        lastLap = currentLap;
        lastRenderedTs = 0;
        if (chartRef.current) {
          chartRef.current.setOption({
            series: [
              { data: [] },
              { data: [] },
              { data: [] },
            ],
          });
        }
      }

      const currFrames = dictionary[currentLap];
      if (!currFrames || currFrames.length === 0) {
        animationId = requestAnimationFrame(refreshChart);
        return;
      }

      const latest = currFrames[currFrames.length - 1];
      if (latest.ts === lastRenderedTs) {
        animationId = requestAnimationFrame(refreshChart);
        return;
      }
      lastRenderedTs = latest.ts;

      if (chartRef.current) {
        const pts = dictionary[currentLap];
        const thrData = pts.map((pt) => [pt.track_position, pt.throttle * 100]);
        const spdData = pts.map((pt) => [pt.track_position, pt.speed]);
        const brkData = pts.map((pt) => [pt.track_position, pt.brake * 100]);
        chartRef.current.setOption({
          series: [
            { data: thrData },
            { data: spdData },
            { data: brkData },
          ],
        });
      }

      animationId = requestAnimationFrame(refreshChart);
    };

    animationId = requestAnimationFrame(refreshChart);
    positionCaptions();
    window.addEventListener("resize", positionCaptions);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", positionCaptions);
      if (chartRef.current) chartRef.current.dispose();
    };
  }, [sessionLapsRef]);

  return <div ref={containerRef} style={{ width: "100%", flex: 1 }} />;
}
