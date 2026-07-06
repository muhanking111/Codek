<template>
  <div
    class="chat-panel"
    :class="{ open: visible }"
    data-codek-smoke="chat-panel-root"
    :style="visible ? { width: panelWidth + 'px' } : {}"
  >
    <div class="resize-handle" @mousedown.prevent="startResize" />
    <div class="chat-header">
      <div class="chat-title-row">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent)"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span>{{ t("chat.title") }}</span>
      </div>
      <div class="chat-header-actions">
        <button
          v-if="hasUnappliedBlocks"
          class="chat-btn-icon"
          @click="handleApplyAll"
          :title="t('diffApply.applyAll')"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
        <button
          v-if="lastAppliedResult"
          class="chat-btn-icon"
          @click="handleUndoLastApply"
          :title="t('diffApply.undo')"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </button>
        <button class="chat-btn-icon" @click="$emit('newchat')" :title="t('chat.newChat')">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button class="chat-btn-icon" @click="$emit('close')" :title="t('chat.close')">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    <SandboxModeBar />

    <div class="session-strip">
      <div
        v-for="session in sessions"
        :key="session.id"
        class="session-pill-wrap"
        :class="{ active: session.id === currentSessionId }"
      >
        <button class="session-pill" @click="$emit('selectSession', session.id)">
          {{ formatSessionTitle(session.title) }}
        </button>
        <button
          class="session-delete"
          @click.stop="$emit('deleteSession', session.id)"
          :title="t('chat.deleteChat')"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    <div class="chat-messages" ref="messagesRef">
      <div v-if="messages.length === 0" class="chat-welcome">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent)"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span class="welcome-title">描述你要修改的代码或问题</span>
        <span class="welcome-hint">我可以读取项目、分析问题、提出计划并在授权后修改文件。</span>
      </div>

      <div v-for="(msg, index) in messages" :key="index" class="message" :class="msg.role">
        <div class="msg-avatar">
          <span v-if="msg.role === 'user'">U</span>
          <svg
            v-else
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>

        <div class="msg-body">
          <div v-if="msg._mentions && msg._mentions.length > 0" class="msg-mentions-row">
            <span
              v-for="(m, mi) in msg._mentions"
              :key="mi"
              class="mention-chip"
              :class="`mention-chip-${m.type}`"
            >
              <span class="mention-chip-icon">{{ m.icon }}</span>
              <span class="mention-chip-label">{{ m.label }}</span>
            </span>
          </div>

          <!-- Rich parts renderer used by the agent loop. -->
          <template v-if="hasParts(msg)">
            <template v-for="(item, ii) in getRenderItems(msg)" :key="ii">
              <PlanTreeView
                v-if="item.kind === 'plan'"
                :plan="item.plan"
                :expandedPhases="expandedPlanPhases"
                @toggleExpand="togglePlanPhase"
              />

              <!-- thinking part -->
              <div
                v-else-if="item.kind === 'thinking'"
                class="thinking-block"
                :class="{
                  expanded: expandedThinking.has(partsThinkingKey(index, item.partIndex)),
                  streaming: item.streaming,
                }"
              >
                <button
                  class="thinking-toggle"
                  @click="toggleThinking(partsThinkingKey(index, item.partIndex))"
                >
                  <svg
                    class="thinking-chevron"
                    :class="{ open: expandedThinking.has(partsThinkingKey(index, item.partIndex)) }"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span class="thinking-label">{{
                    item.streaming ? t("chat.thinking") : t("chat.thought")
                  }}</span>
                  <span v-if="!item.streaming && item.text" class="thinking-meta"
                    >{{ item.text.length }} 字</span
                  >
                  <span v-if="item.streaming" class="thinking-pulse" />
                </button>
                <div
                  v-if="expandedThinking.has(partsThinkingKey(index, item.partIndex))"
                  class="thinking-content"
                >
                  {{ item.text }}
                </div>
              </div>

              <!-- code or text block -->
              <div
                v-else-if="item.kind === 'block' && item.block.type === 'code'"
                class="code-block-wrap"
              >
                <div class="code-block-header">
                  <span class="code-lang-label">{{ item.block.language || "code" }}</span>
                  <button
                    v-if="
                      canApplyBlock(item.block) &&
                      !isBlockApplied(msgIndex(msg), item.globalBlockIdx)
                    "
                    class="apply-btn"
                    :title="t('diffApply.apply')"
                    @click="handleApplyCode(msgIndex(msg), item.globalBlockIdx, item.block)"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {{ t("diffApply.apply") }}
                  </button>
                  <span
                    v-else-if="
                      canApplyBlock(item.block) &&
                      isBlockApplied(msgIndex(msg), item.globalBlockIdx)
                    "
                    class="applied-badge"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {{ t("diffApply.applied") }}
                  </span>
                </div>
                <pre><code :class="`lang-${item.block.language}`">{{ item.block.content }}</code></pre>
                <div
                  v-if="
                    applyFilePathTarget?.msgIdx === msgIndex(msg) &&
                    applyFilePathTarget?.blockIdx === item.globalBlockIdx
                  "
                  class="filepath-input-wrap"
                >
                  <input
                    ref="filepathInputRef"
                    v-model="manualFilePath"
                    class="filepath-input"
                    :placeholder="t('diffApply.enterPath')"
                    @keydown.enter="
                      confirmApplyWithPath(msgIndex(msg), item.globalBlockIdx, item.block)
                    "
                    @keydown.escape="cancelFilePathInput"
                  />
                  <button
                    class="filepath-confirm-btn"
                    @click="confirmApplyWithPath(msgIndex(msg), item.globalBlockIdx, item.block)"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <span v-else-if="item.kind === 'block'" class="msg-text">{{
                item.block.content
              }}</span>

              <div
                v-else-if="item.kind === 'orchestrator_task'"
                class="orchestrator-task-card"
                data-codek-smoke="chat-orchestrator-task-card"
              >
                <div class="orchestrator-task-head">
                  <div>
                    <div class="orchestrator-task-title">已创建智能体任务</div>
                    <div class="orchestrator-task-subtitle">
                      {{ formatOrchestratorMode(item.task.visibleMode) }} ·
                      {{ formatOrchestratorStrategy(item.task.executionStrategy) }}
                    </div>
                  </div>
                  <span
                    class="orchestrator-task-status"
                    :class="formatOrchestratorStatusClass(item.task.status)"
                  >
                    {{ item.task.runtimeStatusLabel || formatOrchestratorStatus(item.task.status) }}
                  </span>
                </div>
                <div class="orchestrator-task-meta">
                  <span :title="item.task.taskId">Task {{ shortId(item.task.taskId) }}</span>
                  <span :title="item.task.runId">Run {{ shortId(item.task.runId) }}</span>
                </div>
                <p class="orchestrator-task-reason">{{ item.task.reason }}</p>
                <div class="orchestrator-task-next">
                  {{
                    item.task.nextAction ||
                    (item.task.requiresConfirmation
                      ? "下一步：在任务中心确认权限或缩小范围。"
                      : "下一步：在任务中心查看计划、diff 和质量门。")
                  }}
                </div>
              </div>

              <!-- tool call (collapsible) -->
              <div
                v-else-if="item.kind === 'tool'"
                class="tool-card-v2"
                :class="[item.call.status, { expanded: expandedTools.has(item.call.id) }]"
              >
                <button class="tool-card-header" @click="toggleTool(item.call.id)">
                  <svg
                    class="tool-card-chevron"
                    :class="{ open: expandedTools.has(item.call.id) }"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span class="tool-card-icon">{{ toolIcon(item.call.name) }}</span>
                  <span class="tool-card-name">{{ item.call.name }}</span>
                  <span v-if="item.call.preview" class="tool-card-preview">{{
                    item.call.preview
                  }}</span>
                  <span class="tool-card-status" :class="item.call.status">
                    <span v-if="item.call.status === 'running'" class="tool-spinner" />
                    <svg
                      v-else-if="item.call.status === 'done'"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <svg
                      v-else-if="item.call.status === 'error'"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </span>
                </button>
                <div v-if="expandedTools.has(item.call.id)" class="tool-card-body">
                  <div v-if="item.call.input" class="tool-card-input">
                    <div class="tool-card-section-label">{{ t("chat.toolInput") }}</div>
                    <pre>{{ formatResult(item.call.input) }}</pre>
                  </div>
                  <div
                    v-if="item.result"
                    class="tool-card-output"
                    :class="{ error: item.result.isError }"
                  >
                    <div class="tool-card-section-label">
                      {{ item.result.isError ? t("chat.toolError") : t("chat.toolOutput") }}
                    </div>
                    <pre
                      v-if="formatResultHtml(item.result.content)"
                      class="ansi-output"
                      v-html="formatResultHtml(item.result.content)"
                    ></pre>
                    <pre v-else>{{ formatResult(item.result.content) }}</pre>
                  </div>
                  <div
                    v-else-if="item.call.status === 'error' && item.call.errorMessage"
                    class="tool-card-output error"
                  >
                    <div class="tool-card-section-label">{{ t("chat.toolError") }}</div>
                    <pre>{{ item.call.errorMessage }}</pre>
                  </div>
                </div>
              </div>
            </template>

            <div
              class="msg-actions"
              v-if="!msg._streaming && msg.role === 'assistant' && partsHaveText(msg)"
            >
              <button class="msg-action-btn" :title="t('chat.copy')" @click="copyMessage(msg)">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
              <button
                v-if="index === lastAssistantIndex"
                class="msg-action-btn"
                :title="t('chat.regenerate')"
                @click="$emit('regenerate')"
                :disabled="loading"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </button>
              <span v-if="copiedId === index" class="copied-toast">{{ t("chat.copied") }}</span>
            </div>
          </template>

          <!-- Legacy renderer kept for messages that have not migrated to parts. -->
          <template v-else>
            <template v-if="msg.role === 'assistant'">
              <div
                v-if="splitThinking(String(msg.content ?? '')).thinking"
                class="thinking-block"
                :class="{
                  expanded: expandedThinking.has(index),
                  streaming: splitThinking(String(msg.content ?? '')).streaming,
                }"
              >
                <button class="thinking-toggle" @click="toggleThinking(index)">
                  <svg
                    class="thinking-chevron"
                    :class="{ open: expandedThinking.has(index) }"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span class="thinking-label">
                    {{
                      thinkingDurationLabel(
                        index,
                        splitThinking(String(msg.content ?? "")).streaming,
                      )
                    }}
                  </span>
                  <span
                    v-if="splitThinking(String(msg.content ?? '')).streaming"
                    class="thinking-pulse"
                  />
                </button>
                <div v-if="expandedThinking.has(index)" class="thinking-content">
                  {{ splitThinking(String(msg.content ?? "")).thinking }}
                </div>
              </div>
            </template>
            <div class="msg-content">
              <template
                v-for="(block, blockIndex) in renderBlocks(
                  msg.role === 'assistant'
                    ? splitThinking(String(msg.content ?? '')).visible
                    : String(msg.content ?? ''),
                )"
                :key="blockIndex"
              >
                <div v-if="block.type === 'code'" class="code-block-wrap">
                  <div class="code-block-header">
                    <span class="code-lang-label">{{ block.language || "code" }}</span>
                    <button
                      v-if="canApplyBlock(block) && !isBlockApplied(msgIndex(msg), blockIndex)"
                      class="apply-btn"
                      :title="t('diffApply.apply')"
                      @click="handleApplyCode(msgIndex(msg), blockIndex, block)"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {{ t("diffApply.apply") }}
                    </button>
                    <span
                      v-else-if="canApplyBlock(block) && isBlockApplied(msgIndex(msg), blockIndex)"
                      class="applied-badge"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {{ t("diffApply.applied") }}
                    </span>
                  </div>
                  <pre><code :class="`lang-${block.language}`">{{ block.content }}</code></pre>
                  <div
                    v-if="
                      applyFilePathTarget?.msgIdx === msgIndex(msg) &&
                      applyFilePathTarget?.blockIdx === blockIndex
                    "
                    class="filepath-input-wrap"
                  >
                    <input
                      ref="filepathInputRef"
                      v-model="manualFilePath"
                      class="filepath-input"
                      :placeholder="t('diffApply.enterPath')"
                      @keydown.enter="confirmApplyWithPath(msgIndex(msg), blockIndex, block)"
                      @keydown.escape="cancelFilePathInput"
                    />
                    <button
                      class="filepath-confirm-btn"
                      @click="confirmApplyWithPath(msgIndex(msg), blockIndex, block)"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <span v-else class="msg-text">{{ block.content }}</span>
              </template>
            </div>

            <div
              class="msg-actions"
              v-if="!msg._streaming && msg.role === 'assistant' && msg.content"
            >
              <button class="msg-action-btn" :title="t('chat.copy')" @click="copyMessage(msg)">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
              <button
                v-if="index === lastAssistantIndex"
                class="msg-action-btn"
                :title="t('chat.regenerate')"
                @click="$emit('regenerate')"
                :disabled="loading"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </button>
              <span v-if="copiedId === index" class="copied-toast">{{ t("chat.copied") }}</span>
            </div>

            <div v-if="msg.toolUse" class="tool-card" :class="msg.toolUse.status">
              <div class="tool-name">
                <span class="tool-icon">{{ toolIcon(msg.toolUse.name) }}</span>
                {{ msg.toolUse.name }}
                <span class="tool-status">{{ toolStatus(msg.toolUse.status) }}</span>
              </div>
              <div v-if="msg.toolUse.status === 'done'" class="tool-result">
                <pre>{{ formatResult(msg.toolUse.result) }}</pre>
              </div>
              <div v-else-if="msg.toolUse.status === 'error'" class="tool-result">
                <pre>{{ formatResult(msg.toolUse.error) }}</pre>
              </div>
            </div>
          </template>
        </div>
      </div>

      <div v-if="loading" class="message assistant">
        <div class="msg-avatar">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div class="msg-body">
          <div class="thinking-dots"><span>.</span><span>.</span><span>.</span></div>
        </div>
      </div>
    </div>

    <div class="chat-input-area">
      <ChatComposer>
        <template #input>
          <div class="chat-input-wrapper">
            <div
              v-if="attachedMentions.length > 0 || attachedFiles.length > 0"
              class="mention-chips-row"
            >
              <span
                v-for="(m, mi) in attachedMentions"
                :key="mi"
                class="mention-chip"
                :class="`mention-chip-${m.type}`"
              >
                <span class="mention-chip-icon">{{ m.icon }}</span>
                <span class="mention-chip-label">{{ m.label }}</span>
                <button class="mention-chip-remove" @click="removeMention(mi)">&times;</button>
              </span>
              <span
                v-for="(file, fi) in attachedFiles"
                :key="`file-${fi}`"
                class="mention-chip mention-chip-file"
              >
                <span class="mention-chip-icon">{{
                  file.kind === "image" ? "图" : file.status === "error" ? "!" : "文件"
                }}</span>
                <span class="mention-chip-label" :title="file.error || file.preview || file.name">
                  {{ file.name }} ·
                  {{ file.status === "error" ? "未加入" : formatAttachmentSize(file.size) }}
                </span>
                <button class="mention-chip-remove" @click="removeAttachment(fi)">&times;</button>
              </span>
            </div>
            <textarea
              ref="inputRef"
              v-model="inputText"
              class="chat-input"
              data-codek-smoke="chat-input"
              :placeholder="t('chat.placeholder')"
              @keydown.enter.exact.prevent="send"
              @keydown="handleInputKeydown"
              @input="handleInputChange"
              rows="1"
            />
            <MentionsPopup
              :visible="showMentions"
              :position="mentionPosition"
              :query="mentionQuery"
              :projectRoot="projectRoot"
              @select="handleMentionSelect"
              @close="closeMentions"
              ref="mentionsPopupRef"
            />
          </div>
        </template>

        <template #left>
          <div class="composer-left-tools-inner">
            <ChatAttachmentButton @attach="handleAttachments" />
            <ChatModeDropdown
              :model-value="currentMode"
              :auto-permission-level="autoPermissionLevel"
              @update:model-value="switchMode"
            />
          </div>
          <div class="composer-model-tools">
            <ChatModelPicker
              :type-options="typeOptions"
              :active-type="activeType"
              :active-model-name="activeModelName"
              :current-models="currentModels"
              :fetching-models="fetchingModels"
              :provider-enabled="providerEnabled"
              @type-change="setComposerType"
              @model-change="setComposerModel"
            />
          </div>
        </template>

        <template #right>
          <VoiceInput @text="handleVoiceText" />
          <button
            v-if="loading"
            class="chat-send-btn chat-stop-btn"
            @click="handleInterrupt"
            :title="t('chat.interrupt') || '中断'"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
          <button
            v-else
            class="chat-send-btn"
            @click="send"
            :disabled="
              !inputText.trim() && attachedMentions.length === 0 && attachedFiles.length === 0
            "
            title="发送"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </template>
      </ChatComposer>
    </div>

    <div v-if="applyToast.visible" class="apply-toast" :class="applyToast.type">
      {{ applyToast.message }}
    </div>

    <div
      v-if="showModeSwitchDialogVisible"
      class="auto-dialog-backdrop"
      @click.self="cancelModeSwitch"
    >
      <div class="auto-dialog">
        <div class="auto-dialog-header">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent)"
            stroke-width="2"
            stroke-linecap="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span class="auto-dialog-title">{{ t("chat.askSwitchTitle") }}</span>
        </div>
        <p class="auto-dialog-desc">{{ t("chat.askSwitchDesc") }}</p>
        <div class="auto-dialog-actions">
          <button class="danger-reject-btn" @click="cancelModeSwitch">
            {{ t("chat.cancel") }}
          </button>
          <button
            class="danger-approve-btn"
            style="background: var(--accent)"
            @click="confirmModeSwitch"
          >
            {{ t("chat.askSwitchConfirm") }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showAutoPermissionDialog"
      class="auto-dialog-backdrop"
      @click.self="cancelAutoDialog"
    >
      <div class="auto-dialog">
        <div class="auto-dialog-header">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent)"
            stroke-width="2"
            stroke-linecap="round"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span class="auto-dialog-title">{{ t("chat.autoModeTitle") }}</span>
        </div>
        <p class="auto-dialog-desc">{{ t("chat.autoModeDesc") }}</p>
        <div class="auto-dialog-options">
          <button class="auto-option" @click="confirmAutoMode('all')">
            <div class="auto-option-icon warn">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              >
                <path
                  d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div class="auto-option-text">
              <span class="auto-option-label">{{ t("chat.autoAll") }}</span>
              <span class="auto-option-desc">{{ t("chat.autoAllDesc") }}</span>
            </div>
          </button>
          <button class="auto-option recommended" @click="confirmAutoMode('safe')">
            <div class="auto-option-icon safe">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <div class="auto-option-text">
              <span class="auto-option-label"
                >{{ t("chat.autoSafe") }}
                <span class="recommended-tag">{{ t("chat.recommended") }}</span></span
              >
              <span class="auto-option-desc">{{ t("chat.autoSafeDesc") }}</span>
            </div>
          </button>
        </div>
        <button class="auto-dialog-cancel" @click="cancelAutoDialog">{{ t("chat.cancel") }}</button>
      </div>
    </div>

    <div v-if="showDangerConfirmDialog" class="auto-dialog-backdrop" @click.self="rejectDangerOp">
      <div class="auto-dialog danger-confirm">
        <div class="auto-dialog-header">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--red)"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path
              d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
            />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span class="auto-dialog-title">{{ t("chat.dangerTitle") }}</span>
        </div>
        <p class="auto-dialog-desc danger-desc">{{ dangerOpDescription }}</p>
        <div class="auto-dialog-actions">
          <button class="danger-reject-btn" @click="rejectDangerOp">{{ t("chat.reject") }}</button>
          <button class="danger-approve-btn" @click="approveDangerOp">
            {{ t("chat.approve") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useI18n } from "../i18n/index"
import {
  aiProviderState,
  setActiveType,
  setActiveModel,
  fetchModelsForType,
  hasActiveProvider,
  getActiveModel,
  TYPE_OPTIONS,
} from "../ai/aiProviders"
import type { AiProviderType } from "../ai/aiProviders"
import { processMentions, mentionRegistry } from "../ai/mentions"
import type { Mention } from "../ai/mentions"
import { buildContextEvidence } from "../ai/contextEvidence"
import type { ContextEvidence } from "../ai/contextEvidence"
import { enforceStructuredContextBudget } from "../ai/context.js"
import { getAllRuleContext, getRuleFiles } from "../workspace/teamRules"
import MentionsPopup from "./MentionsPopup.vue"
import VoiceInput from "./VoiceInput.vue"
import SandboxModeBar from "./SandboxModeBar.vue"
import PlanTreeView from "./PlanTreeView.vue"
import ChatComposer from "./ChatComposer.vue"
import ChatModeDropdown from "./ChatModeDropdown.vue"
import ChatModelPicker from "./ChatModelPicker.vue"
import ChatAttachmentButton from "./ChatAttachmentButton.vue"
import {
  buildAttachmentContextBlock,
  buildProviderMessages,
  formatAttachmentSize,
  type ChatAttachment,
  type ProviderMessageBuildResult,
} from "./chatAttachments"
import {
  parseCodeBlocks,
  applyCodeBlock,
  undoApply,
  getFilepathHintForBlock,
  isApplicableCodeBlock,
} from "../ai/diffApply"
import type { ApplyResult, CodeBlock } from "../ai/diffApply"
import type { ChatPart, ToolCallPart, ToolResultPart } from "../ai/chatTypes"
import { ansiToHtml, hasAnsi } from "../ai/ansi"

/** 聊天消息，字段与父组件约定保持一致。 */
interface ChatMentionChip {
  type: string
  icon: string
  label: string
}

interface ChatToolUse {
  name: string
  status: string
  result?: unknown
  error?: unknown
}

interface OrchestratorTaskPart {
  type: "orchestrator_task"
  taskId: string
  runId: string
  status: string
  runtimeStatusLabel?: string
  visibleMode: "agent" | "auto" | string
  executionStrategy: "single-agent" | "multi-agent" | string
  reason: string
  nextAction?: string
  requiresConfirmation?: boolean
}

interface ChatMessage {
  role: string
  content?: string
  /** Rich representation (preferred). Renderer uses this when present. */
  parts?: Array<ChatPart | OrchestratorTaskPart>
  _streaming?: boolean
  _mentions?: ChatMentionChip[]
  /** Legacy single-tool field, kept for backward compatibility. */
  toolUse?: ChatToolUse
}

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
  messages: ChatMessage[]
  loading: boolean
  sessions: Array<{ id: string; title: string }>
  currentSessionId: string
  activeModel: string
  openFiles?: string[]
}>()

const emit = defineEmits<{
  send: [
    text: string,
    mentions?: Mention[],
    context?: {
      mode: ChatMode
      permissionLevel: AutoPermissionLevel
      attachments?: ChatAttachment[]
      providerMessages?: ProviderMessageBuildResult["messages"]
      attachmentWarnings?: string[]
      contextEvidence?: ContextEvidence
      contextBlocks?: {
        rulesText: string
        mentionsText: string
        attachmentText: string
        userText: string
      }
    },
  ]
  close: []
  newchat: []
  selectSession: [id: string]
  deleteSession: [id: string]
  regenerate: []
  interrupt: []
  modeChange: [mode: string, permissionLevel: string | null]
}>()

function handleInterrupt(): void {
  emit("interrupt")
}

function formatSessionTitle(title: string): string {
  const normalized = String(title || "").trim()
  if (!normalized || normalized.toLowerCase() === "new chat") return "新会话"
  return normalized
}

const MIN_WIDTH = 480
const DEFAULT_WIDTH = 520
const MAX_WIDTH = 1040
const STORAGE_KEY = "codek.chatPanel.width.v3"

function loadWidth(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const n = parseInt(saved, 10)
      if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_WIDTH
}

const panelWidth = ref(loadWidth())
const isResizing = ref(false)

function startResize(e: MouseEvent): void {
  isResizing.value = true
  const startX = e.clientX
  const startWidth = panelWidth.value
  document.body.style.cursor = "col-resize"
  document.body.style.userSelect = "none"

  const onMove = (ev: MouseEvent) => {
    const delta = startX - ev.clientX
    const viewportCap = Math.max(MIN_WIDTH, window.innerWidth - 120)
    const cap = Math.min(MAX_WIDTH, viewportCap)
    const newWidth = Math.min(cap, Math.max(MIN_WIDTH, startWidth + delta))
    panelWidth.value = newWidth
  }

  const onUp = () => {
    isResizing.value = false
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
    document.removeEventListener("mousemove", onMove)
    document.removeEventListener("mouseup", onUp)
    try {
      localStorage.setItem(STORAGE_KEY, String(panelWidth.value))
    } catch {
      /* ignore */
    }
  }

  document.addEventListener("mousemove", onMove)
  document.addEventListener("mouseup", onUp)
}

onBeforeUnmount(() => {
  document.body.style.cursor = ""
  document.body.style.userSelect = ""
})

const inputRef = ref<HTMLTextAreaElement | null>(null)
const messagesRef = ref<HTMLDivElement | null>(null)
const inputText = ref("")
const copiedId = ref(-1)
const expandedThinking = ref<Set<number>>(new Set())
const thinkingTimings = ref<Map<number, { start: number; end: number | null }>>(new Map())
/** Tool cards collapse/expand state, keyed by tool_call.id. Default = collapsed. */
const expandedTools = ref<Set<string>>(new Set())
const expandedPlanPhases = ref<Record<string, boolean>>({})

function togglePlanPhase(phaseId: string): void {
  expandedPlanPhases.value = {
    ...expandedPlanPhases.value,
    [phaseId]: !expandedPlanPhases.value[phaseId],
  }
}

function toggleTool(callId: string): void {
  const next = new Set(expandedTools.value)
  if (next.has(callId)) next.delete(callId)
  else next.add(callId)
  expandedTools.value = next
}

function toggleThinking(idx: number): void {
  const next = new Set(expandedThinking.value)
  if (next.has(idx)) next.delete(idx)
  else next.add(idx)
  expandedThinking.value = next
}

function thinkingDurationLabel(idx: number, streaming: boolean): string {
  const timing = thinkingTimings.value.get(idx)
  if (!timing) return streaming ? t("chat.thinking") : t("chat.thought")
  const end = timing.end ?? Date.now()
  const secs = Math.max(1, Math.round((end - timing.start) / 1000))
  return streaming ? `${t("chat.thinking")} · ${secs}s` : `${t("chat.thoughtFor")} ${secs}s`
}
const showMentions = ref(false)
const mentionQuery = ref("")
const mentionPosition = ref({ top: 0, left: 0 })
const attachedMentions = ref<Mention[]>([])
const attachedFiles = ref<ChatAttachment[]>([])
const mentionsPopupRef = ref<InstanceType<typeof MentionsPopup> | null>(null)
const projectRoot = ref("")

const appliedBlocks = ref<Set<string>>(new Set())
const lastAppliedResult = ref<ApplyResult | null>(null)
const applyFilePathTarget = ref<{ msgIdx: number; blockIdx: number } | null>(null)
const manualFilePath = ref("")
const filepathInputRef = ref<HTMLInputElement | null>(null)
const applyToast = ref<{ visible: boolean; message: string; type: "success" | "error" }>({
  visible: false,
  message: "",
  type: "success",
})

function canApplyBlock(block: ContentBlock): boolean {
  return (
    block.type === "code" &&
    isApplicableCodeBlock({
      language: block.language || "",
      content: block.content,
      filepath: block.filepath,
    })
  )
}

type ChatMode = "ask" | "plan" | "agent" | "auto"
type AutoPermissionLevel = "all" | "safe" | null

const currentMode = ref<ChatMode>("plan")
const autoPermissionLevel = ref<AutoPermissionLevel>(null)
const showAutoPermissionDialog = ref(false)
const showDangerConfirmDialog = ref(false)
const showModeSwitchDialogVisible = ref(false)
const pendingSwitchMode = ref<ChatMode | null>(null)
const dangerOpDescription = ref("")
let dangerOpResolver: ((approved: boolean) => void) | null = null

const typeOptions = TYPE_OPTIONS
const activeType = computed<AiProviderType>(() => aiProviderState.activeType)
const activeModelName = computed(() => getActiveModel())
const currentModels = computed(() => {
  const type = aiProviderState.activeType
  const cached = aiProviderState.modelsByType[type] || []
  if (cached.length > 0) return cached
  // Fallback: show the model from provider config when remote list is empty
  const m = getActiveModel()
  return m ? [m] : []
})
const fetchingModels = computed(() => aiProviderState.fetchingType === aiProviderState.activeType)
const providerEnabled = computed(() => hasActiveProvider())

const lastAssistantIndex = computed(() => {
  const msgs = props.messages
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "assistant" && !msgs[i]._streaming && msgs[i].content) return i
  }
  return -1
})

const hasUnappliedBlocks = computed(() => {
  const msgs = props.messages
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    if (msg.role !== "assistant" || msg._streaming || !msg.content) continue
    const blocks = renderBlocks(String(msg.content))
    for (let j = 0; j < blocks.length; j++) {
      if (canApplyBlock(blocks[j]) && !isBlockApplied(i, j)) return true
    }
  }
  return false
})

function setComposerType(type: AiProviderType): void {
  setActiveType(type)
  void ensureModelsForActiveType()
}

function setComposerModel(model: string): void {
  setActiveModel(model)
}

async function ensureModelsForActiveType() {
  const t = aiProviderState.activeType
  const models = aiProviderState.modelsByType[t] || []
  if (models.length === 0 && providerEnabled.value) {
    await fetchModelsForType(t)
  }
}

void ensureModelsForActiveType()

watch(
  () => [aiProviderState.activeType, providerEnabled.value],
  () => {
    void ensureModelsForActiveType()
  },
)

async function copyMessage(msg: ChatMessage) {
  try {
    await navigator.clipboard.writeText(String(msg.content || ""))
  } catch {
    // clipboard not available
  }
  const idx = props.messages.indexOf(msg)
  copiedId.value = idx
  setTimeout(() => {
    if (copiedId.value === idx) copiedId.value = -1
  }, 1800)
}

async function send() {
  const text = inputText.value.trim()
  const hasMentions = attachedMentions.value.length > 0
  const hasAttachments = attachedFiles.value.length > 0
  if ((!text && !hasMentions && !hasAttachments) || props.loading) return

  const { cleanText, contextBlock, mentions } = await processMentions(inputText.value)
  const filesToSend = [...attachedFiles.value]
  const attachmentText = buildAttachmentContextBlock(
    filesToSend.filter((file) => file.kind !== "image"),
  )
  const rulesText = getAllRuleContext()
  const budgeted = enforceStructuredContextBudget({
    mentionsText: contextBlock,
    attachmentText,
    rulesText,
    workspaceText: "",
    userText: cleanText,
    evidence: buildContextEvidence({
      mentions,
      attachments: filesToSend,
      rules: getRuleFiles(),
      contextBlock,
    }),
  })
  const providerMessages = buildProviderMessages(
    aiProviderState.activeType,
    [budgeted.rulesText, budgeted.mentionsText, cleanText].filter(Boolean).join("\n"),
    filesToSend,
    { textAttachmentBlock: budgeted.attachmentText },
  )
  const evidenceWarnings = [
    ...(Array.isArray(budgeted.evidence?.warnings) ? budgeted.evidence.warnings : []),
    ...providerMessages.warnings,
  ].slice(0, 20)
  const contextEvidence = budgeted.evidence
    ? {
        ...budgeted.evidence,
        warnings: evidenceWarnings,
        budget: {
          ...budgeted.evidence.budget,
          warningCount: evidenceWarnings.length,
        },
      }
    : buildContextEvidence({
        mentions,
        attachments: filesToSend,
        rules: getRuleFiles(),
        contextBlock: budgeted.mentionsText,
        attachmentWarnings: providerMessages.warnings,
      })
  const contextBlocks = {
    rulesText: budgeted.rulesText || "",
    mentionsText: budgeted.mentionsText || "",
    attachmentText: budgeted.attachmentText || "",
    userText: cleanText,
  }
  const fullText =
    typeof providerMessages.messages[0]?.content === "string"
      ? providerMessages.messages[0].content
      : [
          contextBlocks.rulesText,
          contextBlocks.mentionsText,
          contextBlocks.attachmentText,
          cleanText,
        ]
          .filter(Boolean)
          .join("\n")

  inputText.value = ""
  attachedMentions.value = []
  attachedFiles.value = []
  mentionRegistry.mentions = []
  resizeInput()

  emit("send", fullText, mentions, {
    mode: currentMode.value,
    permissionLevel: autoPermissionLevel.value,
    attachments: filesToSend,
    providerMessages: providerMessages.messages,
    attachmentWarnings: providerMessages.warnings,
    contextEvidence,
    contextBlocks,
  })
}

function handleVoiceText(text: string): void {
  inputText.value = (inputText.value + " " + text).trim()
  nextTick(() => {
    const textarea = inputRef.value
    if (textarea) {
      textarea.focus()
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length
    }
    resizeInput()
  })
}

function handleInputChange(): void {
  const textarea = inputRef.value
  if (!textarea) return
  resizeInput()

  const cursorPos = textarea.selectionStart
  const textBeforeCursor = textarea.value.slice(0, cursorPos)

  const lastAtIndex = textBeforeCursor.lastIndexOf("@")
  if (lastAtIndex === -1) {
    closeMentions()
    return
  }

  const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1)
  if (textAfterAt.includes(" ")) {
    closeMentions()
    return
  }

  mentionQuery.value = textAfterAt
  showMentions.value = true
  updateMentionPosition(textarea, lastAtIndex)
}

function resizeInput(): void {
  const textarea = inputRef.value
  if (!textarea) return
  textarea.style.height = "auto"
  const maxHeight = Math.max(72, Math.min(220, Math.floor(window.innerHeight * 0.32)))
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden"
}

function updateMentionPosition(textarea: HTMLTextAreaElement, atIndex: number): void {
  const rect = textarea.getBoundingClientRect()
  const computedStyle = getComputedStyle(textarea)
  const lineHeight = parseFloat(computedStyle.lineHeight) || 18
  const paddingTop = parseFloat(computedStyle.paddingTop) || 8
  const paddingLeft = parseFloat(computedStyle.paddingLeft) || 10

  const textBeforeAt = textarea.value.slice(0, atIndex)
  const lines = textBeforeAt.split("\n")
  const currentLineIndex = lines.length - 1
  const lastLineText = lines[currentLineIndex] || ""

  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  const approxCharWidth = ctx ? ctx.measureText("a").width * 0.6 : 8
  const charWidth = ctx
    ? ctx.measureText(lastLineText).width
    : lastLineText.length * approxCharWidth

  mentionPosition.value = {
    top: rect.top + paddingTop + currentLineIndex * lineHeight + lineHeight + 4,
    left: rect.left + paddingLeft + charWidth,
  }
}

function handleInputKeydown(e: KeyboardEvent): void {
  if (!showMentions.value) return
  if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) {
    mentionsPopupRef.value?.handleKeydown(e)
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault()
    }
  }
}

function handleMentionSelect(mention: Mention): void {
  const textarea = inputRef.value
  if (!textarea) return

  const cursorPos = textarea.selectionStart
  const textBeforeCursor = textarea.value.slice(0, cursorPos)
  const lastAtIndex = textBeforeCursor.lastIndexOf("@")
  const textAfterCursor = textarea.value.slice(cursorPos)

  inputText.value = textarea.value.slice(0, lastAtIndex) + textAfterCursor
  attachedMentions.value = [...attachedMentions.value, mention]
  mentionRegistry.mentions.push(mention)
  closeMentions()
  nextTick(() => {
    const newPos = lastAtIndex + 1
    textarea.setSelectionRange(newPos, newPos)
    textarea.focus()
  })
}

function closeMentions(): void {
  showMentions.value = false
  mentionQuery.value = ""
}

function removeMention(index: number): void {
  attachedMentions.value = attachedMentions.value.filter((_, i) => i !== index)
  mentionRegistry.mentions.splice(index, 1)
}

function handleAttachments(files: ChatAttachment[]): void {
  attachedFiles.value = [...attachedFiles.value, ...files]
  nextTick(() => {
    inputRef.value?.focus()
    resizeInput()
  })
}

function removeAttachment(index: number): void {
  attachedFiles.value = attachedFiles.value.filter((_, i) => i !== index)
  nextTick(resizeInput)
}

function msgIndex(msg: ChatMessage): number {
  return props.messages.indexOf(msg)
}

function isBlockApplied(msgIdx: number, blockIdx: number): boolean {
  return appliedBlocks.value.has(`${msgIdx}-${blockIdx}`)
}

function markBlockApplied(msgIdx: number, blockIdx: number): void {
  appliedBlocks.value = new Set([...appliedBlocks.value, `${msgIdx}-${blockIdx}`])
}

function showApplyToast(message: string, type: "success" | "error"): void {
  applyToast.value = { visible: true, message, type }
  setTimeout(() => {
    applyToast.value = { visible: false, message: "", type: "success" }
  }, 2400)
}

async function handleApplyCode(
  msgIdx: number,
  blockIdx: number,
  block: ContentBlock,
): Promise<void> {
  const codeBlock: CodeBlock = {
    language: block.language || "",
    content: block.content,
    filepath: block.filepath,
  }
  const parsed = parseCodeBlocks("```" + codeBlock.language + "\n" + codeBlock.content + "\n```")

  let targetBlock: CodeBlock = parsed[0] || codeBlock
  if (codeBlock.filepath) {
    targetBlock = { ...targetBlock, filepath: codeBlock.filepath }
  }

  if (!targetBlock.filepath) {
    const hint = getFilepathHintForBlock(codeBlock, {
      openFiles: props.openFiles,
    })
    if (hint) {
      targetBlock = { ...targetBlock, filepath: hint }
    }
  }

  if (!targetBlock.filepath) {
    applyFilePathTarget.value = { msgIdx, blockIdx }
    manualFilePath.value = ""
    await nextTick()
    filepathInputRef.value?.focus()
    return
  }

  await executeApply(targetBlock, msgIdx, blockIdx)
}

async function confirmApplyWithPath(
  msgIdx: number,
  blockIdx: number,
  block: ContentBlock,
): Promise<void> {
  const path = manualFilePath.value.trim()
  if (!path) return

  const targetBlock: CodeBlock = {
    language: block.language || "",
    content: block.content,
    filepath: path,
  }

  applyFilePathTarget.value = null
  manualFilePath.value = ""
  await executeApply(targetBlock, msgIdx, blockIdx)
}

function cancelFilePathInput(): void {
  applyFilePathTarget.value = null
  manualFilePath.value = ""
}

async function executeApply(
  block: { language: string; content: string; filepath?: string },
  msgIdx: number,
  blockIdx: number,
): Promise<void> {
  const result = await applyCodeBlock(block, "")
  lastAppliedResult.value = result

  if (result.success) {
    markBlockApplied(msgIdx, blockIdx)
    showApplyToast(t("diffApply.applySuccess"), "success")
  } else {
    showApplyToast(result.error || t("diffApply.applyFailed"), "error")
  }
}

async function handleUndoLastApply(): Promise<void> {
  if (!lastAppliedResult.value) return

  const result = lastAppliedResult.value
  const reverted = await undoApply(result)

  if (reverted) {
    lastAppliedResult.value = null

    const keys = [...appliedBlocks.value]
    const lastKey = keys[keys.length - 1]
    if (lastKey) {
      appliedBlocks.value = new Set(keys.slice(0, -1))
    }

    showApplyToast(t("diffApply.undoSuccess"), "success")
  }
}

async function handleApplyAll(): Promise<void> {
  const msgs = props.messages
  let applied = 0
  let failed = 0

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    if (msg.role !== "assistant" || msg._streaming || !msg.content) continue

    const blocks = renderBlocks(String(msg.content))
    for (let j = 0; j < blocks.length; j++) {
      if (blocks[j].type !== "code") continue
      if (isBlockApplied(i, j)) continue
      if (!canApplyBlock(blocks[j])) continue

      const block = blocks[j]
      const codeBlock = {
        language: block.language || "",
        content: block.content,
        filepath: block.filepath,
      }

      const parsed = parseCodeBlocks(
        "```" + codeBlock.language + "\n" + codeBlock.content + "\n```",
      )
      let targetBlock: CodeBlock = parsed[0] || codeBlock
      if (codeBlock.filepath) {
        targetBlock = { ...targetBlock, filepath: codeBlock.filepath }
      }
      if (!targetBlock.filepath) {
        const hint = getFilepathHintForBlock(targetBlock, { openFiles: props.openFiles })
        if (!hint) continue
        targetBlock = { ...targetBlock, filepath: hint }
      }

      const result = await applyCodeBlock(targetBlock, "")
      lastAppliedResult.value = result

      if (result.success) {
        markBlockApplied(i, j)
        applied += 1
      } else {
        failed += 1
      }
    }
  }

  showApplyToast(
    `${t("diffApply.applySuccess")}: ${applied}${failed > 0 ? `, ${t("diffApply.applyFailed")}: ${failed}` : ""}`,
    failed > 0 ? "error" : "success",
  )
}

interface ContentBlock {
  type: "text" | "code"
  content: string
  language?: string
  filepath?: string
}

interface ThinkingPart {
  thinking: string
  visible: string
  streaming: boolean
}

const THINK_TAG_RE = /<(think|thinking)>([\s\S]*?)<\/\1>/gi
const OPEN_THINK_RE = /<(think|thinking)>([\s\S]*)$/i

function splitThinking(text: string): ThinkingPart {
  if (!text) return { thinking: "", visible: "", streaming: false }
  const thinkings: string[] = []
  let visible = text.replace(THINK_TAG_RE, (_m, _tag, body) => {
    thinkings.push(String(body || "").trim())
    return ""
  })
  let streaming = false
  const openMatch = visible.match(OPEN_THINK_RE)
  if (openMatch) {
    thinkings.push(String(openMatch[2] || "").trim())
    visible = visible.slice(0, openMatch.index ?? 0)
    streaming = true
  }
  return {
    thinking: thinkings.join("\n\n").trim(),
    visible: visible.trim(),
    streaming,
  }
}

function renderBlocks(text: string): ContentBlock[] {
  if (!text) return []

  const blocks: ContentBlock[] = []
  const codeBlockRe = /```([^\n`]*)\n([\s\S]*?)```/g
  let lastIndex = 0
  let match

  while ((match = codeBlockRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({ type: "text", content: text.slice(lastIndex, match.index) })
    }

    const info = String(match[1] || "").trim()
    const parsed = parseCodeBlocks("```" + info + "\n" + match[2] + "\n```")
    const parsedBlock = parsed[0]
    blocks.push({
      type: "code",
      language: parsedBlock?.language || info,
      content: match[2],
      filepath: parsedBlock?.filepath,
    })

    lastIndex = codeBlockRe.lastIndex
  }

  if (lastIndex < text.length) {
    blocks.push({ type: "text", content: text.slice(lastIndex) })
  }

  return blocks
}

// Rich parts rendering for the new agent loop.

type RenderItem =
  | { kind: "thinking"; text: string; streaming: boolean; partIndex: number }
  | { kind: "plan"; plan: any }
  | { kind: "block"; block: ContentBlock; globalBlockIdx: number }
  | { kind: "tool"; call: ToolCallPart; result?: ToolResultPart }
  | { kind: "orchestrator_task"; task: OrchestratorTaskPart }

function hasParts(msg: ChatMessage): boolean {
  return !!(msg.parts && msg.parts.length > 0)
}

function partsHaveText(msg: ChatMessage): boolean {
  return !!msg.parts?.some((p) => p.type === "text" && p.text.length > 0)
}

function getRenderItems(msg: ChatMessage): RenderItem[] {
  const items: RenderItem[] = []
  if (!msg.parts) return items

  const resultByCallId = new Map<string, ToolResultPart>()
  for (const p of msg.parts) {
    if (p.type === "tool_result") resultByCallId.set(p.callId, p)
  }

  let blockCounter = 0
  let pi = 0
  for (const p of msg.parts) {
    if (p.type === "plan") {
      items.push({ kind: "plan", plan: (p as any).plan })
    } else if (p.type === "orchestrator_task") {
      items.push({ kind: "orchestrator_task", task: p as OrchestratorTaskPart })
    } else if (p.type === "thinking") {
      items.push({ kind: "thinking", text: p.text, streaming: !!p.streaming, partIndex: pi })
    } else if (p.type === "text" && p.text) {
      for (const block of renderBlocks(p.text)) {
        items.push({ kind: "block", block, globalBlockIdx: blockCounter })
        blockCounter++
      }
    } else if (p.type === "tool_call") {
      const result = resultByCallId.get(p.id)
      items.push({ kind: "tool", call: p, result })
    }
    pi++
  }
  return items
}

function partsThinkingKey(messageIndex: number, partIndex: number): number {
  // Encode (messageIndex, partIndex) into a single number for the legacy
  // expandedThinking Set<number>. Assumes <1000 parts per message.
  return messageIndex * 1000 + partIndex
}

function formatOrchestratorMode(mode: string): string {
  if (mode === "auto") return "自主"
  if (mode === "agent") return "执行"
  if (mode === "plan") return "规划"
  if (mode === "ask") return "问答"
  return mode || "执行"
}

function formatOrchestratorStrategy(strategy: string): string {
  if (strategy === "multi-agent") return "多智能体协作"
  if (strategy === "single-agent") return "单智能体执行"
  return strategy || "自动路由"
}

function formatOrchestratorStatus(status: string): string {
  const value = String(status || "").toLowerCase()
  if (value === "waiting_user") return "等待确认"
  if (value === "running") return "执行中"
  if (value === "completed") return "已完成"
  if (value === "failed") return "失败"
  if (value === "cancelled") return "已取消"
  if (value === "created" || value === "pending") return "已创建"
  return status || "已创建"
}

function formatOrchestratorStatusClass(status: string): string {
  const value = String(status || "").toLowerCase()
  if (value === "failed" || value === "cancelled") return "danger"
  if (value === "waiting_user") return "waiting"
  if (value === "completed") return "done"
  return "active"
}

function shortId(id: string): string {
  const value = String(id || "")
  if (value.length <= 12) return value || "-"
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function toolIcon(name: string): string {
  const icons: Record<string, string> = {
    read_file: "RF",
    write_file: "WF",
    edit_file: "EF",
    patch_file: "PF",
    read_dir: "RD",
    search_code: "SC",
    get_code_context: "CX",
    run_command: "RC",
  }
  return icons[name] || "TL"
}

function toolStatus(status: string): string {
  return t(`toolStatus.${status}`) || status
}

function formatResult(result: unknown): string {
  if (!result) return ""
  const value = typeof result === "string" ? result : JSON.stringify(result, null, 2)
  return value.slice(0, 1500)
}

function formatResultHtml(result: unknown): string | null {
  if (typeof result !== "string" || !hasAnsi(result)) return null
  return ansiToHtml(result.slice(0, 4000))
}

function switchMode(mode: ChatMode): void {
  if (mode === "auto") {
    handleAutoModeClick()
    return
  }
  currentMode.value = mode
  autoPermissionLevel.value = null
  emit("modeChange", mode, null)
}

function handleAutoModeClick(): void {
  if (currentMode.value === "auto") return
  showAutoPermissionDialog.value = true
}

function confirmAutoMode(level: "all" | "safe"): void {
  currentMode.value = "auto"
  autoPermissionLevel.value = level
  showAutoPermissionDialog.value = false
  emit("modeChange", "auto", level)
}

function cancelAutoDialog(): void {
  showAutoPermissionDialog.value = false
}

function requestDangerConfirm(description: string): Promise<boolean> {
  return new Promise((resolve) => {
    dangerOpDescription.value = description
    dangerOpResolver = resolve
    showDangerConfirmDialog.value = true
  })
}

function approveDangerOp(): void {
  showDangerConfirmDialog.value = false
  dangerOpResolver?.(true)
  dangerOpResolver = null
}

function rejectDangerOp(): void {
  showDangerConfirmDialog.value = false
  dangerOpResolver?.(false)
  dangerOpResolver = null
}

function appendCodeContext(code, filePath) {
  const lang = filePath ? filePath.split(".").pop() : ""
  const header = filePath ? `From \`${filePath}\`:\n` : ""
  const block = `${header}\`\`\`${lang}\n${code}\n\`\`\`\n`
  inputText.value = inputText.value ? `${inputText.value}\n${block}` : block
  nextTick(() => {
    inputRef.value?.focus()
    resizeInput()
  })
}

function appendPrompt(text) {
  if (!text) return
  inputText.value = inputText.value ? `${inputText.value}\n${text}` : text
  nextTick(() => {
    inputRef.value?.focus()
    resizeInput()
  })
}

function attachFiles(files: ChatAttachment[]) {
  if (!Array.isArray(files) || files.length === 0) return
  handleAttachments(files)
}

function requestModeSwitch(targetMode) {
  pendingSwitchMode.value = targetMode
  showModeSwitchDialogVisible.value = true
}

function cancelModeSwitch() {
  showModeSwitchDialogVisible.value = false
  pendingSwitchMode.value = null
}

function confirmModeSwitch() {
  const target = pendingSwitchMode.value
  showModeSwitchDialogVisible.value = false
  pendingSwitchMode.value = null
  if (target) switchMode(target)
}
defineExpose({
  currentMode,
  autoPermissionLevel,
  requestDangerConfirm,
  appendCodeContext,
  appendPrompt,
  attachFiles,
  requestModeSwitch,
})

onMounted(() => {
  resizeInput()
})

watch(
  () => props.messages.length,
  () =>
    nextTick(() => {
      if (messagesRef.value) {
        messagesRef.value.scrollTop = messagesRef.value.scrollHeight
      }
    }),
)

watch(inputText, () => nextTick(resizeInput))

watch(
  () =>
    props.messages
      .map((m) => `${m.role}|${m._streaming ? 1 : 0}|${(m.content || "").length}`)
      .join(),
  () => {
    const map = thinkingTimings.value
    let changed = false
    props.messages.forEach((msg, idx) => {
      if (msg.role !== "assistant") return
      const part = splitThinking(String(msg.content ?? ""))
      if (!part.thinking) return
      let timing = map.get(idx)
      if (!timing) {
        timing = { start: Date.now(), end: null }
        map.set(idx, timing)
        changed = true
      }
      if (!part.streaming && timing.end === null) {
        timing.end = Date.now()
        changed = true
      }
    })
    if (changed) thinkingTimings.value = new Map(map)
  },
  { immediate: true },
)
</script>

<style scoped>
.chat-panel {
  position: relative;
  width: 0;
  overflow: hidden;
  background: var(--bg-panel);
  border-left: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

/* .chat-panel.open and :not(.open) defined in the Cursor-style overrides below */

.resize-handle {
  position: absolute;
  top: 0;
  left: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 20;
}

.resize-handle:hover,
.resize-handle:active {
  background: var(--accent);
  opacity: 0.4;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 14px;
  height: 36px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.chat-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.chat-header-actions {
  display: flex;
  gap: 2px;
}

.chat-btn-icon {
  width: 26px;
  height: 26px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-btn-icon:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.provider-bar {
  display: flex;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.provider-select,
.model-select {
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 11px;
  padding: 4px 6px;
  outline: none;
  cursor: pointer;
}

.provider-select {
  flex: 2;
  min-width: 0;
}

.model-select {
  flex: 3;
  min-width: 0;
}

.provider-select:focus,
.model-select:focus {
  border-color: var(--accent);
}

.session-strip {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  gap: 6px;
  overflow-x: auto;
  flex-shrink: 0;
}

.session-strip::-webkit-scrollbar {
  height: 0;
}

.session-pill-wrap {
  display: flex;
  align-items: center;
  gap: 0;
  border: 1px solid var(--border);
  background: var(--bg-dark);
  border-radius: 999px;
  white-space: nowrap;
  flex-shrink: 0;
}

.session-pill-wrap.active {
  border-color: rgba(45, 212, 191, 0.35);
  background: rgba(45, 212, 191, 0.08);
}

.session-pill {
  border: none;
  background: none;
  color: var(--text-secondary);
  padding: 4px 8px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  border-radius: 999px 0 0 999px;
}

.session-pill-wrap.active .session-pill {
  color: var(--text-primary);
}

.session-delete {
  border: none;
  background: none;
  color: var(--text-muted);
  padding: 4px 6px;
  cursor: pointer;
  border-radius: 0 999px 999px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
}

.session-pill-wrap:hover .session-delete {
  opacity: 1;
}

.session-delete:hover {
  color: var(--red);
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chat-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  opacity: 0.8;
  text-align: center;
}

.welcome-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.welcome-hint {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}

.message {
  display: flex;
  gap: 8px;
}

.msg-avatar {
  width: 24px;
  height: 24px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 2px;
}

.message.user .msg-avatar {
  background: var(--accent);
  color: #0d0e10;
}

.message.assistant .msg-avatar {
  background: var(--bg-elevated);
  color: var(--accent);
}

.msg-body {
  flex: 1;
  min-width: 0;
}

.msg-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
}

.msg-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.msg-content :deep(pre) {
  background: var(--bg-deepest);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  overflow-x: auto;
  font-size: 12px;
  margin: 6px 0;
}

.msg-content :deep(code) {
  background: var(--bg-elevated);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
  color: #f472b6;
}

.msg-content :deep(pre code) {
  background: none;
  padding: 0;
  color: var(--text-primary);
}

.code-block-wrap {
  position: relative;
  margin: 6px 0;
}

.code-block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
}

.code-lang-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.code-block-wrap pre {
  margin-top: 0 !important;
  border-radius: 0 0 6px 6px !important;
}

.apply-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--accent-dim);
  border: 1px solid var(--accent);
  border-radius: 4px;
  color: var(--accent);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
  transition: background 0.15s;
  height: 22px;
}

.apply-btn:hover {
  background: rgba(45, 212, 191, 0.25);
}

.applied-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(52, 211, 153, 0.12);
  border: 1px solid var(--green);
  border-radius: 4px;
  color: var(--green);
  font-size: 11px;
  padding: 2px 8px;
  height: 22px;
}

.filepath-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  padding: 6px 8px;
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.filepath-input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 12px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  outline: none;
}

.filepath-input::placeholder {
  color: var(--text-muted);
}

.filepath-confirm-btn {
  width: 24px;
  height: 24px;
  background: var(--accent);
  border: none;
  border-radius: 4px;
  color: #0d0e10;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.filepath-confirm-btn:hover {
  background: #5eead4;
}

.apply-toast {
  position: absolute;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  z-index: 10;
  pointer-events: none;
  animation: toast-in 0.25s ease;
}

.apply-toast.success {
  background: rgba(52, 211, 153, 0.15);
  border: 1px solid var(--green);
  color: var(--green);
}

.apply-toast.error {
  background: rgba(248, 113, 113, 0.15);
  border: 1px solid var(--red);
  color: var(--red);
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

.tool-card {
  background: var(--bg-deepest);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  margin-top: 6px;
  font-size: 12px;
}

.thinking-block {
  margin: 2px 0 6px;
  user-select: none;
}

.thinking-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  padding: 2px 4px;
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  border-radius: 4px;
  transition:
    color 0.12s,
    background 0.12s;
}

.thinking-toggle:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.thinking-chevron {
  transition: transform 0.15s ease;
  opacity: 0.7;
}

.thinking-chevron.open {
  transform: rotate(90deg);
}

.thinking-label {
  letter-spacing: 0.1px;
}

.thinking-meta {
  font-size: 10px;
  opacity: 0.55;
  margin-left: 2px;
}

.thinking-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.85;
  animation: thinking-pulse 1.2s ease-in-out infinite;
  margin-left: 2px;
}

@keyframes thinking-pulse {
  0%,
  100% {
    opacity: 0.25;
    transform: scale(0.85);
  }
  50% {
    opacity: 0.95;
    transform: scale(1.1);
  }
}

.thinking-content {
  margin-top: 6px;
  padding: 8px 12px;
  border-left: 2px solid var(--border);
  color: var(--text-muted);
  font-size: 12.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  background: transparent;
}

.tool-card.running {
  border-color: var(--orange);
}

.tool-card.done {
  border-color: var(--green);
}

.orchestrator-task-card {
  margin-top: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-1, rgba(255, 255, 255, 0.02));
  min-width: 0;
}

.orchestrator-task-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.orchestrator-task-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.orchestrator-task-subtitle {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-muted);
}

.orchestrator-task-status {
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--surface-3, rgba(255, 255, 255, 0.08));
}

.orchestrator-task-status.active {
  color: var(--accent);
}

.orchestrator-task-status.waiting {
  color: var(--orange);
}

.orchestrator-task-status.done {
  color: var(--green);
}

.orchestrator-task-status.danger {
  color: var(--red);
}

.orchestrator-task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  color: var(--text-muted);
  font-size: 11px;
}

.orchestrator-task-meta span {
  min-width: 0;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--surface-2, rgba(255, 255, 255, 0.04));
  overflow: hidden;
  text-overflow: ellipsis;
}

.orchestrator-task-reason {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}

.orchestrator-task-next {
  margin-top: 8px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
  word-break: break-word;
}

.tool-card.error {
  border-color: var(--red);
}

.tool-name {
  font-weight: 600;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.tool-icon {
  font-size: 10px;
  color: var(--text-muted);
}

.tool-status {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
}

.tool-result pre {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-muted);
  max-height: 180px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.tool-card-v2 {
  margin-top: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-1, rgba(255, 255, 255, 0.02));
  overflow: hidden;
  transition: border-color 150ms ease;
}

.tool-card-v2.running {
  border-color: var(--accent);
}

.tool-card-v2.error {
  border-color: var(--danger, #e06262);
}

.tool-card-v2.done {
  border-color: var(--border);
}

.tool-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

.tool-card-header:hover {
  background: var(--surface-2, rgba(255, 255, 255, 0.04));
}

.tool-card-chevron {
  transition: transform 150ms ease;
  flex-shrink: 0;
  color: var(--text-muted);
}

.tool-card-chevron.open {
  transform: rotate(90deg);
}

.tool-card-icon {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--surface-3, rgba(255, 255, 255, 0.08));
  color: var(--text-muted);
  flex-shrink: 0;
}

.tool-card-name {
  font-weight: 500;
  flex-shrink: 0;
}

.tool-card-preview {
  color: var(--text-muted);
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 1 auto;
  min-width: 0;
}

.tool-card-status {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.tool-card-status.done svg {
  color: var(--success, #5fbf6f);
}

.tool-card-status.error svg {
  color: var(--danger, #e06262);
}

.tool-spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: tool-spin 0.7s linear infinite;
}

@keyframes tool-spin {
  to {
    transform: rotate(360deg);
  }
}

.tool-card-body {
  border-top: 1px solid var(--border);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-card-section-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin-bottom: 2px;
}

.tool-card-input pre,
.tool-card-output pre {
  margin: 0;
  font-size: 11px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  color: var(--text);
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--surface-2, rgba(0, 0, 0, 0.2));
  padding: 6px 8px;
  border-radius: 4px;
}

.tool-card-output.error pre {
  color: var(--danger, #e06262);
}

.thinking-dots {
  font-size: 20px;
  color: var(--text-muted);
  letter-spacing: 2px;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 1;
  }
}

.chat-input-area {
  padding: 10px 14px;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.chat-input-wrapper {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mention-chips-row,
.msg-mentions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.mention-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-primary);
  user-select: none;
}

.mention-chip-file {
  border-color: rgba(45, 212, 191, 0.35);
  background: rgba(45, 212, 191, 0.08);
}

.mention-chip-folder {
  border-color: rgba(251, 146, 60, 0.35);
  background: rgba(251, 146, 60, 0.08);
}

.mention-chip-code {
  border-color: rgba(96, 165, 250, 0.35);
  background: rgba(96, 165, 250, 0.08);
}

.mention-chip-git {
  border-color: rgba(248, 113, 113, 0.35);
  background: rgba(248, 113, 113, 0.08);
}

.mention-chip-web {
  border-color: rgba(167, 139, 250, 0.35);
  background: rgba(167, 139, 250, 0.08);
}

.mention-chip-notepad {
  border-color: rgba(251, 191, 36, 0.35);
  background: rgba(251, 191, 36, 0.08);
}

.mention-chip-icon {
  font-size: 12px;
  line-height: 1;
}

.mention-chip-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}

.mention-chip-remove {
  width: 14px;
  height: 14px;
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  margin-left: 2px;
}

.mention-chip-remove:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.msg-mentions-row {
  margin-bottom: 6px;
}

.chat-input-area textarea {
  flex: 1;
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  color: var(--text-primary);
  font-size: 13px;
  resize: none;
  outline: none;
  font-family: inherit;
  line-height: 1.5;
}

.chat-input-area textarea:focus {
  border-color: var(--accent);
}

.chat-input-area textarea:disabled {
  opacity: 0.3;
}

.chat-send-btn {
  width: 36px;
  height: 36px;
  background: var(--accent);
  border: none;
  border-radius: 8px;
  color: #0d0e10;
  cursor: pointer;
  align-self: flex-end;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-send-btn:hover:not(:disabled) {
  background: #5eead4;
}

.chat-send-btn:disabled {
  background: var(--bg-hover);
  color: var(--text-muted);
  cursor: not-allowed;
}

.msg-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}

.msg-action-btn {
  width: 24px;
  height: 24px;
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.msg-action-btn:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--border-bright);
}

.msg-action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.copied-toast {
  font-size: 10px;
  color: var(--accent);
  margin-left: 2px;
}

/* Auto Permission Dialog */
.auto-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(4px);
}

.auto-dialog {
  width: 420px;
  background: var(--bg-panel);
  border: 1px solid var(--border-bright);
  border-radius: 14px;
  padding: 24px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.auto-dialog.danger-confirm {
  width: 380px;
  border-color: var(--red);
}

.auto-dialog-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.auto-dialog-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-bright);
}

.auto-dialog-desc {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
  margin-bottom: 20px;
}

.danger-desc {
  color: var(--red);
  background: rgba(248, 113, 113, 0.08);
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(248, 113, 113, 0.2);
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 12px;
}

.auto-dialog-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.auto-option {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-dark);
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.auto-option:hover {
  border-color: var(--border-bright);
  background: var(--bg-hover);
}

.auto-option.recommended {
  border-color: rgba(45, 212, 191, 0.3);
}

.auto-option.recommended:hover {
  border-color: var(--accent);
  background: var(--accent-dim);
}

.auto-option-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.auto-option-icon.warn {
  background: rgba(251, 146, 60, 0.15);
  color: var(--orange);
}

.auto-option-icon.safe {
  background: rgba(45, 212, 191, 0.15);
  color: var(--accent);
}

.auto-option-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.auto-option-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-bright);
}

.recommended-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--accent);
  color: #0d0e10;
  margin-left: 6px;
  letter-spacing: 0.3px;
}

.auto-option-desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.auto-dialog-cancel {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.auto-dialog-cancel:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.auto-dialog-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.danger-reject-btn,
.danger-approve-btn {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.danger-reject-btn {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.danger-reject-btn:hover {
  background: var(--bg-active);
}

.danger-approve-btn {
  background: var(--red);
  color: white;
}

.danger-approve-btn:hover {
  background: #ef4444;
}

/* ===== Cursor-style overrides ===== */
.chat-panel.open {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  min-width: min(480px, calc(100vw - 72px));
  z-index: 30;
  box-shadow: -8px 0 24px -12px rgba(0, 0, 0, 0.5);
  background: var(--bg-panel);
}

.chat-panel:not(.open) {
  width: 0 !important;
  border-left: none;
  box-shadow: none;
}

.chat-header {
  height: 34px;
  padding: 0 10px;
  border-bottom: none;
}

.chat-title-row {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.chat-title-row svg {
  display: none;
}

.session-strip {
  padding: 4px 10px 8px;
  border-bottom: none;
}

.session-pill-wrap {
  border-color: transparent;
  background: transparent;
  border-radius: 6px;
}

.session-pill {
  padding: 3px 8px;
  border-radius: 6px 0 0 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.session-pill-wrap:hover {
  background: var(--bg-hover);
}

.session-pill-wrap.active {
  background: var(--bg-active);
  border-color: transparent;
}

.session-pill-wrap.active .session-pill {
  color: var(--text-bright);
}

.chat-messages {
  padding: 8px 14px 12px;
  gap: 14px;
}

.message {
  gap: 0;
  flex-direction: column;
}

.msg-avatar {
  display: none;
}

.message::before {
  content: attr(data-role);
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 4px;
}

.message.user::before {
  content: "You";
}
.message.assistant::before {
  content: "Assistant";
}

.message.user .msg-body {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 8px 12px;
}

.message.assistant .msg-body {
  background: transparent;
  padding: 0;
}

.msg-content {
  font-size: 13px;
  line-height: 1.65;
}

/* Composer */
.chat-input-area {
  padding: 8px 12px 12px;
  border-top: none;
  gap: 0;
}

.chat-input-wrapper {
  gap: 6px;
  min-width: 0;
}

.composer-left-tools-inner,
.composer-model-tools {
  min-width: 0;
  display: flex;
  align-items: center;
}

.composer-left-tools-inner {
  flex: 0 0 auto;
  gap: 5px;
}

.composer-model-tools {
  flex: 1 1 auto;
}

.chat-input-area textarea {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 3px 2px;
  font-size: 13px;
  min-height: 28px;
  max-height: 160px;
  width: 100%;
  overflow-y: hidden;
}

.chat-input-area textarea:focus {
  border-color: transparent;
  outline: none;
}

.chat-send-btn {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  flex: 0 0 32px;
  align-self: center;
}

:deep(.voice-btn) {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
}

@container (max-width: 470px) {
  .composer-left-tools-inner,
  .composer-model-tools {
    min-width: 0;
  }

  .composer-model-tools {
    flex: 1 1 180px;
  }
}

:deep(.voice-btn:hover:not(:disabled)) {
  background: rgba(148, 163, 184, 0.08);
}

.chat-stop-btn {
  background: var(--red, #f87171);
  color: #fff;
  animation: stop-pulse 1.4s ease-in-out infinite;
}

.chat-stop-btn:hover {
  background: #ef4444;
}

@keyframes stop-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(248, 113, 113, 0.5);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(248, 113, 113, 0);
  }
}
</style>
