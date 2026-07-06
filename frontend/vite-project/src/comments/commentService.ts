import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"

export interface CommentRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export type CommentThreadState = "unresolved" | "resolved"

export interface CommentAuthor {
  id: string
  label: string
  kind?: "user" | "agent" | "extension"
}

export interface CommentReactionDescriptor {
  id: string
  label: string
  icon?: string
}

export interface CommentBody {
  id: string
  body: string
  author: CommentAuthor
  timestamp?: string
  reactions?: Array<CommentReactionDescriptor & { count?: number; reacted?: boolean }>
}

export interface CommentThreadEvidence {
  source?: "agent" | "user" | "extension" | string
  agentId?: string
  runId?: string
  riskLevel?: "safe" | "medium" | "high" | string
  approvalRequired?: boolean
  workspaceObservable?: boolean
}

export interface CommentThreadInput {
  controllerId: string
  threadId: string
  resource: string
  range?: CommentRange
  state?: CommentThreadState
  comments?: CommentBody[]
  contextValue?: string
  evidence?: CommentThreadEvidence
}

export interface CommentThreadModel extends Required<Omit<CommentThreadInput, "range" | "contextValue" | "evidence">> {
  range?: CommentRange
  contextValue?: string
  evidence: CommentThreadEvidence
  createdAt: string
  updatedAt: string
}

export interface CommentControllerDescriptor {
  id: string
  owner?: string
  label: string
  features?: {
    reply?: boolean
    edit?: boolean
    delete?: boolean
    reactions?: CommentReactionDescriptor[]
  }
  contextValue?: string
}

export interface CommentActionDescriptor {
  id: string
  kind: "reply" | "edit" | "delete" | "reaction"
  label: string
  controllerId: string
  threadId: string
  reactionId?: string
  enabled: boolean
  requiresApproval: boolean
  evidenceSafe: true
}

export interface CommentEvidenceActionProjection {
  action: string
  controllerId: string
  threadId: string
  resource: string
  commentCount: number
  bodyPreview: "[REDACTED]"
  evidenceSafe: true
  approvalRequired: boolean
  source: string
  agentId: string | null
  runId: string | null
  riskLevel: string
  workspaceObservable: boolean
}

export interface CommentEditorProjection {
  controllerId: string
  threadId: string
  resource: string
  range?: CommentRange
  glyph: "comment"
  className: string
  hoverLabel: string
  commentCount: number
  state: CommentThreadState
  evidenceSafe: true
}

export interface CommentResourceProjection {
  resource: string
  ownerLabel: string
  threads: Array<{
    controllerId: string
    threadId: string
    state: CommentThreadState
    rangeLabel: string
    commentCount: number
    contextValue?: string
  }>
}

export interface CommentWorkspaceProjection {
  stateSource: "commentService"
  noSecondCommentState: true
  controllerCount: number
  threadCount: number
  unresolvedCount: number
  resolvedCount: number
  resources: CommentResourceProjection[]
}

export interface ICommentService {
  readonly _serviceBrand: undefined
  registerCommentController(controller: CommentControllerDescriptor): { dispose(): void }
  getCommentController(controllerId: string): CommentControllerDescriptor | undefined
  setCommentThread(thread: CommentThreadInput): CommentThreadModel
  deleteCommentThread(controllerId: string, threadId: string): boolean
  getCommentThread(controllerId: string, threadId: string): CommentThreadModel | undefined
  getAllCommentThreads(): CommentThreadModel[]
  getThreadsForResource(resource: string): CommentThreadModel[]
  updateCommentThreadState(controllerId: string, threadId: string, state: CommentThreadState): boolean
  getCommentActionDescriptors(controllerId: string, threadId: string): CommentActionDescriptor[]
  createEvidenceActionProjection(
    controllerId: string,
    threadId: string,
    action: string,
  ): CommentEvidenceActionProjection | null
  createEditorProjection(resource?: string): CommentEditorProjection[]
  getWorkspaceProjection(): CommentWorkspaceProjection
}

export const ICommentService = createDecorator<ICommentService>("commentService")

export class CodekCommentService implements ICommentService {
  declare readonly _serviceBrand: undefined

  private readonly controllers = new Map<string, CommentControllerDescriptor>()
  private readonly threads = new Map<string, CommentThreadModel>()

  registerCommentController(controller: CommentControllerDescriptor): { dispose(): void } {
    const normalized: CommentControllerDescriptor = {
      ...controller,
      owner: controller.owner || controller.id,
      features: controller.features || {},
    }
    this.controllers.set(normalized.id, normalized)

    return {
      dispose: () => {
        this.controllers.delete(normalized.id)
        for (const key of [...this.threads.keys()]) {
          if (key.startsWith(`${normalized.id}\u0000`)) {
            this.threads.delete(key)
          }
        }
      },
    }
  }

  getCommentController(controllerId: string): CommentControllerDescriptor | undefined {
    return this.controllers.get(controllerId)
  }

  setCommentThread(thread: CommentThreadInput): CommentThreadModel {
    const key = createThreadKey(thread.controllerId, thread.threadId)
    const existing = this.threads.get(key)
    const now = new Date().toISOString()
    const model: CommentThreadModel = {
      controllerId: thread.controllerId,
      threadId: thread.threadId,
      resource: thread.resource,
      range: thread.range,
      state: thread.state || existing?.state || "unresolved",
      comments: thread.comments ? [...thread.comments] : existing?.comments ? [...existing.comments] : [],
      contextValue: thread.contextValue ?? existing?.contextValue,
      evidence: { ...(existing?.evidence || {}), ...(thread.evidence || {}) },
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    this.threads.set(key, model)
    return model
  }

  deleteCommentThread(controllerId: string, threadId: string): boolean {
    return this.threads.delete(createThreadKey(controllerId, threadId))
  }

  getCommentThread(controllerId: string, threadId: string): CommentThreadModel | undefined {
    return this.threads.get(createThreadKey(controllerId, threadId))
  }

  getAllCommentThreads(): CommentThreadModel[] {
    return [...this.threads.values()].sort(compareThreads)
  }

  getThreadsForResource(resource: string): CommentThreadModel[] {
    return this.getAllCommentThreads().filter((thread) => thread.resource === resource)
  }

  updateCommentThreadState(controllerId: string, threadId: string, state: CommentThreadState): boolean {
    const thread = this.getCommentThread(controllerId, threadId)
    if (!thread) return false
    this.setCommentThread({ ...thread, state })
    return true
  }

  getCommentActionDescriptors(controllerId: string, threadId: string): CommentActionDescriptor[] {
    const controller = this.controllers.get(controllerId)
    const thread = this.getCommentThread(controllerId, threadId)
    if (!controller || !thread) return []

    const features = controller.features || {}
    const actions: CommentActionDescriptor[] = []
    if (features.reply) {
      actions.push(createAction("comment.reply", "reply", "Reply", controllerId, threadId, thread))
    }
    if (features.edit) {
      actions.push(createAction("comment.edit", "edit", "Edit", controllerId, threadId, thread))
    }
    if (features.delete) {
      actions.push(createAction("comment.delete", "delete", "Delete", controllerId, threadId, thread))
    }
    for (const reaction of features.reactions || []) {
      actions.push({
        ...createAction(
          `comment.reaction.${reaction.id}`,
          "reaction",
          reaction.label,
          controllerId,
          threadId,
          thread,
        ),
        reactionId: reaction.id,
      })
    }
    return actions
  }

  createEvidenceActionProjection(
    controllerId: string,
    threadId: string,
    action: string,
  ): CommentEvidenceActionProjection | null {
    const thread = this.getCommentThread(controllerId, threadId)
    if (!thread) return null
    const evidence = thread.evidence || {}
    return {
      action,
      controllerId,
      threadId,
      resource: thread.resource,
      commentCount: thread.comments.length,
      bodyPreview: "[REDACTED]",
      evidenceSafe: true,
      approvalRequired: evidence.approvalRequired === true,
      source: evidence.source || "unknown",
      agentId: evidence.agentId || null,
      runId: evidence.runId || null,
      riskLevel: evidence.riskLevel || "medium",
      workspaceObservable: evidence.workspaceObservable === true,
    }
  }

  createEditorProjection(resource?: string): CommentEditorProjection[] {
    return this.getAllCommentThreads()
      .filter((thread) => !resource || thread.resource === resource)
      .filter((thread) => Boolean(thread.range))
      .map((thread) => {
        const controller = this.controllers.get(thread.controllerId)
        return {
          controllerId: thread.controllerId,
          threadId: thread.threadId,
          resource: thread.resource,
          range: thread.range,
          glyph: "comment",
          className: `codek-comment-thread-${thread.state}`,
          hoverLabel: `${controller?.label || thread.controllerId}: ${thread.comments.length} comment${
            thread.comments.length === 1 ? "" : "s"
          }, ${thread.state}`,
          commentCount: thread.comments.length,
          state: thread.state,
          evidenceSafe: true,
        }
      })
  }

  getWorkspaceProjection(): CommentWorkspaceProjection {
    const threads = this.getAllCommentThreads()
    const grouped = new Map<string, CommentThreadModel[]>()
    for (const thread of threads) {
      const list = grouped.get(thread.resource) || []
      list.push(thread)
      grouped.set(thread.resource, list)
    }

    return {
      stateSource: "commentService",
      noSecondCommentState: true,
      controllerCount: this.controllers.size,
      threadCount: threads.length,
      unresolvedCount: threads.filter((thread) => thread.state !== "resolved").length,
      resolvedCount: threads.filter((thread) => thread.state === "resolved").length,
      resources: [...grouped.entries()].map(([resource, resourceThreads]) => ({
        resource,
        ownerLabel: this.controllers.get(resourceThreads[0]?.controllerId || "")?.label || "",
        threads: resourceThreads.map((thread) => ({
          controllerId: thread.controllerId,
          threadId: thread.threadId,
          state: thread.state,
          rangeLabel: formatRange(thread.range),
          commentCount: thread.comments.length,
          contextValue: thread.contextValue,
        })),
      })),
    }
  }
}

function createAction(
  id: string,
  kind: CommentActionDescriptor["kind"],
  label: string,
  controllerId: string,
  threadId: string,
  thread: CommentThreadModel,
): CommentActionDescriptor {
  return {
    id,
    kind,
    label,
    controllerId,
    threadId,
    enabled: true,
    requiresApproval: thread.evidence.approvalRequired === true && (kind === "delete" || kind === "edit"),
    evidenceSafe: true,
  }
}

export function formatRange(range: CommentRange | undefined): string {
  if (!range) return "unknown"
  return `${range.startLineNumber}:${range.startColumn}-${range.endLineNumber}:${range.endColumn}`
}

function createThreadKey(controllerId: string, threadId: string): string {
  return `${controllerId}\u0000${threadId}`
}

function compareThreads(a: CommentThreadModel, b: CommentThreadModel): number {
  return (
    a.resource.localeCompare(b.resource) ||
    (a.range?.startLineNumber || 0) - (b.range?.startLineNumber || 0) ||
    a.threadId.localeCompare(b.threadId)
  )
}

export const globalCommentService = new CodekCommentService()

registerSingleton(ICommentService, globalCommentService, InstantiationType.Delayed)

