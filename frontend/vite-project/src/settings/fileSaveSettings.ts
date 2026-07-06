import { settingsStore } from "./settingsStore"

export interface FileSaveOptions {
  trimTrailingWhitespace: boolean
  insertFinalNewline: boolean
}

export function getFileSaveOptions(): FileSaveOptions {
  return {
    trimTrailingWhitespace: settingsStore.get<boolean>("files.trimTrailingWhitespace", false) === true,
    insertFinalNewline: settingsStore.get<boolean>("files.insertFinalNewline", true) !== false,
  }
}

export function applyFileSaveSettings(content: string, options = getFileSaveOptions()): string {
  let nextContent = content

  if (options.trimTrailingWhitespace) {
    nextContent = nextContent.replace(/[ \t]+$/gm, "")
  }

  if (options.insertFinalNewline && nextContent.length > 0 && !/\r?\n$/.test(nextContent)) {
    nextContent += getPreferredFinalNewline(nextContent)
  }

  return nextContent
}

function getPreferredFinalNewline(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n"
}
