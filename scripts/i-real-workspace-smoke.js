const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const orchestrator = require("../desktop/services/agentLoop/orchestrator")
const { summarizeDiff } = require("../desktop/services/agentLoop/diffSummary")
const { normalizeInterruptedRun } = require("../desktop/services/agentLoop/orchestratorStore")

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  return {
    noWrite: argv.includes("--no-write"),
    requireJ: argv.includes("--require-j"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : fs.mkdtempSync(path.join(os.tmpdir(), "codek-i-smoke-reports-")),
  }
}

function withSmokeFixture(callback) {
  const previous = process.env.CODEK_ELECTRON_SMOKE
  const previousData = process.env.CODEK_DATA
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-i-smoke-data-"))
  let store = null
  process.env.CODEK_ELECTRON_SMOKE = "1"
  process.env.CODEK_DATA = dataDir
  orchestrator.reset()
  try {
    store = orchestrator.configureStore({ dbPath: path.join(dataDir, "orchestrator.db") })
    return callback()
  } finally {
    orchestrator.reset()
    try { store?.close?.() } catch {}
    if (previous == null) delete process.env.CODEK_ELECTRON_SMOKE
    else process.env.CODEK_ELECTRON_SMOKE = previous
    if (previousData == null) delete process.env.CODEK_DATA
    else process.env.CODEK_DATA = previousData
  }
}

async function runRealWorkspaceSmoke(options = {}) {
  const reportDir = options.reportDir || fs.mkdtempSync(path.join(os.tmpdir(), "codek-i-smoke-reports-"))
  return withSmokeFixture(() => {
    const run = orchestrator.createSmokePendingRunFixture()
    const mutable = orchestrator._unsafeGetMutableRunForTest(run.id)
    fs.writeFileSync(path.join(mutable.projectRoot, "package.json"), `${JSON.stringify({ name: "codek-i-smoke", type: "module" }, null, 2)}\n`, "utf8")
    mutable.qualityGateCommands = ["npm run typecheck"]
    mutable.permissionRequest = {
      id: "permission_i_smoke",
      runId: mutable.id,
      status: "approved",
      risk: "medium",
      readPaths: ["demo.js"],
      writePaths: ["demo.js"],
      commandAllowlist: ["npm run typecheck"],
      network: false,
      install: false,
      externalTool: false,
      destructive: false,
      reason: "I 线 smoke 仅允许临时项目内 demo.js 写入和类型检查命令",
      createdAt: Date.now(),
      decidedAt: Date.now(),
      decisionReason: "smoke approved",
    }
    mutable.recoveryRecommendation = {
      action: "retry",
      reason: "I 线 smoke 验证报告可展示恢复建议",
      createdAt: Date.now(),
    }

    const diffSummary = summarizeDiff(mutable.integrationDecision.proposedPatch, mutable)
    const authorization = orchestrator.getRunCommandAuthorization(mutable.id)
    const saved = orchestrator.saveReportForRun(mutable.id, { reportDir })
    const recoveredRunning = normalizeInterruptedRun({ ...mutable, status: "running" })

    const checks = [
      {
        id: "diffSummaryReady",
        passed: diffSummary.totalFiles === 1
          && diffSummary.totalAdditions === 1
          && diffSummary.totalDeletions === 1
          && diffSummary.permissionViolationCount === 0,
      },
      {
        id: "commandAuthorizationReady",
        passed: authorization?.ok === true
          && authorization.allowed === 1
          && authorization.blocked === 0,
      },
      {
        id: "reportSaved",
        passed: Boolean(saved?.markdownPath && saved?.jsonPath)
          && fs.existsSync(saved.markdownPath)
          && fs.existsSync(saved.jsonPath),
      },
      {
        id: "recoveryRecommendationReady",
        passed: recoveredRunning.recoveryRecommendation?.action === "retry"
          && saved?.report?.recoveryRecommendation?.action === "retry",
      },
    ]

    const ready = checks.every((check) => check.passed)
    const jChecks = [
      {
        id: "commandAuthorizationPanelData",
        passed: Boolean(authorization && authorization.total === 1 && authorization.commands[0]?.status === "allowed"),
      },
      {
        id: "reportSavePathReady",
        passed: Boolean(saved?.markdownPath && saved?.jsonPath),
      },
      {
        id: "recoveryRecommendationPanelData",
        passed: Boolean(saved?.report?.recoveryRecommendation?.action),
      },
      {
        id: "diffRiskTotalsReady",
        passed: diffSummary.totalFiles > 0
          && Number.isFinite(diffSummary.totalAdditions)
          && Number.isFinite(diffSummary.totalDeletions)
          && Number.isFinite(diffSummary.permissionViolationCount),
      },
    ]

    return {
      createdAt: Date.now(),
      reportDir: path.resolve(reportDir),
      projectRoot: mutable.projectRoot,
      noWrite: Boolean(options.noWrite),
      ready,
      checks,
      jReady: jChecks.every((check) => check.passed),
      jChecks,
      diffSummary,
      commandAuthorization: authorization,
      savedReport: saved ? {
        markdownPath: saved.markdownPath,
        jsonPath: saved.jsonPath,
      } : null,
      recoveryRecommendation: recoveredRunning.recoveryRecommendation || null,
    }
  })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await runRealWorkspaceSmoke(options)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(report.ready && (options.requireJ ? report.jReady : true) ? 0 : 1)
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err?.stack || err}\n`)
    process.exit(1)
  })
}

module.exports = {
  parseArgs,
  runRealWorkspaceSmoke,
}
