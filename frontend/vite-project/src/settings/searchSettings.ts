import { match } from "../vscode-adapter/base/common/glob"

export interface SearchSettings {
  include: string[]
  exclude: string[]
}

export type SettingsRecord = Record<string, unknown>

export function getSearchSettings(settings: SettingsRecord): SearchSettings {
  return {
    include: parseSearchPatternInput(settings["search.include"]),
    exclude: parseSearchPatternInput(settings["search.exclude"]),
  }
}

export function parseSearchPatternInput(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((item) => String(item).trim())
      .filter(Boolean)
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

export function matchesSearchSettings(path: string, settings: SearchSettings): boolean {
  const normalizedPath = normalizePath(path)
  const includePatterns = settings.include.filter((pattern) => pattern !== "*")
  const included =
    includePatterns.length === 0 ||
    includePatterns.some((pattern) => matchesPattern(normalizedPath, pattern))
  if (!included) return false
  return !settings.exclude.some((pattern) => matchesPattern(normalizedPath, pattern))
}

function matchesPattern(path: string, pattern: string): boolean {
  const normalizedPattern = normalizePath(pattern)
  if (!normalizedPattern || normalizedPattern === "*") return true
  if (!hasGlobSyntax(normalizedPattern)) {
    return path === normalizedPattern || path.includes(`/${normalizedPattern}/`) || path.startsWith(`${normalizedPattern}/`)
  }
  return match(normalizedPattern, path)
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "")
}

function hasGlobSyntax(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern)
}
