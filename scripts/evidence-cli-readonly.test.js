const assert = require("node:assert/strict")
const childProcess = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const repoRoot = path.resolve(__dirname, "..")

const READONLY_CLIS = [
  {
    scriptName: "manual-real-ui-evidence.js",
    args: (_rootDir, reportDir) => [`--report-dir=${reportDir}`],
    noWriteArgs: (_rootDir, reportDir) => [`--report-dir=${reportDir}`, "--init", "--no-write"],
  },
  {
    scriptName: "release-evidence-export.js",
    args: (_rootDir, reportDir) => [`--report-dir=${reportDir}`],
    noWriteArgs: (_rootDir, reportDir) => [`--report-dir=${reportDir}`, "--current-release-gate-mode=bd-enterprise-candidate", "--no-write"],
  },
  {
    scriptName: "m1-release-candidate-gate.js",
    args: (rootDir, reportDir) => [`--root=${rootDir}`, `--report-dir=${reportDir}`],
    noWriteArgs: (rootDir, reportDir) => [`--root=${rootDir}`, `--report-dir=${reportDir}`, "--no-write"],
  },
  {
    scriptName: "enterprise-doc-completion-audit.js",
    args: (rootDir, reportDir) => [`--root=${rootDir}`, `--report-dir=${reportDir}`],
    noWriteArgs: (rootDir, reportDir) => [`--root=${rootDir}`, `--report-dir=${reportDir}`, "--no-write"],
  },
  {
    scriptName: "extension-plan-completion-audit.js",
    args: (rootDir, reportDir) => [`--root=${rootDir}`, `--report-dir=${reportDir}`],
    noWriteArgs: (rootDir, reportDir) => [`--root=${rootDir}`, `--report-dir=${reportDir}`, "--no-write"],
  },
]

function makeRoot(prefix) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return {
    rootDir,
    reportDir: path.join(rootDir, ".codek", "reports"),
  }
}

function runCli(scriptName, args) {
  return childProcess.spawnSync(process.execPath, [path.join(repoRoot, "scripts", scriptName), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  })
}

test("evidence CLIs print help without creating report directories", () => {
  for (const cli of READONLY_CLIS) {
    const { rootDir, reportDir } = makeRoot("codek-evidence-cli-help-")
    const result = runCli(cli.scriptName, [...cli.args(rootDir, reportDir), "--help"])

    assert.equal(result.status, 0, `${cli.scriptName} help should exit 0: ${result.stderr}`)
    assert.match(result.stdout, /^Usage: /m, `${cli.scriptName} should print help`)
    assert.equal(fs.existsSync(reportDir), false, `${cli.scriptName} --help must not create reports`)
  }
})

test("evidence CLIs reject invalid args before creating report directories", () => {
  for (const cli of READONLY_CLIS) {
    const { rootDir, reportDir } = makeRoot("codek-evidence-cli-invalid-")
    const result = runCli(cli.scriptName, [...cli.args(rootDir, reportDir), "--unknown-evidence-flag"])

    assert.equal(result.status, 1, `${cli.scriptName} invalid arg should exit 1`)
    assert.match(result.stderr, /Invalid option\(s\): --unknown-evidence-flag/, `${cli.scriptName} should explain invalid args`)
    assert.equal(fs.existsSync(reportDir), false, `${cli.scriptName} invalid args must not create reports`)
  }
})

test("evidence CLIs no-write paths do not create report directories", () => {
  for (const cli of READONLY_CLIS) {
    const { rootDir, reportDir } = makeRoot("codek-evidence-cli-no-write-")
    const result = runCli(cli.scriptName, cli.noWriteArgs(rootDir, reportDir))

    assert.notEqual(result.status, null, `${cli.scriptName} should finish`)
    assert.equal(fs.existsSync(reportDir), false, `${cli.scriptName} --no-write must not create reports`)
  }
})
