/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/base/common/comparers.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Lazy } from "./lazy"

type CollatorState = {
  collator: Intl.Collator
  collatorIsNumeric?: boolean
}

const intlFileNameCollatorBaseNumeric = new Lazy<CollatorState>(() => {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
  return {
    collator,
    collatorIsNumeric: collator.resolvedOptions().numeric,
  }
})

const intlFileNameCollatorNumeric = new Lazy<CollatorState>(() => ({
  collator: new Intl.Collator(undefined, { numeric: true }),
}))

const intlFileNameCollatorNumericCaseInsensitive = new Lazy<CollatorState>(() => ({
  collator: new Intl.Collator(undefined, { numeric: true, sensitivity: "accent" }),
}))

export function compareFileNames(one: string | null, other: string | null, caseSensitive = false): number {
  const a = one || ""
  const b = other || ""
  const result = intlFileNameCollatorBaseNumeric.value.collator.compare(
    caseSensitive ? a : a.toLocaleLowerCase(),
    caseSensitive ? b : b.toLocaleLowerCase(),
  )

  if (intlFileNameCollatorBaseNumeric.value.collatorIsNumeric && result === 0 && a !== b) {
    return a < b ? -1 : 1
  }

  return result
}

export function compareFileNamesDefault(one: string | null, other: string | null): number {
  const collatorNumeric = intlFileNameCollatorNumeric.value.collator
  return compareAndDisambiguateByLength(collatorNumeric, one || "", other || "")
}

export function compareFileNamesUpper(one: string | null, other: string | null): number {
  const a = one || ""
  const b = other || ""
  return compareCaseUpperFirst(a, b) || compareAndDisambiguateByLength(intlFileNameCollatorNumeric.value.collator, a, b)
}

export function compareFileNamesLower(one: string | null, other: string | null): number {
  const a = one || ""
  const b = other || ""
  return compareCaseLowerFirst(a, b) || compareAndDisambiguateByLength(intlFileNameCollatorNumeric.value.collator, a, b)
}

export function compareFileNamesUnicode(one: string | null, other: string | null): number {
  const a = one || ""
  const b = other || ""
  if (a === b) return 0
  return a < b ? -1 : 1
}

export function compareFileExtensions(one: string | null, other: string | null): number {
  const [oneName, oneExtension] = extractNameAndExtension(one)
  const [otherName, otherExtension] = extractNameAndExtension(other)

  let result = intlFileNameCollatorBaseNumeric.value.collator.compare(oneExtension, otherExtension)

  if (result === 0) {
    if (intlFileNameCollatorBaseNumeric.value.collatorIsNumeric && oneExtension !== otherExtension) {
      return oneExtension < otherExtension ? -1 : 1
    }

    result = intlFileNameCollatorBaseNumeric.value.collator.compare(oneName, otherName)
    if (intlFileNameCollatorBaseNumeric.value.collatorIsNumeric && result === 0 && oneName !== otherName) {
      return oneName < otherName ? -1 : 1
    }
  }

  return result
}

export function compareFileExtensionsDefault(one: string | null, other: string | null): number {
  const a = one || ""
  const b = other || ""
  const oneExtension = extractExtension(a)
  const otherExtension = extractExtension(b)
  return compareAndDisambiguateByLength(intlFileNameCollatorNumericCaseInsensitive.value.collator, oneExtension, otherExtension)
    || compareAndDisambiguateByLength(intlFileNameCollatorNumeric.value.collator, a, b)
}

export function compareFileExtensionsUpper(one: string | null, other: string | null): number {
  const a = one || ""
  const b = other || ""
  const oneExtension = extractExtension(a)
  const otherExtension = extractExtension(b)
  return compareAndDisambiguateByLength(intlFileNameCollatorNumericCaseInsensitive.value.collator, oneExtension, otherExtension)
    || compareCaseUpperFirst(a, b)
    || compareAndDisambiguateByLength(intlFileNameCollatorNumeric.value.collator, a, b)
}

export function compareFileExtensionsLower(one: string | null, other: string | null): number {
  const a = one || ""
  const b = other || ""
  const oneExtension = extractExtension(a)
  const otherExtension = extractExtension(b)
  return compareAndDisambiguateByLength(intlFileNameCollatorNumericCaseInsensitive.value.collator, oneExtension, otherExtension)
    || compareCaseLowerFirst(a, b)
    || compareAndDisambiguateByLength(intlFileNameCollatorNumeric.value.collator, a, b)
}

export function compareFileExtensionsUnicode(one: string | null, other: string | null): number {
  const a = one || ""
  const b = other || ""
  const oneExtension = extractExtension(a).toLowerCase()
  const otherExtension = extractExtension(b).toLowerCase()

  if (oneExtension !== otherExtension) return oneExtension < otherExtension ? -1 : 1
  if (a !== b) return a < b ? -1 : 1
  return 0
}

export function comparePaths(one: string, other: string, caseSensitive = false): number {
  const oneParts = splitPath(one)
  const otherParts = splitPath(other)
  const lastOne = oneParts.length - 1
  const lastOther = otherParts.length - 1

  for (let index = 0; ; index += 1) {
    const endOne = lastOne === index
    const endOther = lastOther === index
    if (endOne && endOther) return compareFileNames(oneParts[index], otherParts[index], caseSensitive)
    if (endOne) return -1
    if (endOther) return 1

    const result = comparePathComponents(oneParts[index], otherParts[index], caseSensitive)
    if (result !== 0) return result
  }
}

export function compareAnything(one: string, other: string, lookFor: string): number {
  const elementAName = one.toLowerCase()
  const elementBName = other.toLowerCase()
  const prefixCompare = compareByPrefix(one, other, lookFor)
  if (prefixCompare) return prefixCompare

  const elementASuffixMatch = elementAName.endsWith(lookFor)
  const elementBSuffixMatch = elementBName.endsWith(lookFor)
  if (elementASuffixMatch !== elementBSuffixMatch) return elementASuffixMatch ? -1 : 1

  const result = compareFileNames(elementAName, elementBName)
  if (result !== 0) return result
  return elementAName.localeCompare(elementBName)
}

export function compareByPrefix(one: string, other: string, lookFor: string): number {
  const elementAName = one.toLowerCase()
  const elementBName = other.toLowerCase()
  const elementAPrefixMatch = elementAName.startsWith(lookFor)
  const elementBPrefixMatch = elementBName.startsWith(lookFor)

  if (elementAPrefixMatch !== elementBPrefixMatch) return elementAPrefixMatch ? -1 : 1
  if (elementAPrefixMatch && elementBPrefixMatch) {
    if (elementAName.length < elementBName.length) return -1
    if (elementAName.length > elementBName.length) return 1
  }
  return 0
}

const FileNameMatch = /^(.*?)(\.([^.]*))?$/

function extractNameAndExtension(str?: string | null, dotfilesAsNames = false): [string, string] {
  const match = str ? FileNameMatch.exec(str) as string[] : []
  let result: [string, string] = [(match && match[1]) || "", (match && match[3]) || ""]
  if (dotfilesAsNames && ((!result[0] && result[1]) || (result[0] && result[0].charAt(0) === "."))) {
    result = [result[0] + "." + result[1], ""]
  }
  return result
}

function extractExtension(str?: string | null): string {
  const match = str ? FileNameMatch.exec(str) as string[] : []
  return (match && match[1] && match[1].charAt(0) !== "." && match[3]) || ""
}

function compareAndDisambiguateByLength(collator: Intl.Collator, one: string, other: string): number {
  const result = collator.compare(one, other)
  if (result !== 0) return result
  if (one.length !== other.length) return one.length < other.length ? -1 : 1
  return 0
}

function startsWithLower(value: string): boolean {
  const character = value.charAt(0)
  return character.toLocaleUpperCase() !== character
}

function startsWithUpper(value: string): boolean {
  const character = value.charAt(0)
  return character.toLocaleLowerCase() !== character
}

function compareCaseLowerFirst(one: string, other: string): number {
  if (startsWithLower(one) && startsWithUpper(other)) return -1
  return startsWithUpper(one) && startsWithLower(other) ? 1 : 0
}

function compareCaseUpperFirst(one: string, other: string): number {
  if (startsWithUpper(one) && startsWithLower(other)) return -1
  return startsWithLower(one) && startsWithUpper(other) ? 1 : 0
}

function comparePathComponents(one: string, other: string, caseSensitive = false): number {
  const a = caseSensitive ? one : one.toLowerCase()
  const b = caseSensitive ? other : other.toLowerCase()
  if (a === b) return 0
  return a < b ? -1 : 1
}

function splitPath(value: string): string[] {
  return String(value || "").split(/[\\/]+/).filter(Boolean)
}
