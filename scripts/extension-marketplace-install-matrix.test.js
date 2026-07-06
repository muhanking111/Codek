const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildMarketplaceInstallMatrixReport,
  buildPowerShellZipExtractionCommand,
  defaultDownloadVsix,
  defaultExtractVsix,
  marketplaceInstallMatrixPaths,
  parseArgs,
  progressPaths,
  readLatestMarketplaceInstallMatrix,
  saveMarketplaceInstallMatrixReport,
  saveMarketplaceInstallMatrixProgress,
} = require("./extension-marketplace-install-matrix")

function makeDeps() {
  const detailsById = {
    "sample.one": {
      id: "sample.one",
      publisher: "sample",
      namespace: "sample",
      name: "one",
      version: "1.0.0",
      downloadUrl: "https://registry.example/sample.one.vsix",
      contributes: { commands: [{ command: "sample.one", title: "One" }] },
    },
    "sample.two": {
      id: "sample.two",
      publisher: "sample",
      namespace: "sample",
      name: "two",
      version: "2.0.0",
      downloadUrl: "https://registry.example/sample.two.vsix",
      contributes: { languages: [{ id: "sample-two" }] },
    },
    "sample.three": {
      id: "sample.three",
      publisher: "sample",
      namespace: "sample",
      name: "three",
      version: "3.0.0",
      downloadUrl: "https://registry.example/sample.three.vsix",
      contributes: { configuration: { title: "Three", properties: {} } },
    },
  }
  return {
    registry: {
      async searchMarketplaceRegistry() {
        return {
          extensions: Object.values(detailsById),
          errors: [],
          sources: [{ name: "fixture", ok: true, count: 2 }],
        }
      },
      async getMarketplaceDetails(namespace, name) {
        return detailsById[`${namespace}.${name}`]
      },
    },
    async downloadVsix(extension, targetPath) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      fs.writeFileSync(targetPath, `fixture ${extension.id}`)
      return { bytes: fs.statSync(targetPath).size }
    },
    async extractVsix(extension, extractDir) {
      const extensionDir = path.join(extractDir, "extension")
      fs.mkdirSync(extensionDir, { recursive: true })
      fs.writeFileSync(path.join(extensionDir, "package.json"), `${JSON.stringify({
        publisher: extension.publisher,
        name: extension.name,
        version: extension.version,
        displayName: extension.displayName || extension.name,
        engines: { vscode: "*" },
        contributes: extension.contributes,
        activationEvents: [],
      }, null, 2)}\n`, "utf8")
      fs.writeFileSync(path.join(extensionDir, "extension.js"), "module.exports = {}\n", "utf8")
      return { extensionDir }
    },
  }
}

test("extension marketplace install matrix parseArgs supports thresholds and isolated artifact flags", () => {
  const parsed = parseArgs([
    "--no-write",
    "--no-network",
    "--report-dir=D:/reports",
    "--top=100",
    "--sample-size=25",
    "--extension-ids=sample.one,sample.two",
    "--min-metadata=95",
    "--min-install-chain=90",
    "--min-activation-preflight=40",
    "--per-extension-timeout-ms=12345",
    "--download-timeout-ms=23456",
    "--keep-install-dir",
  ])

  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.noNetwork, true)
  assert.equal(parsed.reportDir, "D:/reports")
  assert.equal(parsed.top, 100)
  assert.equal(parsed.sampleSize, 25)
  assert.deepEqual(parsed.extensionIds, ["sample.one", "sample.two"])
  assert.equal(parsed.minMetadata, 95)
  assert.equal(parsed.minInstallChain, 90)
  assert.equal(parsed.minActivationPreflight, 40)
  assert.equal(parsed.perExtensionTimeoutMs, 12345)
  assert.equal(parsed.downloadTimeoutMs, 23456)
  assert.equal(parsed.keepInstallDir, true)
})

test("extension marketplace install matrix parseArgs keeps default download timeout unset", () => {
  const parsed = parseArgs(["--per-extension-timeout-ms=90000"])

  assert.equal(parsed.perExtensionTimeoutMs, 90000)
  assert.equal(parsed.downloadTimeoutMs, 0)
})

test("extension marketplace install matrix installs real VSIX shape into an isolated scan directory", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-marketplace-install-matrix-"))
  const report = await buildMarketplaceInstallMatrixReport({
    reportDir,
    top: 2,
    sampleSize: 2,
    extensionIds: ["sample.one", "sample.two"],
    keepInstallDir: true,
    createdAt: 1,
  }, makeDeps())

  assert.equal(report.ready, true)
  assert.equal(report.summary.top, 2)
  assert.equal(report.summary.metadataUsable, 2)
  assert.equal(report.summary.installChainComplete, 2)
  assert.equal(report.summary.activationPreflightReady, 2)
  assert.equal(report.summary.scanned, 2)
  assert.equal(report.installation.isolated, true)
  assert.notEqual(path.resolve(report.installation.extensionsDir), path.resolve(__dirname, "..", "extensions"))
  assert.equal(report.extensions.every((item) => item.stages.scan.status === "passed"), true)
})

test("extension marketplace install matrix falls back to search metadata when details API is flaky", async () => {
  const deps = makeDeps()
  deps.registry.getMarketplaceDetails = async () => {
    throw new Error("fetch failed")
  }
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-marketplace-install-matrix-flaky-details-"))
  const report = await buildMarketplaceInstallMatrixReport({
    reportDir,
    top: 1,
    sampleSize: 1,
    extensionIds: ["sample.one"],
    keepInstallDir: true,
    createdAt: 1,
  }, deps)

  assert.equal(report.ready, true)
  assert.equal(report.summary.installChainComplete, 1)
  assert.equal(report.extensions[0].stages.details.status, "passed")
  assert.match(report.extensions[0].stages.details.warning, /fetch failed/)
})

test("extension marketplace install matrix resolves VS Code compatible target platform details", async () => {
  const deps = makeDeps()
  const detailCalls = []
  deps.registry.searchMarketplaceRegistry = async () => ({
    extensions: [{
      id: "sample.native",
      publisher: "sample",
      namespace: "sample",
      name: "native",
      version: "1.0.0",
      targetPlatform: "darwin-arm64",
      downloadUrl: "https://registry.example/sample.native-1.0.0@darwin-arm64.vsix",
    }],
    errors: [],
    sources: [],
  })
  deps.registry.getMarketplaceDetails = async (namespace, name, options = {}) => {
    detailCalls.push({ namespace, name, targetPlatform: options.targetPlatform, version: options.version })
    return {
      id: `${namespace}.${name}`,
      publisher: namespace,
      namespace,
      name,
      version: options.version || "1.0.0",
      targetPlatform: options.targetPlatform,
      downloadUrl: `https://registry.example/${namespace}.${name}-1.0.0@${options.targetPlatform}.vsix`,
      contributes: { commands: [{ command: `${namespace}.${name}`, title: name }] },
    }
  }
  const downloadedUrls = []
  deps.downloadVsix = async (extension, targetPath) => {
    downloadedUrls.push(extension.downloadUrl)
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, `fixture ${extension.id}`)
    return { bytes: fs.statSync(targetPath).size }
  }
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-marketplace-install-matrix-target-platform-"))
  const report = await buildMarketplaceInstallMatrixReport({
    reportDir,
    top: 1,
    sampleSize: 1,
    minMetadata: 1,
    minInstallChain: 1,
    minActivationPreflight: 1,
    createdAt: 1,
  }, deps)

  assert.equal(report.ready, true)
  assert.equal(detailCalls[0].targetPlatform, process.arch === "arm64" ? "win32-arm64" : "win32-x64")
  assert.match(downloadedUrls[0], /@win32-(x64|arm64)\.vsix$/)
  assert.equal(report.extensions[0].targetPlatform, process.arch === "arm64" ? "win32-arm64" : "win32-x64")
})

test("extension marketplace install matrix blocks full top 100 evidence below documented thresholds", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-marketplace-install-matrix-threshold-"))
  const report = await buildMarketplaceInstallMatrixReport({
    reportDir,
    top: 100,
    sampleSize: 2,
    extensionIds: ["sample.one", "sample.two"],
    minMetadata: 95,
    minInstallChain: 90,
    minActivationPreflight: 40,
    createdAt: 1,
  }, makeDeps())

  assert.equal(report.ready, false)
  assert.equal(report.status, "blocked")
  assert.equal(report.gaps.some((gap) => gap.id === "metadata_threshold"), true)
  assert.equal(report.gaps.some((gap) => gap.id === "install_chain_threshold"), true)
  assert.equal(report.gaps.some((gap) => gap.id === "activation_preflight_threshold"), true)
})

test("extension marketplace install matrix keeps failed attempts out of threshold samples", async () => {
  const deps = makeDeps()
  let downloads = 0
  deps.downloadVsix = async (extension, targetPath) => {
    downloads += 1
    if (extension.id === "sample.one") throw new Error("network down")
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, `fixture ${extension.id}`)
    return { bytes: fs.statSync(targetPath).size }
  }
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-marketplace-install-matrix-attempts-"))
  const report = await buildMarketplaceInstallMatrixReport({
    reportDir,
    top: 1,
    sampleSize: 1,
    extensionIds: ["sample.one", "sample.two"],
    keepInstallDir: true,
    createdAt: 1,
  }, deps)

  assert.equal(downloads, 2)
  assert.equal(report.ready, true)
  assert.equal(report.extensions.length, 1)
  assert.equal(report.extensions[0].id, "sample.two")
  assert.equal(report.summary.failed, 0)
  assert.equal(report.attemptedExtensions.length, 2)
  assert.equal(report.attemptedExtensions[0].error, "network down")
})

test("extension marketplace install matrix aborts in-flight downloads on row timeout", async () => {
  const deps = makeDeps()
  const abortedSignals = []
  deps.downloadVsix = async (_extension, _targetPath, options = {}) => {
    await new Promise((resolve) => {
      options.signal?.addEventListener("abort", () => {
        abortedSignals.push(options.signal.aborted)
        resolve()
      }, { once: true })
    })
    throw new Error("download aborted")
  }
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-marketplace-install-matrix-abort-timeout-"))
  const report = await buildMarketplaceInstallMatrixReport({
    reportDir,
    top: 1,
    sampleSize: 1,
    extensionIds: ["sample.one"],
    minMetadata: 1,
    minInstallChain: 1,
    minActivationPreflight: 1,
    perExtensionTimeoutMs: 20,
    noNetwork: true,
    candidateMultiplier: 1,
    createdAt: 1,
  }, deps)

  assert.equal(report.ready, false)
  assert.match(report.attemptedExtensions[0].error, /Extension install matrix timed out after 20ms\.|download aborted/)
  assert.deepEqual(abortedSignals, [true])
})

test("extension marketplace install matrix saves latest json and markdown reports", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-marketplace-install-matrix-save-"))
  const report = await buildMarketplaceInstallMatrixReport({
    reportDir,
    top: 1,
    sampleSize: 1,
    extensionIds: ["sample.one"],
    createdAt: 1,
  }, makeDeps())
  const saved = saveMarketplaceInstallMatrixReport(report, { reportDir })
  const latest = readLatestMarketplaceInstallMatrix({ reportDir })
  const paths = marketplaceInstallMatrixPaths(reportDir)

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(paths.latestJsonPath, saved.latestJsonPath)
  assert.equal(latest.report.reportKind, "extension-marketplace-install-matrix")
})

test("extension marketplace install matrix writes progress reports for long enterprise runs", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-marketplace-install-matrix-progress-"))
  const report = await buildMarketplaceInstallMatrixReport({
    reportDir,
    top: 2,
    sampleSize: 2,
    extensionIds: ["sample.one", "sample.two"],
    keepInstallDir: true,
    createdAt: 1,
  }, makeDeps())
  const paths = progressPaths(reportDir)
  const saved = saveMarketplaceInstallMatrixProgress({
    ...report,
    progress: {
      inProgress: false,
      processedCandidates: report.options.attempted,
      successfulInstallChains: report.summary.installChainComplete,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  }, { reportDir })

  assert.equal(fs.existsSync(paths.progressJsonPath), true)
  assert.equal(fs.existsSync(paths.progressMarkdownPath), true)
  assert.equal(saved.progressJsonPath, paths.progressJsonPath)
  const progress = JSON.parse(fs.readFileSync(paths.progressJsonPath, "utf8"))
  assert.equal(progress.progress.inProgress, false)
  assert.equal(progress.progress.processedCandidates, 2)
  assert.equal(progress.progress.successfulInstallChains, 2)
  assert.match(fs.readFileSync(paths.progressMarkdownPath, "utf8"), /Extension Marketplace Install Matrix/)
})

test("extension marketplace install matrix passes enterprise download timeout into downloader", async () => {
  const deps = makeDeps()
  const timeoutValues = []
  deps.downloadVsix = async (extension, targetPath, options = {}) => {
    timeoutValues.push(options.timeoutMs)
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, `fixture ${extension.id}`)
    return { bytes: fs.statSync(targetPath).size }
  }
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-marketplace-install-matrix-download-timeout-"))
  const report = await buildMarketplaceInstallMatrixReport({
    reportDir,
    top: 1,
    sampleSize: 1,
    extensionIds: ["sample.one"],
    perExtensionTimeoutMs: 90000,
    downloadTimeoutMs: 58000,
    createdAt: 1,
  }, deps)

  assert.equal(report.ready, true)
  assert.deepEqual(timeoutValues, [58000])
  assert.equal(report.options.downloadTimeoutMs, 58000)
})

test("extension marketplace install matrix restores direct audited cache before network download", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-marketplace-install-matrix-direct-cache-"))
  const cacheDir = path.join(reportDir, "vsix-cache")
  const targetPath = path.join(reportDir, "restored", "sample.one.vsix")
  const cachePath = path.join(cacheDir, "sample.one-1.0.0.vsix")
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(cachePath, "direct cache vsix", "utf8")
  let fetchCalled = false

  const downloaded = await defaultDownloadVsix({
    id: "sample.one",
    publisher: "sample",
    name: "one",
    version: "1.0.0",
    targetPlatform: "universal",
    downloadUrl: "https://registry.example/sample.one.vsix",
  }, targetPath, {
    attempts: 1,
    timeoutMs: 10,
    cacheDir,
    fetchImpl: () => {
      fetchCalled = true
      throw new Error("network should not be used when direct cache is valid")
    },
  })

  assert.equal(fetchCalled, false)
  assert.equal(downloaded.source, "artifact-cache")
  assert.equal(downloaded.downloadError || "", "")
  assert.equal(downloaded.bytes, "direct cache vsix".length)
  assert.equal(fs.readFileSync(targetPath, "utf8"), "direct cache vsix")
})

test("extension marketplace install matrix restores a matching VSIX from historical artifact cache", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-marketplace-install-matrix-cache-"))
  const artifactRoot = path.join(reportDir, "extension-marketplace-install-matrix")
  const historicalDir = path.join(artifactRoot, "2026-01-01T00-00-00-000Z", "rank-001-sample.one")
  const targetPath = path.join(reportDir, "restored", "sample.one.vsix")
  fs.mkdirSync(historicalDir, { recursive: true })
  fs.writeFileSync(path.join(historicalDir, "sample.one.vsix"), "historical vsix", "utf8")

  const downloaded = await defaultDownloadVsix({
    id: "sample.one",
    publisher: "sample",
    name: "one",
    version: "1.0.0",
    downloadUrl: "https://registry.example/sample.one.vsix",
  }, targetPath, {
    attempts: 1,
    timeoutMs: 10,
    artifactRoot,
    cacheDir: path.join(artifactRoot, "vsix-cache"),
    fetchImpl: () => Promise.reject(new Error("fetch failed")),
  })

  assert.equal(downloaded.source, "historical-artifact-cache")
  assert.equal(downloaded.bytes, "historical vsix".length)
  assert.equal(fs.readFileSync(targetPath, "utf8"), "historical vsix")
  assert.equal(fs.existsSync(downloaded.cachePath), true)
})

test("extension marketplace install matrix can pass when extra candidates replace one failed chain", async () => {
  const deps = makeDeps()
  deps.downloadVsix = async (extension, targetPath) => {
    if (extension.id === "sample.one") throw new Error("fetch failed")
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, `fixture ${extension.id}`)
    return { bytes: fs.statSync(targetPath).size }
  }
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-marketplace-install-matrix-extra-candidates-"))
  const report = await buildMarketplaceInstallMatrixReport({
    reportDir,
    top: 3,
    sampleSize: 3,
    extensionIds: ["sample.one", "sample.two", "sample.three"],
    minMetadata: 2,
    minInstallChain: 2,
    minActivationPreflight: 2,
    createdAt: 1,
  }, deps)

  assert.equal(report.ready, true)
  assert.equal(report.status, "ready")
  assert.equal(report.summary.sampled, 2)
  assert.equal(report.summary.failed, 0)
  assert.equal(report.summary.installChainComplete, 2)
  assert.equal(report.attemptedExtensions.some((extension) => extension.id === "sample.one" && extension.error === "fetch failed"), true)
})

test("default VSIX extractor handles .vsix archives without PowerShell Archive module cleanup", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-vsix-extract-"))
  const sourceDir = path.join(tmpDir, "source")
  const extensionDir = path.join(sourceDir, "extension")
  const archiveZipPath = path.join(tmpDir, "fixture.zip")
  const vsixPath = path.join(tmpDir, "fixture.vsix")
  const extractDir = path.join(tmpDir, "extract")
  fs.mkdirSync(extensionDir, { recursive: true })
  fs.writeFileSync(path.join(extensionDir, "package.json"), `${JSON.stringify({
    publisher: "sample",
    name: "extractor",
    version: "1.0.0",
    engines: { vscode: "*" },
  })}\n`, "utf8")
  fs.writeFileSync(path.join(extensionDir, "extension.js"), "module.exports = {}\n", "utf8")

  const created = require("node:child_process").spawnSync("tar", ["-a", "-cf", archiveZipPath, "-C", sourceDir, "extension"], {
    encoding: "utf8",
    shell: false,
  })
  if (created.status !== 0) {
    t.skip(`tar cannot create a zip fixture on this machine: ${created.stderr || created.stdout || created.error}`)
    return
  }
  fs.copyFileSync(archiveZipPath, vsixPath)

  const extracted = await defaultExtractVsix({ id: "sample.extractor" }, extractDir, vsixPath)

  assert.equal(path.basename(extracted.extensionDir), "extension")
  assert.equal(fs.existsSync(path.join(extracted.extensionDir, "package.json")), true)
  assert.equal(fs.existsSync(`${vsixPath}.zip`), false)
})

test("default VSIX downloader aborts slow downloads with an explicit timeout error", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-vsix-download-timeout-"))
  const targetPath = path.join(tmpDir, "slow.vsix")
  await assert.rejects(
    defaultDownloadVsix({ downloadUrl: "https://registry.example/slow.vsix" }, targetPath, {
      attempts: 1,
      timeoutMs: 10,
      fetchImpl: (_url, options = {}) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          const error = new Error("aborted")
          error.name = "AbortError"
          reject(error)
        })
      }),
    }),
    /VSIX download timed out after 10ms \(attempt 1\/1, url=https:\/\/registry\.example\/slow\.vsix\)/,
  )
  assert.equal(fs.existsSync(targetPath), false)
})

test("PowerShell VSIX fallback only receives the temporary .zip path", () => {
  const command = buildPowerShellZipExtractionCommand("C:\\tmp\\sample.vsix.zip", "C:\\tmp\\extract")

  assert.match(command, /sample\.vsix\.zip/)
  assert.doesNotMatch(command, /Expand-Archive/)
  assert.doesNotMatch(command, /Remove-Item/)
  assert.doesNotMatch(command, /sample\.vsix'[,)]/)
})
