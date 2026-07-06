const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const test = require("node:test")
const {
  buildWatcherOptions,
  classifyWorkspaceScale,
  createWorkspaceScaleProfile,
  DEFAULT_IGNORED_GLOBS,
  pathHasIgnoredSegment,
  shouldAutoWatchExpandedDirectory,
  shouldStartRecursiveWatcher,
  shouldWatchExpandedDirectories,
} = require("./workspaceScaleProfile")

async function makeTempWorkspace() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), "codek-scale-"))
}

test("classifyWorkspaceScale keeps small workspaces recursive and fully responsive", () => {
  const profile = classifyWorkspaceScale({
    sampledEntries: 120,
    topLevelEntries: 18,
    topLevelDirs: 4,
    generatedEntryCount: 0,
    heavyDirs: [],
  })

  assert.equal(profile.scale, "normal")
  assert.equal(profile.budgets.watcherMode, "recursive")
  assert.equal(shouldStartRecursiveWatcher(profile), true)
  assert.equal(shouldWatchExpandedDirectories(profile), false)
})

test("classifyWorkspaceScale downgrades broad monorepos to bounded watcher budgets", () => {
  const profile = classifyWorkspaceScale({
    sampledEntries: 3_500,
    topLevelEntries: 420,
    topLevelDirs: 100,
    generatedEntryCount: 1,
    heavyDirs: [],
  })

  assert.equal(profile.scale, "large")
  assert.equal(profile.budgets.watcherMode, "shallow-plus-expanded")
  assert.equal(profile.budgets.watcherDepth, 1)
  assert.equal(shouldStartRecursiveWatcher(profile), false)
  assert.equal(shouldWatchExpandedDirectories(profile), true)
})

test("classifyWorkspaceScale puts huge/generated-heavy workspaces into root-shallow mode", () => {
  const profile = classifyWorkspaceScale({
    sampledEntries: 9_000,
    topLevelEntries: 1_200,
    topLevelDirs: 360,
    generatedEntryCount: 12,
    heavyDirs: Array.from({ length: 20 }, (_, index) => ({ name: `pkg-${index}` })),
  })

  assert.equal(profile.scale, "huge")
  assert.equal(profile.budgets.watcherMode, "shallow")
  assert.equal(profile.budgets.watcherDepth, 1)
  assert.equal(shouldStartRecursiveWatcher(profile), false)
  assert.equal(shouldWatchExpandedDirectories(profile), false)
})

test("classifyWorkspaceScale treats a saturated child directory as huge", () => {
  const profile = classifyWorkspaceScale({
    sampledEntries: 320,
    topLevelEntries: 8,
    topLevelDirs: 2,
    generatedEntryCount: 0,
    saturatedChildDirs: 1,
    heavyDirs: [{ name: "src", sampledEntries: 300 }],
  })

  assert.equal(profile.scale, "huge")
  assert.equal(profile.budgets.watcherMode, "shallow")
})

test("classifyWorkspaceScale treats nested generated-heavy source trees as huge", () => {
  const profile = classifyWorkspaceScale({
    sampledEntries: 56,
    topLevelEntries: 8,
    topLevelDirs: 2,
    generatedEntryCount: 4,
    heavyDirs: [{ name: "vscode", sampledEntries: 46, ignoredChildren: 4 }],
    saturatedChildDirs: 0,
  })

  assert.equal(profile.scale, "huge")
  assert.equal(profile.budgets.watcherMode, "shallow")
  assert.equal(shouldStartRecursiveWatcher(profile), false)
  assert.equal(shouldWatchExpandedDirectories(profile), false)
})

test("classifyWorkspaceScale treats VS Code style nested extension forests as huge", () => {
  const profile = classifyWorkspaceScale({
    sampledEntries: 240,
    topLevelEntries: 9,
    topLevelDirs: 3,
    generatedEntryCount: 2,
    heavyDirs: [{ name: "vscode", sampledEntries: 44, ignoredChildren: 2 }],
    nestedWideDirs: [{ name: "vscode/extensions", sampledEntries: 110, childDirs: 104 }],
    saturatedChildDirs: 0,
  })

  assert.equal(profile.scale, "huge")
  assert.equal(profile.budgets.watcherMode, "shallow")
  assert.equal(profile.nestedWideDirCount, 1)
  assert.equal(shouldStartRecursiveWatcher(profile), false)
})

test("buildWatcherOptions uses shared generated-directory ignores", () => {
  const huge = classifyWorkspaceScale({ sampledEntries: 9_000, topLevelEntries: 10, topLevelDirs: 4 })
  const options = buildWatcherOptions(huge)

  assert.equal(options.depth, 1)
  assert.equal(options.followSymlinks, false)
  assert.equal(options.alwaysStat, false)
  assert.deepEqual(options.ignored, DEFAULT_IGNORED_GLOBS)
  assert.ok(options.ignored.includes("**/node_modules/**"))
  assert.ok(options.ignored.includes("**/.codek/**"))
  assert.ok(options.ignored.includes("**/frontend-dist/**"))
})

test("ignored segment checks protect generated directories for search and expanded watchers", async () => {
  const root = await makeTempWorkspace()
  const src = path.join(root, "src")
  const nodeModules = path.join(root, "node_modules", "pkg")
  await fs.promises.mkdir(src, { recursive: true })
  await fs.promises.mkdir(nodeModules, { recursive: true })

  assert.equal(pathHasIgnoredSegment("src/app.ts"), false)
  assert.equal(pathHasIgnoredSegment("node_modules/pkg/index.js"), true)
  assert.equal(shouldAutoWatchExpandedDirectory(src, root), true)
  assert.equal(shouldAutoWatchExpandedDirectory(nodeModules, root), false)
  assert.equal(shouldAutoWatchExpandedDirectory(path.join(os.tmpdir(), "outside"), root), false)
})

test("createWorkspaceScaleProfile samples real workspaces without recursive full walk", async () => {
  const root = await makeTempWorkspace()
  await fs.promises.mkdir(path.join(root, "packages"), { recursive: true })
  await fs.promises.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true })
  for (let index = 0; index < 12; index += 1) {
    await fs.promises.writeFile(path.join(root, "packages", `file-${index}.ts`), "export {}\n", "utf8")
  }

  const profile = await createWorkspaceScaleProfile(root)

  assert.equal(profile.root, path.resolve(root))
  assert.ok(profile.sampledEntries >= 2)
  assert.equal(profile.ignoredTopLevelDirs, 1)
  assert.ok(["normal", "large", "huge"].includes(profile.scale))
})

test("createWorkspaceScaleProfile detects nested extension forests without a full recursive walk", async () => {
  const root = await makeTempWorkspace()
  const vscodeRoot = path.join(root, "vscode")
  const extensionsRoot = path.join(vscodeRoot, "extensions")
  await fs.promises.mkdir(extensionsRoot, { recursive: true })
  for (let index = 0; index < 65; index += 1) {
    await fs.promises.mkdir(path.join(extensionsRoot, `theme-${index}`), { recursive: true })
  }

  const profile = await createWorkspaceScaleProfile(root)

  assert.equal(profile.scale, "huge")
  assert.equal(profile.budgets.watcherMode, "shallow")
  assert.equal(shouldStartRecursiveWatcher(profile), false)
})

test("createWorkspaceScaleProfile caps nested probe work with a global budget", async () => {
  const root = await makeTempWorkspace()
  for (let parentIndex = 0; parentIndex < 4; parentIndex += 1) {
    const parent = path.join(root, `parent-${parentIndex}`)
    await fs.promises.mkdir(parent, { recursive: true })
    for (let childIndex = 0; childIndex < 10; childIndex += 1) {
      await fs.promises.mkdir(path.join(parent, `child-${childIndex}`), { recursive: true })
    }
  }

  const profile = await createWorkspaceScaleProfile(root, {
    limits: {
      childDirs: 4,
      nestedChildDirs: 10,
      nestedDirProbeBudget: 7,
      entriesPerNestedChildDir: 20,
    },
  })

  assert.equal(profile.nestedDirProbes, 7)
})
