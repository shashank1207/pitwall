# PROJECT ARCHITECTURE — Pit Wall Telemetry Hub

---

## 1. Overview

**Pit Wall Telemetry Hub** is a real-time telemetry dashboard for Assetto Corsa Competizione (ACC).

- **Machine A** broadcasts live JSON telemetry via MQTT at 60 Hz.
- **Machine B** (this project) receives the MQTT stream through a Node.js relay, exposes it over WebSockets, and renders it in a React + ECharts dashboard.

The project is a two-directory monorepo: `backend/` (relay) and `frontend/` (dashboard). The two directories are fully isolated — they share no code, no dependencies, and no build tooling.

---

## 2. Directory Tree

```
trackside-hub/
├── PROJECT_ARCHITECTURE.md
├── backend/
│   ├── package.json
│   └── server.js
└── frontend/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
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
            └── LapComparisonChart.tsx
```

---

## 3. Data Flow Diagram

```
Machine A                          Machine B (this project)
┌──────────┐     MQTT      ┌──────────────────────────────────────┐
│   ACC    │──────────────▶│  backend/server.js                   │
│ (60 Hz)  │              │                                      │
│          │               │  mqttClient ──▶ WebSocketServer      │
│          │               │  subscribe:      port 8080           │
│          │               │   ac/telemetry/       │              │
│          │               │   frame               │              │
│          │               │   ac/session/         │              │
│          │               │   metadata            │              │
└──────────┘               └──────────────────────┼──────────────┘
                                                  │  WebSocket
                                                  │  ws://localhost:8080
                                                  │
                       ┌──────────────────────────┼──────────────┐
                       │  frontend/src/           │              │
                       │                          ▼              │
                       │  useTelemetryStream.ts                  │
                       │  ┌──────────────────────────┐          │
                       │  │ liveFrameRef             │──────────▶ LiveGauge
                       │  │ sessionLapsRef           │──────────▶ LapComparisonChart
                       │  │ (Module-level singletons)│  rAF     │
                       │  └──────────────────────────┘          │
                       └─────────────────────────────────────────┘
```

### Message Envelope (as sent by the backend over WebSocket)

```json
{
  "type": "telemetry",
  "payload": { ... }
}
```

```json
{
  "type": "metadata",
  "payload": { ... }
}
```

- `type: "metadata"` — Sent when the session resets or changes. Frontend clears all stored lap data.
- `type: "telemetry"` — Sent 60 times per second. Contains a full `TelemetryFrame`.

---

## 4. Backend — `server.js`

| Attribute | Value |
|---|---|
| **Purpose** | Connect to local MQTT broker, subscribe to ACC telemetry topics, relay frames to WebSocket clients. |
| **MQTT Topics** | `ac/session/metadata`, `ac/telemetry/frame` |
| **WebSocket Port** | `8080` |
| **Framework** | `mqtt` (client), `ws` (server) |
| **Client tracking** | `Set` of connected WebSocket clients |

### Helper Functions

| Function | One-line Purpose |
|---|---|
| `buildEnvelope(type, rawPayloadJson)` | Wraps a parsed MQTT payload into a `{ type, payload }` JSON envelope. |
| `broadcastToAllClients(message)` | Sends a string message to every open WebSocket client. |

### Lifecycle

1. MQTT connects to `mqtt://localhost:1883`.
2. Subscribes to both topics.
3. On each MQTT message, parses the JSON payload, builds an envelope, and broadcasts it.
4. WebSocket clients connect/disconnect are tracked but do not affect MQTT behavior.

---

## 5. Frontend — Types (`telemetry.ts`)

### `TelemetryFrame`

Every field below arrives in each 60 Hz telemetry frame.

| Field | Type | Purpose |
|---|---|---|
| `lap` | `number` | Current lap number (0 = out-lap, 1 = lap 1, etc.) |
| `track_position` | `number` | **Distance along the track normalized to [0, 1].** Critical: serves as the X-axis on the comparison chart so all laps stack perfectly regardless of pace. |
| `throttle` | `number` | Throttle pedal position (0–100%). |
| `brake` | `number` | Brake pedal position (0–100%). |
| `steer_angle` | `number` | Steering wheel angle in degrees. |
| `speed_kmh` | `number` | Vehicle speed in km/h. |
| `rpm` | `number` | Engine RPM. |
| `gear` | `number` | Current gear (0 = neutral, -1 = reverse). |
| `lap_time_ms` | `number` | Cumulative session lap time in milliseconds. |
| `current_lap_time_ms` | `number` | Elapsed time on current lap in milliseconds. |
| `last_lap_time_ms` | `number` | Completed last lap time in milliseconds (0 if no prior lap). |
| `best_lap_time_ms` | `number` | Personal best lap time in milliseconds. |

### `SessionMetadata`

| Field | Type | Purpose |
|---|---|---|
| `session_type` | `string` | Practice, Qualifying, or Race. |
| `track_name` | `string` | Track identifier. |
| `car_model` | `string` | Car model name. |

### `IncomingMessage`

A discriminated union matching the backend envelope format:
- `{ type: "metadata", payload: SessionMetadata }`
- `{ type: "telemetry", payload: TelemetryFrame }`

---

## 6. Frontend — Data Engine (`useTelemetryStream.ts`)

This is the **single source of truth** for all runtime telemetry data. It is a custom React hook, but the core data structures live **outside React** as module-level singletons so they are never touched by React's reconciliation.

### Module-Level Refs (Singletons)

| Ref | Type | Purpose |
|---|---|---|
| `liveFrameRef` | `{ current: TelemetryFrame \| null }` | Holds the single most recent telemetry frame. Updated 60×/s. |
| `sessionLapsRef` | `{ current: Record<LapNumber, TelemetryFrame[]> }` | A dictionary keyed by lap number. Each value is an ordered array of every frame received for that lap. |
| `currentLapRef` | `{ current: LapNumber }` | Tracks the driver's current lap for memory pruning. |
| `connectionAlreadyStarted` | `boolean` | Module-level guard to prevent duplicate WebSocket connections across React Strict Mode double-mounts. |

### WebSocket Lifecycle

1. Opens a WebSocket to `ws://localhost:8080`.
2. On `open` → sets `isConnectedRef.current = true`.
3. On `message` → parses the JSON envelope:
   - `type: "metadata"` → calls `resetSessionState()` (clears all lap data).
   - `type: "telemetry"` → calls `processIncomingFrame()`.
4. On `close` / `error` → schedules reconnect after 2 seconds.
5. Only **one** connection is ever opened (guarded by `connectionAlreadyStarted`).

### Data Processing Functions

| Function | One-line Purpose |
|---|---|
| `updateLiveFrame(frame)` | Assigns the newest frame to `liveFrameRef.current`. |
| `addFrameToSessionDictionary(frame)` | Appends a frame to `sessionLapsRef.current[frame.lap]`, creating the array if it doesn't exist. Skips lap 0 (out-lap). |
| `findBestLapNumber(lapDictionary)` | Scans all completed laps and returns the lap number with the lowest `last_lap_time_ms`. |
| `deleteOldLaps(lapDictionary, currentLap)` | Removes every lap from the dictionary **except** the current lap, the previous lap, and the best lap. |
| `handleLapChange(newLap)` | Detects when the driver crosses a lap boundary and triggers memory cleanup. |
| `resetSessionState()` | Clears `sessionLapsRef`, `currentLapRef`, and `liveFrameRef` to prepare for a new session. |
| `processIncomingFrame(frame)` | Orchestration: calls `updateLiveFrame`, `addFrameToSessionDictionary`, and `handleLapChange` in order. |

### Memory Management Rule

At all times, only **three** laps are retained in `sessionLapsRef.current`:
- **Current lap** — actively accruing data points.
- **Previous lap** (`currentLap - 1`) — the most recently completed lap.
- **Best lap** — the lap with the lowest `last_lap_time_ms`.

All other laps are deleted from the dictionary. This prevents unbounded memory growth during long sessions (potentially hundreds of laps at 60 Hz).

### Return Value

The hook exposes `{ liveFrameRef, sessionLapsRef, isConnectedRef }` so components can read the latest values without triggering React re-renders.

---

## 7. Frontend — Components

### `LiveGauge.tsx`

| Attribute | Detail |
|---|---|
| **Phase** | Phase 1 |
| **Visualization** | Apache ECharts **gauge** chart. |
| **Data Source** | Reads `liveFrameRef.current.speed_kmh` every animation frame. |
| **Range** | 0–320 km/h, with green/yellow/red color bands. |
| **Update Mechanism** | `requestAnimationFrame` loop inside a `useEffect`. Calls `chartInstance.setOption()` directly. **Zero React state updates.** |
| **Dark Theme** | Passes `"dark"` to `echarts.init()`. |

### `LapComparisonChart.tsx`

| Attribute | Detail |
|---|---|
| **Phase** | Phase 2 |
| **Visualization** | Apache ECharts **line** chart. |
| **Data Source** | Reads `sessionLapsRef.current` every animation frame. |
| **X-Axis** | `track_position` — type `"value"`, min 0, max 1. Ensures laps of different durations stack perfectly along the track's distance. |
| **Y-Axis** | Throttle (%) — type `"value"`, min 0, max 100. |
| **Series Generation** | Iterates `sessionLapsRef.current`. Creates one series for the current lap and one for the previous lap. Current lap = solid cyan (`#06b6d4`), previous lap = dashed gray (`#6b7280`). |
| **Data Point Format** | `[frame.track_position, frame.throttle]` — the ECharts `[x, y]` array format. |
| **Update Mechanism** | `requestAnimationFrame` loop. Uses `replaceMerge: ["series"]` to mutate only the series array, avoiding a full chart re-initialization. **Zero React state updates.** |
| **Symbols** | Disabled (`showSymbol: false`) to keep the line clean at 60 Hz data density. |
| **Empty State** | If no laps are in the dictionary, the chart simply remains at its base option. |

### `App.tsx`

| Attribute | Detail |
|---|---|
| **Purpose** | Top-level layout and initialization. |
| **Hook Call** | Calls `useTelemetryStream()` once at mount — starts the WebSocket connection. |
| **Layout** | Three sections: header (title), gauge panel, chart panel. |

---

## 8. Performance Notes

| Decision | Rationale |
|---|---|
| **Module-level refs instead of React state** | At 60 Hz, using `useState` would trigger a React re-render on every frame (60×/s). This overwhelms React's reconciliation and would freeze the UI. Module-level refs are mutable without triggering re-renders. |
| **`requestAnimationFrame` for chart polling** | `rAF` runs at the display's refresh rate (~60 Hz on most monitors), naturally synchronized to the telemetry stream rate. It pulls fresh data from the refs and pushes it directly to ECharts via `setOption()`. |
| **`replaceMerge: ["series"]` on ECharts** | By default, `setOption()` performs a shallow merge on all top-level keys. Specifying `replaceMerge` for `series` tells ECharts to fully replace the series array instead of merging individual series entries. This avoids stale series artifacts when laps are deleted. |
| **`animation: false` on line chart** | Disables ECharts' built-in transition animations. At 60 Hz, morphing between data frames would cause visual jitter with no benefit. |
| **Lap dictionary pruning** | Deleting old lap keys immediately frees memory. Without this, a 30-minute race at 60 Hz per lap would store millions of data points in memory. |

---

## 9. How to Run

### Prerequisites
- **Node.js** ≥ 18 on Machine B.
- **MQTT broker** running on Machine B at `localhost:1883` (e.g., Mosquitto).
- **ACC + telemetry tool** broadcasting to the MQTT broker on Machine A.

### Backend

```bash
cd trackside-hub/backend
npm install
npm start
```

The terminal will print:
```
WebSocket server listening on port 8080
Connected to MQTT broker
```

### Frontend

```bash
cd trackside-hub/frontend
npm install
npm run dev
```

The terminal will print a `http://localhost:5173` URL. Open it in a browser.

### Verification
1. Start ACC on Machine A and begin a session.
2. With the browser open, the **LiveGauge** needle should move immediately with speed changes.
3. After completing one lap, the **LapComparisonChart** should show the previous lap as a dashed gray line. On the next lap, the current lap appears as a solid cyan line overlaid on the same distance domain.

---

## 10. Extension Points

| Feature | Where to Add |
|---|---|
| **Brake overlay** | Add a second Y-axis to `LapComparisonChart` for brake (%), create additional series in `buildSeriesForLap`. |
| **Best-lap ghost line** | In `refreshChart()`, add a third series using `findBestLapNumber()` to locate the best lap in the dictionary. Render it as a dotted gold line. |
| **Sector times** | Extend `TelemetryFrame` with `sector_index` or compute sectors from `track_position` intervals. Store sector times per lap in a new ref. |
| **Additional gauges** | Create `LiveGauge` variants (e.g., RPM, steering angle) by duplicating the component with a different `liveFrameRef` field and gauge range. |
| **Session info bar** | Read the `metadata` message in `useTelemetryStream`, store `SessionMetadata` in a ref, and render a header component with track name and car. |
| **WebSocket reconnection UI** | Render a "Disconnected" banner when `isConnectedRef.current` is `false`, polled via a `useState`-backed interval separate from the chart rAF loops. |
