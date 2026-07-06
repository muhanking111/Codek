const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildAtReleaseCandidatePreflight,
  parseArgs,
  readLatestAtReleaseCandidatePreflight,
  saveAtReleaseCandidatePreflight,
  toMarkdown,
} = require("./at-release-candidate-preflight")

function packageFixture() {
  return {
    packageJson: {
      scripts: {
        "pack:win": "node scripts/build.js --pack win",
        "pack:mac": "node scripts/build.js --pack mac",
        "pack:linux": "node scripts/build.js --pack linux",
      },
    },
    desktopPackageJson: {
      scripts: {
        "pack:win": "electron-builder --win",
        "pack:mac": "electron-builder --mac",
        "pack:linux": "electron-builder --linux",
      },
      build: {
        appId: "com.codek.app",
        productName: "Codek",
        directories: { output: "release" },
        files: ["main.js", "preload.js"],
        win: { target: [{ target: "nsis", arch: ["x64"] }], icon: "assets/icon.ico" },
        mac: { target: [{ target: "dmg", arch: ["x64"] }], entitlements: "assets/entitlements.mac.plist" },
        linux: { target: [{ target: "AppImage", arch: ["x64"] }] },
        publish: { provider: "github", owner: "codek", repo: "codek-releases" },
      },
    },
    artifacts: [{
      name: "Codek-Setup-1.0.0-x64.exe",
      path: "D:/Workspace/desktop/release/Codek-Setup-1.0.0-x64.exe",
      sizeBytes: 1024,
      sizeMb: 0.01,
      sha256: "abc",
    }],
  }
}

function buildNodeModulesFixture() {
  const nodeModulesDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-at-node-modules-"))
  const builderPkgDir = path.join(nodeModulesDir, "electron-builder")
  const rebuildPkgDir = path.join(nodeModulesDir, "@electron", "rebuild")
  const binDir = path.join(nodeModulesDir, ".bin")
  fs.mkdirSync(builderPkgDir, { recursive: true })
  fs.mkdirSync(rebuildPkgDir, { recursive: true })
  fs.mkdirSync(binDir, { recursive: true })
  fs.writeFileSync(path.join(builderPkgDir, "package.json"), JSON.stringify({ name: "electron-builder", version: "26.0.12" }), "utf8")
  fs.writeFileSync(path.join(rebuildPkgDir, "package.json"), JSON.stringify({ name: "@electron/rebuild", version: "4.0.4" }), "utf8")
  fs.writeFileSync(path.join(binDir, "electron-builder.cmd"), "@echo off", "utf8")
  fs.writeFileSync(path.join(binDir, "electron-rebuild.cmd"), "@echo off", "utf8")
  return nodeModulesDir
}

test("parseArgs supports report and artifact directories", () => {
  const parsed = parseArgs(["--no-write", "--strict", "--report-dir=C:/reports", "--artifact-dir=C:/release"])

  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.strict, true)
  assert.equal(parsed.reportDir, "C:/reports")
  assert.equal(parsed.artifactDir, "C:/release")
})

test("AT release candidate preflight reports package configuration and artifacts", () => {
  const report = buildAtReleaseCandidatePreflight({
    createdAt: 123,
    nodeModulesDir: buildNodeModulesFixture(),
    ...packageFixture(),
  })

  assert.equal(report.reportKind, "at-release-candidate-preflight")
  assert.equal(report.summary.failed, 0)
  assert.equal(report.checks.some((item) => item.id === "desktop_builder_config" && item.status === "passed"), true)
  assert.equal(report.checks.some((item) => item.id === "installer_artifacts" && item.status === "passed"), true)
  assert.equal(report.checks.some((item) => item.id === "publish_not_real" && item.status === "warning"), true)
  assert.equal(report.checks.some((item) => item.id === "electron_rebuild_cli" && item.status === "passed"), true)
  assert.equal(report.scope.realPackagingExecuted, false)
  assert.match(toMarkdown(report), /AT/)
})

test("AT release candidate preflight fails missing mandatory pack scripts", () => {
  const fixture = packageFixture()
  fixture.packageJson.scripts = {}
  const report = buildAtReleaseCandidatePreflight({
    createdAt: 456,
    ...fixture,
  })

  assert.equal(report.ready, false)
  assert.equal(report.checks.find((item) => item.id === "root_pack_scripts").status, "failed")
  assert.equal(report.nextActions[0].id, "root_pack_scripts")
})

test("AT release candidate preflight saves latest and history reports", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-at-preflight-"))
  const report = buildAtReleaseCandidatePreflight({
    createdAt: 789,
    ...packageFixture(),
  })
  const saved = saveAtReleaseCandidatePreflight(report, { reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(fs.existsSync(saved.historyJsonPath), true)

  const latest = readLatestAtReleaseCandidatePreflight({ reportDir })
  assert.equal(latest.report.reportKind, "at-release-candidate-preflight")
  assert.match(latest.markdown, /安装/)
})
