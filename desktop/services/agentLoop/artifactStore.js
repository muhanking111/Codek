const artifactsByRun = new Map()
let persistentStore = null

function now() {
  return Date.now()
}

function makeId(prefix) {
  return `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function addArtifact(runId, artifact) {
  if (!runId) throw new Error("runId required")
  const item = {
    id: artifact.id || makeId("artifact"),
    runId,
    assignmentId: artifact.assignmentId || null,
    type: artifact.type || "log",
    path: artifact.path || null,
    content: artifact.content == null ? "" : String(artifact.content),
    metadata: artifact.metadata || {},
    createdAt: artifact.createdAt || now(),
  }
  const list = artifactsByRun.get(runId) || []
  list.push(item)
  artifactsByRun.set(runId, list)
  if (persistentStore?.saveArtifact) {
    try { persistentStore.saveArtifact(item) } catch {}
  }
  return item
}

function listArtifacts(runId, filter = {}) {
  const memory = artifactsByRun.get(runId)
  const list = memory || (persistentStore?.listArtifacts ? persistentStore.listArtifacts(runId, filter) : [])
  return list.filter((item) => {
    if (filter.assignmentId && item.assignmentId !== filter.assignmentId) return false
    if (filter.type && item.type !== filter.type) return false
    return true
  })
}

function clearRun(runId) {
  artifactsByRun.delete(runId)
}

function reset() {
  artifactsByRun.clear()
}

function hydrateRun(runId, artifacts = []) {
  artifactsByRun.set(runId, [...artifacts])
}

function configureStore(store) {
  persistentStore = store || null
}

module.exports = {
  addArtifact,
  listArtifacts,
  clearRun,
  hydrateRun,
  configureStore,
  reset,
}
