/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IRelativePattern {
  readonly base: string
  readonly pattern: string
}

export interface IExpression {
  [pattern: string]: boolean | { when: string }
}

export interface IGlobOptions {
  ignoreCase?: boolean
}

export type ParsedPattern = (path: string, basename?: string) => boolean
export type ParsedExpression = (path: string, basename?: string) => boolean

export const GLOBSTAR = "**"
export const GLOB_SPLIT = "/"

const PATH_REGEX = "[/\\\\]"
const NO_PATH_REGEX = "[^/\\\\]"

function escapeRegExpCharacters(value: string): string {
  return value.replace(/[\\{}*+?.^$|()[\]\s#-]/g, "\\$&")
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "")
}

function basename(value: string): string {
  const normalized = normalizePath(value)
  const index = normalized.lastIndexOf("/")
  return index >= 0 ? normalized.slice(index + 1) : normalized
}

function starsToRegExp(starCount: number, isLastPattern?: boolean): string {
  switch (starCount) {
    case 0:
      return ""
    case 1:
      return `${NO_PATH_REGEX}*?`
    default:
      return `(?:${PATH_REGEX}|${NO_PATH_REGEX}+${PATH_REGEX}${isLastPattern ? `|${PATH_REGEX}${NO_PATH_REGEX}+` : ""})*?`
  }
}

export function splitGlobAware(pattern: string, splitChar: string): string[] {
  if (!pattern) return []

  const segments: string[] = []
  let inBraces = false
  let inBrackets = false
  let current = ""

  for (const char of pattern) {
    if (char === splitChar && !inBraces && !inBrackets) {
      segments.push(current)
      current = ""
      continue
    }
    if (char === "{") inBraces = true
    else if (char === "}") inBraces = false
    else if (char === "[") inBrackets = true
    else if (char === "]") inBrackets = false
    current += char
  }

  if (current) segments.push(current)
  return segments
}

function parseRegExp(pattern: string): string {
  if (!pattern) return ""

  const segments = splitGlobAware(normalizePath(pattern), GLOB_SPLIT)
  if (segments.every((segment) => segment === GLOBSTAR)) return ".*"

  let regExp = ""
  let previousSegmentWasGlobStar = false

  segments.forEach((segment, index) => {
    if (segment === GLOBSTAR) {
      if (previousSegmentWasGlobStar) return
      regExp += starsToRegExp(2, index === segments.length - 1)
      previousSegmentWasGlobStar = true
      return
    }

    let inBraces = false
    let braceValue = ""
    let inBrackets = false
    let bracketValue = ""

    for (const char of segment) {
      if (char !== "}" && inBraces) {
        braceValue += char
        continue
      }

      if (inBrackets && (char !== "]" || !bracketValue)) {
        if (char === "-") bracketValue += char
        else if ((char === "^" || char === "!") && !bracketValue) bracketValue += "^"
        else if (char !== GLOB_SPLIT) bracketValue += escapeRegExpCharacters(char)
        continue
      }

      switch (char) {
        case "{":
          inBraces = true
          continue
        case "}": {
          const choices = splitGlobAware(braceValue, ",").map((choice) => parseRegExp(choice))
          regExp += `(?:${choices.join("|")})`
          inBraces = false
          braceValue = ""
          continue
        }
        case "[":
          inBrackets = true
          bracketValue = ""
          continue
        case "]":
          regExp += bracketValue ? `[${bracketValue}]` : "\\]"
          inBrackets = false
          bracketValue = ""
          continue
        case "?":
          regExp += NO_PATH_REGEX
          continue
        case "*":
          regExp += starsToRegExp(1)
          continue
        default:
          regExp += escapeRegExpCharacters(char)
      }
    }

    if (inBraces) regExp += escapeRegExpCharacters(`{${braceValue}`)
    if (inBrackets) regExp += escapeRegExpCharacters(`[${bracketValue}`)

    if (index < segments.length - 1 && (segments[index + 1] !== GLOBSTAR || index + 2 < segments.length)) {
      regExp += PATH_REGEX
    }
    previousSegmentWasGlobStar = false
  })

  return regExp
}

export function isRelativePattern(obj: unknown): obj is IRelativePattern {
  const candidate = obj as IRelativePattern | null | undefined
  return Boolean(candidate && typeof candidate.base === "string" && typeof candidate.pattern === "string")
}

export function parse(pattern: string | IRelativePattern, options?: IGlobOptions): ParsedPattern
export function parse(expression: IExpression, options?: IGlobOptions): ParsedExpression
export function parse(arg1: string | IExpression | IRelativePattern, options: IGlobOptions = {}): ParsedPattern | ParsedExpression {
  if (!arg1) return () => false

  if (typeof arg1 === "string" || isRelativePattern(arg1)) {
    const pattern = typeof arg1 === "string" ? arg1 : arg1.pattern
    const base = typeof arg1 === "string" ? "" : normalizePath(arg1.base)
    const normalizedPattern = normalizePath(pattern)
    const regex = new RegExp(`^${parseRegExp(normalizedPattern)}$`, options.ignoreCase === false ? undefined : "i")
    return (path: string, providedBasename?: string) => {
      if (typeof path !== "string") return false
      const normalizedPath = normalizePath(path)
      const relativePath = base && normalizedPath.startsWith(`${base}/`) ? normalizedPath.slice(base.length + 1) : normalizedPath
      regex.lastIndex = 0
      if (regex.test(relativePath)) return true
      if (!normalizedPattern.includes("/")) {
        regex.lastIndex = 0
        return regex.test(providedBasename || basename(relativePath))
      }
      return false
    }
  }

  const parsed = Object.entries(arg1)
    .filter(([, value]) => value !== false)
    .map(([pattern]) => parse(pattern, options))
  return (path: string, providedBasename?: string) => parsed.some((matcher) => matcher(path, providedBasename))
}

export function match(pattern: string | IRelativePattern, path: string, options?: IGlobOptions): boolean
export function match(expression: IExpression, path: string, options?: IGlobOptions): boolean
export function match(arg1: string | IExpression | IRelativePattern, path: string, options?: IGlobOptions): boolean {
  return parse(arg1 as string, options)(path)
}
