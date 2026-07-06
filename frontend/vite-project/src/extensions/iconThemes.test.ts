import { describe, expect, it, vi } from "vitest"
import {
  activeFileIconTheme,
  ensureFileIconTheme,
  getFileIconThemeFontSize,
  getRenderableFileIconThemeSource,
  getVisibleFileIconThemeSource,
  installFileIconThemeFonts,
  resolveFileIconThemeIcon,
  type LoadedFileIconTheme,
} from "./iconThemes"

const theme: LoadedFileIconTheme = {
  found: true,
  themeId: "vs-seti",
  icons: {
    file: { id: "_file", fontColor: "#cccccc" },
    folder: { id: "_folder", fontColor: "#d6a85f" },
    folderExpanded: { id: "_folder_open", fontColor: "#e8bd72" },
    rootFolder: { id: "_root", fontColor: "#d6a85f" },
    rootFolderExpanded: { id: "_root_open", fontColor: "#e8bd72" },
    fileNames: {
      "package.json": { id: "_npm", fontColor: "#cb3837" },
      "src/package.json": { id: "_workspace_npm", fontColor: "#f97316" },
    },
    fileExtensions: {
      ts: { id: "_typescript", fontColor: "#519aba" },
      "test.ts": { id: "_test", fontColor: "#8dc149" },
      "src/generated.d.ts": { id: "_generated_types", fontColor: "#38bdf8" },
    },
    folderNames: {
      src: { id: "_src", fontColor: "#519aba" },
    },
    folderNamesExpanded: {
      src: { id: "_src_open", fontColor: "#7dd3fc" },
    },
    languageIds: {
      javascript: { id: "_javascript", fontColor: "#f7df1e" },
    },
    light: {
      fileExtensions: {
        ts: { id: "_typescript_light", fontColor: "#3178c6" },
      },
    },
  },
}

describe("VS Code file icon theme client", () => {
  it("resolves names, compound extensions and folders using VS Code icon theme maps", () => {
    expect(resolveFileIconThemeIcon(theme, "package.json", false)?.id).toBe("_npm")
    expect(resolveFileIconThemeIcon(theme, "src/package.json", false)?.id).toBe("_workspace_npm")
    expect(resolveFileIconThemeIcon(theme, "src/generated.d.ts", false)?.id).toBe("_generated_types")
    expect(resolveFileIconThemeIcon(theme, "button.test.ts", false)?.id).toBe("_test")
    expect(resolveFileIconThemeIcon(theme, "App.ts", false)?.id).toBe("_typescript")
    expect(resolveFileIconThemeIcon(theme, "src", true)?.id).toBe("_src")
    expect(resolveFileIconThemeIcon(theme, "src", true, true)?.id).toBe("_src_open")
    expect(resolveFileIconThemeIcon(theme, "/workspace", true, true, { isRoot: true })?.id).toBe("_root_open")
    expect(resolveFileIconThemeIcon(theme, "unknown", true, true)?.id).toBe("_folder_open")
  })

  it("uses language id fallback and color theme variants", () => {
    expect(resolveFileIconThemeIcon(theme, "script", false, false, { languageId: "javascript" })?.id).toBe("_javascript")
    expect(resolveFileIconThemeIcon(theme, "App.ts", false, false, { colorThemeKind: "light" })?.id).toBe("_typescript_light")
    expect(resolveFileIconThemeIcon(theme, "script", false, false, { languageId: "unknown" })?.id).toBe("_file")
  })

  it("reports only image or glyph theme icons as renderable", () => {
    expect(getRenderableFileIconThemeSource({ id: "_empty" })).toBeNull()
    expect(getRenderableFileIconThemeSource({ id: "_glyph", fontCharacter: "\\E073" })).toBe("glyph")
    expect(getRenderableFileIconThemeSource({ id: "_image", iconPath: "codek-extension-resource://icon.svg" })).toBe("image")
    expect(getRenderableFileIconThemeSource({ id: "_unsafe", iconPath: "../icon.svg" })).toBeNull()
  })

  it("keeps non VS Code glyph icons hidden while asynchronously loading the theme font", () => {
    const load = vi.fn(() => Promise.resolve([]))
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        check: () => false,
        load,
      },
    })
    const fontTheme: LoadedFileIconTheme = {
      found: true,
      themeId: "custom-icons",
      icons: {
        fonts: [{ id: "custom", src: [{ path: "codek-extension-resource://custom.woff", format: "woff" }] }],
      },
    }
    const glyphIcon = { id: "_custom", fontCharacter: "\\E099", fontId: "custom", fontFamily: "custom" }

    expect(getRenderableFileIconThemeSource(glyphIcon)).toBe("glyph")
    expect(getVisibleFileIconThemeSource(fontTheme, glyphIcon)).toBeNull()
    expect(load).toHaveBeenCalledWith('16px "custom"', String.fromCodePoint(0xe099))
  })

  it("keeps VS Code glyph icons hidden until the Seti font is actually ready", () => {
    const load = vi.fn(() => Promise.resolve([]))
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        check: () => false,
        load,
      },
    })
    const fontTheme: LoadedFileIconTheme = {
      found: true,
      themeId: "vs-seti",
      icons: {
        fonts: [{ id: "seti", src: [{ path: "codek-extension-resource://seti.woff", format: "woff" }] }],
      },
    }
    const glyphIcon = { id: "_typescript", fontCharacter: "\\E099", fontId: "seti", fontFamily: "seti" }

    expect(getVisibleFileIconThemeSource(fontTheme, glyphIcon)).toBeNull()
    expect(load).toHaveBeenCalledWith('16px "seti"', String.fromCodePoint(0xe099))
  })

  it("treats glyph icons as visible after the theme font is ready", () => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        check: vi.fn(() => true),
        load: vi.fn(() => Promise.resolve([])),
      },
    })
    const fontTheme: LoadedFileIconTheme = {
      found: true,
      themeId: "vs-seti",
      icons: {
        fonts: [{ id: "seti", src: [{ path: "codek-extension-resource://seti.woff", format: "woff" }] }],
      },
    }
    const glyphIcon = { id: "_typescript", fontCharacter: "\\E099", fontId: "seti", fontFamily: "seti" }

    expect(getVisibleFileIconThemeSource(fontTheme, glyphIcon)).toBe("glyph")
    expect(document.fonts.check).toHaveBeenCalledWith('16px "seti"', String.fromCodePoint(0xe099))
  })

  it("normalizes VS Code font sizes for glyph rendering without using percentages as load probes", () => {
    const check = vi.fn(() => true)
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        check,
        load: vi.fn(() => Promise.resolve([])),
      },
    })
    const fontTheme: LoadedFileIconTheme = {
      found: true,
      themeId: "vs-seti-sized",
      icons: {
        fonts: [{ id: "seti-sized", size: "150%", src: [{ path: "codek-extension-resource://seti.woff", format: "woff" }] }],
      },
    }
    const glyphIcon = { id: "_typescript", fontCharacter: "\\E099", fontId: "seti-sized", fontFamily: "seti-sized" }
    const sizedGlyphIcon = { ...glyphIcon, fontSize: "20px" }

    expect(getFileIconThemeFontSize(fontTheme, glyphIcon)).toBe("150%")
    expect(getFileIconThemeFontSize(fontTheme, sizedGlyphIcon)).toBe("154%")
    expect(getVisibleFileIconThemeSource(fontTheme, glyphIcon)).toBe("glyph")
    expect(check).toHaveBeenCalledWith('16px "seti-sized"', String.fromCodePoint(0xe099))
  })

  it("caches loaded themes and ignores built-in fallback themes", async () => {
    const getMock = vi.fn(async (_path: string) => theme)
    const get = async <T = unknown>(path: string): Promise<T> => {
      return getMock(path) as Promise<T>
    }

    await expect(ensureFileIconTheme("minimal", { get })).resolves.toBeNull()
    expect(getMock).not.toHaveBeenCalled()

    await expect(ensureFileIconTheme("vs-seti", { get })).resolves.toMatchObject({ themeId: "vs-seti" })
    await expect(ensureFileIconTheme("vs-seti", { get })).resolves.toMatchObject({ themeId: "vs-seti" })
    expect(getMock).toHaveBeenCalledTimes(1)
    expect(activeFileIconTheme.value?.themeId).toBe("vs-seti")
  })

  it("does not activate failed remote themes", async () => {
    const failed = { found: false, themeId: "broken-icons", icons: {}, error: "missing" }
    const get = async <T = unknown>(): Promise<T> => failed as T

    await expect(ensureFileIconTheme("broken-icons", { get })).resolves.toMatchObject({ found: false })
    expect(activeFileIconTheme.value).toBeNull()
  })

  it("does not permanently cache failed icon theme loads", async () => {
    let calls = 0
    const getMock = vi.fn(async (_path: string) => {
      calls += 1
      if (calls === 1) return { found: false, themeId: "eventual-icons", icons: {}, error: "not ready" }
      return { ...theme, themeId: "eventual-icons", found: true }
    })
    const get = async <T = unknown>(path: string): Promise<T> => {
      return getMock(path) as Promise<T>
    }
    const now = vi.spyOn(Date, "now")
    now.mockReturnValue(1_000)
    try {
      await expect(ensureFileIconTheme("eventual-icons", { get })).resolves.toMatchObject({ found: false })
      now.mockReturnValue(2_000)
      await expect(ensureFileIconTheme("eventual-icons", { get })).resolves.toMatchObject({ found: true })
      expect(getMock).toHaveBeenCalledTimes(2)
      expect(activeFileIconTheme.value?.themeId).toBe("eventual-icons")
    } finally {
      now.mockRestore()
    }
  })

  it("installs VS Code file icon theme fonts for glyph rendering", () => {
    installFileIconThemeFonts({
      found: true,
      themeId: "vs-seti",
      icons: {
        fonts: [{
          id: "seti",
          weight: "normal",
          style: "normal",
          src: [{ path: "codek-extension-resource://seti.woff", format: "woff" }],
        }],
      },
    })

    const style = document.getElementById("codek-file-icon-font-vs-seti-seti")
    expect(style?.textContent).toContain("@font-face")
    expect(style?.textContent).toContain("codek-extension-resource://seti.woff")
  })
})
