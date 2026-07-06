const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { defaultReadinessReportDir } = require("../agentLoop/readiness")

function defaultExtensionsDir() {
  return path.resolve(__dirname, "..", "..", "..", "extensions")
}

function findBundledDebugpy(options = {}) {
  const extensionsDir = options.extensionsDir || defaultExtensionsDir()
  const candidates = [
    path.join(extensionsDir, "ms-python.debugpy", "bundled", "libs"),
    path.join(extensionsDir, "ms-python.python", "pythonFiles", "lib", "python"),
  ]
  for (const libsPath of candidates) {
    const adapterMain = path.join(libsPath, "debugpy", "adapter", "__main__.py")
    if (fs.existsSync(adapterMain)) return { libsPath, adapterMain }
  }
  return null
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function findJsDebugExtension(options = {}) {
  const extensionsDir = options.extensionsDir || defaultExtensionsDir()
  const candidates = [
    path.join(extensionsDir, "ms-vscode.js-debug"),
    path.join(extensionsDir, "ms-vscode.vscode-js-debug"),
  ]
  for (const extensionPath of candidates) {
    const manifestPath = path.join(extensionPath, "package.json")
    const manifest = readJsonSafe(manifestPath)
    if (!manifest) continue
    const debuggers = Array.isArray(manifest.contributes?.debuggers) ? manifest.contributes.debuggers : []
    const debugTypes = debuggers.map((debuggerContribution) => debuggerContribution.type).filter(Boolean)
    const hasNodeDebugger = debugTypes.some((type) => ["node", "pwa-node", "node-terminal"].includes(type))
    const extensionMain = manifest.main ? path.join(extensionPath, manifest.main) : ""
    if (hasNodeDebugger && extensionMain && fs.existsSync(extensionMain)) {
      return {
        extensionId: `${manifest.publisher || "unknown"}.${manifest.name || path.basename(extensionPath)}`,
        extensionPath,
        manifestPath,
        extensionMain,
        version: manifest.version || "",
        displayName: manifest.displayName || manifest.name || "JavaScript Debugger",
        debugTypes,
      }
    }
  }
  return null
}

function buildJsDebugBridgeFeasibility(jsDebug = {}) {
  return {
    status: "ready",
    stage: "descriptor_to_transport_bridge",
    factoryProvidePath: {
      mainThreadRequest: "$registerDebugAdapterDescriptorFactory must call ExtHostDebugService.$provideDebugAdapter(handle, sessionDto).",
      extHostHandler: "$provideDebugAdapter returns executable, server, pipeServer, or implementation descriptor DTO.",
      currentCodekState: "MainThreadDebugService requests the descriptor and passes server/pipeServer descriptors to desktop dapStart({ debugAdapterDescriptor }).",
    },
    descriptorTypes: {
      executable: "can map to existing stdio DAP when descriptor.command is returned",
      server: "supported via dapStart({ debugAdapterDescriptor: { type: 'server', host, port } })",
      pipeServer: "supported via dapStart({ debugAdapterDescriptor: { type: 'pipeServer', path } })",
      implementation: "blocked; inline debug adapter is not supported by Codek desktop DAP service",
    },
    requiredSessionDtoFields: ["id", "type", "name", "folderUri", "configuration", "parent"],
    verifiedBridgeApis: [
      "debug session start path calls ExtHostDebugService.$provideDebugAdapter and passes the descriptor to dapStart({ debugAdapterDescriptor })",
      "real js-debug initialize/launch smoke through extension-host DebugAdapterDescriptorFactory is covered by npm run smoke:debug-adapter",
      "descriptor timeout/error propagation from extension-host factory request is covered by mainThreadDebugService tests",
    ],
    remainingLimitations: [
      "inline DebugAdapterInlineImplementation descriptors are not supported by Codek desktop DAP service",
    ],
    vscodeSource: [
      "src/vs/workbench/api/browser/mainThreadDebugService.ts#$registerDebugAdapterDescriptorFactory",
      "src/vs/workbench/api/common/extHostDebugService.ts#$provideDebugAdapter",
      "src/vs/workbench/api/node/extHostDebugService.ts#createDebugAdapter",
      "src/vs/workbench/contrib/debug/node/debugAdapter.ts#SocketDebugAdapter/NamedPipeDebugAdapter",
    ],
    extension: jsDebug.extensionId || "ms-vscode.js-debug",
  }
}

function makeRemediation(input = {}) {
  return {
    category: input.category || "environment",
    severity: input.severity || "warning",
    configKey: input.configKey || "",
    resolvedPath: input.resolvedPath || "",
    commands: Array.isArray(input.commands) ? input.commands : [],
    nextAction: input.nextAction || "",
    docsHint: input.docsHint || "",
  }
}

function resolveCustomAdapter(type, config = {}) {
  return {
    adapterType: type || "custom",
    command: String(config.command),
    args: Array.isArray(config.args) ? config.args : [],
    env: config.env,
    available: true,
    source: "config",
    mode: "stdio",
    message: "使用 launch 配置中的自定义调试器命令。",
    remediation: makeRemediation({
      category: "custom-config",
      severity: "info",
      nextAction: "继续使用当前 launch 配置；如果调试失败，先检查 command/args 是否可执行。",
    }),
  }
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value
  }
  return ""
}

function explicitNodeAdapterPath(config = {}, options = {}) {
  return firstNonEmptyString(
    config.jsDebugPath,
    config.nodeAdapterPath,
    config.debugAdapterPath,
    config.adapterPath,
    options.jsDebugPath,
    options.nodeAdapterPath,
    options.debugAdapterPath,
    options.adapterPath,
  )
}

function explicitAdapterExecutable(config = {}) {
  const descriptor = config.adapterExecutable || config.debugAdapterExecutable
  if (typeof descriptor === "string" && descriptor.trim()) {
    return { command: descriptor, args: [], env: config.env }
  }
  if (!descriptor || typeof descriptor !== "object") return null
  const command = firstNonEmptyString(descriptor.command, descriptor.path, descriptor.executable)
  if (!command) return null
  return {
    command,
    args: Array.isArray(descriptor.args) ? descriptor.args : [],
    env: descriptor.env || config.env,
  }
}

function resolveNodeAdapter(config = {}, options = {}) {
  const executable = explicitAdapterExecutable(config)
  if (executable) {
    return resolveCustomAdapter("node", executable)
  }

  const explicitPath = explicitNodeAdapterPath(config, options)
  if (explicitPath) {
    const exists = fs.existsSync(explicitPath)
    return {
      adapterType: "node",
      command: "node",
      args: [explicitPath, "--stdio"],
      available: exists,
      source: "legacy-js-debug-stdio",
      mode: "stdio",
      adapterPath: explicitPath,
      message: exists ? "已找到显式配置的 Node DAP stdio adapter。" : "显式配置的 Node DAP adapter 路径不存在。",
      remediation: makeRemediation({
        category: "environment",
        configKey: "codek.debug.nodeAdapterPath",
        resolvedPath: explicitPath,
        commands: [],
        nextAction: exists
          ? "运行真实 Node DAP smoke，验证断点、栈帧、变量和 console 输出。"
          : "修正 codek.debug.nodeAdapterPath，或改用内置 ms-vscode.js-debug 扩展宿主模式。",
        docsHint: "旧版 js-debug 源码可提供 stdio adapter；新版 VS Code js-debug 默认通过扩展宿主注册。",
      }),
    }
  }

  const jsDebug = findJsDebugExtension(options)
  if (jsDebug) {
    const feasibility = buildJsDebugBridgeFeasibility(jsDebug)
    return {
      adapterType: "node",
      command: "",
      args: [],
      available: true,
      source: "ms-vscode.js-debug",
      mode: "extension-host",
      dapTransportReady: true,
      sessionStartReady: true,
      feasibility,
      adapterPath: jsDebug.extensionMain,
      extension: jsDebug,
      message: "已安装官方 VS Code JavaScript Debugger，server/named-pipe descriptor transport 已可接入 DAP parser，debug session start 已串起 $provideDebugAdapter descriptor。",
      remediation: makeRemediation({
        category: "vscode-extension-host",
        severity: "info",
        configKey: "codek.debug.useVsCodeJsDebug",
        resolvedPath: jsDebug.extensionPath,
        commands: [],
        nextAction: "运行 npm run smoke:debug-adapter 验证真实 ms-vscode.js-debug initialize/launch handoff；若失败，查看 .codek/reports/eh-e2e-js-debug-latest.json。",
        docsHint: "VS Code 的 Node/Chrome 调试由 ms-vscode.js-debug 扩展贡献 debuggers 并注册 DebugAdapterDescriptorFactory。",
      }),
    }
  }

  return {
    adapterType: "node",
    command: "",
    args: [],
    available: false,
    source: "missing",
    mode: "extension-host",
    adapterPath: "",
    message: "缺少官方 VS Code JavaScript Debugger 扩展，Node 调试不可用。",
    remediation: makeRemediation({
      category: "environment",
      configKey: "codek.debug.useVsCodeJsDebug",
      resolvedPath: path.join(options.extensionsDir || defaultExtensionsDir(), "ms-vscode.js-debug"),
      commands: ["安装 OpenVSX 扩展 ms-vscode.js-debug"],
      nextAction: "安装 ms-vscode.js-debug 后重新运行扩展宿主和调试健康检查。",
      docsHint: "Codek 对标 VS Code/Cursor 时应优先复用官方 js-debug 扩展。",
    }),
  }
}

function resolvePythonAdapter(config = {}, options = {}) {
  const pythonCommand = config.pythonCommand || options.pythonCommand || "python"
  const bundled = config.debugpyPath
    ? { libsPath: config.debugpyPath, adapterMain: path.join(config.debugpyPath, "debugpy", "adapter", "__main__.py") }
    : findBundledDebugpy(options)
  const env = bundled ? {
    PYTHONPATH: [bundled.libsPath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
  } : undefined
  const probe = options.skipProbe ? { status: 0 } : spawnSync(pythonCommand, ["-c", "import debugpy.adapter"], {
    shell: false,
    stdio: "ignore",
    env: env ? { ...process.env, ...env } : process.env,
  })
  const available = probe.status === 0
  return {
    adapterType: "python",
    command: pythonCommand,
    args: ["-m", "debugpy.adapter"],
    env,
    available,
    source: bundled ? "ms-python.debugpy" : "debugpy",
    mode: "stdio",
    adapterPath: bundled?.adapterMain || "",
    message: available ? "已找到 Python debugpy adapter。" : "缺少 Python debugpy adapter，请安装 debugpy 或修正调试配置。",
    remediation: makeRemediation({
      category: "environment",
      configKey: "codek.debug.pythonCommand",
      resolvedPath: bundled?.adapterMain || pythonCommand,
      commands: ["python -m pip install debugpy"],
      nextAction: available
        ? "运行真实 Python DAP smoke，验证断点、栈帧、变量和 console 输出。"
        : "在当前 Python 环境安装 debugpy，或把 codek.debug.pythonCommand 指向已安装 debugpy 的解释器。",
      docsHint: "VS Code Python 调试依赖 debugpy adapter。",
    }),
  }
}

function resolveAdapter(adapterType, config = {}, options = {}) {
  const type = String(adapterType || config.type || "").toLowerCase()
  if (config.command) return resolveCustomAdapter(type, config)
  if (type === "node" || type === "pwa-node" || type === "node-terminal") return resolveNodeAdapter(config, options)
  if (type === "python") return resolvePythonAdapter(config, options)
  return {
    adapterType: type || "unknown",
    command: "",
    args: [],
    available: false,
    source: "unsupported",
    mode: "unsupported",
    message: type ? `暂不支持 ${type} 调试器。` : "缺少调试器类型。",
    remediation: makeRemediation({
      category: "product-risk",
      severity: "warning",
      nextAction: "补充该调试类型的 adapter resolver 后再进入真实调试 smoke。",
    }),
  }
}

function buildDebugAdapterHealth(input = {}) {
  const adapters = (input.adapters || ["node", "python"]).map((item) => {
    if (typeof item === "string") return resolveAdapter(item, {}, input)
    return resolveAdapter(item.type, item, input)
  })
  const checks = adapters.map((adapter) => ({
    id: `debug_adapter_${adapter.adapterType}`,
    title: `${adapter.adapterType} 调试器`,
    status: adapter.available && adapter.dapTransportReady !== false && adapter.sessionStartReady !== false ? "passed" : "warning",
    detail: adapter.message,
    nextAction: adapter.available && adapter.dapTransportReady !== false && adapter.sessionStartReady !== false ? "可执行真实 DAP smoke。" : adapter.remediation?.nextAction || "在设置或安装包中补齐 adapter，再运行真实调试 smoke。",
    warningCategory: adapter.available && adapter.dapTransportReady !== false && adapter.sessionStartReady !== false ? "" : adapter.remediation?.category || "environment",
    remediation: adapter.remediation || null,
  }))
  const summary = {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    warning: checks.filter((check) => check.status === "warning").length,
    failed: checks.filter((check) => check.status === "failed").length,
  }
  const status = summary.failed > 0 ? "blocked" : summary.warning > 0 ? "degraded" : "ready"
  return {
    reportKind: "debug-adapter-health",
    createdAt: Number(input.createdAt || Date.now()),
    status,
    statusLabel: status === "ready" ? "调试器可用" : status === "degraded" ? "调试器需要补齐 adapter" : "调试器阻断",
    ready: status === "ready",
    summary,
    checks,
    adapters,
    warningPolicy: checks
      .filter((check) => check.status === "warning")
      .map((check) => ({
        id: check.id,
        category: check.warningCategory || "environment",
        severity: "warning",
        blocking: { quick: false, full: false, strict: true },
        nextAction: check.nextAction,
      })),
  }
}

function debugAdapterHealthPaths(reportDir = defaultReadinessReportDir()) {
  const resolved = reportDir || defaultReadinessReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "debug-adapter-health-latest.json"),
    latestMarkdownPath: path.join(resolved, "debug-adapter-health-latest.md"),
  }
}

function saveDebugAdapterHealth(report, options = {}) {
  const paths = debugAdapterHealthPaths(options.reportDir)
  fs.mkdirSync(paths.reportDir, { recursive: true })
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${toDebugAdapterHealthMarkdown(report)}\n`, "utf8")
  return { ...paths, report }
}

function readLatestDebugAdapterHealth(options = {}) {
  const paths = debugAdapterHealthPaths(options.reportDir)
  if (!fs.existsSync(paths.latestJsonPath)) return { report: null, ...paths }
  return { report: JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8")), ...paths }
}

function toDebugAdapterHealthMarkdown(report) {
  const rows = (report.checks || []).map((check) =>
    `| ${check.title} | ${check.status} | ${String(check.detail || "").replace(/\|/g, "\\|")} | ${String(check.nextAction || "").replace(/\|/g, "\\|")} |`,
  )
  return [
    "# 调试器健康报告",
    "",
    `- 状态: ${report.statusLabel || report.status}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    "",
    "| 检查项 | 状态 | 详情 | 下一步 |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

module.exports = {
  buildDebugAdapterHealth,
  buildJsDebugBridgeFeasibility,
  debugAdapterHealthPaths,
  findBundledDebugpy,
  findJsDebugExtension,
  readLatestDebugAdapterHealth,
  resolveAdapter,
  saveDebugAdapterHealth,
  toDebugAdapterHealthMarkdown,
}
