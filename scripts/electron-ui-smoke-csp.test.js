const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const test = require("node:test")

const root = path.resolve(__dirname, "..")
const scriptPath = path.join(root, "scripts", "electron-ui-smoke.js")
const consistencyScriptPath = path.join(root, "scripts", "frontend-dist-consistency.js")

function writeIndex(filePath, csp) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, [
    "<!doctype html>",
    "<html>",
    "  <head>",
    `    <meta http-equiv="Content-Security-Policy" content="${csp}">`,
    "  </head>",
    "  <body><div id=\"app\"></div></body>",
    "</html>",
  ].join("\n"), "utf8")
}

test("electron UI smoke refuses stale frontend CSP before launching Electron", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-electron-smoke-csp-"))
  const fixtureScript = path.join(fixtureRoot, "scripts", "electron-ui-smoke.js")
  fs.mkdirSync(path.dirname(fixtureScript), { recursive: true })
  fs.copyFileSync(scriptPath, fixtureScript)
  fs.copyFileSync(consistencyScriptPath, path.join(fixtureRoot, "scripts", "frontend-dist-consistency.js"))

  const staleCsp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: file:",
  ].join("; ")
  writeIndex(path.join(fixtureRoot, "frontend", "vite-project", "dist", "index.html"), staleCsp)
  writeIndex(path.join(fixtureRoot, "desktop", "frontend-dist", "index.html"), staleCsp)

  const result = spawnSync(process.execPath, [fixtureScript, "--icon-visual-state"], {
    cwd: fixtureRoot,
    encoding: "utf8",
    windowsHide: true,
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CSP 未允许 VS Code 图标主题资源/)
  assert.doesNotMatch(result.stderr, /electron 不存在|Electron UI smoke 启动失败/)
})
