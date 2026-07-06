/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code MCP resource scanner service:
 * - D:\SourceMirror\vscode\src\vs\platform\mcp\common\mcpResourceScannerService.ts
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs")
const path = require("path")
const userDataProfile = require("../userDataProfile")

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function stripJsonComments(source) {
  let output = ""
  let inString = false
  let quote = ""
  let escaped = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]
    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === quote) {
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

function stripTrailingCommas(source) {
  let output = ""
  let inString = false
  let quote = ""
  let escaped = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === quote) {
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

function parseJsonc(text) {
  if (!String(text || "").trim()) return {}
  return JSON.parse(stripTrailingCommas(stripJsonComments(String(text))))
}

function resolveInnerMcpContent(value) {
  if (!isRecord(value)) return {}
  if (!Object.prototype.hasOwnProperty.call(value, "mcp")) return value
  const content = value.mcp
  if (typeof content === "string") return parseJsonc(content)
  return isRecord(content) ? content : {}
}

function sanitizeServer(serverOrConfig) {
  if (!isRecord(serverOrConfig)) return null
  const server = isRecord(serverOrConfig.config)
    ? { ...serverOrConfig.config, version: serverOrConfig.version, gallery: serverOrConfig.gallery }
    : { ...serverOrConfig }
  if (!server.type) {
    server.type = server.command ? "local" : "remote"
  }
  return server
}

function scanMcpResourceContent(resource = "") {
  const raw = resolveInnerMcpContent(parseJsonc(resource))
  const scanned = {
    inputs: Array.isArray(raw.inputs) ? raw.inputs.map((input) => ({ ...input })) : undefined,
    sandbox: raw.sandbox,
  }
  const servers = isRecord(raw.servers) ? raw.servers : isRecord(raw.mcpServers) ? raw.mcpServers : {}
  const normalizedServers = {}
  for (const [name, server] of Object.entries(servers)) {
    const normalized = sanitizeServer(server)
    if (normalized) normalizedServers[name] = normalized
  }
  if (Object.keys(normalizedServers).length) scanned.servers = normalizedServers
  return scanned
}

function hasScannedContent(scanned = {}) {
  return Boolean(
    (isRecord(scanned.servers) && Object.keys(scanned.servers).length > 0) ||
    (Array.isArray(scanned.inputs) && scanned.inputs.length > 0) ||
    scanned.sandbox !== undefined
  )
}

function serializeScannedMcpServers(scanned = {}) {
  const output = {}
  if (isRecord(scanned.servers) && Object.keys(scanned.servers).length) output.servers = scanned.servers
  if (Array.isArray(scanned.inputs) && scanned.inputs.length) output.inputs = scanned.inputs
  if (scanned.sandbox !== undefined) output.sandbox = scanned.sandbox
  return hasScannedContent(output) ? `${JSON.stringify(output, null, "\t")}\n` : ""
}

function serializeScannedMcpServersObject(scanned = {}) {
  const output = {}
  if (isRecord(scanned.servers) && Object.keys(scanned.servers).length) output.servers = scanned.servers
  if (Array.isArray(scanned.inputs) && scanned.inputs.length) output.inputs = scanned.inputs
  if (scanned.sandbox !== undefined) output.sandbox = scanned.sandbox
  return output
}

function resolveProfile(state, options = {}) {
  const profileId = typeof options.profileId === "string" && options.profileId.trim()
    ? options.profileId.trim()
    : state.workspaceProfileId || state.activeProfileId || userDataProfile.DEFAULT_PROFILE_ID
  const profiles = Array.isArray(state.profiles) ? state.profiles.map((profile) => ({ ...profile })) : []
  let index = profiles.findIndex((profile) => profile?.id === profileId)
  if (index < 0) {
    profiles.push({ id: profileId, name: profileId === userDataProfile.DEFAULT_PROFILE_ID ? "Default" : profileId, settings: {}, resources: {} })
    index = profiles.length - 1
  }
  return { profileId, profiles, index }
}

function readTargetProfile(options = {}) {
  const state = userDataProfile.readWorkbenchProfileState({ workspace: options.workspace, filePath: options.filePath })
  const resolved = resolveProfile(state, options)
  const profile = resolved.profiles[resolved.index]
  return { state, ...resolved, profile }
}

function writeTargetProfile(target, resource, options = {}) {
  const profile = {
    ...target.profile,
    resources: { ...(target.profile.resources || {}) },
  }
  if (resource) profile.resources.mcp = resource
  else delete profile.resources.mcp
  target.profiles[target.index] = profile
  return userDataProfile.writeWorkbenchProfileState({
    profiles: target.profiles,
    activeProfileId: target.state.activeProfileId || target.profileId,
    profileAssociations: target.state.profileAssociations,
  }, {
    workspace: options.workspace,
    filePath: options.filePath,
    changeReason: options.changeReason || "mcp-resource:update",
    onDidChangeWorkbenchProfiles: options.onDidChangeWorkbenchProfiles,
    broadcastUserDataProfileChange: options.broadcastUserDataProfileChange,
  })
}

function scanProfileMcpServers(options = {}) {
  const target = readTargetProfile(options)
  return {
    profileId: target.profileId,
    scanned: scanMcpResourceContent(target.profile?.resources?.mcp || ""),
    resource: target.profile?.resources?.mcp || "",
  }
}

function withProfileMcpServers(options = {}, updateFn) {
  const target = readTargetProfile(options)
  const current = scanMcpResourceContent(target.profile?.resources?.mcp || "")
  if (typeof updateFn !== "function") {
    return { profileId: target.profileId, scanned: current, resource: target.profile?.resources?.mcp || "" }
  }
  const next = updateFn(current) || {}
  const resource = serializeScannedMcpServers(next)
  const state = writeTargetProfile(target, resource, options)
  return { profileId: target.profileId, scanned: next, resource, state }
}

function normalizeTarget(options = {}) {
  const target = typeof options.target === "string" ? options.target.trim() : ""
  if (target === "workspace" || target === "workspaceFolder") return target
  return "user"
}

function resolveWorkspaceResourcePath(options = {}) {
  const candidates = [
    options.mcpResourcePath,
    options.resourcePath,
    options.workspaceResource,
    options.workspaceFile,
    options.workspace,
  ].filter((value) => typeof value === "string" && value.trim())
  const resolved = candidates.map((value) => path.resolve(value)).find((value) => value.endsWith(".code-workspace"))
  if (resolved) return resolved
  throw new Error("workspace target requires a .code-workspace resource path")
}

function resolveWorkspaceFolderResourcePath(options = {}) {
  const direct = [options.mcpResourcePath, options.resourcePath, options.workspaceResource]
    .find((value) => typeof value === "string" && value.trim())
  if (direct) return path.resolve(direct)
  const workspace = typeof options.workspace === "string" && options.workspace.trim() ? options.workspace.trim() : ""
  if (!workspace) throw new Error("workspaceFolder target requires a workspace folder path")
  const root = workspace.endsWith(".code-workspace") ? path.dirname(workspace) : workspace
  return path.join(path.resolve(root), ".mcp.json")
}

function readJsoncFile(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    const parsed = parseJsonc(fs.readFileSync(filePath, "utf8"))
    return isRecord(parsed) ? parsed : fallback
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback
    throw error
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, "\t")}\n`, "utf8")
}

function scanWorkspaceMcpServers(options = {}) {
  const filePath = resolveWorkspaceResourcePath(options)
  const workspace = readJsoncFile(filePath, { settings: {} })
  const scanned = scanMcpResourceContent(JSON.stringify(workspace.settings?.mcp || {}))
  return { target: "workspace", path: filePath, scanned, resource: workspace }
}

function withWorkspaceMcpServers(options = {}, updateFn) {
  const filePath = resolveWorkspaceResourcePath(options)
  const workspace = readJsoncFile(filePath, { settings: {} })
  const scanned = scanMcpResourceContent(JSON.stringify(workspace.settings?.mcp || {}))
  if (typeof updateFn !== "function") return { target: "workspace", path: filePath, scanned, resource: workspace }
  const next = updateFn(scanned) || {}
  const output = { ...workspace, settings: { ...(workspace.settings || {}) } }
  output.settings.mcp = serializeScannedMcpServersObject(next)
  writeJsonFile(filePath, output)
  return { target: "workspace", path: filePath, scanned: next, resource: output }
}

function scanWorkspaceFolderMcpServers(options = {}) {
  const filePath = resolveWorkspaceFolderResourcePath(options)
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : ""
  return { target: "workspaceFolder", path: filePath, scanned: scanMcpResourceContent(content), resource: content }
}

function withWorkspaceFolderMcpServers(options = {}, updateFn) {
  const filePath = resolveWorkspaceFolderResourcePath(options)
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : ""
  const scanned = scanMcpResourceContent(content)
  if (typeof updateFn !== "function") return { target: "workspaceFolder", path: filePath, scanned, resource: content }
  const next = updateFn(scanned) || {}
  const resource = serializeScannedMcpServers(next)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, resource || "{}\n", "utf8")
  return { target: "workspaceFolder", path: filePath, scanned: next, resource }
}

function withMcpServers(options = {}, updateFn) {
  const target = normalizeTarget(options)
  if (target === "workspace") return withWorkspaceMcpServers(options, updateFn)
  if (target === "workspaceFolder") return withWorkspaceFolderMcpServers(options, updateFn)
  return { target: "user", ...withProfileMcpServers(options, updateFn) }
}

function mergeInstallableServers(scanned, servers = []) {
  let inputs = Array.isArray(scanned.inputs) ? [...scanned.inputs] : []
  const existingServers = isRecord(scanned.servers) ? { ...scanned.servers } : {}
  for (const server of Array.isArray(servers) ? servers : []) {
    if (!isRecord(server) || !server.name || !isRecord(server.config)) continue
    existingServers[server.name] = sanitizeServer(server.config)
    if (Array.isArray(server.inputs) && server.inputs.length) {
      const existingInputIds = new Set(inputs.map((input) => input?.id).filter(Boolean))
      const newInputs = server.inputs
        .filter((input) => isRecord(input) && input.id && !existingInputIds.has(input.id))
        .map((input) => ({ ...input }))
      inputs = [...inputs, ...newInputs]
    }
  }
  return {
    servers: existingServers,
    inputs,
    sandbox: scanned.sandbox,
  }
}

function addMcpServers(servers = [], options = {}) {
  return withMcpServers(options, (scanned) => mergeInstallableServers(scanned, servers))
}

function addProfileMcpServers(servers = [], options = {}) {
  return withProfileMcpServers(options, (scanned) => {
    return mergeInstallableServers(scanned, servers)
  })
}

function removeNames(scanned, serverNames = []) {
  const names = new Set((Array.isArray(serverNames) ? serverNames : []).map((name) => String(name || "").trim()).filter(Boolean))
  const servers = isRecord(scanned.servers) ? { ...scanned.servers } : {}
  for (const name of names) delete servers[name]
  return {
    servers,
    inputs: scanned.inputs,
    sandbox: scanned.sandbox,
  }
}

function removeMcpServers(serverNames = [], options = {}) {
  return withMcpServers(options, (scanned) => removeNames(scanned, serverNames))
}

function removeProfileMcpServers(serverNames = [], options = {}) {
  return withProfileMcpServers(options, (scanned) => removeNames(scanned, serverNames))
}

function scanMcpServers(options = {}) {
  const target = normalizeTarget(options)
  if (target === "workspace") return scanWorkspaceMcpServers(options)
  if (target === "workspaceFolder") return scanWorkspaceFolderMcpServers(options)
  return { target: "user", ...scanProfileMcpServers(options) }
}

function updateMcpSandboxConfig(updateFn, options = {}) {
  if (typeof updateFn !== "function") throw new Error("updateFn required")
  return withMcpServers(options, updateFn)
}

function updateProfileMcpSandboxConfig(updateFn, options = {}) {
  if (typeof updateFn !== "function") throw new Error("updateFn required")
  return withProfileMcpServers(options, updateFn)
}

module.exports = {
  addMcpServers,
  addProfileMcpServers,
  removeMcpServers,
  removeProfileMcpServers,
  scanMcpResourceContent,
  scanMcpServers,
  scanProfileMcpServers,
  serializeScannedMcpServers,
  updateMcpSandboxConfig,
  updateProfileMcpSandboxConfig,
  withProfileMcpServers,
}
