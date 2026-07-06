import { describe, expect, it } from "vitest"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"
import { CodekCommentService } from "../comments/commentService"
import {
  CodekReviewThreadService,
  IReviewThreadService,
  globalReviewThreadService,
} from "./reviewThreadService"

describe("CodekReviewThreadService", () => {
  it("registers a VS Code-style service identifier and resolves the singleton through ServiceCollection", () => {
    const collection = new ServiceCollection([IReviewThreadService, globalReviewThreadService])

    expect(collection.get(IReviewThreadService)).toBe(globalReviewThreadService)
  })

  it("derives review thread and peek projections from the comment service without a second state source", () => {
    const comments = new CodekCommentService()
    const review = new CodekReviewThreadService(comments)
    comments.registerCommentController({
      id: "codek.agent-review",
      label: "Codek Review",
      features: {
        reply: true,
        edit: true,
        delete: true,
        reactions: [{ id: "thumbs-up", label: "赞同" }],
      },
    })

    review.upsertReviewThread({
      controllerId: "codek.agent-review",
      threadId: "review-1",
      resource: "file:///workspace/src/app.ts",
      range: {
        startLineNumber: 8,
        startColumn: 1,
        endLineNumber: 10,
        endColumn: 2,
      },
      state: "unresolved",
      comments: [
        {
          id: "review-comment-1",
          body: "do not leak this review body",
          author: { id: "agent", label: "Codek Agent", kind: "agent" },
          timestamp: "2026-06-28T04:10:00.000Z",
        },
      ],
      evidence: {
        source: "agent",
        riskLevel: "high",
        approvalRequired: true,
        workspaceObservable: true,
      },
    })

    expect(review.createReviewProjection()).toMatchObject({
      stateSource: "commentService",
      noSecondReviewState: true,
      threadCount: 1,
      unresolvedCount: 1,
      resolvedCount: 0,
      resources: [
        {
          resource: "file:///workspace/src/app.ts",
          threads: [
            {
              controllerId: "codek.agent-review",
              threadId: "review-1",
              resolution: "open",
              canReply: true,
              actionIds: [
                "comment.reply",
                "comment.edit",
                "comment.delete",
                "comment.reaction.thumbs-up",
              ],
            },
          ],
        },
      ],
    })

    const peek = review.createPeekProjection("file:///workspace/src/app.ts")

    expect(peek).toEqual([
      {
        controllerId: "codek.agent-review",
        threadId: "review-1",
        resource: "file:///workspace/src/app.ts",
        rangeLabel: "8:1-10:2",
        title: "Codek Review",
        commentCount: 1,
        resolution: "open",
        bodyPreview: "[REDACTED]",
        actionIds: [
          "comment.reply",
          "comment.edit",
          "comment.delete",
          "comment.reaction.thumbs-up",
        ],
        evidenceSafe: true,
      },
    ])
    expect(JSON.stringify(peek)).not.toContain("do not leak this review body")
  })
})

