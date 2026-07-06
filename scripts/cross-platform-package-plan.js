#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function check(id, title, passed, detail, nextAction = "", extra = {}) {
  return {
    id,
    title,
    status: passed ? "passed" : "failed",
    passed: Boolean(passed),
    detail,
    nextAction: passed ? "" : nextAction,
    ...extra,
  }
}

function targetNames(config, platform) {
  const targets = config?.build?.[platform]?.target || []
  return targets.map((item) => typeof item === "string" ? item : item.target).filter(Boolean)
}

function hasScript(packageJson, scriptName) {
  return typeof packageJson?.scripts?.[scriptName] === "string" && packageJson.scripts[scriptName].trim().length > 0
}

function buildCrossPlatformPackagePlan(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const rootPackagePath = path.join(root, "package.json")
  const desktopPackagePath = path.join(root, "desktop", "package.json")
  const rootPackage = readJson(rootPackagePath) || {}
  const desktopPackage = readJson(desktopPackagePath) || {}
  const checks = []
  const winTargets = targetNames(desktopPackage, "win")
  const macTargets = targetNames(desktopPackage, "mac")
  const linuxTargets = targetNames(desktopPackage, "linux")
  const hasRootWinPack = hasScript(rootPackage, "pack:win")
  const hasDesktopWinPack = hasScript(desktopPackage, "pack:win")

  checks.push(check("windows_nsis", "Windows NSIS installer target", winTargets.includes("nsis"), winTargets.join(",") || "none", "Add win target nsis."))
  checks.push(check("windows_portable_or_unpacked", "Windows portable or unpacked strategy", hasRootWinPack && hasDesktopWinPack && winTargets.includes("nsis"), `root.pack:win=${hasRootWinPack}; desktop.pack:win=${hasDesktopWinPack}; win-unpacked is generated during Windows packaging`, "Add root and desktop pack:win scripts backed by electron-builder Windows packaging."))
  checks.push(check("mac_dmg", "macOS DMG target", macTargets.includes("dmg"), macTargets.join(",") || "none", "Add mac target dmg."))
  checks.push(check("mac_zip_or_dmg_pair", "macOS archive strategy", macTargets.includes("zip") || macTargets.includes("dmg"), macTargets.join(",") || "none", "Add mac zip or dmg target."))
  checks.push(check("linux_appimage", "Linux AppImage target", linuxTargets.includes("AppImage"), linuxTargets.join(",") || "none", "Add linux AppImage target."))
  checks.push(check("linux_deb", "Linux deb target", linuxTargets.includes("deb"), linuxTargets.join(",") || "none", "Add linux deb target."))
  checks.push(check("signing_boundary", "Signing boundary documented in config", desktopPackage.build?.win?.signAndEditExecutable === false && desktopPackage.build?.mac?.hardenedRuntime === true, `win.signAndEditExecutable=${desktopPackage.build?.win?.signAndEditExecutable}; mac.hardenedRuntime=${desktopPackage.build?.mac?.hardenedRuntime}`, "Document signing/notarization authorization before public release."))

  const failed = checks.filter((item) => !item.passed)
  const summary = {
    total: checks.length,
    passed: checks.length - failed.length,
    warning: 0,
    failed: failed.length,
  }
  return {
    reportKind: "cross-platform-package-plan",
    createdAt,
    ready: failed.length === 0,
    status: failed.length === 0 ? "ready" : "blocked",
    statusLabel: failed.length === 0 ? "Cross-platform package plan ready" : "Cross-platform package plan blocked",
    summary,
    checks,
    platforms: [
      {
        platform: "windows",
        targets: winTargets,
        command: "npm run pack:win",
        verifiedOnThisMachine: process.platform === "win32",
        publicArtifacts: ["Codek-Setup-${version}-x64.exe", "win-unpacked/Codek.exe"],
        signing: "unsigned until certificate is authorized",
      },
      {
        platform: "macos",
        targets: macTargets,
        command: "npm run pack:mac",
        verifiedOnThisMachine: process.platform === "darwin",
        publicArtifacts: ["Codek-${version}-${arch}.dmg", "Codek-${version}-${arch}.zip"],
        signing: "requires Developer ID and notarization authorization",
      },
      {
        platform: "linux",
        targets: linuxTargets,
        command: "npm run pack:linux",
        verifiedOnThisMachine: process.platform === "linux",
        publicArtifacts: ["Codek-${version}-x64.AppImage", "Codek-${version}-x64.deb"],
        signing: "repository signing not configured in BA",
      },
    ],
    nextActions: failed.map((item) => ({ id: item.id, title: item.title, action: item.nextAction })),
  }
}

function paths(reportDir = defaultReportDir()) {
  const resolved = reportDir || defaultReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "cross-platform-package-plan-latest.json"),
    latestMarkdownPath: path.join(resolved, "cross-platform-package-plan-latest.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function escape(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function toMarkdown(report) {
  const checks = (report.checks || []).map((item) =>
    `| ${escape(item.title)} | ${item.status} | ${escape(item.detail)} | ${escape(item.nextAction || "-")} |`,
  )
  const platforms = (report.platforms || []).map((item) =>
    `| ${item.platform} | ${escape(item.command)} | ${escape((item.targets || []).join(", "))} | ${item.verifiedOnThisMachine ? "YES" : "NO"} | ${escape(item.signing)} |`,
  )
  return [
    "# Cross Platform Package Plan",
    "",
    `- Status: ${report.statusLabel}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Created At: ${new Date(report.createdAt).toISOString()}`,
    "",
    "## Platform Strategy",
    "",
    "| Platform | Command | Targets | Verified Here | Signing |",
    "| --- | --- | --- | --- | --- |",
    ...platforms,
    "",
    "## Checks",
    "",
    "| Check | Status | Detail | Next Action |",
    "| --- | --- | --- | --- |",
    ...checks,
  ].join("\n")
}

function save(report, options = {}) {
  const p = paths(options.reportDir)
  fs.mkdirSync(p.reportDir, { recursive: true })
  fs.mkdirSync(p.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJson = path.join(p.historyDir, `cross-platform-package-plan-${stamp}.json`)
  const historyMd = path.join(p.historyDir, `cross-platform-package-plan-${stamp}.md`)
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
    report: readJson(p.latestJsonPath),
    markdown: fs.existsSync(p.latestMarkdownPath) ? fs.readFileSync(p.latestMarkdownPath, "utf8") : "",
    ...p,
  }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const reportDirArg = args.find((arg) => arg.startsWith("--report-dir="))
  const noWrite = args.includes("--no-write")
  const reportDir = reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir()
  const report = buildCrossPlatformPackagePlan()
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
  process.exit(report.ready ? 0 : 1)
}

module.exports = {
  buildCrossPlatformPackagePlan,
  defaultReportDir,
  hasScript,
  readLatest,
  save,
  targetNames,
  toMarkdown,
}
