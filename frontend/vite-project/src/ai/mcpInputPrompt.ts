import { reactive } from "vue"
import type { McpRegistryInputMetadata } from "./mcpRegistryClient"

export interface McpInputRequiredPayload {
  code: "MCP_INPUT_REQUIRED"
  serverName?: string | null
  toolName?: string | null
  profileId?: string | null
  activeProfileId?: string | null
  missingInputs?: McpRegistryInputMetadata[]
}

export interface McpInputPromptRequest {
  id: string
  serverName: string | null
  toolName: string | null
  profileId: string | null
  inputs: McpRegistryInputMetadata[]
}

export const mcpInputPromptState = reactive<{
  queue: McpInputPromptRequest[]
}>({
  queue: [],
})

export function requestMcpInputs(payload: unknown): McpInputPromptRequest | null {
  const normalized = normalizeMcpInputRequiredPayload(payload)
  if (!normalized) return null
  const request: McpInputPromptRequest = {
    id: `mcp_input_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    serverName: normalized.serverName,
    toolName: normalized.toolName,
    profileId: normalized.profileId,
    inputs: normalized.inputs,
  }
  mcpInputPromptState.queue.push(request)
  return request
}

export function consumeMcpInputRequest(id: string): void {
  mcpInputPromptState.queue = mcpInputPromptState.queue.filter((request) => request.id !== id)
}

export function clearMcpInputPromptQueue(): void {
  mcpInputPromptState.queue = []
}

export function normalizeMcpInputRequiredPayload(payload: unknown): {
  serverName: string | null
  toolName: string | null
  profileId: string | null
  inputs: McpRegistryInputMetadata[]
} | null {
  if (!isObject(payload) || payload.code !== "MCP_INPUT_REQUIRED") return null
  const inputs = Array.isArray(payload.missingInputs)
    ? payload.missingInputs.map(normalizeInputMetadata).filter((input): input is McpRegistryInputMetadata => Boolean(input))
    : []
  if (inputs.length === 0) return null
  return {
    serverName: typeof payload.serverName === "string" && payload.serverName.trim() ? payload.serverName.trim() : null,
    toolName: typeof payload.toolName === "string" && payload.toolName.trim() ? payload.toolName.trim() : null,
    profileId: normalizeOptionalString(payload.profileId ?? payload.activeProfileId),
    inputs,
  }
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizeInputMetadata(value: unknown): McpRegistryInputMetadata | null {
  if (!isObject(value)) return null
  const id = typeof value.id === "string" ? value.id.trim() : ""
  if (!id) return null
  return {
    ...value,
    id,
    password: value.password === true,
  } as McpRegistryInputMetadata
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object"
}
