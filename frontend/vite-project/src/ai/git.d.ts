export type GitToolDef = {
  id: string
  name: string
  prompt: string
}

export const GIT_TOOLS: Record<string, GitToolDef>

export function generateCommitMessage(
  diff: string,
  model: string,
  callAi: (prompt: string) => Promise<string>,
): Promise<string>

export function reviewChanges(
  diff: string,
  model: string,
  callAi: (prompt: string) => Promise<string>,
): Promise<string>

export function resolveConflict(
  ours: string,
  theirs: string,
  base: string,
  model: string,
  callAi: (prompt: string) => Promise<string>,
): Promise<string>

export function generatePRDescription(
  diff: string,
  branchInfo: string,
  model: string,
  callAi: (prompt: string) => Promise<string>,
): Promise<string>
