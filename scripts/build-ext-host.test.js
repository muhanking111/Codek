const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  collectExternalModuleManifest,
  createBundleBanner,
  DETERMINISTIC_BUILD_TIMESTAMP,
  packageNameForSpecifier,
  readVendoredPackageNames,
  validateSelfContainedVscodeSource,
} = require("./build-ext-host")

function fixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codek-build-ext-host-"))
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, "utf8")
  return filePath
}

test("accepts a self-contained vendored extension host entrypoint without vendor node_modules", () => {
  const root = fixtureRoot()
  const vscodeRoot = path.join(root, "vendor", "vscode")
  const entry = writeFile(
    vscodeRoot,
    "src/vs/workbench/api/node/extensionHostProcess.ts",
    "export const codekExtensionHostEntrypoint = true\n",
  )

  const report = validateSelfContainedVscodeSource({ repoRoot: root, vscodeRoot, entry })

  assert.equal(report.ok, true)
  assert.deepEqual(readVendoredPackageNames(path.join(vscodeRoot, "node_modules")), new Set())
})

test("rejects extension host source roots outside the repository", () => {
  const root = fixtureRoot()
  const externalRoot = fixtureRoot()
  const entry = writeFile(
    externalRoot,
    "src/vs/workbench/api/node/extensionHostProcess.ts",
    "export const externalEntrypoint = true\n",
  )

  const report = validateSelfContainedVscodeSource({
    repoRoot: root,
    vscodeRoot: externalRoot,
    entry,
  })

  assert.equal(report.ok, false)
  assert.match(report.errors.join("\n"), /must stay inside this repository/)
})

test("rejects missing vendored extension host entrypoint", () => {
  const root = fixtureRoot()
  const vscodeRoot = path.join(root, "vendor", "vscode")

  const report = validateSelfContainedVscodeSource({
    repoRoot: root,
    vscodeRoot,
    entry: path.join(vscodeRoot, "src/vs/workbench/api/node/extensionHostProcess.ts"),
  })

  assert.equal(report.ok, false)
  assert.match(report.errors.join("\n"), /entrypoint must be vendored/)
})

test("extracts bare package names from esbuild external specifiers", () => {
  assert.equal(packageNameForSpecifier("minimist"), "minimist")
  assert.equal(packageNameForSpecifier("@vscode/proxy-agent"), "@vscode/proxy-agent")
  assert.equal(packageNameForSpecifier("@vscode/proxy-agent/node"), "@vscode/proxy-agent")
  assert.equal(packageNameForSpecifier("node:fs"), "")
  assert.equal(packageNameForSpecifier("path"), "")
  assert.equal(packageNameForSpecifier("./local"), "")
})

test("builds an external module manifest from esbuild metafile output", () => {
  const root = fixtureRoot()
  writeFile(root, "node_modules/minimist/package.json", "{}\n")
  const manifest = collectExternalModuleManifest({
    outputs: {
      "out.js": {
        imports: [
          { path: "node:fs", external: true },
          { path: "minimist", external: true },
          { path: "@vscode/proxy-agent/node", external: true },
          { path: "./local.js", external: false },
        ],
      },
    },
  }, {
    nodeModulesDir: path.join(root, "node_modules"),
  })

  assert.equal(manifest.summary.nodeBuiltins, 1)
  assert.equal(manifest.summary.packages, 2)
  assert.deepEqual(manifest.packages.map((entry) => entry.package), [
    "@vscode/proxy-agent",
    "minimist",
  ])
  assert.equal(manifest.packages.find((entry) => entry.package === "minimist").presentInBundleNodeModules, true)
  assert.equal(manifest.packages.find((entry) => entry.package === "@vscode/proxy-agent").presentInBundleNodeModules, false)
})

test("uses a deterministic timestamp in generated extension host metadata", () => {
  const firstManifest = collectExternalModuleManifest({ outputs: {} })
  const secondManifest = collectExternalModuleManifest({ outputs: {} })

  assert.equal(firstManifest.generatedAt, DETERMINISTIC_BUILD_TIMESTAMP)
  assert.equal(secondManifest.generatedAt, DETERMINISTIC_BUILD_TIMESTAMP)
  assert.deepEqual(secondManifest, firstManifest)

  const firstBanner = createBundleBanner()
  const secondBanner = createBundleBanner()
  assert.match(firstBanner, new RegExp(`Build date: ${DETERMINISTIC_BUILD_TIMESTAMP}`))
  assert.equal(secondBanner, firstBanner)
})
