/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/base/common/uri.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

const schemePattern = /^\w[\w\d+.-]*$/
const uriRegexp = /^(([^:/?#]+?):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/
const slash = "/"
const empty = ""
const isWindowsPlatform = typeof navigator !== "undefined" ? /\bWindows\b/i.test(navigator.userAgent) : true

export interface UriComponents {
  scheme: string
  authority?: string
  path?: string
  query?: string
  fragment?: string
}

interface UriState extends UriComponents {
  external?: string
  fsPath?: string
}

function validateUri(uri: URI, strict?: boolean): void {
  if (!uri.scheme && strict) {
    throw new Error(`[UriError]: Scheme is missing: ${uri.toString(true)}`)
  }
  if (uri.scheme && !schemePattern.test(uri.scheme)) {
    throw new Error(`[UriError]: Scheme contains illegal characters: ${uri.scheme}`)
  }
  if (!uri.path) return
  if (uri.authority && uri.path[0] !== slash) {
    throw new Error('[UriError]: If a URI contains an authority component, then the path component must begin with "/"')
  }
  if (!uri.authority && uri.path.startsWith("//")) {
    throw new Error("[UriError]: If a URI does not contain an authority component, then the path cannot begin with two slashes")
  }
}

function schemeFix(scheme: string, strict: boolean): string {
  return !scheme && !strict ? "file" : scheme
}

function referenceResolution(scheme: string, path: string): string {
  if ((scheme === "https" || scheme === "http" || scheme === "file") && path && path[0] !== slash) {
    return `${slash}${path}`
  }
  if ((scheme === "https" || scheme === "http" || scheme === "file") && !path) {
    return slash
  }
  return path
}

function percentDecode(value: string): string {
  if (!/%[0-9A-Fa-f][0-9A-Fa-f]/.test(value)) return value
  try {
    return decodeURIComponent(value)
  } catch {
    return value.replace(/(%[0-9A-Fa-f][0-9A-Fa-f])+/g, (match) => {
      try {
        return decodeURIComponent(match)
      } catch {
        return match
      }
    })
  }
}

function encodePath(value: string, skipEncoding: boolean): string {
  if (skipEncoding) return value.replace(/[?#]/g, (match) => (match === "?" ? "%3F" : "%23"))
  return encodeURI(value).replace(/[?#]/g, (match) => (match === "?" ? "%3F" : "%23"))
}

function encodeComponent(value: string, skipEncoding: boolean): string {
  return skipEncoding ? value : encodeURIComponent(value)
}

function normalizeWindowsDrivePath(path: string): string {
  if (path.length >= 3 && path.charCodeAt(0) === 47 && path.charCodeAt(2) === 58) {
    const drive = path.charCodeAt(1)
    if (drive >= 65 && drive <= 90) return `/${String.fromCharCode(drive + 32)}:${path.slice(3)}`
  }
  if (path.length >= 2 && path.charCodeAt(1) === 58) {
    const drive = path.charCodeAt(0)
    if (drive >= 65 && drive <= 90) return `${String.fromCharCode(drive + 32)}:${path.slice(2)}`
  }
  return path
}

function formatUri(uri: URI, skipEncoding: boolean): string {
  let result = ""
  const scheme = uri.scheme
  let authority = uri.authority
  let path = normalizeWindowsDrivePath(uri.path)

  if (scheme) result += `${scheme}:`
  if (authority || scheme === "file") result += "//"
  if (authority) {
    authority = authority.toLowerCase()
    const at = authority.indexOf("@")
    if (at >= 0) {
      result += `${encodeComponent(authority.slice(0, at), skipEncoding)}@`
      authority = authority.slice(at + 1)
    }
    result += encodeURI(authority)
  }
  if (path) result += encodePath(path, skipEncoding)
  if (uri.query) result += `?${encodeComponent(uri.query, skipEncoding)}`
  if (uri.fragment) result += `#${encodeComponent(uri.fragment, skipEncoding)}`
  return result
}

function posixNormalize(path: string): string {
  const isAbsolute = path.startsWith("/")
  const trailing = path.endsWith("/")
  const segments = path.split("/")
  const result: string[] = []
  for (const segment of segments) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (result.length && result[result.length - 1] !== "..") result.pop()
      else if (!isAbsolute) result.push(segment)
      continue
    }
    result.push(segment)
  }
  let normalized = `${isAbsolute ? "/" : ""}${result.join("/")}`
  if (trailing && normalized !== "/") normalized += "/"
  return normalized || (isAbsolute ? "/" : ".")
}

function posixDirname(path: string): string {
  const normalized = posixNormalize(path)
  if (normalized === "/") return "/"
  const index = normalized.lastIndexOf("/")
  if (index <= 0) return normalized.startsWith("/") ? "/" : "."
  return normalized.slice(0, index)
}

function posixBasename(path: string): string {
  const normalized = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path
  const index = normalized.lastIndexOf("/")
  return index >= 0 ? normalized.slice(index + 1) : normalized
}

export function uriToFsPath(uri: URI, keepDriveLetterCasing: boolean): string {
  let value: string
  if (uri.authority && uri.path.length > 1 && uri.scheme === "file") {
    value = `//${uri.authority}${uri.path}`
  } else if (/^\/[a-zA-Z]:/.test(uri.path)) {
    value = keepDriveLetterCasing ? uri.path.slice(1) : `${uri.path[1].toLowerCase()}${uri.path.slice(2)}`
  } else {
    value = uri.path
  }
  return isWindowsPlatform ? value.replace(/\//g, "\\") : value
}

export function isUriComponents(value: unknown): value is UriComponents {
  const candidate = value as UriComponents | null
  return Boolean(candidate && typeof candidate.scheme === "string")
}

export class URI implements UriComponents {
  readonly scheme: string
  readonly authority: string
  readonly path: string
  readonly query: string
  readonly fragment: string

  protected constructor(components: UriComponents)
  protected constructor(scheme: string, authority?: string, path?: string, query?: string, fragment?: string, strict?: boolean)
  protected constructor(
    schemeOrComponents: string | UriComponents,
    authority = empty,
    path = empty,
    query = empty,
    fragment = empty,
    strict = false,
  ) {
    if (typeof schemeOrComponents === "object") {
      this.scheme = schemeOrComponents.scheme || empty
      this.authority = schemeOrComponents.authority || empty
      this.path = schemeOrComponents.path || empty
      this.query = schemeOrComponents.query || empty
      this.fragment = schemeOrComponents.fragment || empty
    } else {
      this.scheme = schemeFix(schemeOrComponents, strict)
      this.authority = authority || empty
      this.path = referenceResolution(this.scheme, path || empty)
      this.query = query || empty
      this.fragment = fragment || empty
      validateUri(this, strict)
    }
  }

  static isUri(value: unknown): value is URI {
    const candidate = value as URI | null
    return Boolean(
      candidate &&
      typeof candidate.scheme === "string" &&
      typeof candidate.authority === "string" &&
      typeof candidate.path === "string" &&
      typeof candidate.query === "string" &&
      typeof candidate.fragment === "string" &&
      typeof candidate.fsPath === "string" &&
      typeof candidate.with === "function" &&
      typeof candidate.toString === "function",
    )
  }

  static parse(value: string, strict = false): URI {
    const match = uriRegexp.exec(value)
    if (!match) return new Uri(empty, empty, empty, empty, empty)
    return new Uri(
      match[2] || empty,
      percentDecode(match[4] || empty),
      percentDecode(match[5] || empty),
      percentDecode(match[7] || empty),
      percentDecode(match[9] || empty),
      strict,
    )
  }

  static file(path: string): URI {
    let authority = empty
    path = path.replace(/\\/g, slash)
    if (path[0] === slash && path[1] === slash) {
      const index = path.indexOf(slash, 2)
      if (index === -1) {
        authority = path.slice(2)
        path = slash
      } else {
        authority = path.slice(2, index)
        path = path.slice(index) || slash
      }
    }
    return new Uri("file", authority, path, empty, empty)
  }

  static from(components: UriComponents, strict = false): URI {
    return new Uri(components.scheme, components.authority, components.path, components.query, components.fragment, strict)
  }

  static revive(data: UriComponents | URI): URI
  static revive(data: UriComponents | URI | undefined): URI | undefined
  static revive(data: UriComponents | URI | null): URI | null
  static revive(data: UriComponents | URI | undefined | null): URI | undefined | null {
    if (data === undefined) return undefined
    if (data === null) return null
    if (data instanceof URI) return data
    const result = new Uri(data)
    result.formatted = (data as UriState).external ?? null
    result.cachedFsPath = (data as UriState).fsPath ?? null
    return result
  }

  static joinPath(uri: URI, ...pathFragment: string[]): URI {
    if (!uri.path) throw new Error(`[UriError]: cannot call joinPath on URI without path: ${uri.toString()}`)
    const joined = posixNormalize([uri.path, ...pathFragment].join("/"))
    return uri.with({ path: joined })
  }

  get fsPath(): string {
    return uriToFsPath(this, false)
  }

  with(change: { scheme?: string | null; authority?: string | null; path?: string | null; query?: string | null; fragment?: string | null }): URI {
    if (!change) return this
    const scheme = change.scheme === undefined ? this.scheme : change.scheme ?? empty
    const authority = change.authority === undefined ? this.authority : change.authority ?? empty
    const path = change.path === undefined ? this.path : change.path ?? empty
    const query = change.query === undefined ? this.query : change.query ?? empty
    const fragment = change.fragment === undefined ? this.fragment : change.fragment ?? empty
    if (scheme === this.scheme && authority === this.authority && path === this.path && query === this.query && fragment === this.fragment) return this
    return new Uri(scheme, authority, path, query, fragment)
  }

  toString(skipEncoding = false): string {
    return formatUri(this, skipEncoding)
  }

  toJSON(): UriComponents {
    return {
      scheme: this.scheme,
      authority: this.authority || undefined,
      path: this.path || undefined,
      query: this.query || undefined,
      fragment: this.fragment || undefined,
    }
  }
}

class Uri extends URI {
  formatted: string | null = null
  cachedFsPath: string | null = null

  override get fsPath(): string {
    this.cachedFsPath ??= uriToFsPath(this, false)
    return this.cachedFsPath
  }

  override toString(skipEncoding = false): string {
    if (skipEncoding) return formatUri(this, true)
    this.formatted ??= formatUri(this, false)
    return this.formatted
  }

  override toJSON(): UriComponents {
    const result = super.toJSON() as UriState
    if (this.formatted) result.external = this.formatted
    if (this.cachedFsPath) result.fsPath = this.cachedFsPath
    return result
  }
}

export const URIPath = {
  basename: posixBasename,
  dirname: posixDirname,
  normalize: posixNormalize,
}

export type UriDto<T> = { [K in keyof T]: T[K] extends URI ? UriComponents : UriDto<T[K]> }
