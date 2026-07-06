import { reactive } from "vue"
import type { McpResourceReadResult } from "../ai/mcpRegistryClient"
import type { ChatAttachment } from "../components/chatAttachments"
import { URI } from "../vscode-adapter/base/common/uri"
import type { IFileReadOptions, IFileStat } from "../vscode-adapter/platform/files/common/files"

const MCP_VIRTUAL_RESOURCE_ROOT = "/MCP Resources"

export interface McpVirtualResource {
  id: string
  serverName: string
  uri: string
  path: string
  name: string
  mimeType: string
  content: string
  openedAt: number
}

export interface McpVirtualResourceMetadata {
  name?: string
  title?: string
  mimeType?: string
}

export interface McpReadableFileService {
  stat(resource: URI | string): Promise<IFileStat>
  readFile(resource: URI | string, options?: IFileReadOptions): Promise<Uint8Array>
}

export const mcpResourceAccessState = reactive<{
  openedResources: McpVirtualResource[]
  chatAttachments: ChatAttachment[]
}>({
  openedResources: [],
  chatAttachments: [],
})

export function openMcpResource(
  serverName: string,
  uri: string,
  result: McpResourceReadResult,
  now = Date.now(),
): McpVirtualResource {
  const resource = createMcpVirtualResource(serverName, uri, result, now)
  mcpResourceAccessState.openedResources.unshift(resource)
  return resource
}

export function createMcpVirtualResource(
  serverName: string,
  uri: string,
  result: McpResourceReadResult,
  now = Date.now(),
): McpVirtualResource {
  const content = mcpReadResultToText(result)
  return {
    id: `mcp-resource:${serverName}:${uri}`,
    serverName,
    uri,
    path: mcpResourceVirtualPath(serverName, uri),
    name: resourceName(uri),
    mimeType: firstMimeType(result) || "text/plain",
    content,
    openedAt: now,
  }
}

export async function createMcpVirtualResourceFromFileService(
  serverName: string,
  uri: string,
  fileService: McpReadableFileService,
  metadata: McpVirtualResourceMetadata = {},
  now = Date.now(),
): Promise<McpVirtualResource> {
  const resource = URI.parse(uri)
  const stat = await fileService.stat(uri).catch(() => fileService.stat(resource).catch(() => undefined))
  const readOptions = { allowDirectoryRead: true, allowMissingReadMetadata: true }
  const content = decodeBytes(await fileService.readFile(uri, readOptions).catch(() => fileService.readFile(resource, readOptions)))
  return {
    id: `mcp-resource:${serverName}:${uri}`,
    serverName,
    uri,
    path: mcpResourceVirtualPath(serverName, uri),
    name: metadata.name || metadata.title || stat?.name || resourceName(uri),
    mimeType: metadata.mimeType || "text/plain",
    content,
    openedAt: now,
  }
}

export async function openMcpResourceFromFileService(
  serverName: string,
  uri: string,
  fileService: McpReadableFileService,
  metadata: McpVirtualResourceMetadata = {},
  now = Date.now(),
): Promise<McpVirtualResource> {
  const resource = await createMcpVirtualResourceFromFileService(serverName, uri, fileService, metadata, now)
  mcpResourceAccessState.openedResources.unshift(resource)
  return resource
}

export function attachMcpResourceToChat(resource: McpVirtualResource): ChatAttachment {
  const attachment: ChatAttachment = {
    id: `mcp-attachment:${resource.serverName}:${resource.uri}`,
    name: resource.name,
    size: resource.content.length,
    type: resource.mimeType,
    kind: "text",
    status: "ready",
    content: resource.content,
    preview: resource.content.slice(0, 240),
  }
  mcpResourceAccessState.chatAttachments.push(attachment)
  return attachment
}

export function consumePendingMcpChatAttachments(): ChatAttachment[] {
  return mcpResourceAccessState.chatAttachments.splice(0)
}

export function clearMcpResourceAccessState(): void {
  mcpResourceAccessState.openedResources = []
  mcpResourceAccessState.chatAttachments = []
}

export function getMcpResourceAccessEvidenceSummary() {
  const latestOpened = mcpResourceAccessState.openedResources[0]
  const latestAttachment = mcpResourceAccessState.chatAttachments[mcpResourceAccessState.chatAttachments.length - 1]
  return {
    source: "mcpResourceAccess",
    openedCount: mcpResourceAccessState.openedResources.length,
    attachmentCount: mcpResourceAccessState.chatAttachments.length,
    readonlyProviderPath: true,
    latestOpened: latestOpened
      ? {
        id: latestOpened.id,
        serverName: latestOpened.serverName,
        uri: latestOpened.uri,
        name: latestOpened.name,
        mimeType: latestOpened.mimeType,
        size: latestOpened.content.length,
        openedAt: latestOpened.openedAt,
      }
      : undefined,
    latestAttachment: latestAttachment
      ? {
        id: latestAttachment.id,
        name: latestAttachment.name,
        type: latestAttachment.type,
        size: latestAttachment.size,
        status: latestAttachment.status,
      }
      : undefined,
  }
}

export function mcpReadResultToText(result: McpResourceReadResult): string {
  const chunks: string[] = []
  for (const item of Array.isArray(result?.contents) ? result.contents : []) {
    if (typeof item?.text === "string") {
      chunks.push(item.text)
      continue
    }
    if (typeof item?.blob === "string") {
      chunks.push(decodeBase64Text(item.blob))
    }
  }
  return chunks.join("\n")
}

function firstMimeType(result: McpResourceReadResult): string {
  const entry = result.contents.find((item) => typeof item?.mimeType === "string" && item.mimeType)
  return typeof entry?.mimeType === "string" ? entry.mimeType : ""
}

function resourceName(uri: string): string {
  const text = String(uri || "")
  const withoutQuery = text.split(/[?#]/)[0]
  const parts = withoutQuery.split(/[\\/]/).filter(Boolean)
  return decodeURIComponent(parts[parts.length - 1] || text || "MCP Resource")
}

export function mcpResourceVirtualPath(serverName: string, uri: string): string {
  const name = safePathSegment(resourceName(uri))
  const server = safePathSegment(serverName || "server")
  const suffix = shortHash(`${serverName}:${uri}`)
  return `${MCP_VIRTUAL_RESOURCE_ROOT}/${server}/${suffix}-${name}`
}

function safePathSegment(value: string): string {
  const text = String(value || "").trim()
  return (text || "resource")
    .replace(/[<>:"|?*\u0000-\u001F]/g, "_")
    .replace(/[\\/]+/g, "_")
    .slice(0, 120)
}

function shortHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function decodeBase64Text(value: string): string {
  try {
    if (typeof atob === "function") {
      return atob(value)
    }
  } catch {
    return ""
  }
  return ""
}

function decodeBytes(value: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(value)
  return Array.from(value).map((byte) => String.fromCharCode(byte)).join("")
}
