import { api } from "../lib/api"

export async function backendHealth() {
  try {
    return await api.get("/api/ollama/health")
  } catch {
    return null
  }
}

export async function listSessions() {
  return api.get("/api/sessions")
}

export async function getSession(id) {
  return api.get(`/api/sessions/${encodeURIComponent(id)}`)
}

export async function saveSession(session) {
  return api.post("/api/sessions", session)
}

export async function deleteSession(id) {
  return api.request("DELETE", `/api/sessions/${encodeURIComponent(id)}`)
}

export async function indexFile(entry) {
  return api.post("/api/index/file", entry)
}

export async function searchIndex(query, projectRoot, limit = 30) {
  return api.post("/api/index/search", { query, projectRoot, limit })
}

export async function clearProjectIndex(projectRoot) {
  return api.post("/api/index/clear", { projectRoot })
}

export async function getIndexSize(projectRoot) {
  return api.post("/api/index/size", { projectRoot })
}

export async function embedText(model, input) {
  const result = await api.post("/api/ollama/embed", { model, input })
  if (result && result.error) throw new Error(result.error)
  return result?.embeddings?.[0] || null
}
