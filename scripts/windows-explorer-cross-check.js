#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")
const childProcess = require("node:child_process")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const smokeFileArg = argv.find((arg) => arg.startsWith("--smoke-file="))
  return {
    noWrite: argv.includes("--no-write"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
    smokeFile: smokeFileArg ? smokeFileArg.slice("--smoke-file=".length) : "",
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function latestSmokePath(reportDir, name) {
  return path.join(reportDir, `electron-smoke-${name}-latest-result.json`)
}

function extractCreateTargetFixture(smoke) {
  const checks = Array.isArray(smoke?.checks) ? smoke.checks : []
  for (const check of checks) {
    if (!/selected directory controls target/i.test(String(check?.name || ""))) continue
    const detail = typeof check.detail === "string" ? readJsonText(check.detail) : check.detail
    if (detail?.fixture?.selectedFile || detail?.fixture?.selectedFolder) return detail.fixture
  }
  return null
}

function readJsonText(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function shellResolvePath(targetPath) {
  const resolved = path.resolve(String(targetPath || ""))
  const parent = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved)
  const leaf = fs.statSync(resolved).isDirectory() ? "" : path.basename(resolved)
  const script = `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject Shell.Application
$folder = $shell.NameSpace('${escapePowerShellSingleQuoted(parent)}')
if ($null -eq $folder) { throw 'namespace-not-found' }
if ('${escapePowerShellSingleQuoted(leaf)}'.Length -gt 0) {
  $item = $folder.ParseName('${escapePowerShellSingleQuoted(leaf)}')
  if ($null -eq $item) { throw 'item-not-found' }
}
Write-Output 'ok'
`
  const result = childProcess.spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  })
  return {
    path: resolved,
    ok: result.status === 0 && /ok/.test(result.stdout || ""),
    exitCode: result.status,
    stderrLength: String(result.stderr || "").length,
  }
}

function escapePowerShellSingleQuoted(value) {
  return String(value || "").replace(/'/g, "''")
}

function buildWindowsExplorerCrossCheck(options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  const smokePath = options.smokeFile || latestSmokePath(reportDir, "create-target-accuracy")
  const smoke = options.smoke || readJson(smokePath)
  const fixture = options.fixture || extractCreateTargetFixture(smoke)
  const checks = []
  if (fixture?.selectedFile) checks.push({ id: "selected_file_shell_namespace", ...shellResolvePath(fixture.selectedFile) })
  if (fixture?.selectedFolder) checks.push({ id: "selected_folder_shell_namespace", ...shellResolvePath(fixture.selectedFolder) })
  const ready = checks.length >= 2 && checks.every((check) => check.ok)
  return {
    reportKind: "windows-explorer-cross-check",
    createdAt: Number(options.createdAt || Date.now()),
    ready,
    status: ready ? "ready" : "blocked",
    smokePath,
    checkCount: checks.length,
    passed: checks.filter((check) => check.ok).length,
    checks,
  }
}

function saveWindowsExplorerCrossCheck(report, options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  fs.mkdirSync(reportDir, { recursive: true })
  const latestJsonPath = path.join(reportDir, "windows-explorer-cross-check-latest.json")
  fs.writeFileSync(latestJsonPath, `${JSON.stringify({ ...report, latestJsonPath }, null, 2)}\n`, "utf8")
  return { ...report, latestJsonPath }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = buildWindowsExplorerCrossCheck(options)
  const output = options.noWrite ? report : saveWindowsExplorerCrossCheck(report, options)
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  process.exit(output.ready ? 0 : 1)
}

if (require.main === module) main()

module.exports = {
  buildWindowsExplorerCrossCheck,
  extractCreateTargetFixture,
  parseArgs,
  saveWindowsExplorerCrossCheck,
}
