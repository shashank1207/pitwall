const mqtt = require("mqtt");
const { WebSocketServer } = require("ws");

const TELEMETRY_TOPIC = "ac/telemetry/frame";
const METADATA_TOPIC = "ac/session/metadata";
const WEBSOCKET_PORT = 8080;

const mqttClient = mqtt.connect("mqtt://localhost:1883");
const webSocketServer = new WebSocketServer({ port: WEBSOCKET_PORT });
const connectedClients = new Set();

mqttClient.on("connect", () => {
  console.log("Connected to MQTT broker");
  mqttClient.subscribe([TELEMETRY_TOPIC, METADATA_TOPIC]);
});

mqttClient.on("message", (topic, messageBuffer) => {
  const messageText = messageBuffer.toString();
  const messageType = topic === METADATA_TOPIC ? "metadata" : "telemetry";
  const envelope = buildEnvelope(messageType, messageText);

  broadcastToAllClients(envelope);
});

webSocketServer.on("connection", (clientSocket) => {
  console.log("WebSocket client connected");
  connectedClients.add(clientSocket);

  clientSocket.on("close", () => {
    console.log("WebSocket client disconnected");
    connectedClients.delete(clientSocket);
  });
});

console.log(`WebSocket server listening on port ${WEBSOCKET_PORT}`);

function buildEnvelope(messageType, rawPayloadJson) {
  try {
    JSON.parse(rawPayloadJson);
  } catch (_) {
    console.error("Dropped malformed MQTT frame");
    return null;
  }
  return `{"type":"${messageType}","payload":${rawPayloadJson}}`;
}

function broadcastToAllClients(message) {
  if (!message) return;
  for (const client of connectedClients) {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  }
}
