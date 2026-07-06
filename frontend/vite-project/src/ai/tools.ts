/*---------------------------------------------------------------------------------------------
 *  Frontend tool registry.
 *
 *  Thin wrapper over window.codek.agentTools — the source of truth for tool schemas
 *  lives in `desktop/services/agentTools/tools.js`.
 *
 *  Provides:
 *    - listAvailableTools(): cached schema fetch
 *    - invokeTool(name, input): execute via IPC, may pop an auth dialog
 *
 *  Authorization UI is driven by the AuthorizationDialog component, which subscribes
 *  to `window.codek.agentTools.onAuthRequest`. This module does NOT show the dialog
 *  itself — it only ferries data through the IPC layer.
 *--------------------------------------------------------------------------------------------*/

export interface ToolSchema {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  autoAuthorize: boolean
}

export interface ToolInvocationResult {
  /** Plain-text body suitable for feeding back to the LLM. */
  content: string
  /** Optional structured payload for richer UI rendering. */
  structured?: unknown
  /** True when the tool reported an error (still a "result" the model should see). */
  isError?: boolean
  /** True when the user denied the call. */
  denied?: boolean
}

interface AgentToolsBridge {
  list(): Promise<{ ok: boolean; data?: { ok: boolean; tools?: ToolSchema[]; error?: string } }>
  invoke(
    name: string,
    input: unknown,
    projectRoot: string,
  ): Promise<{
    ok: boolean
    data?: {
      ok: boolean
      allowed?: boolean
      isError?: boolean
      content?: string
      structured?: unknown
      error?: string
    }
  }>
  clearAlwaysAllow(tool?: string | null): Promise<unknown>
  onAuthRequest(callback: (payload: AuthRequestPayload) => void): () => void
  resolveAuth(requestId: string, allow: boolean, alwaysAllow?: boolean): void
}

export interface AuthRequestPayload {
  requestId: string
  tool: string
  input: unknown
  preview: string | null
}

function getBridge(): AgentToolsBridge | null {
  const codek = (window as unknown as { codek?: { agentTools?: AgentToolsBridge } }).codek
  return codek?.agentTools ?? null
}

let cached: ToolSchema[] | null = null

export async function listAvailableTools(force = false): Promise<ToolSchema[]> {
  if (cached && !force) return cached
  const bridge = getBridge()
  if (!bridge) return []
  const res = await bridge.list()
  const body = (res as { data?: { tools?: ToolSchema[] } })?.data
  cached = body?.tools ?? []
  return cached
}

export async function invokeTool(
  name: string,
  input: unknown,
  projectRoot: string,
): Promise<ToolInvocationResult> {
  const bridge = getBridge()
  if (!bridge) {
    return { content: "Agent tools IPC bridge not available.", isError: true }
  }
  const res = await bridge.invoke(name, input, projectRoot)
  const body = (res as { data?: { allowed?: boolean; isError?: boolean; content?: string; structured?: unknown; error?: string } })?.data
  if (!body) {
    return { content: "IPC error: no body returned", isError: true }
  }
  if (body.allowed === false) {
    return { content: body.content ?? "user denied", isError: true, denied: true }
  }
  return {
    content: body.content ?? "",
    structured: body.structured,
    isError: !!body.isError,
  }
}

export function subscribeToAuthRequests(callback: (payload: AuthRequestPayload) => void): () => void {
  const bridge = getBridge()
  if (!bridge) return () => undefined
  return bridge.onAuthRequest(callback)
}

export function resolveAuthRequest(requestId: string, allow: boolean, alwaysAllow = false): void {
  const bridge = getBridge()
  bridge?.resolveAuth(requestId, allow, alwaysAllow)
}
