const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

function defaultDbPath() {
  const dir = process.env.CODEK_DATA || path.join(os.homedir(), ".codek")
  return path.join(dir, "orchestrator.db")
}

function encode(value) {
  return JSON.stringify(value == null ? null : value)
}

function decode(value, fallback = null) {
  if (value == null || value === "") return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeInterruptedRun(run) {
  if (!run) return run
  const copy = JSON.parse(JSON.stringify(run))
  const interruptedAt = Date.now()
  if (copy.status === "running" || copy.status === "planning" || copy.status === "integrating") {
    copy.status = "failed"
    copy.summary = `${copy.summary || ""}\n应用重启，中断运行。`.trim()
    copy.recoveryRecommendation = {
      action: "retry",
      reason: "应用重启中断了执行，建议从最近 checkpoint 或当前失败阶段重试。",
      createdAt: interruptedAt,
    }
    copy.updatedAt = interruptedAt
    copy.events = [
      ...(copy.events || []),
      { runId: copy.id, type: "orchestrator:recovered_interrupted", status: copy.status, createdAt: interruptedAt },
    ]
  }
  if (copy.status === "applying" || copy.status === "verifying") {
    copy.status = "waiting_user"
    copy.recoveryRecommendation = {
      action: "ask_user",
      reason: "应用重启中断了应用/验证流程，建议先检查已写入文件，再选择继续或回滚。",
      createdAt: interruptedAt,
    }
    copy.updatedAt = interruptedAt
    if (copy.integrationDecision) {
      copy.integrationDecision.status = "rework_requested"
      copy.integrationDecision.reason = "应用重启，之前的应用/验证流程被中断，请检查结果后继续或回滚。"
    }
    copy.events = [
      ...(copy.events || []),
      { runId: copy.id, type: "orchestrator:recovered_interrupted", status: copy.status, createdAt: interruptedAt },
    ]
  }
  return copy
}

function rowToRun(row, assignments = [], decision = null, events = []) {
  if (!row) return null
  const payload = decode(row.payload, {})
  return {
    ...payload,
    id: row.id,
    goalId: row.goal_id || null,
    projectRoot: row.project_root || "",
    status: row.status,
    visibleMode: row.visible_mode,
    executionStrategy: row.execution_strategy,
    summary: row.summary || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignments,
    integrationDecision: decision,
    events,
  }
}

function createOrchestratorStore({ dbPath = defaultDbPath() } = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = openDatabase(dbPath)
  if (typeof db.pragma === "function") db.pragma("journal_mode = WAL")
  else db.exec("PRAGMA journal_mode = WAL")
  db.exec(`
    CREATE TABLE IF NOT EXISTS orchestrator_runs (
      id TEXT PRIMARY KEY,
      goal_id TEXT,
      project_root TEXT,
      status TEXT,
      visible_mode TEXT,
      execution_strategy TEXT,
      summary TEXT,
      payload TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS orchestrator_assignments (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      phase_id TEXT,
      role TEXT,
      status TEXT,
      payload TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS orchestrator_artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      assignment_id TEXT,
      type TEXT,
      path TEXT,
      content TEXT,
      metadata TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS orchestrator_decisions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE,
      status TEXT,
      payload TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS orchestrator_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      type TEXT,
      payload TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS orchestrator_recovery_actions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      assignment_id TEXT,
      phase_id TEXT,
      action TEXT,
      status TEXT,
      reason TEXT,
      payload TEXT,
      created_at INTEGER,
      completed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS orchestrator_checkpoints (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      stage TEXT,
      can_resume INTEGER DEFAULT 0,
      payload TEXT,
      created_at INTEGER
    );
  `)

  const saveRunStmt = db.prepare(`
    INSERT INTO orchestrator_runs
      (id, goal_id, project_root, status, visible_mode, execution_strategy, summary, payload, created_at, updated_at)
    VALUES
      (@id, @goalId, @projectRoot, @status, @visibleMode, @executionStrategy, @summary, @payload, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      goal_id = excluded.goal_id,
      project_root = excluded.project_root,
      status = excluded.status,
      visible_mode = excluded.visible_mode,
      execution_strategy = excluded.execution_strategy,
      summary = excluded.summary,
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `)
  const saveAssignmentStmt = db.prepare(`
    INSERT INTO orchestrator_assignments
      (id, run_id, phase_id, role, status, payload, created_at, updated_at)
    VALUES
      (@id, @runId, @phaseId, @role, @status, @payload, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      phase_id = excluded.phase_id,
      role = excluded.role,
      status = excluded.status,
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `)
  const saveDecisionStmt = db.prepare(`
    INSERT INTO orchestrator_decisions
      (id, run_id, status, payload, created_at, updated_at)
    VALUES
      (@id, @runId, @status, @payload, @createdAt, @updatedAt)
    ON CONFLICT(run_id) DO UPDATE SET
      id = excluded.id,
      status = excluded.status,
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `)
  const saveArtifactStmt = db.prepare(`
    INSERT INTO orchestrator_artifacts
      (id, run_id, assignment_id, type, path, content, metadata, created_at)
    VALUES
      (@id, @runId, @assignmentId, @type, @path, @content, @metadata, @createdAt)
    ON CONFLICT(id) DO UPDATE SET
      assignment_id = excluded.assignment_id,
      type = excluded.type,
      path = excluded.path,
      content = excluded.content,
      metadata = excluded.metadata,
      created_at = excluded.created_at
  `)
  const appendEventStmt = db.prepare(`
    INSERT INTO orchestrator_events (id, run_id, type, payload, created_at)
    VALUES (@id, @runId, @type, @payload, @createdAt)
  `)
  const saveRecoveryActionStmt = db.prepare(`
    INSERT INTO orchestrator_recovery_actions
      (id, run_id, assignment_id, phase_id, action, status, reason, payload, created_at, completed_at)
    VALUES
      (@id, @runId, @assignmentId, @phaseId, @action, @status, @reason, @payload, @createdAt, @completedAt)
    ON CONFLICT(id) DO UPDATE SET
      assignment_id = excluded.assignment_id,
      phase_id = excluded.phase_id,
      action = excluded.action,
      status = excluded.status,
      reason = excluded.reason,
      payload = excluded.payload,
      completed_at = excluded.completed_at
  `)
  const saveCheckpointStmt = db.prepare(`
    INSERT INTO orchestrator_checkpoints
      (id, run_id, stage, can_resume, payload, created_at)
    VALUES
      (@id, @runId, @stage, @canResume, @payload, @createdAt)
  `)

  function saveDecision(runId, decision) {
    if (!runId || !decision) return null
    const ts = Date.now()
    saveDecisionStmt.run({
      id: decision.id || makeId("decision"),
      runId,
      status: decision.status || "pending",
      payload: encode(decision),
      createdAt: decision.createdAt || ts,
      updatedAt: decision.updatedAt || decision.decidedAt || ts,
    })
    return decision
  }

  function saveRun(run) {
    if (!run?.id) throw new Error("run.id required")
    const ts = Date.now()
    const payload = { ...run }
    delete payload.assignments
    delete payload.integrationDecision
    delete payload.events
    saveRunStmt.run({
      id: run.id,
      goalId: run.goalId || null,
      projectRoot: run.projectRoot || "",
      status: run.status || "planning",
      visibleMode: run.visibleMode || "agent",
      executionStrategy: run.executionStrategy || "single-agent",
      summary: run.summary || "",
      payload: encode(payload),
      createdAt: run.createdAt || ts,
      updatedAt: run.updatedAt || ts,
    })
    for (const assignment of run.assignments || []) {
      saveAssignmentStmt.run({
        id: assignment.id,
        runId: run.id,
        phaseId: assignment.phaseId || null,
        role: assignment.role || null,
        status: assignment.status || "queued",
        payload: encode(assignment),
        createdAt: assignment.createdAt || assignment.startedAt || run.createdAt || ts,
        updatedAt: assignment.updatedAt || assignment.completedAt || run.updatedAt || ts,
      })
    }
    saveDecision(run.id, run.integrationDecision)
    for (const event of run.events || []) {
      appendEvent(run.id, event)
    }
    return run
  }

  function getAssignments(runId) {
    return db.prepare("SELECT * FROM orchestrator_assignments WHERE run_id = ? ORDER BY created_at ASC").all(runId)
      .map((row) => decode(row.payload, {
        id: row.id,
        runId: row.run_id,
        phaseId: row.phase_id,
        role: row.role,
        status: row.status,
      }))
  }

  function getDecision(runId) {
    const row = db.prepare("SELECT * FROM orchestrator_decisions WHERE run_id = ?").get(runId)
    return row ? decode(row.payload, null) : null
  }

  function getEvents(runId, filter = {}) {
    let rows = db.prepare("SELECT * FROM orchestrator_events WHERE run_id = ? ORDER BY created_at ASC").all(runId)
    const since = Number(filter.since || 0)
    const limit = Number(filter.limit || 0)
    if (since > 0) rows = rows.filter((row) => row.created_at > since)
    if (filter.type) rows = rows.filter((row) => row.type === filter.type)
    if (limit > 0) rows = rows.slice(-limit)
    return rows
      .map((row) => ({ ...decode(row.payload, {}), id: row.id, runId: row.run_id, type: row.type, createdAt: row.created_at }))
  }

  function getRun(id) {
    const row = db.prepare("SELECT * FROM orchestrator_runs WHERE id = ?").get(id)
    return rowToRun(row, getAssignments(id), getDecision(id), getEvents(id))
  }

  function listRuns(options = 100) {
    const opts = typeof options === "number" ? { limit: options } : (options || {})
    const limit = Math.max(1, Math.min(Number(opts.limit || 100), 500))
    const includeDetails = opts.includeDetails !== false
    const includeAssignments = includeDetails || opts.includeAssignments === true
    const includeDecision = includeDetails || opts.includeDecision === true
    const includeEvents = includeDetails || opts.includeEvents === true
    const rows = db.prepare("SELECT * FROM orchestrator_runs ORDER BY updated_at DESC LIMIT ?").all(limit)
    return rows.map((row) => rowToRun(
      row,
      includeAssignments ? getAssignments(row.id) : [],
      includeDecision ? getDecision(row.id) : null,
      includeEvents ? getEvents(row.id) : [],
    ))
  }

  function saveArtifact(artifact) {
    if (!artifact?.runId) throw new Error("artifact.runId required")
    const item = {
      id: artifact.id || makeId("artifact"),
      runId: artifact.runId,
      assignmentId: artifact.assignmentId || null,
      type: artifact.type || "log",
      path: artifact.path || null,
      content: artifact.content == null ? "" : String(artifact.content),
      metadata: artifact.metadata || {},
      createdAt: artifact.createdAt || Date.now(),
    }
    saveArtifactStmt.run({
      ...item,
      metadata: encode(item.metadata),
    })
    return item
  }

  function listArtifacts(runId, filter = {}) {
    let rows = db.prepare("SELECT * FROM orchestrator_artifacts WHERE run_id = ? ORDER BY created_at ASC").all(runId)
    if (filter.assignmentId) rows = rows.filter((row) => row.assignment_id === filter.assignmentId)
    if (filter.type) rows = rows.filter((row) => row.type === filter.type)
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      assignmentId: row.assignment_id || null,
      type: row.type,
      path: row.path || null,
      content: row.content || "",
      metadata: decode(row.metadata, {}),
      createdAt: row.created_at,
    }))
  }

  function appendEvent(runId, event) {
    if (!runId || !event) return null
    const item = {
      id: event.id || makeId("event"),
      runId,
      type: event.type || "event",
      payload: encode(event),
      createdAt: event.createdAt || Date.now(),
    }
    appendEventStmt.run(item)
    return item
  }

  function saveRecoveryAction(action) {
    if (!action?.runId) throw new Error("recovery action runId required")
    const item = {
      id: action.id || makeId("recovery"),
      runId: action.runId,
      assignmentId: action.assignmentId || null,
      phaseId: action.phaseId || null,
      action: action.action,
      status: action.status || "suggested",
      reason: action.reason || "",
      payload: action.payload || {},
      createdAt: action.createdAt || Date.now(),
      completedAt: action.completedAt || null,
    }
    saveRecoveryActionStmt.run({
      ...item,
      payload: encode(item.payload),
    })
    return item
  }

  function listRecoveryActions(runId, filter = {}) {
    let rows = db.prepare("SELECT * FROM orchestrator_recovery_actions WHERE run_id = ? ORDER BY created_at ASC").all(runId)
    if (filter.status) rows = rows.filter((row) => row.status === filter.status)
    if (filter.action) rows = rows.filter((row) => row.action === filter.action)
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      assignmentId: row.assignment_id || null,
      phaseId: row.phase_id || null,
      action: row.action,
      status: row.status,
      reason: row.reason || "",
      payload: decode(row.payload, {}),
      createdAt: row.created_at,
      completedAt: row.completed_at || null,
    }))
  }

  function getRecoveryAction(runId, actionId) {
    return listRecoveryActions(runId).find((action) => action.id === actionId) || null
  }

  function saveCheckpoint(runId, checkpoint = {}) {
    if (!runId) throw new Error("checkpoint runId required")
    const item = {
      id: checkpoint.id || makeId("checkpoint"),
      runId,
      stage: checkpoint.stage || "unknown",
      summary: checkpoint.summary || "",
      plan: checkpoint.plan || null,
      assignments: checkpoint.assignments || [],
      artifactIds: checkpoint.artifactIds || [],
      qualityGate: checkpoint.qualityGate || null,
      recoveryActionIds: checkpoint.recoveryActionIds || [],
      canResume: checkpoint.canResume === true,
      createdAt: checkpoint.createdAt || Date.now(),
      ...checkpoint,
    }
    saveCheckpointStmt.run({
      id: item.id,
      runId,
      stage: item.stage,
      canResume: item.canResume ? 1 : 0,
      payload: encode(item),
      createdAt: item.createdAt,
    })
    return item
  }

  function listCheckpoints(runId) {
    return db.prepare("SELECT * FROM orchestrator_checkpoints WHERE run_id = ? ORDER BY created_at DESC").all(runId)
      .map((row) => ({
        ...decode(row.payload, {}),
        id: row.id,
        runId: row.run_id,
        stage: row.stage || "unknown",
        canResume: Boolean(row.can_resume),
        createdAt: row.created_at,
      }))
  }

  function getLatestCheckpoint(runId) {
    return listCheckpoints(runId)[0] || null
  }

  function clearAll() {
    db.exec(`
      DELETE FROM orchestrator_checkpoints;
      DELETE FROM orchestrator_events;
      DELETE FROM orchestrator_recovery_actions;
      DELETE FROM orchestrator_decisions;
      DELETE FROM orchestrator_artifacts;
      DELETE FROM orchestrator_assignments;
      DELETE FROM orchestrator_runs;
    `)
  }

  function close() {
    db.close()
  }

  return {
    dbPath,
    saveRun,
    getRun,
    listRuns,
    saveArtifact,
    listArtifacts,
    saveDecision,
    appendEvent,
    listEvents: getEvents,
    saveRecoveryAction,
    listRecoveryActions,
    getRecoveryAction,
    saveCheckpoint,
    listCheckpoints,
    getLatestCheckpoint,
    clearAll,
    close,
  }
}

function openDatabase(dbPath) {
  try {
    const Database = require("better-sqlite3")
    return new Database(dbPath)
  } catch {
    const { DatabaseSync } = require("node:sqlite")
    return new DatabaseSync(dbPath)
  }
}

let defaultStore = null

function getDefaultStore() {
  if (!defaultStore) defaultStore = createOrchestratorStore()
  return defaultStore
}

function configureDefaultStore(options = {}) {
  if (defaultStore) defaultStore.close()
  defaultStore = createOrchestratorStore(options)
  return defaultStore
}

module.exports = {
  createOrchestratorStore,
  configureDefaultStore,
  getDefaultStore,
  normalizeInterruptedRun,
}
