/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/editor/common/core/misc/eolCounter.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export const enum StringEOL {
  Unknown = 0,
  LF = 1,
  CRLF = 2,
  Invalid = 3,
}

export function countEOL(text: string): [number, number, number, StringEOL] {
  let eolCount = 0
  let firstLineLength = 0
  let lastLineStart = 0
  let eol = StringEOL.Unknown

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code === 13) {
      if (eolCount === 0) firstLineLength = index
      eolCount += 1
      if (index + 1 < text.length && text.charCodeAt(index + 1) === 10) {
        eol |= StringEOL.CRLF
        index += 1
      } else {
        eol |= StringEOL.Invalid
      }
      lastLineStart = index + 1
    } else if (code === 10) {
      if (eolCount === 0) firstLineLength = index
      eolCount += 1
      eol |= StringEOL.LF
      lastLineStart = index + 1
    }
  }

  if (eolCount === 0) firstLineLength = text.length
  return [eolCount, firstLineLength, text.length - lastLineStart, eol]
}
