#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")
const { assertFrontendDistConsistency } = require("./frontend-dist-consistency")

const root = path.resolve(__dirname, "..")
const sourceDist = path.join(root, "frontend", "vite-project", "dist")
const desktopDist = path.join(root, "desktop", "frontend-dist")
const desktopDistTemp = path.join(root, "desktop", `.frontend-dist-tmp-${process.pid}-${Date.now()}`)
const indexPath = path.join(sourceDist, "index.html")

function copyRecursive(source, target) {
  const stat = fs.statSync(source)
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true })
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(target, entry))
    }
    return
  }
  fs.copyFileSync(source, target)
}

if (!fs.existsSync(indexPath)) {
  process.exit(0)
}

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

fs.mkdirSync(path.dirname(desktopDistTemp), { recursive: true })
fs.rmSync(desktopDistTemp, { recursive: true, force: true })
fs.mkdirSync(desktopDistTemp, { recursive: true })
for (const entry of fs.readdirSync(sourceDist)) {
  copyRecursive(path.join(sourceDist, entry), path.join(desktopDistTemp, entry))
}
assertFrontendDistConsistency({ root, sourceDistDir: sourceDist, desktopDistDir: desktopDistTemp, compareSource: false })
fs.rmSync(desktopDist, { recursive: true, force: true })
fs.renameSync(desktopDistTemp, desktopDist)
assertFrontendDistConsistency({ root, sourceDistDir: sourceDist, desktopDistDir: desktopDist })
console.log(`Synced frontend dist into ${desktopDist}`)
