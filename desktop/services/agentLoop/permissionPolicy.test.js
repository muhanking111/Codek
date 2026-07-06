const assert = require("node:assert/strict")
const test = require("node:test")
const {
  isCommandAllowed,
  isPathAllowed,
  validateCommandPermissions,
  validatePatchPermissions,
} = require("./permissionPolicy")

test("permission policy allows only approved write paths", () => {
  assert.equal(isPathAllowed("src/app.js", ["src"]), true)
  assert.equal(isPathAllowed("src/deep/app.js", ["src"]), true)
  assert.equal(isPathAllowed("package.json", ["src"]), false)

  const result = validatePatchPermissions({
    permissionRequest: { status: "approved", writePaths: ["src"] },
  }, ["src/app.js", "package.json"])

  assert.equal(result.ok, false)
  assert.deepEqual(result.violations, ["package.json"])
})

test("permission policy enforces command allowlist and capability flags", () => {
  const permissionRequest = {
    status: "approved",
    commandAllowlist: ["npm install", "npm run build"],
    network: true,
    install: false,
    externalTool: false,
  }

  assert.equal(isCommandAllowed("npm run build", permissionRequest), true)
  assert.equal(isCommandAllowed("npm install", permissionRequest), true)
  assert.equal(isCommandAllowed("git push origin main", permissionRequest), false)

  const result = validateCommandPermissions({ permissionRequest }, ["npm install", "git push origin main"])
  assert.equal(result.ok, false)
  assert.equal(result.violations.some((item) => item.reason.includes("安装依赖")), true)
  assert.equal(result.violations.some((item) => item.reason.includes("允许列表")), true)
})

test("permission policy allows safe quality gate defaults without a permission request", () => {
  const safe = validateCommandPermissions({}, ["npm run typecheck", "node --test desktop/services/agentLoop/runtimeStatus.test.js", "node --check src/app.js"])
  assert.equal(safe.ok, true)

  const risky = validateCommandPermissions({}, ["npm install"])
  assert.equal(risky.ok, false)
  assert.match(risky.violations[0].reason, /权限/)
})
