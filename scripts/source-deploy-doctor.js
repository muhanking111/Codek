#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const root = path.resolve(__dirname, "..")

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

function check(id, title, status, detail, nextAction = "", extra = {}) {
  return { id, title, status, detail, nextAction, ...extra }
}

function existsCheck(id, title, targetPath, nextAction, severity = "failed") {
  const exists = fs.existsSync(targetPath)
  return check(
    id,
    title,
    exists ? "passed" : severity,
    exists ? `found ${path.relative(root, targetPath)}` : `missing ${path.relative(root, targetPath)}`,
    exists ? "" : nextAction,
  )
}

function commandVersion(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    shell: process.platform === "win32",
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  return {
    ok: result.status === 0,
    status: typeof result.status === "number" ? result.status : result.error ? 1 : 0,
    stdout: String(result.stdout || "").trim().slice(0, 300),
    stderr: String(result.stderr || "").trim().slice(0, 300),
    error: result.error ? String(result.error.message || result.error).slice(0, 300) : "",
  }
}

function packageHasScript(packagePath, scriptName) {
  const json = readJsonSafe(packagePath)
  return Boolean(json?.scripts?.[scriptName])
}

function buildSourceDeployDoctor(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const cleanClone = input.cleanClone === true
  const checks = []
  const rootPackage = path.join(root, "package.json")
  const desktopPackage = path.join(root, "desktop", "package.json")
  const frontendPackage = path.join(root, "frontend", "vite-project", "package.json")
  const frontendDist = path.join(root, "frontend", "vite-project", "dist", "index.html")
  const readmePath = path.join(root, "README.md")
  const gitignorePath = path.join(root, ".gitignore")

  const nodeVersion = commandVersion("node", ["--version"])
  checks.push(check(
    "node_runtime",
    "Node.js runtime",
    nodeVersion.ok ? "passed" : "failed",
    nodeVersion.ok ? nodeVersion.stdout : nodeVersion.stderr || nodeVersion.error || "node not available",
    "Install Node.js and reopen the terminal.",
    { version: nodeVersion.stdout },
  ))

  const npmVersion = commandVersion("npm", ["--version"])
  checks.push(check(
    "npm_runtime",
    "npm runtime",
    npmVersion.ok ? "passed" : "failed",
    npmVersion.ok ? npmVersion.stdout : npmVersion.stderr || npmVersion.error || "npm not available",
    "Install npm with Node.js and rerun npm install.",
    { version: npmVersion.stdout },
  ))

  checks.push(existsCheck("root_package_json", "root package.json", rootPackage, "Restore root package.json.", "failed"))
  checks.push(existsCheck("desktop_package_json", "desktop package.json", desktopPackage, "Restore desktop/package.json.", "failed"))
  checks.push(existsCheck("frontend_package_json", "frontend package.json", frontendPackage, "Restore frontend/vite-project/package.json.", "failed"))
  checks.push(existsCheck("readme", "README for external setup", readmePath, "Add README.md with source setup and install instructions.", cleanClone ? "failed" : "warning"))
  checks.push(existsCheck("gitignore", ".gitignore protects generated files", gitignorePath, "Add .gitignore before public source delivery.", cleanClone ? "failed" : "warning"))

  const rootScripts = ["build", "start", "typecheck", "release:gate", "pack:win"]
  for (const script of rootScripts) {
    checks.push(check(
      `root_script_${script.replace(/[^a-z0-9]+/gi, "_")}`,
      `root npm script: ${script}`,
      packageHasScript(rootPackage, script) ? "passed" : "failed",
      packageHasScript(rootPackage, script) ? `npm run ${script}` : `missing npm script ${script}`,
      `Add ${script} to root package.json scripts.`,
    ))
  }

  const desktopScripts = ["start", "rebuild", "pack:win"]
  for (const script of desktopScripts) {
    checks.push(check(
      `desktop_script_${script.replace(/[^a-z0-9]+/gi, "_")}`,
      `desktop npm script: ${script}`,
      packageHasScript(desktopPackage, script) ? "passed" : "failed",
      packageHasScript(desktopPackage, script) ? `cd desktop && npm run ${script}` : `missing desktop script ${script}`,
      `Add ${script} to desktop/package.json scripts.`,
    ))
  }

  checks.push(existsCheck("root_node_modules", "root node_modules", path.join(root, "node_modules"), "Run npm install at repository root.", "warning"))
  checks.push(existsCheck("desktop_node_modules", "desktop node_modules", path.join(root, "desktop", "node_modules"), "Run cd desktop && npm install.", "failed"))
  checks.push(existsCheck("frontend_node_modules", "frontend node_modules", path.join(root, "frontend", "vite-project", "node_modules"), "Run cd frontend/vite-project && npm install.", "failed"))
  checks.push(existsCheck("frontend_dist", "frontend dist/index.html", frontendDist, "Run npm run build:frontend.", "failed"))

  if (fs.existsSync(frontendDist)) {
    const html = fs.readFileSync(frontendDist, "utf8")
    const hasCsp = html.includes('http-equiv="Content-Security-Policy"')
    checks.push(check(
      "frontend_csp",
      "frontend CSP meta",
      hasCsp ? "passed" : "warning",
      hasCsp ? "dist/index.html has CSP meta" : "dist/index.html has no CSP meta",
      "Run npm run build:frontend to rebuild and inject CSP.",
    ))
  }

  const electronBuilderBin = path.join(root, "desktop", "node_modules", ".bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder")
  const electronRebuildBin = path.join(root, "desktop", "node_modules", ".bin", process.platform === "win32" ? "electron-rebuild.cmd" : "electron-rebuild")
  checks.push(existsCheck("electron_builder_cli", "electron-builder CLI", electronBuilderBin, "Run cd desktop && npm install.", "failed"))
  checks.push(existsCheck("electron_rebuild_cli", "electron-rebuild CLI", electronRebuildBin, "Run cd desktop && npm install.", "failed"))

  const nativeModules = ["node-pty", "better-sqlite3", "bcrypt"]
  for (const mod of nativeModules) {
    const modDir = path.join(root, "desktop", "node_modules", mod)
    checks.push(existsCheck(`native_module_${mod.replace(/[^a-z0-9]+/gi, "_")}`, `native module: ${mod}`, modDir, `Run cd desktop && npm install, then npm run rebuild.`, "warning"))
  }

  const summary = {
    total: checks.length,
    passed: checks.filter((item) => item.status === "passed").length,
    warning: checks.filter((item) => item.status === "warning").length,
    failed: checks.filter((item) => item.status === "failed").length,
  }
  const ready = summary.failed === 0
  const status = !ready ? "blocked" : summary.warning > 0 ? "degraded" : "ready"

  return {
    reportKind: "source-deploy-doctor",
    createdAt,
    cleanClone,
    ready,
    status,
    statusLabel: status === "ready"
      ? "Source deploy doctor passed"
      : status === "degraded"
        ? "Source deploy doctor needs review"
        : "Source deploy doctor blocked",
    summary,
    checks,
    sourceDeployCommand: [
      "npm install",
      "cd desktop && npm install",
      "cd ..",
      "npm run doctor -- --clean-clone",
      "npm run build:frontend",
      "npm run start",
    ],
    nextActions: checks
      .filter((item) => item.status !== "passed")
      .map((item) => ({ id: item.id, title: item.title, status: item.status, action: item.nextAction })),
  }
}

function paths(reportDir = defaultReportDir()) {
  const resolved = reportDir || defaultReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "source-deploy-doctor-latest.json"),
    latestMarkdownPath: path.join(resolved, "source-deploy-doctor-latest.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function escape(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function toMarkdown(report) {
  const rows = (report.checks || []).map((item) =>
    `| ${escape(item.title)} | ${item.status} | ${escape(item.detail)} | ${escape(item.nextAction || "-")} |`,
  )
  return [
    "# Source Deploy Doctor",
    "",
    `- Status: ${report.statusLabel}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Clean Clone Mode: ${report.cleanClone ? "YES" : "NO"}`,
    `- Created At: ${new Date(report.createdAt).toISOString()}`,
    `- Summary: ${report.summary.passed}/${report.summary.total} passed, ${report.summary.warning} warning, ${report.summary.failed} failed`,
    "",
    "## Source Deploy Command",
    "",
    "```powershell",
    ...report.sourceDeployCommand,
    "```",
    "",
    "## Checks",
    "",
    "| Check | Status | Detail | Next Action |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## Boundaries",
    "",
    "- This report does not run external publishing, push to Git, upload telemetry, or store prompt/response bodies.",
    "- Paths are local diagnostics for this machine only.",
  ].join("\n")
}

function save(report, options = {}) {
  const p = paths(options.reportDir)
  fs.mkdirSync(p.reportDir, { recursive: true })
  fs.mkdirSync(p.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJson = path.join(p.historyDir, `source-deploy-doctor-${stamp}.json`)
  const historyMd = path.join(p.historyDir, `source-deploy-doctor-${stamp}.md`)
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
  const reportDirArg = args.find((arg) => arg.startsWith("--report-dir="))
  const noWrite = args.includes("--no-write")
  const cleanClone = args.includes("--clean-clone")
  const reportDir = reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir()
  const report = buildSourceDeployDoctor({ cleanClone })
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
  buildSourceDeployDoctor,
  defaultReportDir,
  readLatest,
  save,
  toMarkdown,
}
