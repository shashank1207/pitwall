import { useEffect, useRef } from "react";

const liveFrameRef = { current: null };
const sessionLapsRef = { current: {} };
const sessionEventsRef = { current: [] };
const currentLapRef = { current: 0 };
const previousLapCompletedTimeRef = { current: null };
const previousLapTimeMsRef = { current: 0 };
let wasLastFrameInvalid = false;
let connectionAlreadyStarted = false;

const handleLapInvalidationEdgeTrigger = (frame) => {
  const justBecameInvalid = !wasLastFrameInvalid && frame.lap_invalid;
  if (justBecameInvalid) {
    const alreadyRecorded = sessionEventsRef.current.some(
      (evt) => evt.lap === currentLapRef.current && evt.type === "track_limits"
    );
    if (!alreadyRecorded) {
      sessionEventsRef.current = [
        ...sessionEventsRef.current,
        {
          type: "track_limits",
          lap: currentLapRef.current,
          lapTimeMs: frame.lap_time_ms,
          trackPosition: frame.track_position,
          ts: frame.ts,
        },
      ];
    }
  }

  wasLastFrameInvalid = frame.lap_invalid;
};

const updateLiveFrame = (frame) => {
  liveFrameRef.current = frame;
};

const toChartPoint = (frame) => ({
  track_position: frame.track_position,
  throttle: frame.throttle,
  brake: frame.brake,
  speed: frame.speed,
  lap_time_ms: frame.lap_time_ms,
  ts: frame.ts,
});

const addFrameToSessionDictionary = (frame) => {
  const lapNumber = currentLapRef.current;
  const dictionary = sessionLapsRef.current;
  if (!dictionary[lapNumber]) {
    dictionary[lapNumber] = [];
  }
  dictionary[lapNumber].push(toChartPoint(frame));
};

const findBestLapNumber = (lapDictionary) => {
  let bestLap = null;
  let bestTime = Infinity;

  const lapStrings = Object.keys(lapDictionary);
  for (const lapString of lapStrings) {
    const frames = lapDictionary[lapString];
    if (frames.length === 0) continue;
    const lapTime = frames[frames.length - 1].last_lap_time_ms;
    if (lapTime && lapTime > 0 && lapTime < bestTime) {
      bestTime = lapTime;
      bestLap = Number(lapString);
    }
  }

  return bestLap;
};

const deleteOldLaps = (lapDictionary, currentLap) => {
  const bestLap = findBestLapNumber(lapDictionary);
  const previousLap = currentLap - 1;

  for (const lapString of Object.keys(lapDictionary)) {
    const lap = Number(lapString);
    if (lap !== currentLap && lap !== previousLap && lap !== bestLap) {
      delete lapDictionary[lap];
    }
  }
};

const resetSessionState = () => {
  sessionLapsRef.current = {};
  sessionEventsRef.current = [];
  currentLapRef.current = 0;
  liveFrameRef.current = null;
  wasLastFrameInvalid = false;
  previousLapCompletedTimeRef.current = null;
  previousLapTimeMsRef.current = 0;
};

const processIncomingFrame = (frame) => {
  const prevMs = previousLapTimeMsRef.current;
  if (prevMs > 0 && frame.lap_time_ms < prevMs - 500) {
    if (currentLapRef.current > 0) {
      previousLapCompletedTimeRef.current = prevMs;
    }
    currentLapRef.current++;
    wasLastFrameInvalid = false;
    deleteOldLaps(sessionLapsRef.current, currentLapRef.current);
  }

  previousLapTimeMsRef.current = frame.lap_time_ms;
  handleLapInvalidationEdgeTrigger(frame);
  updateLiveFrame(frame);
  addFrameToSessionDictionary(frame);
};

export function useTelemetryStream() {
  const isConnectedRef = useRef(false);

  useEffect(() => {
    if (connectionAlreadyStarted) return;
    connectionAlreadyStarted = true;

    let webSocket;
    let reconnectTimer;

    const openConnection = () => {
      clearTimeout(reconnectTimer);
      webSocket = new WebSocket("ws://localhost:8080");

      webSocket.onopen = () => {
        console.log("[ws] connected to relay");
        isConnectedRef.current = true;
      };

      webSocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === "metadata") {
            console.log("[ws] metadata received");
            resetSessionState();
          }

          if (message.type === "telemetry") {
            processIncomingFrame(message.payload);
          }
        } catch (error) {
          console.error("[ws] parse error:", error);
        }
      };

      webSocket.onclose = () => {
        console.log("[ws] disconnected, reconnecting...");
        isConnectedRef.current = false;
        reconnectTimer = setTimeout(openConnection, 2000);
      };

      webSocket.onerror = () => {
        webSocket.close();
      };
    };

    openConnection();

    return () => {
      clearTimeout(reconnectTimer);
      if (webSocket) webSocket.close();
      connectionAlreadyStarted = false;
    };
  }, []);

  return {
    liveFrameRef,
    sessionLapsRef,
    sessionEventsRef,
    isConnectedRef,
    previousLapCompletedTimeRef,
  };
}
