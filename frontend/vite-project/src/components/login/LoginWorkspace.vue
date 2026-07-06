<template>
  <section class="workspace">
    <div class="workspace-top">
      <div class="workspace-copy">
        <h2>欢迎回到你的智能工作台</h2>
        <p>{{ heroSubtitle }}</p>
      </div>
      <div class="workspace-actions">
        <span class="chip chip-ready">{{ readyCount }}/{{ serviceItems.length }} 项可用</span>
        <span class="chip">{{ workspaceSummary }}</span>
      </div>
    </div>

    <section class="preview-card">
      <div class="preview-head">
        <div>
          <strong>项目启动状态总览</strong>
          <span>登录前先确认真实项目、核心服务与运行时状态，进入后直接接续当前环境。</span>
        </div>
        <span class="chip">{{ projectRoot ? "工作区已识别" : "等待选择工作区" }}</span>
      </div>

      <div class="preview-surface">
        <div class="surface-bar">
          <div class="surface-tabs" role="tablist" aria-label="登录页项目状态">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="surface-tab"
              :class="[tabTone(tab.id), { active: activeTab === tab.id }]"
              type="button"
              role="tab"
              :aria-selected="activeTab === tab.id"
              @click="activeTab = tab.id"
            >
              <span class="tab-led"></span>
              {{ tab.label }}
            </button>
          </div>
        </div>

        <div class="surface-core">
          <div v-if="activeTab === 'overview'" class="overview-layout">
            <div class="project-panel">
              <div class="project-panel-head">
                <span class="project-badge">Codek</span>
                <span>{{ projectName || "未打开项目" }}</span>
              </div>
              <div class="project-path">
                {{ projectRoot || "登录后从最近项目、打开目录或工作区文件开始。" }}
              </div>
              <div class="restore-grid">
                <div v-for="card in capabilityCards" :key="card.title" class="restore-card" :class="card.tone">
                  <b>{{ card.title }}</b>
                  <strong>{{ card.value }}</strong>
                  <span>{{ card.detail }}</span>
                </div>
              </div>
              <div class="restore-plan">
                <strong>进入后将恢复</strong>
                <div class="restore-plan-row">
                  <span>项目</span>
                  <p>{{
                    projectRoot
                      ? `恢复 ${projectName} 的文件树、最近打开文件与工作区设置。`
                      : "打开或选择最近工程目录。"
                  }}</p>
                </div>
                <div class="restore-plan-row">
                  <span>模型</span>
                  <p>沿用当前模型供应商、模型选择和云端/本地模型配置。</p>
                </div>
                <div class="restore-plan-row">
                  <span>工具</span>
                  <p>继续使用终端、调试、Git、任务调度和扩展服务。</p>
                </div>
              </div>
            </div>

            <div class="summary-panel">
              <span class="summary-kicker">启动状态</span>
              <strong>{{ readyCount }}/{{ serviceItems.length }}</strong>
              <p>{{ readyCount === serviceItems.length ? "核心服务已就绪" : "部分服务会在进入后继续后台确认" }}</p>
              <div class="summary-leds">
                <span
                  v-for="item in serviceItems"
                  :key="item.id"
                  class="summary-led"
                  :class="item.tone"
                  :title="`${item.label}: ${item.detail}`"
                ></span>
              </div>
              <div class="summary-services">
                <div v-for="item in serviceItems" :key="item.id" class="summary-service" :class="item.tone">
                  <span class="summary-led" :class="item.tone"></span>
                  <div>
                    <b>{{ item.label }}</b>
                    <small>{{ item.detail }}</small>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="activeTab === 'services'" class="services-layout">
            <div v-for="item in serviceItems" :key="item.id" class="service-card" :class="item.tone">
              <span class="service-led"></span>
              <div>
                <strong>{{ item.label }}</strong>
                <p>{{ item.detail }}</p>
              </div>
            </div>
          </div>

          <div v-else class="model-layout">
            <div class="model-orb" :class="modelItem?.tone || 'warning'"></div>
            <div class="model-panel">
              <span class="summary-kicker">当前模型</span>
              <strong>{{ modelItem?.label || "智能模型" }}</strong>
              <p>{{ modelItem?.detail || "登录后可在设置里选择模型。" }}</p>
              <div class="model-grid">
                <div v-for="card in modelCards" :key="card.title" class="restore-card" :class="card.tone">
                  <b>{{ card.title }}</b>
                  <strong>{{ card.value }}</strong>
                  <span>{{ card.detail }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import type { LoginCapabilityCard, LoginStatusItem } from "../../composables/useLoginProjectStatus"

type WorkspaceTab = "overview" | "services" | "model"

const props = withDefaults(
  defineProps<{
    capabilityCards: LoginCapabilityCard[]
    serviceItems: LoginStatusItem[]
    projectName?: string
    projectRoot?: string
    workspaceSummary?: string
    heroSubtitle?: string
    readyCount?: number
  }>(),
  {
    projectName: "",
    projectRoot: "",
    workspaceSummary: "暂无打开的项目",
    heroSubtitle: "登录后会恢复最近项目、模型配置、插件偏好和工程协作能力。",
    readyCount: 0,
  },
)

const tabs: Array<{ id: WorkspaceTab; label: string }> = [
  { id: "overview", label: "概览" },
  { id: "services", label: "服务" },
  { id: "model", label: "模型" },
]

const activeTab = ref<WorkspaceTab>("overview")
const modelItem = computed(() => props.serviceItems.find((item) => item.id === "model"))
const runtimeItem = computed(() => props.serviceItems.find((item) => item.id === "runtime"))
const modelCards = computed(() => {
  const cards = props.capabilityCards.filter((card) => /智能|模型|提供方|服务/.test(card.title))
  return cards.length ? cards : props.capabilityCards.slice(0, 2)
})

function tabTone(tab: WorkspaceTab) {
  if (tab === "model") return modelItem.value?.tone || "warning"
  if (tab === "services") {
    if (props.serviceItems.some((item) => item.tone === "offline")) return "offline"
    if (props.serviceItems.some((item) => item.tone === "checking")) return "checking"
    if (props.serviceItems.some((item) => item.tone === "warning")) return "warning"
    return "ready"
  }
  return runtimeItem.value?.tone || "ready"
}
</script>

<style scoped>
.workspace {
  box-sizing: border-box;
  min-width: 0;
  padding: 18px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 14px;
  overflow: hidden;
  -webkit-app-region: no-drag;
}

.workspace-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}

.workspace-copy {
  min-width: 0;
}

.workspace-top h2 {
  margin: 0;
  font-size: 24px;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.workspace-top p {
  margin: 6px 0 0;
  color: #8b97b7;
  font-size: 14px;
  line-height: 1.6;
}

.workspace-actions,
.surface-tabs {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}

.chip,
.surface-tab {
  min-height: 36px;
  padding: 9px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.045);
  display: inline-flex;
  align-items: center;
  color: #d9e2fb;
  font: inherit;
  font-size: 12px;
  line-height: 1.35;
}

.chip {
  max-width: 260px;
}

.chip-ready {
  color: #bff7ec;
  background: rgba(77, 218, 198, 0.1);
  border-color: rgba(77, 218, 198, 0.2);
}

.preview-card {
  padding: 14px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.055);
  background: rgba(255, 255, 255, 0.03);
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.preview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.preview-head > div {
  min-width: 0;
}

.preview-card strong,
.restore-card b {
  display: block;
  font-size: 13px;
  margin-bottom: 6px;
}

.preview-card span,
.restore-card span,
.restore-plan-row p,
.summary-panel p,
.service-card p,
.summary-service small,
.model-panel p {
  display: block;
  color: #8b97b7;
  font-size: 12px;
  line-height: 1.55;
}

.preview-surface {
  margin-top: 12px;
  height: auto;
  min-height: 0;
  border-radius: 18px;
  background:
    radial-gradient(circle at 12% 18%, rgba(77, 218, 198, 0.12), transparent 22%),
    linear-gradient(180deg, rgba(18, 25, 43, 0.98), rgba(10, 15, 28, 0.98));
  border: 1px solid rgba(255, 255, 255, 0.055);
  padding: 16px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  min-width: 0;
  overflow: visible;
}

.surface-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.surface-tab {
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  gap: 8px;
}

.tab-led {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #6f86ff;
  box-shadow: 0 0 10px rgba(111, 134, 255, 0.58);
}

.surface-tab.ready .tab-led {
  background: #39d98a;
  box-shadow: 0 0 12px rgba(57, 217, 138, 0.72);
}

.surface-tab.warning .tab-led,
.surface-tab.checking .tab-led {
  background: #f0b35a;
  box-shadow: 0 0 12px rgba(240, 179, 90, 0.68);
}

.surface-tab.offline .tab-led {
  background: #f87171;
  box-shadow: 0 0 12px rgba(248, 113, 113, 0.68);
}

.surface-tab:hover {
  color: #eef4ff;
  border-color: rgba(111, 134, 255, 0.28);
  background: rgba(111, 134, 255, 0.1);
}

.surface-tab.active {
  color: #eef4ff;
  background: rgba(111, 134, 255, 0.2);
  border-color: rgba(111, 134, 255, 0.28);
  box-shadow: inset 0 0 0 1px rgba(111, 134, 255, 0.08);
}

.surface-core,
.overview-layout,
.services-layout,
.model-layout {
  min-width: 0;
  min-height: 0;
}

.surface-core {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
}

.overview-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(180px, 0.36fr);
  gap: 12px;
  height: 100%;
}

.project-panel,
.summary-panel,
.model-panel {
  min-width: 0;
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.025)),
    rgba(7, 11, 20, 0.64);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.2);
}

.project-panel {
  padding: 16px;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  align-content: start;
}

.project-panel-head {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #eef4ff;
  font-weight: 750;
  min-width: 0;
}

.project-panel-head > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-badge {
  flex: 0 0 auto;
  padding: 4px 8px;
  border-radius: 8px;
  color: #08111e;
  background: linear-gradient(90deg, #6f86ff, #4ddac6);
  font-size: 11px;
}

.project-path {
  margin-top: 10px;
  color: #8b97b7;
  font-size: 12px;
  line-height: 1.55;
  word-break: break-all;
}

.restore-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.restore-card {
  min-width: 0;
  padding: 11px;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.055);
}

.restore-card.ready {
  background: rgba(77, 218, 198, 0.055);
  border-color: rgba(77, 218, 198, 0.14);
}

.restore-card.warning,
.restore-card.checking {
  background: rgba(240, 179, 90, 0.055);
  border-color: rgba(240, 179, 90, 0.14);
}

.restore-card.offline {
  background: rgba(248, 113, 113, 0.055);
  border-color: rgba(248, 113, 113, 0.14);
}

.restore-card strong {
  display: block;
  margin: 2px 0 5px;
  color: #eef4ff;
  font-size: 14px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.restore-plan {
  align-self: end;
  min-width: 0;
  margin-top: 14px;
  padding: 12px;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.055);
}

.restore-plan > strong {
  color: #eef4ff;
  margin-bottom: 10px;
}

.restore-plan-row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
}

.restore-plan-row + .restore-plan-row {
  margin-top: 8px;
}

.restore-plan-row span {
  color: #c9d6f7;
  font-size: 12px;
}

.restore-plan-row p {
  margin: 0;
  overflow-wrap: anywhere;
}

.summary-panel {
  padding: 16px;
  display: grid;
  align-content: stretch;
}

.summary-kicker {
  color: #8b97b7;
  font-size: 12px;
  font-weight: 700;
}

.summary-panel strong,
.model-panel strong {
  display: block;
  margin-top: 5px;
  color: #eef4ff;
  font-size: 30px;
  line-height: 1;
}

.summary-leds {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.summary-services {
  display: grid;
  gap: 9px;
  margin-top: 14px;
  align-content: start;
}

.summary-service {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
  padding: 9px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.055);
}

.summary-service.ready {
  background: rgba(77, 218, 198, 0.04);
  border-color: rgba(77, 218, 198, 0.12);
}

.summary-service.warning,
.summary-service.checking {
  background: rgba(240, 179, 90, 0.04);
  border-color: rgba(240, 179, 90, 0.12);
}

.summary-service.offline {
  background: rgba(248, 113, 113, 0.04);
  border-color: rgba(248, 113, 113, 0.12);
}

.summary-service b {
  display: block;
  color: #eef4ff;
  font-size: 12px;
  line-height: 1.3;
}

.summary-service small {
  margin-top: 3px;
  overflow-wrap: anywhere;
}

.summary-led,
.service-led {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #6f86ff;
  box-shadow: 0 0 10px rgba(111, 134, 255, 0.58);
}

.summary-led.ready,
.service-card.ready .service-led {
  background: #39d98a;
  box-shadow: 0 0 12px rgba(57, 217, 138, 0.72);
}

.summary-led.warning,
.summary-led.checking,
.service-card.warning .service-led,
.service-card.checking .service-led {
  background: #f0b35a;
  box-shadow: 0 0 12px rgba(240, 179, 90, 0.62);
}

.summary-led.offline,
.service-card.offline .service-led {
  background: #f87171;
  box-shadow: 0 0 12px rgba(248, 113, 113, 0.62);
}

.services-layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.service-card {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  min-width: 0;
  padding: 13px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.055);
}

.service-card strong {
  display: block;
  color: #eef4ff;
  font-size: 13px;
  line-height: 1.25;
}

.service-card p {
  margin: 5px 0 0;
  overflow-wrap: anywhere;
}

.service-led {
  margin-top: 5px;
}

.model-layout {
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr);
  gap: 14px;
  align-items: stretch;
}

.model-orb {
  border-radius: 18px;
  background:
    radial-gradient(circle at 50% 42%, rgba(77, 218, 198, 0.55), transparent 19%),
    radial-gradient(circle at 50% 42%, rgba(111, 134, 255, 0.28), transparent 45%),
    rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(77, 218, 198, 0.14);
}

.model-orb.warning,
.model-orb.checking {
  background:
    radial-gradient(circle at 50% 42%, rgba(240, 179, 90, 0.55), transparent 19%),
    radial-gradient(circle at 50% 42%, rgba(111, 134, 255, 0.18), transparent 45%),
    rgba(255, 255, 255, 0.035);
  border-color: rgba(240, 179, 90, 0.16);
}

.model-orb.offline {
  background:
    radial-gradient(circle at 50% 42%, rgba(248, 113, 113, 0.55), transparent 19%),
    rgba(255, 255, 255, 0.035);
  border-color: rgba(248, 113, 113, 0.16);
}

.model-panel {
  padding: 16px;
}

.model-panel p {
  margin: 8px 0 0;
}

.model-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 16px;
}

@media (max-width: 1539px) {
  .workspace {
    grid-template-rows: auto minmax(0, 1fr);
    padding: 16px 18px 18px;
  }

  .workspace-top h2 {
    font-size: 22px;
  }

  .workspace-top p {
    max-width: 560px;
  }

  .preview-surface {
    height: auto;
    min-height: 0;
    padding: 14px;
  }
}

@media (max-width: 1180px) {
  .workspace-top {
    align-items: flex-start;
    flex-direction: column;
  }

  .workspace-top p,
  .preview-head span:not(.chip) {
    display: none;
  }

  .preview-surface {
    height: auto;
    min-height: 0;
  }

  .overview-layout,
  .model-layout {
    grid-template-columns: 1fr;
  }

  .summary-panel,
  .model-orb {
    display: none;
  }

  .restore-grid,
  .model-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-height: 820px) and (min-width: 901px) {
  .workspace {
    padding: 10px 12px 12px;
    gap: 8px;
  }

  .workspace-top h2 {
    font-size: 18px;
  }

  .workspace-top p,
  .preview-head span:not(.chip),
  .restore-card span,
  .restore-plan-row p,
  .summary-service small,
  .model-orb {
    display: none;
  }

  .chip,
  .surface-tab {
    min-height: 28px;
    padding: 5px 8px;
  }

  .preview-card {
    padding: 10px;
  }

  .preview-surface {
    height: auto;
    min-height: 0;
    margin-top: 6px;
    padding: 10px;
    gap: 8px;
    border-radius: 14px;
  }

  .overview-layout,
  .model-layout {
    grid-template-columns: minmax(0, 1fr) minmax(150px, 0.36fr);
    gap: 8px;
  }

  .model-layout {
    grid-template-columns: 1fr;
  }

  .project-panel,
  .summary-panel,
  .model-panel {
    padding: 11px;
    border-radius: 13px;
  }

  .project-path {
    margin-top: 7px;
    line-height: 1.35;
  }

  .restore-grid {
    margin-top: 9px;
    gap: 7px;
  }

  .restore-card {
    padding: 8px;
  }

  .restore-plan {
    margin-top: 8px;
    padding: 8px;
  }

  .restore-plan-row {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .summary-services {
    gap: 7px;
    margin-top: 10px;
  }

  .summary-service {
    padding: 8px;
  }

  .restore-card strong {
    margin-bottom: 0;
    font-size: 13px;
  }

  .summary-panel strong,
  .model-panel strong {
    font-size: 24px;
  }

  .services-layout {
    gap: 7px;
  }

  .service-card {
    padding: 9px;
    border-radius: 11px;
  }
}

@media (max-width: 900px) {
  .workspace {
    grid-column: auto;
    padding: 16px;
  }
}

@media (max-width: 640px) {
  .workspace-top,
  .preview-head,
  .surface-bar {
    flex-direction: column;
    align-items: flex-start;
  }

  .overview-layout,
  .services-layout,
  .model-layout,
  .restore-grid,
  .model-grid {
    grid-template-columns: 1fr;
  }

  .preview-surface {
    height: auto;
    min-height: 360px;
  }
}
</style>
