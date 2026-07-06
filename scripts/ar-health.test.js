const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildArHealthReports,
  buildExtensionSnapshot,
  buildPerformanceBaseline,
  buildProviderConfigSnapshot,
  collectBuildStatsFromDist,
  readInstalledIconDataUrl,
  readLatestPerformanceBaseline,
  writeArHealthReports,
  writeReport,
} = require("./ar-health")

test("performance baseline warns when main chunk exceeds budget", () => {
  const report = buildPerformanceBaseline({
    mainChunkKb: 100,
    buildStats: { chunks: [{ name: "index", sizeKb: 150 }] },
  })

  assert.equal(report.ready, false)
  assert.equal(report.summary.warning, 1)
})

test("performance baseline can block strict lazy chunk budget", () => {
  const report = buildPerformanceBaseline({
    strict: true,
    lazyChunkKb: 100,
    buildStats: {
      chunks: [
        { name: "index.js", sizeKb: 10 },
        { name: "vendor.js", sizeKb: 250 },
      ],
    },
  })

  assert.equal(report.status, "blocked")
  assert.equal(report.summary.failed, 1)
  assert.equal(report.budgetPolicy.strict, true)
  assert.equal(report.chunkEvidence.largestChunk.name, "vendor.js")
  assert.equal(report.chunkEvidence.largestChunk.overBudgetRatio, 2.5)
})

test("performance baseline can block strict worker chunk budget", () => {
  const report = buildPerformanceBaseline({
    strict: true,
    workerChunkKb: 100,
    buildStats: {
      chunks: [
        { name: "index.js", sizeKb: 10 },
        { name: "ts.worker.js", sizeKb: 250 },
      ],
    },
  })

  assert.equal(report.status, "blocked")
  assert.equal(report.summary.failed, 1)
  assert.equal(report.chunkEvidence.largestWorkerChunk.name, "ts.worker.js")
  assert.equal(report.chunkEvidence.largestWorkerChunk.overBudgetRatio, 2.5)
})

test("performance baseline tracks Monaco workers separately from app lazy chunks", () => {
  const report = buildPerformanceBaseline({
    lazyChunkKb: 100,
    workerChunkKb: 300,
    buildStats: {
      chunks: [
        { name: "index.js", sizeKb: 10 },
        { name: "feature.js", sizeKb: 90 },
        { name: "ts.worker.js", sizeKb: 250 },
      ],
    },
  })

  assert.equal(report.ready, true)
  assert.equal(report.summary.warning, 0)
  assert.equal(report.chunkEvidence.largestChunk.name, "feature.js")
  assert.equal(report.chunkEvidence.largestWorkerChunk.name, "ts.worker.js")
})

test("performance baseline classifies business, Monaco, analysis, TypeScript compiler, and worker chunks separately", () => {
  const report = buildPerformanceBaseline({
    lazyChunkKb: 100,
    monacoChunkKb: 500,
    analysisChunkKb: 200,
    typescriptCompilerChunkKb: 500,
    workerChunkKb: 700,
    buildStats: {
      chunks: [
        { name: "index.js", sizeKb: 10 },
        { name: "ChatPanel.js", sizeKb: 90 },
        { name: "vendor-monaco.js", sizeKb: 450 },
        { name: "analysis.js", sizeKb: 180 },
        { name: "typescript.js", sizeKb: 450 },
        { name: "ts.worker.js", sizeKb: 650 },
      ],
    },
  })

  assert.equal(report.ready, true)
  assert.equal(report.chunkEvidence.largestBusinessChunk.name, "ChatPanel.js")
  assert.equal(report.chunkEvidence.largestMonacoChunk.name, "vendor-monaco.js")
  assert.equal(report.chunkEvidence.largestAnalysisChunk.name, "analysis.js")
  assert.equal(report.chunkEvidence.largestTypeScriptCompilerChunk.name, "typescript.js")
  assert.equal(report.chunkEvidence.largestWorkerChunk.name, "ts.worker.js")
  assert.deepEqual(report.checks.map((check) => check.id), [
    "main_chunk_budget",
    "largest_business_chunk_budget",
    "monaco_chunk_budget",
    "analysis_chunk_budget",
    "typescript_compiler_chunk_budget",
    "worker_chunk_budget",
  ])
})

test("performance baseline can block strict analysis chunk budget", () => {
  const report = buildPerformanceBaseline({
    strict: true,
    analysisChunkKb: 100,
    buildStats: {
      chunks: [
        { name: "index.js", sizeKb: 10 },
        { name: "analysis.js", sizeKb: 250 },
      ],
    },
  })

  assert.equal(report.status, "blocked")
  assert.equal(report.summary.failed, 1)
  assert.equal(report.chunkEvidence.largestAnalysisChunk.name, "analysis.js")
  assert.equal(report.warningPolicy[0].id, "analysis_chunk_budget")
})

test("performance baseline can block strict TypeScript compiler lazy chunk budget", () => {
  const report = buildPerformanceBaseline({
    strict: true,
    typescriptCompilerChunkKb: 100,
    buildStats: {
      chunks: [
        { name: "index.js", sizeKb: 10 },
        { name: "typescript.js", sizeKb: 250 },
      ],
    },
  })

  assert.equal(report.status, "blocked")
  assert.equal(report.summary.failed, 1)
  assert.equal(report.chunkEvidence.largestTypeScriptCompilerChunk.name, "typescript.js")
  assert.equal(report.warningPolicy[0].id, "typescript_compiler_chunk_budget")
})

test("performance baseline persists latest report", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-perf-health-"))
  const report = buildPerformanceBaseline({ buildStats: { chunks: [{ name: "index", sizeKb: 10 }] } })
  const saved = writeReport(report, reportDir)
  const latest = readLatestPerformanceBaseline({ reportDir })

  assert.equal(fs.existsSync(saved.jsonPath), true)
  assert.equal(latest.report.reportKind, "performance-baseline")
})

test("performance baseline reads real Vite dist asset sizes", () => {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-dist-"))
  const assetsDir = path.join(distDir, "assets")
  fs.mkdirSync(assetsDir, { recursive: true })
  fs.writeFileSync(path.join(assetsDir, "index-abc.js"), "x".repeat(1024 * 2))
  fs.writeFileSync(path.join(assetsDir, "vendor-def.js"), "x".repeat(1024 * 5))

  const stats = collectBuildStatsFromDist(distDir)
  const report = buildPerformanceBaseline({ distDir, mainChunkKb: 10, lazyChunkKb: 10 })

  assert.equal(stats.chunks.length, 2)
  assert.equal(stats.chunks[0].name, "vendor-def.js")
  assert.equal(report.buildStatsMissing, false)
  assert.match(report.buildStatsSource, /assets$/)
})

test("provider config snapshot does not expose secrets", () => {
  const providers = buildProviderConfigSnapshot({
    ollama: { host: "http://localhost:11434" },
    openai: { apiKey: "sk-test-secret", baseUrl: "https://api.openai.com/v1" },
    anthropic: { apiKey: "", baseUrl: "https://api.anthropic.com/v1" },
  })

  assert.equal(providers.some((provider) => JSON.stringify(provider).includes("sk-test-secret")), false)
  assert.equal(providers.find((provider) => provider.provider === "openai").ok, true)
  assert.equal(providers.find((provider) => provider.provider === "anthropic").ok, true)
  assert.equal(providers.find((provider) => provider.provider === "anthropic").note, "optional provider not configured")
})

test("extension snapshot can turn local extension icons into data URL cache evidence", () => {
  const extensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-icon-ext-"))
  const iconPath = path.join(extensionRoot, "media", "icon.png")
  fs.mkdirSync(path.dirname(iconPath), { recursive: true })
  fs.writeFileSync(iconPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

  const dataUrl = readInstalledIconDataUrl({
    id: "codek.icon",
    icon: "media/icon.png",
    installPath: extensionRoot,
  })

  assert.match(dataUrl, /^data:image\/png;base64,/)
  assert.equal(readInstalledIconDataUrl({
    id: "codek.escape",
    icon: "../outside.png",
    installPath: extensionRoot,
  }), "")
})

test("AR health generator writes all latest report types", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ar-health-"))
  const reports = buildArHealthReports({
    reportDir,
    providers: [{ provider: "ollama", model: "local", ok: true, usageSource: "estimate" }],
    debug: { adapters: [{ type: "node", command: process.execPath, args: ["--version"] }] },
    extensions: {
      installed: [{ id: "codek.sample", name: "sample", publisher: "codek", displayName: "Sample" }],
      searchResults: [{ id: "codek.sample", name: "sample", publisher: "codek", displayName: "Sample", iconUrl: "https://example.com/icon.png" }],
      query: "codek.sample",
      iconCache: { "codek.sample": "data:image/png;base64,AA==" },
      activationReport: { runtimeErrors: [] },
      installResults: [{ success: true }],
    },
    compatibility: {
      reportKind: "extension-compatibility-report",
      ready: true,
      status: "ready",
      summary: { total: 1, native: 0, compatible: 1, degraded: 0, blocked: 0 },
      extensions: [{
        id: "codek.sample",
        status: "compatible",
        unsupportedContributionPoints: [],
        blockers: [],
      }],
    },
    schedulerState: { runningGoals: 0 },
    incompleteGoals: [],
    auditHistory: [{ id: "audit_1" }],
    performance: { buildStats: { chunks: [{ name: "index.js", sizeKb: 10 }] } },
  })
  const saved = writeArHealthReports(reports, reportDir)

  assert.equal(fs.existsSync(saved.saved.provider.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.saved.debug.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.saved.extensions.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.saved.compatibility.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.saved.goals.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.saved.performance.jsonPath), true)
  assert.equal(reports.performance.ready, true)
})

test("AR extension snapshot exposes installed icon cache when local extensions have icons", () => {
  const snapshot = buildExtensionSnapshot()

  assert.equal(snapshot.searchResults.some((item) => item.iconUrl || item.iconCacheUrl), true)
  assert.equal(Object.keys(snapshot.iconCache).length > 0, true)
})
