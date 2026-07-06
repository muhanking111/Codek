import { describe, expect, it } from "vitest"
import { buildContextEvidence } from "./contextEvidence"

describe("contextEvidence", () => {
  it("records context source metadata without leaking attachment bodies", () => {
    const evidence = buildContextEvidence({
      contextBlock: "resolved mention context",
      mentions: [
        { id: "src/App.vue", type: "file", label: "App.vue", detail: "src/App.vue" },
      ],
      attachments: [
        {
          id: "att-1",
          name: "secret.txt",
          size: 42,
          type: "text/plain",
          kind: "text",
          status: "ready",
          content: "TOP_SECRET_BODY",
          preview: "TOP_SECRET_BODY",
        },
        {
          id: "att-2",
          name: "screen.png",
          size: 100,
          type: "image/png",
          kind: "image",
          status: "ready",
          dataUrl: "data:image/png;base64,VERY_SECRET_IMAGE",
        },
      ],
      rules: [
        { path: ".cursor/rules.md", title: "Rules", glob: null, priority: 90, content: "Do not leak rules body" },
      ],
      workspaceSources: [
        { type: "active-file", label: "App.vue", path: "src/App.vue", contentLength: 4000, truncated: true },
      ],
      indexStatus: {
        enabled: true,
        state: "idle",
        indexedFiles: 12,
        indexableFiles: 18,
        excludedFiles: 3,
        workspaceRoots: 2,
        freshness: "fresh",
        updatedAt: 100,
      },
      budgetPolicy: {
        modelWindowChars: 16000,
        reservedResponseChars: 2000,
        taskType: "fix",
        riskLevel: "medium",
      },
      attachmentWarnings: ["screen.png warning"],
    })

    expect(evidence.mentions[0]).toMatchObject({ type: "file", label: "App.vue", resolved: true })
    expect(evidence.attachments[0]).toMatchObject({ name: "secret.txt", kind: "text", contentLength: 15 })
    expect(evidence.attachments[1]).toMatchObject({ name: "screen.png", kind: "image", contentLength: 39 })
    expect(evidence.rules[0]).toMatchObject({ path: ".cursor/rules.md", title: "Rules", contentLength: 22 })
    expect(evidence.workspaceSources[0]).toMatchObject({ type: "active-file", path: "src/App.vue", truncated: true })
    expect(evidence.indexStatus).toMatchObject({ state: "idle", indexedFiles: 12, excludedFiles: 3, workspaceRoots: 2 })
    expect(evidence.budget.policy).toMatchObject({ taskType: "fix", riskLevel: "medium", modelWindowChars: 16000 })
    expect(evidence.budget.totalSources).toBe(5)
    expect(evidence.budget.workspaceContextChars).toBe(4000)
    expect(evidence.warnings).toEqual(["screen.png warning"])

    const serialized = JSON.stringify(evidence)
    expect(serialized).not.toContain("TOP_SECRET_BODY")
    expect(serialized).not.toContain("VERY_SECRET_IMAGE")
    expect(serialized).not.toContain("Do not leak rules body")
  })
})
