<template>
  <div class="welcome-page" :data-getting-started-state-source="welcomeProjection.source">
    <main class="welcome-shell" aria-label="Codek 欢迎页">
      <section class="welcome-hero">
        <div class="codek-mark" aria-hidden="true">
          <div class="codek-mark-face one"></div>
          <div class="codek-mark-face two"></div>
          <div class="codek-mark-face three"></div>
        </div>
        <div class="brand-copy">
          <h1>Codek</h1>
          <p>打开项目，交给智能助手协作完成代码、编辑器和多智能体任务。</p>
        </div>
      </section>

      <section class="quick-actions" aria-label="快捷操作">
        <button
          v-for="action in primaryActions"
          :key="action.id"
          class="quick-action"
          type="button"
          @click="runAction(action.event, action.target)"
        >
          <span class="action-label">{{ action.label }}</span>
          <kbd v-if="action.shortcut">{{ action.shortcut }}</kbd>
        </button>
      </section>

      <section class="recent-section" aria-label="最近项目">
        <div class="section-row">
          <span>最近项目</span>
          <button v-if="recentProjects.length > 0" class="text-action" type="button" @click="emit('openProject')">
            打开其他项目
          </button>
        </div>

        <div v-if="recentProjects.length > 0" class="recent-list">
          <button
            v-for="project in recentProjects.slice(0, 5)"
            :key="project.path"
            class="recent-item"
            type="button"
            :title="project.path"
            @click="emit('openRecent', project.path)"
          >
            <span class="recent-name">{{ project.name }}</span>
            <span class="recent-path">{{ formatPath(project.path) }}</span>
          </button>
        </div>

        <div v-else class="recent-empty">
          还没有最近项目。打开一个文件夹后，它会出现在这里。
        </div>
      </section>

      <footer class="welcome-footer" aria-label="快捷键和模式">
        <div class="footer-group">
          <span class="footer-label">快捷键</span>
          <span><kbd>Ctrl Shift P</kbd> 命令面板</span>
          <span><kbd>Ctrl K</kbd> 智能聊天</span>
        </div>
        <div class="footer-group ai-modes">
          <span class="footer-label">智能模式</span>
          <span>计划规划</span>
          <span>智能体执行</span>
          <span>自动自主</span>
        </div>
        <div class="footer-group workspace-state">
          <span class="footer-label">状态</span>
          <span>{{ workspaceHint }}</span>
        </div>
      </footer>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { getRecentProjects, type RecentProject } from "../utils/recentProjects"
import { getWelcomePageProjection, type WelcomeQuickAction } from "../workbench/gettingStartedService"

type WelcomeEvent =
  | "newProject"
  | "openProject"
  | "openCommandPalette"
  | "openChat"
  | "openLink"

const props = defineProps<{
  projectName?: string
  projectRoot?: string | null
}>()

const emit = defineEmits<{
  newProject: []
  openProject: []
  openCommandPalette: []
  openChat: []
  openRecent: [path: string]
  openLink: [target: string]
}>()

const recentProjects = ref<RecentProject[]>([])
const welcomeProjection = getWelcomePageProjection()
const primaryActions: readonly WelcomeQuickAction[] = welcomeProjection.primaryActions

const workspaceHint = computed(() => {
  if (props.projectName) return `当前工作区：${props.projectName}`
  return "未打开工作区"
})

function runAction(event: WelcomeEvent, target?: string): void {
  switch (event) {
    case "newProject":
      emit("newProject")
      break
    case "openProject":
      emit("openProject")
      break
    case "openCommandPalette":
      emit("openCommandPalette")
      break
    case "openChat":
      emit("openChat")
      break
    case "openLink":
      emit("openLink", target || "settings")
      break
  }
}

function loadRecent(): void {
  recentProjects.value = getRecentProjects()
}

function formatPath(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  if (normalized.length <= 58) return normalized
  return `...${normalized.slice(-55)}`
}

onMounted(loadRecent)
</script>
<style scoped>
.welcome-page {
  width: 100%;
  height: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  background: var(--bg-dark);
  color: var(--text-primary);
  box-sizing: border-box;
  padding: 56px 32px;
}

.welcome-shell {
  width: min(560px, 100%);
  min-height: min(620px, 100%);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 28px;
}

.welcome-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  text-align: center;
}

.codek-mark {
  position: relative;
  width: 82px;
  height: 82px;
  opacity: 0.42;
}

.codek-mark-face {
  position: absolute;
  inset: 0;
  background: #d4d4d8;
  clip-path: polygon(50% 0, 100% 25%, 50% 50%, 0 25%);
}

.codek-mark-face.one {
  transform: translateY(0);
  background: #f4f4f5;
}

.codek-mark-face.two {
  transform: translate(-20px, 28px) skewY(30deg);
  background: #a1a1aa;
}

.codek-mark-face.three {
  transform: translate(20px, 28px) skewY(-30deg);
  background: #71717a;
}

.brand-copy h1 {
  margin: 0;
  color: var(--text-bright);
  font-size: 22px;
  line-height: 1.2;
  font-weight: 650;
}

.brand-copy p {
  margin: 8px 0 0;
  max-width: 420px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.7;
}

.quick-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.quick-action,
.recent-item,
.text-action {
  font-family: inherit;
}

.quick-action {
  min-width: 0;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0 10px;
  text-align: left;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.quick-action:hover {
  background: var(--bg-hover);
  border-color: var(--border-subtle);
  color: var(--text-bright);
}

.action-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
}

kbd {
  display: inline-flex;
  align-items: center;
  height: 20px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  line-height: 1;
  padding: 0 6px;
  white-space: nowrap;
}

.recent-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
}

.text-action {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 0;
}

.text-action:hover {
  color: var(--text-primary);
}

.recent-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.recent-item {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(96px, 150px) minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  min-height: 30px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px 8px;
  text-align: left;
  transition: background 0.12s, color 0.12s;
}

.recent-item:hover {
  background: var(--bg-hover);
  color: var(--text-bright);
}

.recent-name,
.recent-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-name {
  font-size: 12px;
  color: inherit;
}

.recent-path {
  color: var(--text-muted);
  font-size: 11px;
}

.recent-empty {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.6;
  padding: 4px 8px;
}

.welcome-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 10px 16px;
  padding-top: 8px;
  color: var(--text-muted);
  font-size: 11px;
  border-top: 1px solid var(--border-subtle);
}

.footer-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.footer-label {
  color: var(--text-secondary);
  font-weight: 600;
}

.workspace-state {
  max-width: 100%;
}

.workspace-state span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 760px) {
  .welcome-page {
    align-items: flex-start;
    padding: 36px 20px;
  }

  .welcome-shell {
    min-height: auto;
  }

  .quick-actions {
    grid-template-columns: minmax(0, 1fr);
  }

  .recent-item {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
    padding: 7px 8px;
  }

  .welcome-footer,
  .footer-group {
    align-items: flex-start;
    justify-content: flex-start;
  }

  .welcome-footer {
    flex-direction: column;
  }

  .footer-group {
    flex-wrap: wrap;
  }
}
</style>
