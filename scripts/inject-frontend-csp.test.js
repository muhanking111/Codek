const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const test = require("node:test")

const root = path.resolve(__dirname, "..")
const scriptPath = path.join(root, "scripts", "inject-frontend-csp.js")
const consistencyScriptPath = path.join(root, "scripts", "frontend-dist-consistency.js")

function copyRepoScriptToFixture(fixtureRoot) {
  const scriptsDir = path.join(fixtureRoot, "scripts")
  fs.mkdirSync(scriptsDir, { recursive: true })
  fs.copyFileSync(scriptPath, path.join(scriptsDir, "inject-frontend-csp.js"))
  fs.copyFileSync(consistencyScriptPath, path.join(scriptsDir, "frontend-dist-consistency.js"))
}

function writeDistIndex(fixtureRoot, html) {
  const distDir = path.join(fixtureRoot, "frontend", "vite-project", "dist")
  fs.mkdirSync(distDir, { recursive: true })
  fs.writeFileSync(path.join(distDir, "index.html"), html, "utf8")
}

function runFixtureScript(fixtureRoot) {
  return spawnSync(process.execPath, [path.join(fixtureRoot, "scripts", "inject-frontend-csp.js")], {
    cwd: fixtureRoot,
    encoding: "utf8",
    windowsHide: true,
  })
}

test("inject frontend CSP replaces stale extension-resource policy in source and desktop dist", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-csp-fixture-"))
  copyRepoScriptToFixture(fixtureRoot)
  writeDistIndex(fixtureRoot, [
    "<!doctype html>",
    "<html>",
    "  <head>",
    "    <meta charset=\"UTF-8\" />",
    "    <meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; font-src 'self' data:; img-src 'self' data: blob: file:\">",
    "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
    "  </head>",
    "  <body><div id=\"app\"></div></body>",
    "</html>",
  ].join("\n"))

  const result = runFixtureScript(fixtureRoot)

  assert.equal(result.status, 0, result.stderr)
  for (const target of [
    path.join(fixtureRoot, "frontend", "vite-project", "dist", "index.html"),
    path.join(fixtureRoot, "desktop", "frontend-dist", "index.html"),
  ]) {
    const html = fs.readFileSync(target, "utf8")
    assert.match(html, /font-src 'self' data: codek-extension-resource:/)
    assert.match(html, /img-src 'self' data: blob: file: codek-extension-resource:/)
    assert.equal((html.match(/http-equiv="Content-Security-Policy"/g) || []).length, 1)
  }
})
