const test = require("node:test")
const assert = require("node:assert/strict")

const { countPatchLines, summarizeDiff } = require("./diffSummary")

test("countPatchLines counts additions and deletions without file headers", () => {
  const counts = countPatchLines([
    "diff --git a/demo.js b/demo.js",
    "--- a/demo.js",
    "+++ b/demo.js",
    "@@ -1 +1,2 @@",
    "-old",
    "+new",
    "+next",
  ].join("\n"))

  assert.deepEqual(counts, { additions: 2, deletions: 1 })
})

test("summarizeDiff groups patches by file and marks permission violations", () => {
  const summary = summarizeDiff({
    filesChanged: ["src/app.js", "package.json"],
    patches: [
      {
        artifactId: "artifact_1",
        assignmentId: "assignment_1",
        filesChanged: ["src/app.js"],
        content: "-old\n+new\n",
      },
      {
        artifactId: "artifact_2",
        assignmentId: "assignment_2",
        filesChanged: ["package.json"],
        content: "-safe\n+unsafe\n",
      },
    ],
  }, {
    permissionRequest: {
      status: "approved",
      writePaths: ["src"],
    },
  })

  assert.equal(summary.totalFiles, 2)
  assert.equal(summary.totalAdditions, 2)
  assert.equal(summary.totalDeletions, 2)
  assert.equal(summary.permissionViolationCount, 1)
  assert.equal(summary.files.find((item) => item.file === "src/app.js").permission, "approved")
  assert.equal(summary.files.find((item) => item.file === "package.json").permission, "permission_violation")
})
