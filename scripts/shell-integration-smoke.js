#!/usr/bin/env node
const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const ESC = "\x1b"
const BEL = "\x07"

function osc633(payload) {
  return `${ESC}]633;${payload}${BEL}`
}

function parseOsc633(output) {
  const events = []
  const pattern = /\x1b\]633;([^\x07]*)\x07/g
  let match
  while ((match = pattern.exec(output))) {
    const payload = match[1] || ""
    const [code, ...rest] = payload.split(";")
    const value = rest.join(";")
    if (code === "E") events.push({ type: "commandLine", value: decodeOsc(value) })
    if (code === "C") events.push({ type: "commandExecuted" })
    if (code === "D") events.push({ type: "commandFinished", exitCode: Number.parseInt(value, 10) })
    if (code === "P") events.push({ type: "property", value: decodeOsc(value) })
  }
  return events
}

function encodeOsc(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/[^\x20-\x7e]/g, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
    .replace(/ /g, "\\x20")
    .replace(/;/g, "\\x3b")
}

function decodeOsc(value) {
  return String(value || "").replace(/\\(\\|x([0-9a-f]{2}))/gi, (_match, op, hex) =>
    hex ? String.fromCharCode(Number.parseInt(hex, 16)) : op,
  )
}

function psSingleQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function cmdQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`
}

function bashSingleQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const shells = argv.filter((arg) => !arg.startsWith("--"))
  return {
    all: argv.includes("--all"),
    noWrite: argv.includes("--no-write"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : path.join(__dirname, "..", ".codek", "reports"),
    shells,
  }
}

function buildPowerShellCommand(command) {
  return [
    `[Console]::Out.Write(${psSingleQuote(osc633(`E;${encodeOsc(command)}`))})`,
    `[Console]::Out.Write(${psSingleQuote(osc633("C"))})`,
    `Invoke-Expression ${psSingleQuote(command)}`,
    `$exit = if ($null -ne $global:LASTEXITCODE) { $global:LASTEXITCODE } elseif ($?) { 0 } else { 1 }`,
    `[Console]::Out.Write(${psSingleQuote(`${ESC}]633;D;`)} + $exit + ${psSingleQuote(BEL)})`,
    `[Console]::Out.Write(${psSingleQuote(`${ESC}]633;P;Cwd=`)} + (Get-Location).Path + ${psSingleQuote(BEL)})`,
    "exit $exit",
  ].join("; ")
}

function buildCmdCommand(command) {
  const psCommand = [
    `$cmd=${psSingleQuote(command)}`,
    `[Console]::Out.Write(${psSingleQuote(osc633(`E;${encodeOsc(command)}`))})`,
    `[Console]::Out.Write(${psSingleQuote(osc633("C"))})`,
    "cmd.exe /d /s /c $cmd",
    "$exit=$LASTEXITCODE",
    `[Console]::Out.Write(${psSingleQuote(`${ESC}]633;D;`)} + $exit + ${psSingleQuote(BEL)})`,
    `[Console]::Out.Write(${psSingleQuote(`${ESC}]633;P;Cwd=`)} + (Get-Location).Path + ${psSingleQuote(BEL)})`,
    "exit $exit",
  ].join("; ")
  return ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand]
}

function buildBashCommand(command) {
  return [
    `printf '\\033]633;E;%s\\007' ${bashSingleQuote(encodeOsc(command))}`,
    "printf '\\033]633;C\\007'",
    command,
    "__codek_exit=$?",
    "printf '\\033]633;D;%s\\007' \"$__codek_exit\"",
    "printf '\\033]633;P;Cwd=%s\\007' \"$PWD\"",
    "exit $__codek_exit",
  ].join("; ")
}

function runSmoke(shellType) {
  const command = shellType === "cmd" ? "echo codek-shell-smoke" : "node -e \"process.stdout.write('codek-shell-smoke')\""
  let file
  let args
  if (shellType === "powershell") {
    file = "powershell.exe"
    args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", buildPowerShellCommand(command)]
  } else if (shellType === "cmd") {
    file = "powershell.exe"
    args = buildCmdCommand(command)
  } else {
    const gitBash = path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe")
    file = fs.existsSync(gitBash) ? gitBash : "bash"
    args = ["-lc", buildBashCommand(command)]
  }

  const startedAt = Date.now()
  const result = spawnSync(file, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  })
  const output = `${result.stdout || ""}${result.stderr || ""}`
  const events = parseOsc633(output)
  const hasCommand = events.some((event) => event.type === "commandLine" && event.value === command)
  const hasExecuted = events.some((event) => event.type === "commandExecuted")
  const finished = events.find((event) => event.type === "commandFinished")
  const hasCwd = events.some((event) => event.type === "property" && String(event.value || "").startsWith("Cwd="))
  const ok = result.status === 0 && hasCommand && hasExecuted && finished?.exitCode === 0 && hasCwd && output.includes("codek-shell-smoke")
  return {
    shellType,
    ok,
    skipped: Boolean(result.error && result.error.code === "ENOENT"),
    status: result.status,
    signal: result.signal,
    durationMs: Date.now() - startedAt,
    events: events.map((event) => event.type),
    error: result.error ? result.error.message : "",
  }
}

function buildShellIntegrationReport(options = {}) {
  const requested = options.all ? ["powershell", "cmd", "gitbash"] : options.shells || []
  const shells = requested.length ? requested : ["powershell", "cmd", "gitbash"]
  const checks = shells.map(runSmoke)
  const failed = checks.filter((check) => !check.ok && !check.skipped)
  return {
    reportKind: "shell-integration-smoke",
    createdAt: Date.now(),
    ready: failed.length === 0,
    status: failed.length > 0 ? "blocked" : "ready",
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.ok).length,
      skipped: checks.filter((check) => check.skipped).length,
      failed: failed.length,
    },
    checks,
  }
}

function toMarkdown(report) {
  const rows = (report.checks || []).map((check) =>
    `| ${check.shellType} | ${check.ok ? "passed" : check.skipped ? "skipped" : "failed"} | ${check.durationMs}ms | ${check.status ?? "-"} | ${String(check.error || "").replace(/\|/g, "\\|") || "-"} |`,
  )
  return [
    "# Shell Integration Smoke",
    "",
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Summary: ${report.summary.passed}/${report.summary.total} passed, ${report.summary.skipped} skipped, ${report.summary.failed} failed`,
    "",
    "| Shell | Status | Duration | Exit Code | Error |",
    "| --- | --- | ---: | --- | --- |",
    ...rows,
  ].join("\n")
}

function saveShellIntegrationReport(report, options = {}) {
  const reportDir = options.reportDir || path.join(__dirname, "..", ".codek", "reports")
  fs.mkdirSync(reportDir, { recursive: true })
  const jsonPath = path.join(reportDir, "shell-integration-smoke-latest.json")
  const markdownPath = path.join(reportDir, "shell-integration-smoke-latest.md")
  const payload = { ...report, latestJsonPath: jsonPath, latestMarkdownPath: markdownPath }
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  fs.writeFileSync(markdownPath, `${toMarkdown(payload)}\n`, "utf8")
  return { report: payload, jsonPath, markdownPath }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = buildShellIntegrationReport(options)
  if (!options.noWrite) saveShellIntegrationReport(report, options)
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main()
}

module.exports = {
  buildShellIntegrationReport,
  parseArgs,
  saveShellIntegrationReport,
  toMarkdown,
}
