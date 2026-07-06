#!/usr/bin/env node

/**
 * AT6: 发布候选证据链
 *
 * 汇总 AT 线所有阶段证据为一份可人工验收的本地证据包：
 *   - AT1 packaging-preflight
 *   - AT2 electron-rebuild-check
 *   - AT3 package-artifacts
 *   - AT4 install-smoke
 *   - AT5 functional-smoke
 *   - 已有 AT release candidate preflight、release evidence、release gate
 *
 * 产出 .codek/reports/at6-release-candidate-evidence-latest.json/md，包含：
 *   - 候选版本号、平台、产物路径、大小、hash
 *   - 各阶段 ready / warning / failed 状态
 *   - 全局 gaps 与 nextActions
 *   - "内测允许 / 正式发布阻断 / 手动复核" 三档分类（与 AT7 共享）
 *
 * 不上传、不发布、不发 PR、不写用户主目录。
 */

const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")

const root = path.resolve(__dirname, "..")
const desktopDir = path.join(root, "desktop")

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

function loadStageReport(reportDir, fileName) {
  const jsonPath = path.join(reportDir, fileName)
  const mdPath = jsonPath.replace(/\.json$/i, ".md")
  const report = readJsonSafe(jsonPath)
  return {
    available: Boolean(report),
    jsonPath,
    markdownPath: fs.existsSync(mdPath) ? mdPath : "",
    report,
  }
}

function listArtifacts(releaseDir) {
  if (!fs.existsSync(releaseDir)) return []
  const out = []
  for (const name of fs.readdirSync(releaseDir)) {
    const filePath = path.join(releaseDir, name)
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) continue
    if (!/\.(exe|msi|dmg|appimage|deb|zip|blockmap|yml)$/i.test(name)) continue
    const sha256 = stat.size <= 1024 * 1024 * 600 ? fileSha256(filePath) : ""
    out.push({
      name,
      path: filePath,
      sizeBytes: stat.size,
      sizeMb: Number((stat.size / 1024 / 1024).toFixed(2)),
      sha256,
    })
  }
  return out.sort((a, b) => b.sizeBytes - a.sizeBytes)
}

function unpackedExeMeta(unpackedDir) {
  const exe = path.join(unpackedDir, "Codek.exe")
  if (!fs.existsSync(exe)) return null
  const stat = fs.statSync(exe)
  return {
    name: "Codek.exe",
    path: exe,
    sizeBytes: stat.size,
    sizeMb: Number((stat.size / 1024 / 1024).toFixed(2)),
    sha256: stat.size <= 1024 * 1024 * 600 ? fileSha256(exe) : "",
  }
}

function gradeStage(stage) {
  if (!stage || !stage.report) {
    return { grade: "missing", note: "未生成 latest 报告" }
  }
  const r = stage.report
  if (r.summary?.failed > 0) return { grade: "blocked", note: r.statusLabel || "存在 failed 项" }
  if (r.summary?.warning > 0) return { grade: "review", note: r.statusLabel || "存在 warning，需复核" }
  return { grade: "ready", note: r.statusLabel || "通过" }
}

function buildAt6Evidence(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const reportDir = input.reportDir || defaultReportDir()
  const releaseDir = path.join(desktopDir, "release")
  const unpackedDir = path.join(releaseDir, "win-unpacked")

  const desktopPackageJson = readJsonSafe(path.join(desktopDir, "package.json")) || {}
  const rootPackageJson = readJsonSafe(path.join(root, "package.json")) || {}
  const version = desktopPackageJson.version || rootPackageJson.version || "0.0.0"
  const productName = desktopPackageJson.build?.productName || desktopPackageJson.name || "Codek"
  const appId = desktopPackageJson.build?.appId || ""

  const stages = {
    at1_packaging_preflight: loadStageReport(reportDir, "packaging-preflight-latest.json"),
    at2_electron_rebuild: loadStageReport(reportDir, "electron-rebuild-check-latest.json"),
    at3_package_artifacts: loadStageReport(reportDir, "package-artifacts-latest.json"),
    at4_install_smoke: loadStageReport(reportDir, "at4-install-smoke-latest.json"),
    packaged_app_smoke: loadStageReport(reportDir, "packaged-app-smoke-latest.json"),
    at5_functional_smoke: loadStageReport(reportDir, "at5-functional-smoke-latest.json"),
    at_release_candidate_preflight: loadStageReport(reportDir, "at-release-candidate-preflight-latest.json"),
    release_gate: loadStageReport(reportDir, "release-gate-latest.json"),
    release_evidence: loadStageReport(reportDir, "release-evidence-latest.json"),
  }

  const grades = {}
  for (const [key, stage] of Object.entries(stages)) {
    grades[key] = gradeStage(stage)
  }

  const installerArtifacts = listArtifacts(releaseDir)
  const unpacked = unpackedExeMeta(unpackedDir)

  // 总评级
  const blocked = Object.values(grades).filter((g) => g.grade === "blocked").length
  const review = Object.values(grades).filter((g) => g.grade === "review").length
  const missing = Object.values(grades).filter((g) => g.grade === "missing").length
  const ready = Object.values(grades).filter((g) => g.grade === "ready").length

  // 三档分类
  const productionBlocked = []
  const reviewItems = []
  const internalAllowed = []

  // 安装器是否存在 → 正式发布的硬约束
  const hasInstaller = installerArtifacts.some((a) => /setup/i.test(a.name) && /\.exe$/i.test(a.name))
  if (!hasInstaller && !unpacked) {
    // 啥都没有才阻断
    productionBlocked.push({
      id: "missing_nsis_installer",
      title: "未生成 NSIS 安装器, 也没有 win-unpacked",
      detail: `${path.relative(root, releaseDir)} 下未发现任何可执行产物`,
      action: "在授权 Windows 环境运行 npm run pack:win，并复核构建日志。",
    })
  } else if (!hasInstaller && unpacked) {
    // 有免安装版但缺 NSIS → review
    reviewItems.push({
      id: "missing_nsis_installer",
      title: "未生成 NSIS 安装器（有 win-unpacked 可内测）",
      detail: `${path.relative(root, releaseDir)} 下未发现 *Setup*.exe，但 win-unpacked/Codek.exe 可用`,
      action: "首轮内测可用 win-unpacked；正式分发前在授权 Windows 环境运行 npm run pack:win。",
    })
  }
  // 缺 unpacked exe → 直接阻断
  if (!unpacked) {
    productionBlocked.push({
      id: "missing_unpacked_exe",
      title: "未生成 win-unpacked/Codek.exe",
      detail: "免安装版可执行文件缺失",
      action: "在授权 Windows 环境运行 npm run pack:win。",
    })
  }
  // 任何 stage blocked 都算正式阻断
  for (const [key, g] of Object.entries(grades)) {
    if (g.grade === "blocked") {
      productionBlocked.push({ id: `${key}_blocked`, title: `${key} 存在 failed`, detail: g.note, action: "查看对应 latest 报告并修复 failed 检查项。" })
    }
    if (g.grade === "review") {
      reviewItems.push({ id: `${key}_review`, title: `${key} 需复核`, detail: g.note, action: "查看对应 latest 报告，决定是否在内测允许范围。" })
    }
    if (g.grade === "missing") {
      reviewItems.push({ id: `${key}_missing`, title: `${key} 报告缺失`, detail: "未找到 latest 文件", action: "运行对应阶段脚本重新生成证据。" })
    }
  }
  // 内测允许列表（已知非阻断 warning）
  if (grades.at1_packaging_preflight.grade === "review") {
    internalAllowed.push({ id: "icon_icns_warning", title: "macOS icon.icns 缺失", detail: "Windows 内测不阻断", action: "macOS 发布前再补 icns。" })
  }
  if (grades.at2_electron_rebuild.grade === "review") {
    internalAllowed.push({ id: "rebuild_cli_version_arg", title: "@electron/rebuild --version 参数兼容", detail: "不影响实际 rebuild", action: "仅作为版本检查脚本兼容性记录。" })
  }

  const overallGrade = productionBlocked.length > 0
    ? "production-blocked"
    : reviewItems.length > 0
      ? "internal-allowed-review"
      : "release-ready"

  const overallStatus = blocked > 0 ? "blocked" : review > 0 || missing > 0 ? "degraded" : "ready"

  // 各阶段摘要
  const stageSummaries = Object.entries(stages).map(([key, stage]) => ({
    key,
    available: stage.available,
    jsonPath: stage.jsonPath,
    markdownPath: stage.markdownPath,
    grade: grades[key].grade,
    note: grades[key].note,
    summary: stage.report?.summary || null,
    statusLabel: stage.report?.statusLabel || null,
  }))

  return {
    reportKind: "at6-release-candidate-evidence",
    createdAt,
    candidate: {
      productName,
      appId,
      version,
      platform: "win",
      arch: "x64",
      releaseDir,
      unpackedDir,
    },
    artifacts: {
      installer: installerArtifacts,
      unpacked: unpacked ? [unpacked] : [],
    },
    stages: stageSummaries,
    grades,
    overall: {
      grade: overallGrade,
      status: overallStatus,
      stageCount: stageSummaries.length,
      ready,
      review,
      blocked,
      missing,
      hasInstaller,
      hasUnpacked: Boolean(unpacked),
    },
    productionBlocked,
    reviewItems,
    internalAllowed,
    scope: {
      realPublishExecuted: false,
      realInstallExecuted: false,
      signingExecuted: false,
      uploadExecuted: false,
      note: "本证据链只汇总本地 latest 报告，不上传、不发布、不发 PR、不签名。",
    },
  }
}

function paths(reportDir = defaultReportDir()) {
  const resolved = reportDir || defaultReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "at6-release-candidate-evidence-latest.json"),
    latestMarkdownPath: path.join(resolved, "at6-release-candidate-evidence-latest.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function escape(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function toMarkdown(report) {
  const stageRows = (report.stages || []).map((s) =>
    `| ${s.key} | ${s.grade} | ${escape(s.statusLabel || s.note || "-")} | ${escape(s.summary ? `passed=${s.summary.passed} warning=${s.summary.warning} failed=${s.summary.failed}` : "-")} | ${escape(path.relative(root, s.markdownPath || s.jsonPath || "-"))} |`,
  )
  const installerRows = (report.artifacts.installer || []).map((a) =>
    `| ${escape(a.name)} | ${a.sizeMb}MB | ${escape(a.sha256 || "-")} | ${escape(path.relative(root, a.path))} |`,
  )
  const unpackedRows = (report.artifacts.unpacked || []).map((a) =>
    `| ${escape(a.name)} | ${a.sizeMb}MB | ${escape(a.sha256 || "-")} | ${escape(path.relative(root, a.path))} |`,
  )
  const blockedRows = (report.productionBlocked || []).map((g) =>
    `| ${escape(g.title)} | ${escape(g.detail)} | ${escape(g.action)} |`,
  )
  const reviewRows = (report.reviewItems || []).map((g) =>
    `| ${escape(g.title)} | ${escape(g.detail)} | ${escape(g.action)} |`,
  )
  const allowRows = (report.internalAllowed || []).map((g) =>
    `| ${escape(g.title)} | ${escape(g.detail)} | ${escape(g.action)} |`,
  )

  return [
    "# AT6 发布候选证据链",
    "",
    `- 总评级: **${report.overall.grade}**`,
    `- 总状态: ${report.overall.status}`,
    `- 候选: ${report.candidate.productName} ${report.candidate.version} (${report.candidate.platform}/${report.candidate.arch})`,
    `- App ID: ${report.candidate.appId || "-"}`,
    `- Created At: ${new Date(report.createdAt).toISOString()}`,
    `- 阶段统计: ready=${report.overall.ready} review=${report.overall.review} blocked=${report.overall.blocked} missing=${report.overall.missing}`,
    "",
    "## 阶段汇总",
    "",
    "| 阶段 | 评级 | 状态 | 摘要 | 报告 |",
    "| --- | --- | --- | --- | --- |",
    ...(stageRows.length ? stageRows : ["| - | - | - | - | - |"]),
    "",
    "## 安装器产物",
    "",
    "| 文件 | 大小 | SHA256 | 路径 |",
    "| --- | ---: | --- | --- |",
    ...(installerRows.length ? installerRows : ["| - | - | - | 尚未生成 NSIS 安装器 |"]),
    "",
    "## 免安装包产物 (win-unpacked)",
    "",
    "| 文件 | 大小 | SHA256 | 路径 |",
    "| --- | ---: | --- | --- |",
    ...(unpackedRows.length ? unpackedRows : ["| - | - | - | win-unpacked 缺失 |"]),
    "",
    "## 三档分类",
    "",
    "### 正式发布阻断",
    "",
    "| 项 | 详情 | 下一步 |",
    "| --- | --- | --- |",
    ...(blockedRows.length ? blockedRows : ["| 无 | - | - |"]),
    "",
    "### 需手动复核",
    "",
    "| 项 | 详情 | 下一步 |",
    "| --- | --- | --- |",
    ...(reviewRows.length ? reviewRows : ["| 无 | - | - |"]),
    "",
    "### 内测允许",
    "",
    "| 项 | 详情 | 下一步 |",
    "| --- | --- | --- |",
    ...(allowRows.length ? allowRows : ["| 无 | - | - |"]),
    "",
    "## 边界",
    "",
    "- 本证据链只读取本地 latest 报告，不上传 telemetry，不发 PR，不发布到外部渠道。",
    "- 真实签名 / 公证 / 上传 / 发布 / 写用户主目录 必须由授权环境另行执行。",
    "- 未保存 prompt/response 正文与 API key。",
  ].join("\n")
}

function save(report, options = {}) {
  const p = paths(options.reportDir)
  fs.mkdirSync(p.reportDir, { recursive: true })
  fs.mkdirSync(p.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJson = path.join(p.historyDir, `at6-release-candidate-evidence-${stamp}.json`)
  const historyMd = path.join(p.historyDir, `at6-release-candidate-evidence-${stamp}.md`)
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
  const report = buildAt6Evidence({ reportDir })
  const saved = noWrite ? { latestJsonPath: "", latestMarkdownPath: "" } : save(report, { reportDir })
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    overall: report.overall,
    candidate: report.candidate,
    productionBlocked: report.productionBlocked.map((b) => b.title),
    reviewItems: report.reviewItems.map((r) => r.title),
    internalAllowed: report.internalAllowed.map((a) => a.title),
    jsonPath: saved.latestJsonPath || "",
    markdownPath: saved.latestMarkdownPath || "",
  }, null, 2)}\n`)
  process.exit(report.overall.blocked > 0 ? 1 : 0)
}

module.exports = {
  buildAt6Evidence,
  save,
  readLatest,
  toMarkdown,
}
