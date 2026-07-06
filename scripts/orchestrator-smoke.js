const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const assert = require("node:assert/strict")

const orchestrator = require("../desktop/services/agentLoop/orchestrator")
const planTree = require("../desktop/services/agentLoop/planTree")
const planExecutor = require("../desktop/services/agentLoop/planExecutor")
const artifactStore = require("../desktop/services/agentLoop/artifactStore")
const integrator = require("../desktop/services/agentLoop/integrator")

async function runApplySmoke() {
  orchestrator.reset()
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-orch-smoke-"))
  orchestrator.configureStore({ dbPath: path.join(projectRoot, "orchestrator.db") })
  fs.writeFileSync(path.join(projectRoot, "demo.js"), "export const value = 1\n", "utf8")

  const plan = planTree.createPlan("smoke", [
    { id: "phase_1", name: "修改 demo", tasks: [{ description: "修改 demo.js", files: ["demo.js"] }] },
  ])

  const originalExecute = planExecutor.execute
  planExecutor.execute = async ({ plan, emit }) => {
    fs.writeFileSync(path.join(plan.phases[0].workspaceRoot, "demo.js"), "export const value = 2\n", "utf8")
    emit({ type: "phase_start", phaseId: "phase_1" })
    emit({ type: "phase_done", phaseId: "phase_1", summary: "done", filesChanged: ["demo.js"] })
    return { plan, summary: "done" }
  }

  let run
  try {
    run = await orchestrator.startRun({
      projectRoot,
      visibleMode: "agent",
      userInput: "smoke 修改 demo.js",
      plan,
      workspaceIsolation: "auto",
      qualityGateCommands: ["node -e \"process.exit(0)\""],
    })
  } finally {
    planExecutor.execute = originalExecute
  }

  assert.equal(run.status, "waiting_user")
  assert.ok(run.integrationDecision?.proposedPatch?.patches?.length)
  const diff = integrator.createIntegrationDecision({
    runId: run.id,
    assignments: run.assignments,
    artifacts: artifactStore.listArtifacts(run.id),
    qualityGate: run.integrationDecision.qualityGate || null,
  }).proposedPatch
  assert.equal(diff.filesChanged[0], "demo.js")

  const decision = orchestrator.applyDecision(run.id, "accepted")
  assert.equal(decision.status, "accepted")
  assert.equal(fs.readFileSync(path.join(projectRoot, "demo.js"), "utf8").replace(/\r\n/g, "\n"), "export const value = 2\n")

  return { runId: run.id, projectRoot }
}

async function runRecoverySmoke() {
  orchestrator.reset()
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-orch-recovery-smoke-"))
  orchestrator.configureStore({ dbPath: path.join(projectRoot, "orchestrator.db") })
  const plan = planTree.createPlan("recovery-smoke", [
    { id: "phase_1", name: "失败任务", tasks: [{ description: "失败", files: ["demo.js"] }] },
  ])

  const originalExecute = planExecutor.execute
  planExecutor.execute = async ({ emit }) => {
    emit({ type: "phase_start", phaseId: "phase_1" })
    emit({ type: "phase_failed", phaseId: "phase_1", error: "smoke failure" })
    throw new Error("smoke failure")
  }

  let run
  try {
    run = await orchestrator.startRun({
      projectRoot,
      visibleMode: "agent",
      userInput: "smoke 失败恢复",
      plan,
      workspaceIsolation: "auto",
    })
  } finally {
    planExecutor.execute = originalExecute
  }

  assert.equal(run.status, "failed")
  const actions = orchestrator.listRecoveryActions(run.id)
  assert.ok(actions.some((action) => action.action === "retry"))
  assert.ok(actions.some((action) => action.action === "ask_user"))

  const retry = actions.find((action) => action.action === "retry")
  const retryResult = orchestrator.executeRecoveryAction(run.id, retry.id)
  assert.equal(retryResult.action.status, "completed")
  assert.equal(retryResult.run.assignments[0].status, "queued")

  return { runId: run.id, actionCount: actions.length }
}

async function main() {
  const apply = await runApplySmoke()
  const recovery = await runRecoverySmoke()
  process.stdout.write(JSON.stringify({ ok: true, apply, recovery }, null, 2))
  process.stdout.write("\n")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
