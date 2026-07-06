const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildAxEnterpriseGapGate,
  readLatestAxEnterpriseGapGate,
  saveAxEnterpriseGapGate,
} = require("./ax-enterprise-gap-gate")

function readyFixture() {
  return {
    workbenchDeep: {
      ready: true,
      summary: { total: 11, passed: 11, failed: 0 },
      terminal: { splitSessions: [{ id: "term-1" }, { id: "term-2" }] },
      tasks: { app: [{ id: "task-build" }], java: [{ id: "maven-test" }], python: [{ id: "python-test" }] },
    },
    productGradeGate: { ready: true, summary: { total: 10, ready: 10, blocked: 0, missing: 0 } },
    releaseEvidence: {
      ready: true,
      summary: { total: 10, ready: 10, missing: 0 },
      evidence: {
        releaseGate: { ready: true, available: true },
        acceptance: { ready: true, available: true, matrixPassed: 18, matrixTotal: 18 },
        readiness: { ready: true, available: true },
        realWorkspaceTrial: { ready: true, available: true },
        codebaseContext: { ready: true, available: true },
        sandboxSecurity: { ready: true, available: true },
        arHealth: { ready: true, available: true },
        workbenchDeep: { ready: true, available: true },
        productGradeGate: { ready: true, available: true },
      },
    },
    files: new Set([
      "frontend/vite-project/src/workbench/viewRegistry.ts",
      "frontend/vite-project/src/workbench/viewRegistry.test.ts",
      "frontend/vite-project/src/workbench/commandRegistry.ts",
      "frontend/vite-project/src/workbench/commandRegistry.test.ts",
      "frontend/vite-project/src/workbench/contextKeys.ts",
      "frontend/vite-project/src/workbench/contextKeys.test.ts",
      "frontend/vite-project/src/settings/settingsRuntimeIntegration.test.ts",
      "frontend/vite-project/src/workspace/workspaceSettings.ts",
      "frontend/vite-project/src/extensions/workbenchContributions.ts",
      "frontend/vite-project/src/extensions/workbenchContributions.test.ts",
      "frontend/vite-project/src/extensions/iconThemes.ts",
      "frontend/vite-project/src/extensions/iconThemes.test.ts",
      "frontend/vite-project/src/workspace/manager.test.ts",
      "desktop/services/search/index.test.js",
      "frontend/vite-project/src/languages/languageRegistry.ts",
      "frontend/vite-project/src/languages/languageRegistry.test.ts",
      "frontend/vite-project/src/workbench/taskRunner.test.ts",
      "frontend/vite-project/src/workbench/problemMatcher.test.ts",
      "frontend/vite-project/src/workbench/taskLanguageSmoke.test.ts",
      "frontend/vite-project/src/debug/launchConfig.test.ts",
      "frontend/vite-project/src/debug/debugManager.test.ts",
      "frontend/vite-project/src/terminal/shellIntegration.test.ts",
      "desktop/services/pty/ptyManager.test.js",
      "frontend/vite-project/src/scm/scmRegistry.test.ts",
      "frontend/vite-project/src/components/GitPanel.vue",
      "desktop/services/agentLoop/scmAudit.test.js",
      "desktop/services/migration/vscodeImport.test.js",
      "desktop/services/workspaceTrust/index.test.js",
      "desktop/services/agentPolicy/index.test.js",
      "frontend/vite-project/src/ai/contextEvidence.test.ts",
      "desktop/services/agentLoop/contextEvidence.test.js",
      "desktop/services/agentLoop/sandboxSecurityEvidence.test.js",
      "scripts/ax-enterprise-gap-gate.js",
    ]),
  }
}

test("AX enterprise gap gate passes when AX1-AX16 evidence is ready", () => {
  const report = buildAxEnterpriseGapGate({
    createdAt: 100,
    ...readyFixture(),
    fileContents: {
      "frontend/vite-project/src/components/GitPanel.vue": "getScmProviderSnapshot getScmResourceGroup activeScmResources",
    },
  })

  assert.equal(report.reportKind, "ax-enterprise-gap-gate")
  assert.equal(report.ready, true)
  assert.equal(report.status, "ready")
  assert.equal(report.summary.total, 16)
  assert.equal(report.summary.ready, 16)
  assert.equal(report.gaps.length, 0)
  assert.equal(report.ax.find((item) => item.id === "AX15").ready, true)
  assert.match(report.markdown, /AX Enterprise Gap Gate/)
})

test("AX enterprise gap gate blocks missing sandbox security and workbench evidence", () => {
  const fixture = readyFixture()
  fixture.releaseEvidence.evidence.sandboxSecurity.ready = false
  fixture.files.delete("frontend/vite-project/src/workbench/viewRegistry.test.ts")

  const report = buildAxEnterpriseGapGate({
    createdAt: 200,
    ...fixture,
    fileContents: {
      "frontend/vite-project/src/components/GitPanel.vue": "getScmProviderSnapshot getScmResourceGroup activeScmResources",
    },
  })

  assert.equal(report.ready, false)
  assert.equal(report.status, "blocked")
  assert.equal(report.gaps.some((gap) => gap.ax === "AX1"), true)
  assert.equal(report.gaps.some((gap) => gap.ax === "AX15"), true)
  assert.equal(report.nextActions[0].severity, "high")
})

test("AX enterprise gap gate treats release evidence as base ready when only AX recursion remains", () => {
  const fixture = readyFixture()
  fixture.releaseEvidence.ready = false
  fixture.releaseEvidence.gaps = [{
    id: "ax_enterprise_gate",
    severity: "high",
    status: "not_ready",
    reason: "AX gate latest missing",
  }]

  const report = buildAxEnterpriseGapGate({
    createdAt: 250,
    ...fixture,
    fileContents: {
      "frontend/vite-project/src/components/GitPanel.vue": "getScmProviderSnapshot getScmResourceGroup activeScmResources",
    },
  })

  assert.equal(report.ready, true)
  assert.equal(report.ax.find((item) => item.id === "AX16").ready, true)
})

test("AX enterprise gap gate saves latest and history artifacts", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ax-gate-"))
  const report = buildAxEnterpriseGapGate({
    createdAt: 300,
    ...readyFixture(),
    fileContents: {
      "frontend/vite-project/src/components/GitPanel.vue": "getScmProviderSnapshot getScmResourceGroup activeScmResources",
    },
  })
  const saved = saveAxEnterpriseGapGate(report, { reportDir })

  assert.equal(fs.existsSync(saved.jsonPath), true)
  assert.equal(fs.existsSync(saved.markdownPath), true)
  assert.equal(fs.existsSync(saved.historyJsonPath), true)

  const latest = readLatestAxEnterpriseGapGate({ reportDir })
  assert.equal(latest.report.reportKind, "ax-enterprise-gap-gate")
  assert.match(latest.markdown, /AX Enterprise Gap Gate/)
})

test("AX enterprise gap gate blocks GitPanel when SCM provider tree is not consumed", () => {
  const report = buildAxEnterpriseGapGate({
    createdAt: 400,
    ...readyFixture(),
    fileContents: {
      "frontend/vite-project/src/components/GitPanel.vue": "gitState.status.value.changes",
    },
  })

  assert.equal(report.ready, false)
  assert.equal(report.gaps.some((gap) => gap.id === "AX11_git_panel_provider_tree"), true)
})
