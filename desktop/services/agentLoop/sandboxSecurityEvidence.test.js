const assert = require("node:assert/strict")
const test = require("node:test")
const {
  latestRunWithSandboxEvidence,
  sanitizeSandboxSecuritySourceRun,
  summarizeSandboxSecurityEvidence,
} = require("./sandboxSecurityEvidence")

function readyRun(overrides = {}) {
  return {
    id: "run_sandbox_ready",
    createdAt: 100,
    updatedAt: 200,
    assignments: [{
      id: "assignment_1",
      status: "completed",
      workspace: { isolation: "worktree", status: "released" },
    }],
    permissionRequest: {
      id: "permission_1",
      status: "approved",
      risk: "medium",
      writePaths: ["src"],
      commandAllowlist: ["npm run typecheck"],
      network: false,
      install: false,
      externalTool: false,
      destructive: false,
      reason: "DO_NOT_LEAK_PERMISSION_REASON",
    },
    qualityGateCommands: ["npm run typecheck"],
    integrationDecision: {
      proposedPatch: {
        filesChanged: ["src/app.js"],
        summary: "DO_NOT_LEAK_PATCH_SUMMARY",
      },
      applySnapshot: { id: "snapshot_1" },
      qualityGate: {
        status: "passed",
        summary: "DO_NOT_LEAK_GATE_SUMMARY",
        commandResults: [{
          command: "npm run typecheck",
          exitCode: 0,
          stdout: "DO_NOT_LEAK_STDOUT",
          stderr: "DO_NOT_LEAK_STDERR",
        }],
      },
    },
    ...overrides,
  }
}

test("summarizes isolated sandbox run as ready without leaking prompt, patch, or command output", () => {
  const report = summarizeSandboxSecurityEvidence([readyRun({
    userInput: "DO_NOT_LEAK_USER_PROMPT",
  })])

  assert.equal(report.available, true)
  assert.equal(report.ready, true)
  assert.equal(report.status, "ready")
  assert.equal(report.runId, "run_sandbox_ready")
  assert.equal(report.assignmentCount, 1)
  assert.equal(report.isolatedAssignments, 1)
  assert.equal(report.mainWorkspaceAssignments, 0)
  assert.deepEqual(report.workspaceIsolationTypes, { worktree: 1 })
  assert.equal(report.permissionStatus, "approved")
  assert.equal(report.permissionApproved, true)
  assert.equal(report.writePathCount, 1)
  assert.equal(report.commandAllowlistCount, 1)
  assert.equal(report.qualityGateStatus, "passed")
  assert.equal(report.qualityGateFailures, 0)
  assert.equal(report.commandAuthorizationBlocked, 0)
  assert.equal(report.rollbackAvailable, true)
  assert.deepEqual(report.violations, [])

  const serialized = JSON.stringify(report)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_USER_PROMPT/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_PERMISSION_REASON/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_PATCH_SUMMARY/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_GATE_SUMMARY/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_STDOUT/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_STDERR/)
})

test("marks main workspace, rejected permission, failed gate, and blocked commands as not ready", () => {
  const report = summarizeSandboxSecurityEvidence([readyRun({
    id: "run_sandbox_blocked",
    assignments: [{ id: "assignment_1", status: "running", workspace: { isolation: "main" } }],
    permissionRequest: {
      status: "rejected",
      risk: "high",
      writePaths: ["src"],
      commandAllowlist: [],
      network: false,
      install: false,
      externalTool: false,
    },
    qualityGateCommands: ["npm run deploy"],
    integrationDecision: {
      proposedPatch: { filesChanged: ["src/app.js"] },
      qualityGate: {
        status: "failed",
        commandResults: [{ command: "npm run deploy", exitCode: 1, stdout: "DO_NOT_LEAK_DEPLOY_STDOUT" }],
      },
    },
  })])

  assert.equal(report.available, true)
  assert.equal(report.ready, false)
  assert.equal(report.status, "blocked")
  assert.equal(report.mainWorkspaceAssignments, 1)
  assert.equal(report.permissionRejected, true)
  assert.equal(report.qualityGateStatus, "failed")
  assert.equal(report.qualityGateFailures, 1)
  assert.equal(report.commandAuthorizationBlocked, 1)
  assert.equal(report.rollbackAvailable, false)
  assert.equal(report.violations.some((item) => item.id === "main_workspace_assignment"), true)
  assert.equal(report.violations.some((item) => item.id === "permission_rejected"), true)
  assert.equal(report.violations.some((item) => item.id === "quality_gate_failed"), true)
  assert.equal(report.violations.some((item) => item.id === "command_authorization_blocked"), true)
  assert.doesNotMatch(JSON.stringify(report), /DO_NOT_LEAK_DEPLOY_STDOUT/)
})

test("detects approved permission path violations without persisting file contents", () => {
  const report = summarizeSandboxSecurityEvidence([readyRun({
    id: "run_patch_violation",
    permissionRequest: {
      status: "approved",
      risk: "medium",
      writePaths: ["src"],
      commandAllowlist: ["npm run typecheck"],
      network: false,
      install: false,
      externalTool: false,
    },
    integrationDecision: {
      proposedPatch: {
        filesChanged: ["src/app.js", "secrets/.env"],
        content: "DO_NOT_LEAK_PATCH_CONTENT",
      },
      applySnapshot: { id: "snapshot_1" },
      qualityGate: { status: "passed", commandResults: [{ command: "npm run typecheck", exitCode: 0 }] },
    },
  })])

  assert.equal(report.ready, false)
  assert.equal(report.patchPermissionViolations, 1)
  assert.equal(report.violations.some((item) => item.id === "patch_permission_violation"), true)
  assert.doesNotMatch(JSON.stringify(report), /DO_NOT_LEAK_PATCH_CONTENT/)
})

test("selects the latest run that carries sandbox evidence", () => {
  const selected = latestRunWithSandboxEvidence([
    { id: "no_security", updatedAt: 300, contextEvidence: {} },
    readyRun({ id: "older", updatedAt: 100 }),
    readyRun({ id: "newer", updatedAt: 250 }),
  ])

  assert.equal(selected.id, "newer")
})

test("sanitizes sandbox source runs before persistence", () => {
  const source = readyRun({
    userInput: "DO_NOT_LEAK_USER_PROMPT",
    summary: "DO_NOT_LEAK_RUN_SUMMARY",
    integrationDecision: {
      proposedPatch: {
        filesChanged: ["src/app.js"],
        summary: "DO_NOT_LEAK_PATCH_SUMMARY",
        patches: [{ file: "src/app.js", content: "DO_NOT_LEAK_PATCH_CONTENT" }],
      },
      applySnapshot: { id: "snapshot_1", files: [{ content: "DO_NOT_LEAK_SNAPSHOT_CONTENT" }] },
      applyResult: { status: "applied", filesChanged: ["src/app.js"], appliedAt: 300 },
      qualityGate: {
        status: "passed",
        summary: "DO_NOT_LEAK_GATE_SUMMARY",
        commandResults: [{
          command: "npm run typecheck",
          exitCode: 0,
          stdout: "DO_NOT_LEAK_STDOUT",
          stderr: "DO_NOT_LEAK_STDERR",
          durationMs: 12,
        }],
      },
    },
  })

  const sanitized = sanitizeSandboxSecuritySourceRun(source)

  assert.equal(sanitized.id, "run_sandbox_ready")
  assert.equal(sanitized.integrationDecision.proposedPatch.filesChanged[0], "src/app.js")
  assert.equal(sanitized.integrationDecision.applySnapshot.id, "snapshot_1")
  assert.equal(sanitized.integrationDecision.qualityGate.commandResults[0].command, "npm run typecheck")
  const serialized = JSON.stringify(sanitized)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_USER_PROMPT/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_RUN_SUMMARY/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_PATCH_SUMMARY/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_PATCH_CONTENT/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_SNAPSHOT_CONTENT/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_GATE_SUMMARY/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_STDOUT/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_STDERR/)
})

test("reports missing when no run contains sandbox security evidence", () => {
  const report = summarizeSandboxSecurityEvidence([{ id: "context_only", contextEvidence: {}, updatedAt: 1 }])

  assert.equal(report.available, false)
  assert.equal(report.ready, false)
  assert.equal(report.status, "missing")
  assert.equal(report.assignmentCount, 0)
  assert.deepEqual(report.violations, [{ id: "sandbox_security_missing", severity: "high" }])
})
