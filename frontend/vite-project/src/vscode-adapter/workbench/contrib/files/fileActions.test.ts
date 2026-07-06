import { describe, expect, it } from "vitest"
import {
  DEFAULT_EXPLORER_INCREMENTAL_NAMING,
  findValidPasteFileTargetPath,
  getWellFormedFileName,
  incrementFileName,
  validateExplorerFileName,
} from "./fileActions"

describe("VS Code file action naming", () => {
  it("increments simple copy names like VS Code", () => {
    expect(incrementFileName("name.txt", false, "simple")).toBe("name copy.txt")
    expect(incrementFileName("name copy.txt", false, "simple")).toBe("name copy 2.txt")
    expect(incrementFileName("name copy 5.txt", false, "simple")).toBe("name copy 6.txt")
    expect(incrementFileName("folder copy", true, "simple")).toBe("folder copy 2")
  })

  it("increments smart numbered files like VS Code", () => {
    expect(incrementFileName("file.1.txt", false, "smart")).toBe("file.2.txt")
    expect(incrementFileName("file.001.txt", false, "smart")).toBe("file.002.txt")
    expect(incrementFileName("1.file.txt", false, "smart")).toBe("2.file.txt")
    expect(incrementFileName("001.file.txt", false, "smart")).toBe("002.file.txt")
    expect(incrementFileName("1.txt", false, "smart")).toBe("2.txt")
  })

  it("keeps VS Code smart fallback behavior for files and folders", () => {
    expect(incrementFileName("file.txt", false, "smart")).toBe("file.1.txt")
    expect(incrementFileName("file", false, "smart")).toBe("file1")
    expect(incrementFileName("file9", false, "smart")).toBe("file10")
    expect(incrementFileName("folder-9", true, "smart")).toBe("folder-10")
    expect(incrementFileName("1.folder", true, "smart")).toBe("2.folder")
    expect(incrementFileName("folder", true, "smart")).toBe("folder.1")
  })

  it("finds paste targets with VS Code default incremental naming", async () => {
    const existing = new Set(["src/main.ts", "src/main copy.ts"])

    await expect(findValidPasteFileTargetPath({
      targetFolderPath: "src",
      resourceName: "main.ts",
      allowOverwrite: false,
      incrementalNaming: DEFAULT_EXPLORER_INCREMENTAL_NAMING,
      exists: (path) => existing.has(path),
      joinPath: (target, name) => `${target}/${name}`,
    })).resolves.toBe("src/main copy 2.ts")
  })

  it("returns the original paste target when VS Code move paste allows overwrite", async () => {
    await expect(findValidPasteFileTargetPath({
      targetFolderPath: "src",
      resourceName: "main.ts",
      allowOverwrite: true,
      incrementalNaming: DEFAULT_EXPLORER_INCREMENTAL_NAMING,
      exists: () => true,
      joinPath: (target, name) => `${target}/${name}`,
    })).resolves.toBe("src/main.ts")
  })

  it("normalizes editable names like VS Code before validation", () => {
    expect(getWellFormedFileName("\tnew-file.ts\t")).toBe("new-file.ts")
    expect(getWellFormedFileName("nested/folder/")).toBe("nested/folder")
    expect(getWellFormedFileName("nested\\folder\\")).toBe("nested\\folder")
  })

  it("validates Explorer create and rename names with VS Code rules", () => {
    expect(validateExplorerFileName({ name: "", isWindowsOS: true }).message?.severity).toBe("error")
    expect(validateExplorerFileName({ name: "/absolute.ts", isWindowsOS: true }).message?.content).toContain("slash")
    expect(validateExplorerFileName({ name: "bad:name.ts", isWindowsOS: true }).message?.severity).toBe("error")
    expect(validateExplorerFileName({ name: "con", isWindowsOS: true }).message?.severity).toBe("error")
    expect(validateExplorerFileName({ name: "test.txt.", isWindowsOS: true }).message?.severity).toBe("error")
    expect(validateExplorerFileName({ name: "ok/name.ts", isWindowsOS: true }).message).toBeNull()
  })

  it("reports duplicate siblings before create or rename", () => {
    const result = validateExplorerFileName({
      name: "main.ts",
      currentName: "old.ts",
      isWindowsOS: true,
      siblingExists: (name) => name === "main.ts",
    })

    expect(result.message?.severity).toBe("error")
    expect(result.message?.content).toContain("already exists")
  })
})
