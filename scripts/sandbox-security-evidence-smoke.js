#!/usr/bin/env node

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const assert = require("node:assert/strict")

const orchestrator = require("../desktop/services/agentLoop/orchestrator")
const planTree = require("../desktop/services/agentLoop/planTree")
const planExecutor = require("../desktop/services/agentLoop/planExecutor")
const {
  sanitizeSandboxSecuritySourceRun,
  saveSandboxSecurityEvidence,
  summarizeSandboxSecurityEvidence,
} = require("../desktop/services/agentLoop/sandboxSecurityEvidence")

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  return {
    noWrite: argv.includes("--no-write"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : path.join(path.resolve(__dirname, ".."), ".codek", "reports"),
  }
}

async function buildRun() {
  orchestrator.reset()
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-sandbox-evidence-"))
  orchestrator.configureStore({ dbPath: path.join(projectRoot, "orchestrator.db") })
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ private: true, scripts: { typecheck: "node -e \"process.exit(0)\"" } }, null, 2), "utf8")
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, "src", "app.js"), "export const value = 1\n", "utf8")

  const plan = planTree.createPlan("sandbox-security-evidence", [
    { id: "phase_1", name: "更新受控文件", tasks: [{ description: "修改 src/app.js", files: ["src/app.js"] }] },
  ])

  const originalExecute = planExecutor.execute
  planExecutor.execute = async ({ plan, emit }) => {
    fs.writeFileSync(path.join(plan.phases[0].workspaceRoot, "src", "app.js"), "export const value = 2\n", "utf8")
    emit({ type: "phase_start", phaseId: "phase_1" })
    emit({ type: "phase_done", phaseId: "phase_1", summary: "metadata-only sandbox smoke", filesChanged: ["src/app.js"] })
    return { plan, summary: "metadata-only sandbox smoke" }
  }

  try {
    const run = await orchestrator.startRun({
      projectRoot,
      visibleMode: "agent",
      userInput: "生成沙箱安全证据",
      plan,
      workspaceIsolation: "auto",
      qualityGateCommands: ["npm run typecheck"],
      realWorkspaceTrial: {
        allowedPaths: ["src"],
        qualityGateCommands: ["npm run typecheck"],
      },
    })

    assert.equal(run.status, "waiting_user")
    assert.ok(run.integrationDecision.proposedPatch?.filesChanged?.includes("src/app.js"))

    const accepted = orchestrator.applyDecision(run.id, "accepted")
    assert.equal(accepted.status, "accepted")
    assert.equal(accepted.qualityGate?.status, "passed")
    const completed = orchestrator.getRun(run.id)
    assert.equal(completed.integrationDecision?.qualityGate?.status, "passed")
    return {
      ...completed,
      source: "sandbox-security-evidence-smoke",
    }
  } finally {
    planExecutor.execute = originalExecute
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const run = await buildRun()
  const summary = summarizeSandboxSecurityEvidence([run])
  const report = {
    reportKind: "sandbox-security-evidence",
    createdAt: Date.now(),
    ...summary,
    sourceRun: sanitizeSandboxSecuritySourceRun(run),
  }
  const saved = options.noWrite
    ? { report, jsonPath: "", markdownPath: "" }
    : saveSandboxSecurityEvidence(report, { reportDir: options.reportDir })
  process.stdout.write(`${JSON.stringify({
    reportKind: "sandbox-security-evidence",
    ready: saved.report.ready,
    status: saved.report.status,
    summary: {
      assignments: saved.report.assignmentCount,
      isolatedAssignments: saved.report.isolatedAssignments,
      qualityGateStatus: saved.report.qualityGateStatus,
      commandAuthorizationBlocked: saved.report.commandAuthorizationBlocked,
      violations: saved.report.violations.length,
    },
    jsonPath: saved.jsonPath,
    markdownPath: saved.markdownPath,
  }, null, 2)}\n`)
  process.exit(saved.report.ready ? 0 : 1)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`)
    process.exit(1)
  })
}
