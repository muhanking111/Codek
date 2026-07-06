/*---------------------------------------------------------------------------------------------
 *  Agent tool implementations.
 *
 *  Each tool exposes:
 *    { name, description, inputSchema, autoAuthorize, makePreview, execute }
 *
 *  - inputSchema: JSON Schema (passed straight to the LLM as the tool's parameter spec).
 *  - autoAuthorize: when true, executes without renderer prompt (read-only ops).
 *  - makePreview(input): short human-readable string shown on the auth dialog.
 *  - execute(input, ctx) → { content: string, structured?: any, isError?: boolean }
 *
 *  ctx provides `projectRoot` so tools can enforce path containment.
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs")
const path = require("path")
const { resolveInsideRoot } = require("../agentPolicy")
const { runShellInSandbox } = require("../sandbox")
const {
  applyActiveProfileFromProject,
  callMcpTool,
  clearExtensionMcpServers,
  clearProfileMcpServers,
  clearWorkspaceMcpServers,
  listConfiguredMcpServers,
  listMcpTools,
} = require("../mcp/profileMcpAdapter")
const {
  allowedMcpServersService,
  getMcpAccessDeniedMessage,
  getMcpAccessValue,
} = require("../mcp/mcpAccess")

const MAX_FILE_BYTES = 1024 * 1024 // 1 MiB
const MAX_LIST_ENTRIES = 2000
const MAX_GREP_MATCHES = 500
const SHELL_TIMEOUT_MS = 60_000

// Path containment is owned by agentPolicy now; this thin alias keeps the
// internal name stable for the tool implementations below.
const resolveSafe = resolveInsideRoot

async function clearMcpServersForDisabledAccess() {
  await clearProfileMcpServers()
  await clearWorkspaceMcpServers()
  await clearExtensionMcpServers()
}

async function clearMcpServersOutsideRegistryAccess(mcpAccess) {
  if (mcpAccess !== "all") {
    await clearExtensionMcpServers()
  }
}

function buildMcpInputRequiredResult(error, { serverName, toolName, activeProfileId } = {}) {
  const missingInputs = Array.isArray(error?.missingInputs) ? error.missingInputs.map((entry) => ({ ...entry })) : []
  return {
    content: `MCP input required: ${missingInputs.map((entry) => entry.id).filter(Boolean).join(", ")}`,
    isError: true,
    structured: {
      code: "MCP_INPUT_REQUIRED",
      serverName: serverName || null,
      toolName: toolName || null,
      profileId: activeProfileId || null,
      activeProfileId: activeProfileId || null,
      missingInputs,
    },
  }
}

function mcpResourceOptionsFromContext(ctx = {}, mcpAccess) {
  return {
    mcpAccess,
    workspaceFile: ctx.workspaceFile,
    workspaceResource: ctx.workspaceResource,
    mcpResourcePath: ctx.mcpResourcePath,
    resourcePath: ctx.resourcePath,
  }
}

function truncate(s, n) {
  if (typeof s !== "string") return s
  return s.length > n ? `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]` : s
}

// ─────────────────────────────────────────────────────────────────────────────
// Glob (minimal — `**` and `*`, no braces)
// ─────────────────────────────────────────────────────────────────────────────

function globToRegex(pattern) {
  let re = "^"
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*"
        i++
        if (pattern[i + 1] === "/") i++
      } else {
        re += "[^/]*"
      }
    } else if (c === "?") {
      re += "[^/]"
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += `\\${c}`
    } else {
      re += c
    }
  }
  re += "$"
  return new RegExp(re)
}

function walk(dir, projectRoot, out, limit, skip = new Set(["node_modules", ".git", "dist", "build", "target"])) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (out.length >= limit) return
    if (skip.has(ent.name)) continue
    const full = path.join(dir, ent.name)
    const rel = path.relative(projectRoot, full).replace(/\\/g, "/")
    out.push({ name: ent.name, full, rel, isDir: ent.isDirectory() })
    if (ent.isDirectory()) {
      walk(full, projectRoot, out, limit, skip)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────────

const tools = [
  {
    name: "read_file",
    description: "Read the full contents of a text file inside the project. Returns up to 1 MiB; longer files are truncated.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the project root (or absolute, but must stay inside it)." },
      },
      required: ["path"],
    },
    flags: { mutates: false, network: false, pathArgs: ["path"] },
    autoAuthorize: true,
    makePreview: (input) => `read ${input?.path || ""}`,
    execute: async (input, ctx) => {
      const abs = resolveSafe(ctx.projectRoot, String(input?.path || ""))
      const stat = await fs.promises.stat(abs)
      if (!stat.isFile()) throw new Error(`not a file: ${input.path}`)
      const buf = await fs.promises.readFile(abs)
      const truncated = buf.length > MAX_FILE_BYTES
      const text = (truncated ? buf.slice(0, MAX_FILE_BYTES) : buf).toString("utf8")
      return {
        content: truncated ? `${text}\n…[truncated ${buf.length - MAX_FILE_BYTES} bytes]` : text,
        structured: { path: input.path, bytes: buf.length, truncated },
      }
    },
  },

  {
    name: "list_dir",
    description: "List the entries in a directory (one level, not recursive). Returns name + type for each entry.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path relative to the project root. Use '.' for the root itself." },
      },
      required: ["path"],
    },
    flags: { mutates: false, network: false, pathArgs: ["path"] },
    autoAuthorize: true,
    makePreview: (input) => `list ${input?.path || "."}`,
    execute: async (input, ctx) => {
      const abs = resolveSafe(ctx.projectRoot, String(input?.path || "."))
      const entries = await fs.promises.readdir(abs, { withFileTypes: true })
      const items = entries.slice(0, MAX_LIST_ENTRIES).map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other",
      }))
      const text = items.map((e) => (e.type === "dir" ? `${e.name}/` : e.name)).join("\n")
      return {
        content: text || "(empty)",
        structured: { path: input.path, entries: items, truncated: entries.length > MAX_LIST_ENTRIES },
      }
    },
  },

  {
    name: "grep",
    description: "Search for a regex pattern across project files. Returns matching lines with file:line:text format.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "JavaScript regular expression." },
        glob: { type: "string", description: "Optional glob to restrict files (e.g. '**/*.ts'). Default: all text files." },
        caseInsensitive: { type: "boolean", description: "If true, match case-insensitively." },
      },
      required: ["pattern"],
    },
    flags: { mutates: false, network: false, pathArgs: [] },
    autoAuthorize: true,
    makePreview: (input) => `grep ${input?.pattern || ""}`,
    execute: async (input, ctx) => {
      const pattern = String(input?.pattern || "")
      if (!pattern) throw new Error("pattern is required")
      const flags = input?.caseInsensitive ? "i" : ""
      let re
      try {
        re = new RegExp(pattern, flags)
      } catch (err) {
        throw new Error(`invalid regex: ${err.message}`)
      }
      const globRe = input?.glob ? globToRegex(input.glob) : null
      const files = []
      walk(ctx.projectRoot, ctx.projectRoot, files, 50_000)
      const matches = []
      for (const f of files) {
        if (f.isDir) continue
        if (globRe && !globRe.test(f.rel)) continue
        let content
        try {
          const buf = await fs.promises.readFile(f.full)
          if (buf.length > MAX_FILE_BYTES) continue
          content = buf.toString("utf8")
        } catch {
          continue
        }
        const lines = content.split("\n")
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            matches.push({ file: f.rel, line: i + 1, text: lines[i].slice(0, 240) })
            if (matches.length >= MAX_GREP_MATCHES) break
          }
        }
        if (matches.length >= MAX_GREP_MATCHES) break
      }
      const text = matches.map((m) => `${m.file}:${m.line}:${m.text}`).join("\n")
      return {
        content: text || "(no matches)",
        structured: { matches, truncated: matches.length >= MAX_GREP_MATCHES },
      }
    },
  },

  {
    name: "glob",
    description: "Find files by glob pattern (relative paths from project root). Supports * and ** wildcards.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern, e.g. 'src/**/*.ts'." },
      },
      required: ["pattern"],
    },
    flags: { mutates: false, network: false, pathArgs: [] },
    autoAuthorize: true,
    makePreview: (input) => `glob ${input?.pattern || ""}`,
    execute: async (input, ctx) => {
      const re = globToRegex(String(input?.pattern || "*"))
      const files = []
      walk(ctx.projectRoot, ctx.projectRoot, files, 50_000)
      const matched = files.filter((f) => !f.isDir && re.test(f.rel)).map((f) => f.rel)
      const text = matched.slice(0, 500).join("\n")
      return {
        content: text || "(no matches)",
        structured: { paths: matched, truncated: matched.length > 500 },
      }
    },
  },

  {
    name: "write_file",
    description: "Create or overwrite a file. REQUIRES USER APPROVAL. Use for new files or full rewrites; prefer edit_file for surgical changes.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to project root." },
        content: { type: "string", description: "Full file content." },
      },
      required: ["path", "content"],
    },
    flags: { mutates: true, network: false, pathArgs: ["path"] },
    autoAuthorize: false,
    makePreview: (input) => `write ${input?.path || ""} (${String(input?.content || "").length} chars)`,
    execute: async (input, ctx) => {
      const abs = resolveSafe(ctx.projectRoot, String(input?.path || ""))
      await fs.promises.mkdir(path.dirname(abs), { recursive: true })
      await fs.promises.writeFile(abs, String(input?.content ?? ""), "utf8")
      return {
        content: `wrote ${input.path} (${String(input.content || "").length} chars)`,
        structured: { path: input.path },
      }
    },
  },

  {
    name: "edit_file",
    description: "Replace one exact string in a file with another. REQUIRES USER APPROVAL. The old_string must match exactly once.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string", description: "Text to find. Must appear exactly once." },
        new_string: { type: "string", description: "Replacement text." },
      },
      required: ["path", "old_string", "new_string"],
    },
    flags: { mutates: true, network: false, pathArgs: ["path"] },
    autoAuthorize: false,
    makePreview: (input) => `edit ${input?.path || ""}`,
    execute: async (input, ctx) => {
      const abs = resolveSafe(ctx.projectRoot, String(input?.path || ""))
      const original = await fs.promises.readFile(abs, "utf8")
      const oldStr = String(input?.old_string || "")
      const newStr = String(input?.new_string || "")
      if (!oldStr) throw new Error("old_string is required")
      const occurrences = original.split(oldStr).length - 1
      if (occurrences === 0) throw new Error("old_string not found in file")
      if (occurrences > 1) throw new Error(`old_string matched ${occurrences} times; must be unique`)
      const updated = original.replace(oldStr, newStr)
      await fs.promises.writeFile(abs, updated, "utf8")
      return {
        content: `replaced 1 occurrence in ${input.path}`,
        structured: { path: input.path, before: oldStr.slice(0, 200), after: newStr.slice(0, 200) },
      }
    },
  },

  {
    name: "run_shell",
    description: "Run a shell command in the project root. REQUIRES USER APPROVAL. 60s timeout, 4 MiB output cap. Executed inside the OS sandbox when one is available for the current platform.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run." },
        cwd: { type: "string", description: "Optional sub-directory of the project root. Default: project root." },
      },
      required: ["command"],
    },
    flags: { mutates: true, network: true, pathArgs: ["cwd"] },
    autoAuthorize: false,
    makePreview: (input) => `run: ${String(input?.command || "").slice(0, 80)}`,
    execute: async (input, ctx) => {
      const command = String(input?.command || "")
      if (!command.trim()) throw new Error("command is required")
      const cwd = input?.cwd ? resolveSafe(ctx.projectRoot, String(input.cwd)) : ctx.projectRoot

      const result = await runShellInSandbox({
        command,
        cwd,
        projectRoot: ctx.projectRoot,
        timeoutMs: SHELL_TIMEOUT_MS,
        networkAccess: !!ctx.networkAccess,
        sandboxMode: ctx.sandboxMode || "workspace-write",
      })

      const stdout = result.stdout || ""
      const stderr = result.stderr || ""
      const exitCode = typeof result.exitCode === "number" ? result.exitCode : -1
      const text = [
        exitCode !== 0 && `exit code: ${exitCode}`,
        stdout && `stdout:\n${truncate(stdout, 16000)}`,
        stderr && `stderr:\n${truncate(stderr, 4000)}`,
        result.killed && "(killed — possibly timed out)",
        result.sandboxBackend && `sandbox: ${result.sandboxBackend}`,
      ].filter(Boolean).join("\n\n")
      return {
        content: text || "(command produced no output)",
        structured: {
          command,
          exitCode,
          killed: !!result.killed,
          sandboxBackend: result.sandboxBackend || null,
        },
        isError: exitCode !== 0,
      }
    },
  },

  {
    name: "mcp_list_tools",
    description: "List MCP servers configured by the active VS Code profile and workspace-discovered MCP files. Does not start MCP server processes.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    flags: { mutates: false, network: false, pathArgs: [] },
    autoAuthorize: true,
    makePreview: () => "list profile and workspace MCP servers",
    execute: async (_input, ctx) => {
      const mcpAccess = getMcpAccessValue()
      const allowed = allowedMcpServersService.isAllowed()
      if (allowed !== true) {
        await clearMcpServersForDisabledAccess()
        return {
          content: getMcpAccessDeniedMessage(),
          structured: {
            mcpAccess,
            activeProfileId: null,
            servers: [],
            tools: [],
            errors: [getMcpAccessDeniedMessage()],
          },
        }
      }
      await clearMcpServersOutsideRegistryAccess(mcpAccess)
      const applied = await applyActiveProfileFromProject(ctx.projectRoot, mcpResourceOptionsFromContext(ctx, mcpAccess))
      const servers = listConfiguredMcpServers()
      const tools = await listMcpTools()
      return {
        content: servers.length
          ? servers.map((server) => `${server.serverName} (${server.config.transport}${server.initialized ? ", connected" : ""})`).join("\n")
          : "(no MCP servers configured in the active profile or workspace)",
        structured: {
          mcpAccess,
          activeProfileId: applied.activeProfileId,
          servers,
          tools,
          errors: applied.errors,
        },
      }
    },
  },

  {
    name: "mcp_call_tool",
    description: "Call a tool exposed by an MCP server from the active VS Code profile or workspace discovery. Requires approval because it may start external MCP processes or make network requests.",
    inputSchema: {
      type: "object",
      properties: {
        serverName: { type: "string", description: "Configured MCP server name." },
        toolName: { type: "string", description: "Tool name exposed by the MCP server." },
        arguments: { type: "object", description: "Tool arguments." },
      },
      required: ["serverName", "toolName"],
      additionalProperties: false,
    },
    flags: { mutates: true, network: true, pathArgs: [] },
    autoAuthorize: false,
    makePreview: (input) => `MCP ${String(input?.serverName || "")}.${String(input?.toolName || "")}`,
    execute: async (input, ctx) => {
      const allowed = allowedMcpServersService.isAllowed()
      if (allowed !== true) {
        await clearMcpServersForDisabledAccess()
        throw new Error(String(allowed?.value || getMcpAccessDeniedMessage()))
      }
      const serverName = String(input?.serverName || "").trim()
      const toolName = String(input?.toolName || "").trim()
      if (!serverName) throw new Error("serverName is required")
      if (!toolName) throw new Error("toolName is required")
      const mcpAccess = getMcpAccessValue()
      await clearMcpServersOutsideRegistryAccess(mcpAccess)
      const applied = await applyActiveProfileFromProject(ctx.projectRoot, mcpResourceOptionsFromContext(ctx, mcpAccess))
      let result
      try {
        result = await callMcpTool(serverName, toolName, input?.arguments && typeof input.arguments === "object" ? input.arguments : {})
      } catch (error) {
        if (error?.code === "MCP_INPUT_REQUIRED") {
          return buildMcpInputRequiredResult(error, { serverName, toolName, activeProfileId: applied.activeProfileId })
        }
        throw error
      }
      const content = typeof result === "string" ? result : JSON.stringify(result, null, 2)
      return {
        content: content || "(empty MCP result)",
        structured: {
          serverName,
          toolName,
          result,
        },
      }
    },
  },
]

const byName = new Map(tools.map((t) => [t.name, t]))

function listSchemas() {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    autoAuthorize: t.autoAuthorize,
    flags: t.flags || { mutates: false, network: false, pathArgs: [] },
  }))
}

function getTool(name) {
  return byName.get(name) || null
}

module.exports = { tools, listSchemas, getTool, buildMcpInputRequiredResult }
