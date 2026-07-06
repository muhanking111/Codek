const assert = require("node:assert/strict")
const test = require("node:test")

const {
  evaluatePublisherPolicy,
  publisherFromExtension,
  readPublisherPolicy,
} = require("./extensionPublisherPolicy")

test("publisher policy derives publisher from id or metadata", () => {
  assert.equal(publisherFromExtension({ id: "ms-python.python" }), "ms-python")
  assert.equal(publisherFromExtension({ namespace: "OpenAI", name: "agent" }), "openai")
})

test("publisher policy supports allow and deny lists", () => {
  const policy = readPublisherPolicy({
    CODEK_EXTENSION_PUBLISHER_ALLOW: "ms-python, dbaeumer",
    CODEK_EXTENSION_PUBLISHER_DENY: "bad-publisher",
  })

  assert.equal(evaluatePublisherPolicy({ id: "ms-python.python" }, { policy }).allowed, true)
  assert.equal(evaluatePublisherPolicy({ id: "bad-publisher.tool" }, { policy }).reason, "publisher_denied")
  assert.equal(evaluatePublisherPolicy({ id: "unknown.tool" }, { policy }).reason, "publisher_not_allowed")
})
