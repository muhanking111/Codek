import { workspace, updateFile } from "../workspace/manager"

export function applyCrossFilePatch(patches) {
    /**
     patches = [
     { file: "main.js", newCode: "..." },
     { file: "utils.js", newCode: "..." }
     ]
     */

    for (const p of patches) {
        if (workspace.files[p.file]) {
            updateFile(p.file, p.newCode)
        }
    }
}