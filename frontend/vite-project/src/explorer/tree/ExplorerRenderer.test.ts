import { describe, expect, it, vi } from "vitest"
import { createExplorerItem } from "../model/ExplorerModel"
import { ExplorerRenderer } from "./ExplorerRenderer"

function setFontCheckResult(ready: boolean): void {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      check: () => ready,
      load: () => Promise.resolve([]),
    },
  })
}

describe("ExplorerRenderer", () => {
  it("patches reusable rows with file metadata and accessibility state", () => {
    const renderer = new ExplorerRenderer({
      activeUri: "D:/repo/src/App.ts",
      selectedUri: "D:/repo/src/App.ts",
      decorations: {
        "D:/repo/src/App.ts": { label: "M", tooltip: "modified" },
      },
    })
    const row = renderer.createRow()
    const item = createExplorerItem({
      uri: "D:/repo/src/App.ts",
      name: "App.ts",
      isDirectory: false,
      depth: 2,
      size: 128,
    })

    renderer.renderElement(item, row, 3)

    expect(row.dataset.uri).toBe("D:/repo/src/App.ts")
    expect(row.getAttribute("role")).toBe("treeitem")
    expect(row.getAttribute("aria-level")).toBe("3")
    expect(row.getAttribute("aria-selected")).toBe("true")
    expect(row.classList.contains("active")).toBe(false)
    expect(row.classList.contains("selected")).toBe(true)
    expect(row.querySelector(".codek-explorer-label")?.textContent).toBe("App.ts")
    expect(row.querySelector(".codek-explorer-decoration")?.textContent).toBe("M")
  })

  it("projects SCM decorations by relative explorer key", () => {
    const renderer = new ExplorerRenderer({
      decorations: {
        "repo/src/App.ts": { label: "M", tooltip: "Git: 修改", status: "M" },
      },
    })
    const row = renderer.createRow()
    const item = createExplorerItem({
      uri: "D:/repo/src/App.ts",
      name: "App.ts",
      isDirectory: false,
    })

    renderer.renderElement(item, row, 0)

    const decoration = row.querySelector(".codek-explorer-decoration") as HTMLElement
    expect(decoration.textContent).toBe("M")
    expect(decoration.title).toBe("Git: 修改")
  })

  it("renders only one selected row when the active editor and explorer selection differ", () => {
    const renderer = new ExplorerRenderer({
      activeUri: "D:/repo/server/bin/code-192.png",
      selectedUri: "D:/repo/server/bin",
    })
    const activeFileRow = renderer.createRow()
    const selectedDirRow = renderer.createRow()

    renderer.renderElement(createExplorerItem({
      uri: "D:/repo/server/bin/code-192.png",
      name: "code-192.png",
      isDirectory: false,
    }), activeFileRow, 0)
    renderer.renderElement(createExplorerItem({
      uri: "D:/repo/server/bin",
      name: "bin",
      isDirectory: true,
      expanded: true,
    }), selectedDirRow, 1)

    expect(activeFileRow.classList.contains("active")).toBe(false)
    expect(activeFileRow.classList.contains("selected")).toBe(false)
    expect(activeFileRow.getAttribute("aria-selected")).toBe("false")
    expect(selectedDirRow.classList.contains("selected")).toBe(true)
    expect(selectedDirRow.getAttribute("aria-selected")).toBe("true")
  })

  it("uses the active editor as the single selection fallback when the explorer selection is empty", () => {
    const renderer = new ExplorerRenderer({
      activeUri: "D:/repo/src/App.ts",
      selectedUri: "",
    })
    const row = renderer.createRow()

    renderer.renderElement(createExplorerItem({
      uri: "D:/repo/src/App.ts",
      name: "App.ts",
      isDirectory: false,
    }), row, 0)

    expect(row.classList.contains("selected")).toBe(true)
    expect(row.classList.contains("active")).toBe(false)
    expect(row.getAttribute("aria-selected")).toBe("true")
  })

  it("updates existing row DOM without creating nested components", () => {
    const renderer = new ExplorerRenderer()
    const row = renderer.createRow()
    const first = createExplorerItem({ uri: "D:/repo/src", name: "src", isDirectory: true, expanded: false })
    const second = createExplorerItem({ uri: "D:/repo/src/App.ts", name: "App.ts", isDirectory: false })

    renderer.renderElement(first, row, 0)
    const label = row.querySelector(".codek-explorer-label")
    renderer.renderElement(second, row, 1)

    expect(row.querySelector(".codek-explorer-label")).toBe(label)
    expect(label?.textContent).toBe("App.ts")
    expect(row.classList.contains("dir")).toBe(false)
    expect(row.classList.contains("file")).toBe(true)
  })

  it("renders VS Code style editable rows inside the native renderer", async () => {
    const onFinish = vi.fn()
    const renderer = new ExplorerRenderer()
    const row = renderer.createRow()
    const item = createExplorerItem({
      uri: "D:/repo/src/__codek_new_file_1__",
      name: "New File",
      isDirectory: false,
      editable: {
        value: "",
        kind: "createFile",
        placeholder: "文件名，例如 index.html",
        validationMessage: (value) => value.includes(":") ? { content: "The name is not valid.", severity: "error" } : null,
        onFinish,
      },
    })

    renderer.renderElement(item, row, 2)
    await Promise.resolve()

    const label = row.querySelector(".codek-explorer-label") as HTMLElement
    const input = row.querySelector(".codek-explorer-input") as HTMLInputElement
    expect(row.classList.contains("editable")).toBe(true)
    expect(row.draggable).toBe(false)
    expect(label.style.display).toBe("none")
    expect(input.style.display).toBe("")
    expect(input.placeholder).toBe("文件名，例如 index.html")

    input.value = "bad:name.ts"
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    expect(onFinish).not.toHaveBeenCalled()
    expect(input.getAttribute("aria-invalid")).toBe("true")

    input.value = "ok.ts"
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    expect(onFinish).toHaveBeenCalledWith("ok.ts", true)
  })

  it("uses compact VS Code style indentation and twistie spacing", () => {
    const renderer = new ExplorerRenderer()
    const row = renderer.createRow()
    const item = createExplorerItem({ uri: "D:/repo/src", name: "src", isDirectory: true, depth: 2 })

    renderer.renderElement(item, row, 0)

    expect(row.dataset.depth).toBe("2")
    expect(row.style.getPropertyValue("--codek-tree-depth")).toBe("2")
    expect(row.style.getPropertyValue("--codek-tree-indent-px")).toBe("16px")
    expect(row.style.getPropertyValue("--codek-tree-row-padding-left-px")).toBe("16px")
    expect(row.style.getPropertyValue("--codek-tree-guide-offset-px")).toBe("8px")
    expect(row.style.getPropertyValue("--codek-tree-align-offset-margin-left")).toBe("14px")
    expect(row.style.getPropertyValue("--codek-tree-twistie-width-px")).toBe("16px")
    expect(row.style.getPropertyValue("--codek-tree-icon-width-px")).toBe("0px")
    expect(row.style.getPropertyValue("--codek-tree-icon-gap-px")).toBe("0px")
    expect(row.style.paddingLeft).toBe("")
    expect(row.querySelector(".codek-explorer-twistie")?.textContent).toBe(">")
  })

  it("keeps directory labels adjacent to the twistie while files keep a VS Code icon slot", () => {
    const renderer = new ExplorerRenderer()
    const dirRow = renderer.createRow()
    const fileRow = renderer.createRow()

    renderer.renderElement(createExplorerItem({ uri: "D:/repo/src", name: "src", isDirectory: true, depth: 1 }), dirRow, 0)
    renderer.renderElement(createExplorerItem({ uri: "D:/repo/src/App.ts", name: "App.ts", isDirectory: false, depth: 1 }), fileRow, 1)

    expect(dirRow.style.getPropertyValue("--codek-tree-icon-width-px")).toBe("0px")
    expect(dirRow.style.getPropertyValue("--codek-tree-icon-gap-px")).toBe("0px")
    expect(dirRow.querySelector(".codek-explorer-twistie")?.nextElementSibling?.classList.contains("codek-explorer-icon")).toBe(true)
    expect(fileRow.style.getPropertyValue("--codek-tree-icon-width-px")).toBe("16px")
    expect(fileRow.style.getPropertyValue("--codek-tree-icon-gap-px")).toBe("3px")
    expect(dirRow.querySelector(".codek-explorer-icon")?.classList.contains("no-icon")).toBe(true)
    expect(fileRow.querySelector(".codek-explorer-icon")?.classList.contains("no-icon")).toBe(false)
  })

  it("keeps an empty twistie gutter for files so same-level names align with folders", () => {
    const renderer = new ExplorerRenderer()
    const row = renderer.createRow()
    const item = createExplorerItem({ uri: "D:/repo/src/App.ts", name: "App.ts", isDirectory: false, depth: 2 })

    renderer.renderElement(item, row, 0)

    const twistie = row.querySelector(".codek-explorer-twistie") as HTMLElement
    expect(twistie).toBeTruthy()
    expect(twistie.textContent).toBe("")
    expect(twistie.dataset.state).toBe("none")
  })

  it("does not render self-made folder icon slots", () => {
    const renderer = new ExplorerRenderer()
    const row = renderer.createRow()
    const item = createExplorerItem({ uri: "D:/repo/src", name: "src", isDirectory: true, depth: 1 })

    renderer.renderElement(item, row, 0)

    const icon = row.querySelector(".codek-explorer-icon") as HTMLElement
    expect(icon.classList.contains("folder")).toBe(false)
    expect(icon.classList.contains("no-icon")).toBe(true)
    expect(icon.className).not.toContain("icon-folder")
    expect(icon.classList.contains("theme-icon")).toBe(false)
    expect(icon.classList.contains("fallback-seti-icon")).toBe(false)
    expect(icon.classList.contains("fallback-token-icon")).toBe(false)
    expect(row.querySelector(".codek-explorer-theme-image")?.getAttribute("src") || "").toBe("")
    expect(row.querySelector(".codek-explorer-theme-glyph")?.textContent).toBe("")
    expect(row.querySelector(".codek-explorer-fallback-token")?.textContent).toBe("")
  })

  it("does not invent folder fallback glyphs when the active VS Code file icon theme has no folder icon", () => {
    const renderer = new ExplorerRenderer()
    const row = renderer.createRow()
    const item = createExplorerItem({ uri: "D:/repo/src", name: "src", isDirectory: true, expanded: false })

    renderer.renderElement(item, row, 0)

    expect(row.textContent).not.toContain("[+]")
    expect(row.textContent).not.toContain("[-]")
    expect(row.querySelector(".codek-explorer-folder-icon")).toBeNull()
    expect(row.querySelector(".codek-explorer-file-icon")).toBeNull()
    expect(row.querySelector(".codek-explorer-theme-glyph")?.textContent).toBe("")
    expect(row.querySelector(".codek-explorer-icon")?.className).not.toContain("icon-folder")
    expect(row.querySelector(".codek-explorer-icon")?.classList.contains("fallback-seti-icon")).toBe(false)
    expect(row.querySelector(".codek-explorer-icon")?.classList.contains("folder")).toBe(false)
  })

  it("exposes folder open and closed state through VS Code style tree row state", () => {
    const renderer = new ExplorerRenderer()
    const openRow = renderer.createRow()
    const closedRow = renderer.createRow()

    renderer.renderElement(createExplorerItem({
      uri: "D:/repo/src",
      name: "src",
      isDirectory: true,
      expanded: true,
    }), openRow, 0)
    renderer.renderElement(createExplorerItem({
      uri: "D:/repo/tests",
      name: "tests",
      isDirectory: true,
      expanded: false,
    }), closedRow, 1)

    expect(openRow.classList.contains("expanded")).toBe(true)
    expect(openRow.getAttribute("aria-expanded")).toBe("true")
    expect(closedRow.classList.contains("expanded")).toBe(false)
    expect(closedRow.getAttribute("aria-expanded")).toBe("false")
    expect(openRow.querySelector(".codek-explorer-twistie")?.textContent).toBe(">")
    expect(closedRow.querySelector(".codek-explorer-twistie")?.textContent).toBe(">")
    expect(openRow.querySelector(".codek-explorer-icon")?.classList.contains("open")).toBe(false)
    expect(closedRow.querySelector(".codek-explorer-icon")?.classList.contains("open")).toBe(false)
    expect(openRow.querySelector(".codek-explorer-icon")?.classList.contains("no-icon")).toBe(true)
    expect(closedRow.querySelector(".codek-explorer-icon")?.classList.contains("no-icon")).toBe(true)
  })

  it("does not show legacy skipped decorations for ignored folders", () => {
    const renderer = new ExplorerRenderer()
    const row = renderer.createRow()
    const item = createExplorerItem({ uri: "D:/repo/dist", name: "dist", isDirectory: true, ignored: true })

    renderer.renderElement(item, row, 0)

    expect(row.classList.contains("ignored")).toBe(true)
    expect(row.querySelector(".codek-explorer-decoration")?.textContent).toBe("")
    expect(row.textContent).not.toContain("skipped")
  })

  it("renders VS Code file icon theme glyphs for native explorer rows", () => {
    setFontCheckResult(true)
    const renderer = new ExplorerRenderer({
      iconTheme: {
        found: true,
        themeId: "vs-seti-loading",
        icons: {
          fonts: [{ id: "seti", weight: "normal", style: "normal", size: "150%", src: [{ path: "codek-extension-resource://seti.woff", format: "woff" }] }],
          fileExtensions: {
            md: { id: "_markdown", fontCharacter: "\\E073", fontColor: "#519aba", fontId: "seti", fontFamily: "seti" },
          },
        },
      },
    })
    const row = renderer.createRow()
    const item = createExplorerItem({ uri: "D:/repo/SPONSORS.md", name: "SPONSORS.md", isDirectory: false })

    renderer.renderElement(item, row, 0)

    const icon = row.querySelector(".codek-explorer-icon") as HTMLElement
    expect(icon.classList.contains("theme-icon")).toBe(true)
    expect(icon.classList.contains("theme-icon-markdown")).toBe(true)
    expect(icon.style.color).toBe("rgb(81, 154, 186)")
    expect(icon.style.fontFamily).toBe("seti, codicon, ui-monospace, monospace")
    const glyph = row.querySelector(".codek-explorer-theme-glyph") as HTMLElement
    expect(glyph.textContent).toBe(String.fromCodePoint(0xe073))
    expect(glyph.style.fontSize).toBe("150%")
  })

  it("projects WorkbenchThemeService file icon theme identity on native rows", () => {
    setFontCheckResult(true)
    const renderer = new ExplorerRenderer({
      iconThemeId: "vs-seti",
      iconTheme: {
        found: true,
        themeId: "loaded-vs-seti",
        icons: {
          fonts: [{ id: "seti", weight: "normal", style: "normal", size: "150%", src: [{ path: "codek-extension-resource://seti.woff", format: "woff" }] }],
          fileExtensions: {
            ts: { id: "_typescript", fontCharacter: "\\E099", fontColor: "#519aba", fontId: "seti", fontFamily: "seti" },
          },
        },
      },
    })
    const row = renderer.createRow()
    const item = createExplorerItem({ uri: "D:/repo/src/App.ts", name: "App.ts", isDirectory: false })

    renderer.renderElement(item, row, 0)

    const icon = row.querySelector(".codek-explorer-icon") as HTMLElement
    expect(icon.dataset.fileIconThemeId).toBe("vs-seti")
    expect(icon.dataset.fileIconThemeService).toBe("workbenchThemeService")
    expect(icon.dataset.fileIconSource).toBe("glyph")
    expect(icon.dataset.fileIconId).toBe("_typescript")

    renderer.updateOptions({ iconThemeId: "minimal", iconTheme: null })
    renderer.renderElement(item, row, 0)

    expect(icon.dataset.fileIconThemeId).toBe("minimal")
    expect(icon.dataset.fileIconThemeService).toBe("workbenchThemeService")
    expect(icon.dataset.fileIconSource).toBe("fallback")
  })

  it("falls back to a stable token while the VS Code Seti font is loading", () => {
    setFontCheckResult(false)
    const renderer = new ExplorerRenderer({
      iconTheme: {
        found: true,
        themeId: "vs-seti",
        icons: {
          fonts: [{ id: "seti", weight: "normal", style: "normal", src: [{ path: "codek-extension-resource://seti.woff", format: "woff" }] }],
          fileExtensions: {
            ts: { id: "_typescript", fontCharacter: "\\E099", fontColor: "#519aba", fontId: "seti", fontFamily: "seti" },
          },
        },
      },
    })
    const row = renderer.createRow()
    const item = createExplorerItem({ uri: "D:/repo/src/App.ts", name: "App.ts", isDirectory: false })

    renderer.renderElement(item, row, 0)

    const icon = row.querySelector(".codek-explorer-icon") as HTMLElement
    expect(icon.classList.contains("theme-icon-renderable")).toBe(false)
    expect(icon.classList.contains("icon-ts")).toBe(true)
    const glyph = row.querySelector(".codek-explorer-theme-glyph") as HTMLElement
    expect(glyph.textContent).toBeTruthy()
    expect(glyph.textContent).not.toContain("\\")
    expect(row.querySelector(".codek-explorer-fallback-token")?.textContent).toBe("")
    expect(icon.classList.contains("fallback-seti-icon")).toBe(true)
    expect(icon.classList.contains("fallback-token-icon")).toBe(false)
    expect(icon.classList.contains("theme-icon-typescript")).toBe(false)
  })

  it("uses a stable fallback token when a theme definition has no renderable glyph or image", () => {
    const renderer = new ExplorerRenderer({
      iconTheme: {
        found: true,
        themeId: "partial-icons",
        icons: {
          fileExtensions: {
            ts: { id: "_typescript", fontColor: "#519aba" },
          },
        },
      },
    })
    const row = renderer.createRow()
    const item = createExplorerItem({ uri: "D:/repo/src/App.ts", name: "App.ts", isDirectory: false })

    renderer.renderElement(item, row, 0)

    const icon = row.querySelector(".codek-explorer-icon") as HTMLElement
    expect(icon.classList.contains("theme-icon")).toBe(false)
    expect(icon.classList.contains("theme-icon-renderable")).toBe(false)
    expect(icon.classList.contains("fallback-seti-icon")).toBe(true)
    expect(icon.classList.contains("fallback-token-icon")).toBe(false)
    expect(icon.classList.contains("icon-ts")).toBe(true)
    expect(row.querySelector(".codek-explorer-file-icon")).toBeNull()
    expect(row.querySelector(".codek-explorer-theme-glyph")?.textContent).toBeTruthy()
    expect(row.querySelector(".codek-explorer-theme-glyph")?.textContent).not.toContain("\\")
    expect(row.querySelector(".codek-explorer-fallback-token")?.textContent).toBe("")
  })
})
