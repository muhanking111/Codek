const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  backupExtensionDirectory,
  getExtensionInstallRecord,
  listExtensionInstallStates,
  readExtensionInstallState,
  restoreExtensionBackup,
  updateExtensionInstallRecord,
} = require("./extensionInstallState")

test("extension install state persists per-extension lifecycle records", () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-state-")), "state.json")
  const record = updateExtensionInstallRecord("ms-python.python", {
    status: "installed",
    version: "1.2.3",
    enabled: true,
  }, { filePath, updatedAt: "2026-01-01T00:00:00.000Z" })

  assert.equal(record.status, "installed")
  assert.equal(getExtensionInstallRecord("ms-python.python", { filePath }).version, "1.2.3")
  assert.equal(readExtensionInstallState({ filePath }).schemaVersion, 1)
  assert.deepEqual(listExtensionInstallStates({ filePath }).map((item) => item.id), ["ms-python.python"])
})

test("extension install state preserves installed MCP manifest contribution", () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-state-mcp-")), "state.json")
  updateExtensionInstallRecord("publisher.mcp-tools", {
    status: "installed",
    version: "1.0.0",
    enabled: true,
    manifest: {
      publisher: "publisher",
      name: "mcp-tools",
      version: "1.0.0",
      contributes: {
        mcp: {
          servers: {
            installedServer: {
              command: "node",
              args: ["server.js"],
            },
          },
        },
      },
    },
  }, { filePath, updatedAt: "2026-01-01T00:00:00.000Z" })

  const record = getExtensionInstallRecord("publisher.mcp-tools", { filePath })
  assert.equal(record.manifest.contributes.mcp.servers.installedServer.command, "node")
  assert.equal(
    listExtensionInstallStates({ filePath })[0].manifest.contributes.mcp.servers.installedServer.args[0],
    "server.js",
  )
})

test("extension install state can backup and restore extension directories", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-backup-"))
  const targetDir = path.join(root, "publisher.name")
  fs.mkdirSync(targetDir, { recursive: true })
  fs.writeFileSync(path.join(targetDir, "package.json"), JSON.stringify({ version: "1.0.0" }))

  const backup = await backupExtensionDirectory("publisher.name", targetDir, {
    backupRoot: path.join(root, "backups"),
    reason: "test",
  })
  fs.writeFileSync(path.join(targetDir, "package.json"), JSON.stringify({ version: "2.0.0" }))

  await restoreExtensionBackup(backup, {
    filePath: path.join(root, "state.json"),
  })

  assert.equal(JSON.parse(fs.readFileSync(path.join(targetDir, "package.json"), "utf8")).version, "1.0.0")
  assert.equal(getExtensionInstallRecord("publisher.name", { filePath: path.join(root, "state.json") }).status, "rolled-back")
})
