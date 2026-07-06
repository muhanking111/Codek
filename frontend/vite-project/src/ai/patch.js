// src/ai/patch.js

export let currentPatch = null

export function setPatch(patch) {
    currentPatch = patch
}

export function applyPatch(editor) {
    if (!currentPatch) return

    editor.executeEdits("", [
        {
            range: currentPatch.range,
            text: currentPatch.newCode
        }
    ])

    currentPatch = null
}

export function rejectPatch() {
    currentPatch = null
}