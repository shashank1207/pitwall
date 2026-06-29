import { useEffect, useState } from "react";
import { Toaster } from "react-hot-toast";
import { useTelemetryStream } from "./hooks/useTelemetryStream";
import { LiveGauge } from "./components/LiveGauge";
import { LapTimes } from "./components/LapTimes";
import { TireDashboard } from "./components/TireDashboard";
import { TelemetryStack } from "./components/TelemetryStack";

function App() {
  const { isConnectedRef } = useTelemetryStream();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setConnected(isConnectedRef.current);
    }, 500);
    return () => clearInterval(interval);
  }, [isConnectedRef]);

  return (
    <div className="dashboard">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "var(--panel)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            fontFamily: "var(--font-data)",
            fontSize: 11,
          },
        }}
      />
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <h1>Pit Wall — Telemetry</h1>
        </div>
        <div className="connection-status">
          <div
            className={`connection-dot ${connected ? "online" : "offline"}`}
          />
          {connected ? "LIVE" : "NO DATA"}
        </div>
      </header>
      <main className="dashboard-main">
        <section className="sidebar-panel">
          <p className="panel-label">Live Gauge</p>
          <LiveGauge />
          <hr className="panel-divider" />
          <LapTimes />
          <hr className="panel-divider" />
          <p className="panel-label">Tire Data</p>
          <TireDashboard />
        </section>
        <section className="telem-panel" id="telemetryPanel">
          <p className="panel-label">Telemetry Stack — Throttle / Speed / Brake vs Track Position</p>
          <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <TelemetryStack />
            <div className="chan-caption" id="lblThrottle" style={{ color: "var(--throttle)" }}>
              Throttle
            </div>
            <div className="chan-caption" id="lblSpeed" style={{ color: "var(--speed)" }}>
              Speed
            </div>
            <div className="chan-caption" id="lblBrake" style={{ color: "var(--brake)" }}>
              Brake
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
