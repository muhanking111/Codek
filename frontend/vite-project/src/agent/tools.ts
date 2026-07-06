import {
  findInProject,
  normalizeRelativePath,
  readLines,
  readProjectFile,
  saveFile,
  deleteFile as deleteProjectFile,
  workspace,
} from "../workspace/manager"
import { recordChange } from "../workspace/changeHistory"
import { queuePendingBatch } from "../workspace/changeQueue"
import { executeSandbox } from "../sandbox/sandboxClient"
import {
  callMcpTool,
  ensureMcpServerConnected,
  listConfiguredMcpServers,
  listMcpTools,
} from "../ai/mcp.js"

export type OperationRisk = "safe" | "medium" | "high"
export type AgentMode = "ask" | "plan" | "agent" | "auto"

export interface ToolParam {
  type: string
  description: string
  required?: boolean
}

export interface ToolResult {
  [key: string]: unknown
  error?: string
}

export interface ToolContext {
  projectRoot: string
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  runCommand: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number; error?: string }>
  searchCode: (query: string) => Promise<Array<{ file: string; line: number; content: string }>>
  executeSandbox: typeof executeSandbox
}

export interface ToolDefinition {
  name: string
  description: string
  risk: OperationRisk
  parameters: Record<string, ToolParam>
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>
}

const codekApi = () => (typeof window !== "undefined" ? window.codek || null : null)

function ensureProject(projectRoot: string | undefined): void {
  if (!projectRoot) throw new Error("Open a project before using tools.")
}

function ensurePath(pathValue: unknown): string {
  if (typeof pathValue !== "string" || pathValue.trim() === "") {
    throw new Error("Path must be a non-empty string.")
  }
  const relativePath = normalizeRelativePath(pathValue)
  if (!relativePath) throw new Error("Path must resolve inside the selected project.")
  return relativePath
}

async function readTextFile(pathValue: string, projectRoot: string): Promise<{ relativePath: string; content: string }> {
  ensureProject(projectRoot)
  const relativePath = ensurePath(pathValue)
  const content = await readProjectFile(relativePath)
  if (content === null) throw new Error(`File not found or not readable: ${relativePath}`)
  return { relativePath, content }
}

async function writeTextFile(pathValue: string, content: string, _projectRoot: string): Promise<ToolResult> {
  if (typeof content !== "string") throw new Error("Content must be a string.")
  const relativePath = ensurePath(pathValue)
  const beforeContent = await readProjectFile(relativePath)
  const success = await saveFile(relativePath, content, { recordOperation: false })
  recordChange({
    path: relativePath,
    beforeContent,
    afterContent: content,
    source: "agent",
    action: "write",
  })
  return { success: true, path: relativePath }
}

const TOOL_REGISTRY = new Map<string, ToolDefinition>()

function register(def: ToolDefinition): void {
  TOOL_REGISTRY.set(def.name, def)
}

// SSRF defense for the agent's network_request tool. Runs in renderer, so we
// cannot DNS-resolve before fetch — block obvious literal addresses and require
// http(s). Cloud metadata (169.254.169.254), loopback, link-local, private and
// reserved ranges are denied. Returns an error message string or null when ok.
function denyIfInternalUrl(rawUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return "network_request: invalid URL"
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `network_request: scheme ${parsed.protocol} not allowed (only http/https)`
  }
  if (parsed.username || parsed.password) {
    return "network_request: credentials in URL not allowed"
  }
  const host = parsed.hostname.toLowerCase()
  if (host === "" || host === "localhost" || host.endsWith(".localhost")) {
    return "network_request: localhost denied"
  }
  if (host === "metadata.google.internal" || host === "instance-data") {
    return "network_request: cloud metadata host denied"
  }
  // IPv6 literal
  if (host.startsWith("[") && host.endsWith("]")) {
    const v6 = host.slice(1, -1)
    if (v6 === "::1" || v6 === "::" || v6.startsWith("fe80:") ||
        v6.startsWith("fc") || v6.startsWith("fd")) {
      return "network_request: ipv6 internal address denied"
    }
  }
  // IPv4 literal
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [parseInt(v4[1], 10), parseInt(v4[2], 10)]
    if (a === 0 || a === 127 || a === 10 || a >= 224) {
      return "network_request: ipv4 internal address denied"
    }
    if (a === 169 && b === 254) return "network_request: link-local/metadata denied"
    if (a === 172 && b >= 16 && b <= 31) return "network_request: private ipv4 denied"
    if (a === 192 && b === 168) return "network_request: private ipv4 denied"
    if (a === 100 && b >= 64 && b <= 127) return "network_request: CGNAT denied"
  }
  return null
}

register({
  name: "read_file",
  description: "Read a text file inside the selected project.",
  risk: "safe",
  parameters: {
    path: { type: "string", description: "Path relative to the project root.", required: true },
  },
  async execute(args, context) {
    try {
      const { relativePath, content } = await readTextFile(args.path as string, context.projectRoot)
      return { path: relativePath, content }
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
})

register({
  name: "write_file",
  description: "Overwrite a text file inside the selected project.",
  risk: "medium",
  parameters: {
    path: { type: "string", description: "Path relative to the project root.", required: true },
    content: { type: "string", description: "New file content.", required: true },
  },
  async execute(args, context) {
    try {
      return await writeTextFile(args.path as string, args.content as string, context.projectRoot)
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
})

register({
  name: "edit_file",
  description: "Replace one exact text fragment in a file.",
  risk: "medium",
  parameters: {
    path: { type: "string", description: "Path relative to the project root.", required: true },
    old_string: { type: "string", description: "Exact text to replace.", required: true },
    new_string: { type: "string", description: "Replacement text.", required: true },
  },
  async execute(args, context) {
    const oldStr = args.old_string as string
    const newStr = args.new_string as string
    if (typeof oldStr !== "string" || typeof newStr !== "string") {
      return { error: "old_string and new_string must be strings." }
    }
    try {
      const { relativePath, content } = await readTextFile(args.path as string, context.projectRoot)
      if (!content.includes(oldStr)) {
        return { error: `Could not find the exact text to replace in ${relativePath}.` }
      }
      const updated = content.replace(oldStr, newStr)
      return await writeTextFile(relativePath, updated, context.projectRoot)
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
})

register({
  name: "patch_file",
  description: "Queue multiple exact replacements to a file for user approval.",
  risk: "medium",
  parameters: {
    path: { type: "string", description: "Path relative to the project root.", required: true },
    patches: { type: "array", description: "Array of { old_string, new_string } replacements.", required: true },
  },
  async execute(args, context) {
    const patches = args.patches as Array<{ old_string: string; new_string: string }>
    if (!Array.isArray(patches) || patches.length === 0) {
      return { error: "patches must be a non-empty array." }
    }
    try {
      const { relativePath, content } = await readTextFile(args.path as string, context.projectRoot)
      let updated = content
      for (const [index, patch] of patches.entries()) {
        if (typeof patch?.old_string !== "string" || typeof patch?.new_string !== "string") {
          return { error: `Invalid patch at index ${index}.` }
        }
        if (!updated.includes(patch.old_string)) {
          return { error: `Patch ${index} could not find its target in ${relativePath}.` }
        }
        updated = updated.replace(patch.old_string, patch.new_string)
      }
      const batch = queuePendingBatch({
        source: "agent",
        action: "patch",
        summary: `${relativePath} (${patches.length} patch${patches.length === 1 ? "" : "es"})`,
        changes: [{ path: relativePath, beforeContent: content, afterContent: updated, action: "patch" }],
      })
      if (!batch) return { error: `Failed to queue pending patch for ${relativePath}.` }
      return {
        queued: true,
        batchId: batch.id,
        path: relativePath,
        applied: patches.length,
        message: "Patch queued for approval.",
      }
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
})

register({
  name: "delete_file",
  description: "Delete a file (HIGH-RISK).",
  risk: "high",
  parameters: {
    path: { type: "string", description: "File path to delete.", required: true },
  },
  async execute(args, context) {
    try {
      ensureProject(context.projectRoot)
      const relativePath = ensurePath(args.path)
      const beforeContent = await readProjectFile(relativePath)
      await deleteProjectFile(relativePath, { recordOperation: false })
      recordChange({
        path: relativePath,
        beforeContent,
        afterContent: null,
        source: "agent",
        action: "delete",
      })
      return { success: true, deleted: relativePath }
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
})

register({
  name: "read_dir",
  description: "List entries in a directory inside the selected project.",
  risk: "safe",
  parameters: {
    path: { type: "string", description: "Path relative to the project root.", required: false },
  },
  async execute(args, context) {
    const fsApi = codekApi()
    if (!fsApi) return { error: "File system is unavailable." }
    try {
      ensureProject(context.projectRoot)
      const pathValue = (args.path as string) || "."
      const relativePath = pathValue === "." ? "" : ensurePath(pathValue)
      const fullPath = relativePath ? `${workspace.projectRoot}/${relativePath}` : workspace.projectRoot
      const entries = await fsApi.listDir!(fullPath)
      return {
        path: relativePath || ".",
        entries: entries.map((entry: { name: string; isDirectory: boolean }) => ({
          name: entry.name,
          isDir: entry.isDirectory,
        })),
      }
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
})

register({
  name: "search_code",
  description: "Search project files. mode=keyword (default text), semantic (vector+rerank), auto (semantic if available, else keyword).",
  risk: "safe",
  parameters: {
    query: { type: "string", description: "Search query.", required: true },
    mode: { type: "string", description: "keyword | semantic | auto. Default keyword.", required: false },
    max_results: { type: "number", description: "Default 30 for keyword, 8 for semantic.", required: false },
  },
  async execute(args, context) {
    try {
      ensureProject(context.projectRoot)
      const query = args.query as string
      if (typeof query !== "string" || query.trim() === "") {
        return { error: "Query must be a non-empty string." }
      }
      const mode = ((args.mode as string) || "keyword").toLowerCase()
      if (mode === "semantic" || mode === "auto") {
        try {
          const { retrieveRelevantFiles } = await import("../ai/retriever.js")
          const max = (args.max_results as number) || 8
          const semantic = await retrieveRelevantFiles(query, {
            projectRoot: context.projectRoot,
            maxResults: max,
            rerank: true,
          })
          if (semantic && semantic.length > 0) {
            return {
              mode: "semantic",
              count: semantic.length,
              results: semantic.map((r: { path: string; score: number; snippet: string; symbols?: string[]; signals?: unknown }) => ({
                path: r.path,
                score: r.score,
                snippet: r.snippet,
                symbols: r.symbols || [],
                signals: r.signals,
              })),
            }
          }
          if (mode === "semantic") {
            return { mode: "semantic", count: 0, results: [] }
          }
        } catch (err) {
          if (mode === "semantic") {
            return { error: `Semantic search failed: ${err instanceof Error ? err.message : String(err)}` }
          }
        }
      }
      const max = (args.max_results as number) || 30
      const results = await findInProject(query, { maxResults: max })
      return { mode: "keyword", results, count: results.length }
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
})

register({
  name: "get_code_context",
  description: "Read a line range from a file inside the selected project.",
  risk: "safe",
  parameters: {
    path: { type: "string", description: "Path relative to the project root.", required: true },
    start_line: { type: "number", description: "Starting line number.", required: true },
    end_line: { type: "number", description: "Ending line number.", required: true },
  },
  async execute(args, context) {
    try {
      ensureProject(context.projectRoot)
      const relativePath = ensurePath(args.path)
      const lines = await readLines(relativePath, args.start_line as number, args.end_line as number)
      if (!lines) return { error: `File not found: ${relativePath}` }
      return { path: relativePath, ...lines }
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
})

register({
  name: "run_command",
  description: "Execute shell command (HIGH-RISK).",
  risk: "high",
  parameters: {
    command: { type: "string", description: "Shell command to execute.", required: true },
  },
  async execute(args, context) {
    const command = args.command as string
    if (typeof command !== "string" || command.trim() === "") {
      return { error: "Command must be a non-empty string." }
    }
    try {
      const result = await context.runCommand(command)
      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      }
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
})

register({
  name: "execute_code",
  description: "Run code in isolated sandbox.",
  risk: "safe",
  parameters: {
    language: { type: "string", description: "Programming language (js, python, java, ts).", required: true },
    code: { type: "string", description: "Code to execute.", required: true },
    timeout: { type: "number", description: "Timeout in milliseconds (default: 30000)." },
  },
  async execute(args) {
    try {
      const result = await executeSandbox({
        language: args.language as string,
        code: args.code as string,
        timeoutMs: (args.timeout as number) || 30000,
      })
      return {
        success: result.success,
        output: result.output,
        error: result.error,
        exitCode: result.exitCode,
        executionTimeMs: result.executionTimeMs,
      }
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
})

register({
  name: "run_tests",
  description: "Execute test suite.",
  risk: "safe",
  parameters: {
    testFile: { type: "string", description: "Test file path." },
    framework: { type: "string", description: "Test framework (jest, mocha, pytest, junit)." },
  },
  async execute(args, context) {
    const framework = (args.framework as string) || "jest"
    const testFile = (args.testFile as string) || ""
    const command =
      framework === "jest" ? `npx jest ${testFile}`.trim()
      : framework === "pytest" ? `pytest ${testFile}`.trim()
      : framework === "junit" ? `mvn test ${testFile ? `-Dtest=${testFile}` : ""}`.trim()
      : "npm test"
    try {
      const result = await context.runCommand(command)
      return {
        success: result.exitCode === 0,
        output: result.stdout,
        error: result.stderr,
        exitCode: result.exitCode,
      }
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
})

register({
  name: "git_commit",
  description: "Commit changes to git.",
  risk: "medium",
  parameters: {
    message: { type: "string", description: "Commit message.", required: true },
    files: { type: "array", description: "Files to stage (empty = all changes)." },
  },
  async execute(args, context) {
    const message = args.message as string
    const files = (args.files as string[]) || []
    if (typeof message !== "string" || message.length === 0) {
      return { error: "Commit message must be a non-empty string." }
    }
    // Reject shell metacharacters in the message — splitCommandLine on the host side
    // would block them anyway, but a clearer error here saves a round-trip.
    if (/[;&|`$<>\n\r\\]/.test(message)) {
      return { error: "Commit message contains forbidden characters." }
    }
    const unsafe = files.find((f) => typeof f !== "string" || /[;&|`$<>\n\r"'\\]/.test(f))
    if (unsafe !== undefined) {
      return { error: `Refusing unsafe file path: ${String(unsafe)}` }
    }
    try {
      if (files.length > 0) {
        await context.runCommand(`git add ${files.join(" ")}`)
      } else {
        await context.runCommand("git add -A")
      }
      // Double-quote the message; embedded single quotes are fine inside double quotes,
      // and our splitter strips the surrounding " without invoking a shell.
      const quoted = `"${message.replace(/"/g, "")}"`
      const result = await context.runCommand(`git commit -m ${quoted}`)
      return { success: result.exitCode === 0, output: result.stdout, error: result.stderr }
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
})

register({
  name: "network_request",
  description: "Make HTTP request.",
  risk: "medium",
  parameters: {
    url: { type: "string", description: "Request URL.", required: true },
    method: { type: "string", description: "HTTP method (GET, POST, etc.)." },
    body: { type: "object", description: "Request body." },
    headers: { type: "object", description: "Request headers." },
  },
  async execute(args) {
    const url = args.url as string
    const method = (args.method as string) || "GET"
    const body = args.body as Record<string, unknown> | undefined
    const headers = (args.headers as Record<string, string>) || {}
    const denial = denyIfInternalUrl(url)
    if (denial) return { error: denial }
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual",
      })
      const text = await response.text()
      let data: unknown
      try { data = JSON.parse(text) } catch { data = text }
      return { success: response.ok, status: response.status, statusText: response.statusText, data }
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
})

register({
  name: "mcp_list_tools",
  description: "List configured MCP servers and discovered tools from the active VS Code profile.",
  risk: "safe",
  parameters: {
    serverName: { type: "string", description: "Optional MCP server name to connect and inspect." },
  },
  async execute(args) {
    try {
      const serverName = typeof args.serverName === "string" ? args.serverName.trim() : ""
      if (serverName) {
        await ensureMcpServerConnected(serverName)
      }
      const servers = listConfiguredMcpServers()
      const tools = await listMcpTools()
      return {
        servers: servers.map((server) => ({
          serverName: server.serverName,
          initialized: server.initialized,
          profileScoped: server.profileScoped,
          transport: server.config?.transport || server.config?.type || "",
          command: server.config?.command,
          url: server.config?.serverUrl || server.config?.url,
        })),
        tools,
      }
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
})

register({
  name: "mcp_call_tool",
  description: "Call a tool exposed by an MCP server from the active VS Code profile.",
  risk: "high",
  parameters: {
    serverName: { type: "string", description: "MCP server name.", required: true },
    toolName: { type: "string", description: "MCP tool name.", required: true },
    arguments: { type: "object", description: "Tool arguments." },
  },
  async execute(args) {
    const serverName = typeof args.serverName === "string" ? args.serverName.trim() : ""
    const toolName = typeof args.toolName === "string" ? args.toolName.trim() : ""
    if (!serverName || !toolName) return { error: "serverName and toolName are required." }
    try {
      const result = await callMcpTool(serverName, toolName, (args.arguments as Record<string, unknown>) || {})
      return { serverName, toolName, result }
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
})

const READ_ONLY_TOOLS = new Set(["read_file", "read_dir", "search_code", "get_code_context", "mcp_list_tools"])

export function getTool(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.get(name)
}

export function getAllTools(): ToolDefinition[] {
  return Array.from(TOOL_REGISTRY.values())
}

export function getToolsForMode(mode: AgentMode): ToolDefinition[] {
  if (mode === "plan" || mode === "ask") {
    return getAllTools().filter((t) => READ_ONLY_TOOLS.has(t.name))
  }
  return getAllTools()
}

export function getToolNames(): string[] {
  return Array.from(TOOL_REGISTRY.keys())
}

export function buildToolContext(projectRoot: string): ToolContext {
  const fsApi = codekApi()
  return {
    projectRoot,
    readFile: async (path: string) => {
      const content = await readProjectFile(path)
      if (content === null) throw new Error(`File not found: ${path}`)
      return content
    },
    writeFile: async (path: string, content: string) => {
      await saveFile(path, content)
    },
    deleteFile: async (path: string) => {
      await deleteProjectFile(path)
    },
    runCommand: async (command: string) => {
      if (!fsApi) throw new Error("Command runner is unavailable.")
      const api = codekApi() as unknown as { agent?: { shellRun?: (c: string) => Promise<{ stdout?: string; stderr?: string; exitCode?: number; error?: string }> } } | null
      const runner = api?.agent?.shellRun
        ? (c: string) => api.agent!.shellRun!(c)
        : (c: string) => fsApi.runCommand(c)
      const result = await runner(command)
      return {
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        exitCode: result.exitCode ?? 1,
        error: result.error,
      }
    },
    searchCode: async (query: string) => {
      const results = await findInProject(query, { maxResults: 30 })
      return results.map((r: { path?: string; file?: string; line?: number; content?: string; snippet?: string }) => ({
        file: r.path || r.file || "",
        line: r.line || 0,
        content: r.content || r.snippet || "",
      }))
    },
    executeSandbox,
  }
}
