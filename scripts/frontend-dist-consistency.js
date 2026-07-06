#!/usr/bin/env node

const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")

const ASSET_REFERENCE_EXTENSIONS = new Set([
  ".css",
  ".gif",
  ".html",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".map",
  ".png",
  ".svg",
  ".ttf",
  ".wasm",
  ".webp",
  ".woff",
  ".woff2",
])

function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return []

  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join("/")
}

function stripUrlSuffix(value) {
  return value.split(/[?#]/, 1)[0]
}

function hasTrackedAssetExtension(reference) {
  return ASSET_REFERENCE_EXTENSIONS.has(path.extname(stripUrlSuffix(reference)).toLowerCase())
}

function shouldCheckReference(reference) {
  return /^\.{1,2}\//.test(reference) && hasTrackedAssetExtension(reference)
}

function extractHtmlReferences(content) {
  const references = []
  const attributePattern = /\b(?:src|href)=["']([^"']+)["']/gi
  let match
  while ((match = attributePattern.exec(content))) {
    references.push(match[1])
  }
  return references
}

function extractCssReferences(content) {
  const references = []
  const urlPattern = /url\(\s*["']?([^"')]+)["']?\s*\)/gi
  let match
  while ((match = urlPattern.exec(content))) {
    references.push(match[1])
  }
  return references
}

function extractJsReferences(content) {
  const references = []
  const viteMapDepsPattern = /__vite__mapDeps[^[]*\[\s*([\s\S]*?)\s*\]/g
  let match
  while ((match = viteMapDepsPattern.exec(content))) {
    const dependencyList = match[1]
    const dependencyPattern = /(["'`])(\.{1,2}\/[^"'`]+?\.(?:css|gif|html|ico|jpe?g|js|json|map|png|svg|ttf|wasm|webp|woff2?)(?:[?#][^"'`]*)?)\1/g
    let dependencyMatch
    while ((dependencyMatch = dependencyPattern.exec(dependencyList))) {
      references.push(dependencyMatch[2])
    }
  }

  const dynamicImportPattern = /import\(\s*(["'`])(\.{1,2}\/[^"'`]+?\.(?:css|gif|html|ico|jpe?g|js|json|map|png|svg|ttf|wasm|webp|woff2?)(?:[?#][^"'`]*)?)\1\s*\)/g
  while ((match = dynamicImportPattern.exec(content))) {
    references.push(match[2])
  }
  return references
}

function extractReferences(filePath, content) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === ".html") return extractHtmlReferences(content)
  if (ext === ".css") return extractCssReferences(content)
  if (ext === ".js") return extractJsReferences(content)
  return []
}

function assertDistReferencesExist(distDir) {
  const missing = []
  const scannedFiles = listFilesRecursive(distDir).filter((file) => /\.(?:html|js|css)$/i.test(file))

  for (const file of scannedFiles) {
    const content = fs.readFileSync(file, "utf8")
    for (const reference of extractReferences(file, content)) {
      if (!shouldCheckReference(reference)) continue
      const resolved = path.resolve(path.dirname(file), stripUrlSuffix(reference))
      if (!fs.existsSync(resolved)) {
        missing.push({
          file: normalizeRelativePath(path.relative(distDir, file)),
          reference,
          resolved: normalizeRelativePath(path.relative(distDir, resolved)),
        })
      }
    }
  }

  if (missing.length) {
    const details = missing
      .slice(0, 20)
      .map((entry) => `${entry.file} -> ${entry.reference} (${entry.resolved})`)
      .join("\n")
    throw new Error(`frontend dist references missing asset files:\n${details}`)
  }

  return { scannedFiles: scannedFiles.length, missingReferences: 0 }
}

function fileHash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
}

function snapshotDistFiles(distDir) {
  const snapshot = new Map()
  for (const file of listFilesRecursive(distDir)) {
    const relative = normalizeRelativePath(path.relative(distDir, file))
    const stat = fs.statSync(file)
    snapshot.set(relative, {
      size: stat.size,
      hash: fileHash(file),
    })
  }
  return snapshot
}

function assertDistTreesMatch(sourceDistDir, desktopDistDir) {
  const source = snapshotDistFiles(sourceDistDir)
  const desktop = snapshotDistFiles(desktopDistDir)
  const mismatches = []
  const allFiles = new Set([...source.keys(), ...desktop.keys()])

  for (const relative of [...allFiles].sort()) {
    const sourceEntry = source.get(relative)
    const desktopEntry = desktop.get(relative)
    if (!sourceEntry) {
      mismatches.push(`${relative}: only in desktop/frontend-dist`)
    } else if (!desktopEntry) {
      mismatches.push(`${relative}: missing from desktop/frontend-dist`)
    } else if (sourceEntry.size !== desktopEntry.size || sourceEntry.hash !== desktopEntry.hash) {
      mismatches.push(`${relative}: content differs`)
    }
  }

  if (mismatches.length) {
    throw new Error(`desktop/frontend-dist is not synchronized with frontend/vite-project/dist:\n${mismatches.slice(0, 20).join("\n")}`)
  }

  return { comparedFiles: source.size }
}

function assertFrontendDistConsistency(options = {}) {
  const root = options.root || path.resolve(__dirname, "..")
  const sourceDistDir = options.sourceDistDir || path.join(root, "frontend", "vite-project", "dist")
  const desktopDistDir = options.desktopDistDir || path.join(root, "desktop", "frontend-dist")
  const shouldCompareSource = options.compareSource !== false

  const desktopIndex = path.join(desktopDistDir, "index.html")
  if (!fs.existsSync(desktopIndex)) {
    throw new Error("desktop/frontend-dist/index.html is missing. Run npm run build:frontend to sync the Electron frontend.")
  }

  const referenceReport = assertDistReferencesExist(desktopDistDir)
  const compareReport = shouldCompareSource && fs.existsSync(path.join(sourceDistDir, "index.html"))
    ? assertDistTreesMatch(sourceDistDir, desktopDistDir)
    : { comparedFiles: 0 }

  return {
    ...referenceReport,
    ...compareReport,
  }
}

if (require.main === module) {
  try {
    const report = assertFrontendDistConsistency()
    console.log(`frontend dist consistency passed: scanned ${report.scannedFiles} files, compared ${report.comparedFiles} files.`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}

module.exports = {
  assertDistReferencesExist,
  assertDistTreesMatch,
  assertFrontendDistConsistency,
  extractJsReferences,
}
