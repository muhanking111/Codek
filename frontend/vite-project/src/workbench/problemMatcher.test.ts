import { describe, expect, it } from "vitest"
import { collectProblemDiagnostics, resolveProblemMatchers } from "./problemMatcher"

describe("problemMatcher", () => {
  it("matches TypeScript compiler output", () => {
    const matchers = resolveProblemMatchers("$tsc")
    const diagnostics = collectProblemDiagnostics(
      "src/main.ts(12,8): error TS2322: Type 'string' is not assignable to type 'number'.",
      matchers,
    )

    expect(diagnostics).toEqual([
      expect.objectContaining({
        file: "src/main.ts",
        line: 12,
        column: 8,
        severity: "error",
        source: "TypeScript",
        diagnosticSource: "compiler",
      }),
    ])
    expect(diagnostics[0].message).toContain("TS2322")
  })

  it("matches VS Code ESLint stylish output as lint diagnostics", () => {
    const matchers = resolveProblemMatchers("$eslint-stylish")
    const diagnostics = collectProblemDiagnostics([
      "./src/App.vue",
      "  4:10  warning  unused variable  no-unused-vars",
    ].join("\n"), matchers)

    expect(diagnostics).toEqual([
      expect.objectContaining({
        file: "src/App.vue",
        line: 4,
        column: 10,
        severity: "warning",
        diagnosticSource: "lint",
      }),
    ])
  })

  it("supports custom VS Code problem matcher objects", () => {
    const matchers = resolveProblemMatchers({
      owner: "pytest",
      source: "pytest",
      fileLocation: ["relative", "${workspaceFolder}/tests"],
      pattern: {
        regexp: "^(.+):(\\d+):\\s+(.*)$",
        file: 1,
        line: 2,
        message: 3,
      },
      severity: "warning",
    })
    const diagnostics = collectProblemDiagnostics("unit/test_app.py:7: assertion failed", matchers)

    expect(diagnostics[0]).toMatchObject({
      file: "${workspaceFolder}/tests/unit/test_app.py",
      line: 7,
      column: 1,
      severity: "warning",
      source: "pytest",
    })
  })

  it("supports VS Code base problem matcher overrides", () => {
    const matchers = resolveProblemMatchers({
      base: "$eslint-stylish",
      owner: "workspace-eslint",
      source: "Workspace ESLint",
      fileLocation: ["relative", "D:/Workspace"],
    })
    const diagnostics = collectProblemDiagnostics([
      "./src/index.js",
      "  3:10  error  marker is assigned a value but never used  no-unused-vars",
      "  4:1   warning  missing semicolon                       semi",
    ].join("\n"), matchers)

    expect(diagnostics).toHaveLength(2)
    expect(diagnostics[0]).toMatchObject({
      file: "D:/Workspace/src/index.js",
      line: 3,
      column: 10,
      severity: "error",
      source: "Workspace ESLint",
      diagnosticSource: "lint",
    })
    expect(diagnostics[1]).toMatchObject({
      file: "D:/Workspace/src/index.js",
      line: 4,
      column: 1,
      severity: "warning",
    })
  })

  it("ignores invalid or unknown matcher definitions", () => {
    expect(resolveProblemMatchers("$unknown")).toEqual([])
    expect(resolveProblemMatchers({ pattern: { regexp: "(" } })).toEqual([])
  })
})
