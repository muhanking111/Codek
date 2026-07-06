const test = require("node:test")
const assert = require("node:assert/strict")
const path = require("path")
const {
  assertPathInWorkspace,
  buildWorkspaceContent,
  getWorkspaceRootDescriptors,
  parseWorkspaceContent,
  removeWorkspaceRoot,
  renameWorkspaceRoot,
  resolveRootForPath,
} = require("./workspaceFile")

test("parseWorkspaceContent resolves relative folders from workspace file", () => {
  const workspaceFile = path.join("D:", "projects", "demo.code-workspace")
  const parsed = parseWorkspaceContent(JSON.stringify({
    folders: [
      { path: "." },
      { path: "../shared" },
      { path: "." },
    ],
    settings: {
      "editor.tabSize": 2,
    },
  }), workspaceFile)

  assert.equal(parsed.roots.length, 2)
  assert.equal(parsed.roots[0].replace(/\\/g, "/").endsWith("/projects"), true)
  assert.equal(parsed.roots[1].replace(/\\/g, "/").endsWith("/shared"), true)
  assert.equal(parsed.settings["editor.tabSize"], 2)
  assert.equal(parsed.folders[0].name, "projects")
})

test("buildWorkspaceContent writes VS Code compatible folders", () => {
  const content = buildWorkspaceContent(["D:/repo/app", "D:/repo/app", "D:/repo/lib"], {
    "files.exclude": { dist: true },
  })
  const parsed = JSON.parse(content)

  assert.deepEqual(parsed.folders, [
    { path: "D:/repo/app" },
    { path: "D:/repo/lib" },
  ])
  assert.equal(parsed.settings["files.exclude"].dist, true)
})

test("workspace roots preserve labels and enforce root boundaries", () => {
  const workspace = {
    folders: [
      { path: "D:/repo/app", name: "应用" },
      { path: "D:/repo/lib", name: "共享库" },
    ],
    roots: ["D:/repo/app", "D:/repo/lib"],
  }

  assert.deepEqual(getWorkspaceRootDescriptors(workspace).map((root) => [root.name, root.path]), [
    ["应用", "D:/repo/app"],
    ["共享库", "D:/repo/lib"],
  ])
  assert.equal(resolveRootForPath(workspace, "D:/repo/app/src/index.js").name, "应用")
  assert.equal(resolveRootForPath(workspace, "D:/repo/other/index.js"), null)
  assert.equal(assertPathInWorkspace(workspace, "D:/repo/lib/src/main.js").name, "共享库")
  assert.throws(
    () => assertPathInWorkspace(workspace, "D:/repo/other/main.js"),
    /root 边界/,
  )
})

test("workspace roots can be renamed and removed without changing other roots", () => {
  const workspace = {
    folders: [
      { path: "D:/repo/app", name: "app" },
      { path: "D:/repo/lib", name: "lib" },
    ],
  }

  const renamed = renameWorkspaceRoot(workspace, "D:/repo/lib", "packages")
  assert.equal(renamed.folders[1].name, "packages")
  assert.deepEqual(renamed.roots, ["D:/repo/app", "D:/repo/lib"])

  const removed = removeWorkspaceRoot(renamed, "D:/repo/app")
  assert.deepEqual(removed.folders, [{ path: "D:/repo/lib", name: "packages" }])
  assert.deepEqual(removed.roots, ["D:/repo/lib"])
})
