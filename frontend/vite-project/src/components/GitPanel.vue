<template>
  <div v-if="visible" class="git-panel">
    <div v-if="gitState.loading.value && !gitState.status.value" class="git-loading">
      <span class="spinner"></span>
      <span class="loading-text">正在加载 Git 状态...</span>
    </div>

    <template v-else-if="!gitState.hasRepo.value">
      <div class="git-empty">
        <svg class="empty-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
        <div class="empty-title">
          {{ gitRuntimeSettings.enabled ? "当前目录不是 Git 仓库" : "Git 已在设置中关闭" }}
        </div>
        <div class="empty-hint">
          {{ gitRuntimeSettings.enabled ? "使用 git init 或在项目根目录打开仓库" : "在源代码管理设置中开启 git.enabled 后恢复 Git 面板" }}
        </div>
      </div>
    </template>

    <template v-else>
      <div class="git-header">
        <div class="header-top">
          <div class="repo-info">
            <svg class="repo-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
            </svg>
            <span class="repo-name">{{ activeScmProvider?.label || activeGitStatus?.repoName || "仓库" }}</span>
          </div>
          <div class="header-actions">
            <button class="header-btn" title="刷新" @click="handleRefresh">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" :class="{ spinning: gitState.loading.value }">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
            <button class="header-btn" title="拉取远端状态" @click="handleRefresh">获取</button>
            <button class="header-btn" title="拉取" @click="handlePull">拉取</button>
            <button class="header-btn" title="推送" @click="handlePush">推送</button>
          </div>
        </div>
        <div class="header-bottom">
          <div v-if="repositoryOptions.length > 1" class="repo-selector-wrap">
            <select
              class="repo-selector"
              v-model="selectedRepoRoot"
              title="选择仓库"
            >
              <option v-for="repo in repositoryOptions" :key="repo.rootUri || repo.repoName" :value="repo.rootUri">
                {{ repo.repoName || repo.rootUri }}
              </option>
            </select>
          </div>
          <div class="branch-selector-wrap">
            <svg class="branch-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <select
              class="branch-selector"
              :value="gitState.currentBranch.value"
              @change="handleBranchChange(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="branch in gitState.branches.value" :key="branch.name" :value="branch.name">
                {{ branch.name }}{{ branch.current ? ' (当前)' : '' }}
              </option>
            </select>
          </div>
          <div v-if="activeGitStatus" class="sync-info">
            <span v-if="activeAhead > 0" class="sync-badge ahead">{{ activeAhead }} ↑</span>
            <span v-if="activeBehind > 0" class="sync-badge behind">{{ activeBehind }} ↓</span>
          </div>
        </div>
      </div>

      <div v-if="gitState.error.value" class="git-error">
        <span class="error-text">{{ gitState.error.value }}</span>
        <button class="error-dismiss" @click="gitState.clearError()">✕</button>
      </div>

      <div class="git-body">
        <section class="git-section">
          <button
            class="section-header"
            @click="toggleSection('changes')"
          >
            <span class="chevron" :class="{ open: sectionsOpen.has('changes') }">&#x25B6;</span>
            <span class="section-label">更改</span>
            <span class="section-count">{{ unstagedCount }}</span>
            <button
              v-if="unstagedCount > 0"
              class="stage-all-btn"
              title="暂存所有更改"
              @click.stop="gitState.stageAll(activeRepoRoot)"
            >
              + 全部暂存
            </button>
          </button>

          <div v-if="sectionsOpen.has('changes')">
            <div v-if="unstagedCount === 0" class="section-empty">没有未暂存的更改</div>
            <div
              v-for="file in unstagedFiles"
              :key="file.path"
              class="file-item"
            >
              <div class="file-row" @click="toggleFileDiff(file.path)">
                <span class="file-status" :class="statusClass(file.status)">{{ file.status }}</span>
                <span class="file-name">{{ file.path }}</span>
                <button
                  class="file-action"
                  title="暂存更改"
                  @click.stop="gitState.stageFile(file.path, activeRepoRoot)"
                >
                  +
                </button>
                <button
                  class="file-action danger"
                  title="丢弃更改"
                  @click.stop="handleDiscardFile(file.path, file.status === '??')"
                >
                  ×
                </button>
              </div>

              <div v-if="openDiffs.has(file.path)" class="file-diff-wrap">
                <div v-if="diffLoading.has(file.path)" class="diff-loading">加载差异中...</div>
                <pre v-else-if="fileDiffs[file.path]" class="diff-content"><code v-html="renderDiff(fileDiffs[file.path])"></code></pre>
                <div v-else class="diff-empty">无法获取差异</div>
              </div>
            </div>
          </div>
        </section>

        <section class="git-section">
          <button
            class="section-header"
            @click="toggleSection('staged')"
          >
            <span class="chevron" :class="{ open: sectionsOpen.has('staged') }">&#x25B6;</span>
            <span class="section-label">暂存的更改</span>
            <span class="section-count">{{ stagedCount }}</span>
          </button>

          <div v-if="sectionsOpen.has('staged')">
            <div v-if="stagedCount === 0" class="section-empty">没有暂存的更改</div>
            <div
              v-for="file in stagedFiles"
              :key="file.path"
              class="file-item"
            >
              <div class="file-row" @click="toggleFileDiff(file.path)">
                <span class="file-status" :class="statusClass(file.status)">{{ file.status }}</span>
                <span class="file-name">{{ file.path }}</span>
                <button
                  class="file-action"
                  title="取消暂存"
                  @click.stop="gitState.unstageFile(file.path, activeRepoRoot)"
                >
                  -
                </button>
              </div>

              <div v-if="openDiffs.has(file.path)" class="file-diff-wrap">
                <div v-if="diffLoading.has(file.path)" class="diff-loading">加载差异中...</div>
                <pre v-else-if="fileDiffs[file.path]" class="diff-content"><code v-html="renderDiff(fileDiffs[file.path])"></code></pre>
                <div v-else class="diff-empty">无法获取差异</div>
              </div>
            </div>
          </div>
        </section>

        <section v-if="scmAgentChangeSets.length > 0" class="git-section agent-change-section">
          <button
            class="section-header"
            @click="toggleSection('agentChanges')"
            data-codek-smoke="scm-agent-change-section-header"
          >
            <span class="chevron" :class="{ open: sectionsOpen.has('agentChanges') }">&#x25B6;</span>
            <span class="section-label">智能体变更集</span>
            <span class="section-count">{{ scmAgentChangeSets.length }}</span>
          </button>

          <div v-if="sectionsOpen.has('agentChanges')" class="agent-change-list">
            <div
              v-for="operation in scmAgentChangeSets"
              :key="operation.id"
              class="agent-change-card"
              :class="{ blocked: operation.rollbackBlocked }"
              data-codek-smoke="scm-agent-change-card"
              :data-operation-status="operation.statusLabel"
              :data-operation-source="operation.sourceLabel"
            >
              <div class="agent-change-head">
                <div class="agent-change-title">
                  <span class="agent-change-name">{{ operation.title }}</span>
                  <span class="agent-change-badge">{{ operation.badge }}</span>
                  <span class="agent-change-badge alt">{{ operation.operationLabel }}</span>
                  <span class="agent-change-badge" :class="{ blocked: operation.rollbackBlocked }">{{ operation.statusLabel }}</span>
                </div>
                <button class="file-action" title="打开文件" @click.stop="emit('openFile', { path: operation.primaryPath })">
                  ↗
                </button>
              </div>
              <button class="agent-change-path" @click="emit('openFile', { path: operation.primaryPath })">
                {{ operation.primaryPath }}
              </button>
              <div v-if="operation.agentId || operation.runId" class="agent-change-meta">
                <span v-if="operation.agentId">智能体 {{ operation.agentId }}</span>
                <span v-if="operation.runId">Run {{ operation.runId }}</span>
              </div>
              <div v-if="operation.rollbackBlocked" class="agent-change-alert" role="alert">
                回滚被阻止：{{ operation.blockedReasonLabel }}
              </div>
            </div>
          </div>
        </section>

        <section class="git-section">
          <button
            class="section-header"
            @click="toggleSection('review')"
          >
            <span class="chevron" :class="{ open: sectionsOpen.has('review') }">&#x25B6;</span>
            <span class="section-label">{{ t('review.title') }}</span>
            <span class="section-count">{{ reviewIssues.length }}</span>
          </button>

          <div v-if="sectionsOpen.has('review')">
            <div v-if="reviewIssues.length === 0 && !isReviewingCode" class="section-empty">
              <button class="ai-review-trigger" @click="handleAiReview" :disabled="isReviewingCode">
                <svg v-if="!isReviewingCode" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z" />
                </svg>
                <span v-else class="spinner-small"></span>
                {{ isReviewingCode ? t('review.reviewing') : t('review.run') }}
              </button>
            </div>

            <div v-if="isReviewingCode" class="review-loading">{{ t('review.reviewing') }}</div>

            <div
              v-for="issue in reviewIssues"
              :key="issue.id"
              class="review-item"
            >
              <div class="review-item-head">
                <span class="review-severity" :class="`review-sev-${issue.severity}`">
                  {{ issue.severity === 'error' ? '✕' : issue.severity === 'warning' ? '!' : 'i' }}
                </span>
                <span class="review-cat-badge">{{ categoryLabel(issue.category) }}</span>
                <span class="review-file" @click="emit('openFile', { path: issue.file })">
                  {{ basename(issue.file) }}:{{ issue.line }}
                </span>
              </div>
              <p class="review-message">{{ issue.message }}</p>
              <p v-if="issue.suggestion" class="review-suggestion">{{ issue.suggestion }}</p>
            </div>
          </div>
        </section>

        <section class="git-section">
          <button
            class="section-header"
            @click="toggleSection('branchOps')"
          >
            <span class="chevron" :class="{ open: sectionsOpen.has('branchOps') }">&#x25B6;</span>
            <span class="section-label">分支操作</span>
          </button>

          <div v-if="sectionsOpen.has('branchOps')" class="branch-ops-body">
            <div class="ops-row">
              <label class="ops-label">合并分支</label>
              <div class="ops-inputs">
                <select v-model="mergeSource" class="ops-select">
                  <option value="">源分支</option>
                  <option v-for="b in nonCurrentBranches" :key="b.name" :value="b.name">{{ b.name }}</option>
                </select>
                <span class="ops-arrow">→</span>
                <select v-model="mergeTarget" class="ops-select">
                  <option value="">目标分支</option>
                  <option v-for="b in gitState.branches.value" :key="b.name" :value="b.name">{{ b.name }}</option>
                </select>
                <button class="ops-run-btn" :disabled="!mergeSource || !mergeTarget || operating" @click="handleMerge">合并</button>
              </div>
            </div>
            <div class="ops-row">
              <label class="ops-label">变基</label>
              <div class="ops-inputs">
                <select v-model="rebaseBranch" class="ops-select">
                  <option value="">选择分支</option>
                  <option v-for="b in nonCurrentBranches" :key="b.name" :value="b.name">{{ b.name }}</option>
                </select>
                <button class="ops-run-btn" :disabled="!rebaseBranch || operating" @click="handleRebase">变基</button>
              </div>
            </div>
            <div class="ops-row">
              <label class="ops-label">摘取提交</label>
              <div class="ops-inputs">
                <input v-model="cherryPickHash" class="ops-input" placeholder="提交哈希" />
                <button class="ops-run-btn" :disabled="!cherryPickHash || operating" @click="handleCherryPick">摘取</button>
              </div>
            </div>
          </div>
        </section>

        <section class="git-section">
          <button
            class="section-header"
            @click="toggleSection('tags')"
          >
            <span class="chevron" :class="{ open: sectionsOpen.has('tags') }">&#x25B6;</span>
            <span class="section-label">标签</span>
            <span class="section-count">{{ tagList.length }}</span>
          </button>

          <div v-if="sectionsOpen.has('tags')">
            <div class="tag-create-row">
              <input v-model="newTagName" class="ops-input" placeholder="标签名称" />
              <input v-model="newTagMessage" class="ops-input tag-msg-input" placeholder="标签信息（可选）" />
              <button class="ops-run-btn" :disabled="!newTagName || operating" @click="handleCreateTag">创建</button>
            </div>
            <div v-if="tagList.length === 0" class="section-empty">没有标签</div>
            <div v-for="tag in tagList" :key="tag.name" class="tag-item">
              <span class="tag-icon">🏷</span>
              <span class="tag-name">{{ tag.name }}</span>
              <span v-if="tag.message" class="tag-message">{{ tag.message }}</span>
            </div>
          </div>
        </section>

        <section class="git-section">
          <button
            class="section-header"
            @click="toggleSection('remotes')"
          >
            <span class="chevron" :class="{ open: sectionsOpen.has('remotes') }">&#x25B6;</span>
            <span class="section-label">远程仓库</span>
            <span class="section-count">{{ remoteList.length }}</span>
          </button>

          <div v-if="sectionsOpen.has('remotes')">
            <div class="remote-add-row">
              <input v-model="newRemoteName" class="ops-input" placeholder="名称" />
              <input v-model="newRemoteUrl" class="ops-input remote-url-input" placeholder="URL" />
              <button class="ops-run-btn" :disabled="!newRemoteName || !newRemoteUrl || operating" @click="handleAddRemote">添加</button>
            </div>
            <div v-if="remoteList.length === 0" class="section-empty">没有远程仓库</div>
            <div v-for="remote in remoteList" :key="remote.name" class="remote-item">
              <span class="remote-name">{{ remote.name }}</span>
              <span class="remote-url">{{ remote.url }}</span>
              <button class="remote-remove-btn" @click="handleRemoveRemote(remote.name)">✕</button>
            </div>
          </div>
        </section>

        <section v-if="panelConflictList.length > 0" class="git-section conflict-section">
          <button
            class="section-header conflict-header"
            @click="toggleSection('conflicts')"
          >
            <span class="chevron" :class="{ open: sectionsOpen.has('conflicts') }">&#x25B6;</span>
            <span class="section-label">冲突</span>
            <span class="section-count conflict-count">{{ panelConflictList.length }}</span>
          </button>

          <div v-if="sectionsOpen.has('conflicts')">
            <div v-for="conflict in panelConflictList" :key="conflict.path" class="conflict-item">
              <div class="conflict-file-row">
                <span class="conflict-file-name">{{ conflict.path }}</span>
                <button class="ops-run-btn" @click="openConflictResolver(conflict.path)">解决</button>
              </div>
              <div v-if="resolvingConflict === conflict.path" class="conflict-resolver">
                <div class="conflict-mode-toggle">
                  <button
                    class="mode-btn"
                    :class="{ active: conflictMode === 'diff' }"
                    @click="conflictMode = 'diff'"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <line x1="12" y1="3" x2="12" y2="21"/>
                    </svg>
                    三栏对比
                  </button>
                  <button
                    class="mode-btn"
                    :class="{ active: conflictMode === 'edit' }"
                    @click="conflictMode = 'edit'"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    手动编辑
                  </button>
                </div>

                <div v-if="conflictMode === 'diff'" class="conflict-diff-view">
                  <div class="diff-panels">
                    <div class="diff-panel incoming">
                      <div class="diff-panel-header incoming-header">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <circle cx="12" cy="12" r="3"/>
                          <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
                        </svg>
                        Incoming（远程变更）
                      </div>
                      <pre class="diff-panel-content">{{ parsedConflict.incoming }}</pre>
                    </div>
                    <div class="diff-panel base">
                      <div class="diff-panel-header base-header">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <circle cx="12" cy="12" r="10"/>
                          <line x1="12" y1="8" x2="12" y2="12"/>
                          <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        Base（共同祖先）
                      </div>
                      <pre class="diff-panel-content">{{ parsedConflict.base }}</pre>
                    </div>
                    <div class="diff-panel local">
                      <div class="diff-panel-header local-header">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                        </svg>
                        Local（本地变更）
                      </div>
                      <pre class="diff-panel-content">{{ parsedConflict.local }}</pre>
                    </div>
                  </div>
                  <div class="conflict-quick-actions">
                    <button class="quick-action-btn accept-incoming" @click="acceptIncoming">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                      Accept Incoming
                    </button>
                    <button class="quick-action-btn accept-local" @click="acceptLocal">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                      Accept Local
                    </button>
                    <button class="quick-action-btn accept-both" @click="acceptBoth">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
                      Accept Both
                    </button>
                    <button class="quick-action-btn edit-manual" @click="conflictMode = 'edit'">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      Edit Manually
                    </button>
                  </div>
                </div>

                <div v-if="conflictMode === 'edit'">
                  <textarea
                    v-model="conflictResolution"
                    class="conflict-textarea"
                    rows="8"
                    placeholder="输入解决后的文件内容"
                  ></textarea>
                </div>

                <div class="conflict-actions">
                  <button class="ops-run-btn" @click="handleResolveConflict(conflict.path)">确认解决</button>
                  <button class="ops-cancel-btn" @click="resolvingConflict = ''">取消</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="git-section commit-section">
          <div class="commit-area">
            <div class="commit-input-row">
              <textarea
                v-model="commitMessage"
                class="commit-input"
                rows="3"
                placeholder="提交信息（按 Ctrl+Enter 提交）"
                :disabled="committableCount === 0"
                @keydown.ctrl.enter.prevent="handleCommit"
              ></textarea>
              <button
                class="commit-ai-btn"
                title="智能生成提交信息"
                :disabled="committableCount === 0 || generatingCommit"
                @click="handleAiCommitMessage"
              >
                <svg v-if="!generatingCommit" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z" />
                </svg>
                <span v-else class="spinner-small"></span>
              </button>
            </div>
            <button
              class="commit-btn"
              :disabled="committableCount === 0 || !commitMessage.trim() || committing"
              @click="handleCommit"
            >
              {{ committing ? "提交中..." : "提交" }}
            </button>
          </div>

          <div class="action-buttons">
            <button class="action-btn" @click="handlePush" :disabled="pushing">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
              推送
            </button>
            <button class="action-btn" @click="handlePull" :disabled="pulling">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <polyline points="19 12 12 19 5 12" />
              </svg>
              拉取
            </button>
            <button class="action-btn" @click="handleStash">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="21 8 21 21 3 21 3 8" />
                <rect x="1" y="3" width="22" height="5" />
                <line x1="10" y1="12" x2="14" y2="12" />
              </svg>
              Stash
            </button>
            <button class="action-btn" @click="handleRefresh">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              刷新
            </button>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue"
import { workspace } from "../workspace/manager"
import { changeHistory } from "../workspace/changeHistory"
import { gitState } from "./gitState"
import type { GitTag, GitRemote, GitConflict, GitStatusSummary } from "./gitState"
import { useI18n } from "../i18n/index"
import { generateCommitMessage, reviewChanges } from "../ai/git.js"
import { reviewDiff, type ReviewIssue, type ReviewCategory } from "../ai/codeReviewer"
import { chatSync } from "../ai/llmClient"
import { getActiveProvider, getActiveModel } from "../ai/aiProviders"
import { getGitSettings } from "../settings/gitSettings"
import { settingsStore } from "../settings/settingsStore"
import { getScmProviderSnapshot, getScmResourceGroup } from "../scm/scmRegistry"
import type { ScmResource } from "../scm/scmRegistry"
import { createScmAgentChangeSetModels } from "../workbench/changeReviewDisplay"

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
  stash: []
  openFile: [payload: { path: string }]
}>()

const sectionsOpen = ref<Set<string>>(new Set(["changes", "staged", "agentChanges"]))
const openDiffs = ref<Set<string>>(new Set())
const fileDiffs = reactive<Record<string, string>>({})
const diffLoading = ref<Set<string>>(new Set())
const commitMessage = ref("")
const committing = ref(false)
const pushing = ref(false)
const pulling = ref(false)
const selectedRepoRoot = ref("")
const generatingCommit = ref(false)
const isReviewingCode = ref(false)
const reviewIssues = ref<ReviewIssue[]>([])

const operating = ref(false)
const mergeSource = ref("")
const mergeTarget = ref("")
const rebaseBranch = ref("")
const cherryPickHash = ref("")
const newTagName = ref("")
const newTagMessage = ref("")
const tagList = ref<GitTag[]>([])
const newRemoteName = ref("")
const newRemoteUrl = ref("")
const remoteList = ref<GitRemote[]>([])
const conflictList = ref<GitConflict[]>([])
const resolvingConflict = ref("")
const conflictResolution = ref("")
const conflictMode = ref<"edit" | "diff">("diff")

interface ParsedConflict {
  local: string
  incoming: string
  base: string
}

const parsedConflict = computed<ParsedConflict>(() => {
  const content = conflictResolution.value
  if (!content) return { local: "", incoming: "", base: "" }
  return parseConflictMarkers(content)
})

function parseConflictMarkers(content: string): ParsedConflict {
  const localParts: string[] = []
  const incomingParts: string[] = []
  const baseParts: string[] = []
  const lines = content.split("\n")

  let section: "none" | "local" | "base" | "incoming" = "none"
  let hasBase = false

  for (const line of lines) {
    if (line.startsWith("<<<<<<< ")) {
      section = "local"
      continue
    }
    if (line.startsWith("||||||| ")) {
      section = "base"
      hasBase = true
      continue
    }
    if (line.startsWith("=======") && section !== "none") {
      section = hasBase ? "incoming" : "incoming"
      if (!hasBase) {
        section = "incoming"
      }
      continue
    }
    if (line.startsWith(">>>>>>> ")) {
      section = "none"
      continue
    }

    if (section === "local") {
      localParts.push(line)
    } else if (section === "base") {
      baseParts.push(line)
    } else if (section === "incoming") {
      incomingParts.push(line)
    }
  }

  return {
    local: localParts.join("\n"),
    incoming: incomingParts.join("\n"),
    base: baseParts.join("\n"),
  }
}

function acceptIncoming(): void {
  conflictResolution.value = parsedConflict.value.incoming
  conflictMode.value = "edit"
}

function acceptLocal(): void {
  conflictResolution.value = parsedConflict.value.local
  conflictMode.value = "edit"
}

function acceptBoth(): void {
  const { incoming, local } = parsedConflict.value
  conflictResolution.value = incoming + "\n" + local
  conflictMode.value = "edit"
}

const nonCurrentBranches = computed(() =>
  gitState.branches.value.filter((b) => !b.current),
)

const repositoryOptions = computed<GitStatusSummary[]>(() => gitState.repositories.value)

const activeGitStatus = computed<GitStatusSummary | null>(() => {
  if (!repositoryOptions.value.length) return gitState.status.value
  return repositoryOptions.value.find((repo) => repo.rootUri === selectedRepoRoot.value) || repositoryOptions.value[0] || null
})

const activeRepoRoot = computed(() => activeGitStatus.value?.rootUri || selectedRepoRoot.value || gitState.getProjectRoot())
const activeScmProvider = computed(() => {
  const status = activeGitStatus.value
  return getScmProviderSnapshot("git", status?.rootUri || activeRepoRoot.value)
})
const activeAhead = computed(() => activeScmProvider.value?.ahead ?? activeGitStatus.value?.ahead ?? 0)
const activeBehind = computed(() => activeScmProvider.value?.behind ?? activeGitStatus.value?.behind ?? 0)

const categoryLabelMap: Record<ReviewCategory, string> = {
  security: t("review.security"),
  performance: t("review.performance"),
  bug: t("review.bug"),
  style: t("review.style"),
  architecture: t("review.architecture"),
}

function categoryLabel(cat: ReviewCategory): string {
  return categoryLabelMap[cat] || cat
}

function basename(path: string): string {
  return String(path || "").replace(/^.*[\\/]/, "")
}

function activeScmResources(groupId: string): ScmResource[] {
  const provider = activeScmProvider.value
  return provider?.groups.find((group) => group.id === groupId)?.resources || getScmResourceGroup("git", activeRepoRoot.value, groupId).resources
}

const unstagedFiles = computed<ScmResource[]>(() => activeScmResources("changes"))
const stagedFiles = computed<ScmResource[]>(() => activeScmResources("staged"))
const scmConflictResources = computed<ScmResource[]>(() => activeScmResources("conflicts"))
const scmAgentChangeSets = computed(() => createScmAgentChangeSetModels(changeHistory.entries))
const panelConflictList = computed<GitConflict[]>(() => {
  const byPath = new Map<string, GitConflict>()
  for (const conflict of scmConflictResources.value) {
    byPath.set(conflict.path, { path: conflict.path })
  }
  for (const conflict of conflictList.value) {
    byPath.set(conflict.path, conflict)
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
})

const unstagedCount = computed(() => unstagedFiles.value.length)
const stagedCount = computed(() => stagedFiles.value.length)
const gitRuntimeSettings = computed(() => getGitSettings(settingsStore.getAll()))
const committableCount = computed(() =>
  gitRuntimeSettings.value.autoStage ? stagedCount.value + unstagedCount.value : stagedCount.value,
)

function statusClass(status: string): string {
  const map: Record<string, string> = {
    M: "status-modified",
    A: "status-added",
    D: "status-deleted",
    "??": "status-untracked",
    R: "status-renamed",
  }
  return map[status] || ""
}

function toggleSection(key: string): void {
  const next = new Set(sectionsOpen.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  sectionsOpen.value = next
}

async function toggleFileDiff(path: string): Promise<void> {
  const next = new Set(openDiffs.value)
  if (next.has(path)) {
    next.delete(path)
    openDiffs.value = next
    return
  }
  next.add(path)
  openDiffs.value = next

  if (fileDiffs[path]) return

  const loadingSet = new Set(diffLoading.value)
  loadingSet.add(path)
  diffLoading.value = loadingSet

  const result = await gitState.getDiff(path, activeRepoRoot.value)
  if (result?.diff) {
    fileDiffs[path] = result.diff
  }

  const doneSet = new Set(diffLoading.value)
  doneSet.delete(path)
  diffLoading.value = doneSet
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }
  return text.replace(/[&<>"']/g, (ch) => map[ch] || ch)
}

function renderDiff(diff: string): string {
  const lines = diff.split("\n")
  let result = ""
  for (const line of lines) {
    const escaped = escapeHtml(line)
    if (line.startsWith("+") && !line.startsWith("+++")) {
      result += `<span class="diff-add">${escaped}</span>\n`
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      result += `<span class="diff-del">${escaped}</span>\n`
    } else if (line.startsWith("@@")) {
      result += `<span class="diff-hunk">${escaped}</span>\n`
    } else {
      result += `${escaped}\n`
    }
  }
  return result
}

async function handleCommit(): Promise<void> {
  const msg = commitMessage.value.trim()
  if (!msg || committableCount.value === 0 || committing.value) return
  committing.value = true
  const ok = await gitState.commit(msg, activeRepoRoot.value)
  committing.value = false
  if (ok) {
    commitMessage.value = ""
    openDiffs.value = new Set()
    for (const key of Object.keys(fileDiffs)) {
      delete fileDiffs[key]
    }
  }
}

async function handlePush(): Promise<void> {
  if (pushing.value) return
  pushing.value = true
  await gitState.push(activeRepoRoot.value)
  pushing.value = false
}

async function handlePull(): Promise<void> {
  if (pulling.value) return
  pulling.value = true
  await gitState.pull(activeRepoRoot.value)
  pulling.value = false
}

async function handleStash(): Promise<void> {
  if (operating.value) return
  operating.value = true
  await gitState.stashChanges(activeRepoRoot.value)
  operating.value = false
}

async function handleDiscardFile(path: string, untracked: boolean): Promise<void> {
  if (!path || operating.value) return
  operating.value = true
  await gitState.discardFile(path, untracked, activeRepoRoot.value)
  operating.value = false
  openDiffs.value = new Set([...openDiffs.value].filter((item) => item !== path))
  delete fileDiffs[path]
}

async function handleRefresh(): Promise<void> {
  await gitState.fetchStatus()
  await gitState.fetchBranches(activeRepoRoot.value)
}

async function handleBranchChange(branch: string): Promise<void> {
  if (!branch) return
  await gitState.checkoutBranch(branch, activeRepoRoot.value)
}

async function ollamaPromptFn(prompt: string): Promise<string> {
  return chatSync({
    provider: getActiveProvider(),
    model: getActiveModel(),
    messages: [{ role: "user", content: prompt }],
    stream: false,
  })
}

async function handleAiCommitMessage(): Promise<void> {
  if (generatingCommit.value || committableCount.value === 0) return

  generatingCommit.value = true

  try {
    const diffs: string[] = []
    const filesForDiff = gitRuntimeSettings.value.autoStage
      ? [...stagedFiles.value, ...unstagedFiles.value]
      : stagedFiles.value
    for (const file of filesForDiff) {
      const result = await gitState.getDiff(file.path, activeRepoRoot.value)
      if (result?.diff) {
        diffs.push(result.diff)
      }
    }

    if (diffs.length === 0) return

    const combinedDiff = diffs.join("\n")
    const model = getActiveModel()

    const message = await generateCommitMessage(combinedDiff, model, ollamaPromptFn)
    if (message) {
      commitMessage.value = message
    }
  } catch {
    // silently fail, user can still type manually
  } finally {
    generatingCommit.value = false
  }
}

async function handleAiReview(): Promise<void> {
  if (isReviewingCode.value) return

  isReviewingCode.value = true
  reviewIssues.value = []

  try {
    const allIssues: ReviewIssue[] = []

    for (const file of stagedFiles.value) {
      const result = await gitState.getDiff(file.path, activeRepoRoot.value)
      if (result?.diff) {
        const issues = await reviewDiff(result.diff, file.path)
        allIssues.push(...issues)
      }
    }

    if (allIssues.length === 0 && stagedFiles.value.length > 0) {
      const diffs: string[] = []
      for (const file of stagedFiles.value) {
        const result = await gitState.getDiff(file.path, activeRepoRoot.value)
        if (result?.diff) {
          diffs.push(result.diff)
        }
      }

      if (diffs.length > 0) {
        const combined = diffs.join("\n")
        const rawReview = await reviewChanges(combined, getActiveModel(), ollamaPromptFn)
        const summary = {
          id: `rv-summary-${Date.now()}`,
          file: "",
          line: 1,
          column: 1,
          message: rawReview.slice(0, 500),
          severity: "info" as const,
          category: "architecture" as const,
          suggestion: "",
        }
        allIssues.push(summary)
      }
    }

    reviewIssues.value = allIssues
    sectionsOpen.value = new Set([...sectionsOpen.value, "review"])
  } catch {
    // silently fail
  } finally {
    isReviewingCode.value = false
  }
}

async function handleMerge(): Promise<void> {
  if (!mergeSource.value || !mergeTarget.value || operating.value) return
  operating.value = true
  const res = await gitState.merge(mergeSource.value, mergeTarget.value, activeRepoRoot.value)
  operating.value = false
  if (res.success) {
    mergeSource.value = ""
    mergeTarget.value = ""
    await loadAdvancedData()
  }
}

async function handleRebase(): Promise<void> {
  if (!rebaseBranch.value || operating.value) return
  operating.value = true
  const res = await gitState.rebase(rebaseBranch.value, activeRepoRoot.value)
  operating.value = false
  if (res.success) {
    rebaseBranch.value = ""
    await loadAdvancedData()
  }
}

async function handleCherryPick(): Promise<void> {
  if (!cherryPickHash.value || operating.value) return
  operating.value = true
  const res = await gitState.cherryPick(cherryPickHash.value, activeRepoRoot.value)
  operating.value = false
  if (res.success) {
    cherryPickHash.value = ""
    await loadAdvancedData()
  }
}

async function handleCreateTag(): Promise<void> {
  if (!newTagName.value || operating.value) return
  operating.value = true
  const res = await gitState.createTag(newTagName.value, newTagMessage.value, activeRepoRoot.value)
  operating.value = false
  if (res.success) {
    newTagName.value = ""
    newTagMessage.value = ""
    tagList.value = await gitState.fetchTags(activeRepoRoot.value)
  }
}

async function handleAddRemote(): Promise<void> {
  if (!newRemoteName.value || !newRemoteUrl.value || operating.value) return
  operating.value = true
  const res = await gitState.addRemote(newRemoteName.value, newRemoteUrl.value, activeRepoRoot.value)
  operating.value = false
  if (res.success) {
    newRemoteName.value = ""
    newRemoteUrl.value = ""
    remoteList.value = await gitState.fetchRemotes(activeRepoRoot.value)
  }
}

async function handleRemoveRemote(name: string): Promise<void> {
  if (operating.value) return
  operating.value = true
  const res = await gitState.removeRemote(name, activeRepoRoot.value)
  operating.value = false
  if (res.success) {
    remoteList.value = await gitState.fetchRemotes(activeRepoRoot.value)
  }
}

function openConflictResolver(path: string): void {
  resolvingConflict.value = path
  conflictResolution.value = ""
  conflictMode.value = "diff"

  const content = workspace.files?.[path]
  if (typeof content === "string" && hasConflictMarkers(content)) {
    conflictResolution.value = content
    conflictMode.value = "diff"
  }
}

function hasConflictMarkers(content: string): boolean {
  return content.includes("<<<<<<< ") && content.includes(">>>>>>> ")
}

async function handleResolveConflict(path: string): Promise<void> {
  if (operating.value) return
  operating.value = true
  const res = await gitState.resolveConflict(path, conflictResolution.value, activeRepoRoot.value)
  operating.value = false
  if (res.success) {
    resolvingConflict.value = ""
    conflictResolution.value = ""
    conflictList.value = await gitState.fetchMergeConflicts(activeRepoRoot.value)
    await gitState.fetchStatus()
  }
}

async function loadAdvancedData(): Promise<void> {
  const [tags, remotes, conflicts] = await Promise.all([
    gitState.fetchTags(activeRepoRoot.value),
    gitState.fetchRemotes(activeRepoRoot.value),
    gitState.fetchMergeConflicts(activeRepoRoot.value),
  ])
  tagList.value = tags
  remoteList.value = remotes
  conflictList.value = conflicts
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      void initGit()
      gitState.startAutoRefresh(5000)
    } else {
      gitState.stopAutoRefresh()
    }
  },
)

watch(
  () => repositoryOptions.value.map((repo) => repo.rootUri || "").join("|"),
  () => {
    const roots = repositoryOptions.value.map((repo) => repo.rootUri).filter(Boolean) as string[]
    if (!roots.length) {
      selectedRepoRoot.value = ""
      return
    }
    if (!selectedRepoRoot.value || !roots.includes(selectedRepoRoot.value)) {
      selectedRepoRoot.value = roots[0]
    }
  },
  { immediate: true },
)

watch(selectedRepoRoot, async (root) => {
  openDiffs.value = new Set()
  for (const key of Object.keys(fileDiffs)) delete fileDiffs[key]
  if (root) {
    await gitState.fetchBranches(root)
  }
})

async function initGit(): Promise<void> {
  const root = workspace.projectRoot || (window.codek ? await window.codek.getProjectRoot() : "")
  const roots = workspace.workspaceRoots.length ? workspace.workspaceRoots : (root ? [root] : [])
  if (roots.length && roots.join("|") !== gitState.getWorkspaceRoots().join("|")) {
    gitState.setWorkspaceRoots(roots)
  }
  await gitState.fetchStatus()
  if (!selectedRepoRoot.value && gitState.repositories.value[0]?.rootUri) {
    selectedRepoRoot.value = gitState.repositories.value[0].rootUri || ""
  }
  await gitState.fetchBranches(activeRepoRoot.value)
  await loadAdvancedData()
}

onMounted(() => {
  if (props.visible) {
    void initGit()
    gitState.startAutoRefresh(5000)
  }
})

onBeforeUnmount(() => {
  gitState.stopAutoRefresh()
})
</script>

<style scoped>
.git-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  font-family: var(--font-sans);
  overflow: hidden;
}

.git-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px 16px;
  color: var(--text-muted);
  font-size: 12px;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinning {
  animation: spin 1s linear infinite;
}

.git-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 16px;
  text-align: center;
}

.empty-icon {
  color: var(--text-muted);
  margin-bottom: 4px;
}

.empty-title {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
}

.empty-hint {
  color: var(--text-muted);
  font-size: 11px;
}

.git-header {
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
}

.repo-info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.repo-icon {
  color: var(--accent);
  flex-shrink: 0;
}

.repo-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.header-btn {
  height: 24px;
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  background: var(--bg-dark);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: background 0.15s, color 0.15s;
}

.header-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.header-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px 8px;
  gap: 8px;
}

.repo-selector-wrap,
.branch-selector-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.repo-selector-wrap {
  max-width: 45%;
}

.branch-icon {
  color: var(--accent);
  flex-shrink: 0;
}

.repo-selector,
.branch-selector {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-dark);
  color: var(--text-primary);
  font-size: 11px;
  font-family: var(--font-sans);
  cursor: pointer;
  outline: none;
}

.repo-selector:focus,
.branch-selector:focus {
  border-color: var(--accent);
}

.sync-info {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.sync-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  font-weight: 600;
}

.sync-badge.ahead {
  background: rgba(52, 211, 153, 0.15);
  color: var(--green);
}

.sync-badge.behind {
  background: rgba(248, 113, 113, 0.15);
  color: var(--red);
}

.git-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(248, 113, 113, 0.1);
  border-bottom: 1px solid rgba(248, 113, 113, 0.15);
  flex-shrink: 0;
}

.error-text {
  font-size: 11px;
  color: var(--red);
  flex: 1;
}

.error-dismiss {
  background: none;
  border: none;
  color: var(--red);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 3px;
}

.error-dismiss:hover {
  background: rgba(248, 113, 113, 0.2);
}

.git-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.git-section {
  border-bottom: 1px solid var(--border-subtle);
}

.section-header {
  width: 100%;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: none;
  background: var(--bg-darker);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: background 0.1s;
}

.section-header:hover {
  background: var(--bg-hover);
}

.chevron {
  font-size: 8px;
  color: var(--text-muted);
  transition: transform 0.15s;
  flex-shrink: 0;
  width: 12px;
  text-align: center;
}

.chevron.open {
  transform: rotate(90deg);
}

.section-label {
  flex: 1;
  text-align: left;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  font-size: 11px;
}

.section-count {
  font-size: 10px;
  color: var(--text-muted);
  background: var(--bg-active);
  padding: 1px 6px;
  border-radius: 999px;
  min-width: 18px;
  text-align: center;
}

.stage-all-btn {
  font-size: 10px;
  color: var(--accent);
  background: none;
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 1px 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.stage-all-btn:hover {
  background: var(--accent-dim);
}

.section-empty {
  padding: 12px 16px;
  color: var(--text-muted);
  font-size: 11px;
}

.file-item {
  border-top: 1px solid rgba(255, 255, 255, 0.02);
}

.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 10px 0 16px;
  cursor: pointer;
  transition: background 0.1s;
}

.file-row:hover {
  background: var(--bg-hover);
}

.agent-change-section {
  background: rgba(45, 212, 191, 0.03);
}

.agent-change-list {
  padding: 6px 8px 8px;
}

.agent-change-card {
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  background: var(--bg-dark);
  padding: 8px;
}

.agent-change-card + .agent-change-card {
  margin-top: 6px;
}

.agent-change-card.blocked {
  border-color: rgba(251, 146, 60, 0.38);
  background: rgba(251, 146, 60, 0.06);
}

.agent-change-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.agent-change-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.agent-change-name {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-primary);
}

.agent-change-badge {
  font-size: 9px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 999px;
  background: rgba(45, 212, 191, 0.12);
  color: #5eead4;
  border: 1px solid rgba(45, 212, 191, 0.18);
}

.agent-change-badge.alt {
  background: var(--bg-hover);
  color: var(--text-secondary);
  border-color: var(--border-subtle);
}

.agent-change-badge.blocked {
  background: rgba(251, 146, 60, 0.14);
  color: var(--orange);
  border-color: rgba(251, 146, 60, 0.24);
}

.agent-change-path {
  width: 100%;
  margin-top: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
  font-family: var(--font-mono);
  font-size: 11px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-change-path:hover {
  color: var(--accent);
  text-decoration: underline;
}

.agent-change-meta {
  margin-top: 5px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 10px;
  color: var(--text-muted);
}

.agent-change-alert {
  margin-top: 7px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(251, 146, 60, 0.1);
  color: var(--orange);
  font-size: 11px;
}

.file-status {
  font-size: 10px;
  font-weight: 700;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  width: 18px;
  text-align: center;
  flex-shrink: 0;
  letter-spacing: 0;
}

.file-status.status-modified {
  color: var(--orange);
}

.file-status.status-added {
  color: var(--green);
}

.file-status.status-deleted {
  color: var(--red);
}

.file-status.status-untracked {
  color: var(--text-muted);
}

.file-status.status-renamed {
  color: #60a5fa;
}

.file-name {
  flex: 1;
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-sans);
}

.file-action {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
}

.file-action:hover {
  background: var(--bg-active);
  color: var(--accent);
}

.file-action.danger:hover {
  background: rgba(248, 81, 73, 0.14);
  color: #f85149;
}

.file-diff-wrap {
  padding: 0;
  border-top: 1px solid var(--border-subtle);
  max-height: 320px;
  overflow: auto;
}

.diff-content {
  margin: 0;
  padding: 8px 12px;
  font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre;
  tab-size: 4;
  background: var(--bg-deepest);
}

.diff-content :deep(.diff-add) {
  background: rgba(52, 211, 153, 0.12);
  color: var(--green);
  display: block;
}

.diff-content :deep(.diff-del) {
  background: rgba(248, 113, 113, 0.12);
  color: var(--red);
  display: block;
}

.diff-content :deep(.diff-hunk) {
  color: #60a5fa;
  font-weight: 600;
}

.diff-loading,
.diff-empty {
  padding: 10px 16px;
  color: var(--text-muted);
  font-size: 11px;
}

.commit-section {
  border-bottom: none;
  padding-bottom: 8px;
}

.commit-area {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.commit-input {
  width: 100%;
  min-height: 58px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-dark);
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font-sans);
  resize: vertical;
  outline: none;
  line-height: 1.5;
}

.commit-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-dim);
}

.commit-input:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.commit-input::placeholder {
  color: var(--text-muted);
}

.commit-btn {
  height: 30px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: #0d0e10;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.commit-btn:hover:not(:disabled) {
  opacity: 0.88;
}

.commit-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 12px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-dark);
  color: var(--text-secondary);
  font-size: 11px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.action-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-bright);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.commit-input-row {
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

.commit-input-row .commit-input {
  flex: 1;
}

.commit-ai-btn {
  width: 32px;
  height: 32px;
  min-width: 32px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-dark);
  color: var(--accent);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, border-color 0.15s;
  flex-shrink: 0;
  margin-top: 1px;
}

.commit-ai-btn:hover:not(:disabled) {
  background: var(--accent-dim);
  border-color: var(--accent);
}

.commit-ai-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ai-review-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  color: var(--accent);
  font-size: 11px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: background 0.15s;
}

.ai-review-trigger:hover:not(:disabled) {
  background: var(--accent-dim);
}

.ai-review-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.review-loading {
  padding: 12px 16px;
  color: var(--text-muted);
  font-size: 11px;
}

.review-item {
  padding: 10px 12px;
  border-top: 1px solid var(--border-subtle);
}

.review-item-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
}

.review-severity {
  width: 16px;
  height: 16px;
  min-width: 16px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  font-family: "JetBrains Mono", monospace;
}

.review-sev-error {
  background: rgba(248, 113, 113, 0.18);
  color: var(--red);
}

.review-sev-warning {
  background: rgba(251, 146, 60, 0.16);
  color: var(--orange);
}

.review-sev-info {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.review-cat-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.review-file {
  font-size: 10px;
  color: var(--text-muted);
  cursor: pointer;
  margin-left: auto;
  font-family: "JetBrains Mono", "Fira Code", monospace;
}

.review-file:hover {
  color: var(--accent);
  text-decoration: underline;
}

.review-message {
  font-size: 11px;
  color: var(--text-primary);
  line-height: 1.5;
  margin: 0 0 4px;
}

.review-suggestion {
  font-size: 11px;
  color: var(--green);
  line-height: 1.5;
  margin: 0;
  padding: 4px 8px;
  background: rgba(52, 211, 153, 0.06);
  border-radius: 4px;
  border-left: 2px solid var(--green);
}

.spinner-small {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.branch-ops-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ops-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ops-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.ops-inputs {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ops-select {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-dark);
  color: var(--text-primary);
  font-size: 11px;
  font-family: var(--font-sans);
  outline: none;
}

.ops-select:focus {
  border-color: var(--accent);
}

.ops-arrow {
  color: var(--text-muted);
  font-size: 12px;
  flex-shrink: 0;
}

.ops-input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-dark);
  color: var(--text-primary);
  font-size: 11px;
  font-family: var(--font-sans);
  outline: none;
}

.ops-input:focus {
  border-color: var(--accent);
}

.ops-input::placeholder {
  color: var(--text-muted);
}

.ops-run-btn {
  height: 24px;
  padding: 0 10px;
  border: none;
  border-radius: 4px;
  background: var(--accent);
  color: #0d0e10;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-sans);
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.15s;
}

.ops-run-btn:hover:not(:disabled) {
  opacity: 0.88;
}

.ops-run-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ops-cancel-btn {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-dark);
  color: var(--text-secondary);
  font-size: 11px;
  font-family: var(--font-sans);
  cursor: pointer;
  flex-shrink: 0;
}

.ops-cancel-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tag-create-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.tag-msg-input {
  flex: 2;
}

.tag-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  height: 26px;
}

.tag-item:hover {
  background: var(--bg-hover);
}

.tag-icon {
  font-size: 11px;
  flex-shrink: 0;
}

.tag-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  font-family: "JetBrains Mono", "Fira Code", monospace;
}

.tag-message {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.remote-add-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.remote-url-input {
  flex: 2;
}

.remote-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  height: 26px;
}

.remote-item:hover {
  background: var(--bg-hover);
}

.remote-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  flex-shrink: 0;
}

.remote-url {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
  font-family: "JetBrains Mono", "Fira Code", monospace;
}

.remote-remove-btn {
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.1s, color 0.1s;
}

.remote-remove-btn:hover {
  background: rgba(248, 113, 113, 0.15);
  color: var(--red);
}

.conflict-section {
  border-left: 2px solid var(--orange);
}

.conflict-header {
  background: rgba(251, 146, 60, 0.06);
}

.conflict-count {
  background: rgba(251, 146, 60, 0.18) !important;
  color: var(--orange) !important;
}

.conflict-item {
  border-top: 1px solid var(--border-subtle);
}

.conflict-file-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
}

.conflict-file-name {
  font-size: 12px;
  color: var(--orange);
  font-family: "JetBrains Mono", "Fira Code", monospace;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conflict-resolver {
  padding: 0 12px 10px;
}

.conflict-textarea {
  width: 100%;
  min-height: 80px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  color: var(--text-primary);
  font-size: 11px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  resize: vertical;
  outline: none;
  line-height: 1.5;
  margin-bottom: 6px;
}

.conflict-textarea:focus {
  border-color: var(--accent);
}

.conflict-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.conflict-mode-toggle {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}

.mode-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-dark);
  color: var(--text-muted);
  font-size: 11px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: all 0.15s;
}

.mode-btn:hover {
  color: var(--text-primary);
  border-color: var(--border-bright);
}

.mode-btn.active {
  background: var(--accent-dim);
  color: var(--accent);
  border-color: var(--accent);
}

.conflict-diff-view {
  margin-bottom: 8px;
}

.diff-panels {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
  min-height: 120px;
  max-height: 280px;
}

.diff-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.diff-panel.incoming {
  border-color: rgba(96, 165, 250, 0.4);
}

.diff-panel.base {
  border-color: rgba(107, 114, 128, 0.4);
}

.diff-panel.local {
  border-color: rgba(52, 211, 153, 0.4);
}

.diff-panel-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  flex-shrink: 0;
}

.incoming-header {
  background: rgba(96, 165, 250, 0.12);
  color: #60a5fa;
}

.base-header {
  background: rgba(107, 114, 128, 0.12);
  color: #9ca3af;
}

.local-header {
  background: rgba(52, 211, 153, 0.12);
  color: var(--green);
}

.diff-panel-content {
  flex: 1;
  margin: 0;
  padding: 6px 8px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 10px;
  line-height: 1.5;
  color: var(--text-secondary);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--bg-deepest);
}

.conflict-quick-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.quick-action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-dark);
  color: var(--text-secondary);
  font-size: 10px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.quick-action-btn:hover {
  border-color: var(--border-bright);
  color: var(--text-primary);
}

.quick-action-btn.accept-incoming {
  border-color: rgba(96, 165, 250, 0.3);
  color: #60a5fa;
}

.quick-action-btn.accept-incoming:hover {
  background: rgba(96, 165, 250, 0.1);
}

.quick-action-btn.accept-local {
  border-color: rgba(52, 211, 153, 0.3);
  color: var(--green);
}

.quick-action-btn.accept-local:hover {
  background: rgba(52, 211, 153, 0.1);
}

.quick-action-btn.accept-both {
  border-color: rgba(167, 139, 250, 0.3);
  color: #a78bfa;
}

.quick-action-btn.accept-both:hover {
  background: rgba(167, 139, 250, 0.1);
}

.quick-action-btn.edit-manual {
  border-color: rgba(251, 146, 60, 0.3);
  color: var(--orange);
}

.quick-action-btn.edit-manual:hover {
  background: rgba(251, 146, 60, 0.1);
}
</style>
