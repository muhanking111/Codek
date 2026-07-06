<template>
  <div class="file-tree">
    <div class="tree-toolbar">
      <span class="tree-title">{{ projectName || t('sidebar.files') }}</span>
      <div class="tree-actions">
        <button class="tree-action-btn" data-codek-smoke="explorer-new-file" @click="startCreate('file')" :title="t('fileTree.newFile')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
        </button>
        <button class="tree-action-btn" data-codek-smoke="explorer-new-folder" @click="startCreate('folder')" :title="t('fileTree.newFolder')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <line x1="12" y1="11" x2="12" y2="17" />
            <line x1="9" y1="14" x2="15" y2="14" />
          </svg>
        </button>
        <button class="tree-action-btn" @click="handleRefresh" :title="t('fileTree.refresh')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>
    </div>

    <div class="tree-filter-wrap">
      <input
        v-model="filterQuery"
        class="tree-filter-input"
        type="text"
        :placeholder="t('fileTree.filter') || '过滤文件...'"
        @keydown.esc="filterQuery = ''"
      />
      <button v-if="filterQuery" class="tree-filter-clear" @click="filterQuery = ''">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
      </button>
    </div>

    <div v-if="isRealFS && !projectRoot && projectName && !creating.active" class="tree-empty tree-empty-compact">
      <span class="tree-empty-title">{{ t('fileTree.emptyFolderTitle') }}</span>
      <span class="tree-empty-hint" :title="projectRoot">{{ projectRoot }}</span>
      <button class="tree-empty-primary" type="button" @click="$emit('refresh')">
        {{ t('fileTree.refresh') }}
      </button>
    </div>

    <div v-if="!isRealFS && (treeStats?.truncated || treeStats?.ignoredCount > 0)" class="tree-health-note">
      <span v-if="treeStats?.truncated">文件树已按安全上限显示，避免大工作区卡死。</span>
      <span v-else>已跳过 {{ treeStats.ignoredCount }} 个重目录的递归读取。</span>
    </div>

    <div
      v-if="isRealFS"
      ref="treeEntriesRef"
      class="tree-entries codek-explorer-host"
      @click="handleTreeBackgroundClick"
    >
      <div ref="nativeTreeMountRef" class="codek-explorer-mount" data-codek-smoke="native-explorer-host"></div>
    </div>

    <div
      v-if="contextMenu.open"
      class="explorer-context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      data-codek-smoke="explorer-context-menu"
      @click.stop
    >
      <template v-for="item in contextMenuItems" :key="item.id">
        <div v-if="item.separator" class="explorer-context-separator" />
        <button
          v-else
          class="explorer-context-item"
          :class="{ disabled: item.disabled }"
          :disabled="item.disabled"
          type="button"
          @click="runContextAction(item.id)"
        >
          <span>{{ item.label }}</span>
          <kbd v-if="item.shortcut">{{ item.shortcut }}</kbd>
        </button>
      </template>
    </div>

    <div v-if="!isRealFS" class="memory-files">
      <div v-if="Object.keys(files).length === 0 && !creating.active" class="tree-empty tree-empty-workspace">
        <div class="empty-workspace-icon" aria-hidden="true">
          <svg width="31" height="26" viewBox="0 0 31 26" fill="none">
            <path d="M2.5 6.5h9.1l2 3h14.9v13H2.5z" />
            <path d="M2.5 6.5v-3h8.2l2.1 3" />
          </svg>
        </div>
        <div class="tree-empty-copy">
          <span class="tree-empty-title">{{ t('fileTree.noFolderTitle') }}</span>
          <span class="tree-empty-desc">{{ t('fileTree.noFolderDesc') }}</span>
        </div>
        <div class="tree-empty-actions">
          <button class="tree-empty-primary" type="button" @click="$emit('openProject')">
            {{ t('fileTree.openFolder') }}
          </button>
          <button class="tree-empty-secondary" type="button" @click="$emit('cloneRepository')">
            {{ t('fileTree.cloneRepository') }}
          </button>
          <button
            class="tree-empty-secondary"
            type="button"
            data-codek-smoke="create-java-project"
            @click="$emit('createJavaProject')"
          >
            {{ t('fileTree.createJavaProject') }}
          </button>
        </div>
      </div>

      <!-- 内存模式的内联创建输入框 -->
      <div v-if="creating.active && !isRealFS" class="inline-create-row">
        <FileIcon :name="creating.inputValue || ''" />
        <input
          ref="inlineInputRef"
          v-model="creating.inputValue"
          class="inline-create-input"
          data-codek-smoke="explorer-inline-create-input"
          type="text"
          placeholder="文件名，例如 main.py"
          @keydown.enter.prevent="confirmCreate"
          @keydown.esc.prevent="cancelCreate"
          @focus="clearCreateBlurTimeout"
          @pointerdown.stop="handleInlineCreatePointerDown"
          @blur="handleBlur"
        />
      </div>

      <div
        v-for="(code, path) in filteredFiles"
        :key="path"
        class="file-item"
        :class="{ active: activeFile === path }"
        @click="$emit('openFile', path)"
      >
        <FileIcon :name="path" />
        <span class="file-label">{{ path }}</span>
        <span
          v-if="memoryDecoration(path)"
          class="memory-file-decoration"
          :title="memoryDecoration(path).tooltip || memoryDecoration(path).label || memoryDecoration(path).status || ''"
        >
          {{ memoryDecoration(path).label || memoryDecoration(path).status || '' }}
        </span>
        <button class="file-delete-btn" @click.stop="$emit('deleteEntry', path)" :title="t('fileTree.delete')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <button class="btn-add" @click="startCreate('file')">{{ t('fileTree.newFile') }}</button>
    </div>
  </div>
</template>
<script setup>
import { computed, getCurrentInstance, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue"
import FileIcon from "./FileIcon.vue"
import { useI18n } from "../i18n/index"
import { ExplorerTreeHost } from "../explorer/tree/ExplorerTreeHost"
import { ensureFileIconTheme, fileIconThemeFontLoadVersion, installFileIconThemeFonts } from "../extensions/iconThemes"
import { VSCODE_EXPLORER_ITEM_HEIGHT } from "../vscode-adapter/base/browser/ui/tree/treeLayout"
import { workbenchThemeService } from "../vscode-adapter/platform/theme/common/themeService"
import { getExplorerSortOrderConfiguration } from "../vscode-adapter/workbench/contrib/files/explorerSettings"
import { dirname, resolveExplorerCreateTargetSnapshot } from "../workbench/createTarget"
import { getWellFormedFileName } from "../vscode-adapter/workbench/contrib/files/fileActions"

const { t } = useI18n()

const props = defineProps({
  files: Object,
  activeFile: String,
  selectedPath: String,
  selectedKind: String,
  projectRoot: String,
  workspaceRoots: { type: Array, default: () => [] },
  workspaceRootLabels: { type: Object, default: () => ({}) },
  workspaceScaleProfile: { type: Object, default: null },
  isRealFS: Boolean,
  projectName: String,
  dirtyFiles: { type: Object, default: () => ({}) },
  externalChanges: { type: Object, default: () => ({}) },
  gitDecorations: { type: Object, default: () => ({}) },
  treeStats: { type: Object, default: () => ({ nodeCount: 0, truncated: false, ignoredCount: 0 }) },
  selectedDir: { type: String, default: "" },
  activeFileDir: { type: String, default: "" },
})

const emit = defineEmits([
  "openFile", "openProject", "addFile", "createFile", "createFolder",
  "deleteEntry", "renameEntry", "refresh", "selectDir",
  "inlineCreate", "createJavaProject", "cloneRepository", "explorerCommand",
])
const instance = getCurrentInstance()

const filterQuery = ref("")
const inlineInputRef = ref(null)
const treeEntriesRef = ref(null)
const nativeTreeMountRef = ref(null)
const TREE_ROW_HEIGHT = VSCODE_EXPLORER_ITEM_HEIGHT
let explorerHost = null
let pendingExplorerFileService = null
let explorerFileServiceBinding = null
let explorerHostUpdateFrame = 0
let inlineCreateFocusFrame = 0
let inlineCreateFocusDeadline = 0
const currentFileIconTheme = ref(workbenchThemeService.getFileIconTheme())
const loadedFileIconTheme = ref(null)
const fileIconThemeChange = workbenchThemeService.onDidFileIconThemeChange((theme) => {
  currentFileIconTheme.value = theme
})

const creating = reactive({
  active: false,
  type: "",
  parentPath: "",
  targetSnapshot: null,
  inputValue: "",
})

const contextMenu = reactive({
  open: false,
  x: 0,
  y: 0,
  entry: null,
})

function resolveCreateTarget(explicitParentPath = "") {
  return resolveExplorerCreateTargetSnapshot({
    explicitParentPath,
    selectedPath: props.selectedPath,
    selectedKind: props.selectedKind,
    selectedDir: props.selectedDir,
    activeFile: props.activeFileDir || props.activeFile,
    projectRoot: props.projectRoot,
    projectName: props.projectName,
    workspaceRoots: props.workspaceRoots,
    workspaceRootLabels: props.workspaceRootLabels,
  })
}

function startCreate(type, parentPath = "") {
  if (props.isRealFS) {
    const targetSnapshot = resolveCreateTarget(parentPath)
    if (targetSnapshot.parentPath) void explorerHost?.expandPath(targetSnapshot.parentPath)
    void explorerHost?.startCreate?.(type, targetSnapshot.parentPath, targetSnapshot)
    return
  }
  clearCreateBlurTimeout()
  creating.active = true
  creating.type = type
  creating.inputValue = ""
  creating.targetSnapshot = resolveCreateTarget(parentPath)
  creating.parentPath = creating.targetSnapshot.parentPath

  if (creating.parentPath && props.isRealFS) void explorerHost?.expandPath(creating.parentPath)

  scheduleInlineCreateFocus(10)
}

async function confirmCreate() {
  const name = getWellFormedFileName(creating.inputValue)
  if (!name && !creating.inputValue) {
    cancelCreate()
    return
  }
  try {
    await emitPromise("inlineCreate", {
      type: creating.type,
      parentPath: creating.parentPath,
      targetSnapshot: creating.targetSnapshot,
      name,
    })
  } catch {
    scheduleInlineCreateFocus()
    return
  }
  creating.active = false
  creating.type = ""
  creating.parentPath = ""
  creating.targetSnapshot = null
  creating.inputValue = ""
  inlineCreateFocusDeadline = 0
}

function cancelCreate() {
  if (props.isRealFS) {
    explorerHost?.cancelCreate?.()
    return
  }
  clearCreateBlurTimeout()
  clearInlineCreateFocusFrame()
  inlineCreateFocusDeadline = 0
  creating.active = false
  creating.type = ""
  creating.parentPath = ""
  creating.targetSnapshot = null
  creating.inputValue = ""
}

let blurTimeout = null
function clearCreateBlurTimeout() {
  if (!blurTimeout) return
  clearTimeout(blurTimeout)
  blurTimeout = null
}

function handleBlur() {
  clearCreateBlurTimeout()
  blurTimeout = setTimeout(() => {
    blurTimeout = null
    if (inlineInputRef.value && document.activeElement === inlineInputRef.value) return
    if (creating.active) {
      const name = getWellFormedFileName(creating.inputValue)
      if (name || creating.inputValue) {
        void confirmCreate()
      } else if (isInlineCreateFocusProtected()) {
        scheduleInlineCreateFocus(4)
      } else {
        cancelCreate()
      }
    }
  }, 150)
}

function handleInlineCreatePointerDown(event) {
  event?.stopPropagation?.()
  clearCreateBlurTimeout()
  inlineCreateFocusDeadline = Date.now() + 600
  const input = event?.currentTarget || inlineInputRef.value
  if (!input?.focus) return
  input.focus({ preventScroll: true })
  requestFocusFrame(() => {
    if (!creating.active) return
    input.focus({ preventScroll: true })
  })
}

function scheduleInlineCreateFocus(attempts = 6) {
  inlineCreateFocusDeadline = Date.now() + Math.max(250, attempts * 120)
  clearInlineCreateFocusFrame()
  nextTick(() => {
    let remaining = attempts
    const tick = () => {
      inlineCreateFocusFrame = 0
      if (!creating.active) return
      const input = inlineInputRef.value
      if (input) {
        input.focus({ preventScroll: true })
        input.select?.()
        if (document.activeElement === input) return
      }
      remaining -= 1
      if (remaining <= 0) return
      inlineCreateFocusFrame = requestFocusFrame(tick)
    }
    tick()
  })
}

function isInlineCreateFocusProtected() {
  return creating.active && Date.now() <= inlineCreateFocusDeadline
}

function clearInlineCreateFocusFrame() {
  if (!inlineCreateFocusFrame) return
  cancelFocusFrame(inlineCreateFocusFrame)
  inlineCreateFocusFrame = 0
}

function requestFocusFrame(callback) {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback)
  return setTimeout(callback, 16)
}

function cancelFocusFrame(frame) {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame)
  clearTimeout(frame)
}

async function emitPromise(eventName, payload) {
  const handlers = getCurrentInstanceHandlers(eventName)
  if (handlers.length === 0) {
    emit(eventName, payload)
    return
  }
  await Promise.all(handlers.map((handler) => handler(payload)))
}

function getCurrentInstanceHandlers(eventName) {
  const propsKey = `on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`
  const value = instance?.vnode?.props?.[propsKey]
  if (Array.isArray(value)) return value
  return typeof value === "function" ? [value] : []
}

const filteredFiles = computed(() => {
  if (!filterQuery.value || !props.files) return props.files
  const q = filterQuery.value.toLowerCase()
  const result = {}
  for (const [path, code] of Object.entries(props.files)) {
    if (path.toLowerCase().includes(q)) result[path] = code
  }
  return result
})

function memoryDecoration(path) {
  const decoration = props.gitDecorations?.[path] || props.gitDecorations?.[relativeDecorationKey(path)]
  if (!decoration) return null
  if (typeof decoration === "string") return { label: decoration, tooltip: decoration }
  return decoration
}

function relativeDecorationKey(path) {
  return String(path || "").replace(/\\/g, "/").split("/").slice(-3).join("/")
}

const contextMenuItems = computed(() => {
  const entry = contextMenu.entry
  const isDir = Boolean(entry?.isDir)
  const hasEntry = Boolean(entry)
  return [
    { id: "open", label: "打开", disabled: !hasEntry || isDir, shortcut: "Enter" },
    { separator: true, id: "sep-create" },
    { id: "newFile", label: "新建文件" },
    { id: "newFolder", label: "新建文件夹" },
    { separator: true, id: "sep-edit" },
    { id: "rename", label: "重命名", disabled: !hasEntry, shortcut: "F2" },
    { id: "delete", label: "删除", disabled: !hasEntry, shortcut: "Del" },
    { id: "copy", label: "复制", disabled: !hasEntry, shortcut: "Ctrl+C" },
    { id: "cut", label: "剪切", disabled: !hasEntry, shortcut: "Ctrl+X" },
    { id: "paste", label: "粘贴", disabled: !props.isRealFS, shortcut: "Ctrl+V" },
    { separator: true, id: "sep-path" },
    { id: "copyPath", label: "复制路径", disabled: !hasEntry },
    { id: "copyRelativePath", label: "复制相对路径", disabled: !hasEntry },
    { id: "showInFolder", label: "在系统资源管理器中显示", disabled: !hasEntry },
    { id: "openTerminal", label: "在终端中打开" },
    { separator: true, id: "sep-refresh" },
    { id: "refresh", label: "刷新" },
  ]
})

function revealPath(path) {
  if (props.isRealFS) return explorerHost?.revealPath(path) || false
  return false
}

function expandPath(path) {
  if (props.isRealFS) return explorerHost?.expandPath(path) || false
  return false
}

function startRename(path) {
  if (props.isRealFS) return explorerHost?.startRename?.(path) || false
  emit("explorerCommand", { command: "explorer.rename", path })
  return false
}

async function handleRefresh() {
  emit("refresh")
}

async function refreshExplorer() {
  if (!props.isRealFS) return
  if (typeof window !== "undefined") {
    window.__codekSmokeFileOperationDebug = {
      ...(window.__codekSmokeFileOperationDebug || {}),
      fileTreeRefreshStartedAt: Date.now(),
      rowsBeforeRefresh: explorerHost?.getFlatItems?.().map?.((item) => item.uri) || [],
    }
  }
  await explorerHost?.refresh?.()
  if (typeof window !== "undefined") {
    window.__codekSmokeFileOperationDebug = {
      ...(window.__codekSmokeFileOperationDebug || {}),
      fileTreeRefreshFinishedAt: Date.now(),
      rowsAfterRefresh: explorerHost?.getFlatItems?.().map?.((item) => item.uri) || [],
    }
  }
}

async function applyFileOperationToExplorer(payload) {
  if (!props.isRealFS) return false
  if (typeof explorerHost?.applyFileOperationAsync === "function") {
    return Boolean(await explorerHost.applyFileOperationAsync(payload || {}))
  }
  return Boolean(explorerHost?.applyFileOperation?.(payload || {}))
}

function openContextMenu(event, entry) {
  contextMenu.open = true
  contextMenu.x = Math.max(4, Math.min(event.clientX, window.innerWidth - 230))
  contextMenu.y = Math.max(4, Math.min(event.clientY, window.innerHeight - 340))
  contextMenu.entry = entry
  if (entry?.isDir) emit("selectDir", entry.path)
  else if (entry?.path) emit("explorerCommand", { command: "explorer.selectFile", path: entry.path })
}

function openNativeContextMenu(event, item) {
  const entry = item ? { path: item.uri, name: item.name, isDir: item.isDirectory } : null
  openContextMenu(event, entry)
}

function selectNativeFile(path) {
  emit("explorerCommand", { command: "explorer.selectFile", path })
}

function closeContextMenu() {
  contextMenu.open = false
}

function handleTreeBackgroundClick(event) {
  closeContextMenu()
  const target = event.target
  if (target?.closest?.("[data-codek-explorer-row], .inline-create-row, .explorer-context-menu")) return
  emit("explorerCommand", { command: "explorer.clearSelection" })
}

function runContextAction(action) {
  const entry = contextMenu.entry
  const targetPath = entry?.isDir ? entry.path : entry?.path || props.selectedDir || ""
  closeContextMenu()
  if (action === "newFile") {
    if (entry?.isDir) emit("selectDir", entry.path)
    startCreate("file", entry?.isDir ? entry.path : dirname(entry?.path || ""))
    return
  }
  if (action === "newFolder") {
    if (entry?.isDir) emit("selectDir", entry.path)
    startCreate("folder", entry?.isDir ? entry.path : dirname(entry?.path || ""))
    return
  }
  if (action === "refresh") {
    void handleRefresh()
    return
  }
  if (action === "rename" && props.isRealFS) {
    void startRename(targetPath)
    return
  }
  const commandMap = {
    open: "explorer.open",
    rename: "explorer.rename",
    delete: "explorer.delete",
    copy: "explorer.copy",
    cut: "explorer.cut",
    paste: "explorer.paste",
    copyPath: "explorer.copyPath",
    copyRelativePath: "explorer.copyRelativePath",
    showInFolder: "explorer.showInFolder",
    openTerminal: "explorer.openTerminal",
    refresh: "explorer.refresh",
  }
  emit("explorerCommand", { command: commandMap[action], path: targetPath })
}

function updateExplorerHost() {
  if (!props.isRealFS || !explorerHost) return
  explorerHostUpdateFrame = 0
  explorerHost.update({
    activeFile: props.activeFile,
    selectedPath: props.selectedPath,
    selectedKind: props.selectedKind,
    projectRoot: props.projectRoot,
    workspaceRoots: props.workspaceRoots,
    workspaceRootLabels: props.workspaceRootLabels,
    workspaceScaleProfile: props.workspaceScaleProfile,
    gitDecorations: props.gitDecorations,
    filterQuery: filterQuery.value,
    iconTheme: loadedFileIconTheme.value,
    iconThemeId: currentFileIconTheme.value.settingsId,
    iconThemeVersion: fileIconThemeFontLoadVersion.value,
  })
}

function scheduleExplorerHostUpdate() {
  if (!props.isRealFS || !explorerHost) return
  if (explorerHostUpdateFrame) return
  explorerHostUpdateFrame = requestAnimationFrame(() => {
    updateExplorerHost()
  })
}

function mountExplorerHost() {
  if (!props.isRealFS || explorerHost || !nativeTreeMountRef.value) return
  explorerHost = new ExplorerTreeHost({
    container: nativeTreeMountRef.value,
    rowHeight: TREE_ROW_HEIGHT,
    readDir: async (path) => window.codek?.readDir?.(path, { source: "explorer" }) || [],
    onInlineCreate: async (payload) => {
      const name = getWellFormedFileName(payload?.name || "")
      if (!name && !payload?.name) return
      await emitPromise("inlineCreate", {
        ...payload,
        name,
      })
    },
    onRenameEntry: async (payload) => {
      await emitPromise("renameEntry", payload)
    },
    onOpenFile: (path) => emit("openFile", path),
    onSelectDir: (path) => emit("selectDir", path),
    onCommand: (command, path) => {
      if (command === "explorer.rename" && props.isRealFS) {
        void startRename(path)
        return
      }
      emit("explorerCommand", { command, path })
    },
    onMoveEntry: (path, targetDir) => emit("explorerCommand", { command: "explorer.move", path, targetDir }),
    onContextMenu: openNativeContextMenu,
  })
  if (pendingExplorerFileService) {
    explorerFileServiceBinding?.dispose?.()
    explorerFileServiceBinding = explorerHost.bindFileService?.(pendingExplorerFileService) || null
  }
  updateExplorerHost()
}

function bindFileService(fileService) {
  pendingExplorerFileService = fileService || null
  explorerFileServiceBinding?.dispose?.()
  explorerFileServiceBinding = null
  if (explorerHost && pendingExplorerFileService) {
    explorerFileServiceBinding = explorerHost.bindFileService?.(pendingExplorerFileService) || null
  }
  return {
    dispose: () => {
      if (pendingExplorerFileService === fileService) pendingExplorerFileService = null
      explorerFileServiceBinding?.dispose?.()
      explorerFileServiceBinding = null
    },
  }
}

onMounted(() => {
  mountExplorerHost()
})

onUnmounted(() => {
  fileIconThemeChange.dispose()
  if (explorerHostUpdateFrame) {
    cancelAnimationFrame(explorerHostUpdateFrame)
    explorerHostUpdateFrame = 0
  }
  clearInlineCreateFocusFrame()
  clearCreateBlurTimeout()
  explorerFileServiceBinding?.dispose?.()
  explorerFileServiceBinding = null
  pendingExplorerFileService = null
  explorerHost?.dispose?.()
  explorerHost = null
})

watch(
  () => currentFileIconTheme.value.settingsId,
  (themeId) => {
    void loadFileIconTheme(themeId)
  },
  { immediate: true },
)

watch(
  () => props.isRealFS,
  (real) => {
    if (real) nextTick(mountExplorerHost)
    else {
      if (explorerHostUpdateFrame) {
        cancelAnimationFrame(explorerHostUpdateFrame)
        explorerHostUpdateFrame = 0
      }
      explorerHost?.dispose?.()
      explorerHost = null
      explorerFileServiceBinding?.dispose?.()
      explorerFileServiceBinding = null
    }
  },
)

watch(
  () => [
    props.activeFile,
    props.selectedPath,
    props.selectedKind,
    props.projectRoot,
    props.workspaceRoots,
    props.workspaceRootLabels,
    props.workspaceScaleProfile,
    props.gitDecorations,
    filterQuery.value,
    currentFileIconTheme.value.settingsId,
    loadedFileIconTheme.value,
    fileIconThemeFontLoadVersion.value,
  ],
  () => nextTick(scheduleExplorerHostUpdate),
)

watch(
  () => props.treeStats?.nodeCount,
  () => {
    if (!props.isRealFS) return
    nextTick(() => {
      void explorerHost?.refresh?.()
    })
  },
)

async function loadFileIconTheme(themeId) {
  const theme = await ensureFileIconTheme(themeId)
  if (themeId !== currentFileIconTheme.value.settingsId) return
  loadedFileIconTheme.value = theme
  installFileIconThemeFonts(theme)
  nextTick(scheduleExplorerHostUpdate)
}

defineExpose({ startCreate, cancelCreate, startRename, revealPath, expandPath, refreshExplorer, applyFileOperationToExplorer, bindFileService })
</script>

<style scoped>
@font-face {
  font-family: "seti";
  src: url("../../../../extensions/theme-seti/icons/seti.woff") format("woff");
  font-weight: normal;
  font-style: normal;
  font-display: block;
}

.file-tree {
  color: var(--text-secondary);
  height: 100%;
  display: flex;
  flex-direction: column;
  user-select: none;
  font-size: 13px;
  background: var(--workbench-sidebar-bg);
}

.tree-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 36px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.tree-filter-wrap {
  position: relative;
  padding: 7px 8px 6px;
  flex-shrink: 0;
}

.tree-filter-input {
  width: 100%;
  height: 28px;
  background: var(--workbench-control-bg);
  border: 1px solid var(--border-subtle);
  border-radius: 5px;
  padding: 0 26px 0 10px;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  font-family: inherit;
  transition: border-color 0.14s ease, background 0.14s ease, box-shadow 0.14s ease;
}

.tree-filter-input:focus {
  background: var(--workbench-card-bg);
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-dim);
}

.tree-filter-input::placeholder {
  color: var(--text-muted);
}

.tree-filter-clear {
  position: absolute;
  right: 13px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
}

.tree-filter-clear:hover {
  color: var(--text-primary);
}

.tree-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0.64;
  transition: opacity 0.12s ease;
}

.tree-toolbar:hover .tree-actions {
  opacity: 1;
}

.tree-action-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tree-action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tree-empty {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 12px;
  padding: 28px 20px;
  color: var(--text-muted);
  font-size: 12px;
}

.tree-empty-compact {
  align-items: flex-start;
}

.tree-empty-workspace {
  justify-content: flex-start;
  padding-top: 34px;
}

.empty-workspace-icon {
  width: 44px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  color: var(--text-muted);
}

.empty-workspace-icon svg {
  stroke: currentColor;
  stroke-width: 1.35;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.62;
}

.tree-empty-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tree-empty-title {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.45;
}

.tree-empty-desc {
  color: var(--text-muted);
  line-height: 1.55;
}

.tree-empty-hint {
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.6;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-health-note {
  margin: 6px 8px 4px;
  padding: 6px 8px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 5px;
  background: rgba(148, 163, 184, 0.06);
  color: #8f98a8;
  font-size: 11px;
  line-height: 1.45;
  flex-shrink: 0;
}

.tree-empty-actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding-top: 2px;
}

.tree-empty-primary,
.tree-empty-secondary {
  width: 100%;
  min-height: 28px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}

.tree-empty-primary {
  background: var(--accent);
  border: 1px solid var(--accent);
  color: #0d0e10;
  font-weight: 600;
}

.tree-empty-primary:hover {
  filter: brightness(1.06);
}

.tree-empty-secondary {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary);
}

.tree-empty-secondary:hover {
  background: var(--bg-active);
  color: var(--text-primary);
  border-color: var(--border-bright);
}

.tree-entries,
.memory-files {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 3px 0 10px;
  scrollbar-width: thin;
  scrollbar-color: rgba(139, 143, 163, 0.26) transparent;
}

.tree-entries.codek-explorer-host {
  display: flex;
  flex-direction: column;
  padding: 3px 0 0;
  overflow: hidden;
  position: relative;
}

.codek-explorer-mount {
  flex: 1;
  min-height: 0;
  position: relative;
  z-index: 0;
}

.codek-explorer-inline-create {
  flex-shrink: 0;
  margin-bottom: 2px;
  position: relative;
  z-index: 2;
}

.codek-explorer-host :deep(.codek-list-view) {
  scrollbar-width: thin;
  scrollbar-color: rgba(121, 121, 121, 0.38) transparent;
  outline: none;
  background: var(--workbench-sidebar-bg);
}

.codek-explorer-host :deep(.codek-list-view::-webkit-scrollbar) {
  width: 10px;
}

.codek-explorer-host :deep(.codek-list-view::-webkit-scrollbar-thumb) {
  background: rgba(121, 121, 121, 0.38);
  border: 3px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}

.codek-explorer-host :deep(.codek-explorer-row) {
  --codek-tree-indent: 8px;
  --codek-tree-guide-offset-px: 8px;
  --codek-tree-row-padding-left-px: var(--codek-tree-indent-px, calc(var(--codek-tree-depth, 0) * var(--codek-tree-indent)));
  --codek-tree-twistie-width-px: 16px;
  --codek-tree-icon-width-px: 16px;
  --codek-tree-icon-gap-px: 3px;
  display: flex;
  align-items: center;
  gap: 0;
  position: relative;
  min-width: 0;
  box-sizing: border-box;
  height: 22px;
  padding-left: var(--codek-tree-row-padding-left-px);
  color: var(--text-secondary);
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 0;
  font-size: 13px;
  line-height: 22px;
  white-space: nowrap;
  outline: none;
}

.codek-explorer-host :deep(.codek-explorer-row::before) {
  content: "";
  position: absolute;
  left: calc(var(--codek-tree-guide-offset-px) + var(--codek-tree-twistie-width-px));
  top: 0;
  bottom: 0;
  width: max(0px, calc(var(--codek-tree-depth, 0) * var(--codek-tree-indent)));
  pointer-events: none;
  opacity: 0.58;
  background-image: repeating-linear-gradient(
    to right,
    transparent 0,
    transparent calc(var(--codek-tree-indent) - 1px),
    var(--border-subtle) calc(var(--codek-tree-indent) - 1px),
    var(--border-subtle) var(--codek-tree-indent)
  );
}

.codek-explorer-host :deep(.codek-explorer-row:hover) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.codek-explorer-host :deep(.codek-explorer-row.selected) {
  background: var(--bg-active);
  border-color: transparent;
  color: var(--text-primary);
}

.codek-explorer-host :deep(.codek-explorer-row.active:not(.selected)) {
  color: var(--text-primary);
}

.codek-explorer-host :deep(.codek-explorer-row:focus-visible) {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.codek-explorer-host :deep(.codek-explorer-row.ignored) {
  color: var(--text-muted);
}

.codek-explorer-host :deep(.codek-explorer-row.editable) {
  background: var(--workbench-sidebar-bg);
  pointer-events: auto;
}

.codek-explorer-host :deep(.codek-explorer-twistie) {
  width: var(--codek-tree-twistie-width-px);
  height: 22px;
  flex-shrink: 0;
  margin-right: 0;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 22px;
  text-align: center;
  padding-right: 0;
  box-sizing: border-box;
  transform: rotate(0deg);
  transition: transform 0.08s ease;
}

.codek-explorer-host :deep(.codek-explorer-row.file .codek-explorer-twistie) {
  color: transparent;
}

.codek-explorer-host :deep(.codek-explorer-row.dir .codek-explorer-twistie) {
  margin-right: 0;
}

.codek-explorer-host :deep(.codek-explorer-row.expanded .codek-explorer-twistie) {
  transform: rotate(90deg);
}

.codek-explorer-host :deep(.codek-explorer-icon) {
  width: var(--codek-tree-icon-width-px);
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #858b96;
  margin-right: var(--codek-tree-icon-gap-px);
  overflow: hidden;
}

.codek-explorer-host :deep(.codek-explorer-row.dir .codek-explorer-icon) {
  display: none;
  width: 0;
  margin-right: 0;
  color: inherit;
}

.codek-explorer-host :deep(.codek-explorer-icon.no-icon) {
  display: none;
  width: 0;
  margin-right: 0;
  visibility: hidden;
}

.codek-explorer-host :deep(.codek-explorer-theme-image),
.codek-explorer-host :deep(.codek-explorer-theme-glyph),
.codek-explorer-host :deep(.codek-explorer-fallback-token) {
  display: none;
}

.codek-explorer-host :deep(.codek-explorer-icon.theme-icon .codek-explorer-theme-image) {
  width: 16px;
  height: 16px;
  object-fit: contain;
}

.codek-explorer-host :deep(.codek-explorer-icon.theme-icon .codek-explorer-theme-glyph),
.codek-explorer-host :deep(.codek-explorer-icon.fallback-seti-icon .codek-explorer-theme-glyph) {
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 16px;
  speak: never;
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}


.codek-explorer-host :deep(.codek-explorer-label) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-right: 8px;
}

.codek-explorer-host :deep(.codek-explorer-input) {
  flex: 1;
  min-width: 0;
  height: 20px;
  margin-right: 8px;
  background: var(--workbench-control-bg);
  border: 1px solid var(--accent);
  border-radius: 2px;
  padding: 1px 5px;
  color: var(--text-primary);
  font-size: 12px;
  font-family: inherit;
  outline: none;
  user-select: text;
  pointer-events: auto;
}

.codek-explorer-host :deep(.codek-explorer-input[aria-invalid="true"]) {
  border-color: #f48771;
}

.codek-explorer-host :deep(.codek-explorer-decoration) {
  flex-shrink: 0;
  max-width: 68px;
  margin-left: auto;
  padding-right: 8px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  line-height: 22px;
}

.tree-entries::-webkit-scrollbar,
.memory-files::-webkit-scrollbar {
  width: 10px;
}

.tree-entries::-webkit-scrollbar-thumb,
.memory-files::-webkit-scrollbar-thumb {
  background: rgba(139, 143, 163, 0.22);
  border: 3px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}

.tree-entries::-webkit-scrollbar-thumb:hover,
.memory-files::-webkit-scrollbar-thumb:hover {
  background: rgba(139, 143, 163, 0.36);
  border: 3px solid transparent;
  background-clip: padding-box;
}

.inline-create-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  padding: 0 8px 0 28px;
  pointer-events: auto;
}

.inline-create-row.codek-explorer-inline-create {
  gap: 0;
  min-height: 22px;
  padding: 0 8px 0 8px;
  background: var(--workbench-sidebar-bg);
  isolation: isolate;
  pointer-events: auto;
}

.inline-create-twistie {
  width: 16px;
  height: 22px;
  flex-shrink: 0;
}

.inline-create-row.codek-explorer-inline-create :deep(.file-icon-svg) {
  margin-right: 3px;
}

.inline-create-input {
  flex: 1;
  background: var(--workbench-control-bg);
  border: 1px solid var(--accent);
  border-radius: 2px;
  padding: 1px 5px;
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  min-width: 0;
  height: 20px;
  pointer-events: auto;
  position: relative;
  z-index: 1;
}

.inline-create-input::placeholder {
  color: var(--text-muted);
  font-size: 11px;
}

.file-item {
  min-height: 24px;
  height: 24px;
  padding: 0 8px 0 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  border: 1px solid transparent;
  border-radius: 0;
  transition: background 0.08s ease, color 0.08s ease;
}

.file-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.file-item.active {
  background: var(--bg-active);
  border-color: transparent;
  color: var(--text-primary);
}

.file-icon {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.file-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.memory-file-decoration {
  max-width: 48px;
  margin-left: auto;
  padding-right: 2px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}

.file-delete-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}

.file-item:hover .file-delete-btn {
  opacity: 1;
}

.file-delete-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.btn-add {
  background: none;
  border: none;
  color: var(--text-muted);
  padding: 6px 16px;
  margin: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  display: block;
  width: calc(100% - 16px);
  text-align: left;
}

.btn-add:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.explorer-context-menu {
  position: fixed;
  z-index: 3000;
  min-width: 220px;
  padding: 5px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 6px;
  background: var(--workbench-card-bg);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.22);
}

.explorer-context-item {
  width: 100%;
  height: 27px;
  padding: 0 9px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.explorer-context-item:hover:not(.disabled) {
  background: rgba(148, 163, 184, 0.13);
  color: var(--text-primary);
}

.explorer-context-item.disabled {
  color: rgba(148, 163, 184, 0.36);
  cursor: default;
}

.explorer-context-item kbd {
  color: var(--text-muted);
  font-family: inherit;
  font-size: 10px;
}

.explorer-context-separator {
  height: 1px;
  margin: 5px 4px;
  background: rgba(148, 163, 184, 0.16);
}
</style>
