#!/usr/bin/env node

const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")
const { assertFrontendDistConsistency } = require("./frontend-dist-consistency")
const { buildVscodeSourceBoundaryReport, printReport } = require("./vscode-source-boundary-check")

const root = path.resolve(__dirname, "..")

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  if (result.status !== 0) {
    if (options.allowFailure) {
      return result.status || 1
    }
    process.exit(result.status || 1)
  }
  return 0
}

function hasFile(...segments) {
  return fs.existsSync(path.join(root, ...segments))
}

function prepareWindowsPackTools() {
  const localAppData = path.join(root, "desktop", ".codek-cache", "localappdata")
  const appData = path.join(root, "desktop", ".codek-cache", "appdata")
  fs.mkdirSync(localAppData, { recursive: true })
  fs.mkdirSync(appData, { recursive: true })
  process.env.LOCALAPPDATA = localAppData
  process.env.APPDATA = appData
  console.log(`Using local AppData roots at ${localAppData} and ${appData}`)

  const vendorDir = path.join(root, "desktop", "node_modules", "electron-winstaller", "vendor")
  const source = path.join(vendorDir, "rcedit.exe")
  if (!fs.existsSync(source)) return

  const ebCacheDir = path.join(root, "desktop", ".codek-cache", "electron-builder")
  fs.mkdirSync(ebCacheDir, { recursive: true })
  process.env.ELECTRON_BUILDER_CACHE = ebCacheDir
  console.log(`Using local electron-builder cache at ${ebCacheDir}`)

  const shimDir = path.join(root, "desktop", ".codek-cache", "rcedit")
  fs.mkdirSync(shimDir, { recursive: true })

  for (const name of ["rcedit-x86.exe", "rcedit-x64.exe"]) {
    const target = path.join(shimDir, name)
    if (!fs.existsSync(target)) {
      fs.copyFileSync(source, target)
    }
  }

  process.env.ELECTRON_BUILDER_RCEDIT_PATH = shimDir
  console.log(`Using local RCEdit shim from ${shimDir}`)

  const signtoolCandidates = [
    "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\signtool.exe",
    "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x86\\signtool.exe",
    "C:\\Program Files (x86)\\Windows Kits\\10\\App Certification Kit\\signtool.exe",
  ]
  const signtoolPath = signtoolCandidates.find(candidate => fs.existsSync(candidate))
  if (signtoolPath) {
    process.env.SIGNTOOL_PATH = signtoolPath
    console.log(`Using system SignTool from ${signtoolPath}`)
  } else {
    console.warn("System SignTool not found; electron-builder may still try to download winCodeSign")
  }
}

function injectFrontendCsp() {
  const indexPath = path.join(root, "frontend", "vite-project", "dist", "index.html")
  if (!fs.existsSync(indexPath)) return
  const html = fs.readFileSync(indexPath, "utf8")
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data: codek-extension-resource:",
    "img-src 'self' data: blob: file: codek-extension-resource:",
    "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ")
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`
  const cspMetaPattern = /<meta\b(?=[^>]*\bhttp-equiv=["']Content-Security-Policy["'])[^>]*>/gi
  const htmlWithoutStaleCsp = html.replace(cspMetaPattern, "")
  const nextHtml = htmlWithoutStaleCsp.replace("<meta name=\"viewport\"", `${meta}\n    <meta name=\"viewport\"`)
  if (nextHtml !== html) {
    fs.writeFileSync(indexPath, nextHtml, "utf8")
  }
}

function syncFrontendDistForDesktopPackage() {
  const source = path.join(root, "frontend", "vite-project", "dist")
  const target = path.join(root, "desktop", "frontend-dist")
  const tempTarget = path.join(root, "desktop", `.frontend-dist-tmp-${process.pid}-${Date.now()}`)
  if (!fs.existsSync(path.join(source, "index.html"))) {
    throw new Error("frontend dist is missing index.html; run the frontend build before packaging")
  }
  fs.rmSync(tempTarget, { recursive: true, force: true })
  fs.cpSync(source, tempTarget, { recursive: true })
  assertFrontendDistConsistency({ root, sourceDistDir: source, desktopDistDir: tempTarget, compareSource: false })
  fs.rmSync(target, { recursive: true, force: true })
  fs.renameSync(tempTarget, target)
  assertFrontendDistConsistency({ root, sourceDistDir: source, desktopDistDir: target })
  console.log(`Synced frontend dist into ${target}`)
}

const packIndex = process.argv.indexOf("--pack")
const packTarget = packIndex >= 0 ? process.argv[packIndex + 1] : null

console.log("=== Codek Build Pipeline ===")

console.log("\n--- Step 0: VS Code Source Boundary Check ---")
const sourceBoundaryReport = buildVscodeSourceBoundaryReport({ root })
printReport(sourceBoundaryReport)
if (!sourceBoundaryReport.ready) {
  process.exit(1)
}

console.log("\n--- Step 1: Build Frontend ---")
run("npx", ["vite", "build"], path.join(root, "frontend", "vite-project"))
injectFrontendCsp()
syncFrontendDistForDesktopPackage()

if (hasFile("backend", "demo", "pom.xml")) {
  console.log("\n--- Step 2: Build Backend ---")
  run("mvn", ["package", "-DskipTests", "-q"], path.join(root, "backend", "demo"))
} else {
  console.log("\n--- Step 2: Build Backend ---")
  console.log("backend/demo/pom.xml not found, skipping backend build")
}

console.log("\n--- Step 3: Rebuild Native Modules for Electron ---")
const rebuildStatus = run("npx", ["electron-rebuild"], path.join(root, "desktop"), { allowFailure: true })
if (rebuildStatus !== 0) {
  console.warn(`electron-rebuild failed with exit code ${rebuildStatus}; continuing because packaging can still use existing native modules.`)
}

if (packTarget) {
  const script = `pack:${packTarget}`
  console.log(`\n--- Step 4: Package Desktop (${packTarget}) ---`)
  if (packTarget === "win") {
    prepareWindowsPackTools()
  }
  run("npm", ["run", script], path.join(root, "desktop"))
} else {
  console.log("\nBuild complete. To package: npm run pack:win | pack:mac | pack:linux")
}
