/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/workbench/contrib/mcp/browser/mcpResourceQuickAccess.ts
 * and src/vs/platform/files/common/files.ts.
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { URI } from "../../../base/common/uri"
import { Emitter } from "../../../base/common/event"
import type { IDisposable } from "../../../base/common/lifecycle"
import {
  createFileSystemProviderError,
  FileChangeType,
  FileService,
  FileSystemProviderErrorCode,
  FileSystemProviderCapabilities,
  FileType,
  globalFileService,
  type IFileChange,
  type IFileReadOptions,
  type IFileReadStreamOptions,
  type IFileService,
  type IFileStat,
  type IFileSystemProvider,
  type IReadableStreamEvents,
  type IStat,
} from "./files"

export interface McpFileServiceResource {
  uri?: string
  name?: string
  title?: string
  description?: string
  mimeType?: string
  size?: number
  text?: string
  blob?: string
  contents?: Array<{ text?: string; blob?: string; mimeType?: string; uri?: string }>
}

export interface McpResourceResolveOptions {
  resolveMetadata?: boolean
}

export interface McpResourceFileService {
  readonly canVerifyResource: boolean
  resolve(resource: URI | string, options?: McpResourceResolveOptions): Promise<IFileStat>
  stat(resource: URI | string): Promise<IFileStat>
  exists(resource: URI | string): Promise<boolean>
  readFile(resource: URI | string, options?: IFileReadOptions): Promise<Uint8Array>
}

export interface McpResourceReadResult {
  contents?: Array<{ text?: string; blob?: string; mimeType?: string; uri?: string }>
}

export interface McpResourceFileSystemProviderOptions {
  readResource?: (uri: string) => Promise<McpResourceReadResult>
  subscribeResource?: (uri: string, listener: () => void) => Promise<IDisposable> | IDisposable
  cacheDurationMs?: number
  scheme?: string
}

export interface McpResourceFileSystemProviderRegistrationOptions extends McpResourceFileSystemProviderOptions {
  scheme?: string
  fileService?: IFileService
}

interface MutableMcpFileStat extends IFileStat {
  type: FileType
  size: number
  mtime: number
  ctime: number
  children: MutableMcpFileStat[] | undefined
}

const DIRECTORY_MIME_TYPE = "inode/directory"
const MOMENTARY_CACHE_DURATION_MS = 3000

export function createMcpResourceFileService(resources: McpFileServiceResource[] = []): McpResourceFileService {
  const index = buildMcpResourceStatIndex(resources)
  return {
    canVerifyResource: index.size > 0,
    async resolve(resource: URI | string): Promise<IFileStat> {
      const key = normalizeMcpResourceUri(resource)
      const stat = index.get(key)
      if (!stat) throw createFileSystemProviderError(`MCP resource not found: ${key}`, FileSystemProviderErrorCode.FileNotFound)
      return stat
    },
    async stat(resource: URI | string): Promise<IFileStat> {
      const key = normalizeMcpResourceUri(resource)
      const stat = index.get(key)
      if (!stat) throw createFileSystemProviderError(`MCP resource not found: ${key}`, FileSystemProviderErrorCode.FileNotFound)
      return { ...stat, children: undefined }
    },
    async exists(resource: URI | string): Promise<boolean> {
      return index.has(normalizeMcpResourceUri(resource))
    },
    async readFile(resource: URI | string): Promise<Uint8Array> {
      const key = normalizeMcpResourceUri(resource)
      const content = getResourceContent(resources, key)
      if (content === undefined) throw new Error(`MCP resource has no cached contents: ${key}`)
      return encodeText(content)
    },
  }
}

export function createMcpResourceFileSystemProvider(
  resources: McpFileServiceResource[] = [],
  options: McpResourceFileSystemProviderOptions = {},
): IFileSystemProvider {
  const service = createMcpResourceFileService(resources)
  const onDidChangeCapabilities = new Emitter<void>()
  const onDidChangeFile = new Emitter<readonly IFileChange[]>()
  const readCache = new Map<string, { promise: Promise<McpResourceReadResult>; timer: ReturnType<typeof setTimeout> | undefined }>()
  return {
    capabilities: FileSystemProviderCapabilities.Readonly,
    onDidChangeCapabilities: onDidChangeCapabilities.event,
    onDidChangeFile: onDidChangeFile.event,
    async stat(resource: URI): Promise<IStat> {
      const stat = await service.stat(resource)
      return {
        type: stat.type,
        size: stat.size || 0,
        mtime: stat.mtime || 0,
        ctime: stat.ctime || 0,
      }
    },
    async readdir(resource: URI): Promise<[string, FileType][]> {
      const stat = await service.resolve(resource)
      if (!stat.isDirectory) throw createFileSystemProviderError(`MCP resource is not a directory: ${resource.toString()}`, FileSystemProviderErrorCode.FileNotADirectory)
      return (stat.children || []).map((child) => [child.name, child.type])
    },
    async readFile(resource: URI, readOptions: IFileReadOptions = {}): Promise<Uint8Array> {
      let stat: IFileStat | undefined
      try {
        stat = await service.stat(resource)
      } catch {
        stat = undefined
      }
      const readData = await readResourceData(resources, resource, options, readCache)
      if (readData.forSameURI.length && (!stat?.isDirectory || readOptions.allowDirectoryRead === true)) {
        return encodeText(contentEntryToText(readData.forSameURI[0]))
      }
      if (readData.contents.length || stat?.isDirectory) {
        throw createFileSystemProviderError(`MCP resource is a directory: ${resource.toString()}`, FileSystemProviderErrorCode.FileIsADirectory)
      }
      if (!stat || stat.isDirectory) {
        throw createFileSystemProviderError(`MCP resource has no cached contents: ${resource.toString()}`, FileSystemProviderErrorCode.FileNotFound)
      }
      throw createFileSystemProviderError(`MCP resource has no cached contents: ${resource.toString()}`, FileSystemProviderErrorCode.FileNotFound)
    },
    readFileStream(resource: URI, opts: IFileReadStreamOptions = {}): IReadableStreamEvents<Uint8Array> {
      const stream = new OneShotReadableStream<Uint8Array>()
      this.readFile?.(resource, {
        etag: opts.etag,
        limits: opts.limits,
        signal: opts.signal,
        allowDirectoryRead: opts.allowDirectoryRead,
        allowMissingReadMetadata: opts.allowMissingReadMetadata,
      }).then((data) => {
        const position = Math.max(0, opts.position || 0)
        const length = typeof opts.length === "number" && opts.length >= 0 ? opts.length : undefined
        const sliced = length === undefined ? data.slice(position) : data.slice(position, position + length)
        stream.end(sliced)
      }, (error) => stream.error(error instanceof Error ? error : new Error(String(error))))
      return stream
    },
    async writeFile(): Promise<void> {
      throw createFileSystemProviderError("MCP resources are readonly", FileSystemProviderErrorCode.NoPermissions)
    },
    async delete(): Promise<void> {
      throw createFileSystemProviderError("MCP resources are readonly", FileSystemProviderErrorCode.NoPermissions)
    },
    async rename(): Promise<void> {
      throw createFileSystemProviderError("MCP resources are readonly", FileSystemProviderErrorCode.NoPermissions)
    },
    watch(resource: URI): IDisposable {
      if (!options.subscribeResource) return { dispose() {} }
      const uri = normalizeMcpResourceUri(resource)
      let disposed = false
      let inner: IDisposable | undefined
      Promise.resolve(options.subscribeResource(uri, () => {
        if (disposed) return
        onDidChangeFile.fire([{ type: FileChangeType.UPDATED, resource }])
      })).then((disposable) => {
        if (disposed) disposable.dispose()
        else inner = disposable
      }, () => {})
      return {
        dispose: () => {
          disposed = true
          inner?.dispose()
        },
      }
    },
  }
}

class OneShotReadableStream<T> implements IReadableStreamEvents<T> {
  private dataListeners = new Set<(data: T) => unknown>()
  private errorListeners = new Set<(error: Error) => unknown>()
  private endListeners = new Set<() => unknown>()
  private ended = false
  private bufferedData: T[] = []
  private bufferedError: Error | undefined

  onData(listener: (data: T) => unknown): IDisposable {
    this.dataListeners.add(listener)
    for (const data of this.bufferedData) listener(data)
    return { dispose: () => { this.dataListeners.delete(listener) } }
  }

  onError(listener: (error: Error) => unknown): IDisposable {
    this.errorListeners.add(listener)
    if (this.bufferedError) listener(this.bufferedError)
    return { dispose: () => { this.errorListeners.delete(listener) } }
  }

  onEnd(listener: () => unknown): IDisposable {
    this.endListeners.add(listener)
    if (this.ended) listener()
    return { dispose: () => { this.endListeners.delete(listener) } }
  }

  end(data: T): void {
    if (this.ended) return
    this.bufferedData.push(data)
    for (const listener of Array.from(this.dataListeners)) listener(data)
    this.ended = true
    for (const listener of Array.from(this.endListeners)) listener()
  }

  error(error: Error): void {
    if (this.ended) return
    this.bufferedError = error
    this.ended = true
    for (const listener of Array.from(this.errorListeners)) listener(error)
    for (const listener of Array.from(this.endListeners)) listener()
  }
}

export function registerMcpResourceFileSystemProvider(
  resources: McpFileServiceResource[] = [],
  options: McpResourceFileSystemProviderRegistrationOptions = {},
): IDisposable {
  const scheme = options.scheme || inferMcpResourceScheme(resources) || "mcp"
  const provider = createMcpResourceFileSystemProvider(resources, options)
  return (options.fileService || globalFileService).registerProvider(scheme, provider)
}

export function createMcpResourceProviderBackedFileService(
  resources: McpFileServiceResource[] = [],
  options: McpResourceFileSystemProviderOptions = {},
): McpResourceFileService {
  const fileService = new FileService()
  registerMcpResourceFileSystemProvider(resources, { ...options, fileService, scheme: options.scheme })
  return {
    canVerifyResource: resources.some((resource) => Boolean(normalizeMcpResourceUri(resource.uri || ""))),
    async resolve(resource: URI | string, resolveOptions?: McpResourceResolveOptions): Promise<IFileStat> {
      return fileService.resolve(toMcpResourceUri(resource), resolveOptions)
    },
    async stat(resource: URI | string): Promise<IFileStat> {
      return fileService.stat(toMcpResourceUri(resource))
    },
    async exists(resource: URI | string): Promise<boolean> {
      return fileService.exists(toMcpResourceUri(resource))
    },
    async readFile(resource: URI | string, readOptions?: IFileReadOptions): Promise<Uint8Array> {
      return fileService.readFile(toMcpResourceUri(resource), readOptions)
    },
  }
}

export function isMcpResourceDirectory(resource: McpFileServiceResource): boolean {
  if (resource.mimeType === DIRECTORY_MIME_TYPE) return true
  return normalizeMcpResourceUri(resource.uri || "").endsWith("/")
}

export function isMcpResourceDirectoryStat(stat: IFileStat | undefined): boolean {
  return Boolean(stat?.isDirectory)
}

function buildMcpResourceStatIndex(resources: McpFileServiceResource[]): Map<string, MutableMcpFileStat> {
  const index = new Map<string, MutableMcpFileStat>()
  for (const resource of resources) {
    const uri = normalizeMcpResourceUri(resource.uri || "")
    if (!uri) continue
    const stat = createMcpStat(uri, resource, isMcpResourceDirectory(resource))
    index.set(uri, stat)
    ensureParentDirectories(index, uri)
  }
  for (const stat of index.values()) {
    stat.children = collectDirectChildren(index, stat.resource.toString())
  }
  return index
}

function ensureParentDirectories(index: Map<string, MutableMcpFileStat>, uri: string): void {
  let current = parentResourceUri(uri)
  while (current && !index.has(current)) {
    index.set(current, createMcpStat(current, { uri: current, name: resourceBasename(current) }, true))
    current = parentResourceUri(current)
  }
}

function collectDirectChildren(index: Map<string, MutableMcpFileStat>, parentUri: string): MutableMcpFileStat[] {
  const prefix = ensureDirectoryUri(parentUri)
  const children: MutableMcpFileStat[] = []
  for (const [uri, stat] of index) {
    if (uri === parentUri || uri === prefix || !uri.startsWith(prefix)) continue
    const remaining = uri.slice(prefix.length).replace(/\/+$/g, "")
    if (!remaining || remaining.includes("/")) continue
    children.push(stat)
  }
  return children.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
}

function createMcpStat(uri: string, resource: McpFileServiceResource, directory: boolean): MutableMcpFileStat {
  const parsed = URI.parse(uri)
  const type = directory ? FileType.Directory : FileType.File
  return {
    resource: parsed,
    name: resource.title || resource.name || resourceBasename(uri),
    type,
    isFile: (type & FileType.File) === FileType.File,
    isDirectory: (type & FileType.Directory) === FileType.Directory,
    isSymbolicLink: false,
    size: typeof resource.size === "number" ? resource.size : 0,
    mtime: 0,
    ctime: 0,
    children: directory ? [] : undefined,
  }
}

async function readResourceData(
  resources: McpFileServiceResource[],
  resource: URI,
  options: McpResourceFileSystemProviderOptions,
  readCache: Map<string, { promise: Promise<McpResourceReadResult>; timer: ReturnType<typeof setTimeout> | undefined }>,
): Promise<{ contents: Array<{ text?: string; blob?: string; mimeType?: string; uri?: string }>; forSameURI: Array<{ text?: string; blob?: string; mimeType?: string; uri?: string }> }> {
  const uri = normalizeMcpResourceUri(resource)
  const cached = getResourceContent(resources, uri)
  if (cached !== undefined) {
    const contents = [{ uri, text: cached }]
    return { contents, forSameURI: contents }
  }
  if (!options.readResource) return { contents: [], forSameURI: [] }
  const existing = readCache.get(uri)
  const promise = existing?.promise ?? options.readResource(uri)
  const cacheDurationMs = Math.max(0, options.cacheDurationMs ?? MOMENTARY_CACHE_DURATION_MS)
  if (!existing) {
    const timer = cacheDurationMs > 0
      ? setTimeout(() => {
        readCache.delete(uri)
      }, cacheDurationMs)
      : undefined
    readCache.set(uri, { promise, timer })
  }
  const result = await promise
  const contents = Array.isArray(result?.contents) ? result.contents : []
  return {
    contents,
    forSameURI: contents.filter((content) => typeof content?.uri === "string" && equalsMcpResourceUri(content.uri, uri)),
  }
}

function getResourceContent(resources: McpFileServiceResource[], uri: string): string | undefined {
  const entry = resources.find((item) => normalizeMcpResourceUri(item.uri || "") === uri)
  if (!entry) return undefined
  if (typeof entry.text === "string") return entry.text
  if (typeof entry.blob === "string") return decodeBase64Text(entry.blob)
  if (Array.isArray(entry.contents)) return contentEntriesToText(entry.contents)
  return undefined
}

function contentEntriesToText(contents: Array<{ text?: string; blob?: string }>): string {
  const chunks: string[] = []
  for (const item of contents) {
    chunks.push(contentEntryToText(item))
  }
  return chunks.join("\n")
}

function contentEntryToText(item: { text?: string; blob?: string }): string {
  if (typeof item?.text === "string") return item.text
  if (typeof item?.blob === "string") return decodeBase64Text(item.blob)
  return ""
}

function encodeText(value: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value)
  return Uint8Array.from(Array.from(value).map((char) => char.charCodeAt(0) & 0xff))
}

function decodeBase64Text(value: string): string {
  try {
    if (typeof atob === "function") return atob(value)
  } catch {
    return ""
  }
  return ""
}

function parentResourceUri(uri: string): string {
  const trimmed = uri.replace(/[?#].*$/g, "").replace(/\/+$/g, "")
  const index = trimmed.lastIndexOf("/")
  if (index <= `${URI.parse(uri).scheme}://`.length) return ""
  return `${trimmed.slice(0, index + 1)}`
}

export function ensureDirectoryUri(uri: string): string {
  const text = normalizeMcpResourceUri(uri)
  return text.endsWith("/") ? text : `${text}/`
}

export function normalizeMcpResourceUri(resource: URI | string): string {
  if (URI.isUri(resource)) return resource.toString()
  return String(resource || "").trim()
}

function toMcpResourceUri(resource: URI | string): URI {
  if (URI.isUri(resource)) return resource
  const external = normalizeMcpResourceUri(resource)
  const parsed = URI.parse(external)
  return URI.revive({ ...parsed.toJSON(), external } as ReturnType<URI["toJSON"]> & { external: string })!
}

function inferMcpResourceScheme(resources: McpFileServiceResource[]): string {
  for (const resource of resources) {
    const uri = normalizeMcpResourceUri(resource.uri || "")
    if (!uri) continue
    try {
      const scheme = URI.parse(uri).scheme
      if (scheme) return scheme
    } catch {
      // ignore invalid sample URI and keep looking
    }
  }
  return ""
}

function equalsMcpResourceUri(candidate: string, expected: string): boolean {
  try {
    const left = normalizeUrlPath(new URL(candidate).pathname)
    const right = normalizeUrlPath(new URL(expected).pathname)
    return left === right || ensureTrailingSlash(left) === ensureTrailingSlash(right)
  } catch {
    return candidate === expected || ensureTrailingSlash(candidate) === ensureTrailingSlash(expected)
  }
}

function normalizeUrlPath(value: string): string {
  try {
    return decodeURIComponent(value).toLowerCase()
  } catch {
    return value.toLowerCase()
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`
}

function resourceBasename(uri: string): string {
  const text = normalizeMcpResourceUri(uri).replace(/[?#].*$/g, "").replace(/\/+$/g, "")
  const parts = text.split(/[\\/]/).filter(Boolean)
  return decodeURIComponent(parts[parts.length - 1] || text || "Resource")
}
