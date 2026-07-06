import { api } from "../lib/api"

export type SandboxRoute = "local" | "docker"

export interface SandboxExecuteRequest {
  language: string
  code: string
  dependencies?: string[]
  env?: Record<string, string>
  timeoutMs?: number
  route?: SandboxRoute
}

export interface SandboxExecuteResult {
  success: boolean
  output: string
  error: string
  exitCode: number
  executionTimeMs: number
  route?: SandboxRoute
}

export async function executeSandbox(request: SandboxExecuteRequest): Promise<SandboxExecuteResult> {
  const route = request.route ?? "local"
  const endpoint = route === "docker" ? "/api/sandbox/docker/execute" : "/api/sandbox/execute"
  try {
    const result = await api.post<SandboxExecuteResult>(endpoint, request)
    return { ...result, route }
  } catch (err) {
    if (route === "docker") {
      const fallback = await api.post<SandboxExecuteResult>("/api/sandbox/execute", request)
      return { ...fallback, route: "local" }
    }
    throw err
  }
}

export async function checkSandboxHealth(): Promise<{ available: boolean; status: string; docker?: boolean }> {
  try {
    return await api.get<{ available: boolean; status: string; docker?: boolean }>("/api/sandbox/available")
  } catch {
    return { available: false, status: "unreachable" }
  }
}
