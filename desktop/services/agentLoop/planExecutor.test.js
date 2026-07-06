const test = require("node:test")
const assert = require("node:assert/strict")

const planTree = require("./planTree")
const executor = require("./planExecutor")

test("topoWaves groups independent phases for parallel execution", () => {
  const plan = planTree.createPlan("demo", [
    { id: "phase_1", name: "分析", dependsOn: [], tasks: [{ description: "read" }] },
    { id: "phase_2", name: "后端", dependsOn: ["phase_1"], tasks: [{ description: "backend" }] },
    { id: "phase_3", name: "前端", dependsOn: ["phase_1"], tasks: [{ description: "frontend" }] },
    { id: "phase_4", name: "验证", dependsOn: ["phase_2", "phase_3"], tasks: [{ description: "test" }] },
  ])

  const waves = planTree.topoWaves(plan).map((wave) => wave.map((phase) => phase.id).sort())

  assert.deepEqual(waves, [["phase_1"], ["phase_2", "phase_3"], ["phase_4"]])
})

test("in-process file locks reject two phases writing the same file", () => {
  const first = executor.lockFiles("phase_1", ["src/app.ts"])
  const second = executor.lockFiles("phase_2", ["src/app.ts"])

  assert.equal(first.ok, true)
  assert.equal(second.ok, false)
  assert.deepEqual(second.conflicts, [{ file: "src/app.ts", holder: "phase_1" }])

  executor.unlockFiles("phase_1")
  const third = executor.lockFiles("phase_2", ["src/app.ts"])
  assert.equal(third.ok, true)
  executor.unlockFiles("phase_2")
})

test("waitForFileLocks waits until a conflicting phase releases the file", async () => {
  executor.unlockFiles("phase_1")
  executor.unlockFiles("phase_2")

  const first = executor.lockFiles("phase_1", ["src/shared.ts"])
  assert.equal(first.ok, true)

  const events = []
  const waiting = executor.waitForFileLocks(
    "phase_2",
    ["src/shared.ts"],
    undefined,
    (event) => events.push(event),
    undefined,
    2000,
  )

  setTimeout(() => executor.unlockFiles("phase_1"), 80)
  const second = await waiting

  assert.equal(second.ok, true)
  assert.equal(events.some((event) => event.type === "phase_blocked"), true)
  executor.unlockFiles("phase_2")
})
