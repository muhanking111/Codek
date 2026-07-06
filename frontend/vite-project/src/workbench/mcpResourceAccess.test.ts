import { beforeEach, describe, expect, it } from "vitest"
import {
  attachMcpResourceToChat,
  clearMcpResourceAccessState,
  consumePendingMcpChatAttachments,
  createMcpVirtualResource,
  createMcpVirtualResourceFromFileService,
  getMcpResourceAccessEvidenceSummary,
  mcpReadResultToText,
  mcpResourceAccessState,
  mcpResourceVirtualPath,
  openMcpResource,
  openMcpResourceFromFileService,
} from "./mcpResourceAccess"
import { URI } from "../vscode-adapter/base/common/uri"
import { FileType, type IFileStat } from "../vscode-adapter/platform/files/common/files"

describe("mcpResourceAccess", () => {
  beforeEach(() => clearMcpResourceAccessState())

  it("normalizes MCP read-resource text content into a virtual editor resource", () => {
    const resource = openMcpResource("fs", "file:///workspace/readme.md", {
      contents: [{ uri: "file:///workspace/readme.md", mimeType: "text/markdown", text: "# README" }],
    }, 123)

    expect(resource).toEqual({
      id: "mcp-resource:fs:file:///workspace/readme.md",
      serverName: "fs",
      uri: "file:///workspace/readme.md",
      path: expect.stringMatching(/^\/MCP Resources\/fs\/[a-z0-9]+-readme\.md$/),
      name: "readme.md",
      mimeType: "text/markdown",
      content: "# README",
      openedAt: 123,
    })
    expect(mcpResourceAccessState.openedResources[0]).toEqual(resource)
  })

  it("converts opened MCP resources into chat text attachments without rereading files", () => {
    const resource = openMcpResource("fs", "file:///workspace/readme.md", {
      contents: [{ uri: "file:///workspace/readme.md", text: "# README" }],
    }, 123)

    const attachment = attachMcpResourceToChat(resource)

    expect(attachment).toMatchObject({
      id: "mcp-attachment:fs:file:///workspace/readme.md",
      name: "readme.md",
      kind: "text",
      status: "ready",
      content: "# README",
    })
    expect(mcpResourceAccessState.chatAttachments[0]).toEqual(attachment)
  })

  it("can create chat attachments without marking the resource as opened", () => {
    const resource = createMcpVirtualResource("fs", "file:///workspace/readme.md", {
      contents: [{ uri: "file:///workspace/readme.md", text: "# README" }],
    }, 123)

    attachMcpResourceToChat(resource)

    expect(mcpResourceAccessState.openedResources).toEqual([])
    expect(mcpResourceAccessState.chatAttachments[0]).toMatchObject({
      id: "mcp-attachment:fs:file:///workspace/readme.md",
      content: "# README",
    })
  })

  it("creates virtual resources from VS Code FileService reads", async () => {
    const fileService = createReadableFileService("provider body")

    const resource = await createMcpVirtualResourceFromFileService("fs", "file:///workspace/readme.md", fileService, {
      title: "README",
      mimeType: "text/markdown",
    }, 123)

    expect(resource).toMatchObject({
      serverName: "fs",
      uri: "file:///workspace/readme.md",
      name: "README",
      mimeType: "text/markdown",
      content: "provider body",
      openedAt: 123,
    })
  })

  it("opens provider-read MCP resources before attaching them to chat", async () => {
    const fileService = createReadableFileService("provider body")

    const resource = await openMcpResourceFromFileService("fs", "file:///workspace/readme.md", fileService, {
      name: "readme.md",
    }, 123)
    attachMcpResourceToChat(resource)

    expect(mcpResourceAccessState.openedResources[0].content).toBe("provider body")
    expect(mcpResourceAccessState.chatAttachments[0]).toMatchObject({
      content: "provider body",
      preview: "provider body",
    })
  })

  it("summarizes MCP open and attach evidence without exposing resource contents", async () => {
    const resource = openMcpResource("fs", "file:///workspace/readme.md", {
      contents: [{ uri: "file:///workspace/readme.md", mimeType: "text/markdown", text: "# README" }],
    }, 123)
    attachMcpResourceToChat(resource)

    expect(getMcpResourceAccessEvidenceSummary()).toEqual({
      source: "mcpResourceAccess",
      openedCount: 1,
      attachmentCount: 1,
      readonlyProviderPath: true,
      latestOpened: {
        id: "mcp-resource:fs:file:///workspace/readme.md",
        serverName: "fs",
        uri: "file:///workspace/readme.md",
        name: "readme.md",
        mimeType: "text/markdown",
        size: 8,
        openedAt: 123,
      },
      latestAttachment: {
        id: "mcp-attachment:fs:file:///workspace/readme.md",
        name: "readme.md",
        type: "text/markdown",
        size: 8,
        status: "ready",
      },
    })
  })

  it("falls back to URI objects for VS Code-style FileService reads", async () => {
    const fileService = createUriOnlyReadableFileService("provider body")

    const resource = await createMcpVirtualResourceFromFileService("fs", "file:///workspace/readme.md", fileService)

    expect(resource.content).toBe("provider body")
    expect(resource.name).toBe("readme.md")
  })

  it("consumes pending chat attachments after the app syncs them into ChatPanel", () => {
    const resource = openMcpResource("fs", "file:///workspace/readme.md", {
      contents: [{ uri: "file:///workspace/readme.md", text: "# README" }],
    }, 123)

    attachMcpResourceToChat(resource)

    expect(consumePendingMcpChatAttachments()).toHaveLength(1)
    expect(mcpResourceAccessState.chatAttachments).toEqual([])
  })

  it("builds stable safe virtual paths for MCP editor resources", () => {
    const first = mcpResourceVirtualPath("profile/server", "file:///workspace/src/app.ts?version=1")
    const second = mcpResourceVirtualPath("profile/server", "file:///workspace/src/app.ts?version=1")

    expect(first).toBe(second)
    expect(first).toMatch(/^\/MCP Resources\/profile_server\/[a-z0-9]+-app\.ts$/)
  })

  it("joins multiple MCP content entries and decodes base64 blobs when possible", () => {
    expect(mcpReadResultToText({
      contents: [
        { text: "first" },
        { blob: btoa("second") },
      ],
    })).toBe("first\nsecond")
  })
})

function createReadableFileService(content: string) {
  const stat: IFileStat = {
    resource: URI.parse("file:///workspace/readme.md"),
    name: "readme.md",
    type: FileType.File,
    isFile: true,
    isDirectory: false,
    isSymbolicLink: false,
    size: content.length,
    mtime: 0,
    ctime: 0,
    children: undefined,
  }
  return {
    async stat() {
      return stat
    },
    async readFile() {
      return new TextEncoder().encode(content)
    },
  }
}

function createUriOnlyReadableFileService(content: string) {
  const base = createReadableFileService(content)
  return {
    async stat(resource: URI | string) {
      if (!URI.isUri(resource)) throw new Error("URI object required")
      return base.stat()
    },
    async readFile(resource: URI | string) {
      if (!URI.isUri(resource)) throw new Error("URI object required")
      return base.readFile()
    },
  }
}
