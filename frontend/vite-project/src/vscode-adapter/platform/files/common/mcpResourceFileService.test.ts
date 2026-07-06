import { describe, expect, it, vi } from "vitest"
import { URI } from "../../../base/common/uri"
import { FileChangeType, FileService, FileSystemProviderCapabilities, FileSystemProviderErrorCode } from "./files"
import {
  createMcpResourceFileSystemProvider,
  createMcpResourceProviderBackedFileService,
  createMcpResourceFileService,
  isMcpResourceDirectoryStat,
  registerMcpResourceFileSystemProvider,
} from "./mcpResourceFileService"

describe("MCP resource file service adapter", () => {
  const resources = [
    { uri: "file:///workspace/README.md", name: "README.md", mimeType: "text/markdown", size: 12 },
    { uri: "file:///workspace/logs/", name: "logs", mimeType: "inode/directory" },
    { uri: "file:///workspace/logs/app.log", name: "app.log", mimeType: "text/plain", size: 31 },
    { uri: "file:///workspace/src/main.ts", name: "main.ts", mimeType: "text/typescript", size: 42 },
  ]

  it("resolves MCP directories with VS Code IFileService-style children", async () => {
    const service = createMcpResourceFileService(resources)

    const stat = await service.resolve(URI.parse("file:///workspace/logs/"), { resolveMetadata: false })

    expect(stat).toMatchObject({
      name: "logs",
      isDirectory: true,
      isFile: false,
    })
    expect(stat.children?.map((child) => [child.name, child.isFile, child.isDirectory])).toEqual([["app.log", true, false]])
    expect(isMcpResourceDirectoryStat(stat)).toBe(true)
  })

  it("synthesizes parent directories from nested MCP resource URIs", async () => {
    const service = createMcpResourceFileService([
      { uri: "file:///workspace/src/components/App.vue", name: "App.vue", mimeType: "text/vue" },
    ])

    const stat = await service.resolve("file:///workspace/src/")

    expect(stat.isDirectory).toBe(true)
    expect(stat.children?.map((child) => [child.name, child.isFile, child.isDirectory])).toEqual([["components", false, true]])
  })

  it("checks existence using the MCP resource stat index", async () => {
    const service = createMcpResourceFileService(resources)

    await expect(service.exists("file:///workspace/README.md")).resolves.toBe(true)
    await expect(service.exists("file:///workspace/missing.md")).resolves.toBe(false)
  })

  it("resolves MCP resources through a provider-backed FileService facade", async () => {
    const service = createMcpResourceProviderBackedFileService(resources)

    const directory = await service.resolve("file:///workspace/logs/")
    const file = await service.stat("file:///workspace/logs/app.log")

    expect(directory.isDirectory).toBe(true)
    expect(directory.children?.map((child) => [child.name, child.isFile, child.isDirectory])).toEqual([
      ["app.log", true, false],
    ])
    expect(file).toMatchObject({
      name: "app.log",
      isFile: true,
      isDirectory: false,
      size: 31,
    })
    await expect(service.exists("file:///workspace/src/main.ts")).resolves.toBe(true)
    await expect(service.exists("file:///workspace/missing.ts")).resolves.toBe(false)
  })

  it("rejects resolve for missing MCP resources like VS Code FileService", async () => {
    const service = createMcpResourceFileService(resources)

    await expect(service.resolve("file:///workspace/missing.md")).rejects.toThrow(/not found/i)
  })

  it("registers MCP resources as a VS Code-style filesystem provider", async () => {
    const fileService = new FileService()
    const events: Array<[boolean, string]> = []
    fileService.onDidChangeFileSystemProviderRegistrations((event) => events.push([event.added, event.scheme]))

    const disposable = registerMcpResourceFileSystemProvider(resources, { fileService })

    const provider = fileService.getProvider("file")
    expect(provider?.capabilities).toBe(FileSystemProviderCapabilities.Readonly)
    expect(events).toEqual([[true, "file"]])

    const stat = await fileService.resolve(URI.parse("file:///workspace/logs/"))
    expect(stat.isDirectory).toBe(true)
    expect(stat.children?.map((child) => [child.name, child.isFile, child.isDirectory])).toEqual([
      ["app.log", true, false],
    ])
    await expect(fileService.exists(URI.parse("file:///workspace/logs/app.log"))).resolves.toBe(true)
    await expect(fileService.exists(URI.parse("file:///workspace/missing.log"))).resolves.toBe(false)

    disposable.dispose()

    expect(fileService.getProvider("file")).toBeUndefined()
    expect(events).toEqual([[true, "file"], [false, "file"]])
  })

  it("reads text and blob contents through the MCP filesystem provider", async () => {
    const provider = createMcpResourceFileSystemProvider([
      { uri: "file:///workspace/readme.md", name: "readme.md", mimeType: "text/markdown", text: "# README" },
      { uri: "file:///workspace/blob.txt", name: "blob.txt", mimeType: "text/plain", blob: btoa("blob body") },
      {
        uri: "file:///workspace/multi.txt",
        name: "multi.txt",
        mimeType: "text/plain",
        contents: [{ text: "first" }, { blob: btoa("second") }],
      },
    ])

    await expect(provider.readFile?.(URI.parse("file:///workspace/readme.md"))).resolves.toEqual(new TextEncoder().encode("# README"))
    await expect(provider.readFile?.(URI.parse("file:///workspace/blob.txt"))).resolves.toEqual(new TextEncoder().encode("blob body"))
    await expect(provider.readFile?.(URI.parse("file:///workspace/multi.txt"))).resolves.toEqual(new TextEncoder().encode("first\nsecond"))
  })

  it("reads uncached MCP resource contents through an injected resources/read adapter with a momentary cache", async () => {
    const readResource = vi.fn().mockResolvedValue({
      contents: [{ uri: "file:///workspace/remote.txt", text: "remote body" }],
    })
    const provider = createMcpResourceFileSystemProvider([
      { uri: "file:///workspace/remote.txt", name: "remote.txt", mimeType: "text/plain" },
    ], { readResource, cacheDurationMs: 1000 })
    const resource = URI.parse("file:///workspace/remote.txt")

    await expect(provider.readFile?.(resource)).resolves.toEqual(new TextEncoder().encode("remote body"))
    await expect(provider.readFile?.(resource)).resolves.toEqual(new TextEncoder().encode("remote body"))

    expect(readResource).toHaveBeenCalledTimes(1)
    expect(readResource).toHaveBeenCalledWith("file:///workspace/remote.txt")
  })

  it("preserves encoded template URI strings when reading provider-backed MCP resources", async () => {
    const readResource = vi.fn().mockResolvedValue({
      contents: [{ uri: "file:///workspace/src%2Fmain.ts", text: "encoded body" }],
    })
    const service = createMcpResourceProviderBackedFileService([], { scheme: "file", readResource })

    await expect(service.readFile("file:///workspace/src%2Fmain.ts", { allowMissingReadMetadata: true }).then((data) => new TextDecoder().decode(data))).resolves.toBe("encoded body")

    expect(readResource).toHaveBeenCalledWith("file:///workspace/src%2Fmain.ts")
  })

  it("keeps dynamic MCP reads from widening static stat and exists verification", async () => {
    const readResource = vi.fn().mockResolvedValue({
      contents: [{ uri: "file:///workspace/dynamic.txt", text: "dynamic body" }],
    })
    const dynamicService = createMcpResourceProviderBackedFileService([], { scheme: "file", readResource })
    const staticService = createMcpResourceProviderBackedFileService([], { scheme: "file" })

    await expect(dynamicService.exists("file:///workspace/dynamic.txt")).resolves.toBe(false)
    await expect(dynamicService.stat("file:///workspace/dynamic.txt")).rejects.toThrow(/not found/i)
    await expect(dynamicService.readFile("file:///workspace/dynamic.txt", { allowMissingReadMetadata: true }).then((data) => new TextDecoder().decode(data))).resolves.toBe("dynamic body")
    await expect(staticService.stat("file:///workspace/dynamic.txt")).rejects.toThrow(/not found/i)
  })

  it("allows provider-backed reads for directory URIs only when explicitly requested", async () => {
    const readResource = vi.fn().mockResolvedValue({
      contents: [{ uri: "file:///workspace/", text: "workspace root" }],
    })
    const service = createMcpResourceProviderBackedFileService([
      { uri: "file:///workspace/", name: "workspace", mimeType: "inode/directory" },
    ], { scheme: "file", readResource })

    await expect(service.readFile("file:///workspace/")).rejects.toMatchObject({
      fileOperationResult: expect.any(Number),
    })
    await expect(service.readFile("file:///workspace/", { allowDirectoryRead: true }).then((data) => new TextDecoder().decode(data))).resolves.toBe("workspace root")
  })

  it("streams MCP resource reads with VS Code-style position and length options", async () => {
    const provider = createMcpResourceFileSystemProvider([
      { uri: "file:///workspace/readme.md", name: "readme.md", mimeType: "text/markdown", text: "# README" },
    ])
    const stream = provider.readFileStream?.(URI.parse("file:///workspace/readme.md"), { position: 2, length: 4 })
    const chunks: Uint8Array[] = []
    let ended = false
    let error: unknown

    stream?.onData((chunk) => chunks.push(chunk))
    stream?.onEnd(() => { ended = true })
    stream?.onError((err) => { error = err })
    await vi.waitFor(() => expect(ended).toBe(true))

    expect(error).toBeUndefined()
    expect(new TextDecoder().decode(concatBytes(chunks))).toBe("READ")
  })

  it("rejects directory reads and write operations with VS Code-style provider errors", async () => {
    const provider = createMcpResourceFileSystemProvider(resources)

    await expect(provider.readFile?.(URI.parse("file:///workspace/logs/"))).rejects.toMatchObject({
      code: FileSystemProviderErrorCode.FileIsADirectory,
    })
    await expect(provider.writeFile?.(URI.parse("file:///workspace/README.md"), new Uint8Array(), {})).rejects.toMatchObject({
      code: FileSystemProviderErrorCode.NoPermissions,
    })
    await expect(provider.delete?.(URI.parse("file:///workspace/README.md"), {})).rejects.toMatchObject({
      code: FileSystemProviderErrorCode.NoPermissions,
    })
    await expect(provider.rename?.(URI.parse("file:///workspace/README.md"), URI.parse("file:///workspace/README2.md"), {})).rejects.toMatchObject({
      code: FileSystemProviderErrorCode.NoPermissions,
    })
  })

  it("watches MCP resource updates through an injected resources/subscribe adapter", async () => {
    let update: (() => void) | undefined
    const dispose = vi.fn()
    const subscribeResource = vi.fn((uri: string, listener: () => void) => {
      update = listener
      return {
        dispose,
        uri,
      }
    })
    const provider = createMcpResourceFileSystemProvider(resources, { subscribeResource })
    const events: unknown[] = []
    provider.onDidChangeFile((event) => events.push(...event))
    const resource = URI.parse("file:///workspace/README.md")

    const disposable = provider.watch?.(resource, {})
    await vi.waitFor(() => expect(subscribeResource).toHaveBeenCalledWith("file:///workspace/README.md", expect.any(Function)))
    update?.()

    expect(events).toEqual([{ type: FileChangeType.UPDATED, resource }])
    disposable?.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
    update?.()
    expect(events).toEqual([{ type: FileChangeType.UPDATED, resource }])
  })

  it("drops stale MCP resource watch events when disposed before async subscribe resolves", async () => {
    let update: (() => void) | undefined
    let resolveSubscribe: ((value: { dispose: () => void }) => void) | undefined
    const dispose = vi.fn()
    const subscribeResource = vi.fn((_uri: string, listener: () => void) => {
      update = listener
      return new Promise<{ dispose: () => void }>((resolve) => {
        resolveSubscribe = resolve
      })
    })
    const provider = createMcpResourceFileSystemProvider(resources, { subscribeResource })
    const events: unknown[] = []
    provider.onDidChangeFile((event) => events.push(...event))
    const resource = URI.parse("file:///workspace/README.md")

    const disposable = provider.watch?.(resource, {})
    disposable?.dispose()
    resolveSubscribe?.({ dispose })
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1))
    update?.()

    expect(events).toEqual([])
  })
})

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}
