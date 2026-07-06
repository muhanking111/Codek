const { evaluatePublisherPolicy } = require("./extensionPublisherPolicy")

function normalizeExtensionId(namespaceOrId, name) {
  const namespace = String(namespaceOrId || "").trim()
  const extName = String(name || "").trim()
  if (!namespace) return ""
  if (extName) return `${namespace}.${extName}`
  return namespace.includes(".") ? namespace : ""
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String)
  if (typeof value === "string") {
    return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function readManifestInstallMetadata(manifest = {}) {
  const publisher = manifest.publisher || manifest.namespace || ""
  const name = manifest.name || ""
  const id = manifest.id || (publisher && name ? `${publisher}.${name}` : name || "")
  const extensionDependencies = asStringArray(manifest.extensionDependencies || manifest.dependencies)
  const extensionPack = asStringArray(manifest.extensionPack)
  const extensionKind = asStringArray(manifest.extensionKind)
  const enabledApiProposals = asStringArray(manifest.enabledApiProposals)
  const executesCode = Boolean(manifest.main || manifest.browser || manifest.scripts?.postinstall)
  return {
    id,
    name,
    publisher,
    version: manifest.version || "",
    displayName: manifest.displayName || name || id,
    description: manifest.description || "",
    extensionDependencies,
    extensionPack,
    extensionKind,
    engines: manifest.engines || {},
    enabledApiProposals,
    main: manifest.main || "",
    browser: manifest.browser || "",
    executesCode,
  }
}

function buildInstalledSet(installedExtensions = []) {
  const installed = new Set()
  for (const extension of installedExtensions) {
    const id = normalizeExtensionId(extension.id || "", "")
      || normalizeExtensionId(extension.publisher || extension.namespace || "", extension.name || "")
    if (id) installed.add(id.toLowerCase())
  }
  return installed
}

function operation(kind, id, installed, extra = {}) {
  return {
    kind,
    id,
    status: installed.has(String(id || "").toLowerCase()) ? "already-installed" : "pending",
    ...extra,
  }
}

function buildInstallPlan(input = {}) {
  const target = readManifestInstallMetadata(input.target || input.manifest || {})
  const id = target.id || normalizeExtensionId(input.namespace || "", input.name || "")
  const installed = buildInstalledSet(input.installedExtensions || [])
  const dependencies = target.extensionDependencies
  const pack = target.extensionPack
  const operations = [
    ...dependencies.map((dep) => operation("dependency", dep, installed)),
    ...pack.map((dep) => operation("extension-pack", dep, installed)),
    operation("target", id, installed, { version: target.version }),
  ]
  const missingDependencies = dependencies.filter((dep) => !installed.has(dep.toLowerCase()))
  const missingExtensionPack = pack.filter((dep) => !installed.has(dep.toLowerCase()))
  const warnings = []

  if (!target.version || (!target.publisher && !target.name)) {
    warnings.push({
      id: "metadata_incomplete",
      severity: "warning",
      message: "Marketplace metadata is incomplete; install can proceed but dependency and engine evidence may be partial.",
    })
  }
  if (target.enabledApiProposals.length > 0) {
    warnings.push({
      id: "enabled_api_proposals",
      severity: "warning",
      message: "Extension requests proposed VS Code APIs; Codek may run it in degraded mode.",
      values: target.enabledApiProposals,
    })
  }
  if (target.engines?.vscode) {
    warnings.push({
      id: "vscode_engine",
      severity: "info",
      message: `Extension declares VS Code engine ${target.engines.vscode}.`,
      value: target.engines.vscode,
    })
  }
  const publisherPolicy = evaluatePublisherPolicy({ ...target, id })
  if (publisherPolicy.blocked) {
    warnings.push({
      id: publisherPolicy.reason,
      severity: "blocker",
      message: publisherPolicy.reason === "publisher_denied"
        ? `Publisher ${publisherPolicy.publisher} is denied by enterprise policy.`
        : `Publisher ${publisherPolicy.publisher || "unknown"} is not in the enterprise allow list.`,
      value: publisherPolicy.publisher,
    })
  }

  return {
    reportKind: "extension-install-plan",
    createdAt: Date.now(),
    id,
    target: { ...target, id },
    readyToInstall: !publisherPolicy.blocked,
    requiresConfirmation: missingDependencies.length > 0 || missingExtensionPack.length > 0 || warnings.some((warning) => warning.severity === "warning"),
    publisherPolicy,
    dependencies,
    extensionPack: pack,
    missingDependencies,
    missingExtensionPack,
    operations,
    warnings,
  }
}

module.exports = {
  buildInstallPlan,
  normalizeExtensionId,
  readManifestInstallMetadata,
}
