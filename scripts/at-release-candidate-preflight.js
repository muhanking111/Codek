const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const { spawnSync } = require("node:child_process")

const root = path.resolve(__dirname, "..")
const desktopDir = path.join(root, "desktop")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const artifactDirArg = argv.find((arg) => arg.startsWith("--artifact-dir="))
  return {
    noWrite: argv.includes("--no-write"),
    strict: argv.includes("--strict"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
    artifactDir: artifactDirArg ? artifactDirArg.slice("--artifact-dir=".length) : path.join(desktopDir, "release"),
  }
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

function check(id, title, status, detail, nextAction = "", extra = {}) {
  return {
    id,
    title,
    status,
    detail,
    nextAction,
    ...extra,
  }
}

function existsCheck(id, title, filePath, nextAction, severity = "warning") {
  const exists = fs.existsSync(filePath)
  return check(
    id,
    title,
    exists ? "passed" : severity,
    exists ? `已找到 ${filePath}` : `缺少 ${filePath}`,
    exists ? "" : nextAction,
    { filePath },
  )
}

function commandCheck(id, title, command, args, cwd, nextAction, severity = "warning") {
  const result = spawnSync(command, args, {
    cwd,
    shell: process.platform === "win32",
    stdio: "ignore",
  })
  const passed = result.status === 0
  return check(
    id,
    title,
    passed ? "passed" : severity,
    passed ? `${command} ${args.join(" ")} 可执行。` : `${command} ${args.join(" ")} 不可执行或返回 ${result.status ?? "error"}。`,
    passed ? "" : nextAction,
  )
}

function localCliCheck(id, title, nodeModulesDir, packageName, binName, nextAction, severity = "warning") {
  const packageJsonPath = path.join(nodeModulesDir, packageName, "package.json")
  const packageJson = readJsonSafe(packageJsonPath)
  const binCandidates = [
    path.join(nodeModulesDir, ".bin", `${binName}.cmd`),
    path.join(nodeModulesDir, ".bin", binName),
  ]
  const binPath = binCandidates.find((candidate) => fs.existsSync(candidate))
  const passed = Boolean(packageJson && binPath)
  return check(
    id,
    title,
    passed ? "passed" : severity,
    passed
      ? `${packageJson.name || packageName}@${packageJson.version || "-"}; bin=${path.relative(nodeModulesDir, binPath)}`
      : `缺少 ${packageJsonPath} 或 ${path.join(nodeModulesDir, ".bin", binName)}`,
    passed ? "" : nextAction,
  )
}

function listArtifacts(artifactDir) {
  if (!fs.existsSync(artifactDir)) return []
  const names = fs.readdirSync(artifactDir)
  return names
    .map((name) => path.join(artifactDir, name))
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile())
    .filter((filePath) => /\.(exe|msi|dmg|appimage|deb|zip|blockmap|yml)$/i.test(filePath))
    .map((filePath) => {
      const stat = fs.statSync(filePath)
      return {
        name: path.basename(filePath),
        path: filePath,
        sizeBytes: stat.size,
        sizeMb: Number((stat.size / 1024 / 1024).toFixed(2)),
        sha256: stat.size <= 1024 * 1024 * 500 ? fileSha256(filePath) : "",
      }
    })
    .sort((a, b) => b.sizeBytes - a.sizeBytes)
}

function buildAtReleaseCandidatePreflight(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const packageJson = input.packageJson || readJsonSafe(path.join(root, "package.json")) || {}
  const desktopPackageJson = input.desktopPackageJson || readJsonSafe(path.join(desktopDir, "package.json")) || {}
  const nodeModulesDir = input.nodeModulesDir || path.join(desktopDir, "node_modules")
  const build = desktopPackageJson.build || {}
  const scripts = packageJson.scripts || {}
  const desktopScripts = desktopPackageJson.scripts || {}
  const artifactDir = input.artifactDir || path.join(desktopDir, "release")
  const artifacts = input.artifacts || listArtifacts(artifactDir)
  const frontendDist = path.join(root, "frontend", "vite-project", "dist", "index.html")
  const checks = []

  checks.push(check(
    "root_pack_scripts",
    "根 package 打包脚本",
    scripts["pack:win"] && scripts["pack:mac"] && scripts["pack:linux"] ? "passed" : "failed",
    `pack:win=${scripts["pack:win"] || "-"}; pack:mac=${scripts["pack:mac"] || "-"}; pack:linux=${scripts["pack:linux"] || "-"}`,
    "补齐根 package.json 的 pack:win / pack:mac / pack:linux 脚本。",
  ))
  checks.push(check(
    "desktop_builder_config",
    "electron-builder 基础配置",
    build.appId && build.productName && build.directories?.output && Array.isArray(build.files) ? "passed" : "failed",
    `appId=${build.appId || "-"}; productName=${build.productName || "-"}; output=${build.directories?.output || "-"}`,
    "补齐 desktop/package.json build.appId/productName/directories/files。",
  ))
  checks.push(check(
    "desktop_platform_targets",
    "平台 target 配置",
    build.win?.target && build.mac?.target && build.linux?.target ? "passed" : "failed",
    `win=${JSON.stringify(build.win?.target || [])}; mac=${JSON.stringify(build.mac?.target || [])}; linux=${JSON.stringify(build.linux?.target || [])}`,
    "补齐 Windows/macOS/Linux target 配置。",
  ))
  checks.push(check(
    "desktop_pack_scripts",
    "desktop 打包脚本",
    desktopScripts["pack:win"] && desktopScripts["pack:mac"] && desktopScripts["pack:linux"] ? "passed" : "failed",
    `pack:win=${desktopScripts["pack:win"] || "-"}; pack:mac=${desktopScripts["pack:mac"] || "-"}; pack:linux=${desktopScripts["pack:linux"] || "-"}`,
    "补齐 desktop/package.json 的 pack:win / pack:mac / pack:linux。",
  ))
  checks.push(existsCheck("frontend_dist", "前端 dist 产物", frontendDist, "先运行 npm run build 或 npm run build:frontend。", "failed"))
  checks.push(existsCheck("desktop_main", "Electron 主入口", path.join(desktopDir, "main.js"), "补齐 desktop/main.js。", "failed"))
  checks.push(existsCheck("desktop_preload", "Electron preload", path.join(desktopDir, "preload.js"), "补齐 desktop/preload.js。", "failed"))
  checks.push(localCliCheck(
    "electron_builder_cli",
    "electron-builder CLI",
    nodeModulesDir,
    "electron-builder",
    "electron-builder",
    "确认 desktop 依赖已安装。",
  ))
  checks.push(localCliCheck(
    "electron_rebuild_cli",
    "electron-rebuild CLI",
    nodeModulesDir,
    "@electron/rebuild",
    "electron-rebuild",
    "确认 @electron/rebuild 已安装，并在授权环境运行 electron-rebuild。",
  ))
  checks.push(check(
    "windows_icon",
    "Windows 图标",
    fs.existsSync(path.join(desktopDir, build.win?.icon || "assets/icon.ico")) ? "passed" : "warning",
    build.win?.icon || "assets/icon.ico",
    "补齐 Windows installer icon，避免打包时使用默认图标或失败。",
  ))
  checks.push(check(
    "mac_entitlements",
    "macOS entitlements",
    build.mac?.entitlements && fs.existsSync(path.join(desktopDir, build.mac.entitlements)) ? "passed" : "warning",
    build.mac?.entitlements || "-",
    "补齐 macOS entitlements，后续签名/公证需要它。",
  ))
  checks.push(check(
    "publish_not_real",
    "发布渠道安全边界",
    build.publish?.repo === "codek-releases" && build.publish?.owner === "codek" ? "warning" : "passed",
    build.publish ? JSON.stringify(build.publish) : "未配置 publish",
    "当前 publish 看起来是占位配置。真实发布前必须改成真实仓库并由用户授权，不得自动发布。",
    { warningCategory: "release-safety" },
  ))
  checks.push(check(
    "installer_artifacts",
    "安装包产物",
    artifacts.length > 0 ? "passed" : "warning",
    artifacts.length ? `${artifacts.length} 个候选产物，最大 ${artifacts[0].name} ${artifacts[0].sizeMb}MB` : `未在 ${artifactDir} 找到安装包产物`,
    "授权后运行 npm run pack:win，再验证 desktop/release 下的安装包、大小和 hash。",
    { artifacts },
  ))
  checks.push(check(
    "post_install_smoke_contract",
    "安装后 smoke 契约",
    fs.existsSync(path.join(root, "scripts", "electron-ui-smoke.js")) && fs.existsSync(path.join(root, "scripts", "electron-smoke-check.js")) ? "passed" : "failed",
    "electron-ui-smoke.js / electron-smoke-check.js",
    "补齐安装后首次启动、登录态和工作台 smoke 脚本。",
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
    reportKind: "at-release-candidate-preflight",
    createdAt,
    ready,
    status,
    statusLabel: status === "ready" ? "AT 发布候选预检通过" : status === "degraded" ? "AT 发布候选预检需复核" : "AT 发布候选预检阻断",
    summary,
    checks,
    artifacts,
    artifactDir,
    nextActions: buildNextActions(checks),
    scope: {
      realPackagingExecuted: false,
      realPublishExecuted: false,
      signingExecuted: false,
      note: "本预检不执行真实打包、签名、公证、安装或发布。",
    },
  }
}

function buildNextActions(checks) {
  return checks
    .filter((item) => item.status === "failed" || item.status === "warning")
    .map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      action: item.nextAction,
    }))
}

function atPreflightPaths(reportDir = defaultReportDir()) {
  const resolved = reportDir || defaultReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "at-release-candidate-preflight-latest.json"),
    latestMarkdownPath: path.join(resolved, "at-release-candidate-preflight-latest.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function saveAtReleaseCandidatePreflight(report, options = {}) {
  const paths = atPreflightPaths(options.reportDir)
  fs.mkdirSync(paths.reportDir, { recursive: true })
  fs.mkdirSync(paths.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJsonPath = path.join(paths.historyDir, `at-release-candidate-preflight-${stamp}.json`)
  const historyMarkdownPath = path.join(paths.historyDir, `at-release-candidate-preflight-${stamp}.md`)
  const markdown = toMarkdown(report)
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${markdown}\n`, "utf8")
  fs.writeFileSync(historyJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMarkdownPath, `${markdown}\n`, "utf8")
  return { ...paths, historyJsonPath, historyMarkdownPath, report, markdown }
}

function readLatestAtReleaseCandidatePreflight(options = {}) {
  const paths = atPreflightPaths(options.reportDir)
  if (!fs.existsSync(paths.latestJsonPath)) return { report: null, markdown: "", ...paths }
  return {
    report: readJsonSafe(paths.latestJsonPath),
    markdown: fs.existsSync(paths.latestMarkdownPath) ? fs.readFileSync(paths.latestMarkdownPath, "utf8") : "",
    ...paths,
  }
}

function toMarkdown(report) {
  const rows = (report.checks || []).map((item) =>
    `| ${escapeCell(item.title)} | ${item.status} | ${escapeCell(item.detail)} | ${escapeCell(item.nextAction || "-")} |`,
  )
  const artifactRows = (report.artifacts || []).map((item) =>
    `| ${escapeCell(item.name)} | ${item.sizeMb}MB | ${escapeCell(item.sha256 || "-")} | ${escapeCell(item.path)} |`,
  )
  return [
    "# AT 发布候选与安装闭环预检",
    "",
    `- 状态: ${report.statusLabel || report.status}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Created At: ${new Date(report.createdAt || Date.now()).toISOString()}`,
    `- Summary: ${report.summary.passed}/${report.summary.total} 通过，${report.summary.warning} warning，${report.summary.failed} failed`,
    "",
    "| 检查 | 状态 | 详情 | 下一步 |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## 安装包产物",
    "",
    "| 文件 | 大小 | SHA256 | 路径 |",
    "| --- | ---: | --- | --- |",
    ...(artifactRows.length ? artifactRows : ["| - | - | - | 尚未生成安装包 |"]),
    "",
    "## 边界",
    "",
    "- 本报告不执行真实打包、安装、签名、公证或发布。",
    "- 真实发布前必须由用户明确授权运行 pack、签名、公证、上传或发布命令。",
  ].join("\n")
}

function escapeCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = buildAtReleaseCandidatePreflight(options)
  const saved = options.noWrite ? { report, markdown: toMarkdown(report) } : saveAtReleaseCandidatePreflight(report, options)
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

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`)
    process.exit(1)
  })
}

module.exports = {
  atPreflightPaths,
  buildAtReleaseCandidatePreflight,
  defaultReportDir,
  parseArgs,
  readLatestAtReleaseCandidatePreflight,
  saveAtReleaseCandidatePreflight,
  toMarkdown,
}
