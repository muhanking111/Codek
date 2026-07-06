import type { ScmProviderSnapshot, ScmResource } from "./scmRegistry"

export interface ScmDecoration {
  status: string
  groupId: string
  providerId: string
  rootUri: string
  label: string
  tooltip: string
  aggregate?: boolean
  strikeThrough?: boolean
  faded?: boolean
  sourceUri?: string
  resourceUri?: string
  contextValue?: string
  readonlyEvidence?: boolean
}

export type ScmDecorationMap = Record<string, ScmDecoration>

export function buildScmDecorationMap(providers: readonly ScmProviderSnapshot[]): ScmDecorationMap {
  const result: ScmDecorationMap = {}
  for (const provider of providers) {
    const root = normalizePath(provider.rootUri)
    for (const group of provider.groups) {
      for (const resource of group.resources) {
        const decoration = toDecoration(provider, group.id, resource)
        const relativePath = normalizePath(resource.path)
        addDecoration(result, relativePath, decoration)
        if (root) addDecoration(result, `${root}/${relativePath}`, decoration)
        if (resource.resourceUri) addDecoration(result, normalizePath(resource.resourceUri), decoration)
        if (resource.sourceUri) addDecoration(result, normalizePath(resource.sourceUri), decoration)
        addParentDecorations(result, provider, group.id, relativePath, decoration)
      }
    }
  }
  return result
}

function addDecoration(result: ScmDecorationMap, path: string, decoration: ScmDecoration): void {
  const normalized = normalizePath(path)
  if (!normalized) return
  result[normalized] = decoration
}

function toDecoration(provider: ScmProviderSnapshot, groupId: string, resource: ScmResource): ScmDecoration {
  const status = resource.status || "M"
  const tooltip = resource.tooltip || `${provider.label}: ${statusLabel(status)} (${groupId})`
  return {
    status,
    groupId,
    providerId: provider.providerId,
    rootUri: provider.rootUri,
    label: resource.label || status,
    tooltip,
    sourceUri: resource.sourceUri,
    resourceUri: resource.resourceUri,
    contextValue: resource.contextValue,
    readonlyEvidence: resource.readonlyEvidence === true,
    strikeThrough: resource.status === "D",
    faded: groupId === "staged",
  }
}

function addParentDecorations(
  result: ScmDecorationMap,
  provider: ScmProviderSnapshot,
  groupId: string,
  relativePath: string,
  decoration: ScmDecoration,
): void {
  const parts = normalizePath(relativePath).split("/").filter(Boolean)
  parts.pop()
  for (let index = 1; index <= parts.length; index += 1) {
    const parent = parts.slice(0, index).join("/")
    if (!parent || result[parent]) continue
    const aggregate = {
      ...decoration,
      groupId,
      aggregate: true,
      tooltip: `${provider.label}: 子文件包含 ${statusLabel(decoration.status)}`,
      strikeThrough: false,
      faded: decoration.faded === true,
    }
    addDecoration(result, parent, aggregate)
    if (provider.rootUri) addDecoration(result, `${normalizePath(provider.rootUri)}/${parent}`, aggregate)
  }
}

function statusLabel(status: string): string {
  if (status === "??") return "未跟踪"
  if (status === "A") return "新增"
  if (status === "D") return "删除"
  if (status === "R") return "重命名"
  if (status === "U") return "冲突"
  return "修改"
}

function normalizePath(value: string): string {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "")
}
