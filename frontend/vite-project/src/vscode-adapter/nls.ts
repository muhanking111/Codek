/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/nls.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export interface ILocalizeInfo {
  key: string
  comment: string[]
}

export interface ILocalizedString {
  original: string
  value: string
}

type LocalizeArg = string | number | boolean | undefined | null

import {
  formatNlsMessage,
  getLocalizedStringRegistry,
} from "../nls/nlsService"

declare global {
  var _VSCODE_NLS_MESSAGES: string[] | undefined
  var _VSCODE_NLS_LANGUAGE: string | undefined
}

export function getNLSMessages(): string[] | undefined {
  return globalThis._VSCODE_NLS_MESSAGES
}

export function getNLSLanguage(): string | undefined {
  return globalThis._VSCODE_NLS_LANGUAGE
}

function isPseudoLanguage(): boolean {
  if (getNLSLanguage() === "pseudo") return true
  const hash = typeof document !== "undefined" ? document.location?.hash : ""
  return typeof hash === "string" && hash.includes("pseudo=true")
}

function format(message: string, args: LocalizeArg[]): string {
  let result = formatNlsMessage(message, args)
  if (isPseudoLanguage()) {
    result = `\uFF3B${result.replace(/[aouei]/g, "$&$&")}\uFF3D`
  }
  return result
}

function lookupMessage(index: number, fallback: string | null): string {
  const message = getNLSMessages()?.[index]
  if (typeof message === "string") return message
  if (typeof fallback === "string") return fallback
  throw new Error(`!!! NLS MISSING: ${index} !!!`)
}

export function localize(info: ILocalizeInfo, message: string, ...args: LocalizeArg[]): string
export function localize(key: string, message: string, ...args: LocalizeArg[]): string
export function localize(index: number, message: string | null, ...args: LocalizeArg[]): string
export function localize(data: ILocalizeInfo | string | number, message: string | null, ...args: LocalizeArg[]): string {
  if (typeof data === "number") return format(lookupMessage(data, message), args)
  if (typeof data === "string") return getLocalizedStringRegistry().localize("vscode-adapter", data, message || "", ...args)
  if (data?.key) return getLocalizedStringRegistry().localize("vscode-adapter", data.key, message || "", ...args)
  return format(message || "", args)
}

export function localize2(info: ILocalizeInfo, message: string, ...args: LocalizeArg[]): ILocalizedString
export function localize2(key: string, message: string, ...args: LocalizeArg[]): ILocalizedString
export function localize2(index: number, message: string | null, ...args: LocalizeArg[]): ILocalizedString
export function localize2(data: ILocalizeInfo | string | number, originalMessage: string | null, ...args: LocalizeArg[]): ILocalizedString {
  const original = originalMessage || ""
  const message = typeof data === "number"
    ? lookupMessage(data, originalMessage)
    : getLocalizedStringRegistry().localize("vscode-adapter", typeof data === "string" ? data : data.key, original, ...args)
  const value = format(message, args)
  return {
    value: typeof data === "number" ? value : message,
    original: original === message ? value : format(original, args),
  }
}
