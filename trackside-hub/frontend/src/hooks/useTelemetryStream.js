import { useEffect, useRef } from "react";
import toast from "react-hot-toast";

const liveFrameRef = { current: null };
const sessionLapsRef = { current: {} };
const currentLapRef = { current: 0 };
const previousLapCompletedTimeRef = { current: null };
let wasLastFrameInvalid = false;
let connectionAlreadyStarted = false;

const fireLapInvalidatedAlert = () => {
  toast.error("Track limits. Lap invalidated.", { id: "invalid-lap" });

  try {
    const utterance = new SpeechSynthesisUtterance("Lap invalidated.");
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch (_) {
    // audio not available on this system
  }
};

const handleLapInvalidationEdgeTrigger = (frame) => {
  const isNewLap = frame.lap > currentLapRef.current;

  if (isNewLap) {
    wasLastFrameInvalid = false;
  }

  const justBecameInvalid = !wasLastFrameInvalid && frame.lap_invalid;
  if (justBecameInvalid) {
    fireLapInvalidatedAlert();
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
  const lapNumber = frame.lap;
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

const handleLapChange = (newLap) => {
  if (newLap === currentLapRef.current) return;

  if (currentLapRef.current > 0) {
    const previousLapFrames =
      sessionLapsRef.current[currentLapRef.current];
    if (previousLapFrames && previousLapFrames.length > 0) {
      const finalFrame = previousLapFrames[previousLapFrames.length - 1];
      previousLapCompletedTimeRef.current = finalFrame.lap_time_ms;
    }
  }

  currentLapRef.current = newLap;
  deleteOldLaps(sessionLapsRef.current, newLap);
};

const resetSessionState = () => {
  sessionLapsRef.current = {};
  currentLapRef.current = 0;
  liveFrameRef.current = null;
  wasLastFrameInvalid = false;
  previousLapCompletedTimeRef.current = null;
};

const processIncomingFrame = (frame) => {
  handleLapInvalidationEdgeTrigger(frame);
  updateLiveFrame(frame);
  addFrameToSessionDictionary(frame);
  handleLapChange(frame.lap);
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
    isConnectedRef,
    previousLapCompletedTimeRef,
  };
}
