const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

function loadModules() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-mcp-input-storage-"))
  const previous = process.env.CODEK_DATA
  process.env.CODEK_DATA = tempDir
  for (const modulePath of [
    "../userDataProfile",
    "./mcpRegistryInputStorageAdapter",
  ]) {
    delete require.cache[require.resolve(modulePath)]
  }
  const userDataProfile = require("../userDataProfile")
  const inputStorage = require("./mcpRegistryInputStorageAdapter")
  if (previous == null) delete process.env.CODEK_DATA
  else process.env.CODEK_DATA = previous
  return { inputStorage, tempDir, userDataProfile }
}

test("McpRegistryInputStorageAdapter stores plain text values retrievable with getMap", async () => {
  const { inputStorage } = loadModules()
  const storage = new inputStorage.McpRegistryInputStorageAdapter()

  await storage.setPlainText({
    key1: { value: "value1" },
    key2: { value: "value2" },
  })

  assert.deepEqual(await storage.getMap(), {
    key1: { value: "value1" },
    key2: { value: "value2" },
  })
})

test("McpRegistryInputStorageAdapter stores secrets encrypted and combines them with plain values", async () => {
  const { inputStorage, userDataProfile } = loadModules()
  const storage = new inputStorage.McpRegistryInputStorageAdapter({ profileId: "active-profile" })

  await storage.setPlainText({ root: { value: "D:/Workspace" } })
  await storage.setSecrets({ token: { value: "secret-token" } })

  const result = await storage.getMap()
  assert.equal(result.root.value, "D:/Workspace")
  assert.equal(result.token.value, "secret-token")

  const persisted = userDataProfile.readProfileStorageData("active-profile")
  const mcpInputs = persisted.entries[inputStorage.MCP_DATA_STORED_KEY].value
  assert.equal(mcpInputs.includes("D:/Workspace"), true)
  assert.equal(mcpInputs.includes("secret-token"), false)
  assert.equal(JSON.stringify(persisted.entries).includes(inputStorage.MCP_ENCRYPTION_KEY_NAME), true)
})

test("McpRegistryInputStorageAdapter clears individual plain and secret values", async () => {
  const { inputStorage } = loadModules()
  const storage = new inputStorage.McpRegistryInputStorageAdapter()

  await storage.setPlainText({
    key1: { value: "value1" },
    key2: { value: "value2" },
  })
  await storage.setSecrets({
    secretKey1: { value: "secretValue1" },
    secretKey2: { value: "secretValue2" },
  })

  await storage.clear("key1")
  await storage.clear("secretKey1")

  const result = await storage.getMap()
  assert.equal(result.key1, undefined)
  assert.equal(result.key2.value, "value2")
  assert.equal(result.secretKey1, undefined)
  assert.equal(result.secretKey2.value, "secretValue2")
})

test("McpRegistryInputStorageAdapter clearAll removes values and sealed secrets", async () => {
  const { inputStorage, userDataProfile } = loadModules()
  const storage = new inputStorage.McpRegistryInputStorageAdapter()

  await storage.setPlainText({ key1: { value: "value1" } })
  await storage.setSecrets({ secretKey1: { value: "secretValue1" } })
  await storage.clearAll()

  assert.deepEqual(await storage.getMap(), {})
  const persisted = JSON.parse(userDataProfile.readProfileStorageData(inputStorage.DEFAULT_INPUT_STORAGE_PROFILE_ID).entries.mcpInputs.value)
  assert.deepEqual(persisted, { version: 1, values: {} })
})

test("McpRegistryInputStorageAdapter overwrites existing plain and secret values", async () => {
  const { inputStorage } = loadModules()
  const storage = new inputStorage.McpRegistryInputStorageAdapter()

  await storage.setPlainText({ key1: { value: "value1" }, key2: { value: "value2" } })
  await storage.setPlainText({ key1: { value: "updatedValue1" } })
  await storage.setSecrets({ secretKey1: { value: "secretValue1" }, secretKey2: { value: "secretValue2" } })
  await storage.setSecrets({ secretKey1: { value: "updatedSecretValue1" } })

  const result = await storage.getMap()
  assert.equal(result.key1.value, "updatedValue1")
  assert.equal(result.key2.value, "value2")
  assert.equal(result.secretKey1.value, "updatedSecretValue1")
  assert.equal(result.secretKey2.value, "secretValue2")
})

test("McpRegistryInputStorageAdapter persists values across instances", async () => {
  const { inputStorage } = loadModules()
  const first = new inputStorage.McpRegistryInputStorageAdapter({ profileId: "shared-profile" })

  await first.setPlainText({ root: { value: "D:/Workspace" } })
  await first.setSecrets({ token: { value: "persisted-secret" } })

  const second = new inputStorage.McpRegistryInputStorageAdapter({ profileId: "shared-profile" })
  const result = await second.getMap()

  assert.equal(result.root.value, "D:/Workspace")
  assert.equal(result.token.value, "persisted-secret")
})

test("McpRegistryInputStorageAdapter drops corrupted encrypted payloads without throwing", async () => {
  const { inputStorage, userDataProfile } = loadModules()
  const profileId = "corrupted-profile"
  userDataProfile.updateProfileStorageData(profileId, {
    target: userDataProfile.STORAGE_TARGET.USER,
    scope: userDataProfile.STORAGE_SCOPE.PROFILE,
    data: {
      [inputStorage.MCP_DATA_STORED_KEY]: JSON.stringify({
        version: 1,
        values: { plain: { value: "ok" } },
        secrets: { value: "not-valid-base64", iv: "also-invalid" },
      }),
    },
  })

  const warnings = []
  const storage = new inputStorage.McpRegistryInputStorageAdapter({
    profileId,
    logService: { warn: (...args) => warnings.push(args.join(" ")) },
  })

  const result = await storage.getMap()
  assert.deepEqual(result, { plain: { value: "ok" } })
  assert.equal(warnings.some((line) => line.includes("Error unsealing MCP secrets")), true)

  const persisted = JSON.parse(userDataProfile.readProfileStorageData(profileId).entries.mcpInputs.value)
  assert.equal(persisted.secrets, undefined)
})
