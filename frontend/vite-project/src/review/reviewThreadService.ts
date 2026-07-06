import {
  CodekCommentService,
  formatRange,
  globalCommentService,
  type CommentThreadInput,
  type ICommentService,
} from "../comments/commentService"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"

export interface ReviewThreadProjection {
  controllerId: string
  threadId: string
  resource: string
  rangeLabel: string
  resolution: "open" | "resolved"
  canReply: boolean
  commentCount: number
  actionIds: string[]
  evidenceSafe: true
}

export interface ReviewResourceProjection {
  resource: string
  threads: ReviewThreadProjection[]
}

export interface ReviewWorkspaceProjection {
  stateSource: "commentService"
  noSecondReviewState: true
  threadCount: number
  unresolvedCount: number
  resolvedCount: number
  resources: ReviewResourceProjection[]
}

export interface ReviewPeekProjection {
  controllerId: string
  threadId: string
  resource: string
  rangeLabel: string
  title: string
  commentCount: number
  resolution: "open" | "resolved"
  bodyPreview: "[REDACTED]"
  actionIds: string[]
  evidenceSafe: true
}

export interface IReviewThreadService {
  readonly _serviceBrand: undefined
  upsertReviewThread(thread: CommentThreadInput): void
  resolveReviewThread(controllerId: string, threadId: string): boolean
  reopenReviewThread(controllerId: string, threadId: string): boolean
  createReviewProjection(): ReviewWorkspaceProjection
  createPeekProjection(resource?: string): ReviewPeekProjection[]
}

export const IReviewThreadService = createDecorator<IReviewThreadService>("reviewThreadService")

export class CodekReviewThreadService implements IReviewThreadService {
  declare readonly _serviceBrand: undefined

  constructor(private readonly comments: ICommentService = globalCommentService) {}

  upsertReviewThread(thread: CommentThreadInput): void {
    this.comments.setCommentThread(thread)
  }

  resolveReviewThread(controllerId: string, threadId: string): boolean {
    return this.comments.updateCommentThreadState(controllerId, threadId, "resolved")
  }

  reopenReviewThread(controllerId: string, threadId: string): boolean {
    return this.comments.updateCommentThreadState(controllerId, threadId, "unresolved")
  }

  createReviewProjection(): ReviewWorkspaceProjection {
    const threads = this.comments.getAllCommentThreads()
    const grouped = new Map<string, ReviewThreadProjection[]>()
    for (const thread of threads) {
      const controller = this.comments.getCommentController(thread.controllerId)
      const actionIds = this.comments
        .getCommentActionDescriptors(thread.controllerId, thread.threadId)
        .map((action) => action.id)
      const list = grouped.get(thread.resource) || []
      list.push({
        controllerId: thread.controllerId,
        threadId: thread.threadId,
        resource: thread.resource,
        rangeLabel: formatRange(thread.range),
        resolution: thread.state === "resolved" ? "resolved" : "open",
        canReply: controller?.features?.reply === true,
        commentCount: thread.comments.length,
        actionIds,
        evidenceSafe: true,
      })
      grouped.set(thread.resource, list)
    }

    return {
      stateSource: "commentService",
      noSecondReviewState: true,
      threadCount: threads.length,
      unresolvedCount: threads.filter((thread) => thread.state !== "resolved").length,
      resolvedCount: threads.filter((thread) => thread.state === "resolved").length,
      resources: [...grouped.entries()].map(([resource, resourceThreads]) => ({
        resource,
        threads: resourceThreads,
      })),
    }
  }

  createPeekProjection(resource?: string): ReviewPeekProjection[] {
    return this.comments
      .getAllCommentThreads()
      .filter((thread) => !resource || thread.resource === resource)
      .map((thread) => {
        const controller = this.comments.getCommentController(thread.controllerId)
        return {
          controllerId: thread.controllerId,
          threadId: thread.threadId,
          resource: thread.resource,
          rangeLabel: formatRange(thread.range),
          title: controller?.label || thread.controllerId,
          commentCount: thread.comments.length,
          resolution: thread.state === "resolved" ? "resolved" : "open",
          bodyPreview: "[REDACTED]",
          actionIds: this.comments
            .getCommentActionDescriptors(thread.controllerId, thread.threadId)
            .map((action) => action.id),
          evidenceSafe: true,
        }
      })
  }
}

export const globalReviewThreadService = new CodekReviewThreadService(globalCommentService as CodekCommentService)

registerSingleton(IReviewThreadService, globalReviewThreadService, InstantiationType.Delayed)

