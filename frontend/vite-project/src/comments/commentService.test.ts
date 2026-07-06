import { describe, expect, it } from "vitest"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"
import {
  CodekCommentService,
  ICommentService,
  globalCommentService,
  type CommentThreadInput,
} from "./commentService"

function createThread(overrides: Partial<CommentThreadInput> = {}): CommentThreadInput {
  return {
    controllerId: "codek.agent-review",
    threadId: "thread-1",
    resource: "file:///workspace/src/app.ts",
    range: {
      startLineNumber: 4,
      startColumn: 3,
      endLineNumber: 4,
      endColumn: 18,
    },
    state: "unresolved",
    comments: [
      {
        id: "comment-1",
        body: "raw sensitive review body",
        author: { id: "agent", label: "Codek Agent", kind: "agent" },
        timestamp: "2026-06-28T04:00:00.000Z",
      },
    ],
    contextValue: "agent-evidence",
    evidence: {
      source: "agent",
      agentId: "agent-a",
      runId: "run-1",
      riskLevel: "medium",
      approvalRequired: true,
      workspaceObservable: true,
    },
    ...overrides,
  }
}

describe("CodekCommentService", () => {
  it("registers a VS Code-style service identifier and resolves the singleton through ServiceCollection", () => {
    const collection = new ServiceCollection([ICommentService, globalCommentService])

    expect(collection.get(ICommentService)).toBe(globalCommentService)
  })

  it("keeps controller registry and thread model in one service-backed state source", () => {
    const service = new CodekCommentService()
    const disposable = service.registerCommentController({
      id: "codek.agent-review",
      owner: "codek",
      label: "Codek Review",
      features: {
        reply: true,
        edit: true,
        delete: true,
        reactions: [{ id: "thumbs-up", label: "赞同" }],
      },
    })

    service.setCommentThread(createThread())

    expect(service.getCommentController("codek.agent-review")?.label).toBe("Codek Review")
    expect(service.getThreadsForResource("file:///workspace/src/app.ts")).toHaveLength(1)
    expect(service.getWorkspaceProjection()).toMatchObject({
      stateSource: "commentService",
      noSecondCommentState: true,
      controllerCount: 1,
      threadCount: 1,
      resources: [
        {
          resource: "file:///workspace/src/app.ts",
          ownerLabel: "Codek Review",
          threads: [
            {
              threadId: "thread-1",
              state: "unresolved",
              rangeLabel: "4:3-4:18",
              commentCount: 1,
            },
          ],
        },
      ],
    })

    disposable.dispose()

    expect(service.getCommentController("codek.agent-review")).toBeUndefined()
    expect(service.getWorkspaceProjection()).toMatchObject({
      controllerCount: 0,
      threadCount: 0,
    })
  })

  it("exposes reply edit delete and reaction descriptors without leaking comment bodies to evidence", () => {
    const service = new CodekCommentService()
    service.registerCommentController({
      id: "codek.agent-review",
      label: "Codek Review",
      features: {
        reply: true,
        edit: true,
        delete: true,
        reactions: [{ id: "thumbs-up", label: "赞同" }],
      },
    })
    service.setCommentThread(createThread())

    const descriptors = service.getCommentActionDescriptors("codek.agent-review", "thread-1")
    expect(descriptors.map((descriptor) => descriptor.kind)).toEqual([
      "reply",
      "edit",
      "delete",
      "reaction",
    ])
    expect(descriptors.every((descriptor) => descriptor.evidenceSafe)).toBe(true)
    expect(descriptors.find((descriptor) => descriptor.kind === "delete")).toMatchObject({
      requiresApproval: true,
      enabled: true,
    })

    const evidence = service.createEvidenceActionProjection(
      "codek.agent-review",
      "thread-1",
      "delete",
    )

    expect(evidence).toMatchObject({
      action: "delete",
      controllerId: "codek.agent-review",
      threadId: "thread-1",
      resource: "file:///workspace/src/app.ts",
      commentCount: 1,
      bodyPreview: "[REDACTED]",
      evidenceSafe: true,
      approvalRequired: true,
    })
    expect(JSON.stringify(evidence)).not.toContain("raw sensitive review body")
  })

  it("updates review thread resolution and keeps editor decorations body-safe", () => {
    const service = new CodekCommentService()
    service.registerCommentController({
      id: "codek.agent-review",
      label: "Codek Review",
      features: { reply: true },
    })
    service.setCommentThread(createThread())

    service.updateCommentThreadState("codek.agent-review", "thread-1", "resolved")

    expect(service.getCommentThread("codek.agent-review", "thread-1")?.state).toBe("resolved")
    expect(service.createEditorProjection("file:///workspace/src/app.ts")).toEqual([
      {
        controllerId: "codek.agent-review",
        threadId: "thread-1",
        resource: "file:///workspace/src/app.ts",
        range: {
          startLineNumber: 4,
          startColumn: 3,
          endLineNumber: 4,
          endColumn: 18,
        },
        glyph: "comment",
        className: "codek-comment-thread-resolved",
        hoverLabel: "Codek Review: 1 comment, resolved",
        commentCount: 1,
        state: "resolved",
        evidenceSafe: true,
      },
    ])
  })
})

