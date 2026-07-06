const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const root = path.resolve(__dirname, "..")
const reportDir = path.join(root, ".codek", "reports")

function parseArgs(argv) {
  const roundsArg = argv.find((arg) => arg.startsWith("--rounds="))
  const rootArg = argv.find((arg) => arg.startsWith("--root="))
  return {
    rounds: Math.max(1, Math.floor(Number(roundsArg ? roundsArg.slice("--rounds=".length) : 20) || 20)),
    projectRoot: rootArg ? path.resolve(rootArg.slice("--root=".length)) : root,
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function renderMarkdown(report) {
  const lines = [
    "# Workbench Explorer Stress Smoke",
    "",
    `Status: ${report.status}`,
    `Created: ${new Date(report.createdAt).toISOString()}`,
    `Project root: ${report.projectRoot}`,
    `Rounds: ${report.summary.passed}/${report.summary.total} passed`,
    "",
    "## Rounds",
    "",
    ...report.rounds.map((round) => {
      const stress = round.stress || {}
      return `- ${round.status.toUpperCase()} #${round.round}: checks=${round.passedChecks}/${round.totalChecks}, domRows=${stress.domRows || 0}, p95=${stress.p95ScrollMs || 0}ms, max=${stress.maxScrollMs || 0}ms, selectedMax=${stress.selectedRowCountMax || 0}, blank=${Boolean(stress.blankVisibleRows || stress.reopenBlankVisibleRows)}, scrollReset=${Boolean(stress.scrollResetToTop)}`
    }),
    "",
  ]
  const failures = report.rounds.filter((round) => round.status !== "passed")
  if (failures.length) {
    lines.push("## Failures", "")
    for (const round of failures) {
      lines.push(`- #${round.round}: ${round.error || round.failedChecks.map((check) => `${check.name}: ${check.detail}`).join("; ")}`)
    }
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

function writeReport(report) {
  fs.mkdirSync(reportDir, { recursive: true })
  const stamp = new Date(report.createdAt).toISOString().replace(/[:.]/g, "-")
  const jsonPath = path.join(reportDir, `workbench-explorer-stress-${stamp}.json`)
  const latestJsonPath = path.join(reportDir, "workbench-explorer-stress-latest.json")
  const latestMarkdownPath = path.join(reportDir, "workbench-explorer-stress-latest.md")
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestMarkdownPath, renderMarkdown(report), "utf8")
  return { jsonPath, latestJsonPath, latestMarkdownPath }
}

function runRound(round, projectRoot) {
  const resultFile = path.join(reportDir, `electron-smoke-explorer-stress-round-${String(round).padStart(3, "0")}.json`)
  try {
    fs.rmSync(resultFile, { force: true })
  } catch {
    // ignore stale report cleanup failures
  }
  const env = {
    ...process.env,
    CODEK_ELECTRON_SMOKE_RESULT_FILE: resultFile,
    CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT: projectRoot,
    CODEK_ELECTRON_SMOKE_TIMEOUT_MS: process.env.CODEK_ELECTRON_SMOKE_TIMEOUT_MS || "120000",
  }
  const started = Date.now()
  const result = spawnSync(process.execPath, ["scripts/electron-ui-smoke.js", "--explorer-stress"], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: Number(env.CODEK_ELECTRON_SMOKE_TIMEOUT_MS) + 45000,
  })
  const durationMs = Date.now() - started
  const report = fs.existsSync(resultFile) ? readJson(resultFile) : null
  const checks = Array.isArray(report?.checks) ? report.checks : []
  const failedChecks = checks.filter((check) => !check.passed)
  const stress = report?.stage?.explorerStress || report?.lastStage?.detail?.explorerStress || report?.explorerStress || null
  const rendererStage = report?.stage?.explorerStress || null
  const stressResult = report?.checks
    ? null
    : null
  return {
    round,
    status: result.status === 0 && report?.ok === true && failedChecks.length === 0 ? "passed" : "failed",
    exitCode: result.status,
    durationMs,
    resultFile,
    totalChecks: checks.length,
    passedChecks: checks.filter((check) => check.passed).length,
    failedChecks,
    error: report?.error || result.error?.message || "",
    stdoutTail: String(result.stdout || "").slice(-4000),
    stderrTail: String(result.stderr || "").slice(-4000),
    stress: extractStressResult(report, rendererStage, stressResult, result.stdout),
  }
}

function extractStressResult(report, rendererStage, stressResult, stdout) {
  if (stressResult) return stressResult
  const checks = Array.isArray(report?.checks) ? report.checks : []
  const detailCheck = checks.find((check) => String(check.name || "").includes("explorer stress smoke native host mounted"))
  if (detailCheck?.detail) {
    try {
      return JSON.parse(detailCheck.detail)
    } catch {
      // continue to stdout parse
    }
  }
  if (rendererStage && typeof rendererStage === "object") return rendererStage
  const match = String(stdout || "").match(/"explorer stress smoke native host mounted"[\s\S]*?"detail": "([^"]+)"/)
  if (match) {
    try {
      return JSON.parse(match[1].replace(/\\"/g, '"'))
    } catch {
      return null
    }
  }
  return null
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!fs.existsSync(args.projectRoot) || !fs.statSync(args.projectRoot).isDirectory()) {
    throw new Error(`Explorer stress root missing: ${args.projectRoot}`)
  }
  const rounds = []
  for (let round = 1; round <= args.rounds; round += 1) {
    process.stdout.write(`[explorer-stress] round ${round}/${args.rounds}\n`)
    const result = runRound(round, args.projectRoot)
    rounds.push(result)
    if (result.status !== "passed") {
      process.stdout.write(`[explorer-stress] round ${round} failed\n`)
      break
    }
  }
  const summary = {
    total: args.rounds,
    executed: rounds.length,
    passed: rounds.filter((round) => round.status === "passed").length,
    failed: rounds.filter((round) => round.status !== "passed").length,
  }
  const report = {
    reportKind: "workbench-explorer-stress-smoke",
    createdAt: Date.now(),
    projectRoot: args.projectRoot,
    status: summary.failed === 0 && summary.executed === args.rounds ? "ready" : "blocked",
    ready: summary.failed === 0 && summary.executed === args.rounds,
    summary,
    rounds,
  }
  const paths = writeReport(report)
  process.stdout.write(`${JSON.stringify({ ...summary, ready: report.ready, reportPath: paths.latestJsonPath }, null, 2)}\n`)
  if (!report.ready) process.exitCode = 1
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
