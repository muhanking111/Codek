export type ProcessKind = "main" | "renderer" | "extensionHost" | "sharedProcess" | "pty" | "lsp" | "dap" | "mcp" | "service"

export interface ProcessMemorySample {
  rss?: number
  heapUsed?: number
}

export interface ProcessSnapshot {
  app?: {
    name?: string
    version?: string
    pid?: number
    platform?: string
    arch?: string
    electron?: string
    node?: string
    memory?: ProcessMemorySample
    load?: number
    cpu?: number
  }
  windows?: Array<{
    id?: number
    title?: string
    rendererPid?: number | null
    focused?: boolean
    visible?: boolean
    load?: number
    cpu?: number
    memory?: ProcessMemorySample
  }>
  pty?: {
    ptyAvailable?: boolean
    sessions?: Array<{
      id?: string
      pid?: number
      shellType?: string
      cwd?: string
      mode?: string
      uptimeMs?: number
      load?: number
      cpu?: number
      memory?: ProcessMemorySample
    }>
  }
  lsp?: Array<{ id?: string; pid?: number | null; load?: number; cpu?: number; memory?: ProcessMemorySample }>
  dap?: Array<{ id?: string; pid?: number | null; adapterType?: string; load?: number; cpu?: number; memory?: ProcessMemorySample }>
  mcp?: Array<{ id?: string; pid?: number | null; command?: string; load?: number; cpu?: number; memory?: ProcessMemorySample }>
  extensionHost?: Array<{ id?: string; pid?: number | null; name?: string; load?: number; cpu?: number; memory?: ProcessMemorySample }>
  sharedProcess?: Array<{ id?: string; pid?: number | null; name?: string; load?: number; cpu?: number; memory?: ProcessMemorySample }>
}

export interface ProcessProjectionNode {
  id: string
  kind: ProcessKind
  name: string
  pid: number | null
  parentPid: number | null
  load: number
  memoryRss: number
  commandLine: string
  metadata: Record<string, string | number | boolean | null>
  children: ProcessProjectionNode[]
}

export interface ProcessTreeSnapshot {
  schemaVersion: 1
  source: "processDiagnostics"
  stateSource: "processSnapshot"
  generatedAt: number
  roots: ProcessProjectionNode[]
  flattened: ProcessProjectionNode[]
  summary: {
    appName: string
    totalProcesses: number
    rendererProcesses: number
    terminalProcesses: number
    languageServers: number
    debugAdapters: number
    extensionHosts: number
    sharedProcesses: number
    mcpProcesses: number
    ptyAvailable: boolean
  }
  constraints: {
    noSecondProcessState: true
    runtimeSelfContained: true
  }
}

export interface ProcessPerformanceModel {
  schemaVersion: 1
  source: "processDiagnostics"
  generatedAt: number
  tree: ProcessTreeSnapshot
  samplingModel: {
    cpu: {
      totalLoad: number
      maxLoad: number
      sources: string[]
    }
    memory: {
      totalRss: number
      maxRss: number
      heapUsed: number
    }
    counts: ProcessTreeSnapshot["summary"]
  }
  evidence: {
    summary: string
    issues: ProcessPerformanceIssue[]
    privacy: {
      redacted: true
      commandsRedacted: true
      workspacePathsRedacted: true
      externalPost: false
    }
  }
  actions: {
    copy: ProcessActionDescriptor
    export: ProcessActionDescriptor
    kill: ProcessActionDescriptor
  }
  constraints: {
    noSecondPerformanceState: true
    evidenceSafeActionsOnly: true
    preservesAgentEvidence: true
    runtimeSelfContained: true
  }
}

export interface ProcessPerformanceIssue {
  kind: "highCpu" | "highMemory" | "manyServices" | "ptyFallback"
  severity: "info" | "warning" | "critical"
  processId?: string
  pid?: number | null
  message: string
  evidence: Record<string, string | number | boolean | null>
}

export type ProcessActionKind = "kill" | "copy" | "export"

export interface ProcessActionDescriptor {
  commandId: string
  title: string
  kind: ProcessActionKind
  targetPath: string
  format: "json" | "text"
  pid: number | null
  processKind: ProcessKind | "all"
  readonlyEvidence: boolean
  requiresApproval: boolean
  gitIndexMutation: false
  shellExecution: false
  workspaceMutation: "none"
  externalPost: false
  redacted: true
}

export interface ProcessDiagnosticsOptions {
  generatedAt?: number
}

const HIGH_CPU_THRESHOLD = 90
const HIGH_MEMORY_THRESHOLD = 512 * 1024 * 1024

export function buildProcessDiagnosticsText(snapshot: ProcessSnapshot): string {
  const redactedSnapshot = redactProcessSnapshot(snapshot)
  const tree = buildProcessTreeSnapshot(redactedSnapshot)
  const performance = buildProcessPerformanceModel(redactedSnapshot, { generatedAt: tree.generatedAt })
  const payload = {
    createdAt: new Date(tree.generatedAt).toISOString(),
    summary: {
      app: redactedSnapshot.app?.name || "Codek",
      version: redactedSnapshot.app?.version || "",
      pid: redactedSnapshot.app?.pid ?? null,
      platform: [redactedSnapshot.app?.platform, redactedSnapshot.app?.arch].filter(Boolean).join(" "),
      memoryRss: redactedSnapshot.app?.memory?.rss ?? null,
      terminalSessions: redactedSnapshot.pty?.sessions?.length || 0,
      ptyAvailable: Boolean(redactedSnapshot.pty?.ptyAvailable),
      windows: redactedSnapshot.windows?.length || 0,
      lsp: redactedSnapshot.lsp?.length || 0,
      dap: redactedSnapshot.dap?.length || 0,
      mcp: redactedSnapshot.mcp?.length || 0,
      projectedProcesses: tree.summary.totalProcesses,
      performanceIssues: performance.evidence.issues.length,
    },
    process: redactedSnapshot,
    tree,
    performance,
  }

  return JSON.stringify(payload, null, 2)
}

export function buildProcessTreeSnapshot(
  snapshot: ProcessSnapshot,
  options: ProcessDiagnosticsOptions = {},
): ProcessTreeSnapshot {
  const redacted = redactProcessSnapshot(snapshot)
  const mainPid = toPid(redacted.app?.pid)
  const root = createNode({
    id: mainPid !== null ? `main:${mainPid}` : "main:codek",
    kind: "main",
    name: redacted.app?.name || "Codek",
    pid: mainPid,
    parentPid: null,
    load: getLoad(redacted.app),
    memoryRss: toNumber(redacted.app?.memory?.rss),
    commandLine: "",
    metadata: {
      version: redacted.app?.version || "",
      platform: [redacted.app?.platform, redacted.app?.arch].filter(Boolean).join(" "),
      electron: redacted.app?.electron || "",
      node: redacted.app?.node || "",
    },
  })

  for (const win of redacted.windows || []) {
    root.children.push(createNode({
      id: `renderer:${win.id ?? win.rendererPid ?? root.children.length}`,
      kind: "renderer",
      name: win.title || `Window ${win.id ?? "-"}`,
      pid: toPid(win.rendererPid),
      parentPid: mainPid,
      load: getLoad(win),
      memoryRss: toNumber(win.memory?.rss),
      commandLine: "",
      metadata: {
        windowId: win.id ?? null,
        focused: win.focused === true,
        visible: win.visible === true,
      },
    }))
  }

  for (const item of redacted.extensionHost || []) {
    root.children.push(createServiceNode("extensionHost", item.id || item.name || "extension-host", item, mainPid))
  }
  for (const item of redacted.sharedProcess || []) {
    root.children.push(createServiceNode("sharedProcess", item.id || item.name || "shared-process", item, mainPid))
  }
  for (const item of redacted.pty?.sessions || []) {
    root.children.push(createNode({
      id: `pty:${item.id || item.pid || root.children.length}`,
      kind: "pty",
      name: item.shellType || item.mode || "terminal",
      pid: toPid(item.pid),
      parentPid: mainPid,
      load: getLoad(item),
      memoryRss: toNumber(item.memory?.rss),
      commandLine: item.cwd || "",
      metadata: {
        id: item.id || "",
        cwd: item.cwd || "",
        mode: item.mode || "",
        uptimeMs: toNumber(item.uptimeMs),
      },
    }))
  }
  for (const item of redacted.lsp || []) {
    root.children.push(createServiceNode("lsp", item.id || "language-server", item, mainPid))
  }
  for (const item of redacted.dap || []) {
    root.children.push(createNode({
      id: `dap:${item.id || item.pid || root.children.length}`,
      kind: "dap",
      name: item.adapterType || item.id || "debug-adapter",
      pid: toPid(item.pid),
      parentPid: mainPid,
      load: getLoad(item),
      memoryRss: toNumber(item.memory?.rss),
      commandLine: "",
      metadata: {
        id: item.id || "",
        adapterType: item.adapterType || "",
      },
    }))
  }
  for (const item of redacted.mcp || []) {
    root.children.push(createNode({
      id: `mcp:${item.id || item.pid || root.children.length}`,
      kind: "mcp",
      name: item.id || "mcp",
      pid: toPid(item.pid),
      parentPid: mainPid,
      load: getLoad(item),
      memoryRss: toNumber(item.memory?.rss),
      commandLine: item.command || "",
      metadata: { id: item.id || "" },
    }))
  }

  const flattened = flattenNodes([root])
  const summary = {
    appName: root.name,
    totalProcesses: flattened.length,
    rendererProcesses: countKind(flattened, "renderer"),
    terminalProcesses: countKind(flattened, "pty"),
    languageServers: countKind(flattened, "lsp"),
    debugAdapters: countKind(flattened, "dap"),
    extensionHosts: countKind(flattened, "extensionHost"),
    sharedProcesses: countKind(flattened, "sharedProcess"),
    mcpProcesses: countKind(flattened, "mcp"),
    ptyAvailable: redacted.pty?.ptyAvailable === true,
  }

  return {
    schemaVersion: 1,
    source: "processDiagnostics",
    stateSource: "processSnapshot",
    generatedAt: options.generatedAt ?? Date.now(),
    roots: [root],
    flattened,
    summary,
    constraints: {
      noSecondProcessState: true,
      runtimeSelfContained: true,
    },
  }
}

export function buildProcessPerformanceModel(
  snapshot: ProcessSnapshot,
  options: ProcessDiagnosticsOptions = {},
): ProcessPerformanceModel {
  const tree = buildProcessTreeSnapshot(snapshot, options)
  const sources = collectCpuSources(snapshot)
  const loads = tree.flattened.map((node) => node.load).filter((value) => value > 0)
  const rssValues = tree.flattened.map((node) => node.memoryRss).filter((value) => value > 0)
  const heapUsed = toNumber(snapshot.app?.memory?.heapUsed)
  const totalLoad = round(loads.reduce((sum, value) => sum + value, 0))
  const totalRss = rssValues.reduce((sum, value) => sum + value, 0)
  const issues = buildPerformanceIssues(tree)

  return {
    schemaVersion: 1,
    source: "processDiagnostics",
    generatedAt: tree.generatedAt,
    tree,
    samplingModel: {
      cpu: {
        totalLoad,
        maxLoad: loads.length ? Math.max(...loads) : 0,
        sources,
      },
      memory: {
        totalRss,
        maxRss: rssValues.length ? Math.max(...rssValues) : 0,
        heapUsed,
      },
      counts: tree.summary,
    },
    evidence: {
      summary: buildPerformanceSummary(tree, issues, totalLoad, totalRss),
      issues,
      privacy: {
        redacted: true,
        commandsRedacted: true,
        workspacePathsRedacted: true,
        externalPost: false,
      },
    },
    actions: {
      copy: createProcessActionDescriptor("copy"),
      export: createProcessActionDescriptor("export"),
      kill: createProcessActionDescriptor("kill"),
    },
    constraints: {
      noSecondPerformanceState: true,
      evidenceSafeActionsOnly: true,
      preservesAgentEvidence: true,
      runtimeSelfContained: true,
    },
  }
}

export function createProcessActionDescriptor(
  kind: ProcessActionKind,
  options: { pid?: number | null; processKind?: ProcessKind | "all" } = {},
): ProcessActionDescriptor {
  const pid = toPid(options.pid)
  if (kind === "kill") {
    return {
      commandId: "workbench.action.processExplorer.kill",
      title: "Process Explorer: Kill Process",
      kind,
      targetPath: pid !== null ? `process://${pid}` : "process://selected",
      format: "json",
      pid,
      processKind: options.processKind || "all",
      readonlyEvidence: false,
      requiresApproval: true,
      gitIndexMutation: false,
      shellExecution: false,
      workspaceMutation: "none",
      externalPost: false,
      redacted: true,
    }
  }
  if (kind === "export") {
    return {
      commandId: "workbench.action.processExplorer.export",
      title: "Process Explorer: Export Local Performance Evidence",
      kind,
      targetPath: ".codek/reports/process-performance-latest.json",
      format: "json",
      pid: null,
      processKind: "all",
      readonlyEvidence: true,
      requiresApproval: false,
      gitIndexMutation: false,
      shellExecution: false,
      workspaceMutation: "none",
      externalPost: false,
      redacted: true,
    }
  }
  return {
    commandId: "workbench.action.processExplorer.copy",
    title: "Process Explorer: Copy Redacted Diagnostics",
    kind,
    targetPath: "clipboard://process-explorer",
    format: "text",
    pid: null,
    processKind: "all",
    readonlyEvidence: true,
    requiresApproval: false,
    gitIndexMutation: false,
    shellExecution: false,
    workspaceMutation: "none",
    externalPost: false,
    redacted: true,
  }
}

export function redactProcessSnapshot(snapshot: ProcessSnapshot): ProcessSnapshot {
  return redactValue(snapshot || {}) as ProcessSnapshot
}

function createServiceNode(
  kind: "extensionHost" | "sharedProcess" | "lsp",
  fallbackName: string,
  item: { id?: string; pid?: number | null; name?: string; load?: number; cpu?: number; memory?: ProcessMemorySample },
  mainPid: number | null,
): ProcessProjectionNode {
  return createNode({
    id: `${kind}:${item.id || item.pid || fallbackName}`,
    kind,
    name: item.name || item.id || fallbackName,
    pid: toPid(item.pid),
    parentPid: mainPid,
    load: getLoad(item),
    memoryRss: toNumber(item.memory?.rss),
    commandLine: "",
    metadata: { id: item.id || "" },
  })
}

function createNode(input: Omit<ProcessProjectionNode, "children"> & { children?: ProcessProjectionNode[] }): ProcessProjectionNode {
  return {
    id: sanitizeText(input.id),
    kind: input.kind,
    name: sanitizeText(input.name),
    pid: input.pid,
    parentPid: input.parentPid,
    load: round(input.load),
    memoryRss: Math.max(0, Math.round(input.memoryRss)),
    commandLine: sanitizeText(input.commandLine),
    metadata: Object.fromEntries(
      Object.entries(input.metadata || {}).map(([key, value]) => [key, typeof value === "string" ? sanitizeText(value) : value]),
    ) as ProcessProjectionNode["metadata"],
    children: input.children || [],
  }
}

function buildPerformanceIssues(tree: ProcessTreeSnapshot): ProcessPerformanceIssue[] {
  const issues: ProcessPerformanceIssue[] = []
  for (const node of tree.flattened) {
    if (node.load >= HIGH_CPU_THRESHOLD) {
      issues.push({
        kind: "highCpu",
        severity: node.load >= 98 ? "critical" : "warning",
        processId: node.id,
        pid: node.pid,
        message: `${node.name} CPU load is ${node.load}%`,
        evidence: { load: node.load, kind: node.kind },
      })
    }
    if (node.memoryRss >= HIGH_MEMORY_THRESHOLD) {
      issues.push({
        kind: "highMemory",
        severity: node.memoryRss >= HIGH_MEMORY_THRESHOLD * 2 ? "critical" : "warning",
        processId: node.id,
        pid: node.pid,
        message: `${node.name} RSS memory is ${Math.round(node.memoryRss / 1024 / 1024)} MB`,
        evidence: { memoryRss: node.memoryRss, kind: node.kind },
      })
    }
  }
  const serviceCount = tree.summary.languageServers + tree.summary.debugAdapters + tree.summary.mcpProcesses + tree.summary.extensionHosts
  if (serviceCount >= 8) {
    issues.push({
      kind: "manyServices",
      severity: "info",
      message: `${serviceCount} service processes are projected`,
      evidence: { serviceCount },
    })
  }
  if (!tree.summary.ptyAvailable && tree.summary.terminalProcesses > 0) {
    issues.push({
      kind: "ptyFallback",
      severity: "info",
      message: "Terminal sessions are running in compatibility mode",
      evidence: { terminalProcesses: tree.summary.terminalProcesses },
    })
  }
  return issues
}

function buildPerformanceSummary(
  tree: ProcessTreeSnapshot,
  issues: ProcessPerformanceIssue[],
  totalLoad: number,
  totalRss: number,
): string {
  const memoryMb = Math.round(totalRss / 1024 / 1024)
  return `${tree.summary.totalProcesses} projected processes, ${totalLoad}% sampled load, ${memoryMb} MB RSS, ${issues.length} issue(s)`
}

function collectCpuSources(snapshot: ProcessSnapshot): string[] {
  const sources: string[] = []
  if (hasLoad(snapshot.app)) sources.push("app.load")
  if ((snapshot.windows || []).some(hasLoad)) sources.push("windows.load")
  if ((snapshot.pty?.sessions || []).some(hasLoad)) sources.push("pty.load")
  if ((snapshot.lsp || []).some(hasLoad)) sources.push("lsp.load")
  if ((snapshot.dap || []).some(hasLoad)) sources.push("dap.load")
  if ((snapshot.mcp || []).some(hasLoad)) sources.push("mcp.load")
  if ((snapshot.extensionHost || []).some(hasLoad)) sources.push("extensionHost.load")
  if ((snapshot.sharedProcess || []).some(hasLoad)) sources.push("sharedProcess.load")
  return sources.length ? sources : ["snapshot.counts"]
}

function flattenNodes(nodes: ProcessProjectionNode[]): ProcessProjectionNode[] {
  const result: ProcessProjectionNode[] = []
  for (const node of nodes) {
    result.push(node)
    result.push(...flattenNodes(node.children))
  }
  return result
}

function countKind(nodes: ProcessProjectionNode[], kind: ProcessKind): number {
  return nodes.filter((node) => node.kind === kind).length
}

function hasLoad(value: { load?: number; cpu?: number } | undefined): boolean {
  return typeof value?.load === "number" || typeof value?.cpu === "number"
}

function getLoad(value: { load?: number; cpu?: number } | undefined): number {
  const load = typeof value?.load === "number" ? value.load : value?.cpu
  return toNumber(load)
}

function toPid(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) result[key] = redactValue(item)
    return result
  }
  return value
}

function sanitizeText(value: unknown): string {
  return String(value || "")
    .replace(/\bsk-[A-Za-z0-9_-]{3,}\b/g, "[redacted]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{6,}/gi, "$1[redacted]")
    .replace(/\b(api[_-]?key|token|password|secret|authorization)\s*[:=]\s*[^,\s;]+/gi, "$1=[redacted]")
    .replace(/(--?(?:api[_-]?key|token|password|secret|authorization)[=\s]+)[^,\s;]+/gi, "$1[redacted]")
    .replace(/[A-Za-z]:[\\/](Users|用户)[\\/][^\\/]+/gi, "[USER_PATH]")
    .replace(/[A-Za-z]:[\\/](Codek|Workspace)[\\/][^\\/\s]+/gi, "D:/Workspace/[workspace-path-redacted]")
    .replace(/\\/g, "/")
}
