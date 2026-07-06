import { describe, expect, it } from "vitest"
import { normalizeEditorOpenOptions, promoteEditorOpenModel } from "./editorOpenOptions"

describe("VS Code editor open options adapter", () => {
  it("keeps regular opens as preview editors", () => {
    expect(normalizeEditorOpenOptions({ path: "src/a.ts" })).toEqual({
      path: "src/a.ts",
      dirty: false,
      pinned: false,
      preview: true,
      permanent: false,
    })
  })

  it("promotes pinned dirty or permanent editors", () => {
    expect(normalizeEditorOpenOptions({ path: "src/a.ts", pinned: true })).toMatchObject({ preview: false, permanent: true })
    expect(normalizeEditorOpenOptions({ path: "src/a.ts", dirty: true })).toMatchObject({ preview: false, permanent: true })
    expect(normalizeEditorOpenOptions({ path: "src/a.ts", permanent: true })).toMatchObject({ preview: false, permanent: true })
  })

  it("recomputes promoted editor state from current flags", () => {
    expect(promoteEditorOpenModel({ path: "src/a.ts", dirty: true, pinned: false, preview: true, permanent: false })).toMatchObject({
      dirty: true,
      preview: false,
      permanent: true,
    })
  })
})
