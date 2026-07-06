/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/workbench/contrib/files/browser/fileActions.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { isValidBasename } from "../../../base/common/extpath"

export type IncrementalNaming = "simple" | "smart"
export type PasteIncrementalNaming = IncrementalNaming | "disabled"
export type ExplorerFileNameValidationSeverity = "error" | "warning"

export const DEFAULT_EXPLORER_INCREMENTAL_NAMING: IncrementalNaming = "simple"

const MAX_SAFE_SMALL_INTEGER = 1_073_741_824

export async function findValidPasteFileTargetPath(options: {
  targetFolderPath: string
  resourceName: string
  isDirectory?: boolean
  allowOverwrite: boolean
  incrementalNaming: PasteIncrementalNaming
  exists: (path: string) => boolean | Promise<boolean>
  joinPath: (targetFolderPath: string, name: string) => string
  maxAttempts?: number
}): Promise<string | undefined> {
  let name = options.resourceName
  let candidate = options.joinPath(options.targetFolderPath, name)

  if (options.allowOverwrite) return candidate
  if (options.incrementalNaming === "disabled") {
    return await options.exists(candidate) ? undefined : candidate
  }

  const maxAttempts = Math.max(1, Number(options.maxAttempts || 1000))
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!await options.exists(candidate)) return candidate
    name = incrementFileName(name, Boolean(options.isDirectory), options.incrementalNaming)
    candidate = options.joinPath(options.targetFolderPath, name)
  }

  return undefined
}

export function incrementFileName(name: string, isFolder: boolean, incrementalNaming: IncrementalNaming): string {
  if (incrementalNaming === "simple") {
    let namePrefix = name
    let extSuffix = ""
    if (!isFolder) {
      extSuffix = extname(name)
      namePrefix = basename(name, extSuffix)
    }

    const suffixRegex = /^(.+ copy)( \d+)?$/
    if (suffixRegex.test(namePrefix)) {
      return namePrefix.replace(suffixRegex, (_match, group1?: string, group2?: string) => {
        const number = group2 ? parseInt(group2, 10) : 1
        return number === 0
          ? `${group1}`
          : number < MAX_SAFE_SMALL_INTEGER
            ? `${group1} ${number + 1}`
            : `${group1}${group2} copy`
      }) + extSuffix
    }

    return `${namePrefix} copy${extSuffix}`
  }

  const separators = "[\\.\\-_]"
  const maxNumber = MAX_SAFE_SMALL_INTEGER

  const suffixFileRegex = RegExp("(.*" + separators + ")(\\d+)(\\..*)$")
  if (!isFolder && name.match(suffixFileRegex)) {
    return name.replace(suffixFileRegex, (_match, group1?: string, group2?: string, group3?: string) => {
      const number = parseInt(group2 || "", 10)
      return number < maxNumber
        ? `${group1}${String(number + 1).padStart((group2 || "").length, "0")}${group3}`
        : `${group1}${group2}.1${group3}`
    })
  }

  const prefixFileRegex = RegExp("(\\d+)(" + separators + ".*)(\\..*)$")
  if (!isFolder && name.match(prefixFileRegex)) {
    return name.replace(prefixFileRegex, (_match, group1?: string, group2?: string, group3?: string) => {
      const number = parseInt(group1 || "", 10)
      return number < maxNumber
        ? `${String(number + 1).padStart((group1 || "").length, "0")}${group2}${group3}`
        : `${group1}${group2}.1${group3}`
    })
  }

  const prefixFileNoNameRegex = RegExp("(\\d+)(\\..*)$")
  if (!isFolder && name.match(prefixFileNoNameRegex)) {
    return name.replace(prefixFileNoNameRegex, (_match, group1?: string, group2?: string) => {
      const number = parseInt(group1 || "", 10)
      return number < maxNumber
        ? `${String(number + 1).padStart((group1 || "").length, "0")}${group2}`
        : `${group1}.1${group2}`
    })
  }

  const lastIndexOfDot = name.lastIndexOf(".")
  if (!isFolder && lastIndexOfDot >= 0) {
    return `${name.substr(0, lastIndexOfDot)}.1${name.substr(lastIndexOfDot)}`
  }

  const noNameNoExtensionRegex = RegExp("(\\d+)$")
  if (!isFolder && lastIndexOfDot === -1 && name.match(noNameNoExtensionRegex)) {
    return name.replace(noNameNoExtensionRegex, (_match, group1?: string) => {
      const number = parseInt(group1 || "", 10)
      return number < maxNumber
        ? String(number + 1).padStart((group1 || "").length, "0")
        : `${group1}.1`
    })
  }

  const noExtensionRegex = RegExp("(.*)(\\d*)$")
  if (!isFolder && lastIndexOfDot === -1 && name.match(noExtensionRegex)) {
    return name.replace(noExtensionRegex, (_match, group1?: string, group2?: string) => {
      let number = parseInt(group2 || "", 10)
      if (Number.isNaN(number)) number = 0
      return number < maxNumber
        ? `${group1}${String(number + 1).padStart((group2 || "").length, "0")}`
        : `${group1}${group2}.1`
    })
  }

  if (isFolder && name.match(/(\d+)$/)) {
    return name.replace(/(\d+)$/, (_match, group?: string) => {
      const number = parseInt(group || "", 10)
      return number < maxNumber
        ? String(number + 1).padStart((group || "").length, "0")
        : `${group}.1`
    })
  }

  if (isFolder && name.match(/^(\d+)/)) {
    return name.replace(/^(\d+)(.*)$/, (_match, group1?: string, group2?: string) => {
      const number = parseInt(group1 || "", 10)
      return number < maxNumber
        ? `${String(number + 1).padStart((group1 || "").length, "0")}${group2}`
        : `${group1}${group2}.1`
    })
  }

  return `${name}.1`
}

export interface ExplorerFileNameValidationMessage {
  content: string
  severity: ExplorerFileNameValidationSeverity
}

export interface ExplorerFileNameValidationResult {
  name: string
  message: ExplorerFileNameValidationMessage | null
}

export function validateExplorerFileName(options: {
  name: string
  currentName?: string
  isWindowsOS?: boolean
  siblingExists?: (name: string) => boolean
}): ExplorerFileNameValidationResult {
  const name = getWellFormedFileName(options.name)

  if (!name || name.length === 0 || /^\s+$/.test(name)) {
    return {
      name,
      message: {
        content: "A file or folder name must be provided.",
        severity: "error",
      },
    }
  }

  if (name[0] === "/" || name[0] === "\\") {
    return {
      name,
      message: {
        content: "A file or folder name cannot start with a slash.",
        severity: "error",
      },
    }
  }

  if (name !== (options.currentName || "") && options.siblingExists?.(name)) {
    return {
      name,
      message: {
        content: `A file or folder ${name} already exists at this location. Please choose a different name.`,
        severity: "error",
      },
    }
  }

  const names = name.split(/[\\/]/).filter(Boolean)
  if (names.some((folderName) => !isValidBasename(folderName, options.isWindowsOS ?? true))) {
    return {
      name,
      message: {
        content: `The name ${trimLongName(name.replace(/\*/g, "\\*"))} is not valid as a file or folder name. Please choose a different name.`,
        severity: "error",
      },
    }
  }

  if (names.some((candidate) => /^\s|\s$/.test(candidate))) {
    return {
      name,
      message: {
        content: "Leading or trailing whitespace detected in file or folder name.",
        severity: "warning",
      },
    }
  }

  return { name, message: null }
}

export function getWellFormedFileName(filename: string): string {
  if (!filename) return filename

  let result = trimCharacter(filename, "\t")
  result = trimTrailingCharacter(result, "/")
  result = trimTrailingCharacter(result, "\\")
  return result
}

function extname(name: string): string {
  const index = name.lastIndexOf(".")
  if (index <= 0) return ""
  return name.slice(index)
}

function basename(name: string, suffix = ""): string {
  if (suffix && name.endsWith(suffix)) return name.slice(0, -suffix.length)
  return name
}

function trimLongName(name: string): string {
  if (name?.length > 255) return `${name.substr(0, 255)}...`
  return name
}

function trimCharacter(value: string, character: string): string {
  let start = 0
  let end = value.length
  while (start < end && value[start] === character) start += 1
  while (end > start && value[end - 1] === character) end -= 1
  return value.slice(start, end)
}

function trimTrailingCharacter(value: string, character: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === character) end -= 1
  return value.slice(0, end)
}
