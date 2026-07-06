<template>
  <div class="menu-bar" :class="{ 'caption-overlay': needsCaptionInset }" @click.stop>
    <div class="menu-bar-left">
      <span class="menu-logo">Codek</span>

      <div
        v-for="menu in menuDefinitions"
        :key="menu.id"
        class="menu-item"
        :class="{ active: openMenuId === menu.id }"
        @mouseenter="handleMouseEnter(menu.id)"
        @click="toggleMenu(menu.id)"
      >
        <span class="menu-label">{{ menu.label }}</span>

        <Transition name="dropdown">
          <div v-if="openMenuId === menu.id" class="menu-dropdown" @click.stop>
            <template v-for="(item, index) in preparedMenuDefinitionItems(menu)" :key="entryKey(item, index)">
              <div v-if="item.type === 'separator'" class="menu-separator" />
              <div v-else-if="item.type === 'submenu'" class="menu-dropdown-submenu">
                <button
                  class="menu-dropdown-item menu-dropdown-parent"
                  :class="{ disabled: !entryEnabled(item) }"
                  :disabled="!entryEnabled(item)"
                  type="button"
                >
                  <span class="menu-dropdown-check"></span>
                  <span class="menu-dropdown-label">{{ item.label }}</span>
                  <span class="menu-dropdown-caret">›</span>
                </button>
                <div class="menu-submenu-popover">
                  <template v-for="(child, childIndex) in preparedMenuItems(item.items)" :key="entryKey(child, childIndex)">
                    <div v-if="child.type === 'separator'" class="menu-separator" />
                    <button
                      v-else-if="child.type === 'item'"
                      class="menu-dropdown-item"
                      :class="{ disabled: !entryEnabled(child), checked: entryChecked(child) }"
                      :disabled="!entryEnabled(child)"
                      type="button"
                      @click.stop="handleItemClick(child)"
                    >
                      <span class="menu-dropdown-check">{{ entryChecked(child) ? '✓' : '' }}</span>
                      <span class="menu-dropdown-label">{{ child.label }}</span>
                      <span v-if="child.shortcut" class="menu-dropdown-shortcut">{{ child.shortcut }}</span>
                    </button>
                  </template>
                </div>
              </div>
              <button
                v-else
                class="menu-dropdown-item"
                :class="{ disabled: !entryEnabled(item), checked: entryChecked(item) }"
                :disabled="!entryEnabled(item)"
                type="button"
                @click.stop="handleItemClick(item)"
              >
                <span class="menu-dropdown-check">{{ entryChecked(item) ? '✓' : '' }}</span>
                <span class="menu-dropdown-label">{{ item.label }}</span>
                <span v-if="item.shortcut" class="menu-dropdown-shortcut">{{ item.shortcut }}</span>
              </button>
            </template>
          </div>
        </Transition>
      </div>

      <button
        class="title-layout-btn layout-left-btn"
        :class="{ active: sidebarVisible }"
        :title="sidebarVisible ? '隐藏左侧文件树' : '显示左侧文件树'"
        @click.stop="$emit('toggleSidebarPanel')"
      >
        <svg class="layout-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="1.6" />
          <path d="M6.25 2.5v11" />
          <path d="M3.85 4.85h.05M3.85 6.95h.05M3.85 9.05h.05" />
        </svg>
      </button>
    </div>

    <button class="menu-bar-title" type="button" title="打开命令面板" @click.stop="$emit('menuAction', 'commandPalette')">
      <span class="menu-bar-title-text">{{ projectName || 'Codek' }}</span>
      <span class="menu-bar-title-hint">Ctrl+Shift+P</span>
    </button>

    <div class="menu-bar-right">
      <button
        class="title-layout-btn layout-chat-ai-btn"
        :class="{ active: chatOpen }"
        :title="chatOpen ? '隐藏智能助手' : '打开智能助手'"
        aria-label="智能助手"
        @click.stop="$emit('toggleChat')"
      >
        <svg class="layout-icon chat-layout-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="1.6" />
          <path d="M9.75 2.5v11" />
          <path d="M4.15 5.35h3.15M4.15 7.55h2.3" />
          <path d="M11.15 6.05h1.15v1.15M12.3 8.8h-1.15V7.65" />
        </svg>
        <span>智能助手</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import {
  isMenuEntryChecked,
  isMenuEntryEnabled,
  getPreparedMenuEntries,
  getPreparedMenuDefinitionEntries,
  menuDefinitions,
  type MenuAction,
  type MenuContext,
  type MenuDefinition,
  type MenuEntry,
  type MenuItem,
  type MenuSubmenu,
} from "./menuModel"

const props = defineProps<{
  projectName?: string
  sidebarVisible?: boolean
  chatOpen?: boolean
  activityBarVisible?: boolean
  panelVisible?: boolean
  hasEditor?: boolean
  hasSelection?: boolean
  hasWorkspace?: boolean
  hasActiveFile?: boolean
  dirty?: boolean
  autoSave?: boolean
  debugActive?: boolean
  isElectron?: boolean
  agentMode?: string
  agentBusy?: boolean
  sandboxMode?: string
  goalCount?: number
  diagnosticsErrorCount?: number
  diagnosticsWarningCount?: number
}>()

const emit = defineEmits<{
  menuAction: [action: MenuAction]
  toggleChat: []
  toggleSidebarPanel: []
}>()

const openMenuId = ref<string | null>(null)

const needsCaptionInset = computed(() => {
  if (!props.isElectron || typeof navigator === "undefined") return false
  const platform = `${navigator.platform || ""} ${navigator.userAgent || ""}`
  return /Win/i.test(platform)
})

const menuContext = computed<MenuContext>(() => ({
  hasEditor: props.hasEditor,
  hasSelection: props.hasSelection,
  hasWorkspace: props.hasWorkspace,
  hasActiveFile: props.hasActiveFile,
  dirty: props.dirty,
  chatOpen: props.chatOpen,
  sidebarVisible: props.sidebarVisible,
  "workbench.activityBar.visible": props.activityBarVisible,
  "workbench.sideBar.visible": props.sidebarVisible,
  "workbench.panel.visible": props.panelVisible,
  autoSave: props.autoSave,
  debugActive: props.debugActive,
  isElectron: props.isElectron,
}))

function entryKey(entry: MenuEntry, index: number): string {
  if (entry.type === "separator") return `separator-${index}`
  return entry.id
}

function entryEnabled(entry: MenuItem | MenuSubmenu): boolean {
  return isMenuEntryEnabled(entry, menuContext.value)
}

function entryChecked(entry: MenuItem | MenuSubmenu): boolean {
  return isMenuEntryChecked(entry, menuContext.value)
}

function preparedMenuItems(entries: MenuEntry[]): MenuEntry[] {
  return getPreparedMenuEntries(entries, menuContext.value)
}

function preparedMenuDefinitionItems(menu: MenuDefinition): MenuEntry[] {
  return getPreparedMenuDefinitionEntries(menu, menuContext.value)
}

function toggleMenu(menuId: string): void {
  openMenuId.value = openMenuId.value === menuId ? null : menuId
}

function handleMouseEnter(menuId: string): void {
  if (openMenuId.value !== null && openMenuId.value !== menuId) {
    openMenuId.value = menuId
  }
}

function handleItemClick(item: MenuItem): void {
  if (!entryEnabled(item)) return
  openMenuId.value = null
  emit("menuAction", item.action)
}

function handleDocumentClick(): void {
  openMenuId.value = null
}

onMounted(() => {
  document.addEventListener("click", handleDocumentClick)
})

onBeforeUnmount(() => {
  document.removeEventListener("click", handleDocumentClick)
})
</script>

<style scoped>
.menu-bar {
  --codek-caption-button-width: 138px;
  height: 35px;
  background: var(--bg-darker);
  display: flex;
  align-items: center;
  padding: 0;
  border-bottom: 1px solid var(--border-subtle);
  user-select: none;
  flex-shrink: 0;
  font-family: var(--font-sans);
  position: relative;
  z-index: 10000;
  isolation: isolate;
  -webkit-app-region: drag;
}

.menu-bar.caption-overlay {
  padding-right: var(--codek-caption-button-width);
}

.menu-bar-left {
  display: flex;
  align-items: center;
  height: 100%;
  gap: 1px;
  padding-left: 8px;
  min-width: 0;
  -webkit-app-region: no-drag;
  z-index: 2;
}

.menu-bar-title {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 160px;
  max-width: min(480px, 38vw);
  height: 25px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  letter-spacing: 0.2px;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.menu-bar-title:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.menu-bar-title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menu-bar-title-hint {
  color: var(--text-muted);
  font-size: 11px;
  flex-shrink: 0;
}

.menu-bar-right {
  margin-left: auto;
  height: 100%;
  width: auto;
  min-width: 96px;
  max-width: min(180px, 28vw);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  padding-left: 6px;
  -webkit-app-region: no-drag;
}

.menu-logo {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent);
  margin-right: 10px;
  letter-spacing: 0.3px;
  padding: 0 4px;
  line-height: 35px;
}

.menu-item {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  -webkit-app-region: no-drag;
}

.title-layout-btn {
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  -webkit-app-region: no-drag;
}

.title-layout-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.title-layout-btn.active {
  color: var(--text-bright);
  background: var(--bg-active);
}

.layout-icon {
  stroke: currentColor;
  stroke-width: 1.35;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.layout-icon rect {
  stroke: currentColor;
}

.layout-left-btn {
  margin-left: 8px;
}

.layout-chat-ai-btn {
  width: auto;
  min-width: 82px;
  gap: 6px;
  padding: 0 9px;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}

.layout-chat-ai-btn span {
  line-height: 1;
}

@media (max-width: 900px) {
  .menu-bar-title {
    max-width: min(260px, 28vw);
  }

  .menu-bar-title-hint {
    display: none;
  }
}

@media (max-width: 960px) {
  .menu-bar-left {
    flex: 1 1 auto;
    overflow: hidden;
  }

  .menu-logo {
    margin-right: 4px;
  }

  .menu-label {
    padding-inline: 6px;
  }

  .menu-bar-title {
    display: none;
  }

  .menu-bar-right {
    min-width: 42px;
    max-width: 42px;
    padding-left: 0;
  }

  .layout-chat-ai-btn {
    width: 32px;
    min-width: 32px;
    padding: 0;
  }

  .layout-chat-ai-btn span {
    display: none;
  }
}

@media (max-width: 720px) {
  .menu-bar-left {
    min-width: 0;
  }

  .menu-logo {
    margin-right: 4px;
  }

  .menu-item {
    min-width: 0;
  }

  .menu-label {
    padding-inline: 5px;
  }

  .layout-left-btn {
    margin-left: 4px;
  }

  .menu-bar-title {
    left: 53%;
    max-width: 96px;
    justify-content: center;
  }

  .menu-bar-right {
    min-width: 42px;
    max-width: 42px;
    padding-left: 0;
  }

  .layout-chat-ai-btn {
    width: 32px;
    min-width: 32px;
    padding: 0;
  }

  .layout-chat-ai-btn span {
    display: none;
  }
}

.menu-label {
  padding: 0 8px;
  height: 22px;
  line-height: 22px;
  font-size: 12px;
  color: var(--text-secondary);
  border-radius: 4px;
  cursor: default;
  transition: background 0.1s, color 0.1s;
}

.menu-item:hover .menu-label {
  color: var(--text-primary);
}

.menu-item.active .menu-label {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.menu-dropdown,
.menu-submenu-popover {
  min-width: 236px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 0;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2);
}

.menu-dropdown {
  position: absolute;
  top: 35px;
  left: 0;
  z-index: 10001;
}

.menu-dropdown-submenu {
  position: relative;
}

.menu-submenu-popover {
  display: none;
  position: absolute;
  top: -5px;
  left: calc(100% - 4px);
  z-index: 10002;
}

.menu-dropdown-submenu:hover .menu-submenu-popover {
  display: block;
}

.menu-dropdown-item {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  width: 100%;
  min-height: 28px;
  padding: 4px 12px 4px 8px;
  border: none;
  background: none;
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font-sans);
  cursor: pointer;
  text-align: left;
  transition: background 0.08s, color 0.08s;
}

.menu-dropdown-item:hover:not(.disabled) {
  background: var(--bg-hover);
  color: var(--text-bright);
}

.menu-dropdown-item.disabled {
  color: color-mix(in srgb, var(--text-muted) 52%, transparent);
  cursor: default;
}

.menu-dropdown-check {
  width: 14px;
  color: var(--accent);
  font-size: 11px;
  text-align: center;
}

.menu-dropdown-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-dropdown-shortcut,
.menu-dropdown-caret {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: 24px;
  white-space: nowrap;
}

.menu-dropdown-caret {
  font-size: 16px;
  line-height: 1;
}

.menu-separator {
  height: 1px;
  background: var(--border-subtle);
  margin: 4px 8px;
}

.dropdown-enter-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}

.dropdown-leave-active {
  transition: none;
}

.dropdown-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}

.dropdown-leave-to {
  opacity: 0;
}
</style>
