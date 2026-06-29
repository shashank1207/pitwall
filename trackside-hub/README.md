# Pit Wall Telemetry Hub

Real-time telemetry dashboard for Assetto Corsa Competizione (ACC).

---

## Architecture

```
Machine A (ACC)                     Machine B (this project)
┌──────────┐  MQTT (1883)   ┌─────────────────────────────────┐
│   ACC    │───────────────▶│ backend/server.js               │
│ 60 Hz    │               │ mqtt → WebSocket (8080)          │
└──────────┘               └────────────┬────────────────────┘
                                        │ ws://localhost:8080
                          ┌─────────────┴────────────────────┐
                          │ frontend/ (React + Vite + ECharts)│
                          │ useTelemetryStream               │
                          │   ├── LiveGauge                  │
                          │   ├── LapTimes                   │
                          │   └── TelemetryStack             │
                          └──────────────────────────────────┘
```

---

## Directory Tree

```
trackside-hub/
├── PROJECT_ARCHITECTURE.md
├── backend/
│   ├── package.json
│   └── server.js
└── frontend/
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── App.css
        ├── types/
        │   └── telemetry.ts
        ├── hooks/
        │   └── useTelemetryStream.ts
        └── components/
            ├── LiveGauge.tsx
            ├── LapTimes.tsx
            ├── TelemetryStack.tsx
            └── TelemetryLineChart.tsx
```

---

## Prerequisites

- **Node.js** >= 18
- **Mosquitto** MQTT broker running on `localhost:1883`
- **AC-mqtt** telemetry tool on Machine A broadcasting to `mqtt://<this-ip>:1883`

---

## Quick Start

```bash
# Install Mosquitto (if not already present)
sudo apt install mosquitto mosquitto-clients -y
sudo systemctl start mosquitto

# Backend
cd trackside-hub/backend
npm install
npm start

# Frontend (separate terminal)
cd trackside-hub/frontend
npm install
npm run dev
```

Open `http://localhost:5173` in a browser.

---

## How It Works

### Data Pipeline

1. **Machine A** broadcasts JSON telemetry at 60 Hz over MQTT topics `ac/telemetry/frame` and `ac/session/metadata`.
2. **Backend** (`server.js`) connects to the local MQTT broker, subscribes to both topics, wraps each payload in a `{ type, payload }` envelope, and broadcasts to all WebSocket clients on port 8080.
3. **Frontend** opens a WebSocket to `ws://localhost:8080`, parses each envelope, and writes the frame into module-level refs (bypassing React state entirely).

### Data Engine (`useTelemetryStream`)

| Ref | Purpose |
|---|---|
| `liveFrameRef` | Single newest frame — consumed by `LiveGauge` and `LapTimes` |
| `sessionLapsRef` | Dictionary of all frames grouped by lap — consumed by `TelemetryStack` |
| `currentLapRef` | Tracks current lap number for memory pruning |

**Memory management**: Only the current lap, previous lap, and best lap are retained. Older laps are deleted from the dictionary on each lap boundary.

**Alert system**: Rising edge on `lap_invalid` triggers a `react-hot-toast` error + browser text-to-speech "Lap invalidated."

### Performance

All visual components use `requestAnimationFrame` loops that read directly from module-level refs. Zero `useState`-driven re-renders at 60 Hz. ECharts animation is disabled on all series to prevent pointer lag and render queue buildup.

---

## Components

### LiveGauge

| Detail | Value |
|---|---|
| Pointer | RPM (0–8000), instant response |
| Center number | Ceiled speed in km/h |
| Update | rAF polling `liveFrameRef`, patching only `series.data` |

### LapTimes

Displays current lap time (`M:SS.mmm`) and previous lap time (if available) below the gauge. Updates via rAF reading `liveFrameRef` and `sessionLapsRef`.

### TelemetryStack

Three stacked ECharts line charts sharing a single container:

| Grid | Y-Axis | Scale |
|---|---|---|
| Top | Throttle (%) | 0–100 |
| Middle | Speed (km/h) | 0–320 |
| Bottom | Brake (%) | 0–100 |

- Shared X-axis (`track_position` 0–1) shown only at bottom
- Linked crosshair — hovering any grid shows vertical indicator across all three
- Current lap = solid cyan, Previous lap = dashed gray
- 2 legend entries that toggle all three grids simultaneously

### Layout

```
┌──────────┬──────────────────────────────┐
│          │  Throttle (%)                │
│  GAUGE   │  ─────────────────────────  │
│  20vw    │  Speed (km/h)                │
│  + timer │  ─────────────────────────  │
│          │  Brake (%)                   │
└──────────┴──────────────────────────────┘
```

---

## Telemetry Frame Schema

```json
{
  "ts": 1778072567948,
  "speed": 76.92,
  "rpm": 3010,
  "gear": 2,
  "throttle": 0.0,
  "brake": 0.0,
  "clutch": -0.008,
  "steer_angle": 0.0013,
  "lap": 0,
  "lap_time_ms": 186718,
  "lap_invalid": true,
  "pos_x": 207.386,
  "pos_y": -2.102,
  "pos_z": 488.427,
  "track_position": 0.297
}
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Build tool | Vite 6 |
| UI framework | React 19 |
| Language | TypeScript 5 |
| Charts | Apache ECharts 5 |
| Toasts | react-hot-toast |
| Backend | Node.js |
| MQTT client | mqtt |
| WebSocket server | ws |

---

## Extension Points

- **Best lap ghost** — add third series to `TelemetryStack` for the best lap's trace
- **Sector times** — compute from `track_position` intervals
- **Session info bar** — render `SessionMetadata` (track name, car, session type)
- **Additional gauges** — duplicate `LiveGauge` for steering angle, gear indicator, etc.
- **Dual Y-axis overlays** — overlay throttle on the speed grid for richer comparison
- **Connection status indicator** — render a banner when `isConnectedRef` is false
