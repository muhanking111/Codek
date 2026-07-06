import { describe, expect, it } from "vitest"
import {
  collectTaskProblemMatches,
  createBackgroundProblemState,
  resolveTaskProblemMatchers,
  updateBackgroundProblemState,
} from "./problemMatcher"

describe("VS Code task problem matcher adapter", () => {
  it("collects multi-line ESLint stylish matches with loop semantics", () => {
    const matchers = resolveTaskProblemMatchers("$eslint-stylish", "D:/Workspace")
    const matches = collectTaskProblemMatches([
      "./src/index.js",
      "  3:10  warning  marker is assigned a value but never used  no-unused-vars",
      "  4:1   error    missing semicolon                         semi",
    ].join("\n"), matchers)

    expect(matches).toHaveLength(2)
    expect(matches[0].marker).toMatchObject({
      resource: "D:/Workspace/src/index.js",
      line: 3,
      column: 10,
      severity: "warning",
      source: "ESLint",
      code: "no-unused-vars",
    })
    expect(matches[1].marker).toMatchObject({
      resource: "D:/Workspace/src/index.js",
      line: 4,
      column: 1,
      severity: "error",
      code: "semi",
    })
  })

  it("resolves VS Code base matcher overrides", () => {
    const [matcher] = resolveTaskProblemMatchers({
      base: "$tsc",
      owner: "workspace-tsc",
      source: "Workspace TypeScript",
      fileLocation: ["relative", "D:/Workspace/packages/app"],
    })
    const matches = collectTaskProblemMatches(
      "src/main.ts(7,5): warning TS6133: unused local",
      [matcher],
    )

    expect(matches[0].marker).toMatchObject({
      owner: "workspace-tsc",
      source: "Workspace TypeScript",
      resource: "D:/Workspace/packages/app/src/main.ts",
      line: 7,
      column: 5,
      severity: "warning",
      code: "TS6133",
    })
  })

  it("tracks VS Code watching matcher begin and end state", () => {
    const [matcher] = resolveTaskProblemMatchers({
      owner: "watch",
      source: "watch",
      pattern: {
        regexp: "^(.*)\\((\\d+),(\\d+)\\):\\s+(error|warning)\\s+(TS\\d+):\\s+(.*)$",
        file: 1,
        line: 2,
        column: 3,
        severity: 4,
        code: 5,
        message: 6,
      },
      background: {
        activeOnStart: false,
        beginsPattern: "Starting compilation",
        endsPattern: "Watching for file changes",
      },
    }, "D:/Workspace")

    const started = updateBackgroundProblemState("Starting compilation", [matcher], createBackgroundProblemState([matcher]))
    expect(started).toMatchObject({ active: true, beginsMatched: true, endsMatched: false })

    const ended = updateBackgroundProblemState("Watching for file changes", [matcher], started)
    expect(ended).toMatchObject({ active: false, beginsMatched: true, endsMatched: true })
  })
})
