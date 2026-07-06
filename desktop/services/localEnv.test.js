const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")

const { loadLocalEnv, parseEnvLine } = require("./localEnv")

test("parseEnvLine reads simple, quoted, and exported env values", () => {
  assert.deepEqual(parseEnvLine("GITHUB_OAUTH_CLIENT_ID=abc123"), {
    key: "GITHUB_OAUTH_CLIENT_ID",
    value: "abc123",
  })
  assert.deepEqual(parseEnvLine("export CODEK_SMTP_USER='dev@qq.com'"), {
    key: "CODEK_SMTP_USER",
    value: "dev@qq.com",
  })
  assert.deepEqual(parseEnvLine('CODEK_SMTP_PASS="secret"'), {
    key: "CODEK_SMTP_PASS",
    value: "secret",
  })
  assert.equal(parseEnvLine("# comment"), null)
  assert.equal(parseEnvLine("1_BAD=value"), null)
})

test("loadLocalEnv loads .env values without overriding existing env", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-env-"))
  const envPath = path.join(dir, ".env")
  fs.writeFileSync(envPath, [
    "GITHUB_OAUTH_CLIENT_ID=from-file",
    "CODEK_SMTP_USER=dev@qq.com",
    "CODEK_SMTP_PASS=secret",
    "CODEK_SMTP_HOST=smtp.qq.com",
  ].join("\n"), "utf8")

  const env = { GITHUB_OAUTH_CLIENT_ID: "from-system" }
  const loaded = loadLocalEnv({ paths: [envPath], env })

  assert.equal(loaded, 3)
  assert.equal(env.GITHUB_OAUTH_CLIENT_ID, "from-system")
  assert.equal(env.CODEK_SMTP_USER, "dev@qq.com")
  assert.equal(env.CODEK_SMTP_PASS, "secret")
  assert.equal(env.CODEK_SMTP_HOST, "smtp.qq.com")
})
