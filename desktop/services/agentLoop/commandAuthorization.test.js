const test = require("node:test")
const assert = require("node:assert/strict")

const { summarizeCommandAuthorization } = require("./commandAuthorization")

test("summarizeCommandAuthorization allows safe quality gate defaults", () => {
  const summary = summarizeCommandAuthorization({}, ["node --test", "npm run build"])

  assert.equal(summary.ok, true)
  assert.equal(summary.allowed, 2)
  assert.equal(summary.blocked, 0)
  assert.equal(summary.commands[0].source, "safe_default")
})

test("summarizeCommandAuthorization blocks install without install permission", () => {
  const summary = summarizeCommandAuthorization({
    permissionRequest: {
      status: "approved",
      commandAllowlist: ["npm install"],
      network: true,
      install: false,
      externalTool: false,
    },
  }, ["npm install"])

  assert.equal(summary.ok, false)
  assert.equal(summary.blocked, 1)
  assert.equal(summary.commands[0].capabilities.install, true)
  assert.match(summary.commands[0].reasons.join(" "), /安装|install|依赖/)
})

test("summarizeCommandAuthorization allows explicitly approved install capability", () => {
  const summary = summarizeCommandAuthorization({
    permissionRequest: {
      status: "approved",
      commandAllowlist: ["npm install"],
      network: true,
      install: true,
      externalTool: false,
    },
  }, ["npm install"])

  assert.equal(summary.ok, true)
  assert.equal(summary.allowed, 1)
  assert.equal(summary.commands[0].source, "permission_request")
})
