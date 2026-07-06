import { describe, expect, it } from "vitest"
import { enforceContextBudget, enforceStructuredContextBudget } from "./context.js"

describe("context budget", () => {
  it("truncates workspace context by budget policy and records evidence", () => {
    const text = "a".repeat(3000)
    const evidence = {
      version: 1,
      mentions: [],
      attachments: [],
      rules: [],
      workspaceSources: [],
      warnings: [],
      budget: {
        totalSources: 0,
        estimatedChars: text.length,
        contextBlockChars: text.length,
        attachmentTextChars: 0,
        ruleChars: 0,
        workspaceContextChars: 0,
        truncatedSources: 0,
        warningCount: 0,
        policy: {
          modelWindowChars: 4000,
          reservedResponseChars: 1000,
          availableContextChars: 3000,
          taskType: "fix",
          riskLevel: "medium",
          allocation: { workspace: 1000 },
          overflowChars: 0,
        },
      },
    }

    const result = enforceContextBudget(text, evidence)

    expect(result.text.length).toBeLessThanOrEqual(1000)
    expect(result.text).toContain("Codek context budget truncated")
    expect(result.evidence.budget.contextBlockChars).toBe(result.text.length)
    expect(result.evidence.budget.truncatedSources).toBe(1)
    expect(result.evidence.budget.warningCount).toBe(1)
    expect(result.evidence.budget.policy.overflowChars).toBeGreaterThan(0)
    expect(result.evidence.warnings[0]).toContain("workspace context truncated")
  })

  it("truncates mentions, attachments, rules, and workspace blocks independently", () => {
    const evidence = {
      version: 1,
      mentions: [{ type: "file", id: "src/a.ts", label: "a.ts", resolved: true }],
      attachments: [
        {
          id: "att-1",
          name: "notes.md",
          size: 4000,
          type: "text/markdown",
          kind: "text",
          status: "ready",
          truncated: false,
          contentLength: 1400,
        },
      ],
      rules: [
        { path: ".codek/rules.md", title: "Rules", glob: null, priority: 100, contentLength: 900 },
      ],
      workspaceSources: [
        { type: "active-file-content", label: "main.ts", path: "src/main.ts", contentLength: 2200, truncated: false },
      ],
      warnings: [],
      budget: {
        totalSources: 4,
        estimatedChars: 6500,
        contextBlockChars: 1800,
        attachmentTextChars: 1400,
        ruleChars: 900,
        workspaceContextChars: 2200,
        truncatedSources: 0,
        warningCount: 0,
        policy: {
          modelWindowChars: 7000,
          reservedResponseChars: 1000,
          availableContextChars: 6000,
          taskType: "fix",
          riskLevel: "medium",
          allocation: {
            mentions: 520,
            attachments: 480,
            rules: 360,
            workspace: 700,
            diagnostics: 120,
          },
          overflowChars: 500,
        },
      },
    }

    const result = enforceStructuredContextBudget({
      mentionsText: "m".repeat(1800),
      attachmentText: "a".repeat(1400),
      rulesText: "r".repeat(900),
      workspaceText: "w".repeat(2200),
      userText: "please fix the issue",
      evidence,
    })

    expect(result.mentionsText.length).toBeLessThanOrEqual(520)
    expect(result.attachmentText.length).toBeLessThanOrEqual(480)
    expect(result.rulesText.length).toBeLessThanOrEqual(360)
    expect(result.workspaceText.length).toBeLessThanOrEqual(700)
    expect(result.text).toContain("please fix the issue")
    expect(result.evidence.budget.contextBlockChars).toBe(result.mentionsText.length)
    expect(result.evidence.budget.attachmentTextChars).toBe(result.attachmentText.length)
    expect(result.evidence.budget.ruleChars).toBe(result.rulesText.length)
    expect(result.evidence.budget.workspaceContextChars).toBe(result.workspaceText.length)
    expect(result.evidence.budget.truncatedSources).toBe(4)
    expect(result.evidence.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("mentions context truncated"),
        expect.stringContaining("attachments context truncated"),
        expect.stringContaining("rules context truncated"),
        expect.stringContaining("workspace context truncated"),
      ]),
    )
    expect(result.evidence.mentions[0].truncated).toBe(true)
    expect(result.evidence.attachments[0].truncated).toBe(true)
    expect(result.evidence.rules[0].truncated).toBe(true)
    expect(result.evidence.workspaceSources[0].truncated).toBe(true)
  })
})
