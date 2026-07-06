import { computed, reactive, shallowRef } from "vue"
import { api } from "../lib/api"
import { getGitSettings } from "../settings/gitSettings"
import { settingsStore } from "../settings/settingsStore"
import { registerOrUpdateGitProvider, unregisterScmProvider } from "../scm/scmRegistry"

export interface GitFileStatus {
  path: string
  status: "M" | "A" | "D" | "??" | "R" | "U"
  staged: boolean
  oldPath?: string
}

export interface GitStatusSummary {
  rootUri?: string
  branch: string
  changes: GitFileStatus[]
  staged: GitFileStatus[]
  ahead: number
  behind: number
  repoName: string
  conflicts?: GitFileStatus[]
}

export interface GitBranch {
  name: string
  current: boolean
}

export interface GitTag {
  name: string
  message: string
}

export interface GitRemote {
  name: string
  url: string
}

export interface GitConflict {
  path: string
}

export interface GitOperationResult {
  success: boolean
  output: string
  error: string
}

export interface DiffResult {
  path: string
  diff: string
}

async function apiPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  return api.post(path, body)
}

const state = reactive({
  status: null as GitStatusSummary | null,
  repositories: [] as GitStatusSummary[],
  branches: [] as GitBranch[],
  hasRepo: false,
  loading: false,
  error: "",
})

let projectRoot = ""
let workspaceRoots: string[] = []
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let refreshInterval: ReturnType<typeof setInterval> | null = null

function currentSettings() {
  return getGitSettings(settingsStore.getAll())
}

export function setProjectRoot(root: string): void {
  projectRoot = root
  workspaceRoots = root ? [root] : []
}

export function getProjectRoot(): string {
  return projectRoot
}

export function setWorkspaceRoots(roots: string[]): void {
  workspaceRoots = [...new Set((roots || []).filter(Boolean))]
  projectRoot = workspaceRoots[0] || ""
}

export function getWorkspaceRoots(): string[] {
  return workspaceRoots.length ? [...workspaceRoots] : (projectRoot ? [projectRoot] : [])
}

export const currentBranch = shallowRef("")

const statusComputed = computed(() => state.status)
const repositoriesComputed = computed(() => state.repositories)
const branchesComputed = computed(() => state.branches)
const hasRepoComputed = computed(() => state.hasRepo)
const loadingComputed = computed(() => state.loading)
const errorComputed = computed(() => state.error)

function baseBody(root = projectRoot): Record<string, unknown> {
  return { projectRoot: root }
}

const STATUS_DEBOUNCE_MS = 300

async function checkRepo(root = projectRoot): Promise<boolean> {
  if (!root) return false
  try {
    const res = (await apiPost("/api/git/isRepo", { projectRoot: root })) as { isRepo: boolean }
    return Boolean(res.isRepo)
  } catch {
    return false
  }
}

async function fetchStatus(): Promise<void> {
  const gitSettings = currentSettings()
  if (!gitSettings.enabled) {
    state.hasRepo = false
    state.status = null
    state.repositories = []
    state.loading = false
    state.error = ""
    currentBranch.value = ""
    unregisterScmProvider(`git:${projectRoot}`)
    return
  }
  if (!projectRoot) {
    state.hasRepo = false
    state.status = null
    state.repositories = []
    unregisterScmProvider(`git:${projectRoot}`)
    return
  }
  state.loading = true
  state.error = ""
  try {
    const roots = getWorkspaceRoots()
    const repoSummaries: GitStatusSummary[] = []
    for (const root of roots) {
      const hasRepo = await checkRepo(root)
      if (!hasRepo) {
        unregisterScmProvider(`git:${root}`)
        continue
      }
      const data = (await apiPost("/api/git/status", { projectRoot: root })) as GitStatusSummary
      data.rootUri = root
      repoSummaries.push(data)
      registerOrUpdateGitProvider(root, data)
    }

    if (repoSummaries.length === 0) {
      state.hasRepo = false
      state.status = null
      state.repositories = []
      state.loading = false
      unregisterScmProvider(`git:${projectRoot}`)
      return
    }
    state.hasRepo = true
    state.repositories = repoSummaries
    const data = repoSummaries[0]
    state.status = data
    currentBranch.value = data.branch || ""
    state.error = ""
  } catch (err) {
    state.error = err instanceof Error ? err.message : "获取 Git 状态失败"
    state.status = null
  } finally {
    state.loading = false
  }
}

function debouncedFetchStatus(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void fetchStatus()
  }, STATUS_DEBOUNCE_MS)
}

async function fetchBranches(root = projectRoot): Promise<void> {
  if (!currentSettings().enabled) {
    state.branches = []
    return
  }
  if (!root) return
  try {
    const data = (await apiPost("/api/git/branches", baseBody(root))) as { branches: GitBranch[] }
    state.branches = data.branches || []
  } catch {
    state.branches = []
  }
}

async function checkoutBranch(branch: string, root = projectRoot): Promise<boolean> {
  if (!root) return false
  try {
    await apiPost("/api/git/checkout", { ...baseBody(root), branch })
    await fetchStatus()
    await fetchBranches(root)
    return true
  } catch (err) {
    state.error = err instanceof Error ? err.message : "切换分支失败"
    return false
  }
}

async function stageFile(filePath: string, root = projectRoot): Promise<void> {
  if (!root) return
  try {
    await apiPost("/api/git/stage", { ...baseBody(root), file: filePath })
    await debouncedFetchStatus()
  } catch (err) {
    state.error = err instanceof Error ? err.message : "暂存文件失败"
  }
}

async function unstageFile(filePath: string, root = projectRoot): Promise<void> {
  if (!root) return
  try {
    await apiPost("/api/git/unstage", { ...baseBody(root), file: filePath })
    await debouncedFetchStatus()
  } catch (err) {
    state.error = err instanceof Error ? err.message : "取消暂存失败"
  }
}

async function stageAll(root = projectRoot): Promise<void> {
  if (!root) return
  try {
    await apiPost("/api/git/stageAll", baseBody(root))
    await debouncedFetchStatus()
  } catch (err) {
    state.error = err instanceof Error ? err.message : "暂存所有文件失败"
  }
}

async function commit(message: string, root = projectRoot): Promise<boolean> {
  if (!root || !message.trim()) return false
  try {
    if (currentSettings().autoStage) {
      await apiPost("/api/git/stageAll", baseBody(root))
    }
    await apiPost("/api/git/commit", { ...baseBody(root), message: message.trim() })
    await debouncedFetchStatus()
    return true
  } catch (err) {
    state.error = err instanceof Error ? err.message : "提交失败"
    return false
  }
}

async function push(root = projectRoot): Promise<boolean> {
  if (!root) return false
  try {
    await apiPost("/api/git/push", baseBody(root))
    await debouncedFetchStatus()
    return true
  } catch (err) {
    state.error = err instanceof Error ? err.message : "推送失败"
    return false
  }
}

async function pull(root = projectRoot): Promise<boolean> {
  if (!root) return false
  try {
    await apiPost("/api/git/pull", baseBody(root))
    await debouncedFetchStatus()
    return true
  } catch (err) {
    state.error = err instanceof Error ? err.message : "拉取失败"
    return false
  }
}

async function discardFile(filePath: string, untracked = false, root = projectRoot): Promise<GitOperationResult> {
  if (!root) return { success: false, output: "", error: "未设置项目根目录" }
  try {
    const res = (await apiPost(untracked ? "/api/git/discardUntracked" : "/api/git/discard", {
      ...baseBody(root),
      file: filePath,
    })) as GitOperationResult
    await fetchStatus()
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : "丢弃更改失败"
    state.error = msg
    return { success: false, output: "", error: msg }
  }
}

async function stashChanges(root = projectRoot): Promise<GitOperationResult> {
  if (!root) return { success: false, output: "", error: "未设置项目根目录" }
  try {
    const res = (await apiPost("/api/git/stash", baseBody(root))) as GitOperationResult
    await fetchStatus()
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : "储藏更改失败"
    state.error = msg
    return { success: false, output: "", error: msg }
  }
}

async function stashPopChanges(root = projectRoot): Promise<GitOperationResult> {
  if (!root) return { success: false, output: "", error: "未设置项目根目录" }
  try {
    const res = (await apiPost("/api/git/stashPop", baseBody(root))) as GitOperationResult
    await fetchStatus()
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : "恢复储藏失败"
    state.error = msg
    return { success: false, output: "", error: msg }
  }
}

async function getDiff(filePath: string, root = projectRoot): Promise<DiffResult | null> {
  if (!root) return null
  try {
    return (await apiPost("/api/git/diff", {
      ...baseBody(root),
      file: filePath,
    })) as DiffResult
  } catch (err) {
    state.error = err instanceof Error ? err.message : "获取差异失败"
    return null
  }
}

function startAutoRefresh(intervalMs: number = 5000): void {
  stopAutoRefresh()
  if (!currentSettings().enabled || !currentSettings().autofetch) return
  refreshInterval = setInterval(() => {
    if (!currentSettings().enabled || !currentSettings().autofetch) {
      stopAutoRefresh()
      return
    }
    void fetchStatus()
  }, intervalMs)
}

function stopAutoRefresh(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
}

function clearError(): void {
  state.error = ""
}

async function merge(sourceBranch: string, targetBranch: string, root = projectRoot): Promise<GitOperationResult> {
  if (!root) return { success: false, output: "", error: "未设置项目根目录" }
  try {
    const res = (await apiPost("/api/git/merge", {
      ...baseBody(root),
      sourceBranch,
      targetBranch,
    })) as GitOperationResult
    await fetchStatus()
    await fetchBranches(root)
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : "合并失败"
    state.error = msg
    return { success: false, output: "", error: msg }
  }
}

async function rebase(branch: string, root = projectRoot): Promise<GitOperationResult> {
  if (!root) return { success: false, output: "", error: "未设置项目根目录" }
  try {
    const res = (await apiPost("/api/git/rebase", {
      ...baseBody(root),
      branch,
    })) as GitOperationResult
    await fetchStatus()
    await fetchBranches(root)
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : "变基失败"
    state.error = msg
    return { success: false, output: "", error: msg }
  }
}

async function cherryPick(commitHash: string, root = projectRoot): Promise<GitOperationResult> {
  if (!root) return { success: false, output: "", error: "未设置项目根目录" }
  try {
    const res = (await apiPost("/api/git/cherryPick", {
      ...baseBody(root),
      commitHash,
    })) as GitOperationResult
    await fetchStatus()
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : "摘取提交失败"
    state.error = msg
    return { success: false, output: "", error: msg }
  }
}

async function reset(commitHash: string, mode: string, root = projectRoot): Promise<GitOperationResult> {
  if (!root) return { success: false, output: "", error: "未设置项目根目录" }
  try {
    const res = (await apiPost("/api/git/reset", {
      ...baseBody(root),
      commitHash,
      mode,
    })) as GitOperationResult
    await fetchStatus()
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : "重置失败"
    state.error = msg
    return { success: false, output: "", error: msg }
  }
}

async function revert(commitHash: string, root = projectRoot): Promise<GitOperationResult> {
  if (!root) return { success: false, output: "", error: "未设置项目根目录" }
  try {
    const res = (await apiPost("/api/git/revert", {
      ...baseBody(root),
      commitHash,
    })) as GitOperationResult
    await fetchStatus()
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : "撤销提交失败"
    state.error = msg
    return { success: false, output: "", error: msg }
  }
}

async function createTag(tagName: string, message: string, root = projectRoot): Promise<GitOperationResult> {
  if (!root) return { success: false, output: "", error: "未设置项目根目录" }
  try {
    const res = (await apiPost("/api/git/tag", {
      ...baseBody(root),
      tagName,
      message,
    })) as GitOperationResult
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : "创建标签失败"
    state.error = msg
    return { success: false, output: "", error: msg }
  }
}

async function fetchTags(root = projectRoot): Promise<GitTag[]> {
  if (!root) return []
  try {
    const res = (await apiPost("/api/git/tags", baseBody(root))) as { tags: GitTag[] }
    return res.tags || []
  } catch {
    return []
  }
}

async function fetchRemotes(root = projectRoot): Promise<GitRemote[]> {
  if (!root) return []
  try {
    const res = (await apiPost("/api/git/remotes", baseBody(root))) as { remotes: GitRemote[] }
    return res.remotes || []
  } catch {
    return []
  }
}

async function addRemote(name: string, url: string, root = projectRoot): Promise<GitOperationResult> {
  if (!root) return { success: false, output: "", error: "未设置项目根目录" }
  try {
    const res = (await apiPost("/api/git/remoteAdd", {
      ...baseBody(root),
      name,
      url,
    })) as GitOperationResult
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : "添加远程仓库失败"
    state.error = msg
    return { success: false, output: "", error: msg }
  }
}

async function removeRemote(name: string, root = projectRoot): Promise<GitOperationResult> {
  if (!root) return { success: false, output: "", error: "未设置项目根目录" }
  try {
    const res = (await apiPost("/api/git/remoteRemove", {
      ...baseBody(root),
      name,
    })) as GitOperationResult
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : "删除远程仓库失败"
    state.error = msg
    return { success: false, output: "", error: msg }
  }
}

async function fetchMergeConflicts(root = projectRoot): Promise<GitConflict[]> {
  if (!root) return []
  try {
    const res = (await apiPost("/api/git/mergeConflicts", baseBody(root))) as { conflicts: GitConflict[] }
    return res.conflicts || []
  } catch {
    return []
  }
}

async function resolveConflict(filePath: string, resolvedContent: string, root = projectRoot): Promise<GitOperationResult> {
  if (!root) return { success: false, output: "", error: "未设置项目根目录" }
  try {
    const res = (await apiPost("/api/git/resolveConflict", {
      ...baseBody(root),
      filePath,
      resolvedContent,
    })) as GitOperationResult
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : "解决冲突失败"
    state.error = msg
    return { success: false, output: "", error: msg }
  }
}

export const gitState = {
  status: statusComputed,
  repositories: repositoriesComputed,
  branches: branchesComputed,
  currentBranch,
  hasRepo: hasRepoComputed,
  loading: loadingComputed,
  error: errorComputed,
  setProjectRoot,
  setWorkspaceRoots,
  getProjectRoot,
  getWorkspaceRoots,
  fetchStatus,
  fetchBranches,
  checkoutBranch,
  stageFile,
  unstageFile,
  stageAll,
  commit,
  push,
  pull,
  discardFile,
  stashChanges,
  stashPopChanges,
  getDiff,
  startAutoRefresh,
  stopAutoRefresh,
  clearError,
  merge,
  rebase,
  cherryPick,
  reset,
  revert,
  createTag,
  fetchTags,
  fetchRemotes,
  addRemote,
  removeRemote,
  fetchMergeConflicts,
  resolveConflict,
}
