const assert = require("node:assert/strict")
const test = require("node:test")

const { toMarkdown } = require("./workbench-large-file-enterprise-smoke")

test("large-file enterprise smoke markdown includes latest report paths", () => {
  const markdown = toMarkdown({
    ready: true,
    status: "ready",
    createdAt: "2026-06-24T00:00:00.000Z",
    fixtureRoot: "D:/Workspace/.codek/large-file-enterprise-smoke",
    fileSize: 54 * 1024 * 1024,
    latestJsonPath: "D:/Workspace/.codek/reports/workbench-large-file-enterprise-latest.json",
    latestMarkdownPath: "D:/Workspace/.codek/reports/workbench-large-file-enterprise-latest.md",
    checks: [{
      id: "large_preview_window",
      passed: true,
      title: "50MB+ text uses bounded window",
    }],
  })

  assert.match(markdown, /workbench-large-file-enterprise-latest\.json/)
  assert.match(markdown, /workbench-large-file-enterprise-latest\.md/)
})
