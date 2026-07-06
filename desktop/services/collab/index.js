const { getDb } = require("../db")

const HISTORY_LIMIT = 100

// in-memory: sessionId → { peers: Set<ws>, history: [], revision: int, users: Map<ws, string> }
const rooms = new Map()

function getRoom(sessionId) {
  if (!rooms.has(sessionId)) {
    rooms.set(sessionId, { peers: new Set(), history: [], revision: 0, users: new Map() })
    loadHistory(sessionId)
  }
  return rooms.get(sessionId)
}

function loadHistory(sessionId) {
  try {
    const rows = getDb().prepare(
      "SELECT revision, user_id, operation_json FROM collab_operations WHERE session_id = ? ORDER BY revision ASC LIMIT ?"
    ).all(sessionId, HISTORY_LIMIT)
    const room = rooms.get(sessionId)
    for (const r of rows) {
      room.history.push({ revision: r.revision, userId: r.user_id, operation: JSON.parse(r.operation_json) })
    }
    if (rows.length) room.revision = rows[rows.length - 1].revision
  } catch {}
}

function persistOp(sessionId, revision, userId, operationJson) {
  try {
    getDb().prepare(
      "INSERT OR IGNORE INTO collab_operations (session_id, revision, user_id, operation_json, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(sessionId, revision, userId, operationJson, Date.now())
  } catch {}
}

function broadcast(room, msg, exclude) {
  const payload = JSON.stringify(msg)
  for (const peer of room.peers) {
    if (peer !== exclude && peer.readyState === 1 /* OPEN */) {
      try { peer.send(payload) } catch {}
    }
  }
}

function handleConnection(ws, sessionId) {
  const room = getRoom(sessionId)
  room.peers.add(ws)

  ws.send(JSON.stringify({ type: "join", sessionId, connections: room.peers.size }))
  ws.send(JSON.stringify({
    type: "history",
    revision: room.revision,
    operations: room.history.slice(-HISTORY_LIMIT),
  }))

  ws.on("message", (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    const type = msg.type || ""

    if (type === "join") {
      const username = msg.username || "anonymous"
      room.users.set(ws, username)
      broadcast(room, { type: "join", sessionId, username, connections: room.peers.size }, null)
    } else if (type === "leave") {
      const username = room.users.get(ws) || "unknown"
      room.users.delete(ws)
      broadcast(room, { type: "leave", sessionId, username, connections: room.peers.size - 1 }, ws)
    } else if (type === "operation") {
      const userId = msg.userId || "unknown"
      const operation = msg.operation
      room.revision += 1
      const rev = room.revision
      const opJson = JSON.stringify(operation)
      room.history.push({ revision: rev, userId, operation })
      if (room.history.length > HISTORY_LIMIT) room.history.splice(0, room.history.length - HISTORY_LIMIT)
      persistOp(sessionId, rev, userId, opJson)
      broadcast(room, { type: "operation", revision: rev, userId, operation }, ws)
      try { ws.send(JSON.stringify({ type: "ack", revision: rev })) } catch {}
    } else if (type === "cursor") {
      broadcast(room, msg, ws)
    } else if (type === "getHistory") {
      try {
        ws.send(JSON.stringify({ type: "history", revision: room.revision, operations: room.history.slice(-HISTORY_LIMIT) }))
      } catch {}
    } else {
      broadcast(room, msg, ws)
    }
  })

  ws.on("close", () => {
    const username = room.users.get(ws) || "unknown"
    room.users.delete(ws)
    room.peers.delete(ws)
    if (room.peers.size === 0) {
      rooms.delete(sessionId)
    } else {
      broadcast(room, { type: "leave", username, connections: room.peers.size }, null)
    }
  })
}

function register(router) {
  // Collab is WebSocket-only; no HTTP routes needed.
  // The WebSocket server is started in services/index.js and calls handleConnection.
}

module.exports = { register, handleConnection }
