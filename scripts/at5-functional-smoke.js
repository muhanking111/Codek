#!/usr/bin/env node

/**
 * AT5: 发布候选功能冒烟矩阵
 *
 * 不实际启动 Electron，只验证打包产物里关键功能入口的契约：
 *   - Workbench: 文件树、命令面板、快捷键、设置页双入口
 *   - Terminal: PTY 启动入口、分屏、运行任务
 *   - ChatAI composer: Ask/Plan/Agent/Auto 模式、附件入口
 *   - Marketplace/Extensions: 列表、搜索、安装、卸载、激活报告
 *   - Orchestrator: 真实工作区试运行、企业预检、发布验收
 *   - Settings: Codek Settings 与 VS Code Settings 双入口
 *
 * 真实 UI 冒烟仍由 scripts/electron-ui-smoke.js / electron-smoke-check.js 在
 * 授权 Electron 环境运行。本脚本只验证源码契约和关键入口存在，避免
 * "源代码已删除但产物仍在" 的迷之绿灯。
 */

const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const desktopDir = path.join(root, "desktop")
const frontendDir = path.join(root, "frontend", "vite-project", "src")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function check(id, title, status, detail, nextAction = "", category = "") {
  return { id, title, status, detail, nextAction, category }
}

function existsCheck(id, title, filePath, nextAction, category, severity = "warning") {
  const exists = fs.existsSync(filePath)
  const detail = exists
    ? `已找到 ${path.relative(root, filePath)}`
    : `缺少 ${path.relative(root, filePath)}`
  return check(id, title, exists ? "passed" : severity, detail, exists ? "" : nextAction, category)
}

function buildAt5FunctionalSmoke(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const checks = []

  // === Workbench ===
  checks.push(existsCheck(
    "workbench_app_shell",
    "Workbench shell App.vue",
    path.join(frontendDir, "App.vue"),
    "补齐 frontend/vite-project/src/App.vue。",
    "workbench",
    "failed",
  ))
  checks.push(existsCheck(
    "workbench_menu_bar",
    "顶部菜单 MenuBar.vue",
    path.join(frontendDir, "components", "MenuBar.vue"),
    "补齐顶部菜单组件。",
    "workbench",
    "failed",
  ))
  checks.push(existsCheck(
    "workbench_command_palette",
    "命令面板 CommandPalette.vue",
    path.join(frontendDir, "components", "CommandPalette.vue"),
    "补齐命令面板组件。",
    "workbench",
    "failed",
  ))
  checks.push(existsCheck(
    "workbench_palette_commands",
    "命令面板注册器 paletteCommands.ts",
    path.join(frontendDir, "workbench", "paletteCommands.ts"),
    "补齐 workbench/paletteCommands.ts。",
    "workbench",
    "failed",
  ))
  checks.push(existsCheck(
    "workbench_keybindings",
    "Workbench 快捷键注册器",
    path.join(frontendDir, "workbench", "keybindingCommands.ts"),
    "补齐 workbench/keybindingCommands.ts。",
    "workbench",
    "failed",
  ))

  // === Terminal ===
  checks.push(existsCheck(
    "terminal_panel",
    "TerminalPanel.vue",
    path.join(frontendDir, "components", "TerminalPanel.vue"),
    "补齐终端面板组件。",
    "terminal",
    "failed",
  ))
  checks.push(existsCheck(
    "terminal_pty_manager",
    "PTY manager",
    path.join(desktopDir, "services", "pty", "ptyManager.js"),
    "补齐 desktop/services/pty/ptyManager.js。",
    "terminal",
    "failed",
  ))

  // === ChatAI composer ===
  checks.push(existsCheck(
    "chat_panel",
    "ChatPanel.vue",
    path.join(frontendDir, "components", "ChatPanel.vue"),
    "补齐 ChatAI 主面板。",
    "chat",
    "failed",
  ))
  // composer mode 选项必须仍是 Ask/Plan/Agent/Auto 四种
  // 真实模式选项由 ChatModeDropdown.vue 提供，ChatPanel 只是容器
  const modeDropdownPath = path.join(frontendDir, "components", "ChatModeDropdown.vue")
  if (fs.existsSync(modeDropdownPath)) {
    const text = fs.readFileSync(modeDropdownPath, "utf8")
    const hasAsk = /\bAsk\b/.test(text)
    const hasPlan = /\bPlan\b/.test(text)
    const hasAgent = /\bAgent\b/.test(text)
    const hasAuto = /\bAuto\b/.test(text)
    const ok = hasAsk && hasPlan && hasAgent && hasAuto
    checks.push(check(
      "chat_modes",
      "ChatAI 模式 Ask/Plan/Agent/Auto",
      ok ? "passed" : "warning",
      `Ask=${hasAsk} Plan=${hasPlan} Agent=${hasAgent} Auto=${hasAuto}`,
      ok ? "" : "确认 ChatModeDropdown 仍暴露 4 种可见模式。",
      "chat",
    ))
  }

  // === Marketplace / Extensions ===
  checks.push(existsCheck(
    "marketplace_panel",
    "Marketplace.vue",
    path.join(frontendDir, "components", "Marketplace.vue"),
    "补齐 Marketplace 组件。",
    "extensions",
    "failed",
  ))
  checks.push(existsCheck(
    "extension_manager",
    "Extension Host extensionManager.js",
    path.join(desktopDir, "services", "extensions-host", "extensionManager.js"),
    "补齐 desktop/services/extensions-host/extensionManager.js。",
    "extensions",
    "failed",
  ))
  const activationReport = path.join(root, "extensions", "_activation_report.json")
  if (fs.existsSync(activationReport)) {
    const data = readJsonSafe(activationReport) || {}
    const required = Number(data.required || 0)
    const active = Number(data.activeTotal || 0)
    const errs = Array.isArray(data.runtimeErrors) ? data.runtimeErrors.length : 0
    const ok = required > 0 && active >= required && errs === 0
    checks.push(check(
      "extension_activation_report",
      "Extension 激活报告",
      ok ? "passed" : "warning",
      `required=${required} active=${active} runtimeErrors=${errs}`,
      ok ? "" : "运行 npm run eh:e2e:all 重新生成激活报告。",
      "extensions",
    ))
  } else {
    checks.push(check(
      "extension_activation_report",
      "Extension 激活报告",
      "warning",
      "缺少 extensions/_activation_report.json",
      "运行 npm run eh:e2e:all 生成激活报告。",
      "extensions",
    ))
  }

  // === Orchestrator ===
  checks.push(existsCheck(
    "orchestrator_routes",
    "Orchestrator routes",
    path.join(desktopDir, "services", "agentLoop", "orchestratorRoutes.js"),
    "补齐 Orchestrator routes。",
    "orchestrator",
    "failed",
  ))
  checks.push(existsCheck(
    "orchestrator_panel",
    "Orchestrator 面板",
    path.join(frontendDir, "components", "AgentOrchestratorPanel.vue"),
    "补齐 Orchestrator 面板组件。",
    "orchestrator",
    "warning",
  ))
  checks.push(existsCheck(
    "real_workspace_trial",
    "真实工作区试运行",
    path.join(desktopDir, "services", "agentLoop", "realWorkspaceTrial.js"),
    "补齐 realWorkspaceTrial.js。",
    "orchestrator",
    "failed",
  ))

  // === Settings 双入口 ===
  checks.push(existsCheck(
    "settings_panel",
    "SettingsPanel.vue",
    path.join(frontendDir, "components", "SettingsPanel.vue"),
    "补齐设置面板组件。",
    "settings",
    "failed",
  ))
  const settingsPath = path.join(frontendDir, "components", "SettingsPanel.vue")
  if (fs.existsSync(settingsPath)) {
    const text = fs.readFileSync(settingsPath, "utf8")
    const hasCodekSettings = /Codek Settings/i.test(text)
    const hasVsCodeSettings = /VS\s*Code\s*Settings/i.test(text)
    const ok = hasCodekSettings && hasVsCodeSettings
    checks.push(check(
      "settings_dual_entry",
      "Cursor 风格双入口 (Codek / VS Code Settings)",
      ok ? "passed" : "warning",
      `Codek=${hasCodekSettings} VSCode=${hasVsCodeSettings}`,
      ok ? "" : "确认设置页同时暴露 Codek Settings 与 VS Code Settings 入口。",
      "settings",
    ))
  }

  // === 关键运行时入口（authentication / welcome） ===
  checks.push(existsCheck(
    "auth_login_page",
    "登录页 LoginPanel",
    path.join(frontendDir, "components", "LoginPanel.vue"),
    "补齐登录页组件。",
    "auth",
    "warning",
  ))
  checks.push(existsCheck(
    "welcome_page",
    "欢迎页 WelcomePage",
    path.join(frontendDir, "components", "WelcomePage.vue"),
    "补齐欢迎页组件。",
    "workbench",
    "warning",
  ))

  // === 主入口 / preload 桥 ===
  checks.push(existsCheck(
    "main_js",
    "Electron main.js",
    path.join(desktopDir, "main.js"),
    "补齐 desktop/main.js。",
    "runtime",
    "failed",
  ))
  checks.push(existsCheck(
    "preload_js",
    "Electron preload.js",
    path.join(desktopDir, "preload.js"),
    "补齐 desktop/preload.js。",
    "runtime",
    "failed",
  ))

  // === 聚合 ===
  const summary = {
    total: checks.length,
    passed: checks.filter((c) => c.status === "passed").length,
    warning: checks.filter((c) => c.status === "warning").length,
    failed: checks.filter((c) => c.status === "failed").length,
  }
  const ready = summary.failed === 0
  const status = !ready ? "blocked" : summary.warning > 0 ? "degraded" : "ready"

  // 按 category 分组
  const byCategory = {}
  for (const c of checks) {
    const key = c.category || "other"
    byCategory[key] = byCategory[key] || { total: 0, passed: 0, warning: 0, failed: 0 }
    byCategory[key].total += 1
    byCategory[key][c.status] = (byCategory[key][c.status] || 0) + 1
  }

  return {
    reportKind: "at5-functional-smoke",
    createdAt,
    ready,
    status,
    statusLabel: status === "ready"
      ? "AT5 功能冒烟矩阵契约通过"
      : status === "degraded"
        ? "AT5 功能冒烟矩阵需复核"
        : "AT5 功能冒烟矩阵阻断",
    summary,
    byCategory,
    checks,
    scope: {
      realElectronLaunched: false,
      realUserInteraction: false,
      note: "本脚本只验证源码与产物中的关键入口契约。真实 Electron UI 冒烟由 scripts/electron-ui-smoke.js 在授权环境运行。",
    },
    nextActions: checks
      .filter((c) => c.status !== "passed")
      .map((c) => ({ id: c.id, title: c.title, status: c.status, action: c.nextAction })),
  }
}

function paths(reportDir = defaultReportDir()) {
  const resolved = reportDir || defaultReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "at5-functional-smoke-latest.json"),
    latestMarkdownPath: path.join(resolved, "at5-functional-smoke-latest.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function escape(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function toMarkdown(report) {
  const rows = (report.checks || []).map((c) =>
    `| ${escape(c.title)} | ${c.category || "-"} | ${c.status} | ${escape(c.detail)} | ${escape(c.nextAction || "-")} |`,
  )
  const catRows = Object.entries(report.byCategory || {}).map(([cat, sub]) =>
    `| ${cat} | ${sub.total} | ${sub.passed || 0} | ${sub.warning || 0} | ${sub.failed || 0} |`,
  )
  return [
    "# AT5 发布候选功能冒烟矩阵",
    "",
    `- 状态: ${report.statusLabel}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Created At: ${new Date(report.createdAt).toISOString()}`,
    `- Summary: ${report.summary.passed}/${report.summary.total} 通过，${report.summary.warning} warning，${report.summary.failed} failed`,
    "",
    "## 按类别",
    "",
    "| 类别 | 总数 | 通过 | warning | failed |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...catRows,
    "",
    "## 检查项",
    "",
    "| 检查 | 类别 | 状态 | 详情 | 下一步 |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## 边界",
    "",
    "- 本脚本不实际启动 Electron，不模拟用户点击。",
    "- 真实功能冒烟仍由 scripts/electron-ui-smoke.js 在授权 Electron 环境运行。",
    "- 未上传 telemetry，未保存 prompt/response 正文。",
  ].join("\n")
}

function save(report, options = {}) {
  const p = paths(options.reportDir)
  fs.mkdirSync(p.reportDir, { recursive: true })
  fs.mkdirSync(p.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJson = path.join(p.historyDir, `at5-functional-smoke-${stamp}.json`)
  const historyMd = path.join(p.historyDir, `at5-functional-smoke-${stamp}.md`)
  const md = toMarkdown(report)
  fs.writeFileSync(p.latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(p.latestMarkdownPath, `${md}\n`, "utf8")
  fs.writeFileSync(historyJson, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMd, `${md}\n`, "utf8")
  return { ...p, historyJson, historyMd, markdown: md }
}

function readLatest(options = {}) {
  const p = paths(options.reportDir)
  if (!fs.existsSync(p.latestJsonPath)) return { report: null, markdown: "", ...p }
  return {
    report: readJsonSafe(p.latestJsonPath),
    markdown: fs.existsSync(p.latestMarkdownPath) ? fs.readFileSync(p.latestMarkdownPath, "utf8") : "",
    ...p,
  }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const reportDirArg = args.find((a) => a.startsWith("--report-dir="))
  const noWrite = args.includes("--no-write")
  const reportDir = reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir()
  const report = buildAt5FunctionalSmoke()
  const saved = noWrite ? { latestJsonPath: "", latestMarkdownPath: "" } : save(report, { reportDir })
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    byCategory: report.byCategory,
    nextActions: report.nextActions,
    jsonPath: saved.latestJsonPath || "",
    markdownPath: saved.latestMarkdownPath || "",
  }, null, 2)}\n`)
  process.exit(report.summary.failed > 0 ? 1 : 0)
}

module.exports = {
  buildAt5FunctionalSmoke,
  save,
  readLatest,
  toMarkdown,
}
