/**
 * Build Extension Host Bundle
 *
 * Bundles extensionHostProcess.ts + dependencies into a standalone Node.js file.
 *
 * Usage: node scripts/build-ext-host.js
 */

const esbuild = require("../frontend/vite-project/node_modules/esbuild")
const path = require("path")
const fs = require("fs")
const { builtinModules } = require("module")

const REPO_ROOT = path.resolve(__dirname, "..")
const DEFAULT_VSCODE_ROOT = path.resolve(__dirname, "..", "vendor", "vscode")
const VSCODE_ROOT = path.resolve(process.env.CODEK_VSCODE_SOURCE_ROOT || DEFAULT_VSCODE_ROOT)
const VSCODE_SRC = path.join(VSCODE_ROOT, "src")
const VSCODE_NODE_MODULES = path.join(VSCODE_ROOT, "node_modules")
const VSCODE_EXTENSIONS = path.join(VSCODE_ROOT, "extensions")
const OUT_DIR = path.resolve(__dirname, "..", "desktop", "services", "extensions-host", "bundle")
const STUBS_DIR = path.join(OUT_DIR, "stubs")

const ENTRY = path.join(VSCODE_SRC, "vs", "workbench", "api", "node", "extensionHostProcess.ts")
const GENERATED_BUNDLE_FILES = [
  path.join(OUT_DIR, "extHost.bundle.mjs"),
  path.join(OUT_DIR, "extHost.bundle.mjs.map"),
]
const EXTERNAL_MODULE_MANIFEST = path.join(OUT_DIR, "external-modules.json")
const EXTERNAL_SOURCE_ROOT_NAME = "SourceMirror"
const VSCODE_DIR_NAME = "vscode"
const DETERMINISTIC_BUILD_TIMESTAMP = "1970-01-01T00:00:00.000Z"
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => name.replace(/^node:/, "")),
])

function validateSelfContainedVscodeSource({
  repoRoot = REPO_ROOT,
  vscodeRoot = VSCODE_ROOT,
  entry = ENTRY,
} = {}) {
  const errors = []
  const relativeToRepo = path.relative(repoRoot, vscodeRoot)
  if (!relativeToRepo || relativeToRepo.startsWith("..") || path.isAbsolute(relativeToRepo)) {
    errors.push("[build-ext-host] VS Code source root must stay inside this repository for self-contained packaging.")
    errors.push(`[build-ext-host] Received root: ${vscodeRoot}`)
  }
  if (!fs.existsSync(entry)) {
    errors.push("[build-ext-host] VS Code extension host entrypoint must be vendored inside this repository before building.")
    errors.push(`[build-ext-host] Expected entry: ${entry}`)
    errors.push("[build-ext-host] Refresh vendor/vscode with scripts/vscode-dependency-closure-importer.js --refresh-vendor before building.")
  }
  return { ok: errors.length === 0, errors }
}

function assertSelfContainedVscodeSource(options = {}) {
  const report = validateSelfContainedVscodeSource(options)
  if (report.ok) return report

  for (const error of report.errors) console.error(error)
  if (options.exit === false) {
    const err = new Error(report.errors.join("\n"))
    err.report = report
    throw err
  }
  process.exit(1)
}

function readVendoredPackageNames(nodeModulesDir = VSCODE_NODE_MODULES) {
  if (!fs.existsSync(nodeModulesDir)) {
    return new Set()
  }
  return new Set(
    fs.readdirSync(nodeModulesDir)
      .filter(d => d.startsWith("vscode-") || d.startsWith("@vscode"))
  )
}

function isRelativeOrAbsoluteImport(specifier) {
  return specifier.startsWith(".") || path.isAbsolute(specifier)
}

function packageNameForSpecifier(specifier) {
  const normalized = String(specifier || "").replace(/^node:/, "")
  if (!normalized || isRelativeOrAbsoluteImport(normalized)) return ""
  if (NODE_BUILTINS.has(normalized)) return ""
  if (normalized.startsWith("@")) {
    const [scope, name] = normalized.split("/")
    return scope && name ? `${scope}/${name}` : normalized
  }
  return normalized.split("/")[0]
}

function collectExternalModuleManifest(metafile, {
  nodeModulesDir = path.join(OUT_DIR, "node_modules"),
} = {}) {
  const externalSpecifiers = new Set()

  for (const output of Object.values(metafile?.outputs || {})) {
    for (const item of output.imports || []) {
      if (item.external) externalSpecifiers.add(item.path)
    }
  }

  const nodeBuiltins = []
  const packages = new Map()
  for (const specifier of Array.from(externalSpecifiers).sort()) {
    const normalized = String(specifier || "").replace(/^node:/, "")
    if (NODE_BUILTINS.has(normalized)) {
      nodeBuiltins.push(specifier)
      continue
    }
    const packageName = packageNameForSpecifier(specifier)
    if (!packageName) continue
    if (!packages.has(packageName)) {
      const packageRoot = path.join(nodeModulesDir, packageName)
      packages.set(packageName, {
        package: packageName,
        specifiers: [],
        presentInBundleNodeModules: fs.existsSync(packageRoot),
      })
    }
    packages.get(packageName).specifiers.push(specifier)
  }

  return {
    reportKind: "codek-extension-host-external-modules",
    generatedAt: DETERMINISTIC_BUILD_TIMESTAMP,
    policy: "VS Code src/vs files are bundled; Node builtins and bare package imports are externalized and resolved from the extension-host bundle node_modules at runtime.",
    nodeBuiltins,
    packages: Array.from(packages.values()),
    summary: {
      externalSpecifiers: externalSpecifiers.size,
      nodeBuiltins: nodeBuiltins.length,
      packages: packages.size,
      packagesPresentInBundleNodeModules: Array.from(packages.values()).filter((entry) => entry.presentInBundleNodeModules).length,
    },
  }
}

function createBundleBanner() {
  return `// Codek Extension Host Bundle
// Built from: vs/workbench/api/node/extensionHostProcess.ts
// Build date: ${DETERMINISTIC_BUILD_TIMESTAMP}

globalThis.__VSCODE_EXTENSION_HOST = true;
globalThis._VSCODE_FILE_ROOT = undefined;
`
}

function writeExternalModuleManifest(metafile) {
  const manifest = collectExternalModuleManifest(metafile)
  fs.writeFileSync(EXTERNAL_MODULE_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  return manifest
}

function toSourceMapPath(value) {
  return String(value || "").replace(/\\/g, "/")
}

function packagedVscodeSourcePrefix() {
  const relative = toSourceMapPath(path.relative(OUT_DIR, VSCODE_ROOT))
  return relative && relative !== "." ? relative : "."
}

function hasForbiddenExternalSourcePath(value) {
  const text = String(value || "")
  const drivePattern = new RegExp(`D:\\s*[\\\\/]+\\s*${EXTERNAL_SOURCE_ROOT_NAME}(?:\\s*[\\\\/]+\\s*${VSCODE_DIR_NAME})?`, "i")
  const relativePattern = new RegExp(`${EXTERNAL_SOURCE_ROOT_NAME}\\s*[\\\\/]+\\s*${VSCODE_DIR_NAME}`, "i")
  return drivePattern.test(text) || relativePattern.test(text)
}

function sanitizeGeneratedSourcePaths() {
  const packagedPrefix = packagedVscodeSourcePrefix()
  let replacements = 0

  for (const filePath of GENERATED_BUNDLE_FILES) {
    if (!fs.existsSync(filePath)) continue

    const before = fs.readFileSync(filePath, "utf8")
    const slashPattern = new RegExp(`(?:\\.\\./)+${EXTERNAL_SOURCE_ROOT_NAME}/${VSCODE_DIR_NAME}(?=/src/)`, "gi")
    const backslashPattern = new RegExp(`(?:\\.\\.\\\\)+${EXTERNAL_SOURCE_ROOT_NAME}\\\\${VSCODE_DIR_NAME}(?=\\\\src\\\\)`, "gi")
    const after = before
      .replace(slashPattern, () => {
        replacements += 1
        return packagedPrefix
      })
      .replace(backslashPattern, () => {
        replacements += 1
        return packagedPrefix.replace(/\//g, "\\")
      })

    if (hasForbiddenExternalSourcePath(after)) {
      throw new Error(`generated extension-host bundle still references external VS Code source: ${filePath}`)
    }

    if (after !== before) {
      fs.writeFileSync(filePath, after, "utf8")
    }
  }

  return replacements
}

async function main() {
  assertSelfContainedVscodeSource()

  // VS Code packages are optional here: bare package imports are externalized
  // and resolved from the extension-host bundle directory at runtime.
  const VSCODE_PACKAGES = readVendoredPackageNames()
  console.log("[build-ext-host] Entry:", ENTRY)
  console.log("[build-ext-host] VS Code packages:", VSCODE_PACKAGES.size)

  // Ensure stubs directory exists
  fs.mkdirSync(STUBS_DIR, { recursive: true })

  try {
    const result = await esbuild.build({
      entryPoints: [ENTRY],
      outfile: path.join(OUT_DIR, "extHost.bundle.mjs"),
      bundle: true,
      platform: "node",
      target: "node18",
      format: "esm",
      banner: {
        js: createBundleBanner(),
      },
      define: {
        "globalThis.__VSCODE_PID__": "process.pid",
        "globalThis.__VSCODE_NODE_VERSION__": `"${process.versions.node}"`,
        "globalThis._VSCODE_FILE_ROOT": "undefined",
        "AMD_LOADER": "undefined",
      },

      external: [
        "child_process", "fs", "path", "os", "net", "events", "util",
        "stream", "assert", "buffer", "crypto", "module", "process",
        "cluster", "perf_hooks", "async_hooks", "v8", "worker_threads",
        "diagnostics_channel",
        "vscode-jsonrpc", "vscode-oniguruma", "vscode-regexpp", "vscode-textmate", "vscode-uri", "@vscode/iconv-lite-umd",
        "@vscode/spdlog", "@vscode/sqlite3",
        "@vscode/windows-ca-certs", "@vscode/windows-process-tree", "@vscode/proxy-agent",
      ],

      resolveExtensions: [".ts", ".js", ".json", ".mjs"],
      tsconfigRaw: {
        compilerOptions: {
          experimentalDecorators: true,
          useDefineForClassFields: false,
        },
      },

      plugins: [
        vscodeAliasPlugin,
        externalNodeModulesPlugin,
        stubPlugin,
      ],

      minify: false,
      sourcemap: true,
      keepNames: true,
      metafile: true,
    })

    console.log("[build-ext-host] ✅ Build succeeded")
    const sanitized = sanitizeGeneratedSourcePaths()
    if (sanitized > 0) {
      console.log(`[build-ext-host] ✅ Normalized ${sanitized} generated source path reference(s) to ${packagedVscodeSourcePrefix()}`)
    }
    console.log("[build-ext-host] Output:", path.join(OUT_DIR, "extHost.bundle.mjs"))
    const externalManifest = writeExternalModuleManifest(result.metafile)
    console.log(`[build-ext-host] ✅ external-modules.json written (${externalManifest.summary.packages} package(s), ${externalManifest.summary.nodeBuiltins} builtin(s))`)
    if (result.warnings?.length) {
      console.log("[build-ext-host] Warnings:", result.warnings.length)
      for (const w of result.warnings.slice(0, 5)) {
        console.log("  ⚠️", w.text.slice(0, 120))
      }
    }

    // Generate package.json for the bundle
    const pkgJson = {
      name: "codek-ext-host",
      version: "0.1.0",
      type: "module",
      main: "extHost.bundle.mjs",
      dependencies: {},
    }
    fs.writeFileSync(path.join(OUT_DIR, "package.json"), JSON.stringify(pkgJson, null, 2))
    console.log("[build-ext-host] ✅ package.json written")

  } catch (err) {
    console.error("[build-ext-host] ❌ Build failed:", err.message)
    // List which vs packages might be missing
    const missingPkg = err.message.match(/['"]((?:vscode-|@vscode\/)[^'"]+)['"]/)
    if (missingPkg) {
      console.error(`[build-ext-host] Missing package resolution: ${missingPkg[1]}`)
      const exists = fs.existsSync(path.join(VSCODE_NODE_MODULES, missingPkg[1]))
      console.error(`[build-ext-host]   Exists in node_modules: ${exists}`)
    }
    process.exit(1)
  }
}

// Externalize node_modules + bare package imports (but not vs/ source)
const externalNodeModulesPlugin = {
  name: "external-node-modules",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      // Never externalize the entry point
      if (args.path === ENTRY) return
      // Never externalize vs/ source files
      if (args.path.startsWith("vs/") || args.path.startsWith(VSCODE_SRC)) return
      // Never externalize relative imports (./ or ../)
      if (args.path.startsWith(".")) return
      // Don't externalize absolute paths (already resolved vs/ files)
      if (path.isAbsolute(args.path)) return
      // Externalize bare package names (vscode-*, @vscode/*, typescript, etc.)
      if (!args.path.startsWith("vs/")) {
        return { path: args.path, external: true }
      }
    })
  },
}

// VS Code alias plugin — resolves vs/ imports to absolute paths
const vscodeAliasPlugin = {
  name: "vscode-alias",
  setup(build) {
    build.onResolve({ filter: /^vs\// }, (args) => {
      return { path: path.join(VSCODE_SRC, args.path) }
    })
  },
}

// Stub plugin — replaces VS Code services we don't want bundled
const stubPlugin = {
  name: "vscode-stub",
  setup(build) {
    // Externalize .node native binaries
    build.onResolve({ filter: /\.node($|\?)/ }, (args) => {
      return { path: args.path, external: true }
    })

    // Stub ripgrep search engine
    build.onResolve({ filter: /ripgrepTextSearchEngine/ }, () => {
      const stubPath = path.join(STUBS_DIR, "search-stub.js")
      fs.writeFileSync(stubPath, `export class RipgrepTextSearchEngine { provideTextSearchResults() { return { results: [] } } }\nexport class RipgrepFileSearchEngine { provideFileSearchResults() { return { results: [] } } }\nexport function spawnRipgrepCmd() { return { cmd: "", args: [] } }\nexport function spawnRipgrep() { return null }\n`)
      return { path: stubPath }
    })

    // Stub ripgrepFileSearch (needed by fileSearch.ts)
    build.onResolve({ filter: /ripgrepFileSearch/ }, () => {
      const stubPath = path.join(STUBS_DIR, "rg-file-search-stub.js")
      if (!fs.existsSync(stubPath)) {
        fs.writeFileSync(stubPath, `export class RipgrepFileSearchEngine { provideFileSearchResults() { return { results: [] } } }\nexport function spawnRipgrepCmd() { return { cmd: "", args: [] } }\nexport function spawnRipgrep() { return { spawn: null, cmd: "" } }\n`)
      }
      return { path: stubPath }
    })

    // Stub native-watchdog
    build.onResolve({ filter: /native-watchdog/ }, () => {
      const stubPath = path.join(STUBS_DIR, "watchdog-stub.js")
      if (!fs.existsSync(stubPath)) {
        fs.writeFileSync(stubPath, `export default { start() {}, stop() {} }\n`)
      }
      return { path: stubPath }
    })

    // Stub @vscode/windows-ca-certs → replaced with external
    // Stub @vscode/windows-process-tree → replaced with external
    // Stub @vscode/proxy-agent → replaced with external
  },
}

if (require.main === module) {
  main()
}

module.exports = {
  assertSelfContainedVscodeSource,
  collectExternalModuleManifest,
  createBundleBanner,
  DETERMINISTIC_BUILD_TIMESTAMP,
  hasForbiddenExternalSourcePath,
  packageNameForSpecifier,
  readVendoredPackageNames,
  sanitizeGeneratedSourcePaths,
  validateSelfContainedVscodeSource,
}
