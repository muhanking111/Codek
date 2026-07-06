const fs = require("fs")
const path = require("path")

const DEFAULT_IGNORED_DIR_NAMES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  ".codek",
  ".workspace-storage",
  ".cache",
  ".turbo",
  ".next",
  ".nuxt",
  "coverage",
  "release",
  "frontend-dist",
  ".venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".gradle",
  ".idea",
  ".vscode-test",
  "vendor",
  "Pods",
  "DerivedData",
]

const DEFAULT_IGNORED_DIR_PATTERNS = [
  /^_.*unpack$/i,
  /^_.*codex.*install$/i,
]

const DEFAULT_IGNORED_FILE_NAMES = [
  ".DS_Store",
  "Thumbs.db",
]

const DEFAULT_IGNORED_GLOBS = [
  ...DEFAULT_IGNORED_DIR_NAMES.map((name) => `**/${name}/**`),
  "**/extensions/.marketplace-cache/**",
  "**/services/extensions-host/bundle/**",
  "**/*.pyc",
  ...DEFAULT_IGNORED_FILE_NAMES.map((name) => `**/${name}`),
]

const SCALE_BUDGETS = {
  normal: {
    explorerMaxEntries: 2_000,
    searchMaxVisitedFiles: 20_000,
    searchMaxResults: 1_000,
    indexMaxFiles: 2_000,
    analysisMaxFiles: 180,
    watcherDepth: 8,
    watcherMode: "recursive",
  },
  large: {
    explorerMaxEntries: 1_200,
    searchMaxVisitedFiles: 12_000,
    searchMaxResults: 750,
    indexMaxFiles: 1_200,
    analysisMaxFiles: 120,
    watcherDepth: 1,
    watcherMode: "shallow-plus-expanded",
  },
  huge: {
    explorerMaxEntries: 1_200,
    searchMaxVisitedFiles: 6_000,
    searchMaxResults: 500,
    indexMaxFiles: 600,
    analysisMaxFiles: 80,
    watcherDepth: 1,
    watcherMode: "shallow",
  },
}

const SAMPLE_LIMITS = {
  topLevelEntries: 2_000,
  childDirs: 80,
  entriesPerChildDir: 300,
  nestedChildDirs: 16,
  nestedDirProbeBudget: 64,
  entriesPerNestedChildDir: 180,
}

const PRIORITY_NESTED_DIR_NAMES = new Set([
  "apps",
  "backend",
  "cli",
  "crates",
  "extensions",
  "frontend",
  "modules",
  "packages",
  "plugins",
  "services",
  "src",
])

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "")
}

function splitPathSegments(value) {
  return normalizePath(value).split("/").filter(Boolean)
}

function isIgnoredDirectoryName(name) {
  const candidate = String(name || "")
  return DEFAULT_IGNORED_DIR_NAMES.includes(candidate) || DEFAULT_IGNORED_DIR_PATTERNS.some((pattern) => pattern.test(candidate))
}

function pathHasIgnoredSegment(filePath) {
  return splitPathSegments(filePath).some(isIgnoredDirectoryName)
}

async function safeReadDir(dir) {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function sampleWorkspace(root, options = {}) {
  const resolvedRoot = path.resolve(root)
  const limits = { ...SAMPLE_LIMITS, ...(options.limits || {}) }
  const topLevel = (await safeReadDir(resolvedRoot)).slice(0, limits.topLevelEntries)
  const topLevelDirs = topLevel.filter((entry) => entry.isDirectory())
  const candidateDirs = topLevelDirs.filter((entry) => !isIgnoredDirectoryName(entry.name)).slice(0, limits.childDirs)
  let sampledEntries = topLevel.length
  let generatedEntryCount = topLevelDirs.filter((entry) => isIgnoredDirectoryName(entry.name)).length
  const heavyDirs = []
  const nestedWideDirs = []
  let saturatedChildDirs = 0
  let nestedDirProbes = 0

  for (const entry of candidateDirs) {
    const childPath = path.join(resolvedRoot, entry.name)
    const childEntries = (await safeReadDir(childPath)).slice(0, limits.entriesPerChildDir)
    sampledEntries += childEntries.length
    const ignoredChildren = childEntries.filter((child) => child.isDirectory() && isIgnoredDirectoryName(child.name)).length
    generatedEntryCount += ignoredChildren
    if (childEntries.length >= limits.entriesPerChildDir) saturatedChildDirs += 1
    if (childEntries.length >= limits.entriesPerChildDir || ignoredChildren > 0) {
      heavyDirs.push({
        name: entry.name,
        sampledEntries: childEntries.length,
        ignoredChildren,
      })
    }

    const nestedDirCandidates = childEntries
      .filter((child) => child.isDirectory() && !isIgnoredDirectoryName(child.name))
      .sort((left, right) => priorityNestedDirScore(right.name) - priorityNestedDirScore(left.name))
      .slice(0, limits.nestedChildDirs)
    for (const nestedEntry of nestedDirCandidates) {
      if (nestedDirProbes >= limits.nestedDirProbeBudget) break
      nestedDirProbes += 1
      const nestedPath = path.join(childPath, nestedEntry.name)
      const nestedEntries = await safeReadDir(nestedPath)
      const sampledNestedEntries = nestedEntries.slice(0, limits.entriesPerNestedChildDir)
      sampledEntries += sampledNestedEntries.length
      const nestedChildDirs = sampledNestedEntries.filter((child) => child.isDirectory()).length
      const nestedIgnoredChildren = sampledNestedEntries.filter((child) => child.isDirectory() && isIgnoredDirectoryName(child.name)).length
      generatedEntryCount += nestedIgnoredChildren
      if (
        nestedEntries.length >= limits.entriesPerNestedChildDir ||
        nestedChildDirs >= 60 ||
        (priorityNestedDirScore(nestedEntry.name) > 0 && nestedChildDirs >= 40) ||
        nestedIgnoredChildren >= 2
      ) {
        nestedWideDirs.push({
          name: `${entry.name}/${nestedEntry.name}`,
          sampledEntries: nestedEntries.length,
          childDirs: nestedChildDirs,
          ignoredChildren: nestedIgnoredChildren,
        })
      }
    }
  }

  return {
    root: resolvedRoot,
    sampledEntries,
    topLevelEntries: topLevel.length,
    topLevelDirs: topLevelDirs.length,
    ignoredTopLevelDirs: topLevelDirs.filter((entry) => isIgnoredDirectoryName(entry.name)).length,
    generatedEntryCount,
    heavyDirs,
    nestedWideDirs,
    nestedDirProbes,
    saturatedChildDirs,
    sampledAt: Date.now(),
  }
}

function priorityNestedDirScore(name) {
  return PRIORITY_NESTED_DIR_NAMES.has(String(name || "")) ? 1 : 0
}

function classifyWorkspaceScale(sample = {}) {
  const sampledEntries = Number(sample.sampledEntries || 0)
  const topLevelEntries = Number(sample.topLevelEntries || 0)
  const topLevelDirs = Number(sample.topLevelDirs || 0)
  const generatedEntryCount = Number(sample.generatedEntryCount || 0)
  const heavyDirs = Array.isArray(sample.heavyDirs) ? sample.heavyDirs.length : 0
  const nestedWideDirs = Array.isArray(sample.nestedWideDirs) ? sample.nestedWideDirs.length : 0
  const saturatedChildDirs = Number(sample.saturatedChildDirs || 0)

  let scale = "normal"
  const reasons = []

  const nestedGeneratedHeavy = Array.isArray(sample.heavyDirs)
    && sample.heavyDirs.some((entry) => Number(entry?.ignoredChildren || 0) >= 3)
  const nestedWideSourceTree = Array.isArray(sample.nestedWideDirs)
    && sample.nestedWideDirs.some((entry) => Number(entry?.sampledEntries || 0) >= 80 || Number(entry?.childDirs || 0) >= 40)

  if (sampledEntries >= 8_000 || topLevelEntries >= 1_000 || topLevelDirs >= 300 || saturatedChildDirs >= 1 || nestedWideSourceTree) {
    scale = "huge"
    reasons.push(nestedWideSourceTree ? "nested-wide-directory-density" : "sampled-entry-count")
  }
  if (generatedEntryCount >= 8 || heavyDirs >= 16 || nestedGeneratedHeavy) {
    scale = "huge"
    reasons.push(nestedGeneratedHeavy ? "nested-generated-directory-density" : "generated-directory-density")
  }
  if (scale !== "huge" && (sampledEntries >= 2_500 || topLevelEntries >= 300 || topLevelDirs >= 80)) {
    scale = "large"
    reasons.push("workspace-width")
  }
  if (scale !== "huge" && generatedEntryCount >= 3) {
    scale = "large"
    reasons.push("generated-directories")
  }
  if (reasons.length === 0) reasons.push("within-normal-budget")

  return {
    scale,
    reasons,
    sampledEntries,
    topLevelEntries,
    topLevelDirs,
    generatedEntryCount,
    heavyDirCount: heavyDirs,
    nestedWideDirCount: nestedWideDirs,
    saturatedChildDirs,
    budgets: { ...SCALE_BUDGETS[scale] },
  }
}

async function createWorkspaceScaleProfile(root, options = {}) {
  if (!root) {
    return classifyWorkspaceScale({ root: null })
  }
  const sample = options.sample || await sampleWorkspace(root, options)
  return {
    ...sample,
    ...classifyWorkspaceScale(sample),
  }
}

function buildWatcherOptions(profile = {}) {
  const budgets = profile.budgets || SCALE_BUDGETS.normal
  return {
    ignored: DEFAULT_IGNORED_GLOBS,
    alwaysStat: false,
    awaitWriteFinish: false,
    depth: Number.isFinite(budgets.watcherDepth) ? budgets.watcherDepth : SCALE_BUDGETS.normal.watcherDepth,
    followSymlinks: false,
    ignorePermissionErrors: true,
    ignoreInitial: true,
    persistent: true,
    usePolling: false,
  }
}

function shouldStartRecursiveWatcher(profile = {}) {
  return profile.scale === "normal"
}

function shouldWatchExpandedDirectories(profile = {}) {
  return profile.scale === "large"
}

function shouldAutoWatchExpandedDirectory(dirPath, workspaceRoot) {
  if (!dirPath || !workspaceRoot) return false
  const normalizedRoot = normalizePath(path.resolve(workspaceRoot))
  const normalizedDir = normalizePath(path.resolve(dirPath))
  if (normalizedDir !== normalizedRoot && !normalizedDir.startsWith(`${normalizedRoot}/`)) return false
  const rel = normalizedDir === normalizedRoot ? "" : normalizedDir.slice(normalizedRoot.length + 1)
  return !pathHasIgnoredSegment(rel)
}

module.exports = {
  DEFAULT_IGNORED_DIR_NAMES,
  DEFAULT_IGNORED_FILE_NAMES,
  DEFAULT_IGNORED_GLOBS,
  SCALE_BUDGETS,
  SAMPLE_LIMITS,
  buildWatcherOptions,
  classifyWorkspaceScale,
  createWorkspaceScaleProfile,
  isIgnoredDirectoryName,
  pathHasIgnoredSegment,
  sampleWorkspace,
  shouldAutoWatchExpandedDirectory,
  shouldStartRecursiveWatcher,
  shouldWatchExpandedDirectories,
}
