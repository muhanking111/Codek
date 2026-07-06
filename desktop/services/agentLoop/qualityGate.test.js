const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { runQualityGate } = require("./qualityGate")

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `codek-${name}-`))
}

test("runQualityGate passes when all commands exit successfully", () => {
  const root = tempDir("quality-pass")
  const result = runQualityGate({
    projectRoot: root,
    commands: ["node -e \"process.stdout.write('ok')\""],
  })

  assert.equal(result.status, "passed")
  assert.equal(result.commandResults.length, 1)
  assert.equal(result.commandResults[0].exitCode, 0)
  assert.match(result.summary, /1\/1/)
})

test("runQualityGate fails and stops at the first failing command", () => {
  const root = tempDir("quality-fail")
  const result = runQualityGate({
    projectRoot: root,
    commands: [
      "node -e \"process.stderr.write('bad'); process.exit(2)\"",
      "node -e \"process.stdout.write('should not run')\"",
    ],
  })

  assert.equal(result.status, "failed")
  assert.equal(result.commandResults.length, 1)
  assert.equal(result.commandResults[0].exitCode, 2)
  assert.match(result.commandResults[0].stderr, /bad/)
})

test("runQualityGate skips when no commands are configured", () => {
  const result = runQualityGate({
    projectRoot: tempDir("quality-skip"),
    commands: [],
  })

  assert.equal(result.status, "skipped")
  assert.equal(result.commandResults.length, 0)
})
