/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/base/common/resources.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { URI, URIPath, uriToFsPath } from "./uri"

export interface IExtUri {
  compare(uri1: URI, uri2: URI, ignoreFragment?: boolean): number
  isEqual(uri1: URI | undefined, uri2: URI | undefined, ignoreFragment?: boolean): boolean
  isEqualOrParent(base: URI, parentCandidate: URI, ignoreFragment?: boolean): boolean
  getComparisonKey(uri: URI, ignoreFragment?: boolean): string
  ignorePathCasing(uri: URI): boolean
  basenameOrAuthority(resource: URI): string
  basename(resource: URI): string
  extname(resource: URI): string
  dirname(resource: URI): URI
  joinPath(resource: URI, ...pathFragment: string[]): URI
  normalizePath(resource: URI): URI
  relativePath(from: URI, to: URI): string | undefined
  resolvePath(base: URI, path: string): URI
  isAbsolutePath(resource: URI): boolean
}

export function originalFSPath(uri: URI): string {
  return uriToFsPath(uri, true)
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function isEqualAuthority(a: string | undefined, b: string | undefined): boolean {
  return a === b || Boolean(a && b && a.toLowerCase() === b.toLowerCase())
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/")
}

function normalizeForCompare(value: string, ignoreCase: boolean): string {
  const normalized = normalizeSlashes(value).replace(/\/+$/, "")
  return ignoreCase ? normalized.toLowerCase() : normalized
}

function isEqualOrParentPath(base: string, parent: string, ignoreCase: boolean): boolean {
  const normalizedBase = normalizeForCompare(base, ignoreCase)
  const normalizedParent = normalizeForCompare(parent, ignoreCase)
  return normalizedBase === normalizedParent || normalizedBase.startsWith(`${normalizedParent}/`)
}

function relativePosix(from: string, to: string): string {
  const fromParts = URIPath.normalize(from).split("/").filter(Boolean)
  const toParts = URIPath.normalize(to).split("/").filter(Boolean)
  let index = 0
  while (index < fromParts.length && index < toParts.length && fromParts[index] === toParts[index]) index++
  return [...new Array(fromParts.length - index).fill(".."), ...toParts.slice(index)].join("/")
}

function extname(path: string): string {
  const base = URIPath.basename(path)
  const index = base.lastIndexOf(".")
  return index > 0 ? base.slice(index) : ""
}

export class ExtUri implements IExtUri {
  constructor(private readonly shouldIgnorePathCasing: (uri: URI) => boolean) {}

  compare(uri1: URI, uri2: URI, ignoreFragment = false): number {
    if (uri1 === uri2) return 0
    return compareStrings(this.getComparisonKey(uri1, ignoreFragment), this.getComparisonKey(uri2, ignoreFragment))
  }

  isEqual(uri1: URI | undefined, uri2: URI | undefined, ignoreFragment = false): boolean {
    if (uri1 === uri2) return true
    if (!uri1 || !uri2) return false
    return this.getComparisonKey(uri1, ignoreFragment) === this.getComparisonKey(uri2, ignoreFragment)
  }

  isEqualOrParent(base: URI, parentCandidate: URI, ignoreFragment = false): boolean {
    if (base.scheme !== parentCandidate.scheme) return false
    if (!isEqualAuthority(base.authority, parentCandidate.authority)) return false
    if (base.query !== parentCandidate.query) return false
    if (!ignoreFragment && base.fragment !== parentCandidate.fragment) return false
    const ignoreCase = this.shouldIgnorePathCasing(base)
    const basePath = base.scheme === "file" ? originalFSPath(base) : base.path
    const parentPath = parentCandidate.scheme === "file" ? originalFSPath(parentCandidate) : parentCandidate.path
    return isEqualOrParentPath(basePath, parentPath, ignoreCase)
  }

  getComparisonKey(uri: URI, ignoreFragment = false): string {
    return uri
      .with({
        path: this.shouldIgnorePathCasing(uri) ? uri.path.toLowerCase() : uri.path,
        fragment: ignoreFragment ? null : uri.fragment,
      })
      .toString()
  }

  ignorePathCasing(uri: URI): boolean {
    return this.shouldIgnorePathCasing(uri)
  }

  basenameOrAuthority(resource: URI): string {
    return this.basename(resource) || resource.authority
  }

  basename(resource: URI): string {
    return URIPath.basename(resource.path)
  }

  extname(resource: URI): string {
    return extname(resource.path)
  }

  dirname(resource: URI): URI {
    if (!resource.path) return resource
    return resource.with({ path: URIPath.dirname(resource.path) })
  }

  joinPath(resource: URI, ...pathFragment: string[]): URI {
    return URI.joinPath(resource, ...pathFragment)
  }

  normalizePath(resource: URI): URI {
    return resource.path ? resource.with({ path: URIPath.normalize(resource.path) }) : resource
  }

  relativePath(from: URI, to: URI): string | undefined {
    if (from.scheme !== to.scheme || !isEqualAuthority(from.authority, to.authority)) return undefined
    const ignoreCase = this.shouldIgnorePathCasing(from)
    let fromPath = from.path
    let toPath = to.path
    if (ignoreCase) {
      fromPath = fromPath.toLowerCase()
      toPath = toPath.toLowerCase()
    }
    return relativePosix(fromPath || "/", toPath || "/")
  }

  resolvePath(base: URI, path: string): URI {
    const normalized = path.startsWith("/") ? URIPath.normalize(path) : URIPath.normalize(`${base.path}/${normalizeSlashes(path)}`)
    return base.with({ path: normalized })
  }

  isAbsolutePath(resource: URI): boolean {
    return Boolean(resource.path && resource.path[0] === "/")
  }
}

export const extUri = new ExtUri(() => false)
export const extUriIgnorePathCase = new ExtUri(() => true)
export const extUriBiasedIgnorePathCase = new ExtUri((uri) => uri.scheme === "file")

export const isEqual = extUri.isEqual.bind(extUri)
export const isEqualOrParent = extUri.isEqualOrParent.bind(extUri)
export const getComparisonKey = extUri.getComparisonKey.bind(extUri)
export const basenameOrAuthority = extUri.basenameOrAuthority.bind(extUri)
export const basename = extUri.basename.bind(extUri)
export const dirname = extUri.dirname.bind(extUri)
export const joinPath = extUri.joinPath.bind(extUri)
export const normalizePath = extUri.normalizePath.bind(extUri)
export const relativePath = extUri.relativePath.bind(extUri)
export const resolvePath = extUri.resolvePath.bind(extUri)
export const isAbsolutePath = extUri.isAbsolutePath.bind(extUri)

export function distinctParents<T>(items: T[], resourceAccessor: (item: T) => URI): T[] {
  const distinct: T[] = []
  for (let index = 0; index < items.length; index += 1) {
    const candidate = resourceAccessor(items[index])
    if (items.some((other, otherIndex) => otherIndex !== index && isEqualOrParent(candidate, resourceAccessor(other)))) continue
    distinct.push(items[index])
  }
  return distinct
}
