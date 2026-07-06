<template>
  <CodekDialog
    :visible="visible"
    title="任务依赖图"
    width="min(860px, 94vw)"
    @close="$emit('close')"
  >
    <template #default>
      <svg ref="svgRef" class="tgm-svg" :width="svgWidth" :height="svgHeight">
        <g class="tgm-edges">
          <line
            v-for="edge in edges"
            :key="edge.id"
            :x1="edge.x1" :y1="edge.y1" :x2="edge.x2" :y2="edge.y2"
            class="tgm-edge"
            :class="edge.status"
            stroke="#555"
            stroke-width="2"
            marker-end="url(#tgm-arrow)"
          />
        </g>
        <g class="tgm-nodes">
          <g
            v-for="node in nodes"
            :key="node.id"
            :transform="`translate(${node.x}, ${node.y})`"
            class="tgm-node"
            :class="node.status"
          >
            <rect :width="nodeWidth" :height="nodeHeight" rx="4" class="tgm-node-rect" />
            <text :x="nodeWidth / 2" :y="nodeHeight / 2 - 10" text-anchor="middle" class="tgm-node-label">{{ node.label }}</text>
            <text :x="nodeWidth / 2" :y="nodeHeight / 2 + 10" text-anchor="middle" class="tgm-node-status">{{ statusIcon(node.status) }}</text>
          </g>
        </g>
        <defs>
          <marker id="tgm-arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
            <polygon points="0 0, 10 3, 0 6" fill="#555" />
          </marker>
        </defs>
      </svg>

      <div class="tgm-legend">
        <div class="tgm-legend-item"><span class="tgm-legend-dot pending" /> 等待中</div>
        <div class="tgm-legend-item"><span class="tgm-legend-dot running" /> 运行中</div>
        <div class="tgm-legend-item"><span class="tgm-legend-dot completed" /> 已完成</div>
        <div class="tgm-legend-item"><span class="tgm-legend-dot failed" /> 失败</div>
      </div>
    </template>
  </CodekDialog>
</template>

<script setup lang="ts">
import { computed } from "vue"
import type { AgentTask } from "../agent/agentCore"
import CodekDialog from "./CodekDialog.vue"

interface TaskNode { id: string; label: string; status: string; x: number; y: number }
interface TaskEdge { id: string; from: string; to: string; status: string; x1: number; y1: number; x2: number; y2: number }

const props = defineProps<{ visible: boolean; tasks: AgentTask[] }>()
defineEmits<{ close: [] }>()

const svgWidth = 800
const svgHeight = 600
const nodeWidth = 150
const nodeHeight = 80

const nodes = computed<TaskNode[]>(() =>
  props.tasks.map((task, index) => {
    const col = index % 3
    const row = Math.floor(index / 3)
    return { id: task.id, label: task.description.slice(0, 20) + (task.description.length > 20 ? "…" : ""), status: task.status, x: 50 + col * 200, y: 50 + row * 120 }
  }),
)

const edges = computed<TaskEdge[]>(() => {
  const result: TaskEdge[] = []
  for (let i = 0; i < props.tasks.length - 1; i++) {
    const from = nodes.value[i]; const to = nodes.value[i + 1]
    if (!from || !to) continue
    result.push({ id: `${from.id}-${to.id}`, from: from.id, to: to.id, status: from.status === "completed" && to.status !== "pending" ? "active" : "inactive", x1: from.x + nodeWidth, y1: from.y + nodeHeight / 2, x2: to.x, y2: to.y + nodeHeight / 2 })
  }
  return result
})

function statusIcon(status: string): string {
  switch (status) { case "completed": return "✓"; case "failed": return "✗"; case "running": return "⏳"; default: return "○" }
}
</script>

<style scoped>
.tgm-svg { display: block; margin: 0 auto; }
.tgm-node-rect { fill: var(--bg-dark); stroke: var(--border); stroke-width: 2; }
.tgm-node.pending .tgm-node-rect { fill: var(--bg-darker); }
.tgm-node.running .tgm-node-rect { fill: rgba(255, 169, 77, 0.12); stroke: #ffa94d; }
.tgm-node.completed .tgm-node-rect { fill: rgba(81, 207, 102, 0.12); stroke: #51cf66; }
.tgm-node.failed .tgm-node-rect { fill: rgba(255, 107, 107, 0.12); stroke: #ff6b6b; }
.tgm-node-label { fill: var(--text-primary); font-size: 12px; font-weight: 500; }
.tgm-node-status { fill: var(--text-secondary); font-size: 18px; }
.tgm-edge { stroke: var(--border); stroke-width: 2; }
.tgm-edge.active { stroke: var(--accent); stroke-width: 3; }
.tgm-legend { display: flex; gap: 20px; justify-content: center; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 13px; opacity: 0.65; }
.tgm-legend-item { display: flex; align-items: center; gap: 8px; }
.tgm-legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; }
.tgm-legend-dot.pending { background: var(--border-bright); }
.tgm-legend-dot.running { background: #ffa94d; }
.tgm-legend-dot.completed { background: #51cf66; }
.tgm-legend-dot.failed { background: #ff6b6b; }
</style>
