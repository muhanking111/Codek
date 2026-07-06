import { mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import FileTree from "./FileTree.vue"
import { provideI18n } from "../i18n/index"
import { ensureFileIconTheme } from "../extensions/iconThemes"
import { ConfigurationTarget, settingsStore } from "../settings/settingsStore"
import { workbenchThemeService } from "../vscode-adapter/platform/theme/common/themeService"
import { Emitter } from "../vscode-adapter/base/common/event"
import { URI } from "../vscode-adapter/base/common/uri"
import {
  FileOperation,
  FileOperationEvent,
  FileType,
  type FileChangesEvent,
  type FileOperationEvent as FileOperationEventType,
  type IFileStatWithMetadata,
} from "../vscode-adapter/platform/files/common/files"

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(async (path?: string) => {
    const themeId = String(path || "").split("/").pop() || "vs-seti"
    return {
      found: true,
      themeId: decodeURIComponent(themeId),
      icons: {
        fileExtensions: {
          vue: { id: "_vue", iconPath: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", fontColor: "#42b883" },
        },
      },
    }
  }),
}))

vi.mock("../lib/api", () => ({
  api: {
    get: mocks.apiGet,
  },
}))

describe("FileTree", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    settingsStore.reset()
    ;(window as unknown as { codek?: unknown }).codek = {
      readDir: vi.fn(async (path: string) => {
        if (path === "D:/repo") return [{ name: "src", path: "D:/repo/src", isDirectory: true }]
        return []
      }),
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as unknown as { codek?: unknown }).codek
  })

  it("reads real filesystem explorer directories without the legacy maxEntries cap", async () => {
    const readDir = vi.fn(async (path: string, _options?: Record<string, unknown>) => {
      if (path === "D:/repo") return [{ name: "src", path: "D:/repo/src", isDirectory: true }]
      return []
    })
    ;(window as unknown as { codek?: { readDir: typeof readDir } }).codek = { readDir }

    const wrapper = mount(FileTree, {
      attachTo: document.body,
      global: mountGlobal(),
      props: {
        files: {},
        isRealFS: true,
        projectRoot: "D:/repo",
        workspaceRoots: ["D:/repo"],
        projectName: "repo",
      },
    })
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    expect(readDir).toHaveBeenCalledWith("D:/repo", { source: "explorer" })
    expect(readDir.mock.calls.some(([, options]) => Object.prototype.hasOwnProperty.call(options || {}, "maxEntries"))).toBe(false)

    wrapper.unmount()
  })

  it("keeps the native explorer tree widget as the only real filesystem tab stop", async () => {
    const wrapper = mount(FileTree, {
      attachTo: document.body,
      global: mountGlobal(),
      props: {
        files: {},
        isRealFS: true,
        projectRoot: "D:/repo",
        workspaceRoots: ["D:/repo"],
        projectName: "repo",
      },
    })
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    const outer = wrapper.find(".tree-entries")
    const tree = wrapper.find(".codek-list-view")

    expect(outer.attributes("tabindex")).toBeUndefined()
    expect(tree.attributes("role")).toBe("tree")
    expect(tree.attributes("aria-label")).toBe("Files Explorer")
    expect((tree.element as HTMLElement).tabIndex).toBe(0)
    expect(tree.attributes("aria-activedescendant")).toBe(wrapper.find("[data-uri='D:/repo']").attributes("id"))
    expect(outer.attributes("aria-activedescendant")).toBeUndefined()

    wrapper.unmount()
  })

  it("keeps inline create input focused inside the native renderer", async () => {
    const focus = vi.spyOn(HTMLInputElement.prototype, "focus").mockImplementation(() => {})
    const selectRange = vi.spyOn(HTMLInputElement.prototype, "setSelectionRange").mockImplementation(() => {})
    const wrapper = mount(FileTree, {
      attachTo: document.body,
      global: mountGlobal(),
      props: {
        files: {},
        isRealFS: true,
        projectRoot: "D:/repo",
        workspaceRoots: ["D:/repo"],
        projectName: "repo",
      },
    })
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    await wrapper.find(".tree-action-btn").trigger("click")
    await wrapper.vm.$nextTick()
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    expect(wrapper.find(".codek-explorer-row.editable").exists()).toBe(true)
    expect(focus).toHaveBeenCalled()
    expect(selectRange).toHaveBeenCalled()

    focus.mockRestore()
    selectRange.mockRestore()
    wrapper.unmount()
  })

  it("does not show legacy recursive skip notices in the real filesystem explorer", async () => {
    const wrapper = mount(FileTree, {
      attachTo: document.body,
      global: mountGlobal(),
      props: {
        files: {},
        isRealFS: true,
        projectRoot: "D:/repo",
        workspaceRoots: ["D:/repo"],
        projectName: "repo",
        treeStats: { nodeCount: 42, truncated: true, ignoredCount: 9 },
      },
    })
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    expect(wrapper.find(".tree-health-note").exists()).toBe(false)
    expect(wrapper.text()).not.toContain("已跳过")
    expect(wrapper.text()).not.toContain("安全上限")

    wrapper.unmount()
  })


  it("keeps an empty inline create editor alive during the focus protection window", async () => {
    const focus = vi.spyOn(HTMLInputElement.prototype, "focus").mockImplementation(() => {})
    const wrapper = mount(FileTree, {
      attachTo: document.body,
      global: mountGlobal(),
      props: {
        files: {},
        isRealFS: true,
        projectRoot: "D:/repo",
        workspaceRoots: ["D:/repo"],
        projectName: "repo",
      },
    })
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    await wrapper.find(".tree-action-btn").trigger("click")
    await wrapper.vm.$nextTick()
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()
    await wrapper.find(".codek-explorer-input").trigger("blur")
    vi.advanceTimersByTime(160)
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    expect(wrapper.find(".codek-explorer-row.editable").exists()).toBe(true)
    expect(focus).toHaveBeenCalled()

    focus.mockRestore()
    wrapper.unmount()
  })

  it("keeps the real filesystem inline editor as the active hit target while it is clicked", async () => {
    const explorerCommand = vi.fn()
    const focus = vi.spyOn(HTMLInputElement.prototype, "focus").mockImplementation(() => {})
    const wrapper = mount(FileTree, {
      attachTo: document.body,
      global: mountGlobal(),
      props: {
        files: {},
        isRealFS: true,
        projectRoot: "D:/repo",
        workspaceRoots: ["D:/repo"],
        projectName: "repo",
        onExplorerCommand: explorerCommand,
      },
    })
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    await wrapper.find(".tree-action-btn").trigger("click")
    await wrapper.vm.$nextTick()
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()
    const inlineCreate = wrapper.find<HTMLElement>(".codek-explorer-row.editable")
    const input = inlineCreate.find<HTMLInputElement>(".codek-explorer-input")

    expect(inlineCreate.exists()).toBe(true)
    expect(getComputedStyle(inlineCreate.element).pointerEvents).toBe("auto")
    expect(inlineCreate.classes()).toContain("editable")
    expect(wrapper.find(".codek-explorer-inline-create").exists()).toBe(false)

    await input.trigger("pointerdown")
    expect(focus).toHaveBeenCalled()

    await input.trigger("click")
    vi.advanceTimersByTime(160)
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    expect(wrapper.find(".codek-explorer-row.editable").exists()).toBe(true)
    expect(explorerCommand).not.toHaveBeenCalledWith({ command: "explorer.clearSelection" })

    focus.mockRestore()
    wrapper.unmount()
  })

  it("does not render folder icons for the real filesystem inline folder input", async () => {
    const wrapper = mount(FileTree, {
      attachTo: document.body,
      global: mountGlobal(),
      props: {
        files: {},
        isRealFS: true,
        projectRoot: "D:/repo",
        workspaceRoots: ["D:/repo"],
        projectName: "repo",
      },
    })
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    await wrapper.findAll(".tree-action-btn")[1].trigger("click")
    await wrapper.vm.$nextTick()

    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()
    const inlineCreate = wrapper.find(".codek-explorer-row.editable")
    expect(inlineCreate.exists()).toBe(true)
    expect(inlineCreate.find(".codek-explorer-input").exists()).toBe(true)
    expect(inlineCreate.find(".inline-create-target").exists()).toBe(false)
    expect(inlineCreate.find(".file-icon-svg").exists()).toBe(false)
    expect(inlineCreate.find(".theme-image-icon").exists()).toBe(false)
    expect(inlineCreate.find(".theme-font-icon").exists()).toBe(false)
    expect(inlineCreate.find(".fallback-token-icon").exists()).toBe(false)

    wrapper.unmount()
  })

  it("keeps memory fallback dirty indicators on SCM decorations instead of dirty file state", async () => {
    const wrapper = mount(FileTree, {
      attachTo: document.body,
      global: mountGlobal(),
      props: {
        files: { "src/App.ts": "export const app = true" },
        isRealFS: false,
        projectName: "repo",
        dirtyFiles: { "src/App.ts": true },
        externalChanges: { "src/App.ts": true },
      },
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.find(".file-dirty").exists()).toBe(false)
    expect(wrapper.find(".memory-file-decoration").exists()).toBe(false)

    await wrapper.setProps({
      dirtyFiles: { "src/App.ts": false },
      externalChanges: { "src/App.ts": false },
      gitDecorations: { "src/App.ts": { label: "M", tooltip: "Git: 修改" } },
    })
    await wrapper.vm.$nextTick()

    const decoration = wrapper.find(".memory-file-decoration")
    expect(decoration.exists()).toBe(true)
    expect(decoration.text()).toBe("M")
    expect(decoration.attributes("title")).toBe("Git: 修改")

    wrapper.unmount()
  })

  it("projects native explorer decorations from gitDecorations without legacy dirty state", async () => {
    const readDir = vi.fn(async (path: string) => {
      if (path === "D:/repo") return [{ name: "App.ts", path: "D:/repo/App.ts", isDirectory: false }]
      return []
    })
    ;(window as unknown as { codek?: { readDir: typeof readDir } }).codek = { readDir }
    const wrapper = mount(FileTree, {
      attachTo: document.body,
      global: mountGlobal(),
      props: {
        files: {},
        isRealFS: true,
        projectRoot: "D:/repo",
        workspaceRoots: ["D:/repo"],
        projectName: "repo",
        dirtyFiles: { "D:/repo/App.ts": true },
        externalChanges: { "D:/repo/App.ts": true },
        gitDecorations: { "D:/repo/App.ts": { label: "M", tooltip: "Git: 修改" } },
      },
    })
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()
    await vi.runOnlyPendingTimersAsync()
    await wrapper.vm.$nextTick()

    const decoration = wrapper.find("[data-uri='D:/repo/App.ts'] .codek-explorer-decoration")
    expect(decoration.exists()).toBe(true)
    expect(decoration.text()).toBe("M")
    expect(decoration.attributes("title")).toBe("Git: 修改")
    expect(wrapper.find("[data-uri='D:/repo/App.ts'] .file-dirty").exists()).toBe(false)

    wrapper.unmount()
  })

  it("keeps a file icon only for real filesystem inline file creation", async () => {
    const wrapper = mount(FileTree, {
      attachTo: document.body,
      global: mountGlobal(),
      props: {
        files: {},
        isRealFS: true,
        projectRoot: "D:/repo",
        workspaceRoots: ["D:/repo"],
        projectName: "repo",
      },
    })
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    await wrapper.findAll(".tree-action-btn")[0].trigger("click")
    await wrapper.vm.$nextTick()

    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()
    const inlineCreate = wrapper.find(".codek-explorer-row.editable")
    expect(inlineCreate.exists()).toBe(true)
    expect(inlineCreate.find(".codek-explorer-input").exists()).toBe(true)
    expect(inlineCreate.find(".inline-create-target").exists()).toBe(false)
    expect(inlineCreate.find(".file-icon-svg").exists()).toBe(false)
    expect(inlineCreate.find(".codek-explorer-icon").exists()).toBe(true)

    wrapper.unmount()
  })

  it("keeps the inline editor open when VS Code name validation rejects the create", async () => {
    const inlineCreateHandler = vi.fn(async () => {
      throw new Error("The name is not valid.")
    })
    const focus = vi.spyOn(HTMLInputElement.prototype, "focus").mockImplementation(() => {})
    const wrapper = mount(FileTree, {
      attachTo: document.body,
      global: mountGlobal(),
      props: {
        files: {},
        isRealFS: true,
        projectRoot: "D:/repo",
        workspaceRoots: ["D:/repo"],
        projectName: "repo",
        onInlineCreate: inlineCreateHandler,
      },
    })
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    await wrapper.find(".tree-action-btn").trigger("click")
    await wrapper.vm.$nextTick()
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()
    const editableRow = wrapper.find(".codek-explorer-row.editable")
    const input = editableRow.find<HTMLInputElement>(".codek-explorer-input")
    input.element.value = "bad-name.ts"
    input.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    expect(inlineCreateHandler).toHaveBeenCalledWith(expect.objectContaining({ name: "bad-name.ts" }))
    expect(wrapper.find(".codek-explorer-row.editable").exists()).toBe(true)

    focus.mockRestore()
    wrapper.unmount()
  })

  it("routes real filesystem rename through the native editable row instead of the legacy command prompt", async () => {
    const renameEntry = vi.fn(async () => undefined)
    const explorerCommand = vi.fn()
    const wrapper = mount(FileTree, {
      attachTo: document.body,
      global: mountGlobal(),
      props: {
        files: {},
        isRealFS: true,
        projectRoot: "D:/repo",
        workspaceRoots: ["D:/repo"],
        projectName: "repo",
        onRenameEntry: renameEntry,
        onExplorerCommand: explorerCommand,
      },
    })
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    expect(await (wrapper.vm as unknown as { startRename: (path: string) => Promise<boolean> }).startRename("D:/repo/src")).toBe(true)
    await wrapper.vm.$nextTick()
    const editableRow = wrapper.find(".codek-explorer-row.editable")
    const input = editableRow.find<HTMLInputElement>(".codek-explorer-input")
    input.element.value = "source"
    input.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()
    await Promise.resolve()

    expect(renameEntry).toHaveBeenCalledWith({
      path: "D:/repo/src",
      newPath: "D:/repo/source",
      name: "source",
    })
    expect(explorerCommand).not.toHaveBeenCalledWith({ command: "explorer.rename", path: "D:/repo/src" })
    expect(wrapper.find(".codek-explorer-row.editable").exists()).toBe(false)

    wrapper.unmount()
  })

  it("binds VS Code FileService operation events to the native explorer host", async () => {
    const readDir = vi.fn(async (path: string) => {
      if (path === "D:/repo") return [{ name: "src", path: "D:/repo/src", isDirectory: true }]
      if (path === "D:/repo/src") return []
      return []
    })
    ;(window as unknown as { codek?: { readDir: typeof readDir } }).codek = { readDir }
    const operationEmitter = new Emitter<FileOperationEventType>()
    const changeEmitter = new Emitter<FileChangesEvent>()
    const wrapper = mount(FileTree, {
      attachTo: document.body,
      global: mountGlobal(),
      props: {
        files: {},
        isRealFS: true,
        projectRoot: "D:/repo",
        workspaceRoots: ["D:/repo"],
        projectName: "repo",
      },
    })
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    await (wrapper.vm as unknown as { expandPath: (path: string) => Promise<boolean> }).expandPath("D:/repo/src")
    ;(wrapper.vm as unknown as {
      bindFileService: (fileService: {
        onDidRunOperation: typeof operationEmitter.event
        onDidFilesChange: typeof changeEmitter.event
      }) => { dispose(): void }
    }).bindFileService({
      onDidRunOperation: operationEmitter.event,
      onDidFilesChange: changeEmitter.event,
    })

    operationEmitter.fire(new FileOperationEvent(
      URI.file("D:/repo/src/new.ts"),
      FileOperation.CREATE,
      stat("D:/repo/src/new.ts"),
    ))
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    expect(wrapper.find("[data-uri='D:/repo/src/new.ts']").exists()).toBe(true)
    expect(wrapper.find("[data-uri='D:/repo/src/new.ts']").classes()).toContain("selected")

    wrapper.unmount()
  })

  it("updates the native explorer icon theme from IWorkbenchThemeService events", async () => {
    const readDir = vi.fn(async (path: string) => {
      if (path === "D:/repo") return [{ name: "App.vue", path: "D:/repo/App.vue", isDirectory: false }]
      return []
    })
    ;(window as unknown as { codek?: { readDir: typeof readDir } }).codek = { readDir }
    const wrapper = mount(FileTree, {
      attachTo: document.body,
      global: mountGlobal(),
      props: {
        files: {},
        isRealFS: true,
        projectRoot: "D:/repo",
        workspaceRoots: ["D:/repo"],
        projectName: "repo",
      },
    })
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()
    await vi.runOnlyPendingTimersAsync()
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()

    expect(wrapper.find("[data-uri='D:/repo/App.vue'] .codek-explorer-icon").exists()).toBe(true)
    expect(wrapper.find("[data-uri='D:/repo/App.vue'] .codek-explorer-icon").classes()).toContain("theme-icon-vue")
    expect(wrapper.find("[data-uri='D:/repo/App.vue'] .codek-explorer-icon").attributes("data-file-icon-theme-id")).toBe("vs-seti")
    expect(wrapper.find("[data-uri='D:/repo/App.vue'] .codek-explorer-icon").attributes("data-file-icon-source")).toBe("image")

    await workbenchThemeService.setFileIconTheme("minimal", ConfigurationTarget.USER)
    await vi.dynamicImportSettled()
    await wrapper.vm.$nextTick()
    await vi.runOnlyPendingTimersAsync()
    await wrapper.vm.$nextTick()

    expect(wrapper.find("[data-uri='D:/repo/App.vue'] .codek-explorer-icon").classes()).toContain("fallback-seti-icon")
    expect(wrapper.find("[data-uri='D:/repo/App.vue'] .codek-explorer-icon").attributes("data-file-icon-theme-id")).toBe("minimal")
    expect(wrapper.find("[data-uri='D:/repo/App.vue'] .codek-explorer-icon").attributes("data-file-icon-source")).toBe("fallback")
    expect(await ensureFileIconTheme("vs-seti")).toMatchObject({ themeId: "vs-seti" })
    await vi.runOnlyPendingTimersAsync()
    await wrapper.vm.$nextTick()
    expect(wrapper.find("[data-uri='D:/repo/App.vue'] .codek-explorer-icon").classes()).toContain("fallback-seti-icon")
    expect(wrapper.find("[data-uri='D:/repo/App.vue'] .codek-explorer-icon").classes()).not.toContain("theme-icon-vue")

    wrapper.unmount()
  })
})

function mountGlobal() {
  return {
    plugins: [
      {
        install(app: { provide: (key: symbol | string, value: unknown) => void }) {
          provideI18n(app)
        },
      },
    ],
  }
}

function stat(path: string, isDirectory = false): IFileStatWithMetadata {
  return {
    resource: URI.file(path),
    name: path.split(/[\\/]/).pop() || path,
    type: isDirectory ? FileType.Directory : FileType.File,
    isFile: !isDirectory,
    isDirectory,
    isSymbolicLink: false,
    mtime: 1,
    ctime: 1,
    size: 1,
    etag: "1",
    readonly: false,
    locked: false,
    executable: false,
    children: undefined,
  }
}
