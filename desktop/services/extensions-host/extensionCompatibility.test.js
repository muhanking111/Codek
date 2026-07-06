const assert = require("node:assert/strict")
const test = require("node:test")

const {
  evaluateExtensionCompatibility,
  buildExtensionsCompatibilityReport,
} = require("./extensionCompatibility")

test("evaluateExtensionCompatibility marks built-in supported extensions as native", () => {
  const result = evaluateExtensionCompatibility({
    id: "codek.json",
    isBuiltin: true,
    contributes: { languages: [{ id: "json" }], commands: [{ command: "json.run" }] },
  })

  assert.equal(result.status, "native")
  assert.equal(result.blockers.length, 0)
})

test("evaluateExtensionCompatibility reports degraded unsupported contribution points", () => {
  const result = evaluateExtensionCompatibility({
    id: "theme.popular",
    contributes: {
      themes: [{ label: "Theme" }],
      webviews: [{ viewType: "theme.preview" }],
    },
  })

  assert.equal(result.status, "degraded")
  assert.deepEqual(result.unsupportedContributionPoints.sort(), ["themes", "webviews"])
})

test("evaluateExtensionCompatibility blocks runtime errors for the extension", () => {
  const result = evaluateExtensionCompatibility({
    id: "ms-python.python",
    contributes: { commands: [{ command: "python.run" }] },
  }, {
    activationReport: {
      runtimeErrors: [{ extensionId: "ms-python.python", message: "Cannot find module" }],
    },
  })

  assert.equal(result.status, "blocked")
  assert.equal(result.blockers[0].id, "runtime_error")
})

test("buildExtensionsCompatibilityReport summarizes native, compatible, degraded, and blocked statuses", () => {
  const report = buildExtensionsCompatibilityReport({
    extensions: [
      { id: "codek.json", isBuiltin: true, contributes: { languages: [{ id: "json" }] } },
      { id: "ms-python.python", contributes: { commands: [{ command: "python.run" }] } },
      { id: "theme.popular", contributes: { themes: [{ label: "Theme" }] } },
      { id: "broken.extension", contributes: { commands: [{ command: "broken.run" }] } },
    ],
    activationReport: {
      runtimeErrors: [{ extensionId: "broken.extension", message: "boom" }],
    },
  })

  assert.equal(report.ready, false)
  assert.deepEqual(report.summary, {
    total: 4,
    native: 1,
    compatible: 1,
    degraded: 1,
    blocked: 1,
  })
})
