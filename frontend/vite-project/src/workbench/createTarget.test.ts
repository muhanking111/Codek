import { describe, expect, it } from "vitest"
import { describeCreateParent, resolveExplorerCreateParent, resolveExplorerCreateTargetSnapshot } from "./createTarget"

describe("resolveExplorerCreateParent", () => {
  it("creates under the selected directory", () => {
    expect(resolveExplorerCreateParent({
      selectedPath: "scripts",
      selectedKind: "dir",
      activeFile: "src/App.vue",
    })).toBe("scripts")
  })

  it("creates beside the selected file", () => {
    expect(resolveExplorerCreateParent({
      selectedPath: "scripts/ar-health.js",
      selectedKind: "file",
      activeFile: "src/App.vue",
    })).toBe("scripts")
  })

  it("falls back to the active file directory when nothing is selected", () => {
    expect(resolveExplorerCreateParent({
      activeFile: "frontend/vite-project/src/App.vue",
    })).toBe("frontend/vite-project/src")
  })

  it("uses the active file directory after Explorer selection has been cleared", () => {
    expect(resolveExplorerCreateParent({
      selectedPath: "",
      selectedKind: "",
      selectedDir: "",
      activeFile: "packages/app/src/main.ts",
    })).toBe("packages/app/src")
  })

  it("uses the active file directory prop when the active file itself is also supplied", () => {
    expect(resolveExplorerCreateParent({
      activeFile: "packages/app/src/main.ts",
      selectedDir: "",
      explicitParentPath: "",
    })).toBe("packages/app/src")
  })

  it("keeps multi-root virtual parent paths instead of silently falling back to another root", () => {
    expect(resolveExplorerCreateParent({
      selectedPath: "/client (apps)/src",
      selectedKind: "dir",
      activeFile: "/client (libs)/README.md",
    })).toBe("/client (apps)/src")
  })

  it("falls back to project root when there is no selection or active file", () => {
    expect(resolveExplorerCreateParent({})).toBe("")
    expect(describeCreateParent("")).toBe("项目根目录")
  })

  it("uses explicit parent path for context-menu create actions", () => {
    expect(resolveExplorerCreateParent({
      explicitParentPath: "docs",
      selectedPath: "scripts/ar-health.js",
      selectedKind: "file",
      activeFile: "src/App.vue",
    })).toBe("docs")
  })

  it("normalizes create parent resources with VS Code URI path semantics", () => {
    const snapshot = resolveExplorerCreateTargetSnapshot({
      explicitParentPath: "src/../docs/",
      projectRoot: "D:/Workspace",
      projectName: "Codek",
      workspaceRoots: ["D:/Workspace"],
    })

    expect(snapshot.parentPath).toBe("docs")
    expect(snapshot.parentLabel).toBe("docs")
    expect(snapshot.resolvedAbsoluteParent).toBe("D:/Workspace/docs")
  })

  it("uses VS Code resource dirname for normalized selected files", () => {
    expect(resolveExplorerCreateParent({
      selectedPath: "src/../scripts/main.ts",
      selectedKind: "file",
    })).toBe("scripts")
  })

  it("keeps Windows absolute selected files anchored to the matching workspace root", () => {
    const snapshot = resolveExplorerCreateTargetSnapshot({
      selectedPath: "D:\\Workspace\\frontend\\App.vue",
      selectedKind: "file",
      projectRoot: "D:/Workspace",
      workspaceRoots: ["D:/Workspace"],
      workspaceRootLabels: { "D:/Workspace": "Codek" },
    })

    expect(snapshot.workspaceRoot).toBe("D:/Workspace")
    expect(snapshot.parentPath).toBe("D:/Workspace/frontend")
    expect(snapshot.resolvedAbsoluteParent).toBe("D:/Workspace/frontend")
  })

  it("creates a single snapshot for display label and actual parent", () => {
    const snapshot = resolveExplorerCreateTargetSnapshot({
      selectedPath: "src/features",
      selectedKind: "dir",
      activeFile: "packages/lib/src/index.ts",
      projectRoot: "D:/Workspace",
      projectName: "Codek",
      workspaceRoots: ["D:/Workspace"],
      workspaceRootLabels: { "D:/Workspace": "Codek" },
    })

    expect(snapshot.parentPath).toBe("src/features")
    expect(snapshot.displayLabel).toBe("src/features")
    expect(snapshot.resolvedAbsoluteParent).toBe("D:/Workspace/src/features")
    expect(describeCreateParent(snapshot)).toBe("src/features")
  })

  it("shows the real root label for root fallback snapshots", () => {
    const snapshot = resolveExplorerCreateTargetSnapshot({
      projectRoot: "D:/Workspace",
      projectName: "Codek",
      workspaceRoots: ["D:/Workspace"],
      workspaceRootLabels: { "D:/Workspace": "Codek" },
    })

    expect(snapshot.parentPath).toBe("")
    expect(snapshot.rootLabel).toBe("Codek")
    expect(snapshot.displayLabel).toBe("Codek")
    expect(snapshot.resolvedAbsoluteParent).toBe("D:/Workspace")
  })

  it("keeps multi-root selected target anchored instead of using active file root", () => {
    const snapshot = resolveExplorerCreateTargetSnapshot({
      selectedPath: "/client (apps)/src",
      selectedKind: "dir",
      activeFile: "/client (libs)/src/lib.ts",
      projectRoot: "D:/workspace/client.code-workspace",
      workspaceRoots: ["D:/mono/apps/client", "D:/mono/libs/client"],
      workspaceRootLabels: {
        "D:/mono/apps/client": "client (apps)",
        "D:/mono/libs/client": "client (libs)",
      },
    })

    expect(snapshot.workspaceRoot).toBe("D:/mono/apps/client")
    expect(snapshot.parentPath).toBe("/client (apps)/src")
    expect(snapshot.resolvedAbsoluteParent).toBe("D:/mono/apps/client/src")
  })
})
