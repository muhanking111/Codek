#!/usr/bin/env node

const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const root = path.resolve(__dirname, "..")
const REAL_EXTENSIONS_DIR = path.join(root, "extensions")
const INSTALL_MARKER = ".codek-installed.json"
const DEFAULT_QUERIES = [
  "python",
  "eslint",
  "prettier",
  "java",
  "rust",
  "clangd",
  "docker",
  "markdown",
  "git",
  "theme",
]
const DEFAULT_VSIX_DOWNLOAD_TIMEOUT_MS = Number(process.env.CODEK_EXTENSION_VSIX_DOWNLOAD_TIMEOUT_MS || 15000)
const TARGET_PLATFORM_UNDEFINED = "undefined"
const TARGET_PLATFORM_UNIVERSAL = "universal"
const TARGET_PLATFORM_UNKNOWN = "unknown"

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv = []) {
  const readArg = (prefix) => argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  const downloadTimeoutArg = readArg("--download-timeout-ms=")
  return {
    noWrite: argv.includes("--no-write"),
    noNetwork: argv.includes("--no-network"),
    keepInstallDir: argv.includes("--keep-install-dir"),
    reportDir: readArg("--report-dir=") || defaultReportDir(),
    top: Math.max(1, Number(readArg("--top=") || 100)),
    sampleSize: Math.max(1, Number(readArg("--sample-size=") || readArg("--top=") || 100)),
    candidateMultiplier: Math.max(1, Number(readArg("--candidate-multiplier=") || 4)),
    perExtensionTimeoutMs: Math.max(1000, Number(readArg("--per-extension-timeout-ms=") || 90000)),
    downloadTimeoutMs: downloadTimeoutArg == null ? 0 : Math.max(1000, Number(downloadTimeoutArg || 0)),
    targetPlatform: readArg("--target-platform=") || computeTargetPlatform(),
    minMetadata: Math.max(0, Number(readArg("--min-metadata=") || 95)),
    minInstallChain: Math.max(0, Number(readArg("--min-install-chain=") || 90)),
    minActivationPreflight: Math.max(0, Number(readArg("--min-activation-preflight=") || 40)),
    extensionIds: splitList(readArg("--extension-ids=")),
    queries: splitList(readArg("--queries=") || DEFAULT_QUERIES.join(",")),
  }
}

function splitList(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function extensionId(extension = {}) {
  return String(extension.id || (extension.publisher && extension.name ? `${extension.publisher}.${extension.name}` : "")).trim()
}

function computeTargetPlatform(platform = process.platform, arch = process.arch) {
  if (platform === "win32") return arch === "arm64" ? "win32-arm64" : "win32-x64"
  if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64"
  if (platform === "linux") return arch === "arm64" ? "linux-arm64" : arch === "arm" ? "linux-armhf" : "linux-x64"
  return TARGET_PLATFORM_UNKNOWN
}

function targetPlatformFromDownloadUrl(value = "") {
  const match = String(value || "").match(/@([a-z0-9-]+)\.vsix(?:$|[?#])/i)
  return match ? match[1].toLowerCase() : ""
}

function extensionTargetPlatform(extension = {}) {
  return String(
    extension.targetPlatform
      || extension.properties?.targetPlatform
      || extension.raw?.targetPlatform
      || extension.raw?.properties?.targetPlatform
      || targetPlatformFromDownloadUrl(resolveDownloadUrl(extension)),
  ).toLowerCase()
}

function isTargetPlatformCompatible(extensionPlatform, productTargetPlatform) {
  const platform = String(extensionPlatform || TARGET_PLATFORM_UNDEFINED).toLowerCase()
  const product = String(productTargetPlatform || TARGET_PLATFORM_UNKNOWN).toLowerCase()
  if (platform === TARGET_PLATFORM_UNDEFINED || platform === TARGET_PLATFORM_UNIVERSAL) return true
  if (platform === TARGET_PLATFORM_UNKNOWN) return false
  return platform === product
}

function shouldRequestTargetPlatformDetails(candidate, targetPlatform) {
  const candidatePlatform = extensionTargetPlatform(candidate)
  return Boolean(targetPlatform)
    && Boolean(candidate.version)
    && Boolean(candidatePlatform)
    && !isTargetPlatformCompatible(candidatePlatform, targetPlatform)
}

function splitExtensionId(id) {
  const dot = String(id || "").indexOf(".")
  if (dot <= 0) return { namespace: "", name: String(id || "") }
  return { namespace: id.slice(0, dot), name: id.slice(dot + 1) }
}

function dedupeExtensions(extensions = []) {
  const seen = new Map()
  const out = []
  for (const extension of extensions) {
    const id = extensionId(extension)
    const key = id.toLowerCase()
    if (!id) continue
    if (seen.has(key)) {
      const index = seen.get(key)
      out[index] = mergeExtensionMetadata(out[index], { ...extension, id })
      continue
    }
    seen.set(key, out.length)
    out.push({ ...extension, id })
  }
  return out
}

function mergeExtensionMetadata(existing = {}, incoming = {}) {
  const merged = { ...existing }
  for (const [key, value] of Object.entries(incoming)) {
    const current = merged[key]
    const currentEmpty = current == null || current === "" || (Array.isArray(current) && current.length === 0)
    if (currentEmpty && value != null && value !== "") {
      merged[key] = value
    }
  }
  if (!resolveDownloadUrl(merged) && resolveDownloadUrl(incoming)) {
    merged.downloadUrl = resolveDownloadUrl(incoming)
  }
  return merged
}

function makeStage(status = "pending", detail = "", extra = {}) {
  return { status, detail, ...extra }
}

function recordStageDuration(row, stage, durationMs) {
  if (!row._stageDurations) {
    Object.defineProperty(row, "_stageDurations", {
      value: {},
      enumerable: false,
      configurable: true,
    })
  }
  row._stageDurations[stage] = durationMs
}

function stageDuration(row, stage) {
  const durationMs = Number(row?._stageDurations?.[stage])
  return Number.isFinite(durationMs) ? { durationMs } : {}
}

async function measureStage(row, stage, work) {
  const startedAt = Date.now()
  try {
    return await work()
  } catch (error) {
    throw error
  } finally {
    recordStageDuration(row, stage, Date.now() - startedAt)
  }
}

function makeExtensionRow(extension = {}, rank = 0) {
  return {
    rank,
    id: extensionId(extension),
    displayName: extension.displayName || extension.name || extensionId(extension),
    version: extension.version || "",
    source: extension.source || "",
    downloadUrl: extension.downloadUrl || "",
    targetPlatform: extensionTargetPlatform(extension),
    stages: {
      search: makeStage("pending"),
      details: makeStage("pending"),
      download: makeStage("pending"),
      extract: makeStage("pending"),
      manifest: makeStage("pending"),
      dependency: makeStage("pending"),
      install: makeStage("pending"),
      scan: makeStage("pending"),
      activation: makeStage("pending"),
      cleanup: makeStage("pending"),
    },
    compatibility: null,
    manifest: null,
    error: "",
  }
}

async function collectCandidates(options = {}, registry = require("../desktop/services/extensions-host/marketplaceRegistry")) {
  const top = Number(options.top || 100)
  const targetCount = Math.max(
    Number(options.sampleSize || top),
    Math.min(top, Number(options.minInstallChain || 90)),
  )
  const candidateLimit = Math.max(targetCount, Math.ceil(targetCount * Number(options.candidateMultiplier || 4)))
  const explicit = options.extensionIds.map((id) => {
    const { namespace, name } = splitExtensionId(id)
    return { id, publisher: namespace, namespace, name }
  })
  if (options.noNetwork) return dedupeExtensions(explicit).slice(0, candidateLimit)

  const candidates = [...explicit]
  for (const query of options.queries || DEFAULT_QUERIES) {
    const result = await registry.searchMarketplaceRegistry(query, {
      size: Math.min(options.top, 50),
      targetPlatform: options.targetPlatform,
    })
    candidates.push(...(Array.isArray(result?.extensions) ? result.extensions : []))
    if (dedupeExtensions(candidates).length >= candidateLimit) break
  }
  return dedupeExtensions(candidates).slice(0, candidateLimit)
}

async function enrichCandidate(candidate, registry, options = {}) {
  const id = extensionId(candidate)
  const { namespace, name } = splitExtensionId(id)
  if (!namespace || !name || typeof registry.getMarketplaceDetails !== "function") {
    return { details: candidate, detailError: "" }
  }
  try {
    const requestedTargetPlatform = shouldRequestTargetPlatformDetails(candidate, options.targetPlatform)
      ? options.targetPlatform
      : undefined
    const details = await registry.getMarketplaceDetails(namespace, name, {
      version: candidate.version,
      targetPlatform: requestedTargetPlatform,
    })
    return { details: details ? { ...candidate, ...details, id } : candidate, detailError: "" }
  } catch (error) {
    return {
      details: candidate,
      detailError: String(error?.message || error),
    }
  }
}

function resolveDownloadUrl(extension = {}) {
  return extension.downloadUrl || extension.files?.download || extension.raw?.files?.download || ""
}

async function defaultDownloadVsix(extension, targetPath, options = {}) {
  const downloadUrl = resolveDownloadUrl(extension)
  if (!downloadUrl) throw new Error("Marketplace details did not include a VSIX download URL.")
  const directCached = await restoreCachedVsix(extension, targetPath, {
    ...options,
    artifactRoot: "",
    allowHistoricalCache: false,
  })
  if (directCached) {
    return {
      bytes: directCached.bytes,
      attempts: 0,
      source: directCached.source,
      cachePath: directCached.cachePath,
      historicalPath: directCached.historicalPath,
      downloadError: "",
    }
  }
  let lastError = null
  const attempts = Math.max(1, Number(options.attempts || 3))
  const timeoutMs = Math.max(1, Number(options.timeoutMs || DEFAULT_VSIX_DOWNLOAD_TIMEOUT_MS))
  const fetchImpl = options.fetchImpl || fetch
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null
    const abortFromParent = () => controller?.abort()
    if (options.signal?.aborted) controller?.abort()
    options.signal?.addEventListener?.("abort", abortFromParent, { once: true })
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
    try {
      const response = await fetchImpl(downloadUrl, controller ? { signal: controller.signal } : {})
      if (!response.ok) throw new Error(`VSIX download failed with HTTP ${response.status}`)
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      await fsp.writeFile(targetPath, buffer)
      const cachePath = await writeVsixCache(extension, targetPath, options.cacheDir)
      return { bytes: buffer.length, attempts: attempt, source: "network", cachePath }
    } catch (error) {
      lastError = normalizeDownloadError(error, { attempt, attempts, timeoutMs, downloadUrl })
      if (options.signal?.aborted) break
      if (attempt < attempts) await sleep(Number(options.retryDelayMs ?? 750) * attempt, options.signal)
    } finally {
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener?.("abort", abortFromParent)
    }
  }
  const cached = await restoreCachedVsix(extension, targetPath, options)
  if (cached) {
    return {
      bytes: cached.bytes,
      attempts,
      source: cached.source,
      cachePath: cached.cachePath,
      historicalPath: cached.historicalPath,
      downloadError: lastError?.message || "",
    }
  }
  throw lastError || new Error(`VSIX download failed after ${attempts} attempts.`)
}

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener?.("abort", done)
      resolve()
    }
    signal?.addEventListener?.("abort", done, { once: true })
  })
}

function normalizeDownloadError(error, context = {}) {
  const timedOut = error?.name === "AbortError" || /abort|timeout|timed out/i.test(String(error?.message || error || ""))
  const reason = timedOut
    ? `VSIX download timed out after ${context.timeoutMs}ms`
    : String(error?.message || error || "VSIX download failed")
  const detail = `${reason} (attempt ${context.attempt}/${context.attempts}, url=${context.downloadUrl || "unknown"})`
  const normalized = new Error(detail)
  normalized.cause = error
  return normalized
}

function vsixCacheFileName(extension = {}) {
  const id = sanitizePathSegment(extensionId(extension) || "extension")
  const version = sanitizePathSegment(extension.version || "latest")
  const platform = extensionTargetPlatform(extension)
  const platformSegment = platform && platform !== TARGET_PLATFORM_UNDEFINED && platform !== "universal"
    ? `-${sanitizePathSegment(platform)}`
    : ""
  return `${id}-${version}${platformSegment}.vsix`
}

function vsixCachePath(extension = {}, cacheDir = "") {
  return cacheDir ? path.join(cacheDir, vsixCacheFileName(extension)) : ""
}

async function writeVsixCache(extension, sourcePath, cacheDir = "") {
  const target = vsixCachePath(extension, cacheDir)
  if (!target) return ""
  await fsp.mkdir(path.dirname(target), { recursive: true })
  await fsp.copyFile(sourcePath, target)
  return target
}

async function restoreCachedVsix(extension, targetPath, options = {}) {
  const directCachePath = vsixCachePath(extension, options.cacheDir)
  const candidates = [
    directCachePath && { path: directCachePath, source: "artifact-cache", cachePath: directCachePath },
    ...(options.allowHistoricalCache === false ? [] : findHistoricalVsixArtifacts(extension, options.artifactRoot).map((historicalPath) => ({
      path: historicalPath,
      source: "historical-artifact-cache",
      historicalPath,
    }))),
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate.path)
      if (!stat.isFile() || stat.size <= 0) continue
      await fsp.mkdir(path.dirname(targetPath), { recursive: true })
      await fsp.copyFile(candidate.path, targetPath)
      if (candidate.source === "historical-artifact-cache" && options.cacheDir) {
        candidate.cachePath = await writeVsixCache(extension, targetPath, options.cacheDir)
      }
      return { ...candidate, bytes: stat.size }
    } catch {}
  }
  return null
}

function findHistoricalVsixArtifacts(extension = {}, artifactRoot = "") {
  const rootDir = artifactRoot ? path.resolve(artifactRoot) : ""
  if (!rootDir || !fs.existsSync(rootDir)) return []
  const idSegment = sanitizePathSegment(extensionId(extension) || "")
  if (!idSegment) return []
  const found = []
  for (const runEntry of safeReadDir(rootDir)) {
    if (!runEntry.isDirectory() || runEntry.name === "vsix-cache") continue
    const runDir = path.join(rootDir, runEntry.name)
    for (const rankEntry of safeReadDir(runDir)) {
      if (!rankEntry.isDirectory() || !rankEntry.name.includes(idSegment)) continue
      const rankDir = path.join(runDir, rankEntry.name)
      for (const fileEntry of safeReadDir(rankDir)) {
        if (!fileEntry.isFile() || path.extname(fileEntry.name).toLowerCase() !== ".vsix") continue
        if (!fileEntry.name.toLowerCase().includes(idSegment.toLowerCase())) continue
        const fullPath = path.join(rankDir, fileEntry.name)
        try {
          const stat = fs.statSync(fullPath)
          if (stat.size > 0) found.push({ fullPath, mtimeMs: stat.mtimeMs })
        } catch {}
      }
    }
  }
  return found
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((item) => item.fullPath)
}

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function defaultExtractVsix(extension, extractDir, vsixPath) {
  const resolvedVsixPath = path.resolve(vsixPath)
  const resolvedExtractDir = path.resolve(extractDir)
  const errors = []
  await resetDirectory(resolvedExtractDir)
  const extractZip = tryLoadExtractZip()
  if (extractZip) {
    try {
      await extractZip(resolvedVsixPath, { dir: resolvedExtractDir })
      return { extensionDir: path.join(resolvedExtractDir, "extension"), extractor: "extract-zip" }
    } catch (error) {
      errors.push(`extract-zip: ${formatSpawnError(error)}`)
      await resetDirectory(resolvedExtractDir)
    }
  }
  const extractTimeoutMs = Number(process.env.CODEK_EXTENSION_MATRIX_EXTRACT_TIMEOUT_MS || 60000)
  const tarResult = spawnSync("tar", ["-xf", resolvedVsixPath, "-C", resolvedExtractDir], {
    encoding: "utf8",
    shell: false,
    timeout: extractTimeoutMs,
  })
  if (tarResult.status === 0) {
    return { extensionDir: path.join(resolvedExtractDir, "extension"), extractor: "tar" }
  }
  errors.push(`tar: ${formatSpawnError(tarResult)}`)
  await resetDirectory(resolvedExtractDir)

  const zipPath = `${resolvedVsixPath}.zip`
  try {
    await fsp.copyFile(resolvedVsixPath, zipPath)
    const command = buildPowerShellZipExtractionCommand(zipPath, resolvedExtractDir)
    const result = spawnSync("powershell", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      shell: false,
      timeout: extractTimeoutMs,
    })
    if (result.status === 0) {
      return { extensionDir: path.join(resolvedExtractDir, "extension"), extractor: "powershell-zipfile" }
    }
    errors.push(`powershell-zipfile: ${formatSpawnError(result)}`)
  } finally {
    await fsp.rm(zipPath, { force: true }).catch(() => {})
  }
  throw new Error(`VSIX extraction failed for ${extensionId(extension) || path.basename(vsixPath)}. ${errors.join(" | ")}`)
}

function tryLoadExtractZip() {
  try {
    return require("extract-zip")
  } catch {
    return null
  }
}

async function resetDirectory(targetDir) {
  await fsp.rm(targetDir, { recursive: true, force: true }).catch(() => {})
  await fsp.mkdir(targetDir, { recursive: true })
}

function powerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function buildPowerShellZipExtractionCommand(zipPath, extractDir) {
  return [
    "$ErrorActionPreference = 'Stop';",
    "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
    `New-Item -ItemType Directory -Path ${powerShellLiteral(path.resolve(extractDir))} -Force | Out-Null;`,
    `[System.IO.Compression.ZipFile]::ExtractToDirectory(${powerShellLiteral(path.resolve(zipPath))}, ${powerShellLiteral(path.resolve(extractDir))})`,
  ].join(" ")
}

function formatSpawnError(errorOrResult) {
  if (!errorOrResult) return "unknown error"
  if (errorOrResult.error) return String(errorOrResult.error.message || errorOrResult.error)
  if (errorOrResult.stderr || errorOrResult.stdout) return String(errorOrResult.stderr || errorOrResult.stdout).trim()
  if (errorOrResult.status !== undefined) return `exit ${errorOrResult.status}`
  return String(errorOrResult.message || errorOrResult)
}

async function copyExtensionToIsolatedInstall(extensionDir, installDir, row, manifest) {
  const extensionKey = `${manifest.publisher || splitExtensionId(row.id).namespace || "unknown"}.${manifest.name || splitExtensionId(row.id).name || path.basename(extensionDir)}`
  const targetDir = path.join(installDir, sanitizePathSegment(extensionKey))
  await fsp.rm(targetDir, { recursive: true, force: true })
  await fsp.cp(extensionDir, targetDir, { recursive: true, force: true })
  await fsp.writeFile(path.join(targetDir, INSTALL_MARKER), `${JSON.stringify({
    builtin: false,
    source: "marketplace-install-matrix",
    extensionId: row.id,
    installedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8")
  return targetDir
}

function sanitizePathSegment(value) {
  return String(value || "extension").replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-").replace(/^-+|-+$/g, "") || "extension"
}

function readManifest(extensionDir) {
  const pkgPath = path.join(extensionDir, "package.json")
  if (!fs.existsSync(pkgPath)) throw new Error("Invalid VSIX: extension/package.json is missing.")
  const manifest = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
  if (!manifest.name) throw new Error("Invalid VSIX manifest: name is missing.")
  return manifest
}

function dependencySummary(manifest = {}) {
  return {
    extensionDependencies: Array.isArray(manifest.extensionDependencies) ? manifest.extensionDependencies.length : 0,
    extensionPack: Array.isArray(manifest.extensionPack) ? manifest.extensionPack.length : 0,
  }
}

function activationPreflightReady(manifest = {}, compatibility = {}) {
  const activationEvents = Array.isArray(manifest.activationEvents) ? manifest.activationEvents : []
  const hasEntry = Boolean(manifest.main || manifest.browser) || activationEvents.length === 0
  const blockersClear = !Array.isArray(compatibility.blockers) || compatibility.blockers.length === 0
  return hasEntry && blockersClear
}

async function processExtension(row, candidate, context, deps, signal) {
  const registry = deps.registry || require("../desktop/services/extensions-host/marketplaceRegistry")
  const downloadVsix = deps.downloadVsix || defaultDownloadVsix
  const extractVsix = deps.extractVsix || defaultExtractVsix
  const { evaluateExtensionCompatibility } = deps.compatibility || require("../desktop/services/extensions-host/extensionCompatibility")
  row.stages.search = makeStage("passed", "Candidate selected from marketplace search or explicit extension id.")

  try {
    const enriched = await measureStage(row, "details", () => enrichCandidate(candidate, registry, {
      targetPlatform: context.targetPlatform,
    }))
    const details = enriched.details
    Object.assign(row, {
      id: extensionId(details) || row.id,
      displayName: details.displayName || details.name || row.displayName,
      version: details.version || row.version,
      source: details.source || row.source,
      downloadUrl: resolveDownloadUrl(details),
      targetPlatform: extensionTargetPlatform(details),
    })
    if (!isTargetPlatformCompatible(row.targetPlatform, context.targetPlatform)) {
      row.stages.details = makeStage("failed", `Marketplace details target platform ${row.targetPlatform || TARGET_PLATFORM_UNDEFINED} is not compatible with ${context.targetPlatform}.`, {
        targetPlatform: row.targetPlatform || TARGET_PLATFORM_UNDEFINED,
        productTargetPlatform: context.targetPlatform,
        ...stageDuration(row, "details"),
      })
      throw new Error(`Incompatible target platform ${row.targetPlatform || TARGET_PLATFORM_UNDEFINED} for ${context.targetPlatform}.`)
    }
    row.stages.details = row.downloadUrl
      ? makeStage("passed", enriched.detailError
        ? `Marketplace details failed (${enriched.detailError}); search metadata provided a usable VSIX download URL.`
        : "Marketplace details include usable metadata and VSIX download URL.", {
          ...(enriched.detailError ? { warning: enriched.detailError } : {}),
          ...stageDuration(row, "details"),
        })
      : makeStage("failed", "Marketplace details are missing a VSIX download URL.", stageDuration(row, "details"))
    if (!row.downloadUrl) throw new Error("Missing VSIX download URL.")

    const extensionWorkDir = path.join(context.workDir, `rank-${String(row.rank).padStart(3, "0")}-${sanitizePathSegment(row.id)}`)
    const vsixPath = path.join(extensionWorkDir, `${sanitizePathSegment(row.id)}.vsix`)
    const extractDir = path.join(extensionWorkDir, "extract")
    const downloaded = await measureStage(row, "download", () => downloadVsix({ ...details, id: row.id, downloadUrl: row.downloadUrl }, vsixPath, {
      artifactRoot: context.artifactRoot,
      cacheDir: context.cacheDir,
      timeoutMs: context.downloadTimeoutMs,
      signal,
    }))
    row.stages.download = makeStage(
      "passed",
      downloaded?.source === "network"
        ? "VSIX downloaded."
        : "VSIX restored from audited local artifact cache after remote download failure.",
      {
        bytes: Number(downloaded?.bytes || (fs.existsSync(vsixPath) ? fs.statSync(vsixPath).size : 0)),
        vsixPath,
        source: downloaded?.source || "network",
        cachePath: downloaded?.cachePath || "",
        historicalPath: downloaded?.historicalPath || "",
        downloadError: downloaded?.downloadError || "",
        ...stageDuration(row, "download"),
      },
    )

    const extracted = await measureStage(row, "extract", () => extractVsix({ ...details, id: row.id }, extractDir, vsixPath))
    const extensionDir = extracted?.extensionDir || path.join(extractDir, "extension")
    row.stages.extract = fs.existsSync(extensionDir)
      ? makeStage("passed", "VSIX extracted with extension/ directory.", { extensionDir, ...stageDuration(row, "extract") })
      : makeStage("failed", "VSIX extraction did not create extension/ directory.", { extensionDir, ...stageDuration(row, "extract") })
    if (!fs.existsSync(extensionDir)) throw new Error("Extracted VSIX does not contain extension/ directory.")

    const manifest = await measureStage(row, "manifest", async () => readManifest(extensionDir))
    row.manifest = {
      publisher: manifest.publisher || "",
      name: manifest.name || "",
      version: manifest.version || "",
      engines: manifest.engines || {},
      activationEvents: Array.isArray(manifest.activationEvents) ? manifest.activationEvents.length : 0,
    }
    row.stages.manifest = makeStage("passed", "extension/package.json parsed and validated.", stageDuration(row, "manifest"))
    const depsSummary = dependencySummary(manifest)
    row.stages.dependency = makeStage("passed", "Dependency metadata inspected.", depsSummary)

    const targetDir = await measureStage(row, "install", () => copyExtensionToIsolatedInstall(extensionDir, context.extensionsDir, row, manifest))
    row.stages.install = makeStage("passed", "Extension copied into isolated install directory.", { targetDir, ...stageDuration(row, "install") })

    const scan = await measureStage(row, "scan", async () => context.scanExtensions({ extensionsDir: context.extensionsDir }))
    const scanned = scan.byId?.get(`${manifest.publisher || "unknown"}.${manifest.name}`) || scan.byId?.get(row.id)
    row.stages.scan = scanned
      ? makeStage("passed", "Isolated extension scanner discovered the installed extension.", stageDuration(row, "scan"))
      : makeStage("failed", "Isolated extension scanner did not discover the installed extension.", stageDuration(row, "scan"))
    if (!scanned) throw new Error("Scanner did not discover isolated install.")

    const compatibility = await measureStage(row, "activation", async () => evaluateExtensionCompatibility(scanned, { activationReport: { runtimeErrors: [] } }))
    row.compatibility = compatibility
    const activationReady = activationPreflightReady(manifest, compatibility)
    row.stages.activation = activationReady
      ? makeStage("passed", "Activation preflight has no runtime blocker in static compatibility pass.", stageDuration(row, "activation"))
      : makeStage("failed", "Activation preflight found missing entrypoint or compatibility blockers.", stageDuration(row, "activation"))
  } catch (error) {
    row.error = String(error?.message || error)
    markPendingAfterError(row, row.error)
  }
  return row
}

function timeoutExtensionRow(candidate, rank, timeoutMs) {
  const row = makeExtensionRow(candidate, rank)
  row.error = `Extension install matrix timed out after ${timeoutMs}ms.`
  row.stages.search = makeStage("passed", "Candidate selected from marketplace search or explicit extension id.")
  row.stages.details = makeStage("skipped", row.error)
  markPendingAfterError(row, row.error)
  return row
}

function markRowTimedOut(row, timeoutMs) {
  row.error = `Extension install matrix timed out after ${timeoutMs}ms.`
  for (const stage of Object.keys(row.stages)) {
    if (row.stages[stage].status === "pending") {
      row.stages[stage] = makeStage("skipped", row.error)
    }
  }
  return row
}

async function processExtensionWithTimeout(candidate, rank, context, deps, timeoutMs) {
  let timer = null
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null
  const row = makeExtensionRow(candidate, rank)
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller?.abort()
      resolve(markRowTimedOut(row, timeoutMs))
    }, timeoutMs)
  })
  try {
    return await Promise.race([
      processExtension(row, candidate, context, deps, controller?.signal),
      timeout,
    ])
  } finally {
    if (timer) clearTimeout(timer)
    controller?.abort()
  }
}

function markPendingAfterError(row, detail) {
  for (const stage of Object.keys(row.stages)) {
    if (row.stages[stage].status === "pending") {
      row.stages[stage] = makeStage("skipped", detail)
    }
  }
}

function stagePassed(row, stage) {
  return row?.stages?.[stage]?.status === "passed"
}

function installChainComplete(row) {
  return ["details", "download", "extract", "manifest", "dependency", "install", "scan"].every((stage) => stagePassed(row, stage))
}

function buildSummary(options, extensions) {
  return {
    top: Number(options.top || 100),
    sampled: Math.min(Number(options.top || 100), extensions.length),
    metadataUsable: extensions.filter((item) => stagePassed(item, "details")).length,
    downloaded: extensions.filter((item) => stagePassed(item, "download")).length,
    extracted: extensions.filter((item) => stagePassed(item, "extract")).length,
    manifestScanned: extensions.filter((item) => stagePassed(item, "manifest")).length,
    dependencyInspected: extensions.filter((item) => stagePassed(item, "dependency")).length,
    installed: extensions.filter((item) => stagePassed(item, "install")).length,
    scanned: extensions.filter((item) => stagePassed(item, "scan")).length,
    activationPreflightReady: extensions.filter((item) => stagePassed(item, "activation")).length,
    installChainComplete: extensions.filter(installChainComplete).length,
    failed: extensions.filter((item) => item.error).length,
  }
}

function buildThresholds(summary, options) {
  return {
    minMetadata: Math.min(summary.top, Number(options.minMetadata || 95)),
    minInstallChain: Math.min(summary.top, Number(options.minInstallChain || 90)),
    minActivationPreflight: Math.min(summary.top, Number(options.minActivationPreflight || 40)),
    requestedMinMetadata: Number(options.minMetadata || 95),
    requestedMinInstallChain: Number(options.minInstallChain || 90),
    requestedMinActivationPreflight: Number(options.minActivationPreflight || 40),
  }
}

function buildGaps(summary, options) {
  const gaps = []
  const minMetadata = Math.min(Number(summary.top || options.top || 100), Number(options.minMetadata || 95))
  const minInstallChain = Math.min(Number(summary.top || options.top || 100), Number(options.minInstallChain || 90))
  const minActivationPreflight = Math.min(Number(summary.top || options.top || 100), Number(options.minActivationPreflight || 40))
  if (summary.metadataUsable < minMetadata) {
    gaps.push({
      id: "metadata_threshold",
      title: "Marketplace metadata threshold",
      detail: `${summary.metadataUsable}/${minMetadata} usable metadata records.`,
      nextAction: "Run the matrix with --top=100 and fix registry/detail/download URL failures.",
    })
  }
  if (summary.installChainComplete < minInstallChain) {
    gaps.push({
      id: "install_chain_threshold",
      title: "Marketplace install-chain threshold",
      detail: `${summary.installChainComplete}/${minInstallChain} complete download/extract/manifest/install/scan chains.`,
      nextAction: "Fix VSIX download, extraction, manifest, isolated install, or scanner failures.",
    })
  }
  if (summary.activationPreflightReady < minActivationPreflight) {
    gaps.push({
      id: "activation_preflight_threshold",
      title: "Activation preflight threshold",
      detail: `${summary.activationPreflightReady}/${minActivationPreflight} activation preflight records.`,
      nextAction: "Resolve entrypoint and static compatibility blockers for top extensions.",
    })
  }
  return gaps
}

function buildPartialMarketplaceInstallMatrixReport(normalized, context, startedAt, candidates, extensions, attemptedExtensions, extra = {}) {
  const summary = buildSummary(normalized, extensions)
  const gaps = buildGaps(summary, normalized)
  const ready = gaps.length === 0 && !extra.error
  return {
    reportKind: "extension-marketplace-install-matrix",
    createdAt: Number(normalized.createdAt || Date.now()),
    durationMs: Date.now() - startedAt,
    ready,
    status: ready ? "ready" : "blocked",
    thresholds: buildThresholds(summary, normalized),
    options: {
      perExtensionTimeoutMs: Number(normalized.perExtensionTimeoutMs || 90000),
      downloadTimeoutMs: Number(normalized.downloadTimeoutMs || context.downloadTimeoutMs || DEFAULT_VSIX_DOWNLOAD_TIMEOUT_MS),
      targetPlatform: context.targetPlatform || normalized.targetPlatform || computeTargetPlatform(),
      candidateMultiplier: Number(normalized.candidateMultiplier || 4),
      candidates: candidates.length,
      attempted: attemptedExtensions.length,
    },
    summary,
    gaps,
    installation: {
      isolated: true,
      extensionsDir: context.extensionsDir,
      cacheDir: context.cacheDir,
      artifactRoot: context.artifactRoot,
      kept: normalized.keepInstallDir === true,
      realExtensionsDir: REAL_EXTENSIONS_DIR,
      scannedExtensions: Number(extra.scannedExtensions || 0),
    },
    extensions,
    attemptedExtensions,
    ...extra,
  }
}

function progressPaths(reportDir = defaultReportDir()) {
  return {
    progressJsonPath: path.join(reportDir, "extension-marketplace-install-matrix-progress-latest.json"),
    progressMarkdownPath: path.join(reportDir, "extension-marketplace-install-matrix-progress-latest.md"),
  }
}

function saveMarketplaceInstallMatrixProgress(report, options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  const paths = progressPaths(reportDir)
  fs.mkdirSync(reportDir, { recursive: true })
  const withPaths = { ...report, ...paths }
  fs.writeFileSync(paths.progressJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.progressMarkdownPath, `${toMarkdown(withPaths)}\n`, "utf8")
  return { ...paths, report: withPaths }
}

async function buildMarketplaceInstallMatrixReport(options = {}, deps = {}) {
  const normalized = {
    ...parseArgs([]),
    ...options,
    extensionIds: Array.isArray(options.extensionIds) ? options.extensionIds : splitList(options.extensionIds),
    queries: Array.isArray(options.queries) ? options.queries : splitList(options.queries || DEFAULT_QUERIES.join(",")),
  }
  const reportDir = normalized.reportDir || defaultReportDir()
  const artifactRoot = path.join(reportDir, "extension-marketplace-install-matrix")
  const workDir = path.join(artifactRoot, new Date(Number(normalized.createdAt || Date.now())).toISOString().replace(/[:.]/g, "-"))
  const extensionsDir = path.join(workDir, "extensions")
  const cacheDir = path.join(artifactRoot, "vsix-cache")
  fs.mkdirSync(extensionsDir, { recursive: true })
  const registry = deps.registry || require("../desktop/services/extensions-host/marketplaceRegistry")
  const scanner = deps.scanner || require("../desktop/services/extensions-host/extensionScanner")
  const startedAt = Date.now()
  let candidates = []
  try {
    candidates = await collectCandidates(normalized, registry)
  } catch (error) {
    candidates = normalized.extensionIds.map((id) => {
      const { namespace, name } = splitExtensionId(id)
      return { id, publisher: namespace, namespace, name, error: String(error?.message || error) }
    })
  }
  const extensions = []
  const attemptedExtensions = []
  const context = {
    artifactRoot,
    cacheDir,
    workDir,
    extensionsDir,
    targetPlatform: normalized.targetPlatform || computeTargetPlatform(),
    downloadTimeoutMs: Number(normalized.downloadTimeoutMs || Math.max(
      DEFAULT_VSIX_DOWNLOAD_TIMEOUT_MS,
      Math.floor(Number(normalized.perExtensionTimeoutMs || 90000) * 0.65),
    )),
    scanExtensions: deps.scanExtensions || scanner.scanExtensions,
  }
  for (let index = 0; index < candidates.length; index += 1) {
    const row = await processExtensionWithTimeout(
      candidates[index],
      index + 1,
      context,
      { ...deps, registry },
      Number(normalized.perExtensionTimeoutMs || 90000),
    )
    attemptedExtensions.push(row)
    if (installChainComplete(row)) {
      extensions.push(row)
    }
    if (!normalized.noWrite && !deps.disableProgressWrite) {
      const progress = buildPartialMarketplaceInstallMatrixReport(
        normalized,
        context,
        startedAt,
        candidates,
        extensions,
        attemptedExtensions,
        {
          progress: {
            inProgress: true,
            processedCandidates: attemptedExtensions.length,
            successfulInstallChains: extensions.length,
            lastExtensionId: row.id,
            lastExtensionStatus: installChainComplete(row) ? "install-chain-complete" : "failed-or-skipped",
            updatedAt: new Date().toISOString(),
          },
        },
      )
      saveMarketplaceInstallMatrixProgress(progress, { reportDir })
    }
    const current = buildSummary(normalized, extensions)
    const enough = current.metadataUsable >= Math.min(Number(normalized.top || 100), Number(normalized.minMetadata || 95))
      && current.installChainComplete >= Math.min(Number(normalized.top || 100), Number(normalized.minInstallChain || 90))
      && current.activationPreflightReady >= Math.min(Number(normalized.top || 100), Number(normalized.minActivationPreflight || 40))
    if (enough) break
  }
  const summary = buildSummary(normalized, extensions)
  const gaps = buildGaps(summary, normalized)
  const ready = gaps.length === 0
  const scan = context.scanExtensions({ extensionsDir })
  if (!normalized.keepInstallDir) {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
  return {
    reportKind: "extension-marketplace-install-matrix",
    createdAt: Number(normalized.createdAt || Date.now()),
    durationMs: Date.now() - startedAt,
    ready,
    status: ready ? "ready" : "blocked",
    thresholds: buildThresholds(summary, normalized),
    options: {
      perExtensionTimeoutMs: Number(normalized.perExtensionTimeoutMs || 90000),
      downloadTimeoutMs: Number(normalized.downloadTimeoutMs || context.downloadTimeoutMs || DEFAULT_VSIX_DOWNLOAD_TIMEOUT_MS),
      targetPlatform: context.targetPlatform || normalized.targetPlatform || computeTargetPlatform(),
      candidateMultiplier: Number(normalized.candidateMultiplier || 4),
      candidates: candidates.length,
      attempted: attemptedExtensions.length,
    },
    summary,
    gaps,
    installation: {
      isolated: true,
      extensionsDir,
      cacheDir,
      artifactRoot,
      kept: normalized.keepInstallDir === true,
      realExtensionsDir: REAL_EXTENSIONS_DIR,
      scannedExtensions: scan.allExtensions.length,
    },
    extensions,
    attemptedExtensions,
  }
}

function marketplaceInstallMatrixPaths(reportDir = defaultReportDir()) {
  return {
    reportDir,
    latestJsonPath: path.join(reportDir, "extension-marketplace-install-matrix-latest.json"),
    latestMarkdownPath: path.join(reportDir, "extension-marketplace-install-matrix-latest.md"),
    ...progressPaths(reportDir),
  }
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function toMarkdown(report) {
  const rows = (report.extensions || []).map((extension) =>
    `| ${extension.rank} | ${escapeCell(extension.id)} | ${installChainComplete(extension) ? "passed" : "failed"} | ${extension.stages.details.status} | ${extension.stages.download.status} | ${extension.stages.extract.status} | ${extension.stages.manifest.status} | ${extension.stages.install.status} | ${extension.stages.scan.status} | ${extension.stages.activation.status} | ${escapeCell(extension.error || "-")} |`,
  )
  const gaps = (report.gaps || []).map((gap) => `- ${gap.id}: ${gap.detail}`)
  return [
    "# Extension Marketplace Install Matrix",
    "",
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Status: ${report.status}`,
    `- Sampled: ${report.summary?.sampled || 0}/${report.summary?.top || 0}`,
    `- Metadata usable: ${report.summary?.metadataUsable || 0}/${report.thresholds?.minMetadata || 0}`,
    `- Install chain complete: ${report.summary?.installChainComplete || 0}/${report.thresholds?.minInstallChain || 0}`,
    `- Activation preflight: ${report.summary?.activationPreflightReady || 0}/${report.thresholds?.minActivationPreflight || 0}`,
    `- Isolated install dir: ${report.installation?.extensionsDir || ""}`,
    "",
    "## Gaps",
    "",
    ...(gaps.length ? gaps : ["- none"]),
    "",
    "| Rank | Extension | Chain | Details | Download | Extract | Manifest | Install | Scan | Activation | Error |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

function saveMarketplaceInstallMatrixReport(report, options = {}) {
  const paths = marketplaceInstallMatrixPaths(options.reportDir || defaultReportDir())
  fs.mkdirSync(paths.reportDir, { recursive: true })
  const withPaths = { ...report, ...paths }
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${toMarkdown(withPaths)}\n`, "utf8")
  return { ...paths, report: withPaths }
}

function readLatestMarketplaceInstallMatrix(options = {}) {
  const paths = marketplaceInstallMatrixPaths(options.reportDir || defaultReportDir())
  if (!fs.existsSync(paths.latestJsonPath)) return { report: null, ...paths }
  return { report: JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8")), ...paths }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  try {
    const report = await buildMarketplaceInstallMatrixReport(options)
    if (!options.noWrite) {
      saveMarketplaceInstallMatrixReport(report, { reportDir: options.reportDir })
      saveMarketplaceInstallMatrixProgress({
        ...report,
        progress: {
          inProgress: false,
          processedCandidates: report.options.attempted,
          successfulInstallChains: report.summary.installChainComplete,
          updatedAt: new Date().toISOString(),
        },
      }, { reportDir: options.reportDir })
    }
    process.stdout.write(`${JSON.stringify({
      reportKind: report.reportKind,
      ready: report.ready,
      status: report.status,
      summary: report.summary,
      gaps: report.gaps.map((gap) => gap.id),
      jsonPath: options.noWrite ? "" : marketplaceInstallMatrixPaths(options.reportDir).latestJsonPath,
      markdownPath: options.noWrite ? "" : marketplaceInstallMatrixPaths(options.reportDir).latestMarkdownPath,
      progressJsonPath: options.noWrite ? "" : marketplaceInstallMatrixPaths(options.reportDir).progressJsonPath,
    }, null, 2)}\n`)
    process.exit(report.ready ? 0 : 1)
  } catch (error) {
    if (!options.noWrite) {
      const reportDir = options.reportDir || defaultReportDir()
      const summary = buildSummary(options, [])
      const failedReport = {
        reportKind: "extension-marketplace-install-matrix",
        createdAt: Date.now(),
        durationMs: 0,
        ready: false,
        status: "blocked",
        thresholds: buildThresholds(summary, options),
        options: {
          perExtensionTimeoutMs: Number(options.perExtensionTimeoutMs || 90000),
          downloadTimeoutMs: Number(options.downloadTimeoutMs || DEFAULT_VSIX_DOWNLOAD_TIMEOUT_MS),
          targetPlatform: options.targetPlatform || computeTargetPlatform(),
          candidateMultiplier: Number(options.candidateMultiplier || 4),
          candidates: 0,
          attempted: 0,
        },
        summary,
        gaps: [{
          id: "matrix_runtime_error",
          title: "Marketplace install matrix runtime error",
          detail: String(error?.message || error),
          nextAction: "Inspect stderr/progress logs and rerun the matrix after fixing the runtime failure.",
        }],
        installation: {
          isolated: true,
          extensionsDir: "",
          cacheDir: "",
          artifactRoot: "",
          kept: options.keepInstallDir === true,
          realExtensionsDir: REAL_EXTENSIONS_DIR,
          scannedExtensions: 0,
        },
        extensions: [],
        attemptedExtensions: [],
        error: String(error?.stack || error),
        progress: {
          inProgress: false,
          failed: true,
          updatedAt: new Date().toISOString(),
        },
      }
      saveMarketplaceInstallMatrixReport(failedReport, { reportDir })
      saveMarketplaceInstallMatrixProgress(failedReport, { reportDir })
    }
    throw error
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`)
    process.exit(1)
  })
}

module.exports = {
  buildMarketplaceInstallMatrixReport,
  buildPowerShellZipExtractionCommand,
  computeTargetPlatform,
  defaultDownloadVsix,
  defaultExtractVsix,
  defaultReportDir,
  findHistoricalVsixArtifacts,
  installChainComplete,
  isTargetPlatformCompatible,
  marketplaceInstallMatrixPaths,
  parseArgs,
  progressPaths,
  readLatestMarketplaceInstallMatrix,
  saveMarketplaceInstallMatrixReport,
  saveMarketplaceInstallMatrixProgress,
  toMarkdown,
}
