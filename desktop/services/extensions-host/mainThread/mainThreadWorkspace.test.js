const assert = require("node:assert/strict")
const path = require("node:path")
const test = require("node:test")

const mainThreadWorkspace = require("./mainThreadWorkspace")
const { toFileUriComponents } = require("../uriComponents")

function createServer() {
  const handlers = new Map()
  return {
    handlers,
    onRpc(actorIdOrMethod, methodOrHandler, maybeHandler) {
      if (typeof actorIdOrMethod === "number") {
        handlers.set(`${actorIdOrMethod}:${methodOrHandler}`, maybeHandler)
        return
      }
      handlers.set(actorIdOrMethod, methodOrHandler)
    },
    callRpc(method, args) {
      const handler = handlers.get(`${mainThreadWorkspace.MAIN_THREAD_WORKSPACE_NID}:${method}`) || handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [])
    },
  }
}

test("MainThreadWorkspace exposes VS Code-style multi-root folders and resolves by path boundary", async () => {
  const roots = [
    path.join("D:\\", "Codek"),
    path.join("D:\\", "CodekPackages"),
  ]
  const server = createServer()
  let setRoots
  mainThreadWorkspace.register(server, {
    setWorkspaceRoots: (fn) => { setRoots = fn },
  })

  setRoots(roots, path.join("D:\\", "workspace.code-workspace"))

  const folders = await server.callRpc("$computeWorkspaceFolders", [])
  assert.deepEqual(folders.map((folder) => folder.name), ["Codek", "CodekPackages"])
  assert.equal(folders[0].index, 0)
  assert.equal(folders[1].index, 1)
  assert.equal(folders[0].uri.path, "/D:/Workspace")

  const resolved = await server.callRpc("$resolveWorkspaceFolder", [
    toFileUriComponents(path.join("D:\\", "Codek", "src", "index.ts"), "win32"),
  ])
  assert.equal(resolved.name, "Codek")

  const sibling = await server.callRpc("$resolveWorkspaceFolder", [
    toFileUriComponents(path.join("D:\\", "CodekSibling", "src", "index.ts"), "win32"),
  ])
  assert.equal(sibling, undefined)
})

test("MainThreadWorkspace applies updateWorkspaceFolders to the local runtime state", async () => {
  const server = createServer()
  const rendererEvents = []
  mainThreadWorkspace.register(server, {
    workspaceRoots: [path.join("D:\\", "Codek"), path.join("D:\\", "Libraries")],
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  await server.callRpc("$updateWorkspaceFolders", [
    "sample.extension",
    1,
    1,
    [{ uri: toFileUriComponents(path.join("D:\\", "Apps"), "win32"), name: "Apps" }],
  ])

  const folders = await server.callRpc("$computeWorkspaceFolders", [])
  assert.deepEqual(folders.map((folder) => folder.name), ["Codek", "Apps"])
  assert.equal(folders[1].uri.path, "/D:/Apps")
  assert.equal(rendererEvents.at(-1).channel, "ext-host:workspace-folders-updated")
  assert.equal(rendererEvents.at(-1).payload.extensionName, "sample.extension")
})

test("MainThreadWorkspace exposes clone-safe workspace data without a second state source", async () => {
  const server = createServer()
  const workspaceFile = path.join("D:\\", "workspace.code-workspace")
  mainThreadWorkspace.register(server, {
    workspaceRoots: [path.join("D:\\", "Codek")],
    workspaceFile,
  })

  const data = mainThreadWorkspace.getWorkspaceData()

  assert.deepEqual(data.folders.map((folder) => folder.name), ["Codek"])
  assert.equal(data.workspaceFile.path, "/D:/workspace.code-workspace")
  assert.deepEqual(data.folders, await server.callRpc("$computeWorkspaceFolders", []))
})
