import { describe, expect, it } from "vitest"
import {
  getMonacoEditorSettingsOptions,
  getProductGradeMonacoEditorOptions,
  type SettingsRecord,
} from "./monacoEditorSettings"

describe("monacoEditorSettings", () => {
  it("maps VS Code editor settings to Monaco options", () => {
    const settings: SettingsRecord = {
      "editor.fontSize": 18,
      "editor.fontFamily": "Fira Code",
      "editor.tabSize": 4,
      "editor.insertSpaces": false,
      "editor.wordWrap": "on",
      "editor.minimap.enabled": false,
      "editor.lineNumbers": "relative",
      "editor.renderWhitespace": "all",
      "editor.bracketPairColorization.enabled": false,
      "editor.formatOnPaste": true,
    }

    expect(getMonacoEditorSettingsOptions(settings)).toEqual({
      fontSize: 18,
      fontFamily: "Fira Code",
      tabSize: 4,
      insertSpaces: false,
      wordWrap: "on",
      minimap: { enabled: false },
      lineNumbers: "relative",
      renderWhitespace: "all",
      bracketPairColorization: { enabled: false },
      unicodeHighlight: {
        ambiguousCharacters: false,
        invisibleCharacters: false,
        nonBasicASCII: false,
      },
      formatOnPaste: true,
    })
  })

  it("falls back to safe defaults for invalid imported values", () => {
    const settings: SettingsRecord = {
      "editor.fontSize": 120,
      "editor.tabSize": -1,
      "editor.wordWrap": "bad",
      "editor.lineNumbers": "maybe",
      "editor.renderWhitespace": "sometimes",
    }

    expect(getMonacoEditorSettingsOptions(settings)).toMatchObject({
      fontSize: 40,
      tabSize: 2,
      insertSpaces: true,
      wordWrap: "off",
      lineNumbers: "on",
      renderWhitespace: "selection",
      unicodeHighlight: {
        ambiguousCharacters: false,
        invisibleCharacters: false,
        nonBasicASCII: false,
      },
      formatOnPaste: false,
    })
  })

  it("shows line numbers by default", () => {
    expect(getMonacoEditorSettingsOptions({}).lineNumbers).toBe("on")
  })

  it("keeps supported line number modes configurable", () => {
    expect(getMonacoEditorSettingsOptions({ "editor.lineNumbers": "off" }).lineNumbers).toBe("off")
    expect(getMonacoEditorSettingsOptions({ "editor.lineNumbers": "relative" }).lineNumbers).toBe("relative")
    expect(getMonacoEditorSettingsOptions({ "editor.lineNumbers": "interval" }).lineNumbers).toBe("interval")
  })

  it("builds product-grade editor options without losing the gutter baseline", () => {
    expect(getProductGradeMonacoEditorOptions({ "editor.lineNumbers": "relative" })).toMatchObject({
      lineNumbers: "relative",
      glyphMargin: true,
      lineDecorationsWidth: 14,
      lineNumbersMinChars: 3,
      unicodeHighlight: {
        ambiguousCharacters: false,
        invisibleCharacters: false,
        nonBasicASCII: false,
      },
      renderLineHighlight: "all",
      scrollbar: {
        verticalScrollbarSize: 12,
        horizontalScrollbarSize: 12,
        useShadows: false,
      },
    })
  })
})
