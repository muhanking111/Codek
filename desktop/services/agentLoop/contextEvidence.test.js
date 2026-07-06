const test = require("node:test")
const assert = require("node:assert/strict")

const { normalizeContextEvidence } = require("./contextEvidence")

test("normalizeContextEvidence strips prompt, text attachment, image, and rule bodies", () => {
  const evidence = normalizeContextEvidence({
    prompt: "USER PROMPT BODY",
    mentions: [{ type: "file", id: "src/App.vue", label: "App.vue", detail: "src/App.vue", truncated: true }],
    attachments: [
      {
        id: "att-1",
        name: "secret.txt",
        size: 10,
        type: "text/plain",
        kind: "text",
        status: "ready",
        content: "TEXT_SECRET",
        dataUrl: "data:image/png;base64,IMAGE_SECRET",
        preview: "TEXT_SECRET",
        contentLength: 11,
      },
    ],
    rules: [{ path: ".codek/rules.md", title: "Rules", content: "RULE_SECRET", contentLength: 11, priority: 100, truncated: true }],
    workspaceSources: [{ type: "active-file", label: "App.vue", path: "src/App.vue", content: "SOURCE_SECRET", contentLength: 1200, truncated: true }],
    indexStatus: {
      enabled: true,
      state: "idle",
      indexedFiles: 12,
      indexableFiles: 20,
      excludedFiles: 4,
      workspaceRoots: 2,
      freshness: "fresh",
      updatedAt: 123,
      content: "INDEX_SECRET",
    },
    warnings: ["safe warning"],
    budget: {
      totalSources: 4,
      estimatedChars: 1323,
      contextBlockChars: 20,
      attachmentTextChars: 11,
      ruleChars: 11,
      workspaceContextChars: 1200,
      policy: {
        modelWindowChars: 16000,
        reservedResponseChars: 2000,
        availableContextChars: 14000,
        taskType: "fix",
        riskLevel: "medium",
        allocation: { workspace: 8000 },
      },
    },
  })

  assert.equal(evidence.version, 1)
  assert.equal(evidence.mentions[0].truncated, true)
  assert.equal(evidence.attachments[0].name, "secret.txt")
  assert.equal(evidence.attachments[0].contentLength, 11)
  assert.equal(evidence.attachments[0].truncated, false)
  assert.equal(evidence.rules[0].path, ".codek/rules.md")
  assert.equal(evidence.rules[0].truncated, true)
  assert.equal(evidence.workspaceSources[0].path, "src/App.vue")
  assert.equal(evidence.workspaceSources[0].truncated, true)
  assert.equal(evidence.indexStatus.indexedFiles, 12)
  assert.equal(evidence.indexStatus.excludedFiles, 4)
  assert.equal(evidence.budget.totalSources, 4)
  assert.equal(evidence.budget.workspaceContextChars, 1200)
  assert.equal(evidence.budget.truncatedSources, 3)
  assert.equal(evidence.budget.policy.taskType, "fix")
  assert.equal(evidence.budget.policy.riskLevel, "medium")

  const serialized = JSON.stringify(evidence)
  assert.doesNotMatch(serialized, /USER PROMPT BODY/)
  assert.doesNotMatch(serialized, /TEXT_SECRET/)
  assert.doesNotMatch(serialized, /IMAGE_SECRET/)
  assert.doesNotMatch(serialized, /RULE_SECRET/)
  assert.doesNotMatch(serialized, /SOURCE_SECRET/)
  assert.doesNotMatch(serialized, /INDEX_SECRET/)
})
