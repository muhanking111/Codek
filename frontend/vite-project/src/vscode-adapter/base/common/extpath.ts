/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/base/common/extpath.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

const WINDOWS_INVALID_FILE_CHARS = /[\\/:*?"<>|]/g
const UNIX_INVALID_FILE_CHARS = /[/]/g
const WINDOWS_FORBIDDEN_NAMES = /^(con|prn|aux|clock\$|nul|lpt[0-9]|com[0-9])(\.(.*?))?$/i

export function isValidBasename(name: string | null | undefined, isWindowsOS = true): boolean {
  const invalidFileChars = isWindowsOS ? WINDOWS_INVALID_FILE_CHARS : UNIX_INVALID_FILE_CHARS

  if (!name || name.length === 0 || /^\s+$/.test(name)) {
    return false
  }

  invalidFileChars.lastIndex = 0
  if (invalidFileChars.test(name)) {
    return false
  }

  if (isWindowsOS && WINDOWS_FORBIDDEN_NAMES.test(name)) {
    return false
  }

  if (name === "." || name === "..") {
    return false
  }

  if (isWindowsOS && name[name.length - 1] === ".") {
    return false
  }

  if (isWindowsOS && name.length !== name.trim().length) {
    return false
  }

  if (name.length > 255) {
    return false
  }

  return true
}
