<template>
  <div class="artifact-viewer">
    <div v-for="artifact in artifacts" :key="artifact.id" class="artifact-row">
      <div class="artifact-head">
        <span>{{ artifact.type }}</span>
        <span>{{ new Date(artifact.createdAt).toLocaleTimeString() }}</span>
      </div>
      <pre>{{ artifact.content || artifact.path || "" }}</pre>
    </div>
    <div v-if="artifacts.length === 0" class="artifact-empty">暂无产物</div>
  </div>
</template>

<script setup lang="ts">
import type { AgentArtifact } from "../agent/orchestratorClient"

defineProps<{
  artifacts: AgentArtifact[]
}>()
</script>

<style scoped>
.artifact-viewer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.artifact-row {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-deepest);
  overflow: hidden;
}

.artifact-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 11px;
}

pre {
  margin: 0;
  padding: 8px;
  max-height: 160px;
  overflow: auto;
  color: var(--text-muted);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
}

.artifact-empty {
  color: var(--text-muted);
  font-size: 12px;
}
</style>
