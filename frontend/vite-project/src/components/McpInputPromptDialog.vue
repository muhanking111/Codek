<template>
  <CodekDialog
    :visible="Boolean(current)"
    title="MCP 输入"
    width="min(560px, 94vw)"
    :loading="saving"
    @close="cancel"
  >
    <template #default>
      <div class="mcp-input-body">
        <div v-if="current?.serverName" class="mcp-input-server">
          <span>{{ current.serverName }}</span>
          <span v-if="current.toolName">/ {{ current.toolName }}</span>
        </div>
        <label
          v-for="input in current?.inputs || []"
          :key="input.id"
          class="mcp-input-field"
        >
          <span class="mcp-input-label">{{ input.description || input.id }}</span>
          <input
            v-model="values[input.id]"
            class="mcp-input-control"
            :type="input.password ? 'password' : 'text'"
            :autocomplete="input.password ? 'new-password' : 'off'"
            :placeholder="placeholderFor(input)"
            @keydown.enter.prevent="submit"
          />
        </label>
        <p v-if="error" class="mcp-input-error">{{ error }}</p>
      </div>
    </template>

    <template #footer>
      <button class="cdk-btn cdk-btn-secondary" type="button" @click="cancel">取消</button>
      <button class="cdk-btn cdk-btn-primary" type="button" :disabled="saving || !canSubmit" @click="submit">保存</button>
    </template>
  </CodekDialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue"
import type { McpRegistryInputMetadata } from "../ai/mcpRegistryClient"
import { consumeMcpInputRequest, mcpInputPromptState } from "../ai/mcpInputPrompt"
import { executeCommand } from "../workbench/commandRegistry"
import { MCP_COMMAND_IDS } from "../workbench/mcpCommandIds"
import CodekDialog from "./CodekDialog.vue"

const values = reactive<Record<string, string>>({})
const saving = ref(false)
const error = ref("")

const current = computed(() => mcpInputPromptState.queue[0] ?? null)
const canSubmit = computed(() => {
  const request = current.value
  if (!request) return false
  return request.inputs.every((input) => String(values[input.id] ?? "").trim().length > 0)
})

watch(current, (request) => {
  error.value = ""
  for (const key of Object.keys(values)) delete values[key]
  for (const input of request?.inputs || []) {
    values[input.id] = input.default == null || String(input.default).includes("${") ? "" : String(input.default)
  }
}, { immediate: true })

function placeholderFor(input: McpRegistryInputMetadata): string {
  if (typeof input.default === "string" && input.default && !input.default.includes("${")) return input.default
  return input.id
}

async function submit(): Promise<void> {
  const request = current.value
  if (!request || !canSubmit.value || saving.value) return
  saving.value = true
  error.value = ""
  try {
    for (const input of request.inputs) {
      await executeCommand(MCP_COMMAND_IDS.EditStoredInput, [
        input,
        values[input.id],
        { profileId: request.profileId },
      ])
    }
    consumeMcpInputRequest(request.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

function cancel(): void {
  const request = current.value
  if (request) consumeMcpInputRequest(request.id)
}
</script>

<style scoped>
.mcp-input-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mcp-input-server {
  font-size: 12px;
  color: var(--text-muted);
}

.mcp-input-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mcp-input-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.mcp-input-control {
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  color: var(--text-primary);
  padding: 0 10px;
  font: inherit;
  outline: none;
}

.mcp-input-control:focus {
  border-color: var(--accent);
}

.mcp-input-error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
</style>
