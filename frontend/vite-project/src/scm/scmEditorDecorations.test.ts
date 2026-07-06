import { beforeEach, describe, expect, it, vi } from "vitest"
import { applyScmEditorDecorations, createQuickDiffGutterDecorations, createScmEditorDecorations, getScmDecorationForFile } from "./scmEditorDecorations"
import { registerOrUpdateGitProvider, resetScmRegistry } from "./scmRegistry"

function createMonacoMock() {
  return {
    Range: class Range {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
    editor: {
      OverviewRulerLane: { Left: 1 },
      MinimapPosition: { Gutter: 2 },
    },
  }
}

describe("scmEditorDecorations", () => {
  beforeEach(() => resetScmRegistry())

  it("finds SCM decoration by absolute, relative and file URI active file path", () => {
    const decoration = {
      status: "M",
      groupId: "changes",
      providerId: "git",
      rootUri: "D:/Workspace",
      label: "M",
      tooltip: "Codek: 修改 (changes)",
      resourceUri: "file:///D:/Workspace/src/App.vue",
    }

    expect(getScmDecorationForFile({
      activeFile: "D:\\Workspace\\src\\App.vue",
      decorations: { "D:/Workspace/src/App.vue": decoration },
    })).toBe(decoration)
    expect(getScmDecorationForFile({
      activeFile: "src/App.vue",
      decorations: { "src/App.vue": decoration },
    })).toBe(decoration)
    expect(getScmDecorationForFile({
      activeFile: "file:///D:/Workspace/src/App.vue",
      decorations: { "file:///D:/Workspace/src/App.vue": decoration },
    })).toBe(decoration)
    expect(getScmDecorationForFile({
      activeFile: "App.vue",
      decorations: { "src/App.vue": decoration },
    })).toBeNull()
  })

  it("creates Monaco glyph margin and overview ruler decorations", () => {
    const monaco = createMonacoMock()
    const decorations = createScmEditorDecorations(monaco, {
      status: "U",
      groupId: "conflicts",
      providerId: "git",
      rootUri: "D:/Workspace",
      label: "U",
      tooltip: "Codek: 冲突 (conflicts)",
    })

    expect(decorations[0].options.glyphMarginClassName).toBe("scm-glyph-conflict")
    expect(decorations[0].options.overviewRuler).toEqual({ color: "#f85149", position: 1 })
    expect(decorations[0].options.minimap).toEqual({ color: "#f85149", position: 2 })
  })

  it("marks readonly evidence decorations with an inline class", () => {
    const monaco = createMonacoMock()
    const decorations = createScmEditorDecorations(monaco, {
      status: "M",
      groupId: "changes",
      providerId: "agentEvidence",
      rootUri: "D:/Workspace",
      label: "M",
      tooltip: "readonly evidence",
      readonlyEvidence: true,
    })

    expect(decorations[0].options.inlineClassName).toBe("scm-inline-readonly-evidence")
  })

  it("applies and clears editor decorations through Monaco deltaDecorations", () => {
    const monaco = createMonacoMock()
    const editor = { deltaDecorations: vi.fn(() => ["next"]) }
    const next = applyScmEditorDecorations({
      editor,
      monaco,
      activeFile: "src/a.ts",
      decorations: {
        "src/a.ts": {
          status: "A",
          groupId: "staged",
          providerId: "git",
          rootUri: "D:/Workspace",
          label: "A",
          tooltip: "Codek: 新增 (staged)",
        },
      },
      currentDecorationIds: ["old"],
    })

    expect(editor.deltaDecorations).toHaveBeenCalledWith(["old"], [expect.objectContaining({
      options: expect.objectContaining({ glyphMarginClassName: "scm-glyph-staged" }),
    })])
    expect(next).toEqual(["next"])
  })

  it("creates Quick Diff gutter decorations for unstaged changes", () => {
    registerOrUpdateGitProvider("D:/Workspace", {
      repoName: "Codek",
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [{ path: "src/staged.ts", status: "M", staged: true }],
      changes: [{ path: "src/app.ts", status: "M", staged: false }],
    })

    const monaco = createMonacoMock()
    const decorations = createQuickDiffGutterDecorations(monaco, "D:/Workspace/src/app.ts")
    const stagedDecorations = createQuickDiffGutterDecorations(monaco, "D:/Workspace/src/staged.ts")

    expect(decorations[0].options.linesDecorationsClassName).toBe("scm-quick-diff-line")
    expect(decorations[0].options.glyphMarginHoverMessage.value).toContain("src/app.ts")
    expect(stagedDecorations).toEqual([])
  })
})
