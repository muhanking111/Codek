// src/ai/diff.js

import * as monaco from "monaco-editor"

export function createDiff(editor, originalCode, newCode, range) {
    const oldLines = originalCode.split("\n")
    const newLines = newCode.split("\n")

    const start = range.startLineNumber

    const decorations = []

    const max = Math.max(oldLines.length, newLines.length)

    for (let i = 0; i < max; i++) {
        const line = start + i

        const oldL = oldLines[i]
        const newL = newLines[i]

        // 🔴 删除/修改
        if (oldL && oldL !== newL) {
            decorations.push({
                range: new monaco.Range(line, 1, line, 1),
                options: {
                    isWholeLine: true,
                    className: "line-delete"
                }
            })
        }

        // 🟢 新增
        if (newL && newL !== oldL) {
            decorations.push({
                range: new monaco.Range(line, 1, line, 1),
                options: {
                    isWholeLine: true,
                    className: "line-add"
                }
            })
        }
    }

    return editor.deltaDecorations([], decorations)
}