import { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import * as echarts from "echarts";
import { useTelemetryStream } from "../hooks/useTelemetryStream";

const buildBaseChartOption = (yAxisName, yAxisMax, formatter) => {
  const tooltipFormatter = (value) =>
    typeof value === "number" ? formatter(value) : "";
  return {
    animation: false,
    backgroundColor: "#1e293b",
    grid: { top: 36, right: 24, bottom: 32, left: 56 },
    xAxis: {
      type: "value",
      name: "Track Position",
      nameTextStyle: { color: "#9ca3af" },
      min: 0,
      max: 1,
      axisLabel: { color: "#9ca3af" },
      splitLine: { lineStyle: { color: "#1f2937" } },
    },
    yAxis: {
      type: "value",
      name: yAxisName,
      nameTextStyle: { color: "#9ca3af" },
      min: 0,
      max: yAxisMax,
      axisLabel: { color: "#9ca3af" },
      splitLine: { lineStyle: { color: "#1f2937" } },
    },
    legend: {
      textStyle: { color: "#e0e0e0" },
      top: 4,
    },
    tooltip: {
      trigger: "item",
      valueFormatter: tooltipFormatter,
    },
  };
};

const mapFramesToChartData = (frames, field, multiplier) =>
  frames.map((frame) => {
    const rawValue = frame[field];
    const numericValue = typeof rawValue === "number" ? rawValue : 0;
    return [frame.track_position, numericValue * multiplier];
  });

const getSortedLapNumbers = (dictionary) =>
  Object.keys(dictionary)
    .map(Number)
    .sort((a, b) => b - a);

const buildSeriesForLap = (
  dictionary, lapNumber, field, multiplier,
  label, color, isDashed,
) => {
  const frames = dictionary[lapNumber];
  if (!frames || frames.length === 0) return null;

  return {
    name: label,
    type: "line",
    data: mapFramesToChartData(frames, field, multiplier),
    showSymbol: false,
    lineStyle: {
      color,
      width: 2,
      type: isDashed ? "dashed" : "solid",
    },
  };
};

export function TelemetryLineChart({
  dataField,
  yAxisName,
  yAxisMax,
  multiplier,
  valueFormatter,
  height,
}) {
  const { sessionLapsRef } = useTelemetryStream();
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    chartRef.current = echarts.init(containerRef.current, "dark");
    chartRef.current.setOption(
      buildBaseChartOption(yAxisName, yAxisMax, valueFormatter),
    );

    let animationId;

    const refreshChart = () => {
      const dictionary = sessionLapsRef.current;
      const lapNumbers = getSortedLapNumbers(dictionary);
      if (lapNumbers.length === 0) {
        animationId = requestAnimationFrame(refreshChart);
        return;
      }

      const currentLap = lapNumbers[0];
      const previousLap = currentLap - 1;
      const seriesList = [];

      const currentSeries = buildSeriesForLap(
        dictionary, currentLap, dataField, multiplier,
        `Lap ${currentLap} (Current)`, "#06b6d4", false,
      );
      if (currentSeries) seriesList.push(currentSeries);

      const previousSeries = buildSeriesForLap(
        dictionary, previousLap, dataField, multiplier,
        `Lap ${previousLap} (Previous)`, "#6b7280", true,
      );
      if (previousSeries) seriesList.push(previousSeries);

      if (chartRef.current) {
        chartRef.current.setOption(
          { series: seriesList },
          { replaceMerge: ["series"] },
        );
      }

      animationId = requestAnimationFrame(refreshChart);
    };

    animationId = requestAnimationFrame(refreshChart);

    return () => {
      cancelAnimationFrame(animationId);
      if (chartRef.current) chartRef.current.dispose();
    };
  }, [sessionLapsRef, dataField, yAxisName, yAxisMax, multiplier, valueFormatter]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}

TelemetryLineChart.propTypes = {
  dataField: PropTypes.string.isRequired,
  yAxisName: PropTypes.string.isRequired,
  yAxisMax: PropTypes.number.isRequired,
  multiplier: PropTypes.number.isRequired,
  valueFormatter: PropTypes.func.isRequired,
  height: PropTypes.number.isRequired,
};
