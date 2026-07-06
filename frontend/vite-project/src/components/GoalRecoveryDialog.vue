<template>
  <CodekDialog
    :visible="visible"
    title="发现未完成任务"
    width="min(640px, 94vw)"
    @close="dismiss"
  >
    <template #default>
      <p class="grd-hint">Codek 找到 {{ goals.length }} 个上次没有完成的任务。</p>

      <ul class="grd-list">
        <li v-for="goal in goals" :key="goal.id" class="grd-item">
          <div class="grd-info">
            <span class="grd-status" :data-status="goal.status">{{ goal.status }}</span>
            <span class="grd-desc">{{ goal.description }}</span>
            <span v-if="goal.project_root" class="grd-root" :title="goal.project_root">{{ shortRoot(goal.project_root) }}</span>
          </div>
          <div class="grd-actions">
            <button type="button" class="cdk-btn cdk-btn-primary" :disabled="busyId === goal.id" @click="onResume(goal)">
              {{ busyId === goal.id ? "继续中…" : "继续" }}
            </button>
            <button type="button" class="cdk-btn cdk-btn-secondary" :disabled="busyId === goal.id" @click="onOpen(goal)">查看详情</button>
            <button type="button" class="cdk-btn cdk-btn-danger" :disabled="busyId === goal.id" @click="onDiscard(goal)">丢弃</button>
          </div>
        </li>
      </ul>
    </template>

    <template #footer>
      <button type="button" class="cdk-btn cdk-btn-secondary" @click="dismiss">稍后处理</button>
    </template>
  </CodekDialog>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue"
import CodekDialog from "./CodekDialog.vue"

interface Goal { id: string; description: string; status: string; project_root?: string; created_at?: number }

const visible = ref(false)
const goals = ref<Goal[]>([])
const busyId = ref<string | null>(null)

const emit = defineEmits<{
  (event: "resume", goal: Goal, checkpoint: unknown): void
  (event: "open", goalId: string): void
}>()

function api(method: string, path: string, body?: unknown) {
  const codek = (window as unknown as { codek?: { api?: (m: string, p: string, b?: unknown) => Promise<unknown> } }).codek
  return codek?.api?.(method, path, body) ?? Promise.resolve(null)
}

function shortRoot(root: string): string {
  if (!root) return ""
  const parts = root.split(/[\\/]/).filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : root
}

async function load() {
  try {
    const result = (await api("GET", "/api/goals/incomplete")) as { goals?: Goal[] } | null
    const list = result?.goals ?? []
    if (list.length > 0) { goals.value = list; visible.value = true }
  } catch (err) { console.warn("[goal-recovery] load failed:", err) }
}

async function onResume(goal: Goal) {
  busyId.value = goal.id
  try {
    const result = (await api("POST", `/api/goals/${goal.id}/resume`)) as { checkpoint?: unknown } | null
    emit("resume", goal, result?.checkpoint ?? null)
    goals.value = goals.value.filter((g) => g.id !== goal.id)
    if (!goals.value.length) visible.value = false
  } catch (err) { console.warn("[goal-recovery] resume failed:", err) }
  finally { busyId.value = null }
}

async function onDiscard(goal: Goal) {
  busyId.value = goal.id
  try {
    await api("DELETE", `/api/goals/${goal.id}`)
    goals.value = goals.value.filter((g) => g.id !== goal.id)
    if (!goals.value.length) visible.value = false
  } catch (err) { console.warn("[goal-recovery] discard failed:", err) }
  finally { busyId.value = null }
}

function onOpen(goal: Goal) { emit("open", goal.id) }
function dismiss() { visible.value = false }

onMounted(() => { load() })
</script>

<style scoped>
.grd-hint { margin: 0 0 8px; font-size: 13px; opacity: 0.6; }
.grd-list { list-style: none; margin: 0; padding: 0; }
.grd-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; }
.grd-item + .grd-item { border-top: 1px solid var(--border-subtle); }
.grd-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
.grd-status { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.5; }
.grd-status[data-status="running"] { color: #58a6ff; opacity: 1; }
.grd-status[data-status="pending"] { color: #d29922; opacity: 1; }
.grd-desc { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.grd-root { font-size: 11px; opacity: 0.45; font-family: ui-monospace, monospace; }
.grd-actions { display: flex; gap: 6px; flex-shrink: 0; }
</style>
