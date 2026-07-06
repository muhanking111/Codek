#!/usr/bin/env node

/**
 * AT7: 回滚与分发说明
 *
 * 基于 AT6 证据链生成本地发布候选 runbook，覆盖：
 *   - 候选元数据（版本、平台、产物、hash）
 *   - 重新构建步骤
 *   - 失败产物清理步骤
 *   - 回滚到源码运行的步骤
 *   - 内测允许 / 正式发布阻断 / 手动复核 三档清单
 *   - 安装 / 卸载 / 升级 说明
 *
 * 不上传、不发布、不发 PR。所有产物只写本地 .codek/reports。
 */

const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const desktopDir = path.join(root, "desktop")
const at6 = require("./at6-release-candidate-evidence.js")

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

function escape(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function buildAt7Runbook(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const reportDir = input.reportDir || defaultReportDir()

  // 优先用已落盘的 AT6 latest，没有就实时计算一份
  let evidence = readJsonSafe(path.join(reportDir, "at6-release-candidate-evidence-latest.json"))
  if (!evidence) {
    evidence = at6.buildAt6Evidence({ reportDir })
  }

  const desktopPackageJson = readJsonSafe(path.join(desktopDir, "package.json")) || {}
  const productName = desktopPackageJson.build?.productName || desktopPackageJson.name || "Codek"
  const version = evidence?.candidate?.version || desktopPackageJson.version || "0.0.0"
  const appId = evidence?.candidate?.appId || desktopPackageJson.build?.appId || ""

  // —— Runbook 核心段落 ——
  const rebuildSteps = [
    "1. 在仓库根目录执行 `npm install`，确认根级 dev 依赖（vite-tsc、各 smoke 脚本）就位。",
    "2. 进入 `desktop/` 执行 `npm install`，触发 `postinstall` 中的 `electron-rebuild -f -w node-pty`。",
    "3. 回到根目录执行 `npm run build:frontend`，生成 `frontend/vite-project/dist/`。",
    "4. 在授权 Windows 环境执行 `npm run pack:win`，电子构建器将基于 `desktop/package.json` 的 build 配置生成 NSIS 安装器与 win-unpacked。",
    "5. 执行 `node scripts/at3-package-artifacts-check.js` 收集产物路径、大小与 SHA256。",
    "6. 执行 `node scripts/at4-install-smoke.js` 与 `node scripts/at5-functional-smoke.js` 验证产物契约。",
    "7. 执行 `node scripts/at6-release-candidate-evidence.js` 汇总当前候选证据链，再次确认评级。",
  ]

  const cleanupSteps = [
    "1. 失败的 NSIS 产物：删除 `desktop/release/*.exe`、`desktop/release/*.blockmap`、`desktop/release/*.yml`，保留 `desktop/release/builder-debug.yml` 用于诊断。",
    "2. 失败的 win-unpacked：直接删除整个 `desktop/release/win-unpacked/` 目录。",
    "3. native 模块编译失败：删除 `desktop/node_modules/`，重新 `cd desktop && npm install`。",
    "4. 前端缓存：删除 `frontend/vite-project/dist/`、`frontend/vite-project/node_modules/.vite/` 后重新构建。",
    "5. electron-builder 缓存（仓库内）：删除 `desktop/.codek-cache/electron-builder/`、`desktop/.codek-cache/rcedit/`，下次运行 `scripts/build.js` 会自动重建。",
    "6. 报告级清理：删除 `.codek/reports/*-latest.json` 与 `.codek/reports/history/` 后重跑各阶段脚本。",
  ]

  const sourceFallbackSteps = [
    "1. 用户主目录下若已有损坏的安装版本，先执行 `控制面板 > 程序与功能` 卸载，再删除 `%APPDATA%/Codek` 下的残留。",
    `2. 在源码仓库根目录执行 \`npm install\` 与 \`cd desktop && npm install\`，回到根目录后用 \`npm run start\` 直接以 Electron 加载源码。`,
    "3. 此模式下 native 模块由 `postinstall` 自动 rebuild；如失败需手动 `cd desktop && npm run rebuild`。",
    "4. 源码模式不会安装到系统目录，也不会写桌面快捷方式，可作为安装版的应急回滚路径。",
  ]

  const productionBlocked = (evidence?.productionBlocked || []).map((b) => ({
    id: b.id,
    title: b.title,
    detail: b.detail,
    action: b.action,
  }))
  const reviewItems = (evidence?.reviewItems || []).map((r) => ({
    id: r.id,
    title: r.title,
    detail: r.detail,
    action: r.action,
  }))
  const internalAllowed = (evidence?.internalAllowed || []).map((a) => ({
    id: a.id,
    title: a.title,
    detail: a.detail,
    action: a.action,
  }))

  const installerArtifacts = evidence?.artifacts?.installer || []
  const unpacked = evidence?.artifacts?.unpacked || []
  const hasInstaller = installerArtifacts.length > 0
  const hasUnpacked = unpacked.length > 0

  const installSteps = hasInstaller
    ? [
        `1. 双击 \`${path.relative(root, installerArtifacts[0].path)}\`，按向导选择安装目录（默认 \`%LOCALAPPDATA%/Programs/${productName}\`）。`,
        "2. 安装器会创建桌面快捷方式与开始菜单项；首次启动会在 `%APPDATA%/${productName}` 下创建用户数据目录。",
        "3. 启动后建议立即跑一次登录页 → 工作台 → 设置页 → ChatAI 的链路冒烟，记录任何弹窗或缺失字体。",
      ]
    : [
        "尚未生成 NSIS 安装器。可使用免安装包：",
        hasUnpacked
          ? `1. 解压或直接进入 \`${path.relative(root, path.dirname(unpacked[0].path))}\`，运行 \`Codek.exe\`。`
          : "1. 当前 win-unpacked 也缺失，需先执行 `npm run pack:win` 生成产物。",
        "2. 免安装包不会写注册表与开始菜单，可直接整目录复制到测试机使用，但仍会在 `%APPDATA%/${productName}` 下生成用户数据目录。",
      ]

  const uninstallSteps = [
    "1. 安装版：通过 `控制面板 > 程序与功能 > Codek` 执行卸载；卸载器路径形如 `%LOCALAPPDATA%/Programs/${productName}/Uninstall ${productName}.exe`。",
    "2. 免安装版：直接删除产物目录即可。",
    "3. 用户数据残留：手动删除 `%APPDATA%/${productName}/`、`%LOCALAPPDATA%/${productName}/`（包含登录态、Codek workspace 设置、扩展安装记录、本地 LLM usage 审计）。",
    "4. 谨慎删除 `%APPDATA%/${productName}/extensions/` —— 该目录保存用户安装的 OpenVSX/.vsix 扩展。",
  ]

  const upgradeSteps = [
    "1. 直接运行新版本安装器，electron-builder 默认走 NSIS perUser 升级，无需事先卸载。",
    "2. 升级前建议备份用户数据目录 `%APPDATA%/${productName}/`，尤其是 Orchestrator runs 的 SQLite 数据库与扩展目录。",
    "3. 升级后立即跑一次 `node scripts/at4-install-smoke.js`、`node scripts/at5-functional-smoke.js`，确认契约未回退。",
    "4. 若升级失败导致启动崩溃，使用 `源码回滚` 段落的步骤临时恢复，再排查升级日志。",
  ]

  return {
    reportKind: "at7-release-candidate-runbook",
    createdAt,
    candidate: {
      productName,
      version,
      appId,
      hasInstaller,
      hasUnpacked,
    },
    evidenceSummary: {
      overallGrade: evidence?.overall?.grade || "unknown",
      overallStatus: evidence?.overall?.status || "unknown",
      stageCount: evidence?.overall?.stageCount || 0,
      ready: evidence?.overall?.ready || 0,
      review: evidence?.overall?.review || 0,
      blocked: evidence?.overall?.blocked || 0,
      missing: evidence?.overall?.missing || 0,
    },
    sections: {
      rebuild: rebuildSteps,
      cleanup: cleanupSteps,
      sourceFallback: sourceFallbackSteps,
      install: installSteps,
      uninstall: uninstallSteps,
      upgrade: upgradeSteps,
    },
    classification: {
      productionBlocked,
      reviewItems,
      internalAllowed,
    },
    artifacts: {
      installer: installerArtifacts,
      unpacked,
    },
    scope: {
      realPublishExecuted: false,
      realInstallExecuted: false,
      uploadExecuted: false,
      note: "本 runbook 只记录本地步骤，不上传、不发布、不发 PR、不签名、不公证。",
    },
  }
}

function paths(reportDir = defaultReportDir()) {
  const resolved = reportDir || defaultReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "at7-release-candidate-runbook-latest.json"),
    latestMarkdownPath: path.join(resolved, "at7-release-candidate-runbook-latest.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function classificationTable(items) {
  if (!items.length) return ["| 无 | - | - |"]
  return items.map((item) => `| ${escape(item.title)} | ${escape(item.detail)} | ${escape(item.action)} |`)
}

function bulletList(items) {
  return (items || []).map((line) => `- ${line}`)
}

function toMarkdown(report) {
  const c = report.candidate
  const e = report.evidenceSummary
  const s = report.sections
  const cls = report.classification

  const installerRows = (report.artifacts.installer || []).map((a) =>
    `| ${escape(a.name)} | ${a.sizeMb}MB | ${escape(a.sha256 || "-")} | ${escape(path.relative(root, a.path))} |`,
  )
  const unpackedRows = (report.artifacts.unpacked || []).map((a) =>
    `| ${escape(a.name)} | ${a.sizeMb}MB | ${escape(a.sha256 || "-")} | ${escape(path.relative(root, a.path))} |`,
  )

  return [
    "# AT7 发布候选 Runbook（回滚与分发说明）",
    "",
    `- 候选: ${c.productName} ${c.version}`,
    `- App ID: ${c.appId || "-"}`,
    `- AT6 总评级: **${e.overallGrade}** (${e.overallStatus})`,
    `- 阶段统计: ready=${e.ready} review=${e.review} blocked=${e.blocked} missing=${e.missing}`,
    `- 安装器存在: ${c.hasInstaller ? "YES" : "NO"} | 免安装包存在: ${c.hasUnpacked ? "YES" : "NO"}`,
    `- 生成时间: ${new Date(report.createdAt).toISOString()}`,
    "",
    "## 1. 重新构建步骤",
    "",
    ...bulletList(s.rebuild),
    "",
    "## 2. 失败产物清理",
    "",
    ...bulletList(s.cleanup),
    "",
    "## 3. 回滚到源码运行",
    "",
    ...bulletList(s.sourceFallback),
    "",
    "## 4. 安装步骤",
    "",
    ...bulletList(s.install),
    "",
    "## 5. 卸载步骤",
    "",
    ...bulletList(s.uninstall),
    "",
    "## 6. 升级步骤",
    "",
    ...bulletList(s.upgrade),
    "",
    "## 7. 三档 warning 分类",
    "",
    "### 正式发布阻断",
    "",
    "| 项 | 详情 | 下一步 |",
    "| --- | --- | --- |",
    ...classificationTable(cls.productionBlocked),
    "",
    "### 需手动复核",
    "",
    "| 项 | 详情 | 下一步 |",
    "| --- | --- | --- |",
    ...classificationTable(cls.reviewItems),
    "",
    "### 内测允许",
    "",
    "| 项 | 详情 | 下一步 |",
    "| --- | --- | --- |",
    ...classificationTable(cls.internalAllowed),
    "",
    "## 8. 候选产物",
    "",
    "### 安装器",
    "",
    "| 文件 | 大小 | SHA256 | 路径 |",
    "| --- | ---: | --- | --- |",
    ...(installerRows.length ? installerRows : ["| - | - | - | 尚未生成 |"]),
    "",
    "### 免安装包 (win-unpacked)",
    "",
    "| 文件 | 大小 | SHA256 | 路径 |",
    "| --- | ---: | --- | --- |",
    ...(unpackedRows.length ? unpackedRows : ["| - | - | - | win-unpacked 缺失 |"]),
    "",
    "## 边界",
    "",
    "- 本 runbook 只记录本地构建、安装、卸载、回滚步骤，不上传、不发布、不发 PR、不签名、不公证。",
    "- 真实 Windows 打包、安装包写入与卸载必须在授权环境运行。",
    "- 未保存 prompt/response 正文与 API key。",
  ].join("\n")
}

function save(report, options = {}) {
  const p = paths(options.reportDir)
  fs.mkdirSync(p.reportDir, { recursive: true })
  fs.mkdirSync(p.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJson = path.join(p.historyDir, `at7-release-candidate-runbook-${stamp}.json`)
  const historyMd = path.join(p.historyDir, `at7-release-candidate-runbook-${stamp}.md`)
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
  const report = buildAt7Runbook({ reportDir })
  const saved = noWrite ? { latestJsonPath: "", latestMarkdownPath: "" } : save(report, { reportDir })
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    candidate: report.candidate,
    evidenceSummary: report.evidenceSummary,
    productionBlocked: report.classification.productionBlocked.map((b) => b.title),
    reviewItems: report.classification.reviewItems.map((r) => r.title),
    internalAllowed: report.classification.internalAllowed.map((a) => a.title),
    jsonPath: saved.latestJsonPath || "",
    markdownPath: saved.latestMarkdownPath || "",
  }, null, 2)}\n`)
  process.exit(0)
}

module.exports = {
  buildAt7Runbook,
  save,
  readLatest,
  toMarkdown,
}
