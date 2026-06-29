# Pit Wall Telemetry Hub — Low-Level Design

---

## 1. System Connectivity

```
Machine A (ACC)                     Machine B (this server)
  192.168.1.x                          192.168.1.9
┌─────────────────┐                ┌─────────────────────────────┐
│ ACC Sim         │  MQTT (1883)   │ Mosquitto Broker            │
│ 60 Hz telemetry │───────────────▶│                              │
│ ac/telemetry/   │                │ ac/telemetry/frame ──┐       │
│   frame          │                │ ac/session/metadata ─┤       │
│ ac/session/     │                │                       │       │
│   metadata       │                └───────────────────────┼───────┘
└─────────────────┘                                        │
                                     backend/server.js     │
                                     ┌─────────────────────▼─────┐
                                     │ mqtt.connect(localhost)    │
                                     │ on("message") → parse      │
                                     │ broadcast to WS clients    │
                                     │ WebSocketServer :8080      │
                                     └────────────┬──────────────┘
                                                  │ ws://
                           ┌──────────────────────┼──────────────┐
                           │  Browser (localhost:5173)            │
                           │  useTelemetryStream.js              │
                           │  ┌────────────────────────┐         │
                           │  │ WebSocket onmessage     │         │
                           │  │ → processIncomingFrame  │         │
                           │  └──────┬─────────────────┘         │
                           │         │                           │
                           │    ┌────▼───────────────────┐       │
                           │    │ Module-level refs       │       │
                           │    │ liveFrameRef            │       │
                           │    │ sessionLapsRef          │       │
                           │    │ currentLapRef           │       │
                           │    │ previousLapCompleted... │       │
                           │    └──┬──────────┬───────────┘       │
                           │       │          │                   │
                           │  rAF  │     rAF  │                   │
                           │  ┌────▼──┐ ┌────▼──────────────┐    │
                           │  │LiveGauge│ │TelemetryStack    │    │
                           │  │LapTimes │ │(Thr/Spd/Brk)    │    │
                           │  │TireDash │ │                  │    │
                           │  └────────┘ └──────────────────┘    │
                           └──────────────────────────────────────┘
```

---

## 2. Frame Processing Pipeline

```
MQTT message arrives on ac/telemetry/frame or ac/session/metadata
       │
       ▼
server.js: buildEnvelope(type, rawJson)        [OPTIMIZED — §13.1]
  ┌───────────────────────────────────────────────────┐
  │ try { JSON.parse(rawJson) }   // validate only,   │
  │ catch { return null }         // drop malformed   │
  │ return `{"type":"${type}","payload":${rawJson}}`  │
  │   (string concat — rawJson re-used verbatim)      │
  └───────────────────────────────────────────────────┘
       │
       ▼
WebSocket broadcast to all connected clients (skip if envelope === null)
       │
       ▼
useTelemetryStream: onmessage(event)
       │
       ▼
JSON.parse(event.data) → { type, payload }
       │
       ├── type === "metadata"
       │    └── resetSessionState()
       │         ├── sessionLapsRef.current = {}
       │         ├── currentLapRef.current = 0
       │         ├── liveFrameRef.current = null
       │         ├── wasLastFrameInvalid = false
       │         └── previousLapCompletedTimeRef.current = null
       │
       └── type === "telemetry"
            └── processIncomingFrame(frame)
                 │
                 ├── 1. handleLapInvalidationEdgeTrigger(frame)
                 │     ├── isNewLap = frame.lap > currentLapRef.current
                 │     │   └── if true: wasLastFrameInvalid = false  (re-arm)
                 │     ├── justBecameInvalid = !wasLastFrameInvalid && frame.lap_invalid
                 │     │   └── if true: fireLapInvalidatedAlert()
                 │     └── wasLastFrameInvalid = frame.lap_invalid
                 │
                 ├── 2. updateLiveFrame(frame)
                 │     └── liveFrameRef.current = frame
                 │
                 ├── 3. addFrameToSessionDictionary(frame)        [OPTIMIZED — §13.2]
                 │     └── sessionLapsRef.current[frame.lap].push(toChartPoint(frame))
                 │         toChartPoint = { track_position, throttle, brake,
                 │                          speed, lap_time_ms, ts }
                 │         (6 fields, not the full 17 — drops pos_*, gear, clutch,
                 │          steer_angle, and other fields §11 marks as "reserved")
                 │
                 └── 4. handleLapChange(frame.lap)
                       ├── if (newLap === currentLapRef.current) → return
                       ├── if (currentLapRef.current > 0):
                       │     capture last frame's lap_time_ms from the finishing lap
                       │     → previousLapCompletedTimeRef.current
                       ├── currentLapRef.current = newLap
                       └── deleteOldLaps(sessionLapsRef.current, newLap)
```

---

## 3. Component Tree & Data Flow

```
App.jsx
├── <Toaster />  (react-hot-toast, position top-right, CSS-var themed)
│
├── <header className="dashboard-header">
│   ├── brand: "Pit Wall — Telemetry" (Oswald 13px, --text-dim)
│   └── connection-status:
│       └── polls isConnectedRef.current every 500ms
│           ├── true  → green glow dot (--throttle) + "LIVE"
│           └── false → red glow dot (--brake) + "NO DATA"
│
└── <main className="dashboard-main">  (flex row, 20px gap)
    │
    ├── <section className="sidebar-panel">  (300px fixed, --panel bg, 3px radius, 20px pad)
    │   │
    │   ├── <p className="panel-label">Live Gauge</p>
    │   │
    │   ├── <LiveGauge />  (SVG renderer)
    │   │   Data: liveFrameRef.current
    │   │   ├── 10-segment shift-light bar (18×6px, 3px gap)
    │   │   │   Seg 0-3: --speed (cyan), 4-7: #e8eaed (white), 8-9: --redline (#ff3b30)
    │   │   │   Lit count = round(rpm / 8000 × 10), 80ms CSS transition
    │   │   ├── Thin 6px arc ring (mostly transparent, redline at [1, #ff3b30])
    │   │   ├── 3px pointer (58% length), 7px anchor dot
    │   │   ├── Rich-text center detail: "127\nkm/h" (JetBrains Mono 38px + Oswald 11px sub)
    │   │   └── Axis ticks/labels at 250° arc, 5 split lines
    │   │
    │   ├── <hr className="panel-divider" />  (1px --border, 18px margin top+bottom)
    │   │
    │   ├── <LapTimes />
    │   │   Data: liveFrameRef.current + previousLapCompletedTimeRef
    │   │   Font: JetBrains Mono, Oswald for labels
    │   │   ├── current = frame.lap_time_ms (36px, 500 weight, --text)
    │   │   ├── previous = stored from last lap transition (11px, --text-dim)
    │   │   └── delta = current - previous (13px, 500 weight)
    │   │       ├── negative → --throttle (green, faster)
    │   │       ├── positive → --brake (red, slower)
    │   │       └── zero → --text-dim (gray, equal)
    │   │
    │   ├── <hr className="panel-divider" />
    │   │
    │   └── <TireDashboard />
    │       └── (see §9 for full description)
    │
    └── <section className="telem-panel">  (flex: 1, position: relative, --panel bg)
        │
        ├── <p className="panel-label">Telemetry Stack — Throttle / Speed / Brake vs Track Position</p>
        │
        ├── <div style="position:relative; flex:1">
        │   ├── <TelemetryStack />  (SVG renderer)
        │   │   Data: sessionLapsRef.current
        │   │   Single ECharts instance, 3 stacked grids at 22% height each:
        │   │   │
        │   │   ├── Grid 0 (top, 6%):     Throttle (0-100%) vs Track Position (0-1)
        │   │   ├── Grid 1 (middle, 39%): Speed (0-300 km/h) vs Track Position
        │   │   └── Grid 2 (bottom, 72%): Brake (0-100%) vs Track Position
        │   │
        │   │   6 fixed series (indices §13.4):
        │   │     [0] THR_PREV: dashed #444455, 1px, 0.45 opacity
        │   │     [1] THR_CURR: solid --throttle (#00e676), 1.5px, appendData
        │   │     [2] SPD_PREV: dashed #444455, 1px, 0.45 opacity
        │   │     [3] SPD_CURR: solid --speed (#00e5ff), 1.5px, appendData
        │   │     [4] BRK_PREV: dashed #444455, 1px, 0.45 opacity
        │   │     [5] BRK_CURR: solid --brake (#ff5252), 1.5px, appendData
        │   │
        │   │   Gridlines: 1px at 6% opacity (--text at 0.06 alpha)
        │   │   Only bottom grid shows X-axis labels (0.0-1.0)
        │   │   Y-axis labels via JetBrains Mono 10px, 30% opacity
        │   │   No legend. tooltip: item trigger on --panel bg.
        │   │
        │   └── Floating channel captions (positioned absolute, 24px from left):
        │       ├── "Throttle" at 3% height, color --throttle
        │       ├── "Speed" at 36% height, color --speed
        │       └── "Brake" at 69% height, color --brake
        │       (all Oswald 10px, 1.5px letter-spacing, uppercase, pointer-events:none)
        │       Positioned via JS resize listener + DOM setAttribute.
        │
        └── </div>
```

---

## 4. Module-Level Ref Map

```
┌──────────────────────────────────────────────────────────────┐
│  MODULE SCOPE (shared singletons, allocated once at import)   │
│  Lives outside React reconciliation tree                      │
│                                                              │
│  const liveFrameRef                = { current: frame|null }  │
│  const sessionLapsRef              = { current: {lap:[]} }   │
│  const currentLapRef               = { current: number }     │
│  const previousLapCompletedTimeRef = { current: ms|null }     │
│                                                              │
│  let wasLastFrameInvalid  = false   (edge trigger state)     │
│  let connectionAlreadyStarted = false  (singleton guard)     │
│                                                              │
│  Helper:                                                      │
│  const toChartPoint = (frame) => ({                          │
│    track_position, throttle, brake, speed, lap_time_ms, ts   │
│  })  // 6 fields — ~70% smaller than full 17-field frame     │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       │  useTelemetryStream() exports them
                       ▼
  ┌────────────┬────────────┬───────────────┬─────────────────┐
  │            │            │               │                 │
  │ LiveGauge  │ LapTimes   │TelemetryStack │ TireDashboard   │
  │            │            │               │                 │
  │ liveFrame  │ liveFrame  │ sessionLaps   │ liveFrame       │
  │ Ref        │ Ref        │ Ref           │ Ref             │
  │            │ previous   │               │                 │
  │            │ LapComp... │               │                 │
  └────────────┴────────────┴───────────────┴─────────────────┘

  All components use rAF loops to poll refs directly.
  No useState-driven re-renders for 60 Hz data.
  toChartPoint() ensures sessionLapsRef stores only 6 fields,
  never the full 17-field MQTT payload.
```

---

## 5. Lap Memory Management

```
sessionLapsRef.current state example (mid-race):       [OPTIMIZED — §13.2]

  {
    0:  [c₀, c₁, c₂, ..., cₙ]  ← out-lap (~3000 points @ 50s)
    1:  [c₀, c₁, c₂, ..., cₙ]  ← lap 1 complete (~7500 points @ 125s)
    2:  [c₀, c₁, ..., cₖ]       ← lap 2 in progress (growing)
  }
  cᵢ = toChartPoint(frame) — 6 fields:
       { track_position, throttle, brake, speed, lap_time_ms, ts }

  LAP TRANSITION DETECTED: frame.lap changes from 2 → 3

  handleLapChange(3):
  ┌────────────────────────────────────────────────────────┐
  │  1. currentLapRef.current === 2                       │
  │     newLap === 3 → NOT equal → proceed                │
  │                                                       │
  │  2. currentLapRef.current (2) > 0 → YES               │
  │     previousLapFrames = sessionLapsRef[2]             │
  │     if frames exist:                                  │
  │       finalFrame = previousLapFrames[last]            │
  │       previousLapCompletedTimeRef.current =           │
  │         finalFrame.lap_time_ms                        │
  │       (stores 125000 ms as lap 2's completed time)    │
  │                                                       │
  │  3. currentLapRef.current = 3                         │
  │                                                       │
  │  4. deleteOldLaps(dictionary, 3):                     │
  │     bestLap = findBestLapNumber(dictionary)           │
  │     previousLap = 2                                   │
  │     currentLap = 3                                    │
  │     KEEP:  { 2, 3, bestLap }                         │
  │     DELETE: all other keys from dictionary            │
  └────────────────────────────────────────────────────────┘

  Result:
  sessionLapsRef.current = {
    1: [...],   ← if lap 1 is best lap
    2: [...],   ← previous lap
    3: [...]    ← current lap (growing)
  }

  Maximum 3 full laps retained at any time.
  Memory: ~22,000 points × 6 fields (vs. 17 pre-optimization)
  ≈ 70% smaller per-point footprint.
```

---

## 6. Delta Calculation Flow

```
╔═══════════════════════════════════════════════════════════╗
║  SOURCE DATA                                             ║
║                                                          ║
║  lap_time_ms = per-lap timer (resets to 0 each lap)      ║
║  Example: lap 4, 192 seconds in = 192385 ms              ║
║                                                          ║
║  PREVIOUS LAP TIME STORAGE                               ║
║                                                          ║
║  When lap transition 3→4 occurs:                         ║
║    last frame of lap 3 has lap_time_ms = 188200 ms       ║
║    → previousLapCompletedTimeRef.current = 188200         ║
║                                                          ║
║  LIVE COMPUTATION (every rAF tick while on lap 4):       ║
║                                                          ║
║    currentTime  = frame.lap_time_ms          = 192385   ║
║    previousTime = previousLapCompletedTimeRef = 188200  ║
║    diffMs       = 192385 - 188200            = 4185     ║
║    absSeconds   = 4185 / 1000                = 4.185    ║
║    sign         = diffMs > 0 → "+"                      ║
║    display      = "+4.2"                                ║
║                                                          ║
║  OUT-LAP EXCLUSION:                                      ║
║    handleLapChange checks currentLapRef > 0 before       ║
║    storing. Lap 0→1 transition stores nothing.           ║
║    Delta only appears after lap 1→2 transition.          ║
║                                                          ║
║  COLOR RULES (via CSS custom properties):                ║
║    diff < 0  →  var(--throttle)   #00e676  green, faster ║
║    diff > 0  →  var(--brake)      #ff5252  red, slower  ║
║    diff = 0  →  var(--text-dim)   #7a7f87  gray, equal  ║
╚═══════════════════════════════════════════════════════════╝
```

---

## 7. WebSocket Lifecycle

```
                              ┌──────────┐
                              │  MOUNT   │
                              └────┬─────┘
                                   │
                                   ▼
                        connectionAlreadyStarted?
                        ├── TRUE  → return (no-op guard)
                        └── FALSE → connectionAlreadyStarted = true
                                   │
                                   ▼
                             openConnection()
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
                onopen         onmessage       onclose / onerror
                ┌──────┐      ┌──────────┐    ┌──────────────────┐
                │console│      │JSON.parse│    │isConnected=false │
                │ "[ws]"│      │ if meta: │    │reconnectTimer =  │
                │isConn │      │  reset() │    │ setTimeout(open, │
                │= true │      │ if telem:│    │   2000)           │
                └──────┘      │  process │    └──────────────────┘
                              │IncomingFr│
                              └──────────┘

  Strict Mode (React dev, double-mount):
  ┌────────────────────────────────────────────────────┐
  │ Mount 1: effect runs                               │
  │   connectionAlreadyStarted = true                  │
  │   webSocket = new WebSocket(...)  → WS-A           │
  │                                                    │
  │ Unmount 1: cleanup runs                            │
  │   clearTimeout(reconnectTimer)  (none set yet)      │
  │   webSocket.close() → triggers onclose →            │
  │     reconnectTimer = setTimeout(open, 2000)         │
  │   connectionAlreadyStarted = false                  │
  │                                                    │
  │ Mount 2: effect runs                                │
  │   connectionAlreadyStarted = false → guard passes   │
  │   connectionAlreadyStarted = true                   │
  │   openConnection()                                  │
  │     → clearTimeout(reconnectTimer)  kills stale     │
  │     → new WebSocket(...)  → WS-B                   │
  │                                                    │
  │ Result: only WS-B is active, WS-A is dead.          │
  └────────────────────────────────────────────────────┘
```

---

## 8. rAF → ECharts Update Cycle

```
┌──────────────────────────────────────────────────┐
│ useEffect (mounts once, cleanup on unmount)      │
│                                                  │
│  1. echarts.init(container, undefined,           │
│       { renderer: "svg" })                       │
│     (SVG renderer for crisp scaling, no canvas)  │
│                                                  │
│  2. setOption(baseOption)                        │
│     Shapes, axes, grid layout set once           │
│                                                  │
│  3. rAF loop started:                            │
│                                                  │
│     ╔══════════════════════════════════════╗      │
│     ║  refresh()        ◀── rAF (display Hz) ║   [OPTIMIZED — §13.3]
│     ║                                      ║      │
│     ║  read ref.current                    ║      │
│     ║    ↓                                 ║      │
│     ║  if (frame.ts === lastRenderedTs)     ║      │
│     ║    → requestAnimationFrame, return    ║      │
│     ║  (skip redraw — display refresh can   ║      │
│     ║   exceed the 60Hz telemetry rate)     ║      │
│     ║    ↓                                 ║      │
│     ║  lastRenderedTs = frame.ts            ║      │
│     ║                                      ║      │
│     ║  LiveGauge: setOption({              ║      │
│     ║    series: [{ data: [{ value }] }]   ║ ← O(1) │
│     ║  })                        + shift   ║      │
│     ║    ↓                       lights    ║      │
│     ║                                      ║      │
│     ║  TelemetryStack:                     ║      │
│     ║    appendData() for CURR series       ║ [OPTIMIZED — §13.4]
│     ║    (indices 1,3,5 — O(1) per frame)  ║      │
│     ║    └── only the NEW point appended    ║      │
│     ║    setOption() for PREV series        ║      │
│     ║    └── ONCE on lap transition         ║      │
│     ║    positionCaptions() on resize       ║      │
│     ║    ↓                                 ║      │
│     ║  requestAnimationFrame──▶             ║ loop │
│     ╚══════════════════════════════════════╝      │
│                                                  │
│  4. Cleanup:                                     │
│     cancelAnimationFrame(animationId)            │
│     chartRef.current.dispose()                   │
│     window.removeEventListener("resize", ...)    │
└──────────────────────────────────────────────────┘
```

---

## 9. Tire Dashboard Data Binding

```
liveFrameRef.current (updated 60 Hz by WebSocket)
         │
         ▼
TireDashboard rAF loop (refresh())
         │
         ├─────────────────────────────────────────────────┐
         │  Per tire index i (0=FL, 1=FR, 2=RL, 3=RR):    │
         │                                                │
         │  frame.wheel_pressure[i]                        │
         │    └── pressureRefs[i].textContent =            │
         │          p.toFixed(1) | "—"                    │
         │                                                │
         │  frame.core_temp[i]                             │
         │    ├── coreRefs[i].textContent =                │
         │    │     c.toFixed(0) + "°" | "—"              │
         │    └── coreRefs[i].style.color =                │
         │          coreTempColor(c)                       │
         │          ├── < 75°   →  var(--text-faint)  #4a4e54  cold    │
         │          ├── < 90°   →  var(--speed)       #00e5ff  warmup  │
         │          ├── < 100°  →  var(--throttle)    #00e676  optimal │
         │          ├── < 108°  →  #ffc107                     hot     │
         │          └── ≥ 108°  →  var(--brake)       #ff5252  critical│
         │                                                │
         │  frame.surface_temp[i]                          │
         │    ├── surfaceRefs[i].textContent =             │
         │    │     s.toFixed(0) + "°" | "—"              │
         │    └── surfaceRefs[i].style.color =             │
         │          surfaceTempColor(s)                    │
         │          ├── < 50°   →  var(--text-faint)  #4a4e54  cold    │
         │          ├── < 70°   →  var(--speed)       #00e5ff  warmup  │
         │          ├── < 85°   →  var(--throttle)    #00e676  optimal │
         │          ├── < 95°   →  #ffc107                     hot     │
         │          └── ≥ 95°   →  var(--brake)       #ff5252  critical│
         └────────────────────────────────────────────────┘

  2×2 CSS Grid layout (mirrors physical car):

       ┌────────────┬────────────┐
       │   FL [0]   │   FR [1]   │
       │   26.8     │   26.5     │
       │ CORE SURF  │ CORE SURF  │
       │  85°  72°  │  83°  70°  │
       ├────────────┼────────────┤
       │   RL [2]   │   RR [3]   │
       │   26.3     │   26.1     │
       │ CORE SURF  │ CORE SURF  │
       │  84°  71°  │  82°  69°  │
       └────────────┴────────────┘

  Fonts: Oswald for labels (FL/FR, CORE/SURF), JetBrains Mono for values.
  Colors: references CSS custom properties (var(--text), var(--text-faint),
          var(--speed), var(--throttle), var(--brake)) instead of hardcoded hex.
```

---

## 10. Edge-Triggered Alert Flow

```
╔══════════════════════════════════════════════════╗
║  PROBLEM: lap_invalid stays true for many frames ║
║  SOLUTION: only fire on the RISING EDGE           ║
║  (0 → 1 transition of lap_invalid flag)           ║
╚══════════════════════════════════════════════════╝

  TRACKING STATE:
  let wasLastFrameInvalid = false  (module-level, persists across frames)

  PROCESSING:
  ┌──────────────────────────────────────────────┐
  │ handleLapInvalidationEdgeTrigger(frame)      │
  │                                              │
  │  isNewLap = frame.lap > currentLapRef.current │
  │  if (isNewLap):                              │
  │    wasLastFrameInvalid = false  (re-arm)     │
  │                                              │
  │  justBecameInvalid =                         │
  │    !wasLastFrameInvalid && frame.lap_invalid │
  │                                              │
  │  if (justBecameInvalid):                     │
  │    fireLapInvalidatedAlert()                 │
  │    ├── toast.error("Track limits...")        │
  │    └── speechSynthesis.speak("Lap inval...") │
  │                                              │
  │  wasLastFrameInvalid = frame.lap_invalid     │
  └──────────────────────────────────────────────┘

  EXAMPLE TRACE:

  Frame | lap | lap_invalid | wasLastInvalid | triggers?
  ──────┼─────┼────────────┼────────────────┼─────────
   100  |  2  |   false     |    false       |   no
   101  |  2  |   false     |    false       |   no
   102  |  2  |   true      |    false       |  YES ▶
   103  |  2  |   true      |    true        |   no
   104  |  2  |   true      |    true        |   no
  ──────┼─────┤   LAP CHANGE   ├────────────┼─────────
   105  |  3  |   false     | → reset=false │   no
   106  |  3  |   false     |    false       |   no
   107  |  3  |   true      |    false       |  YES ▶

  SESSION RESET:
  On metadata message → resetSessionState()
    → wasLastFrameInvalid = false
```

---

## 11. Telemetry Frame Schema

```
╔═══════════════════════════════════════════════╗
║  Incoming JSON from MQTT (via WebSocket)      ║
╚═══════════════════════════════════════════════╝

{
  ts:              number    // Unix timestamp (ms)
  speed:           number    // km/h
  rpm:             number    // Engine RPM
  gear:            number    // 0=N, -1=R, 1-8
  throttle:        number    // 0.0 - 1.0
  brake:           number    // 0.0 - 1.0
  clutch:          number    // 0.0 - 1.0
  steer_angle:     number    // degrees
  lap:             number    // Current lap (0=out-lap)
  lap_time_ms:     number    // Per-lap timer, resets each lap
  lap_invalid:     boolean   // Track limits / cut detected
  pos_x:           number    // World X position
  pos_y:           number    // World Y position
  pos_z:           number    // World Z position
  track_position:  number    // 0.0 to 1.0 (normalized track distance)
  wheel_pressure:  number[]  // [FL, FR, RL, RR] in PSI
  core_temp:       number[]  // [FL, FR, RL, RR] in °C
  surface_temp:    number[]  // [FL, FR, RL, RR] in °C
}

  FIELD USAGE MAP:

  Field               Used By
  ──────────────────────────────────────────
  speed               LiveGauge (center number), TelemetryStack (grid 1)
  rpm                 LiveGauge (pointer position + shift lights)
  throttle            TelemetryStack (grid 0), TelemetryStack tooltip
  brake               TelemetryStack (grid 2), TelemetryStack tooltip
  lap                 useTelemetryStream (lap boundary detection, edge trigger)
  lap_time_ms         LapTimes (current time, delta), toChartPoint
  lap_invalid         useTelemetryStream (edge trigger)
  track_position      TelemetryStack (X-axis for all 3 grids), toChartPoint
  ts                  toChartPoint (dedup guard §13.3), LiveGauge dedup
  wheel_pressure      TireDashboard (FL/FR/RL/RR)
  core_temp           TireDashboard (with CSS-var color coding)
  surface_temp        TireDashboard (with CSS-var color coding)
  pos_x/y/z           (reserved, not displayed — dropped by toChartPoint)
  steer_angle         (reserved, not displayed)
  gear                (reserved, not displayed)
  clutch              (reserved, not displayed)
```

---

## 12. Design Tokens

CSS custom properties defined in `App.css :root` — single source of truth for all visual styling.

```
┌─────────────────────────────────────────────────────────────┐
│  CSS Custom Property          Value         Used By          │
│ ───────────────────────────────────────────────────────────  │
│  --bg                         #0a0b0d       body, scrollbar  │
│  --panel                      #121417       .sidebar-panel,  │
│                                             .telem-panel,    │
│                                             tooltip bg       │
│  --border                     #23262b       panel borders,    │
│                                             dividers,        │
│                                             scrollbar thumb  │
│  --text                       #e8eaed       body color,      │
│                                             gauge detail,    │
│                                             lap timer,       │
│                                             tire values      │
│  --text-dim                   #7a7f87       header brand,    │
│                                             conn status,     │
│                                             panel labels,    │
│                                             prev lap time    │
│  --text-faint                 #4a4e54       tire labels,     │
│                                             CORE/SURF labels │
│                                                              │
│  Semantic (data-channel + state colors):                     │
│  --throttle                   #00e676       GREEN: faster    │
│     (semantic: positive/      (green)       delta, optimal   │
│      faster/optimal)                        tire temp,       │
│                                             CURR throttle    │
│                                             series, online   │
│                                             dot              │
│  --speed                      #00e5ff       CYAN: gauge      │
│     (semantic: neutral/       (cyan)        shift lights,    │
│      warmup/info)                           CURR speed       │
│                                             series, warmup   │
│                                             tire temps       │
│  --brake                      #ff5252       RED: slower      │
│     (semantic: negative/      (red)         delta, critical  │
│      slower/critical)                       tire temp, CURR  │
│                                             brake series,    │
│                                             offline dot      │
│  --redline                    #ff3b30       REDLINE: gauge   │
│     (semantic: redline RPM    (red-orange)  ring [1] stop,   │
│      danger)                                shift light      │
│                                             segments 8-9     │
│                                                              │
│  Typography:                                                  │
│  --font-label                 "Oswald",     Panel labels,     │
│                               sans-serif    gauge title,      │
│                                             tire corner       │
│                                             labels, conn      │
│                                             status, channel   │
│                                             captions          │
│  --font-data                  "JetBrains    All numeric       │
│                               Mono",        readouts: lap     │
│                               monospace     timer, delta,     │
│                                             tire pressure/    │
│                                             temp, gauge       │
│                                             detail, ECharts   │
│                                             axes/tooltip      │
│                                                              │
│  Fonts loaded via Google Fonts <link> in index.html:          │
│    Oswald: 400, 500, 600                                     │
│    JetBrains Mono: 400, 500, 700                             │
└─────────────────────────────────────────────────────────────┘

  Panel geometry:
  ┌─────────────────────────────────────────────────────────────┐
  │  Property                Value         Note                  │
  │ ───────────────────────────────────────────────────────────  │
  │  Panel border-radius     3px          Both panels           │
  │  Panel border            1px solid     --border              │
  │  Panel padding           20px         Both panels           │
  │  Sidebar width           300px        Fixed, flex-shrink:0  │
  │  Telem panel             flex:1        Fills remaining       │
  │  Dashboard gap           14px         Between header/main   │
  │  Main gap                20px         Between panels        │
  │  Panel divider           1px --border 18px margin           │
  │  Panel label             11px/500     1.5px letter-spacing  │
  │                           weight       uppercase             │
  │  Channel captions        10px/500     Absolute positioned    │
  │                           weight       left:24px, z-index:2 │
  └─────────────────────────────────────────────────────────────┘
```

---

## 13. Performance Optimizations (Machine B)

```
Four changes to the hot path, none touching Machine A or the wire
schema in §11. All are independent and safe to ship.

13.1 — Relay: stop parsing what you're about to re-stringify
  PROBLEM:  buildEnvelope() did JSON.parse(rawJson) then
            JSON.stringify(...) on EVERY frame, at 60Hz, fanned out
            to every connected client. The parse result was thrown
            away immediately after — pure CPU waste on the relay.
  FIX:      Validate with try/parse (catches malformed MQTT payloads
            before they reach N browser clients), but build the
            envelope via string concatenation, reusing rawJson as-is.
  TRADEOFF: A naive "just concatenate, skip validation entirely"
            version would be faster still, but would let one bad
            MQTT frame crash JSON.parse() on every connected client
            at once. Keeping the try/parse preserves that safety net
            for the cost of one parse (not parse+stringify).

13.2 — Session store: stop retaining fields nothing reads
  PROBLEM:  sessionLapsRef stored the full 17-field frame per data
            point, even though §11's own Field Usage Map shows
            pos_x/y/z, ts, steer_angle, gear, clutch are never read
            from this dictionary — TelemetryStack only ever charts
            5 fields (+ ts for the dedup guard §13.3).
  FIX:      toChartPoint(frame) reduces to { track_position,
            throttle, brake, speed, lap_time_ms, ts } before pushing.
  IMPACT:   ~70% smaller per-point footprint across ~22K retained
            points. Also future-proofs the store: new sim-specific
            fields added to the MQTT schema (tire wear, fuel, ABS/TC
            flags, whatever ACC exposes next) won't silently bloat
            session memory unless something actually charts them.

13.3 — Render loop: stop repainting unchanged frames
  PROBLEM:  Each component's rAF loop fires at DISPLAY refresh rate,
            not telemetry rate. ACC publishes at 60Hz, but sim rigs
            commonly run 144Hz/240Hz monitors — meaning refresh()
            could call setOption() 2-4x for every actual new data
            point, repainting an identical value each extra time.
  FIX:      Track lastRenderedTs; skip setOption() entirely if
            frame.ts hasn't changed since the last paint.
  IMPACT:   Caps ECharts redraw work to the actual data rate (60Hz)
            regardless of monitor refresh rate. Applied to LiveGauge,
            LapTimes, TireDashboard, and TelemetryStack.

13.4 — TelemetryStack: stop re-sending the whole lap every frame
  PROBLEM:  Each rAF tick rebuilt and sent the FULL accumulated
            series array for the current lap via setOption(). Early
            in a lap this is cheap; by lap end it's ~7,500 points
            re-diffed and re-sent 60+ times a second for ONE new
            point each time — cost grows linearly with lap progress.
  FIX:      6 fixed series indices:
              [0] THR_PREV: static, set ONCE on lap transition
              [1] THR_CURR: chart.appendData() — O(1) per frame
              [2] SPD_PREV: static, set ONCE on lap transition
              [3] SPD_CURR: chart.appendData() — O(1) per frame
              [4] BRK_PREV: static, set ONCE on lap transition
              [5] BRK_CURR: chart.appendData() — O(1) per frame
            lap transition: setOption with replaceMerge for PREV
            series + clear CURR series data arrays.
  IMPACT:   Per-frame chart-update cost stays flat across a session
            instead of growing with lap duration — the difference
            between a steady frame budget and a system that visibly
            degrades the longer you've been on track.

NOT changed (considered, deprioritized):
  Map vs. plain object for sessionLapsRef — delete on a plain JS
  object can trigger V8 dictionary-mode deopt. True, but
  deleteOldLaps() only runs once per LAP (~every 90-130s), not once
  per FRAME — the wins above are 60-240x more frequent and were
  prioritized first. Worth revisiting only if profiling shows it
  matters in practice.
```

---

## 14. File Map

```
trackside-hub/
├── backend/
│   ├── package.json     → mqtt, ws
│   └── server.js        → MQTT→WS relay, port 8080
│                           §13.1 string-concat buildEnvelope
│
├── frontend/
│   ├── index.html       → entry point, loads /src/main.jsx
│   │                       Google Fonts <link> for Oswald + JetBrains Mono
│   ├── package.json     → react, echarts, react-hot-toast, prop-types
│   ├── vite.config.js   → @vitejs/plugin-react
│   └── src/
│       ├── main.jsx     → ReactDOM.createRoot, StrictMode
│       ├── App.jsx      → Layout, connection indicator, component mounting,
│       │                   panel labels, channel caption divs
│       ├── App.css      → CSS custom properties (:root), panel geometry,
│       │                   typography, channel captions, scrollbar
│       ├── propTypes.js → TelemetryFrameShape (PropTypes validation)
│       ├── hooks/
│       │   └── useTelemetryStream.js
│       │       ├── Module-level refs (liveFrame, sessionLaps, lap data)
│       │       ├── WebSocket lifecycle (connect, reconnect, parse, route)
│       │       ├── Frame processors (edge trigger, update refs, dictionary)
│       │       ├── toChartPoint (frame → 6-field chart point, §13.2)
│       │       └── Memory manager (deleteOldLaps, findBestLapNumber)
│       └── components/
│           ├── LiveGauge.jsx          → SVG ECharts gauge (6px ring, 3px
│           │                             pointer, 10-segment shift lights,
│           │                             rich-text speed detail, §13.3 guard)
│           ├── LapTimes.jsx           → Current/prev lap time + delta,
│           │                             JetBrains Mono data, CSS-var colors
│           ├── TireDashboard.jsx      → 2×2 tire grid, Oswald labels,
│           │                             CSS-var temp color coding
│           ├── TelemetryStack.jsx     → 3-grid SVG chart (22% height each),
│           │                             appendData for CURR series (§13.4),
│           │                             static setOption for PREV series,
│           │                             floating channel captions +
│           │                             resize listener, §13.3 guard
│           └── TelemetryLineChart.jsx → Generic single-field line chart
│           │                             (not used in current layout)
│
├── README.md            → Project overview, quick start, extension points
├── PROJECT_ARCHITECTURE.md → Architecture documentation
├── UI_AUDIT.md          → Visual inventory, color/font/spacing catalog,
│                           component descriptions, UX assessment
└── LLD.md              → This document
```
