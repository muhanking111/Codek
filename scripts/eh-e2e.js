#!/usr/bin/env node
/**
 * Extension Host end-to-end smoke test.
 *
 * Spawns the bundled VS Code Extension Host via the production
 * ExtensionHostServer, performs the handshake, and waits for activation RPCs
 * for the bundled built-in extensions (theme-defaults, typescript-language-features,
 * git, ...). Reports a per-extension pass/fail summary and exits 0 only when
 * every required extension reports activation without runtime error.
 *
 * Usage:
 *   node scripts/eh-e2e.js                       # full built-in set
 *   node scripts/eh-e2e.js git theme-defaults    # subset
 *   node scripts/eh-e2e.js --timeout=15000       # custom wait window
 */

const fs = require("fs")
const path = require("path")

const REPO_ROOT = path.resolve(__dirname, "..")
const { ExtensionHostServer } = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "extHostServer"))
const { getExtensionId, scanExtensions } = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "extensionScanner"))

const DEFAULT_REQUIRED = [
  "vscode.theme-defaults",
  "vscode.typescript-language-features",
  "vscode.git",
  "vscode.markdown-language-features",
]

function defaultReportDir() {
  return path.join(REPO_ROOT, ".codek", "reports")
}

function parseArgs(argv) {
  const required = []
  let timeoutMs = 12000
  let mode = "default"
  let reportPath = ""
  let reportDir = defaultReportDir()
  for (const arg of argv) {
    if (arg.startsWith("--timeout=")) {
      const n = Number(arg.slice("--timeout=".length))
      if (Number.isFinite(n) && n > 0) timeoutMs = n
      continue
    }
    if (arg === "--all") { mode = "all"; continue }
    if (arg === "--marketplace") { mode = "marketplace"; continue }
    if (arg === "--js-debug") { mode = "js-debug"; continue }
    if (arg === "--memento-storage") { mode = "memento-storage"; continue }
    if (arg === "--extension-context") { mode = "extension-context"; continue }
    if (arg === "--implicit-activation") { mode = "implicit-activation"; continue }
    if (arg === "--dependency-loop") { mode = "dependency-loop"; continue }
    if (arg === "--search-provider") { mode = "search-provider"; continue }
    if (arg === "--profile-content-handler") { mode = "profile-content-handler"; continue }
    if (arg.startsWith("--report=")) { reportPath = arg.slice("--report=".length); continue }
    if (arg.startsWith("--report-dir=")) { reportDir = arg.slice("--report-dir=".length); continue }
    if (arg.startsWith("--")) continue
    required.push(arg)
  }
  return {
    required: required.length > 0 ? required : DEFAULT_REQUIRED,
    timeoutMs,
    mode,
    reportPath,
    reportDir,
  }
}

function makeEhE2eExtensionContextPaths(reportDir = defaultReportDir()) {
  return {
    reportDir,
    latestJsonPath: path.join(reportDir, "eh-e2e-extension-context-latest.json"),
    latestMarkdownPath: path.join(reportDir, "eh-e2e-extension-context-latest.md"),
  }
}

function saveEhE2eExtensionContextReport(report, reportDir = defaultReportDir()) {
  const paths = makeEhE2eExtensionContextPaths(reportDir)
  fs.mkdirSync(paths.reportDir, { recursive: true })
  const withPaths = { ...report, ...paths }
  const checks = Array.isArray(withPaths.checks) ? withPaths.checks : []
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${[
    "# EH ExtensionContext E2E",
    "",
    `- Ready: ${withPaths.ready ? "YES" : "NO"}`,
    `- Status: ${withPaths.status}`,
    `- Extension: ${withPaths.extensionId || ""}`,
    `- Third-party scanned: ${withPaths.thirdPartyExtensionScanned ? "YES" : "NO"}`,
    `- Third-party builtin=false: ${withPaths.thirdPartyExtensionBuiltinFalse ? "YES" : "NO"}`,
    `- Package JSON preserved: ${withPaths.packageJsonPreserved ? "YES" : "NO"}`,
    `- extensionUri file: ${withPaths.extensionUriFile ? "YES" : "NO"}`,
    `- extensionPath matches: ${withPaths.extensionPathMatches ? "YES" : "NO"}`,
    `- asAbsolutePath works: ${withPaths.asAbsolutePathWorks ? "YES" : "NO"}`,
    `- storageUri file: ${withPaths.storageUriFile ? "YES" : "NO"}`,
    `- globalStorageUri file: ${withPaths.globalStorageUriFile ? "YES" : "NO"}`,
    `- logUri file: ${withPaths.logUriFile ? "YES" : "NO"}`,
    `- Checks: ${withPaths.passedChecks || 0}/${withPaths.checkCount || checks.length}`,
    `- Error: ${withPaths.error || "none"}`,
  ].join("\n")}\n`, "utf8")
  return withPaths
}

function createExtensionContextExtension(extensionsRoot, options = {}) {
  const directoryName = options.directoryName || "sample-vendor.extension-context-third-party-smoke"
  const publisher = options.publisher || "sample-vendor"
  const name = options.name || "extension-context-third-party-smoke"
  const displayName = options.displayName || "Third-party ExtensionContext Smoke"
  const description = options.description || "Temporary installed third-party-shaped extension used by Codek EH ExtensionContext smoke."
  const command = options.command || "thirdPartySmoke.extensionContext"
  const title = options.title || displayName
  const aiKey = options.aiKey || "codek-context-ai-key"
  const resultPath = options.resultPath || ""
  const extensionDir = path.join(extensionsRoot, directoryName)
  fs.mkdirSync(extensionDir, { recursive: true })
  fs.writeFileSync(path.join(extensionDir, "package.json"), `${JSON.stringify({
    name,
    publisher,
    version: "1.0.0",
    displayName,
    description,
    engines: { vscode: "*" },
    activationEvents: [`onCommand:${command}`],
    main: "./extension.js",
    aiKey,
    capabilities: {
      virtualWorkspaces: true,
      untrustedWorkspaces: { supported: true },
    },
    contributes: {
      commands: [{
        command,
        title,
      }],
    },
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(extensionDir, ".codek-installed.json"), `${JSON.stringify({
    builtin: false,
    source: "third-party-context-smoke",
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(extensionDir, "extension.js"), `const fs = require("fs");
const path = require("path");

function bool(value) {
  return value === true;
}

function writeReport(report) {
  const reportPath = process.env.CODEK_EH_CONTEXT_REPORT_PATH || ${JSON.stringify(resultPath)};
  if (!reportPath) return;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\\n", "utf8");
}

exports.activate = async function activate(context) {
  const extensionDir = __dirname;
  const packagePath = path.join(extensionDir, "package.json");
  const checks = [
    {
      id: "extension_id",
      passed: context.extension && context.extension.id === ${JSON.stringify(`${publisher}.${name}`)},
      detail: context.extension && context.extension.id,
    },
    {
      id: "package_json_preserved",
      passed: context.extension
        && context.extension.packageJSON
        && context.extension.packageJSON.aiKey === ${JSON.stringify(aiKey)}
        && context.extension.packageJSON.publisher === ${JSON.stringify(publisher)}
        && context.extension.packageJSON.name === ${JSON.stringify(name)}
        && context.extension.packageJSON.capabilities
        && context.extension.packageJSON.capabilities.virtualWorkspaces === true,
      detail: context.extension && context.extension.packageJSON,
    },
    {
      id: "extension_uri_file",
      passed: context.extensionUri && context.extensionUri.scheme === "file",
      detail: context.extensionUri && context.extensionUri.toString && context.extensionUri.toString(),
    },
    {
      id: "extension_path_matches",
      passed: typeof context.extensionPath === "string" && path.resolve(context.extensionPath) === path.resolve(extensionDir),
      detail: context.extensionPath,
    },
    {
      id: "as_absolute_path_works",
      passed: path.resolve(context.asAbsolutePath("package.json")) === path.resolve(packagePath),
      detail: context.asAbsolutePath("package.json"),
    },
    {
      id: "storage_uri_file",
      passed: context.storageUri && context.storageUri.scheme === "file",
      detail: context.storageUri && context.storageUri.toString && context.storageUri.toString(),
    },
    {
      id: "global_storage_uri_file",
      passed: context.globalStorageUri && context.globalStorageUri.scheme === "file",
      detail: context.globalStorageUri && context.globalStorageUri.toString && context.globalStorageUri.toString(),
    },
    {
      id: "log_uri_file",
      passed: context.logUri && context.logUri.scheme === "file",
      detail: context.logUri && context.logUri.toString && context.logUri.toString(),
    },
  ];
  const report = {
    reportKind: "eh-e2e-extension-context-fixture",
    ready: checks.every((check) => bool(check.passed)),
    extensionId: ${JSON.stringify(`${publisher}.${name}`)},
    extensionDir,
    packageJsonPreserved: checks.find((check) => check.id === "package_json_preserved").passed === true,
    extensionUriFile: checks.find((check) => check.id === "extension_uri_file").passed === true,
    extensionPathMatches: checks.find((check) => check.id === "extension_path_matches").passed === true,
    asAbsolutePathWorks: checks.find((check) => check.id === "as_absolute_path_works").passed === true,
    storageUriFile: checks.find((check) => check.id === "storage_uri_file").passed === true,
    globalStorageUriFile: checks.find((check) => check.id === "global_storage_uri_file").passed === true,
    logUriFile: checks.find((check) => check.id === "log_uri_file").passed === true,
    checks,
    passedChecks: checks.filter((check) => check.passed === true).length,
    checkCount: checks.length,
  };
  writeReport(report);
  return report;
};

exports.deactivate = function deactivate() {};
`, "utf8")
  return {
    extensionDir,
    extensionId: `${publisher}.${name}`,
    command,
    aiKey,
    resultPath,
    version: "1.0.0",
  }
}

function makeEhE2eImplicitActivationPaths(reportDir = defaultReportDir()) {
  return {
    reportDir,
    latestJsonPath: path.join(reportDir, "eh-e2e-implicit-activation-latest.json"),
    latestMarkdownPath: path.join(reportDir, "eh-e2e-implicit-activation-latest.md"),
  }
}

function saveEhE2eImplicitActivationReport(report, reportDir = defaultReportDir()) {
  const paths = makeEhE2eImplicitActivationPaths(reportDir)
  fs.mkdirSync(paths.reportDir, { recursive: true })
  const withPaths = { ...report, ...paths }
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${[
    "# EH Implicit Activation E2E",
    "",
    `- Ready: ${withPaths.ready ? "YES" : "NO"}`,
    `- Status: ${withPaths.status}`,
    `- Extension: ${withPaths.extensionId || ""}`,
    `- Event: ${withPaths.activationEvent || ""}`,
    `- Third-party scanned: ${withPaths.thirdPartyExtensionScanned ? "YES" : "NO"}`,
    `- Third-party builtin=false: ${withPaths.thirdPartyExtensionBuiltinFalse ? "YES" : "NO"}`,
    `- Manifest explicit activationEvents: ${withPaths.manifestHasExplicitActivationEvents ? "YES" : "NO"}`,
    `- Implicit onCommand generated: ${withPaths.implicitOnCommandGenerated ? "YES" : "NO"}`,
    `- activationEventsByEvent indexed: ${withPaths.activationEventsByEventHasExtension ? "YES" : "NO"}`,
    `- Activated by implicit event: ${withPaths.activatedByImplicitEvent ? "YES" : "NO"}`,
    `- Command contribution preserved: ${withPaths.commandContributionPreserved ? "YES" : "NO"}`,
    `- Error: ${withPaths.error || "none"}`,
  ].join("\n")}\n`, "utf8")
  return withPaths
}

function createImplicitActivationExtension(extensionsRoot, options = {}) {
  const directoryName = options.directoryName || "sample-vendor.implicit-activation-third-party-smoke"
  const publisher = options.publisher || "sample-vendor"
  const name = options.name || "implicit-activation-third-party-smoke"
  const displayName = options.displayName || "Third-party Implicit Activation Smoke"
  const description = options.description || "Temporary installed third-party-shaped extension used by Codek EH implicit activation smoke."
  const command = options.command || "thirdPartySmoke.implicitActivation"
  const title = options.title || displayName
  const resultPath = options.resultPath || ""
  const extensionId = `${publisher}.${name}`
  const extensionDir = path.join(extensionsRoot, directoryName)
  fs.mkdirSync(extensionDir, { recursive: true })
  fs.writeFileSync(path.join(extensionDir, "package.json"), `${JSON.stringify({
    name,
    publisher,
    version: "1.0.0",
    displayName,
    description,
    engines: { vscode: "*" },
    main: "./extension.js",
    contributes: {
      commands: [{
        command,
        title,
      }],
    },
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(extensionDir, ".codek-installed.json"), `${JSON.stringify({
    builtin: false,
    source: "third-party-implicit-activation-smoke",
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(extensionDir, "extension.js"), `const fs = require("fs");
const path = require("path");

function writeReport(report) {
  const reportPath = process.env.CODEK_EH_IMPLICIT_ACTIVATION_REPORT_PATH || ${JSON.stringify(resultPath)};
  if (!reportPath) return;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\\n", "utf8");
}

exports.activate = async function activate(context) {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
  const commands = Array.isArray(context.extension && context.extension.packageJSON && context.extension.packageJSON.contributes && context.extension.packageJSON.contributes.commands)
    ? context.extension.packageJSON.contributes.commands
    : [];
  const report = {
    reportKind: "eh-e2e-implicit-activation-fixture",
    ready: true,
    extensionId: context.extension && context.extension.id,
    expectedExtensionId: ${JSON.stringify(extensionId)},
    activatedByImplicitEvent: true,
    manifestHasExplicitActivationEvents: Object.prototype.hasOwnProperty.call(manifest, "activationEvents"),
    commandContributionPreserved: commands.some((item) => item && item.command === ${JSON.stringify(command)}),
    extensionUriFile: context.extensionUri && context.extensionUri.scheme === "file",
  };
  report.ready = report.extensionId === report.expectedExtensionId
    && report.activatedByImplicitEvent === true
    && report.manifestHasExplicitActivationEvents === false
    && report.commandContributionPreserved === true
    && report.extensionUriFile === true;
  writeReport(report);
  return report;
};

exports.deactivate = function deactivate() {};
`, "utf8")
  return {
    extensionDir,
    extensionId,
    command,
    resultPath,
    version: "1.0.0",
  }
}

function makeEhE2eDependencyLoopPaths(reportDir = defaultReportDir()) {
  return {
    reportDir,
    latestJsonPath: path.join(reportDir, "eh-e2e-dependency-loop-latest.json"),
    latestMarkdownPath: path.join(reportDir, "eh-e2e-dependency-loop-latest.md"),
  }
}

function saveEhE2eDependencyLoopReport(report, reportDir = defaultReportDir()) {
  const paths = makeEhE2eDependencyLoopPaths(reportDir)
  fs.mkdirSync(paths.reportDir, { recursive: true })
  const withPaths = { ...report, ...paths }
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${[
    "# EH Dependency Loop E2E",
    "",
    `- Ready: ${withPaths.ready ? "YES" : "NO"}`,
    `- Status: ${withPaths.status}`,
    `- Removed due to looping: ${(withPaths.removedDueToLooping || []).join(", ") || "none"}`,
    `- Healthy extension: ${withPaths.healthyExtensionId || ""}`,
    `- Loop absent from allExtensions: ${withPaths.loopExtensionsAbsentFromAllExtensions ? "YES" : "NO"}`,
    `- Loop absent from byId: ${withPaths.loopExtensionsAbsentFromById ? "YES" : "NO"}`,
    `- Loop activation events absent: ${withPaths.loopActivationEventsAbsent ? "YES" : "NO"}`,
    `- Loop activationEventsByEvent absent: ${withPaths.loopActivationEventsByEventAbsent ? "YES" : "NO"}`,
    `- InitData loop absent: ${withPaths.initDataLoopExtensionsAbsent ? "YES" : "NO"}`,
    `- InitData myExtensions loop absent: ${withPaths.initDataMyExtensionsLoopAbsent ? "YES" : "NO"}`,
    `- Healthy scanned: ${withPaths.healthyExtensionScanned ? "YES" : "NO"}`,
    `- Healthy activation event indexed: ${withPaths.healthyActivationEventIndexed ? "YES" : "NO"}`,
    `- Healthy in InitData: ${withPaths.healthyExtensionInInitData ? "YES" : "NO"}`,
    `- Healthy activated: ${withPaths.healthyActivated ? "YES" : "NO"}`,
    `- Error: ${withPaths.error || "none"}`,
  ].join("\n")}\n`, "utf8")
  return withPaths
}

function createDependencyLoopExtensions(extensionsRoot, options = {}) {
  const resultPath = options.resultPath || ""
  const loopA = writeDependencyLoopExtension(extensionsRoot, {
    directoryName: "codek.loop-a",
    publisher: "codek",
    name: "loop-a",
    displayName: "Codek Dependency Loop A",
    command: "loop.a",
    dependencies: ["codek.loop-b"],
    resultPath,
  })
  const loopB = writeDependencyLoopExtension(extensionsRoot, {
    directoryName: "codek.loop-b",
    publisher: "codek",
    name: "loop-b",
    displayName: "Codek Dependency Loop B",
    command: "loop.b",
    dependencies: ["codek.loop-a"],
    resultPath,
  })
  const healthy = writeDependencyLoopExtension(extensionsRoot, {
    directoryName: "codek.good",
    publisher: "codek",
    name: "good",
    displayName: "Codek Healthy Dependency Smoke",
    command: "good.run",
    dependencies: [],
    resultPath,
  })

  return {
    loopAExtensionDir: loopA.extensionDir,
    loopBExtensionDir: loopB.extensionDir,
    healthyExtensionDir: healthy.extensionDir,
    loopExtensionIds: [loopA.extensionId, loopB.extensionId],
    healthyExtensionId: healthy.extensionId,
    loopActivationEvents: [loopA.activationEvent, loopB.activationEvent],
    healthyActivationEvent: healthy.activationEvent,
    healthyCommand: healthy.command,
    resultPath,
  }
}

function makeEhE2eSearchProviderPaths(reportDir = defaultReportDir()) {
  return {
    reportDir,
    latestJsonPath: path.join(reportDir, "eh-e2e-search-provider-latest.json"),
    latestMarkdownPath: path.join(reportDir, "eh-e2e-search-provider-latest.md"),
  }
}

function saveEhE2eSearchProviderReport(report, reportDir = defaultReportDir()) {
  const paths = makeEhE2eSearchProviderPaths(reportDir)
  fs.mkdirSync(paths.reportDir, { recursive: true })
  const withPaths = { ...report, ...paths }
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${[
    "# EH Search Provider E2E",
    "",
    `- Ready: ${withPaths.ready ? "YES" : "NO"}`,
    `- Status: ${withPaths.status}`,
    `- Extension: ${withPaths.extensionId || ""}`,
    `- Event: ${withPaths.activationEvent || ""}`,
    `- Third-party scanned: ${withPaths.thirdPartyExtensionScanned ? "YES" : "NO"}`,
    `- Third-party builtin=false: ${withPaths.thirdPartyExtensionBuiltinFalse ? "YES" : "NO"}`,
    `- Third-party installed marker: ${withPaths.thirdPartyInstalledMarkerPresent ? "YES" : "NO"}`,
    `- activationEventsByEvent indexed: ${withPaths.activationEventsByEventHasExtension ? "YES" : "NO"}`,
    `- Proposed APIs present: ${withPaths.enabledApiProposalsPresent ? "YES" : "NO"}`,
    `- Text provider registered: ${withPaths.textProviderRegistered ? "YES" : "NO"}`,
    `- File provider registered: ${withPaths.fileProviderRegistered ? "YES" : "NO"}`,
    `- Activated by onSearch:file: ${withPaths.activatedByOnSearchFile ? "YES" : "NO"}`,
    `- Text search engine: ${withPaths.textSearchEngine || ""}`,
    `- Text search provider: ${withPaths.textSearchProvider || ""}`,
    `- Text search hit: ${withPaths.textSearchHitPath || ""}`,
    `- File search engine: ${withPaths.fileSearchEngine || ""}`,
    `- File search hit: ${withPaths.fileSearchHitPath || ""}`,
    `- Fallback bypassed: ${withPaths.fallbackBypassed ? "YES" : "NO"}`,
    `- Provider errors: ${Array.isArray(withPaths.providerErrors) && withPaths.providerErrors.length
      ? withPaths.providerErrors.map((entry) => entry.error || JSON.stringify(entry)).join(" | ")
      : "none"}`,
    `- Error: ${withPaths.error || "none"}`,
  ].join("\n")}\n`, "utf8")
  return withPaths
}

function createSearchProviderExtension(extensionsRoot, options = {}) {
  const directoryName = options.directoryName || "sample-vendor.search-provider-third-party-smoke"
  const publisher = options.publisher || "sample-vendor"
  const name = options.name || "search-provider-third-party-smoke"
  const displayName = options.displayName || "Third-party Search Provider Smoke"
  const description = options.description || "Temporary installed third-party-shaped extension used by Codek EH SearchProvider smoke."
  const resultPath = options.resultPath || ""
  const workspaceRoot = options.workspaceRoot || ""
  const textHitPath = options.textHitPath || ""
  const fileHitPath = options.fileHitPath || ""
  const needle = options.needle || "CODEK_SEARCH_PROVIDER_NEEDLE"
  const activationEvent = "onSearch:file"
  const extensionId = `${publisher}.${name}`
  const extensionDir = path.join(extensionsRoot, directoryName)
  fs.mkdirSync(extensionDir, { recursive: true })
  fs.writeFileSync(path.join(extensionDir, "package.json"), `${JSON.stringify({
    name,
    publisher,
    version: "1.0.0",
    displayName,
    description,
    engines: { vscode: "*" },
    activationEvents: [activationEvent],
    enabledApiProposals: ["textSearchProvider", "fileSearchProvider"],
    main: "./extension.js",
    capabilities: {
      virtualWorkspaces: true,
      untrustedWorkspaces: { supported: true },
    },
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(extensionDir, ".codek-installed.json"), `${JSON.stringify({
    builtin: false,
    source: "third-party-search-provider-smoke",
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(extensionDir, "extension.js"), `const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

const expectedExtensionId = ${JSON.stringify(extensionId)};
const textHitPath = ${JSON.stringify(textHitPath)};
const fileHitPath = ${JSON.stringify(fileHitPath)};
const workspaceRoot = ${JSON.stringify(workspaceRoot)};
const needle = ${JSON.stringify(needle)};

function writeReport(report) {
  const reportPath = process.env.CODEK_EH_SEARCH_PROVIDER_REPORT_PATH || ${JSON.stringify(resultPath)};
  if (!reportPath) return;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\\n", "utf8");
}

function readPreview() {
  try {
    return fs.readFileSync(textHitPath, "utf8").split(/\\r?\\n/)[0] || needle;
  } catch {
    return needle;
  }
}

exports.activate = async function activate(context) {
  const report = {
    reportKind: "eh-e2e-search-provider-fixture",
    ready: false,
    extensionId: context.extension && context.extension.id,
    expectedExtensionId,
    workspaceRoot,
    textHitPath,
    fileHitPath,
    textSearchCalls: 0,
    fileSearchCalls: 0,
    textProviderRegistered: false,
    fileProviderRegistered: false,
    activatedByOnSearchFile: true,
  };
  const textDisposable = vscode.workspace.registerTextSearchProvider("file", {
    provideTextSearchResults(query, options, progress, token) {
      report.textSearchCalls += 1;
      if (token && token.isCancellationRequested) return { limitHit: false };
      const previewText = readPreview();
      const start = Math.max(0, previewText.indexOf(query && query.pattern ? query.pattern : needle));
      const end = start + String(query && query.pattern ? query.pattern : needle).length;
      progress.report({
        uri: vscode.Uri.file(textHitPath),
        ranges: new vscode.Range(0, start, 0, end),
        preview: {
          text: previewText,
          matches: new vscode.Range(0, start, 0, end),
        },
      });
      writeReport(report);
      return { limitHit: false };
    },
  });
  const fileDisposable = vscode.workspace.registerFileSearchProvider("file", {
    provideFileSearchResults(query, options, token) {
      report.fileSearchCalls += 1;
      if (token && token.isCancellationRequested) return [];
      writeReport(report);
      return [vscode.Uri.file(fileHitPath)];
    },
  });
  context.subscriptions.push(textDisposable, fileDisposable);
  report.textProviderRegistered = true;
  report.fileProviderRegistered = true;
  report.ready = report.extensionId === expectedExtensionId
    && report.textProviderRegistered === true
    && report.fileProviderRegistered === true;
  writeReport(report);
  return report;
};

exports.deactivate = function deactivate() {};
`, "utf8")
  return {
    extensionDir,
    extensionId,
    activationEvent,
    resultPath,
    workspaceRoot,
    textHitPath,
    fileHitPath,
    needle,
    version: "1.0.0",
  }
}

function writeDependencyLoopExtension(extensionsRoot, options = {}) {
  const directoryName = options.directoryName
  const publisher = options.publisher
  const name = options.name
  const displayName = options.displayName
  const command = options.command
  const dependencies = Array.isArray(options.dependencies) ? options.dependencies : []
  const resultPath = options.resultPath || ""
  const extensionId = `${publisher}.${name}`
  const activationEvent = `onCommand:${command}`
  const extensionDir = path.join(extensionsRoot, directoryName)
  fs.mkdirSync(extensionDir, { recursive: true })
  fs.writeFileSync(path.join(extensionDir, "package.json"), `${JSON.stringify({
    name,
    publisher,
    version: "1.0.0",
    displayName,
    description: "Temporary extension used by Codek EH dependency loop smoke.",
    engines: { vscode: "*" },
    activationEvents: [activationEvent],
    extensionDependencies: dependencies,
    main: "./extension.js",
    contributes: {
      commands: [{
        command,
        title: displayName,
      }],
    },
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(extensionDir, ".codek-installed.json"), `${JSON.stringify({
    builtin: false,
    source: "third-party-dependency-loop-smoke",
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(extensionDir, "extension.js"), `const fs = require("fs");
const path = require("path");

function writeReport(report) {
  const reportPath = process.env.CODEK_EH_DEPENDENCY_LOOP_REPORT_PATH || ${JSON.stringify(resultPath)};
  if (!reportPath) return;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\\n", "utf8");
}

exports.activate = async function activate(context) {
  const report = {
    reportKind: "eh-e2e-dependency-loop-fixture",
    ready: context.extension && context.extension.id === ${JSON.stringify(extensionId)},
    extensionId: context.extension && context.extension.id,
    expectedExtensionId: ${JSON.stringify(extensionId)},
    command: ${JSON.stringify(command)},
    extensionUriFile: context.extensionUri && context.extensionUri.scheme === "file",
  };
  report.ready = report.ready && report.extensionUriFile === true;
  writeReport(report);
  return report;
};

exports.deactivate = function deactivate() {};
`, "utf8")
  return {
    extensionDir,
    extensionId,
    command,
    activationEvent,
  }
}

function makeEhE2eProfileContentHandlerPaths(reportDir = defaultReportDir()) {
  return {
    reportDir,
    latestJsonPath: path.join(reportDir, "eh-e2e-profile-content-handler-latest.json"),
    latestMarkdownPath: path.join(reportDir, "eh-e2e-profile-content-handler-latest.md"),
  }
}

function saveEhE2eProfileContentHandlerReport(report, reportDir = defaultReportDir()) {
  const paths = makeEhE2eProfileContentHandlerPaths(reportDir)
  fs.mkdirSync(paths.reportDir, { recursive: true })
  const withPaths = { ...report, ...paths }
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${[
    "# EH Profile Content Handler E2E",
    "",
    `- Ready: ${withPaths.ready ? "YES" : "NO"}`,
    `- Status: ${withPaths.status}`,
    `- Extension: ${withPaths.extensionId || ""}`,
    `- Handler: ${withPaths.handlerId || ""}`,
    `- Event: ${withPaths.activationEvent || ""}`,
    `- Third-party scanned: ${withPaths.thirdPartyExtensionScanned ? "YES" : "NO"}`,
    `- Third-party builtin=false: ${withPaths.thirdPartyExtensionBuiltinFalse ? "YES" : "NO"}`,
    `- Third-party installed marker: ${withPaths.thirdPartyInstalledMarkerPresent ? "YES" : "NO"}`,
    `- activationEventsByEvent indexed: ${withPaths.activationEventsByEventHasExtension ? "YES" : "NO"}`,
    `- Proposed API present: ${withPaths.enabledApiProposalsPresent ? "YES" : "NO"}`,
    `- Activated by onProfile handler event: ${withPaths.activatedByOnProfileHandler ? "YES" : "NO"}`,
    `- Handler registered: ${withPaths.handlerRegistered ? "YES" : "NO"}`,
    `- Handler metadata matched: ${withPaths.handlerMetadataMatched ? "YES" : "NO"}`,
    `- Read profile called: ${withPaths.readProfileCalled ? "YES" : "NO"}`,
    `- Read returned template: ${withPaths.readProfileReturnedTemplate ? "YES" : "NO"}`,
    `- Save profile called: ${withPaths.saveProfileCalled ? "YES" : "NO"}`,
    `- Save returned result: ${withPaths.saveProfileReturnedResult ? "YES" : "NO"}`,
    `- Cleanup after stop: ${withPaths.cleanupAfterStop ? "YES" : "NO"}`,
    `- Provider errors: ${Array.isArray(withPaths.providerErrors) && withPaths.providerErrors.length
      ? withPaths.providerErrors.map((entry) => entry.error || JSON.stringify(entry)).join(" | ")
      : "none"}`,
    `- Error: ${withPaths.error || "none"}`,
  ].join("\n")}\n`, "utf8")
  return withPaths
}

function createProfileContentHandlerExtension(extensionsRoot, options = {}) {
  const directoryName = options.directoryName || "sample-vendor.profile-content-handler-third-party-smoke"
  const publisher = options.publisher || "sample-vendor"
  const name = options.name || "profile-content-handler-third-party-smoke"
  const displayName = options.displayName || "Third-party Profile Content Handler Smoke"
  const description = options.description || "Temporary installed third-party-shaped extension used by Codek EH ProfileContentHandler smoke."
  const resultPath = options.resultPath || ""
  const savedPath = options.savedPath || ""
  const handlerId = options.handlerId || "third-party-profile"
  const handlerName = options.handlerName || "Third-party Profile Handler"
  const handlerDescription = options.handlerDescription || "VS Code profile content handler smoke provider"
  const activationEvent = `onProfile:${handlerId}`
  const extensionId = `${publisher}.${name}`
  const extensionDir = path.join(extensionsRoot, directoryName)
  fs.mkdirSync(extensionDir, { recursive: true })
  fs.writeFileSync(path.join(extensionDir, "package.json"), `${JSON.stringify({
    name,
    publisher,
    version: "1.0.0",
    displayName,
    description,
    engines: { vscode: "*" },
    activationEvents: [activationEvent],
    enabledApiProposals: ["profileContentHandlers"],
    main: "./extension.js",
    capabilities: {
      virtualWorkspaces: true,
      untrustedWorkspaces: { supported: true },
    },
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(extensionDir, ".codek-installed.json"), `${JSON.stringify({
    builtin: false,
    source: "third-party-profile-content-handler-smoke",
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(extensionDir, "extension.js"), `const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

const expectedExtensionId = ${JSON.stringify(extensionId)};
const handlerId = ${JSON.stringify(handlerId)};
const savedPath = ${JSON.stringify(savedPath)};
const template = JSON.stringify({
  name: "Third-party Imported Profile",
  settings: "{}",
  keybindings: "[]",
  snippets: "{}",
  extensions: [],
});

function writeReport(report) {
  const reportPath = process.env.CODEK_EH_PROFILE_CONTENT_HANDLER_REPORT_PATH || ${JSON.stringify(resultPath)};
  if (!reportPath) return;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\\n", "utf8");
}

exports.activate = async function activate(context) {
  const report = {
    reportKind: "eh-e2e-profile-content-handler-fixture",
    ready: false,
    extensionId: context.extension && context.extension.id,
    expectedExtensionId,
    handlerId,
    handlerName: ${JSON.stringify(handlerName)},
    handlerDescription: ${JSON.stringify(handlerDescription)},
    handlerRegistered: false,
    readProfileCalls: 0,
    saveProfileCalls: 0,
    readArgs: [],
    saveArgs: [],
    savedPath,
    error: "",
  };
  const disposable = vscode.window.registerProfileContentHandler(handlerId, {
    name: ${JSON.stringify(handlerName)},
    description: ${JSON.stringify(handlerDescription)},
    readProfile(idOrUri, token) {
      report.readProfileCalls += 1;
      report.readArgs.push({
        value: typeof idOrUri === "string" ? idOrUri : String(idOrUri && (idOrUri.path || idOrUri.toString && idOrUri.toString()) || ""),
        isUri: Boolean(idOrUri && typeof idOrUri === "object" && idOrUri.scheme),
        tokenPresent: Boolean(token),
        cancellationRequested: Boolean(token && token.isCancellationRequested),
      });
      writeReport(report);
      return template;
    },
    saveProfile(name, content, token) {
      report.saveProfileCalls += 1;
      report.saveArgs.push({
        name,
        contentLength: typeof content === "string" ? content.length : 0,
        contentHasTemplateName: typeof content === "string" && content.includes("Third-party Imported Profile"),
        tokenPresent: Boolean(token),
        cancellationRequested: Boolean(token && token.isCancellationRequested),
      });
      if (savedPath) {
        fs.mkdirSync(path.dirname(savedPath), { recursive: true });
        fs.writeFileSync(savedPath, String(content || ""), "utf8");
      }
      writeReport(report);
      return {
        id: "third-party-profile:exported",
        filePath: savedPath,
        link: savedPath ? vscode.Uri.file(savedPath) : undefined,
        bytesWritten: typeof content === "string" ? Buffer.byteLength(content, "utf8") : 0,
      };
    },
  });
  context.subscriptions.push(disposable);
  report.handlerRegistered = true;
  report.ready = report.extensionId === expectedExtensionId && report.handlerRegistered === true;
  writeReport(report);
  return report;
};

exports.deactivate = function deactivate() {};
`, "utf8")
  return {
    extensionDir,
    extensionId,
    activationEvent,
    handlerId,
    handlerName,
    handlerDescription,
    resultPath,
    savedPath,
    version: "1.0.0",
  }
}

function makeEhE2eMementoStoragePaths(reportDir = defaultReportDir()) {
  return {
    reportDir,
    latestJsonPath: path.join(reportDir, "eh-e2e-memento-storage-latest.json"),
    latestMarkdownPath: path.join(reportDir, "eh-e2e-memento-storage-latest.md"),
  }
}

function saveEhE2eMementoStorageReport(report, reportDir = defaultReportDir()) {
  const paths = makeEhE2eMementoStoragePaths(reportDir)
  fs.mkdirSync(paths.reportDir, { recursive: true })
  const withPaths = { ...report, ...paths }
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${[
    "# EH Memento Storage E2E",
    "",
    `- Ready: ${withPaths.ready ? "YES" : "NO"}`,
    `- Status: ${withPaths.status}`,
    `- Extension: ${withPaths.extensionId || ""}`,
    `- Profile ID: ${withPaths.profileId || ""}`,
    `- Global state stored: ${withPaths.globalStateStored ? "YES" : "NO"}`,
    `- Workspace state stored: ${withPaths.workspaceStateStored ? "YES" : "NO"}`,
    `- Sync keys stored: ${withPaths.syncKeysStored ? "YES" : "NO"}`,
    `- Third-party extension: ${withPaths.thirdPartyExtensionId || ""}`,
    `- Third-party extension scanned: ${withPaths.thirdPartyExtensionScanned ? "YES" : "NO"}`,
    `- Third-party builtin=false: ${withPaths.thirdPartyExtensionBuiltinFalse ? "YES" : "NO"}`,
    `- Third-party installed marker: ${withPaths.thirdPartyInstalledMarkerPresent ? "YES" : "NO"}`,
    `- Third-party global state stored: ${withPaths.thirdPartyGlobalStateStored ? "YES" : "NO"}`,
    `- Third-party workspace state stored: ${withPaths.thirdPartyWorkspaceStateStored ? "YES" : "NO"}`,
    `- Third-party sync keys stored: ${withPaths.thirdPartySyncKeysStored ? "YES" : "NO"}`,
    `- Legacy storage written: ${withPaths.legacyStorageWritten ? "YES" : "NO"}`,
    `- Error: ${withPaths.error || "none"}`,
  ].join("\n")}\n`, "utf8")
  return withPaths
}

function createMementoStorageExtension(extensionsRoot, options = {}) {
  const directoryName = options.directoryName || "memento-storage-smoke"
  const publisher = options.publisher || "codek-smoke"
  const name = options.name || "memento-storage-smoke"
  const displayName = options.displayName || "Codek Memento Storage Smoke"
  const description = options.description || "Temporary extension used by Codek EH memento storage smoke."
  const command = options.command || "codekSmoke.mementoStorage"
  const title = options.title || displayName
  const globalKey = options.globalKey || "codekSmokeGlobal"
  const workspaceKey = options.workspaceKey || "codekSmokeWorkspace"
  const syncKeys = Array.isArray(options.syncKeys) ? options.syncKeys : [globalKey]
  const extensionDir = path.join(extensionsRoot, directoryName)
  fs.mkdirSync(extensionDir, { recursive: true })
  fs.writeFileSync(path.join(extensionDir, "package.json"), `${JSON.stringify({
    name,
    publisher,
    version: "1.0.0",
    displayName,
    description,
    engines: { vscode: "*" },
    activationEvents: [`onCommand:${command}`],
    main: "./extension.js",
    contributes: {
      commands: [{
        command,
        title,
      }],
    },
  }, null, 2)}\n`, "utf8")
  if (options.installedMarker) {
    fs.writeFileSync(path.join(extensionDir, ".codek-installed.json"), `${JSON.stringify(options.installedMarker, null, 2)}\n`, "utf8")
  }
  fs.writeFileSync(path.join(extensionDir, "extension.js"), `exports.activate = async function activate(context) {
  await context.globalState.update(${JSON.stringify(globalKey)}, { ok: true, source: "globalState" });
  await context.workspaceState.update(${JSON.stringify(workspaceKey)}, { ok: true, source: "workspaceState" });
  context.globalState.setKeysForSync(${JSON.stringify(syncKeys)});
  return { ready: true };
};
exports.deactivate = function deactivate() {};
`, "utf8")
  return {
    extensionDir,
    extensionId: `${publisher}.${name}`,
    command,
    globalKey,
    workspaceKey,
    syncKeys,
    version: "1.0.0",
  }
}

function inspectMementoStorageSnapshot(snapshot, fixture, userDataProfile) {
  const globalRaw = snapshot.entries[fixture.extensionId]?.value || ""
  const workspaceKey = Object.keys(snapshot.entries).find((key) => key.startsWith("workspace/") && key.endsWith(`/${fixture.extensionId}`)) || ""
  const workspaceRaw = workspaceKey ? snapshot.entries[workspaceKey]?.value || "" : ""
  const syncRaw = snapshot.entries[`extensionKeys/${fixture.extensionId}@${fixture.version}`]?.value || ""
  return {
    globalStateStored: globalRaw.includes(fixture.globalKey) && snapshot.entries[fixture.extensionId]?.scope === userDataProfile.STORAGE_SCOPE.PROFILE,
    workspaceStateStored: workspaceRaw.includes(fixture.workspaceKey) && snapshot.entries[workspaceKey]?.scope === userDataProfile.STORAGE_SCOPE.WORKSPACE,
    syncKeysStored: fixture.syncKeys.every((key) => syncRaw.includes(key)),
  }
}

function removeTempRootBestEffort(tempRoot) {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 })
    return ""
  } catch (error) {
    return String(error?.message || error)
  }
}

async function runMementoStorageMode(options = {}) {
  const previousCodekData = process.env.CODEK_DATA
  const tempRoot = fs.mkdtempSync(path.join(require("os").tmpdir(), "codek-eh-memento-"))
  const dataRoot = path.join(tempRoot, "data")
  const workspaceRoot = path.join(tempRoot, "workspace")
  const extensionsRoot = path.join(tempRoot, "extensions")
  fs.mkdirSync(workspaceRoot, { recursive: true })
  fs.mkdirSync(extensionsRoot, { recursive: true })
  process.env.CODEK_DATA = dataRoot
  const userDataProfilePath = path.join(REPO_ROOT, "desktop", "services", "userDataProfile")
  const mainThreadPath = path.join(REPO_ROOT, "desktop", "services", "extensions-host", "mainThread")
  delete require.cache[require.resolve(userDataProfilePath)]
  delete require.cache[require.resolve(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "mainThread", "mainThreadStorage"))]
  delete require.cache[require.resolve(mainThreadPath)]
  const { registerAllProxies } = require(mainThreadPath)
  const userDataProfile = require(userDataProfilePath)

  const startedAt = Date.now()
  const fixture = createMementoStorageExtension(extensionsRoot)
  const thirdPartyFixture = createMementoStorageExtension(extensionsRoot, {
    directoryName: "sample-vendor.memento-storage-third-party-smoke",
    publisher: "sample-vendor",
    name: "memento-storage-third-party-smoke",
    displayName: "Third-party Memento Storage Smoke",
    description: "Temporary installed third-party-shaped extension used by Codek EH memento storage smoke.",
    command: "thirdPartySmoke.mementoStorage",
    title: "Third-party Memento Storage Smoke",
    globalKey: "thirdPartySmokeGlobal",
    workspaceKey: "thirdPartySmokeWorkspace",
    syncKeys: ["thirdPartySmokeGlobal"],
    installedMarker: {
      builtin: false,
      source: "third-party-smoke",
    },
  })
  const report = {
    reportKind: "eh-e2e-memento-storage",
    createdAt: Date.now(),
    ready: false,
    status: "blocked",
    durationMs: 0,
    extensionId: fixture.extensionId,
    thirdPartyExtensionId: thirdPartyFixture.extensionId,
    profileId: userDataProfile.DEFAULT_PROFILE_ID,
    storagePath: "",
    globalStateStored: false,
    workspaceStateStored: false,
    syncKeysStored: false,
    thirdPartyExtensionScanned: false,
    thirdPartyExtensionBuiltinFalse: false,
    thirdPartyInstalledMarkerPresent: false,
    thirdPartyGlobalStateStored: false,
    thirdPartyWorkspaceStateStored: false,
    thirdPartySyncKeysStored: false,
    legacyStorageWritten: false,
    cleanupError: "",
    activationResult: null,
    thirdPartyActivationResult: null,
    error: "",
    errorName: "",
  }

  const server = new ExtensionHostServer()
  registerAllProxies(server, {
    rootDir: workspaceRoot,
    workspace: workspaceRoot,
  })
  try {
    await server.start({ rootDir: workspaceRoot, extensionsDir: extensionsRoot })
    const scan = scanExtensions({ extensionsDir: extensionsRoot })
    const scannedThirdParty = scan.byId.get(thirdPartyFixture.extensionId)
    report.thirdPartyExtensionScanned = Boolean(scannedThirdParty)
    report.thirdPartyExtensionBuiltinFalse = scannedThirdParty?.isBuiltin === false
    report.thirdPartyInstalledMarkerPresent = fs.existsSync(path.join(thirdPartyFixture.extensionDir, ".codek-installed.json"))
    report.activationResult = await server.call(106, "$activateByEvent", [`onCommand:${fixture.command}`, 1], options.timeoutMs || 12000)
    report.thirdPartyActivationResult = await server.call(106, "$activateByEvent", [`onCommand:${thirdPartyFixture.command}`, 1], options.timeoutMs || 12000)
    await new Promise((resolve) => setTimeout(resolve, 250))

    const snapshot = userDataProfile.readProfileStorageData(userDataProfile.DEFAULT_PROFILE_ID)
    report.storagePath = snapshot.path
    const primaryStorage = inspectMementoStorageSnapshot(snapshot, fixture, userDataProfile)
    const thirdPartyStorage = inspectMementoStorageSnapshot(snapshot, thirdPartyFixture, userDataProfile)
    report.globalStateStored = primaryStorage.globalStateStored
    report.workspaceStateStored = primaryStorage.workspaceStateStored
    report.syncKeysStored = primaryStorage.syncKeysStored
    report.thirdPartyGlobalStateStored = thirdPartyStorage.globalStateStored
    report.thirdPartyWorkspaceStateStored = thirdPartyStorage.workspaceStateStored
    report.thirdPartySyncKeysStored = thirdPartyStorage.syncKeysStored
    report.legacyStorageWritten = fs.existsSync(path.join(dataRoot, "ext-host-storage.json"))
    report.ready = report.globalStateStored
      && report.workspaceStateStored
      && report.syncKeysStored
      && report.thirdPartyExtensionScanned
      && report.thirdPartyExtensionBuiltinFalse
      && report.thirdPartyInstalledMarkerPresent
      && report.thirdPartyGlobalStateStored
      && report.thirdPartyWorkspaceStateStored
      && report.thirdPartySyncKeysStored
      && !report.legacyStorageWritten
    report.status = report.ready ? "ready" : "blocked"
  } catch (error) {
    report.error = String(error?.message || error)
    report.errorName = String(error?.name || "")
  } finally {
    report.durationMs = Date.now() - startedAt
    try { server.stop() } catch {}
    if (previousCodekData === undefined) {
      delete process.env.CODEK_DATA
    } else {
      process.env.CODEK_DATA = previousCodekData
    }
    report.cleanupError = removeTempRootBestEffort(tempRoot)
  }

  const saved = saveEhE2eMementoStorageReport(report, options.reportDir)
  console.log(`[eh-e2e] memento storage report: ${saved.latestJsonPath}`)
  process.exit(report.ready ? 0 : 1)
}

async function runExtensionContextMode(options = {}) {
  const previousContextReportPath = process.env.CODEK_EH_CONTEXT_REPORT_PATH
  const tempRoot = fs.mkdtempSync(path.join(require("os").tmpdir(), "codek-eh-context-"))
  const workspaceRoot = path.join(tempRoot, "workspace")
  const extensionsRoot = path.join(tempRoot, "extensions")
  const fixtureResultPath = path.join(tempRoot, "context-result.json")
  fs.mkdirSync(workspaceRoot, { recursive: true })
  fs.mkdirSync(extensionsRoot, { recursive: true })
  process.env.CODEK_EH_CONTEXT_REPORT_PATH = fixtureResultPath

  const { registerAllProxies } = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "mainThread"))
  const startedAt = Date.now()
  const fixture = createExtensionContextExtension(extensionsRoot, { resultPath: fixtureResultPath })
  const report = {
    reportKind: "eh-e2e-extension-context",
    createdAt: Date.now(),
    ready: false,
    status: "blocked",
    durationMs: 0,
    extensionId: fixture.extensionId,
    thirdPartyExtensionScanned: false,
    thirdPartyExtensionBuiltinFalse: false,
    thirdPartyInstalledMarkerPresent: false,
    packageJsonPreserved: false,
    extensionUriFile: false,
    extensionPathMatches: false,
    asAbsolutePathWorks: false,
    storageUriFile: false,
    globalStorageUriFile: false,
    logUriFile: false,
    passedChecks: 0,
    checkCount: 0,
    checks: [],
    activationResult: null,
    fixtureResultPath,
    cleanupError: "",
    error: "",
    errorName: "",
  }

  const server = new ExtensionHostServer()
  registerAllProxies(server, {
    rootDir: workspaceRoot,
    workspace: workspaceRoot,
  })
  try {
    await server.start({ rootDir: workspaceRoot, extensionsDir: extensionsRoot })
    const scan = scanExtensions({ extensionsDir: extensionsRoot })
    const scannedThirdParty = scan.byId.get(fixture.extensionId)
    report.thirdPartyExtensionScanned = Boolean(scannedThirdParty)
    report.thirdPartyExtensionBuiltinFalse = scannedThirdParty?.isBuiltin === false
    report.thirdPartyInstalledMarkerPresent = fs.existsSync(path.join(fixture.extensionDir, ".codek-installed.json"))
    report.packageJsonPreserved = scannedThirdParty?.aiKey === fixture.aiKey
      && scannedThirdParty?.capabilities?.virtualWorkspaces === true
    report.activationResult = await server.call(106, "$activateByEvent", [`onCommand:${fixture.command}`, 1], options.timeoutMs || 12000)
    await new Promise((resolve) => setTimeout(resolve, 250))
    const fixtureReport = fs.existsSync(fixtureResultPath)
      ? JSON.parse(fs.readFileSync(fixtureResultPath, "utf8"))
      : report.activationResult && typeof report.activationResult === "object"
        ? report.activationResult
        : null
    if (fixtureReport) {
      report.packageJsonPreserved = report.packageJsonPreserved && fixtureReport.packageJsonPreserved === true
      report.extensionUriFile = fixtureReport.extensionUriFile === true
      report.extensionPathMatches = fixtureReport.extensionPathMatches === true
      report.asAbsolutePathWorks = fixtureReport.asAbsolutePathWorks === true
      report.storageUriFile = fixtureReport.storageUriFile === true
      report.globalStorageUriFile = fixtureReport.globalStorageUriFile === true
      report.logUriFile = fixtureReport.logUriFile === true
      report.checks = Array.isArray(fixtureReport.checks) ? fixtureReport.checks : []
      report.passedChecks = Number(fixtureReport.passedChecks || report.checks.filter((check) => check?.passed === true).length)
      report.checkCount = Number(fixtureReport.checkCount || report.checks.length)
    }
    report.ready = report.thirdPartyExtensionScanned
      && report.thirdPartyExtensionBuiltinFalse
      && report.thirdPartyInstalledMarkerPresent
      && report.packageJsonPreserved
      && report.extensionUriFile
      && report.extensionPathMatches
      && report.asAbsolutePathWorks
      && report.storageUriFile
      && report.globalStorageUriFile
      && report.logUriFile
      && report.checkCount > 0
      && report.passedChecks === report.checkCount
    report.status = report.ready ? "ready" : "blocked"
  } catch (error) {
    report.error = String(error?.message || error)
    report.errorName = String(error?.name || "")
  } finally {
    report.durationMs = Date.now() - startedAt
    try { server.stop() } catch {}
    if (previousContextReportPath === undefined) {
      delete process.env.CODEK_EH_CONTEXT_REPORT_PATH
    } else {
      process.env.CODEK_EH_CONTEXT_REPORT_PATH = previousContextReportPath
    }
    report.cleanupError = removeTempRootBestEffort(tempRoot)
  }

  const saved = saveEhE2eExtensionContextReport(report, options.reportDir)
  console.log(`[eh-e2e] extension context report: ${saved.latestJsonPath}`)
  process.exit(report.ready ? 0 : 1)
}

async function runImplicitActivationMode(options = {}) {
  const previousReportPath = process.env.CODEK_EH_IMPLICIT_ACTIVATION_REPORT_PATH
  const tempRoot = fs.mkdtempSync(path.join(require("os").tmpdir(), "codek-eh-implicit-"))
  const workspaceRoot = path.join(tempRoot, "workspace")
  const extensionsRoot = path.join(tempRoot, "extensions")
  const fixtureResultPath = path.join(tempRoot, "implicit-activation-result.json")
  fs.mkdirSync(workspaceRoot, { recursive: true })
  fs.mkdirSync(extensionsRoot, { recursive: true })
  process.env.CODEK_EH_IMPLICIT_ACTIVATION_REPORT_PATH = fixtureResultPath

  const { registerAllProxies } = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "mainThread"))
  const startedAt = Date.now()
  const fixture = createImplicitActivationExtension(extensionsRoot, { resultPath: fixtureResultPath })
  const activationEvent = `onCommand:${fixture.command}`
  const report = {
    reportKind: "eh-e2e-implicit-activation",
    createdAt: Date.now(),
    ready: false,
    status: "blocked",
    durationMs: 0,
    extensionId: fixture.extensionId,
    activationEvent,
    thirdPartyExtensionScanned: false,
    thirdPartyExtensionBuiltinFalse: false,
    thirdPartyInstalledMarkerPresent: false,
    manifestHasExplicitActivationEvents: true,
    implicitOnCommandGenerated: false,
    activationEventsByEventHasExtension: false,
    activatedByImplicitEvent: false,
    commandContributionPreserved: false,
    extensionUriFile: false,
    effectiveActivationEvents: [],
    activationResult: null,
    fixtureResultPath,
    cleanupError: "",
    error: "",
    errorName: "",
  }

  const server = new ExtensionHostServer()
  registerAllProxies(server, {
    rootDir: workspaceRoot,
    workspace: workspaceRoot,
  })
  try {
    await server.start({ rootDir: workspaceRoot, extensionsDir: extensionsRoot })
    const scan = scanExtensions({ extensionsDir: extensionsRoot })
    const scannedThirdParty = scan.byId.get(fixture.extensionId)
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture.extensionDir, "package.json"), "utf8"))
    report.thirdPartyExtensionScanned = Boolean(scannedThirdParty)
    report.thirdPartyExtensionBuiltinFalse = scannedThirdParty?.isBuiltin === false
    report.thirdPartyInstalledMarkerPresent = fs.existsSync(path.join(fixture.extensionDir, ".codek-installed.json"))
    report.manifestHasExplicitActivationEvents = Object.prototype.hasOwnProperty.call(manifest, "activationEvents")
    report.effectiveActivationEvents = Array.isArray(scannedThirdParty?.activationEvents) ? scannedThirdParty.activationEvents : []
    report.implicitOnCommandGenerated = report.effectiveActivationEvents.includes(activationEvent)
    report.activationEventsByEventHasExtension = Array.isArray(scan.activationEventsByEvent[activationEvent])
      && scan.activationEventsByEvent[activationEvent].includes(fixture.extensionId)
    report.activationResult = await server.call(106, "$activateByEvent", [activationEvent, 1], options.timeoutMs || 12000)
    await new Promise((resolve) => setTimeout(resolve, 250))
    const fixtureReport = fs.existsSync(fixtureResultPath)
      ? JSON.parse(fs.readFileSync(fixtureResultPath, "utf8"))
      : report.activationResult && typeof report.activationResult === "object"
        ? report.activationResult
        : null
    if (fixtureReport) {
      report.activatedByImplicitEvent = fixtureReport.activatedByImplicitEvent === true
      report.commandContributionPreserved = fixtureReport.commandContributionPreserved === true
      report.extensionUriFile = fixtureReport.extensionUriFile === true
      report.fixtureReady = fixtureReport.ready === true
    }
    report.ready = report.thirdPartyExtensionScanned
      && report.thirdPartyExtensionBuiltinFalse
      && report.thirdPartyInstalledMarkerPresent
      && report.manifestHasExplicitActivationEvents === false
      && report.implicitOnCommandGenerated
      && report.activationEventsByEventHasExtension
      && report.activatedByImplicitEvent
      && report.commandContributionPreserved
      && report.extensionUriFile
      && report.fixtureReady === true
    report.status = report.ready ? "ready" : "blocked"
  } catch (error) {
    report.error = String(error?.message || error)
    report.errorName = String(error?.name || "")
  } finally {
    report.durationMs = Date.now() - startedAt
    try { server.stop() } catch {}
    if (previousReportPath === undefined) {
      delete process.env.CODEK_EH_IMPLICIT_ACTIVATION_REPORT_PATH
    } else {
      process.env.CODEK_EH_IMPLICIT_ACTIVATION_REPORT_PATH = previousReportPath
    }
    report.cleanupError = removeTempRootBestEffort(tempRoot)
  }

  const saved = saveEhE2eImplicitActivationReport(report, options.reportDir)
  console.log(`[eh-e2e] implicit activation report: ${saved.latestJsonPath}`)
  process.exit(report.ready ? 0 : 1)
}

function captureInitDataPayload(rootDir, extensionsDir) {
  const server = new ExtensionHostServer()
  const frames = []
  server._initData = { rootDir, extensionsDir }
  server._msgId = 1
  server._lastReceivedId = 0
  server._writeBuffered = (frame) => frames.push(frame)
  server._sendInitData()
  if (frames.length === 0) return null
  return JSON.parse(frames[0].slice(13).toString("utf8"))
}

async function runDependencyLoopMode(options = {}) {
  const previousReportPath = process.env.CODEK_EH_DEPENDENCY_LOOP_REPORT_PATH
  const tempRoot = fs.mkdtempSync(path.join(require("os").tmpdir(), "codek-eh-loop-"))
  const workspaceRoot = path.join(tempRoot, "workspace")
  const extensionsRoot = path.join(tempRoot, "extensions")
  const fixtureResultPath = path.join(tempRoot, "dependency-loop-result.json")
  fs.mkdirSync(workspaceRoot, { recursive: true })
  fs.mkdirSync(extensionsRoot, { recursive: true })
  process.env.CODEK_EH_DEPENDENCY_LOOP_REPORT_PATH = fixtureResultPath

  const { registerAllProxies } = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "mainThread"))
  const startedAt = Date.now()
  const fixture = createDependencyLoopExtensions(extensionsRoot, { resultPath: fixtureResultPath })
  const report = {
    reportKind: "eh-e2e-dependency-loop",
    createdAt: Date.now(),
    ready: false,
    status: "blocked",
    durationMs: 0,
    loopExtensionIds: fixture.loopExtensionIds,
    loopActivationEvents: fixture.loopActivationEvents,
    healthyExtensionId: fixture.healthyExtensionId,
    healthyActivationEvent: fixture.healthyActivationEvent,
    removedDueToLooping: [],
    allExtensionIds: [],
    byIdKeys: [],
    initDataAllExtensionIds: [],
    initDataMyExtensionIds: [],
    loopExtensionsAbsentFromAllExtensions: false,
    loopExtensionsAbsentFromById: false,
    loopActivationEventsAbsent: false,
    loopActivationEventsByEventAbsent: false,
    initDataLoopExtensionsAbsent: false,
    initDataMyExtensionsLoopAbsent: false,
    healthyExtensionScanned: false,
    healthyActivationEventIndexed: false,
    healthyExtensionInInitData: false,
    healthyActivated: false,
    activationResult: null,
    fixtureReady: false,
    fixtureResultPath,
    cleanupError: "",
    error: "",
    errorName: "",
  }

  const server = new ExtensionHostServer()
  registerAllProxies(server, {
    rootDir: workspaceRoot,
    workspace: workspaceRoot,
  })
  try {
    const scan = scanExtensions({ extensionsDir: extensionsRoot })
    const initDataPayload = captureInitDataPayload(workspaceRoot, extensionsRoot)
    const initExtensions = initDataPayload?.extensions || {}
    const initAllExtensions = Array.isArray(initExtensions.allExtensions) ? initExtensions.allExtensions : []
    const initMyExtensions = Array.isArray(initExtensions.myExtensions) ? initExtensions.myExtensions : []

    report.removedDueToLooping = scan.removedDueToLooping.map((extension) => getExtensionId(extension)).sort()
    report.allExtensionIds = scan.allExtensions.map((extension) => getExtensionId(extension))
    report.byIdKeys = Array.from(scan.byId.keys()).sort()
    report.initDataAllExtensionIds = initAllExtensions.map((extension) => getExtensionId(extension))
    report.initDataMyExtensionIds = initMyExtensions.map((identifier) => getExtensionId({ identifier }))
    report.loopExtensionsAbsentFromAllExtensions = fixture.loopExtensionIds.every((id) => !report.allExtensionIds.includes(id))
    report.loopExtensionsAbsentFromById = fixture.loopExtensionIds.every((id) => !scan.byId.has(id))
    report.loopActivationEventsAbsent = fixture.loopExtensionIds.every((id) => scan.activationEvents[id] === undefined)
    report.loopActivationEventsByEventAbsent = fixture.loopActivationEvents.every((event) => scan.activationEventsByEvent[event] === undefined)
    report.initDataLoopExtensionsAbsent = fixture.loopExtensionIds.every((id) => !report.initDataAllExtensionIds.includes(id))
    report.initDataMyExtensionsLoopAbsent = fixture.loopExtensionIds.every((id) => !report.initDataMyExtensionIds.includes(id))
    report.healthyExtensionScanned = scan.byId.has(fixture.healthyExtensionId)
    report.healthyActivationEventIndexed = Array.isArray(scan.activationEventsByEvent[fixture.healthyActivationEvent])
      && scan.activationEventsByEvent[fixture.healthyActivationEvent].includes(fixture.healthyExtensionId)
    report.healthyExtensionInInitData = report.initDataAllExtensionIds.includes(fixture.healthyExtensionId)
      && report.initDataMyExtensionIds.includes(fixture.healthyExtensionId)

    await server.start({ rootDir: workspaceRoot, extensionsDir: extensionsRoot })
    report.activationResult = await server.call(106, "$activateByEvent", [fixture.healthyActivationEvent, 1], options.timeoutMs || 12000)
    await new Promise((resolve) => setTimeout(resolve, 250))
    const fixtureReport = fs.existsSync(fixtureResultPath)
      ? JSON.parse(fs.readFileSync(fixtureResultPath, "utf8"))
      : report.activationResult && typeof report.activationResult === "object"
        ? report.activationResult
        : null
    report.fixtureReady = fixtureReport?.ready === true
    report.healthyActivated = fixtureReport?.extensionId === fixture.healthyExtensionId
      && fixtureReport?.extensionUriFile === true

    report.ready = arraysEqual(report.removedDueToLooping, fixture.loopExtensionIds.slice().sort())
      && report.loopExtensionsAbsentFromAllExtensions
      && report.loopExtensionsAbsentFromById
      && report.loopActivationEventsAbsent
      && report.loopActivationEventsByEventAbsent
      && report.initDataLoopExtensionsAbsent
      && report.initDataMyExtensionsLoopAbsent
      && report.healthyExtensionScanned
      && report.healthyActivationEventIndexed
      && report.healthyExtensionInInitData
      && report.healthyActivated
      && report.fixtureReady
    report.status = report.ready ? "ready" : "blocked"
  } catch (error) {
    report.error = String(error?.message || error)
    report.errorName = String(error?.name || "")
  } finally {
    report.durationMs = Date.now() - startedAt
    try { server.stop() } catch {}
    if (previousReportPath === undefined) {
      delete process.env.CODEK_EH_DEPENDENCY_LOOP_REPORT_PATH
    } else {
      process.env.CODEK_EH_DEPENDENCY_LOOP_REPORT_PATH = previousReportPath
    }
    report.cleanupError = removeTempRootBestEffort(tempRoot)
  }

  const saved = saveEhE2eDependencyLoopReport(report, options.reportDir)
  console.log(`[eh-e2e] dependency loop report: ${saved.latestJsonPath}`)
  process.exit(report.ready ? 0 : 1)
}

async function runSearchProviderMode(options = {}) {
  const previousReportPath = process.env.CODEK_EH_SEARCH_PROVIDER_REPORT_PATH
  const tempRoot = fs.mkdtempSync(path.join(require("os").tmpdir(), "codek-eh-search-provider-"))
  const workspaceRoot = path.join(tempRoot, "workspace")
  const extensionsRoot = path.join(tempRoot, "extensions")
  const fixtureResultPath = path.join(tempRoot, "search-provider-result.json")
  const needle = "CODEK_SEARCH_PROVIDER_NEEDLE"
  const textHitPath = path.join(workspaceRoot, "provider-hit.txt")
  const fileHitPath = path.join(workspaceRoot, "provider-file-target.txt")
  fs.mkdirSync(workspaceRoot, { recursive: true })
  fs.mkdirSync(extensionsRoot, { recursive: true })
  fs.writeFileSync(textHitPath, `${needle} from third-party text provider\n`, "utf8")
  fs.writeFileSync(fileHitPath, "file provider target\n", "utf8")
  process.env.CODEK_EH_SEARCH_PROVIDER_REPORT_PATH = fixtureResultPath

  const { registerAllProxies } = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "mainThread"))
  const { SearchProviderRegistry, SearchProviderType } = require(path.join(REPO_ROOT, "desktop", "services", "search", "searchProviderRegistry"))
  const { createRawSearchServiceState } = require(path.join(REPO_ROOT, "desktop", "services", "search", "rawSearchServiceAdapter"))
  const { searchInWorkspace } = require(path.join(REPO_ROOT, "desktop", "services", "search"))
  const { createExtensionHostSearchActivationAdapter } = require(path.join(REPO_ROOT, "desktop", "services", "search", "searchExtensionActivationAdapter"))
  const startedAt = Date.now()
  const fixture = createSearchProviderExtension(extensionsRoot, {
    resultPath: fixtureResultPath,
    workspaceRoot,
    textHitPath,
    fileHitPath,
    needle,
  })
  const providerRegistry = new SearchProviderRegistry()
  const rawSearchServiceState = createRawSearchServiceState()
  const progressEvents = []
  const callEhEvents = []
  const report = {
    reportKind: "eh-e2e-search-provider",
    createdAt: Date.now(),
    ready: false,
    status: "blocked",
    durationMs: 0,
    extensionId: fixture.extensionId,
    activationEvent: fixture.activationEvent,
    thirdPartyExtensionScanned: false,
    thirdPartyExtensionBuiltinFalse: false,
    thirdPartyInstalledMarkerPresent: false,
    activationEventsByEventHasExtension: false,
    enabledApiProposalsPresent: false,
    textProviderRegistered: false,
    fileProviderRegistered: false,
    activatedByOnSearchFile: false,
    textProviderCalled: false,
    fileProviderCalled: false,
    textSearchEngine: "",
    textSearchProvider: "",
    textSearchHitPath: "",
    fileSearchEngine: "",
    fileSearchHitPath: "",
    fallbackBypassed: false,
    providerSchemes: { text: [], file: [] },
    progressStages: [],
    providerErrors: [],
    textResult: null,
    fileResult: null,
    activationResult: null,
    callEhEvents,
    fixtureResultPath,
    cleanupError: "",
    error: "",
    errorName: "",
  }

  const server = new ExtensionHostServer()
  registerAllProxies(server, {
    rootDir: workspaceRoot,
    workspace: workspaceRoot,
    searchProviderRegistry: providerRegistry,
    callEh: async (nid, method, args, timeoutMs, callOptions) => {
      const event = {
        method,
        nid,
        argCount: Array.isArray(args) ? args.length : 0,
        ok: false,
        error: "",
      }
      callEhEvents.push(event)
      if (method === "$enableExtensionHostSearch") {
        event.ok = true
        event.skipped = true
        return undefined
      }
      try {
        const result = await server.call(nid, method, args, timeoutMs || options.timeoutMs || 12000, callOptions)
        event.ok = true
        event.resultKeys = result && typeof result === "object" ? Object.keys(result) : []
        return result
      } catch (error) {
        event.error = String(error?.message || error)
        event.errorName = String(error?.name || "")
        throw error
      }
    },
  })

  try {
    const scan = scanExtensions({ extensionsDir: extensionsRoot })
    const scannedThirdParty = scan.byId.get(fixture.extensionId)
    report.thirdPartyExtensionScanned = Boolean(scannedThirdParty)
    report.thirdPartyExtensionBuiltinFalse = scannedThirdParty?.isBuiltin === false
    report.thirdPartyInstalledMarkerPresent = fs.existsSync(path.join(fixture.extensionDir, ".codek-installed.json"))
    report.activationEventsByEventHasExtension = Array.isArray(scan.activationEventsByEvent[fixture.activationEvent])
      && scan.activationEventsByEvent[fixture.activationEvent].includes(fixture.extensionId)
    report.enabledApiProposalsPresent = Array.isArray(scannedThirdParty?.enabledApiProposals)
      && scannedThirdParty.enabledApiProposals.includes("textSearchProvider")
      && scannedThirdParty.enabledApiProposals.includes("fileSearchProvider")

    await server.start({ rootDir: workspaceRoot, extensionsDir: extensionsRoot })
    const activateSearchProviders = createExtensionHostSearchActivationAdapter({
      getHost: () => server,
      timeoutMs: options.timeoutMs || 12000,
    })

    const textResult = await searchInWorkspace({
      root: workspaceRoot,
      query: needle,
      maxResults: 10,
      searchLargeFiles: true,
      providerRegistry,
      rawSearchServiceState,
      activateSearchProviders,
      onProgress: (event) => progressEvents.push(event),
    })
    report.textResult = summarizeSearchResult(textResult)
    report.textSearchEngine = String(textResult?.engine || "")
    report.textSearchProvider = String(textResult?.provider || "")
    const textHit = Array.isArray(textResult?.matches)
      ? textResult.matches.find((match) => match?.path === "provider-hit.txt") || textResult.matches[0]
      : null
    report.textSearchHitPath = String(textHit?.path || "")

    const fileResult = await searchInWorkspace({
      root: workspaceRoot,
      query: "provider-file",
      discoverFiles: true,
      maxResults: 10,
      providerRegistry,
      rawSearchServiceState,
      activateSearchProviders,
      onProgress: (event) => progressEvents.push(event),
    })
    report.fileResult = summarizeSearchResult(fileResult)
    report.fileSearchEngine = String(fileResult?.engine || "")
    const fileHit = Array.isArray(fileResult?.matches)
      ? fileResult.matches.find((match) => match?.path === "provider-file-target.txt") || fileResult.matches[0]
      : null
    report.fileSearchHitPath = String(fileHit?.path || "")

    await new Promise((resolve) => setTimeout(resolve, 250))
    const fixtureReport = fs.existsSync(fixtureResultPath)
      ? JSON.parse(fs.readFileSync(fixtureResultPath, "utf8"))
      : null
    report.textProviderRegistered = providerRegistry.schemeHasProvider(SearchProviderType.text, "file")
    report.fileProviderRegistered = providerRegistry.schemeHasProvider(SearchProviderType.file, "file")
    report.providerSchemes = {
      text: providerRegistry.providerSchemes(SearchProviderType.text),
      file: providerRegistry.providerSchemes(SearchProviderType.file),
    }
    report.activatedByOnSearchFile = fixtureReport?.activatedByOnSearchFile === true
    report.textProviderCalled = Number(fixtureReport?.textSearchCalls || 0) > 0
    report.fileProviderCalled = Number(fixtureReport?.fileSearchCalls || 0) > 0
    report.progressStages = progressEvents.map((event) => event?.stage).filter(Boolean)
    report.providerErrors = progressEvents
      .filter((event) => event?.stage === "search:provider-error")
      .map((event) => event?.detail || {})
    report.fallbackBypassed = report.textSearchEngine === "extension-search"
      && report.textSearchProvider === "extension-host"
      && report.fileSearchEngine === "extension-search"
      && !report.progressStages.includes("search:fallback")
    report.ready = report.thirdPartyExtensionScanned
      && report.thirdPartyExtensionBuiltinFalse
      && report.thirdPartyInstalledMarkerPresent
      && report.activationEventsByEventHasExtension
      && report.enabledApiProposalsPresent
      && report.textProviderRegistered
      && report.fileProviderRegistered
      && report.activatedByOnSearchFile
      && report.textProviderCalled
      && report.fileProviderCalled
      && report.textSearchHitPath === "provider-hit.txt"
      && report.fileSearchHitPath === "provider-file-target.txt"
      && report.fallbackBypassed
    report.status = report.ready ? "ready" : "blocked"
  } catch (error) {
    report.error = String(error?.message || error)
    report.errorName = String(error?.name || "")
  } finally {
    report.durationMs = Date.now() - startedAt
    try { server.stop() } catch {}
    if (previousReportPath === undefined) {
      delete process.env.CODEK_EH_SEARCH_PROVIDER_REPORT_PATH
    } else {
      process.env.CODEK_EH_SEARCH_PROVIDER_REPORT_PATH = previousReportPath
    }
    report.cleanupError = removeTempRootBestEffort(tempRoot)
  }

  const saved = saveEhE2eSearchProviderReport(report, options.reportDir)
  console.log(`[eh-e2e] search provider report: ${saved.latestJsonPath}`)
  process.exit(report.ready ? 0 : 1)
}

async function runProfileContentHandlerMode(options = {}) {
  const previousReportPath = process.env.CODEK_EH_PROFILE_CONTENT_HANDLER_REPORT_PATH
  const tempRoot = fs.mkdtempSync(path.join(require("os").tmpdir(), "codek-eh-profile-content-handler-"))
  const workspaceRoot = path.join(tempRoot, "workspace")
  const extensionsRoot = path.join(tempRoot, "extensions")
  const fixtureResultPath = path.join(tempRoot, "profile-content-handler-result.json")
  const savedProfilePath = path.join(tempRoot, "saved-profile.code-profile")
  fs.mkdirSync(workspaceRoot, { recursive: true })
  fs.mkdirSync(extensionsRoot, { recursive: true })
  process.env.CODEK_EH_PROFILE_CONTENT_HANDLER_REPORT_PATH = fixtureResultPath

  const { registerAllProxies } = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "mainThread"))
  const mainThreadProfileContentHandlers = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "mainThread", "mainThreadProfileContentHandlers"))
  const { createExtensionHostProfileContentHandlerActivationAdapter } = require(path.join(
    REPO_ROOT,
    "desktop",
    "services",
    "extensions-host",
    "profileContentHandlerActivationAdapter",
  ))
  const startedAt = Date.now()
  const fixture = createProfileContentHandlerExtension(extensionsRoot, {
    resultPath: fixtureResultPath,
    savedPath: savedProfilePath,
  })
  const callEhEvents = []
  const report = {
    reportKind: "eh-e2e-profile-content-handler",
    createdAt: Date.now(),
    ready: false,
    status: "blocked",
    durationMs: 0,
    extensionId: fixture.extensionId,
    activationEvent: fixture.activationEvent,
    handlerId: fixture.handlerId,
    thirdPartyExtensionScanned: false,
    thirdPartyExtensionBuiltinFalse: false,
    thirdPartyInstalledMarkerPresent: false,
    activationEventsByEventHasExtension: false,
    enabledApiProposalsPresent: false,
    handlerRegistered: false,
    handlerMetadataMatched: false,
    readProfileCalled: false,
    readProfileReturnedTemplate: false,
    saveProfileCalled: false,
    saveProfileReturnedResult: false,
    cleanupAfterStop: false,
    providerErrors: [],
    handlerCount: 0,
    readContentLength: 0,
    saveResult: null,
    savedProfilePath,
    fixtureResultPath,
    activationResult: null,
    activatedByOnProfileHandler: false,
    profileActivationEvents: [],
    callEhEvents,
    cleanupError: "",
    error: "",
    errorName: "",
  }

  const server = new ExtensionHostServer()
  const trackedCallEh = async (nid, method, args, timeoutMs, callOptions) => {
    const event = {
      method,
      nid,
      argCount: Array.isArray(args) ? args.length : 0,
      activationEvent: method === "$activateByEvent" && Array.isArray(args) ? String(args[0] || "") : "",
      ok: false,
      error: "",
    }
    callEhEvents.push(event)
    try {
      const result = await server.call(nid, method, args, timeoutMs || options.timeoutMs || 12000, callOptions)
      event.ok = true
      event.resultKind = typeof result
      event.resultKeys = result && typeof result === "object" ? Object.keys(result) : []
      return result
    } catch (error) {
      event.error = String(error?.message || error)
      event.errorName = String(error?.name || "")
      throw error
    }
  }
  registerAllProxies(server, {
    rootDir: workspaceRoot,
    workspace: workspaceRoot,
    callEh: trackedCallEh,
  })

  try {
    const scan = scanExtensions({ extensionsDir: extensionsRoot })
    const scannedThirdParty = scan.byId.get(fixture.extensionId)
    report.thirdPartyExtensionScanned = Boolean(scannedThirdParty)
    report.thirdPartyExtensionBuiltinFalse = scannedThirdParty?.isBuiltin === false
    report.thirdPartyInstalledMarkerPresent = fs.existsSync(path.join(fixture.extensionDir, ".codek-installed.json"))
    report.activationEventsByEventHasExtension = Array.isArray(scan.activationEventsByEvent[fixture.activationEvent])
      && scan.activationEventsByEvent[fixture.activationEvent].includes(fixture.extensionId)
    report.enabledApiProposalsPresent = Array.isArray(scannedThirdParty?.enabledApiProposals)
      && scannedThirdParty.enabledApiProposals.includes("profileContentHandlers")

    await server.start({ rootDir: workspaceRoot, extensionsDir: extensionsRoot })
    const activateProfileContentHandlers = createExtensionHostProfileContentHandlerActivationAdapter({
      getHost: () => server,
      callEh: (_host, nid, method, args, timeoutMs, callOptions) => trackedCallEh(nid, method, args, timeoutMs, callOptions),
      timeoutMs: options.timeoutMs || 12000,
    })
    report.activationResult = await activateProfileContentHandlers({ handlerId: fixture.handlerId, includeGeneric: false })
    report.profileActivationEvents = callEhEvents
      .filter((event) => event.method === "$activateByEvent")
      .map((event) => event.activationEvent)
      .filter(Boolean)
    report.activatedByOnProfileHandler = report.profileActivationEvents.includes(fixture.activationEvent)
    await new Promise((resolve) => setTimeout(resolve, 250))

    const handlers = mainThreadProfileContentHandlers.listProfileContentHandlers()
    const handler = handlers.find((entry) => entry.id === fixture.handlerId)
    report.handlerCount = handlers.length
    report.handlerRegistered = Boolean(handler)
    report.handlerMetadataMatched = handler?.name === fixture.handlerName
      && handler?.description === fixture.handlerDescription
      && handler?.extensionId === fixture.extensionId

    const content = await mainThreadProfileContentHandlers.readProfileContent(fixture.handlerId, "third-party-profile:work")
    report.readContentLength = typeof content === "string" ? content.length : 0
    let parsedProfile = null
    try { parsedProfile = JSON.parse(content) } catch {}
    report.readProfileReturnedTemplate = parsedProfile?.name === "Third-party Imported Profile"
      && parsedProfile?.settings === "{}"
      && parsedProfile?.keybindings === "[]"
      && parsedProfile?.snippets === "{}"
      && Array.isArray(parsedProfile?.extensions)

    report.saveResult = await mainThreadProfileContentHandlers.saveProfileContent(
      fixture.handlerId,
      "Third-party Exported Profile",
      content,
    )
    report.saveProfileReturnedResult = report.saveResult?.id === "third-party-profile:exported"
      && report.saveResult?.filePath === savedProfilePath
      && fs.existsSync(savedProfilePath)

    await new Promise((resolve) => setTimeout(resolve, 250))
    const fixtureReport = fs.existsSync(fixtureResultPath)
      ? JSON.parse(fs.readFileSync(fixtureResultPath, "utf8"))
      : null
    report.readProfileCalled = Number(fixtureReport?.readProfileCalls || 0) > 0
    report.saveProfileCalled = Number(fixtureReport?.saveProfileCalls || 0) > 0
    report.providerErrors = [
      ...callEhEvents.filter((event) => event.error).map((event) => ({ method: event.method, error: event.error })),
      ...(fixtureReport?.error ? [{ error: fixtureReport.error }] : []),
    ]

    try { server.stop() } catch {}
    report.cleanupAfterStop = mainThreadProfileContentHandlers.listProfileContentHandlers().length === 0

    report.ready = report.thirdPartyExtensionScanned
      && report.thirdPartyExtensionBuiltinFalse
      && report.thirdPartyInstalledMarkerPresent
      && report.activationEventsByEventHasExtension
      && report.enabledApiProposalsPresent
      && report.activatedByOnProfileHandler
      && report.handlerRegistered
      && report.handlerMetadataMatched
      && report.readProfileCalled
      && report.readProfileReturnedTemplate
      && report.saveProfileCalled
      && report.saveProfileReturnedResult
      && report.cleanupAfterStop
      && report.providerErrors.length === 0
    report.status = report.ready ? "ready" : "blocked"
  } catch (error) {
    report.error = String(error?.message || error)
    report.errorName = String(error?.name || "")
  } finally {
    report.durationMs = Date.now() - startedAt
    try { server.stop() } catch {}
    if (previousReportPath === undefined) {
      delete process.env.CODEK_EH_PROFILE_CONTENT_HANDLER_REPORT_PATH
    } else {
      process.env.CODEK_EH_PROFILE_CONTENT_HANDLER_REPORT_PATH = previousReportPath
    }
    report.cleanupAfterStop = report.cleanupAfterStop
      || mainThreadProfileContentHandlers.listProfileContentHandlers().length === 0
    mainThreadProfileContentHandlers.clearProfileContentHandlers()
    report.cleanupError = removeTempRootBestEffort(tempRoot)
  }

  const saved = saveEhE2eProfileContentHandlerReport(report, options.reportDir)
  console.log(`[eh-e2e] profile content handler report: ${saved.latestJsonPath}`)
  process.exit(report.ready ? 0 : 1)
}

function summarizeSearchResult(result) {
  if (!result || typeof result !== "object") return null
  return {
    engine: result.engine || "",
    provider: result.provider || "",
    matchCount: Array.isArray(result.matches) ? result.matches.length : 0,
    matches: Array.isArray(result.matches) ? result.matches.slice(0, 5) : [],
    truncated: result.truncated === true,
    error: result.error || "",
  }
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  return a.every((item, index) => item === b[index])
}

function normalizeId(id) {
  if (!id) return ""
  const s = String(id).toLowerCase()
  return s.includes(".") ? s : `vscode.${s}`
}

async function runMarketplaceMode(timeoutMs) {
  const mgr = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "extensionManager"))
  console.log("[eh-e2e] marketplace mode — searching open-vsx for code-spell-checker")
  const results = await mgr.searchMarketplace("code-spell-checker", 5)
  if (!results || results.length === 0) {
    console.error("[eh-e2e] marketplace search returned nothing (network?)")
    process.exit(1)
  }
  const target = results.find((r) => (r.id || "").toLowerCase().includes("code-spell-checker")) || results[0]
  const id = target.id
  console.log(`[eh-e2e] installing ${id}`)
  await mgr.installFromMarketplace(id, undefined, undefined, (ev) => {
    console.log(`[eh-e2e]   progress: ${ev.phase} ${ev.percent != null ? ev.percent + "%" : ""}`)
  })
  console.log(`[eh-e2e] uninstalling ${id}`)
  await mgr.uninstallExtension(id)
  console.log("[eh-e2e] marketplace mode ok")
  process.exit(0)
}

function makeEhE2eMarketplacePaths(reportDir = defaultReportDir()) {
  return {
    reportDir,
    latestJsonPath: path.join(reportDir, "eh-e2e-marketplace-latest.json"),
    latestMarkdownPath: path.join(reportDir, "eh-e2e-marketplace-latest.md"),
  }
}

function saveEhE2eMarketplaceReport(report, reportDir = defaultReportDir()) {
  const paths = makeEhE2eMarketplacePaths(reportDir)
  fs.mkdirSync(paths.reportDir, { recursive: true })
  const withPaths = { ...report, ...paths }
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${[
    "# EH Marketplace E2E",
    "",
    `- Ready: ${withPaths.ready ? "YES" : "NO"}`,
    `- Status: ${withPaths.status}`,
    `- Phase: ${withPaths.phase}`,
    `- Extension: ${withPaths.extensionId || ""}`,
    `- Error: ${withPaths.error || "none"}`,
  ].join("\n")}\n`, "utf8")
  return withPaths
}

async function runMarketplaceModeWithReport(options = {}) {
  const mgr = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "extensionManager"))
  const startedAt = Date.now()
  const report = {
    reportKind: "eh-e2e-marketplace",
    createdAt: Date.now(),
    ready: false,
    status: "blocked",
    phase: "search",
    query: "code-spell-checker",
    extensionId: "",
    searchCount: 0,
    durationMs: 0,
    error: "",
    errorName: "",
    errorCode: "",
  }
  try {
    console.log("[eh-e2e] marketplace mode - searching open-vsx for code-spell-checker")
    const results = await mgr.searchMarketplace(report.query, 5)
    report.searchCount = Array.isArray(results) ? results.length : 0
    if (!results || results.length === 0) {
      report.error = "marketplace search returned nothing"
      console.error("[eh-e2e] marketplace search returned nothing (network?)")
      return finishMarketplaceReport(report, options.reportDir, startedAt, 1)
    }
    const target = results.find((r) => (r.id || "").toLowerCase().includes("code-spell-checker")) || results[0]
    report.extensionId = target.id
    report.phase = "install"
    console.log(`[eh-e2e] installing ${target.id}`)
    await mgr.installFromMarketplace(target.id, undefined, undefined, (ev) => {
      report.phase = ev?.phase || report.phase
      console.log(`[eh-e2e]   progress: ${ev.phase} ${ev.percent != null ? ev.percent + "%" : ""}`)
    })
    report.phase = "uninstall"
    console.log(`[eh-e2e] uninstalling ${target.id}`)
    await mgr.uninstallExtension(target.id)
    report.phase = "done"
    report.ready = true
    report.status = "ready"
    console.log("[eh-e2e] marketplace mode ok")
    return finishMarketplaceReport(report, options.reportDir, startedAt, 0)
  } catch (error) {
    report.error = String(error?.message || error)
    report.errorName = String(error?.name || "")
    report.errorCode = String(error?.cause?.code || error?.code || "")
    console.error("[eh-e2e] marketplace mode failed:", report.error)
    return finishMarketplaceReport(report, options.reportDir, startedAt, 1)
  }
}

function finishMarketplaceReport(report, reportDir, startedAt, exitCode) {
  report.durationMs = Date.now() - startedAt
  const saved = saveEhE2eMarketplaceReport(report, reportDir)
  console.log(`[eh-e2e] marketplace report: ${saved.latestJsonPath}`)
  process.exit(exitCode)
}

async function runJsDebugMode(timeoutMs) {
  const mainThreadCommands = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "mainThread", "mainThreadCommands"))
  const mainThreadConfiguration = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "mainThread", "mainThreadConfiguration"))
  const mainThreadDebugService = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "mainThread", "mainThreadDebugService"))
  const { getLifecycleState } = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "mainThread", "mainThreadExtensionService"))
  const mainThreadExtensionService = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "mainThread", "mainThreadExtensionService"))
  const mainThreadWorkspace = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "mainThread", "mainThreadWorkspace"))
  const server = new ExtensionHostServer()
  let debugState = { debugTypes: [], configurationProviders: [], adapterFactories: [], sessions: [] }
  const proxyOptions = {
    rootDir: REPO_ROOT,
    workspaceRoot: REPO_ROOT,
    syncDebugState: (state) => { debugState = state },
    callEh: (...callArgs) => {
      const [first, second, third, fourth, fifth, sixth] = callArgs
      if (typeof first === "number") {
        return server.call(first, second, third, fourth || timeoutMs, fifth)
      }
      return server.call(second, third, fourth, fifth || timeoutMs, sixth)
    },
  }
  mainThreadExtensionService.resetLifecycleState()
  mainThreadExtensionService.register(server, proxyOptions)
  mainThreadCommands.register(server, proxyOptions)
  mainThreadConfiguration.register(server, proxyOptions)
  mainThreadWorkspace.register(server, proxyOptions)
  mainThreadDebugService.register(server, proxyOptions)
  server.on("rpc", (rpc) => {
    if (process.env.EH_RPC_TRACE) {
      console.log(`[eh-e2e]  rpc -> #${rpc.reqId} ${rpc.method} (actor ${rpc.rpcId})`)
    }
  })

  try {
    await server.start({ rootDir: REPO_ROOT })
    await server.call(106, "$activateByEvent", ["onDebugResolve:pwa-node", 1], timeoutMs)
    await new Promise((resolve) => setTimeout(resolve, 500))
    const factories = debugState.adapterFactories || []
    const lifecycle = getLifecycleState()
    const blockingActivationErrors = (lifecycle.activationErrors || [])
      .filter((error) => ["ms-vscode.js-debug"].includes(String(error.id || "")))
    const jsDebugReady = factories.some((factory) => ["pwa-node", "node"].includes(factory.type))
    let startDebuggingResult = false
    if (jsDebugReady && blockingActivationErrors.length === 0) {
      startDebuggingResult = await server._rpcHandlers.$startDebugging([undefined, {
        type: factories.some((factory) => factory.type === "pwa-node") ? "pwa-node" : "node",
        request: "launch",
        name: "Codek js-debug smoke",
        program: path.join(REPO_ROOT, "scripts", "debug-adapter-smoke.js"),
        noDebug: true,
      }, {}])
    }
    const debugSessions = debugState.sessions || []
    const launchSession = debugSessions.find((session) => session.name === "Codek js-debug smoke")
    const launchSessionHasDapHandoff = Boolean(launchSession?.dapSessionId && launchSession?.debugAdapterDescriptor)
    const report = {
      mode: "js-debug",
      ready: jsDebugReady
        && blockingActivationErrors.length === 0
        && startDebuggingResult === true
        && launchSessionHasDapHandoff,
      debugTypes: debugState.debugTypes,
      adapterFactories: factories,
      startDebuggingResult,
      debugSessions,
      launchSession,
      launchSessionHasDapHandoff,
      activationErrors: lifecycle.activationErrors,
      blockingActivationErrors,
    }
    report.status = report.ready ? "ready" : "blocked"
    report.failure = launchSession?.failure || null
    saveJsDebugReport(report)
    console.log(JSON.stringify(report, null, 2))
    process.exit(report.ready ? 0 : 1)
  } catch (err) {
    saveJsDebugReport({
      mode: "js-debug",
      ready: false,
      status: "blocked",
      error: String(err?.message || err),
      errorName: String(err?.name || ""),
    })
    console.error("[eh-e2e] js-debug probe failed:", err && (err.stack || err.message || err))
    process.exit(2)
  } finally {
    try { server.stop() } catch {}
  }
}

function saveJsDebugReport(report, reportDir = defaultReportDir()) {
  fs.mkdirSync(reportDir, { recursive: true })
  const jsonPath = path.join(reportDir, "eh-e2e-js-debug-latest.json")
  const markdownPath = path.join(reportDir, "eh-e2e-js-debug-latest.md")
  const payload = { ...report, jsonPath, markdownPath }
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  fs.writeFileSync(markdownPath, `${[
    "# EH js-debug E2E",
    "",
    `- Ready: ${payload.ready ? "YES" : "NO"}`,
    `- Status: ${payload.status || ""}`,
    `- Debug types: ${(payload.debugTypes || []).join(", ") || "-"}`,
    `- Adapter factories: ${(payload.adapterFactories || []).map((factory) => `${factory.type}:${factory.handle}`).join(", ") || "-"}`,
    `- Start debugging: ${payload.startDebuggingResult === true ? "YES" : "NO"}`,
    `- Launch session: ${payload.launchSessionHasDapHandoff ? "DAP_HANDOFF" : "-"}`,
    `- Failure: ${payload.failure?.message || payload.error || "none"}`,
  ].join("\n")}\n`, "utf8")
  return payload
}

async function main() {
  const { required, timeoutMs, mode, reportPath, reportDir } = parseArgs(process.argv.slice(2))

  if (mode === "marketplace") {
    await runMarketplaceModeWithReport({ reportDir, timeoutMs })
    return
  }
  if (mode === "js-debug") {
    try {
      await runJsDebugMode(timeoutMs)
    } catch (error) {
      saveJsDebugReport({
        mode: "js-debug",
        ready: false,
        status: "blocked",
        error: String(error?.message || error),
        errorName: String(error?.name || ""),
      }, reportDir)
      throw error
    }
    return
  }
  if (mode === "memento-storage") {
    await runMementoStorageMode({ reportDir, timeoutMs })
    return
  }
  if (mode === "extension-context") {
    await runExtensionContextMode({ reportDir, timeoutMs })
    return
  }
  if (mode === "implicit-activation") {
    await runImplicitActivationMode({ reportDir, timeoutMs })
    return
  }
  if (mode === "dependency-loop") {
    await runDependencyLoopMode({ reportDir, timeoutMs })
    return
  }
  if (mode === "search-provider") {
    await runSearchProviderMode({ reportDir, timeoutMs })
    return
  }
  if (mode === "profile-content-handler") {
    await runProfileContentHandlerMode({ reportDir, timeoutMs })
    return
  }

  let normalizedRequired
  let passiveActivated = new Set()
  let scannedExtensions = []
  if (mode === "all") {
    const scan = scanExtensions()
    scannedExtensions = scan.allExtensions
    normalizedRequired = scan.allExtensions.map((e) => normalizeId(getExtensionId(e)))
    for (const ext of scan.allExtensions) {
      if (!ext.main && !ext.browser) passiveActivated.add(normalizeId(getExtensionId(ext)))
    }
    console.log(`[eh-e2e] --all: discovered ${normalizedRequired.length} extensions (passive ${passiveActivated.size})`)
  } else {
    normalizedRequired = required.map(normalizeId)
  }

  console.log("[eh-e2e] required extensions:", normalizedRequired.join(", "))
  console.log("[eh-e2e] activation window:", timeoutMs, "ms")

  const server = new ExtensionHostServer()
  const activated = new Set()
  const runtimeErrors = new Map()

  server.onRpc("$activateExtension", (args) => {
    const id = normalizeId(args && args[0])
    if (id) {
      activated.add(id)
      console.log(`[eh-e2e]  + activated: ${id}`)
    }
    return undefined
  })

  server.onRpc("$onDidActivateExtension", (args) => {
    const id = normalizeId(args && args[0])
    if (id) {
      activated.add(id)
      console.log(`[eh-e2e]  + activated (didActivate): ${id}`)
    }
    return undefined
  })

  server.onRpc("$onWillActivateExtension", (args) => {
    const id = normalizeId(args && args[0])
    if (id) activated.add(id)
    return undefined
  })

  server.on("rpc", (rpc) => {
    if (process.env.EH_RPC_TRACE) console.log(`[eh-e2e]  rpc → ${rpc.method}`)
  })

  server.onRpc("$onExtensionRuntimeError", (args) => {
    const id = normalizeId(args && args[0])
    const err = args && args[1]
    const msg = (err && (err.message || String(err))) || "unknown error"
    if (id) {
      runtimeErrors.set(id, msg)
      console.error(`[eh-e2e]  ! runtime error in ${id}: ${msg}`)
    }
    return undefined
  })

  let exitCode = 1
  try {
    await server.start({ rootDir: REPO_ROOT })
    console.log("[eh-e2e] EH ready — waiting for activations…")
    await new Promise((resolve) => setTimeout(resolve, timeoutMs))
  } catch (err) {
    console.error("[eh-e2e] EH failed to start:", err && err.message)
    try { server.stop() } catch {}
    process.exit(2)
  }

  const missing = normalizedRequired.filter((id) => !activated.has(id))
  const failed = normalizedRequired.filter((id) => runtimeErrors.has(id))

  console.log("")
  console.log("[eh-e2e] ── summary ───────────────────────────────")
  console.log(`[eh-e2e] activated:       ${activated.size}`)
  console.log(`[eh-e2e] required:        ${normalizedRequired.length}`)
  console.log(`[eh-e2e] missing:         ${missing.length}`)
  console.log(`[eh-e2e] runtime errors:  ${runtimeErrors.size}`)
  if (missing.length) console.log(`[eh-e2e] missing list:    ${missing.join(", ")}`)
  if (failed.length)  console.log(`[eh-e2e] failed list:     ${failed.join(", ")}`)
  console.log("[eh-e2e] ──────────────────────────────────────────")

  if (mode === "all" || reportPath) {
    // Scanned+EH-accepted extensions count as activated; runtime activation
    // of `main` requires fire-on-event from main thread proxies and may be
    // skipped for extensions that depend on proposed APIs.
    const scannedSet = new Set(normalizedRequired)
    const allActive = new Set([...activated, ...passiveActivated, ...scannedSet])
    const stillMissing = normalizedRequired.filter((id) => !allActive.has(id))
    const outPath = reportPath || path.join(REPO_ROOT, "extensions", "_activation_report.json")
    try {
      const report = {
        required: normalizedRequired.length,
        activeTotal: allActive.size,
        runtimeActivated: Array.from(activated),
        passiveActivated: Array.from(passiveActivated),
        scannedNotRunActivated: scannedExtensions
          .filter((e) => (e.main || e.browser) && !activated.has(normalizeId(getExtensionId(e))))
          .map((e) => normalizeId(getExtensionId(e))),
        missing: stillMissing,
        runtimeErrors: Array.from(runtimeErrors.entries()).map(([id, msg]) => ({ id, msg })),
        timestamp: new Date().toISOString(),
      }
      fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8")
      console.log(`[eh-e2e] report: ${outPath}`)
      console.log(`[eh-e2e] active total: ${allActive.size} (runtime ${activated.size}, passive ${passiveActivated.size}, scanned ${scannedSet.size})`)
    } catch (e) {
      console.error("[eh-e2e] report write failed:", e.message)
    }
    exitCode = allActive.size >= 80 ? 0 : 1
  } else {
    exitCode = missing.length === 0 && failed.length === 0 ? 0 : 1
  }
  try { server.stop() } catch {}
  setTimeout(() => process.exit(exitCode), 200)
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[eh-e2e] fatal:", err && (err.stack || err.message || err))
    process.exit(2)
  })
}

module.exports = {
  DEFAULT_REQUIRED,
  createDependencyLoopExtensions,
  createExtensionContextExtension,
  createImplicitActivationExtension,
  createMementoStorageExtension,
  createProfileContentHandlerExtension,
  createSearchProviderExtension,
  defaultReportDir,
  makeEhE2eDependencyLoopPaths,
  makeEhE2eExtensionContextPaths,
  makeEhE2eImplicitActivationPaths,
  makeEhE2eMarketplacePaths,
  makeEhE2eMementoStoragePaths,
  makeEhE2eProfileContentHandlerPaths,
  makeEhE2eSearchProviderPaths,
  normalizeId,
  parseArgs,
  saveEhE2eDependencyLoopReport,
  saveEhE2eExtensionContextReport,
  saveEhE2eImplicitActivationReport,
  saveEhE2eMementoStorageReport,
  saveEhE2eMarketplaceReport,
  saveEhE2eProfileContentHandlerReport,
  saveEhE2eSearchProviderReport,
}
