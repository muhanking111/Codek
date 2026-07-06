#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const root = path.resolve(__dirname, "..")
const desktopDir = path.join(root, "desktop")
const packagedExe = path.join(desktopDir, "release", "win-unpacked", "Codek.exe")
const packagedUserDataDir = path.join(root, ".codek", "electron-packaged-smoke-user-data")
const packagedSmokeResultFile = path.join(root, ".codek", "reports", "packaged-app-smoke-result.json")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function relativePath(filePath) {
  return path.relative(root, filePath)
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const timeoutArg = argv.find((arg) => arg.startsWith("--timeout-ms="))
  return {
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
    noWrite: argv.includes("--no-write"),
    timeoutMs: timeoutArg ? Number(timeoutArg.slice("--timeout-ms=".length)) : 90000,
  }
}

function extractBalancedJson(text, startIndex) {
  let depth = 0
  let inString = false
  let escaped = false
  let started = false
  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i]
    if (!started) {
      if (ch === "{") {
        started = true
        depth = 1
      }
      continue
    }
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === "\\") {
      escaped = true
      continue
    }
    if (ch === "\"") {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === "{") depth += 1
    if (ch === "}") depth -= 1
    if (depth === 0) {
      return text.slice(startIndex, i + 1)
    }
  }
  return ""
}

function parseSmokeOutput(output) {
  const marker = "[electron-smoke]"
  const markerIndex = output.lastIndexOf(marker)
  if (markerIndex < 0) {
    return { ok: false, checks: [], error: "missing [electron-smoke] marker" }
  }
  const jsonStart = output.indexOf("{", markerIndex)
  if (jsonStart < 0) {
    return { ok: false, checks: [], error: "missing smoke JSON payload" }
  }
  const jsonText = extractBalancedJson(output, jsonStart)
  if (!jsonText) {
    return { ok: false, checks: [], error: "incomplete smoke JSON payload" }
  }
  try {
    const parsed = JSON.parse(jsonText)
    return {
      ok: Boolean(parsed.ok),
      checks: Array.isArray(parsed.checks) ? parsed.checks : [],
      error: "",
    }
  } catch (error) {
    return { ok: false, checks: [], error: String(error?.message || error) }
  }
}

function readSmokeResultFile(filePath = packagedSmokeResultFile) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function buildReportFromResult(result, input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const output = `${result.stdout || ""}\n${result.stderr || ""}`
  const filePayload = input.smokePayload || readSmokeResultFile(input.smokeResultFile || packagedSmokeResultFile)
  const parsed = filePayload
    ? {
        ok: Boolean(filePayload.ok),
        checks: Array.isArray(filePayload.checks) ? filePayload.checks : [],
        error: String(filePayload.error || ""),
      }
    : parseSmokeOutput(output)
  const exitCode = typeof result.status === "number" ? result.status : result.error ? 1 : 0
  const executableExists = fs.existsSync(packagedExe)
  const userDataExists = fs.existsSync(packagedUserDataDir)
  const checks = [
    {
      id: "packaged_executable",
      title: "win-unpacked/Codek.exe",
      status: executableExists ? "passed" : "failed",
      detail: executableExists ? `${relativePath(packagedExe)} exists` : `${relativePath(packagedExe)} missing`,
      nextAction: executableExists ? "" : "Run npm run pack:win before packaged smoke.",
    },
    {
      id: "packaged_launch_exit_code",
      title: "packaged app launch exit code",
      status: exitCode === 0 ? "passed" : "failed",
      detail: `exitCode=${exitCode}`,
      nextAction: exitCode === 0 ? "" : "Inspect the packaged smoke stderr excerpt and fix the failing startup path.",
    },
    {
      id: "packaged_smoke_payload",
      title: "main process smoke payload",
      status: parsed.ok ? "passed" : "failed",
      detail: parsed.ok
        ? `${parsed.checks.length} smoke checks reported${filePayload ? " via result file" : ""}`
        : parsed.error || "smoke payload reported failure",
      nextAction: parsed.ok ? "" : "Run npm run smoke:packaged locally and fix the first failed check.",
    },
    {
      id: "packaged_user_data_dir",
      title: "isolated packaged smoke user data",
      status: userDataExists ? "passed" : "failed",
      detail: userDataExists ? `${relativePath(packagedUserDataDir)} exists` : `${relativePath(packagedUserDataDir)} missing`,
      nextAction: userDataExists ? "" : "Ensure electron-ui-smoke passes --user-data-dir for packaged mode.",
    },
  ]

  const failedSmokeChecks = parsed.checks
    .filter((item) => !item.passed)
    .map((item) => ({
      name: item.name || "unknown",
      detail: String(item.detail || "").slice(0, 240),
    }))
  for (const failed of failedSmokeChecks.slice(0, 12)) {
    checks.push({
      id: `smoke_check_${checks.length}`,
      title: failed.name,
      status: "failed",
      detail: failed.detail || "reported false",
      nextAction: "Fix the packaged UI smoke check and rerun scripts/packaged-app-smoke.js.",
    })
  }

  const passed = checks.filter((item) => item.status === "passed").length
  const failed = checks.filter((item) => item.status === "failed").length
  const ready = failed === 0 && parsed.ok && exitCode === 0
  const stderrExcerpt = String(result.stderr || "").split(/\r?\n/).filter(Boolean).slice(-20).join("\n").slice(0, 2400)

  return {
    reportKind: "packaged-app-smoke",
    createdAt,
    ready,
    status: ready ? "ready" : "blocked",
    statusLabel: ready ? "packaged app smoke passed" : "packaged app smoke blocked",
    summary: {
      total: checks.length,
      passed,
      warning: 0,
      failed,
      smokeChecks: parsed.checks.length,
      failedSmokeChecks: failedSmokeChecks.length,
    },
    artifact: {
      executable: relativePath(packagedExe),
      userDataDir: relativePath(packagedUserDataDir),
      smokeResultFile: relativePath(input.smokeResultFile || packagedSmokeResultFile),
    },
    checks,
    smokeChecks: parsed.checks.map((item) => ({
      name: item.name || "unknown",
      passed: Boolean(item.passed),
      detail: String(item.detail || "").slice(0, 240),
    })),
    stderrExcerpt,
    scope: {
      realInstallExecuted: false,
      realLaunchExecuted: true,
      packagedEnvironment: true,
      note: "This smoke launches desktop/release/win-unpacked/Codek.exe with an isolated local user-data-dir. It does not run the NSIS installer or write to the real user profile.",
    },
  }
}

function runPackagedAppSmoke(input = {}, runner = spawnSync) {
  const timeoutMs = Number(input.timeoutMs || 90000)
  const smokeResultFile = input.smokeResultFile || packagedSmokeResultFile
  fs.rmSync(smokeResultFile, { force: true })
  const env = {
    ...process.env,
    CODEK_ELECTRON_SMOKE_TIMEOUT_MS: String(Math.max(60000, timeoutMs - 10000)),
    CODEK_ELECTRON_SMOKE_RESULT_FILE: smokeResultFile,
  }
  const result = runner(process.execPath, [
    "scripts/electron-ui-smoke.js",
    "--packaged",
    "--login-workbench",
  ], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 10,
  })
  return buildReportFromResult(result, { ...input, smokeResultFile, smokePayload: readSmokeResultFile(smokeResultFile) })
}

function paths(reportDir = defaultReportDir()) {
  const resolved = reportDir || defaultReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "packaged-app-smoke-latest.json"),
    latestMarkdownPath: path.join(resolved, "packaged-app-smoke-latest.md"),
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
  const smokeRows = (report.smokeChecks || []).slice(0, 80).map((item) =>
    `| ${escape(item.name)} | ${item.passed ? "passed" : "failed"} | ${escape(item.detail || "-")} |`,
  )
  return [
    "# Packaged App Smoke",
    "",
    `- Status: ${report.statusLabel}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Created At: ${new Date(report.createdAt).toISOString()}`,
    `- Executable: ${report.artifact.executable}`,
    `- User Data Dir: ${report.artifact.userDataDir}`,
    `- Smoke Result File: ${report.artifact.smokeResultFile}`,
    `- Summary: passed=${report.summary.passed}/${report.summary.total}, failed=${report.summary.failed}, smokeChecks=${report.summary.smokeChecks}`,
    "",
    "## Checks",
    "",
    "| Check | Status | Detail | Next Action |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## Renderer/Main Smoke Checks",
    "",
    "| Check | Status | Detail |",
    "| --- | --- | --- |",
    ...(smokeRows.length ? smokeRows : ["| - | - | - |"]),
    "",
    "## Boundaries",
    "",
    "- Launches win-unpacked/Codek.exe, not the development Electron binary.",
    "- Uses an isolated .codek user-data-dir and does not run the NSIS installer.",
    "- Does not store full command output, prompt/response bodies, API keys, or user file bodies.",
  ].join("\n")
}

function save(report, options = {}) {
  const p = paths(options.reportDir)
  fs.mkdirSync(p.reportDir, { recursive: true })
  fs.mkdirSync(p.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJson = path.join(p.historyDir, `packaged-app-smoke-${stamp}.json`)
  const historyMd = path.join(p.historyDir, `packaged-app-smoke-${stamp}.md`)
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
    report: JSON.parse(fs.readFileSync(p.latestJsonPath, "utf8")),
    markdown: fs.existsSync(p.latestMarkdownPath) ? fs.readFileSync(p.latestMarkdownPath, "utf8") : "",
    ...p,
  }
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2))
  const report = runPackagedAppSmoke(options)
  const saved = options.noWrite ? { latestJsonPath: "", latestMarkdownPath: "" } : save(report, options)
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    jsonPath: saved.latestJsonPath || "",
    markdownPath: saved.latestMarkdownPath || "",
  }, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

module.exports = {
  buildReportFromResult,
  defaultReportDir,
  parseSmokeOutput,
  readLatest,
  runPackagedAppSmoke,
  save,
  toMarkdown,
  readSmokeResultFile,
}
