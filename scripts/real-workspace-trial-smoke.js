#!/usr/bin/env node

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const orchestrator = require("../desktop/services/agentLoop/orchestrator")
const planTree = require("../desktop/services/agentLoop/planTree")
const planExecutor = require("../desktop/services/agentLoop/planExecutor")

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  return {
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : fs.mkdtempSync(path.join(os.tmpdir(), "codek-real-trial-smoke-reports-")),
  }
}

function writeProject(root, source = "export const value = 1\n") {
  fs.mkdirSync(path.join(root, "src"), { recursive: true })
  fs.writeFileSync(path.join(root, "src", "app.js"), source, "utf8")
}

function createPlan() {
  return planTree.createPlan("真实工作区试运行 smoke", [
    { id: "phase_1", name: "实现改动", tasks: [{ description: "修改 src/app.js", files: ["src/app.js"] }] },
  ])
}

function createContextEvidence() {
  return {
    mentions: [{ type: "file", id: "src/app.js", label: "src/app.js", detail: "smoke fixture metadata" }],
    attachments: [{ name: "smoke-notes.md", size: 80, type: "text/markdown", kind: "text", status: "ready", truncated: false, contentLength: 80 }],
    rules: [{ path: ".codek/rules/smoke.md", title: "Smoke rules", glob: "src/**", priority: 10, contentLength: 60, truncated: false }],
    workspaceSources: [
      { type: "active-file", label: "src/app.js", path: "src/app.js", contentLength: 120, truncated: false },
      { type: "diagnostics", label: "diagnostics", count: 0, contentLength: 0, truncated: false },
    ],
    indexStatus: {
      enabled: true,
      state: "ready",
      indexedFiles: 1,
      indexableFiles: 1,
      excludedFiles: 0,
      workspaceRoots: 1,
      freshness: "fresh",
      updatedAt: Date.now(),
    },
    warnings: [],
    budget: {
      totalSources: 5,
      estimatedChars: 260,
      contextBlockChars: 120,
      attachmentTextChars: 80,
      ruleChars: 60,
      workspaceContextChars: 120,
      truncatedSources: 0,
      warningCount: 0,
      policy: {
        modelWindowChars: 64000,
        reservedResponseChars: 8000,
        availableContextChars: 56000,
        taskType: "implementation",
        riskLevel: "medium",
        allocation: { workspace: 31360, mentions: 10080, attachments: 7840, rules: 4480, diagnostics: 2240 },
        overflowChars: 0,
      },
    },
  }
}

async function withStubbedExecutor(content, callback) {
  const originalExecute = planExecutor.execute
  planExecutor.execute = async ({ plan, emit }) => {
    fs.writeFileSync(path.join(plan.phases[0].workspaceRoot, "src", "app.js"), content, "utf8")
    emit({ type: "phase_start", phaseId: "phase_1" })
    emit({ type: "phase_done", phaseId: "phase_1", summary: "done", filesChanged: ["src/app.js"] })
    return { plan, summary: "done" }
  }
  try {
    return await callback()
  } finally {
    planExecutor.execute = originalExecute
  }
}

async function startTrial(projectRoot, plan, qualityGateCommands = ["node --check src/app.js"]) {
  return orchestrator.startRealWorkspaceTrial({
    projectRoot,
    userInput: "真实工作区受控试运行 smoke",
    files: ["src/app.js"],
    plan,
    contextEvidence: createContextEvidence(),
    settings: {
      "codek.agent.realWorkspaceTrial.allowedPaths": ["src"],
      "codek.agent.realWorkspaceTrial.qualityGateCommands": qualityGateCommands,
    },
  })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const previousSmoke = process.env.CODEK_ELECTRON_SMOKE
  const previousData = process.env.CODEK_DATA
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-real-trial-smoke-data-"))
  let store = null
  process.env.CODEK_ELECTRON_SMOKE = "1"
  process.env.CODEK_DATA = dataDir
  orchestrator.reset()
  store = orchestrator.configureStore({ dbPath: path.join(dataDir, "orchestrator.db") })
  try {
    const reportDir = options.reportDir
    const cleanProject = fs.mkdtempSync(path.join(os.tmpdir(), "codek-real-trial-clean-"))
    writeProject(cleanProject)

    const acceptedContent = "export const value = 2\n"
    const cleanRun = await withStubbedExecutor(acceptedContent, () => startTrial(cleanProject, createPlan()))

    assert.equal(cleanRun.policyProfile, "real-workspace-trial")
    assert.equal(cleanRun.realWorkspaceTrial.writeMode, "proposed_patch_only")
    assert.equal(fs.readFileSync(path.join(cleanProject, "src", "app.js"), "utf8"), "export const value = 1\n")

    const cleanReport = orchestrator.getRunReport(cleanRun.id)
    assert.equal(cleanReport.realWorkspaceTrial.mainWorkspaceUntouchedBeforeAccept, true)
    const saved = orchestrator.saveReportForRun(cleanRun.id, { reportDir })
    assert.equal(fs.existsSync(saved.realWorkspaceTrialMarkdownPath), true)
    assert.equal(fs.existsSync(saved.realWorkspaceTrialJsonPath), true)
    assert.equal(fs.existsSync(saved.realWorkspaceTrialHistoryMarkdownPath), true)
    assert.equal(fs.existsSync(saved.realWorkspaceTrialHistoryJsonPath), true)

    const accepted = orchestrator.applyDecision(cleanRun.id, "accepted")
    assert.equal(accepted.status, "accepted")
    assert.equal(fs.readFileSync(path.join(cleanProject, "src", "app.js"), "utf8").replace(/\r\n/g, "\n"), acceptedContent)

    const rolledBack = orchestrator.applyDecision(cleanRun.id, "rollback")
    assert.equal(rolledBack.status, "rolled_back")
    assert.equal(fs.readFileSync(path.join(cleanProject, "src", "app.js"), "utf8"), "export const value = 1\n")
    const rollbackSaved = orchestrator.saveReportForRun(cleanRun.id, { reportDir })
    assert.equal(rollbackSaved.report.realWorkspaceTrial.mainWorkspaceUntouchedBeforeAccept, true)
    assert.equal(rollbackSaved.report.realWorkspaceTrial.rollbackAvailable, true)

    const failedProject = fs.mkdtempSync(path.join(os.tmpdir(), "codek-real-trial-fail-"))
    writeProject(failedProject)
    const failedRun = await withStubbedExecutor(
      "export const value = 2\n",
      () => startTrial(failedProject, createPlan(), ["node --test missing-test-file.js"]),
    )
    const failedDecision = orchestrator.applyDecision(failedRun.id, "accepted")
    assert.equal(failedDecision.status, "rework_requested")
    assert.equal(orchestrator.getRun(failedRun.id).status, "waiting_user")

    const result = {
      ok: true,
      reportDir,
      cleanProject,
      failedProject,
      checks: [
        "proposal-only",
        "report-latest-history",
        "accept",
        "rollback",
        "quality-gate-rework",
      ],
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } finally {
    orchestrator.reset()
    try { store?.close?.() } catch {}
    if (previousSmoke == null) delete process.env.CODEK_ELECTRON_SMOKE
    else process.env.CODEK_ELECTRON_SMOKE = previousSmoke
    if (previousData == null) delete process.env.CODEK_DATA
    else process.env.CODEK_DATA = previousData
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`)
  process.exit(1)
})

module.exports = {
  main,
  parseArgs,
}
