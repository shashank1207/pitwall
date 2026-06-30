import { useEffect, useRef, useState } from "react";
import { useTelemetryStream } from "../hooks/useTelemetryStream";

const formatLapTime = (ms) => {
  if (ms == null || ms < 0) return "0:00.000";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
};

const formatPosition = (pos) => {
  if (pos == null) return "—";
  return (pos * 100).toFixed(1) + "%";
};

const EVENT_LABELS = {
  track_limits: "Track Limits",
};

const EVENT_COLORS = {
  track_limits: "var(--brake)",
};

export function NotificationPopup() {
  const { sessionEventsRef } = useTelemetryStream();
  const [events, setEvents] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const current = sessionEventsRef.current;
      if (current.length !== events.length) {
        setEvents([...current]);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [sessionEventsRef, events.length]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="notif-wrapper" ref={wrapperRef}>
      <button
        className="notif-bell"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Session events"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {events.length > 0 && (
          <span className="notif-badge">{events.length}</span>
        )}
      </button>

      {open && (
        <div className="notif-popup">
          <div className="notif-popup-header">
            Session Events
            <span className="notif-popup-count">{events.length}</span>
          </div>
          <div className="notif-popup-body">
            {events.length === 0 ? (
              <div className="notif-empty">No events this session</div>
            ) : (
              events
                .slice()
                .reverse()
                .map((evt, i) => (
                  <div
                    key={i}
                    className="notif-event-card"
                    style={{ borderLeftColor: EVENT_COLORS[evt.type] || "var(--border)" }}
                  >
                    <div className="notif-event-type" style={{ color: EVENT_COLORS[evt.type] }}>
                      {EVENT_LABELS[evt.type] || evt.type}
                      <span className="notif-event-lap">Lap {evt.lap}</span>
                    </div>
                    <div className="notif-event-detail">
                      {formatLapTime(evt.lapTimeMs)} &middot; {formatPosition(evt.trackPosition)}
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
