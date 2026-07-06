#!/usr/bin/env node

/**
 * AT4: 安装后首次启动 smoke
 *
 * 不实际触发安装/卸载，只验证打包产物的关键启动契约：
 *   1. desktop/release/win-unpacked/Codek.exe 存在且可执行
 *   2. 主入口 main.js、preload.js、frontend dist 均已打入 win-unpacked/resources
 *   3. CSP meta 在打包后的 index.html 中存在
 *   4. 关键服务模块（agent/orchestrator/llm/extensions-host）均已打入
 *   5. 启动 smoke 契约脚本（electron-smoke-check.js / electron-ui-smoke.js）存在
 *
 * 真实点击安装器、首次写用户目录、启动登录页等动作仍由用户在授权环境执行；
 * 本脚本只生成契约级证据，不上传 telemetry，不写用户主目录。
 */

const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")

const root = path.resolve(__dirname, "..")
const desktopDir = path.join(root, "desktop")
const releaseDir = path.join(desktopDir, "release")
const unpackedDir = path.join(releaseDir, "win-unpacked")

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

function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
}

function check(id, title, status, detail, nextAction = "") {
  return { id, title, status, detail, nextAction }
}

function existsCheck(id, title, filePath, nextAction, severity = "warning") {
  const exists = fs.existsSync(filePath)
  const detail = exists
    ? `已找到 ${path.relative(root, filePath)}`
    : `缺少 ${path.relative(root, filePath)}`
  return check(id, title, exists ? "passed" : severity, detail, exists ? "" : nextAction)
}

function findUnpackedAsar() {
  const candidates = [
    path.join(unpackedDir, "resources", "app.asar"),
    path.join(unpackedDir, "resources", "app"),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function normalizeAsarEntry(entry) {
  return String(entry || "").replace(/^\\+/, "").replace(/\\/g, "/")
}

function hasAsarEntry(asarPath, entry) {
  try {
    const asar = require(path.join(desktopDir, "node_modules", "@electron", "asar"))
    const wanted = normalizeAsarEntry(entry)
    return asar.listPackage(asarPath).some((item) => normalizeAsarEntry(item) === wanted)
  } catch {
    return false
  }
}

function findPackagedFrontendIndex() {
  const unpackedFrontendIndex = path.join(unpackedDir, "resources", "app", "frontend-dist", "index.html")
  if (fs.existsSync(unpackedFrontendIndex)) {
    return { kind: "directory", displayPath: unpackedFrontendIndex }
  }

  const asarPath = path.join(unpackedDir, "resources", "app.asar")
  if (fs.existsSync(asarPath) && hasAsarEntry(asarPath, "frontend-dist/index.html")) {
    return { kind: "asar", displayPath: `${asarPath}/frontend-dist/index.html` }
  }

  const legacyDistIndex = path.join(unpackedDir, "resources", "app", "dist", "index.html")
  if (fs.existsSync(legacyDistIndex)) {
    return { kind: "legacy-directory", displayPath: legacyDistIndex }
  }
  if (fs.existsSync(asarPath) && hasAsarEntry(asarPath, "dist/index.html")) {
    return { kind: "legacy-asar", displayPath: `${asarPath}/dist/index.html` }
  }
  return null
}

function buildAt4InstallSmoke(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const checks = []

  // 1. 主可执行文件
  const exePath = path.join(unpackedDir, "Codek.exe")
  if (fs.existsSync(exePath)) {
    const stat = fs.statSync(exePath)
    checks.push(check(
      "unpacked_exe",
      "免安装包主程序 Codek.exe",
      "passed",
      `路径=${path.relative(root, exePath)}; 大小=${(stat.size / 1024 / 1024).toFixed(2)}MB`,
      "在授权环境运行该 exe，验证首次启动是否可达登录/欢迎页。",
    ))
  } else {
    checks.push(check(
      "unpacked_exe",
      "免安装包主程序 Codek.exe",
      "failed",
      `缺少 ${path.relative(root, exePath)}`,
      "运行 npm run pack:win，确认 win-unpacked 产物。",
    ))
  }

  // 2. NSIS 安装器
  const installerCandidates = fs.existsSync(releaseDir)
    ? fs.readdirSync(releaseDir).filter((name) => /\.exe$/i.test(name) && /setup/i.test(name))
    : []
  if (installerCandidates.length > 0) {
    const installer = installerCandidates[0]
    const installerPath = path.join(releaseDir, installer)
    const stat = fs.statSync(installerPath)
    const sha256 = stat.size <= 1024 * 1024 * 500 ? fileSha256(installerPath) : ""
    checks.push(check(
      "nsis_installer",
      "NSIS 安装器",
      "passed",
      `${installer}; ${(stat.size / 1024 / 1024).toFixed(2)}MB; sha256=${sha256.slice(0, 16) || "-"}`,
      "在授权环境双击安装，记录安装目录、桌面快捷方式、开始菜单和卸载项。",
    ))
  } else {
    checks.push(check(
      "nsis_installer",
      "NSIS 安装器",
      "warning",
      `${path.relative(root, releaseDir)} 下未找到 *Setup*.exe`,
      "首轮内测可只用 win-unpacked 直接运行；正式分发前需在授权环境补 NSIS 安装器。",
    ))
  }

  // 3. resources / app 资源
  const asarPath = findUnpackedAsar()
  if (asarPath) {
    checks.push(check(
      "app_resources",
      "应用资源 app.asar / app/",
      "passed",
      `${path.relative(root, asarPath)} 存在`,
      "首次启动时 Electron 将从该资源加载主进程与渲染进程。",
    ))
  } else {
    checks.push(check(
      "app_resources",
      "应用资源 app.asar / app/",
      "failed",
      `${path.relative(root, path.join(unpackedDir, "resources"))} 下缺少 app.asar 或 app/`,
      "重新运行 npm run pack:win，确认 build.files 配置正确。",
    ))
  }

  // 4. 主入口 / preload 源文件存在（构建时才会被打入）
  checks.push(existsCheck("desktop_main_source", "主入口源文件 desktop/main.js", path.join(desktopDir, "main.js"), "补齐 desktop/main.js。", "failed"))
  checks.push(existsCheck("desktop_preload_source", "preload 源文件 desktop/preload.js", path.join(desktopDir, "preload.js"), "补齐 desktop/preload.js。", "failed"))

  // 5. CSP 注入
  const packagedFrontendIndex = findPackagedFrontendIndex()
  if (packagedFrontendIndex) {
    checks.push(check(
      "packaged_frontend_dist",
      "打包内置前端 dist/index.html",
      "passed",
      `${path.relative(root, packagedFrontendIndex.displayPath)} 存在; mode=${packagedFrontendIndex.kind}`,
      "",
    ))
  } else {
    checks.push(check(
      "packaged_frontend_dist",
      "打包内置前端 dist/index.html",
      "failed",
      "win-unpacked/resources/app.asar/frontend-dist/index.html 缺失",
      "重新运行 npm run pack:win，确保 scripts/build.js 已同步 frontend dist 且 desktop/package.json files 包含 frontend-dist/**。",
    ))
  }

  const distHtml = path.join(root, "frontend", "vite-project", "dist", "index.html")
  if (fs.existsSync(distHtml)) {
    const html = fs.readFileSync(distHtml, "utf8")
    const hasCsp = html.includes('http-equiv="Content-Security-Policy"')
    checks.push(check(
      "frontend_csp",
      "前端 CSP meta",
      hasCsp ? "passed" : "warning",
      hasCsp ? "dist/index.html 已包含 CSP meta" : "dist/index.html 未包含 CSP meta",
      hasCsp ? "" : "运行 npm run build:frontend，会自动注入 CSP。",
    ))
  } else {
    checks.push(check(
      "frontend_csp",
      "前端 CSP meta",
      "failed",
      "frontend/vite-project/dist/index.html 不存在",
      "先运行 npm run build:frontend。",
    ))
  }

  // 6. 关键服务模块存在
  const serviceModules = [
    ["services_agent_loop", "Agent loop 服务", "services/agentLoop/index.js"],
    ["services_orchestrator", "Orchestrator 路由", "services/agentLoop/orchestratorRoutes.js"],
    ["services_llm", "LLM 服务", "services/llm/index.js"],
    ["services_extensions_host", "Extensions Host", "services/extensions-host/extensionManager.js"],
    ["services_goal_scheduler", "Goal Scheduler", "services/goalScheduler/index.js"],
  ]
  for (const [id, title, rel] of serviceModules) {
    checks.push(existsCheck(id, title, path.join(desktopDir, rel), `补齐 desktop/${rel}。`, "failed"))
  }

  // 7. 启动 smoke 契约脚本
  checks.push(existsCheck(
    "electron_smoke_check_script",
    "electron-smoke-check 契约脚本",
    path.join(root, "scripts", "electron-smoke-check.js"),
    "补齐 scripts/electron-smoke-check.js，作为打包后启动 smoke 入口。",
    "failed",
  ))
  checks.push(existsCheck(
    "electron_ui_smoke_script",
    "electron-ui-smoke 契约脚本",
    path.join(root, "scripts", "electron-ui-smoke.js"),
    "补齐 scripts/electron-ui-smoke.js，覆盖登录态/工作台/ChatAI/Orchestrator 关键 DOM。",
    "failed",
  ))

  // 8. 用户数据目录策略说明（不写用户目录，仅声明）
  checks.push(check(
    "electron_packaged_smoke_command",
    "packaged Electron UI smoke 命令",
    "passed",
    "npm run smoke:packaged 会从 desktop/release/win-unpacked/Codek.exe 启动真实打包应用",
    "",
  ))

  const desktopPackageJson = readJsonSafe(path.join(desktopDir, "package.json")) || {}
  const productName = desktopPackageJson.build?.productName || desktopPackageJson.name
  checks.push(check(
    "user_data_dir_policy",
    "用户数据目录策略",
    productName ? "passed" : "warning",
    productName
      ? `productName=${productName}，首次启动后用户数据将位于 %APPDATA%/${productName}`
      : "build.productName 缺失，无法解释用户数据目录",
    "首次启动 smoke 必须在授权环境执行，并记录用户数据目录是否被正确创建、是否包含敏感信息。",
  ))

  const summary = {
    total: checks.length,
    passed: checks.filter((item) => item.status === "passed").length,
    warning: checks.filter((item) => item.status === "warning").length,
    failed: checks.filter((item) => item.status === "failed").length,
  }
  const ready = summary.failed === 0
  const status = !ready ? "blocked" : summary.warning > 0 ? "degraded" : "ready"

  return {
    reportKind: "at4-install-smoke",
    createdAt,
    ready,
    status,
    statusLabel: status === "ready"
      ? "AT4 安装后启动 smoke 契约通过"
      : status === "degraded"
        ? "AT4 安装后启动 smoke 契约需复核"
        : "AT4 安装后启动 smoke 契约阻断",
    summary,
    checks,
    scope: {
      realInstallExecuted: false,
      realLaunchExecuted: input.realLaunchExecuted === true,
      note: "本脚本只验证契约和打包产物存在性。真实安装、首次启动、登录态 smoke 必须在授权环境运行。",
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
    latestJsonPath: path.join(resolved, "at4-install-smoke-latest.json"),
    latestMarkdownPath: path.join(resolved, "at4-install-smoke-latest.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function toMarkdown(report) {
  const rows = (report.checks || []).map((c) =>
    `| ${escape(c.title)} | ${c.status} | ${escape(c.detail)} | ${escape(c.nextAction || "-")} |`,
  )
  return [
    "# AT4 安装后首次启动 smoke 契约",
    "",
    `- 状态: ${report.statusLabel}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Created At: ${new Date(report.createdAt).toISOString()}`,
    `- Summary: ${report.summary.passed}/${report.summary.total} 通过，${report.summary.warning} warning，${report.summary.failed} failed`,
    "",
    "| 检查 | 状态 | 详情 | 下一步 |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## 边界",
    "",
    "- 本脚本不实际安装、不实际启动 Electron、不写用户主目录。",
    "- 真实首次启动、登录态 smoke、用户数据目录验证必须由授权环境的人工流程执行。",
    "- 未上传 telemetry，不保存 prompt/response 正文。",
  ].join("\n")
}

function escape(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function save(report, options = {}) {
  const p = paths(options.reportDir)
  fs.mkdirSync(p.reportDir, { recursive: true })
  fs.mkdirSync(p.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJson = path.join(p.historyDir, `at4-install-smoke-${stamp}.json`)
  const historyMd = path.join(p.historyDir, `at4-install-smoke-${stamp}.md`)
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
  const report = buildAt4InstallSmoke()
  const saved = noWrite ? { latestJsonPath: "", latestMarkdownPath: "" } : save(report, { reportDir })
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    nextActions: report.nextActions,
    jsonPath: saved.latestJsonPath || "",
    markdownPath: saved.latestMarkdownPath || "",
  }, null, 2)}\n`)
  process.exit(report.summary.failed > 0 ? 1 : 0)
}

module.exports = {
  buildAt4InstallSmoke,
  save,
  readLatest,
  toMarkdown,
}
