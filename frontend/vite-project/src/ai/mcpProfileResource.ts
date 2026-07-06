import {
  applyProfileMcpServers,
  type McpServerRuntimeConfig,
} from "./mcp.js"
import {
  workbenchProfileStore,
  type WorkbenchProfileStore,
} from "../settings/profileStore"

export interface ParsedMcpProfileResource {
  servers: McpServerRuntimeConfig[]
  inputs: unknown[]
  sandbox?: unknown
  errors: string[]
}

interface JsonObject {
  [key: string]: unknown
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stripJsonComments(source: string): string {
  let output = ""
  let inString = false
  let quote = ""
  let escaped = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]
    if (inString) {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === quote) {
        inString = false
        quote = ""
      }
      continue
    }
    if (char === "\"" || char === "'") {
      inString = true
      quote = char
      output += char
      continue
    }
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1
      output += "\n"
      continue
    }
    if (char === "/" && next === "*") {
      i += 2
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1
      i += 1
      continue
    }
    output += char
  }
  return output
}

function stripTrailingCommas(source: string): string {
  let output = ""
  let inString = false
  let quote = ""
  let escaped = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (inString) {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === quote) {
        inString = false
        quote = ""
      }
      continue
    }
    if (char === "\"" || char === "'") {
      inString = true
      quote = char
      output += char
      continue
    }
    if (char === ",") {
      let j = i + 1
      while (/\s/.test(source[j] || "")) j += 1
      if (source[j] === "}" || source[j] === "]") continue
    }
    output += char
  }
  return output
}

function parseJsonc(text: string): unknown {
  return JSON.parse(stripTrailingCommas(stripJsonComments(text)))
}

function parseProfileResourceContent(resource: string | undefined): { value: unknown; errors: string[] } {
  if (!resource || !resource.trim()) return { value: undefined, errors: [] }
  try {
    return { value: parseJsonc(resource), errors: [] }
  } catch (error) {
    return { value: undefined, errors: [error instanceof Error ? error.message : String(error)] }
  }
}

function resolveInnerMcpContent(value: unknown, errors: string[]): unknown {
  if (!isRecord(value)) return undefined
  if (!Object.prototype.hasOwnProperty.call(value, "mcp")) return value
  const content = value.mcp
  if (content === null || content === undefined || content === "") return undefined
  if (typeof content === "string") {
    try {
      return parseJsonc(content)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
      return undefined
    }
  }
  return isRecord(content) ? content : undefined
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.filter((item): item is string => typeof item === "string")
  return out.length ? out : undefined
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
    .filter(([, item]) => typeof item === "string" || typeof item === "number" || item === null)
    .map(([key, item]) => [key, item === null ? "" : String(item)])
  return entries.length ? Object.fromEntries(entries) : undefined
}

function headerMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
    .filter(([, item]) => typeof item === "string")
    .map(([key, item]) => [key, item as string])
  return entries.length ? Object.fromEntries(entries) : undefined
}

function normalizeServerConfig(name: string, value: unknown): McpServerRuntimeConfig | null {
  if (!isRecord(value)) return null
  const source = isRecord(value.config) ? { ...value.config, version: value.version, gallery: value.gallery } : value
  const type = typeof source.type === "string" ? source.type : ""
  if (type === "ws") return null
  const command = typeof source.command === "string" ? source.command.trim() : ""
  const url = typeof source.url === "string" ? source.url.trim() : typeof source.serverUrl === "string" ? source.serverUrl.trim() : ""
  if (type === "http" || type === "sse" || (!command && url)) {
    if (!url) return null
    return {
      serverName: name,
      name,
      type: "http",
      transport: "http",
      url,
      serverUrl: url,
      headers: headerMap(source.headers),
    }
  }
  if (!command) return null
  return {
    serverName: name,
    name,
    type: "stdio",
    transport: "stdio",
    command,
    args: stringArray(source.args),
    env: stringMap(source.env),
    cwd: typeof source.cwd === "string" ? source.cwd : undefined,
  }
}

function looksLikeServerMap(value: JsonObject): boolean {
  const entries = Object.entries(value)
  if (!entries.length) return false
  return entries.every(([, item]) => isRecord(item) && (
    typeof item.command === "string" ||
    typeof item.url === "string" ||
    typeof item.serverUrl === "string" ||
    isRecord(item.config)
  ))
}

function resolveServerMap(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  if (isRecord(value.servers)) return value.servers
  if (isRecord(value.mcpServers)) return value.mcpServers
  if (looksLikeServerMap(value)) return value
  return {}
}

export function parseMcpProfileResource(resource: string | undefined): ParsedMcpProfileResource {
  const errors: string[] = []
  const parsed = parseProfileResourceContent(resource)
  errors.push(...parsed.errors)
  const inner = resolveInnerMcpContent(parsed.value, errors)
  const serverMap = resolveServerMap(inner)
  const servers = Object.entries(serverMap)
    .map(([name, value]) => normalizeServerConfig(name, value))
    .filter((item): item is McpServerRuntimeConfig => Boolean(item))
  return {
    servers,
    inputs: isRecord(inner) && Array.isArray(inner.inputs) ? inner.inputs : [],
    sandbox: isRecord(inner) ? inner.sandbox : undefined,
    errors,
  }
}

export async function applyMcpProfileResource(resource: string | undefined): Promise<ParsedMcpProfileResource> {
  const parsed = parseMcpProfileResource(resource)
  await applyProfileMcpServers(parsed.servers)
  return parsed
}

export async function applyActiveProfileMcpResource(profileStore: WorkbenchProfileStore = workbenchProfileStore): Promise<ParsedMcpProfileResource> {
  const activeProfileId = profileStore.getActiveProfileId()
  const profile = activeProfileId ? profileStore.getProfile(activeProfileId) : null
  return applyMcpProfileResource(profile?.resources.mcp)
}

export async function hydrateAndApplyActiveProfileMcpResource(options: {
  force?: boolean
  profileStore?: WorkbenchProfileStore
} = {}): Promise<ParsedMcpProfileResource> {
  const profileStore = options.profileStore ?? workbenchProfileStore
  try {
    if (options.force) {
      await profileStore.refreshFromProfileStorage()
    } else {
      await profileStore.hydrateFromProfileStorage()
    }
  } catch {
    // Keep MCP registry aligned with the local active profile when desktop profile storage is unavailable.
  }
  return applyActiveProfileMcpResource(profileStore)
}
