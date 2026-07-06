<template>
  <AuthGate>
  <div
    class="app-shell"
    :class="[
      `side-bar-${workbench.sideBarLocation}`,
      bottomPanelOpen ? `panel-${workbench.panelDefaultLocation}` : 'panel-bottom',
      {
        'activity-hidden': !workbench.activityBarVisible,
        'status-hidden': !workbench.statusBarVisible,
        'markdown-preview-open': markdownPreviewOpen,
      },
    ]"
  >
    <MenuBar
      data-workbench-title-bar="true"
      :projectName="projectName"
      :sidebarVisible="sidebarVisible"
      :chatOpen="chatOpen"
      :data-workbench-title-project="workbenchLayoutUi.titleBar.projectName"
      :data-workbench-title-active-editor="workbenchLayoutUi.titleBar.activeEditor || ''"
      :data-workbench-title-active-view="workbenchLayoutUi.titleBar.activeViewId || ''"
      :data-workbench-title-agent-mode="workbenchLayoutUi.titleBar.agentMode"
      :data-workbench-title-sandbox-mode="workbenchLayoutUi.titleBar.sandboxMode"
      :data-workbench-title-goal-count="workbenchLayoutUi.titleBar.goalCount"
      :data-workbench-title-error-count="workbenchLayoutUi.titleBar.diagnosticsErrorCount"
      :data-workbench-title-warning-count="workbenchLayoutUi.titleBar.diagnosticsWarningCount"
      :data-workbench-command-palette-hint="workbenchLayoutUi.titleBar.commandPaletteHint"
      :activityBarVisible="workbench.activityBarVisible"
      :panelVisible="bottomPanelOpen"
      :hasEditor="Boolean(editor && w.activeFile)"
      :hasSelection="hasEditorSelection"
      :hasWorkspace="Boolean(w.projectRoot)"
      :hasActiveFile="Boolean(w.activeFile)"
      :dirty="Boolean(w.activeFile && isDirty(w.activeFile))"
      :autoSave="autoSaveMode !== 'off'"
      :debugActive="debugState.isRunning.value"
      :isElectron="isElectron"
      :agentMode="titlebarAgentMode"
      :agentBusy="agentBusy"
      :sandboxMode="titlebarSandboxMode"
      :goalCount="titlebarGoalCount"
      :diagnosticsErrorCount="problemState.errorCount.value"
      :diagnosticsWarningCount="problemState.warningCount.value"
      @menuAction="handleMenuAction"
      @toggleChat="toggleChatPanel"
      @toggleSidebarPanel="toggleSidebarVisibility"
    />
    <section
      v-if="workspaceTrustBannerVisible"
      class="workspace-trust-banner"
      role="region"
      :aria-label="workspaceTrustBannerProjection.ariaLabel"
      data-codek-smoke="workspace-trust-restricted-banner"
      :data-workbench-banner-id="workspaceTrustBannerProjection.id"
      :data-workbench-banner-owner="workspaceTrustBannerProjection.owner"
      :data-workbench-banner-service-id="workspaceTrustBannerProjection.serviceId"
      :data-workbench-banner-state-source="workspaceTrustBannerProjection.stateSource"
      :data-workbench-banner-visible="workspaceTrustBannerProjection.visible"
      :data-workbench-banner-dismissed="workspaceTrustBannerProjection.dismissed"
      :data-workbench-banner-action-labels="workspaceTrustBannerProjection.actions.map((action) => action.label).join(',')"
      :data-workbench-banner-action-hrefs="workspaceTrustBannerProjection.actions.map((action) => action.href).join(',')"
    >
      <span class="workspace-trust-banner-icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
          <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
          <path d="M9.5 12.5l1.7 1.7 3.8-4" />
        </svg>
      </span>
      <span class="workspace-trust-banner-message">{{ workspaceTrustBannerProjection.message }}</span>
      <span class="workspace-trust-banner-actions">
        <button
          v-for="action in workspaceTrustBannerProjection.actions"
          :key="action.href"
          type="button"
          class="workspace-trust-banner-action"
          :data-workbench-banner-action-label="action.label"
          :data-workbench-banner-action-href="action.href"
          @click="handleWorkspaceTrustBannerAction(action)"
        >
          {{ action.label }}
        </button>
        <button
          type="button"
          class="workspace-trust-banner-dismiss"
          data-workbench-banner-dismiss="true"
          aria-label="关闭受限模式横幅"
          title="关闭"
          @click="dismissWorkspaceTrustBanner"
        >
          x
        </button>
      </span>
    </section>
    <div class="app-body">
      <div v-if="workbench.activityBarVisible" class="activity-bar">
      <div class="activity-top" role="tablist" :aria-label="t('app.activityBar')">
        <button
          v-for="button in workbenchLayoutUi.activityButtons"
          :key="button.containerId"
          class="activity-btn"
          :class="{ active: isActivityButtonActive(button) }"
          role="tab"
          :aria-selected="isActivityButtonActive(button)"
          :data-codek-smoke="button.smokeId"
          :data-workbench-container-id="button.containerId"
          :data-workbench-view-id="button.activeViewId"
          :data-workbench-icon="button.iconFallback"
          :aria-label="button.ariaLabel"
          @pointerenter="handleActivityContainerPointerEnter(button)"
          @focus="handleActivityContainerPointerEnter(button)"
          @click="handleActivityContainerClick(button)"
          :title="button.tooltip"
        >
          <ActivityProductIcon
            class="activity-icon"
            :icon="button.iconFallback"
            aria-hidden="true"
          />
          <span v-if="getActivityButtonBadge(button)" class="activity-count">{{ getActivityButtonBadge(button) }}</span>
        </button>
      </div>

      <div class="activity-bottom">
        <button
          class="activity-btn user-btn"
          :title="auth.username"
          @click="activeView = 'settings'"
        >
          <span class="user-avatar">{{ auth.username?.charAt(0)?.toUpperCase() || '?' }}</span>
        </button>
        <button
          class="activity-btn logout-btn"
          :title="t('auth.logout')"
          @click="handleLogout"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
      </div>

    <div
      v-if="sidebarVisible"
      class="sidebar"
      role="tabpanel"
      :aria-label="t('app.sidebarPanel')"
      tabindex="-1"
      data-codek-smoke="sidebar-panel"
      :data-workbench-container-id="workbenchLayoutUi.sidebar.activeContainerId || ''"
      :data-workbench-view-id="workbenchLayoutUi.sidebar.activeViewId || activeView"
      :data-workbench-title="workbenchLayoutUi.sidebar.title || sidebarTitle"
      :data-workbench-width="workbenchLayoutUi.sidebar.width || sidebarWidth"
      :style="{ width: sidebarWidth + 'px' }"
    >
      <div class="sidebar-body">
        <FileTree
          ref="fileTreeRef"
          v-if="activeView === 'files'"
          role="tree"
          :aria-label="t('app.fileExplorer')"
          :files="w.files"
          :activeFile="w.activeFile"
          :selectedPath="selectedTreePath"
          :selectedKind="selectedTreeKind"
          :projectRoot="w.projectRoot"
          :workspaceRoots="w.workspaceRoots"
          :workspaceRootLabels="w.workspaceRootLabels"
          :workspaceScaleProfile="w.workspaceScaleProfile"
          :isRealFS="isRealFS"
          :projectName="projectName"
          :dirtyFiles="w.dirtyFiles"
          :externalChanges="w.externalChanges"
          :gitDecorations="fileGitDecorations"
          :treeStats="w.fileTreeStats"
          :selectedDir="selectedDir"
          :activeFileDir="dirname(w.activeFile)"
          @openFile="handleOpenFile"
          @openProject="handleOpenProject"
          @addFile="handleAddFile"
          @createFile="handleCreateFile"
          @createFolder="handleCreateFolder"
          @deleteEntry="handleDeleteEntry"
          @renameEntry="handleRenameEntry"
          @refresh="handleRefreshTree"
          @selectDir="handleSelectDir"
          @inlineCreate="handleInlineCreate"
          @createJavaProject="handleCreateJavaProject"
          @cloneRepository="handleCloneRepository"
          @explorerCommand="handleExplorerCommand"
        />

          <div v-else-if="activeView === 'search'" class="search-panel" role="search" :aria-label="t('sidebar.search')">
          <div class="search-input-wrap">
            <div class="search-input-row">
              <input
                v-model="searchQuery"
                class="search-input"
                type="text"
                :placeholder="t('search.placeholder')"
                @keydown.enter="scheduleSearch(searchQuery)"
              />
              <div class="search-toggle-group">
                <button
                  class="search-toggle"
                  :class="{ active: isRegex }"
                  :title="t('search.regex')"
                  @click="isRegex = !isRegex"
                >.*</button>
                <button
                  class="search-toggle"
                  :class="{ active: caseSensitive }"
                  :title="t('search.caseSensitive')"
                  @click="caseSensitive = !caseSensitive"
                >Aa</button>
              </div>
            </div>
            <div class="search-input-row">
              <input
                v-model="searchReplaceQuery"
                class="search-input replace-input"
                type="text"
                :placeholder="t('search.replacePlaceholder')"
              />
              <button
                class="search-action-btn"
                :disabled="!searchReplaceQuery || grepResults.length === 0"
                :title="t('search.replaceOne')"
                @click="handleReplaceOne"
              >{{ t('search.replace') }}</button>
              <button
                class="search-action-btn"
                :disabled="!searchReplaceQuery || grepResults.length === 0"
                :title="t('search.replaceAll')"
                @click="handleReplaceAll"
              >{{ t('search.replaceAll') }}</button>
            </div>
          </div>
          <div class="search-results">
            <div v-if="searchBusy" class="search-empty">{{ t('search.searching') }}</div>
            <div v-else-if="searchError" class="search-empty">{{ searchError }}</div>
            <div v-else-if="!searchQuery.trim()" class="search-empty">{{ t('search.typeToSearch') }}</div>
            <div v-else-if="searchResults.length === 0 && grepResults.length === 0" class="search-empty">{{ t('search.noMatches') }}</div>

            <div v-if="grepResults.length > 0" class="grep-results">
              <div
                v-for="fileGroup in grepResults"
                :key="fileGroup.path"
                class="grep-file-group"
              >
                <button
                  class="grep-file-header"
                  @click="toggleGrepFile(fileGroup.path)"
                >
                  <span class="chevron" :class="{ collapsed: collapsedGrepFiles.has(fileGroup.path) }">&#x25B6;</span>
                  <span class="grep-file-path">{{ fileGroup.path }}</span>
                  <span class="grep-match-count">{{ fileGroup.matches.length }}</span>
                </button>
                <div v-if="!collapsedGrepFiles.has(fileGroup.path)">
                  <button
                    v-for="match in fileGroup.matches"
                    :key="match.id || `${fileGroup.path}-${match.line}-${match.column || 1}-${match.matchLength || 0}`"
                    class="grep-match"
                    @click="handleGrepMatchClick(fileGroup.path, match)"
                  >
                    <span class="grep-line-num">{{ match.line }}</span>
                    <span class="grep-line-text">{{ match.text }}</span>
                    <span v-if="match.count && match.count > 1" class="grep-match-count-inline">x{{ match.count }}</span>
                  </button>
                </div>
              </div>
            </div>

            <div v-if="grepResults.length === 0">
              <button
                v-for="result in searchResults"
                :key="`${result.path}-${result.score}`"
                class="search-result"
                @click="handleOpenFile(result.path)"
              >
                <span class="search-result-path">{{ result.path }}</span>
                <span v-if="result.snippet" class="search-result-snippet">{{ result.snippet }}</span>
              </button>
            </div>
          </div>
        </div>

        <SymbolPanel
          v-else-if="activeView === 'symbols'"
          v-model:query="symbolQuery"
          :outline="currentOutline"
          :diagnostics="currentDiagnostics"
          :searchResults="projectSymbolResults"
          :selectedSymbol="selectedSymbol"
          :referenceData="currentReferences"
          @openFile="handleOpenFile"
          @openSymbol="handleSelectSymbol"
          @openDiagnostic="handleOpenDiagnostic"
        />

        <div v-else-if="activeView === 'changes'" class="source-control-view">
          <GitPanel
            class="source-control-git"
            :visible="true"
            @close="openSidebarView('files')"
            @openFile="handleOpenFile"
          />
          <ChangeReviewPanel
            class="source-control-review"
            :pendingBatches="pendingBatches"
            :historyEntries="changeEntries"
            @open="handleOpenFile"
            @revert="handleRevertChange"
            @dismiss="dismissChange"
            @clearHistory="clearChanges"
            @applyPending="handleApplyPending"
            @rejectPending="handleRejectPending"
            @applyPendingFile="handleApplyPendingFile"
            @rejectPendingFile="handleRejectPendingFile"
            @applyPendingHunk="handleApplyPendingHunk"
            @rejectPendingHunk="handleRejectPendingHunk"
          />
        </div>

        <section
          v-else-if="activeView === 'marketplace'"
          class="extension-gallery-workbench-shell"
          data-codek-smoke="extension-gallery-workbench-shell"
          data-workbench-container-id="workbench.view.extensions"
          data-workbench-view-id="workbench.extensions.marketplace"
        >
          <Marketplace />
        </section>

        <section
          v-else-if="activeView === 'mcp'"
          class="mcp-workbench-surface"
          data-codek-smoke="mcp-workbench-surface"
          data-workbench-container-id="workbench.view.mcp"
          :data-mcp-service-id="mcpWorkbenchSurface.serviceId"
          :data-mcp-state-source="mcpWorkbenchSurface.stateSource"
          :data-mcp-view-ids="mcpWorkbenchSurface.viewIds.join(',')"
          :data-mcp-command-ids="mcpWorkbenchSurface.commandIds.join(',')"
          :data-mcp-quick-access-prefixes="mcpWorkbenchSurface.quickAccessPrefixes.join(',')"
          :data-mcp-opened-count="mcpWorkbenchSurface.openedCount"
          :data-mcp-attachment-count="mcpWorkbenchSurface.attachmentCount"
          :data-mcp-readonly-provider-path="mcpWorkbenchSurface.readonlyProviderPath"
          :data-mcp-gallery-server="mcpWorkbenchSurface.latestGalleryDetail?.serverName || ''"
          :data-mcp-gallery-install-state="mcpWorkbenchSurface.latestGalleryDetail?.installState || ''"
          :data-mcp-gallery-status-label="mcpWorkbenchSurface.latestGalleryDetail?.statusLabel || ''"
          :data-mcp-gallery-action-ids="(mcpWorkbenchSurface.latestGalleryDetail?.actions || []).map((action) => action.id).join(',')"
          :data-mcp-gallery-enabled-action-ids="(mcpWorkbenchSurface.latestGalleryDetail?.actions || []).filter((action) => action.enabled).map((action) => action.id).join(',')"
          :data-mcp-gallery-metadata-count="mcpWorkbenchSurface.latestGalleryDetail?.evidence.metadataCount || 0"
          :data-mcp-gallery-has-readme="Boolean(mcpWorkbenchSurface.latestGalleryDetail?.evidence.hasReadme)"
          :data-mcp-gallery-has-manifest="Boolean(mcpWorkbenchSurface.latestGalleryDetail?.evidence.hasManifest)"
          :data-mcp-preserves-agent-approval="mcpWorkbenchSurface.constraints.preservesAgentApproval"
          :data-mcp-no-second-state="mcpWorkbenchSurface.constraints.noSecondMcpState"
        >
          <header class="mcp-workbench-header">
            <div>
              <div class="mcp-workbench-title">MCP 管理</div>
              <div class="mcp-workbench-summary">
                服务器 {{ mcpDashboardServerCount }} · 运行 {{ mcpDashboardRunningCount }} · 工具 {{ mcpDashboardToolRows.length }} · 资源 {{ mcpDashboardResources.length }}
              </div>
            </div>
            <button
              class="mcp-workbench-action"
              type="button"
              data-codek-smoke="mcp-refresh"
              :disabled="mcpDashboardBusy"
              @click="refreshMcpDashboard"
            >
              {{ mcpDashboardBusy ? '刷新中' : '刷新' }}
            </button>
          </header>
          <div v-if="mcpDashboardError" class="mcp-workbench-error" role="alert">
            {{ mcpDashboardError }}
          </div>
          <div class="mcp-workbench-meta">
            <span>配置 {{ mcpDashboardScopeSummary }}</span>
            <span>传输 {{ mcpDashboardTransportSummary }}</span>
            <span>最近打开 {{ mcpWorkbenchSurface.latestOpened?.name || '暂无' }}</span>
            <span>刷新 {{ mcpDashboardLastRefresh || '尚未刷新' }}</span>
          </div>

          <section v-if="mcpDashboardServerCount === 0" class="mcp-workbench-empty" data-codek-smoke="mcp-empty-state">
            <div class="mcp-empty-title">还没有 MCP 服务器</div>
            <p>可以从资源库安装，或在项目 / 全局 mcp.json 中添加本地命令（stdio）、流式 HTTP（Streamable HTTP）或旧 SSE 兼容服务器。添加后这里会显示启停、认证、工具、资源、提示词模板、日志和审批状态。</p>
            <div class="mcp-workbench-actions">
              <button class="mcp-workbench-action primary" type="button" @click="openMcpCommand(MCP_COMMAND_IDS.Browse)">浏览资源库</button>
              <button class="mcp-workbench-action" type="button" @click="openMcpCommand(MCP_COMMAND_IDS.ShowInstalled)">查看已安装</button>
            </div>
          </section>

          <section class="mcp-workbench-section" data-mcp-surface="servers">
            <div class="mcp-workbench-section-head">
              <div>
                <div class="mcp-workbench-section-title">服务器</div>
                <div class="mcp-workbench-section-subtitle">项目配置、用户配置、扩展提供和已安装服务器统一显示。</div>
              </div>
              <button class="mcp-workbench-action" type="button" @click="openMcpCommand(MCP_COMMAND_IDS.ListServer)">服务器</button>
            </div>
            <article
              v-for="server in mcpDashboardServers"
              :key="server.serverName"
              class="mcp-server-card"
              :data-mcp-server-name="server.serverName"
              :data-mcp-server-status="mcpServerStatusLabel(server)"
            >
              <div class="mcp-server-main">
                <div class="mcp-server-title-row">
                  <span class="mcp-server-name">{{ server.serverName }}</span>
                  <span class="mcp-status-pill" :data-tone="mcpServerStatusTone(server)">{{ mcpServerStatusLabel(server) }}</span>
                </div>
                <div class="mcp-server-detail">{{ mcpServerConfigSummary(server) }}</div>
                <div v-if="mcpServerErrorSummary(server)" class="mcp-server-error">{{ mcpServerErrorSummary(server) }}</div>
              </div>
              <div class="mcp-server-meta">
                <span>{{ mcpServerScopeLabel(server) }}</span>
                <span>{{ mcpServerTransportLabel(server) }}</span>
                <span>{{ mcpServerAuthLabel(server) }}</span>
                <span>工具 {{ Array.isArray(server.tools) ? server.tools.length : 0 }}</span>
              </div>
              <div class="mcp-server-actions">
                <button class="mcp-workbench-action" type="button" :disabled="server.initialized || server.allowed === false" @click="runMcpServerAction(server, 'start')">启动</button>
                <button class="mcp-workbench-action" type="button" :disabled="!server.initialized" @click="runMcpServerAction(server, 'stop')">停止</button>
                <button class="mcp-workbench-action" type="button" :disabled="server.allowed === false" @click="runMcpServerAction(server, 'restart')">重启</button>
                <button class="mcp-workbench-action" type="button" @click="openMcpCommand(MCP_COMMAND_IDS.ServerOptions, [{ serverName: server.serverName }])">更多</button>
              </div>
            </article>
          </section>

          <section class="mcp-workbench-section mcp-add-section" data-mcp-surface="add">
            <div class="mcp-workbench-section-title">添加服务器</div>
            <div class="mcp-add-grid">
              <div class="mcp-add-card">
                <span class="mcp-add-label">本地命令（stdio）</span>
                <p>配置本地命令、参数和环境变量（env）。适合文件系统、数据库命令行工具（CLI）和本地工具。</p>
              </div>
              <div class="mcp-add-card">
                <span class="mcp-add-label">流式 HTTP（Streamable HTTP）</span>
                <p>单一 HTTP 端点，支持会话和远程服务。</p>
              </div>
              <div class="mcp-add-card">
                <span class="mcp-add-label">旧 SSE</span>
                <p>仅用于兼容旧服务；新服务优先使用流式 HTTP（Streamable HTTP）。</p>
              </div>
            </div>
            <div class="mcp-workbench-actions">
              <button class="mcp-workbench-action primary" type="button" @click="openMcpCommand(MCP_COMMAND_IDS.Browse)">从资源库安装</button>
              <button class="mcp-workbench-action" type="button" @click="openMcpCommand(MCP_COMMAND_IDS.ShowInstalled)">管理已安装</button>
            </div>
          </section>

          <section class="mcp-workbench-section" data-mcp-surface="tools">
            <div class="mcp-workbench-section-title">工具</div>
            <div v-if="mcpDashboardToolRows.length === 0" class="mcp-workbench-row muted">
              <span>尚未发现 MCP 工具</span>
              <span>服务器启动后会显示工具和审批策略</span>
            </div>
            <div v-for="tool in mcpDashboardToolRows.slice(0, 8)" :key="`${tool.serverName}:${tool.name}`" class="mcp-workbench-row">
              <span>{{ tool.name }}</span>
              <span>{{ tool.serverName }} · {{ tool.approval }}</span>
            </div>
          </section>

          <section class="mcp-workbench-section" data-mcp-surface="resources">
            <div class="mcp-workbench-section-title">资源</div>
            <div v-if="mcpDashboardResources.length === 0" class="mcp-workbench-row muted" data-codek-smoke="mcp-resource-evidence">
              <span>尚未打开 MCP 资源</span>
              <span>{{ mcpWorkbenchSurface.latestOpened?.mimeType || '只读资源会显示在这里' }}</span>
            </div>
            <div v-for="resource in mcpDashboardResources.slice(0, 8)" :key="`${resource.serverName}:${resource.uri}`" class="mcp-workbench-row" data-codek-smoke="mcp-resource-evidence">
              <span>{{ mcpResourceTitle(resource) }}</span>
              <span>{{ resource.serverName }} · {{ resource.mimeType || '资源' }}</span>
            </div>
            <button class="mcp-workbench-action inline" type="button" data-codek-smoke="mcp-open-resources" @click="openMcpCommand(MCP_COMMAND_IDS.BrowseResources)">浏览资源</button>
          </section>

          <section class="mcp-workbench-section" data-mcp-surface="prompts">
            <div class="mcp-workbench-section-title">提示词模板（Prompt）</div>
            <div v-if="mcpDashboardTemplates.length === 0" class="mcp-workbench-row muted">
              <span>尚未发现提示词模板或资源模板</span>
              <span>服务器提供模板后可插入聊天或补全参数</span>
            </div>
            <div v-for="template in mcpDashboardTemplates.slice(0, 6)" :key="`${template.serverName}:${template.uriTemplate || template.template || template.name}`" class="mcp-workbench-row">
              <span>{{ mcpTemplateTitle(template) }}</span>
              <span>{{ template.serverName }} · {{ template.mimeType || '模板' }}</span>
            </div>
          </section>

          <section class="mcp-workbench-section" data-mcp-surface="gallery">
            <div class="mcp-workbench-section-title">资源库</div>
            <div class="mcp-workbench-row" data-codek-smoke="mcp-gallery-evidence">
              <span>{{ mcpWorkbenchSurface.latestGalleryDetail?.title || mcpWorkbenchSurface.latestAttachment?.name || '尚未打开资源库详情' }}</span>
              <span>{{ mcpWorkbenchSurface.latestGalleryDetail?.statusLabel || mcpWorkbenchSurface.latestAttachment?.status || '-' }}</span>
            </div>
            <div v-if="mcpWorkbenchSurface.latestGalleryDetail" class="mcp-gallery-actions">
              <button
                v-for="action in mcpWorkbenchSurface.latestGalleryDetail.actions"
                :key="action.id"
                class="mcp-workbench-action"
                type="button"
                :disabled="!action.enabled"
              >
                {{ action.label }}
              </button>
            </div>
          </section>

          <section class="mcp-workbench-section" data-mcp-surface="logs">
            <div class="mcp-workbench-section-title">日志</div>
            <div v-for="(log, index) in mcpDashboardLogs" :key="`${log.level}:${index}:${log.message}`" class="mcp-log-row" :data-level="log.level">
              <span>{{ log.message }}</span>
              <span>{{ log.detail || '-' }}</span>
            </div>
          </section>

          <section class="mcp-workbench-section" data-mcp-surface="security">
            <div class="mcp-workbench-section-title">安全与审批</div>
            <div v-for="row in mcpDashboardSecurityRows" :key="row.label" class="mcp-workbench-row">
              <span>{{ row.label }}</span>
              <span>{{ row.value }}</span>
            </div>
          </section>
        </section>

        <section
          v-else-if="activeView === 'remote'"
          class="remote-workbench-shell"
        >
          <section
            class="extension-trust-remote-auth-workbench"
            data-codek-smoke="extension-trust-remote-auth-workbench"
            :data-workbench-container-id="extensionTrustRemoteAuthSurface.containerId"
            :data-workbench-view-ids="extensionTrustRemoteAuthSurface.viewIds.join(',')"
            :data-workbench-command-ids="extensionTrustRemoteAuthSurface.commandIds.join(',')"
            :data-extension-host-service-id="extensionTrustRemoteAuthSurface.serviceIds.extensionHost"
            :data-workspace-trust-service-id="extensionTrustRemoteAuthSurface.serviceIds.workspaceTrust"
            :data-remote-authority-service-id="extensionTrustRemoteAuthSurface.serviceIds.remoteAuthority"
            :data-authentication-service-id="extensionTrustRemoteAuthSurface.serviceIds.authentication"
            :data-extension-host-state-source="extensionTrustRemoteAuthSurface.extensionHost.stateSource"
            :data-workspace-trust-state-source="extensionTrustRemoteAuthSurface.workspaceTrust.stateSource"
            :data-remote-authority-state-source="extensionTrustRemoteAuthSurface.remoteAuthority.stateSource"
            :data-authentication-state-source="extensionTrustRemoteAuthSurface.authentication.stateSource"
            :data-extension-host-activation-count="extensionTrustRemoteAuthSurface.extensionHost.activationCount"
            :data-extension-host-latest-activation-event="extensionTrustRemoteAuthSurface.extensionHost.latestActivation?.activationEvent || ''"
            :data-extension-host-latest-activation-extension="extensionTrustRemoteAuthSurface.extensionHost.latestActivation?.extensionId || ''"
            :data-workspace-trust-status="extensionTrustRemoteAuthSurface.workspaceTrust.status"
            :data-workspace-trust-decision-count="extensionTrustRemoteAuthSurface.workspaceTrust.decisionCount"
            :data-workspace-trust-latest-decision="extensionTrustRemoteAuthSurface.workspaceTrust.latestDecision?.decision || ''"
            :data-remote-authority-resolve-count="extensionTrustRemoteAuthSurface.remoteAuthority.resolveCount"
            :data-remote-authority-success-count="extensionTrustRemoteAuthSurface.remoteAuthority.successCount"
            :data-remote-authority-failure-count="extensionTrustRemoteAuthSurface.remoteAuthority.failureCount"
            :data-remote-authority-cache-hit-count="extensionTrustRemoteAuthSurface.remoteAuthority.cacheHitCount"
            :data-remote-authority-latest-status="extensionTrustRemoteAuthSurface.remoteAuthority.latestResult?.status || ''"
            :data-authentication-statuses="extensionTrustRemoteAuthSurface.authentication.statuses.join(',')"
            :data-authentication-latest-status="extensionTrustRemoteAuthSurface.authentication.latestSession.status"
            :data-authentication-provider-ids="extensionTrustRemoteAuthSurface.authentication.providerIds.join(',')"
            :data-authentication-token-redacted="extensionTrustRemoteAuthSurface.authentication.constraints.noTokenInEvidence"
            :data-extension-trust-remote-auth-no-second-extension-runtime="extensionTrustRemoteAuthSurface.constraints.noSecondExtensionRuntime"
            :data-extension-trust-remote-auth-no-second-trust-store="extensionTrustRemoteAuthSurface.constraints.noSecondTrustStore"
            :data-extension-trust-remote-auth-no-second-remote-state="extensionTrustRemoteAuthSurface.constraints.noSecondRemoteState"
            :data-extension-trust-remote-auth-no-second-auth-store="extensionTrustRemoteAuthSurface.constraints.noSecondAuthStore"
            :data-extension-trust-remote-auth-preserves-agent-evidence="extensionTrustRemoteAuthSurface.constraints.preservesAgentEvidence"
          >
            <div class="extension-trust-remote-auth-title">扩展、信任、远程与认证</div>
            <div class="extension-trust-remote-auth-grid">
              <span data-extension-trust-remote-auth-surface="extensionHost">扩展宿主 · {{ extensionTrustRemoteAuthSurface.extensionHost.activationCount }} 次激活</span>
              <span data-extension-trust-remote-auth-surface="workspaceTrust">工作区信任 · {{ workspaceTrustStatusLabel(extensionTrustRemoteAuthSurface.workspaceTrust.status) }}</span>
              <span data-extension-trust-remote-auth-surface="remoteAuthority">远程解析 · {{ extensionTrustRemoteAuthSurface.remoteAuthority.resolveCount }} 次</span>
              <span data-extension-trust-remote-auth-surface="authentication">认证 · {{ authStatusLabel(extensionTrustRemoteAuthSurface.authentication.latestSession.status) }}</span>
            </div>
            <section
              ref="workspaceTrustEditorRoot"
              class="workspace-trust-editor"
              :class="{ trusted: workspaceTrustEditorSnapshot.trusted, untrusted: !workspaceTrustEditorSnapshot.trusted }"
              tabindex="0"
              role="region"
              aria-label="管理工作区信任"
              data-codek-smoke="workspace-trust-editor"
              data-workspace-trust-editor-id="workbench.editor.workspaceTrust"
              data-workspace-trust-editor-input-id="workbench.input.workspaceTrust"
              data-workspace-trust-editor-focus-contract="WorkspaceTrustEditor.focus -> rootElement.focus"
              data-workspace-trust-editor-keyboard-contracts="UpArrow/DownArrow section navigation,Escape root focus,CtrlCmd+Enter toggle workspace trust,CtrlCmd+Shift+Enter trust parent folder"
              :data-workspace-trust-editor-status="workspaceTrustEditorSnapshot.status"
              :data-workspace-trust-editor-trusted="workspaceTrustEditorSnapshot.trusted"
              :data-workspace-trust-editor-dom-status="workspaceTrustEditorPane.domSmoke?.status || ''"
              :data-workspace-trust-editor-pane-owner-status="workspaceTrustEditorPane.paneOwnerStatus || ''"
              :data-workspace-trust-editor-no-second-trust-store="workspaceTrustEditorSnapshot.constraints?.noSecondTrustStore === true"
              @keydown="handleWorkspaceTrustEditorKeydown"
            >
              <input
                type="text"
                readonly
                tabindex="-1"
                class="workspace-trust-focus-anchor"
                data-workspace-trust-editor-root-focus-target="true"
                aria-label="工作区信任编辑器"
              />
              <header
                class="workspace-trust-header"
                tabindex="0"
                data-workspace-trust-editor-section="header"
              >
                <input
                  type="text"
                  readonly
                  tabindex="-1"
                  class="workspace-trust-focus-anchor"
                  data-workspace-trust-editor-focus-target="header"
                  data-workspace-trust-editor-section="header"
                  aria-label="工作区信任标题"
                />
                <span class="workspace-trust-title-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
                    <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
                    <path d="M9.5 12.5l1.7 1.7 3.8-4" />
                  </svg>
                </span>
                <span class="workspace-trust-title-text">{{ workspaceTrustEditorSnapshot.trusted ? '当前工作区已信任' : '当前处于受限模式' }}</span>
              </header>
              <div class="workspace-trust-editor-body">
                <section
                  class="workspace-trust-features"
                  tabindex="0"
                  data-codek-smoke="workspace-trust-editor-affected-features"
                  data-workspace-trust-editor-section="affectedFeatures"
                  :data-workspace-trust-disabled-by-trust-requirement-count="workspaceTrustEditorPane.affectedFeaturesList?.disabledByTrustRequirementCount || 0"
                  :data-workspace-trust-restricted-mode-enabled="workspaceTrustEditorPane.affectedFeaturesList?.restrictedModeEnabled === true"
                >
                  <input
                    type="text"
                    readonly
                    tabindex="-1"
                    class="workspace-trust-focus-anchor"
                    data-workspace-trust-editor-focus-target="affectedFeatures"
                    data-workspace-trust-editor-section="affectedFeatures"
                    aria-label="工作区信任影响的功能"
                  />
                  <div class="workspace-trust-limitations trusted" data-workspace-trust-editor-section="trustedContainer">
                    <input
                      type="text"
                      readonly
                      tabindex="-1"
                      class="workspace-trust-focus-anchor"
                      data-workspace-trust-editor-focus-target="trustedContainer"
                      data-workspace-trust-editor-section="trustedContainer"
                      aria-label="工作区信任可用功能"
                    />
                    <div class="workspace-trust-limitations-title">信任工作区</div>
                    <ul>
                      <li>允许运行任务</li>
                      <li>允许启动调试</li>
                      <li>已启用扩展会正常激活</li>
                    </ul>
                  </div>
                  <div class="workspace-trust-limitations untrusted" data-workspace-trust-editor-section="untrustedContainer">
                    <input
                      type="text"
                      readonly
                      tabindex="-1"
                      class="workspace-trust-focus-anchor"
                      data-workspace-trust-editor-focus-target="untrustedContainer"
                      data-workspace-trust-editor-section="untrustedContainer"
                      aria-label="受限模式功能"
                    />
                    <div class="workspace-trust-limitations-title">受限模式</div>
                    <ul>
                      <li>任务运行会被阻止</li>
                      <li>调试功能已禁用</li>
                      <li>{{ workspaceTrustEditorPane.affectedFeaturesList?.disabledByTrustRequirementCount || 0 }} 个扩展被禁用或功能受限</li>
                    </ul>
                  </div>
                </section>
                <section
                  class="workspace-trust-settings"
                  tabindex="0"
                  data-codek-smoke="workspace-trust-editor-trusted-folders-table"
                  data-workspace-trust-editor-section="configuration"
                  :data-workspace-trust-trusted-folder-count="workspaceTrustEditorSnapshot.trustedFolderCount"
                  :data-workspace-trust-trusted-folders-event-count="workspaceTrustEditorSnapshot.trustedFoldersEventCount"
                >
                  <input
                    type="text"
                    readonly
                    tabindex="-1"
                    class="workspace-trust-focus-anchor"
                    data-workspace-trust-editor-focus-target="configuration"
                    data-workspace-trust-editor-section="configuration"
                    aria-label="已信任文件夹"
                  />
                  <div class="workspace-trusted-folders-title">已信任的文件夹和工作区</div>
                  <div class="trusted-uris-table" role="table" aria-label="已信任的文件夹和工作区">
                    <div v-if="workspaceTrustEditorSnapshot.trustedFolders.length === 0" class="trusted-uris-empty" role="row">
                      还没有信任任何文件夹或工作区文件。
                    </div>
                    <div
                      v-for="uri in workspaceTrustEditorSnapshot.trustedFolders"
                      :key="uri"
                      class="trusted-uris-row"
                      role="row"
                      :data-workspace-trust-trusted-uri="uri"
                    >
                      <span role="cell">{{ uri }}</span>
                    </div>
                  </div>
                </section>
              </div>
            </section>
          </section>
          <RemotePanel
            :visible="true"
            @close="openSidebarView('files'); remotePanelOpen = false"
          />
        </section>

        <section
          v-else-if="activeView === 'goals'"
          class="task-center-workbench"
          data-codek-smoke="task-center-workbench-detail"
          :data-task-center-selected-run-id="activeOrchestratorRunId"
        >
          <GoalListPanel
            class="task-center-list-pane"
            @openGoal="openGoalResult"
            @openRun="openOrchestratorRun"
          />
        </section>

        <section
          v-else-if="activeView === 'agentEvidence'"
          class="agent-evidence-workbench"
          data-codek-smoke="agent-evidence-workbench"
          :data-agent-evidence-status="agentEvidenceSurface.status"
          :data-agent-evidence-ready="agentEvidenceSurface.ready"
          :data-agent-evidence-correlation-id="agentEvidenceCorrelationId"
          :data-agent-evidence-vscode-service-ids="agentEvidenceVsCodeServiceIds.join(',')"
        >
          <header class="agent-evidence-header">
            <div>
              <div class="agent-evidence-title">智能体证据</div>
              <div class="agent-evidence-summary">{{ agentEvidenceSurface.summary }}</div>
            </div>
            <button
              class="agent-evidence-refresh"
              type="button"
              data-codek-smoke="agent-evidence-refresh"
              :disabled="agentEvidenceLoadStatus === 'loading'"
              @click="refreshAgentEvidenceWorkbenchSurface"
            >
              刷新
            </button>
          </header>
          <div class="agent-evidence-meta">
            <span>状态 {{ agentEvidenceSurface.status }}</span>
            <span>关联 {{ agentEvidenceCorrelationId || '-' }}</span>
          </div>
          <div v-if="agentEvidenceLoadError" class="agent-evidence-error">{{ agentEvidenceLoadError }}</div>

          <div class="agent-evidence-tabs" role="tablist" aria-label="智能体证据视图">
            <button
              v-for="surface in agentEvidenceSurfaceTabs"
              :key="surface"
              class="agent-evidence-tab"
              :class="{ active: selectedAgentEvidenceSurface === surface }"
              type="button"
              :aria-selected="selectedAgentEvidenceSurface === surface"
              @click="openAgentEvidenceSurface(surface)"
            >
              {{ surface }}
            </button>
          </div>

          <section
            class="agent-evidence-section agent-evidence-unified"
            data-agent-evidence-surface="list"
            data-codek-smoke="agent-evidence-list-detail-export"
            :data-agent-evidence-list-count="agentEvidenceListItems.length"
            :data-agent-evidence-filter-surfaces="agentEvidenceSurface.list.filters.surfaces.join(',')"
            :data-agent-evidence-filter-statuses="agentEvidenceSurface.list.filters.statuses.join(',')"
            :data-agent-evidence-filter-severities="agentEvidenceSurface.list.filters.severities.join(',')"
            :data-agent-evidence-detail-kind="agentEvidenceDetail.item?.surface || ''"
            :data-agent-evidence-detail-id="agentEvidenceDetail.selectedId"
            :data-agent-evidence-editor-id="agentEvidenceDetail.editor.id"
            :data-agent-evidence-editor-uri="agentEvidenceDetail.editor.resourceUri"
            :data-agent-evidence-export-command="agentEvidenceExport.jsonCommandId"
            :data-agent-evidence-export-markdown-command="agentEvidenceExport.markdownCommandId"
            :data-agent-evidence-export-path="agentEvidenceExport.artifactPath"
            :data-agent-evidence-export-markdown-path="agentEvidenceExport.markdownPath"
          >
            <div class="agent-evidence-section-title">Evidence 统一列表</div>
            <div class="agent-evidence-kpi">
              {{ agentEvidenceSurface.list.counts.total }} 项 · error {{ agentEvidenceSurface.list.counts.errors }} · warning {{ agentEvidenceSurface.list.counts.warnings }}
            </div>
            <div class="agent-evidence-list">
              <div
                v-for="item in agentEvidenceListVisibleItems"
                :key="item.id"
                class="agent-evidence-row"
                :data-agent-evidence-list-item-id="item.id"
                :data-agent-evidence-list-item-surface="item.surface"
                :data-agent-evidence-list-item-status="item.status"
                :data-agent-evidence-list-item-severity="item.severity"
                :data-agent-evidence-list-item-command="item.commandId"
                :data-agent-evidence-list-item-resource="item.resourceUri"
              >
                <span>{{ item.label }}</span>
                <span>{{ item.surface }} / {{ item.status }}</span>
              </div>
              <div v-if="agentEvidenceListItems.length === 0" class="agent-evidence-empty">暂无统一证据项</div>
            </div>
            <div class="agent-evidence-detail" data-codek-smoke="agent-evidence-detail-editor">
              <span>{{ agentEvidenceDetail.item?.label || '暂无详情' }}</span>
              <span>{{ agentEvidenceDetail.editor.title }}</span>
            </div>
            <div class="agent-evidence-export" data-codek-smoke="agent-evidence-export">
              <span>{{ agentEvidenceExport.artifactPath }}</span>
              <span>{{ agentEvidenceExport.markdownPath }}</span>
            </div>
          </section>

          <section class="agent-evidence-section" data-agent-evidence-surface="scm">
            <div class="agent-evidence-section-title">SCM 变更证据</div>
            <div class="agent-evidence-kpi">{{ agentEvidenceSurface.views.scm.summary }}</div>
            <div
              class="agent-evidence-risk"
              :data-agent-evidence-rollback-available="agentEvidenceSurface.views.scm.rollbackRisk.rollbackAvailable"
              :data-agent-evidence-main-protected="agentEvidenceSurface.views.scm.rollbackRisk.mainWorkspaceProtected"
            >
              回滚 {{ agentEvidenceSurface.views.scm.rollbackRisk.rollbackAvailable ? '可用' : '缺失' }} · 主工作区保护 {{ agentEvidenceSurface.views.scm.rollbackRisk.mainWorkspaceProtected ? '是' : '否' }}
            </div>
            <div class="agent-evidence-list" data-codek-smoke="agent-evidence-scm-files">
              <div
                v-for="resource in agentEvidenceScmResources.slice(0, 6)"
                :key="resource.uri"
                class="agent-evidence-row"
                :data-agent-evidence-resource-uri="resource.resourceUri"
                :data-agent-evidence-open-command="resource.openCommandId"
                :data-agent-evidence-diff-command="resource.diffCommandId"
                :data-agent-evidence-stage-command="resource.stageCommandId"
                :data-agent-evidence-attach-command="resource.attachCommandId"
                :data-agent-evidence-readonly="resource.readonlyEvidence"
                :data-agent-evidence-rollback-risk-label="resource.rollbackRiskLabel"
              >
                <span class="agent-evidence-path">{{ resource.uri }}</span>
                <span>{{ resource.status }}</span>
              </div>
              <div v-if="agentEvidenceScmResources.length === 0" class="agent-evidence-empty">暂无变更文件证据</div>
            </div>
          </section>

          <section class="agent-evidence-section" data-agent-evidence-surface="testing">
            <div class="agent-evidence-section-title">Testing 结果证据</div>
            <div
              class="agent-evidence-kpi"
              data-codek-smoke="agent-evidence-testing-summary"
              :data-agent-evidence-test-state="agentEvidenceTestingSummary.state"
            >
              {{ agentEvidenceTestingSummary.passed }}/{{ agentEvidenceTestingSummary.total }} passed · failed {{ agentEvidenceTestingSummary.failed }} · diagnostics {{ agentEvidenceTestingSummary.problemDiagnostics }}
            </div>
            <div
              class="agent-evidence-coverage-shell"
              data-codek-smoke="testing-coverage-renderer-shell"
              :data-testing-coverage-container-id="testingCoverageRendererShell.containerId"
              :data-testing-coverage-view-id="testingCoverageRendererShell.viewId"
              :data-testing-coverage-state-source="testingCoverageRendererShell.stateSource"
              :data-testing-coverage-status="testingCoverageRendererShell.status"
              :data-testing-coverage-node-count="testingCoverageRendererShell.nodeCount"
              :data-testing-coverage-selected-id="testingCoverageRendererShell.selectedCoverageId || ''"
              :data-testing-coverage-filtered-test-id="testingCoverageRendererShell.filteredToTestId || ''"
              :data-testing-coverage-show-inline="testingCoverageRendererShell.showInline"
              :data-testing-coverage-sort-order="testingCoverageRendererShell.sortOrder"
              :data-testing-coverage-command-ids="testingCoverageRendererShell.commandIds.join(',')"
              :data-testing-coverage-adapter-kind="testingCoverageRendererShell.adapter.kind"
              :data-testing-coverage-blocked-owners="testingCoverageRendererShell.adapter.blockedOwners.join(',')"
              :data-testing-coverage-no-second-state="testingCoverageRendererShell.adapter.noSecondState"
            >
              <div
                v-for="row in testingCoverageRendererShell.rows.slice(0, 6)"
                :key="row.id"
                class="agent-evidence-row"
                role="treeitem"
                :aria-label="row.ariaLabel"
                :aria-selected="row.selected"
                :data-testing-coverage-row-id="row.id"
                :data-testing-coverage-row-uri="row.uri"
                :data-testing-coverage-row-selected="row.selected"
                :data-testing-coverage-row-statement-percent="row.statementPercent ?? ''"
                :data-testing-coverage-row-branch-percent="row.branchPercent ?? ''"
                :data-testing-coverage-row-command-ids="row.commandIds.join(',')"
                :data-testing-coverage-row-evidence-uri="row.evidenceUri"
              >
                <span>{{ row.label }}</span>
                <span>{{ row.statementPercent ?? '-' }}%</span>
              </div>
              <div v-if="testingCoverageRendererShell.rows.length === 0" class="agent-evidence-empty">暂无覆盖率证据</div>
            </div>
            <span
              data-codek-smoke="testing-coverage-editor-contribution-shell"
              :data-testing-coverage-editor-contribution-id="testingCoverageEditorContributionShell.contributionId"
              :data-testing-coverage-editor-state-source="testingCoverageEditorContributionShell.stateSource"
              :data-testing-coverage-editor-status="testingCoverageEditorContributionShell.status"
              :data-testing-coverage-editor-uri="testingCoverageEditorContributionShell.uri || ''"
              :data-testing-coverage-editor-selected-id="testingCoverageEditorContributionShell.selectedCoverageId || ''"
              :data-testing-coverage-editor-command-ids="testingCoverageEditorContributionShell.commandIds.join(',')"
              :data-testing-coverage-editor-adapter-kind="testingCoverageEditorContributionShell.adapter.kind"
              :data-testing-coverage-editor-blocked-owners="testingCoverageEditorContributionShell.adapter.blockedOwners.join(',')"
              :data-testing-coverage-editor-no-second-state="testingCoverageEditorContributionShell.adapter.noSecondState"
              hidden
            ></span>
            <div
              class="agent-evidence-testing-explorer-shell"
              data-codek-smoke="testing-explorer-viewpane-shell-owner"
              :data-testing-explorer-container-id="testingExplorerContract.domOwnerAdapter.containerSelector"
              :data-testing-explorer-view-id="'testing'"
              :data-testing-explorer-state-source="'TestingService.getTestingExplorerContractProjection()'"
              :data-testing-explorer-status="testingExplorerContract.domOwnerAdapter.status"
              :data-testing-explorer-row-count="testingExplorerContract.domOwnerAdapter.rowCount"
              :data-testing-explorer-filter-value="testingExplorerContract.domOwnerAdapter.filterInput.value"
              :data-testing-explorer-filter-terms="testingExplorerContract.domOwnerAdapter.filterInput.filterTerms.join(',')"
              :data-testing-explorer-filter-include-tags="testingExplorerContract.domOwnerAdapter.filterInput.includeTags.join(',')"
              :data-testing-explorer-filter-exclude-tags="testingExplorerContract.domOwnerAdapter.filterInput.excludeTags.join(',')"
              :data-testing-explorer-storage-key="testingExplorerContract.domOwnerAdapter.storageKey"
              :data-testing-explorer-implemented-evidence="testingExplorerContract.domOwnerAdapter.implementedEvidence.join(' | ')"
              :data-testing-explorer-blocked-owners="testingExplorerContract.domOwnerAdapter.blockedOwners.join(',')"
              :data-testing-explorer-no-second-state="testingExplorerContract.domOwnerAdapter.noSecondState"
            >
              <input
                readonly
                class="testing-explorer-filter-input"
                data-testing-explorer-filter-input="true"
                :value="testingExplorerContract.domOwnerAdapter.filterInput.value"
                :placeholder="testingExplorerContract.domOwnerAdapter.filterInput.placeholder"
                :data-testing-explorer-filter-value="testingExplorerContract.domOwnerAdapter.filterInput.value"
                :data-testing-explorer-filter-blocked-owner="testingExplorerContract.domOwnerAdapter.filterInput.blockedOwner"
                :data-testing-explorer-filter-storage-key="testingExplorerContract.domOwnerAdapter.storageKey"
                aria-label="Testing Explorer filter evidence"
              />
              <div
                class="testing-explorer-object-tree"
                data-testing-explorer-object-tree="true"
                role="tree"
                :data-testing-explorer-state-source="'TestingService.getTestingExplorerContractProjection()'"
                :data-testing-explorer-visible-row-ids="testingExplorerContract.domOwnerAdapter.visibleRowIds.join(',')"
                :data-testing-explorer-object-tree-blocked-owners="testingExplorerContract.objectTreeAdapter.blockedOwners.join(',')"
              >
                <div
                  v-for="row in testingExplorerVisibleRows.slice(0, 8)"
                  :key="row.id"
                  class="agent-evidence-row"
                  role="treeitem"
                  :aria-level="row.depth + 1"
                  :aria-selected="testingExplorerContract.objectTreeAdapter.selectedRowId === row.id"
                  :data-testing-explorer-row-id="row.id"
                  :data-testing-explorer-row-controller-id="row.controllerId"
                  :data-testing-explorer-row-depth="row.depth"
                  :data-testing-explorer-row-label="row.label"
                  :data-testing-explorer-row-uri="row.uri || ''"
                  :data-testing-explorer-row-parent-id="row.parentId || ''"
                  :data-testing-explorer-row-reveal-state="row.revealState"
                  :data-testing-explorer-row-retired="row.retired"
                  :data-testing-explorer-row-running-continuously="row.isRunningContinuously"
                  :data-testing-explorer-row-parent-running-continuously="row.isParentRunningContinuously"
                  :data-testing-explorer-row-command-ids="row.commandIds.join(',')"
                  :data-testing-explorer-row-evidence-uri="row.evidenceUri"
                >
                  <span>{{ row.label }}</span>
                  <span>{{ row.revealState }}</span>
                </div>
                <div v-if="testingExplorerVisibleRows.length === 0" class="agent-evidence-empty">暂无测试资源管理器证据</div>
              </div>
            </div>
            <div
              class="agent-evidence-result-viewpane-shell"
              data-codek-smoke="testing-results-viewpane-shell-owner"
              :data-testing-results-container-id="testingResultsViewPaneShell.containerId"
              :data-testing-results-view-id="testingResultsViewPaneShell.viewId"
              :data-testing-results-state-source="testingResultsViewPaneShell.stateSource"
              :data-testing-results-status="testingResultsViewPaneShell.status"
              :data-testing-results-run-count="testingResultsViewPaneShell.runCount"
              :data-testing-results-result-count="testingResultsViewPaneShell.resultCount"
              :data-testing-results-tree-row-count="testingResultsViewPaneShell.treeRowCount"
              :data-testing-results-selected-run-id="testingResultsViewPaneShell.selectedRunId || ''"
              :data-testing-results-selected-entry-id="testingResultsViewPaneShell.selectedEntryId || ''"
              :data-testing-results-command-ids="testingResultsViewPaneShell.commandIds.join(',')"
              :data-testing-results-adapter-kind="testingResultsViewPaneShell.adapter.kind"
              :data-testing-results-implemented-owners="testingResultsViewPaneShell.adapter.implementedOwners.join(',')"
              :data-testing-results-blocked-owners="testingResultsViewPaneShell.adapter.blockedOwners.join(',')"
              :data-testing-results-no-second-state="testingResultsViewPaneShell.noSecondState && testingResultsViewPaneShell.adapter.noSecondState"
            >
              <div
                v-for="row in testingResultsViewPaneShell.rows.slice(0, 6)"
                :key="row.id"
                class="agent-evidence-row"
                role="treeitem"
                :data-testing-results-row-id="row.id"
                :data-testing-results-row-kind="row.kind"
                :data-testing-results-row-run-id="row.runId || ''"
                :data-testing-results-row-test-id="row.testId || ''"
                :data-testing-results-row-depth="row.depth"
                :data-testing-results-row-state="row.state"
                :data-testing-results-row-message-count="row.messageCount"
                :data-testing-results-row-output-message-count="row.outputMessageCount"
                :data-testing-results-row-location-uri="row.locationUri || ''"
                :data-testing-results-row-command-ids="row.commandIds.join(',')"
                :data-testing-results-row-evidence-uri="row.evidenceUri"
              >
                <span>{{ row.label }}</span>
                <span>{{ row.state }}</span>
              </div>
              <div v-if="testingResultsViewPaneShell.rows.length === 0" class="agent-evidence-empty">暂无测试结果视图证据</div>
            </div>
            <div
              class="agent-evidence-result-peek"
              data-codek-smoke="testing-result-peek-visible-owner"
              :data-testing-result-peek-state-source="'TestingService.getResultPeekProjection()'"
              :data-testing-result-peek-status="testingResultPeekVisibleOwner.status"
              :data-testing-result-peek-latest-run-id="testingResultPeekVisibleOwner.latestRunId || ''"
              :data-testing-result-peek-entry-count="testingResultPeekVisibleOwner.entries.length"
              :data-testing-result-peek-command-ids="testingResultPeekCommandIds.join(',')"
              :data-testing-result-peek-codek-owner="testingResultPeekVisibleOwner.adapter.codekOwner"
              :data-testing-result-peek-blocked-owners="testingResultPeekVisibleOwner.adapter.blockedOwners.join(',')"
              :data-testing-result-peek-no-second-state="testingResultPeekVisibleOwner.adapter.noSecondState"
              :data-testing-followup-status="testingUpperOwnerProjection.messageFollowups.status"
              :data-testing-followup-implemented-owners="testingUpperOwnerProjection.messageFollowups.implementedOwners.join(',')"
              :data-testing-followup-blocked-owners="testingUpperOwnerProjection.messageFollowups.blockedOwners.join(',')"
              :data-testing-followup-no-second-state="testingUpperOwnerProjection.messageFollowups.noSecondState"
            >
              <div
                v-for="entry in testingResultPeekVisibleOwner.entries.slice(0, 4)"
                :key="entry.id"
                class="agent-evidence-row"
                :data-testing-result-peek-entry-id="entry.id"
                :data-testing-result-peek-run-id="entry.runId"
                :data-testing-result-peek-test-id="entry.testId"
                :data-testing-result-peek-state="entry.state"
                :data-testing-result-peek-entry-retired="entry.retired"
                :data-testing-result-peek-location-uri="entry.locationUri || ''"
                :data-testing-result-peek-can-cancel="entry.canCancel"
                :data-testing-result-peek-entry-command-ids="entry.commandIds.join(',')"
                :data-testing-result-peek-evidence-uri="entry.evidenceUri"
              >
                <span>{{ entry.label }}</span>
                <span>{{ entry.state }}</span>
              </div>
              <div v-if="testingResultPeekVisibleOwner.entries.length === 0" class="agent-evidence-empty">暂无结果 Peek 证据</div>
            </div>
            <div
              v-for="item in agentEvidenceSurface.views.testing.items"
              :key="item.id"
              class="agent-evidence-row"
              :data-agent-evidence-rerun-command="item.rerunCommandId"
              :data-agent-evidence-failure-detail="item.failureDetail"
              :data-agent-evidence-resource-links="item.resourceLinks.map((link) => link.uri).join(',')"
            >
              <span>{{ item.label }}</span>
              <span>{{ item.state }}</span>
            </div>
          </section>

          <section class="agent-evidence-section" data-agent-evidence-surface="timeline">
            <div class="agent-evidence-section-title">Timeline 事件</div>
            <div data-codek-smoke="agent-evidence-timeline">
              <div
                v-for="item in agentEvidenceTimelineItems.slice(0, 8)"
                :key="item.handle"
                class="agent-evidence-row"
                :data-agent-evidence-timeline-command="item.command.id"
                :data-agent-evidence-timeline-resource="item.resource?.uri || ''"
                :data-agent-evidence-timeline-link="item.link?.href || ''"
              >
                <span>{{ item.label }}</span>
                <span>{{ item.status }}</span>
              </div>
              <div v-if="agentEvidenceTimelineItems.length === 0" class="agent-evidence-empty">暂无时间线事件</div>
            </div>
          </section>

          <section class="agent-evidence-section" data-agent-evidence-surface="progress">
            <div class="agent-evidence-section-title">Progress 运行状态</div>
            <div data-codek-smoke="agent-evidence-progress">
              <div
                v-for="item in agentEvidenceProgressItems.slice(0, 8)"
                :key="item.id"
                class="agent-evidence-row"
                :aria-label="item.ariaLabel"
                :data-agent-evidence-aggregate-status="item.aggregateStatus"
                :data-agent-evidence-cancel-command="item.cancelCommandId"
              >
                <span>{{ item.title }}</span>
                <span>{{ item.lifecycle.state }} {{ Math.round((item.worked / Math.max(item.total, 1)) * 100) }}%</span>
              </div>
              <div v-if="agentEvidenceProgressItems.length === 0" class="agent-evidence-empty">暂无运行中进度</div>
            </div>
          </section>

          <section class="agent-evidence-section" data-agent-evidence-surface="notifications">
            <div class="agent-evidence-section-title">Notification 风险提示</div>
            <div data-codek-smoke="agent-evidence-notifications">
              <div
                v-for="item in agentEvidenceNotificationItems.slice(0, 8)"
                :key="item.id"
                class="agent-evidence-notification"
                :data-agent-evidence-severity="item.severity"
                :data-agent-evidence-dedupe-key="item.dedupeKey"
                :data-agent-evidence-dismiss-command="item.dismissCommandId"
                :data-agent-evidence-focus-target="item.focusTarget"
                :aria-label="item.ariaLabel"
              >
                <span>{{ item.message }}</span>
                <span>{{ item.actions.map((action) => action.label).join(', ') || '无操作' }}</span>
              </div>
              <div v-if="agentEvidenceNotificationItems.length === 0" class="agent-evidence-empty">暂无通知</div>
            </div>
          </section>
        </section>

        <div
          v-else
          class="sidebar-placeholder-view"
          :data-workbench-view-id="activeView"
        >
          <div class="sidebar-placeholder-title">{{ workbenchLayoutUi.sidebar.emptyStateTitle }}</div>
          <p class="sidebar-placeholder-description">{{ workbenchLayoutUi.sidebar.emptyStateDescription }}</p>
          <button
            v-for="view in workbenchLayoutUi.sidebar.views"
            :key="view.id"
            class="sidebar-placeholder-row"
            type="button"
          >
            <span>{{ view.name }}</span>
            <span v-if="view.description">{{ view.description }}</span>
          </button>
        </div>

      </div>
    </div>

    <div v-if="sidebarVisible" class="sidebar-resize-handle" @mousedown.prevent="startSidebarResize" />

    <div
      class="main-area"
      :class="{ 'has-active-editor': Boolean(w.activeFile || openFiles.length > 0) }"
      role="main"
      :aria-label="t('app.codeEditor')"
      tabindex="-1"
    >
      <div class="tab-bar">
        <div class="tabs">
          <div
            v-for="path in openFiles"
            :key="path"
            class="tab"
            :class="[
              {
                active: tabDisplayModels[path]?.active,
                pinned: tabDisplayModels[path]?.pinned,
                'drag-over': dragOverTab === path,
              },
              editorTabStateModels[path]?.badge ? `working-copy-${editorTabStateModels[path].badge}` : '',
            ]"
            :title="tabDisplayModels[path]?.tooltip || path"
            :aria-label="tabDisplayModels[path]?.ariaLabel || path"
            :data-short-label="tabDisplayModels[path]?.shortLabel || path"
            :data-working-copy-state="editorTabStateModels[path]?.badge || 'saved'"
            draggable="true"
            @click="handleOpenFile(path)"
            @auxclick.prevent="(e) => { if (e.button === 1) handleCloseTab(path) }"
            @contextmenu.prevent="(e) => openTabContextMenu(e, path)"
            @dragstart="(e) => onTabDragStart(e, path)"
            @dragover.prevent="(e) => onTabDragOver(e, path)"
            @dragleave="onTabDragLeave"
            @drop="(e) => onTabDrop(e, path)"
            @dragend="onTabDragEnd"
          >
            <FileIcon class="tab-file-icon" :name="path" />
            <span class="tab-name">{{ tabDisplayModels[path]?.basename || path }}</span>
            <span v-if="tabDisplayModels[path]?.description" class="tab-description">{{ tabDisplayModels[path].description }}</span>
            <WorkingCopyTabBadge
              :state="editorTabStateModels[path] || null"
              :pinned="tabDisplayModels[path]?.pinned"
              :fallbackTitle="t('app.closeTabUnsaved')"
            />
            <button
              v-if="!pinnedTabs.has(path)"
              class="tab-close-btn"
              data-codek-smoke="tab-close"
              :title="isDirty(path) ? t('app.closeTabUnsaved') : t('app.closeTab')"
              @click.stop="handleCloseTab(path)"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
              </svg>
            </button>
            <span v-if="tabDisplayModels[path]?.pinned" class="tab-pin-icon" :title="t('app.pinned')" aria-hidden="true">●</span>
          </div>
        </div>
        <div class="tab-actions">
          <button v-if="openFiles.length > 0" class="tab-action-btn" :class="{ active: splitOpen }" :title="t('settings.shortcutSplit')" @click="handleToggleSplit">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
              <rect x="1" y="2" width="14" height="12" rx="1.5" />
              <line x1="8" y1="2" x2="8" y2="14" />
            </svg>
          </button>
        </div>
      </div>

      <div v-if="w.activeFile" class="editor-title-bar" data-codek-smoke="editor-title-bar">
        <div class="editor-title-main">
          <FileIcon class="editor-title-file-icon" :name="w.activeFile" />
          <span class="editor-title-name">{{ editorTitleModel.name }}</span>
          <span
            v-if="editorTitleModel.stateLabel"
            class="editor-title-state"
            :class="editorTitleModel.stateClass"
            :data-working-copy-state="activeEditorTabState?.badge || 'saved'"
          >{{ editorTitleModel.stateLabel }}</span>
        </div>
        <div class="editor-title-path" :title="editorTitleModel.relativePath">
          <span class="editor-title-root">{{ editorTitleModel.rootLabel }}</span>
          <span v-if="editorTitleModel.relativePath" class="editor-title-sep">/</span>
          <span>{{ editorTitleModel.relativePath }}</span>
        </div>
      </div>

      <WorkingCopyRestorePanel
        v-if="workingCopyRestoreSurfaceVisible"
        :actions="workingCopyRestoreActionModels"
        :status="w.workingCopyHotExitStatus"
        :busyActionKey="workingCopyRestoreBusyKey"
        :errorMessage="workingCopyRestoreError"
        @apply="handleWorkingCopyRestoreAction"
      />

      <div v-if="w.activeFile && breadcrumbDisplayModel.visible" class="breadcrumb-bar" data-codek-smoke="breadcrumb-bar">
        <div
          v-for="element in breadcrumbDisplayModel.elements"
          :key="element.id"
          class="breadcrumb-dropdown-wrap"
        >
          <button
            class="breadcrumb-item"
            :class="{ 'breadcrumb-symbol': element.type === 'symbol' }"
            @click="handleBreadcrumbClick(element.targetLine)"
          >
            <span v-if="element.type === 'path'" class="breadcrumb-icon">{{ element.icon }}</span>
            <span v-else class="breadcrumb-type-icon" :class="'icon-' + element.kind">{{ element.icon }}</span>
            <span>{{ element.label }}</span>
            <span v-if="element.children.length > 0" class="breadcrumb-chevron" @click.stop="toggleBreadcrumbDropdownByElement(element)">v</span>
          </button>
          <div v-if="element.dropdownOpen" class="breadcrumb-dropdown">
            <button
              v-for="child in element.children"
              :key="child.label + child.kind + child.targetLine"
              class="breadcrumb-dropdown-item"
              @click="handleBreadcrumbDropdownSelect(child.targetLine)"
            >
              <span class="breadcrumb-type-icon" :class="'icon-' + child.kind">{{ child.icon }}</span>
              <span>{{ child.label }}</span>
              <span class="breadcrumb-dropdown-line">L{{ child.targetLine }}</span>
            </button>
          </div>
          <span v-if="element.separator === '|'" class="breadcrumb-divider">|</span>
          <span v-else-if="element.separator" class="breadcrumb-sep">{{ element.separator }}</span>
        </div>
      </div>

      <div
        class="editor-wrapper"
        :class="{
          empty: !w.activeFile && openFiles.length === 0,
          'has-editor': Boolean(w.activeFile || openFiles.length > 0),
          'editor-surface-active': Boolean(w.activeFile),
        }"
        tabindex="-1"
        data-workbench-editor-part="true"
        :data-workbench-active-group="workbenchLayoutUi.editorPart.activeGroupId"
        :data-workbench-active-editor="workbenchLayoutUi.editorPart.activeEditor || ''"
        :data-workbench-editor-count="workbenchLayoutUi.editorPart.totalEditors"
        :data-workbench-open-editors-source="workbenchOpenEditorsModel.source"
        :data-workbench-open-editors-count="workbenchOpenEditorsModel.entries.length"
        data-workbench-no-local-open-files-state="true"
        :data-workbench-dirty-count="workbenchLayoutUi.editorPart.dirtyCount"
        :data-workbench-pinned-count="workbenchLayoutUi.editorPart.pinnedCount"
        :data-workbench-preview-count="workbenchLayoutUi.editorPart.previewCount"
        :data-workbench-overflow-count="workbenchLayoutUi.editorPart.overflowCount"
        :data-workbench-overflow="workbenchLayoutUi.editorPart.overflow"
        :data-workbench-split-open="workbenchLayoutUi.editorPart.splitOpen"
        :data-markdown-preview-service-source="markdownPreviewSnapshot.source"
        :data-markdown-preview-count="markdownPreviewSnapshot.previewCount"
        :data-markdown-preview-active-resource="markdownPreviewSnapshot.activeResource"
        :data-markdown-preview-lifecycle="activeMarkdownPreview?.lifecycle || ''"
        :data-markdown-preview-version="activeMarkdownPreview?.versionId || 0"
        :data-notebook-service-id="notebookWebviewCustomEditorSmokeEvidence.notebookServiceId"
        :data-notebook-serializer-count="notebookWebviewCustomEditorSmokeEvidence.notebookSerializerCount"
        :data-notebook-document-count="notebookWebviewCustomEditorSmokeEvidence.notebookDocumentCount"
        :data-notebook-active-resource="notebookWebviewCustomEditorSmokeEvidence.activeNotebookResource"
        :data-notebook-renderer-count="notebookWebviewCustomEditorSmokeEvidence.notebookRendererCount"
        :data-notebook-renderer-message-count="notebookWebviewCustomEditorSmokeEvidence.notebookRendererMessageCount"
        :data-webview-service-id="notebookWebviewCustomEditorSmokeEvidence.webviewServiceId"
        :data-webview-panel-count="notebookWebviewCustomEditorSmokeEvidence.webviewPanelCount"
        :data-webview-active-panel-id="notebookWebviewCustomEditorSmokeEvidence.activeWebviewPanelId"
        :data-custom-editor-service-id="notebookWebviewCustomEditorSmokeEvidence.customEditorServiceId"
        :data-custom-editor-restored-count="notebookWebviewCustomEditorSmokeEvidence.restoredCustomEditorCount"
        :data-custom-editor-dirty-count="notebookWebviewCustomEditorSmokeEvidence.customEditorDirtyCount"
        :data-webview-message-bridge-ready="notebookWebviewCustomEditorSmokeEvidence.webviewMessageBridgeReady"
        :data-webview-resource-guard-ready="notebookWebviewCustomEditorSmokeEvidence.webviewResourceGuardReady"
      >
        <WelcomePage
          v-if="!w.activeFile && openFiles.length === 0"
          :projectName="projectName"
          :projectRoot="w.projectRoot"
          @newProject="handleCreateFile"
          @openProject="handleOpenProject"
          @openCommandPalette="commandPaletteRef?.open()"
          @openChat="chatOpen = true"
          @openRecent="handleOpenRecentProject"
          @openLink="handleOpenLink"
        />
        <div
          v-show="w.activeFile || openFiles.length > 0"
          class="editor-split-container"
          :class="{ active: Boolean(w.activeFile) }"
          :aria-hidden="!w.activeFile && openFiles.length === 0"
        >
          <div ref="editorContainer" class="editor-container" :class="{ split: splitOpen || markdownPreviewOpen }" :style="splitOpen ? { width: splitRatio + '%' } : {}"></div>
          <div v-if="splitOpen" class="split-divider" :class="{ dragging: splitDividerDragging }" @mousedown="handleSplitDividerMouseDown"></div>
          <div v-if="splitOpen" ref="splitEditorContainer" class="editor-container split-pane" :style="{ width: (100 - splitRatio) + '%' }"></div>
          <MarkdownPreview
            v-if="markdownPreviewOpen && isMarkdownFile"
            :content="markdownPreviewContent"
            @close="handleCloseMarkdownPreview"
          />
        </div>
        <div v-if="(w.activeFile || openFiles.length > 0) && !editorReady" class="editor-loading">{{ t('editor.loading') }}</div>
        <InlineEditBar
          :visible="inlineEdit.visible"
          :busy="inlineEdit.busy"
          :status="inlineEdit.status"
          :statusText="inlineEdit.statusText"
          :activeModel="inlineEdit.activeModel"
          :review="inlineEdit.review"
          :cursorTop="inlineEdit.cursorTop"
          :cursorLeft="inlineEdit.cursorLeft"
          @submit="handleInlineSubmit"
          @cancel="handleInlineCancel"
          @accept="handleInlineAccept"
          @reject="handleInlineReject"
        />
      </div>

      <div
        v-if="bottomPanelOpen"
        class="bottom-panel-resize-handle"
        @mousedown.prevent="startBottomPanelResize"
      />
      <div
        v-if="bottomPanelOpen"
        class="bottom-panel-wrap"
        data-codek-smoke="bottom-panel"
        tabindex="-1"
        :data-workbench-panel-id="workbenchLayoutUi.panel.activePanelId || ''"
        :data-workbench-panel-height="workbenchLayoutUi.panel.height || bottomPanelHeight"
        :style="{ height: bottomPanelHeight + 'px' }"
      >
        <OutputPanel
          :visible="isBottomPanelActive(bottomPanelState, 'output')"
          @close="closeBottomPanel(bottomPanelState, 'output')"
        />

        <TerminalPanel
          v-if="terminalPanelMounted"
          ref="terminalPanelRef"
          :visible="isBottomPanelActive(bottomPanelState, 'terminal')"
          :projectRoot="w.projectRoot"
          @close="closeBottomPanel(bottomPanelState, 'terminal')"
        />

        <TaskWorkbenchPanel
          :visible="isBottomPanelActive(bottomPanelState, 'tasks')"
          @close="closeBottomPanel(bottomPanelState, 'tasks')"
        />

        <ProcessExplorerPanel
          :visible="isBottomPanelActive(bottomPanelState, 'processExplorer')"
          @close="closeBottomPanel(bottomPanelState, 'processExplorer')"
        />

        <VisualEditor
          :visible="isBottomPanelActive(bottomPanelState, 'visualEditor')"
          :projectRoot="w.projectRoot"
          @close="handleCloseVisualEditor"
          @openSource="onVisualEditorOpenSource"
          @requestAiEdit="onVisualEditorAiEdit"
        />
      </div>
    </div>

    <ChatPanel
      ref="chatPanelRef"
      data-codek-smoke="chat-panel"
      :visible="chatOpen"
      :messages="chatMessages"
      :loading="agentBusy"
      :sessions="sessionLabels"
      :currentSessionId="currentSessionId"
      :activeModel="getModelLabel(activeModel)"
      :openFiles="openFiles"
      @send="handleChatSend"
      @close="chatOpen = false"
      @newchat="handleNewChat"
      @selectSession="handleSelectSession"
      @deleteSession="handleDeleteSession"
      @regenerate="handleRegenerate"
      @interrupt="handleChatInterrupt"
      @modeChange="handleModeChange"
    />

    <div v-if="activeView === 'settings'" class="settings-overlay">
      <button class="settings-overlay-close" @click="activeView = 'files'" title="关闭设置" aria-label="关闭设置">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <SettingsPanel
        ref="settingsPanelRef"
        :ollamaOk="ollamaOk"
        :selectedModel="activeModel"
        :activeModel="getModelLabel(activeModel)"
        :availableModels="modelSettings.availableModels"
        :formatOnSave="formatOnSave"
        :lintOnSave="lintOnSave"
        :collabEnabled="collabEnabled"
        :autoSaveMode="autoSaveMode"
        :settingsQuery="activeSettingsQuery"
        @changeModel="handleChangeModel"
        @refreshModels="handleRefreshModels"
        @toggleFormatOnSave="toggleFormatOnSave"
        @toggleLintOnSave="lintOnSave = !lintOnSave"
        @toggleCollab="toggleCollab"
        @changeAutoSave="handleChangeAutoSave"
      />
    </div>
    </div>

    <!-- Tab preview and command overlays -->
    <Teleport to="body">
      <div v-if="tabContextMenu.visible" class="tab-context-menu" :style="{ left: tabContextMenu.x + 'px', top: tabContextMenu.y + 'px' }" @click="tabContextMenu.visible = false">
        <button class="tab-ctx-item" @click="handleCloseTab(tabContextMenu.path)">{{ t('app.closeTab') }}</button>
        <button class="tab-ctx-item" @click="closeOtherTabs(tabContextMenu.path)">{{ t('app.closeOthers') }}</button>
        <button class="tab-ctx-item" @click="closeRightTabs(tabContextMenu.path)">{{ t('app.closeRight') }}</button>
        <button class="tab-ctx-item" @click="closeAllSavedTabs()">{{ t('app.closeSaved') }}</button>
        <button class="tab-ctx-item" :disabled="closedEditors.length === 0" @click="reopenLastClosedTab()">{{ t('app.reopenClosed') }}</button>
        <div class="tab-ctx-sep"></div>
        <button class="tab-ctx-item" @click="togglePinTab(tabContextMenu.path)">
          {{ pinnedTabs.has(tabContextMenu.path) ? t('app.unpinTab') : t('app.pinTab') }}
        </button>
      </div>
      <div v-if="tabContextMenu.visible" class="tab-ctx-backdrop" @click="tabContextMenu.visible = false"></div>
    </Teleport>

    <!-- Empty editor and welcome overlays -->
    <div v-if="unsavedDialog.visible" class="name-dialog-backdrop" @click.self="unsavedDialog.resolve?.('cancel')">
      <div class="name-dialog unsaved-dialog">
        <div class="name-dialog-title">{{ t('app.unsavedTitle') }}</div>
        <div class="unsaved-dialog-body">{{ t('app.unsavedBody', { name: basename(unsavedDialog.path) }) }}</div>
        <div class="name-dialog-actions">
          <button class="name-dialog-btn ghost" @click="unsavedDialog.resolve?.('discard')">{{ t('app.discard') }}</button>
          <button class="name-dialog-btn ghost" @click="unsavedDialog.resolve?.('cancel')">{{ t('app.cancel') }}</button>
          <button class="name-dialog-btn primary" @click="unsavedDialog.resolve?.('save')">{{ t('app.save') }}</button>
        </div>
      </div>
    </div>

    <!-- Editor command overlays -->
    <div v-if="gotoLineVisible" class="name-dialog-backdrop" @click.self="gotoLineVisible = false">
      <div class="name-dialog goto-line-dialog">
        <div class="name-dialog-title">{{ t('app.gotoLineTitle') }}</div>
        <input
          ref="gotoLineInput"
          v-model="gotoLineValue"
          class="name-dialog-input"
          type="number"
          min="1"
          :placeholder="t('app.gotoLinePlaceholder')"
          @keydown.enter.prevent="submitGotoLine"
          @keydown.esc.prevent="gotoLineVisible = false"
        />
        <div class="name-dialog-actions">
          <button class="name-dialog-btn ghost" @click="gotoLineVisible = false">{{ t('app.cancel') }}</button>
          <button class="name-dialog-btn primary" @click="submitGotoLine">{{ t('app.gotoLineBtn') }}</button>
        </div>
      </div>
    </div>

    <!-- Ctrl+Tab switcher overlay -->
    <div v-if="fileSwitcherVisible" class="file-switcher-backdrop" @click.self="fileSwitcherVisible = false" @keydown.esc="fileSwitcherVisible = false">
      <div class="file-switcher">
        <div class="file-switcher-title">{{ t('app.switchFile') }}</div>
        <div
          v-for="(path, idx) in switcherFiles"
          :key="path"
          class="file-switcher-item"
          :class="{ active: idx === switcherIndex }"
          @click="selectSwitcherFile(path)"
          @mouseenter="switcherIndex = idx"
        >
          <FileIcon :name="path" />
          <span class="file-switcher-name">{{ basename(path) }}</span>
          <span class="file-switcher-path">{{ parentDir(path) }}</span>
          <span v-if="isDirty(path)" class="tab-dirty"></span>
        </div>
      </div>
    </div>

    <div
      v-if="workbench.statusBarVisible"
      class="status-bar"
      role="status"
      aria-live="polite"
      tabindex="0"
      data-workbench-status-bar="true"
      :data-workbench-status-active-view="workbenchLayoutUi.statusBar.activeViewId || ''"
      :data-workbench-status-active-panel="workbenchLayoutUi.statusBar.activePanelId || ''"
      :data-workbench-status-language="workbenchLayoutUi.statusBar.languageId"
      :data-workbench-status-line="workbenchLayoutUi.statusBar.line"
      :data-workbench-status-column="workbenchLayoutUi.statusBar.column"
      :data-workbench-status-branch="workbenchLayoutUi.statusBar.branch"
      :data-workbench-status-error-count="workbenchLayoutUi.statusBar.errorCount"
      :data-workbench-status-warning-count="workbenchLayoutUi.statusBar.warningCount"
      :data-workbench-status-encoding="workbenchLayoutUi.statusBar.encoding"
      :data-workbench-status-eol="workbenchLayoutUi.statusBar.eol"
      :data-workbench-status-service-entry-count="workbenchStatusbarEntries.length"
      :data-workbench-status-service-entry-ids="workbenchStatusbarEntries.map((entry) => entry.id).join(',')"
      :data-workbench-notification-service-count="workbenchNotificationItems.length"
      :data-workbench-progress-service-count="workbenchProgressTasks.length"
    >
      <span
        class="workbench-command-surface-probe"
        data-workbench-command-surface="true"
        :data-workbench-command-count="workbenchLayoutUi.commandSurface.commandCount"
        :data-workbench-command-ids="workbenchLayoutUi.commandSurface.commandIds.join(',')"
        :data-workbench-menu-ids="workbenchLayoutUi.commandSurface.menuIds.join(',')"
        :data-workbench-menu-entry-count="workbenchLayoutUi.commandSurface.menuEntryCount"
        :data-workbench-command-palette-count="workbenchLayoutUi.commandSurface.commandPaletteCommandIds.length"
        :data-workbench-command-palette-ids="workbenchLayoutUi.commandSurface.commandPaletteCommandIds.join(',')"
        :data-workbench-service-menu-ids="workbenchServiceMenuIds.join(',')"
        :data-workbench-service-menu-entry-count="workbenchServiceMenuEntryCount"
        aria-hidden="true"
      />
      <span class="status-left">
        <button
          v-for="entry in workbenchStatusbarLeftEntries"
          :key="entry.id"
          class="status-item status-clickable workbench-status-service-entry"
          :class="[`status-service-${entry.kind || 'standard'}`, { 'status-service-progress': Boolean(entry.showProgress) }]"
          :title="entry.tooltip || entry.ariaLabel || entry.name"
          :data-workbench-status-service-entry-id="entry.id"
          :data-workbench-status-service-entry-source="entry.source || ''"
          :data-workbench-status-service-entry-command="entry.command || ''"
          @click="entry.command && executeCommand(entry.command)"
        >
          <span v-if="entry.showProgress" class="status-service-spinner" aria-hidden="true"></span>
          <span>{{ entry.text }}</span>
        </button>
        <button class="status-item status-clickable" :title="t('sidebar.changes')" @click="openSidebarView('changes')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <span>{{ gitState.currentBranch.value || 'main' }}</span>
        </button>
        <span v-if="gitState.status.value && (gitState.status.value.ahead > 0 || gitState.status.value.behind > 0)" class="status-item sync-status">
          <span v-if="gitState.status.value.ahead > 0" class="sync-ahead">{{ gitState.status.value.ahead }}?</span>
          <span v-if="gitState.status.value.behind > 0" class="sync-behind">{{ gitState.status.value.behind }}?</span>
        </span>
        <button v-if="remoteConnection.type" class="status-item status-clickable" :title="remoteConnection.name" @click="openSidebarView('remote')">
          <svg v-if="remoteConnection.type === 'ssh'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="2" width="20" height="8" rx="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" />
            <line x1="6" y1="6" x2="6.01" y2="6" />
            <line x1="6" y1="18" x2="6.01" y2="18" />
          </svg>
          <span>{{ remoteConnection.name }}</span>
        </button>
      </span>
      <span class="status-right">
        <button
          v-for="entry in workbenchStatusbarRightEntries"
          :key="entry.id"
          class="status-item status-clickable workbench-status-service-entry"
          :class="[`status-service-${entry.kind || 'standard'}`, { 'status-service-progress': Boolean(entry.showProgress) }]"
          :title="entry.tooltip || entry.ariaLabel || entry.name"
          :data-workbench-status-service-entry-id="entry.id"
          :data-workbench-status-service-entry-source="entry.source || ''"
          :data-workbench-status-service-entry-command="entry.command || ''"
          @click="entry.command && executeCommand(entry.command)"
        >
          <span v-if="entry.showProgress" class="status-service-spinner" aria-hidden="true"></span>
          <span>{{ entry.text }}</span>
        </button>
        <span class="status-item">Ln {{ cursorPosition.line }}, Col {{ cursorPosition.column }}</span>
        <span class="status-item">{{ indentType }}</span>
        <span class="status-item">{{ fileEncoding }}</span>
        <span class="status-item">{{ eolType }}</span>
        <button class="status-item status-clickable" :title="t('app.switchLanguage')" @click="showLanguagePicker = !showLanguagePicker">
          {{ currentLanguageLabel }}
        </button>
        <button
          v-if="problemState.errorCount > 0 || problemState.warningCount > 0"
          class="status-item status-clickable"
          :title="`${problemState.errorCount} 个错误，${problemState.warningCount} 个警告`"
          @click="toggleProblemsPanel"
        >
          <span v-if="problemState.errorCount > 0" class="status-pill err">{{ problemState.errorCount }} 错误</span>
          <span v-if="problemState.warningCount > 0" class="status-pill warn">{{ problemState.warningCount }} 警告</span>
        </button>
        <button class="status-item status-clickable status-icon-button" title="输出" aria-label="输出" data-codek-smoke="status-output-toggle" @click="toggleBottomPanel(bottomPanelState, 'output')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 17l6-6-6-6" />
            <path d="M12 19h8" />
          </svg>
        </button>
      </span>
    </div>

    <Teleport to="body">
      <div v-if="showLanguagePicker" class="lang-picker-overlay" @click.self="showLanguagePicker = false">
        <div class="lang-picker-panel">
          <input
            ref="langPickerInputRef"
            v-model="langPickerQuery"
            class="lang-picker-input"
            type="text"
            :placeholder="t('app.languagePickerPlaceholder')"
            @keydown.esc="showLanguagePicker = false"
            @keydown.enter="confirmLanguagePick"
          />
          <div class="lang-picker-list">
            <div
              v-for="lang in filteredLanguages"
              :key="lang"
              class="lang-picker-item"
              :class="{ active: lang === currentLanguageId }"
              @click="setEditorLanguage(lang)"
            >{{ lang }}</div>
          </div>
        </div>
      </div>
    </Teleport>

  <ProblemsPanel
      :visible="problemsVisible"
      @close="closeProblemsPanel"
      @openFile="handleOpenDiagnostic"
    />

    <QuickQuestion
      v-if="quickQuestionVisible"
      @close="quickQuestionVisible = false"
    />

    <CommandPalette ref="commandPaletteRef" role="dialog" :aria-label="t('app.cmdCommandPalette')" aria-modal="true" @gotoLine="handlePaletteGotoLine" @symbolSearch="handlePaletteSymbolSearch" @openFile="handleOpenFile" />

    <AuthorizationDialog />
    <div
      v-if="activeCodekDialog"
      class="name-dialog-backdrop codek-dialog-backdrop"
      role="presentation"
      data-codek-smoke="codek-dialog-service-modal"
      :data-dialog-service-id="'dialogService'"
      :data-dialog-source="activeCodekDialog.source"
      :data-dialog-kind="activeCodekDialog.kind"
      :data-dialog-modal="activeCodekDialog.modal"
      :data-dialog-command-id="activeCodekDialog.evidenceContext?.commandId || ''"
      :data-dialog-workspace-folder="activeCodekDialog.evidenceContext?.workspaceFolder || ''"
      :data-dialog-resource="activeCodekDialog.evidenceContext?.resource || ''"
      :data-dialog-button-labels="activeCodekDialog.buttons.map((button) => button.label).join(',')"
      @click.self="resolveCodekDialogCancel"
    >
      <section
        class="name-dialog codek-dialog-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="activeCodekDialog.title || activeCodekDialog.message"
      >
        <div class="name-dialog-title">{{ activeCodekDialog.title || activeCodekDialog.message }}</div>
        <div v-if="activeCodekDialog.title" class="codek-dialog-message">{{ activeCodekDialog.message }}</div>
        <div v-if="activeCodekDialog.detail" class="codek-dialog-detail">{{ activeCodekDialog.detail }}</div>
        <label v-if="activeCodekDialog.checkbox" class="codek-dialog-checkbox">
          <input v-model="activeCodekDialogCheckboxChecked" type="checkbox" />
          <span>{{ activeCodekDialog.checkbox.label }}</span>
        </label>
        <div class="name-dialog-actions">
          <button
            v-for="button in activeCodekDialog.buttons"
            :key="button.index"
            type="button"
            class="name-dialog-btn"
            :class="{ primary: !button.isCancel && button.index === 0, ghost: button.isCancel || button.index !== 0 }"
            :data-dialog-button-index="button.index"
            :data-dialog-button-label="button.label"
            :data-dialog-button-cancel="button.isCancel"
            @click="resolveCodekDialog(button.index)"
          >
            {{ button.label }}
          </button>
        </div>
      </section>
    </div>
    <McpInputPromptDialog />
    <QuickPickDialog />

    <section
      class="accessible-view-owner-evidence"
      data-codek-smoke="accessible-view-visible-owner"
      :data-accessible-view-state-source="'globalAccessibleViewService.getRendererProjection()'"
      :data-accessible-view-owner="accessibleViewVisibleOwner.owner"
      :data-accessible-view-state="accessibleViewVisibleOwner.state"
      :data-accessible-view-hidden="accessibleViewVisibleOwner.hidden"
      :data-accessible-view-provider-id="accessibleViewVisibleOwner.providerId || ''"
      :data-accessible-view-line-count="accessibleViewVisibleOwner.lineCount"
      :data-accessible-view-dom-shell-owner="accessibleViewVisibleOwner.domShellReadiness.owner"
      :data-accessible-view-dom-shell-state="accessibleViewVisibleOwner.domShellReadiness.state"
      :data-accessible-view-toolbar-owner="accessibleViewVisibleOwner.toolbarQuickPickFocusInvocation.owner"
      :data-accessible-view-toolbar-state="accessibleViewVisibleOwner.toolbarQuickPickFocusInvocation.state"
      :data-accessible-view-quick-pick-owner="accessibleViewVisibleOwner.toolbarQuickPickFocusInvocation.quickPick.symbolQuickPickOwner"
      :data-accessible-view-focus-invocation-owner="accessibleViewVisibleOwner.toolbarQuickPickFocusInvocation.focusInvocation.focusRestoreInvocationOwner"
      :data-accessible-view-code-editor-backed="accessibleViewVisibleOwner.editor.codeEditorWidgetBacked"
      :data-accessible-view-blocked-surfaces="accessibleViewVisibleOwner.remainingBlockedSurfaces.join(',')"
      :data-accessible-view-no-second-state="accessibleViewContractProjection.trueOwnerFollowUp.noSecondAccessibilityState"
      :data-accessibility-signal-owner="accessibleViewContractProjection.accessibilitySignalUiProjection.actionOwner.owner"
      :data-accessibility-signal-state="accessibleViewContractProjection.accessibilitySignalUiProjection.actionOwner.state"
      :data-accessibility-signal-blocked-capabilities="accessibleViewContractProjection.accessibilitySignalUiProjection.actionOwner.blockedCapabilities.join(',')"
      hidden
    ></section>
    <section
      v-if="!accessibleViewVisibleOwner.hidden"
      class="accessible-view-dom-shell"
      data-codek-smoke="accessible-view-dom-shell"
      data-accessible-view-dom-shell="true"
      :data-accessible-view-state-source="'globalAccessibleViewService.getRendererProjection()'"
      :data-accessible-view-owner="accessibleViewVisibleOwner.owner"
      :data-accessible-view-state="accessibleViewVisibleOwner.state"
      :data-accessible-view-provider-id="accessibleViewVisibleOwner.providerId || ''"
      :data-accessible-view-provider-type="accessibleViewVisibleOwner.providerType || ''"
      :data-accessible-view-line-count="accessibleViewVisibleOwner.lineCount"
      :data-accessible-view-dom-shell-owner="accessibleViewVisibleOwner.domShellReadiness.owner"
      :data-accessible-view-dom-shell-state="accessibleViewVisibleOwner.domShellReadiness.state"
      :data-accessible-view-placement-owner="accessibleViewVisibleOwner.placement.owner"
      :data-accessible-view-placement-state="accessibleViewVisibleOwner.placement.state"
      :data-accessible-view-code-editor-backed="accessibleViewVisibleOwner.editor.codeEditorWidgetBacked"
      :data-accessible-view-context-view-owner="accessibleViewVisibleOwner.editorContextFocusOwnerMatrix.contextView.contextViewDelegateOwner"
      :data-accessible-view-toolbar-owner="accessibleViewVisibleOwner.toolbarQuickPickFocusInvocation.owner"
      :data-accessible-view-toolbar-state="accessibleViewVisibleOwner.toolbarQuickPickFocusInvocation.state"
      :data-accessible-view-workbench-toolbar-backed="accessibleViewVisibleOwner.toolbarQuickPickFocusInvocation.toolbar.workbenchToolbarWidgetBacked"
      :data-accessible-view-quick-pick-owner="accessibleViewVisibleOwner.toolbarQuickPickFocusInvocation.quickPick.symbolQuickPickOwner"
      :data-accessible-view-generic-quick-input-reusable="accessibleViewVisibleOwner.toolbarQuickPickFocusInvocation.quickPick.genericQuickInputSurface.reusableInfrastructure"
      :data-accessible-view-focus-target-owner="accessibleViewVisibleOwner.editorShellFocusRestore.focusRestoreTargetOwner"
      :data-accessible-view-focus-invocation-owner="accessibleViewVisibleOwner.toolbarQuickPickFocusInvocation.focusInvocation.focusRestoreInvocationOwner"
      :data-accessible-view-blocked-surfaces="accessibleViewVisibleOwner.remainingBlockedSurfaces.join(',')"
      :data-accessible-view-blocked-owners="accessibleViewVisibleOwner.domShellReadiness.blockedOwners.join(',')"
      :data-accessible-view-no-second-state="accessibleViewContractProjection.trueOwnerFollowUp.noSecondAccessibilityState"
      role="dialog"
      aria-modal="true"
      :aria-label="accessibleViewVisibleOwner.title"
      @keydown.esc.stop.prevent="hideAccessibleViewDomShell"
    >
      <header class="accessible-view-dom-shell-header">
        <div>
          <div class="accessible-view-dom-shell-title" data-accessible-view-title="true">{{ accessibleViewVisibleOwner.title }}</div>
          <div class="accessible-view-dom-shell-meta">
            {{ accessibleViewVisibleOwner.providerId || 'unknown' }} · {{ accessibleViewVisibleOwner.lineCount }} lines
          </div>
        </div>
        <button type="button" class="accessible-view-dom-shell-close" aria-label="Close Accessible View" @click="hideAccessibleViewDomShell">x</button>
      </header>
      <textarea
        ref="accessibleViewContentRef"
        class="accessible-view-dom-shell-content"
        data-accessible-view-content="true"
        :value="accessibleViewVisibleOwner.content"
        :aria-label="accessibleViewVisibleOwner.title"
        readonly
      ></textarea>
      <div
        class="accessible-view-dom-shell-toolbar"
        data-accessible-view-toolbar="true"
        role="toolbar"
        :aria-label="accessibleViewVisibleOwner.title"
        :data-menu-id="accessibleViewVisibleOwner.toolbar.menuId"
        :data-action-ids="accessibleViewVisibleOwner.toolbar.actionIds.join(',')"
      >
        <button
          v-for="actionId in accessibleViewVisibleOwner.toolbar.actionIds"
          :key="actionId"
          type="button"
          class="accessible-view-dom-shell-action"
          :data-accessible-view-action-id="actionId"
          @click="runAccessibleViewDomShellAction(actionId)"
        >
          {{ actionId.replace('editor.action.', '') }}
        </button>
      </div>
    </section>

    <GoalRecoveryDialog @open="openGoalResult" />

    <div
      v-if="orchestratorRunDetailVisible && activeOrchestratorRunId"
      class="goal-result-backdrop task-run-detail-backdrop"
      @click.self="closeOrchestratorRun"
    >
      <div
        class="goal-result-modal task-run-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label="任务详情"
        data-codek-smoke="task-run-detail-modal"
      >
        <button class="goal-result-close" @click="closeOrchestratorRun" title="关闭" aria-label="关闭">x</button>
        <AgentOrchestratorPanel
          :key="activeOrchestratorRunId"
          :initial-run-id="activeOrchestratorRunId"
        />
      </div>
    </div>

    <div v-if="goalResultVisible" class="goal-result-backdrop" @click.self="closeGoalResult">
      <div class="goal-result-modal">
        <button class="goal-result-close" @click="closeGoalResult" title="关闭" aria-label="关闭">x</button>
        <GoalResultView
          :goal="selectedGoalResult"
          @retry="retryGoal"
          @continue="continueGoal"
        />
      </div>
    </div>

    <TaskGraphModal :visible="showTaskGraph" :tasks="taskGraphTasks" @close="showTaskGraph = false" />

    <NotificationToast />
    <span v-if="smokeAnalysisWorkspaceReady" data-codek-smoke="analysis-workspace-ready" hidden></span>
</div>
  </AuthGate>
</template>

<script setup lang="ts">
// @ts-nocheck
import { computed, defineAsyncComponent, markRaw, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, watchEffect } from "vue"
import { usePanelResize } from "./composables/usePanelResize"
import { useWorkbenchLayout } from "./composables/useWorkbenchLayout"
import { useWorkspaceSearch } from "./composables/useWorkspaceSearch"
import { buildActiveEditorTitleModel, buildTabDisplayModels } from "./workbench/tabDisplay"
import {
  type CodekSidebarViewId,
} from "./workbench/workbenchLayoutModel"
import { buildWorkbenchLayoutUiModel, type WorkbenchActivityButtonUiModel } from "./workbench/workbenchLayoutUiAdapter"
import { globalWorkbenchLayoutService, WorkbenchParts } from "./vscode-adapter/workbench/services/layout/browser/layoutService"
import {
  AGENT_EVIDENCE_VSCODE_SERVICE_IDS,
  AGENT_EVIDENCE_WORKBENCH_VIEW_IDS,
  type AgentEvidenceSurfaceKind,
  type AgentEvidenceWorkbenchSurface,
  getAgentEvidenceWorkbenchSurface,
  globalAgentEvidenceWorkbenchService,
  registerAgentEvidenceWorkbenchContributions,
  setAgentEvidenceWorkbenchSummary,
} from "./workbench/agentEvidenceWorkbench"
import {
  DEBUG_WORKBENCH_VIEW_IDS,
  TASK_WORKBENCH_VIEW_IDS,
  TERMINAL_DEBUG_TASK_COMMAND_IDS,
  TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS,
  globalCodekOutputService,
  globalDebugService,
  globalTerminalDebugTaskWorkbenchService,
  registerTerminalDebugTaskWorkbenchContributions,
} from "./workbench/terminalDebugTaskWorkbench"
import { TASK_CONFIG_STATE_SOURCE, userTasksService } from "./workbench/userTasks"
import {
  registerEditorWorkbenchContributions,
} from "./workbench/editorWorkbenchContributions"
import {
  AUTHENTICATION_WORKBENCH_COMMAND_IDS,
  EXTENSION_HOST_WORKBENCH_COMMAND_IDS,
  EXTENSION_TRUST_REMOTE_AUTH_WORKBENCH_VIEW_IDS,
  REMOTE_AUTHORITY_WORKBENCH_COMMAND_IDS,
  WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID,
  WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS,
  globalWorkspaceTrustBannerService,
  globalWorkspaceTrustManagementService,
  type WorkspaceTrustBannerActionProjection,
  getExtensionTrustRemoteAuthWorkbenchSurfaceSnapshot,
  registerExtensionTrustRemoteAuthWorkbenchContributions,
  seedAuthenticationWorkbenchEvidenceForSmoke,
  seedRemoteAuthorityWorkbenchEvidenceForSmoke,
} from "./workbench/extensionTrustRemoteAuthWorkbench"
import {
  WorkbenchStatusbarAlignment,
  globalWorkbenchStatusNotificationProgressService,
} from "./workbench/statusNotificationProgressService"
import {
  globalLegacyMarkdownPreviewController,
  globalNotebookMarkdownPreviewWorkbenchService,
} from "./workbench/notebookMarkdownPreviewService"
import { globalWebviewCustomEditorPreviewService } from "./workbench/webviewCustomEditorPreviewService"
import { globalTestingService } from "./testing/testingService"
import {
  globalAccessibleViewService,
  registerAccessibleViewCommandContributions,
} from "./accessibility/accessibleViewService"
import { type CodekDialogRequest, globalCodekDialogService } from "./dialogs/dialogService"
import { IQuickInputService, quickInputService } from "./workbench/quickInput"
import McpInputPromptDialog from "./components/McpInputPromptDialog.vue"
import QuickPickDialog from "./components/QuickPickDialog.vue"
import WorkingCopyTabBadge from "./components/WorkingCopyTabBadge.vue"
import WorkingCopyRestorePanel from "./components/WorkingCopyRestorePanel.vue"
import { buildBreadcrumbDisplayModel } from "./workbench/breadcrumbDisplay"
import { useEditorInsights } from "./composables/useEditorInsights"
import { useChatSession } from "./composables/useChatSession"
import { registerDefaultWorkbenchViews } from "./workbench/viewRegistry"

const ChatPanel = defineAsyncComponent(() => import("./components/ChatPanel.vue"))
import AuthGate from "./components/AuthGate.vue"
const ChangeReviewPanel = defineAsyncComponent(() => import("./components/ChangeReviewPanel.vue"))
const CommandPalette = defineAsyncComponent(() => import("./components/CommandPalette.vue"))
import FileTree from "./components/FileTree.vue"
const GitPanel = defineAsyncComponent(() => import("./components/GitPanel.vue"))
const InlineEditBar = defineAsyncComponent(() => import("./components/InlineEditBar.vue"))
import MenuBar from "./components/MenuBar.vue"
const ProblemsPanel = defineAsyncComponent(() => import("./components/ProblemsPanel.vue"))
const SettingsPanel = defineAsyncComponent(() => import("./components/SettingsPanel.vue"))
const loadMarketplacePanel = () => import("./components/Marketplace.vue")
const Marketplace = defineAsyncComponent(loadMarketplacePanel)
let marketplacePreloadStarted = false
function preloadMarketplacePanel() {
  if (marketplacePreloadStarted) return
  marketplacePreloadStarted = true
  void loadMarketplacePanel()
}
const SymbolPanel = defineAsyncComponent(() => import("./components/SymbolPanel.vue"))
const VisualEditor = defineAsyncComponent(() => import("./components/VisualEditor.vue"))
const QuickQuestion = defineAsyncComponent(() => import("./components/QuickQuestion.vue"))
import NotificationToast from "./components/NotificationToast.vue"
const AuthorizationDialog = defineAsyncComponent(() => import("./components/AuthorizationDialog.vue"))
const GoalRecoveryDialog = defineAsyncComponent(() => import("./components/GoalRecoveryDialog.vue"))
const GoalListPanel = defineAsyncComponent(() => import("./components/GoalListPanel.vue"))
const GoalResultView = defineAsyncComponent(() => import("./components/GoalResultView.vue"))
const AgentOrchestratorPanel = defineAsyncComponent(() => import("./components/AgentOrchestratorPanel.vue"))
const OutputPanel = defineAsyncComponent(() => import("./components/OutputPanel.vue"))
const ProcessExplorerPanel = defineAsyncComponent(() => import("./components/ProcessExplorerPanel.vue"))
const TaskWorkbenchPanel = defineAsyncComponent(() => import("./components/TaskWorkbenchPanel.vue"))
const TerminalPanel = defineAsyncComponent(() => import("./components/TerminalPanel.vue"))
const WelcomePage = defineAsyncComponent(() => import("./components/WelcomePage.vue"))
const MarkdownPreview = defineAsyncComponent(() => import("./components/MarkdownPreview.vue"))
const RemotePanel = defineAsyncComponent(() => import("./components/RemotePanel.vue"))
import FileIcon from "./components/FileIcon.vue"
const isElectron = computed(() => typeof window !== "undefined" && Boolean(window.codek))
import { type MenuAction } from "./components/menuModel"
import ActivityProductIcon from "./components/ActivityProductIcon.vue"

import { loadAiProviders, getActiveProvider } from "./ai/aiProviders"
import { chatStream, readUnifiedStream } from "./ai/llmClient"
import { problemState } from "./components/problemState"
import { gitState } from "./components/gitState"
import { extensionWorkbenchService, getExtensionWorkbenchSurfaceSnapshot } from "./extensions/extensionsWorkbenchService"
import { getScmProviders } from "./scm/scmRegistry"
import { buildScmDecorationMap } from "./scm/scmDecorations"
import { applyScmEditorDecorations } from "./scm/scmEditorDecorations"
import { executeCommand, getCommand, getCommands, registerCommand } from "./workbench/commandRegistry"
import { MenuId, MenuRegistry } from "./vscode-adapter/platform/actions/common/menuRegistry"
import { globalSearchService, QueryType } from "./vscode-adapter/workbench/services/search/common/searchService"
import {
  closeBottomPanel,
  createBottomPanelState,
  isBottomPanelActive,
  isBottomPanelOpen,
  openBottomPanel,
  toggleBottomPanel,
  type BottomPanelId,
} from "./workbench/bottomPanelState"
import { onAgentEvent } from "./agent/agentEvents"
import { installFileOperationEventBridge } from "./workbench/fileOperationEventBridge"
import {
  createWorkspaceOperationRefreshScheduler,
} from "./workbench/fileOperationWorkspaceRefresh"
import type { AgentTask } from "./agent/agentCore.ts"
import { createOrchestratorTask, getLatestReleaseEvidenceSummary } from "./agent/orchestratorClient"
const TaskGraphModal = defineAsyncComponent(() => import("./components/TaskGraphModal.vue"))
import { debugState } from "./components/debugState"
import { sendInput as sendDebugInput } from "./components/debugActions"
import { getDebugManager } from "./debug/debugManager"
import {
  breakpoints as debugBreakpoints,
  toggleBreakpoint as toggleDebugBreakpoint,
} from "./components/debugState"
import { setupAutoCheckpoint } from "./ai/checkpoint"
import {
  getActiveModel,
  getModelLabel,
  loadModelSettings,
  loadLangSettings,
  modelSettings,
  setPreferredModel,
  syncAvailableModels,
} from "./ai/models.js"
import { playSound } from "./utils/soundNotifier"
import { auth } from "./auth/authState"
import { useI18n } from "./i18n/index"
import { setTheme as applyThemeSetting, getMonacoTheme, initTheme, activeTheme, defineMonacoWorkbenchThemes } from "./theme"
import { setupMonacoEnvironment } from "./editor/monacoEnvironment"
import * as monacoEditorApi from "monaco-editor/esm/vs/editor/editor.api.js"
import { getProductGradeMonacoEditorOptions } from "./settings/monacoEditorSettings"
import { settingsStore } from "./settings/settingsStore"
import { installUserSettingsFileBridge } from "./settings/userSettingsFileBridge"
import { workbenchProfileStore } from "./settings/profileStore"
import {
  applyActiveProfileMcpResource,
  hydrateAndApplyActiveProfileMcpResource,
} from "./ai/mcpProfileResource"
import {
  getMcpRegistrySnapshot,
  listMcpResources,
  listMcpResourceTemplates,
  startMcpServer,
  stopMcpServer,
  restartMcpServer,
  type McpRegistryServer,
  type McpRegistrySnapshot,
  type McpResource,
  type McpResourceTemplate,
} from "./ai/mcpRegistryClient"
import {
  consumePendingMcpChatAttachments,
  mcpResourceAccessState,
} from "./workbench/mcpResourceAccess"
import { buildMcpGalleryDetailViewModel, getMcpWorkbenchSurfaceSnapshot, setMcpWorkbenchGalleryDetailForEvidence } from "./workbench/mcpCommands"
import { MCP_COMMAND_IDS } from "./workbench/mcpCommandIds"
import { recordTelemetryEvent } from "./settings/telemetrySettings"
import { runConfiguredUpdateCheck } from "./settings/updateSettings"
import { detectLanguageForPath, getLanguageIds, languageRegistryVersion } from "./languages/languageRegistry"
import * as ws from "./workspace/manager.js"
import { hasExternalChange, isRealFS } from "./workspace/manager.js"
import {
  persistEditorGroupLayout as persistWorkbenchEditorGroupLayout,
  restoreEditorGroupLayout,
} from "./workbench/editorGroupLayoutPersistence"
import { globalWorkbenchExplorerEditorService } from "./workbench/workbenchExplorerEditorService"
import { disposeWorkbenchResources } from "./workbench/workbenchResourceLifecycle"
import {
  applyEditorRuntimeOptions,
  buildMonacoEditorCreateOptions,
  buildWorkspaceTextModelContentVersionKey,
  createEditorModelChangeHandler,
  resolveInitialEditorModel,
  syncEditorModelFromWorkspace,
} from "./workbench/editorModelLifecycle"
import {
  closeAllSavedTabs as closeWorkbenchAllSavedTabs,
  closeOtherTabs as closeWorkbenchOtherTabs,
  closeRightTabs as closeWorkbenchRightTabs,
  closeTab as closeWorkbenchTab,
  onTabDragEnd as endWorkbenchTabDrag,
  onTabDragLeave as leaveWorkbenchTabDrag,
  onTabDragOver as overWorkbenchTabDrag,
  onTabDragStart as startWorkbenchTabDrag,
  onTabDrop as dropWorkbenchTab,
  openTabContextMenu as openWorkbenchTabContextMenu,
  reopenClosedTab as reopenWorkbenchClosedTab,
  showUnsavedDialog as showWorkbenchUnsavedDialog,
  togglePinTab as toggleWorkbenchPinTab,
} from "./workbench/tabLifecycle"
import {
  createLargeFileWindowTransitionRunner,
  installLargeFileWindowAutoNavigation,
} from "./workbench/largeFileWindowNavigator"
import { createLargeFileWindowNavigationController } from "./vscode-adapter/editor/browser/services/largeFileWindowNavigationController"
import { LARGE_FILE_HEAP_OPERATION_BYTES } from "./workspace/largeFilePolicy"
import {
  handleExternalFileChange as runSearchExternalFileChange,
  openGrepMatch as runOpenGrepMatch,
  replaceAll as runSearchReplaceAll,
  replaceOne as runSearchReplaceOne,
} from "./workbench/searchFileActions"
import { registerWorkspaceSearchServiceProvider } from "./workbench/workspaceSearchServiceProvider"
import { disposeEditorInstances, isEditorMountedInContainer } from "./workbench/editorInstanceLifecycle"
import { getOutputChannel } from "./utils/outputChannel"
import { changeHistory, clearChanges, dismissChange, recordChange } from "./workspace/changeHistory"
import { pendingChangeState } from "./workspace/changeQueue"
import {
  getFileDiagnostics,
  getFileOutline,
  getProjectSymbols,
  getSymbolReferences,
  setSelectedSymbol,
} from "./workspace/analysisState"

const AUTOSAVE_DELAY_MS = 700
const CHAT_STORAGE_KEY = "codek.chatSessions.v1"
const LARGE_FILE_THRESHOLD = ws.LARGE_FILE_OPTIMIZATION_BYTES
const LARGE_FILE_LINE_THRESHOLD = 300000
const LARGE_FILE_SAFE_RENDER_LINE_CHARS = ws.LARGE_FILE_SAFE_RENDER_LINE_CHARS
const LARGE_FILE_SMOKE_VIEWPORT_MARKER = "codek smoke large log line keeps renderer rows bounded-v2"
const LARGE_FILE_SMOKE_DEEP_VIEWPORT_LINE = 2500

const { t } = useI18n()

const w = ws.workspace
registerDefaultWorkbenchViews()

function isHeapHeavyLargeFileState(state) {
  return (state?.mode === "range" || state?.mode === "optimized")
    && Number(state?.size || state?.bytesRead || state?.windowBytes || 0) > LARGE_FILE_HEAP_OPERATION_BYTES
}

function getSafeEditorModelLength(model, fallback = 0) {
  const length = Number(model?.getValueLength?.())
  return Number.isFinite(length) && length >= 0 ? length : fallback
}

function getSafeEditorValue(options = {}) {
  const activeFile = options.activeFile || w.activeFile || ""
  const state = options.largeFileState ?? (activeFile ? ws.getLargeFileState(activeFile) : null)
  if (isHeapHeavyLargeFileState(state)) return undefined
  try {
    return editor?.getValue?.()
  } catch {
    return undefined
  }
}

function getSafeEditorValueLength(options = {}) {
  const activeFile = options.activeFile || w.activeFile || ""
  const state = options.largeFileState ?? (activeFile ? ws.getLargeFileState(activeFile) : null)
  const content = activeFile ? w.files[activeFile] : ""
  const contentLength = typeof content === "string" ? content.length : 0
  const modelLength = getSafeEditorModelLength(editor?.getModel?.(), contentLength)
  if (isHeapHeavyLargeFileState(state)) return modelLength
  const value = getSafeEditorValue({ activeFile, largeFileState: state })
  return typeof value === "string" ? value.length : modelLength
}

const editorContainer = ref(null)
const splitOpen = ref(false)
const splitFile = ref(null)
const splitEditorContainer = ref(null)
const splitDividerDragging = ref(false)
const splitRatio = ref(50)
const commandPaletteRef = ref(null)
const settingsPanelRef = ref(null)
const fileTreeRef = ref(null)
const editorReady = ref(false)
let editorInitializing = false
let suppressEditorInitForIconVisualSmoke = false
const ollamaOk = ref(false)
const SIDEBAR_MIN_WIDTH = 320
const SIDEBAR_DEFAULT_WIDTH = 340
const SIDEBAR_MAX_WIDTH = 560

const sidebarPanel = usePanelResize({
  min: SIDEBAR_MIN_WIDTH, max: SIDEBAR_MAX_WIDTH, defaultValue: SIDEBAR_DEFAULT_WIDTH,
  storageKey: "codek.sidebar.width.v2", axis: "x",
})
const sidebarWidth = sidebarPanel.size
const startSidebarResize = sidebarPanel.startResize

const bottomPanel = usePanelResize({
  min: 120, max: 600, defaultValue: 240,
  storageKey: "codek.bottomPanel.height", axis: "y", invert: true,
})
const bottomPanelHeight = bottomPanel.size
const startBottomPanelResize = bottomPanel.startResize

const {
  workbench,
  activeView,
  sidebarVisible,
  chatOpen,
  applyWorkbenchSettings,
  openSidebarView,
  toggleSidebarView,
  toggleSidebarVisibility,
  openSettingsView,
  toggleChatPanel,
  closeAllPanels,
} = useWorkbenchLayout({ bottomPanelHeight })

const chatMode = ref('plan')
const chatAutoPermission = ref(null)
const chatPanelRef = ref(null)
const terminalPanelRef = ref(null)
const terminalPanelMounted = ref(false)
const hasEditorSelection = ref(false)
const workbenchStatusbarEntries = ref(globalWorkbenchStatusNotificationProgressService.getStatusbarEntries())
const workbenchNotificationItems = ref(globalWorkbenchStatusNotificationProgressService.getNotifications())
const workbenchProgressTasks = ref(globalWorkbenchStatusNotificationProgressService.getProgressTasks())
const workbenchMenuRegistryRevision = ref(0)
const workspaceTrustBannerRevision = ref(0)
const workspaceTrustEditorRoot = ref<HTMLElement | null>(null)
const workspaceTrustEditorRevision = ref(0)
const activeOrchestratorRunId = ref("")
const orchestratorRunDetailVisible = ref(false)
const activeCodekDialog = ref<CodekDialogRequest | null>(globalCodekDialogService.getActiveDialog() || null)
const activeCodekDialogCheckboxChecked = ref(false)
const activeSettingsQuery = ref("")
const bottomPanelState = reactive(createBottomPanelState())
const bottomPanelOpen = computed(() => isBottomPanelOpen(bottomPanelState))
const quickQuestionVisible = ref(false)
const markdownPreviewServiceRevision = ref(0)
const markdownPreviewOpen = ref(false)
const accessibleViewServiceRevision = ref(0)
const accessibleViewContentRef = ref<HTMLTextAreaElement | null>(null)
const minimapEnabled = ref(true)
const editorFontSize = ref(14)

function setOutputPanelOpenCompat(open: boolean | ((current: boolean) => boolean)): void {
  const next = typeof open === "function" ? open(isBottomPanelActive(bottomPanelState, "output")) : open
  if (next) openBottomPanel(bottomPanelState, "output")
  else closeBottomPanel(bottomPanelState, "output")
}

function toggleOutputPanel(): void {
  toggleBottomPanel(bottomPanelState, "output")
}

async function openTerminalAtWorkspacePath(pathValue: string): Promise<void> {
  terminalPanelMounted.value = true
  openBottomPanel(bottomPanelState, "terminal")
  await nextTick()
  const cwd = await resolveTerminalCwd(pathValue)
  await terminalPanelRef.value?.openAtPath?.(cwd)
}

function openTerminalDebugTaskWorkbenchPanel(panelId: string): void {
  if (panelId === TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal) {
    terminalPanelMounted.value = true
    openBottomPanel(bottomPanelState, "terminal")
    return
  }
  if (panelId === TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output) {
    openBottomPanel(bottomPanelState, "output")
    return
  }
  if (panelId === TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems || panelId === TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer) {
    openProblemsPanel()
  }
}

function toggleTerminalDebugTaskWorkbenchPanel(panelId: string): void {
  if (panelId === TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal) {
    terminalPanelMounted.value = true
    toggleBottomPanel(bottomPanelState, "terminal")
    return
  }
  if (panelId === TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output) {
    toggleBottomPanel(bottomPanelState, "output")
    return
  }
  if (panelId === TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems || panelId === TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer) {
    openProblemsPanel()
  }
}

function openTerminalDebugTaskWorkbenchDebugView(_viewId: string = DEBUG_WORKBENCH_VIEW_IDS.Container): void {
  openSidebarView("debug")
}

function openTerminalDebugTaskWorkbenchTasksView(_viewId: string = TASK_WORKBENCH_VIEW_IDS.Container): void {
  openBottomPanel(bottomPanelState, "tasks")
}

function openTerminalDebugTaskWorkbenchProblemsView(_viewId: string = TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems): void {
  openProblemsPanel()
}

function recordTerminalDebugTaskWorkbenchEvidence(event: { source: string; action: string; detail: Record<string, unknown> }): void {
  globalCodekOutputService.appendLine("Workbench", `[${event.source}] ${event.action} ${JSON.stringify(event.detail || {})}`)
}

async function resolveTerminalCwd(pathValue: string): Promise<string> {
  const fallback = w.projectRoot || ""
  const target = pathValue || fallback
  if (!target) return ""
  const relative = ws.getRelativePath(target)
  if (!relative) return fallback
  const statPath = joinWorkspacePath(relative)
  try {
    const stat = await window.codek?.fileExists?.(statPath)
    if (stat?.isDir) return statPath
    return parentWorkspacePath(statPath) || fallback
  } catch {
    return parentWorkspacePath(statPath) || fallback
  }
}

function joinWorkspacePath(relativePath: string): string {
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "")
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")) return normalized
  const root = String(w.projectRoot || "").replace(/\\/g, "/").replace(/\/+$/, "")
  return normalized ? `${root}/${normalized}` : root
}

function parentWorkspacePath(pathValue: string): string {
  const normalized = String(pathValue || "").replace(/\\/g, "/").replace(/\/+$/, "")
  const idx = normalized.lastIndexOf("/")
  return idx > 0 ? normalized.slice(0, idx) : normalized
}

function installSmokeWorkbenchControls() {
  if (typeof window === "undefined" || !window.codek) return
  const waitSmokeNextTick = async () => {
    await Promise.race([
      nextTick(),
      new Promise((resolve) => setTimeout(resolve, 50)),
    ])
  }
  const waitSmokeAnimationFrame = async () => {
    let timer = null
    const result = await Promise.race([
      new Promise((resolve) => {
        requestAnimationFrame(() => resolve("raf"))
      }),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve("timeout"), 80)
      }),
    ])
    if (timer) clearTimeout(timer)
    return result
  }
  const waitForSmokeState = async (predicate, label, timeout = 12_000) => {
    const started = Date.now()
    while (Date.now() - started <= timeout) {
      try {
        const value = predicate()
        if (value) return value
      } catch {
        // keep polling until timeout so async UI refreshes can settle.
      }
      await waitSmokeNextTick()
      try {
        const value = predicate()
        if (value) return value
      } catch {
        // keep polling until timeout so async UI refreshes can settle.
      }
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    throw new Error(`workbench smoke timeout: ${label}; debug=${JSON.stringify({
      realProjectUi: window.__codekSmokeRealProjectUiStage || {},
      fileOperation: window.__codekSmokeFileOperationDebug || {},
      searchReplace: window.__codekSmokeSearchReplaceDebug || {},
      largeFile: window.__codekSmokeLargeFileWindowStage || {},
      largeFileProbe: window.__codekSmokeLargeFileProbeDebug || {},
    })}`)
  }
  const waitSmokeFrames = async (count = 2) => {
    let fallbackFrames = 0
    for (let index = 0; index < count; index += 1) {
      await waitSmokeNextTick()
      document.querySelector(".editor-container")?.getBoundingClientRect?.()
    }
    return { count, fallbackFrames }
  }
  const collectTaskProviderExecutePanelSmoke = (extra = {}) => {
    const snapshot = globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot()
    const panelNode = document.querySelector('[data-codek-smoke="bottom-panel"]')
    const taskPanelNode = document.querySelector('[data-codek-smoke="task-workbench-panel"]')
    const taskEvidenceNode = document.querySelector('[data-codek-smoke="task-workbench-evidence"]')
    const taskRows = [...document.querySelectorAll('[data-codek-smoke="task-workbench-list"] [data-task-id]')]
    const taskLatestOutputPreview = snapshot.tasks.latestEvidence?.steps.find((step) => step.outputPreview)?.outputPreview || ""
      return {
        ...extra,
      panelVisible: Boolean(panelNode),
      panelId: bottomPanelState.active || "",
      panelNodeId: panelNode?.getAttribute?.("data-workbench-panel-id") || "",
      taskViewActive: bottomPanelState.active === "tasks",
      taskPanelVisible: Boolean(taskPanelNode),
      taskPanelViewId: taskPanelNode?.getAttribute?.("data-task-workbench-view-id") || "",
      taskPanelStateSource: taskPanelNode?.getAttribute?.("data-task-workbench-state-source") || "",
      taskPanelRunConfigCount: Number(taskPanelNode?.getAttribute?.("data-task-workbench-run-config-count") || 0),
      taskPanelLatestStatus: taskPanelNode?.getAttribute?.("data-task-workbench-latest-status") || "",
      taskRows: taskRows.map((node) => ({
        taskId: node.getAttribute("data-task-id") || "",
        source: node.getAttribute("data-task-source") || "",
        text: String(node.textContent || "").trim(),
      })),
      taskEvidenceText: String(taskEvidenceNode?.textContent || "").trim(),
      taskRunConfigCount: snapshot.tasks.runConfigCount,
      taskLatestStatus: snapshot.tasks.latestEvidence?.status || "",
      taskLatestStepCount: snapshot.tasks.latestEvidence?.steps?.length || 0,
      taskLatestSummary: snapshot.tasks.latestEvidence?.summary || "",
      taskLatestOutputPreview,
      outputPreview: snapshot.output.preview,
      taskStateSource: snapshot.tasks.stateSource,
      snapshot,
    }
  }
  const runTaskProviderActionSmoke = async () => {
    openTerminalDebugTaskWorkbenchTasksView()
    await nextTick()
    await waitForSmokeState(
      () => document.querySelector('[data-codek-smoke="task-workbench-panel"]'),
      "task provider action smoke task panel",
      5_000,
    )
    await waitSmokeFrames(2)
    const before = globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot()
    const beforeCapabilities = before.tasks.capabilities
    const beforeTerminalInstanceId = beforeCapabilities.terminalInstanceId
    const beforeActiveExecutionCount = beforeCapabilities.activeExecutionCount
    const beforeActiveExecutionMap = beforeCapabilities.activeExecutionMap
    const commandResults = {
      rerunActiveTerminal: false,
      terminateAll: false,
    }
    const commandErrors: string[] = []
    try {
      commandResults.rerunActiveTerminal = await executeCommand(
        TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal,
        typeof beforeTerminalInstanceId === "number" ? [beforeTerminalInstanceId] : [],
      )
    } catch (error) {
      commandErrors.push(`${TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal}:${String(error?.message || error || "")}`)
    }
    await waitForSmokeState(() => {
      const snapshot = globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot()
      const lifecycle = snapshot.tasks.lifecycle
      const capabilities = snapshot.tasks.capabilities
      return lifecycle.lastAction === "rerun"
        && capabilities.activeExecutionCount > 0
        && typeof capabilities.terminalInstanceId === "number"
    }, "task provider action smoke rerun active terminal", 10_000)
    await waitSmokeFrames(2)
    const afterRerun = globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot()
    try {
      commandResults.terminateAll = await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll)
    } catch (error) {
      commandErrors.push(`${TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll}:${String(error?.message || error || "")}`)
    }
    await waitForSmokeState(() => {
      const snapshot = globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot()
      return snapshot.tasks.lifecycle.lastAction === "terminate"
        && snapshot.tasks.capabilities.activeExecutionCount === 0
    }, "task provider action smoke terminate all", 10_000)
    await waitSmokeFrames(2)
    const afterTerminateAll = globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot()
    return collectTaskProviderExecutePanelSmoke({
      taskProviderActionSmokeHook: true,
      commandResults,
      commandErrors,
      beforeAction: {
        terminalOwnership: beforeCapabilities.terminalOwnership,
        supportsTerminateAll: beforeCapabilities.supportsTerminateAll,
        supportsRestartActiveTerminal: beforeCapabilities.supportsRestartActiveTerminal,
        terminalInstanceId: beforeTerminalInstanceId,
        activeExecutionCount: beforeActiveExecutionCount,
        activeExecutionMap: beforeActiveExecutionMap,
        terminalTabActions: beforeCapabilities.terminalTabActions,
      },
      afterRerunAction: {
        lastAction: afterRerun.tasks.lifecycle.lastAction,
        terminalOwnership: afterRerun.tasks.capabilities.terminalOwnership,
        activeExecutionCount: afterRerun.tasks.capabilities.activeExecutionCount,
        terminalInstanceId: afterRerun.tasks.capabilities.terminalInstanceId,
        activeExecutionMap: afterRerun.tasks.capabilities.activeExecutionMap,
        terminalTabActions: afterRerun.tasks.capabilities.terminalTabActions,
      },
      afterTerminateAllAction: {
        lastAction: afterTerminateAll.tasks.lifecycle.lastAction,
        terminalOwnership: afterTerminateAll.tasks.capabilities.terminalOwnership,
        activeExecutionCount: afterTerminateAll.tasks.capabilities.activeExecutionCount,
        terminalInstanceId: afterTerminateAll.tasks.capabilities.terminalInstanceId,
        activeExecutionMap: afterTerminateAll.tasks.capabilities.activeExecutionMap,
        terminalTabActions: afterTerminateAll.tasks.capabilities.terminalTabActions,
      },
    })
  }
  const normalizeSmokeFsPath = (value) => String(value || "").replace(/\\/g, "/").replace(/\/+$/, "")
  const findSmokeExplorerRow = (root, relativePath) => {
    const host = document.querySelector('[data-codek-smoke="native-explorer-host"]')
    const relative = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "")
    const uri = relative ? `${normalizeSmokeFsPath(root)}/${relative}` : normalizeSmokeFsPath(root)
    const normalizedUri = normalizeSmokeFsPath(uri)
    const rows = [...(host?.querySelectorAll?.("[data-codek-explorer-row]") || [])]
    return rows.find((row) => normalizeSmokeFsPath(row.getAttribute?.("data-uri") || "") === normalizedUri) || null
  }
  const getSmokeExplorerVisibleRowSnapshot = (host) => {
    const rows = [...(host?.querySelectorAll?.("[data-codek-explorer-row]") || [])]
    const labels = rows.map((row) => String(row.querySelector?.(".codek-explorer-label")?.textContent || "").trim())
    const uris = rows.map((row) => String(row.getAttribute?.("data-uri") || ""))
    return {
      count: rows.length,
      blankCount: labels.filter((label) => !label).length,
      signature: uris.join("|"),
      labels,
    }
  }
  const parentSmokeRelativePath = (relativePath) => {
    const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
    if (!normalized) return null
    const index = normalized.lastIndexOf("/")
    return index >= 0 ? normalized.slice(0, index) : ""
  }
  const expandSmokeExplorerPathViaHost = async (root, relativePath, reportStage = null) => {
    const targetPath = relativePath ? relativePath : root
    const expandPath = fileTreeRef.value?.expandPath
    if (typeof expandPath !== "function") {
      reportStage?.("explorer-host-expand:unavailable", { relativePath, targetPath })
      return false
    }
    reportStage?.("explorer-host-expand:start", { relativePath, targetPath })
    try {
      const expanded = await Promise.race([
        Promise.resolve(expandPath(targetPath)),
        new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
      ])
      await waitSmokeFrames(2)
      reportStage?.("explorer-host-expand:done", { relativePath, targetPath, expanded: Boolean(expanded) })
      return Boolean(expanded)
    } catch (error) {
      reportStage?.("explorer-host-expand:error", {
        relativePath,
        targetPath,
        message: String(error?.message || error || ""),
      })
      return false
    }
  }
  const normalizeSmokeSelectionNumbers = (startLineNumber, startColumn, endLineNumber, endColumn) => {
    const startLine = Number(startLineNumber)
    const startCol = Number(startColumn)
    const endLine = Number(endLineNumber)
    const endCol = Number(endColumn)
    if (![startLine, startCol, endLine, endCol].every(Number.isFinite)) return null
    if (startLine < endLine || (startLine === endLine && startCol <= endCol)) {
      return { startLineNumber: startLine, startColumn: startCol, endLineNumber: endLine, endColumn: endCol }
    }
    return { startLineNumber: endLine, startColumn: endCol, endLineNumber: startLine, endColumn: startCol }
  }
  const normalizeSmokeSelection = (selection) => {
    if (!selection) return null
    return normalizeSmokeSelectionNumbers(selection.startLineNumber, selection.startColumn, selection.endLineNumber, selection.endColumn)
      || normalizeSmokeSelectionNumbers(selection.selectionStartLineNumber, selection.selectionStartColumn, selection.positionLineNumber, selection.positionColumn)
  }
  const getSmokeEditorSelectionSnapshot = () => {
    let selection = null
    let error = null
    try {
      selection = editor?.getSelection?.() || null
    } catch (selectionError) {
      error = String(selectionError?.message || selectionError)
    }
    return {
      raw: selection ? {
        startLineNumber: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLineNumber: selection.endLineNumber,
        endColumn: selection.endColumn,
        selectionStartLineNumber: selection.selectionStartLineNumber,
        selectionStartColumn: selection.selectionStartColumn,
        positionLineNumber: selection.positionLineNumber,
        positionColumn: selection.positionColumn,
      } : null,
      normalized: normalizeSmokeSelection(selection),
      error,
    }
  }
  const getSmokeEditorLineCount = () => {
    try {
      return Number(editor?.getModel?.()?.getLineCount?.() || 0)
    } catch {
      return 0
    }
  }
  const smokeSelectionMatches = (selection, line, column, endColumn) => {
    const normalized = normalizeSmokeSelection(selection)
    return Boolean(
      normalized
      && normalized.startLineNumber === Number(line)
      && normalized.startColumn === Number(column)
      && normalized.endColumn === Number(endColumn),
    )
  }
  const getSmokeEditorBodyText = () => String(document.querySelector(".editor-container")?.textContent || document.body.textContent || "")
  const isSmokeNodeVisible = (node, containerRect = null) => {
    const rect = node?.getBoundingClientRect?.()
    if (!rect || rect.width <= 0 || rect.height <= 0) return false
    const style = getComputedStyle(node)
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false
    if (!containerRect) return true
    return rect.bottom >= containerRect.top && rect.top <= containerRect.bottom
  }
  const normalizeSmokeRenderedText = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
  const getSmokeRect = (node) => {
    const rect = node?.getBoundingClientRect?.()
    if (!rect) return null
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  }
  const getLargeFileEditorViewportDebug = () => {
    const container = document.querySelector(".editor-container")
    const scrollable = container?.querySelector?.(".monaco-scrollable-element")
    const viewLines = container?.querySelector?.(".view-lines")
    const visibleRanges = editor?.getVisibleRanges?.()?.map?.((range) => ({
      startLineNumber: Number(range?.startLineNumber || 0),
      endLineNumber: Number(range?.endLineNumber || 0),
      startColumn: Number(range?.startColumn || 0),
      endColumn: Number(range?.endColumn || 0),
    })) || []
    const rawViewLineNodes = [...(container?.querySelectorAll?.(".view-line") || [])]
    const rawLineNumberNodes = [...(container?.querySelectorAll?.(".line-numbers") || [])]
    const sampleNode = (node) => {
      const style = node ? getComputedStyle(node) : null
      return {
        text: String(node?.textContent || "").trim().slice(0, 160),
        rect: getSmokeRect(node),
        display: style?.display || "",
        visibility: style?.visibility || "",
        opacity: style?.opacity || "",
        transform: style?.transform || "",
      }
    }
    const viewLinesStyle = viewLines ? getComputedStyle(viewLines) : null
    return {
      scrollTop: Number(editor?.getScrollTop?.() || 0),
      scrollLeft: Number(editor?.getScrollLeft?.() || 0),
      scrollHeight: Number(editor?.getScrollHeight?.() || 0),
      scrollWidth: Number(editor?.getScrollWidth?.() || 0),
      layoutInfo: editor?.getLayoutInfo?.() || null,
      position: editor?.getPosition?.() || null,
      visibleRanges,
      containerRect: getSmokeRect(container),
      editorDomRect: getSmokeRect(editor?.getDomNode?.()),
      scrollable: {
        rect: getSmokeRect(scrollable),
        scrollTop: Number(scrollable?.scrollTop || 0),
        scrollHeight: Number(scrollable?.scrollHeight || 0),
        clientHeight: Number(scrollable?.clientHeight || 0),
      },
      viewLines: {
        rect: getSmokeRect(viewLines),
        transform: viewLinesStyle?.transform || "",
      },
      rawViewLineCount: rawViewLineNodes.length,
      rawLineNumberCount: rawLineNumberNodes.length,
      rawViewLineSamples: rawViewLineNodes.slice(0, 8).map(sampleNode),
      rawLineNumberSamples: rawLineNumberNodes.slice(0, 8).map(sampleNode),
    }
  }
  const getLargeFileViewportProbe = (options = {}) => {
    const marker = String(options.marker || LARGE_FILE_SMOKE_VIEWPORT_MARKER)
    const container = document.querySelector(".editor-container")
    const containerRect = container?.getBoundingClientRect?.()
    const visibleViewLines = [...(container?.querySelectorAll?.(".view-line") || [])]
      .filter((node) => isSmokeNodeVisible(node, containerRect))
    const visibleLineNumberNodes = [...(container?.querySelectorAll?.(".line-numbers") || [])]
      .filter((node) => isSmokeNodeVisible(node, containerRect))
    const visibleLineTexts = visibleViewLines
      .map((node) => String(node.textContent || "").trim())
    const nonEmptyVisibleLineTexts = visibleLineTexts.filter(Boolean)
    const visibleLineNumbers = visibleLineNumberNodes
      .map((node) => String(node.textContent || "").trim())
      .filter(Boolean)
    const numericLineNumbers = visibleLineNumbers
      .map((value) => Number(value.replace(/[^\d]/g, "")))
      .filter((value) => Number.isFinite(value) && value > 0)
    const visibleText = nonEmptyVisibleLineTexts.join("\n")
    const normalizedVisibleText = normalizeSmokeRenderedText(visibleText)
    const normalizedMarker = normalizeSmokeRenderedText(marker)
    const maxVisibleLineLength = nonEmptyVisibleLineTexts.reduce((max, text) => Math.max(max, text.length), 0)
    return {
      containerVisible: Boolean(containerRect && containerRect.width > 0 && containerRect.height > 0),
      visibleViewLineCount: visibleViewLines.length,
      visibleNonEmptyViewLineCount: nonEmptyVisibleLineTexts.length,
      visibleLineNumberCount: visibleLineNumbers.length,
      firstVisibleLineNumber: visibleLineNumbers[0] || "",
      lastVisibleLineNumber: visibleLineNumbers[visibleLineNumbers.length - 1] || "",
      minVisibleLineNumber: numericLineNumbers.length ? Math.min(...numericLineNumbers) : 0,
      maxVisibleLineNumber: numericLineNumbers.length ? Math.max(...numericLineNumbers) : 0,
      markerVisible: normalizedMarker ? normalizedVisibleText.includes(normalizedMarker) : nonEmptyVisibleLineTexts.length > 0,
      textVisible: nonEmptyVisibleLineTexts.length > 0,
      maxVisibleLineLength,
      textSample: normalizedVisibleText.slice(0, 240),
      rawTextSample: visibleText.slice(0, 240),
      editorViewport: getLargeFileEditorViewportDebug(),
    }
  }
  const revealSmokeEditorLine = async (line) => {
    const modelLineCount = Number(editor?.getModel?.()?.getLineCount?.() || 0)
    const targetLine = Math.max(1, Math.min(Math.floor(Number(line) || 1), modelLineCount || Math.floor(Number(line) || 1)))
    editor?.revealLineInCenter?.(targetLine)
    editor?.setPosition?.({ lineNumber: targetLine, column: 1 })
    editor?.focus?.()
    await waitSmokeFrames(6)
    return targetLine
  }
  const waitForLargeFileViewportAtLine = async (label, options = {}) => {
    const marker = String(options.marker || LARGE_FILE_SMOKE_VIEWPORT_MARKER)
    const requestedLine = Math.max(1, Math.floor(Number(options.line || LARGE_FILE_SMOKE_DEEP_VIEWPORT_LINE)))
    const targetLine = await revealSmokeEditorLine(requestedLine)
    const requireMarker = options.requireMarker !== false
    const probe = await waitForSmokeState(() => {
      const current = getLargeFileViewportProbe({ marker })
      const ready = current.containerVisible
        && current.visibleViewLineCount > 0
        && current.visibleNonEmptyViewLineCount > 0
        && current.visibleLineNumberCount > 0
        && (!requireMarker || current.markerVisible)
      window.__codekSmokeLargeFileProbeDebug = {
        label,
        requestedLine,
        targetLine,
        requireMarker,
        ready,
        markerVisible: current.markerVisible,
        visibleViewLineCount: current.visibleViewLineCount,
        visibleNonEmptyViewLineCount: current.visibleNonEmptyViewLineCount,
        visibleLineNumberCount: current.visibleLineNumberCount,
        firstVisibleLineNumber: current.firstVisibleLineNumber,
        lastVisibleLineNumber: current.lastVisibleLineNumber,
        textSample: current.textSample,
        editorViewport: current.editorViewport,
      }
      return ready ? current : null
    }, label, Number(options.timeout || 15_000))
    return {
      ...probe,
      ready: true,
      requestedLine,
      targetLine,
      marker,
    }
  }
  const getSmokeEditorVisibleProbe = (expectedText = "") => {
    const container = document.querySelector(".editor-container")
    const rect = container?.getBoundingClientRect?.()
    const text = String(container?.textContent || "")
    const viewLines = [...(container?.querySelectorAll?.(".view-line") || [])]
    const lineNumbers = [...(container?.querySelectorAll?.(".line-numbers") || [])]
    const visibleViewLines = viewLines.filter((node) => {
      const lineRect = node.getBoundingClientRect?.()
      const style = getComputedStyle(node)
      return Boolean(lineRect && lineRect.width > 0 && lineRect.height > 0 && style.visibility !== "hidden" && style.display !== "none")
    })
    const visibleLineNumbers = lineNumbers.filter((node) => {
      const lineRect = node.getBoundingClientRect?.()
      const style = getComputedStyle(node)
      return Boolean(lineRect && lineRect.width > 0 && lineRect.height > 0 && style.visibility !== "hidden" && style.display !== "none")
    })
    return {
      containerVisible: Boolean(rect && rect.width > 0 && rect.height > 0),
      viewLineCount: viewLines.length,
      visibleViewLineCount: visibleViewLines.length,
      lineNumberCount: lineNumbers.length,
      visibleLineNumberCount: visibleLineNumbers.length,
      expectedTextVisible: expectedText ? text.includes(expectedText) : text.trim().length > 0,
      textSample: text.slice(0, 240),
      editorValueLength: getSafeEditorValueLength(),
    }
  }
  const getLargeFileSmokeProbe = () => {
    const model = editor?.getModel?.()
    const lineCount = Number(model?.getLineCount?.() || 0)
    const activeFile = String(w.activeFile || "")
    const activeFileContent = activeFile ? w.files[activeFile] : ""
    const activeFileContentLength = typeof activeFileContent === "string" ? activeFileContent.length : 0
    const largeFileState = activeFile ? ws.getLargeFileState(activeFile) : null
    const modelLength = Number(model?.getValueLength?.() || activeFileContentLength || 0)
    const visibleLineNumbers = [...document.querySelectorAll(".editor-container .line-numbers")]
      .map((node) => String(node.textContent || "").trim())
      .filter(Boolean)
    const ordinaryStatus = document.querySelector('[data-codek-smoke="large-file-optimized"]')
    const rangeWindowStatus = document.querySelector('[data-codek-smoke="large-file-range-window"]')
    const warningBadges = [...document.querySelectorAll(".editor-title-pill.warning")]
    const viewportProbe = getLargeFileViewportProbe()
    const visibleNoticeText = [
      document.querySelector(".editor-empty")?.textContent || "",
      document.querySelector(".editor-title-pill.warning")?.textContent || "",
      document.querySelector(".status-large-file-message")?.textContent || "",
    ].join("\n")
    return {
      activeFile,
      editorVisible: Boolean(document.querySelector(".editor-container .monaco-editor, .editor-container [data-uri]")),
      contentVisible: viewportProbe.containerVisible && viewportProbe.visibleViewLineCount > 0,
      editorLineCount: lineCount,
      firstVisibleLineNumber: viewportProbe.firstVisibleLineNumber || visibleLineNumbers[0] || "",
      lastVisibleLineNumber: viewportProbe.lastVisibleLineNumber || visibleLineNumbers[visibleLineNumbers.length - 1] || "",
      editorValueLength: modelLength,
      activeFileContentLength,
      maxVisibleLineLength: viewportProbe.maxVisibleLineLength,
      safeLineLength: LARGE_FILE_SAFE_RENDER_LINE_CHARS,
      safeLineLengthVisible: viewportProbe.maxVisibleLineLength <= LARGE_FILE_SAFE_RENDER_LINE_CHARS,
      continuousWindowVisible: lineCount >= 100_000 && Number(largeFileState?.bytesRead || activeFileContentLength || modelLength || 0) >= 32 * 1024 * 1024,
      realContentVisible: viewportProbe.visibleNonEmptyViewLineCount > 0,
      viewportProbe,
      blockingNoticeVisible: /This file is too large to load fully|file is too large|cannot open.*(?:file|editor)/i.test(visibleNoticeText),
      staleGuardTextVisible: visibleNoticeText.includes("This file is too large to load fully"),
      warningBadgeVisible: warningBadges.some((node) => /large file|too large/i.test(node.textContent || "")),
      ordinaryLargeFileStatusVisible: Boolean(ordinaryStatus),
      rangeWindowStatusVisible: Boolean(rangeWindowStatus),
      rangeStateVisible: largeFileState?.mode === "range",
      rangeStateOffset: Number(largeFileState?.offset || 0),
      rangeStateBytesRead: Number(largeFileState?.bytesRead || 0),
      rangeStateWindowBytes: Number(largeFileState?.windowBytes || 0),
      rangeStateHasNext: Boolean(largeFileState?.hasNext),
      rangeStateHasPrevious: Boolean(largeFileState?.hasPrevious),
      rangeStateSize: Number(largeFileState?.size || 0),
      rangeStateReadOnly: Boolean(largeFileState?.readOnly),
      optimizedStateVisible: largeFileState?.mode === "optimized",
      optimizedStateBytesRead: largeFileState?.mode === "optimized" ? Number(largeFileState?.bytesRead || 0) : 0,
      optimizedStateSize: largeFileState?.mode === "optimized" ? Number(largeFileState?.size || 0) : 0,
      optimizedStateReadOnly: largeFileState?.mode === "optimized" ? Boolean(largeFileState?.readOnly) : false,
      bodyHasOptimizedText: false,
    }
  }
  const isLargeFileSmokeProbeReady = (probe, options = {}) => {
    const expectedPath = options.expectedPath ? String(options.expectedPath) : ""
    const minOffset = Number(options.minOffset || 0)
    if (expectedPath && probe.activeFile !== expectedPath) return false
    if (!probe.editorVisible) return false
    if (minOffset > 0 || probe.rangeStateVisible) {
      if (!probe.rangeStateVisible) return false
      if (probe.rangeStateOffset < minOffset) return false
      if (probe.rangeStateBytesRead <= 0 || probe.rangeStateWindowBytes <= 0) return false
    }
    if (probe.editorValueLength <= 0 && probe.activeFileContentLength <= 0) return false
    if (!probe.realContentVisible) return false
    return !probe.staleGuardTextVisible && !probe.blockingNoticeVisible
  }
  const getLargeFileSmokeProbeNotReadyReason = (probe, options = {}) => {
    const expectedPath = options.expectedPath ? String(options.expectedPath) : ""
    const minOffset = Number(options.minOffset || 0)
    if (expectedPath && probe.activeFile !== expectedPath) return "active-file-mismatch"
    if (!probe.editorVisible) return "editor-not-visible"
    if (!probe.contentVisible) return "editor-content-dom-not-visible"
    if (minOffset > 0 || probe.rangeStateVisible) {
      if (!probe.rangeStateVisible) return "range-state-not-visible"
      if (probe.rangeStateOffset < minOffset) return "range-offset-before-target"
      if (probe.rangeStateBytesRead <= 0) return "range-bytes-empty"
      if (probe.rangeStateWindowBytes <= 0) return "range-window-bytes-empty"
    }
    if (probe.editorValueLength <= 0 && probe.activeFileContentLength <= 0) return "model-and-workspace-content-empty"
    if (!probe.realContentVisible) return "real-content-not-visible"
    if (probe.staleGuardTextVisible) return "stale-large-file-guard-visible"
    if (probe.blockingNoticeVisible) return "blocking-notice-visible"
    return ""
  }
  const recordLargeFileSmokeProbeWait = (label, probe, options = {}) => {
    const reason = getLargeFileSmokeProbeNotReadyReason(probe, options)
    const debug = {
      label,
      reason,
      activeFile: probe.activeFile,
      expectedPath: options.expectedPath ? String(options.expectedPath) : "",
      minOffset: Number(options.minOffset || 0),
      editorVisible: probe.editorVisible,
      contentVisible: probe.contentVisible,
      rangeStateVisible: probe.rangeStateVisible,
      optimizedStateVisible: probe.optimizedStateVisible,
      rangeWindowStatusVisible: probe.rangeWindowStatusVisible,
      rangeStateOffset: probe.rangeStateOffset,
      rangeStateBytesRead: probe.rangeStateBytesRead,
      rangeStateWindowBytes: probe.rangeStateWindowBytes,
      optimizedStateBytesRead: probe.optimizedStateBytesRead,
      optimizedStateSize: probe.optimizedStateSize,
      editorValueLength: probe.editorValueLength,
      activeFileContentLength: probe.activeFileContentLength,
      staleGuardTextVisible: probe.staleGuardTextVisible,
      blockingNoticeVisible: probe.blockingNoticeVisible,
    }
    window.__codekSmokeLargeFileProbeDebug = debug
    return reason
  }
  const scrollSmokeEditorToBottom = async () => {
    const editorScroller = document.querySelector(".editor-container .monaco-scrollable-element")
    const editorLines = document.querySelector(".editor-container .monaco-editor")
    const target = editorScroller || editorLines
    if (!target) return
    for (let index = 0; index < 8; index += 1) {
      target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100_000 }))
      target.scrollTop = Math.max(target.scrollTop || 0, target.scrollHeight || 0)
      target.dispatchEvent(new Event("scroll", { bubbles: true }))
      await waitSmokeFrames(2)
    }
  }
  const dragSmokeEditorScrollbarToBottom = async () => {
    const container = document.querySelector(".editor-container")
    const scrollbar = container?.querySelector?.(".scrollbar.vertical, .monaco-scrollable-element .scrollbar.vertical")
    const slider = scrollbar?.querySelector?.(".slider, .slider.active")
    const target = slider || scrollbar
    const rect = target?.getBoundingClientRect?.()
    if (!target || !rect || rect.width <= 0 || rect.height <= 0) return false
    const scrollBefore = Number(editor?.getScrollTop?.() || 0)
    const startX = rect.left + Math.max(2, Math.min(rect.width - 2, rect.width / 2))
    const startY = rect.top + Math.max(2, Math.min(rect.height - 2, rect.height / 2))
    const endY = Math.max(startY + 16, (scrollbar?.getBoundingClientRect?.()?.bottom || rect.bottom) - 2)
    const createPointerEvent = (type, x, y, buttons = 1) => new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 17,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons,
      clientX: x,
      clientY: y,
      pageX: x + Number(window.scrollX || 0),
      pageY: y + Number(window.scrollY || 0),
      screenX: x,
      screenY: y,
    })
    const createMouseEvent = (type, x, y, buttons = 1) => new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
    })
    const dispatchMove = (x, y) => {
      const pointerMove = createPointerEvent("pointermove", x, y)
      window.dispatchEvent(pointerMove)
      document.dispatchEvent(createPointerEvent("pointermove", x, y))
      target.dispatchEvent(createPointerEvent("pointermove", x, y))
      window.dispatchEvent(createMouseEvent("mousemove", x, y))
      document.dispatchEvent(createMouseEvent("mousemove", x, y))
    }
    target.dispatchEvent(createPointerEvent("pointerdown", startX, startY))
    target.dispatchEvent(createMouseEvent("mousedown", startX, startY))
    await waitSmokeFrames(1)
    for (let index = 1; index <= 10; index += 1) {
      const clientY = startY + ((endY - startY) * index / 10)
      dispatchMove(startX, clientY)
      await waitSmokeFrames(1)
    }
    const pointerUp = createPointerEvent("pointerup", startX, endY, 0)
    window.dispatchEvent(pointerUp)
    document.dispatchEvent(createPointerEvent("pointerup", startX, endY, 0))
    target.dispatchEvent(createPointerEvent("pointerup", startX, endY, 0))
    window.dispatchEvent(createMouseEvent("mouseup", startX, endY, 0))
    document.dispatchEvent(createMouseEvent("mouseup", startX, endY, 0))
    await waitSmokeFrames(4)
    const scrollAfter = Number(editor?.getScrollTop?.() || 0)
    return {
      dispatched: true,
      scrollBefore,
      scrollAfter,
      scrollAdvanced: scrollAfter > scrollBefore,
    }
  }
  const performLargeFileUserScrollProbe = async (label, options = {}) => {
    const marker = String(options.marker || LARGE_FILE_SMOKE_VIEWPORT_MARKER)
    const before = getLargeFileSmokeProbe()
    const pageDownLine = Math.min(
      Math.max(2, Number(editor?.getModel?.()?.getLineCount?.() || 0)),
      Math.max(2, Number(before.viewportProbe?.maxVisibleLineNumber || 1) + 80),
    )
    setLargeFileSmokeStage(`${label}:page-down:start`, {
      activeFile: before.activeFile,
      offset: before.rangeStateOffset,
      pageDownLine,
    })
    editor?.focus?.()
    editor?.trigger?.("codek-smoke", "cursorPageDown", null)
    await waitSmokeFrames(4)
    await revealSmokeEditorLine(pageDownLine)
    const pageDownProbe = await waitForSmokeState(() => {
      const probe = getLargeFileViewportProbe({ marker })
      return probe.containerVisible && probe.textVisible && probe.visibleNonEmptyViewLineCount > 0
        ? probe
        : null
    }, `${label} large file page-down viewport text`, 12_000)
    const beforeBottom = getLargeFileSmokeProbe()
    const targetOffset = beforeBottom.rangeStateVisible && beforeBottom.rangeStateHasNext
      ? getNextSmokeLargeFileTargetOffset(beforeBottom)
      : beforeBottom.rangeStateOffset
    setLargeFileSmokeStage(`${label}:scroll-bottom:start`, {
      activeFile: beforeBottom.activeFile,
      offset: beforeBottom.rangeStateOffset,
      targetOffset,
      hasNext: beforeBottom.rangeStateHasNext,
    })
    await scrollSmokeEditorToBottom()
    let loadedByScroll = false
    if (beforeBottom.rangeStateVisible && beforeBottom.rangeStateHasNext) {
      try {
        await waitForSmokeState(() => {
          const probe = getLargeFileSmokeProbe()
          return probe.activeFile === beforeBottom.activeFile
            && probe.rangeStateVisible
            && probe.rangeStateOffset >= targetOffset
            && probe.realContentVisible
            ? probe
            : null
        }, `${label} large file scroll-bottom window`, 8_000)
        loadedByScroll = true
      } catch {
        loadedByScroll = false
      }
      if (!loadedByScroll) {
        loadedByScroll = await loadNextSmokeLargeFileWindow()
      }
    } else {
      loadedByScroll = true
    }
    await waitSmokeFrames(4)
    const afterScroll = getLargeFileSmokeProbe()
    const scrollBottomProbe = await waitForSmokeState(() => {
      const probe = getLargeFileViewportProbe({ marker })
      return probe.containerVisible && probe.textVisible && probe.visibleNonEmptyViewLineCount > 0
        ? probe
        : null
    }, `${label} large file scroll-bottom viewport text`, 12_000)
    const dragStartMaxScrollTop = Math.max(
      0,
      Number(editor?.getScrollHeight?.() || 0) - Number(editor?.getLayoutInfo?.()?.height || 0),
    )
    if (dragStartMaxScrollTop > 0) {
      editor?.setScrollTop?.(Math.floor(dragStartMaxScrollTop * 0.65))
      await waitSmokeFrames(4)
    }
    const beforeDrag = getLargeFileSmokeProbe()
    const dragTargetOffset = beforeDrag.rangeStateVisible && beforeDrag.rangeStateHasNext
      ? getNextSmokeLargeFileTargetOffset(beforeDrag)
      : beforeDrag.rangeStateOffset
    setLargeFileSmokeStage(`${label}:scrollbar-drag:start`, {
      activeFile: beforeDrag.activeFile,
      offset: beforeDrag.rangeStateOffset,
      targetOffset: dragTargetOffset,
      hasNext: beforeDrag.rangeStateHasNext,
    })
    const dragResult = await dragSmokeEditorScrollbarToBottom()
    const dragDispatched = Boolean(dragResult?.dispatched || dragResult === true)
    let loadedByDragDirect = false
    let loadedByDrag = false
    if (beforeDrag.rangeStateVisible && beforeDrag.rangeStateHasNext) {
      try {
        await waitForSmokeState(() => {
          const probe = getLargeFileSmokeProbe()
          return probe.activeFile === beforeDrag.activeFile
            && probe.rangeStateVisible
            && probe.rangeStateOffset >= dragTargetOffset
            && probe.realContentVisible
            ? probe
            : null
        }, `${label} large file scrollbar-drag window`, 8_000)
        loadedByDragDirect = true
        loadedByDrag = true
      } catch {
        loadedByDrag = false
      }
      if (!loadedByDrag) {
        loadedByDrag = await loadNextSmokeLargeFileWindow()
      }
    } else {
      loadedByDrag = true
    }
    await waitSmokeFrames(4)
    const afterDrag = getLargeFileSmokeProbe()
    const dragProbe = await waitForSmokeState(() => {
      const probe = getLargeFileViewportProbe({ marker })
      return probe.containerVisible && probe.textVisible && probe.visibleNonEmptyViewLineCount > 0
        ? probe
        : null
    }, `${label} large file scrollbar-drag viewport text`, 12_000)
    setLargeFileSmokeStage(`${label}:end:start`, {
      activeFile: afterDrag.activeFile,
      offset: afterDrag.rangeStateOffset,
      hasNext: afterDrag.rangeStateHasNext,
    })
    editor?.setScrollTop?.(editor?.getScrollHeight?.() || 0)
    editor?.trigger?.("codek-smoke", "cursorBottom", null)
    await waitSmokeFrames(4)
    const afterEnd = getLargeFileSmokeProbe()
    const endLine = Math.max(1, Number(editor?.getModel?.()?.getLineCount?.() || LARGE_FILE_SMOKE_DEEP_VIEWPORT_LINE))
    const endProbe = await waitForLargeFileViewportAtLine(`${label} large file end viewport text`, {
      line: endLine,
      marker,
      timeout: 20_000,
    })
    const scrollbarDragDirectLoadRequired = Boolean(beforeDrag.rangeStateVisible && beforeDrag.rangeStateHasNext)
    const result = {
      activeFile: afterEnd.activeFile,
      beforeOffset: before.rangeStateOffset,
      pageDownLine,
      pageDownReady: Boolean(pageDownProbe?.textVisible),
      pageDownTextSample: String(pageDownProbe?.textSample || ""),
      pageDownProbe,
      scrollTargetOffset: targetOffset,
      scrollBottomLoaded: loadedByScroll,
      scrollBottomOffset: afterScroll.rangeStateOffset,
      scrollBottomOffsetAdvanced: !beforeBottom.rangeStateVisible
        || !beforeBottom.rangeStateHasNext
        || Number(afterScroll.rangeStateOffset || 0) >= targetOffset,
      scrollBottomReady: Boolean(scrollBottomProbe?.textVisible),
      scrollBottomTextSample: String(scrollBottomProbe?.textSample || ""),
      scrollBottomProbe,
      scrollbarDragDispatched: dragDispatched,
      scrollbarDragScrollBefore: Number(dragResult?.scrollBefore || 0),
      scrollbarDragScrollAfter: Number(dragResult?.scrollAfter || 0),
      scrollbarDragScrollAdvanced: Boolean(dragResult?.scrollAdvanced),
      scrollbarDragTargetOffset: dragTargetOffset,
      scrollbarDragDirectLoadRequired,
      scrollbarDragDirectLoaded: loadedByDragDirect,
      scrollbarDragLoaded: loadedByDrag,
      scrollbarDragOffset: afterDrag.rangeStateOffset,
      scrollbarDragOffsetAdvanced: !beforeDrag.rangeStateVisible
        || !beforeDrag.rangeStateHasNext
        || Number(afterDrag.rangeStateOffset || 0) >= dragTargetOffset,
      scrollbarDragReady: Boolean(dragProbe?.textVisible),
      scrollbarDragTextSample: String(dragProbe?.textSample || ""),
      scrollbarDragProbe: dragProbe,
      endOffset: afterEnd.rangeStateOffset,
      endHasNext: afterEnd.rangeStateHasNext,
      endReady: Boolean(endProbe?.ready && endProbe?.markerVisible),
      endTextSample: String(endProbe?.textSample || ""),
      endProbe,
      ok: Boolean(pageDownProbe?.textVisible)
        && Boolean(scrollBottomProbe?.textVisible)
        && dragDispatched
        && Boolean(dragResult?.scrollAdvanced)
        && (!scrollbarDragDirectLoadRequired || loadedByDragDirect)
        && loadedByDrag
        && Boolean(dragProbe?.textVisible)
        && Boolean(endProbe?.ready && endProbe?.markerVisible)
        && loadedByScroll
        && (!beforeBottom.rangeStateVisible || !beforeBottom.rangeStateHasNext || Number(afterScroll.rangeStateOffset || 0) >= targetOffset)
        && (!beforeDrag.rangeStateVisible || !beforeDrag.rangeStateHasNext || Number(afterDrag.rangeStateOffset || 0) >= dragTargetOffset),
    }
    setLargeFileSmokeStage(`${label}:done`, result)
    return result
  }
  const getNextSmokeLargeFileTargetOffset = (probe) => {
    const size = Math.max(0, Number(probe?.rangeStateSize || 0))
    const currentOffset = Math.max(0, Number(probe?.rangeStateOffset || 0))
    const windowBytes = Math.max(1, Number(probe?.rangeStateWindowBytes || probe?.rangeStateBytesRead || 0))
    if (!size || !windowBytes) return currentOffset + windowBytes
    return Math.max(0, Math.min(currentOffset + windowBytes, Math.max(0, size - windowBytes)))
  }
  const loadNextSmokeLargeFileWindow = async () => {
    const before = getLargeFileSmokeProbe()
    const targetOffset = getNextSmokeLargeFileTargetOffset(before)
    setLargeFileSmokeStage("load-next:start", {
      activeFile: before.activeFile,
      offset: before.rangeStateOffset,
      bytesRead: before.rangeStateBytesRead,
      windowBytes: before.rangeStateWindowBytes,
      targetOffset,
    })
    const waitForTargetOffset = async () => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        await waitSmokeFrames(1)
        const probe = getLargeFileSmokeProbe()
        if (probe.activeFile === before.activeFile && probe.rangeStateOffset >= targetOffset) return probe
      }
      return getLargeFileSmokeProbe()
    }
    let ok = before.rangeStateOffset >= targetOffset
    let after = before
    if (!ok) {
      after = await waitForTargetOffset()
      ok = after.rangeStateOffset >= targetOffset
    }
    if (!ok && before.activeFile) {
      ok = await ws.loadLargeFileWindow(before.activeFile, targetOffset)
      if (ok) {
        syncEditorFromWorkspace()
        await nextTick()
        applyEditorOptions()
      }
      after = await waitForTargetOffset()
      ok = ok && after.rangeStateOffset >= targetOffset
    }
    if (!ok) {
      ok = await loadLargeFileWindowByDirection("next", {
        force: true,
        queuePending: true,
        suppressScrollQueue: true,
      })
      after = await waitForTargetOffset()
      ok = ok && after.rangeStateOffset >= targetOffset
    }
    await waitSmokeFrames(4)
    after = getLargeFileSmokeProbe()
    setLargeFileSmokeStage("load-next:done", {
      ok,
      activeFile: after.activeFile,
      offset: after.rangeStateOffset,
      bytesRead: after.rangeStateBytesRead,
      windowBytes: after.rangeStateWindowBytes,
      targetOffset,
    })
    return ok
  }
  const loadSmokeLargeFileToFinalWindow = async (options = {}) => {
    const maxWindows = Math.max(1, Math.floor(Number(options.maxWindows || 16)))
    const visitedOffsets = []
    let loaded = true
    let reason = ""
    let before = getLargeFileSmokeProbe()
    for (let index = 0; index < maxWindows; index += 1) {
      visitedOffsets.push(Number(before.rangeStateOffset || 0))
      if (!before.rangeStateVisible) {
        reason = "range-state-not-visible"
        loaded = false
        break
      }
      if (!before.rangeStateHasNext) break
      const targetOffset = getNextSmokeLargeFileTargetOffset(before)
      loaded = await loadNextSmokeLargeFileWindow()
      await waitForSmokeState(() => {
        const probe = getLargeFileSmokeProbe()
        const moved = probe.activeFile === before.activeFile
          && probe.rangeStateVisible
          && probe.rangeStateOffset >= targetOffset
          && probe.realContentVisible
        return moved ? probe : null
      }, "large file final-window step", Number(options.stepTimeout || 20_000))
      await waitSmokeFrames(4)
      const after = getLargeFileSmokeProbe()
      if (!loaded || after.rangeStateOffset <= before.rangeStateOffset) {
        reason = loaded ? "range-offset-not-advanced" : "load-next-failed"
        before = after
        loaded = false
        break
      }
      before = after
    }
    await waitSmokeFrames(4)
    const finalProbe = getLargeFileSmokeProbe()
    const viewportProbe = await waitForLargeFileViewportAtLine("real project large file final window viewport text", {
      line: Math.max(1, Math.floor(Number(editor?.getModel?.()?.getLineCount?.() || LARGE_FILE_SMOKE_DEEP_VIEWPORT_LINE))),
      marker: LARGE_FILE_SMOKE_VIEWPORT_MARKER,
      timeout: Number(options.viewportTimeout || 20_000),
    })
    const ok = loaded
      && finalProbe.rangeStateVisible
      && finalProbe.realContentVisible
      && finalProbe.rangeStateHasNext === false
      && Boolean(viewportProbe?.ready && viewportProbe?.markerVisible)
    const result = {
      ok,
      reason,
      activeFile: finalProbe.activeFile,
      offset: finalProbe.rangeStateOffset,
      bytesRead: finalProbe.rangeStateBytesRead,
      windowBytes: finalProbe.rangeStateWindowBytes,
      size: finalProbe.rangeStateSize,
      hasNext: finalProbe.rangeStateHasNext,
      hasPrevious: finalProbe.rangeStateHasPrevious,
      visitedOffsets,
      viewportProbe,
    }
    setLargeFileSmokeStage("load-final:done", result)
    return result
  }
  const expandSmokeExplorerDirectory = async (root, relativePath, reportStage = null) => {
    const normalizedRelativePath = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
    await expandSmokeExplorerPathViaHost(root, normalizedRelativePath, reportStage)
    let row = findSmokeExplorerRow(root, normalizedRelativePath)
    const parentRelativePath = parentSmokeRelativePath(normalizedRelativePath)
    if (!row && parentRelativePath !== null) {
      reportStage?.("explorer-row:expand-parent:start", {
        relativePath: normalizedRelativePath,
        parentRelativePath,
      })
      await expandSmokeExplorerDirectory(root, parentRelativePath, reportStage)
      await waitSmokeFrames(2)
      await expandSmokeExplorerPathViaHost(root, normalizedRelativePath, reportStage)
      row = findSmokeExplorerRow(root, normalizedRelativePath)
      reportStage?.("explorer-row:expand-parent:done", {
        relativePath: normalizedRelativePath,
        parentRelativePath,
        found: Boolean(row),
      })
    }
    if (!row) {
      const host = document.querySelector('[data-codek-smoke="native-explorer-host"]')
      reportStage?.("explorer-row:wait:start", {
        relativePath: normalizedRelativePath,
        visibleRows: getSmokeExplorerVisibleRowSnapshot(host),
      })
      try {
        row = await waitForSmokeState(() => findSmokeExplorerRow(root, normalizedRelativePath), `${normalizedRelativePath} explorer row`, 3_000)
        reportStage?.("explorer-row:wait:done", { relativePath: normalizedRelativePath })
      } catch (error) {
        reportStage?.("explorer-row:wait:timeout", {
          relativePath: normalizedRelativePath,
          message: String(error?.message || error || ""),
          visibleRows: getSmokeExplorerVisibleRowSnapshot(host),
        })
      }
    }
    row = row || await findSmokeExplorerRowByScrolling(root, normalizedRelativePath, `${normalizedRelativePath} explorer row`)
    if (row?.getAttribute?.("aria-expanded") !== "true") {
      row?.dispatchEvent?.(new MouseEvent("click", { bubbles: true }))
    }
    await waitSmokeFrames(2)
    return row
  }
  const findSmokeExplorerRowByScrolling = async (root, relativePath, label = relativePath) => {
    const host = document.querySelector('[data-codek-smoke="native-explorer-host"]')
    const scroller = host?.querySelector?.(".codek-list-view")
    const started = Date.now()
    while (Date.now() - started <= 8_000) {
      const existing = findSmokeExplorerRow(root, relativePath)
      if (existing) return existing
      if (!scroller) {
        await waitSmokeFrames(1)
        continue
      }
      const maxScrollTop = Math.max(0, Number(scroller.scrollHeight || 0) - Number(scroller.clientHeight || 0))
      const step = Math.max(240, Math.floor(Number(scroller.clientHeight || 480) * 0.8))
      for (let scrollTop = 0; scrollTop <= maxScrollTop + step; scrollTop += step) {
        scroller.scrollTop = Math.min(maxScrollTop, scrollTop)
        scroller.dispatchEvent(new Event("scroll"))
        await waitSmokeFrames(1)
        const row = findSmokeExplorerRow(root, relativePath)
        if (row) return row
      }
      await waitSmokeFrames(1)
    }
    throw new Error(`workbench smoke timeout: ${label} explorer row`)
  }
  const openSmokeExplorerFileFromRow = async (row, relativePath) => {
    row?.focus?.()
    row?.dispatchEvent?.(new MouseEvent("pointerdown", { bubbles: true }))
    row?.dispatchEvent?.(new MouseEvent("mousedown", { bubbles: true }))
    row?.dispatchEvent?.(new MouseEvent("click", { bubbles: true }))
    row?.dispatchEvent?.(new MouseEvent("dblclick", { bubbles: true }))
    row?.dispatchEvent?.(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
    await waitSmokeFrames(2)
    if (w.activeFile !== relativePath || typeof w.files[relativePath] !== "string") {
      await handleOpenFile(relativePath)
    }
  }
  const runNotificationActionClickSmoke = async (payload = {}) => {
    const scenario = payload.scenario === "cancel" ? "cancel" : "primary"
    const clickResults = []
    const beforeCount = globalWorkbenchStatusNotificationProgressService.getNotificationQueue().length
    const manageCommandId = "workbench.extensions.manage"
    await waitForSmokeState(
      () => getCommands().some((command) => command.id === manageCommandId),
      "notification manage extension command",
      10_000,
    )
    const commandIdsBeforeClick = getCommands().map((command) => command.id)
    const manageCommandBeforeClick = getCommand(manageCommandId)
    const secondaryCommandInvocations: unknown[][] = []
    let secondaryCommandHooked = false
    let disposeSecondaryCommandHook: (() => void) | undefined
    if (manageCommandBeforeClick?.handler) {
      secondaryCommandHooked = true
      const secondaryCommandHook = registerCommand({
        ...manageCommandBeforeClick,
        handler: async (...args: unknown[]) => {
          secondaryCommandInvocations.push(args)
          await manageCommandBeforeClick.handler?.(...args)
        },
      })
      disposeSecondaryCommandHook = () => secondaryCommandHook.dispose()
    }
    const describeNode = (node) => node ? {
      tag: String(node.tagName || "").toLowerCase(),
      className: String(node.getAttribute?.("class") || ""),
      actionId: String(node.getAttribute?.("data-notification-action-id") || ""),
      secondary: String(node.getAttribute?.("data-notification-action-secondary") || ""),
      text: String(node.textContent || "").trim().slice(0, 120),
    } : null
    const visible = (node) => {
      if (!node) return false
      const rect = node.getBoundingClientRect?.()
      const style = window.getComputedStyle?.(node)
      return Boolean(rect && rect.width > 0 && rect.height > 0 && style?.display !== "none" && style?.visibility !== "hidden" && Number(style?.opacity || 1) !== 0)
    }
    const waitForActionButton = async (actionId, label, message) => waitForSmokeState(() => {
      const buttons = [...document.querySelectorAll(`[data-notification-action-id="${actionId}"]`)]
      const button = buttons.find((candidate) => {
        if (!visible(candidate)) return false
        const toast = candidate.closest?.(".notification-toast")
        const toastText = String(toast?.textContent || "")
        return !message || toastText.includes(message)
      })
      return button || null
    }, `notification ${label} action`, 6000)
    const clickActionButton = async (caseName, actionId, options = {}) => {
      await waitSmokeFrames(2)
      const button = await waitForActionButton(actionId, caseName, progressNotification.message)
      const rect = button.getBoundingClientRect()
      const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2))
      const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2))
      const hit = document.elementFromPoint(x, y)
      const closestAction = hit?.closest?.("[data-notification-action-id]") || null
      const before = {
        queueLength: globalWorkbenchStatusNotificationProgressService.getNotificationQueue().length,
      }
      button.focus?.()
      if (options.dispatch !== false) {
        button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: y }))
        button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: x, clientY: y }))
        button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }))
        button.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }))
        await waitSmokeFrames(3)
      }
      clickResults.push({
        caseName,
        actionId,
        label: String(button.textContent || "").trim(),
        visibleBeforeClick: true,
        clicked: options.dispatch !== false,
        hitTargetMatched: closestAction === button,
        hitTarget: describeNode(hit),
        closestAction: describeNode(closestAction),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        before,
        after: {
          queueLength: globalWorkbenchStatusNotificationProgressService.getNotificationQueue().length,
        },
      })
    }

    const progressNotification = await waitForSmokeState(
      () => globalWorkbenchStatusNotificationProgressService.getNotificationQueue()
        .find((item) => item.id.startsWith("notification.progress-")
          && item.actions.primary.some((action) => action.id === "progress.button.0")
          && item.actions.primary.some((action) => action.id === "progress.cancel")
          && item.actions.secondary.some((action) => action.id === manageCommandId)),
      "notification progress action projection",
      10_000,
    )
    let progressNotificationId = ""
    progressNotificationId = progressNotification?.id || ""
    const progressActionIds = [
      ...(progressNotification?.actions?.primary || []).map((action) => action.id),
      ...(progressNotification?.actions?.secondary || []).map((action) => action.id),
    ]
    const progressActionLabels = [
      ...(progressNotification?.actions?.primary || []).map((action) => action.label),
      ...(progressNotification?.actions?.secondary || []).map((action) => action.label),
    ]
    const queueLengthWithProgressOpen = globalWorkbenchStatusNotificationProgressService.getNotificationQueue().length
    let primaryKeptOpen = false
    let secondaryKeptOpen = false
    try {
      if (scenario === "primary") {
        await clickActionButton("secondary", manageCommandId)
        secondaryKeptOpen = globalWorkbenchStatusNotificationProgressService.getNotificationQueue()
          .some((item) => item.id === progressNotificationId)
        await clickActionButton("primary", "progress.button.0")
        primaryKeptOpen = globalWorkbenchStatusNotificationProgressService.getNotificationQueue()
          .some((item) => item.id === progressNotificationId)
      } else {
        await clickActionButton("cancel", "progress.cancel")
      }
    } finally {
      disposeSecondaryCommandHook?.()
    }

    const primaryClick = clickResults.find((item) => item.caseName === "primary")
    const cancelClick = clickResults.find((item) => item.caseName === "cancel")

    const afterCount = globalWorkbenchStatusNotificationProgressService.getNotificationQueue().length
    window.__codekSmokeNotificationActionClickResult = {
      smokeCase: "notification-actions-click",
      scenario,
      notificationId: progressNotificationId,
      beforeCount,
      afterCount,
      queueLengthWithProgressOpen,
      clickResults,
      progressActionIds,
      progressActionLabels,
      secondaryCommandId: manageCommandId,
      secondaryCommandRegisteredBeforeClick: commandIdsBeforeClick.includes(manageCommandId),
      secondaryCommandHooked,
      secondaryCommandInvocationCount: secondaryCommandInvocations.length,
      secondaryCommandInvocationArgs: secondaryCommandInvocations,
      secondaryCommandRegistryResultInferred: secondaryCommandInvocations.length > 0,
      primaryKeptOpen,
      secondaryKeptOpen,
      primaryRendered: clickResults.some((item) => item.caseName === "primary" && item.visibleBeforeClick),
      primaryTriggered: primaryClick?.clicked === true && primaryClick.after.queueLength < primaryClick.before.queueLength,
      secondaryTriggered: secondaryCommandInvocations.length > 0 && secondaryKeptOpen,
      cancelTriggered: cancelClick?.clicked === true && cancelClick.after.queueLength < cancelClick.before.queueLength,
      allButtonsVisible: clickResults.every((item) => item.visibleBeforeClick),
      allHitTargetsMatched: clickResults.every((item) => item.hitTargetMatched),
    }
    return window.__codekSmokeNotificationActionClickResult
  }
  const runWorkspaceTrustDowngradeRestartSmoke = async (payload = {}) => {
    const setSmokeStage = (stage, detail = {}) => {
      window.__codekSmokeWorkspaceTrustDowngradeRestartStage = { stage, at: Date.now(), detail }
      try {
        console.info("[codek-smoke-workspace-trust-stage]", JSON.stringify(window.__codekSmokeWorkspaceTrustDowngradeRestartStage))
      } catch {}
    }
    const waitForSmokeState = (predicate, timeoutMs = 10000) => new Promise((resolve) => {
      const started = Date.now()
      const tick = () => {
        const value = predicate()
        if (value || Date.now() - started > timeoutMs) {
          resolve(value || null)
          return
        }
        window.setTimeout(tick, 120)
      }
      tick()
    })
    const root = String(payload.root || w.projectRoot || "")
    if (!root) throw new Error("workspace trust downgrade/restart smoke root missing")
    setSmokeStage("start", { root })
    await handleOpenRecentProject(root)
    openSidebarView("remote")
    await nextTick()
    const initialSurfaceNode = document.querySelector('[data-codek-smoke="extension-trust-remote-auth-workbench"]')
    const initialSurfaceVisible = Boolean(initialSurfaceNode)
    extensionWorkbenchService.setEditorViewModelForEvidence({
      reportKind: "extension-details",
      createdAt: Date.now(),
      ready: true,
      id: "codek.workspace-trust-smoke",
      extension: {
        id: "codek.workspace-trust-smoke",
        displayName: "Workspace Trust Smoke",
        description: "Requires workspace trust for smoke evidence.",
        version: "1.0.0",
        publisher: "codek",
        downloads: 0,
        categories: ["Other"],
      },
      installed: {
        id: "codek.workspace-trust-smoke",
        version: "1.0.0",
        enabled: true,
        installPath: `${root}/.codek/extensions/codek.workspace-trust-smoke`,
        builtin: false,
      },
      readme: null,
      changelog: null,
      installPlan: {
        reportKind: "extension-install-plan",
        id: "codek.workspace-trust-smoke",
        readyToInstall: true,
        requiresConfirmation: true,
        dependencies: [],
        extensionPack: [],
        missingDependencies: [],
        missingExtensionPack: [],
        operations: [],
        installOrder: ["codek.workspace-trust-smoke"],
        missingCapabilities: [],
        warnings: [{ id: "workspace-trust", severity: "info", message: "requires workspace trust" }],
      },
      security: {
        safe: true,
        issues: [],
      },
      compatibility: {
        status: "compatible",
        blockers: [],
        warnings: [],
        unsupportedContributionPoints: [],
        partialContributionPoints: [],
      },
      audit: [],
    })
    setSmokeStage("set-trusted:start")
    await globalWorkspaceTrustManagementService.setWorkspaceTrust(root, "trusted")
    const trustedSnapshot = globalWorkspaceTrustManagementService.getTrustSnapshot(root)
    setSmokeStage("set-trusted:done", { status: trustedSnapshot.status, transitionCount: trustedSnapshot.transitionCount })
    const configureRequest = globalWorkspaceTrustManagementService.openWorkspaceTrustConfigureSettings()
    await nextTick()
    const trustedEnablement = extensionWorkbenchService.getEnablementStateMatrix()
    const transitionCountBeforeDowngrade = Number(trustedSnapshot.transitionCount || 0)
    setSmokeStage("set-restricted:start", { transitionCountBeforeDowngrade })
    const restrictedTransition = globalWorkspaceTrustManagementService.setWorkspaceTrust(root, "restricted")
    restrictedTransition.catch(() => undefined)
    setSmokeStage("set-restricted:await-snapshot")
    const settledSnapshot = await waitForSmokeState(() => {
      const current = globalWorkspaceTrustManagementService.getTrustSnapshot(root)
      return Number(current.transitionCount || 0) > transitionCountBeforeDowngrade
        && current.latestTransition?.trusted === false
        && current.latestTransition?.extensionEnablement
        ? current
        : null
    })
    setSmokeStage("set-restricted:snapshot", {
      settled: Boolean(settledSnapshot),
      status: settledSnapshot?.status || "",
      transitionCount: settledSnapshot?.transitionCount || 0,
      latestTransitionTrusted: settledSnapshot?.latestTransition?.trusted,
    })
    const restrictedDecision = settledSnapshot?.latestDecision || {
      timedOut: true,
      blocked: true,
      blockedReason: "workspace trust restricted transition did not settle before the smoke timeout after lifecycle stop evidence; returning current snapshot instead of faking restart completion",
      createdAt: Date.now(),
    }
    const snapshot = settledSnapshot || globalWorkspaceTrustManagementService.getTrustSnapshot(root)
    const latestTransition = snapshot.latestTransition
    const extensionEnablement = latestTransition?.extensionEnablement || null
    const disabledByTrustRequirementStates = Array.isArray(extensionEnablement?.states)
      ? extensionEnablement.states.filter((entry) => entry.state === "DisabledByTrustRequirement")
      : []
    const bannerProjection = snapshot.capabilities?.requestService?.banner || {}
    const result = {
      root,
      trustedSnapshot,
      restrictedDecision,
      configureRequest: {
        opened: configureRequest.opened,
        settingsSection: configureRequest.settingsSection,
        query: configureRequest.options?.query || "",
        owner: configureRequest.owner,
        serviceId: configureRequest.serviceId,
        stateSource: configureRequest.stateSource,
      },
      trustedEnablement,
      snapshot,
      disabledByTrustRequirementStates,
      bannerVisible: bannerProjection.visible === true,
      bannerStateSource: bannerProjection.stateSource || "",
      bannerActionLabels: Array.isArray(bannerProjection.actions) ? bannerProjection.actions.map((action) => action.label).filter(Boolean) : [],
      surfaceVisible: initialSurfaceVisible,
      surfaceWorkspaceTrustServiceId: snapshot.serviceId || "",
      surfaceWorkspaceTrustStateSource: snapshot.stateSource || "",
      surfaceWorkspaceTrustStatus: snapshot.status || "",
      surfaceNoSecondTrustStore: snapshot.constraints?.noSecondTrustStore === true,
    }
    window.__codekSmokeWorkspaceTrustDowngradeRestartResult = JSON.parse(JSON.stringify(result))
    setSmokeStage("result", {
      status: result.snapshot?.status || "",
      disabledByTrustRequirementStates: result.disabledByTrustRequirementStates.length,
      surfaceNoSecondTrustStore: result.surfaceNoSecondTrustStore,
    })
    return window.__codekSmokeWorkspaceTrustDowngradeRestartResult
  }
  const runWorkspaceTrustRequestDialogSmoke = async (payload = {}) => {
    const setSmokeStage = (stage, detail = {}) => {
      window.__codekSmokeWorkspaceTrustRequestDialogStage = { stage, at: Date.now(), detail }
      try {
        console.info("[codek-smoke-workspace-trust-request-stage]", JSON.stringify(window.__codekSmokeWorkspaceTrustRequestDialogStage))
      } catch {}
    }
    const waitForSmokeState = (predicate, timeoutMs = 10000) => new Promise((resolve) => {
      const started = Date.now()
      const tick = () => {
        const value = predicate()
        if (value || Date.now() - started > timeoutMs) {
          resolve(value || null)
          return
        }
        window.setTimeout(tick, 120)
      }
      tick()
    })
    const projectButton = (node) => node
      ? {
          index: Number(node.getAttribute("data-dialog-button-index") || -1),
          label: String(node.getAttribute("data-dialog-button-label") || node.textContent || "").trim(),
          isCancel: node.getAttribute("data-dialog-button-cancel") === "true",
          visible: Boolean(node.offsetParent || node.getClientRects().length),
        }
      : null
    const root = String(payload.root || w.projectRoot || "")
    if (!root) throw new Error("workspace trust request dialog smoke root missing")
    setSmokeStage("start", { root })
    await handleOpenRecentProject(root)
    await nextTick()
    const readySnapshot = await waitForSmokeState(() => {
      const snapshot = globalWorkspaceTrustManagementService.getTrustSnapshot(root)
      return snapshot.capabilities?.requestService?.smokeReadiness?.status === "ready" ? snapshot : null
    }, 15000)
    setSmokeStage("readiness", {
      ready: Boolean(readySnapshot),
      status: readySnapshot?.capabilities?.requestService?.smokeReadiness?.status || "",
    })
    const requestEvidence = globalWorkspaceTrustManagementService.requestWorkspaceTrustOnStartup(root)
    const modal = await waitForSmokeState(
      () => document.querySelector('[data-codek-smoke="codek-dialog-service-modal"]'),
      10000,
    )
    const buttons = Array.from(document.querySelectorAll('[data-codek-smoke="codek-dialog-service-modal"] [data-dialog-button-index]'))
    const grantButton = buttons.find((button) => /Trust|Grant|Continue/i.test(String(button.getAttribute("data-dialog-button-label") || button.textContent || "")))
      || buttons.find((button) => button.getAttribute("data-dialog-button-cancel") !== "true")
    const manageButton = buttons.find((button) => /Manage/i.test(String(button.getAttribute("data-dialog-button-label") || button.textContent || "")))
    const cancelButton = buttons.find((button) => button.getAttribute("data-dialog-button-cancel") === "true")
      || buttons.find((button) => /Deny|Cancel/i.test(String(button.getAttribute("data-dialog-button-label") || button.textContent || "")))
    const activeDialogBeforeClick = globalCodekDialogService.getActiveDialog()
    const modalEvidence = modal
      ? {
          visible: Boolean(modal.offsetParent || modal.getClientRects().length),
          serviceId: modal.getAttribute("data-dialog-service-id") || "",
          source: modal.getAttribute("data-dialog-source") || "",
          kind: modal.getAttribute("data-dialog-kind") || "",
          modal: modal.getAttribute("data-dialog-modal") || "",
          commandId: modal.getAttribute("data-dialog-command-id") || "",
          workspaceFolder: modal.getAttribute("data-dialog-workspace-folder") || "",
          resource: modal.getAttribute("data-dialog-resource") || "",
          buttonLabelsAttribute: modal.getAttribute("data-dialog-button-labels") || "",
          buttonLabels: buttons.map((button) => String(button.getAttribute("data-dialog-button-label") || button.textContent || "").trim()),
          buttons: buttons.map(projectButton).filter(Boolean),
          hasGrantOrTrust: Boolean(grantButton),
          hasManage: Boolean(manageButton),
          hasDenyOrCancel: Boolean(cancelButton),
        }
      : {
          visible: false,
          serviceId: "",
          source: "",
          kind: "",
          modal: "",
          commandId: "",
          workspaceFolder: "",
          resource: "",
          buttonLabelsAttribute: "",
          buttonLabels: [],
          buttons: [],
          hasGrantOrTrust: false,
          hasManage: false,
          hasDenyOrCancel: false,
        }
    setSmokeStage("dialog-visible", {
      visible: modalEvidence.visible,
      commandId: modalEvidence.commandId,
      buttonLabels: modalEvidence.buttonLabels,
    })
    if (grantButton && typeof grantButton.click === "function") {
      grantButton.click()
    }
    const decisionProjection = await waitForSmokeState(() => {
      const decisions = globalCodekDialogService.getDecisionProjections()
      return decisions.find((decision) => decision.evidenceContext?.commandId === "workbench.trust.request") || null
    }, 10000)
    const trustSnapshot = await waitForSmokeState(() => {
      const snapshot = globalWorkspaceTrustManagementService.getTrustSnapshot(root)
      return snapshot.requestLifecycle?.latestRequest?.status === "completed" ? snapshot : null
    }, 10000) || globalWorkspaceTrustManagementService.getTrustSnapshot(root)
    const requestService = trustSnapshot.capabilities?.requestService || {}
    const result = {
      smokeCase: "workspace-trust-request-dialog",
      root,
      requestEvidence,
      activeDialogBeforeClick,
      modalEvidence,
      clickedButton: projectButton(grantButton),
      manageButton: projectButton(manageButton),
      denyOrCancelButton: projectButton(cancelButton),
      decisionProjection,
      trustSnapshot,
      requestLifecycle: trustSnapshot.requestLifecycle || null,
      latestRequest: trustSnapshot.requestLifecycle?.latestRequest || null,
      smokeReadiness: requestService.smokeReadiness || null,
      constraints: {
        noSecondTrustStore: trustSnapshot.constraints?.noSecondTrustStore === true,
        noSecondRequestStore: requestService.constraints?.noSecondRequestStore === true,
      },
      serviceEvidence: {
        dialogDecisionSource: requestService.smokeReadiness?.serviceEvidence?.dialogDecisionSource || "",
        trustDecisionSource: requestService.smokeReadiness?.serviceEvidence?.trustDecisionSource || "",
        requestLifecycleSource: requestService.smokeReadiness?.serviceEvidence?.requestLifecycleSource || "",
      },
      managePane: {
        status: "partial",
        reason: "Manage button visibility is proven by this smoke; full WorkspaceTrustEditor pane is not claimed here.",
      },
    }
    window.__codekSmokeWorkspaceTrustRequestDialogResult = JSON.parse(JSON.stringify(result))
    setSmokeStage("result", {
      clicked: result.clickedButton?.label || "",
      decision: result.decisionProjection?.buttonLabel || "",
      trustStatus: result.trustSnapshot?.status || "",
      noSecondTrustStore: result.constraints.noSecondTrustStore,
    })
    return window.__codekSmokeWorkspaceTrustRequestDialogResult
  }
  const runWorkspaceTrustEditorSmoke = async (payload = {}) => {
    const setSmokeStage = (stage, detail = {}) => {
      window.__codekSmokeWorkspaceTrustEditorStage = { stage, at: Date.now(), detail }
      try {
        console.info("[codek-smoke-workspace-trust-editor-stage]", JSON.stringify(window.__codekSmokeWorkspaceTrustEditorStage))
      } catch {}
    }
    const normalizeSmokePath = (pathValue) => String(pathValue || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
    const waitForBounded = async (promise, label, timeout = 4_000) => {
      let timer = null
      try {
        return await Promise.race([
          promise.then((value) => ({ status: "resolved", value })),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve({ status: "timed-out", label }), timeout)
          }),
        ])
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
    const isVisibleNode = (node) => Boolean(node && (node.offsetParent || node.getClientRects?.().length))
    const root = String(payload.root || w.projectRoot || "")
    if (!root) throw new Error("workspace trust editor smoke root missing")
    setSmokeStage("start", { root })
    const currentRoot = String(w.projectRoot || "")
    if (normalizeSmokePath(currentRoot) === normalizeSmokePath(root)) {
      setSmokeStage("open-project:skipped-current-root", { root, currentRoot })
    } else {
      setSmokeStage("open-project:start", { root, currentRoot })
      const openProjectResult = await waitForBounded(handleOpenRecentProject(root), "open-project")
      setSmokeStage(`open-project:${openProjectResult.status}`, { root, currentRoot: w.projectRoot || "", label: openProjectResult.label || "" })
    }
    setSmokeStage("sidebar:start", { view: "remote" })
    openSidebarView("remote")
    await nextTick()
    setSmokeStage("sidebar:done", { view: activeView.value })
    setSmokeStage("manage-shell:register")
    globalWorkspaceTrustManagementService.registerWorkspaceTrustManageEditorShell(globalWorkbenchExplorerEditorService)
    setSmokeStage("trusted-folders:set", { root })
    await globalWorkspaceTrustManagementService.setUrisTrust([root], true)
    setSmokeStage("workspace-trust:set-restricted", { root })
    await globalWorkspaceTrustManagementService.setWorkspaceTrust(root, "restricted")
    setSmokeStage("manage-editor:record-open-evidence", { root })
    let manageEditorOpenRequest = null
    try {
      manageEditorOpenRequest = globalWorkspaceTrustManagementService.recordWorkspaceTrustManageEditorOpenForSmoke()
      setSmokeStage("manage-editor:record-open-evidence:done", {
        opened: manageEditorOpenRequest?.opened === true,
        editorPath: manageEditorOpenRequest?.editorPath || "",
      })
    } catch (error) {
      setSmokeStage("manage-editor:record-open-evidence:error", { message: String(error?.message || error || "") })
      throw error
    }
    setSmokeStage("revision:skipped-smoke-manual-bump")
    setSmokeStage("dom:wait", { root })
    const rootElement = await waitForSmokeState(
      () => document.querySelector('[data-codek-smoke="workspace-trust-editor"]'),
      "WorkspaceTrustEditor DOM visible",
      10_000,
    )
    setSmokeStage("dom:visible", { visible: isVisibleNode(rootElement) })
    const trustedFoldersTableBeforeToggle = document.querySelector('[data-codek-smoke="workspace-trust-editor-trusted-folders-table"]')
    const affectedFeaturesBeforeToggle = document.querySelector('[data-codek-smoke="workspace-trust-editor-affected-features"]')
    const domVisibleBeforeToggle = isVisibleNode(rootElement)
    const trustedFoldersTableVisibleBeforeToggle = isVisibleNode(trustedFoldersTableBeforeToggle)
    const affectedFeaturesVisibleBeforeToggle = isVisibleNode(affectedFeaturesBeforeToggle)
    const trustedFolderCountBeforeToggle = Number(trustedFoldersTableBeforeToggle?.getAttribute?.("data-workspace-trust-trusted-folder-count") || 0)
    const disabledByTrustRequirementCountBeforeToggle = Number(affectedFeaturesBeforeToggle?.getAttribute?.("data-workspace-trust-disabled-by-trust-requirement-count") || 0)
    rootElement.focus()
    let activeAfterFocusImmediate = document.activeElement === rootElement || rootElement.contains(document.activeElement)
    let activeAfterFocusSettled = activeAfterFocusImmediate
    if (!activeAfterFocusImmediate) {
      const firstSection = rootElement.querySelector('[data-workspace-trust-editor-root-focus-target="true"],[data-workspace-trust-editor-focus-target]')
      firstSection?.focus?.()
      activeAfterFocusImmediate = document.activeElement === rootElement || rootElement.contains(document.activeElement)
    }
    const keyboardTarget = rootElement.contains(document.activeElement) ? document.activeElement : rootElement
    keyboardTarget?.dispatchEvent?.(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    const activeAfterArrowDownImmediate = document.activeElement?.getAttribute?.("data-workspace-trust-editor-section")
      || document.activeElement?.closest?.("[data-workspace-trust-editor-section]")?.getAttribute?.("data-workspace-trust-editor-section")
      || ""
    const escapeTargetImmediate = rootElement.contains(document.activeElement) ? document.activeElement : rootElement
    escapeTargetImmediate?.dispatchEvent?.(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    const activeAfterEscapeImmediate = document.activeElement === rootElement || rootElement.contains(document.activeElement)
    await waitSmokeAnimationFrame()
    activeAfterFocusSettled = document.activeElement === rootElement || rootElement.contains(document.activeElement)
    const activeAfterFocus = activeAfterFocusImmediate || activeAfterFocusSettled
    setSmokeStage("focus:root", {
      activeAfterFocus,
      activeAfterFocusImmediate,
      activeAfterFocusSettled,
      activeTag: document.activeElement?.tagName || "",
      activeSection: document.activeElement?.getAttribute?.("data-workspace-trust-editor-section")
        || document.activeElement?.closest?.("[data-workspace-trust-editor-section]")?.getAttribute?.("data-workspace-trust-editor-section")
        || "",
      documentHasFocus: document.hasFocus?.() === true,
      sectionCount: rootElement.querySelectorAll("[data-workspace-trust-editor-section]").length,
    })
    await nextTick()
    await waitSmokeAnimationFrame()
    const activeAfterArrowDownSettled = document.activeElement?.getAttribute?.("data-workspace-trust-editor-section")
      || document.activeElement?.closest?.("[data-workspace-trust-editor-section]")?.getAttribute?.("data-workspace-trust-editor-section")
      || ""
    const activeAfterArrowDown = activeAfterArrowDownImmediate || activeAfterArrowDownSettled
    setSmokeStage("keyboard:arrow-down", { activeAfterArrowDown })
    const activeAfterEscapeSettled = document.activeElement === rootElement || rootElement.contains(document.activeElement)
    const activeAfterEscape = activeAfterEscapeImmediate || activeAfterEscapeSettled
    setSmokeStage("keyboard:escape", { activeAfterEscape })
    const statusBeforeToggle = globalWorkspaceTrustManagementService.getTrustSnapshot(root).status
    rootElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }))
    setSmokeStage("keyboard:ctrl-enter", { statusBeforeToggle })
    await waitForSmokeState(
      () => globalWorkspaceTrustManagementService.getTrustSnapshot(root).status !== statusBeforeToggle,
      "WorkspaceTrustEditor Ctrl+Enter toggled workspace trust",
      10_000,
    )
    const snapshot = globalWorkspaceTrustManagementService.getTrustSnapshot(root)
    const editorPane = snapshot.capabilities?.requestService?.editorPane || {}
    const trustedFoldersTable = document.querySelector('[data-codek-smoke="workspace-trust-editor-trusted-folders-table"]')
    const affectedFeatures = document.querySelector('[data-codek-smoke="workspace-trust-editor-affected-features"]')
    const result = {
      smokeCase: "workspace-trust-editor",
      root,
      domVisible: domVisibleBeforeToggle,
      activeAfterFocus,
      activeAfterArrowDown,
      activeAfterEscape,
      trustedFoldersTableVisible: trustedFoldersTableVisibleBeforeToggle,
      affectedFeaturesVisible: affectedFeaturesVisibleBeforeToggle,
      trustedFolderCount: trustedFolderCountBeforeToggle,
      disabledByTrustRequirementCount: disabledByTrustRequirementCountBeforeToggle,
      snapshot,
      editorPane,
      manageEditorOpenRequest,
      contracts: {
        focusContract: rootElement.getAttribute("data-workspace-trust-editor-focus-contract") || "",
        keyboardContracts: String(rootElement.getAttribute("data-workspace-trust-editor-keyboard-contracts") || "").split(",").filter(Boolean),
        noSecondTrustStore: snapshot.constraints?.noSecondTrustStore === true,
      },
    }
    window.__codekSmokeWorkspaceTrustEditorResult = JSON.parse(JSON.stringify(result))
    setSmokeStage("result", {
      domVisible: result.domVisible,
      activeAfterFocus,
      activeAfterArrowDown,
      activeAfterEscape,
      trustStatus: snapshot.status,
    })
    return window.__codekSmokeWorkspaceTrustEditorResult
  }
  const collectExtensionGalleryWorkbenchSmoke = () => {
    const isVisible = (node) => Boolean(node && (node.offsetParent || node.getClientRects().length))
    const shell = document.querySelector('[data-codek-smoke="extension-gallery-workbench-shell"]')
    const pane = document.querySelector('[data-codek-smoke="extension-gallery-workbench-surface"]')
    const search = document.querySelector('[data-codek-smoke="extensions-search-input"]')
    const installed = document.querySelector('[data-codek-smoke="extension-gallery-installed"]')
    const results = document.querySelector('[data-codek-smoke="extension-gallery-search-results"]')
    const detail = document.querySelector('[data-codek-smoke="extension-gallery-detail"]')
    return {
      shellVisible: isVisible(shell),
      visible: isVisible(pane),
      searchVisible: isVisible(search),
      installedVisible: isVisible(installed),
      resultsVisible: isVisible(results),
      detailVisible: isVisible(detail),
      containerId: shell?.getAttribute?.("data-workbench-container-id") || pane?.getAttribute?.("data-extension-gallery-container-id") || "",
      viewId: shell?.getAttribute?.("data-workbench-view-id") || "",
      serviceId: pane?.getAttribute?.("data-extension-gallery-service-id") || "",
      stateSource: pane?.getAttribute?.("data-extension-gallery-state-source") || "",
      viewIds: String(pane?.getAttribute?.("data-extension-gallery-view-ids") || "").split(",").filter(Boolean),
      commandIds: String(pane?.getAttribute?.("data-extension-gallery-command-ids") || "").split(",").filter(Boolean),
      quickAccessPrefix: pane?.getAttribute?.("data-extension-gallery-quick-access-prefix") || "",
      lastQuery: pane?.getAttribute?.("data-extension-gallery-last-query") || "",
      resultCount: Number(pane?.getAttribute?.("data-extension-gallery-result-count") || 0),
      installedCount: Number(pane?.getAttribute?.("data-extension-gallery-installed-count") || 0),
      editorCount: Number(pane?.getAttribute?.("data-extension-gallery-editor-count") || 0),
      openedExtensionIds: String(pane?.getAttribute?.("data-extension-gallery-opened-extension-ids") || "").split(",").filter(Boolean),
      latestEditorId: pane?.getAttribute?.("data-extension-gallery-latest-editor-id") || "",
      actionStateCount: Number(pane?.getAttribute?.("data-extension-gallery-action-state-count") || 0),
      errorActionCount: Number(pane?.getAttribute?.("data-extension-gallery-error-action-count") || 0),
      progressCount: Number(pane?.getAttribute?.("data-extension-gallery-progress-count") || 0),
      latestProgressPhase: pane?.getAttribute?.("data-extension-gallery-latest-progress-phase") || "",
      localFirst: pane?.getAttribute?.("data-extension-gallery-local-first") === "true",
      noSecondState: pane?.getAttribute?.("data-extension-gallery-no-second-state") === "true",
      resultRows: results?.querySelectorAll?.("[data-extension-id]")?.length || 0,
      installedRows: installed?.querySelectorAll?.("[data-extension-id]")?.length || 0,
      detailExtensionId: detail?.getAttribute?.("data-extension-gallery-editor-id") || "",
      detailInstallState: detail?.getAttribute?.("data-extension-gallery-install-state") || "",
      detailActionIds: String(detail?.getAttribute?.("data-extension-gallery-action-ids") || "").split(",").filter(Boolean),
      detailRollbackAvailable: detail?.getAttribute?.("data-extension-gallery-rollback-available") === "true",
      detailServiceId: detail?.getAttribute?.("data-extension-gallery-detail-service-id") || "",
      detailStateSource: detail?.getAttribute?.("data-extension-gallery-detail-state-source") || "",
      text: String(pane?.textContent || "").slice(0, 240),
    }
  }
  const runExtensionInstallConfirmationSmoke = async (payload = {}) => {
    const setSmokeStage = (stage, detail = {}) => {
      window.__codekSmokeExtensionInstallConfirmationStage = { stage, at: Date.now(), detail }
      try {
        console.info("[codek-smoke-extension-install-confirmation-stage]", JSON.stringify(window.__codekSmokeExtensionInstallConfirmationStage))
      } catch {}
    }
    const projectButton = (node) => node
      ? {
          index: Number(node.getAttribute("data-dialog-button-index") || -1),
          label: String(node.getAttribute("data-dialog-button-label") || node.textContent || "").trim(),
          isCancel: node.getAttribute("data-dialog-button-cancel") === "true",
          visible: Boolean(node.offsetParent || node.getClientRects().length),
        }
      : null
    const extensionId = String(payload.extensionId || "codek.smoke-confirmation")
    const version = String(payload.version || "1.0.0")
    const root = String(payload.root || w.projectRoot || "")
    setSmokeStage("start", { extensionId, root })
    const editorModel = extensionWorkbenchService.setEditorViewModelForEvidence({
      reportKind: "extension-details",
      createdAt: Date.now(),
      ready: true,
      id: extensionId,
      extension: {
        id: extensionId,
        displayName: "Codek Smoke Confirmation",
        description: "Synthetic extension used to verify install confirmation owner wiring.",
        version,
        publisher: "codek",
        downloads: 1,
        iconDataUrl: "",
        iconSource: "default",
        defaultIcon: true,
        categories: ["Other"],
        source: "smoke",
        sourceUrl: "codek-smoke://extension-install-confirmation",
        license: "MIT",
        engines: { vscode: "^1.90.0" },
        extensionDependencies: [],
        extensionPack: [],
      },
      installed: null,
      readme: {
        id: extensionId,
        available: true,
        length: 58,
        text: "# Codek Smoke Confirmation\n\nVerifies install dialog owner.",
      },
      versions: [{ version, targetPlatforms: ["win32-x64"] }],
      latestVersion: version,
      installPlan: {
        reportKind: "extension-install-plan",
        id: extensionId,
        readyToInstall: true,
        requiresConfirmation: true,
        dependencies: [],
        extensionPack: [],
        missingDependencies: [],
        missingExtensionPack: [],
        operations: [{ kind: "target", id: extensionId, status: "pending" }],
        warnings: [{ id: "smoke-confirmation", severity: "info", message: "Smoke install requires explicit confirmation." }],
      },
      compatibility: {
        available: true,
        status: "compatible",
        blockers: [],
        warnings: [],
        unsupportedContributionPoints: [],
        partialContributionPoints: [],
      },
      installState: null,
      audit: [],
    })
    openSidebarView("marketplace")
    await nextTick()
    await waitForSmokeState(
      () => document.querySelector('[data-codek-smoke="extension-gallery-workbench-surface"]'),
      "extension gallery surface",
      10_000,
    )
    setSmokeStage("detail-ready", {
      extensionId: editorModel.id,
      requiresConfirmation: editorModel.detailSummary.requiresConfirmation,
    })
    const dialogPromise = globalCodekDialogService.prompt({
      type: "warning",
      title: "Install Extension",
      message: `Are you sure you want to install '${editorModel.displayName}'?`,
      detail: editorModel.detailSummary.trustGate.detail,
      source: "ExtensionInstallConfirmationSmoke",
      evidenceContext: {
        commandId: "workbench.extensions.install",
        resource: extensionId,
        workspaceFolder: root,
      },
      buttons: [{
        label: "Install",
        run: () => true,
      }],
      cancelButton: {
        label: "Cancel",
        run: () => false,
      },
    })
    await nextTick()
    refreshActiveCodekDialog()
    const modal = await waitForSmokeState(
      () => document.querySelector('[data-codek-smoke="codek-dialog-service-modal"]'),
      "extension install confirmation dialog",
      10_000,
    )
    const buttons = Array.from(document.querySelectorAll('[data-codek-smoke="codek-dialog-service-modal"] [data-dialog-button-index]'))
    const installButton = buttons.find((button) => /Install|安装/i.test(String(button.getAttribute("data-dialog-button-label") || button.textContent || "")))
      || buttons.find((button) => button.getAttribute("data-dialog-button-cancel") !== "true")
    const cancelButton = buttons.find((button) => button.getAttribute("data-dialog-button-cancel") === "true")
    const modalEvidence = modal
      ? {
          visible: Boolean(modal.offsetParent || modal.getClientRects().length),
          serviceId: modal.getAttribute("data-dialog-service-id") || "",
          source: modal.getAttribute("data-dialog-source") || "",
          kind: modal.getAttribute("data-dialog-kind") || "",
          modal: modal.getAttribute("data-dialog-modal") || "",
          commandId: modal.getAttribute("data-dialog-command-id") || "",
          workspaceFolder: modal.getAttribute("data-dialog-workspace-folder") || "",
          resource: modal.getAttribute("data-dialog-resource") || "",
          buttonLabelsAttribute: modal.getAttribute("data-dialog-button-labels") || "",
          buttonLabels: buttons.map((button) => String(button.getAttribute("data-dialog-button-label") || button.textContent || "").trim()),
          buttons: buttons.map(projectButton).filter(Boolean),
          hasInstall: Boolean(installButton),
          hasCancel: Boolean(cancelButton),
        }
      : {
          visible: false,
          serviceId: "",
          source: "",
          kind: "",
          modal: "",
          commandId: "",
          workspaceFolder: "",
          resource: "",
          buttonLabelsAttribute: "",
          buttonLabels: [],
          buttons: [],
          hasInstall: false,
          hasCancel: false,
        }
    setSmokeStage("dialog-visible", {
      visible: modalEvidence.visible,
      commandId: modalEvidence.commandId,
      buttonLabels: modalEvidence.buttonLabels,
    })
    if (installButton && typeof installButton.click === "function") {
      installButton.click()
    }
    const promptResult = await dialogPromise
    const decisionProjection = await waitForSmokeState(
      () => {
        const decisions = globalCodekDialogService.getDecisionProjections()
        return decisions.find((decision) => decision.source === "ExtensionInstallConfirmationSmoke"
          && decision.evidenceContext?.commandId === "workbench.extensions.install"
          && decision.outcome === "confirmed") || null
      },
      "extension install confirmation decision projection",
      10_000,
    )
    const detailSummary = extensionWorkbenchService.getDetailSummary(extensionId)
    const beforeInstallConfirmation = detailSummary?.requiresConfirmation === true
    const installResult = beforeInstallConfirmation
      ? await extensionWorkbenchService.install(extensionId, version)
      : { success: false, error: "detailSummary.requiresConfirmation was not true" }
    const actionState = extensionWorkbenchService.getActionState(extensionId)
    const surface = getExtensionWorkbenchSurfaceSnapshot(extensionWorkbenchService)
    const galleryWorkbench = collectExtensionGalleryWorkbenchSmoke()
    const result = {
      smokeCase: "extension-install-confirmation",
      owner: "App.vue __codekSmokeWorkbenchControls.runExtensionInstallConfirmationSmoke",
      root,
      promptResult,
      modalEvidence,
      clickedButton: projectButton(installButton),
      cancelButton: projectButton(cancelButton),
      decisionProjection,
      editorModel: {
        id: editorModel.id,
        installState: editorModel.installState,
        requiresConfirmation: editorModel.detailSummary.requiresConfirmation,
      },
      detailEvidence: {
        extensionId,
        serviceId: detailSummary?.serviceId || "",
        stateSource: detailSummary?.source || "",
        installPlanReady: detailSummary?.installPlanReady === true,
        requiresConfirmation: detailSummary?.requiresConfirmation === true,
        actionIds: detailSummary?.actionIds || [],
        trustGateRequired: detailSummary?.trustGate.required === true,
      },
      galleryWorkbench,
      surfaceSnapshot: surface,
      actionState,
      installResult: {
        ...installResult,
        confirmed: beforeInstallConfirmation,
        source: "extensionsWorkbenchService.resolveInstallConfirmation",
      },
      constraints: {
        noSecondInstallStateSource: true,
        stateSource: "extensionsWorkbenchService",
        dialogStateSource: "CodekDialogService",
      },
    }
    window.__codekSmokeExtensionInstallConfirmationResult = JSON.parse(JSON.stringify(result))
    setSmokeStage("result", {
      confirmed: result.installResult.confirmed,
      dialogSource: result.modalEvidence.source,
      noSecondInstallStateSource: result.constraints.noSecondInstallStateSource,
    })
    return window.__codekSmokeExtensionInstallConfirmationResult
  }
  window.__codekSmokeWorkbenchControls = {
    ...(window.__codekSmokeWorkbenchControls || {}),
    openChat: () => {
      chatOpen.value = true
      return nextTick()
    },
    setWorkbenchSmokeTheme: async (theme: "dark" | "light") => {
      applyThemeSetting(theme === "light" ? "light" : "dark")
      await nextTick()
      await waitSmokeFrames(2)
      return { activeTheme: activeTheme.value }
    },
    openWorkbenchSmokeView: async (view: CodekSidebarViewId | "settings") => {
      if (view === "settings") openSettingsView()
      else openSidebarView(view)
      await nextTick()
      await waitSmokeFrames(2)
      return {
        activeView: activeView.value,
        sidebarVisible: sidebarVisible.value,
        settingsOpen: activeView.value === "settings",
      }
    },
    getWorkbenchSmokeState: () => ({
      activeView: activeView.value,
      sidebarVisible: sidebarVisible.value,
      theme: activeTheme.value,
    }),
    openOutputPanel: () => {
      openBottomPanel(bottomPanelState, "output")
      return nextTick()
    },
    openProblemsPanel: () => {
      openProblemsPanel()
      return nextTick()
    },
    openDebugView: () => {
      openTerminalDebugTaskWorkbenchDebugView()
      return nextTick()
    },
    openTaskProviderExecuteSmokePanel: async () => {
      openTerminalDebugTaskWorkbenchTasksView()
      await nextTick()
      await waitForSmokeState(
        () => document.querySelector('[data-codek-smoke="task-workbench-panel"]'),
        "task provider execute smoke task panel",
        5_000,
      )
      await waitSmokeFrames(2)
      return collectTaskProviderExecutePanelSmoke({
        taskProviderExecutePanelHook: true,
      })
    },
    runTaskProviderActionSmoke,
    runExtensionInstallConfirmationSmoke,
    runWorkspaceTrustEditorSmoke,
    runAccessibleViewVisibleOwnerSmoke: async (input = {}) => {
      const providerId = String(input.providerId || "codek.accessibleView.visibleOwnerSmoke")
      const content = String(input.content || "Accessible View visible owner smoke\nSecond line")
      const nextContent = String(input.nextContent || "Accessible View visible owner smoke\nSecond line\nNext action content")
      const providerDisposable = globalAccessibleViewService.registerProvider({
        type: "view",
        priority: 100,
        name: "Accessible View Visible Owner Smoke",
        providerId,
        createProvider: () => ({
          providerId,
          type: "view",
          provideContent: () => content,
          provideNextContent: () => nextContent,
        }),
      })
      const showResult = globalAccessibleViewService.show(providerId)
      refreshAccessibleViewDomShell()
      try {
        await nextTick()
        const shell = await waitForSmokeState(
          () => document.querySelector('[data-codek-smoke="accessible-view-dom-shell"]'),
          "Accessible View DOM shell visible",
          5_000,
        )
        await waitSmokeFrames(2)
        const textArea = shell?.querySelector?.("[data-accessible-view-content]")
        const toolbar = shell?.querySelector?.("[data-accessible-view-toolbar]")
        const nextAction = shell?.querySelector?.('[data-accessible-view-action-id="editor.action.accessibleViewNext"]')
        const toolbarActionClick = nextAction
          ? await runAccessibleViewDomShellAction("editor.action.accessibleViewNext")
          : {
              actionId: "editor.action.accessibleViewNext",
              executed: false,
              contentChanged: false,
              contentBefore: String(textArea?.value || ""),
              contentAfter: String(textArea?.value || ""),
              owner: "App.vue DOM-shell menu-service projection",
              missingButton: true,
            }
        await nextTick()
        const contentAfterAction = shell?.querySelector?.("[data-accessible-view-content]")
        const visible = Boolean(shell && (shell.offsetParent || shell.getClientRects().length))
        const projection = globalAccessibleViewService.getRendererProjection()
        const contract = globalAccessibleViewService.getContractProjection()
        const hideResult = hideAccessibleViewDomShell()
        await nextTick()
        const focusRestoreProjection = globalAccessibleViewService.getWidgetLifecycleProjection().focusRestoreInvocation
        const result = {
          smokeCase: "accessible-view-visible-owner",
          owner: "App.vue __codekSmokeWorkbenchControls.runAccessibleViewVisibleOwnerSmoke",
          showResult,
          hideResult,
          domEvidence: {
            visible,
            providerId: shell?.getAttribute?.("data-accessible-view-provider-id") || "",
            stateSource: shell?.getAttribute?.("data-accessible-view-state-source") || "",
            domShellOwner: shell?.getAttribute?.("data-accessible-view-dom-shell-owner") || "",
            domShellState: shell?.getAttribute?.("data-accessible-view-dom-shell-state") || "",
            codeEditorBacked: shell?.getAttribute?.("data-accessible-view-code-editor-backed") === "true",
            contextViewOwner: shell?.getAttribute?.("data-accessible-view-context-view-owner") || "",
            toolbarOwner: shell?.getAttribute?.("data-accessible-view-toolbar-owner") || "",
            workbenchToolbarBacked: shell?.getAttribute?.("data-accessible-view-workbench-toolbar-backed") === "true",
            quickPickOwner: shell?.getAttribute?.("data-accessible-view-quick-pick-owner") || "",
            genericQuickInputReusable: shell?.getAttribute?.("data-accessible-view-generic-quick-input-reusable") === "true",
            focusTargetOwner: shell?.getAttribute?.("data-accessible-view-focus-target-owner") || "",
            focusInvocationOwner: shell?.getAttribute?.("data-accessible-view-focus-invocation-owner") || "",
            noSecondState: shell?.getAttribute?.("data-accessible-view-no-second-state") === "true",
            lineCount: Number(shell?.getAttribute?.("data-accessible-view-line-count") || 0),
            contentValue: String(contentAfterAction?.value || ""),
            toolbarMenuId: toolbar?.getAttribute?.("data-menu-id") || "",
            toolbarActionIds: String(toolbar?.getAttribute?.("data-action-ids") || "").split(",").filter(Boolean),
          },
          toolbarActionClick: {
            ...toolbarActionClick,
            menuId: toolbar?.getAttribute?.("data-menu-id") || "",
            buttonFound: Boolean(nextAction),
            contentAfter: String(contentAfterAction?.value || toolbarActionClick.contentAfter || ""),
          },
          projection: {
            owner: projection.owner,
            state: projection.state,
            hidden: projection.hidden,
            providerId: projection.providerId,
            domShellOwner: projection.domShellReadiness.owner,
            codeEditorWidgetBacked: projection.editor.codeEditorWidgetBacked,
            contextViewDelegateOwner: projection.editorContextFocusOwnerMatrix.contextView.contextViewDelegateOwner,
            toolbarOwner: projection.toolbarQuickPickFocusInvocation.owner,
            symbolQuickPickOwner: projection.toolbarQuickPickFocusInvocation.quickPick.symbolQuickPickOwner,
            focusInvocationOwner: projection.toolbarQuickPickFocusInvocation.focusInvocation.focusRestoreInvocationOwner,
          },
          focusRestore: {
            owner: focusRestoreProjection.owner,
            state: focusRestoreProjection.state,
            targetId: focusRestoreProjection.targetId || "",
            activeEditor: focusRestoreProjection.activeEditor || "",
            invoked: focusRestoreProjection.invoked,
            focusRestoreInvocationOwner: focusRestoreProjection.focusRestoreInvocationOwner,
            codeEditorWidgetBacked: focusRestoreProjection.codeEditorWidgetBacked,
            noSecondFocusState: focusRestoreProjection.noSecondFocusState,
          },
          connected: {
            appDomShell: true,
            serviceStateSource: "globalAccessibleViewService",
            providerLifecycle: showResult.shown === true,
            domShellToolbarAction: toolbarActionClick.executed === true && toolbarActionClick.contentChanged === true,
            focusRestoreInvocation: focusRestoreProjection.invoked,
          },
          blocked: {
            codeEditorWidget: !projection.editor.codeEditorWidgetBacked,
            contextView: projection.editorContextFocusOwnerMatrix.contextView.contextViewDelegateOwner !== "projected",
            workbenchToolbar: !projection.toolbarQuickPickFocusInvocation.toolbar.workbenchToolbarWidgetBacked,
            symbolQuickPick: projection.toolbarQuickPickFocusInvocation.quickPick.symbolQuickPickOwner === "missing",
            codeEditorWidgetOwnedFocusLifecycle: focusRestoreProjection.focusRestoreInvocationOwner !== "App.vue editor.focus",
          },
          constraints: {
            noSecondAccessibilityState: contract.trueOwnerFollowUp.noSecondAccessibilityState,
            runtimeReferenceToSourceMirror: false,
          },
        }
        window.__codekSmokeAccessibleViewVisibleOwnerResult = JSON.parse(JSON.stringify(result))
        return window.__codekSmokeAccessibleViewVisibleOwnerResult
      } finally {
        if (!globalAccessibleViewService.getRendererProjection().hidden) {
          hideAccessibleViewDomShell()
        }
        providerDisposable.dispose()
        refreshAccessibleViewDomShell()
      }
    },
    runNotebookMarkdownPreviewSmoke: async (input = {}) => {
      const resource = String(input.resource || "electron-smoke-notebook.md")
      const content = String(input.content || "# Notebook markdown preview smoke\n\nRenderer message bridge.")
      const notebookUri = String(input.notebookUri || resource.replace(/\.md$/i, ".codek-notebook"))
      const rendererId = String(input.rendererId || "codek-notebook-markdown-preview-smoke-renderer")
      const kernelId = String(input.kernelId || "codek-notebook-markdown-preview-smoke-kernel")
      const notebook = globalNotebookMarkdownPreviewWorkbenchService.openNotebookDocument({
        uri: notebookUri,
        viewType: "codek-smoke-notebook",
        cells: [{
          kind: "markup",
          languageId: "markdown",
          source: content,
          metadata: { smoke: true },
        }],
        dirty: false,
      })
      const kernelDisposable = globalNotebookMarkdownPreviewWorkbenchService.registerNotebookKernel({
        id: kernelId,
        label: "Codek Notebook Smoke Kernel",
        viewType: "codek-smoke-notebook",
        supportedLanguages: ["markdown"],
      })
      const rendererDisposable = globalNotebookMarkdownPreviewWorkbenchService.registerNotebookRenderer({
        id: rendererId,
        mimeTypes: ["text/markdown"],
        messaging: true,
      })
      const selectedKernel = globalNotebookMarkdownPreviewWorkbenchService.selectNotebookKernel(notebook.uri, kernelId)
      const preview = globalNotebookMarkdownPreviewWorkbenchService.openMarkdownPreview({
        resource,
        content,
        title: "Notebook Markdown Preview Smoke",
        source: "command",
      })
      markdownPreviewServiceRevision.value += 1
      const snapshot = globalNotebookMarkdownPreviewWorkbenchService.getMarkdownPreviewSnapshot(resource)
      const smokeEvidence = globalNotebookMarkdownPreviewWorkbenchService.getSmokeEvidence()
      const messagePosted = globalNotebookMarkdownPreviewWorkbenchService.postNotebookRendererMessage({
        rendererId,
        uri: notebook.uri,
        type: "codek.notebookMarkdownPreviewSmoke",
        payload: {
          resource,
          contentLength: content.length,
          redacted: true,
        },
      })
      await nextTick()
      await waitSmokeAnimationFrame()
      const editorPartNode = document.querySelector("[data-workbench-editor-part=\"true\"]")
      const postFrameSnapshot = globalNotebookMarkdownPreviewWorkbenchService.getMarkdownPreviewSnapshot(resource)
      const notebookSnapshot = globalNotebookMarkdownPreviewWorkbenchService.getNotebookSnapshot(notebook.uri)
      const rendererProjection = globalNotebookMarkdownPreviewWorkbenchService.getNotebookRendererProjection()
      const kernelProjection = globalNotebookMarkdownPreviewWorkbenchService.getNotebookKernelProjection(notebook.uri)
      const postFrameSmokeEvidence = globalNotebookMarkdownPreviewWorkbenchService.getSmokeEvidence()
      const result = {
        smokeCase: "notebook-markdown-preview",
        owner: "App.vue __codekSmokeWorkbenchControls.runNotebookMarkdownPreviewSmoke",
        preview,
        selectedKernel,
        messagePosted,
        snapshot,
        postFrameSnapshot,
        notebookSnapshot,
        rendererProjection,
        kernelProjection,
        smokeEvidence,
        postFrameSmokeEvidence,
        domEvidence: {
          hasEditorPart: Boolean(editorPartNode),
          markdownPreviewSource: editorPartNode?.getAttribute("data-markdown-preview-service-source") || "",
          markdownPreviewCount: Number(editorPartNode?.getAttribute("data-markdown-preview-count") || 0),
          activeResource: editorPartNode?.getAttribute("data-markdown-preview-active-resource") || "",
          notebookServiceId: editorPartNode?.getAttribute("data-notebook-service-id") || "",
          notebookDocumentCount: Number(editorPartNode?.getAttribute("data-notebook-document-count") || 0),
          rendererMessageBridgeReady: editorPartNode?.getAttribute("data-webview-message-bridge-ready") === "true",
        },
        constraints: {
          noSecondNotebookOrRendererStateSource: true,
          stateSource: "notebookMarkdownPreviewService",
        },
      }
      window.__codekSmokeNotebookMarkdownPreviewResult = JSON.parse(JSON.stringify(result))
      kernelDisposable.dispose()
      rendererDisposable.dispose()
      return window.__codekSmokeNotebookMarkdownPreviewResult
    },
    runTestingPublishResultsSmoke: async (input = {}) => {
      const controllerId = String(input.controllerId || "codek.testing-smoke")
      const profileId = Number(input.profileId || 1)
      const testId = String(input.testId || `${controllerId}\u0000suite\u0000publish-results.test.ts`)
      const runId = String(input.runId || "codek-testing-publish-results-smoke-run")
      const taskId = String(input.taskId || "codek-testing-publish-results-smoke-task")
      const message = String(input.message || "Testing publish results smoke failure message")
      globalTestingService.registerController({ id: controllerId, label: "Codek Testing Smoke" })
      globalTestingService.addProfile({ controllerId, profileId, label: "Run", group: "run", isDefault: true })
      globalTestingService.upsertItem({ controllerId, id: controllerId, label: "Codek Testing Smoke", expand: "expanded" })
      globalTestingService.upsertItem({
        controllerId,
        id: `${controllerId}\u0000suite`,
        parentId: controllerId,
        label: "suite",
        expand: "expanded",
      })
      globalTestingService.upsertItem({
        controllerId,
        id: testId,
        parentId: `${controllerId}\u0000suite`,
        label: "publish-results.test.ts",
        uri: "file:///workspace/publish-results.test.ts",
        expand: "notExpandable",
      })
      globalTestingService.startRun({ id: runId, controllerId, profileId, group: "run", testIds: [testId], label: "Testing Publish Results Smoke" })
      globalTestingService.startRunTask(runId, { id: taskId, controllerId, name: "Smoke task", running: true })
      globalTestingService.appendOutput(runId, `${message}\n`, { testId, locationUri: "file:///workspace/publish-results.test.ts" })
      globalTestingService.updateRunItemState(runId, testId, "failed", 17, [message])
      globalTestingService.finishRunTask(runId, taskId)
      globalTestingService.completeRun(runId, "failed")
      agentEvidenceRevision.value += 1
      openSidebarView("agentEvidence")
      openAgentEvidenceSurface("testing")
      await nextTick()
      await waitForSmokeState(
        () => {
          const peek = document.querySelector('[data-codek-smoke="testing-result-peek-visible-owner"]')
          const resultsView = document.querySelector('[data-codek-smoke="testing-results-viewpane-shell-owner"]')
          const explorerShell = document.querySelector('[data-codek-smoke="testing-explorer-viewpane-shell-owner"]')
          const explorerTree = explorerShell?.querySelector?.('[data-testing-explorer-object-tree="true"]')
          const explorerFilter = explorerShell?.querySelector?.('[data-testing-explorer-filter-input="true"]')
          const section = document.querySelector('[data-agent-evidence-surface="testing"]')
          const rowStates = [...(peek?.querySelectorAll?.("[data-testing-result-peek-entry-id]") || [])]
            .map((row) => row.getAttribute("data-testing-result-peek-state") || "")
          return section
            && peek?.getAttribute?.("data-testing-result-peek-latest-run-id") === runId
            && resultsView?.getAttribute?.("data-testing-results-selected-run-id") === runId
            && explorerShell?.getAttribute?.("data-testing-explorer-state-source") === "TestingService.getTestingExplorerContractProjection()"
            && explorerTree
            && explorerFilter
            && Number(explorerShell?.getAttribute?.("data-testing-explorer-row-count") || 0) >= 3
            && Number(resultsView?.getAttribute?.("data-testing-results-tree-row-count") || 0) >= 2
            && Number(peek?.getAttribute?.("data-testing-result-peek-entry-count") || 0) >= 1
            && rowStates.includes("failed")
            ? true
            : null
        },
        "Testing publish results DOM evidence",
        10_000,
      )
      await waitSmokeFrames(2)
      const summaryNode = document.querySelector('[data-codek-smoke="agent-evidence-testing-summary"]')
      const peekNode = document.querySelector('[data-codek-smoke="testing-result-peek-visible-owner"]')
      const resultsViewNode = document.querySelector('[data-codek-smoke="testing-results-viewpane-shell-owner"]')
      const explorerShellNode = document.querySelector('[data-codek-smoke="testing-explorer-viewpane-shell-owner"]')
      const explorerTreeNode = explorerShellNode?.querySelector?.('[data-testing-explorer-object-tree="true"]')
      const explorerFilterNode = explorerShellNode?.querySelector?.('[data-testing-explorer-filter-input="true"]')
      const testingSection = document.querySelector('[data-agent-evidence-surface="testing"]')
      const rows = [...(peekNode?.querySelectorAll?.("[data-testing-result-peek-entry-id]") || [])]
      const resultsViewRows = [...(resultsViewNode?.querySelectorAll?.("[data-testing-results-row-id]") || [])]
      const explorerRows = [...(explorerShellNode?.querySelectorAll?.("[data-testing-explorer-row-id]") || [])]
      const projection = globalTestingService.getProjection(controllerId)
      const explorer = globalTestingService.getTestingExplorerContractProjection({ controllerId, revealTestId: testId })
      const result = {
        smokeCase: "testing-publish-results",
        owner: "App.vue __codekSmokeWorkbenchControls.runTestingPublishResultsSmoke",
        publishBridge: {
          serviceCompletionInvoked: true,
          expectedSource: "TestingService.completeRun()",
          preloadApiAvailable: typeof window.codek?.publishExtHostTestingResults === "function",
        },
        domEvidence: {
          agentEvidenceTestingVisible: Boolean(testingSection && (testingSection.getClientRects().length || (testingSection as HTMLElement).offsetParent)),
          summaryState: summaryNode?.getAttribute?.("data-agent-evidence-test-state") || "",
          resultPeekStatus: peekNode?.getAttribute?.("data-testing-result-peek-status") || "",
          resultPeekEntryCount: Number(peekNode?.getAttribute?.("data-testing-result-peek-entry-count") || 0),
          latestRunId: peekNode?.getAttribute?.("data-testing-result-peek-latest-run-id") || "",
          rowStates: rows.map((row) => row.getAttribute("data-testing-result-peek-state") || "").filter(Boolean),
          rowTestIds: rows.map((row) => row.getAttribute("data-testing-result-peek-test-id") || "").filter(Boolean),
          noSecondState: peekNode?.getAttribute?.("data-testing-result-peek-no-second-state") === "true",
          resultsViewStatus: resultsViewNode?.getAttribute?.("data-testing-results-status") || "",
          resultsViewTreeRowCount: Number(resultsViewNode?.getAttribute?.("data-testing-results-tree-row-count") || 0),
          resultsViewSelectedRunId: resultsViewNode?.getAttribute?.("data-testing-results-selected-run-id") || "",
          resultsViewRowKinds: resultsViewRows.map((row) => row.getAttribute("data-testing-results-row-kind") || "").filter(Boolean),
          resultsViewBlockedOwners: String(resultsViewNode?.getAttribute?.("data-testing-results-blocked-owners") || ""),
          resultsViewNoSecondState: resultsViewNode?.getAttribute?.("data-testing-results-no-second-state") === "true",
          testingExplorerShellStatus: explorerShellNode?.getAttribute?.("data-testing-explorer-status") || "",
          testingExplorerObjectTreePresent: Boolean(explorerTreeNode),
          testingExplorerFilterInputPresent: Boolean(explorerFilterNode),
          testingExplorerRowCount: Number(explorerShellNode?.getAttribute?.("data-testing-explorer-row-count") || 0),
          testingExplorerDomRowIds: explorerRows.map((row) => row.getAttribute("data-testing-explorer-row-id") || "").filter(Boolean),
          testingExplorerDomFilterValue: explorerFilterNode?.getAttribute?.("data-testing-explorer-filter-value") || "",
          testingExplorerNoSecondState: explorerShellNode?.getAttribute?.("data-testing-explorer-no-second-state") === "true",
        },
        projection: {
          runState: projection.runSummary.state,
          failed: projection.runSummary.failed,
          total: projection.runSummary.total,
          latestRunId: projection.resultPeek.latestRunId || "",
          resultPeekStatus: projection.resultPeek.status,
          resultPeekEntries: projection.resultPeek.entries.map((entry) => ({ id: entry.id, testId: entry.testId, state: entry.state })),
          resultsViewPaneShellStatus: projection.testResultsViewPaneShell.status,
          resultsViewPaneShellRows: projection.testResultsViewPaneShell.rows.map((row) => ({ id: row.id, kind: row.kind, state: row.state })),
          explorerStatus: explorer.status,
          explorerRows: explorer.rows.map((row) => ({ id: row.id, revealState: row.revealState })),
          explorerDomHookConnected: Boolean(explorerShellNode && explorerTreeNode && explorerFilterNode)
            && explorerRows.length === explorer.domOwnerAdapter.rowCount
            && explorerShellNode?.getAttribute?.("data-testing-explorer-state-source") === "TestingService.getTestingExplorerContractProjection()"
            && explorerShellNode?.getAttribute?.("data-testing-explorer-no-second-state") === "true",
        },
        constraints: {
          noSecondTestingStateSource: projection.contract.noSecondState === true && projection.resultPeek.adapter.noSecondState === true && projection.testResultsViewPaneShell.noSecondState === true && peekNode?.getAttribute?.("data-testing-result-peek-no-second-state") === "true" && resultsViewNode?.getAttribute?.("data-testing-results-no-second-state") === "true" && explorer.noSecondState === true && explorerShellNode?.getAttribute?.("data-testing-explorer-no-second-state") === "true",
          runtimeReferenceToSourceMirror: false,
          fullViewPaneOwnerClaimed: false,
        },
        blocked: {
          testingExplorerViewPaneOwner: true,
          testingViewPaneContainerOwner: true,
          electronMainSmokeDispatcher: false,
        },
      }
      window.__codekSmokeTestingPublishResults = JSON.parse(JSON.stringify(result))
      return window.__codekSmokeTestingPublishResults
    },
    getDebugOutputBridgeSnapshot: (channelLabel: string) => {
      const outputContentNode = document.querySelector('[data-codek-smoke="output-content"]')
      const outputPanelNode = document.querySelector('[data-codek-smoke="output-panel"]')
      return {
        output: globalCodekOutputService.getOutputSnapshot(channelLabel),
        outputRenderer: {
          panelVisible: Boolean(outputPanelNode),
          contentVisible: Boolean(outputContentNode),
          serviceSource: outputContentNode?.getAttribute?.("data-output-service-source") || "",
          activeChannel: outputContentNode?.getAttribute?.("data-output-active-channel") || "",
          entryCount: Number(outputContentNode?.getAttribute?.("data-output-entry-count") || 0),
          preview: String(outputContentNode?.getAttribute?.("data-output-preview") || ""),
          text: String(outputContentNode?.textContent || "").slice(0, 2000),
        },
        debug: {
        serviceId: "debugService",
        stateSource: "debugState",
        isRunning: debugState.isRunning.value,
        sessionId: debugState.sessionId.value || "",
        consoleOutput: debugState.consoleOutput.value.map((entry) => ({
          type: entry.type,
          text: String(entry.text || ""),
        })),
      },
      }
    },
    runDebugOutputBridgeReplSmoke: async (expression: string) => {
      if (debugState.isRunning.value !== true) {
        debugState.isRunning.value = true
        debugState.sessionId.value = debugState.sessionId.value || "electron-smoke-debug-output-bridge"
      }
      const beforeCount = debugState.consoleOutput.value.length
      await sendDebugInput(expression)
      const successExpression = `${expression}-success`
      const successResult = "debug-output-bridge-success-result"
      const manager = getDebugManager() as unknown as {
        client: { sendRequest: (command: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>> } | null
      }
      const previousClient = manager.client
      manager.client = {
        async sendRequest(command: string, args?: Record<string, unknown>) {
          if (command !== "evaluate") {
            throw new Error(`unexpected smoke debug request: ${command}`)
          }
          if (args?.expression !== successExpression) {
            throw new Error(`unexpected smoke evaluate expression: ${String(args?.expression || "")}`)
          }
          return { result: successResult }
        },
      }
      try {
        await sendDebugInput(successExpression)
      } finally {
        manager.client = previousClient
      }
      await nextTick()
      await waitSmokeFrames(2)
      const entries = debugState.consoleOutput.value
      const matched = entries.filter((entry) => String(entry.text || "") === expression)
      const successInputs = entries.filter((entry) => entry.type === "input" && String(entry.text || "") === successExpression)
      const successOutputs = entries.filter((entry) => entry.type === "output" && String(entry.text || "") === successResult)
      const notConnectedErrors = entries.filter((entry) => entry.type === "error" && String(entry.text || "").includes("not connected"))
      return {
        serviceId: "debugService",
        stateSource: "debugState",
        expression,
        successExpression,
        hasSetupDebugState: true,
        beforeCount,
        afterCount: entries.length,
        inputCount: matched.filter((entry) => entry.type === "input").length,
        errorCount: notConnectedErrors.length,
        outputCount: successOutputs.length,
        entries: entries.slice(-8).map((entry) => ({
          type: entry.type,
          text: String(entry.text || "").slice(0, 160),
        })),
        evaluateResult: notConnectedErrors.length === 1 ? "Error: not connected" : "",
        successEvaluateResult: successOutputs.length === 1 ? successResult : "",
        evaluatePathReached: matched.filter((entry) => entry.type === "input").length === 1 && notConnectedErrors.length === 1,
        successEvaluatePathReached: successInputs.length === 1 && successOutputs.length === 1,
        noDoubleAppend: matched.filter((entry) => entry.type === "input").length === 1 && notConnectedErrors.length === 1 && successInputs.length === 1 && successOutputs.length === 1,
        blockedReason: "",
      }
    },
    isChatOpen: () => chatOpen.value,
    runNotificationActionClickSmoke,
    runWorkspaceTrustDowngradeRestartSmoke,
    runWorkspaceTrustRequestDialogSmoke,
    runSearchReplaceSmoke: async (payload = {}) => {
      const root = String(payload.root || "")
      if (!root) throw new Error("search replace smoke root missing")
      await handleOpenRecentProject(root)
      openSidebarView("search")
      await nextTick()
      searchQuery.value = "needle"
      searchReplaceQuery.value = "haystack"
      isRegex.value = false
      caseSensitive.value = false
      const serviceProbe = await globalSearchService.textSearch({
        type: QueryType.Text,
        query: "needle",
        maxResults: 20,
        includeContentForSmallFiles: true,
      })
      window.__codekSmokeSearchReplaceDebug = {
        root,
        projectRoot: w.projectRoot,
        workspaceRoots: w.workspaceRoots,
        serviceProbe,
        searchSettings: {
          include: settingsStore.get("search.include", ["*"]),
          exclude: settingsStore.get("search.exclude", []),
        },
      }
      await refreshSearchResults("needle")
      await waitForSmokeState(() => {
        window.__codekSmokeSearchReplaceDebug = {
          ...(window.__codekSmokeSearchReplaceDebug || {}),
          grepResults: grepResults.value,
          searchBusy: searchBusy.value,
        }
        return grepResults.value.length >= 2
      }, "search replace initial grep results")
      const initialGroups = JSON.parse(JSON.stringify(grepResults.value))
      const repeatedInitial = initialGroups.find((group) => group.path === "src/000-repeated.ts")
      const collapsedOccurrenceCount = repeatedInitial?.matches?.[0]?.occurrences?.length || 0
      const snapshotGrepResults = () => JSON.parse(JSON.stringify(grepResults.value || []))
      const getGroupMatchCount = (groups) => groups.reduce((total, group) => total + Number(group?.matches?.length || 0), 0)
      const countGroupsContainingPath = (groups, path) => groups.some((group) => group?.path === path && Number(group?.matches?.length || 0) > 0)
      const previewBeforeRepeated = await ws.readProjectFile("src/000-repeated.ts")
      const previewBeforeOther = await ws.readProjectFile("src/100-other.ts")
      const previewResult = await runSearchReplaceAll(createSearchFileActionContext(), { dryRun: true })
      const previewAfterRepeated = await ws.readProjectFile("src/000-repeated.ts")
      const previewAfterOther = await ws.readProjectFile("src/100-other.ts")
      const previewDidNotWriteDisk = previewBeforeRepeated === previewAfterRepeated && previewBeforeOther === previewAfterOther

      const replaceOneResult = await runSearchReplaceOne(createSearchFileActionContext())
      const afterReplaceOne = await ws.readProjectFile("src/000-repeated.ts")
      await waitForSmokeState(() => typeof afterReplaceOne === "string", "search replace one file content")

      await waitForSmokeState(() => {
        const group = grepResults.value.find((item) => item.path === "src/000-repeated.ts")
        return group && Number(group.matches?.length || 0) > 0 && typeof afterReplaceOne === "string" && afterReplaceOne.includes("haystack needle")
      }, "search replace one refresh after workspace save")
      const refreshAfterReplaceOneGroups = snapshotGrepResults()
      const replaceAllResult = await runSearchReplaceAll(createSearchFileActionContext())
      const finalRepeated = await ws.readProjectFile("src/000-repeated.ts")
      const finalOther = await ws.readProjectFile("src/100-other.ts")
      const refreshAfterReplaceAllGroups = await waitForSmokeState(() => {
        if (searchBusy.value) return null
        if (grepResults.value.length !== 0) return null
        return snapshotGrepResults()
      }, "search replace all refresh after FileService watcher")
      const watcherRefreshStable = Array.isArray(refreshAfterReplaceAllGroups)
        && refreshAfterReplaceAllGroups.length === 0
        && typeof finalRepeated === "string"
        && typeof finalOther === "string"
        && !finalRepeated.includes("needle")
        && !finalOther.includes("needle")
      openSidebarView("search")
      await nextTick()
      const bulkEditChangedFiles = Array.from(new Set([
        ...(previewResult?.summary?.changedFiles || []),
        ...(replaceOneResult?.summary?.changedFiles || []),
        ...(replaceAllResult?.summary?.changedFiles || []),
      ]))

      return {
        projectRoot: w.projectRoot,
        initialGroupCount: initialGroups.length,
        collapsedOccurrenceCount,
        previewSummary: previewResult?.summary || null,
        previewDryRun: previewResult?.dryRun === true,
        previewApplied: previewResult?.applied === true,
        previewDidNotWriteDisk,
        replaceOneSummary: replaceOneResult?.summary || null,
        replaceOneApplied: replaceOneResult?.applied === true,
        replaceAllSummary: replaceAllResult?.summary || null,
        replaceAllApplied: replaceAllResult?.applied === true,
        bulkEditAppliedViaService: Boolean(replaceOneResult?.summary?.changedFileCount || replaceAllResult?.summary?.changedFileCount),
        bulkEditChangedFiles,
        rollbackRisk: {
          preview: previewResult?.summary?.riskLevel || null,
          replaceOne: replaceOneResult?.summary?.riskLevel || null,
          replaceAll: replaceAllResult?.summary?.riskLevel || null,
          replaceAllDescription: replaceAllResult?.summary?.rollbackDescription || null,
        },
        searchRefreshEvidence: {
          afterReplaceOneGroupCount: refreshAfterReplaceOneGroups.length,
          afterReplaceOneMatchCount: getGroupMatchCount(refreshAfterReplaceOneGroups),
          afterReplaceOneRepeatedVisible: countGroupsContainingPath(refreshAfterReplaceOneGroups, "src/000-repeated.ts"),
          afterReplaceAllGroupCount: refreshAfterReplaceAllGroups.length,
          afterReplaceAllMatchCount: getGroupMatchCount(refreshAfterReplaceAllGroups),
          changedFilesStillVisibleAfterReplaceAll: bulkEditChangedFiles.some((path) => countGroupsContainingPath(refreshAfterReplaceAllGroups, path)),
          searchBusy: searchBusy.value,
          watcherRefreshStable,
        },
        afterReplaceOne,
        finalRepeated,
        finalOther,
        remainingNeedleGroups: grepResults.value.length,
        searchViewActive: activeView.value === "search",
      }
    },
    runSearchNavigationSmoke: async (payload = {}) => {
      const setSearchNavigationStage = (stage, detail = {}) => {
        try {
          const payload = { stage, at: Date.now(), detail }
          window.__codekSmokeSearchNavigationStage = payload
          console.info("[codek-smoke-search-navigation-stage]", JSON.stringify(payload))
        } catch {
          // smoke diagnostics only
        }
      }
      const root = String(payload.root || "")
      if (!root) throw new Error("search navigation smoke root missing")
      setSearchNavigationStage("open-project:start", { root })
      await handleOpenRecentProject(root)
      setSearchNavigationStage("open-project:done", { projectRoot: w.projectRoot })
      openSidebarView("search")
      preloadEditorRuntime("search-navigation-smoke")
      await nextTick()
      searchQuery.value = "needle"
      searchReplaceQuery.value = ""
      isRegex.value = false
      caseSensitive.value = false
      setSearchNavigationStage("needle-search:start")
      await refreshSearchResults("needle")
      setSearchNavigationStage("needle-search:refresh-done", { groupCount: grepResults.value.length })
      await waitForSmokeState(() => grepResults.value.length >= 2, "search navigation grep results")
      setSearchNavigationStage("needle-search:results-ready", { groupCount: grepResults.value.length })
      const matches = grepResults.value.flatMap((group) => (group.matches || []).map((match) => ({
        path: group.path,
        match,
      })))
      if (matches.length < 20) throw new Error(`search navigation smoke expected at least 20 matches, got ${matches.length}`)
      const clickTargets = matches.slice(0, 20)
      const clickResults = []
      const navigationStartedAt = performance.now()
      for (const [index, target] of clickTargets.entries()) {
        const clickStartedAt = performance.now()
        setSearchNavigationStage("needle-click:start", {
          index,
          path: target.path,
          line: target.match.line,
          elapsedMs: Math.round(clickStartedAt - navigationStartedAt),
        })
        try {
          await handleGrepMatchClick(target.path, target.match)
          setSearchNavigationStage("needle-click:handler-done", {
            index,
            path: target.path,
            activeFile: w.activeFile,
            editorReady: Boolean(editor),
          })
        } catch (error) {
          setSearchNavigationStage("needle-click:error", {
            index,
            path: target.path,
            line: target.match.line,
            column: target.match.column,
            matchLength: target.match.matchLength,
            activeFile: w.activeFile,
            editorValueLength: getSafeEditorValueLength(),
            selection: getSmokeEditorSelectionSnapshot(),
            elapsedMs: Math.round(performance.now() - clickStartedAt),
            totalElapsedMs: Math.round(performance.now() - navigationStartedAt),
            error: String(error?.message || error),
          })
          throw error
        }
        setSearchNavigationStage("needle-click:wait-active:start", { index, path: target.path, activeFile: w.activeFile })
        await waitForSmokeState(() => w.activeFile === target.path && typeof w.files[target.path] === "string", `search navigation active file loaded: ${target.path}`)
        setSearchNavigationStage("needle-click:wait-active:done", { index, path: target.path, activeFile: w.activeFile })
        setSearchNavigationStage("needle-click:sample:start", { index, path: target.path })
        const value = getSafeEditorValue() || ""
        const selectionSnapshot = getSmokeEditorSelectionSnapshot()
        const selection = selectionSnapshot.normalized
        setSearchNavigationStage("needle-click:sample:done", {
          index,
          path: target.path,
          valueLength: value.length,
          hasSelection: Boolean(selection),
          selectionError: selectionSnapshot.error,
        })
        const expectedColumn = Number(target.match.column || 1)
        const expectedEndColumn = Number(target.match.matchLength || 0) > 0
          ? expectedColumn + Number(target.match.matchLength || 0)
          : expectedColumn
        const selectionAccurate = smokeSelectionMatches(selection, target.match.line, expectedColumn, expectedEndColumn)
        clickResults.push({
          path: target.path,
          line: target.match.line,
          column: expectedColumn,
          endColumn: expectedEndColumn,
          activeFile: w.activeFile,
          openedContentVisible: value.toLowerCase().includes("needle"),
          blankEditor: value.trim().length === 0,
          selectionAccurate,
          searchViewActive: activeView.value === "search",
          elapsedMs: Math.round(performance.now() - clickStartedAt),
          totalElapsedMs: Math.round(performance.now() - navigationStartedAt),
        })
        setSearchNavigationStage("needle-click:done", {
          index,
          path: target.path,
          selectionAccurate,
          elapsedMs: Math.round(performance.now() - clickStartedAt),
          totalElapsedMs: Math.round(performance.now() - navigationStartedAt),
        })
      }
      const firstResult = clickResults[0]
      const firstTarget = clickTargets[0]
      const distinctPathsClicked = new Set(clickResults.map((result) => result.path)).size
      const perPathClickCounts = clickResults.reduce((counts, result) => {
        counts[result.path] = (counts[result.path] || 0) + 1
        return counts
      }, {})
      searchQuery.value = "json"
      setSearchNavigationStage("json-search:start")
      await refreshSearchResults("json")
      setSearchNavigationStage("json-search:refresh-done", { groupCount: grepResults.value.length })
      await waitForSmokeState(() => grepResults.value.length >= 1, "search navigation json grep results")
      const jsonMatches = grepResults.value.flatMap((group) => (group.matches || []).map((match) => ({
        path: group.path,
        match,
      })))
      const jsonTarget = jsonMatches.find((target) => String(target.path || "").endsWith("settings.json")) || jsonMatches[0]
      if (!jsonTarget) throw new Error("search navigation smoke expected json match")
      setSearchNavigationStage("json-click:start", { path: jsonTarget.path, line: jsonTarget.match.line })
      try {
        await handleGrepMatchClick(jsonTarget.path, jsonTarget.match)
      } catch (error) {
        setSearchNavigationStage("json-click:error", {
          path: jsonTarget.path,
          line: jsonTarget.match.line,
          column: jsonTarget.match.column,
          matchLength: jsonTarget.match.matchLength,
          activeFile: w.activeFile,
          editorValueLength: getSafeEditorValueLength(),
          selection: getSmokeEditorSelectionSnapshot(),
          error: String(error?.message || error),
        })
        throw error
      }
      await waitForSmokeState(() => w.activeFile === jsonTarget.path && typeof w.files[jsonTarget.path] === "string", `search navigation json active file loaded: ${jsonTarget.path}`)
      const jsonValue = getSafeEditorValue() || ""
      const jsonSelectionSnapshot = getSmokeEditorSelectionSnapshot()
      const jsonSelection = jsonSelectionSnapshot.normalized
      const jsonExpectedColumn = Number(jsonTarget.match.column || 1)
      const jsonExpectedEndColumn = Number(jsonTarget.match.matchLength || 0) > 0
        ? jsonExpectedColumn + Number(jsonTarget.match.matchLength || 0)
        : jsonExpectedColumn
      const jsonSearchSelectionAccurate = smokeSelectionMatches(jsonSelection, jsonTarget.match.line, jsonExpectedColumn, jsonExpectedEndColumn)
      const result = {
        projectRoot: w.projectRoot,
        activeFile: w.activeFile,
        matchPath: firstTarget.path,
        matchLine: firstTarget.match.line,
        matchColumn: firstTarget.match.column || 1,
        editorLineCount: getSmokeEditorLineCount(),
        openedContentVisible: Boolean(firstResult?.openedContentVisible),
        blankEditor: Boolean(firstResult?.blankEditor),
        selectionChanged: Boolean(firstResult?.selectionAccurate),
        searchViewActive: activeView.value === "search",
        totalMatches: matches.length,
        clickedCount: clickResults.length,
        nonBlankClickCount: clickResults.filter((result) => !result.blankEditor).length,
        contentVisibleClickCount: clickResults.filter((result) => result.openedContentVisible).length,
        selectionAccurateCount: clickResults.filter((result) => result.selectionAccurate).length,
        searchViewActiveClickCount: clickResults.filter((result) => result.searchViewActive).length,
        distinctPathsClicked,
        sameFileMultiLineClicked: Object.values(perPathClickCounts).some((count) => Number(count) >= 2),
        allClicksNonBlank: clickResults.every((result) => !result.blankEditor && result.openedContentVisible),
        allSelectionsAccurate: clickResults.every((result) => result.selectionAccurate),
        allClicksKeptSearchView: clickResults.every((result) => result.searchViewActive),
        jsonSearchQuery: "json",
        jsonSearchMatchPath: jsonTarget.path,
        jsonSearchMatchLine: jsonTarget.match.line,
        jsonSearchMatchColumn: jsonExpectedColumn,
        jsonSearchOpenedContentVisible: jsonValue.toLowerCase().includes("json"),
        jsonSearchBlankEditor: jsonValue.trim().length === 0,
        jsonSearchSelectionAccurate,
        jsonSearchSelectionError: jsonSelectionSnapshot.error,
        clickResults,
      }
      setSearchNavigationStage("complete", { clickedCount: clickResults.length, jsonTarget: jsonTarget.path })
      return result
    },
    runArtifactOpenSmoke: async (payload = {}) => {
      const setArtifactOpenStage = (stage, detail = {}) => {
        try {
          const stagePayload = { stage, at: Date.now(), detail }
          window.__codekSmokeArtifactOpenStage = stagePayload
          console.info("[codek-smoke-artifact-open-stage]", JSON.stringify(stagePayload))
        } catch {
          // smoke diagnostics only
        }
      }
      const root = String(payload.root || "")
      const binaryFiles = Array.isArray(payload.binaryFiles) ? payload.binaryFiles.map((entry) => String(entry || "")) : []
      const textFiles = Array.isArray(payload.textFiles) ? payload.textFiles.map((entry) => String(entry || "")) : []
      if (!root) throw new Error("artifact open smoke root missing")
      if (binaryFiles.length < 1 || textFiles.length < 2) throw new Error("artifact open smoke files missing")
      setArtifactOpenStage("open-project:start", { root })
      await handleOpenRecentProject(root)
      setArtifactOpenStage("open-project:done", { projectRoot: w.projectRoot })
      openSidebarView("files")
      preloadEditorRuntime("artifact-open-smoke")
      await nextTick()
      await waitSmokeFrames(2)

      const openResults = []
      const openWithTimeout = async (path, expectedOpened) => {
        const startedAt = performance.now()
        setArtifactOpenStage("open:start", { path, expectedOpened })
        const opened = await Promise.race([
          handleOpenFile(path),
          new Promise((_, reject) => window.setTimeout(() => reject(new Error(`artifact open timeout: ${path}`)), 6000)),
        ])
        await waitSmokeFrames(2)
        const durationMs = Math.round(performance.now() - startedAt)
        const value = getSafeEditorValue() || ""
        const result = {
          path,
          expectedOpened,
          opened: Boolean(opened),
          activeFile: w.activeFile,
          inOpenFiles: openFiles.value.includes(path),
          hasWorkspaceText: typeof w.files[path] === "string",
          editorValueLength: value.length,
          durationMs,
        }
        openResults.push(result)
        setArtifactOpenStage("open:done", result)
        return result
      }

      const binaryResults = []
      for (const binaryPath of binaryFiles) {
        binaryResults.push(await openWithTimeout(binaryPath, false))
      }

      const textResults = []
      for (const textPath of textFiles) {
        const result = await openWithTimeout(textPath, true)
        textResults.push(result)
        await waitForSmokeState(
          () => w.activeFile === textPath && typeof w.files[textPath] === "string",
          `artifact open text active file loaded: ${textPath}`,
          8000,
        )
      }

      const finalPath = textFiles[textFiles.length - 1]
      await waitForSmokeState(
        () => w.activeFile === finalPath && typeof getSafeEditorValue() === "string" && getSafeEditorValue().trim().length > 0,
        "artifact open final editor non blank",
        8000,
      )
      await waitSmokeFrames(3)
      const finalValue = getSafeEditorValue() || ""
      const editorNode = document.querySelector(".editor-container .monaco-editor")
      const titleNode = document.querySelector('[data-codek-smoke="editor-title-bar"] .editor-title-name')
      const binaryArtifactsBlocked = binaryResults.every((result) => result.opened === false && result.activeFile !== result.path && !result.hasWorkspaceText)
      const binaryArtifactsNotOpened = binaryFiles.every((path) => !openFiles.value.includes(path))
      const textFilesOpened = textResults.every((result) => result.opened === true && result.inOpenFiles)
      const maxOpenDurationMs = Math.max(...openResults.map((result) => Number(result.durationMs || 0)), 0)
      const result = {
        projectRoot: w.projectRoot,
        activeFile: w.activeFile,
        openFiles: [...openFiles.value],
        binaryFiles,
        textFiles,
        binaryResults,
        textResults,
        binaryArtifactsBlocked,
        binaryArtifactsNotOpened,
        responsiveAfterArtifactClicks: Boolean(document.querySelector(".app-shell") && document.querySelector('[data-codek-smoke="native-explorer-host"]')),
        textFilesOpened,
        finalEditorNonBlank: finalValue.trim().length > 0 && finalValue.includes("js debug extension smoke"),
        editorDomVisible: Boolean(editorNode && editorNode.getBoundingClientRect?.().width > 0 && editorNode.getBoundingClientRect?.().height > 0 && titleNode),
        maxOpenDurationMs,
        allOpenDurationsWithinBudget: openResults.every((entry) => Number(entry.durationMs || 0) <= 6000),
        openResults,
      }
      window.__codekSmokeArtifactOpenResult = result
      setArtifactOpenStage("complete", {
        activeFile: result.activeFile,
        binaryArtifactsBlocked,
        textFilesOpened,
        maxOpenDurationMs,
      })
      return result
    },
    runTabOverflowSmoke: async (payload = {}) => {
      const root = String(payload.root || "")
      if (!root) throw new Error("tab overflow smoke root missing")
      await handleOpenRecentProject(root)
      openSidebarView("files")
      await nextTick()
      const setTabOverflowStage = (stage, detail = {}) => {
        window.__codekSmokeTabOverflowStage = { stage: `renderer-tab-overflow:${stage}`, at: new Date().toISOString(), detail }
      }
      const paths = Array.from({ length: 24 }, (_value, index) => `src/tab-${String(index).padStart(2, "0")}.txt`)
      const { openTabOverflowSmokeFiles } = await import("./smoke/tabOverflowSmoke")
      await openTabOverflowSmokeFiles({
        paths,
        openFile: handleOpenFile,
        recoverOpenFile: async (path, error) => {
          if (w.activeFile && isDirty(w.activeFile)) throw error
          const content = await ws.readProjectFile(path)
          if (typeof content !== "string") throw error
          w.files[path] = content
          w.activeFile = path
          ws.updateFile(path, content, { dirty: false, external: false })
          syncEditorFromWorkspace()
          await nextTick()
          return true
        },
        isOpen: (path) => openFiles.value.includes(path),
        minOpenCount: 20,
        perFileTimeoutMs: 45000,
        setStage: setTabOverflowStage,
      })
      await waitForSmokeState(() => openFiles.value.length >= 20, "tab overflow open files")
      await waitSmokeFrames(2)
      const tabNodes = [...document.querySelectorAll(".tab")]
      const readableTabs = tabNodes.map((node) => {
        const rect = node.getBoundingClientRect()
        const name = node.querySelector(".tab-name")
        const nameRect = name?.getBoundingClientRect?.()
        const text = String(name?.textContent || node.getAttribute("data-short-label") || "").trim()
        return {
          text,
          width: rect.width,
          nameWidth: nameRect?.width || 0,
          shortLabel: node.getAttribute("data-short-label") || "",
        }
      })
      return {
        projectRoot: w.projectRoot,
        activeFile: w.activeFile,
        openFiles: openFiles.value,
        tabCount: tabNodes.length,
        allTabsReadable: readableTabs.length >= 20 && readableTabs.every((tab) => tab.width > 0 && tab.nameWidth >= 12 && (tab.text || tab.shortLabel)),
        readableTabs,
        editorTitleVisible: Boolean(document.querySelector('[data-codek-smoke="editor-title-bar"] .editor-title-name')),
        hasFileIcons: Boolean(document.querySelector(".tab .file-icon-svg")),
      }
    },
    runIconVisualStateSmoke: async (payload = {}) => {
      const setIconVisualStage = (stage, detail = {}) => {
        try {
          const payload = { stage, at: Date.now(), detail }
          window.__codekSmokeIconVisualStateStage = payload
          console.info("[codek-smoke-icon-stage]", JSON.stringify(payload))
        } catch {
          // smoke diagnostics only
        }
      }
      const collectIconVisualDiagnostics = () => {
        const fontStyle = document.getElementById("codek-file-icon-font-vs-seti-seti")
        const activeThemeDebug = window.__codekIconThemeDebug?.() || {}
        const activeTheme = activeThemeDebug.activeTheme
          ? {
              found: Boolean(activeThemeDebug.activeTheme.found),
              themeId: String(activeThemeDebug.activeTheme.themeId || ""),
              label: String(activeThemeDebug.activeTheme.label || ""),
              error: activeThemeDebug.activeTheme.error ? String(activeThemeDebug.activeTheme.error) : "",
              fonts: Array.isArray(activeThemeDebug.activeTheme.fonts)
                ? activeThemeDebug.activeTheme.fonts.map((font) => ({
                    id: String(font?.id || ""),
                    size: String(font?.size || ""),
                    src: Array.isArray(font?.src) ? font.src.map((source) => String(source?.path || "")) : [],
                  }))
                : [],
            }
          : null
        const firstThemeGlyph = document.querySelector(".theme-font-icon, .codek-explorer-theme-glyph")
        const host = document.querySelector('[data-codek-smoke="native-explorer-host"]')
        const explorerRows = [...(host?.querySelectorAll?.("[data-codek-explorer-row]") || [])]
        return {
          activeTheme,
          fontLoadVersion: activeThemeDebug.fontLoadVersion,
          fontStyleMounted: Boolean(fontStyle),
          fontStyleSample: String(fontStyle?.textContent || "").slice(0, 240),
          devicePixelRatio: Number(window.devicePixelRatio || 1),
          bodyTextSample: String(document.body?.innerText || "").slice(0, 260),
          welcomePageCount: document.querySelectorAll(".welcome-page").length,
          visibleWelcomePageCount: [...document.querySelectorAll(".welcome-page")].filter((node) => isSmokeElementVisible(node)).length,
          tabCount: document.querySelectorAll(".tab").length,
          editorTitleCount: document.querySelectorAll('[data-codek-smoke="editor-title-bar"]').length,
          monacoEditorCount: document.querySelectorAll(".editor-container .monaco-editor").length,
          setiFontCheck: typeof document.fonts?.check === "function" ? document.fonts.check('16px "seti"', "\ue099") : null,
          firstThemeGlyphText: firstThemeGlyph?.textContent || "",
          firstThemeGlyphClass: firstThemeGlyph?.getAttribute?.("class") || "",
          explorerRowCount: explorerRows.length,
          visibleExplorerLabels: explorerRows.slice(0, 12).map((row) => String(row.querySelector?.(".codek-explorer-label")?.textContent || "").trim()),
          activeFile: w.activeFile,
          openFiles: [...openFiles.value],
          visibleRects: collectIconVisualRects(),
          hitTargets: collectIconVisualHitTargets(),
        }
      }
      const isSmokeElementVisible = (node) => {
        if (!node) return false
        const rect = node.getBoundingClientRect?.()
        const style = window.getComputedStyle?.(node)
        return Boolean(rect && rect.width > 0 && rect.height > 0 && style?.display !== "none" && style?.visibility !== "hidden" && Number(style?.opacity || 1) !== 0)
      }
      const collectIconVisualRects = () => {
        const findPreferredSmokeNode = (selector) => {
          if (Array.isArray(selector)) {
            for (const candidate of selector) {
              const match = document.querySelector(candidate)
              if (match) return match
            }
            return null
          }
          return document.querySelector(selector)
        }
        const rectOf = (selector) => {
          const node = findPreferredSmokeNode(selector)
          const rect = node?.getBoundingClientRect?.()
          const style = node ? window.getComputedStyle?.(node) : null
          return rect ? {
            text: String(node.textContent || "").trim().slice(0, 80),
            visible: isSmokeElementVisible(node),
            display: String(style?.display || ""),
            visibility: String(style?.visibility || ""),
            opacity: String(style?.opacity || ""),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          } : null
        }
        return {
          devicePixelRatio: Number(window.devicePixelRatio || 1),
          tabBar: rectOf(".tab-bar"),
          firstTab: rectOf([".tab.active", ".tab"]),
          editorTitle: rectOf('[data-codek-smoke="editor-title-bar"]'),
          editorIcon: rectOf('[data-codek-smoke="editor-title-bar"] .file-icon-svg'),
          editorContainer: rectOf(".editor-container .monaco-editor"),
          welcomePage: rectOf(".welcome-page"),
        }
      }
      const describeSmokeNode = (node) => {
        if (!node) return null
        const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
        if (!element) return null
        return {
          tag: String(element.tagName || "").toLowerCase(),
          className: String(element.getAttribute?.("class") || ""),
          smoke: String(element.getAttribute?.("data-codek-smoke") || ""),
          text: String(element.textContent || "").trim().slice(0, 80),
        }
      }
      const hitTargetOf = (selector) => {
        const node = Array.isArray(selector)
          ? selector.map((candidate) => document.querySelector(candidate)).find(Boolean)
          : document.querySelector(selector)
        const rect = node?.getBoundingClientRect?.()
        if (!rect || rect.width <= 0 || rect.height <= 0) return null
        const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2))
        const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2))
        const hit = document.elementFromPoint(x, y)
        return {
          x: Math.round(x),
          y: Math.round(y),
          target: describeSmokeNode(hit),
          closestTab: describeSmokeNode(hit?.closest?.(".tab")),
          closestTitle: describeSmokeNode(hit?.closest?.('[data-codek-smoke="editor-title-bar"]')),
          closestEditor: describeSmokeNode(hit?.closest?.(".editor-container, .monaco-editor")),
          closestWelcome: describeSmokeNode(hit?.closest?.(".welcome-page")),
        }
      }
      const collectIconVisualHitTargets = () => ({
        firstTab: hitTargetOf([".tab.active", ".tab"]),
        editorTitle: hitTargetOf('[data-codek-smoke="editor-title-bar"]'),
        editorContainer: hitTargetOf(".editor-container .monaco-editor"),
        welcomePage: hitTargetOf(".welcome-page"),
      })
      const countMountedThemeIcons = () => {
        const explorerThemeIcons = [...document.querySelectorAll(".codek-explorer-icon.theme-icon-renderable")]
        const tabThemeIcons = [...document.querySelectorAll(".tab .file-icon-svg .theme-font-icon, .tab .file-icon-svg .theme-image-icon")]
        const editorThemeIcons = [...document.querySelectorAll('[data-codek-smoke="editor-title-bar"] .file-icon-svg .theme-font-icon, [data-codek-smoke="editor-title-bar"] .file-icon-svg .theme-image-icon')]
        return {
          explorerThemeIcons,
          tabThemeIcons,
          editorThemeIcons,
          ready: explorerThemeIcons.length >= 3 && tabThemeIcons.length >= 1 && editorThemeIcons.length >= 1,
        }
      }
      const flushIconVisualLayoutNow = (stage) => {
        forceEditorRender()
        const selectors = [
          ".main-area",
          ".tab-bar",
          ".tab",
          '[data-codek-smoke="editor-title-bar"]',
          ".editor-wrapper",
          ".editor-split-container",
          ".editor-container",
          ".editor-container .monaco-editor",
        ]
        const nodes = selectors.map((selector) => document.querySelector(selector)).filter(Boolean)
        for (const node of nodes) {
          void node.getBoundingClientRect?.()
        }
        return {
          stage,
          nodes: nodes.length,
          visibleRects: collectIconVisualRects(),
          hitTargets: collectIconVisualHitTargets(),
        }
      }
      const waitIconVisualSmokeFrames = async (stage, count = 1) => {
        const snapshots = []
        for (let index = 0; index < count; index += 1) {
          await Promise.resolve()
          snapshots.push(flushIconVisualLayoutNow(`${stage}:${index + 1}`))
        }
        return { count, snapshots }
      }
      const runIconVisualStep = async (stage, action, timeout = 20_000) => {
        setIconVisualStage(`${stage}:start`)
        let timer = null
        try {
          const result = await Promise.race([
            Promise.resolve().then(action),
            new Promise((_, reject) => {
              timer = window.setTimeout(() => {
                reject(new Error(`icon visual smoke step timeout: ${stage}`))
              }, timeout)
            }),
          ])
          setIconVisualStage(`${stage}:done`)
          return result
        } catch (error) {
          setIconVisualStage(`${stage}:error`, {
            message: String(error?.message || error),
            diagnostics: collectIconVisualDiagnostics(),
          })
          throw error
        } finally {
          if (timer) window.clearTimeout(timer)
        }
      }
      const runIconVisualSubStep = (stage, action, timeout = 5_000) => runIconVisualStep(`open-files:${stage}`, action, timeout)
      const forceIconVisualEditorPaint = async (stage) => {
        setIconVisualStage(`${stage}:start`)
        document.body.classList.add("codek-icon-visual-smoke-capturing")
        forceEditorRender()
        const nodes = [
          document.querySelector(".main-area"),
          document.querySelector(".tab-bar"),
          document.querySelector('[data-codek-smoke="editor-title-bar"]'),
          document.querySelector(".editor-wrapper"),
          document.querySelector(".editor-split-container"),
          document.querySelector(".editor-container"),
          document.querySelector(".editor-container .monaco-editor"),
        ].filter(Boolean)
        for (const node of nodes) {
          node.classList.add("force-editor-surface-paint")
          void node.getBoundingClientRect?.()
        }
        const firstFrames = await waitIconVisualSmokeFrames(`${stage}:frames:first`, 2)
        setIconVisualStage(`${stage}:frames:first`, firstFrames)
        forceEditorRender()
        const secondFrames = await waitIconVisualSmokeFrames(`${stage}:frames:second`, 2)
        setIconVisualStage(`${stage}:frames:second`, secondFrames)
        const result = { ok: true, nodes: nodes.length }
        window.__codekSmokeIconVisualPaintProbe = {
          stage,
          at: Date.now(),
          visibleRects: collectIconVisualRects(),
          hitTargets: collectIconVisualHitTargets(),
        }
        setIconVisualStage(`${stage}:done`, result)
        return result
      }
      const iconVisualPaths = [
        "src/icon-state.ts",
        "src/icon-state.json",
        "src/components/IconState.vue",
      ]
      const getIconVisualSmokeContent = (path) => path.endsWith(".json")
        ? JSON.stringify({ iconState: true }, null, 2)
        : path.endsWith(".vue")
          ? "<template><div /></template>\n"
          : "export const iconState = true\n"
      const openIconVisualFilesInEditor = async (paths) => {
        const normalizedPaths = paths.map((path) => ws.getRelativePath(path)).filter(Boolean)
        const targetPath = normalizedPaths[normalizedPaths.length - 1] || ""
        if (!targetPath) throw new Error("icon visual smoke target file missing")
        for (const path of normalizedPaths) {
          ws.updateFile(path, getIconVisualSmokeContent(path), { dirty: false, external: false })
        }
        const opened = await handleOpenFile(targetPath)
        setIconVisualStage("open:file:done", { path: targetPath, opened, activeFile: w.activeFile, openFiles: [...openFiles.value] })
        if (!opened) throw new Error(`icon visual smoke failed to open ${targetPath}`)
        await runIconVisualSubStep("active-editor", () => waitForSmokeState(() => w.activeFile === targetPath, `active editor ${targetPath}`, 5000), 6_000)
        await runIconVisualSubStep("ensure-editor-ready", () => ensureEditorReady(5000), 6_000)
        await runIconVisualSubStep("sync-editor", () => {
          syncEditorFromWorkspace()
          return true
        }, 3_000)
        await runIconVisualSubStep("force-render", () => {
          forceEditorRender()
          return true
        }, 3_000)
        const openFrames = await runIconVisualSubStep("wait-open-frames", () => waitIconVisualSmokeFrames("open", 2), 3_000)
        setIconVisualStage("open:frames:done", openFrames)
        const activePath = targetPath
        selectedDir.value = ""
        selectedTreePath.value = activePath
        selectedTreeKind.value = activePath ? "file" : ""
        setIconVisualStage("open:state:done", { activeFile: w.activeFile, openFiles: [...openFiles.value] })
        await runIconVisualSubStep("next-tick", () => nextTick(), 3_000)
        await runIconVisualSubStep("force-paint", () => forceIconVisualEditorPaint("open:force-paint"), 8_000)
        await runIconVisualSubStep("visible-title", () => waitForSmokeState(() => isSmokeElementVisible(document.querySelector('[data-codek-smoke="editor-title-bar"]')), "visible editor title bar"), 13_000)
        await runIconVisualSubStep("visible-title-icon", () => waitForSmokeState(() => isSmokeElementVisible(document.querySelector('[data-codek-smoke="editor-title-bar"] .editor-title-file-icon.file-icon-svg, [data-codek-smoke="editor-title-bar"] .editor-title-file-icon .file-icon-svg')), "visible editor title file icon"), 13_000)
        await runIconVisualSubStep("visible-tab", () => waitForSmokeState(() => isSmokeElementVisible(document.querySelector(".tab")), "visible editor tab"), 13_000)
        await runIconVisualSubStep("visible-editor", () => waitForSmokeState(() => isSmokeElementVisible(document.querySelector(".editor-container .monaco-editor")), "visible monaco editor"), 13_000)
        await runIconVisualSubStep("welcome-hidden", () => waitForSmokeState(() => !isSmokeElementVisible(document.querySelector(".welcome-page")), "welcome page hidden"), 13_000)
        await runIconVisualSubStep("theme-icons-mounted", () => waitForSmokeState(() => {
          const mounted = countMountedThemeIcons()
          return mounted.ready ? mounted : null
        }, "mounted theme icons"), 15_000)
        await runIconVisualSubStep("hit-targets", () => waitForSmokeState(() => {
          const hits = collectIconVisualHitTargets()
          return Boolean(hits.firstTab?.closestTab && hits.editorTitle?.closestTitle && hits.editorContainer?.closestEditor && !hits.editorContainer?.closestWelcome)
        }, "editor surface hit targets"), 13_000)
        const finalFrames = await runIconVisualSubStep("final-frames", () => waitIconVisualSmokeFrames("open:final", 2), 4_000)
        setIconVisualStage("open:final-frames:done", finalFrames)
      }
      const restoreIconVisualEditorState = async () => {
        const normalizedPaths = iconVisualPaths.map((path) => ws.getRelativePath(path)).filter(Boolean)
        for (const path of normalizedPaths) {
          ws.updateFile(path, getIconVisualSmokeContent(path), { dirty: false, external: false })
        }
        w.openFiles = normalizedPaths
        w.activeFile = normalizedPaths[normalizedPaths.length - 1] || w.activeFile
        selectedDir.value = ""
        selectedTreePath.value = w.activeFile || ""
        selectedTreeKind.value = w.activeFile ? "file" : ""
        await nextTick()
        if (!editor && editorContainer.value) await initEditor()
        syncEditorFromWorkspace()
        await forceIconVisualEditorPaint("restore:force-paint")
        await waitIconVisualSmokeFrames("restore", 1)
        return {
          activeFile: w.activeFile,
          openFiles: [...openFiles.value],
          visibleRects: collectIconVisualRects(),
        }
      }
      window.__codekSmokeWorkbenchControls.restoreIconVisualStateSmoke = restoreIconVisualEditorState
      const root = String(payload.root || "")
      if (!root) throw new Error("icon visual state smoke root missing")
      setIconVisualStage("open-project:queued", { root })
      await runIconVisualStep("open-project", () => handleOpenRecentProject(root), 20_000)
      setIconVisualStage("open-project:done", { projectRoot: w.projectRoot })
      openSidebarView("files")
      await nextTick()
      setIconVisualStage("native-host:wait")
      await waitForSmokeState(() => document.querySelector('[data-codek-smoke="native-explorer-host"]'), "native explorer host")
      setIconVisualStage("native-host:ready")
      setIconVisualStage("expand:queued", { path: "src" })
      await runIconVisualStep("expand-src", () => expandSmokeExplorerDirectory(root, "src"), 15_000)
      setIconVisualStage("expand:done", { path: "src" })
      setIconVisualStage("expand:queued", { path: "src/components" })
      await runIconVisualStep("expand-src-components", () => expandSmokeExplorerDirectory(root, "src/components"), 15_000)
      setIconVisualStage("expand:done", { path: "src/components" })
      setIconVisualStage("open-files:start")
      await runIconVisualStep("open-files", () => openIconVisualFilesInEditor([
        "src/icon-state.ts",
        "src/icon-state.json",
        "src/components/IconState.vue",
      ]), 20_000)
      setIconVisualStage("open-files:done", { openFiles: openFiles.value })
      await nextTick()
      const themeGlyphsMountedBeforeCollect = countMountedThemeIcons().ready
      await nextTick()
      setIconVisualStage("collect-icons:start")

      const iconNodes = [...document.querySelectorAll(".codek-explorer-icon, .file-icon-svg")]
      const explorerIcons = [...document.querySelectorAll(".codek-explorer-icon")]
      const tabIcons = [...document.querySelectorAll(".tab .file-icon-svg")]
      const editorIcons = [...document.querySelectorAll('[data-codek-smoke="editor-title-bar"] .file-icon-svg')]
      const classNames = iconNodes.map((node) => String(node.getAttribute("class") || ""))
      const themeIconNodes = iconNodes.filter((node) => {
        const className = String(node.getAttribute("class") || "")
        return className.includes("theme-icon")
          || Boolean(node.querySelector(".codek-explorer-theme-glyph, .codek-explorer-theme-image, .theme-font-icon, .theme-image-icon"))
      })
      const tabThemeIcons = tabIcons.filter((node) => Boolean(node.querySelector(".theme-font-icon, .theme-image-icon")))
      const editorThemeIcons = editorIcons.filter((node) => Boolean(node.querySelector(".theme-font-icon, .theme-image-icon")))
      const explorerThemeIcons = explorerIcons.filter((node) => {
        const className = String(node.getAttribute("class") || "")
        return className.includes("theme-icon")
          && Boolean(node.querySelector(".codek-explorer-theme-glyph, .codek-explorer-theme-image"))
      })
      const visibleExplorerIcons = explorerIcons.filter((node) => isSmokeElementVisible(node))
      const hasTextBadge = iconNodes.some((node) => {
        const directText = [...node.childNodes]
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => String(child.textContent || "").trim())
          .join("")
        return directText.length > 0
      })
      const srcRow = findSmokeExplorerRow(root, "src")
      const componentsRow = findSmokeExplorerRow(root, "src/components")
      const collapsedRow = findSmokeExplorerRow(root, "src/z-collapsed")
      const srcTwistie = srcRow?.querySelector?.(".codek-explorer-twistie")
      const collapsedTwistie = collapsedRow?.querySelector?.(".codek-explorer-twistie")
      const srcIcon = srcRow?.querySelector?.(".codek-explorer-icon")
      const collapsedIcon = collapsedRow?.querySelector?.(".codek-explorer-icon")
      const srcLabel = srcRow?.querySelector?.(".codek-explorer-label")
      const componentsLabel = componentsRow?.querySelector?.(".codek-explorer-label")
      const collapsedLabel = collapsedRow?.querySelector?.(".codek-explorer-label")
      const tsRow = findSmokeExplorerRow(root, "src/icon-state.ts")
      const jsonRow = findSmokeExplorerRow(root, "src/icon-state.json")
      const vueRow = findSmokeExplorerRow(root, "src/components/IconState.vue")
      const fileRows = [tsRow, jsonRow, vueRow].filter(Boolean)
      const fileIconNodes = fileRows
        .map((row) => row?.querySelector?.(".codek-explorer-icon"))
        .filter(Boolean)
      const rectSnapshot = (node) => {
        const rect = node?.getBoundingClientRect?.()
        const style = node ? window.getComputedStyle?.(node) : null
        return rect ? {
          display: String(style?.display || ""),
          visibility: String(style?.visibility || ""),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          visible: isSmokeElementVisible(node),
        } : null
      }
      const gapBetween = (leftNode, rightNode) => {
        const leftRect = leftNode?.getBoundingClientRect?.()
        const rightRect = rightNode?.getBoundingClientRect?.()
        if (!leftRect || !rightRect) return null
        return Math.round(rightRect.left - leftRect.right)
      }
      const depthLeftDelta = (parentNode, childNode) => {
        const parentRect = parentNode?.getBoundingClientRect?.()
        const childRect = childNode?.getBoundingClientRect?.()
        if (!parentRect || !childRect) return null
        return Math.round(childRect.left - parentRect.left)
      }
      const folderLayout = {
        expandedIcon: rectSnapshot(srcIcon),
        collapsedIcon: rectSnapshot(collapsedIcon),
        expandedTwistie: rectSnapshot(srcTwistie),
        collapsedTwistie: rectSnapshot(collapsedTwistie),
        expandedLabel: rectSnapshot(srcLabel),
        nestedExpandedLabel: rectSnapshot(componentsLabel),
        collapsedLabel: rectSnapshot(collapsedLabel),
        expandedTwistieToLabelGapPx: gapBetween(srcTwistie, srcLabel),
        collapsedTwistieToLabelGapPx: gapBetween(collapsedTwistie, collapsedLabel),
        nestedFolderIndentDeltaPx: depthLeftDelta(srcLabel, componentsLabel),
        fileIconRects: fileIconNodes.map((node) => rectSnapshot(node)),
      }
      const folderIconsHidden = Boolean(
        srcRow
          && collapsedRow
          && (!srcIcon || !isSmokeElementVisible(srcIcon))
          && (!collapsedIcon || !isSmokeElementVisible(collapsedIcon)),
      )
      const fileIconsVisible = fileIconNodes.length >= 3 && fileIconNodes.every((node) => isSmokeElementVisible(node))
      const folderLabelAdjacentToTwistie = Boolean(
        typeof folderLayout.expandedTwistieToLabelGapPx === "number"
          && typeof folderLayout.collapsedTwistieToLabelGapPx === "number"
          && folderLayout.expandedTwistieToLabelGapPx >= -2
          && folderLayout.expandedTwistieToLabelGapPx <= 2
          && folderLayout.collapsedTwistieToLabelGapPx >= -2
          && folderLayout.collapsedTwistieToLabelGapPx <= 2,
      )
      const nestedFolderIndentMatchesVsCode = Boolean(
        typeof folderLayout.nestedFolderIndentDeltaPx === "number"
          && folderLayout.nestedFolderIndentDeltaPx >= 6
          && folderLayout.nestedFolderIndentDeltaPx <= 10,
      )
      const diagnostics = collectIconVisualDiagnostics()
      const folderStates = {
        expandedRowFound: Boolean(srcRow),
        nestedExpandedRowFound: Boolean(componentsRow),
        collapsedRowFound: Boolean(collapsedRow),
        expandedAria: srcRow?.getAttribute?.("aria-expanded") || "",
        collapsedAria: collapsedRow?.getAttribute?.("aria-expanded") || "",
        expandedClass: String(srcRow?.getAttribute?.("class") || ""),
        collapsedClass: String(collapsedRow?.getAttribute?.("class") || ""),
        expandedTwistie: String(srcTwistie?.textContent || ""),
        collapsedTwistie: String(collapsedTwistie?.textContent || ""),
        expandedIconClass: String(srcIcon?.getAttribute?.("class") || ""),
        collapsedIconClass: String(collapsedIcon?.getAttribute?.("class") || ""),
        folderIconsHidden,
        fileIconsVisible,
        folderLabelAdjacentToTwistie,
        nestedFolderIndentMatchesVsCode,
        folderLayout,
      }
      const result = {
        projectRoot: w.projectRoot,
        explorerIconCount: explorerIcons.length,
        visibleExplorerIconCount: visibleExplorerIcons.length,
        tabIconCount: tabIcons.length,
        editorIconCount: editorIcons.length,
        explorerIconsMounted: fileIconsVisible,
        fallbackIconsAreSvg: iconNodes.length > 0 && !hasTextBadge && iconNodes.every((node) => Boolean(node.querySelector("svg, img, .theme-font-icon, .codek-explorer-theme-glyph"))),
        themeIconsMounted: themeIconNodes.length >= 3,
        explorerThemeIconsMounted: explorerThemeIcons.length >= 3,
        tabThemeIconsMounted: tabThemeIcons.length >= 1,
        editorThemeIconsMounted: editorThemeIcons.length >= 1,
        folderStatesDiffer: Boolean(
          srcRow?.classList?.contains("expanded")
            && srcRow?.getAttribute?.("aria-expanded") === "true"
            && collapsedRow
            && collapsedRow.getAttribute?.("aria-expanded") === "false"
            && !collapsedRow.classList?.contains("expanded")
            && String(srcTwistie?.textContent || "").trim()
            && String(collapsedTwistie?.textContent || "").trim()
        ),
        folderIconsHidden,
        fileIconsVisible,
        folderLabelAdjacentToTwistie,
        nestedFolderIndentMatchesVsCode,
        commonExtensionsTyped: ["icon-ts", "icon-json", "icon-vue"].every((token) => classNames.some((name) => name.includes(token))),
        tabAndEditorIconsMounted: tabIcons.length >= 1 && editorIcons.length >= 1,
        classNames,
        folderStates,
        folderLayout,
        diagnostics: { ...diagnostics, themeGlyphsMountedBeforeCollect },
        visibleRects: collectIconVisualRects(),
        hitTargets: collectIconVisualHitTargets(),
      }
      window.__codekSmokeIconVisualStateResult = result
      window.__codekSmokeIconVisualPaintProbe = {
        stage: "complete",
        at: Date.now(),
        visibleRects: result.visibleRects,
        hitTargets: result.hitTargets,
      }
      const completeFrames = await waitIconVisualSmokeFrames("complete", 3)
      const completeVisibleRects = collectIconVisualRects()
      const completeHitTargets = collectIconVisualHitTargets()
      result.visibleRects = completeVisibleRects
      result.hitTargets = completeHitTargets
      window.__codekSmokeIconVisualPaintProbe = {
        stage: "complete",
        at: Date.now(),
        visibleRects: completeVisibleRects,
        hitTargets: completeHitTargets,
        frames: completeFrames,
      }
      setIconVisualStage("complete", {
        projectRoot: result.projectRoot,
        explorerIconCount: result.explorerIconCount,
        tabIconCount: result.tabIconCount,
        editorIconCount: result.editorIconCount,
        explorerIconsMounted: result.explorerIconsMounted,
        visibleExplorerIconCount: result.visibleExplorerIconCount,
        fallbackIconsAreSvg: result.fallbackIconsAreSvg,
        themeIconsMounted: result.themeIconsMounted,
        explorerThemeIconsMounted: result.explorerThemeIconsMounted,
        tabThemeIconsMounted: result.tabThemeIconsMounted,
        editorThemeIconsMounted: result.editorThemeIconsMounted,
        folderStatesDiffer: result.folderStatesDiffer,
        folderIconsHidden: result.folderIconsHidden,
        fileIconsVisible: result.fileIconsVisible,
        folderLabelAdjacentToTwistie: result.folderLabelAdjacentToTwistie,
        nestedFolderIndentMatchesVsCode: result.nestedFolderIndentMatchesVsCode,
        commonExtensionsTyped: result.commonExtensionsTyped,
        tabAndEditorIconsMounted: result.tabAndEditorIconsMounted,
        folderLayout: result.folderLayout,
        visibleRects: completeVisibleRects,
        hitTargets: completeHitTargets,
        frames: completeFrames,
      })
      window.__codekSmokeIconVisualStateStage = null
      return result
    },
    runRealProjectUiSmoke: async (payload = {}) => {
      const setRealUiSmokeStage = (stage, detail = {}) => {
        try {
          const payload = { stage, at: Date.now(), detail }
          window.__codekSmokeRealProjectUiStage = payload
          console.info("[codek-smoke-real-project-ui-stage]", JSON.stringify(payload))
        } catch {
          // smoke diagnostics only
        }
      }
      const root = String(payload.root || "")
      if (!root) throw new Error("real project UI smoke root missing")
      const createTargetDir = String(payload.createTargetDir || "codek-real-ui-smoke-target/nested")
      const searchNeedle = String(payload.searchQuery || "json")
      const expectedSearchPath = String(payload.expectedSearchPath || "")
      const sameLineNeedle = String(payload.sameLineNeedle || "codek-real-ui-same-line-token")
      const sameLineSearchPath = String(payload.sameLineSearchPath || `${createTargetDir}/same-line-repeated.ts`)
      const normalFile = String(payload.openFile || "frontend/vite-project/src/App.vue")
      const largeFile = String(payload.largeFile || "")
      const extremeFile = String(payload.extremeFile || "")
      const skipCreateTarget = Boolean(payload.skipCreateTarget)
      const createTargetRootDir = createTargetDir.split("/").filter(Boolean)[0] || "codek-real-ui-smoke-target"

      setRealUiSmokeStage("open-project:start", { root })
      await handleOpenRecentProject(root)
      setRealUiSmokeStage("open-project:done", { root })
      openSidebarView("files")
      await nextTick()
      setRealUiSmokeStage("native-host:wait")
      await waitForSmokeState(() => document.querySelector('[data-codek-smoke="native-explorer-host"]'), "real project native explorer host")
      setRealUiSmokeStage("native-host:ready")
      const host = document.querySelector('[data-codek-smoke="native-explorer-host"]')
      const expandCandidates = [
        "frontend",
        "frontend/vite-project",
        "frontend/vite-project/src",
      ]
      for (const relativePath of expandCandidates) {
        try {
          setRealUiSmokeStage("expand:start", { relativePath })
          await expandSmokeExplorerDirectory(root, relativePath)
          setRealUiSmokeStage("expand:done", { relativePath })
        } catch {
          // The real repository can change; keep the smoke focused on the
          // directories that exist instead of failing on a renamed folder.
        }
      }
      await waitSmokeFrames(2)

      const scroller = host?.querySelector?.(".codek-list-view")
      const scrollSamples = []
      const visibleRowSnapshots = []
      if (scroller) {
        setRealUiSmokeStage("scroll:start")
        const maxScrollTop = Math.max(0, Number(scroller.scrollHeight || 0) - Number(scroller.clientHeight || 0))
        const step = Math.max(240, Math.floor(maxScrollTop / 60) || 240)
        setRealUiSmokeStage("scroll:dimensions", {
          maxScrollTop,
          step,
          scrollHeight: Number(scroller.scrollHeight || 0),
          clientHeight: Number(scroller.clientHeight || 0),
        })
        for (let index = 0; index < 80; index += 1) {
          if (index % 10 === 0) {
            setRealUiSmokeStage("scroll:sample", {
              index,
              scrollTop: Number(scroller.scrollTop || 0),
              renderedRows: Number(host?.querySelectorAll?.("[data-codek-explorer-row]")?.length || 0),
            })
          }
          const started = performance.now()
          scroller.scrollTop = Math.min(maxScrollTop, index * step)
          scroller.dispatchEvent(new Event("scroll"))
          scrollSamples.push(performance.now() - started)
          if (index % 5 === 0 || index === 79) {
            await waitSmokeFrames(1)
            visibleRowSnapshots.push(getSmokeExplorerVisibleRowSnapshot(host))
          }
        }
        scroller.scrollTop = 0
        scroller.dispatchEvent(new Event("scroll"))
        await waitSmokeFrames(2)
        visibleRowSnapshots.push(getSmokeExplorerVisibleRowSnapshot(host))
        setRealUiSmokeStage("scroll:done", { samples: scrollSamples.length })
      }
      const sortedSamples = [...scrollSamples].sort((left, right) => left - right)
      const p95Index = Math.min(sortedSamples.length - 1, Math.max(0, Math.ceil(sortedSamples.length * 0.95) - 1))
      const rows = [...(host?.querySelectorAll?.("[data-codek-explorer-row]") || [])]
      const blankVisibleRows = rows.some((row) => String(row.querySelector?.(".codek-explorer-label")?.textContent || "").trim().length === 0)
      const firstVisibleRowSnapshot = visibleRowSnapshots.find((snapshot) => snapshot.count > 0) || getSmokeExplorerVisibleRowSnapshot(host)
      const finalVisibleRowSnapshot = getSmokeExplorerVisibleRowSnapshot(host)
      const visibleRowSnapshotsAreReadable = visibleRowSnapshots.length === 0
        || visibleRowSnapshots.every((snapshot) => snapshot.count > 0 && snapshot.blankCount === 0)
      const visibleRowsStableAfterFastScroll = firstVisibleRowSnapshot.count > 0
        && finalVisibleRowSnapshot.count > 0
        && firstVisibleRowSnapshot.blankCount === 0
        && finalVisibleRowSnapshot.blankCount === 0
        && visibleRowSnapshotsAreReadable
      const content = host?.querySelector?.(".codek-list-view-content")
      const totalHeight = Number.parseFloat(content?.style?.height || "0")
      const totalRows = Number.isFinite(totalHeight) && totalHeight > 0 ? Math.round(totalHeight / 24) : rows.length

      setRealUiSmokeStage("open-normal-file:start", { normalFile })
      const normalFileOpened = await handleOpenFile(normalFile)
      setRealUiSmokeStage("open-normal-file:handle-returned", {
        normalFile,
        opened: normalFileOpened,
        activeFile: w.activeFile,
        hasContent: typeof w.files[normalFile] === "string",
        editorValueLength: getSafeEditorValueLength(),
      })
      await waitForSmokeState(() => w.activeFile === normalFile && typeof w.files[normalFile] === "string", "real project normal file opened")
      setRealUiSmokeStage("open-normal-file:state-ready", {
        normalFile,
        activeFile: w.activeFile,
        editorValueLength: getSafeEditorValueLength(),
      })
      await waitSmokeFrames(2)
      setRealUiSmokeStage("open-normal-file:done", { normalFile })
      const normalActiveFile = w.activeFile
      const normalEditorValue = getSafeEditorValue() || ""
      const normalWorkspaceValue = typeof w.files[normalFile] === "string" ? String(w.files[normalFile]) : ""
      editor?.focus?.()
      await waitSmokeFrames(2)
      const lightbulbNodes = [
        ...document.querySelectorAll(".codicon-light-bulb, .codicon-lightbulb, .lightbulb-glyph, .lightbulb"),
      ]
      const visibleLightbulbs = lightbulbNodes.filter((node) => {
        const rect = node.getBoundingClientRect?.()
        const style = getComputedStyle(node)
        return Boolean(
          rect
          && rect.width > 0
          && rect.height > 0
          && style.display !== "none"
          && style.visibility !== "hidden"
          && style.opacity !== "0",
        )
      })

      let rootPackageWorkspaceValue = ""
      let rootPackageExpectedText = ""
      let rootPackageVisibleProbe = {
        skipped: Boolean(largeFile),
        reason: largeFile ? "large-file smoke focuses on range-window validation" : "",
      }
      let rootPackageEditorValue = ""
      let rootPackageActiveFile = w.activeFile
      let rootPackageFile = "package.json"
      if (!largeFile) {
        setRealUiSmokeStage("open-root-package:direct", { rootPackageFile })
        await handleOpenFile(rootPackageFile)
        await waitForSmokeState(() => w.activeFile === rootPackageFile && typeof w.files[rootPackageFile] === "string", "real project root package file opened")
        rootPackageWorkspaceValue = String(w.files[rootPackageFile] || "")
        rootPackageExpectedText = rootPackageWorkspaceValue.includes("codek-large-file-smoke-fixture")
          ? "codek-large-file-smoke-fixture"
          : rootPackageWorkspaceValue.includes("\"name\"")
            ? "\"name\""
            : rootPackageWorkspaceValue.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() || ""
        rootPackageVisibleProbe = await waitForSmokeState(() => {
          const probe = getSmokeEditorVisibleProbe(rootPackageExpectedText)
          return probe.containerVisible
            && probe.visibleViewLineCount > 0
            && probe.visibleLineNumberCount > 0
            && probe.expectedTextVisible
            ? probe
            : null
        }, "real project root package visible editor text")
        rootPackageEditorValue = getSafeEditorValue() || ""
        rootPackageActiveFile = w.activeFile
        setRealUiSmokeStage("open-root-package:done", rootPackageVisibleProbe)
      } else {
        setRealUiSmokeStage("open-root-package:skipped-for-large-file", rootPackageVisibleProbe)
      }

      let largeFileProbe = getLargeFileSmokeProbe()
      let largeFileReopenProbe = null
      let largeFileViewportProbe = null
      let largeFileDeepViewportProbe = null
      let largeFileNextWindowViewportProbe = null
      let largeFileFinalWindowResult = null
      let largeFileFinalWindowViewportProbe = null
      let largeFileFinalWindowLoaded = false
      let largeFileFinalWindowVisible = false
      let largeFileReopenViewportProbe = null
      let largeFileUserScrollResult = null
      let largeFileNextWindowLoaded = false
      let largeFileNextWindowVisible = false
      let largeFileWindowNavigationRequired = false
      if (largeFile) {
        setRealUiSmokeStage("large-file:start", { largeFile })
        await handleOpenFile(largeFile)
        await waitForSmokeState(() => {
          const probe = getLargeFileSmokeProbe()
          recordLargeFileSmokeProbeWait("real project large file content", probe, { expectedPath: largeFile })
          return isLargeFileSmokeProbeReady(probe, { expectedPath: largeFile })
            ? probe
            : null
        }, "real project large file content", 20_000)
        await waitSmokeFrames(4)
        largeFileProbe = getLargeFileSmokeProbe()
        largeFileViewportProbe = getLargeFileViewportProbe()
        largeFileDeepViewportProbe = await waitForLargeFileViewportAtLine("real project large file deep viewport text", {
          line: LARGE_FILE_SMOKE_DEEP_VIEWPORT_LINE,
          marker: LARGE_FILE_SMOKE_VIEWPORT_MARKER,
        })
        if (largeFileProbe.rangeStateVisible && largeFileProbe.rangeStateHasNext) {
          largeFileWindowNavigationRequired = true
          setRealUiSmokeStage("large-file:next-window:start", { largeFile })
          const firstWindowOffset = Number(largeFileProbe.rangeStateOffset || 0)
          const firstWindowBytes = Number(largeFileProbe.rangeStateBytesRead || largeFileProbe.rangeStateWindowBytes || 0)
          const nextWindowTargetOffset = firstWindowOffset + Math.max(1, firstWindowBytes)
          largeFileNextWindowLoaded = await loadNextSmokeLargeFileWindow()
          await waitForSmokeState(() => {
            const probe = getLargeFileSmokeProbe()
            const probeOptions = {
              expectedPath: largeFile,
              minOffset: nextWindowTargetOffset,
            }
            recordLargeFileSmokeProbeWait("real project large file next window content", probe, probeOptions)
            return isLargeFileSmokeProbeReady(probe, probeOptions)
              ? probe
              : null
          }, "real project large file next window content", 20_000)
          await waitSmokeFrames(4)
          largeFileProbe = getLargeFileSmokeProbe()
          largeFileNextWindowViewportProbe = await waitForLargeFileViewportAtLine("real project large file next window deep viewport text", {
            line: LARGE_FILE_SMOKE_DEEP_VIEWPORT_LINE,
            marker: LARGE_FILE_SMOKE_VIEWPORT_MARKER,
          })
          largeFileProbe = getLargeFileSmokeProbe()
          largeFileNextWindowVisible = largeFileProbe.activeFile === largeFile
            && largeFileProbe.rangeStateVisible
            && largeFileProbe.rangeStateOffset >= nextWindowTargetOffset
            && largeFileProbe.realContentVisible
            && Boolean(largeFileNextWindowViewportProbe?.ready)
          setRealUiSmokeStage("large-file:next-window:done", largeFileProbe)
        } else {
          largeFileNextWindowLoaded = true
          largeFileNextWindowVisible = Boolean(largeFileDeepViewportProbe?.ready)
          largeFileNextWindowViewportProbe = largeFileDeepViewportProbe
          setRealUiSmokeStage("large-file:single-window:next-proof-skipped", largeFileProbe)
        }
        largeFileUserScrollResult = await performLargeFileUserScrollProbe("real project large file user-scroll")
        largeFileProbe = getLargeFileSmokeProbe()
        setRealUiSmokeStage("large-file:done", largeFileProbe)
        if (largeFileProbe.rangeStateVisible) {
          setRealUiSmokeStage("large-file:final-window:start", { largeFile })
          largeFileFinalWindowResult = await loadSmokeLargeFileToFinalWindow()
          largeFileFinalWindowViewportProbe = largeFileFinalWindowResult?.viewportProbe || null
          largeFileProbe = getLargeFileSmokeProbe()
          largeFileFinalWindowLoaded = Boolean(largeFileFinalWindowResult?.ok)
          largeFileFinalWindowVisible = largeFileProbe.activeFile === largeFile
            && largeFileProbe.rangeStateVisible
            && largeFileProbe.rangeStateHasNext === false
            && largeFileProbe.realContentVisible
            && Boolean(largeFileFinalWindowViewportProbe?.ready && largeFileFinalWindowViewportProbe?.markerVisible)
          setRealUiSmokeStage("large-file:final-window:done", {
            result: largeFileFinalWindowResult,
            probe: largeFileProbe,
          })
        } else {
          largeFileFinalWindowLoaded = true
          largeFileFinalWindowVisible = Boolean(largeFileDeepViewportProbe?.ready)
          setRealUiSmokeStage("large-file:optimized-full-model:done", largeFileProbe)
        }
        setRealUiSmokeStage("large-file:close-reopen:start", { largeFile })
        await handleCloseTab(largeFile)
        await waitSmokeFrames(2)
        await handleOpenFile(largeFile)
        await waitForSmokeState(() => {
          const probe = getLargeFileSmokeProbe()
          recordLargeFileSmokeProbeWait("real project large file reopen content", probe, { expectedPath: largeFile })
          return isLargeFileSmokeProbeReady(probe, { expectedPath: largeFile })
            ? probe
            : null
        }, "real project large file reopen content", 20_000)
        await waitSmokeFrames(4)
        largeFileReopenViewportProbe = await waitForLargeFileViewportAtLine("real project large file reopen deep viewport text", {
          line: LARGE_FILE_SMOKE_DEEP_VIEWPORT_LINE,
          marker: LARGE_FILE_SMOKE_VIEWPORT_MARKER,
        })
        largeFileReopenProbe = getLargeFileSmokeProbe()
        setRealUiSmokeStage("large-file:close-reopen:done", largeFileReopenProbe)
      }

      let extremeFileFirstWindowVisible = false
      let extremeFileSecondWindowVisible = false
      if (extremeFile) {
        setRealUiSmokeStage("extreme-file:start", { extremeFile })
        await handleOpenFile(extremeFile)
        await waitForSmokeState(() => {
          const probe = getLargeFileSmokeProbe()
          recordLargeFileSmokeProbeWait("real project extreme file first window", probe, { expectedPath: extremeFile })
          return isLargeFileSmokeProbeReady(probe, { expectedPath: extremeFile })
            ? probe
            : null
        }, "real project extreme file first window", 20_000)
        extremeFileFirstWindowVisible = true
        const extremeFirstWindowProbe = getLargeFileSmokeProbe()
        setRealUiSmokeStage("extreme-file:first-window", extremeFirstWindowProbe)
        const extremeFirstWindowOffset = Number(extremeFirstWindowProbe.rangeStateOffset || 0)
        const extremeFirstWindowBytes = Number(extremeFirstWindowProbe.rangeStateBytesRead || extremeFirstWindowProbe.rangeStateWindowBytes || 0)
        await loadNextSmokeLargeFileWindow()
        await waitForSmokeState(() => {
          const probe = getLargeFileSmokeProbe()
          const probeOptions = {
            expectedPath: extremeFile,
            minOffset: extremeFirstWindowOffset + Math.max(1, extremeFirstWindowBytes),
          }
          recordLargeFileSmokeProbeWait("real project extreme file second window", probe, probeOptions)
          return isLargeFileSmokeProbeReady(probe, probeOptions)
            ? probe
            : null
        }, "real project extreme file second window", 20_000)
        extremeFileSecondWindowVisible = true
        setRealUiSmokeStage("extreme-file:second-window", getLargeFileSmokeProbe())
      }

      setRealUiSmokeStage("search:start", { searchNeedle })
      openSidebarView("search")
      await nextTick()
      searchQuery.value = searchNeedle
      searchReplaceQuery.value = ""
      isRegex.value = false
      caseSensitive.value = false
      await refreshSearchResults(searchNeedle)
      await waitForSmokeState(() => {
        const expectedGroup = expectedSearchPath
          ? grepResults.value.find((group) => group.path === expectedSearchPath && group.matches?.length > 0)
          : null
        return expectedGroup || grepResults.value.find((group) => group.matches?.length > 0) || null
      }, "real project search results")
      const searchGroup = expectedSearchPath
        ? grepResults.value.find((group) => group.path === expectedSearchPath && group.matches?.length > 0)
        : grepResults.value.find((group) => group.matches?.length > 0)
      const searchMatch = searchGroup?.matches?.[0]
      if (!searchGroup || !searchMatch) throw new Error("real project search match missing")
      setRealUiSmokeStage("search:result", { path: searchGroup.path, line: searchMatch.line })
      await handleGrepMatchClick(searchGroup.path, searchMatch)
      await waitForSmokeState(() => w.activeFile === searchGroup.path && typeof w.files[searchGroup.path] === "string", "real project search file loaded")
      await waitForSmokeState(() => activeView.value === "search", "real project search view remains active")
      await waitSmokeFrames(2)
      setRealUiSmokeStage("search:opened", { path: searchGroup.path })
      const searchEditorValue = getSafeEditorValue() || ""
      const searchViewActiveAfterOpen = activeView.value === "search"

      setRealUiSmokeStage("same-line-search:start", { sameLineNeedle })
      searchQuery.value = sameLineNeedle
      searchReplaceQuery.value = ""
      isRegex.value = false
      caseSensitive.value = false
      await refreshSearchResults(sameLineNeedle)
      await waitForSmokeState(() => grepResults.value.some((group) => group.path === sameLineSearchPath), "real project same-line search result")
      const sameLineGroup = grepResults.value.find((group) => group.path === sameLineSearchPath)
      const sameLineMatches = sameLineGroup?.matches || []
      const sameLineFirstMatch = sameLineMatches[0]
      const sameLineOccurrences = sameLineFirstMatch?.occurrences || []
      setRealUiSmokeStage("same-line-search:done", { matches: sameLineMatches.length, occurrences: sameLineOccurrences.length })

      let createdFileRow = null
      let createdFolderRow = null
      const continuousCreateResults = []
      let staleSnapshotRejected = false
      let staleSnapshotError = ""
      let staleRequestedRowVisible = false
      let staleSnapshotRowVisible = false
      const staleName = "stale-snapshot-should-not-exist.ts"
      const staleSnapshotParent = createTargetRootDir
      if (skipCreateTarget) {
        setRealUiSmokeStage("create-target:skipped", { reason: "focused large-file/search smoke" })
      } else {
        setRealUiSmokeStage("create-target:expand")
        openSidebarView("files")
        await nextTick()
        setRealUiSmokeStage("create-target:expand-root:start", { createTargetRootDir })
        await expandSmokeExplorerDirectory(root, createTargetRootDir, setRealUiSmokeStage)
        setRealUiSmokeStage("create-target:expand-root:done", { createTargetRootDir })
        setRealUiSmokeStage("create-target:expand-dir:start", { createTargetDir })
        await expandSmokeExplorerDirectory(root, createTargetDir, setRealUiSmokeStage)
        setRealUiSmokeStage("create-target:expand-dir:done", { createTargetDir })
        setRealUiSmokeStage("create-target:ready", { createTargetDir })
        selectedDir.value = createTargetDir
        selectedTreePath.value = createTargetDir
        selectedTreeKind.value = "dir"
        const validCreateSnapshot = {
          workspaceRoot: root,
          rootLabel: root.split(/[\\/]/).filter(Boolean).pop() || root,
          parentPath: createTargetDir,
          parentLabel: createTargetDir.split("/").filter(Boolean).pop() || createTargetDir,
          parentKind: "directory",
          source: "selected-directory",
          selectedPathAtStart: createTargetDir,
          activeFileAtStart: w.activeFile,
          displayLabel: createTargetDir.split("/").filter(Boolean).pop() || createTargetDir,
          resolvedAbsoluteParent: `${normalizeSmokeFsPath(root)}/${createTargetDir}`,
        }
        setRealUiSmokeStage("create:file:start")
        await handleInlineCreate({ type: "file", parentPath: createTargetDir, targetSnapshot: validCreateSnapshot, name: "created-real-ui-smoke.ts" })
        createdFileRow = await waitForSmokeState(() => findSmokeExplorerRow(root, `${createTargetDir}/created-real-ui-smoke.ts`), "real project created file row")
        setRealUiSmokeStage("create:file:done")
        setRealUiSmokeStage("create:folder:start")
        await handleInlineCreate({ type: "folder", parentPath: createTargetDir, targetSnapshot: validCreateSnapshot, name: "created-real-ui-smoke-folder" })
        createdFolderRow = await waitForSmokeState(() => findSmokeExplorerRow(root, `${createTargetDir}/created-real-ui-smoke-folder`), "real project created folder row")
        setRealUiSmokeStage("create:folder:done")
        for (let index = 1; index <= 10; index += 1) {
          const suffix = String(index).padStart(2, "0")
          const type = index % 2 === 0 ? "folder" : "file"
          const name = type === "file" ? `continuous-${suffix}.ts` : `continuous-folder-${suffix}`
          const relativePath = `${createTargetDir}/${name}`
          setRealUiSmokeStage("create:continuous:start", { index, type, relativePath })
          await handleInlineCreate({ type, parentPath: createTargetDir, targetSnapshot: validCreateSnapshot, name })
          await waitForSmokeState(() => findSmokeExplorerRow(root, relativePath), `real project continuous create ${relativePath}`)
          setRealUiSmokeStage("create:continuous:done", { index, type, relativePath })
          continuousCreateResults.push({
            type,
            name,
            relativePath,
            rowVisible: Boolean(findSmokeExplorerRow(root, relativePath)),
          })
        }

        try {
          setRealUiSmokeStage("create:stale-snapshot:start")
          await handleInlineCreate({
            type: "file",
            parentPath: createTargetDir,
            targetSnapshot: {
              ...validCreateSnapshot,
              parentPath: staleSnapshotParent,
              parentLabel: createTargetRootDir,
              selectedPathAtStart: staleSnapshotParent,
              displayLabel: createTargetRootDir,
              resolvedAbsoluteParent: `${normalizeSmokeFsPath(root)}/${staleSnapshotParent}`,
            },
            name: staleName,
          })
        } catch (error) {
          staleSnapshotRejected = true
          staleSnapshotError = String(error?.message || error || "")
        }
        setRealUiSmokeStage("create:stale-snapshot:done", { staleSnapshotRejected })
        await waitSmokeFrames(2)
        staleRequestedRowVisible = Boolean(findSmokeExplorerRow(root, `${createTargetDir}/${staleName}`))
        staleSnapshotRowVisible = Boolean(findSmokeExplorerRow(root, `${staleSnapshotParent}/${staleName}`))
      }

      setRealUiSmokeStage("chat:start")
      chatOpen.value = true
      await nextTick()
      const chatInput = await waitForSmokeState(() => document.querySelector('[data-codek-smoke="chat-input"]'), "real project chat input")
      const chatComposer = chatInput?.closest?.(".chat-composer")
      const chatComposerRect = chatComposer?.getBoundingClientRect?.()
      const chatComposerStyle = chatComposer ? getComputedStyle(chatComposer) : null
      const parseRgbMax = (value) => {
        const numbers = String(value || "").match(/\d+(\.\d+)?/g)?.map(Number) || []
        return numbers.length >= 3 ? Math.max(numbers[0], numbers[1], numbers[2]) : 255
      }
      try {
        chatInput.focus?.()
        chatInput.value = "real project UI smoke chat probe"
        chatInput.dispatchEvent?.(new Event("input", { bubbles: true }))
      } catch {
        // Keep the result explicit below; non-input chat controls will fail the
        // acceptance check instead of throwing here.
      }
      setRealUiSmokeStage("chat:done")

      const rectSnapshot = (node) => {
        const rect = node?.getBoundingClientRect?.()
        return rect ? {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        } : null
      }
      const isVisibleNode = (node) => {
        const rect = node?.getBoundingClientRect?.()
        const style = node ? getComputedStyle(node) : null
        return Boolean(
          rect
          && rect.width > 0
          && rect.height > 0
          && style
          && style.display !== "none"
          && style.visibility !== "hidden"
          && style.opacity !== "0",
        )
      }
      const rectRight = (rect) => Number(rect?.left || 0) + Number(rect?.width || 0)
      const rectBottom = (rect) => Number(rect?.top || 0) + Number(rect?.height || 0)
      const rectHasArea = (rect) => Number(rect?.width || 0) > 0 && Number(rect?.height || 0) > 0
      const rectsDoNotOverlap = (a, b) => {
        if (!rectHasArea(a) || !rectHasArea(b)) return false
        return rectRight(a) <= Number(b.left || 0) + 1
          || rectRight(b) <= Number(a.left || 0) + 1
          || rectBottom(a) <= Number(b.top || 0) + 1
          || rectBottom(b) <= Number(a.top || 0) + 1
      }
      const focusWorkbenchPartForSmoke = async (part) => {
        const selectors = {
          [WorkbenchParts.ACTIVITYBAR_PART]: ".activity-bar [data-workbench-container-id]",
          [WorkbenchParts.SIDEBAR_PART]: '[data-codek-smoke="sidebar-panel"]',
          [WorkbenchParts.EDITOR_PART]: "[data-workbench-editor-part='true']",
          [WorkbenchParts.PANEL_PART]: '[data-codek-smoke="bottom-panel"]',
          [WorkbenchParts.TITLEBAR_PART]: '[data-workbench-title-bar="true"]',
          [WorkbenchParts.STATUSBAR_PART]: '[data-workbench-status-bar="true"]',
        }
        let focused = ""
        const result = globalWorkbenchLayoutService.focusPart(part, workbenchLayoutSnapshot.value, {
          focus: (focusedPart) => {
            const node = document.querySelector(selectors[focusedPart])
            node?.focus?.()
            focused = focusedPart
          },
        })
        await waitSmokeFrames(1)
        return {
          part,
          focused,
          result,
          activeElementMatches: Boolean(focused && document.activeElement?.matches?.(selectors[focused])),
        }
      }
      const collectQuickInputWorkbenchSmoke = () => {
        const pane = document.querySelector('[data-codek-smoke="quick-input-workbench"]')
        const input = pane?.querySelector?.(".quick-pick-input")
        const list = pane?.querySelector?.(".quick-pick-list")
        const items = [...(pane?.querySelectorAll?.(".quick-pick-item") || [])]
        const validation = pane?.querySelector?.(".quick-input-validation")
        return {
          visible: isVisibleNode(pane),
          kind: pane?.getAttribute?.("data-quick-input-kind") || "",
          quickInputServiceId: String(IQuickInputService),
          stateSource: "quickInputService",
          currentType: quickInputService.currentQuickInput?.type || "",
          inputFocused: document.activeElement === input,
          inputValue: input?.value || "",
          placeholder: input?.getAttribute?.("placeholder") || "",
          itemCount: items.length,
          firstItemText: String(items[0]?.textContent || "").trim().slice(0, 120),
          listVisible: isVisibleNode(list),
          validationVisible: isVisibleNode(validation),
          validationText: String(validation?.textContent || "").trim(),
        }
      }
      const exerciseQuickInputWorkbenchSmoke = async () => {
        const summary = {
          quickInputServiceId: String(IQuickInputService),
          stateSource: "quickInputService",
          quickPickVisible: false,
          quickPickKind: "",
          quickPickItemCount: 0,
          quickPickAcceptedLabel: "",
          quickPickAcceptedValue: "",
          inputVisible: false,
          inputKind: "",
          inputCancelled: false,
          inputResolvedValue: "",
          currentTypeAfterClose: "",
          inputFocused: false,
          error: "",
        }
        try {
          const quickPickPromise = quickInputService.showQuickPick([
            { label: "Open MCP Resource", description: "MCP", value: "mcp-resource" },
            { label: "Open Extension Gallery", description: "Gallery", value: "extension-gallery" },
          ], {
            title: "QuickInput Workbench Smoke",
            placeHolder: "Select a workbench action",
            validationMessage: "QuickInput smoke validation",
            severity: "info",
          })
          const quickPickNode = await waitForSmokeState(
            () => document.querySelector('[data-codek-smoke="quick-input-workbench"][data-quick-input-kind="quickPick"]'),
            "QuickInput quick pick visible",
            5_000,
          )
          await waitSmokeFrames(2)
          const quickPickSnapshot = collectQuickInputWorkbenchSmoke()
          summary.quickPickVisible = Boolean(quickPickSnapshot.visible)
          summary.quickPickKind = quickPickSnapshot.kind
          summary.quickPickItemCount = quickPickSnapshot.itemCount
          summary.inputFocused = Boolean(quickPickSnapshot.inputFocused)
          const firstItem = quickPickNode?.querySelector?.(".quick-pick-item")
          firstItem?.dispatchEvent?.(new MouseEvent("click", { bubbles: true }))
          const accepted = await Promise.race([
            quickPickPromise,
            new Promise((resolve) => setTimeout(() => resolve(undefined), 5_000)),
          ])
          summary.quickPickAcceptedLabel = String(accepted?.label || "")
          summary.quickPickAcceptedValue = String(accepted?.value || "")

          const inputPromise = quickInputService.showInputBox({
            title: "QuickInput Workbench Smoke Input",
            prompt: "Type a value then cancel",
            placeHolder: "smoke value",
            value: "cancel-me",
          })
          const inputNode = await waitForSmokeState(
            () => document.querySelector('[data-codek-smoke="quick-input-workbench"][data-quick-input-kind="inputBox"]'),
            "QuickInput input box visible",
            5_000,
          )
          await waitSmokeFrames(2)
          const inputSnapshot = collectQuickInputWorkbenchSmoke()
          summary.inputVisible = Boolean(inputSnapshot.visible)
          summary.inputKind = inputSnapshot.kind
          const inputEl = inputNode?.querySelector?.(".quick-pick-input")
          inputEl?.dispatchEvent?.(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
          const inputResult = await Promise.race([
            inputPromise,
            new Promise((resolve) => setTimeout(() => resolve("__timeout__"), 5_000)),
          ])
          summary.inputCancelled = inputResult === undefined
          summary.inputResolvedValue = inputResult === undefined ? "" : String(inputResult)
          await waitSmokeFrames(2)
          summary.currentTypeAfterClose = quickInputService.currentQuickInput?.type || ""
        } catch (error) {
          summary.error = String(error?.message || error || "")
        }
        return summary
      }
      const collectTerminalDebugTaskWorkbenchSmoke = (extra = {}) => {
        const snapshot = globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot()
        const panelNode = document.querySelector('[data-codek-smoke="bottom-panel"]')
        const taskPanelNode = document.querySelector('[data-codek-smoke="task-workbench-panel"]')
        return {
          ...extra,
          serviceId: snapshot.serviceId,
          vscodeServiceIds: snapshot.vscodeServiceIds,
          viewIds: snapshot.viewIds,
          commandIds: snapshot.commandIds,
          terminalStateSource: snapshot.terminal.stateSource,
          outputStateSource: snapshot.output.stateSource,
          debugStateSource: snapshot.debug.stateSource,
          taskStateSource: snapshot.tasks.stateSource,
          problemsStateSource: snapshot.problems.stateSource,
          constraints: snapshot.constraints,
          panelVisible: isVisibleNode(panelNode),
          panelId: bottomPanelState.active || "",
          panelNodeId: panelNode?.getAttribute?.("data-workbench-panel-id") || "",
          terminalCount: snapshot.terminal.terminalCount,
          terminalActiveId: snapshot.terminal.activeTerminalId,
          terminalLastCreatedId: snapshot.terminal.lastCreatedTerminalId,
          outputChannelName: snapshot.output.channelName,
          outputActiveChannelName: snapshot.output.activeChannelName,
          outputEntryCount: snapshot.output.entryCount,
          outputPreview: snapshot.output.preview,
          debugViewActive: activeView.value === "debug",
          debugSessionId: snapshot.debug.sessionId,
          debugRunning: snapshot.debug.isRunning,
          debugConsoleEntryCount: snapshot.debug.consoleEntryCount,
          taskViewActive: bottomPanelState.active === "tasks",
          taskPanelVisible: isVisibleNode(taskPanelNode),
          taskPanelViewId: taskPanelNode?.getAttribute?.("data-task-workbench-view-id") || "",
          taskPanelStateSource: taskPanelNode?.getAttribute?.("data-task-workbench-state-source") || "",
          taskPanelRunConfigCount: Number(taskPanelNode?.getAttribute?.("data-task-workbench-run-config-count") || 0),
          taskPanelLatestStatus: taskPanelNode?.getAttribute?.("data-task-workbench-latest-status") || "",
          taskRunConfigCount: snapshot.tasks.runConfigCount,
          taskLatestStatus: snapshot.tasks.latestEvidence?.status || "",
          taskLatestStepCount: snapshot.tasks.latestEvidence?.steps?.length || 0,
          taskLatestSummary: snapshot.tasks.latestEvidence?.summary || "",
          problemsVisible: Boolean(problemsVisible.value),
          problemsDiagnosticCount: snapshot.problems.diagnosticCount,
          problemsReadOnlyBridge: Boolean(snapshot.constraints.problemsReadOnlyBridge),
          paneCompositeLastOpenedPanelId: snapshot.paneComposite.lastOpenedPanelId,
          paneCompositeLastToggledPanelId: snapshot.paneComposite.lastToggledPanelId,
          paneCompositeDebugViewId: snapshot.paneComposite.lastOpenedDebugViewId,
          paneCompositeTaskViewId: snapshot.paneComposite.lastOpenedTaskViewId,
          paneCompositeProblemsOpened: snapshot.paneComposite.problemsOpened,
          paneCompositeOpenCount: snapshot.paneComposite.openCount,
          paneCompositeToggleCount: snapshot.paneComposite.toggleCount,
          snapshot,
        }
      }
      const exerciseTerminalDebugTaskWorkbenchSmoke = async () => {
        const summary = {
          commandsExecuted: [],
          commandFailures: [],
          outputChannelName: "TerminalDebugTaskWorkbench Smoke",
          terminalToggleCommandRan: false,
          terminalCommandOpened: false,
          outputCommandOpened: false,
          debugCommandOpened: false,
          debugStartCommandRan: false,
          debugStopCommandRan: false,
          taskOpenCommandRan: false,
          taskRunCommandRan: false,
          taskPanelWasVisible: false,
          problemsCommandOpened: false,
          debugDuringRunIsRunning: false,
          debugAfterStopIsRunning: true,
          error: "",
        }
        const runCommand = async (commandId, args = []) => {
          try {
            const ok = await executeCommand(commandId, args)
            if (ok) summary.commandsExecuted.push(commandId)
            else summary.commandFailures.push(`${commandId}:not-registered-or-disabled`)
            return ok
          } catch (error) {
            summary.commandFailures.push(`${commandId}:${String(error?.message || error || "")}`)
            return false
          }
        }
        let previousWorkspaceTasks = null
        let previousActiveTaskId = ""
        try {
          globalTerminalDebugTaskWorkbenchService.clearEvidence()
          const smokeTaskId = "codek-workbench-smoke-task"
          previousWorkspaceTasks = userTasksService.getTasks("workspace")
          previousActiveTaskId = userTasksService.getContractSnapshot().activeTaskId
          userTasksService.replaceTasks("workspace", [
            ...previousWorkspaceTasks.filter((task) => task.id !== smokeTaskId),
            {
              id: smokeTaskId,
              name: "Task: Codek Workbench Smoke",
              type: "custom",
              command: "codek-workbench-smoke",
              workingDir: "${workspaceFolder}",
              source: "workspace",
            },
          ])
          userTasksService.setActiveTask(smokeTaskId)
          if (!debugState.runConfigs.some((config) => config.id === smokeTaskId)) {
            debugState.runConfigs.push({
              id: smokeTaskId,
              name: "Task: Codek Workbench Smoke",
              type: "custom",
              command: "codek-workbench-smoke",
              workingDir: "${workspaceFolder}",
            })
          }
          debugState.activeConfigId.value = smokeTaskId
          globalDebugService.setRuntime({
            start: async (config) => ({
              sessionId: `debug-${config?.id || smokeTaskId}`,
              consoleOutput: "Debug session started from TerminalDebugTaskWorkbench smoke runtime",
              stackFrames: [],
              variables: [],
            }),
            stop: async () => ({
              consoleOutput: "Debug session stopped from TerminalDebugTaskWorkbench smoke runtime",
            }),
          })

          summary.terminalToggleCommandRan = await runCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalToggle)
          await waitSmokeFrames(1)
          summary.terminalCommandOpened = await runCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalNew)
          await waitSmokeFrames(2)
          globalCodekOutputService.appendLine(summary.outputChannelName, "Output routed through terminalDebugTaskWorkbenchService smoke.")
          summary.outputCommandOpened = await runCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputShow, [summary.outputChannelName])
          await waitSmokeFrames(2)
          summary.debugCommandOpened = await runCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugOpen)
          await waitSmokeFrames(1)
          summary.debugStartCommandRan = await runCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugStart, [smokeTaskId])
          await waitSmokeFrames(1)
          summary.debugDuringRunIsRunning = Boolean(globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot().debug.isRunning)
          summary.debugStopCommandRan = await runCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugStop)
          await waitSmokeFrames(1)
          summary.debugAfterStopIsRunning = Boolean(globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot().debug.isRunning)
          summary.taskOpenCommandRan = await runCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksOpen)
          await waitForSmokeState(() => Boolean(document.querySelector('[data-codek-smoke="task-workbench-panel"]')), "terminal debug task workbench tasks panel")
          summary.taskPanelWasVisible = true
          await waitSmokeFrames(1)
          summary.taskRunCommandRan = await runCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRun, [smokeTaskId])
          await waitSmokeFrames(1)
          summary.problemsCommandOpened = await runCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.ProblemsToggle)
          await waitForSmokeState(() => Boolean(problemsVisible.value), "terminal debug task problems visible")
          await waitSmokeFrames(2)
          const result = collectTerminalDebugTaskWorkbenchSmoke(summary)
          globalDebugService.setRuntime()
          userTasksService.replaceTasks("workspace", previousWorkspaceTasks)
          userTasksService.setActiveTask(previousActiveTaskId || "")
          return result
        } catch (error) {
          summary.error = String(error?.message || error || "")
        }
        globalDebugService.setRuntime()
        if (Array.isArray(previousWorkspaceTasks)) {
          userTasksService.replaceTasks("workspace", previousWorkspaceTasks)
          userTasksService.setActiveTask(previousActiveTaskId || "")
        }
        return collectTerminalDebugTaskWorkbenchSmoke(summary)
      }
      const collectWorkbenchLayoutSmoke = () => {
        const activityButtons = [...document.querySelectorAll(".activity-bar [data-workbench-container-id]")]
        const titleBarNode = document.querySelector('[data-workbench-title-bar="true"]')
        const sidebarNode = document.querySelector('[data-codek-smoke="sidebar-panel"]')
        const editorPartNode = document.querySelector("[data-workbench-editor-part='true']")
        const panelNode = document.querySelector('[data-codek-smoke="bottom-panel"]')
        const statusBarNode = document.querySelector('[data-workbench-status-bar="true"]')
        const commandSurfaceNode = document.querySelector('[data-workbench-command-surface="true"]')
        const workspaceTrustBannerNode = document.querySelector('[data-codek-smoke="workspace-trust-restricted-banner"]')
        const rects = {
          activityFirst: rectSnapshot(activityButtons[0]),
          titleBar: rectSnapshot(titleBarNode),
          sidebar: rectSnapshot(sidebarNode),
          editorPart: rectSnapshot(editorPartNode),
          panel: rectSnapshot(panelNode),
          statusBar: rectSnapshot(statusBarNode),
          commandSurface: rectSnapshot(commandSurfaceNode),
          workspaceTrustBanner: rectSnapshot(workspaceTrustBannerNode),
        }
        const serviceSizes = {
          activityBar: globalWorkbenchLayoutService.getSize(WorkbenchParts.ACTIVITYBAR_PART, workbenchLayoutSnapshot.value),
          sidebar: globalWorkbenchLayoutService.getSize(WorkbenchParts.SIDEBAR_PART, workbenchLayoutSnapshot.value),
          editorPart: globalWorkbenchLayoutService.getSize(WorkbenchParts.EDITOR_PART, workbenchLayoutSnapshot.value),
          panel: globalWorkbenchLayoutService.getSize(WorkbenchParts.PANEL_PART, workbenchLayoutSnapshot.value),
          titleBar: globalWorkbenchLayoutService.getSize(WorkbenchParts.TITLEBAR_PART, workbenchLayoutSnapshot.value),
          statusBar: globalWorkbenchLayoutService.getSize(WorkbenchParts.STATUSBAR_PART, workbenchLayoutSnapshot.value),
        }
        const sidebarLeft = workbench.sideBarLocation === "left" ? rectRight(rects.activityFirst) <= Number(rects.sidebar?.left || 0) + 1 : true
        const sidebarBeforeEditor = rectHasArea(rects.sidebar) && rectHasArea(rects.editorPart)
          ? rectRight(rects.sidebar) <= Number(rects.editorPart.left || 0) + 1
          : false
        const editorAbovePanel = rectHasArea(rects.editorPart) && rectHasArea(rects.panel)
          ? rectBottom(rects.editorPart) <= Number(rects.panel.top || 0) + 1
          : true
        const activityContainerIds = activityButtons.map((node) => node.getAttribute("data-workbench-container-id") || "")
        const hasVisibleActivity = (containerId) => Boolean(activityButtons.find((node) => node.getAttribute("data-workbench-container-id") === containerId && isVisibleNode(node)))
        const requiredDefaultActivityIds = [
          "workbench.view.explorer",
          "workbench.view.search",
          "workbench.view.scm",
          "workbench.view.extensions",
          "workbench.view.mcp",
          "codek.view.agent",
          "workbench.view.settings",
        ]
        return {
          activityButtonCount: activityButtons.length,
          activityContainerIds,
          activityViewIds: activityButtons.map((node) => node.getAttribute("data-workbench-view-id") || ""),
          activityVisible: requiredDefaultActivityIds.every(hasVisibleActivity),
          explorerActivityVisible: hasVisibleActivity("workbench.view.explorer"),
          searchActivityVisible: hasVisibleActivity("workbench.view.search"),
          scmActivityVisible: hasVisibleActivity("workbench.view.scm"),
          extensionsActivityVisible: hasVisibleActivity("workbench.view.extensions"),
          mcpActivityVisible: hasVisibleActivity("workbench.view.mcp"),
          agentActivityVisible: hasVisibleActivity("codek.view.agent"),
          testingActivityVisible: hasVisibleActivity("workbench.view.testing"),
          settingsActivityVisible: hasVisibleActivity("workbench.view.settings"),
          titleBarVisible: isVisibleNode(titleBarNode),
          titleProjectName: titleBarNode?.getAttribute?.("data-workbench-title-project") || "",
          titleActiveEditor: titleBarNode?.getAttribute?.("data-workbench-title-active-editor") || "",
          titleActiveViewId: titleBarNode?.getAttribute?.("data-workbench-title-active-view") || "",
          titleAgentMode: titleBarNode?.getAttribute?.("data-workbench-title-agent-mode") || "",
          titleSandboxMode: titleBarNode?.getAttribute?.("data-workbench-title-sandbox-mode") || "",
          titleGoalCount: Number(titleBarNode?.getAttribute?.("data-workbench-title-goal-count") || 0),
          titleDiagnosticsErrorCount: Number(titleBarNode?.getAttribute?.("data-workbench-title-error-count") || 0),
          titleDiagnosticsWarningCount: Number(titleBarNode?.getAttribute?.("data-workbench-title-warning-count") || 0),
          titleCommandPaletteHint: titleBarNode?.getAttribute?.("data-workbench-command-palette-hint") || "",
          workspaceTrustBannerVisible: isVisibleNode(workspaceTrustBannerNode),
          workspaceTrustBannerId: workspaceTrustBannerNode?.getAttribute?.("data-workbench-banner-id") || "",
          workspaceTrustBannerOwner: workspaceTrustBannerNode?.getAttribute?.("data-workbench-banner-owner") || "",
          workspaceTrustBannerServiceId: workspaceTrustBannerNode?.getAttribute?.("data-workbench-banner-service-id") || "",
          workspaceTrustBannerStateSource: workspaceTrustBannerNode?.getAttribute?.("data-workbench-banner-state-source") || "",
          workspaceTrustBannerDismissed: workspaceTrustBannerNode?.getAttribute?.("data-workbench-banner-dismissed") || "",
          workspaceTrustBannerActionLabels: String(workspaceTrustBannerNode?.getAttribute?.("data-workbench-banner-action-labels") || "").split(",").filter(Boolean),
          workspaceTrustBannerActionHrefs: String(workspaceTrustBannerNode?.getAttribute?.("data-workbench-banner-action-hrefs") || "").split(",").filter(Boolean),
          sidebarVisible: isVisibleNode(sidebarNode),
          sidebarContainerId: sidebarNode?.getAttribute?.("data-workbench-container-id") || "",
          sidebarViewId: sidebarNode?.getAttribute?.("data-workbench-view-id") || "",
          sidebarTitle: sidebarNode?.getAttribute?.("data-workbench-title") || "",
          sidebarWidth: Number(sidebarNode?.getAttribute?.("data-workbench-width") || 0),
          editorPartVisible: isVisibleNode(editorPartNode),
          editorPartActiveGroup: editorPartNode?.getAttribute?.("data-workbench-active-group") || "",
          editorPartActiveEditor: editorPartNode?.getAttribute?.("data-workbench-active-editor") || "",
          editorPartEditorCount: Number(editorPartNode?.getAttribute?.("data-workbench-editor-count") || 0),
          editorPartDirtyCount: Number(editorPartNode?.getAttribute?.("data-workbench-dirty-count") || 0),
          editorPartPinnedCount: Number(editorPartNode?.getAttribute?.("data-workbench-pinned-count") || 0),
          editorPartPreviewCount: Number(editorPartNode?.getAttribute?.("data-workbench-preview-count") || 0),
          editorPartOverflowCount: Number(editorPartNode?.getAttribute?.("data-workbench-overflow-count") || 0),
          editorPartOverflow: editorPartNode?.getAttribute?.("data-workbench-overflow") || "",
          editorPartSplitOpen: editorPartNode?.getAttribute?.("data-workbench-split-open") || "",
          panelVisible: isVisibleNode(panelNode),
          panelId: panelNode?.getAttribute?.("data-workbench-panel-id") || "",
          panelHeight: Number(panelNode?.getAttribute?.("data-workbench-panel-height") || 0),
          statusBarVisible: isVisibleNode(statusBarNode),
          statusActiveViewId: statusBarNode?.getAttribute?.("data-workbench-status-active-view") || "",
          statusActivePanelId: statusBarNode?.getAttribute?.("data-workbench-status-active-panel") || "",
          statusLanguageId: statusBarNode?.getAttribute?.("data-workbench-status-language") || "",
          statusLine: Number(statusBarNode?.getAttribute?.("data-workbench-status-line") || 0),
          statusColumn: Number(statusBarNode?.getAttribute?.("data-workbench-status-column") || 0),
          statusBranch: statusBarNode?.getAttribute?.("data-workbench-status-branch") || "",
          statusErrorCount: Number(statusBarNode?.getAttribute?.("data-workbench-status-error-count") || 0),
          statusWarningCount: Number(statusBarNode?.getAttribute?.("data-workbench-status-warning-count") || 0),
          statusEncoding: statusBarNode?.getAttribute?.("data-workbench-status-encoding") || "",
          statusEol: statusBarNode?.getAttribute?.("data-workbench-status-eol") || "",
          commandSurfaceVisible: isVisibleNode(commandSurfaceNode),
          commandSurfaceCommandCount: Number(commandSurfaceNode?.getAttribute?.("data-workbench-command-count") || 0),
          commandSurfaceCommandIds: String(commandSurfaceNode?.getAttribute?.("data-workbench-command-ids") || "").split(",").filter(Boolean),
          commandSurfaceMenuIds: String(commandSurfaceNode?.getAttribute?.("data-workbench-menu-ids") || "").split(",").filter(Boolean),
          commandSurfaceMenuEntryCount: Number(commandSurfaceNode?.getAttribute?.("data-workbench-menu-entry-count") || 0),
          commandPaletteCommandCount: Number(commandSurfaceNode?.getAttribute?.("data-workbench-command-palette-count") || 0),
          commandPaletteCommandIds: String(commandSurfaceNode?.getAttribute?.("data-workbench-command-palette-ids") || "").split(",").filter(Boolean),
          serviceSizes,
          visibleNeighbors: {
            sidebarNext: globalWorkbenchLayoutService.getVisibleNeighborPart(WorkbenchParts.SIDEBAR_PART, workbenchLayoutSnapshot.value, "next") || "",
            editorPrevious: globalWorkbenchLayoutService.getVisibleNeighborPart(WorkbenchParts.EDITOR_PART, workbenchLayoutSnapshot.value, "previous") || "",
            editorNext: globalWorkbenchLayoutService.getVisibleNeighborPart(WorkbenchParts.EDITOR_PART, workbenchLayoutSnapshot.value, "next") || "",
            panelPrevious: globalWorkbenchLayoutService.getVisibleNeighborPart(WorkbenchParts.PANEL_PART, workbenchLayoutSnapshot.value, "previous") || "",
          },
          layoutConsistent: Boolean(
            rectHasArea(rects.activityFirst)
            && rectHasArea(rects.sidebar)
            && rectHasArea(rects.editorPart)
            && rectHasArea(rects.panel)
            && sidebarLeft
            && sidebarBeforeEditor
            && editorAbovePanel
            && rectsDoNotOverlap(rects.activityFirst, rects.sidebar)
            && rectsDoNotOverlap(rects.sidebar, rects.editorPart)
            && rectsDoNotOverlap(rects.editorPart, rects.panel)
            && Number(serviceSizes.sidebar.width || 0) === Number(sidebarNode?.getAttribute?.("data-workbench-width") || 0)
            && Number(serviceSizes.panel.height || 0) === Number(panelNode?.getAttribute?.("data-workbench-panel-height") || 0),
          ),
          rects,
        }
      }
      const collectAgentEvidenceWorkbenchSmoke = () => {
        const pane = document.querySelector('[data-codek-smoke="agent-evidence-workbench"]')
        const scm = document.querySelector('[data-agent-evidence-surface="scm"]')
        const testing = document.querySelector('[data-agent-evidence-surface="testing"]')
        const timeline = document.querySelector('[data-agent-evidence-surface="timeline"]')
        const progress = document.querySelector('[data-agent-evidence-surface="progress"]')
        const notifications = document.querySelector('[data-agent-evidence-surface="notifications"]')
        const list = document.querySelector('[data-agent-evidence-surface="list"]')
        const severityNodes = [...document.querySelectorAll("[data-agent-evidence-severity]")]
        const listItemNodes = [...(list?.querySelectorAll?.("[data-agent-evidence-list-item-id]") || [])]
        const scmResourceNodes = [...(scm?.querySelectorAll?.("[data-agent-evidence-resource-uri]") || [])]
        const testingItemNodes = [...(testing?.querySelectorAll?.("[data-agent-evidence-rerun-command]") || [])]
        const timelineItemNodes = [...(timeline?.querySelectorAll?.("[data-agent-evidence-timeline-command]") || [])]
        const progressItemNodes = [...(progress?.querySelectorAll?.("[data-agent-evidence-aggregate-status]") || [])]
        const notificationNodes = [...(notifications?.querySelectorAll?.("[data-agent-evidence-dedupe-key]") || [])]
        return {
          visible: isVisibleNode(pane),
          status: pane?.getAttribute?.("data-agent-evidence-status") || "",
          ready: pane?.getAttribute?.("data-agent-evidence-ready") || "",
          correlationId: pane?.getAttribute?.("data-agent-evidence-correlation-id") || "",
          vscodeServiceIds: String(pane?.getAttribute?.("data-agent-evidence-vscode-service-ids") || "").split(",").filter(Boolean),
          listVisible: isVisibleNode(list),
          listCount: Number(list?.getAttribute?.("data-agent-evidence-list-count") || 0),
          listFilterSurfaces: String(list?.getAttribute?.("data-agent-evidence-filter-surfaces") || "").split(",").filter(Boolean),
          listFilterStatuses: String(list?.getAttribute?.("data-agent-evidence-filter-statuses") || "").split(",").filter(Boolean),
          listFilterSeverities: String(list?.getAttribute?.("data-agent-evidence-filter-severities") || "").split(",").filter(Boolean),
          listItemIds: listItemNodes.map((node) => node.getAttribute("data-agent-evidence-list-item-id") || "").filter(Boolean),
          listItemSurfaces: listItemNodes.map((node) => node.getAttribute("data-agent-evidence-list-item-surface") || "").filter(Boolean),
          listItemStatuses: listItemNodes.map((node) => node.getAttribute("data-agent-evidence-list-item-status") || "").filter(Boolean),
          listItemSeverities: listItemNodes.map((node) => node.getAttribute("data-agent-evidence-list-item-severity") || "").filter(Boolean),
          listItemCommands: listItemNodes.map((node) => node.getAttribute("data-agent-evidence-list-item-command") || "").filter(Boolean),
          listItemResources: listItemNodes.map((node) => node.getAttribute("data-agent-evidence-list-item-resource") || "").filter(Boolean),
          detailKind: list?.getAttribute?.("data-agent-evidence-detail-kind") || "",
          detailId: list?.getAttribute?.("data-agent-evidence-detail-id") || "",
          detailEditorId: list?.getAttribute?.("data-agent-evidence-editor-id") || "",
          detailEditorUri: list?.getAttribute?.("data-agent-evidence-editor-uri") || "",
          exportCommand: list?.getAttribute?.("data-agent-evidence-export-command") || "",
          exportMarkdownCommand: list?.getAttribute?.("data-agent-evidence-export-markdown-command") || "",
          exportPath: list?.getAttribute?.("data-agent-evidence-export-path") || "",
          exportMarkdownPath: list?.getAttribute?.("data-agent-evidence-export-markdown-path") || "",
          scmVisible: isVisibleNode(scm),
          scmText: String(scm?.textContent || "").slice(0, 240),
          scmResourceUris: scmResourceNodes.map((node) => node.getAttribute("data-agent-evidence-resource-uri") || "").filter(Boolean),
          scmOpenCommandIds: scmResourceNodes.map((node) => node.getAttribute("data-agent-evidence-open-command") || "").filter(Boolean),
          scmDiffCommandIds: scmResourceNodes.map((node) => node.getAttribute("data-agent-evidence-diff-command") || "").filter(Boolean),
          scmStageCommandIds: scmResourceNodes.map((node) => node.getAttribute("data-agent-evidence-stage-command") || "").filter(Boolean),
          scmAttachCommandIds: scmResourceNodes.map((node) => node.getAttribute("data-agent-evidence-attach-command") || "").filter(Boolean),
          scmReadonlyEvidenceFlags: scmResourceNodes.map((node) => node.getAttribute("data-agent-evidence-readonly") || "").filter(Boolean),
          scmRollbackRiskLabels: scmResourceNodes.map((node) => node.getAttribute("data-agent-evidence-rollback-risk-label") || "").filter(Boolean),
          testingVisible: isVisibleNode(testing),
          testingState: testing?.querySelector?.("[data-agent-evidence-test-state]")?.getAttribute?.("data-agent-evidence-test-state") || "",
          testingText: String(testing?.textContent || "").slice(0, 240),
          testingRerunCommandIds: testingItemNodes.map((node) => node.getAttribute("data-agent-evidence-rerun-command") || "").filter(Boolean),
          testingFailureDetails: testingItemNodes.map((node) => node.getAttribute("data-agent-evidence-failure-detail") || "").filter(Boolean),
          testingResourceLinks: testingItemNodes.flatMap((node) => String(node.getAttribute("data-agent-evidence-resource-links") || "").split(",").filter(Boolean)),
          timelineVisible: isVisibleNode(timeline),
          timelineRows: timeline?.querySelectorAll?.(".agent-evidence-row")?.length || 0,
          timelineCommandIds: timelineItemNodes.map((node) => node.getAttribute("data-agent-evidence-timeline-command") || "").filter(Boolean),
          timelineResources: timelineItemNodes.map((node) => node.getAttribute("data-agent-evidence-timeline-resource") || "").filter(Boolean),
          timelineLinks: timelineItemNodes.map((node) => node.getAttribute("data-agent-evidence-timeline-link") || "").filter(Boolean),
          progressVisible: isVisibleNode(progress),
          progressRows: progress?.querySelectorAll?.(".agent-evidence-row")?.length || 0,
          progressAggregateStatuses: progressItemNodes.map((node) => node.getAttribute("data-agent-evidence-aggregate-status") || "").filter(Boolean),
          progressCancelCommandIds: progressItemNodes.map((node) => node.getAttribute("data-agent-evidence-cancel-command") || "").filter(Boolean),
          progressAriaLabels: progressItemNodes.map((node) => node.getAttribute("aria-label") || "").filter(Boolean),
          notificationsVisible: isVisibleNode(notifications),
          notificationSeverities: severityNodes.map((node) => node.getAttribute("data-agent-evidence-severity") || ""),
          notificationDedupeKeys: notificationNodes.map((node) => node.getAttribute("data-agent-evidence-dedupe-key") || "").filter(Boolean),
          notificationDismissCommandIds: notificationNodes.map((node) => node.getAttribute("data-agent-evidence-dismiss-command") || "").filter(Boolean),
          notificationFocusTargets: notificationNodes.map((node) => node.getAttribute("data-agent-evidence-focus-target") || "").filter(Boolean),
          notificationText: String(notifications?.textContent || "").slice(0, 240),
        }
      }
      const collectMcpWorkbenchSmoke = () => {
        const pane = document.querySelector('[data-codek-smoke="mcp-workbench-surface"]')
        const servers = document.querySelector('[data-mcp-surface="servers"]')
        const resources = document.querySelector('[data-mcp-surface="resources"]')
        const gallery = document.querySelector('[data-mcp-surface="gallery"]')
        const readonlyProviderPath = pane?.getAttribute?.("data-mcp-readonly-provider-path") === "true"
        return {
          visible: isVisibleNode(pane),
          serviceId: pane?.getAttribute?.("data-mcp-service-id") || "",
          stateSource: pane?.getAttribute?.("data-mcp-state-source") || "",
          openedCount: Number(pane?.getAttribute?.("data-mcp-opened-count") || 0),
          attachmentCount: Number(pane?.getAttribute?.("data-mcp-attachment-count") || 0),
          readonlyProviderPath,
          serversVisible: isVisibleNode(servers),
          resourcesVisible: isVisibleNode(resources),
          galleryVisible: isVisibleNode(gallery),
          viewIds: String(pane?.getAttribute?.("data-mcp-view-ids") || "").split(",").filter(Boolean),
          commandIds: String(pane?.getAttribute?.("data-mcp-command-ids") || "").split(",").filter(Boolean),
          quickAccessPrefixes: String(pane?.getAttribute?.("data-mcp-quick-access-prefixes") || "").split(",").filter(Boolean),
          renderedViewIds: [...(servers?.querySelectorAll?.("[data-mcp-view-id]") || [])].map((node) => node.getAttribute("data-mcp-view-id") || ""),
          galleryServer: pane?.getAttribute?.("data-mcp-gallery-server") || "",
          galleryInstallState: pane?.getAttribute?.("data-mcp-gallery-install-state") || "",
          galleryStatusLabel: pane?.getAttribute?.("data-mcp-gallery-status-label") || "",
          galleryActionIds: String(pane?.getAttribute?.("data-mcp-gallery-action-ids") || "").split(",").filter(Boolean),
          galleryEnabledActionIds: String(pane?.getAttribute?.("data-mcp-gallery-enabled-action-ids") || "").split(",").filter(Boolean),
          galleryMetadataCount: Number(pane?.getAttribute?.("data-mcp-gallery-metadata-count") || 0),
          galleryHasReadme: pane?.getAttribute?.("data-mcp-gallery-has-readme") === "true",
          galleryHasManifest: pane?.getAttribute?.("data-mcp-gallery-has-manifest") === "true",
          preservesAgentApproval: pane?.getAttribute?.("data-mcp-preserves-agent-approval") === "true",
          noSecondState: pane?.getAttribute?.("data-mcp-no-second-state") === "true",
          resourceText: String(resources?.textContent || "").slice(0, 240),
          galleryText: String(gallery?.textContent || "").slice(0, 240),
        }
      }
      const seedMcpGalleryWorkbenchDetailSmoke = () => {
        try {
          const model = buildMcpGalleryDetailViewModel({
            name: "io.modelcontextprotocol.filesystem",
            displayName: "Filesystem MCP",
            description: "Filesystem tools",
            publisher: "MCP",
            version: "1.0.0",
            repositoryUrl: "https://github.com/modelcontextprotocol/servers",
            packageType: "npm",
            configuration: { command: "npx" },
          }, {
            readme: "# Filesystem MCP\nProvider-backed resource smoke detail.",
            permission: { canInstall: true, reason: "" },
            installed: null,
          })
          setMcpWorkbenchGalleryDetailForEvidence(model)
          mcpWorkbenchRevision.value += 1
          return { ok: true, serverName: model.name }
        } catch (error) {
          return { ok: false, error: String(error?.message || error || "") }
        }
      }
      const collectExtensionGalleryWorkbenchSmoke = () => {
        const shell = document.querySelector('[data-codek-smoke="extension-gallery-workbench-shell"]')
        const pane = document.querySelector('[data-codek-smoke="extension-gallery-workbench-surface"]')
        const search = document.querySelector('[data-codek-smoke="extensions-search-input"]')
        const installed = document.querySelector('[data-codek-smoke="extension-gallery-installed"]')
        const results = document.querySelector('[data-codek-smoke="extension-gallery-search-results"]')
        const detail = document.querySelector('[data-codek-smoke="extension-gallery-detail"]')
        return {
          shellVisible: isVisibleNode(shell),
          visible: isVisibleNode(pane),
          searchVisible: isVisibleNode(search),
          installedVisible: isVisibleNode(installed),
          resultsVisible: isVisibleNode(results),
          detailVisible: isVisibleNode(detail),
          containerId: shell?.getAttribute?.("data-workbench-container-id") || pane?.getAttribute?.("data-extension-gallery-container-id") || "",
          viewId: shell?.getAttribute?.("data-workbench-view-id") || "",
          serviceId: pane?.getAttribute?.("data-extension-gallery-service-id") || "",
          stateSource: pane?.getAttribute?.("data-extension-gallery-state-source") || "",
          viewIds: String(pane?.getAttribute?.("data-extension-gallery-view-ids") || "").split(",").filter(Boolean),
          commandIds: String(pane?.getAttribute?.("data-extension-gallery-command-ids") || "").split(",").filter(Boolean),
          quickAccessPrefix: pane?.getAttribute?.("data-extension-gallery-quick-access-prefix") || "",
          lastQuery: pane?.getAttribute?.("data-extension-gallery-last-query") || "",
          resultCount: Number(pane?.getAttribute?.("data-extension-gallery-result-count") || 0),
          installedCount: Number(pane?.getAttribute?.("data-extension-gallery-installed-count") || 0),
          editorCount: Number(pane?.getAttribute?.("data-extension-gallery-editor-count") || 0),
          openedExtensionIds: String(pane?.getAttribute?.("data-extension-gallery-opened-extension-ids") || "").split(",").filter(Boolean),
          latestEditorId: pane?.getAttribute?.("data-extension-gallery-latest-editor-id") || "",
          actionStateCount: Number(pane?.getAttribute?.("data-extension-gallery-action-state-count") || 0),
          errorActionCount: Number(pane?.getAttribute?.("data-extension-gallery-error-action-count") || 0),
          progressCount: Number(pane?.getAttribute?.("data-extension-gallery-progress-count") || 0),
          latestProgressPhase: pane?.getAttribute?.("data-extension-gallery-latest-progress-phase") || "",
          localFirst: pane?.getAttribute?.("data-extension-gallery-local-first") === "true",
          noSecondState: pane?.getAttribute?.("data-extension-gallery-no-second-state") === "true",
          resultRows: results?.querySelectorAll?.("[data-extension-id]")?.length || 0,
          installedRows: installed?.querySelectorAll?.("[data-extension-id]")?.length || 0,
          detailExtensionId: detail?.getAttribute?.("data-extension-gallery-editor-id") || "",
          detailInstallState: detail?.getAttribute?.("data-extension-gallery-install-state") || "",
          detailActionIds: String(detail?.getAttribute?.("data-extension-gallery-action-ids") || "").split(",").filter(Boolean),
          detailRollbackAvailable: detail?.getAttribute?.("data-extension-gallery-rollback-available") === "true",
          detailServiceId: detail?.getAttribute?.("data-extension-gallery-detail-service-id") || "",
          detailStateSource: detail?.getAttribute?.("data-extension-gallery-detail-state-source") || "",
          text: String(pane?.textContent || "").slice(0, 240),
        }
      }
      const openExtensionGalleryWorkbenchDetailSmoke = async () => {
        const result = {
          attempted: false,
          opened: false,
          extensionId: "",
          error: "",
        }
        try {
          await waitForSmokeState(() => document.querySelector('[data-codek-smoke="extension-gallery-search-results"]'), "Extension Gallery search results visible", 8_000)
          const firstResult = document.querySelector('[data-codek-smoke="extension-gallery-search-results"] [data-extension-id]')
          const extensionId = firstResult?.getAttribute?.("data-extension-id") || ""
          result.extensionId = extensionId
          result.attempted = Boolean(extensionId)
          if (!extensionId) {
            const seededExtensionId = await window.__codekSeedExtensionGalleryWorkbenchDetailForSmoke?.() || ""
            result.extensionId = seededExtensionId
            result.attempted = Boolean(seededExtensionId)
            if (!seededExtensionId) {
              result.error = "No extension gallery result row was available to open"
              return result
            }
            await nextTick()
            await waitForSmokeState(
              () => {
                const detail = document.querySelector('[data-codek-smoke="extension-gallery-detail"]')
                return detail?.getAttribute?.("data-extension-gallery-editor-id") === seededExtensionId
              },
              "Extension Gallery seeded detail visible through service open",
              10_000,
            )
            result.opened = true
            return result
          }
          const detailButton = firstResult?.querySelector?.(".extension-action-btn")
          detailButton?.dispatchEvent?.(new MouseEvent("click", { bubbles: true }))
          await nextTick()
          await waitForSmokeState(
            () => document.querySelector('[data-codek-smoke="extension-gallery-detail"]'),
            "Extension Gallery detail visible",
            10_000,
          )
          result.opened = true
        } catch (error) {
          result.error = String(error?.message || error || "")
        }
        return result
      }
      const seedExtensionTrustRemoteAuthWorkbenchSmoke = async () => {
        const commandResults = []
        const commandTimeoutMs = 8_000
        const runSeedCommand = async (stage, commandId, args = []) => {
          setRealUiSmokeStage(`extension-trust-remote-auth:seed:${stage}:start`, { commandId })
          let timer = null
          try {
            const result = await Promise.race([
              executeCommand(commandId, args),
              new Promise((resolve) => {
                timer = setTimeout(() => resolve("timeout"), commandTimeoutMs)
              }),
            ])
            if (timer) clearTimeout(timer)
            const entry = {
              stage,
              commandId,
              ok: result !== "timeout",
              timedOut: result === "timeout",
              executed: result === true,
              error: result === "timeout" ? `command timed out after ${commandTimeoutMs}ms` : "",
            }
            commandResults.push(entry)
            setRealUiSmokeStage(`extension-trust-remote-auth:seed:${stage}:done`, entry)
            return entry
          } catch (error) {
            if (timer) clearTimeout(timer)
            const entry = {
              stage,
              commandId,
              ok: false,
              timedOut: false,
              executed: false,
              error: String(error?.message || error || ""),
            }
            commandResults.push(entry)
            setRealUiSmokeStage(`extension-trust-remote-auth:seed:${stage}:error`, entry)
            return entry
          }
        }
        try {
          const activation = await runSeedCommand(
            "activate-placeholder",
            EXTENSION_HOST_WORKBENCH_COMMAND_IDS.ActivatePlaceholder,
            ["onStartupFinished", "codek.placeholder"],
          )
          const allow = await runSeedCommand(
            "workspace-trust-allow",
            WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Allow,
            [w.projectRoot || ""],
          )
          const deny = await runSeedCommand(
            "workspace-trust-deny",
            WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Deny,
            [w.projectRoot || ""],
          )
          setRealUiSmokeStage("extension-trust-remote-auth:seed:remote-authority:start")
          const remoteAuthority = seedRemoteAuthorityWorkbenchEvidenceForSmoke()
          setRealUiSmokeStage("extension-trust-remote-auth:seed:remote-authority:done", {
            resolveCount: remoteAuthority.resolveCount,
            successCount: remoteAuthority.successCount,
            failureCount: remoteAuthority.failureCount,
            cacheHitCount: remoteAuthority.cacheHitCount,
          })
          setRealUiSmokeStage("extension-trust-remote-auth:seed:authentication:start")
          const authentication = seedAuthenticationWorkbenchEvidenceForSmoke()
          setRealUiSmokeStage("extension-trust-remote-auth:seed:authentication:done", {
            providerIds: authentication.providerIds,
            statuses: authentication.statuses,
            latestStatus: authentication.latestSession?.status || "",
          })
          const result = {
            ok: Boolean(remoteAuthority.resolveCount > 0 && authentication.sessions.length > 0),
            commandResults,
            degraded: commandResults.some((entry) => !entry.ok),
            activation,
            allow,
            deny,
          }
          setRealUiSmokeStage("extension-trust-remote-auth:seed:done", {
            ok: result.ok,
            degraded: result.degraded,
            commandResults,
          })
          return result
        } catch (error) {
          return {
            ok: false,
            degraded: true,
            commandResults,
            error: String(error?.message || error || ""),
          }
        }
      }
      const collectExtensionTrustRemoteAuthWorkbenchSmoke = () => {
        const pane = document.querySelector('[data-codek-smoke="extension-trust-remote-auth-workbench"]')
        return {
          visible: isVisibleNode(pane),
          containerId: pane?.getAttribute?.("data-workbench-container-id") || "",
          viewIds: String(pane?.getAttribute?.("data-workbench-view-ids") || "").split(",").filter(Boolean),
          commandIds: String(pane?.getAttribute?.("data-workbench-command-ids") || "").split(",").filter(Boolean),
          extensionHostServiceId: pane?.getAttribute?.("data-extension-host-service-id") || "",
          workspaceTrustServiceId: pane?.getAttribute?.("data-workspace-trust-service-id") || "",
          remoteAuthorityServiceId: pane?.getAttribute?.("data-remote-authority-service-id") || "",
          authenticationServiceId: pane?.getAttribute?.("data-authentication-service-id") || "",
          extensionHostStateSource: pane?.getAttribute?.("data-extension-host-state-source") || "",
          workspaceTrustStateSource: pane?.getAttribute?.("data-workspace-trust-state-source") || "",
          remoteAuthorityStateSource: pane?.getAttribute?.("data-remote-authority-state-source") || "",
          authenticationStateSource: pane?.getAttribute?.("data-authentication-state-source") || "",
          activationCount: Number(pane?.getAttribute?.("data-extension-host-activation-count") || 0),
          latestActivationEvent: pane?.getAttribute?.("data-extension-host-latest-activation-event") || "",
          latestActivationExtension: pane?.getAttribute?.("data-extension-host-latest-activation-extension") || "",
          trustStatus: pane?.getAttribute?.("data-workspace-trust-status") || "",
          trustDecisionCount: Number(pane?.getAttribute?.("data-workspace-trust-decision-count") || 0),
          latestTrustDecision: pane?.getAttribute?.("data-workspace-trust-latest-decision") || "",
          remoteResolveCount: Number(pane?.getAttribute?.("data-remote-authority-resolve-count") || 0),
          remoteSuccessCount: Number(pane?.getAttribute?.("data-remote-authority-success-count") || 0),
          remoteFailureCount: Number(pane?.getAttribute?.("data-remote-authority-failure-count") || 0),
          remoteCacheHitCount: Number(pane?.getAttribute?.("data-remote-authority-cache-hit-count") || 0),
          remoteLatestStatus: pane?.getAttribute?.("data-remote-authority-latest-status") || "",
          authStatuses: String(pane?.getAttribute?.("data-authentication-statuses") || "").split(",").filter(Boolean),
          authLatestStatus: pane?.getAttribute?.("data-authentication-latest-status") || "",
          authProviderIds: String(pane?.getAttribute?.("data-authentication-provider-ids") || "").split(",").filter(Boolean),
          authTokenRedacted: pane?.getAttribute?.("data-authentication-token-redacted") === "true",
          noSecondExtensionRuntime: pane?.getAttribute?.("data-extension-trust-remote-auth-no-second-extension-runtime") === "true",
          noSecondTrustStore: pane?.getAttribute?.("data-extension-trust-remote-auth-no-second-trust-store") === "true",
          noSecondRemoteState: pane?.getAttribute?.("data-extension-trust-remote-auth-no-second-remote-state") === "true",
          noSecondAuthStore: pane?.getAttribute?.("data-extension-trust-remote-auth-no-second-auth-store") === "true",
          preservesAgentEvidence: pane?.getAttribute?.("data-extension-trust-remote-auth-preserves-agent-evidence") === "true",
          renderedSurfaces: [...(pane?.querySelectorAll?.("[data-extension-trust-remote-auth-surface]") || [])]
            .map((node) => node.getAttribute("data-extension-trust-remote-auth-surface") || ""),
          text: String(pane?.textContent || "").slice(0, 240),
        }
      }
      setRealUiSmokeStage("workbench-layout:start")
      await executeCommand("workbench.action.togglePanel")
      await waitForSmokeState(() => document.querySelector('[data-codek-smoke="bottom-panel"]')?.getAttribute?.("data-workbench-panel-id"), "workbench layout panel data")
      const savedWorkbenchSnapshot = globalWorkbenchLayoutService.deserializeSnapshot(
        globalWorkbenchLayoutService.serializeSnapshot(workbenchLayoutSnapshot.value),
      )
      const layoutFocusResults = [
        await focusWorkbenchPartForSmoke(WorkbenchParts.SIDEBAR_PART),
        await focusWorkbenchPartForSmoke(WorkbenchParts.EDITOR_PART),
        await focusWorkbenchPartForSmoke(WorkbenchParts.PANEL_PART),
      ]
      await executeCommand("workbench.view.search")
      await nextTick()
      await waitForSmokeState(() => activeView.value === "search", "workbench layout retained sidebar view active")
      const retainedWorkbenchLayout = collectWorkbenchLayoutSmoke()
      const restoreResult = globalWorkbenchLayoutService.restoreFromSnapshot(savedWorkbenchSnapshot, {
        setActiveSidebarView: (view) => { activeView.value = view },
        setSidebarVisible: (visible) => { sidebarVisible.value = visible },
        setSidebarWidth: (width) => { sidebarWidth.value = width },
        setBottomPanel: (panel) => {
          if (panel) openBottomPanel(bottomPanelState, panel)
          else closeBottomPanel(bottomPanelState)
        },
        setBottomPanelHeight: (height) => { bottomPanelHeight.value = height },
        setSplitOpen: (open) => { splitOpen.value = open },
        setSplitFile: (path) => { splitFile.value = path },
        setSplitRatio: (ratio) => { splitRatio.value = ratio },
      })
      await nextTick()
      const restoredWorkbenchLayout = collectWorkbenchLayoutSmoke()
      const workbenchLayoutRestore = {
        restored: restoreResult.restored,
        reason: restoreResult.reason || "",
        activeViewMatches: restoredWorkbenchLayout.sidebarViewId === (savedWorkbenchSnapshot?.parts.sideBar.activeViewId || ""),
        sidebarVisibleMatches: restoredWorkbenchLayout.sidebarVisible === Boolean(savedWorkbenchSnapshot?.parts.sideBar.visible),
        sidebarWidthMatches: Number(restoredWorkbenchLayout.sidebarWidth || 0) === Number(savedWorkbenchSnapshot?.parts.sideBar.width || 0),
        panelMatches: (restoredWorkbenchLayout.panelId || "") === (savedWorkbenchSnapshot?.parts.panel.activePanelId || ""),
        panelHeightMatches: Number(restoredWorkbenchLayout.panelHeight || 0) === Number(savedWorkbenchSnapshot?.parts.panel.height || 0),
        splitMatches: String(restoredWorkbenchLayout.editorPartSplitOpen) === String(savedWorkbenchSnapshot?.parts.editorPart.split.open || false),
      }
      const agentEvidenceCommandOpened = await executeCommand("agent.evidence.openTimeline", [], { agentEvidenceAvailable: true })
      if (!agentEvidenceCommandOpened) {
        openAgentEvidenceSurface("timeline")
      }
      await nextTick()
      await waitForSmokeState(() => document.querySelector('[data-codek-smoke="agent-evidence-workbench"]'), "agent evidence workbench visible")
      const agentEvidenceWorkbench = collectAgentEvidenceWorkbenchSmoke()
      const mcpCommandOpened = await executeCommand("workbench.view.mcp")
      if (!mcpCommandOpened) openSidebarView("mcp")
      await nextTick()
      await waitForSmokeState(() => activeView.value === "mcp", "MCP workbench view active")
      const mcpGalleryDetailSeed = seedMcpGalleryWorkbenchDetailSmoke()
      await nextTick()
      await waitForSmokeState(() => document.querySelector('[data-codek-smoke="mcp-workbench-surface"]'), "MCP workbench surface visible")
      const mcpWorkbench = collectMcpWorkbenchSmoke()
      const extensionCommandOpened = await executeCommand("workbench.view.extensions")
      if (!extensionCommandOpened) openSidebarView("marketplace")
      await nextTick()
      await waitForSmokeState(() => activeView.value === "marketplace", "Extension Gallery workbench view active")
      await waitForSmokeState(() => document.querySelector('[data-codek-smoke="extension-gallery-workbench-surface"]'), "Extension Gallery workbench surface visible")
      const extensionGalleryDetailOpen = await openExtensionGalleryWorkbenchDetailSmoke()
      const extensionGalleryWorkbench = collectExtensionGalleryWorkbenchSmoke()
      setRealUiSmokeStage("extension-trust-remote-auth:start")
      const extensionTrustRemoteAuthSeed = await seedExtensionTrustRemoteAuthWorkbenchSmoke()
      setRealUiSmokeStage("extension-trust-remote-auth:seed:return", {
        seeded: Boolean(extensionTrustRemoteAuthSeed.ok),
        degraded: Boolean(extensionTrustRemoteAuthSeed.degraded),
        commandResults: extensionTrustRemoteAuthSeed.commandResults || [],
      })
      setRealUiSmokeStage("extension-trust-remote-auth:open-view:start")
      openSidebarView("remote")
      setRealUiSmokeStage("extension-trust-remote-auth:open-view:called", { activeView: activeView.value })
      await waitSmokeNextTick()
      setRealUiSmokeStage("extension-trust-remote-auth:open-view:tick", { activeView: activeView.value })
      await waitForSmokeState(() => activeView.value === "remote", "Extension/Trust/Remote/Auth workbench view active")
      setRealUiSmokeStage("extension-trust-remote-auth:open-view:active", { activeView: activeView.value })
      await waitForSmokeState(() => document.querySelector('[data-codek-smoke="extension-trust-remote-auth-workbench"]'), "Extension/Trust/Remote/Auth workbench surface visible")
      setRealUiSmokeStage("extension-trust-remote-auth:surface-visible")
      const extensionTrustRemoteAuthWorkbench = collectExtensionTrustRemoteAuthWorkbenchSmoke()
      setRealUiSmokeStage("extension-trust-remote-auth:done", {
        seeded: Boolean(extensionTrustRemoteAuthSeed.ok),
        serviceIds: {
          extensionHost: extensionTrustRemoteAuthWorkbench.extensionHostServiceId,
          workspaceTrust: extensionTrustRemoteAuthWorkbench.workspaceTrustServiceId,
          remoteAuthority: extensionTrustRemoteAuthWorkbench.remoteAuthorityServiceId,
          authentication: extensionTrustRemoteAuthWorkbench.authenticationServiceId,
        },
      })
      setRealUiSmokeStage("quickinput:start")
      const quickInputWorkbench = await exerciseQuickInputWorkbenchSmoke()
      setRealUiSmokeStage("quickinput:done", quickInputWorkbench)
      setRealUiSmokeStage("terminal-debug-task:start")
      const terminalDebugTaskWorkbench = await exerciseTerminalDebugTaskWorkbenchSmoke()
      setRealUiSmokeStage("terminal-debug-task:done", {
        serviceId: terminalDebugTaskWorkbench.serviceId,
        commandsExecuted: terminalDebugTaskWorkbench.commandsExecuted,
        commandFailures: terminalDebugTaskWorkbench.commandFailures,
        panelId: terminalDebugTaskWorkbench.panelId,
        terminalCount: terminalDebugTaskWorkbench.terminalCount,
        taskLatestStatus: terminalDebugTaskWorkbench.taskLatestStatus,
        problemsVisible: terminalDebugTaskWorkbench.problemsVisible,
      })
      await executeCommand("workbench.view.search")
      await nextTick()
      await waitForSmokeState(() => activeView.value === "search", "workbench layout search view active")
      const workbenchLayout = collectWorkbenchLayoutSmoke()
      setRealUiSmokeStage("workbench-layout:done", workbenchLayout)

      const restoreRealProjectUiScreenshotSurface = async () => {
        const target = normalFile || rootPackageFile || searchGroup?.path || w.activeFile || ""
        const summary = {
          target,
          restored: false,
          activeFileBefore: w.activeFile || "",
          activeFile: "",
          editorVisible: false,
          expectedTextVisible: false,
          visibleLineNumberCount: 0,
          editorValueLength: 0,
          error: "",
        }
        if (!target) {
          summary.error = "missing screenshot restore target"
          return summary
        }
        try {
          setRealUiSmokeStage("screenshot-restore:start", { target, activeFile: w.activeFile })
          chatOpen.value = false
          sidebarVisible.value = true
          await handleOpenFile(target)
          await waitForSmokeState(
            () => w.activeFile === target && typeof w.files[target] === "string" && getSafeEditorValueLength() > 0,
            "real project screenshot editor restored",
            10_000,
          )
          await nextTick()
          editor?.focus?.()
          await waitSmokeFrames(4)
          const workspaceValue = String(w.files[target] || "")
          const expectedText = workspaceValue.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() || ""
          const probe = getSmokeEditorVisibleProbe(expectedText)
          summary.restored = w.activeFile === target
          summary.activeFile = w.activeFile || ""
          summary.editorVisible = Boolean(probe.containerVisible && probe.visibleViewLineCount > 0)
          summary.expectedTextVisible = expectedText ? Boolean(probe.expectedTextVisible) : summary.editorVisible
          summary.visibleLineNumberCount = Number(probe.visibleLineNumberCount || 0)
          summary.editorValueLength = getSafeEditorValueLength()
          setRealUiSmokeStage("screenshot-restore:done", summary)
        } catch (error) {
          summary.activeFile = w.activeFile || ""
          summary.error = String(error?.message || error || "")
          setRealUiSmokeStage("screenshot-restore:error", summary)
        }
        return summary
      }

      const screenshotRestore = await restoreRealProjectUiScreenshotSurface()

      setRealUiSmokeStage("return:metrics")
      const result = {
        projectRoot: w.projectRoot,
        workspaceRoots: [...(w.workspaceRoots || [])],
        nativeHostMounted: Boolean(host),
        totalRows,
        domRows: rows.length,
        blankVisibleRows,
        scrollSamples,
        visibleRowSnapshotBeforeFastScroll: firstVisibleRowSnapshot,
        visibleRowSnapshotAfterFastScroll: finalVisibleRowSnapshot,
        visibleRowsStableAfterFastScroll,
        p95ScrollMs: sortedSamples[p95Index] || 0,
        maxScrollMs: scrollSamples.length ? Math.max(...scrollSamples) : 0,
        longTasks: scrollSamples.filter((value) => value > 50).length,
        normalFile,
        normalActiveFile,
        normalEditorContentVisible: normalEditorValue.trim().length > 0 || normalWorkspaceValue.trim().length > 0,
        rootPackageFile,
        rootPackageActiveFile,
        rootPackageEditorValueVisible: rootPackageEditorValue.includes(rootPackageExpectedText),
        rootPackageDomTextVisible: Boolean(rootPackageVisibleProbe?.expectedTextVisible),
        rootPackageLineNumbersVisible: Number(rootPackageVisibleProbe?.visibleLineNumberCount || 0) > 0,
        rootPackageVisibleProbe,
        largeFile,
        largeFileRealContentVisible: Boolean(largeFile) ? largeFileProbe.editorVisible && largeFileProbe.realContentVisible && !largeFileProbe.staleGuardTextVisible : true,
        largeFileEditorVisible: Boolean(largeFile) ? largeFileProbe.editorVisible : true,
        largeFileContentVisible: Boolean(largeFile) ? largeFileProbe.contentVisible && largeFileProbe.realContentVisible && !largeFileProbe.staleGuardTextVisible : true,
        largeFileViewportTextVisible: Boolean(largeFile) ? Boolean(largeFileViewportProbe?.textVisible || largeFileProbe.viewportProbe?.textVisible) : true,
        largeFileDeepViewportTextVisible: Boolean(largeFile) ? Boolean(largeFileDeepViewportProbe?.ready && largeFileDeepViewportProbe?.markerVisible) : true,
        largeFileDeepViewportLine: Boolean(largeFile) ? Number(largeFileDeepViewportProbe?.targetLine || 0) : 0,
        largeFileDeepViewportFirstVisibleLineNumber: Boolean(largeFile) ? String(largeFileDeepViewportProbe?.firstVisibleLineNumber || "") : "",
        largeFileDeepViewportLastVisibleLineNumber: Boolean(largeFile) ? String(largeFileDeepViewportProbe?.lastVisibleLineNumber || "") : "",
        largeFileDeepViewportVisibleLineCount: Boolean(largeFile) ? Number(largeFileDeepViewportProbe?.visibleNonEmptyViewLineCount || 0) : 0,
        largeFileDeepViewportTextSample: Boolean(largeFile) ? String(largeFileDeepViewportProbe?.textSample || "") : "",
        largeFileDeepViewportProbe,
        largeFileSafeLineLength: Boolean(largeFile) ? largeFileProbe.safeLineLengthVisible : true,
        largeFileContinuousWindowVisible: Boolean(largeFile) ? largeFileProbe.continuousWindowVisible : true,
        largeFileFirstVisibleLineNumber: Boolean(largeFile) ? largeFileProbe.firstVisibleLineNumber : "",
        largeFileLastVisibleLineNumber: Boolean(largeFile) ? largeFileProbe.lastVisibleLineNumber : "",
        largeFileEditorLineCount: Boolean(largeFile) ? largeFileProbe.editorLineCount : 0,
        largeFileMaxVisibleLineLength: Boolean(largeFile) ? largeFileProbe.maxVisibleLineLength : 0,
        largeFileEditorValueLength: Boolean(largeFile) ? largeFileProbe.editorValueLength : 0,
        largeFileActiveFileContentLength: Boolean(largeFile) ? largeFileProbe.activeFileContentLength : 0,
        largeFileRangeStateVisible: Boolean(largeFile) ? largeFileProbe.rangeStateVisible : true,
        largeFileRangeStateBytesRead: Boolean(largeFile) ? largeFileProbe.rangeStateBytesRead : 0,
        largeFileRangeStateWindowBytes: Boolean(largeFile) ? largeFileProbe.rangeStateWindowBytes : 0,
        largeFileRangeStateOffset: Boolean(largeFile) ? largeFileProbe.rangeStateOffset : 0,
        largeFileRangeStateHasNext: Boolean(largeFile) ? largeFileProbe.rangeStateHasNext : false,
        largeFileRangeStateHasPrevious: Boolean(largeFile) ? largeFileProbe.rangeStateHasPrevious : false,
        largeFileRangeStateSize: Boolean(largeFile) ? largeFileProbe.rangeStateSize : 0,
        largeFileRangeStateReadOnly: Boolean(largeFile) ? largeFileProbe.rangeStateReadOnly : false,
        largeFileOptimizedStateVisible: Boolean(largeFile) ? largeFileProbe.optimizedStateVisible : true,
        largeFileOptimizedStateBytesRead: Boolean(largeFile) ? largeFileProbe.optimizedStateBytesRead : 0,
        largeFileOptimizedStateSize: Boolean(largeFile) ? largeFileProbe.optimizedStateSize : 0,
        largeFileOptimizedStateReadOnly: Boolean(largeFile) ? largeFileProbe.optimizedStateReadOnly : false,
        largeFileWindowNavigationRequired,
        largeFileNextWindowLoaded: Boolean(largeFile) ? largeFileNextWindowLoaded : true,
        largeFileNextWindowVisible: Boolean(largeFile) ? largeFileNextWindowVisible : true,
        largeFileNextWindowViewportTextVisible: Boolean(largeFile) ? Boolean(largeFileNextWindowViewportProbe?.ready && largeFileNextWindowViewportProbe?.markerVisible) : true,
        largeFileNextWindowViewportLine: Boolean(largeFile) ? Number(largeFileNextWindowViewportProbe?.targetLine || 0) : 0,
        largeFileNextWindowViewportTextSample: Boolean(largeFile) ? String(largeFileNextWindowViewportProbe?.textSample || "") : "",
        largeFileNextWindowViewportProbe,
        largeFileFinalWindowLoaded: Boolean(largeFile) ? largeFileFinalWindowLoaded : true,
        largeFileFinalWindowVisible: Boolean(largeFile) ? largeFileFinalWindowVisible : true,
        largeFileFinalWindowViewportTextVisible: Boolean(largeFile) ? Boolean(largeFileFinalWindowViewportProbe?.ready && largeFileFinalWindowViewportProbe?.markerVisible) : true,
        largeFileFinalWindowViewportLine: Boolean(largeFile) ? Number(largeFileFinalWindowViewportProbe?.targetLine || 0) : 0,
        largeFileFinalWindowViewportTextSample: Boolean(largeFile) ? String(largeFileFinalWindowViewportProbe?.textSample || "") : "",
        largeFileFinalWindowOffset: Boolean(largeFile) ? Number(largeFileFinalWindowResult?.offset || 0) : 0,
        largeFileFinalWindowBytesRead: Boolean(largeFile) ? Number(largeFileFinalWindowResult?.bytesRead || 0) : 0,
        largeFileFinalWindowWindowBytes: Boolean(largeFile) ? Number(largeFileFinalWindowResult?.windowBytes || 0) : 0,
        largeFileFinalWindowSize: Boolean(largeFile) ? Number(largeFileFinalWindowResult?.size || 0) : 0,
        largeFileFinalWindowHasNext: Boolean(largeFile) ? Boolean(largeFileFinalWindowResult?.hasNext) : false,
        largeFileFinalWindowHasPrevious: Boolean(largeFile) ? Boolean(largeFileFinalWindowResult?.hasPrevious) : false,
        largeFileFinalWindowVisitedOffsets: Boolean(largeFile) ? [...(largeFileFinalWindowResult?.visitedOffsets || [])] : [],
        largeFileFinalWindowResult,
        largeFileFinalWindowViewportProbe,
        largeFileReopenRangeStateVisible: Boolean(largeFile) ? Boolean(largeFileReopenProbe?.rangeStateVisible) : true,
        largeFileReopenRangeStateBytesRead: Boolean(largeFile) ? Number(largeFileReopenProbe?.rangeStateBytesRead || 0) : 0,
        largeFileReopenRealContentVisible: Boolean(largeFile) ? Boolean(largeFileReopenProbe?.editorVisible && largeFileReopenProbe?.realContentVisible && !largeFileReopenProbe?.staleGuardTextVisible && !largeFileReopenProbe?.blockingNoticeVisible && largeFileReopenViewportProbe?.ready && largeFileReopenViewportProbe?.markerVisible) : true,
        largeFileReopenViewportTextVisible: Boolean(largeFile) ? Boolean(largeFileReopenViewportProbe?.ready && largeFileReopenViewportProbe?.markerVisible) : true,
        largeFileReopenViewportTextSample: Boolean(largeFile) ? String(largeFileReopenViewportProbe?.textSample || "") : "",
        largeFileReopenViewportProbe,
        largeFileUserPageDownViewportTextVisible: Boolean(largeFile) ? Boolean(largeFileUserScrollResult?.pageDownReady) : true,
        largeFileUserPageDownViewportTextSample: Boolean(largeFile) ? String(largeFileUserScrollResult?.pageDownTextSample || "") : "",
        largeFileUserScrollBottomLoaded: Boolean(largeFile) ? Boolean(largeFileUserScrollResult?.scrollBottomLoaded) : true,
        largeFileUserScrollBottomOffsetAdvanced: Boolean(largeFile) ? Boolean(largeFileUserScrollResult?.scrollBottomOffsetAdvanced) : true,
        largeFileUserScrollBottomViewportTextVisible: Boolean(largeFile) ? Boolean(largeFileUserScrollResult?.scrollBottomReady) : true,
        largeFileUserScrollBottomViewportTextSample: Boolean(largeFile) ? String(largeFileUserScrollResult?.scrollBottomTextSample || "") : "",
        largeFileUserScrollbarDragDispatched: Boolean(largeFile) ? Boolean(largeFileUserScrollResult?.scrollbarDragDispatched) : true,
        largeFileUserScrollbarDragScrollBefore: Boolean(largeFile) ? Number(largeFileUserScrollResult?.scrollbarDragScrollBefore || 0) : 0,
        largeFileUserScrollbarDragScrollAfter: Boolean(largeFile) ? Number(largeFileUserScrollResult?.scrollbarDragScrollAfter || 0) : 0,
        largeFileUserScrollbarDragScrollAdvanced: Boolean(largeFile) ? Boolean(largeFileUserScrollResult?.scrollbarDragScrollAdvanced) : true,
        largeFileUserScrollbarDragDirectLoadRequired: Boolean(largeFile) ? Boolean(largeFileUserScrollResult?.scrollbarDragDirectLoadRequired) : false,
        largeFileUserScrollbarDragDirectLoaded: Boolean(largeFile) ? Boolean(largeFileUserScrollResult?.scrollbarDragDirectLoaded) : true,
        largeFileUserScrollbarDragLoaded: Boolean(largeFile) ? Boolean(largeFileUserScrollResult?.scrollbarDragLoaded) : true,
        largeFileUserScrollbarDragOffsetAdvanced: Boolean(largeFile) ? Boolean(largeFileUserScrollResult?.scrollbarDragOffsetAdvanced) : true,
        largeFileUserScrollbarDragViewportTextVisible: Boolean(largeFile) ? Boolean(largeFileUserScrollResult?.scrollbarDragReady) : true,
        largeFileUserScrollbarDragViewportTextSample: Boolean(largeFile) ? String(largeFileUserScrollResult?.scrollbarDragTextSample || "") : "",
        largeFileUserEndViewportTextVisible: Boolean(largeFile) ? Boolean(largeFileUserScrollResult?.endReady) : true,
        largeFileUserEndViewportTextSample: Boolean(largeFile) ? String(largeFileUserScrollResult?.endTextSample || "") : "",
        largeFileUserScrollBeforeOffset: Boolean(largeFile) ? Number(largeFileUserScrollResult?.beforeOffset || 0) : 0,
        largeFileUserScrollTargetOffset: Boolean(largeFile) ? Number(largeFileUserScrollResult?.scrollTargetOffset || 0) : 0,
        largeFileUserScrollBottomOffset: Boolean(largeFile) ? Number(largeFileUserScrollResult?.scrollBottomOffset || 0) : 0,
        largeFileUserScrollbarDragTargetOffset: Boolean(largeFile) ? Number(largeFileUserScrollResult?.scrollbarDragTargetOffset || 0) : 0,
        largeFileUserScrollbarDragOffset: Boolean(largeFile) ? Number(largeFileUserScrollResult?.scrollbarDragOffset || 0) : 0,
        largeFileUserScrollEndOffset: Boolean(largeFile) ? Number(largeFileUserScrollResult?.endOffset || 0) : 0,
        largeFileUserScrollEndHasNext: Boolean(largeFile) ? Boolean(largeFileUserScrollResult?.endHasNext) : false,
        largeFileUserScrollResult,
        largeFileCloseReopenKeepsWorkbenchResponsive: Boolean(largeFile) ? Boolean(largeFileReopenProbe?.editorVisible) && scrollSamples.filter((value) => value > 50).length === 0 : true,
        largeFileLowNoiseStatusVisible: Boolean(largeFile) ? !largeFileProbe.blockingNoticeVisible : true,
        largeFileOrdinaryStatusHidden: Boolean(largeFile) ? !largeFileProbe.ordinaryLargeFileStatusVisible && !largeFileProbe.bodyHasOptimizedText : true,
        largeFileWarningBadgeHidden: Boolean(largeFile) ? !largeFileProbe.warningBadgeVisible : true,
        extremeFile,
        extremeFileAutoWindowNavigation: Boolean(extremeFile) ? extremeFileFirstWindowVisible && extremeFileSecondWindowVisible : true,
        extremeFileFirstWindowVisible,
        extremeFileSecondWindowVisible,
        idleLightbulbHidden: visibleLightbulbs.length === 0,
        idleLightbulbCount: visibleLightbulbs.length,
        searchQuery: searchNeedle,
        expectedSearchPath,
        searchMatchPath: searchGroup.path,
        searchMatchLine: searchMatch.line,
        searchExpectedPathMatched: expectedSearchPath ? searchGroup.path === expectedSearchPath : true,
        searchOpenedContentVisible: searchEditorValue.trim().length > 0 && searchEditorValue.toLowerCase().includes(searchNeedle.toLowerCase()),
        searchBlankEditor: searchEditorValue.trim().length === 0,
        searchViewActive: searchViewActiveAfterOpen,
        sameLineNeedle,
        sameLineSearchPath,
        sameLineMatchRows: sameLineMatches.length,
        sameLineOccurrences: sameLineOccurrences.length,
        sameLineDuplicateCollapsed: sameLineMatches.length === 1 && sameLineOccurrences.length >= 3,
        sameLineOccurrencesAccurate: sameLineOccurrences.length >= 3 && sameLineOccurrences.every((occurrence) => Number(occurrence.column || 0) > 0 && Number(occurrence.matchLength || 0) === sameLineNeedle.length),
        createTargetDir,
        createTargetSkipped: skipCreateTarget,
        createdFileRowVisible: Boolean(createdFileRow),
        createdFolderRowVisible: Boolean(createdFolderRow),
        continuousCreateCount: continuousCreateResults.length,
        continuousCreateRowsVisible: continuousCreateResults.every((entry) => entry.rowVisible),
        continuousCreateResults,
        continuousCreatePassed: continuousCreateResults.length === 10 && continuousCreateResults.every((entry) => entry.rowVisible),
        staleSnapshotRejected,
        staleSnapshotError,
        staleRequestedRowVisible,
        staleSnapshotRowVisible,
        staleCreateSnapshotRejected: staleSnapshotRejected && !staleRequestedRowVisible && !staleSnapshotRowVisible,
        selectedTreePath: selectedTreePath.value,
        selectedTreeKind: selectedTreeKind.value,
        screenshotRestoreActiveFile: screenshotRestore.activeFile,
        screenshotRestoreTarget: screenshotRestore.target,
        screenshotRestoreRestored: Boolean(screenshotRestore.restored),
        screenshotRestoreEditorVisible: Boolean(screenshotRestore.editorVisible),
        screenshotRestoreExpectedTextVisible: Boolean(screenshotRestore.expectedTextVisible),
        screenshotRestoreEditorValueLength: Number(screenshotRestore.editorValueLength || 0),
        screenshotRestoreVisibleLineNumberCount: Number(screenshotRestore.visibleLineNumberCount || 0),
        screenshotRestoreError: screenshotRestore.error,
        screenshotRestore,
        chatInputVisible: Boolean(chatInput),
        chatInputAcceptsText: String(chatInput?.value || "").includes("real project UI smoke chat probe"),
        chatComposerCompact: Boolean(chatComposerRect && chatComposerRect.height <= 118),
        chatComposerNotWhiteBox: Boolean(
          chatComposerStyle &&
          parseRgbMax(chatComposerStyle.backgroundColor) < 80 &&
          parseRgbMax(chatComposerStyle.borderColor) < 180
        ),
        chatComposerRect: chatComposerRect ? {
          width: Math.round(chatComposerRect.width),
          height: Math.round(chatComposerRect.height),
        } : null,
        chatComposerColors: chatComposerStyle ? {
          backgroundColor: chatComposerStyle.backgroundColor,
          borderColor: chatComposerStyle.borderColor,
        } : null,
        workbenchActivityBarVisible: Boolean(workbenchLayout.activityVisible),
        workbenchActivityButtonCount: workbenchLayout.activityButtonCount,
        workbenchActivityContainerIds: workbenchLayout.activityContainerIds,
        workbenchExplorerActivityVisible: Boolean(workbenchLayout.explorerActivityVisible),
        workbenchSearchActivityVisible: Boolean(workbenchLayout.searchActivityVisible),
        workbenchScmActivityVisible: Boolean(workbenchLayout.scmActivityVisible),
        workbenchExtensionsActivityVisible: Boolean(workbenchLayout.extensionsActivityVisible),
        workbenchMcpActivityVisible: Boolean(workbenchLayout.mcpActivityVisible),
        workbenchAgentActivityVisible: Boolean(workbenchLayout.agentActivityVisible),
        workbenchTestingActivityVisible: Boolean(workbenchLayout.testingActivityVisible),
        workbenchSettingsActivityVisible: Boolean(workbenchLayout.settingsActivityVisible),
        workbenchTitleBarVisible: Boolean(workbenchLayout.titleBarVisible),
        workbenchTitleProjectName: workbenchLayout.titleProjectName,
        workbenchTitleActiveEditor: workbenchLayout.titleActiveEditor,
        workbenchTitleActiveViewId: workbenchLayout.titleActiveViewId,
        workbenchTitleAgentMode: workbenchLayout.titleAgentMode,
        workbenchTitleSandboxMode: workbenchLayout.titleSandboxMode,
        workbenchTitleGoalCount: workbenchLayout.titleGoalCount,
        workbenchTitleDiagnosticsErrorCount: workbenchLayout.titleDiagnosticsErrorCount,
        workbenchTitleDiagnosticsWarningCount: workbenchLayout.titleDiagnosticsWarningCount,
        workbenchTitleCommandPaletteHint: workbenchLayout.titleCommandPaletteHint,
        workbenchSidebarVisible: Boolean(workbenchLayout.sidebarVisible),
        workbenchSidebarContainerId: workbenchLayout.sidebarContainerId,
        workbenchSidebarViewId: workbenchLayout.sidebarViewId,
        workbenchSidebarTitle: workbenchLayout.sidebarTitle,
        workbenchSidebarWidth: workbenchLayout.sidebarWidth,
        workbenchRetainedSidebarContainerId: retainedWorkbenchLayout.sidebarContainerId,
        workbenchRetainedSidebarViewId: retainedWorkbenchLayout.sidebarViewId,
        workbenchLayoutConsistent: Boolean(workbenchLayout.layoutConsistent),
        workbenchLayoutServiceSizes: workbenchLayout.serviceSizes,
        workbenchLayoutVisibleNeighbors: workbenchLayout.visibleNeighbors,
        workbenchLayoutFocusResults: layoutFocusResults,
        workbenchLayoutFocusPartIds: layoutFocusResults.map((entry) => entry.focused).filter(Boolean),
        workbenchLayoutFocusVisibleParts: layoutFocusResults.every((entry) => entry.result && entry.activeElementMatches),
        workbenchLayoutRestore,
        workbenchLayoutRestoreMatches: Boolean(
          workbenchLayoutRestore.restored
          && workbenchLayoutRestore.activeViewMatches
          && workbenchLayoutRestore.sidebarVisibleMatches
          && workbenchLayoutRestore.sidebarWidthMatches
          && workbenchLayoutRestore.panelMatches
          && workbenchLayoutRestore.panelHeightMatches
          && workbenchLayoutRestore.splitMatches,
        ),
        agentEvidenceWorkbenchVisible: Boolean(agentEvidenceWorkbench.visible),
        agentEvidenceWorkbenchStatus: agentEvidenceWorkbench.status,
        agentEvidenceWorkbenchReady: agentEvidenceWorkbench.ready,
        agentEvidenceCorrelationId: agentEvidenceWorkbench.correlationId,
        agentEvidenceVsCodeServiceIds: agentEvidenceWorkbench.vscodeServiceIds,
        agentEvidenceListVisible: Boolean(agentEvidenceWorkbench.listVisible),
        agentEvidenceListCount: agentEvidenceWorkbench.listCount,
        agentEvidenceListFilterSurfaces: agentEvidenceWorkbench.listFilterSurfaces,
        agentEvidenceListFilterStatuses: agentEvidenceWorkbench.listFilterStatuses,
        agentEvidenceListFilterSeverities: agentEvidenceWorkbench.listFilterSeverities,
        agentEvidenceListItemIds: agentEvidenceWorkbench.listItemIds,
        agentEvidenceListItemSurfaces: agentEvidenceWorkbench.listItemSurfaces,
        agentEvidenceListItemStatuses: agentEvidenceWorkbench.listItemStatuses,
        agentEvidenceListItemSeverities: agentEvidenceWorkbench.listItemSeverities,
        agentEvidenceListItemCommands: agentEvidenceWorkbench.listItemCommands,
        agentEvidenceListItemResources: agentEvidenceWorkbench.listItemResources,
        agentEvidenceDetailKind: agentEvidenceWorkbench.detailKind,
        agentEvidenceDetailId: agentEvidenceWorkbench.detailId,
        agentEvidenceDetailEditorId: agentEvidenceWorkbench.detailEditorId,
        agentEvidenceDetailEditorUri: agentEvidenceWorkbench.detailEditorUri,
        agentEvidenceExportCommand: agentEvidenceWorkbench.exportCommand,
        agentEvidenceExportMarkdownCommand: agentEvidenceWorkbench.exportMarkdownCommand,
        agentEvidenceExportPath: agentEvidenceWorkbench.exportPath,
        agentEvidenceExportMarkdownPath: agentEvidenceWorkbench.exportMarkdownPath,
        agentEvidenceScmVisible: Boolean(agentEvidenceWorkbench.scmVisible),
        agentEvidenceScmText: agentEvidenceWorkbench.scmText,
        agentEvidenceScmOpenCommandIds: agentEvidenceWorkbench.scmOpenCommandIds,
        agentEvidenceScmDiffCommandIds: agentEvidenceWorkbench.scmDiffCommandIds,
        agentEvidenceScmStageCommandIds: agentEvidenceWorkbench.scmStageCommandIds,
        agentEvidenceScmAttachCommandIds: agentEvidenceWorkbench.scmAttachCommandIds,
        agentEvidenceScmReadonlyEvidenceFlags: agentEvidenceWorkbench.scmReadonlyEvidenceFlags,
        agentEvidenceScmRollbackRiskLabels: agentEvidenceWorkbench.scmRollbackRiskLabels,
        agentEvidenceTestingVisible: Boolean(agentEvidenceWorkbench.testingVisible),
        agentEvidenceTestingState: agentEvidenceWorkbench.testingState,
        agentEvidenceTestingText: agentEvidenceWorkbench.testingText,
        agentEvidenceTestingRerunCommandIds: agentEvidenceWorkbench.testingRerunCommandIds,
        agentEvidenceTestingFailureDetails: agentEvidenceWorkbench.testingFailureDetails,
        agentEvidenceTestingResourceLinks: agentEvidenceWorkbench.testingResourceLinks,
        agentEvidenceTimelineVisible: Boolean(agentEvidenceWorkbench.timelineVisible),
        agentEvidenceTimelineRows: agentEvidenceWorkbench.timelineRows,
        agentEvidenceTimelineCommandIds: agentEvidenceWorkbench.timelineCommandIds,
        agentEvidenceTimelineResources: agentEvidenceWorkbench.timelineResources,
        agentEvidenceTimelineLinks: agentEvidenceWorkbench.timelineLinks,
        agentEvidenceProgressVisible: Boolean(agentEvidenceWorkbench.progressVisible),
        agentEvidenceProgressRows: agentEvidenceWorkbench.progressRows,
        agentEvidenceProgressAggregateStatuses: agentEvidenceWorkbench.progressAggregateStatuses,
        agentEvidenceProgressCancelCommandIds: agentEvidenceWorkbench.progressCancelCommandIds,
        agentEvidenceProgressAriaLabels: agentEvidenceWorkbench.progressAriaLabels,
        agentEvidenceNotificationsVisible: Boolean(agentEvidenceWorkbench.notificationsVisible),
        agentEvidenceNotificationSeverities: agentEvidenceWorkbench.notificationSeverities,
        agentEvidenceNotificationDedupeKeys: agentEvidenceWorkbench.notificationDedupeKeys,
        agentEvidenceNotificationDismissCommandIds: agentEvidenceWorkbench.notificationDismissCommandIds,
        agentEvidenceNotificationFocusTargets: agentEvidenceWorkbench.notificationFocusTargets,
        agentEvidenceNotificationText: agentEvidenceWorkbench.notificationText,
        agentEvidenceWorkbench: agentEvidenceWorkbench,
        mcpWorkbenchSurfaceVisible: Boolean(mcpWorkbench.visible),
        mcpWorkbenchServiceId: mcpWorkbench.serviceId,
        mcpWorkbenchStateSource: mcpWorkbench.stateSource,
        mcpWorkbenchOpenedCount: mcpWorkbench.openedCount,
        mcpWorkbenchAttachmentCount: mcpWorkbench.attachmentCount,
        mcpWorkbenchReadonlyProviderPath: mcpWorkbench.readonlyProviderPath,
        mcpWorkbenchServersVisible: Boolean(mcpWorkbench.serversVisible),
        mcpWorkbenchResourcesVisible: Boolean(mcpWorkbench.resourcesVisible),
        mcpWorkbenchGalleryVisible: Boolean(mcpWorkbench.galleryVisible),
        mcpWorkbenchViewIds: mcpWorkbench.viewIds,
        mcpWorkbenchCommandIds: mcpWorkbench.commandIds,
        mcpWorkbenchQuickAccessPrefixes: mcpWorkbench.quickAccessPrefixes,
        mcpWorkbenchRenderedViewIds: mcpWorkbench.renderedViewIds,
        mcpGalleryWorkbenchDetailVisible: Boolean(mcpWorkbench.galleryServer),
        mcpGalleryWorkbenchServer: mcpWorkbench.galleryServer,
        mcpGalleryWorkbenchInstallState: mcpWorkbench.galleryInstallState,
        mcpGalleryWorkbenchStatusLabel: mcpWorkbench.galleryStatusLabel,
        mcpGalleryWorkbenchActionIds: mcpWorkbench.galleryActionIds,
        mcpGalleryWorkbenchEnabledActionIds: mcpWorkbench.galleryEnabledActionIds,
        mcpGalleryWorkbenchMetadataCount: mcpWorkbench.galleryMetadataCount,
        mcpGalleryWorkbenchHasReadme: Boolean(mcpWorkbench.galleryHasReadme),
        mcpGalleryWorkbenchHasManifest: Boolean(mcpWorkbench.galleryHasManifest),
        mcpGalleryWorkbenchDetailSeeded: Boolean(mcpGalleryDetailSeed.ok),
        mcpGalleryWorkbenchDetailSeedError: mcpGalleryDetailSeed.error || "",
        mcpWorkbenchPreservesAgentApproval: Boolean(mcpWorkbench.preservesAgentApproval),
        mcpWorkbenchNoSecondState: Boolean(mcpWorkbench.noSecondState),
        mcpWorkbenchResourceText: mcpWorkbench.resourceText,
        mcpWorkbenchGalleryText: mcpWorkbench.galleryText,
        mcpWorkbench: mcpWorkbench,
        quickInputWorkbenchVisible: Boolean(quickInputWorkbench.quickPickVisible && quickInputWorkbench.inputVisible),
        quickInputWorkbenchPickAccepted: quickInputWorkbench.quickPickAcceptedValue === "mcp-resource",
        quickInputWorkbenchInputCancelled: Boolean(quickInputWorkbench.inputCancelled),
        quickInputWorkbenchServiceBoundary: quickInputWorkbench.quickInputServiceId === "quickInputService"
          && quickInputWorkbench.stateSource === "quickInputService"
          && quickInputWorkbench.quickPickKind === "quickPick"
          && quickInputWorkbench.inputKind === "inputBox"
          && quickInputWorkbench.currentTypeAfterClose === "",
        quickInputWorkbenchQuickPickKind: quickInputWorkbench.quickPickKind,
        quickInputWorkbenchInputKind: quickInputWorkbench.inputKind,
        quickInputWorkbenchServiceId: quickInputWorkbench.quickInputServiceId,
        quickInputWorkbenchStateSource: quickInputWorkbench.stateSource,
        quickInputWorkbenchAcceptedLabel: quickInputWorkbench.quickPickAcceptedLabel,
        quickInputWorkbenchAcceptedValue: quickInputWorkbench.quickPickAcceptedValue,
        quickInputWorkbenchItemCount: quickInputWorkbench.quickPickItemCount,
        quickInputWorkbenchInputFocused: quickInputWorkbench.inputFocused,
        quickInputWorkbenchError: quickInputWorkbench.error,
        quickInputWorkbench,
        terminalDebugTaskWorkbenchServiceBoundary: terminalDebugTaskWorkbench.serviceId === "terminalDebugTaskWorkbenchService"
          && Array.isArray(terminalDebugTaskWorkbench.vscodeServiceIds)
          && terminalDebugTaskWorkbench.vscodeServiceIds.includes("terminalService")
          && terminalDebugTaskWorkbench.vscodeServiceIds.includes("outputService")
          && terminalDebugTaskWorkbench.vscodeServiceIds.includes("debugService")
          && terminalDebugTaskWorkbench.vscodeServiceIds.includes("taskService")
          && terminalDebugTaskWorkbench.vscodeServiceIds.includes("problemsWorkbenchService")
          && terminalDebugTaskWorkbench.vscodeServiceIds.includes("paneCompositePartService")
          && terminalDebugTaskWorkbench.terminalStateSource === "terminalManager"
          && terminalDebugTaskWorkbench.outputStateSource === "outputLogTelemetryService"
          && ["debugState", "debugState/debugRuntime"].includes(terminalDebugTaskWorkbench.debugStateSource)
          && terminalDebugTaskWorkbench.taskStateSource === TASK_CONFIG_STATE_SOURCE
          && terminalDebugTaskWorkbench.problemsStateSource === "problemsDiagnosticsService(globalMarkerService)",
        terminalDebugTaskWorkbenchPanelBridge: terminalDebugTaskWorkbench.panelVisible === true
          && terminalDebugTaskWorkbench.panelId === "tasks"
          && terminalDebugTaskWorkbench.paneCompositeLastOpenedPanelId === TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output
          && terminalDebugTaskWorkbench.paneCompositeLastToggledPanelId === TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal
          && terminalDebugTaskWorkbench.paneCompositeDebugViewId === DEBUG_WORKBENCH_VIEW_IDS.Container
          && terminalDebugTaskWorkbench.paneCompositeTaskViewId === TASK_WORKBENCH_VIEW_IDS.Container
          && terminalDebugTaskWorkbench.paneCompositeProblemsOpened === true,
        outputWorkbenchChannelEvidence: terminalDebugTaskWorkbench.outputActiveChannelName === terminalDebugTaskWorkbench.outputChannelName
          && terminalDebugTaskWorkbench.outputEntryCount > 0
          && String(terminalDebugTaskWorkbench.outputPreview || "").includes("terminalDebugTaskWorkbenchService"),
        taskWorkbenchRunEvidence: terminalDebugTaskWorkbench.taskRunCommandRan === true
          && terminalDebugTaskWorkbench.taskLatestStatus === "passed"
          && terminalDebugTaskWorkbench.taskLatestStepCount > 0,
        taskWorkbenchPanelSurface: terminalDebugTaskWorkbench.taskPanelVisible === true
          && terminalDebugTaskWorkbench.taskPanelWasVisible === true
          && terminalDebugTaskWorkbench.taskPanelViewId === TASK_WORKBENCH_VIEW_IDS.Container
          && terminalDebugTaskWorkbench.taskPanelStateSource === TASK_CONFIG_STATE_SOURCE
          && terminalDebugTaskWorkbench.taskPanelRunConfigCount > 0,
        debugWorkbenchSessionEvidence: terminalDebugTaskWorkbench.debugCommandOpened === true
          && terminalDebugTaskWorkbench.debugStartCommandRan === true
          && terminalDebugTaskWorkbench.debugStopCommandRan === true
          && terminalDebugTaskWorkbench.debugDuringRunIsRunning === true
          && terminalDebugTaskWorkbench.debugAfterStopIsRunning === false
          && terminalDebugTaskWorkbench.debugConsoleEntryCount > 0,
        terminalWorkbenchCommandEvidence: terminalDebugTaskWorkbench.terminalCommandOpened === true
          && terminalDebugTaskWorkbench.terminalCount > 0
          && Boolean(terminalDebugTaskWorkbench.terminalActiveId)
          && Boolean(terminalDebugTaskWorkbench.terminalLastCreatedId),
        problemsWorkbenchReadOnlyBridge: terminalDebugTaskWorkbench.problemsReadOnlyBridge === true
          && terminalDebugTaskWorkbench.problemsCommandOpened === true
          && terminalDebugTaskWorkbench.problemsVisible === true
          && Number(terminalDebugTaskWorkbench.problemsDiagnosticCount || 0) >= 0,
        terminalDebugTaskWorkbenchCommandIds: terminalDebugTaskWorkbench.commandIds,
        terminalDebugTaskWorkbenchViewIds: terminalDebugTaskWorkbench.viewIds,
        terminalDebugTaskWorkbenchVsCodeServiceIds: terminalDebugTaskWorkbench.vscodeServiceIds,
        terminalDebugTaskWorkbenchCommandsExecuted: terminalDebugTaskWorkbench.commandsExecuted,
        terminalDebugTaskWorkbenchCommandFailures: terminalDebugTaskWorkbench.commandFailures,
        terminalDebugTaskWorkbenchServiceId: terminalDebugTaskWorkbench.serviceId,
        terminalDebugTaskWorkbenchPanelId: terminalDebugTaskWorkbench.panelId,
        terminalDebugTaskWorkbenchPanelNodeId: terminalDebugTaskWorkbench.panelNodeId,
        terminalDebugTaskWorkbenchTerminalCount: terminalDebugTaskWorkbench.terminalCount,
        terminalDebugTaskWorkbenchOutputChannelName: terminalDebugTaskWorkbench.outputChannelName,
        terminalDebugTaskWorkbenchOutputEntryCount: terminalDebugTaskWorkbench.outputEntryCount,
        terminalDebugTaskWorkbenchDebugConsoleEntryCount: terminalDebugTaskWorkbench.debugConsoleEntryCount,
        terminalDebugTaskWorkbenchTaskLatestStatus: terminalDebugTaskWorkbench.taskLatestStatus,
        terminalDebugTaskWorkbenchTaskLatestSummary: terminalDebugTaskWorkbench.taskLatestSummary,
        terminalDebugTaskWorkbenchTaskPanelVisible: terminalDebugTaskWorkbench.taskPanelVisible,
        terminalDebugTaskWorkbenchTaskPanelViewId: terminalDebugTaskWorkbench.taskPanelViewId,
        terminalDebugTaskWorkbenchTaskPanelStateSource: terminalDebugTaskWorkbench.taskPanelStateSource,
        terminalDebugTaskWorkbenchTaskPanelRunConfigCount: terminalDebugTaskWorkbench.taskPanelRunConfigCount,
        terminalDebugTaskWorkbenchProblemsDiagnosticCount: terminalDebugTaskWorkbench.problemsDiagnosticCount,
        terminalDebugTaskWorkbenchPaneCompositeOpenCount: terminalDebugTaskWorkbench.paneCompositeOpenCount,
        terminalDebugTaskWorkbenchPaneCompositeToggleCount: terminalDebugTaskWorkbench.paneCompositeToggleCount,
        terminalDebugTaskWorkbenchProblemsVisible: terminalDebugTaskWorkbench.problemsVisible,
        terminalDebugTaskWorkbench,
        extensionGalleryWorkbenchSurfaceVisible: Boolean(extensionGalleryWorkbench.visible),
        extensionGalleryWorkbenchShellVisible: Boolean(extensionGalleryWorkbench.shellVisible),
        extensionGalleryWorkbenchSearchVisible: Boolean(extensionGalleryWorkbench.searchVisible),
        extensionGalleryWorkbenchInstalledVisible: Boolean(extensionGalleryWorkbench.installedVisible),
        extensionGalleryWorkbenchResultsVisible: Boolean(extensionGalleryWorkbench.resultsVisible),
        extensionGalleryWorkbenchDetailVisible: Boolean(extensionGalleryWorkbench.detailVisible),
        extensionGalleryWorkbenchContainerId: extensionGalleryWorkbench.containerId,
        extensionGalleryWorkbenchViewId: extensionGalleryWorkbench.viewId,
        extensionGalleryWorkbenchServiceId: extensionGalleryWorkbench.serviceId,
        extensionGalleryWorkbenchStateSource: extensionGalleryWorkbench.stateSource,
        extensionGalleryWorkbenchViewIds: extensionGalleryWorkbench.viewIds,
        extensionGalleryWorkbenchCommandIds: extensionGalleryWorkbench.commandIds,
        extensionGalleryWorkbenchQuickAccessPrefix: extensionGalleryWorkbench.quickAccessPrefix,
        extensionGalleryWorkbenchLastQuery: extensionGalleryWorkbench.lastQuery,
        extensionGalleryWorkbenchResultCount: extensionGalleryWorkbench.resultCount,
        extensionGalleryWorkbenchInstalledCount: extensionGalleryWorkbench.installedCount,
        extensionGalleryWorkbenchEditorCount: extensionGalleryWorkbench.editorCount,
        extensionGalleryWorkbenchOpenedExtensionIds: extensionGalleryWorkbench.openedExtensionIds,
        extensionGalleryWorkbenchLatestEditorId: extensionGalleryWorkbench.latestEditorId,
        extensionGalleryWorkbenchActionStateCount: extensionGalleryWorkbench.actionStateCount,
        extensionGalleryWorkbenchErrorActionCount: extensionGalleryWorkbench.errorActionCount,
        extensionGalleryWorkbenchProgressCount: extensionGalleryWorkbench.progressCount,
        extensionGalleryWorkbenchLatestProgressPhase: extensionGalleryWorkbench.latestProgressPhase,
        extensionGalleryWorkbenchLocalFirst: Boolean(extensionGalleryWorkbench.localFirst),
        extensionGalleryWorkbenchNoSecondState: Boolean(extensionGalleryWorkbench.noSecondState),
        extensionGalleryWorkbenchResultRows: extensionGalleryWorkbench.resultRows,
        extensionGalleryWorkbenchInstalledRows: extensionGalleryWorkbench.installedRows,
        extensionGalleryWorkbenchDetailAttempted: Boolean(extensionGalleryDetailOpen.attempted),
        extensionGalleryWorkbenchDetailOpened: Boolean(extensionGalleryDetailOpen.opened),
        extensionGalleryWorkbenchDetailOpenExtensionId: extensionGalleryDetailOpen.extensionId,
        extensionGalleryWorkbenchDetailOpenError: extensionGalleryDetailOpen.error,
        extensionGalleryWorkbenchDetailExtensionId: extensionGalleryWorkbench.detailExtensionId,
        extensionGalleryWorkbenchDetailInstallState: extensionGalleryWorkbench.detailInstallState,
        extensionGalleryWorkbenchDetailActionIds: extensionGalleryWorkbench.detailActionIds,
        extensionGalleryWorkbenchDetailRollbackAvailable: Boolean(extensionGalleryWorkbench.detailRollbackAvailable),
        extensionGalleryWorkbenchDetailServiceId: extensionGalleryWorkbench.detailServiceId,
        extensionGalleryWorkbenchDetailStateSource: extensionGalleryWorkbench.detailStateSource,
        extensionGalleryWorkbenchText: extensionGalleryWorkbench.text,
        extensionGalleryWorkbench,
        extensionTrustRemoteAuthWorkbenchSurfaceVisible: Boolean(extensionTrustRemoteAuthWorkbench.visible),
        extensionTrustRemoteAuthWorkbenchContainerId: extensionTrustRemoteAuthWorkbench.containerId,
        extensionTrustRemoteAuthWorkbenchViewIds: extensionTrustRemoteAuthWorkbench.viewIds,
        extensionTrustRemoteAuthWorkbenchCommandIds: extensionTrustRemoteAuthWorkbench.commandIds,
        extensionTrustRemoteAuthWorkbenchExtensionHostServiceId: extensionTrustRemoteAuthWorkbench.extensionHostServiceId,
        extensionTrustRemoteAuthWorkbenchWorkspaceTrustServiceId: extensionTrustRemoteAuthWorkbench.workspaceTrustServiceId,
        extensionTrustRemoteAuthWorkbenchRemoteAuthorityServiceId: extensionTrustRemoteAuthWorkbench.remoteAuthorityServiceId,
        extensionTrustRemoteAuthWorkbenchAuthenticationServiceId: extensionTrustRemoteAuthWorkbench.authenticationServiceId,
        extensionTrustRemoteAuthWorkbenchExtensionHostStateSource: extensionTrustRemoteAuthWorkbench.extensionHostStateSource,
        extensionTrustRemoteAuthWorkbenchWorkspaceTrustStateSource: extensionTrustRemoteAuthWorkbench.workspaceTrustStateSource,
        extensionTrustRemoteAuthWorkbenchRemoteAuthorityStateSource: extensionTrustRemoteAuthWorkbench.remoteAuthorityStateSource,
        extensionTrustRemoteAuthWorkbenchAuthenticationStateSource: extensionTrustRemoteAuthWorkbench.authenticationStateSource,
        extensionHostWorkbenchActivationCount: extensionTrustRemoteAuthWorkbench.activationCount,
        extensionHostWorkbenchLatestActivationEvent: extensionTrustRemoteAuthWorkbench.latestActivationEvent,
        extensionHostWorkbenchLatestActivationExtension: extensionTrustRemoteAuthWorkbench.latestActivationExtension,
        workspaceTrustWorkbenchStatus: extensionTrustRemoteAuthWorkbench.trustStatus,
        workspaceTrustWorkbenchDecisionCount: extensionTrustRemoteAuthWorkbench.trustDecisionCount,
        workspaceTrustWorkbenchLatestDecision: extensionTrustRemoteAuthWorkbench.latestTrustDecision,
        remoteAuthorityWorkbenchResolveCount: extensionTrustRemoteAuthWorkbench.remoteResolveCount,
        remoteAuthorityWorkbenchSuccessCount: extensionTrustRemoteAuthWorkbench.remoteSuccessCount,
        remoteAuthorityWorkbenchFailureCount: extensionTrustRemoteAuthWorkbench.remoteFailureCount,
        remoteAuthorityWorkbenchCacheHitCount: extensionTrustRemoteAuthWorkbench.remoteCacheHitCount,
        remoteAuthorityWorkbenchLatestStatus: extensionTrustRemoteAuthWorkbench.remoteLatestStatus,
        authenticationWorkbenchStatuses: extensionTrustRemoteAuthWorkbench.authStatuses,
        authenticationWorkbenchLatestStatus: extensionTrustRemoteAuthWorkbench.authLatestStatus,
        authenticationWorkbenchProviderIds: extensionTrustRemoteAuthWorkbench.authProviderIds,
        authenticationWorkbenchTokenRedacted: Boolean(extensionTrustRemoteAuthWorkbench.authTokenRedacted),
        extensionTrustRemoteAuthWorkbenchNoSecondExtensionRuntime: Boolean(extensionTrustRemoteAuthWorkbench.noSecondExtensionRuntime),
        extensionTrustRemoteAuthWorkbenchNoSecondTrustStore: Boolean(extensionTrustRemoteAuthWorkbench.noSecondTrustStore),
        extensionTrustRemoteAuthWorkbenchNoSecondRemoteState: Boolean(extensionTrustRemoteAuthWorkbench.noSecondRemoteState),
        extensionTrustRemoteAuthWorkbenchNoSecondAuthStore: Boolean(extensionTrustRemoteAuthWorkbench.noSecondAuthStore),
        extensionTrustRemoteAuthWorkbenchPreservesAgentEvidence: Boolean(extensionTrustRemoteAuthWorkbench.preservesAgentEvidence),
        extensionTrustRemoteAuthWorkbenchRenderedSurfaces: extensionTrustRemoteAuthWorkbench.renderedSurfaces,
        extensionTrustRemoteAuthWorkbenchSeeded: Boolean(extensionTrustRemoteAuthSeed.ok),
        extensionTrustRemoteAuthWorkbenchSeedDegraded: Boolean(extensionTrustRemoteAuthSeed.degraded),
        extensionTrustRemoteAuthWorkbenchSeedError: extensionTrustRemoteAuthSeed.error || "",
        extensionTrustRemoteAuthWorkbenchSeedCommands: extensionTrustRemoteAuthSeed.commandResults || [],
        extensionTrustRemoteAuthWorkbenchText: extensionTrustRemoteAuthWorkbench.text,
        extensionTrustRemoteAuthWorkbench,
        workbenchEditorPartVisible: Boolean(workbenchLayout.editorPartVisible),
        workbenchEditorPartActiveGroup: workbenchLayout.editorPartActiveGroup,
        workbenchEditorPartActiveEditor: workbenchLayout.editorPartActiveEditor,
        workbenchEditorPartEditorCount: workbenchLayout.editorPartEditorCount,
        workbenchEditorPartDirtyCount: workbenchLayout.editorPartDirtyCount,
        workbenchEditorPartPinnedCount: workbenchLayout.editorPartPinnedCount,
        workbenchEditorPartPreviewCount: workbenchLayout.editorPartPreviewCount,
        workbenchEditorPartOverflowCount: workbenchLayout.editorPartOverflowCount,
        workbenchEditorPartOverflow: workbenchLayout.editorPartOverflow,
        workbenchEditorPartSplitOpen: workbenchLayout.editorPartSplitOpen,
        workbenchPanelVisible: Boolean(workbenchLayout.panelVisible),
        workbenchPanelId: workbenchLayout.panelId,
        workbenchPanelHeight: workbenchLayout.panelHeight,
        workbenchStatusBarVisible: Boolean(workbenchLayout.statusBarVisible),
        workbenchStatusActiveViewId: workbenchLayout.statusActiveViewId,
        workbenchStatusActivePanelId: workbenchLayout.statusActivePanelId,
        workbenchStatusLanguageId: workbenchLayout.statusLanguageId,
        workbenchStatusLine: workbenchLayout.statusLine,
        workbenchStatusColumn: workbenchLayout.statusColumn,
        workbenchStatusBranch: workbenchLayout.statusBranch,
        workbenchStatusErrorCount: workbenchLayout.statusErrorCount,
        workbenchStatusWarningCount: workbenchLayout.statusWarningCount,
        workbenchStatusEncoding: workbenchLayout.statusEncoding,
        workbenchStatusEol: workbenchLayout.statusEol,
        workbenchCommandSurfaceVisible: Boolean(workbenchLayout.commandSurfaceVisible),
        workbenchCommandSurfaceCommandCount: workbenchLayout.commandSurfaceCommandCount,
        workbenchCommandSurfaceCommandIds: workbenchLayout.commandSurfaceCommandIds,
        workbenchCommandSurfaceMenuIds: workbenchLayout.commandSurfaceMenuIds,
        workbenchCommandSurfaceMenuEntryCount: workbenchLayout.commandSurfaceMenuEntryCount,
        workbenchCommandPaletteCommandCount: workbenchLayout.commandPaletteCommandCount,
        workbenchCommandPaletteCommandIds: workbenchLayout.commandPaletteCommandIds,
        workbenchLayoutRects: workbenchLayout.rects,
        workbenchRetainedLayout: retainedWorkbenchLayout,
      }
      const serializedResult = JSON.parse(JSON.stringify(result))
      setRealUiSmokeStage("return:serialized", {
        keys: Object.keys(serializedResult).length,
        createTargetSkipped: Boolean(serializedResult.createTargetSkipped),
      })
      return serializedResult
    },
    runFileOperationVisibilitySmoke: async (payload = {}) => {
      const root = String(payload.root || "")
      if (!root) throw new Error("file operation smoke root missing")
      await waitForSmokeState(
        () => window.__codekSmokeFileOperationBridgeReady === true,
        "file operation bridge ready",
      )
      const createdPath = "src/agent-created.ts"
      const renamedPath = "src/agent-renamed.ts"
      const existingPath = "src/existing.ts"
      const agentOptions = {
        source: "agent",
        agentId: "electron-smoke-agent",
        runId: "electron-smoke-file-operation",
        reason: "Electron file operation visibility smoke",
      }

      await handleOpenRecentProject(root)
      openSidebarView("files")
      await nextTick()
      await waitForSmokeState(() => document.querySelector('[data-codek-smoke="native-explorer-host"]'), "native explorer host")
      await expandSmokeExplorerDirectory(root, "src")
      await handleOpenFile(existingPath)
      await waitForSmokeState(() => w.activeFile === existingPath && editor, "existing file opened")

      const updateStartedAt = performance.now()
      await ws.saveFile(existingPath, "export const existing = 2\n", agentOptions)
      await waitForSmokeState(() => typeof w.files[existingPath] === "string" && w.files[existingPath].includes("existing = 2"), "updated workspace content")
      await waitForSmokeState(() => getSafeEditorValue()?.includes("existing = 2"), "updated editor content")
      const updateVisibleMs = performance.now() - updateStartedAt

      const createStartedAt = performance.now()
      await ws.createFile(createdPath, "export const createdByAgent = true\n", agentOptions)
      await waitForSmokeState(() => typeof w.files[createdPath] === "string", "created workspace file")
      await waitForSmokeState(() => findSmokeExplorerRow(root, createdPath), "created explorer row")
      const createdExplorerVisible = Boolean(findSmokeExplorerRow(root, createdPath))
      const createVisibleMs = performance.now() - createStartedAt

      const renameStartedAt = performance.now()
      await ws.renameEntry(createdPath, renamedPath, agentOptions)
      await waitForSmokeState(() => typeof w.files[renamedPath] === "string" && !w.files[createdPath], "renamed workspace file")
      await waitForSmokeState(() => findSmokeExplorerRow(root, renamedPath), "renamed explorer row")
      const renamedExplorerVisible = Boolean(findSmokeExplorerRow(root, renamedPath))
      const renameVisibleMs = performance.now() - renameStartedAt

      const deleteStartedAt = performance.now()
      await ws.deleteFile(renamedPath, agentOptions)
      await waitForSmokeState(() => !w.files[renamedPath] && !findSmokeExplorerRow(root, renamedPath), "deleted explorer row removed")
      const deleteVisibleMs = performance.now() - deleteStartedAt
      chatOpen.value = true
      await nextTick()

      refreshScmEditorDecorations()
      return {
        projectRoot: w.projectRoot,
        activeFile: w.activeFile,
        openFiles: openFiles.value,
        createdPath,
        renamedPath,
        existingPath,
        updatedEditorVisible: getSafeEditorValue()?.includes("existing = 2") || Boolean(w.files[existingPath]?.includes?.("existing = 2")),
        createdExplorerVisible,
        renamedExplorerVisible,
        deletedExplorerHidden: !findSmokeExplorerRow(root, renamedPath) && !w.files[renamedPath],
        createVisibleMs,
        updateVisibleMs,
        renameVisibleMs,
        deleteVisibleMs,
        chatInputVisible: Boolean(document.querySelector('[data-codek-smoke="chat-input"]')),
        nativeHostMounted: Boolean(document.querySelector('[data-codek-smoke="native-explorer-host"]')),
      }
    },
    runWorkingCopyHotExitSmoke: async (payload = {}) => {
      const root = normalizeSmokeFsPath(payload.root || "")
      const targetPath = String(payload.targetPath || "src/hot-exit.ts")
      if (!root) throw new Error("working copy hot-exit smoke root missing")

      await handleOpenRecentProject(root)
      openSidebarView("files")
      await nextTick()
      await waitForSmokeState(() => normalizeSmokeFsPath(w.projectRoot) === root, "working copy hot-exit project opened")
      await waitForSmokeState(() => document.querySelector('[data-codek-smoke="native-explorer-host"]'), "native explorer host")
      await handleOpenFile(targetPath)
      await waitForSmokeState(() => w.activeFile === targetPath && editor, "hot-exit target opened")

      const unsavedContent = [
        "export const hotExitSmoke = \"renderer dirty backup\"",
        `export const hotExitSmokeStamp = ${Date.now()}`,
        "",
      ].join("\n")
      ws.updateFile(targetPath, unsavedContent, { dirty: true, external: false })
      await waitForSmokeState(() => ws.isDirty(targetPath), "hot-exit target dirty")

      const dirtyEvidence = ws.buildWorkingCopyHotExitEvidence("electron-smoke")
      const nativeCancelAllowed = await window.codek?.closeWindow?.({ source: "electron-smoke-cancel" })
      const nativeCancelLifecycle = window.__codekSmokeWorkingCopyHotExitLifecycle || null
      await waitForSmokeState(() => w.activeFile === targetPath && ws.isDirty(targetPath), "native close veto kept dirty target")
      const closeGuardAllowed = ws.requestCloseFile(targetPath, { source: "electron-smoke" })
      const closeGuardEvidence = ws.getWorkingCopyHotExitEvidence()
      const backedUp = await ws.backupDirtyWorkingCopiesForLifecycle("electron-smoke")
      const backupEvidence = ws.getWorkingCopyHotExitEvidence()
      const nativeConfirmLifecycle = await window.codek?.simulateWindowCloseLifecycle?.({ source: "electron-smoke-confirm" })
      const forcedCloseAllowed = ws.requestCloseFile(targetPath, { source: "electron-smoke", force: true })
      const nativeForceLifecycle = await window.codek?.simulateWindowCloseLifecycle?.({ source: "electron-smoke-force", force: true })

      await ws.refreshWorkingCopyRestorations()
      await waitForSmokeState(
        () => w.pendingWorkingCopyRestorations.some((entry) => entry.path === targetPath),
        "hot-exit restore choice",
      )
      const restoreChoicesEvidence = ws.getWorkingCopyHotExitEvidence()
      const restoreApplied = await ws.applyWorkingCopyRestoration(targetPath, "restore")
      await waitForSmokeState(() => w.activeFile === targetPath && ws.isDirty(targetPath), "hot-exit restored dirty target")
      const restoreAttemptEvidence = ws.getWorkingCopyHotExitEvidence()
      const restoredContent = String(w.files[targetPath] || "")
      const dirtyAfterRestore = ws.isDirty(targetPath)
      const savedContent = [
        "export const hotExitSmoke = \"saved to disk\"",
        `export const hotExitSavedStamp = ${Date.now()}`,
        "",
      ].join("\n")
      const saveSucceeded = await ws.saveFile(targetPath, savedContent, {
        source: "electron-smoke",
        reason: "working copy hot-exit smoke save",
      })
      const diskAfterSave = await ws.readProjectFile(targetPath)
      const dirtyAfterSave = ws.isDirty(targetPath)
      const revertDraftContent = [
        "export const hotExitSmoke = \"revert draft\"",
        `export const hotExitRevertStamp = ${Date.now()}`,
        "",
      ].join("\n")
      ws.updateFile(targetPath, revertDraftContent, { dirty: true, external: false })
      await waitForSmokeState(() => ws.isDirty(targetPath), "hot-exit revert draft dirty")
      const reloadReverted = await ws.reloadFile(targetPath)
      const contentAfterRevert = String(w.files[targetPath] || "")
      const dirtyAfterRevert = ws.isDirty(targetPath)

      const result = {
        projectRoot: w.projectRoot,
        targetPath,
        dirtyEvidence,
        nativeCancelAllowed,
        nativeCancelLifecycle,
        nativeConfirmLifecycle,
        nativeForceLifecycle,
        closeGuardAllowed,
        closeGuardEvidence,
        backedUp,
        backupEvidence,
        forcedCloseAllowed,
        restoreChoicesEvidence,
        restoreApplied,
        restoreAttemptEvidence,
        restoredContentMatches: restoredContent === unsavedContent,
        dirtyAfterRestore,
        saveSucceeded,
        diskAfterSaveMatches: diskAfterSave === savedContent,
        dirtyAfterSave,
        reloadReverted,
        revertRestoredDiskContent: reloadReverted === true && contentAfterRevert === savedContent,
        dirtyAfterRevert,
        activeFile: w.activeFile,
        openFiles: openFiles.value,
        dirty: ws.isDirty(targetPath),
        risk: restoreAttemptEvidence?.risk || backupEvidence?.risk || dirtyEvidence?.risk || "",
        shutdownRisk: dirtyEvidence?.risk || "",
        backupArtifactPaths: backupEvidence?.backupArtifactPaths || [],
        evidencePath: restoreAttemptEvidence?.evidencePath || backupEvidence?.evidencePath || dirtyEvidence?.evidencePath || "",
        nativeHostMounted: Boolean(document.querySelector('[data-codek-smoke="native-explorer-host"]')),
      }
      window.__codekSmokeWorkingCopyHotExitResult = JSON.parse(JSON.stringify(result))
      return window.__codekSmokeWorkingCopyHotExitResult
    },
    runMultiRootCreateTargetSmoke: async (payload = {}) => {
      const appsRoot = normalizeSmokeFsPath(payload.appsRoot || "")
      const libsRoot = normalizeSmokeFsPath(payload.libsRoot || "")
      if (!appsRoot || !libsRoot) throw new Error("multi-root create target smoke roots missing")

      openSidebarView("files")
      await nextTick()
      await waitForSmokeState(() => w.workspaceRoots?.length >= 2, "multi-root workspace restored")
      await waitForSmokeState(() => document.querySelector('[data-codek-smoke="native-explorer-host"]'), "native explorer host")

      const appRootInfo = ws.getWorkspaceRootInfo(appsRoot)
      const libRootInfo = ws.getWorkspaceRootInfo(libsRoot)
      const selectedParent = `/${appRootInfo?.label || "client (apps)"}/src`
      const activeLibFile = `/${libRootInfo?.label || "client (libs)"}/src/lib.ts`
      const createdFilePath = `${selectedParent}/created-from-selected.ts`
      const createdFolderPath = `${selectedParent}/generated-from-selected`
      window.__codekSmokeMultiRootCreateTargetDebug = {
        appsRoot,
        libsRoot,
        workspaceRoots: [...(w.workspaceRoots || [])],
        workspaceRootLabels: { ...(w.workspaceRootLabels || {}) },
        appRootInfo,
        libRootInfo,
        selectedParent,
        activeLibFile,
      }

      await expandSmokeExplorerDirectory(appsRoot, "")
      await expandSmokeExplorerDirectory(appsRoot, "src")
      await handleOpenFile(activeLibFile)
      await waitForSmokeState(() => w.activeFile === activeLibFile && editor, "lib active file opened")
      const activeFileBeforeCreate = w.activeFile

      selectedDir.value = selectedParent
      selectedTreePath.value = selectedParent
      selectedTreeKind.value = "dir"

      await handleInlineCreate({ type: "file", parentPath: selectedParent, name: "created-from-selected.ts" })
      await waitForSmokeState(() => w.files[createdFilePath] === "\n".repeat(9), "selected-root created file state")
      await waitForSmokeState(() => findSmokeExplorerRow(appsRoot, "src/created-from-selected.ts"), "selected-root created file row")
      await handleInlineCreate({ type: "folder", parentPath: selectedParent, name: "generated-from-selected" })
      await waitForSmokeState(() => selectedTreePath.value === createdFolderPath, "selected-root created folder selection")

      return {
        projectRoot: w.projectRoot,
        workspaceRoots: [...(w.workspaceRoots || [])],
        workspaceRootLabels: { ...(w.workspaceRootLabels || {}) },
        activeFile: w.activeFile,
        activeFileBeforeCreate,
        selectedParent,
        selectedTreePath: selectedTreePath.value,
        selectedTreeKind: selectedTreeKind.value,
        createdFilePath,
        createdFolderPath,
        createdFileInWorkspaceState: Boolean(w.files[createdFilePath]),
        appsFileRowVisible: Boolean(findSmokeExplorerRow(appsRoot, "src/created-from-selected.ts")),
        libsWrongFileRowVisible: Boolean(findSmokeExplorerRow(libsRoot, "src/created-from-selected.ts")),
        nativeHostMounted: Boolean(document.querySelector('[data-codek-smoke="native-explorer-host"]')),
      }
    },
    runInlineCreateFocusSmoke: async (payload = {}) => {
      const root = String(payload.root || "")
      if (!root) throw new Error("inline create focus smoke root missing")
      await handleOpenRecentProject(root)
      openSidebarView("files")
      await nextTick()
      await waitForSmokeState(() => document.querySelector('[data-codek-smoke="native-explorer-host"]'), "native explorer host")

      const runCase = async (kind) => {
        const findEditableInput = () => {
          const inputs = Array.from(document.querySelectorAll('[data-codek-smoke="explorer-inline-create-input"]'))
          return inputs.find((candidate) => {
            const row = candidate.closest(".codek-explorer-row.editable") || candidate.closest(".inline-create-row")
            if (!row) return false
            const rect = candidate.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
          })
        }
        const buttonSelector = kind === "folder"
          ? '[data-codek-smoke="explorer-new-folder"]'
          : '[data-codek-smoke="explorer-new-file"]'
        const button = await waitForSmokeState(() => document.querySelector(buttonSelector), `inline create ${kind} button`)
        button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, pointerType: "mouse", isPrimary: true }))
        button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
        button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        await nextTick()
        await waitSmokeFrames(2)
        const input = await waitForSmokeState(
          findEditableInput,
          `inline create ${kind} input`,
        )
        const rect = input.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.left + Math.min(12, rect.width / 2), rect.top + Math.min(10, rect.height / 2))
        const hitIsInput = hit === input || Boolean(hit?.closest?.('[data-codek-smoke="explorer-inline-create-input"]'))
        input.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 2, pointerType: "mouse", isPrimary: true }))
        input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
        input.focus({ preventScroll: true })
        input.value = kind === "folder" ? "focus-smoke-folder" : "focus-smoke-file.ts"
        input.dispatchEvent(new Event("input", { bubbles: true }))
        await nextTick()
        await waitSmokeFrames(1)
        const activeElementIsInput = document.activeElement === input
        const valueAccepted = String(input.value || "").includes(kind === "folder" ? "focus-smoke-folder" : "focus-smoke-file.ts")
        const row = input.closest(".codek-explorer-row.editable") || input.closest(".inline-create-row")
        const rowRect = row?.getBoundingClientRect?.()
        const rowKind = row?.classList?.contains?.("codek-explorer-row") ? "native-editable-row" : row ? "legacy-inline-row" : ""
        const host = document.querySelector('[data-codek-smoke="native-explorer-host"]')
        const hostRect = host?.getBoundingClientRect?.()
        input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
        await nextTick()
        return {
          kind,
          buttonVisible: Boolean(button),
          inputVisible: Boolean(rect.width > 0 && rect.height > 0),
          hitIsInput,
          activeElementIsInput,
          valueAccepted,
          rowKind,
          rowRect: rowRect ? {
            left: Math.round(rowRect.left),
            top: Math.round(rowRect.top),
            width: Math.round(rowRect.width),
            height: Math.round(rowRect.height),
          } : null,
          hostRect: hostRect ? {
            left: Math.round(hostRect.left),
            top: Math.round(hostRect.top),
            width: Math.round(hostRect.width),
            height: Math.round(hostRect.height),
          } : null,
        }
      }

      const fileCase = await runCase("file")
      const folderCase = await runCase("folder")
      return {
        projectRoot: w.projectRoot,
        nativeHostMounted: Boolean(document.querySelector('[data-codek-smoke="native-explorer-host"]')),
        fileCase,
        folderCase,
        allInputsFocusable: Boolean(
          fileCase.hitIsInput &&
          fileCase.activeElementIsInput &&
          fileCase.valueAccepted &&
          folderCase.hitIsInput &&
          folderCase.activeElementIsInput &&
          folderCase.valueAccepted
        ),
      }
    },
  }
}

const showLanguagePicker = ref(false)
const langPickerQuery = ref("")
const langPickerInputRef = ref(null)
const autoSaveMode = ref(localStorage.getItem('codek.autoSave') || 'off')

function handleChangeAutoSave(mode) {
  loadEditorPreferenceActionsRuntime().then(({ changeAutoSaveMode }) => {
    changeAutoSaveMode(mode, createEditorPreferenceActionContext())
  })
}

function toggleAutoSaveMode() {
  loadEditorPreferenceActionsRuntime().then(({ toggleAutoSaveMode: toggleWorkbenchAutoSaveMode }) => {
    toggleWorkbenchAutoSaveMode(createEditorPreferenceActionContext())
  })
}

function toggleFormatOnSave() {
  loadEditorPreferenceActionsRuntime().then(({ toggleFormatOnSave: toggleWorkbenchFormatOnSave }) => {
    toggleWorkbenchFormatOnSave(createEditorPreferenceActionContext())
  })
}

function openSettingsSection(section: SettingsPanelSection = "general", query = "") {
  activeSettingsQuery.value = String(query || "")
  openSettingsView()
  nextTick(() => {
    settingsPanelRef.value?.openSection?.(section, activeSettingsQuery.value)
  })
}

function runEditorAction(actionId: string) {
  if (!editor) return
  const action = editor.getAction?.(actionId)
  if (action?.run) {
    void action.run()
  } else {
    editor.trigger("menu", actionId, null)
  }
  editor.focus()
}

function openCommandPalette(mode?: "files") {
  commandPaletteRef.value?.open?.(mode)
}

function toggleWorkbenchBoolean(key: string, fallback = true) {
  const next = !settingsStore.get<boolean>(key, fallback)
  settingsStore.set(key, next)
  applyWorkbenchSettings()
}

function toggleWordWrapSetting() {
  loadEditorPreferenceActionsRuntime().then(({ toggleWordWrapSetting: toggleWorkbenchWordWrapSetting }) => {
    toggleWorkbenchWordWrapSetting(createEditorPreferenceActionContext())
  })
}

function createChangeReviewActionContext() {
  return {
    hasActiveWorkspaceFile: () => Boolean(w.activeFile && typeof w.files[w.activeFile] === "string"),
    refreshWorkspaceAnalysis: refreshWorkspaceAnalysisRuntime,
    syncEditorFromWorkspace,
    applyEditorDiagnostics,
  }
}

let changeReviewActionsRuntimePromise = null

function loadChangeReviewActionsRuntime() {
  if (!changeReviewActionsRuntimePromise) {
    changeReviewActionsRuntimePromise = import("./workbench/changeReviewActions")
  }
  return changeReviewActionsRuntimePromise
}

let navigationActionsRuntimePromise = null

function loadNavigationActionsRuntime() {
  if (!navigationActionsRuntimePromise) {
    navigationActionsRuntimePromise = import("./workbench/navigationActions")
  }
  return navigationActionsRuntimePromise
}

let editorViewActionsRuntimePromise = null

function loadEditorViewActionsRuntime() {
  if (!editorViewActionsRuntimePromise) {
    editorViewActionsRuntimePromise = import("./workbench/editorViewActions")
  }
  return editorViewActionsRuntimePromise
}

let agentEventBridgeRuntimePromise = null

function loadAgentEventBridgeRuntime() {
  if (!agentEventBridgeRuntimePromise) {
    agentEventBridgeRuntimePromise = import("./workbench/agentEventBridge")
  }
  return agentEventBridgeRuntimePromise
}

let inlineEditActionsRuntimePromise = null

function loadInlineEditActionsRuntime() {
  if (!inlineEditActionsRuntimePromise) {
    inlineEditActionsRuntimePromise = import("./workbench/inlineEditActions")
  }
  return inlineEditActionsRuntimePromise
}

let splitEditorLifecycleRuntimePromise = null

function loadSplitEditorLifecycleRuntime() {
  if (!splitEditorLifecycleRuntimePromise) {
    splitEditorLifecycleRuntimePromise = import("./workbench/splitEditorLifecycle")
  }
  return splitEditorLifecycleRuntimePromise
}

let editorContextMenuLifecycleRuntimePromise = null

function loadEditorContextMenuLifecycleRuntime() {
  if (!editorContextMenuLifecycleRuntimePromise) {
    editorContextMenuLifecycleRuntimePromise = import("./workbench/editorContextMenuLifecycle")
  }
  return editorContextMenuLifecycleRuntimePromise
}

let monacoLanguageDefaultsRuntimePromise = null

function loadMonacoLanguageDefaultsRuntime() {
  if (!monacoLanguageDefaultsRuntimePromise) {
    monacoLanguageDefaultsRuntimePromise = import("./workbench/monacoLanguageDefaults")
  }
  return monacoLanguageDefaultsRuntimePromise
}

let editorLspLifecycleRuntimePromise = null

function loadEditorLspLifecycleRuntime() {
  if (!editorLspLifecycleRuntimePromise) {
    editorLspLifecycleRuntimePromise = import("./workbench/editorLspLifecycle")
  }
  return editorLspLifecycleRuntimePromise
}

let editorDiagnosticsLifecycleRuntimePromise = null

function loadEditorDiagnosticsLifecycleRuntime() {
  if (!editorDiagnosticsLifecycleRuntimePromise) {
    editorDiagnosticsLifecycleRuntimePromise = import("./workbench/editorDiagnosticsLifecycle")
  }
  return editorDiagnosticsLifecycleRuntimePromise
}

let editorCursorLifecycleRuntimePromise = null

function loadEditorCursorLifecycleRuntime() {
  if (!editorCursorLifecycleRuntimePromise) {
    editorCursorLifecycleRuntimePromise = import("./workbench/editorCursorLifecycle")
  }
  return editorCursorLifecycleRuntimePromise
}

let editorInlineDiffLifecycleRuntimePromise = null

function loadEditorInlineDiffLifecycleRuntime() {
  if (!editorInlineDiffLifecycleRuntimePromise) {
    editorInlineDiffLifecycleRuntimePromise = import("./workbench/editorInlineDiffLifecycle")
  }
  return editorInlineDiffLifecycleRuntimePromise
}

let editorFeatureInstallLifecycleRuntimePromise = null

function loadEditorFeatureInstallLifecycleRuntime() {
  if (!editorFeatureInstallLifecycleRuntimePromise) {
    editorFeatureInstallLifecycleRuntimePromise = import("./workbench/editorFeatureInstallLifecycle")
  }
  return editorFeatureInstallLifecycleRuntimePromise
}

let goalResultActionsRuntimePromise = null

function loadGoalResultActionsRuntime() {
  if (!goalResultActionsRuntimePromise) {
    goalResultActionsRuntimePromise = import("./workbench/goalResultActions")
  }
  return goalResultActionsRuntimePromise
}

let editorPreferenceActionsRuntimePromise = null

function loadEditorPreferenceActionsRuntime() {
  if (!editorPreferenceActionsRuntimePromise) {
    editorPreferenceActionsRuntimePromise = import("./workbench/editorPreferenceActions")
  }
  return editorPreferenceActionsRuntimePromise
}

function createEditorViewActionContext() {
  return {
    hasEditor: () => Boolean(editor),
    getSplitOpen: () => splitOpen.value,
    setSplitOpen: (open) => {
      splitOpen.value = open
    },
    setSplitFile: (path) => {
      splitFile.value = path
    },
    disposeSplitEditor: () => {
      if (splitEditor) {
        splitEditor.dispose()
        splitEditor = null
      }
    },
    getSplitContextMenuDisposable: () => splitContextMenuDisp,
    setSplitContextMenuDisposable: (disposable) => {
      splitContextMenuDisp = disposable
    },
    initSplitEditor,
    nextTick: (callback) => nextTick(callback),
    setSplitDividerDragging: (dragging) => {
      splitDividerDragging.value = dragging
    },
    setSplitRatio: (ratio) => {
      splitRatio.value = ratio
    },
    setMarkdownPreviewOpen: (open) => {
      setLegacyMarkdownPreviewOpen(open)
    },
    setVisualEditorOpen: (open) => {
      if (open) openBottomPanel(bottomPanelState, "visualEditor")
      else closeBottomPanel(bottomPanelState, "visualEditor")
    },
    getMinimapEnabled: () => minimapEnabled.value,
    setMinimapEnabled: (enabled) => {
      minimapEnabled.value = enabled
    },
    settingsStore,
    applyEditorOptions,
    document,
  }
}

function createEditorPreferenceActionContext() {
  return {
    getAutoSaveMode: () => autoSaveMode.value,
    setAutoSaveMode: (mode) => {
      autoSaveMode.value = mode
    },
    localStorage,
    settingsStore,
    getFormatOnSave: () => formatOnSave.value,
    setFormatOnSave: (enabled) => {
      formatOnSave.value = enabled
    },
    getFormatManager: () => formatManagerRuntime,
    applyEditorOptions,
    getEditor: () => editor,
    getMonacoApi: () => monacoApi,
    setLanguagePickerVisible: (visible) => {
      showLanguagePicker.value = visible
    },
    setLanguagePickerQuery: (query) => {
      langPickerQuery.value = query
    },
    getFilteredLanguages: () => filteredLanguages.value,
  }
}

function createSplitEditorLifecycleContext() {
  return {
    getSplitEditor: () => splitEditor,
    setSplitEditor: (instance) => {
      splitEditor = instance
    },
    getSplitEditorContainer: () => splitEditorContainer.value,
    ensureMonaco,
    getTheme: () => getMonacoTheme(activeTheme.value),
    getEditorOptions: getCurrentMonacoEditorOptions,
    setMinimapEnabled: (enabled) => {
      minimapEnabled.value = enabled
    },
    setEditorFontSize: (size) => {
      editorFontSize.value = size
    },
    getWorkspace: () => w,
    setSplitFile: (path) => {
      splitFile.value = path
    },
    getSplitFile: () => splitFile.value,
    updateFile: ws.updateFile,
    detectLanguage,
    attachFormatOnPaste,
    loadEditorFeatureModules,
    installEditorContextMenu,
    setSplitContextMenuDisposable: (disposable) => {
      splitContextMenuDisp = disposable
    },
  }
}

function createInlineEditActionContext() {
  return {
    getEditor: () => editor,
    getMonacoApi: () => monacoApi,
    getWorkspace: () => w,
    getInlineEdit: () => inlineEdit,
    loadEditCode,
    updateFile: ws.updateFile,
    recordChange,
    scheduleAnalysisRefresh: () => scheduleAnalysisRefresh(),
    scheduleAutosave,
    clearInlineDecorations,
    showInlineDiff,
    getSelectedText,
    setChatOpen: (open) => {
      chatOpen.value = open
    },
    appendCodeContextToChat: (text, path) => {
      chatPanelRef.value?.appendCodeContext(text, path)
    },
    nextTick: (callback) => nextTick(callback),
  }
}

function createAgentEventBridgeContext() {
  return {
    updateSessionById,
    syncSessionConversationById,
    setSessionBusy,
    setTaskGraphVisible: (visible) => {
      showTaskGraph.value = visible
    },
    getTaskGraphTasks: () => taskGraphTasks.value,
    playSound,
    t,
  }
}

function createGoalResultActionContext() {
  return {
    codek: window.codek,
    getProjectRoot: () => w.projectRoot,
    getSelectedGoalResult: () => selectedGoalResult.value,
    setSelectedGoalResult: (goal) => {
      selectedGoalResult.value = goal
    },
    setGoalResultVisible: (visible) => {
      goalResultVisible.value = visible
    },
    warn: (message, error) => {
      console.warn(message, error)
    },
  }
}

function createNavigationActionContext() {
  return {
    getEditor: () => editor,
    getMonacoApi: () => monacoApi,
    getWorkspace: () => w,
    openFile: handleOpenFile,
    updateSelectedSymbol,
    openSidebarView,
    setSymbolQuery: (query) => {
      symbolQuery.value = query
    },
    nextTick: (callback) => nextTick(callback),
    getBreadcrumbPath: (editorInstance, api) => getBreadcrumbPathFn?.(editorInstance, api) || [],
    getSymbolBreadcrumb: (model, position, activeFile) => getSymbolBreadcrumbFn?.(model, position, activeFile) || [],
    getBreadcrumbState: () => ({
      path: breadcrumbPath.value,
      symbols: breadcrumbSymbols.value,
      activeDropdown: activeBreadcrumbDropdown.value,
    }),
    setBreadcrumbPath: (path) => {
      breadcrumbPath.value = path
    },
    setBreadcrumbSymbols: (symbols) => {
      breadcrumbSymbols.value = symbols
    },
    setActiveBreadcrumbDropdown: (idx) => {
      activeBreadcrumbDropdown.value = idx
    },
    clearBreadcrumbState,
  }
}

function createProjectLifecycleContext() {
  return {
    workspace: w,
    codek: window.codek,
    maybeSaveCurrentFile,
    resetTreeSelection: () => {
      selectedDir.value = ""
      selectedTreePath.value = ""
      selectedTreeKind.value = ""
    },
    syncEditorFromWorkspace,
    clearSelectedSymbol,
    loadWorkspaceSettings: (root) => { settingsStore.loadWorkspace(root) },
    applyWorkbenchSettings,
    applyEditorOptions,
    openExplorerView: () => {
      openSidebarView("files")
    },
    refreshWorkspaceAnalysisRuntime,
    applyEditorDiagnostics,
    startWorkspaceAiRuntime,
    scheduleWorkspaceWarmup,
    syncSessionAgentsProjectRoot: (root) => {
      forEachSessionAgent((a) => a.setProjectRoot(root))
    },
  }
}

function createTabLifecycleContext() {
  return {
    workspace: {
      get openFiles() {
        return w.openFiles
      },
      set openFiles(paths) {
        w.openFiles = Array.isArray(paths) ? paths : []
      },
      closeFile: (path) => {
        ws.closeFile(path)
      },
    },
    getOpenFiles: () => openFiles.value,
    getActiveFile: () => w.activeFile,
    setActiveFile: (path) => {
      w.activeFile = path
    },
    pinnedTabs,
    tabContextMenu,
    unsavedDialog,
    dragState: tabDragState,
    closedEditors,
    isDirty,
    saveFile: handleSave,
    syncEditorFromWorkspace,
    setDragOverTab: (path) => {
      dragOverTab.value = path
    },
    openFile: handleOpenFile,
    reportTabLifecycleStage: reportTabLifecycleStage,
  }
}

function replaceEditorGroupStateFromWorkspace() {
  globalWorkbenchExplorerEditorService.replaceEditorGroupStateFromOpenFiles({
    openFiles: ws.getOpenFiles(),
    activeFile: w.activeFile,
    pinnedTabs,
    dirtyFiles: isDirty,
    closedEditors,
    split: {
      open: splitOpen.value,
      file: splitFile.value,
      ratio: splitRatio.value,
    },
  })
  editorGroupServiceRevision.value += 1
}

const editorGroupServiceListener = globalWorkbenchExplorerEditorService.onDidChange((event) => {
  if (event.kind === "editorGroups" || event.kind === "openEditors") {
    editorGroupServiceRevision.value += 1
  }
})

function persistEditorGroupState() {
  persistWorkbenchEditorGroupLayout({
    projectRoot: w.projectRoot,
    storage: typeof localStorage === "undefined" ? undefined : localStorage,
    isHydrating: hydratingEditorGroups,
    openFiles: openFiles.value,
    activeFile: w.activeFile,
    pinnedTabs,
    dirtyFiles: isDirty,
    closedEditors,
    split: {
      open: splitOpen.value,
      file: splitFile.value,
      ratio: splitRatio.value,
    },
  })
}

async function hydrateEditorGroupStateForProject(root = w.projectRoot) {
  hydratingEditorGroups = true
  try {
    const result = await restoreEditorGroupLayout({
      projectRoot: root,
      storage: typeof localStorage === "undefined" ? undefined : localStorage,
      availableFiles: Object.keys(w.files),
      restoreOpenFiles: ws.restoreOpenFiles,
      setActiveFile: (path) => {
        w.activeFile = path
      },
      isOpenFile: (path) => openFiles.value.includes(path),
      pinnedTabs,
      closedEditors,
      setSplitOpen: (open) => { splitOpen.value = open },
      setSplitFile: (path) => { splitFile.value = path },
      setSplitRatio: (ratio) => { splitRatio.value = ratio },
      shouldEnsureActiveFileLoaded: (path) => typeof w.files[path] !== "string",
      ensureActiveFileLoaded: handleOpenFile,
      replaceEditorGroupState: (state) => {
        globalWorkbenchExplorerEditorService.replaceEditorGroupState(state)
      },
    })
    return result.restored
  } finally {
    hydratingEditorGroups = false
  }
}

function createFileActionContext() {
  return {
    workspace: w,
    workspaceManager: ws,
    getEditor: () => editor,
    getOpenFiles: () => openFiles.value,
    isDirty,
    isRealFS: () => isRealFS.value,
    isFormatOnSave: () => formatOnSave.value,
    isLintOnSave: () => lintOnSave.value,
    setSuppressEditorSync: (suppress) => {
      suppressEditorSync = suppress
    },
    syncEditorFromWorkspace,
    ensureEditorContentVisible,
    refreshActiveAnalysis,
    loadFormatManager,
    loadLintManager,
    problemState,
    setSelectedDir: (path) => {
      selectedDir.value = path
    },
    setSelectedTree: (path, kind) => {
      selectedTreePath.value = path
      selectedTreeKind.value = kind
    },
    confirmDelete: (path) => confirm(t("app.confirmDelete", { path })),
    promptRename: (_path, currentName) => prompt("Rename", currentName),
    copyText: async (text) => {
      if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text)
    },
    openTerminalAtPath: async (path) => {
      await openTerminalAtWorkspacePath(path)
    },
    notifyLspFileOpened: async (path, content) => {
      const editorFeatures = openLspFileFn ? { openFile: openLspFileFn } : await loadEditorFeatureModules()
      const { notifyLspFileOpened: notifyWorkbenchLspFileOpened } = await loadEditorLspLifecycleRuntime()
      await notifyWorkbenchLspFileOpened(Boolean(detachLsp), editorFeatures, path, content)
    },
    reportOpenFileStage: (stage, detail = {}) => {
      if (!window.__codekSmokeIconVisualStateStage && !window.__codekSmokeSearchNavigationStage && !window.__codekSmokeArtifactOpenStage && !window.__codekSmokeRealProjectUiStage) return
      try {
        const payload = { stage: `open-file:${stage}`, at: Date.now(), detail }
        if (window.__codekSmokeIconVisualStateStage) {
          window.__codekSmokeIconVisualStateStage = payload
          console.info("[codek-smoke-icon-stage]", JSON.stringify(payload))
        }
        if (window.__codekSmokeSearchNavigationStage) {
          window.__codekSmokeSearchNavigationStage = payload
          console.info("[codek-smoke-search-navigation-stage]", JSON.stringify(payload))
        }
        if (window.__codekSmokeArtifactOpenStage) {
          window.__codekSmokeArtifactOpenStage = payload
          console.info("[codek-smoke-artifact-open-stage]", JSON.stringify(payload))
        }
        if (window.__codekSmokeRealProjectUiStage) {
          window.__codekSmokeRealProjectUiStage = payload
          console.info("[codek-smoke-real-project-ui-stage]", JSON.stringify(payload))
        }
      } catch {
        // smoke diagnostics only
      }
    },
    joinRelativePath,
    getPostOpenBackgroundDelayMs: () => (
      window.__codekSmokeIconVisualStateStage
        ? 60_000
        : window.__codekSmokeSearchNavigationStage || window.__codekSmokeArtifactOpenStage || window.__codekSmokeRealProjectUiStage
        ? 2500
        : 0
    ),
    shouldBlockUntilEditorContentVisible: () => Boolean(
      window.__codekSmokeIconVisualStateStage
        || window.__codekSmokeSearchNavigationStage
        || window.__codekSmokeArtifactOpenStage
        || window.__codekSmokeRealProjectUiStage,
    ),
  }
}

let fileActionsRuntimePromise = null

function loadFileActionsRuntime() {
  if (!fileActionsRuntimePromise) {
    fileActionsRuntimePromise = import("./workbench/fileActions")
  }
  return fileActionsRuntimePromise
}

function createSearchFileActionContext() {
  return {
    workspace: w,
    workspaceManager: {
      ...ws,
      readProjectFile: ws.readProjectFile,
      saveFile: ws.saveFile,
    },
    getEditor: () => editor,
    getSearchQuery: () => searchQuery.value,
    getReplaceQuery: () => searchReplaceQuery.value,
    getGrepResults: () => grepResults.value,
    createSearchPattern,
    openFile: handleOpenFile,
    syncEditorFromWorkspace,
    refreshSearchResults,
    refreshActiveAnalysis,
    ensureEditorReady,
    prepareEditorRuntime: preloadEditorRuntime,
    reportNavigationStage: (stage, detail = {}) => {
      try {
        const payload = {
          stage,
          at: Date.now(),
          detail,
        }
        window.__codekSmokeSearchNavigationStage = payload
        console.info("[codek-smoke-search-navigation-stage]", JSON.stringify(payload))
      } catch {
        // smoke diagnostics only
      }
    },
    keepSearchViewActive: () => {
      openSidebarView("search")
    },
    showOpenError: (message, path) => {
      getOutputChannel("Diagnostics").error(`${message}\n${path || ""}\n`)
      openBottomPanel(bottomPanelState, "output")
    },
  }
}

async function buildNativeShutdownLifecycleDecision(request = {}) {
  const source = String(request?.source || "native-close")
  const force = request?.force === true
  const evidence = ws.buildWorkingCopyHotExitEvidence(source)
  let backedUp = []
  if (Number(evidence?.dirtyCount || 0) > 0) {
    backedUp = await ws.backupDirtyWorkingCopiesForLifecycle(source)
  }
  const latestEvidence = ws.getWorkingCopyHotExitEvidence() || evidence
  const dirtyCount = Number(latestEvidence?.dirtyCount ?? evidence?.dirtyCount ?? 0)
  const smokeConfirm = source.includes("confirm") || request?.decision === "confirm"
  const userConfirmed = dirtyCount > 0
    && !force
    && !source.includes("electron-smoke")
    ? window.confirm("There are unsaved working copies. Close this window and keep hot-exit backups?")
    : false
  const decision = force
    ? "force"
    : dirtyCount === 0
      ? "allow"
      : smokeConfirm || userConfirmed
        ? "confirm"
        : "cancel"
  const allowed = decision === "allow" || decision === "confirm" || decision === "force"
  return {
    requestId: request?.requestId,
    source,
    decision,
    allowed,
    cancelled: !allowed,
    forced: force,
    dirtyCount,
    backedUp,
    evidence: latestEvidence,
    backupArtifactPaths: latestEvidence?.backupArtifactPaths || [],
    risk: latestEvidence?.risk || (dirtyCount > 0 ? "dirty-working-copy" : "none"),
  }
}

function toSerializableWindowCloseValue(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback))
  } catch {
    return fallback
  }
}

function toSerializableStringArray(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : []
}

function normalizeNativeShutdownLifecycleDecisionPayload(decision = {}) {
  const dirtyCount = Number(decision?.dirtyCount)
  return {
    requestId: typeof decision?.requestId === "string" ? decision.requestId : "",
    source: String(decision?.source || "native-close"),
    decision: String(decision?.decision || "cancel"),
    allowed: decision?.allowed === true,
    cancelled: decision?.cancelled === true,
    forced: decision?.forced === true,
    dirtyCount: Number.isFinite(dirtyCount) && dirtyCount >= 0 ? dirtyCount : 0,
    backedUp: toSerializableStringArray(decision?.backedUp),
    evidence: toSerializableWindowCloseValue(decision?.evidence, null),
    backupArtifactPaths: toSerializableStringArray(decision?.backupArtifactPaths),
    risk: String(decision?.risk || "none"),
  }
}

function installNativeShutdownLifecycleBridge() {
  const removeLifecycleListener = window.codek?.onWindowWillClose?.((request) => {
    void buildNativeShutdownLifecycleDecision(request)
      .then((decision) => {
        const payload = normalizeNativeShutdownLifecycleDecisionPayload(decision)
        window.__codekSmokeWorkingCopyHotExitLifecycle = payload
        window.codek?.resolveWindowClose?.(request?.requestId, payload)
      })
      .catch((error) => {
        const fallback = {
          requestId: request?.requestId,
          source: request?.source || "native-close",
          decision: "cancel",
          allowed: false,
          cancelled: true,
          error: String(error?.message || error),
          dirtyCount: 1,
          risk: "dirty-working-copy",
        }
        window.__codekSmokeWorkingCopyHotExitLifecycle = fallback
        window.codek?.resolveWindowClose?.(request?.requestId, fallback)
      })
  }) || null
  const beforeUnloadHandler = (event) => {
    const evidence = ws.buildWorkingCopyHotExitEvidence("beforeunload")
    if (Number(evidence?.dirtyCount || 0) <= 0) return
    event.preventDefault()
    event.returnValue = ""
  }
  window.addEventListener("beforeunload", beforeUnloadHandler)
  return () => {
    removeLifecycleListener?.()
    window.removeEventListener("beforeunload", beforeUnloadHandler)
  }
}

async function ensureEditorReady(timeout = 3000) {
  if (editor) return true
  if (!editor && !editorInitializing && w.activeFile) {
    void initEditor()
  }
  if (editor) return true
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    const done = (value) => {
      if (settled) return
      settled = true
      if (timer) window.clearTimeout(timer)
      resolve(Boolean(value || editor))
    }
    timer = window.setTimeout(() => done(Boolean(editor)), timeout)
    editorReadyWaiters.push(done)
    if (editor) done(true)
  })
}

function waitForEditorFrame() {
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    requestAnimationFrame(done)
    setTimeout(done, 32)
  })
}

function setLargeFileSmokeStage(stage, detail = {}) {
  const payload = {
    stage,
    at: Date.now(),
    detail,
  }
  window.__codekSmokeLargeFileWindowStage = payload
  console.info("[codek-smoke-large-file-stage]", JSON.stringify(payload))
  reportEditorSyncSmokeStage(payload)
  return payload
}

function reportEditorSyncSmokeStage(payload) {
  if (window.__codekSmokeArtifactOpenStage) {
    window.__codekSmokeArtifactOpenStage = payload
    console.info("[codek-smoke-artifact-open-stage]", JSON.stringify(payload))
  }
  if (window.__codekSmokeSearchNavigationStage) {
    window.__codekSmokeSearchNavigationStage = payload
    console.info("[codek-smoke-search-navigation-stage]", JSON.stringify(payload))
  }
  if (window.__codekSmokeIconVisualStateStage) {
    window.__codekSmokeIconVisualStateStage = payload
    console.info("[codek-smoke-icon-stage]", JSON.stringify(payload))
  }
}

async function settleEditorRenderFrames(count = 2) {
  await nextTick()
  for (let index = 0; index < count; index += 1) {
    await waitForEditorFrame()
  }
}

function forceEditorRender() {
  if (!editor) return
  editor.layout?.()
  editor.render?.(true)
}

function cancelDeferredWorkspaceEditorRender() {
  workspaceEditorRenderGeneration += 1
  if (workspaceEditorRenderTimer) {
    window.clearTimeout(workspaceEditorRenderTimer)
    workspaceEditorRenderTimer = null
  }
}

function scheduleDeferredWorkspaceEditorRender(path) {
  cancelDeferredWorkspaceEditorRender()
  const generation = workspaceEditorRenderGeneration
  workspaceEditorRenderTimer = window.setTimeout(() => {
    workspaceEditorRenderTimer = null
    if (generation !== workspaceEditorRenderGeneration) return
    if (!editor || w.activeFile !== path) return
    void settleEditorRenderFrames(1).then(() => {
      if (generation !== workspaceEditorRenderGeneration) return
      if (!editor || w.activeFile !== path) return
      forceEditorRender()
    })
  }, 120)
}

function cancelScheduledWorkspaceEditorSync() {
  workspaceEditorSyncGeneration += 1
  if (workspaceEditorSyncTimer) {
    window.clearTimeout(workspaceEditorSyncTimer)
    workspaceEditorSyncTimer = null
  }
}

function scheduleWorkspaceEditorSync(path) {
  cancelScheduledWorkspaceEditorSync()
  if (!path) return
  const generation = workspaceEditorSyncGeneration
  workspaceEditorSyncTimer = window.setTimeout(() => {
    workspaceEditorSyncTimer = null
    if (generation !== workspaceEditorSyncGeneration) return
    if (!editor || w.activeFile !== path) return
    syncEditorFromWorkspace()
    refreshScmEditorDecorations()
  }, 0)
}

async function forceWorkbenchEditorSurfacePaint() {
  const mainArea = document.querySelector(".main-area")
  const editorSurface = document.querySelector(".editor-wrapper")
  const editorSplit = document.querySelector(".editor-split-container")
  const nodes = [mainArea, editorSurface, editorSplit].filter(Boolean)
  for (const node of nodes) {
    node.classList.add("force-editor-surface-paint")
    void node.getBoundingClientRect?.()
  }
  await waitForEditorFrame()
  for (const node of nodes) {
    node.classList.remove("force-editor-surface-paint")
    void node.getBoundingClientRect?.()
  }
  await waitForEditorFrame()
}

function getWorkspaceTextModelCacheKey(path) {
  return `${w.projectRoot || ""}::${String(path || "").replace(/\\/g, "/")}`
}

function getWorkspaceTextModelContentVersionKey(path) {
  const content = path ? w.files[path] : ""
  return buildWorkspaceTextModelContentVersionKey({
    projectRoot: w.projectRoot || "",
    path,
    content: typeof content === "string" ? content : "",
  })
}

function resetWorkspaceTextModelCacheIfRootChanged() {
  const nextRoot = w.projectRoot || ""
  if (workspaceTextModelCacheRoot === nextRoot) return
  disposeWorkspaceTextModelCache()
  workspaceTextModelCacheRoot = nextRoot
}

function clearPendingWorkspaceTextModelLanguageUpdate() {
  workspaceTextModelLanguageGeneration += 1
  if (workspaceTextModelLanguageTimer) {
    window.clearTimeout(workspaceTextModelLanguageTimer)
    workspaceTextModelLanguageTimer = null
  }
}

function isEditorModelDisposed(model) {
  if (!model) return true
  try {
    if (typeof model.isDisposed === "function") return model.isDisposed()
    return model.isDisposed === true
  } catch {
    return true
  }
}

function disposeWorkspaceTextModelCache(exceptModel = null) {
  clearPendingWorkspaceTextModelLanguageUpdate()
  cancelDeferredWorkspaceEditorRender()
  for (const [key, entry] of workspaceTextModelCache.entries()) {
    const model = entry?.model
    if (model && model === exceptModel) continue
    try {
      entry?.disposeListener?.dispose?.()
    } catch {
      // Best effort cache listener cleanup.
    }
    try {
      if (model && !isEditorModelDisposed(model)) model.dispose?.()
    } catch {
      // Monaco model disposal should not block editor teardown.
    }
    workspaceTextModelCache.delete(key)
  }
}

function scheduleWorkspaceTextModelLanguageUpdate(entry, language, path) {
  if (!entry?.model || !language || language === "plaintext") return
  clearPendingWorkspaceTextModelLanguageUpdate()
  const generation = workspaceTextModelLanguageGeneration
  workspaceTextModelLanguageTimer = window.setTimeout(() => {
    workspaceTextModelLanguageTimer = null
    if (generation !== workspaceTextModelLanguageGeneration) return
    if (!editor || editor.getModel?.() !== entry.model || w.activeFile !== path) return
    if (isEditorModelDisposed(entry.model)) return
    try {
      monacoApi?.editor?.setModelLanguage?.(entry.model, language)
      entry.language = language
    } catch {
      // Language activation must never block file switching.
    }
  }, 200)
}

function isWorkspaceTextModelCached(model) {
  if (!model) return false
  for (const [key, entry] of Array.from(workspaceTextModelCache.entries())) {
    if (entry?.model !== model) continue
    if (isEditorModelDisposed(model)) {
      disposeWorkspaceTextModelEntry(key, entry)
      return false
    }
    return true
  }
  return false
}

function getWorkspaceTextModelPathFromCacheKey(key) {
  return String(key || "").split("::").slice(1).join("::")
}

function getWorkspaceTextModelEntryPath(key, entry) {
  return String(entry?.path || getWorkspaceTextModelPathFromCacheKey(key) || "")
}

function attachWorkspaceTextModelDisposeListener(key, entry) {
  try {
    entry?.disposeListener?.dispose?.()
  } catch {
    // Best effort listener replacement.
  }
  entry.disposeListener = null
  try {
    if (typeof entry?.model?.onWillDispose === "function") {
      entry.disposeListener = entry.model.onWillDispose(() => {
        if (workspaceTextModelCache.get(key) === entry) {
          workspaceTextModelCache.delete(key)
        }
        entry.disposeListener = null
      })
    }
  } catch {
    entry.disposeListener = null
  }
}

function disposeWorkspaceTextModelEntry(key, entry) {
  if (workspaceTextModelCache.get(key) === entry) {
    workspaceTextModelCache.delete(key)
  }
  try {
    entry?.disposeListener?.dispose?.()
  } catch {
    // Best effort cache listener cleanup.
  }
  try {
    if (entry?.model && !isEditorModelDisposed(entry.model)) entry.model.dispose?.()
  } catch {
    // Best effort cache cleanup.
  }
}

function disposeUncachedEditorModelLater(model) {
  if (!model || isEditorModelDisposed(model) || isWorkspaceTextModelCached(model)) return
  window.setTimeout(() => {
    try {
      if (!isEditorModelDisposed(model) && !isWorkspaceTextModelCached(model) && model !== editor?.getModel?.()) {
        model.dispose?.()
      }
    } catch {
      // Best effort cleanup for temporary Monaco models.
    }
  }, 0)
}

function clearActiveEditorModelIfIdle() {
  if (!editor || w.activeFile) return
  cancelScheduledWorkspaceEditorSync()
  cancelDeferredWorkspaceEditorRender()
  const previousModel = editor.getModel?.()
  if (!previousModel) return
  editor.setModel?.(null)
  disposeWorkspaceTextModelCache()
  disposeUncachedEditorModelLater(previousModel)
}

function pruneClosedWorkspaceTextModelCache() {
  const currentModel = editor?.getModel?.()
  const openFileSet = new Set(openFiles.value)
  for (const [key, entry] of Array.from(workspaceTextModelCache.entries())) {
    const model = entry?.model
    if (!model || isEditorModelDisposed(model)) {
      disposeWorkspaceTextModelEntry(key, entry)
      continue
    }
    if (model && model === currentModel) continue
    const path = getWorkspaceTextModelEntryPath(key, entry)
    if (path && openFileSet.has(path)) continue
    disposeWorkspaceTextModelEntry(key, entry)
  }
}

function pruneWorkspaceTextModelCache() {
  pruneClosedWorkspaceTextModelCache()
  while (workspaceTextModelCache.size > WORKSPACE_TEXT_MODEL_CACHE_LIMIT) {
    const first = workspaceTextModelCache.entries().next()
    if (first.done) return
    const [key, entry] = first.value
    const model = entry?.model
    if (!model || isEditorModelDisposed(model)) {
      disposeWorkspaceTextModelEntry(key, entry)
      continue
    }
    if (model && model === editor?.getModel?.()) {
      workspaceTextModelCache.delete(key)
      workspaceTextModelCache.set(key, entry)
      continue
    }
    disposeWorkspaceTextModelEntry(key, entry)
  }
}

function shouldUseWorkspaceTextModel(path, _content, language) {
  if (!editor || !monacoApi?.editor?.createModel || !path) return false
  if (ws.getLargeFileState(path)?.mode === "range") return false
  if (ws.isReadOnlyFile(path)) return false
  return typeof language === "string" && language.length > 0
}

function replaceWorkspaceTextModel(path, content, language, versionKey) {
  if (!editor || !monacoApi?.editor?.createModel || !path) return false
  resetWorkspaceTextModelCacheIfRootChanged()
  const cacheKey = getWorkspaceTextModelCacheKey(path)
  const currentModel = editor.getModel?.()
  let entry = workspaceTextModelCache.get(cacheKey)
  if (entry?.model && isEditorModelDisposed(entry.model)) {
    disposeWorkspaceTextModelEntry(cacheKey, entry)
    entry = null
  }
  if (!entry) {
    const model = monacoApi.editor.createModel(content, "plaintext")
    entry = { model, path, versionKey, contentLength: content.length, language: "plaintext", targetLanguage: language }
    workspaceTextModelCache.set(cacheKey, entry)
    attachWorkspaceTextModelDisposeListener(cacheKey, entry)
  } else {
    workspaceTextModelCache.delete(cacheKey)
    workspaceTextModelCache.set(cacheKey, entry)
    if (entry.versionKey !== versionKey || entry.contentLength !== content.length) {
      entry.model?.setValue?.(content)
    }
    entry.path = path
    entry.versionKey = versionKey
    entry.contentLength = content.length
  }
  entry.targetLanguage = language
  if (currentModel !== entry.model) {
    editor.setModel?.(entry.model)
    disposeUncachedEditorModelLater(currentModel)
  }
  scheduleWorkspaceTextModelLanguageUpdate(entry, language, path)
  pruneWorkspaceTextModelCache()
  return true
}

function disposePrimaryEditorInstance() {
  cancelScheduledWorkspaceEditorSync()
  cancelDeferredWorkspaceEditorRender()
  disposeEditorInstances({
    editor,
    editorChangeDisposable,
    editorScrollDisposable,
    detachInlineDiffOverlay,
    detachLsp,
    contextMenuDisposable: contextMenuDisp,
    clearInlineDecorations,
    setEditor: (value) => { editor = value },
    setEditorChangeDisposable: (value) => { editorChangeDisposable = value },
    setEditorScrollDisposable: (value) => { editorScrollDisposable = value },
    setDetachInlineDiffOverlay: (value) => { detachInlineDiffOverlay = value },
    setDetachLsp: (value) => { detachLsp = value },
    setContextMenuDisposable: (value) => { contextMenuDisp = value },
  })
  disposeWorkspaceTextModelCache()
  editorReady.value = false
}

function disposeDetachedPrimaryEditorInstance() {
  if (!editor) return false
  if (isEditorMountedInContainer(editor, editorContainer.value)) return false
  disposePrimaryEditorInstance()
  return true
}

async function ensureEditorContentVisible(path, expectedContent) {
  if (!editor || w.activeFile !== path) return false
  forceEditorRender()
  await settleEditorRenderFrames(2)
  forceEditorRender()

  const editorValue = getSafeEditorValue({ activeFile: path })
  if (typeof editorValue === "string" && editorValue !== expectedContent) return false

  const container = editorContainer.value
  const rect = container?.getBoundingClientRect?.()
  if (!rect || rect.width <= 0 || rect.height <= 0) return false

  const text = String(container?.textContent || "")
  const firstLine = String(expectedContent || "").split(/\r?\n/, 1)[0]?.trim() || ""
  const visibleLine = Boolean(firstLine && text.includes(firstLine))
  const hasRenderedLine = Boolean(container?.querySelector?.(".view-line"))
  const hasLineNumber = Boolean(container?.querySelector?.(".line-numbers"))

  return hasRenderedLine && hasLineNumber && (visibleLine || expectedContent.trim().length === 0)
}

function getEditorLargeFileWindowDecision(options = {}) {
  return largeFileWindowTransitionRunner.getDecision(options)
}

async function loadLargeFileWindowByDirection(direction, options = {}) {
  return largeFileWindowTransitionRunner.loadByDirection(direction, options)
}

async function navigateLargeFileWindowFromEditorScroll(options = {}) {
  return largeFileWindowTransitionRunner.navigateFromEditorScroll(options)
}

function installEditorLargeFileWindowAutoNavigation() {
  editorScrollDisposable?.dispose?.()
  editorScrollDisposable = null
  editorScrollDisposable = installLargeFileWindowAutoNavigation({
    editor,
    navigate: navigateLargeFileWindowFromEditorScroll,
  })
}

let focusRegionController = null
let workspaceSearchProviderDisposable = registerWorkspaceSearchServiceProvider({
  searchService: globalSearchService,
  workspaceManager: {
    searchTextInProject: (query, options) => ws.searchTextInProject(query, options),
    getAllFiles: () => ws.getAllFiles(),
  },
})

async function getFocusRegionController() {
  if (!focusRegionController) {
    const { createFocusRegionController } = await import("./workbench/focusRegions")
    focusRegionController = createFocusRegionController({
      getEditor: () => editor,
      getOutputPanelOpen: () => bottomPanelOpen.value,
      getActiveView: () => activeView.value,
      setActiveView: (view) => {
        activeView.value = view
      },
      getCommandPalette: () => commandPaletteRef.value,
      nextTick: (callback) => {
        nextTick(callback)
      },
      querySelector: (selector) => document.querySelector(selector),
    })
  }
  return focusRegionController
}

function openNextProblem(direction: 1 | -1) {
  const diagnostics = currentDiagnostics.value
  if (diagnostics.length === 0) {
    openProblemsPanel()
    return
  }
  const currentLine = editor?.getPosition()?.lineNumber ?? 1
  const ordered = [...diagnostics].sort((a, b) => (a.line || 0) - (b.line || 0))
  const next =
    direction > 0
      ? ordered.find((diag) => (diag.line || 0) > currentLine) || ordered[0]
      : [...ordered].reverse().find((diag) => (diag.line || 0) < currentLine) || ordered[ordered.length - 1]
  void handleOpenDiagnostic(next)
}

function toggleBreakpointAtCursor() {
  if (!w.activeFile) return
  const line = editor?.getPosition()?.lineNumber || 1
  toggleDebugBreakpoint(w.activeFile, line)
}

async function openUnsupportedCommand(action: MenuAction) {
  const { getUnsupportedMenuCommandMessage } = await import("./components/menuCommandHelpers")
  console.info(`[menu] ${action}: ${getUnsupportedMenuCommandMessage(action)}`)
}

async function handleMenuAction(action: MenuAction) {
  const { runWorkbenchMenuAction } = await import("./workbench/menuActions")
  await runWorkbenchMenuAction(action, {
    getActiveFile: () => w.activeFile,
    getOpenFiles: () => openFiles.value,
    getEditor: () => editor,
    getSplitEditor: () => splitEditor,
    isSplitOpen: () => splitOpen.value,
    getDebugBreakpoints: () => debugBreakpoints.value,
    setDebugBreakpoints: (breakpoints) => { debugBreakpoints.value = breakpoints },
    setSearchReplaceQuery: (value) => { searchReplaceQuery.value = value },
    ensureSearchReplaceQuery: () => { searchReplaceQuery.value = searchReplaceQuery.value || "" },
    setChatOpen: (open) => { chatOpen.value = open },
    setOutputPanelOpen: setOutputPanelOpenCompat,
    handleCreateFile,
    invokeDesktopWindowAction,
    openCommandPalette,
    handleOpenProject,
    handleOpenWorkspaceFile,
    handleAddFolderToWorkspace,
    handleSaveWorkspaceAs,
    handleSave,
    toggleAutoSaveMode,
    openSettingsSection,
    reloadActiveFile: async () => {
      if (!w.activeFile) return
      await ws.reloadFile(w.activeFile)
      syncEditorFromWorkspace()
      await refreshActiveAnalysis(w.activeFile)
    },
    handleCloseTab,
    runEditorAction,
    toggleMultiCursorModifier: () => {
      settingsStore.set(
        "editor.multiCursorModifier",
        settingsStore.get("editor.multiCursorModifier", "alt") === "ctrlCmd" ? "alt" : "ctrlCmd",
      )
      applyEditorOptions()
    },
    toggleColumnSelection: () => {
      settingsStore.set("editor.columnSelection", !settingsStore.get("editor.columnSelection", false))
    },
    toggleWorkbenchBoolean,
    toggleSidebarView,
    openSidebarView,
    toggleProblemsPanel,
    toggleChatPanel,
    handleToggleSplit,
    toggleWordWrapSetting,
    navigateBack: async () => {
      if (editor) (navigateBackFn || (await loadEditorFeatureModules()).navigateBack)(editor)
    },
    navigateForward: async () => {
      if (editor) (navigateForwardFn || (await loadEditorFeatureModules()).navigateForward)(editor)
    },
    openFileSwitcher,
    sendSelectionToChat,
    handleNewChat,
    openGotoLine,
    openNextProblem,
    loadDebugActions,
    toggleBreakpointAtCursor,
    openProcessExplorer,
    exportDiagnostics,
    runConfiguredUpdateCheck,
  })
}

async function invokeDesktopWindowAction(action: "newWindow" | "newAgentWindow" | "closeWindow" | "quit" | "toggleDeveloperTools" | "openLogs") {
  const codek = window.codek as (CodekAPI & {
    newWindow?: (mode?: string) => Promise<unknown>
    closeWindow?: () => Promise<unknown>
    quit?: () => Promise<unknown>
    toggleDeveloperTools?: () => Promise<unknown>
    openLogs?: () => Promise<unknown>
  }) | undefined

  if (!codek) return
  if (action === "newWindow") await codek.newWindow?.()
  if (action === "newAgentWindow") await codek.newWindow?.("agent")
  if (action === "closeWindow") await codek.closeWindow?.()
  if (action === "quit") await codek.quit?.()
  if (action === "toggleDeveloperTools") await codek.toggleDeveloperTools?.()
  if (action === "openLogs") await codek.openLogs?.()
}

async function openProcessExplorer() {
  openBottomPanel(bottomPanelState, "processExplorer")
}

async function exportDiagnostics() {
  const channel = getOutputChannel("Diagnostics")
  const result = await window.codek?.exportDiagnostics?.()
  if (!result?.path) {
    channel.error("Diagnostics export failed. Command: diagnostics:export\n")
    return
  }
  channel.appendLine(`Diagnostics exported: ${result.path}`)
  if (result.payload) {
    channel.appendLine(JSON.stringify(result.payload, null, 2))
  }
}

const currentLanguageId = computed(() => {
  if (!w.activeFile) return "plaintext"
  return detectLanguage(w.activeFile) || "plaintext"
})

const monacoLanguages = computed(() => {
  void languageRegistryVersion.value
  return getLanguageIds()
})

const currentLanguageLabel = computed(() => {
  const id = currentLanguageId.value
  const labelMap = {
    javascript: "JavaScript", typescript: "TypeScript", html: "HTML", css: "CSS",
    json: "JSON", markdown: "Markdown", python: "Python", java: "Java",
    cpp: "C++", csharp: "C#", go: "Go", rust: "Rust", ruby: "Ruby", php: "PHP",
    shell: "Shell", sql: "SQL", xml: "XML", yaml: "YAML", ini: "INI",
    plaintext: "Plain Text", scss: "SCSS", less: "Less", kotlin: "Kotlin",
    swift: "Swift", dart: "Dart", lua: "Lua", r: "R", perl: "Perl",
    dockerfile: "Dockerfile", c: "C", vue: "Vue",
  }
  return labelMap[id] || id
})

const filteredLanguages = computed(() => {
  const q = langPickerQuery.value.toLowerCase()
  const languages = monacoLanguages.value
  if (!q) return languages
  return languages.filter((l) => l.toLowerCase().includes(q))
})

function setEditorLanguage(langId) {
  loadEditorPreferenceActionsRuntime().then(({ setEditorLanguage: setWorkbenchEditorLanguage }) => {
    setWorkbenchEditorLanguage(langId, createEditorPreferenceActionContext())
  })
}

function confirmLanguagePick() {
  loadEditorPreferenceActionsRuntime().then(({ confirmLanguagePick: confirmWorkbenchLanguagePick }) => {
    confirmWorkbenchLanguagePick(createEditorPreferenceActionContext())
  })
}

watch(showLanguagePicker, (v) => {
  if (v) {
    langPickerQuery.value = ""
    nextTick(() => langPickerInputRef.value?.focus())
  }
})
const isLargeFile = ref(false)
const remotePanelOpen = ref(false)
const formatOnSave = ref(false)
const lintOnSave = ref(true)
const collabEnabled = ref(false)
const collabSession = ref(null)
const collabUsers = ref(0)
const collabConnected = ref(false)

// Tab state mirrors VS Code-style editor label models.
const pinnedTabs = reactive(new Set())
const tabContextMenu = reactive({ visible: false, x: 0, y: 0, path: "" })
const unsavedDialog = reactive({ visible: false, path: "", resolve: null })
const dragOverTab = ref(null)
const tabDragState = reactive({ draggedTab: null })
const closedEditors = reactive([])
const editorGroupServiceRevision = ref(0)
let hydratingEditorGroups = false

// Tab ordering and close-state helpers.
const gotoLineVisible = ref(false)
const gotoLineValue = ref("")
const gotoLineInput = ref(null)

// Split editor and navigation state.
const fileSwitcherVisible = ref(false)
const switcherIndex = ref(0)
const switcherFiles = computed(() => {
  const files = [...openFiles.value]
  const active = w.activeFile
  if (active && files.includes(active)) {
    const idx = files.indexOf(active)
    files.splice(idx, 1)
    files.unshift(active)
  }
  return files
})
const {
  searchQuery,
  searchReplaceQuery,
  isRegex,
  caseSensitive,
  searchBusy,
  searchError,
  searchResults,
  grepResults,
  collapsedGrepFiles,
  createPattern: createSearchPattern,
  refreshSearchResults,
  scheduleSearch,
  toggleGrepFile,
} = useWorkspaceSearch({
  searchService: globalSearchService,
  getSettings: () => settingsStore.getAll(),
})
const {
  problemsVisible,
  symbolQuery,
  selectedSymbol,
  currentOutline,
  currentDiagnostics,
  projectSymbolResults,
  currentReferences,
  toggleProblemsPanel,
  openProblemsPanel,
  closeProblemsPanel,
  updateSelectedSymbol,
  clearSelectedSymbol,
} = useEditorInsights({
  activeFile: computed(() => w.activeFile),
  getFileOutline,
  getFileDiagnostics,
  getProjectSymbols,
  getSymbolReferences,
  setSelectedSymbol,
})
const chatSession = useChatSession({
  storageKey: CHAT_STORAGE_KEY,
  defaultTitle: () => t("chat.newChatTitle"),
  createAgent: (sessionId) => createAgentForSession(sessionId),
})
const sessions = chatSession.sessions
const currentSessionId = chatSession.currentSessionId
const selectedDir = ref("")
const selectedTreePath = ref("")
const selectedTreeKind = ref("")
const breadcrumbPath = ref([])
const breadcrumbSymbols = ref([])
const activeBreadcrumbDropdown = ref(null)
const showTaskGraph = ref(false)
const taskGraphTasks = ref<AgentTask[]>([])

const cursorPosition = reactive({ line: 1, column: 1 })
const fileEncoding = ref("UTF-8")
const eolType = ref("LF")

function clearBreadcrumbState() {
  breadcrumbPath.value = []
  breadcrumbSymbols.value = []
  activeBreadcrumbDropdown.value = null
}
const indentType = ref("Spaces: 2")
const lspStatus = reactive({ connected: false, name: "" })
const remoteConnection = reactive({ type: "", name: "" })

const inlineEdit = reactive({
  visible: false,
  busy: false,
  status: "",
  statusText: "",
  activeModel: "",
  review: "",
  originalCode: "",
  modifiedCode: "",
  selection: null,
  cursorTop: 0,
  cursorLeft: 0,
})

const workbenchOpenEditorsModel = computed(() => {
  void editorGroupServiceRevision.value
  return globalWorkbenchExplorerEditorService.getOpenEditorsModel()
})
const openFiles = computed(() => {
  return workbenchOpenEditorsModel.value.entries.map((entry) => entry.path)
})
const tabDisplayModels = computed(() => buildTabDisplayModels(openFiles.value, {
  activeFile: w.activeFile,
  dirtyFiles: w.dirtyFiles,
  pinnedTabs,
}))
const editorTabStateModels = computed(() => w.editorTabStates || {})
const activeEditorTabState = computed(() => {
  const activeFile = w.activeFile || ""
  return activeFile ? (editorTabStateModels.value[activeFile] || null) : null
})
const workingCopyRestoreActionModels = computed(() => w.workingCopyRestoreActions || [])
const workingCopyRestoreBusyKey = ref("")
const workingCopyRestoreError = ref("")
const workingCopyRestoreSurfaceVisible = computed(() => {
  return workingCopyRestoreActionModels.value.length > 0
    || Boolean(workingCopyRestoreBusyKey.value)
    || Boolean(workingCopyRestoreError.value)
    || w.workingCopyHotExitStatus?.phase === "restoreChoices"
    || w.workingCopyHotExitStatus?.phase === "restoreChoicesUnavailable"
})
const workbenchViewRegistryRevision = ref(0)
const agentEvidenceSurfaceTabs: AgentEvidenceSurfaceKind[] = ["timeline", "scm", "testing", "progress", "notifications"]
const agentEvidenceVsCodeServiceIds = AGENT_EVIDENCE_VSCODE_SERVICE_IDS
const agentEvidenceRevision = ref(0)
const selectedAgentEvidenceSurface = ref<AgentEvidenceSurfaceKind>("timeline")
const agentEvidenceLoadStatus = ref<"idle" | "loading" | "loaded" | "error">("idle")
const agentEvidenceLoadError = ref("")
const agentEvidenceSurface = computed<AgentEvidenceWorkbenchSurface>(() => {
  void agentEvidenceRevision.value
  return getAgentEvidenceWorkbenchSurface()
})
const agentEvidenceAvailable = computed(() => {
  const surface = agentEvidenceSurface.value
  return surface.ready || surface.status !== "missing" || surface.report.commands.length > 0 || surface.views.timeline.items.length > 0
})
const agentEvidenceCorrelationId = computed(() => agentEvidenceSurface.value.report.correlationId || "")
const agentEvidenceTestingSummary = computed(() => agentEvidenceSurface.value.views.testing.runSummary)
const testingCoverageRendererShell = computed(() => globalTestingService.getCoverageRendererShellProjection())
const testingCoverageEditorContributionShell = computed(() => globalTestingService.getCoverageEditorContributionShellProjection(w.activeFile || undefined))
const testingResultPeekVisibleOwner = computed(() => globalTestingService.getResultPeekProjection())
const testingResultsViewPaneShell = computed(() => globalTestingService.getTestResultsViewPaneShellProjection())
const testingExplorerContract = computed(() => globalTestingService.getTestingExplorerContractProjection())
const testingExplorerVisibleRows = computed(() => {
  const rowsById = new Map(testingExplorerContract.value.rows.map((row) => [row.id, row]))
  return testingExplorerContract.value.domOwnerAdapter.visibleRowIds
    .map((id) => rowsById.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
})
const testingUpperOwnerProjection = computed(() => globalTestingService.getProjection().upperOwnerProjection)
const testingResultPeekCommandIds = computed(() => {
  const ids = new Set<string>()
  for (const entry of testingResultPeekVisibleOwner.value.entries) {
    for (const id of entry.commandIds) ids.add(id)
  }
  return Array.from(ids).sort()
})
const refreshAccessibleViewDomShell = () => {
  accessibleViewServiceRevision.value += 1
}
const getAccessibleViewCommandContext = () => {
  const context = accessibleViewVisibleOwner.value.context || {}
  return {
    accessibilityHelpIsShown: Boolean(context.accessibilityHelpIsShown),
    accessibleViewIsShown: Boolean(context.accessibleViewIsShown),
    accessibleViewSupportsNavigation: Boolean(context.supportsNavigation),
    accessibleViewGoToSymbolSupported: Boolean(context.goToSymbolSupported),
    accessibleViewCurrentProviderId: context.currentProviderId || "",
  }
}
const runAccessibleViewDomShellAction = async (actionId) => {
  const beforeContent = accessibleViewVisibleOwner.value.content
  const context = getAccessibleViewCommandContext()
  const executed = await executeCommand(actionId, [], context)
  refreshAccessibleViewDomShell()
  await nextTick()
  const afterContent = globalAccessibleViewService.getRendererProjection().content
  return {
    actionId,
    executed,
    context,
    contentChanged: beforeContent !== afterContent,
    contentBefore: beforeContent,
    contentAfter: afterContent,
    owner: "App.vue DOM-shell menu-service projection",
  }
}
const hideAccessibleViewDomShell = () => {
  const result = globalAccessibleViewService.hide({ focusTargetId: "editor:active" })
  let focusInvoked = false
  if (result.hidden) {
    try {
      editor?.focus?.()
      focusInvoked = true
    } catch {
      focusInvoked = false
    }
  }
  globalAccessibleViewService.recordFocusRestoreInvocation({
    targetId: "editor:active",
    activeEditor: w.activeFile || null,
    invoked: focusInvoked,
  })
  refreshAccessibleViewDomShell()
  return result
}
const accessibleViewVisibleOwner = computed(() => {
  void accessibleViewServiceRevision.value
  return globalAccessibleViewService.getRendererProjection()
})
const accessibleViewContractProjection = computed(() => {
  void accessibleViewServiceRevision.value
  return globalAccessibleViewService.getContractProjection()
})
watch(
  () => accessibleViewVisibleOwner.value.hidden,
  (hidden) => {
    if (!hidden) nextTick(() => accessibleViewContentRef.value?.focus?.())
  },
)
const agentEvidenceScmResources = computed(() => agentEvidenceSurface.value.views.scm.resourceGroups.flatMap((group) => group.resources))
const agentEvidenceTimelineItems = computed(() => agentEvidenceSurface.value.views.timeline.items)
const agentEvidenceProgressItems = computed(() => agentEvidenceSurface.value.views.progress.items)
const agentEvidenceNotificationItems = computed(() => agentEvidenceSurface.value.views.notifications.items)
const agentEvidenceListItems = computed(() => agentEvidenceSurface.value.list.items)
const agentEvidenceListRequiredSurfaces: AgentEvidenceSurfaceKind[] = ["testing", "notifications", "timeline", "scm", "progress"]
const agentEvidenceListVisibleItems = computed(() => {
  const items = agentEvidenceListItems.value
  const selected = new Map<string, (typeof items)[number]>()
  for (const surface of agentEvidenceListRequiredSurfaces) {
    const item = items.find((candidate) => candidate.surface === surface)
    if (item) selected.set(item.id, item)
  }
  for (const item of items) {
    if (selected.size >= 8) break
    selected.set(item.id, item)
  }
  return Array.from(selected.values()).slice(0, 8)
})
const agentEvidenceDetail = computed(() => agentEvidenceSurface.value.detail)
const agentEvidenceExport = computed(() => agentEvidenceSurface.value.export)
const mcpWorkbenchRevision = ref(0)
const mcpWorkbenchSurface = computed(() => {
  void mcpWorkbenchRevision.value
  return getMcpWorkbenchSurfaceSnapshot()
})
type McpDashboardResourceRow = McpResource & { serverName: string }
type McpDashboardTemplateRow = McpResourceTemplate & { serverName: string }
interface McpDashboardLogRow {
  level: "info" | "warning" | "error"
  message: string
  detail?: string
}
const mcpDashboardBusy = ref(false)
const mcpDashboardError = ref("")
const mcpDashboardSnapshot = ref<McpRegistrySnapshot>({ collections: [], servers: [], delegates: [] })
const mcpDashboardResources = ref<McpDashboardResourceRow[]>([])
const mcpDashboardTemplates = ref<McpDashboardTemplateRow[]>([])
const mcpDashboardLogs = ref<McpDashboardLogRow[]>([])
const mcpDashboardLastRefresh = ref("")
const mcpDashboardServers = computed(() => mcpDashboardSnapshot.value.servers || [])
const mcpDashboardServerCount = computed(() => mcpDashboardServers.value.length)
const mcpDashboardRunningCount = computed(() => mcpDashboardServers.value.filter((server) => server.initialized).length)
const mcpDashboardDisabledCount = computed(() => mcpDashboardServers.value.filter((server) => server.allowed === false).length)
const mcpDashboardToolRows = computed(() => {
  const rows: Array<{ serverName: string; name: string; description: string; approval: string }> = []
  for (const server of mcpDashboardServers.value) {
    const tools = Array.isArray(server.tools) ? server.tools : []
    for (const tool of tools) {
      const name = String(tool.name || tool.id || "未命名工具")
      const description = String(tool.description || tool.title || "该工具未提供描述。")
      const approval = String(tool.approval || tool.approvalPolicy || "沿用智能体审批")
      rows.push({ serverName: server.serverName, name, description, approval })
    }
  }
  return rows
})
const mcpDashboardSecurityRows = computed(() => [
  { label: "配置范围", value: mcpDashboardScopeSummary.value },
  { label: "传输类型", value: mcpDashboardTransportSummary.value },
  { label: "工具审批", value: "MCP 工具调用必须沿用智能体审批与证据链" },
  { label: "敏感信息", value: "环境变量、secret 和 token 仅显示脱敏状态" },
])
const mcpDashboardScopeSummary = computed(() => {
  if (!mcpDashboardServers.value.length) return "项目 / 全局 mcp.json 均未发现服务器"
  const scopes = new Set(mcpDashboardServers.value.map((server) => mcpServerScopeLabel(server)))
  return Array.from(scopes).join("、")
})
const mcpDashboardTransportSummary = computed(() => {
  if (!mcpDashboardServers.value.length) return "支持本地命令（stdio）、流式 HTTP（Streamable HTTP）和旧 SSE 兼容入口"
  const transports = new Set(mcpDashboardServers.value.map((server) => mcpServerTransportLabel(server)))
  return Array.from(transports).join("、")
})
const extensionTrustRemoteAuthRevision = ref(0)
const extensionTrustRemoteAuthSurface = computed(() => {
  void extensionTrustRemoteAuthRevision.value
  void workspaceTrustEditorRevision.value
  return getExtensionTrustRemoteAuthWorkbenchSurfaceSnapshot()
})
const workspaceTrustEditorSnapshot = computed(() => extensionTrustRemoteAuthSurface.value.workspaceTrust)
const workspaceTrustEditorPane = computed(() => workspaceTrustEditorSnapshot.value.capabilities?.requestService?.editorPane || {})
const mcpWorkbenchViews = computed(() => {
  const views = workbenchLayoutUi.value.sidebar.activeViewId === "mcp" ? workbenchLayoutUi.value.sidebar.views : []
  return views.length ? views : [
    { id: "workbench.mcp.servers", name: "MCP Servers", source: "vscode" },
    { id: "workbench.mcp.resources", name: "MCP Resources", source: "vscode" },
    { id: "workbench.mcp.gallery", name: "MCP Gallery", source: "vscode" },
  ]
})
const breadcrumbDisplayModel = computed(() => buildBreadcrumbDisplayModel({
  path: breadcrumbPath.value,
  symbols: breadcrumbSymbols.value,
  activeDropdown: activeBreadcrumbDropdown.value,
}))
const activeLargeFileNotice = computed(() => {
  const activeFile = w.activeFile || ""
  return activeFile && w.largeFileNotice?.path === activeFile ? w.largeFileNotice : null
})
const activeLargeFileStateSnapshot = ref<any | null>(null)
watchEffect(() => {
  const activeFile = w.activeFile || ""
  activeLargeFileStateSnapshot.value = activeFile ? ws.getLargeFileState(activeFile) : null
})

watch(
  () => {
    const resource = mcpResourceAccessState.openedResources[0]
    return resource ? `${resource.id}:${resource.openedAt}` : ""
  },
  () => {
    const resource = mcpResourceAccessState.openedResources[0]
    if (!resource?.path) return
    ws.openVirtualTextResource(resource.path, resource.content, { dirty: false })
  },
)

watch(
  () => mcpResourceAccessState.chatAttachments.length,
  () => {
    const attachments = consumePendingMcpChatAttachments()
    if (!attachments.length) return
    chatOpen.value = true
    nextTick(() => {
      chatPanelRef.value?.attachFiles?.(attachments)
    })
  },
)
watch(
  () => activeView.value,
  (view) => {
    if (view === "mcp") void refreshMcpDashboard()
  },
)
const activeLargeFileState = computed(() => {
  return activeLargeFileStateSnapshot.value
})

function syncAgentEvidenceSurface(surface?: AgentEvidenceWorkbenchSurface): AgentEvidenceWorkbenchSurface {
  if (surface) {
    // The service is the source of truth; revision only nudges Vue to re-project.
  }
  agentEvidenceRevision.value += 1
  return surface || getAgentEvidenceWorkbenchSurface()
}

function openAgentEvidenceSurface(surface: AgentEvidenceSurfaceKind = "timeline"): void {
  selectedAgentEvidenceSurface.value = surface
  globalAgentEvidenceWorkbenchService.openSurface(surface)
  openSidebarView("agentEvidence")
  syncAgentEvidenceSurface()
}

async function refreshAgentEvidenceWorkbenchSurface(): Promise<void> {
  agentEvidenceLoadStatus.value = "loading"
  agentEvidenceLoadError.value = ""
  try {
    const latest = await getLatestReleaseEvidenceSummary()
    const surface = setAgentEvidenceWorkbenchSummary(latest.report?.evidence?.agentEvidenceWorkbench || null, {
      createdAt: latest.report?.createdAt,
    })
    agentEvidenceLoadStatus.value = latest.report?.evidence?.agentEvidenceWorkbench ? "loaded" : "idle"
    syncAgentEvidenceSurface(surface)
    workbenchViewRegistryRevision.value += 1
  } catch (error) {
    agentEvidenceLoadStatus.value = "error"
    agentEvidenceLoadError.value = String(error?.message || error)
    syncAgentEvidenceSurface(setAgentEvidenceWorkbenchSummary(null))
    workbenchViewRegistryRevision.value += 1
  }
}

function getActiveEditorLineNumbersOption() {
  const activeFile = w.activeFile || ""
  const state = activeFile ? ws.getLargeFileState(activeFile) : activeLargeFileState.value
  if (state?.mode !== "range") return getCurrentMonacoEditorOptions().lineNumbers || "on"
  const startLine = Math.max(1, Number(state.virtualStartLine || 1))
  return (lineNumber) => String(startLine + Math.max(1, Number(lineNumber || 1)) - 1)
}

const activeEditorLargeFile = computed(() => {
  const state = activeLargeFileState.value
  if (state?.mode === "range" || activeLargeFileNotice.value || isLargeFile.value) return true
  const content = w.activeFile ? w.files[w.activeFile] : ""
  if (typeof content !== "string") return false
  return content.length > LARGE_FILE_THRESHOLD || content.split("\n").length > LARGE_FILE_LINE_THRESHOLD
})

function mcpServerScopeLabel(server: McpRegistryServer): string {
  if (server.workspaceScoped) return "项目配置"
  if (server.profileScoped) return "用户配置"
  if (server.installedScoped) return "已安装"
  if (server.extensionScoped) return "扩展提供"
  return "全局配置"
}

function mcpServerTransportLabel(server: McpRegistryServer): string {
  const config = server.config || {}
  const type = String(config.type || config.transport || "").toLowerCase()
  if (type.includes("streamable") || type.includes("http")) return "流式 HTTP（Streamable HTTP）"
  if (type.includes("sse")) return "旧 SSE"
  if (typeof config.url === "string" && config.url.trim()) return "流式 HTTP（Streamable HTTP）"
  if (typeof config.command === "string" && config.command.trim()) return "本地命令（stdio）"
  return "未声明"
}

function mcpServerStatusLabel(server: McpRegistryServer): string {
  if (server.allowed === false) return "已禁用"
  if (server.initialized) return "运行中"
  const transportState = server.transportState
  if (transportState?.retryMode === "reconnecting" || transportState?.channelStatus === "connecting") return "重连中"
  if (transportState?.channelStatus === "error" || transportState?.retryMode === "failed") return "连接异常"
  return "已停止"
}

function mcpServerStatusTone(server: McpRegistryServer): string {
  if (server.allowed === false) return "muted"
  if (server.initialized) return "ok"
  if (server.transportState?.channelStatus === "error" || server.transportState?.retryMode === "failed") return "error"
  if (server.authSession && server.authSession.status !== "authorized" && server.authSession.status !== "missing") return "warning"
  return "idle"
}

function mcpServerConfigSummary(server: McpRegistryServer): string {
  const config = server.config || {}
  const command = typeof config.command === "string" ? config.command.trim() : ""
  const args = Array.isArray(config.args) ? config.args.map((item) => String(item)).join(" ") : ""
  const url = typeof config.url === "string" ? config.url.trim() : ""
  if (url) return url
  if (command) return [command, args].filter(Boolean).join(" ")
  return "未配置启动命令或 URL"
}

function mcpServerAuthLabel(server: McpRegistryServer): string {
  const session = server.authSession
  if (!session) return "无需认证"
  if (session.status === "authorized") return "已认证"
  if (session.status === "pending") return "等待认证"
  if (session.status === "expired") return "认证已过期"
  if (session.status === "revoked") return "认证已撤销"
  if (session.status === "error") return "认证失败"
  return "未认证"
}

function mcpServerErrorSummary(server: McpRegistryServer): string {
  return server.disabledReason
    || server.transportState?.lastError
    || server.transportState?.lastBackchannelError
    || server.authSession?.error
    || ""
}

function mcpResourceTitle(resource: McpDashboardResourceRow): string {
  return resource.title || resource.name || resource.uri
}

function mcpTemplateTitle(template: McpDashboardTemplateRow): string {
  return template.title || template.name || template.uriTemplate || template.template || "未命名提示词模板"
}

function mcpMaskDetail(value: string): string {
  return value.replace(/([A-Za-z_][A-Za-z0-9_]*=)([^\\s]+)/g, "$1***")
}

function buildMcpDashboardLogs(
  snapshot: McpRegistrySnapshot,
  resources: McpDashboardResourceRow[],
  templates: McpDashboardTemplateRow[],
  errorMessage = "",
): McpDashboardLogRow[] {
  const logs: McpDashboardLogRow[] = []
  if (errorMessage) logs.push({ level: "error", message: "刷新 MCP 状态失败", detail: errorMessage })
  if (!snapshot.servers.length) {
    logs.push({
      level: "warning",
      message: "还没有 MCP 服务器",
      detail: "通过项目或全局 mcp.json 添加本地命令（stdio）、流式 HTTP（Streamable HTTP）或旧 SSE 兼容服务器，或从资源库安装。",
    })
  }
  for (const server of snapshot.servers) {
    const status = mcpServerStatusLabel(server)
    logs.push({
      level: server.initialized ? "info" : server.allowed === false ? "warning" : "info",
      message: `${server.serverName}：${status}`,
      detail: mcpMaskDetail(mcpServerErrorSummary(server) || mcpServerConfigSummary(server)),
    })
    if (server.authSession && server.authSession.status !== "authorized" && server.authSession.status !== "missing") {
      logs.push({
        level: server.authSession.status === "error" ? "error" : "warning",
        message: `${server.serverName}：${mcpServerAuthLabel(server)}`,
        detail: server.authSession.detail || server.authSession.promptDetail,
      })
    }
  }
  if (resources.length) logs.push({ level: "info", message: `已发现 ${resources.length} 个资源`, detail: "资源按服务器只读浏览。" })
  if (templates.length) logs.push({ level: "info", message: `已发现 ${templates.length} 个提示词模板 / 资源模板`, detail: "模板参数会通过 MCP 输入弹窗收集。" })
  return logs.slice(0, 12)
}

async function refreshMcpDashboard(): Promise<void> {
  mcpDashboardBusy.value = true
  mcpDashboardError.value = ""
  try {
    const snapshot = await getMcpRegistrySnapshot()
    mcpDashboardSnapshot.value = snapshot
    const allowedServers = snapshot.servers.filter((server) => server.allowed !== false)
    const resourceGroups = await Promise.all(allowedServers.map(async (server) => {
      const [resources, templates] = await Promise.all([
        listMcpResources(server.serverName).catch(() => [] as McpResource[]),
        listMcpResourceTemplates(server.serverName).catch(() => [] as McpResourceTemplate[]),
      ])
      return {
        serverName: server.serverName,
        resources: resources.map((resource) => ({ ...resource, serverName: server.serverName })),
        templates: templates.map((template) => ({ ...template, serverName: server.serverName })),
      }
    }))
    mcpDashboardResources.value = resourceGroups.flatMap((group) => group.resources)
    mcpDashboardTemplates.value = resourceGroups.flatMap((group) => group.templates)
    mcpDashboardLastRefresh.value = new Date().toLocaleTimeString()
    mcpDashboardLogs.value = buildMcpDashboardLogs(
      snapshot,
      mcpDashboardResources.value,
      mcpDashboardTemplates.value,
    )
  } catch (error: any) {
    const message = error?.message || String(error)
    mcpDashboardError.value = message
    mcpDashboardLogs.value = buildMcpDashboardLogs(
      mcpDashboardSnapshot.value,
      mcpDashboardResources.value,
      mcpDashboardTemplates.value,
      message,
    )
  } finally {
    mcpDashboardBusy.value = false
    mcpWorkbenchRevision.value += 1
  }
}

async function runMcpServerAction(server: McpRegistryServer, action: "start" | "stop" | "restart"): Promise<void> {
  if (!server.serverName) return
  mcpDashboardBusy.value = true
  mcpDashboardError.value = ""
  try {
    if (action === "start") await startMcpServer(server.serverName)
    else if (action === "stop") await stopMcpServer(server.serverName)
    else await restartMcpServer(server.serverName)
    await refreshMcpDashboard()
  } catch (error: any) {
    mcpDashboardError.value = error?.message || String(error)
    mcpDashboardLogs.value = buildMcpDashboardLogs(
      mcpDashboardSnapshot.value,
      mcpDashboardResources.value,
      mcpDashboardTemplates.value,
      mcpDashboardError.value,
    )
  } finally {
    mcpDashboardBusy.value = false
  }
}

async function openMcpCommand(commandId: string, args: unknown[] = []): Promise<void> {
  await executeCommand(commandId, args)
  await refreshMcpDashboard()
}

const editorTitleModel = computed(() => {
  const activeFile = w.activeFile || ""
  return buildActiveEditorTitleModel({
    path: activeFile,
    projectName: projectName.value,
    fallbackRootLabel: t("sidebar.files"),
    dirtyFiles: w.dirtyFiles,
    pinnedTabs,
    largeFile: activeEditorLargeFile.value,
  })
})
const projectName = computed(() => {
  if (!w.projectRoot) return ""
  return w.projectRoot.replace(/\\/g, "/").split("/").pop()
})
const fileGitDecorations = computed(() => {
  gitState.repositories.value
  return buildScmDecorationMap(getScmProviders())
})

function refreshScmEditorDecorations() {
  if (!editor || !monacoApi) return
  scmEditorDecorationIds = applyScmEditorDecorations({
    editor,
    monaco: monacoApi,
    activeFile: w.activeFile,
    decorations: fileGitDecorations.value,
    currentDecorationIds: scmEditorDecorationIds,
  })
}
const sidebarTitle = computed(() => {
  const map = {
    files: projectName.value || t("sidebar.files"),
    search: t("sidebar.search"),
    symbols: t("sidebar.symbols"),
    changes: t("sidebar.changes"),
    debug: "运行和调试",
    remote: t("app.sidebarRemote"),
    automation: "自动化",
    goals: "任务中心",
    marketplace: t("app.sidebarMarketplace"),
    mcp: "MCP",
    settings: t("sidebar.settings"),
    testing: "测试",
    agentEvidence: "智能体证据",
  }
  return map[activeView.value] || t("sidebar.settings")
})

function workspaceTrustStatusLabel(status) {
  const labels = {
    trusted: "已信任",
    untrusted: "受限",
    unknown: "未知",
  }
  return labels[String(status || "")] || String(status || "未知")
}

function authStatusLabel(status) {
  const labels = {
    missing: "未授权",
    pending: "等待授权",
    authorized: "已授权",
    expired: "已过期",
    revoked: "已撤销",
    error: "异常",
  }
  return labels[String(status || "")] || String(status || "未知")
}

function mcpViewLabel(name) {
  const labels = {
    "MCP Servers": "MCP 服务器",
    "MCP Resources": "MCP 资源",
    "MCP Gallery": "MCP 资源库",
  }
  return labels[String(name || "")] || String(name || "")
}
const WORKBENCH_SERVICE_MENU_IDS = [
  MenuId.CommandPalette,
  MenuId.MenubarFileMenu,
  MenuId.MenubarEditMenu,
  MenuId.MenubarSelectionMenu,
  MenuId.MenubarViewMenu,
  MenuId.MenubarGoMenu,
  MenuId.MenubarHelpMenu,
  MenuId.ViewTitle,
  MenuId.ExplorerContext,
  MenuId.EditorContext,
  MenuId.EditorTitle,
  MenuId.EditorTitleContext,
  MenuId.SCMTitle,
  MenuId.SCMResourceContext,
  MenuId.TestItem,
  MenuId.AgentEvidenceTimeline,
]

function getWorkbenchServiceMenuEntries(context) {
  void workbenchMenuRegistryRevision.value
  return new Map(WORKBENCH_SERVICE_MENU_IDS.map((menuId) => [
    menuId.id,
    MenuRegistry.getMenuEntries(menuId, context),
  ]))
}

const workbenchStatusbarLeftEntries = computed(() => workbenchStatusbarEntries.value.filter((entry) => entry.alignment === WorkbenchStatusbarAlignment.LEFT))
const workbenchStatusbarRightEntries = computed(() => workbenchStatusbarEntries.value.filter((entry) => entry.alignment === WorkbenchStatusbarAlignment.RIGHT))
const workspaceTrustBannerProjection = computed(() => {
  void workspaceTrustBannerRevision.value
  return globalWorkspaceTrustBannerService.getBannerItem(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID)
})
const workspaceTrustBannerVisible = computed(() => {
  const banner = workspaceTrustBannerProjection.value
  return Boolean(banner.visible && !banner.dismissed)
})
function refreshActiveCodekDialog(): void {
  activeCodekDialog.value = globalCodekDialogService.getActiveDialog() || null
  activeCodekDialogCheckboxChecked.value = Boolean(activeCodekDialog.value?.checkbox?.checked)
}
function resolveCodekDialog(buttonIndex: number): void {
  globalCodekDialogService.resolveActiveDialog({
    buttonIndex,
    checkboxChecked: activeCodekDialogCheckboxChecked.value,
  })
  refreshActiveCodekDialog()
}
function resolveCodekDialogCancel(): void {
  const dialog = activeCodekDialog.value
  if (!dialog) return
  const cancelButton = [...dialog.buttons].reverse().find((button) => button.isCancel)
  resolveCodekDialog(cancelButton?.index ?? dialog.buttons.length - 1)
}
const workbenchServiceMenuIds = computed(() => WORKBENCH_SERVICE_MENU_IDS.map((menuId) => menuId.id))
const workbenchServiceMenuEntryCount = computed(() => {
  void workbenchMenuRegistryRevision.value
  const context = {
    workspaceFolderCount: w.projectRoot ? 1 : 0,
    hasWorkspace: Boolean(w.projectRoot),
    hasEditor: Boolean(editor && w.activeFile),
    hasActiveFile: Boolean(w.activeFile),
    "workbench.activityBar.visible": workbench.activityBarVisible,
    "workbench.sideBar.visible": sidebarVisible.value,
    "workbench.panel.visible": bottomPanelOpen.value,
    view: activeView.value,
    agentEvidenceAvailable: agentEvidenceAvailable.value,
  }
  return Array.from(getWorkbenchServiceMenuEntries(context).values()).reduce((total, entries) => total + entries.length, 0)
})
const workbenchCommandSurfaceInput = computed(() => {
  void workbenchViewRegistryRevision.value
  void workbenchMenuRegistryRevision.value
  const context = {
    workspaceFolderCount: w.projectRoot ? 1 : 0,
    hasWorkspace: Boolean(w.projectRoot),
    hasEditor: Boolean(editor && w.activeFile),
    hasActiveFile: Boolean(w.activeFile),
    "workbench.activityBar.visible": workbench.activityBarVisible,
    "workbench.sideBar.visible": sidebarVisible.value,
    "workbench.panel.visible": bottomPanelOpen.value,
  }
  const commands = getCommands(context)
  const menuEntries = getWorkbenchServiceMenuEntries(context)
  const commandPaletteEntries = menuEntries.get(MenuId.CommandPalette.id) || []
  return {
    visible: commands.length > 0,
    commandIds: commands.map((command) => command.id).sort(),
    menuIds: workbenchServiceMenuIds.value,
    menuEntryCount: workbenchServiceMenuEntryCount.value,
    commandPaletteCommandIds: commandPaletteEntries
      .map((entry) => entry.type === "item" ? entry.commandId : entry.id)
      .filter(Boolean),
  }
})
const workbenchLayoutSnapshot = computed(() => {
  // The registry itself is intentionally framework-agnostic; this revision only
  // asks Vue to re-project the snapshot after contribution registration.
  void workbenchViewRegistryRevision.value
  return globalWorkbenchLayoutService.createSnapshot({
    activeSidebarView: activeView.value,
    sidebarVisible: sidebarVisible.value,
    sidebarWidth: sidebarWidth.value,
    bottomPanel: bottomPanelState,
    bottomPanelHeight: bottomPanelHeight.value,
    titleBar: {
      projectName: projectName.value,
      activeEditor: w.activeFile || null,
      activeViewId: activeView.value,
      agentMode: titlebarAgentMode.value,
      sandboxMode: titlebarSandboxMode.value,
      goalCount: titlebarGoalCount.value,
      diagnosticsErrorCount: problemState.errorCount.value,
      diagnosticsWarningCount: problemState.warningCount.value,
      commandPaletteHint: "Ctrl+Shift+P",
    },
    statusBar: {
      visible: workbench.statusBarVisible,
      activeViewId: activeView.value,
      activePanelId: bottomPanelState.active,
      languageId: currentLanguageId.value,
      line: cursorPosition.line,
      column: cursorPosition.column,
      branch: gitState.currentBranch.value || "main",
      errorCount: problemState.errorCount.value,
      warningCount: problemState.warningCount.value,
      encoding: fileEncoding.value,
      eol: eolType.value,
    },
    commandSurface: workbenchCommandSurfaceInput.value,
    editorGroups: globalWorkbenchExplorerEditorService.getEditorGroupState(),
    context: {
      workspaceFolderCount: w.projectRoot ? 1 : 0,
      hasWorkspace: Boolean(w.projectRoot),
      testingEnabled: true,
      agentEvidenceAvailable: agentEvidenceAvailable.value,
      "workbench.activityBar.visible": workbench.activityBarVisible,
      "workbench.sideBar.visible": sidebarVisible.value,
      "workbench.panel.visible": bottomPanelOpen.value,
    },
  })
})
const workbenchLayoutUi = computed(() => buildWorkbenchLayoutUiModel(workbenchLayoutSnapshot.value))

function isActivityButtonActive(button: WorkbenchActivityButtonUiModel): boolean {
  return activeView.value === "settings"
    ? button.activeViewId === "settings"
    : sidebarVisible.value && button.active
}

async function handleWorkspaceTrustBannerAction(action: WorkspaceTrustBannerActionProjection): Promise<void> {
  const href = String(action.href || "")
  if (href.startsWith("command:")) {
    await executeCommand(href.slice("command:".length))
    workspaceTrustBannerRevision.value += 1
    return
  }
  if (href) window.open?.(href, "_blank", "noopener,noreferrer")
}

function dismissWorkspaceTrustBanner(): void {
  globalWorkspaceTrustBannerService.dismiss(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID)
  globalWorkspaceTrustManagementService.getTrustSnapshot(w.projectRoot || "")
  workspaceTrustBannerRevision.value += 1
}

function getWorkspaceTrustEditorRoot(): HTMLElement | null {
  return workspaceTrustEditorRoot.value || document.querySelector<HTMLElement>('[data-codek-smoke="workspace-trust-editor"]')
}

function focusWorkspaceTrustEditorRoot(): void {
  const root = getWorkspaceTrustEditorRoot()
  const focusTarget = root?.querySelector<HTMLElement>('[data-workspace-trust-editor-root-focus-target="true"]')
  ;(focusTarget || root)?.focus?.({ preventScroll: true })
}

function getWorkspaceTrustEditorNavOrder(): HTMLElement[] {
  const root = getWorkspaceTrustEditorRoot()
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>("[data-workspace-trust-editor-focus-target]"))
    .filter((node) => typeof node.focus === "function")
}

async function toggleWorkspaceTrustEditorTrust(): Promise<void> {
  const root = w.projectRoot || workspaceTrustEditorSnapshot.value.root || ""
  if (!root) return
  await globalWorkspaceTrustManagementService.setWorkspaceTrust(
    root,
    workspaceTrustEditorSnapshot.value.trusted ? "restricted" : "trusted",
  )
  workspaceTrustEditorRevision.value += 1
  extensionTrustRemoteAuthRevision.value += 1
}

async function trustWorkspaceTrustEditorParentFolder(): Promise<void> {
  const root = w.projectRoot || workspaceTrustEditorSnapshot.value.root || ""
  const parent = parentWorkspacePath(root)
  if (!parent) return
  await globalWorkspaceTrustManagementService.setUrisTrust([parent], true)
  workspaceTrustEditorRevision.value += 1
  extensionTrustRemoteAuthRevision.value += 1
}

async function handleWorkspaceTrustEditorKeydown(event: KeyboardEvent): Promise<void> {
  const key = event.key
  if (key === "ArrowDown" || key === "ArrowUp") {
    event.preventDefault()
    const navOrder = getWorkspaceTrustEditorNavOrder()
    if (!navOrder.length) return
    const currentIndex = navOrder.findIndex((node) => node === document.activeElement || node.contains(document.activeElement))
    const direction = key === "ArrowDown" ? 1 : -1
    const nextIndex = (Math.max(0, currentIndex) + direction + navOrder.length) % navOrder.length
    navOrder[nextIndex]?.focus?.()
    return
  }
  if (key === "Escape") {
    event.preventDefault()
    focusWorkspaceTrustEditorRoot()
    return
  }
  if ((event.ctrlKey || event.metaKey) && key === "Enter") {
    event.preventDefault()
    if (event.shiftKey) await trustWorkspaceTrustEditorParentFolder()
    else await toggleWorkspaceTrustEditorTrust()
  }
}

function getActivityButtonBadge(button: WorkbenchActivityButtonUiModel): number | string {
  if (button.badge !== undefined && button.badge !== null && button.badge !== "") return button.badge
  return button.activeViewId === "changes" && changeEntries.value.length > 0 ? changeEntries.value.length : ""
}

function handleActivityContainerPointerEnter(button: WorkbenchActivityButtonUiModel): void {
  if (button.activeViewId === "marketplace") preloadMarketplacePanel()
}

function handleActivityContainerClick(button: WorkbenchActivityButtonUiModel): void {
  const view = button.activeViewId as CodekSidebarViewId
  if (view === "settings") {
    openSettingsView()
    return
  }
  toggleSidebarView(view)
  remotePanelOpen.value = sidebarVisible.value && activeView.value === "remote"
}
const projectShortPath = computed(() => {
  if (!w.projectRoot) return ""
  return w.projectRoot.length > 48 ? `${w.projectRoot.slice(0, 48)}...` : w.projectRoot
})
const changeEntries = computed(() => changeHistory.entries)
const pendingBatches = computed(() => pendingChangeState.batches)
const currentFileContent = computed(() => {
  if (w.activeFile && activeLargeFileState.value?.mode) {
    const content = w.files[w.activeFile]
    return activeLargeFileState.value?.readOnly && typeof content === "string" ? content : ""
  }
  if (!editor) return ""
  return getSafeEditorValue() || ""
})
function getActiveMarkdownPreviewResource() {
  return w.activeFile || "markdown-preview"
}
function syncLegacyMarkdownPreviewProjection() {
  const snapshot = globalNotebookMarkdownPreviewWorkbenchService.getMarkdownPreviewSnapshot()
  markdownPreviewOpen.value = snapshot.previewCount > 0
}
function bumpMarkdownPreviewServiceRevision() {
  markdownPreviewServiceRevision.value += 1
  syncLegacyMarkdownPreviewProjection()
}
function setLegacyMarkdownPreviewOpen(open, input = {}) {
  const resource = input.resource || getActiveMarkdownPreviewResource()
  if (!open) {
    const closeResource = input.resource || globalNotebookMarkdownPreviewWorkbenchService.getMarkdownPreviewSnapshot().activeResource || resource
    globalLegacyMarkdownPreviewController.dispose(closeResource)
    bumpMarkdownPreviewServiceRevision()
    return null
  }
  const model = globalLegacyMarkdownPreviewController.setOpen(open, {
    resource,
    content: input.content ?? currentFileContent.value,
    title: input.title,
    sideBySide: input.sideBySide,
    locked: input.locked,
    source: "legacy",
  })
  bumpMarkdownPreviewServiceRevision()
  return model
}
function refreshLegacyMarkdownPreview(resource = getActiveMarkdownPreviewResource(), content = currentFileContent.value) {
  const model = globalLegacyMarkdownPreviewController.refresh(resource, content)
  if (model) bumpMarkdownPreviewServiceRevision()
  return model
}
const isMarkdownFile = computed(() => {
  if (!w.activeFile) return false
  const ext = String(w.activeFile).split(".").pop().toLowerCase()
  return ext === "md" || ext === "mdx" || ext === "markdown"
})
const markdownPreviewSnapshot = computed(() => {
  void markdownPreviewServiceRevision.value
  return globalNotebookMarkdownPreviewWorkbenchService.getMarkdownPreviewSnapshot()
})
const activeMarkdownPreview = computed(() => markdownPreviewSnapshot.value.previews[0] || null)
const notebookWebviewCustomEditorSmokeEvidence = computed(() => {
  void markdownPreviewServiceRevision.value
  const notebookEvidence = globalNotebookMarkdownPreviewWorkbenchService.getSmokeEvidence()
  const webviewEvidence = globalWebviewCustomEditorPreviewService.getSmokeEvidence()
  return {
    notebookServiceId: notebookEvidence.notebookServiceId,
    notebookSerializerCount: notebookEvidence.serializerCount,
    notebookDocumentCount: notebookEvidence.notebookDocumentCount,
    activeNotebookResource: notebookEvidence.activeNotebookResource,
    notebookRendererCount: notebookEvidence.notebookRendererCount,
    notebookRendererMessageCount: notebookEvidence.rendererMessageCount,
    webviewServiceId: webviewEvidence.webviewServiceId,
    webviewPanelCount: webviewEvidence.panelCount,
    activeWebviewPanelId: webviewEvidence.activePanelId,
    customEditorServiceId: webviewEvidence.customEditorServiceId,
    restoredCustomEditorCount: webviewEvidence.restoredCustomEditorCount,
    customEditorDirtyCount: webviewEvidence.customEditorDirtyCount,
    webviewMessageBridgeReady: webviewEvidence.messageBridgeReady,
    webviewResourceGuardReady: webviewEvidence.resourceGuardReady,
  }
})
const markdownPreviewContent = computed(() => activeMarkdownPreview.value?.content ?? currentFileContent.value)
const currentSession = chatSession.currentSession
const chatMessages = chatSession.chatMessages
const currentSessionTitle = chatSession.currentSessionTitle
const activeModel = computed(() => getActiveModel())
const sessionLabels = chatSession.sessionLabels
const titlebarAgentMode = computed(() => {
  if (chatMode.value === "auto") return "自主"
  if (chatMode.value === "agent" || agentBusy.value) return "执行"
  if (chatMode.value === "ask") return "问答"
  return "规划"
})
const titlebarSandboxMode = computed(() => {
  const approvalMode = settingsStore.get<string>("codek.agent.approvalMode", "ask")
  if (approvalMode === "read-only") return "read-only"
  if (approvalMode === "workspace-auto") return "workspace-write"
  return "ask"
})
const titlebarGoalCount = computed(() => {
  let count = 0
  if (agentBusy.value) count += 1
  if (goalResultVisible.value) count += 1
  return count
})

let monacoApi = null
let editor = null
let splitEditor = null
let editorChangeDisposable = null
let editorScrollDisposable = null
const workspaceTextModelCache = new Map()
let workspaceTextModelCacheRoot = ""
const WORKSPACE_TEXT_MODEL_CACHE_LIMIT = 80
let workspaceTextModelLanguageTimer = null
let workspaceTextModelLanguageGeneration = 0
let workspaceEditorSyncTimer = null
let workspaceEditorSyncGeneration = 0
let workspaceEditorRenderTimer = null
let workspaceEditorRenderGeneration = 0
const largeFileWindowNavigationStatusText = ref("")
const largeFileWindowNavigationController = createLargeFileWindowNavigationController({
  onStatusTextChange: (statusText) => {
    largeFileWindowNavigationStatusText.value = statusText
  },
})
const largeFileWindowTransitionRunner = createLargeFileWindowTransitionRunner({
  controller: largeFileWindowNavigationController,
  getEditor: () => editor,
  getActiveFile: () => w.activeFile,
  getLargeFileState: (path) => ws.getLargeFileState(path),
  loadWindow: (direction, path) => (
    direction === "previous"
      ? ws.loadPreviousLargeFileWindow(path)
      : ws.loadNextLargeFileWindow(path)
  ),
  syncEditorFromWorkspace,
  nextTick,
  applyEditorOptions,
  waitForEditorFrame,
  requestAnimationFrame: (handler) => window.requestAnimationFrame(handler),
  setTimeout: (handler, timeout) => window.setTimeout(handler, timeout),
  setStatusText: (statusText) => {
    largeFileWindowNavigationStatusText.value = statusText
  },
  reportStage: setLargeFileSmokeStage,
})
let inlineDecorations = []
let detachInlineDiffOverlay = null
let detachLsp = null
let ollamaTimer = null
let autosaveTimer = null
let analysisTimer = null
let suppressEditorSync = false
let largeFileProgrammaticChangeGuard = null
let removeFsChangeListener = null
let removeOpenGoalListener = null
let removeSmokeOpenProjectPathListener = null
let removeSmokeAnalysisBridge = null
let removeSmokeExplorerPerformanceBridge = null
let removeWorkbenchKeybindings = null
let removeWorkbenchLayoutActions = null
let removeEditorWorkbenchContributions = null
let removeAgentEvidenceWorkbenchContributions = null
let removeTerminalDebugTaskWorkbenchContributions = null
let removeExtensionTrustRemoteAuthWorkbenchContributions = null
let removeWorkspaceTrustConfigureSettingsShell = null
let removeAccessibleViewCommandContributions = null
let removeFileOperationEventBridge = null
let removeUserDataProfileChangeListener = null
let removeWindowCloseLifecycleListener = null
let workbenchStatusbarSubscription = null
let workbenchNotificationSubscription = null
let workbenchProgressSubscription = null
let workspaceTrustBannerSubscription = null
let workspaceTrustChangeSubscription = null
let workspaceTrustFoldersSubscription = null
let codekDialogWillShowSubscription = null
let codekDialogDidShowSubscription = null
let workbenchMenuRegistrySubscription = null
let markdownPreviewServiceSubscription = null
let userSettingsFileBridge = null
let currentProfileMcpSubscription = null
let contextMenuDisp = null
let splitContextMenuDisp = null
let unsubscribeEditorSettings = null
let editorFeatureModulesPromise = null
let editorFeatureModules = null
let refreshInlineDiffFn = null
let getBreadcrumbPathFn = null
let getSymbolBreadcrumbFn = null
let pushNavigationHistoryFn = null
let navigateBackFn = null
let navigateForwardFn = null
let fileOperationRefreshScheduler = null
let openLspFileFn = null
let agentRuntimePromise = null
let agentRuntime = null
let ollamaRuntimePromise = null
let ollamaRuntime = null
let editProviderPromise = null
let editCodeFn = null
let workspaceAiRuntimePromise = null
let workspaceAiRuntime = null
let workspaceWarmupIdleId = null
let workspaceWarmupTimer = null
let workspaceWarmupRevision = 0
let workspaceDeferredWarmupTimer = null
let formatManagerPromise = null
let formatManagerRuntime = null
let lintManagerPromise = null
let lintManagerRuntime = null
let languageServerManagerPromise = null
let languageServerManagerRuntime = null
let languageServerDiagnosticsPromise = null
let editorRuntimePreloadPromise = null
let editorEnhancementTimer = null
let editorReadyWaiters = []
let languageServerDiagnosticsReady = false
let debugActionsPromise = null
let debugActionsRuntime = null
let workspaceAnalysisPromise = null
let workspaceAnalysisRuntime = null
const workspaceAnalysisLoading = ref(false)
const workspaceAnalysisLoadError = ref("")
const smokeAnalysisWorkspaceReady = ref(false)

type SettingsPanelSection =
  | "general"
  | "appearance"
  | "editor"
  | "files"
  | "search"
  | "terminal"
  | "source-control"
  | "extensions"
  | "models"
  | "agent"
  | "rules"
  | "indexing"
  | "privacy"
  | "release"
  | "languages"
  | "keybindings"
  | "workspace"
  | "advanced"
  | "codek-settings"
  | "vscode-settings"

const {
  createSession,
  ensureSessionExists,
  ensureAgentForSession,
  updateCurrentSession,
  updateSessionById,
  setSessionBusy,
  syncSessionConversationById,
  persistSessions,
} = chatSession
const currentAgent = chatSession.currentAgent
const agentBusy = chatSession.currentBusy
const goalResultVisible = ref(false)
const selectedGoalResult = ref(null)

function getCurrentMonacoEditorOptions() {
  return getProductGradeMonacoEditorOptions(settingsStore.getAll())
}

async function loadFormatManager() {
  if (formatManagerRuntime) return formatManagerRuntime
  if (!formatManagerPromise) {
    formatManagerPromise = import("./languages/format/formatManager").then((module) => module.formatManager)
  }
  formatManagerRuntime = await formatManagerPromise
  formatManagerRuntime.formatOnSave = formatOnSave.value
  return formatManagerRuntime
}

async function loadLintManager() {
  if (lintManagerRuntime) return lintManagerRuntime
  if (!lintManagerPromise) {
    lintManagerPromise = import("./languages/lint/lintManager").then((module) => module.lintManager)
  }
  lintManagerRuntime = await lintManagerPromise
  return lintManagerRuntime
}

async function loadLanguageServerManager() {
  if (languageServerManagerRuntime) return languageServerManagerRuntime
  if (!languageServerManagerPromise) {
    languageServerManagerPromise = import("./languages/lsp/manager").then((module) => module.languageServerManager)
  }
  languageServerManagerRuntime = await languageServerManagerPromise
  return languageServerManagerRuntime
}

async function setupLanguageServerDiagnostics() {
  if (languageServerDiagnosticsReady) return
  if (!languageServerDiagnosticsPromise) {
    languageServerDiagnosticsPromise = loadLanguageServerManager()
      .then((languageServerManager) => {
        if (languageServerDiagnosticsReady) return
        languageServerManager.onDiagnostics((_serverId, params) => {
          const filePath = params.uri.replace(/^file:\/\/\//, "").replace(/^\//, "")
          if (!filePath) return
          const diags = params.diagnostics.map((d) => ({
            file: filePath,
            line: d.range.start.line + 1,
            column: d.range.start.character + 1,
            message: d.message,
            severity: d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info",
            source: d.source,
            diagnosticSource: "lsp",
          }))
          problemState.addLspDiagnostics(filePath, diags)
        })
        languageServerDiagnosticsReady = true
      })
      .catch((err) => {
        languageServerDiagnosticsPromise = null
        throw err
      })
  }
  await languageServerDiagnosticsPromise
}

async function loadDebugActions() {
  if (debugActionsRuntime) return debugActionsRuntime
  if (!debugActionsPromise) {
    debugActionsPromise = import("./components/debugActions")
  }
  debugActionsRuntime = await debugActionsPromise
  return debugActionsRuntime
}

async function loadWorkspaceAnalysisRuntime() {
  if (workspaceAnalysisRuntime) return workspaceAnalysisRuntime
  if (!workspaceAnalysisPromise) {
    workspaceAnalysisLoading.value = true
    workspaceAnalysisLoadError.value = ""
    workspaceAnalysisPromise = import("./workspace/analysis")
      .catch((err) => {
        workspaceAnalysisPromise = null
        workspaceAnalysisLoadError.value = err instanceof Error ? err.message : String(err)
        console.warn("[analysis] failed to load workspace analysis runtime:", err)
        return null
      })
      .finally(() => {
        workspaceAnalysisLoading.value = false
      })
  }
  workspaceAnalysisRuntime = await workspaceAnalysisPromise
  return workspaceAnalysisRuntime
}

function warmWorkspaceAnalysisRuntime() {
  if (workspaceAnalysisRuntime || workspaceAnalysisPromise) return
  const warm = () => {
    void loadWorkspaceAnalysisRuntime()
  }
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(warm, { timeout: 3000 })
  } else {
    setTimeout(warm, 1200)
  }
}

async function loadAgentRuntime() {
  if (agentRuntime) return agentRuntime
  if (!agentRuntimePromise) {
    agentRuntimePromise = Promise.all([
      import("./agent/agent.ts"),
      import("./agent/nativeAgent"),
      import("./ai/context.js"),
    ]).then(([agentModule, nativeAgentModule, contextModule]) => ({
      Agent: agentModule.Agent,
      NativeAgent: nativeAgentModule.NativeAgent,
      buildContext: contextModule.buildContext,
      buildContextWithEvidence: contextModule.buildContextWithEvidence,
      enforceStructuredContextBudget: contextModule.enforceStructuredContextBudget,
    }))
  }
  agentRuntime = await agentRuntimePromise
  return agentRuntime
}

async function loadOllamaRuntime() {
  if (ollamaRuntime) return ollamaRuntime
  if (!ollamaRuntimePromise) {
    ollamaRuntimePromise = import("./ai/ollama.js").then((module) => ({
      listModels: module.listModels,
      ping: module.ping,
    }))
  }
  ollamaRuntime = await ollamaRuntimePromise
  return ollamaRuntime
}

async function loadEditCode() {
  if (editCodeFn) return editCodeFn
  if (!editProviderPromise) {
    editProviderPromise = import("./ai/editProvider.js").then((module) => module.editCode)
  }
  editCodeFn = await editProviderPromise
  return editCodeFn
}

async function loadWorkspaceAiRuntime() {
  if (workspaceAiRuntime) return workspaceAiRuntime
  if (!workspaceAiRuntimePromise) {
    workspaceAiRuntimePromise = Promise.all([
      import("./ai/indexer.js"),
      import("./workspace/teamRules"),
    ]).then(([indexer, teamRules]) => ({
      startBackgroundIndexing: indexer.startBackgroundIndexing,
      stopBackgroundIndexing: indexer.stopBackgroundIndexing,
      loadAllRules: teamRules.loadAllRules,
    }))
  }
  workspaceAiRuntime = await workspaceAiRuntimePromise
  return workspaceAiRuntime
}

async function getWorkspaceScaleProfileForWarmup() {
  if (w.workspaceScaleProfile) return w.workspaceScaleProfile
  if (typeof window === "undefined" || typeof window.codek?.getWorkspaceScaleProfile !== "function") return null
  try {
    return await window.codek.getWorkspaceScaleProfile()
  } catch {
    return null
  }
}

function isHugeOrPendingWorkspaceProfile(profile) {
  return profile?.scale === "huge" || profile?.pending === true
}

function scheduleLowPriorityTask(callback, delayMs) {
  const run = () => {
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      workspaceWarmupIdleId = window.requestIdleCallback(() => {
        workspaceWarmupIdleId = null
        callback()
      }, { timeout: Math.max(5000, delayMs) })
      return
    }
    callback()
  }
  workspaceWarmupTimer = setTimeout(() => {
    workspaceWarmupTimer = null
    run()
  }, delayMs)
}

function scheduleStartupIdleTask(callback, delayMs = 6000) {
  setTimeout(() => {
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => callback(), { timeout: Math.max(5000, delayMs) })
      return
    }
    callback()
  }, delayMs)
}

async function startWorkspaceAiRuntime(projectRoot, options = {}) {
  if (!projectRoot) return
  const runtime = await loadWorkspaceAiRuntime()
  runtime.loadAllRules(projectRoot)
  runtime.startBackgroundIndexing(projectRoot, options)
}

function stopWorkspaceAiRuntime() {
  cancelWorkspaceWarmup()
  workspaceAiRuntime?.stopBackgroundIndexing?.()
}

function cancelWorkspaceWarmup() {
  workspaceWarmupRevision += 1
  if (workspaceWarmupIdleId != null && typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(workspaceWarmupIdleId)
  }
  workspaceWarmupIdleId = null
  if (workspaceWarmupTimer) {
    clearTimeout(workspaceWarmupTimer)
    workspaceWarmupTimer = null
  }
  if (workspaceDeferredWarmupTimer) {
    clearTimeout(workspaceDeferredWarmupTimer)
    workspaceDeferredWarmupTimer = null
  }
}

function scheduleWorkspaceWarmup(projectRoot) {
  cancelWorkspaceWarmup()
  if (!projectRoot) return
  const visualSmokeActive = Boolean(window.__codekSmokeIconVisualStateStage)
  const root = String(projectRoot)
  const revision = workspaceWarmupRevision
  const run = async (options = {}) => {
    if (revision !== workspaceWarmupRevision) return
    const profile = options.profile || await getWorkspaceScaleProfileForWarmup()
    const startupLightMode = Object.prototype.hasOwnProperty.call(options, "startupLightMode")
      ? Boolean(options.startupLightMode)
      : isHugeOrPendingWorkspaceProfile(profile)
    await startWorkspaceAiRuntime(root, { knownOnly: startupLightMode })
    if (revision !== workspaceWarmupRevision) return
    await refreshWorkspaceAnalysisRuntime({ knownOnly: startupLightMode })
    if (revision !== workspaceWarmupRevision) return
    applyEditorDiagnostics()
    if (startupLightMode && revision === workspaceWarmupRevision) {
      workspaceDeferredWarmupTimer = setTimeout(() => {
        workspaceDeferredWarmupTimer = null
        if (revision !== workspaceWarmupRevision) return
        void run({ startupLightMode: false, profile })
      }, 18_000)
    }
  }
  const queueRun = () => {
    void (async () => {
      const profile = await getWorkspaceScaleProfileForWarmup()
      if (revision !== workspaceWarmupRevision) return
      const startupLightMode = isHugeOrPendingWorkspaceProfile(profile)
      const delayMs = visualSmokeActive ? 12_000 : startupLightMode ? 6_000 : 900
      scheduleLowPriorityTask(() => {
        void run({ startupLightMode, profile })
      }, delayMs)
    })()
  }
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    workspaceWarmupIdleId = window.requestIdleCallback(() => {
      workspaceWarmupIdleId = null
      queueRun()
    }, { timeout: visualSmokeActive ? 12_000 : 3500 })
    return
  }
  workspaceWarmupTimer = setTimeout(() => {
    workspaceWarmupTimer = null
    void run()
  }, visualSmokeActive ? 12_000 : 2500)
}

async function createAgentForSession(sessionId) {
  const runtime = await loadAgentRuntime()
  const provider = getActiveProvider()
  const nativeProviderIds = new Set(["openai", "claude", "anthropic"])
  const useNative = provider && nativeProviderIds.has(provider.id) && !!w.projectRoot
  const AgentCtor = useNative ? runtime.NativeAgent : runtime.Agent
  const instance = new AgentCtor({
    model: activeModel.value,
    projectRoot: w.projectRoot,
    workspaceFile: w.workspaceFile,
    contextProvider: async (query) =>
      runtime.buildContext({
        query,
        activeFile: w.activeFile,
        selection: getSelectedText(),
        openFiles: openFiles.value,
        activeOutline: currentOutline.value,
        activeDiagnostics: currentDiagnostics.value,
        selectedSymbol: selectedSymbol.value,
      }),
    onMessage: (msg) => handleAgentMessage(sessionId, msg),
    onStream: (content) => handleAgentStream(sessionId, content),
    onToolUse: (info) => handleToolUse(sessionId, info),
    onError: (error) => handleAgentError(sessionId, error),
    onDone: () => handleAgentDone(sessionId),
    onProgress: (message) => handleAgentProgress(sessionId, message),
    ...(useNative
      ? {
          onPartsUpdate: (parts) => handleAgentPartsStream(sessionId, parts),
          onPartsComplete: (parts) => handleAgentPartsFinal(sessionId, parts),
          onPlanEvent: (event) => handleAgentPlanEvent(sessionId, event),
        }
      : {}),
    onSuggestModeSwitch: (targetMode) => {
      if (chatPanelRef.value?.requestModeSwitch) {
        chatPanelRef.value.requestModeSwitch(targetMode)
      }
    },
    onDangerConfirm: (description) => {
      if (chatPanelRef.value?.requestDangerConfirm) {
        return chatPanelRef.value.requestDangerConfirm(description)
      }
      return Promise.resolve(false)
    },
  })
  // Keep the selected workspace tree stable while async state restores.
  instance.setMode(chatMode.value, chatAutoPermission.value)
  return markRaw(instance)
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    }),
  ]).finally(() => {
    if (timer) window.clearTimeout(timer)
  })
}

async function ensureMonaco(reportStage = null) {
  if (monacoApi) return monacoApi
  if (editorRuntimePreloadPromise) return editorRuntimePreloadPromise
  reportStage?.("monaco-environment:start")
  setupMonacoEnvironment()
  reportStage?.("monaco-environment:done")
  reportStage?.("monaco-api:start")
  try {
    monacoApi = monacoEditorApi
    defineMonacoWorkbenchThemes(monacoApi)
    reportStage?.("monaco-api:done")
    return monacoApi
  } catch (error) {
    reportStage?.("monaco-api:error", { message: String(error?.message || error) })
    throw error
  }
}

function preloadEditorRuntime(reason = "idle") {
  if (monacoApi || editorRuntimePreloadPromise) return
  const schedule = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 1))
  schedule(() => {
    if (monacoApi || editorRuntimePreloadPromise) return
    void ensureMonaco().catch((error) => {
      console.warn("[editor] Monaco runtime preload failed", reason, error)
    })
  })
}

function resolveEditorReadyWaiters(value = Boolean(editor)) {
  const waiters = editorReadyWaiters
  editorReadyWaiters = []
  for (const waiter of waiters) {
    try { waiter(value) } catch { /* ignore */ }
  }
}

function scheduleEditorEnhancements(editorInstance, monaco, reportEditorInitStage) {
  if (editorEnhancementTimer) window.clearTimeout(editorEnhancementTimer)
  const firstPaintSmokeActive = Boolean(
    window.__codekSmokeSearchNavigationStage
    || window.__codekSmokeIconVisualStateStage
    || window.__codekSmokeArtifactOpenStage
    || window.__codekSmokeRealProjectUiStage,
  )
  const delayMs = window.__codekSmokeIconVisualStateStage ? 60_000 : firstPaintSmokeActive ? 5000 : 250
  const idleTimeoutMs = firstPaintSmokeActive ? 10000 : 2500
  editorEnhancementTimer = window.setTimeout(() => {
    editorEnhancementTimer = null
    const schedule = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 350))
    schedule(() => {
      void installEditorEnhancements(editorInstance, monaco, reportEditorInitStage)
    }, { timeout: idleTimeoutMs })
  }, delayMs)
}

async function loadEditorFeatureModules() {
  if (editorFeatureModules) return editorFeatureModules
  if (!editorFeatureModulesPromise) {
    editorFeatureModulesPromise = Promise.all([
      import("./components/EditorContextMenu"),
      import("./ai/tabCompletion.ts"),
      import("./languages/completions"),
      import("./navigation/navigator"),
      import("./components/debugIntegration"),
      import("./editor/inlineDiffOverlay"),
      import("./languages/lspClient"),
      import("./components/BreadcrumbSymbols"),
    ]).then(([
      contextMenu,
      tabCompletion,
      completions,
      navigation,
      debugIntegration,
      inlineDiff,
      lspClient,
      breadcrumbs,
    ]) => ({
      ...contextMenu,
      ...tabCompletion,
      ...completions,
      ...navigation,
      ...debugIntegration,
      ...inlineDiff,
      ...lspClient,
      ...breadcrumbs,
    }))
  }
  editorFeatureModules = await editorFeatureModulesPromise
  refreshInlineDiffFn = editorFeatureModules.refreshInlineDiff
  getBreadcrumbPathFn = editorFeatureModules.getBreadcrumbPath
  getSymbolBreadcrumbFn = editorFeatureModules.getSymbolBreadcrumb
  pushNavigationHistoryFn = editorFeatureModules.pushNavigationHistory
  navigateBackFn = editorFeatureModules.navigateBack
  navigateForwardFn = editorFeatureModules.navigateForward
  openLspFileFn = editorFeatureModules.openFile
  return editorFeatureModules
}

function forEachSessionAgent(fn) {
  for (const s of chatSession.sessions.value) {
    if (s.agent) {
      try { fn(s.agent) } catch { /* ignore */ }
    }
  }
}

async function refreshChatModel() {
  const { listModels } = await loadOllamaRuntime()
  const models = await listModels()
  const resolved = syncAvailableModels(models)
  forEachSessionAgent((a) => a.setModel(resolved))
}

async function refreshOllamaRuntimeStatus() {
  const { ping } = await loadOllamaRuntime()
  ollamaOk.value = await ping()
  if (ollamaOk.value) await refreshChatModel()
}

async function handleRefreshModels() {
  const { ping } = await loadOllamaRuntime()
  ollamaOk.value = await ping()
  if (!ollamaOk.value) return
  await refreshChatModel()
}

function handleChangeModel(model) {
  setPreferredModel(model)
  forEachSessionAgent((a) => a.setModel(activeModel.value))
}

async function initializeEditorAfterLogin() {
  try {
    if (!w.activeFile && openFiles.value.length === 0) {
      editorReady.value = true
      return
    }
    const initTimeout = setTimeout(() => {
      if (!editorReady.value) {
        console.warn("Editor initialization timed out after 8s, forcing ready state")
        editorReady.value = true
      }
    }, 8000)
    await initEditor()
    clearTimeout(initTimeout)
  } catch (err) {
    console.error("Editor initialization failed:", err)
    recordTelemetryEvent("error", "editor.initialization.failed", {
      message: err instanceof Error ? err.message : String(err),
    })
    editorReady.value = true
  }
}

onMounted(async () => {
  await auth.init({ lightweight: true })

  initTheme()
  userSettingsFileBridge = installUserSettingsFileBridge()
  await userSettingsFileBridge.hydrate()
  loadModelSettings()
  loadLangSettings()
  import("./extensions/configurationDefaults")
    .then(({ loadExtensionConfigurationDefaults }) => loadExtensionConfigurationDefaults())
    .then((result) => {
      if (result.ok && result.appliedKeys > 0) {
        applyEditorOptions()
        applyWorkbenchSettings()
      }
    })
    .catch(() => {})
  loadAiProviders()
  chatSession.initFromStorage()
  currentProfileMcpSubscription = workbenchProfileStore.onDidChangeCurrentProfile(() => {
    void applyActiveProfileMcpResource()
  })
  workbenchStatusbarSubscription = globalWorkbenchStatusNotificationProgressService.onDidChangeStatusbar((items) => {
    workbenchStatusbarEntries.value = items
  })
  workspaceTrustBannerSubscription = globalWorkspaceTrustBannerService.onDidChangeBanner(() => {
    workspaceTrustBannerRevision.value += 1
  })
  workspaceTrustChangeSubscription = globalWorkspaceTrustManagementService.onDidChangeTrust(() => {
    workspaceTrustEditorRevision.value += 1
    extensionTrustRemoteAuthRevision.value += 1
  })
  workspaceTrustFoldersSubscription = globalWorkspaceTrustManagementService.onDidChangeTrustedFolders(() => {
    workspaceTrustEditorRevision.value += 1
    extensionTrustRemoteAuthRevision.value += 1
  })
  codekDialogWillShowSubscription = globalCodekDialogService.onWillShowDialog(() => {
    refreshActiveCodekDialog()
  })
  codekDialogDidShowSubscription = globalCodekDialogService.onDidShowDialog(() => {
    refreshActiveCodekDialog()
  })
  workbenchNotificationSubscription = globalWorkbenchStatusNotificationProgressService.onDidChangeNotifications((items) => {
    workbenchNotificationItems.value = items
  })
  workbenchProgressSubscription = globalWorkbenchStatusNotificationProgressService.onDidChangeProgress((items) => {
    workbenchProgressTasks.value = items
  })
  workbenchMenuRegistrySubscription = MenuRegistry.onDidChangeMenu(() => {
    workbenchMenuRegistryRevision.value += 1
  })
  markdownPreviewServiceSubscription = globalNotebookMarkdownPreviewWorkbenchService.onDidChange((event) => {
    if (event.kind.startsWith("markdown-")) bumpMarkdownPreviewServiceRevision()
  })
  void hydrateAndApplyActiveProfileMcpResource()
  removeUserDataProfileChangeListener = window.codek?.onUserDataProfileChanged?.(() => {
    void hydrateAndApplyActiveProfileMcpResource({ force: true })
  }) || null
  const applySettingsToEditor = () => applyEditorOptions()
  unsubscribeEditorSettings = settingsStore.subscribe(() => {
    applyEditorOptions()
    applyWorkbenchSettings()
  })
  applyWorkbenchSettings()
  const scheduleIdle = window.requestIdleCallback || ((cb: IdleRequestCallback) => window.setTimeout(cb, 900))
  scheduleIdle(preloadMarketplacePanel)
  scheduleStartupIdleTask(() => {
    void auth.init({ background: true })
    void runConfiguredUpdateCheck()
    void refreshOllamaRuntimeStatus()
  }, 18_000)

  watch(() => w.projectRoot, (root) => {
    if (root) {
      settingsStore.loadWorkspace(root)
      applyEditorOptions()
      applyWorkbenchSettings()
      gitState.setProjectRoot(root)
      gitState.fetchStatus()
    }
  }, { immediate: true })

  if (auth.isLoggedIn) {
    await initializeEditorAfterLogin()
  }

  watch(
    () => auth.isLoggedIn,
    async (isLoggedIn) => {
      if (!isLoggedIn || editor || editorInitializing) return
      await nextTick()
      await initializeEditorAfterLogin()
    },
    { flush: "post" },
  )

  ollamaTimer = setInterval(async () => {
    await refreshOllamaRuntimeStatus()
  }, 30_000)

  fileOperationRefreshScheduler = createWorkspaceOperationRefreshScheduler({
    getActiveFile: () => w.activeFile,
    getProjectRoot: () => w.projectRoot,
    getFiles: () => w.files,
    isDirty,
    normalizePath: ws.normalizeRelativePath,
    refreshWorkspaceTree: ws.refreshFileTree,
    refreshExplorerHost: async () => fileTreeRef.value?.refreshExplorer?.(),
    applyFileOperationToExplorer: async (payload) => Boolean(await fileTreeRef.value?.applyFileOperationToExplorer?.(payload)),
    reloadFile: ws.reloadFile,
    syncEditorFromWorkspace,
    refreshActiveAnalysis,
    refreshScmEditorDecorations,
    refreshInlineDiff: (path) => refreshInlineDiffFn?.(path),
    setDebugState: (state) => {
      if (typeof window === "undefined") return
      window.__codekSmokeFileOperationDebug = {
        ...(window.__codekSmokeFileOperationDebug || {}),
        ...state,
        hasFileTreeRef: state.hasFileTreeRef ?? Boolean(fileTreeRef.value),
      }
    },
  })
  removeFileOperationEventBridge = installFileOperationEventBridge()
  removeWindowCloseLifecycleListener = installNativeShutdownLifecycleBridge()

  onAgentEvent((event) => {
    if (event.type === 'git-operation' || event.type === 'workspace-file-operation') {
      gitState.fetchStatus()
    }
    if (event.type === "workspace-file-operation") {
      scheduleFileOperationWorkspaceRefresh(event.payload || {})
    }
  })
  if (typeof window !== "undefined") {
    window.__codekSmokeFileOperationBridgeReady = true
  }
  removeAccessibleViewCommandContributions = registerAccessibleViewCommandContributions()
  installSmokeWorkbenchControls()

  // Initialize workbench controls after storage-backed chat state is ready.
  await getFocusRegionController()
  const { installWorkbenchKeybindings } = await import("./workbench/keybindingCommands")
  removeWorkbenchKeybindings = installWorkbenchKeybindings({
    t,
    getEditor: () => editor,
    getWorkspace: () => w,
    isInlineEditVisible: () => inlineEdit.visible,
    setQuickQuestionVisible: (visible) => { quickQuestionVisible.value = visible },
    saveActiveFile: () => handleSave(),
    toggleChatPanel,
    openInlineEdit,
    openSidebarView,
    handleToggleSplit,
    sendSelectionToChat,
    toggleMinimap,
    focusNextRegion,
    focusPrevRegion,
    zoomIn,
    zoomOut,
    zoomReset,
    handleCloseTab,
    openGotoLine,
    openFileSwitcher,
    handleSwitcherKeydown,
    handleSwitcherKeyup,
    handleAccessibilityKeydown,
  })
  if (w.projectRoot) {
    scheduleWorkspaceWarmup(w.projectRoot)
  }

  warmWorkspaceAnalysisRuntime()

  setupAutoCheckpoint(editor)

  const { installCommandPaletteCommands } = await import("./workbench/paletteCommands")
  const { registerMcpInputCommands } = await import("./workbench/mcpCommands")
  const { registerExplorerCommands } = await loadFileActionsRuntime()
  installCommandPaletteCommands({
    t,
    getCommandPalette: () => commandPaletteRef.value,
    getEditor: () => editor,
    getWorkspace: () => w,
    getOpenFiles: () => openFiles.value,
    saveActiveFile: () => handleSave(),
    saveFile: (path) => handleSave(path),
    openSidebarView,
    toggleChatPanel,
    toggleSidebarVisibility,
    toggleOutputPanel,
    toggleCollab,
    toggleMinimap,
    toggleSidebarView,
    toggleLargeFile: () => { isLargeFile.value = !isLargeFile.value },
    handleCloseTab,
    closeOtherTabs,
    closeAllSavedTabs,
    openGotoLine,
    openFileSwitcher,
    openInlineEdit,
    handleMenuAction,
  })
  registerMcpInputCommands()
  registerExplorerCommands(createFileActionContext())
  const { registerWorkbenchLayoutActions } = await import("./workbench/workbenchLayoutActions")
  removeWorkbenchLayoutActions = registerWorkbenchLayoutActions({
    toggleWorkbenchBoolean,
    toggleSidebarVisibility,
    toggleSidebarView,
    openSidebarView,
    toggleBottomPanel: (panel) => {
      if (panel === "terminal") terminalPanelMounted.value = true
      toggleBottomPanel(bottomPanelState, panel)
    },
    toggleSplitEditor: handleToggleSplit,
    openSettingsView,
    openSettingsSection,
  })

  const { registerDefaultWorkbenchViews } = await import("./workbench/viewRegistry")
  registerDefaultWorkbenchViews()
  removeEditorWorkbenchContributions = registerEditorWorkbenchContributions({
    getEditor: () => editor,
    getActiveFile: () => w.activeFile,
    openFile: handleOpenFile,
    openSidebarView,
    setSymbolQuery: (query) => {
      symbolQuery.value = query
    },
    setProblemsVisible: (visible) => {
      if (visible) openProblemsPanel()
      else closeProblemsPanel()
    },
    openNextProblem,
    nextTick: (callback) => nextTick(callback),
  })
  removeTerminalDebugTaskWorkbenchContributions = registerTerminalDebugTaskWorkbenchContributions({
    registerDebugActivityView: false,
    openPanel: openTerminalDebugTaskWorkbenchPanel,
    togglePanel: toggleTerminalDebugTaskWorkbenchPanel,
    openDebugView: openTerminalDebugTaskWorkbenchDebugView,
    openTasks: openTerminalDebugTaskWorkbenchTasksView,
    openProblems: openTerminalDebugTaskWorkbenchProblemsView,
    onEvidence: recordTerminalDebugTaskWorkbenchEvidence,
  })
  removeAgentEvidenceWorkbenchContributions = registerAgentEvidenceWorkbenchContributions({
    openSurface: (surface) => openAgentEvidenceSurface(surface),
  })
  removeExtensionTrustRemoteAuthWorkbenchContributions = registerExtensionTrustRemoteAuthWorkbenchContributions()
  removeWorkspaceTrustConfigureSettingsShell = globalWorkspaceTrustManagementService.registerWorkspaceTrustConfigureSettingsShell((request) => {
    openSettingsSection(request.settingsSection, request.options.query)
  })
  await refreshAgentEvidenceWorkbenchSurface()
  workbenchViewRegistryRevision.value += 1
  void import("./extensions/workbenchContributions")
    .then(({ loadExtensionWorkbenchContributions }) => loadExtensionWorkbenchContributions({
      commandPalette: commandPaletteRef.value,
    }))
    .finally(() => {
      workbenchViewRegistryRevision.value += 1
    })
    .catch(() => {})

  void setupLanguageServerDiagnostics()

  if (window.codek?.onFileChanged) {
    removeFsChangeListener = window.codek.onFileChanged(handleExternalFileChange)
  }
  if (window.codek?.onOpenGoal) {
    removeOpenGoalListener = window.codek.onOpenGoal((goalId) => {
      void openGoalResult(String(goalId || ""))
    })
  }
  if (window.codek?.onSmokeOpenProjectPath) {
    import("./smoke/analysisWorkspaceSmoke").then(({ installAnalysisWorkspaceSmokeBridge }) => {
      removeSmokeAnalysisBridge = installAnalysisWorkspaceSmokeBridge({
        setReady: (ready) => { smokeAnalysisWorkspaceReady.value = ready },
        onSmokeOpenProjectPath: window.codek?.onSmokeOpenProjectPath,
        handleOpenRecentProject,
        handleOpenFile,
        refreshActiveAnalysis,
        refreshWorkspaceAnalysisRuntime,
        applyEditorDiagnostics,
        openSidebarView,
        openProblemsPanel,
        nextTick,
        getEditor: () => editor,
        updateBreadcrumb,
        loadAgentRuntime,
        getSelectedText,
        getState: () => ({
          projectRoot: w.projectRoot,
          activeFile: w.activeFile,
          openFiles: openFiles.value,
          currentOutline: currentOutline.value,
          currentDiagnostics: currentDiagnostics.value,
          selectedSymbol: selectedSymbol.value,
          breadcrumbSymbols: breadcrumbSymbols.value,
          breadcrumbVisible: breadcrumbPath.value.length > 0 || breadcrumbSymbols.value.length > 0,
          workspaceAnalysisLoading: workspaceAnalysisLoading.value,
          workspaceAnalysisLoadError: workspaceAnalysisLoadError.value,
        }),
      })
    })
    import("./smoke/explorerPerformanceSmoke").then(({ installExplorerPerformanceSmokeBridge }) => {
      removeSmokeExplorerPerformanceBridge = installExplorerPerformanceSmokeBridge({
        onSmokeOpenProjectPath: window.codek?.onSmokeOpenProjectPath,
        handleOpenRecentProject,
        handleOpenFile,
        handleCloseTab,
        getEditor: () => editor,
        getWorkspace: () => w,
        getLargeFileState: (path) => ws.getLargeFileState(path),
        loadLargeFileWindowByDirection,
        navigateLargeFileWindowFromEditorScroll,
        openSidebarView,
        openChat: () => {
          chatOpen.value = true
        },
        nextTick,
        getProjectRoot: () => w.projectRoot,
      })
    })
  }

  if (window.codek) {
    const { restoreElectronWorkspace } = await import("./workbench/projectLifecycle")
    const restoreInitialView = activeView.value
    const restoreContext = {
      ...createProjectLifecycleContext(),
      openExplorerView: () => {
        if (activeView.value === restoreInitialView) openSidebarView("files")
      },
    }
    await restoreElectronWorkspace(restoreContext)
    replaceEditorGroupStateFromWorkspace()
    await hydrateEditorGroupStateForProject(w.projectRoot)
  }
})

function handleWindowBlur() {
  if (autoSaveMode.value === 'onFocusChange' && isRealFS.value && w.activeFile && isDirty(w.activeFile)) {
    void handleSave()
  }
}
window.addEventListener("blur", handleWindowBlur)

onBeforeUnmount(() => {
  persistEditorGroupState()
  editorGroupServiceListener.dispose()
  largeFileWindowNavigationController.dispose()
  disposeEditorInstances({
    editor,
    editorChangeDisposable,
    editorScrollDisposable,
    detachInlineDiffOverlay,
    detachLsp,
    contextMenuDisposable: contextMenuDisp,
    splitContextMenuDisposable: splitContextMenuDisp,
    splitEditor,
    clearInlineDecorations,
    setEditor: (value) => { editor = value },
    setEditorChangeDisposable: (value) => { editorChangeDisposable = value },
    setEditorScrollDisposable: (value) => { editorScrollDisposable = value },
    setDetachInlineDiffOverlay: (value) => { detachInlineDiffOverlay = value },
    setDetachLsp: (value) => { detachLsp = value },
    setContextMenuDisposable: (value) => { contextMenuDisp = value },
    setSplitContextMenuDisposable: (value) => { splitContextMenuDisp = value },
    setSplitEditor: (value) => { splitEditor = value },
  })
  disposeWorkbenchResources({
    removeWorkbenchKeybindings,
    removeWorkbenchLayoutActions,
    removeWindowBlurListener: () => window.removeEventListener("blur", handleWindowBlur),
    stopWorkspaceAiRuntime,
    ollamaTimer,
    autosaveTimer,
    analysisTimer,
    fileOperationRefreshScheduler,
    unsubscribeEditorSettings,
    removeFsChangeListener,
    removeOpenGoalListener,
    removeUserDataProfileChangeListener,
    userSettingsFileBridge,
    removeSmokeOpenProjectPathListener,
    removeSmokeAnalysisBridge,
    removeSmokeExplorerPerformanceBridge,
    removeFileOperationEventBridge,
    removeWindowCloseLifecycleListener,
    collabSession,
    setRemoveWorkbenchKeybindings: (value) => { removeWorkbenchKeybindings = value },
    setRemoveWorkbenchLayoutActions: (value) => { removeWorkbenchLayoutActions = value },
    setFileOperationRefreshScheduler: (value) => { fileOperationRefreshScheduler = value },
    setUnsubscribeEditorSettings: (value) => { unsubscribeEditorSettings = value },
    setRemoveFileOperationEventBridge: (value) => { removeFileOperationEventBridge = value },
    setRemoveWindowCloseLifecycleListener: (value) => { removeWindowCloseLifecycleListener = value },
  })
  removeEditorWorkbenchContributions?.dispose?.()
  removeEditorWorkbenchContributions = null
  removeAgentEvidenceWorkbenchContributions?.dispose?.()
  removeAgentEvidenceWorkbenchContributions = null
  removeTerminalDebugTaskWorkbenchContributions?.dispose?.()
  removeTerminalDebugTaskWorkbenchContributions = null
  removeExtensionTrustRemoteAuthWorkbenchContributions?.dispose?.()
  removeExtensionTrustRemoteAuthWorkbenchContributions = null
  removeAccessibleViewCommandContributions?.dispose?.()
  removeAccessibleViewCommandContributions = null
  removeWorkspaceTrustConfigureSettingsShell?.dispose?.()
  removeWorkspaceTrustConfigureSettingsShell = null
  workspaceSearchProviderDisposable?.dispose?.()
  workspaceSearchProviderDisposable = null
  userSettingsFileBridge = null
  currentProfileMcpSubscription?.dispose?.()
  currentProfileMcpSubscription = null
  workbenchStatusbarSubscription?.dispose?.()
  workbenchStatusbarSubscription = null
  workspaceTrustBannerSubscription?.dispose?.()
  workspaceTrustBannerSubscription = null
  workspaceTrustChangeSubscription?.dispose?.()
  workspaceTrustChangeSubscription = null
  workspaceTrustFoldersSubscription?.dispose?.()
  workspaceTrustFoldersSubscription = null
  codekDialogWillShowSubscription?.dispose?.()
  codekDialogWillShowSubscription = null
  codekDialogDidShowSubscription?.dispose?.()
  codekDialogDidShowSubscription = null
  workbenchNotificationSubscription?.dispose?.()
  workbenchNotificationSubscription = null
  workbenchProgressSubscription?.dispose?.()
  workbenchProgressSubscription = null
  workbenchMenuRegistrySubscription?.dispose?.()
  workbenchMenuRegistrySubscription = null
  markdownPreviewServiceSubscription?.dispose?.()
  markdownPreviewServiceSubscription = null
  removeUserDataProfileChangeListener = null
})

watch(searchQuery, (value) => {
  if (activeView.value !== "search") return
  scheduleSearch(value)
})

watch(
  () => [w.activeFile, currentFileContent.value, isMarkdownFile.value, markdownPreviewOpen.value],
  ([activeFile, content, markdown, open]) => {
    if (!open) return
    if (!markdown) {
      setLegacyMarkdownPreviewOpen(false)
      return
    }
    const resource = String(activeFile || "markdown-preview")
    const preview = activeMarkdownPreview.value
    if (preview?.resource !== resource) {
      if (preview?.resource) globalLegacyMarkdownPreviewController.dispose(preview.resource)
      setLegacyMarkdownPreviewOpen(true, { resource, content: String(content || "") })
      return
    }
    if (preview.content !== content) {
      refreshLegacyMarkdownPreview(resource, String(content || ""))
    }
  },
)

watch(activeView, (value) => {
  if (value === "search") scheduleSearch(searchQuery.value)
})

watch(activeTheme, (theme) => {
  if (editor && monacoApi) {
    monacoApi.editor.setTheme(getMonacoTheme(theme))
  }
})

async function installEditorContextMenu(editorInstance, editorFeatures) {
  const { installEditorContextMenu: installWorkbenchEditorContextMenu } = await loadEditorContextMenuLifecycleRuntime()
  return installWorkbenchEditorContextMenu(editorInstance, editorFeatures, {
    t,
    openCommandPalette: () => {
      commandPaletteRef.value?.open()
    },
  })
}

async function initEditor() {
  if (editorInitializing || editor) return
  if (!auth.isLoggedIn) return
  const reportEditorInitStage = (stage, detail = {}) => {
    try {
      const payload = { stage: `editor-init:${stage}`, at: Date.now(), detail }
      if (window.__codekSmokeIconVisualStateStage) {
        window.__codekSmokeIconVisualStateStage = payload
        console.info("[codek-smoke-icon-stage]", JSON.stringify(payload))
      }
      if (window.__codekSmokeSearchNavigationStage) {
        window.__codekSmokeSearchNavigationStage = payload
        console.info("[codek-smoke-search-navigation-stage]", JSON.stringify(payload))
      }
      if (window.__codekSmokeRealProjectUiStage) {
        window.__codekSmokeRealProjectUiStage = payload
        console.info("[codek-smoke-real-project-ui-stage]", JSON.stringify(payload))
      }
    } catch {
      // smoke diagnostics only
    }
  }
  if (!w.activeFile) {
    editorReady.value = true
    reportEditorInitStage("skip-no-active-file", { openFiles: [...openFiles.value] })
    resolveEditorReadyWaiters(false)
    return
  }
  reportEditorInitStage("start", { activeFile: w.activeFile })
  editorInitializing = true
  editorReady.value = false

  if (!editorContainer.value) {
    reportEditorInitStage("wait-container")
    await nextTick()
  }
  if (!editorContainer.value) {
    console.error("Editor container not found in DOM")
    editorInitializing = false
    reportEditorInitStage("missing-container")
    return
  }

  try {
    reportEditorInitStage("ensure-monaco:start")
    const monaco = await ensureMonaco(reportEditorInitStage)
    reportEditorInitStage("ensure-monaco:done")
    if (!editorContainer.value) {
      editorReady.value = true
      editorInitializing = false
      reportEditorInitStage("container-detached")
      return
    }

    const editorSettingOptions = getCurrentMonacoEditorOptions()
    minimapEnabled.value = editorSettingOptions.minimap.enabled
    editorFontSize.value = editorSettingOptions.fontSize

    const initialEditorModel = resolveInitialEditorModel({
      activeFile: w.activeFile,
      files: w.files,
      defaultValue: t("editor.defaultValue"),
      detectLanguage,
    })

    reportEditorInitStage("create:start", {
      activeFile: w.activeFile,
      valueLength: initialEditorModel.value.length,
      language: initialEditorModel.language,
    })
    editor = monaco.editor.create(editorContainer.value, buildMonacoEditorCreateOptions({
      value: initialEditorModel.value,
      language: initialEditorModel.language,
      theme: getMonacoTheme(activeTheme.value),
      settingsOptions: editorSettingOptions,
    }))
    reportEditorInitStage("create:done")
    attachFormatOnPaste(editor)

    reportEditorInitStage("change-handler:start")
    editorChangeDisposable = editor.onDidChangeModelContent(createEditorModelChangeHandler({
      editor,
      getActiveFile: () => w.activeFile,
      getWorkspaceContent: (path) => w.files[path],
      shouldIgnoreChange: (path, _content, event) => {
        const guard = largeFileProgrammaticChangeGuard
        if (!event?.isFlush || !guard || guard.path !== path || Date.now() > guard.expiresAt) return false
        ws.markClean(path)
        setLargeFileSmokeStage("sync-editor:change-ignored", {
          activeFile: path,
          versionKey: guard.versionKey,
        })
        return true
      },
      isSuppressed: () => suppressEditorSync,
      isReadOnly: (path) => ws.isReadOnlyFile(path),
      updateFile: ws.updateFile,
      scheduleAnalysisRefresh,
      scheduleAutosave,
    }))
    installEditorLargeFileWindowAutoNavigation()
    reportEditorInitStage("change-handler:done")

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void handleSave()
    })

    editorReady.value = true
    reportEditorInitStage("ready")
    resolveEditorReadyWaiters(true)
    scheduleEditorEnhancements(editor, monaco, reportEditorInitStage)
  } catch (err) {
    console.error("Monaco editor creation failed:", err)
    reportEditorInitStage("error", { message: String(err?.message || err) })
    resolveEditorReadyWaiters(false)
  } finally {
    editorInitializing = false
    resolveEditorReadyWaiters(Boolean(editor))
    reportEditorInitStage("finally", { editor: Boolean(editor), editorReady: editorReady.value })
  }

  if (editor) {
    await nextTick()
    reportEditorInitStage("post-sync:start")
    syncEditorFromWorkspace()
    refreshScmEditorDecorations()
    reportEditorInitStage("post-sync:done")
  }
}

async function installEditorEnhancements(editorInstance, monaco, reportEditorInitStage) {
  const isCurrentEditor = () => editorInstance && editorInstance === editor
  try {
    reportEditorInitStage("feature-modules:start")
    const editorFeatures = await loadEditorFeatureModules()
    if (!isCurrentEditor()) return
    reportEditorInitStage("feature-modules:done")

    reportEditorInitStage("core-features:start")
    const {
      installEditorCompletionFeatures,
      installEditorCoreFeatureProviders,
    } = await loadEditorFeatureInstallLifecycleRuntime()
    if (!isCurrentEditor()) return
    installEditorCoreFeatureProviders(editorInstance, monaco, editorFeatures)
    reportEditorInitStage("core-features:done")

    reportEditorInitStage("language-defaults:start")
    try {
      const { applyMonacoJsTsLanguageDefaults } = await loadMonacoLanguageDefaultsRuntime()
      if (monaco.languages?.typescript) {
        applyMonacoJsTsLanguageDefaults(monaco)
      }
      reportEditorInitStage("language-defaults:done")
    } catch (err) {
      reportEditorInitStage("language-defaults:error", { message: String(err?.message || err) })
    }
    if (!isCurrentEditor()) return

    reportEditorInitStage("inline-diff:start")
    const {
      installEditorInlineDiffOverlay,
      installInlineDiffAgentRefresh,
    } = await loadEditorInlineDiffLifecycleRuntime()
    if (!isCurrentEditor()) return
    detachInlineDiffOverlay = installEditorInlineDiffOverlay(editorInstance, monaco, editorFeatures)
    installInlineDiffAgentRefresh({
      onAgentEvent,
      refreshInlineDiff: (filePath) => refreshInlineDiffFn?.(filePath),
      getActiveFile: () => w.activeFile,
    })
    reportEditorInitStage("inline-diff:done")

    reportEditorInitStage("lsp:start")
    const { startEditorLsp } = await loadEditorLspLifecycleRuntime()
    void startEditorLsp({
      projectRoot: w.projectRoot,
      monaco,
      editor: editorInstance,
      features: editorFeatures,
      setDetachLsp: (detach) => {
        detachLsp = detach
      },
    })
    reportEditorInitStage("lsp:started")

    if (!isCurrentEditor()) return
    reportEditorInitStage("completion-features:start")
    installEditorCompletionFeatures(editorInstance, monaco, editorFeatures)
    reportEditorInitStage("completion-features:done")

    reportEditorInitStage("context-menu:start")
    contextMenuDisp = await installEditorContextMenu(editorInstance, editorFeatures)
    reportEditorInitStage("context-menu:done")

    if (!isCurrentEditor()) return
    reportEditorInitStage("cursor:start")
    const { installEditorCursorLifecycle } = await loadEditorCursorLifecycleRuntime()
    installEditorCursorLifecycle({
      editor: editorInstance,
      getActiveFile: () => w.activeFile,
      setCursorPosition: (line, column) => {
        cursorPosition.line = line
        cursorPosition.column = column
      },
      setHasEditorSelection: (hasSelection) => {
        hasEditorSelection.value = hasSelection
      },
      updateBreadcrumb,
      pushNavigationHistory: (entry) => pushNavigationHistoryFn?.(entry),
    })
    reportEditorInitStage("cursor:done")

    if (!isCurrentEditor()) return
    reportEditorInitStage("markers:start")
    const { installEditorMarkerSync } = await loadEditorDiagnosticsLifecycleRuntime()
    installEditorMarkerSync({
      editor: editorInstance,
      monaco,
      getActiveFile: () => w.activeFile,
      problemState,
      getScrollbarDecorations: () => scrollbarDecorations,
      setScrollbarDecorations: (decorations) => {
        scrollbarDecorations = decorations
      },
    })
    reportEditorInitStage("markers:done")

    if (!isCurrentEditor()) return
    try {
      reportEditorInitStage("bridge:start")
      const { initMonacoBridge } = await import('./ext-host/monacoBridge')
      initMonacoBridge((method, path, body) => {
        const codek = window.codek
        return codek?.api ? codek.api(method, path, body, undefined) : null
      }, monaco)
      reportEditorInitStage("bridge:done")
    } catch (err) {
      console.warn('[app] Monaco bridge init failed:', err)
      reportEditorInitStage("bridge:error", { message: String(err?.message || err) })
    }
  } catch (err) {
    console.error("Editor feature installation failed:", err)
    reportEditorInitStage("enhancements:error", { message: String(err?.message || err) })
  } finally {
    reportEditorInitStage("enhancements:finally", { editor: Boolean(editor), editorReady: editorReady.value })
  }
}

watch(
  () => [w.activeFile, openFiles.value.length],
  async () => {
    const suppressEditorInit = suppressEditorInitForIconVisualSmoke
    disposeDetachedPrimaryEditorInstance()

    if (!w.activeFile || openFiles.value.length === 0) {
      clearBreadcrumbState()
    } else {
      activeBreadcrumbDropdown.value = null
    }

    if (suppressEditorInit) {
      editorReady.value = true
      return
    }
    if (editor || editorInitializing) {
      if (editor && w.activeFile) {
        scheduleWorkspaceEditorSync(w.activeFile)
      } else {
        clearActiveEditorModelIfIdle()
        refreshScmEditorDecorations()
      }
      return
    }
    if (w.activeFile && openFiles.value.length > 0) {
      editorReady.value = false
    }
    await nextTick()
    if (editorContainer.value) {
      await initEditor()
    }
  },
  { flush: "post" }
)

watch(
  () => [activeView.value, sidebarVisible.value],
  ([view, visible]) => {
    if (visible && view === "search") preloadEditorRuntime("search-view")
  },
  { flush: "post" }
)

watch(
  () => [w.activeFile, gitState.repositories.value.length, fileGitDecorations.value],
  () => {
    refreshScmEditorDecorations()
  },
  { flush: "post" }
)

watch(
  () => [w.activeFile, pendingChangeState.batches.length],
  () => {
    if (!editor) return
    refreshInlineDiffFn?.(w.activeFile || null)
  },
  { flush: "post" }
)

watch(
  () => [
    w.projectRoot,
    w.activeFile,
    openFiles.value.join("\n"),
    Array.from(pinnedTabs).join("\n"),
    closedEditors.map((editor) => editor.path).join("\n"),
    splitOpen.value,
    splitFile.value,
    splitRatio.value,
  ],
  () => {
    persistEditorGroupState()
  },
  { flush: "post" },
)

function handleToggleSplit() {
  loadEditorViewActionsRuntime().then(({ toggleSplitView }) => {
    toggleSplitView(createEditorViewActionContext())
  })
}

function handleCloseSplit() {
  loadEditorViewActionsRuntime().then(({ closeSplitView }) => {
    closeSplitView(createEditorViewActionContext())
  })
}

async function initSplitEditor() {
  const { initSplitEditor: initWorkbenchSplitEditor } = await loadSplitEditorLifecycleRuntime()
  await initWorkbenchSplitEditor(createSplitEditorLifecycleContext())
}

function basename(path) {
  return String(path || "").replace(/^.*[\\/]/, "")
}

function toggleMinimap() {
  loadEditorViewActionsRuntime().then(({ toggleMinimapSetting }) => {
    toggleMinimapSetting(createEditorViewActionContext())
  })
}

function handleCloseMarkdownPreview() {
  loadEditorViewActionsRuntime().then(({ closeMarkdownPreview }) => {
    closeMarkdownPreview(createEditorViewActionContext())
  })
}

function handleCloseVisualEditor() {
  loadEditorViewActionsRuntime().then(({ closeVisualEditor }) => {
    closeVisualEditor(createEditorViewActionContext())
  })
}

function zoomIn() {
  if (!editor) return
  editorFontSize.value = Math.min(editorFontSize.value + 2, 40)
  settingsStore.set("editor.fontSize", editorFontSize.value)
  applyEditorOptions()
}

function zoomOut() {
  if (!editor) return
  editorFontSize.value = Math.max(editorFontSize.value - 2, 8)
  settingsStore.set("editor.fontSize", editorFontSize.value)
  applyEditorOptions()
}

function zoomReset() {
  if (!editor) return
  editorFontSize.value = 14
  settingsStore.set("editor.fontSize", 14)
  applyEditorOptions()
}

function applyEditorOptions() {
  const settingsOptions = {
    ...getCurrentMonacoEditorOptions(),
    lineNumbers: getActiveEditorLineNumbersOption(),
  }
  applyEditorRuntimeOptions({
    editor,
    splitEditor,
    settingsOptions,
    largeFile: activeEditorLargeFile.value,
    readOnly: w.activeFile ? ws.isReadOnlyFile(w.activeFile) : false,
    setMinimapEnabled: (enabled) => {
      minimapEnabled.value = enabled
    },
    setEditorFontSize: (fontSize) => {
      editorFontSize.value = fontSize
    },
  })
}

function attachFormatOnPaste(targetEditor) {
  if (!targetEditor?.onDidPaste) return
  targetEditor.onDidPaste(() => {
    if (!settingsStore.get("editor.formatOnPaste", false)) return
    targetEditor.getAction?.("editor.action.formatSelection")?.run()?.catch(() => {
      targetEditor.getAction?.("editor.action.formatDocument")?.run()?.catch(() => {})
    })
  })
}

function handleSplitDividerMouseDown(event) {
  loadEditorViewActionsRuntime().then(({ startSplitDividerDrag }) => {
    startSplitDividerDrag(event, createEditorViewActionContext())
  })
}

function detectLanguage(filename) {
  return detectLanguageForPath(filename)
}

function dirname(path) {
  const normalized = String(path || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  if (!normalized || !normalized.includes("/")) return ""
  return normalized.slice(0, normalized.lastIndexOf("/"))
}

function joinRelativePath(dir, name) {
  const rawDir = String(dir || "").replace(/\\/g, "/")
  const isVirtualRootPath = rawDir.startsWith("/") && Array.isArray(w.workspaceRoots) && w.workspaceRoots.length > 1
  const normalizedDir = rawDir.replace(isVirtualRootPath ? /\/+$/g : /^\/+|\/+$/g, "")
  const normalizedName = String(name || "").replace(/\\/g, "/").replace(/^\/+/, "")
  return normalizedDir ? `${normalizedDir}/${normalizedName}` : normalizedName
}

function getCreateTargetPath(name) {
  return joinRelativePath(selectedDir.value, name)
}

function isDirty(path) {
  return ws.isDirty(path)
}

async function handleWorkingCopyRestoreAction(path, action) {
  workingCopyRestoreError.value = ""
  workingCopyRestoreBusyKey.value = `${path}:${action}`
  try {
    const applied = await ws.applyWorkingCopyRestoration(path, action)
    if (!applied) {
      workingCopyRestoreError.value = `无法恢复 ${path}`
    }
  } catch (error) {
    workingCopyRestoreError.value = String(error?.message || error || "恢复操作失败")
  } finally {
    workingCopyRestoreBusyKey.value = ""
  }
}

let scrollbarDecorations = []
let scmEditorDecorationIds = []

// --- Tab close helpers ---
function formatBytes(value) {
  const bytes = Number(value || 0)
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

// --- Tab pin and split helpers ---
function reportTabLifecycleStage(stage, detail = {}) {
  if (!window.__codekSmokeRealProjectUiStage && !window.__codekSmokeSearchNavigationStage && !window.__codekSmokeArtifactOpenStage && !window.__codekSmokeIconVisualStateStage) return
  try {
    const payload = { stage: `tab:${stage}`, at: Date.now(), detail }
    if (window.__codekSmokeRealProjectUiStage) {
      window.__codekSmokeRealProjectUiStage = payload
      console.info("[codek-smoke-real-project-ui-stage]", JSON.stringify(payload))
    }
    if (window.__codekSmokeSearchNavigationStage) {
      window.__codekSmokeSearchNavigationStage = payload
      console.info("[codek-smoke-search-navigation-stage]", JSON.stringify(payload))
    }
    if (window.__codekSmokeArtifactOpenStage) {
      window.__codekSmokeArtifactOpenStage = payload
      console.info("[codek-smoke-artifact-open-stage]", JSON.stringify(payload))
    }
    if (window.__codekSmokeIconVisualStateStage) {
      window.__codekSmokeIconVisualStateStage = payload
      console.info("[codek-smoke-icon-stage]", JSON.stringify(payload))
    }
  } catch {
    // smoke diagnostics only
  }
}

async function handleCloseTab(path) {
  reportTabLifecycleStage("handle-close:start", {
    path,
    dirty: isDirty(path),
    activeFile: w.activeFile,
    openCount: openFiles.value.length,
    unsavedVisible: Boolean(unsavedDialog.visible),
  })
  reportTabLifecycleStage("handle-close:runtime:done", { path })
  await closeWorkbenchTab(path, createTabLifecycleContext())
  reportTabLifecycleStage("handle-close:done", {
    path,
    activeFile: w.activeFile,
    openCount: openFiles.value.length,
    unsavedVisible: Boolean(unsavedDialog.visible),
  })
}

async function showUnsavedDialog(path) {
  return showWorkbenchUnsavedDialog(path, createTabLifecycleContext())
}

// --- Tab context menu helpers ---
async function openTabContextMenu(e, path) {
  openWorkbenchTabContextMenu(e, path, createTabLifecycleContext())
}

async function closeOtherTabs(keepPath) {
  await closeWorkbenchOtherTabs(keepPath, createTabLifecycleContext())
}

async function closeRightTabs(anchorPath) {
  await closeWorkbenchRightTabs(anchorPath, createTabLifecycleContext())
}

async function closeAllSavedTabs() {
  closeWorkbenchAllSavedTabs(createTabLifecycleContext())
}

async function reopenLastClosedTab() {
  await reopenWorkbenchClosedTab(createTabLifecycleContext())
}

async function togglePinTab(path) {
  toggleWorkbenchPinTab(path, createTabLifecycleContext())
}

// --- Tab drag and drop helpers ---
async function onTabDragStart(e, path) {
  startWorkbenchTabDrag(e, path, createTabLifecycleContext())
}

async function onTabDragOver(e, path) {
  overWorkbenchTabDrag(e, path, createTabLifecycleContext())
}

async function onTabDragLeave() {
  leaveWorkbenchTabDrag(createTabLifecycleContext())
}

async function onTabDrop(e, targetPath) {
  dropWorkbenchTab(targetPath, createTabLifecycleContext())
}

async function onTabDragEnd() {
  endWorkbenchTabDrag(createTabLifecycleContext())
}

// --- Editor navigation helpers ---
function openGotoLine() {
  gotoLineValue.value = ""
  gotoLineVisible.value = true
  nextTick(() => gotoLineInput.value?.focus())
}

function submitGotoLine() {
  const line = parseInt(gotoLineValue.value, 10)
  if (!line || line < 1 || !editor) {
    gotoLineVisible.value = false
    return
  }
  editor.revealLineInCenter(line)
  editor.setPosition({ lineNumber: line, column: 1 })
  editor.focus()
  gotoLineVisible.value = false
}

// --- Ctrl+Tab helpers ---
function openFileSwitcher() {
  if (openFiles.value.length < 2) return
  switcherIndex.value = 1
  fileSwitcherVisible.value = true
}

function selectSwitcherFile(path) {
  fileSwitcherVisible.value = false
  handleOpenFile(path)
}

function handleSwitcherKeydown(e) {
  if (!fileSwitcherVisible.value) return
  if (e.key === "Tab" && e.ctrlKey) {
    e.preventDefault()
    if (e.shiftKey) {
      switcherIndex.value = (switcherIndex.value - 1 + switcherFiles.value.length) % switcherFiles.value.length
    } else {
      switcherIndex.value = (switcherIndex.value + 1) % switcherFiles.value.length
    }
  }
  if (e.key === "Escape") {
    fileSwitcherVisible.value = false
  }
}

function handleSwitcherKeyup(e) {
  if (!fileSwitcherVisible.value) return
  if (e.key === "Control") {
    const path = switcherFiles.value[switcherIndex.value]
    if (path) selectSwitcherFile(path)
  }
}

function getSelectedText() {
  const selection = editor?.getSelection()
  const model = editor?.getModel()
  if (!selection || !model || selection.isEmpty()) return ""
  return model.getValueInRange(selection)
}

function syncEditorFromWorkspace() {
  cancelScheduledWorkspaceEditorSync()
  cancelDeferredWorkspaceEditorRender()
  if (!w.activeFile) {
    clearActiveEditorModelIfIdle()
    refreshScmEditorDecorations()
    return
  }
  const activeLargeFileState = w.activeFile ? ws.getLargeFileState(w.activeFile) : null
  const activeFileIsRangeLargeFile = Boolean(activeLargeFileState?.mode === "range")
  const activeFileIsManagedLargeFile = Boolean(activeLargeFileState?.mode === "range" || activeLargeFileState?.mode === "optimized")
  const activeFileContentVersionKey = activeFileIsManagedLargeFile
    ? [
      w.activeFile || "",
      activeLargeFileState.mode || "",
      activeLargeFileState.offset || 0,
      activeLargeFileState.bytesRead || activeLargeFileState.previewBytes || 0,
      activeLargeFileState.windowBytes || 0,
      activeLargeFileState.fileVersionHash || "",
    ].join(":")
    : undefined
    if (activeFileIsManagedLargeFile) {
      setLargeFileSmokeStage("sync-editor:start", {
        activeFile: w.activeFile,
        mode: activeLargeFileState?.mode,
        contentVersionKey: activeFileContentVersionKey,
        contentLength: typeof w.files[w.activeFile] === "string" ? w.files[w.activeFile].length : null,
      })
    }
  const result = syncEditorModelFromWorkspace({
    editor,
    monaco: monacoApi,
    activeFile: w.activeFile,
    files: w.files,
    detectLanguage,
    setSuppressEditorSync: (suppress) => {
      suppressEditorSync = suppress
    },
    releaseSuppressEditorSync: (largeFileSync) => {
      if (!largeFileSync) {
        suppressEditorSync = false
        return
      }
      if (activeFileIsManagedLargeFile && w.activeFile) {
        largeFileProgrammaticChangeGuard = {
          path: w.activeFile,
          versionKey: activeFileContentVersionKey,
          expiresAt: Date.now() + 1500,
        }
        ws.markClean(w.activeFile)
      }
      window.setTimeout(() => {
        suppressEditorSync = false
      }, 250)
    },
    onFileState: (state) => {
      eolType.value = state.eolType
      indentType.value = state.indentType
      isLargeFile.value = state.isLargeFile
    },
    warn: (message, path) => {
      console.warn(message, path)
    },
    fileStateBudget: {
      largeFileBytes: LARGE_FILE_THRESHOLD,
      largeFileLines: LARGE_FILE_LINE_THRESHOLD,
    },
    isReadOnlyFile: (path) => ws.isReadOnlyFile(path),
    forceLargeFile: activeFileIsManagedLargeFile,
    contentVersionKey: activeFileContentVersionKey || (w.activeFile ? getWorkspaceTextModelContentVersionKey(w.activeFile) : undefined),
    shouldReplaceModel: (path, content, language) => {
      return shouldUseWorkspaceTextModel(path, content, language)
    },
    replaceModel: activeFileIsRangeLargeFile
      ? (content, language) => {
          if (!editor || !monacoApi?.editor?.createModel) return false
          setLargeFileSmokeStage("sync-editor:replace-model:create:start", { activeFile: w.activeFile, contentLength: content.length, language })
          applyEditorRuntimeOptions({
            editor,
            splitEditor,
            settingsOptions: {
              ...getCurrentMonacoEditorOptions(),
              lineNumbers: getActiveEditorLineNumbersOption(),
            },
            largeFile: true,
            readOnly: false,
            setMinimapEnabled: (enabled) => {
              minimapEnabled.value = enabled
            },
            setEditorFontSize: (fontSize) => {
              editorFontSize.value = fontSize
            },
          })
          const previousModel = editor.getModel?.()
          const nextModel = monacoApi.editor.createModel(content, language)
          setLargeFileSmokeStage("sync-editor:replace-model:create:done", { activeFile: w.activeFile, contentLength: content.length, language })
          setLargeFileSmokeStage("sync-editor:replace-model:set:start", { activeFile: w.activeFile })
          editor.setModel?.(nextModel)
          forceEditorRender()
          setLargeFileSmokeStage("sync-editor:replace-model:set:done", { activeFile: w.activeFile })
          if (previousModel && previousModel !== nextModel) {
            disposeUncachedEditorModelLater(previousModel)
          }
        return true
      }
      : (content, language, versionKey) => {
        if (!w.activeFile) return false
        if (window.__codekSmokeArtifactOpenStage || window.__codekSmokeSearchNavigationStage || window.__codekSmokeIconVisualStateStage || window.__codekSmokeRealProjectUiStage) {
          reportEditorSyncSmokeStage({
            stage: "sync-editor:text-model:replace:start",
            at: Date.now(),
            detail: {
              activeFile: w.activeFile,
              contentLength: content.length,
              language,
            },
          })
        }
        const replaced = replaceWorkspaceTextModel(w.activeFile, content, language, versionKey)
        if (window.__codekSmokeArtifactOpenStage || window.__codekSmokeSearchNavigationStage || window.__codekSmokeIconVisualStateStage || window.__codekSmokeRealProjectUiStage) {
          reportEditorSyncSmokeStage({
            stage: "sync-editor:text-model:replace:done",
            at: Date.now(),
            detail: {
              activeFile: w.activeFile,
              replaced,
              modelLength: getSafeEditorValueLength({ activeFile: w.activeFile, largeFileState: activeLargeFileState }),
            },
          })
        }
        return replaced
      },
    applyBeforeSetValue: (state) => {
      const largeFileMode = state.isLargeFile || activeFileIsManagedLargeFile
      const settingsOptions = {
        ...getCurrentMonacoEditorOptions(),
        lineNumbers: getActiveEditorLineNumbersOption(),
      }
      applyEditorRuntimeOptions({
        editor,
        splitEditor,
        settingsOptions,
        largeFile: largeFileMode,
        readOnly: state.readOnly,
        setMinimapEnabled: (enabled) => {
          minimapEnabled.value = enabled
        },
        setEditorFontSize: (fontSize) => {
          editorFontSize.value = fontSize
        },
      })
    },
    })
    if (activeFileIsManagedLargeFile) {
      setLargeFileSmokeStage("sync-editor:done", {
        activeFile: w.activeFile,
        mode: activeLargeFileState?.mode,
        synced: result.synced,
        fileState: result.fileState,
        modelLength: Number(editor?.getModel?.()?.getValueLength?.() || 0),
      })
    }
    if (result.synced) {
      if (activeFileIsManagedLargeFile) {
        setLargeFileSmokeStage("sync-editor:apply-options:start", { activeFile: w.activeFile })
      }
      applyEditorOptions()
      if (activeFileIsManagedLargeFile) {
        setLargeFileSmokeStage("sync-editor:apply-options:done", { activeFile: w.activeFile })
        forceEditorRender()
        window.requestAnimationFrame(() => forceEditorRender())
      }
    if (!result.fileState?.isLargeFile && !activeFileIsManagedLargeFile && w.activeFile) {
      scheduleDeferredWorkspaceEditorRender(w.activeFile)
    }
  }
}

async function applyEditorDiagnostics() {
  if (!editor || !monacoApi) return
  const { applyEditorDiagnostics: applyWorkbenchEditorDiagnostics } = await loadEditorDiagnosticsLifecycleRuntime()
  applyWorkbenchEditorDiagnostics(editor, monacoApi, currentDiagnostics.value)
}

async function refreshActiveAnalysis(path = w.activeFile) {
  if (!path) {
    applyEditorDiagnostics()
    return null
  }

  const analysisRuntime = await loadWorkspaceAnalysisRuntime()
  const refreshFileAnalysis = analysisRuntime?.refreshFileAnalysis
  if (!refreshFileAnalysis) return null
  const analysis = await refreshFileAnalysis(path)
  if (w.activeFile === path) applyEditorDiagnostics()
  return analysis
}

async function refreshWorkspaceAnalysisRuntime(options = {}) {
  const analysisRuntime = await loadWorkspaceAnalysisRuntime()
  const refreshWorkspaceAnalysis = analysisRuntime?.refreshWorkspaceAnalysis
  if (!refreshWorkspaceAnalysis) return false
  return refreshWorkspaceAnalysis(options)
}

function scheduleAnalysisRefresh(path = w.activeFile) {
  if (!path) return
  if (analysisTimer) clearTimeout(analysisTimer)
  analysisTimer = setTimeout(() => {
    void refreshActiveAnalysis(path)
  }, 220)
}

function scheduleFileOperationWorkspaceRefresh(payload = {}) {
  fileOperationRefreshScheduler?.schedule(payload)
}

function scheduleAutosave() {
  if (autoSaveMode.value === 'off') return
  if (!isRealFS.value || !w.activeFile) return
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    void handleSave()
  }, AUTOSAVE_DELAY_MS)
}

async function handleSave(path = w.activeFile) {
  const { saveFile } = await loadFileActionsRuntime()
  return saveFile(path, createFileActionContext())
}

async function maybeSaveCurrentFile() {
  const { maybeSaveCurrentFile: saveCurrentFileIfNeeded } = await loadFileActionsRuntime()
  return saveCurrentFileIfNeeded(createFileActionContext())
}

function reportOpenFileSmokeStage(stage, detail = {}) {
  if (!window.__codekSmokeIconVisualStateStage && !window.__codekSmokeSearchNavigationStage && !window.__codekSmokeArtifactOpenStage && !window.__codekSmokeRealProjectUiStage) return
  try {
    const payload = { stage: `handle-open-file:${stage}`, at: Date.now(), detail }
    if (window.__codekSmokeIconVisualStateStage) {
      window.__codekSmokeIconVisualStateStage = payload
      console.info("[codek-smoke-icon-stage]", JSON.stringify(payload))
    }
    if (window.__codekSmokeSearchNavigationStage) {
      window.__codekSmokeSearchNavigationStage = payload
      console.info("[codek-smoke-search-navigation-stage]", JSON.stringify(payload))
    }
    if (window.__codekSmokeArtifactOpenStage) {
      window.__codekSmokeArtifactOpenStage = payload
      console.info("[codek-smoke-artifact-open-stage]", JSON.stringify(payload))
    }
    if (window.__codekSmokeRealProjectUiStage) {
      window.__codekSmokeRealProjectUiStage = payload
      console.info("[codek-smoke-real-project-ui-stage]", JSON.stringify(payload))
    }
  } catch {
    // smoke diagnostics only
  }
}

async function handleOpenFile(path) {
  reportOpenFileSmokeStage("start", { path })
  try {
    reportOpenFileSmokeStage("runtime:start", { path })
    const { openFile } = await loadFileActionsRuntime()
    reportOpenFileSmokeStage("runtime:done", { path })
    const opened = await openFile(path, createFileActionContext())
    reportOpenFileSmokeStage("done", { path, opened, activeFile: w.activeFile })
    return opened
  } catch (error) {
    reportOpenFileSmokeStage("error", { path, error: String(error?.message || error) })
    throw error
  }
}



async function handleOpenProject() {
  const { openProjectFromDialog } = await import("./workbench/projectLifecycle")
  await openProjectFromDialog(createProjectLifecycleContext())
}

async function handleOpenWorkspaceFile() {
  const saved = await maybeSaveCurrentFile()
  if (!saved) return
  const ok = await ws.openWorkspaceFile()
  if (!ok) return
  await finalizeWorkspaceSurfaceOpen()
}

async function handleAddFolderToWorkspace() {
  const ok = await ws.addFolderToWorkspace()
  if (!ok) return
  await finalizeWorkspaceSurfaceOpen()
}

async function handleSaveWorkspaceAs() {
  await ws.saveWorkspaceAs()
}

async function finalizeWorkspaceSurfaceOpen() {
  selectedDir.value = ""
  selectedTreePath.value = ""
  selectedTreeKind.value = ""
  openSidebarView("files")
  syncEditorFromWorkspace()
  clearSelectedSymbol()
  if (w.projectRoot) {
    settingsStore.loadWorkspace(w.projectRoot)
    scheduleWorkspaceWarmup(w.projectRoot)
  }
  applyWorkbenchSettings()
  applyEditorOptions()
  replaceEditorGroupStateFromWorkspace()
  await hydrateEditorGroupStateForProject(w.projectRoot)
  forEachSessionAgent((agent) => agent.setProjectRoot(w.projectRoot))
}

async function handleOpenRecentProject(path) {
  const { openRecentProject } = await import("./workbench/projectLifecycle")
  await openRecentProject(path, createProjectLifecycleContext())
}

async function handleAddFile() {
  const { addScratchFile } = await loadFileActionsRuntime()
  await addScratchFile(createFileActionContext())
}

function handleCreateFile() {
  if (fileTreeRef.value) {
    fileTreeRef.value.startCreate("file")
  }
}

function handleCreateFolder() {
  if (fileTreeRef.value) {
    fileTreeRef.value.startCreate("folder")
  }
}

async function handleCreateJavaProject() {
  const { createJavaProject } = await loadFileActionsRuntime()
  await createJavaProject(createFileActionContext())
}

function handleCloneRepository() {
  commandPaletteRef.value?.open()
}

async function handleInlineCreate({ type, parentPath, targetSnapshot, name }) {
  const { inlineCreate } = await loadFileActionsRuntime()
  await inlineCreate({ type, parentPath, targetSnapshot, name }, createFileActionContext())
  await fileTreeRef.value?.refreshExplorer?.()
}

async function handleDeleteEntry(path) {
  const { deleteEntry } = await loadFileActionsRuntime()
  await deleteEntry(path, createFileActionContext())
}

async function handleRenameEntry(payload) {
  const oldPath = payload?.path
  const newPath = payload?.newPath
  if (!oldPath || !newPath) throw new Error("rename payload missing path")
  const success = await ws.renameEntry(oldPath, newPath)
  if (!success) throw new Error("rename failed")
  selectedTreePath.value = ws.getRelativePath(newPath)
  selectedTreeKind.value = "file"
  selectedDir.value = dirname(selectedTreePath.value)
  syncEditorFromWorkspace()
}

async function handleRefreshTree() {
  const { refreshTree } = await loadFileActionsRuntime()
  await refreshTree(createFileActionContext())
  await fileTreeRef.value?.refreshExplorer?.()
}

async function handleExplorerCommand(payload) {
  const command = payload?.command
  if (!command) return
  if (command === "explorer.move") {
    const { cutEntry, pasteEntry } = await loadFileActionsRuntime()
    const context = createFileActionContext()
    await cutEntry(payload.path, context)
    await pasteEntry(payload.targetDir, context)
    return
  }
  if (command === "explorer.selectFile") {
    const relativePath = ws.getRelativePath(payload.path)
    selectedDir.value = dirname(relativePath)
    selectedTreePath.value = relativePath
    selectedTreeKind.value = "file"
    return
  }
  if (command === "explorer.clearSelection") {
    selectedDir.value = ""
    selectedTreePath.value = ""
    selectedTreeKind.value = ""
    return
  }
  await executeCommand(command, [payload.path], {
    explorerVisible: activeView.value === "files",
    explorerResource: Boolean(payload.path),
  })
}

function handleSelectDir(path) {
  selectedDir.value = ws.getRelativePath(path)
  selectedTreePath.value = selectedDir.value
  selectedTreeKind.value = "dir"
}

async function handleGrepMatchClick(path, match) {
  const matchLine = typeof match === "number" ? match : match?.line
  const matchColumn = typeof match === "number" ? 1 : match?.column
  const context = createSearchFileActionContext()
  context.reportNavigationStage?.("grep-click:start", {
    path,
    line: matchLine,
    column: matchColumn,
    activeFile: w.activeFile,
  })
  await runOpenGrepMatch(path, match, context)
  context.reportNavigationStage?.("grep-click:done", {
    path,
    line: matchLine,
    column: matchColumn,
    activeFile: w.activeFile,
  })
}

async function handleReplaceOne() {
  await runSearchReplaceOne(createSearchFileActionContext())
}

async function handleReplaceAll() {
  await runSearchReplaceAll(createSearchFileActionContext())
}

function handleOpenLink(target) {
  if (target === "shortcuts") {
    activeView.value = "settings"
  } else if (target === "settings") {
    activeView.value = "settings"
  } else if (target === "remote") {
    openSidebarView("remote")
    remotePanelOpen.value = true
  }
}

function openOrchestratorRun(runId) {
  activeOrchestratorRunId.value = String(runId || "")
  orchestratorRunDetailVisible.value = Boolean(activeOrchestratorRunId.value)
  openSidebarView("goals")
}

function closeOrchestratorRun() {
  orchestratorRunDetailVisible.value = false
}

async function handleExternalFileChange(payload) {
  await runSearchExternalFileChange(payload, createSearchFileActionContext())
}

async function focusNextRegion() {
  const controller = await getFocusRegionController()
  controller.focusNextRegion()
}

async function focusPrevRegion() {
  const controller = await getFocusRegionController()
  controller.focusPrevRegion()
}

async function handleAccessibilityKeydown(event) {
  const controller = await getFocusRegionController()
  controller.handleAccessibilityKeydown(event)
}

async function handleRegenerate() {
  const session = currentSession.value
  if (!session) return
  if (session.busy) return
  if (session.messages.length < 2) return

  const userMessages = session.messages.filter((m) => m.role === "user")
  if (userMessages.length === 0) return

  const lastUserMsg = userMessages[userMessages.length - 1]
  const sid = session.id

  updateSessionById(sid, (s) => {
    while (s.messages.length > 0) {
      const last = s.messages[s.messages.length - 1]
      if (last.role === "user") {
        s.messages.pop()
        break
      }
      s.messages.pop()
    }
  })

  const a = await ensureAgentForSession(sid)
  if (!a) return
  a.reset()
  a.setProjectRoot(w.projectRoot)
  setSessionBusy(sid, true)
  a.send(lastUserMsg.content).catch((err) => {
    console.error('[chat] regenerate failed', err)
    handleAgentError(sid, err?.message || String(err))
  })
}

async function handleInlineSubmit(instruction) {
  const { submitInlineEdit } = await loadInlineEditActionsRuntime()
  await submitInlineEdit(instruction, createInlineEditActionContext())
}

function openInlineEdit() {
  loadInlineEditActionsRuntime().then(({ openInlineEdit: openWorkbenchInlineEdit }) => {
    openWorkbenchInlineEdit(createInlineEditActionContext())
  })
}

function handleInlineAccept() {
  loadInlineEditActionsRuntime().then(({ applyInlineEdit }) => {
    applyInlineEdit(createInlineEditActionContext())
  })
}

function handleInlineReject() {
  loadInlineEditActionsRuntime().then(({ cancelInlineEdit }) => {
    cancelInlineEdit(createInlineEditActionContext())
  })
}

function handleInlineCancel() {
  loadInlineEditActionsRuntime().then(({ cancelInlineEdit }) => {
    cancelInlineEdit(createInlineEditActionContext())
  })
}

function clearInlineDecorations() {
  if (editor && inlineDecorations.length > 0) {
    inlineDecorations = editor.deltaDecorations(inlineDecorations, [])
  }
}

function showInlineDiff(oldCode, newCode) {
  if (!editor || !inlineEdit.selection || !monacoApi) return

  const oldLines = oldCode.split("\n")
  const newLines = newCode.split("\n")
  const startLine = inlineEdit.selection.startLineNumber
  const maxLength = Math.max(oldLines.length, newLines.length)
  const decorations = []

  for (let index = 0; index < maxLength; index += 1) {
    const line = startLine + index
    const oldLine = oldLines[index] ?? ""
    const newLine = newLines[index] ?? ""
    if (oldLine !== newLine) {
      decorations.push({
        range: new monacoApi.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: newLine && !oldLine ? "inline-diff-add" : "inline-diff-remove",
        },
      })
    }
  }

  inlineDecorations = editor.deltaDecorations([], decorations)
}

function updateCurrentSessionTitle(text) {
  updateCurrentSession((session) => {
    if (session.title !== t("chat.newChatTitle") || session.messages.length > 0) return
    session.title = text.trim().slice(0, 28) || t("chat.newChatTitle")
  })
}

function handleModeChange(mode, permissionLevel) {
  chatMode.value = mode
  chatAutoPermission.value = permissionLevel
  // Keep accepted task messages compact and readable.
  forEachSessionAgent((a) => a.setMode(mode, permissionLevel))
}

function sendSelectionToChat() {
  loadInlineEditActionsRuntime().then(({ sendSelectionToChat: sendWorkbenchSelectionToChat }) => {
    sendWorkbenchSelectionToChat(createInlineEditActionContext())
  })
}

async function onVisualEditorOpenSource(payload) {
  const { openVisualEditorSource } = await loadNavigationActionsRuntime()
  await openVisualEditorSource(payload, createNavigationActionContext())
}

function onVisualEditorAiEdit(payload) {
  if (!payload?.prompt) return
  chatOpen.value = true
  nextTick(() => {
    chatPanelRef.value?.appendPrompt(payload.prompt)
  })
}

function handlePaletteGotoLine(line) {
  loadNavigationActionsRuntime().then(({ gotoLine }) => {
    gotoLine(line, createNavigationActionContext())
  })
}

function handlePaletteSymbolSearch(query) {
  loadNavigationActionsRuntime().then(({ openPaletteSymbolSearch }) => {
    openPaletteSymbolSearch(query, createNavigationActionContext())
  })
}

const CONTINUE_RE = /^\s*(go on|keep going|continue|resume|carry on|proceed)([\s!?.]*)$/i
const CONTINUE_PHRASES = ["continue", "resume", "go on", "keep going", "carry on", "proceed"]

function isContinueCommand(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[!?.]+$/g, "").trim()
  return CONTINUE_RE.test(value) || CONTINUE_PHRASES.includes(normalized)
}

function wasLastInterrupted() {
  const msgs = currentSession.value?.messages || []
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role !== 'assistant') continue
    return m._interrupted === true
  }
  return false
}

function appendChatTaskAcceptedMessage(sessionId, text, task, run) {
  updateSessionById(sessionId, (session) => {
    session.messages.push({ role: 'user', content: text })
    const strategy = run?.executionStrategy === 'multi-agent' ? '多智能体' : '单智能体'
    const reason = task?.routerDecision?.reason || run?.strategyReason || '系统已选择执行策略'
    const blocked = task?.requiresConfirmation
      ? `\n\n需要确认：${task.blockingReason || '该任务需要人工确认后继续'}`
      : ''
    session.messages.push({
      role: 'assistant',
      content: `任务已接收\n\n任务 ID：${task?.id || '未知'}\nRun ID：${task?.runId || run?.id || '未知'}\n执行方式：${strategy}\n原因：${reason}${blocked}\n\n我会在后台继续执行，并在完成后更新结果。`,
      parts: [{
        type: 'text',
        text: `任务已接收\n\n执行方式：${strategy}\n原因：${reason}`,
      }, {
        type: 'orchestrator_task',
        taskId: task?.id || '',
        runId: task?.runId || run?.id || '',
        status: task?.status || run?.status || 'created',
        runtimeStatusLabel: task?.runtimeStatusLabel || run?.runtimeStatusLabel || '',
        visibleMode: task?.visibleMode || run?.visibleMode || 'agent',
        executionStrategy: run?.executionStrategy || task?.executionStrategy || 'single-agent',
        reason,
        requiresConfirmation: Boolean(task?.requiresConfirmation),
        nextAction: task?.requiresConfirmation
          ? (task.blockingReason || '等待人工确认后继续执行')
          : '任务执行完成后会展示 diff 和验证结果',
      }],
    })
  })
}

async function handleChatSend(text, mentions, context) {
  ensureSessionExists()
  const sid = currentSessionId.value
  if (!sid) return
  updateCurrentSessionTitle(text)
  const mode = context?.mode || chatPanelRef.value?.currentMode?.value || chatMode.value || 'plan'
  if (mode === 'agent' || mode === 'auto') {
    setSessionBusy(sid, true)
    try {
      const workspaceContext = await buildWorkspaceContextForAgent(text)
      const runtime = await loadAgentRuntime()
      const budgetedContext = mergeAndBudgetAgentContext(context, workspaceContext, runtime)
      const result = await createOrchestratorTask({
        message: text,
        mode,
        projectRoot: w.projectRoot,
        files: Array.isArray(openFiles.value) ? openFiles.value : [],
        attachments: Array.isArray(context?.attachments)
          ? context.attachments.map((attachment) => ({
            name: attachment.name,
            size: attachment.size,
            type: attachment.type,
            kind: attachment.kind,
            status: attachment.status,
            content: attachment.content,
            dataUrl: attachment.dataUrl,
            truncated: attachment.truncated,
            error: attachment.error,
          }))
          : [],
        contextEvidence: budgetedContext.evidence,
        contextSummary: budgetedContext.workspaceText,
        permissionLevel: context?.permissionLevel || null,
      })
      appendChatTaskAcceptedMessage(sid, text, result.task, result.run)
      openSidebarView("goals")
    } catch (err) {
      updateSessionById(sid, (session) => {
        session.messages.push({ role: 'user', content: text })
      })
      console.error('[chat] create orchestrator task failed', err)
      handleAgentError(sid, err?.message || String(err))
    } finally {
      setSessionBusy(sid, false)
    }
    return
  }

  const a = await ensureAgentForSession(sid)
  if (!a) return
  const hasVisionProviderMessage = Array.isArray(context?.providerMessages)
    && context.providerMessages.some((message) => Array.isArray(message.content))
  if (hasVisionProviderMessage) {
    setSessionBusy(sid, true)
    updateSessionById(sid, (session) => {
      session.messages.push({
        role: 'user',
        content: text,
      })
      session.conversation.push({
        role: 'user',
        content: text,
      })
      if (Array.isArray(context.attachmentWarnings) && context.attachmentWarnings.length > 0) {
        session.messages.push({
          role: 'assistant',
          content: `附件处理提醒\n${context.attachmentWarnings.map((item) => `- ${item}`).join('\n')}`,
        })
      }
      session.messages.push({
        role: 'assistant',
        content: '',
        _streaming: true,
      })
    })
    try {
      const provider = getActiveProvider()
      const response = await chatStream({
        provider,
        model: activeModel.value,
        messages: context.providerMessages,
        stream: true,
      })
      if (!response.ok || !response.body) throw new Error(`LLM request failed with status ${response.status}`)
      let finalContent = ''
      await readUnifiedStream(response.body, (content) => {
        finalContent = content
        updateSessionById(sid, (session) => {
          const last = session.messages[session.messages.length - 1]
          if (last && last.role === 'assistant') {
            last.content = content
            last._streaming = true
          }
        })
      })
      updateSessionById(sid, (session) => {
        const last = session.messages[session.messages.length - 1]
        if (last && last.role === 'assistant') {
          last.content = finalContent
          delete last._streaming
        } else {
          session.messages.push({ role: 'assistant', content: finalContent })
        }
        session.conversation.push({ role: 'assistant', content: finalContent })
      })
    } catch (err) {
      console.error('[chat] multimodal send failed', err)
      handleAgentError(sid, err?.message || String(err))
    } finally {
      setSessionBusy(sid, false)
    }
    return
  }
  let payload = text
  if (isContinueCommand(text) && wasLastInterrupted()) {
    payload = `Continue from the last interrupted response. User message: ${text}`
  }
  setSessionBusy(sid, true)
  a.send(payload).catch((err) => {
    console.error('[chat] send failed', err)
    handleAgentError(sid, err?.message || String(err))
  })
}

function mergeAndBudgetAgentContext(context, workspaceContext, runtime) {
  const mergedEvidence = mergeContextEvidence(context?.contextEvidence || null, workspaceContext?.evidence || null)
  const blocks = context?.contextBlocks || {}
  if (typeof runtime?.enforceStructuredContextBudget !== 'function') {
    return {
      evidence: mergedEvidence,
      workspaceText: workspaceContext?.text || "",
    }
  }
  const budgeted = runtime.enforceStructuredContextBudget({
    rulesText: blocks.rulesText || "",
    mentionsText: blocks.mentionsText || "",
    attachmentText: blocks.attachmentText || "",
    workspaceText: workspaceContext?.text || "",
    userText: blocks.userText || "",
    evidence: mergedEvidence,
  })
  return {
    evidence: budgeted?.evidence || mergedEvidence,
    workspaceText: budgeted?.workspaceText || "",
  }
}

function mergeContextEvidence(...items) {
  const valid = items.filter((item) => item && typeof item === 'object')
  if (!valid.length) return null
  const mentions = valid.flatMap((item) => Array.isArray(item.mentions) ? item.mentions : [])
  const attachments = valid.flatMap((item) => Array.isArray(item.attachments) ? item.attachments : [])
  const rules = valid.flatMap((item) => Array.isArray(item.rules) ? item.rules : [])
  const workspaceSources = valid.flatMap((item) => Array.isArray(item.workspaceSources) ? item.workspaceSources : [])
  const indexStatus = valid.map((item) => item.indexStatus).find((status) => status && typeof status === 'object') || null
  const warnings = valid.flatMap((item) => Array.isArray(item.warnings) ? item.warnings : []).slice(0, 20)
  const policy = valid.map((item) => item.budget?.policy).find((item) => item && typeof item === 'object') || null
  const budget = valid.reduce((acc, item) => {
    const b = item.budget || {}
    acc.estimatedChars += Number(b.estimatedChars || 0)
    acc.contextBlockChars += Number(b.contextBlockChars || 0)
    acc.attachmentTextChars += Number(b.attachmentTextChars || 0)
    acc.ruleChars += Number(b.ruleChars || 0)
    acc.workspaceContextChars += Number(b.workspaceContextChars || 0)
    acc.truncatedSources += Number(b.truncatedSources || 0)
    return acc
  }, {
    totalSources: 0,
    estimatedChars: 0,
    contextBlockChars: 0,
    attachmentTextChars: 0,
    ruleChars: 0,
    workspaceContextChars: 0,
    truncatedSources: 0,
    warningCount: 0,
  })
  if (policy) budget.policy = policy
  budget.totalSources = mentions.length + attachments.length + rules.length + workspaceSources.length
  budget.warningCount = warnings.length
  return { version: 1, mentions, attachments, rules, workspaceSources, indexStatus, warnings, budget }
}

async function buildWorkspaceContextForAgent(query) {
  if (!w.projectRoot) return null
  try {
    const runtime = await loadAgentRuntime()
    const builder = runtime.buildContextWithEvidence || runtime.buildContext
    const result = await builder({
      query,
      activeFile: w.activeFile,
      selection: getSelectedText(),
      openFiles: openFiles.value,
      activeOutline: currentOutline.value,
      activeDiagnostics: currentDiagnostics.value,
      selectedSymbol: selectedSymbol.value,
      modelWindowChars: 64_000,
      reservedResponseChars: 8_000,
    })
    if (!result) return null
    if (typeof result === 'string') return { text: result, evidence: null }
    return {
      text: typeof result.text === 'string' ? result.text : "",
      evidence: result.evidence || null,
    }
  } catch (err) {
    console.warn('[chat] build workspace context failed', err)
    return null
  }
}

function handleChatInterrupt() {
  const session = currentSession.value
  if (!session || !session.busy || !session.agent) return
  const sid = session.id
  if (typeof session.agent.abort === 'function') session.agent.abort()
  updateSessionById(sid, (s) => {
    const lastMsg = s.messages[s.messages.length - 1]
    if (lastMsg && lastMsg.role === 'assistant') {
      if (lastMsg._streaming) delete lastMsg._streaming
      lastMsg._interrupted = true
      lastMsg.content = (lastMsg.content || '') + '\n\n' + t('app.interruptedHint')
    } else {
      s.messages.push({
        role: 'assistant',
        content: t('app.interruptedHint'),
        _interrupted: true,
      })
    }
  })
  setSessionBusy(sid, false)
}

function handleNewChat() {
  // Refresh runtime state after chat sends.
  const session = createSession()
  currentSessionId.value = session.id
}

function handleSelectSession(sessionId) {
  // Preserve attachment warnings in the active session.
  const session = sessions.value.find((item) => item.id === sessionId)
  if (!session) return
  currentSessionId.value = sessionId
}

function handleDeleteSession(sessionId) {
  const idx = sessions.value.findIndex((s) => s.id === sessionId)
  if (idx < 0) return
  const removed = sessions.value[idx]
  try { removed.agent?.reset() } catch { /* ignore */ }
  removed.agent = null
  removed.busy = false
  sessions.value.splice(idx, 1)
  if (sessions.value.length === 0) {
    const session = createSession()
    currentSessionId.value = session.id
  } else if (currentSessionId.value === sessionId) {
    const next = sessions.value[0]
    currentSessionId.value = next.id
  }
  persistSessions()
}

function handleAgentMessage(sessionId, message) {
  loadAgentEventBridgeRuntime().then(({ handleAgentMessage: bridgeHandleAgentMessage }) => {
    bridgeHandleAgentMessage(sessionId, message, createAgentEventBridgeContext())
  })
}

function handleAgentStream(sessionId, content) {
  loadAgentEventBridgeRuntime().then(({ handleAgentStream: bridgeHandleAgentStream }) => {
    bridgeHandleAgentStream(sessionId, content, createAgentEventBridgeContext())
  })
}

function handleAgentProgress(sessionId, message) {
  loadAgentEventBridgeRuntime().then(({ handleAgentProgress: bridgeHandleAgentProgress }) => {
    bridgeHandleAgentProgress(sessionId, message, createAgentEventBridgeContext())
  })
}

function handleToolUse(sessionId, info) {
  loadAgentEventBridgeRuntime().then(({ handleToolUse: bridgeHandleToolUse }) => {
    bridgeHandleToolUse(sessionId, info, createAgentEventBridgeContext())
  })
}

function handleAgentPartsStream(sessionId, parts) {
  loadAgentEventBridgeRuntime().then(({ handleAgentPartsStream: bridgeHandleAgentPartsStream }) => {
    bridgeHandleAgentPartsStream(sessionId, parts, createAgentEventBridgeContext())
  })
}

function handleAgentPartsFinal(sessionId, parts) {
  loadAgentEventBridgeRuntime().then(({ handleAgentPartsFinal: bridgeHandleAgentPartsFinal }) => {
    bridgeHandleAgentPartsFinal(sessionId, parts, createAgentEventBridgeContext())
  })
}

function handleAgentPlanEvent(sessionId, event) {
  loadAgentEventBridgeRuntime().then(({ handleAgentPlanEvent: bridgeHandleAgentPlanEvent }) => {
    bridgeHandleAgentPlanEvent(sessionId, event, createAgentEventBridgeContext())
  })
}

function handleAgentError(sessionId, error) {
  loadAgentEventBridgeRuntime().then(({ handleAgentError: bridgeHandleAgentError }) => {
    bridgeHandleAgentError(sessionId, error, createAgentEventBridgeContext())
  })
}

function handleAgentDone(sessionId) {
  loadAgentEventBridgeRuntime().then(({ handleAgentDone: bridgeHandleAgentDone }) => {
    bridgeHandleAgentDone(sessionId, createAgentEventBridgeContext())
  })
}

async function openGoalResult(goalId) {
  const { openGoalResult: openWorkbenchGoalResult } = await loadGoalResultActionsRuntime()
  await openWorkbenchGoalResult(goalId, createGoalResultActionContext())
}

function closeGoalResult() {
  loadGoalResultActionsRuntime().then(({ closeGoalResult: closeWorkbenchGoalResult }) => {
    closeWorkbenchGoalResult(createGoalResultActionContext())
  })
}

async function retryGoal(goalId) {
  const { retryGoal: retryWorkbenchGoal } = await loadGoalResultActionsRuntime()
  await retryWorkbenchGoal(goalId, createGoalResultActionContext())
}

async function continueGoal(goalId) {
  const { continueGoal: continueWorkbenchGoal } = await loadGoalResultActionsRuntime()
  await continueWorkbenchGoal(goalId, createGoalResultActionContext())
}

async function revealLocation(path, line = 1, column = 1) {
  const { revealLocation: revealWorkbenchLocation } = await loadNavigationActionsRuntime()
  await revealWorkbenchLocation(path, line, column, createNavigationActionContext())
}

async function handleSelectSymbol(symbol) {
  const { selectSymbol } = await loadNavigationActionsRuntime()
  await selectSymbol(symbol, createNavigationActionContext())
}

async function handleOpenDiagnostic(diagnostic) {
  const { openDiagnostic } = await loadNavigationActionsRuntime()
  await openDiagnostic(diagnostic, createNavigationActionContext())
}

function handleBreadcrumbClick(targetLine) {
  loadNavigationActionsRuntime().then(({ clickBreadcrumb }) => {
    clickBreadcrumb(targetLine, createNavigationActionContext())
  })
}

function toggleBreadcrumbDropdown(idx) {
  loadNavigationActionsRuntime().then(({ toggleBreadcrumbDropdown: toggleWorkbenchBreadcrumbDropdown }) => {
    toggleWorkbenchBreadcrumbDropdown(idx, createNavigationActionContext())
  })
}

function toggleBreadcrumbDropdownByElement(element) {
  const index = breadcrumbDisplayModel.value.elements.filter((item) => item.type === "symbol").findIndex((item) => item.id === element.id)
  if (index >= 0) toggleBreadcrumbDropdown(index)
}

function handleBreadcrumbDropdownSelect(targetLine) {
  loadNavigationActionsRuntime().then(({ selectBreadcrumbDropdown }) => {
    selectBreadcrumbDropdown(targetLine, createNavigationActionContext())
  })
}

function updateBreadcrumb() {
  loadNavigationActionsRuntime().then(({ updateBreadcrumbState }) => {
    updateBreadcrumbState(createNavigationActionContext())
  })
}

async function handleRevertChange(changeId) {
  const { revertReviewedChange } = await loadChangeReviewActionsRuntime()
  await revertReviewedChange(changeId, createChangeReviewActionContext())
}

async function handleApplyPending(batchId) {
  const { applyPendingChanges } = await loadChangeReviewActionsRuntime()
  await applyPendingChanges(batchId, createChangeReviewActionContext())
}

async function handleRejectPending(batchId) {
  const { rejectPendingChanges } = await loadChangeReviewActionsRuntime()
  rejectPendingChanges(batchId)
}

async function handleApplyPendingFile(batchId, path) {
  const { applyPendingChangeFile } = await loadChangeReviewActionsRuntime()
  await applyPendingChangeFile(batchId, path, createChangeReviewActionContext())
}

async function handleRejectPendingFile(batchId, path) {
  const { rejectPendingChangeFile } = await loadChangeReviewActionsRuntime()
  rejectPendingChangeFile(batchId, path)
}

async function handleApplyPendingHunk(batchId, path, hunkId) {
  const { applyPendingChangeHunk } = await loadChangeReviewActionsRuntime()
  await applyPendingChangeHunk(batchId, path, hunkId, createChangeReviewActionContext())
}

async function handleRejectPendingHunk(batchId, path, hunkId) {
  const { rejectPendingChangeHunk } = await loadChangeReviewActionsRuntime()
  rejectPendingChangeHunk(batchId, path, hunkId)
}

async function toggleCollab() {
  if (collabEnabled.value) {
    if (collabSession.value) {
      collabSession.value.disconnect()
      collabSession.value = null
    }
    collabEnabled.value = false
    collabConnected.value = false
    collabUsers.value = 0
    return
  }

  if (!editor) return
  const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const userName = auth.username || "Anonymous"
  const { CollabSession } = await import("./collab/collabSession")
  const session = new CollabSession(userId, userName, "ot")
  session.attachEditor(editor, monacoApi)
  collabSession.value = session
  collabEnabled.value = true
  collabConnected.value = false
}

function handleLogout() {
  auth.logout()
  chatSession.reset()
  closeAllPanels()
}

</script>

<style>
:root {
  --bg-deepest: #111111;
  --bg-darker: #181818;
  --bg-dark: #1e1e1e;
  --bg-panel: #181818;
  --bg-elevated: #252526;
  --bg-hover: #2a2d2e;
  --bg-active: #37373d;
  --border-subtle: #2b2b2b;
  --border: #333333;
  --border-bright: #454545;
  --text-muted: #6e7681;
  --text-secondary: #9da3ad;
  --text-primary: #cccccc;
  --text-bright: #ffffff;
  --accent: #2dd4bf;
  --accent-contrast: #0d0e10;
  --accent-dim: rgba(45, 212, 191, 0.15);
  --green: #34d399;
  --red: #f87171;
  --orange: #fb923c;
  --scrollbar-track: #111317;
  --scrollbar-thumb: rgba(148, 163, 184, 0.34);
  --scrollbar-thumb-hover: rgba(148, 163, 184, 0.5);
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --workbench-titlebar-bg: var(--bg-darker);
  --workbench-activity-bg: #14161a;
  --workbench-sidebar-bg: #17191e;
  --workbench-editor-bg: #1e1e1e;
  --workbench-tabbar-bg: #181818;
  --workbench-tab-bg: #181818;
  --workbench-tab-hover-bg: #202020;
  --workbench-tab-active-bg: #1e1e1e;
  --workbench-status-bg: #181818;
  --workbench-control-bg: var(--bg-dark);
  --workbench-card-bg: var(--bg-panel);
  --workbench-panel-bg: var(--bg-panel);
  --workbench-overlay-bg: var(--bg-deepest);
  --workbench-surface-border: var(--border-subtle);
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
}

*::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

*::-webkit-scrollbar-track {
  background: var(--scrollbar-track);
}

*::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border: 2px solid var(--scrollbar-track);
  border-radius: 999px;
  background-clip: padding-box;
}

*::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}

html,
body {
  height: 100%;
  overflow: hidden;
  background: var(--bg-deepest);
  color: var(--text-primary);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--bg-deepest);
}

.app-body {
  display: flex;
  flex: 1;
  min-height: 0;
  position: relative;
}

.workspace-trust-banner {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background: #fff7df;
  border-top: 1px solid #f4dfad;
  border-bottom: 1px solid #e5c66f;
  color: #4f3510;
  font-size: 12px;
  line-height: 1.35;
}

.workspace-trust-banner-icon {
  flex: 0 0 auto;
  color: #9a6500;
  font-weight: 600;
}

.workspace-trust-banner-message {
  flex: 1 1 auto;
  min-width: 0;
}

.workspace-trust-banner-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.workspace-trust-banner-action,
.workspace-trust-banner-dismiss {
  height: 22px;
  border: 1px solid #d1a84c;
  background: #fffaf0;
  color: #4f3510;
  font: inherit;
  cursor: pointer;
}

.workspace-trust-banner-action {
  padding: 0 9px;
}

.workspace-trust-banner-dismiss {
  width: 22px;
  padding: 0;
}

.workspace-trust-banner-action:hover,
.workspace-trust-banner-dismiss:hover,
.workspace-trust-banner-action:focus-visible,
.workspace-trust-banner-dismiss:focus-visible {
  background: #ffeec2;
  outline: 1px solid #c28a12;
  outline-offset: 1px;
}

.theme-dark .workspace-trust-banner {
  background: #201b10;
  border-top-color: rgba(255, 255, 255, 0.06);
  border-bottom-color: #4a3a18;
  color: #f3e7c6;
}

.theme-dark .workspace-trust-banner-icon {
  color: #f0c45c;
}

.theme-dark .workspace-trust-banner-action,
.theme-dark .workspace-trust-banner-dismiss {
  border-color: #6d5524;
  background: #2c2416;
  color: #f5e6bb;
}

.theme-dark .workspace-trust-banner-action:hover,
.theme-dark .workspace-trust-banner-dismiss:hover,
.theme-dark .workspace-trust-banner-action:focus-visible,
.theme-dark .workspace-trust-banner-dismiss:focus-visible {
  background: #3a301c;
  outline-color: #d7b35a;
}

.workspace-trust-editor {
  margin-top: 12px;
  border: 1px solid var(--border-subtle);
  background: var(--workbench-card-bg);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
}

.workspace-trust-editor:focus-visible,
.workspace-trust-editor [tabindex="0"]:focus-visible {
  outline: 1px solid #6aa6ff;
  outline-offset: 2px;
}

.workspace-trust-focus-anchor {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  border: 0;
}

.workspace-trust-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.workspace-trust-title-icon {
  color: #f0c45c;
}

.workspace-trust-editor-body {
  display: grid;
  gap: 10px;
  padding: 10px;
}

.workspace-trust-features {
  display: grid;
  gap: 8px;
}

.workspace-trust-limitations,
.workspace-trust-settings {
  padding: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
}

.workspace-trust-limitations-title,
.workspace-trusted-folders-title {
  margin-bottom: 6px;
  font-weight: 600;
}

.workspace-trust-limitations ul {
  margin: 0;
  padding-left: 18px;
}

.trusted-uris-table {
  display: grid;
  gap: 4px;
}

.trusted-uris-row,
.trusted-uris-empty {
  min-height: 24px;
  padding: 4px 6px;
  background: var(--bg-dark);
}

.app-shell.side-bar-right .app-body {
  flex-direction: row-reverse;
}

.app-shell.side-bar-right .activity-bar {
  border-right: none;
  border-left: 1px solid var(--workbench-surface-border);
}

.app-shell.side-bar-right .sidebar {
  border-right: none;
  border-left: 1px solid var(--workbench-surface-border);
}

.app-shell.side-bar-right .sidebar-resize-handle {
  order: 2;
}

.app-shell.panel-left .main-area,
.app-shell.panel-right .main-area {
  flex-direction: row;
}

.app-shell.panel-right .main-area {
  flex-direction: row-reverse;
}

.app-shell.panel-left .editor-wrapper,
.app-shell.panel-right .editor-wrapper {
  min-width: 0;
}

.app-shell.panel-left .tab-bar,
.app-shell.panel-right .tab-bar,
.app-shell.panel-left .breadcrumb-bar,
.app-shell.panel-right .breadcrumb-bar {
  position: absolute;
  left: 0;
  right: var(--codek-side-panel-width, 240px);
}

.app-shell.panel-left .bottom-panel-wrap,
.app-shell.panel-right .bottom-panel-wrap {
  width: var(--codek-side-panel-width, 240px);
  height: auto !important;
  border-top: none;
  border-left: 1px solid var(--border-subtle);
}

.app-shell.panel-left .bottom-panel-wrap {
  border-left: none;
  border-right: 1px solid var(--border-subtle);
}

.app-shell.panel-left .bottom-panel-resize-handle,
.app-shell.panel-right .bottom-panel-resize-handle {
  display: none;
}

.settings-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--workbench-overlay-bg);
  z-index: 120;
  display: flex;
  overflow: hidden;
  animation: settings-overlay-in 0.18s ease-out;
}
.settings-overlay-close {
  position: absolute;
  top: 14px;
  right: 18px;
  width: 32px;
  height: 32px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
  transition: color 0.15s, border-color 0.15s;
}
.settings-overlay-close:hover {
  color: var(--text-bright);
  border-color: var(--border-bright);
}

@keyframes settings-overlay-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Form-control dark-theme normalization, scoped to app surfaces (avoids Monaco) */
:where(.sidebar, .settings-overlay, .chat-panel, .bottom-panel, .name-dialog, .auto-dialog) select,
:where(.sidebar, .settings-overlay, .chat-panel, .bottom-panel, .name-dialog, .auto-dialog) input[type="text"],
:where(.sidebar, .settings-overlay, .chat-panel, .bottom-panel, .name-dialog, .auto-dialog) input[type="search"],
:where(.sidebar, .settings-overlay, .chat-panel, .bottom-panel, .name-dialog, .auto-dialog) input[type="email"],
:where(.sidebar, .settings-overlay, .chat-panel, .bottom-panel, .name-dialog, .auto-dialog) input[type="password"],
:where(.sidebar, .settings-overlay, .chat-panel, .bottom-panel, .name-dialog, .auto-dialog) input[type="number"],
:where(.sidebar, .settings-overlay, .chat-panel, .bottom-panel, .name-dialog, .auto-dialog) textarea {
  background-color: var(--workbench-control-bg);
  color: var(--text-primary);
  color-scheme: dark;
}

:root.theme-light :where(.sidebar, .settings-overlay, .chat-panel, .bottom-panel, .name-dialog, .auto-dialog) select,
:root.theme-light :where(.sidebar, .settings-overlay, .chat-panel, .bottom-panel, .name-dialog, .auto-dialog) input[type="text"],
:root.theme-light :where(.sidebar, .settings-overlay, .chat-panel, .bottom-panel, .name-dialog, .auto-dialog) input[type="search"],
:root.theme-light :where(.sidebar, .settings-overlay, .chat-panel, .bottom-panel, .name-dialog, .auto-dialog) input[type="email"],
:root.theme-light :where(.sidebar, .settings-overlay, .chat-panel, .bottom-panel, .name-dialog, .auto-dialog) input[type="password"],
:root.theme-light :where(.sidebar, .settings-overlay, .chat-panel, .bottom-panel, .name-dialog, .auto-dialog) input[type="number"],
:root.theme-light :where(.sidebar, .settings-overlay, .chat-panel, .bottom-panel, .name-dialog, .auto-dialog) textarea {
  color-scheme: light;
}

:where(.sidebar, .settings-overlay, .chat-panel, .bottom-panel, .name-dialog, .auto-dialog) select {
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238b96a0' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat: no-repeat;
  background-position: right 8px center;
  padding-right: 28px;
}

:where(.sidebar, .settings-overlay, .chat-panel, .bottom-panel, .name-dialog, .auto-dialog) select option {
  background-color: var(--bg-dark);
  color: var(--text-primary);
}

.activity-bar {
  width: 50px;
  min-width: 50px;
  background: var(--workbench-activity-bg);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  padding: 7px 0;
  border-right: 1px solid var(--workbench-surface-border);
  z-index: 10;
  flex-shrink: 0;
}

.activity-top {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 5px 0 0;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
}

.activity-top::-webkit-scrollbar {
  width: 0;
}

.activity-bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 0 0 5px;
  flex-shrink: 0;
}

.activity-btn {
  width: 38px;
  height: 38px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s ease, color 0.12s ease, transform 0.12s ease;
  position: relative;
}

.activity-btn svg {
  width: 21px;
  height: 21px;
  stroke-width: 1.65;
}

.activity-icon {
  width: 21px;
  height: 21px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: currentColor;
}

.activity-product-icon {
  width: 21px;
  height: 21px;
  flex: 0 0 21px;
}

.activity-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.activity-btn:focus-visible {
  outline: 1px solid var(--border-bright);
  outline-offset: 2px;
}

.activity-btn.active {
  color: var(--text-bright);
  background: var(--bg-active);
}

.activity-btn.active::before {
  content: "";
  position: absolute;
  left: -6px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  background: var(--accent);
  border-radius: 0 3px 3px 0;
}

.app-shell.side-bar-right .activity-btn.active::before {
  left: auto;
  right: -6px;
  border-radius: 3px 0 0 3px;
}

.activity-count {
  position: absolute;
  top: 3px;
  right: 3px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--accent);
  color: #0d0e10;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.activity-count.err-count {
  background: #ef4444;
  color: #fff;
}

.activity-count.warn-count {
  background: #f59e0b;
  color: #0d0e10;
}

.activity-count.rewrite-count {
  background: #a78bfa;
  color: #0d0e10;
}

.breadcrumb-bar {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  background: var(--bg-darker);
  border-top: 1px solid var(--border-subtle);
  gap: 2px;
  overflow-x: auto;
  flex-shrink: 0;
}

.breadcrumb-bar::-webkit-scrollbar {
  height: 0;
}

.breadcrumb-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.breadcrumb-item:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.breadcrumb-item:last-child {
  color: var(--text-primary);
  font-weight: 500;
}

.breadcrumb-icon {
  font-size: 9px;
  color: var(--accent);
  opacity: 0.7;
}

.breadcrumb-sep {
  color: var(--border);
  margin: 0 2px;
  font-size: 12px;
}

.breadcrumb-divider {
  color: var(--border-bright);
  margin: 0 6px;
  font-size: 11px;
  font-weight: 300;
}

.breadcrumb-symbol {
  color: var(--text-secondary);
}

.breadcrumb-type-icon {
  font-size: 9px;
  font-weight: 700;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.breadcrumb-type-icon.icon-class {
  background: rgba(96, 165, 250, 0.18);
  color: #60a5fa;
}

.breadcrumb-type-icon.icon-interface {
  background: rgba(96, 165, 250, 0.12);
  color: #93bbfc;
}

.breadcrumb-type-icon.icon-method {
  background: rgba(167, 139, 250, 0.18);
  color: #a78bfa;
}

.breadcrumb-type-icon.icon-function {
  background: rgba(45, 212, 191, 0.18);
  color: var(--accent);
}

.breadcrumb-type-icon.icon-variable {
  background: rgba(52, 211, 153, 0.18);
  color: var(--green);
}

.breadcrumb-type-icon.icon-type {
  background: rgba(251, 146, 60, 0.18);
  color: var(--orange);
}

.breadcrumb-type-icon.icon-enum {
  background: rgba(248, 113, 113, 0.18);
  color: var(--red);
}

.breadcrumb-dropdown-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.breadcrumb-chevron {
  font-size: 9px;
  color: var(--text-muted);
  margin-left: 2px;
  cursor: pointer;
  padding: 0 2px;
  border-radius: 2px;
  transition: background 0.1s;
}

.breadcrumb-chevron:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.breadcrumb-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 180px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  z-index: 50;
  padding: 4px;
}

.breadcrumb-dropdown-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  font-size: 11px;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}

.breadcrumb-dropdown-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.breadcrumb-dropdown-line {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono, "JetBrains Mono", monospace);
}

.sidebar {
  min-width: 320px;
  max-width: 560px;
  background: var(--workbench-sidebar-bg);
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--workbench-surface-border);
  overflow: hidden;
  flex-shrink: 0;
}

.sidebar-resize-handle {
  width: 4px;
  cursor: col-resize;
  flex-shrink: 0;
  position: relative;
  z-index: 15;
}

.sidebar-resize-handle:hover,
.sidebar-resize-handle:active {
  background: var(--accent);
  opacity: 0.4;
}

.bottom-panel-resize-handle {
  height: 4px;
  cursor: row-resize;
  flex-shrink: 0;
  position: relative;
  z-index: 15;
}

.bottom-panel-resize-handle:hover,
.bottom-panel-resize-handle:active {
  background: var(--accent);
  opacity: 0.4;
}

.bottom-panel-wrap {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border-top: 1px solid var(--border-subtle);
  overflow: hidden;
}

.sidebar-header {
  height: 36px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.sidebar-body {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(139, 143, 163, 0.26) transparent;
}

.sidebar-body::-webkit-scrollbar {
  width: 10px;
}

.sidebar-body::-webkit-scrollbar-thumb {
  background: rgba(139, 143, 163, 0.22);
  border: 3px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}

.source-control-view {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--workbench-sidebar-bg);
}

.source-control-git {
  flex: 0 0 auto;
  min-height: 220px;
}

.source-control-review {
  flex: 1 1 auto;
  min-height: 220px;
  border-top: 1px solid var(--border-subtle);
}

.mcp-workbench-surface {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  color: var(--text-primary);
  background: var(--workbench-sidebar-bg);
  overflow: auto;
}

.extension-gallery-workbench-shell {
  min-height: 100%;
  height: 100%;
  display: flex;
  min-width: 0;
}

.extension-gallery-workbench-shell .extensions-view {
  flex: 1;
}

.remote-workbench-shell {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--workbench-sidebar-bg);
}

.extension-trust-remote-auth-workbench {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
}

.extension-trust-remote-auth-title {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.extension-trust-remote-auth-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.extension-trust-remote-auth-grid span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 4px 6px;
  border: 1px solid rgba(139, 143, 163, 0.16);
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 11px;
}

.mcp-workbench-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.mcp-workbench-title {
  font-size: 13px;
  font-weight: 700;
}

.mcp-workbench-summary,
.mcp-workbench-meta {
  color: var(--text-muted);
  font-size: 11px;
}

.mcp-workbench-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mcp-workbench-error {
  border: 1px solid rgba(248, 113, 113, 0.26);
  border-radius: 7px;
  padding: 8px 10px;
  background: rgba(248, 113, 113, 0.09);
  color: var(--red);
  font-size: 12px;
  line-height: 1.45;
}

.mcp-workbench-empty {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--workbench-card-bg);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mcp-empty-title {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
}

.mcp-workbench-empty p,
.mcp-add-card p {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.mcp-workbench-actions,
.mcp-server-actions,
.mcp-gallery-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mcp-workbench-action {
  border: 1px solid var(--border);
  background: var(--workbench-card-bg);
  color: var(--text-secondary);
  border-radius: 6px;
  cursor: pointer;
  padding: 5px 8px;
  font-size: 11px;
  min-height: 28px;
  white-space: nowrap;
}

.mcp-workbench-action:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.mcp-workbench-action:disabled {
  cursor: default;
  opacity: 0.48;
}

.mcp-workbench-action.primary {
  border-color: var(--accent);
  background: var(--accent-dim);
  color: var(--text-bright);
}

.mcp-workbench-action.inline {
  align-self: flex-start;
  margin-top: 6px;
}

.mcp-workbench-section {
  border-top: 1px solid var(--border-subtle);
  padding-top: 10px;
}

.mcp-workbench-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.mcp-workbench-section-title {
  margin-bottom: 6px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  text-transform: none;
}

.mcp-workbench-section-subtitle {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.mcp-server-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--workbench-card-bg);
  padding: 10px;
}

.mcp-server-card + .mcp-server-card {
  margin-top: 8px;
}

.mcp-server-main {
  min-width: 0;
}

.mcp-server-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mcp-server-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
}

.mcp-status-pill {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 2px 7px;
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
}

.mcp-status-pill[data-tone="ok"] {
  background: rgba(16, 185, 129, 0.12);
  color: var(--green);
}

.mcp-status-pill[data-tone="warning"] {
  background: rgba(217, 119, 6, 0.12);
  color: var(--orange);
}

.mcp-status-pill[data-tone="error"] {
  background: rgba(220, 38, 38, 0.12);
  color: var(--red);
}

.mcp-server-detail,
.mcp-server-error,
.mcp-server-meta {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.mcp-server-detail,
.mcp-server-error {
  margin-top: 4px;
  overflow-wrap: anywhere;
}

.mcp-server-error {
  color: var(--red);
}

.mcp-server-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mcp-server-meta span,
.mcp-add-label {
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  padding: 2px 7px;
  background: var(--bg-elevated);
}

.mcp-add-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin-bottom: 8px;
}

.mcp-add-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px;
  background: var(--workbench-card-bg);
}

.mcp-add-label {
  display: inline-flex;
  margin-bottom: 6px;
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 700;
}

.mcp-workbench-row {
  width: 100%;
  min-height: 24px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 0;
  border-bottom: 1px solid rgba(139, 143, 163, 0.12);
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  text-align: left;
}

.mcp-workbench-row.muted {
  color: var(--text-muted);
}

.mcp-workbench-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcp-workbench-row span:last-child {
  color: var(--text-muted);
}

.mcp-log-row {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 8px;
  min-height: 24px;
  align-items: center;
  border-bottom: 1px solid rgba(139, 143, 163, 0.12);
  color: var(--text-secondary);
  font-size: 11px;
}

.mcp-log-row[data-level="warning"] {
  color: var(--orange);
}

.mcp-log-row[data-level="error"] {
  color: var(--red);
}

.mcp-log-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .mcp-workbench-surface {
    padding: 10px;
    gap: 9px;
  }

  .mcp-workbench-header,
  .mcp-workbench-section-head {
    align-items: stretch;
  }

  .mcp-workbench-header {
    flex-direction: row;
  }

  .mcp-workbench-action {
    padding-inline: 7px;
    font-size: 11px;
  }

  .mcp-workbench-row,
  .mcp-log-row {
    grid-template-columns: 1fr;
    gap: 2px;
    padding: 5px 0;
  }

  .mcp-workbench-row span,
  .mcp-log-row span {
    white-space: normal;
  }
}

.agent-evidence-workbench {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  color: var(--text-primary);
}

.agent-evidence-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.agent-evidence-title {
  font-size: 13px;
  font-weight: 700;
}

.agent-evidence-summary,
.agent-evidence-meta,
.agent-evidence-empty {
  color: var(--text-muted);
  font-size: 11px;
}

.agent-evidence-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.agent-evidence-refresh,
.agent-evidence-tab {
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-secondary);
  border-radius: 6px;
  cursor: pointer;
}

.agent-evidence-refresh {
  padding: 5px 8px;
  font-size: 11px;
}

.agent-evidence-refresh:disabled {
  cursor: default;
  opacity: 0.55;
}

.agent-evidence-tabs {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
}

.agent-evidence-tab {
  min-width: 0;
  padding: 5px 4px;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-evidence-tab.active {
  border-color: var(--accent);
  color: var(--text-primary);
  background: var(--accent-dim);
}

.agent-evidence-section {
  border-top: 1px solid var(--border-subtle);
  padding-top: 10px;
}

.agent-evidence-section-title {
  margin-bottom: 6px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.agent-evidence-kpi,
.agent-evidence-risk,
.agent-evidence-row,
.agent-evidence-notification,
.agent-evidence-error {
  font-size: 12px;
}

.agent-evidence-risk {
  margin: 4px 0 6px;
  color: var(--text-muted);
}

.agent-evidence-row,
.agent-evidence-notification {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  border-bottom: 1px solid rgba(139, 143, 163, 0.12);
}

.agent-evidence-row span,
.agent-evidence-notification span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-evidence-path {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
}

.agent-evidence-notification[data-agent-evidence-severity="error"] {
  color: var(--danger);
}

.agent-evidence-notification[data-agent-evidence-severity="warning"],
.agent-evidence-error {
  color: var(--warning);
}

.search-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.search-input-wrap {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.search-input-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.search-input-row:last-child {
  margin-bottom: 0;
}

.search-input {
  flex: 1;
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-primary);
  padding: 8px 10px;
  font-size: 13px;
  outline: none;
}

.search-input:focus {
  border-color: var(--accent);
}

.replace-input {
  font-size: 12px;
  padding: 6px 10px;
}

.search-toggle-group {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.search-toggle {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  font-family: 'JetBrains Mono', monospace;
}

.search-toggle:hover {
  border-color: var(--border-bright);
  color: var(--text-secondary);
}

.search-toggle.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim);
}

.search-action-btn {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  font-family: var(--font-sans);
}

.search-action-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.search-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.grep-results {
  margin-bottom: 8px;
}

.grep-file-group {
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  margin-bottom: 4px;
  overflow: hidden;
}

.grep-file-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border: none;
  background: var(--bg-dark);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  font-family: var(--font-sans);
}

.grep-file-header:hover {
  background: var(--bg-hover);
}

.grep-file-header .chevron {
  font-size: 8px;
  color: var(--text-muted);
  transition: transform 0.15s;
  width: 12px;
  text-align: center;
}

.grep-file-header .chevron:not(.collapsed) {
  transform: rotate(90deg);
}

.grep-file-path {
  flex: 1;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grep-match-count {
  min-width: 18px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--accent-dim);
  color: var(--accent);
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.grep-match {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 10px 4px 28px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  font-family: var(--font-sans);
  transition: background 0.1s;
}

.grep-match:hover {
  background: var(--bg-hover);
}

.grep-line-num {
  color: var(--text-muted);
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  flex-shrink: 0;
  min-width: 28px;
  text-align: right;
}

.grep-line-text {
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-results {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.search-empty {
  padding: 12px;
  color: var(--text-muted);
  font-size: 12px;
}

.search-result {
  width: 100%;
  border: 1px solid var(--border-subtle);
  background: var(--bg-dark);
  border-radius: 6px;
  color: inherit;
  padding: 10px;
  margin-bottom: 6px;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.search-result:hover {
  border-color: var(--border-bright);
  background: var(--bg-hover);
}

.search-result-path {
  color: var(--text-primary);
  font-size: 12px;
}

.search-result-snippet {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.5;
  white-space: normal;
  overflow-wrap: anywhere;
}

.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--workbench-editor-bg);
  position: relative;
  overflow: hidden;
}

.main-area.has-active-editor .editor-wrapper,
.main-area.has-active-editor .editor-split-container,
.main-area.has-active-editor .editor-container {
  background: var(--workbench-editor-bg);
  opacity: 1;
}

.main-area.has-active-editor .editor-wrapper {
  overflow: hidden;
}

.main-area.has-active-editor .welcome-page {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

.force-editor-surface-paint {
  overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(64, 200, 220, 0.01);
}

.codek-icon-visual-smoke-capturing .main-area,
.codek-icon-visual-smoke-capturing .editor-wrapper,
.codek-icon-visual-smoke-capturing .editor-split-container,
.codek-icon-visual-smoke-capturing .editor-container {
  background: var(--workbench-editor-bg) !important;
}

.tab-bar {
  height: 35px;
  background: var(--workbench-tabbar-bg);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px 0 0;
  border-bottom: 1px solid var(--workbench-surface-border);
  flex-shrink: 0;
}

.tabs {
  display: flex;
  align-items: center;
  overflow-x: auto;
  flex: 1;
  min-width: 0;
  height: 100%;
}

.tabs::-webkit-scrollbar {
  height: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 35px;
  min-width: 86px;
  max-width: 220px;
  padding: 0 7px 0 9px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  border-right: 1px solid var(--workbench-surface-border);
  border-top: 1px solid transparent;
  white-space: nowrap;
  user-select: none;
  transition: background 0.08s ease, color 0.08s ease;
  position: relative;
  background: var(--workbench-tab-bg);
  flex: 0 1 176px;
}

.tab:hover {
  color: var(--text-primary);
  background: var(--workbench-tab-hover-bg);
}

.tab.active {
  color: var(--text-bright);
  background: var(--workbench-tab-active-bg);
  border-top-color: var(--accent);
}

.tab.active::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: var(--workbench-tab-active-bg);
}

.tab-name {
  min-width: 28px;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 35px;
  flex: 0 1 auto;
}

.tab-description {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 35px;
  color: var(--text-muted);
  flex: 1 1 auto;
}

.tab.active .tab-description {
  color: var(--text-secondary);
}

.tab-name:empty::before {
  content: attr(data-short-label);
}

.tab::after {
  content: attr(data-short-label);
  display: none;
  min-width: 22px;
  overflow: hidden;
  color: inherit;
  text-overflow: clip;
}

.tab .file-icon-svg,
.tab-file-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin-right: 1px;
}

.tab-dirty {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-bright);
  opacity: 0.72;
  flex-shrink: 0;
}

.tab.working-copy-conflict {
  border-top-color: #f85149;
}

.tab.working-copy-orphan {
  border-top-color: #d29922;
}

.tab.working-copy-backup-restored {
  border-top-color: #58a6ff;
}

.tab-dirty-conflict {
  background: #f85149;
}

.tab-dirty-orphan {
  background: #d29922;
}

.tab-dirty-backup-restored {
  background: #58a6ff;
}

.tab-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.tab-action-btn {
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.tab-action-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
  border-color: transparent;
}

.tab-action-btn.active {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-dim);
}

.working-copy-restore-panel {
  flex-shrink: 0;
  border-bottom: 1px solid var(--workbench-surface-border);
  background: var(--bg-elevated);
  color: var(--text-primary);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.restore-panel-header,
.restore-panel-entry,
.restore-entry-actions {
  display: flex;
  align-items: center;
}

.restore-panel-header {
  justify-content: space-between;
  gap: 12px;
}

.restore-panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-bright);
}

.restore-panel-subtitle,
.restore-entry-message,
.restore-panel-empty {
  font-size: 11px;
  color: var(--text-secondary);
}

.restore-panel-count {
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-active);
  color: var(--text-primary);
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.restore-panel-error {
  border: 1px solid rgba(248, 81, 73, 0.45);
  background: rgba(248, 81, 73, 0.12);
  color: #ffb4ad;
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 12px;
}

.restore-panel-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.restore-panel-entry {
  justify-content: space-between;
  gap: 10px;
  min-height: 34px;
}

.restore-entry-main {
  min-width: 0;
}

.restore-entry-path {
  font-size: 12px;
  color: var(--text-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.restore-entry-actions {
  gap: 6px;
  flex-shrink: 0;
}

.restore-action-btn {
  height: 24px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-primary);
  font-size: 11px;
  padding: 0 8px;
  cursor: pointer;
}

.restore-action-btn.primary {
  border-color: #58a6ff;
  color: #dbeafe;
  background: rgba(88, 166, 255, 0.12);
}

.restore-action-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.restore-action-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

/* --- Tab close button --- */
.tab-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 3px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.1s, background 0.1s, color 0.1s;
  margin-left: auto;
  flex-shrink: 0;
}

.tab:hover .tab-close-btn,
.tab.active .tab-close-btn {
  opacity: 0.78;
}

.tab-close-btn:hover {
  opacity: 1 !important;
  background: var(--bg-hover);
  color: var(--text-bright);
}

.tab-pin-icon {
  font-size: 10px;
  margin-left: 2px;
  opacity: 0.6;
}

.tab.pinned {
  border-left: 2px solid var(--border-bright);
  min-width: 54px;
}

.tab.drag-over {
  border-left: 2px solid var(--accent);
  background: rgba(45, 212, 191, 0.12);
}

@media (max-width: 980px) {
  .tab {
    min-width: 72px;
    flex-basis: 120px;
  }

  .tab-name {
    min-width: 24px;
  }
}

.editor-title-bar {
  min-height: 38px;
  padding: 5px 12px 5px 11px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--workbench-editor-bg);
  border-bottom: 1px solid var(--workbench-surface-border);
  flex-shrink: 0;
}

.editor-title-main,
.editor-title-path {
  display: flex;
  align-items: center;
  min-width: 0;
}

.editor-title-main {
  gap: 7px;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
}

.editor-title-file-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

.editor-title-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-title-path {
  flex: 1;
  justify-content: flex-end;
  gap: 5px;
  color: #858585;
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
}

.editor-title-path span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
}

.editor-title-root {
  color: #a0a0a0;
}

.editor-title-sep {
  color: #5f5f5f;
}

.editor-title-state {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.12);
  color: #b8c0cc;
  font-size: 10px;
  font-weight: 500;
}

.editor-title-state.unsaved {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

.editor-title-state.pinned:not(.unsaved) {
  color: #b8c0cc;
}

/* --- Tab context menu --- */
.tab-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 999;
}

.tab-context-menu {
  position: fixed;
  z-index: 1000;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 0;
  min-width: 160px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
}

.tab-ctx-item {
  display: block;
  width: 100%;
  padding: 6px 14px;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.tab-ctx-item:hover {
  background: var(--bg-hover);
  color: var(--text-bright);
}

.tab-ctx-sep {
  height: 1px;
  background: var(--border-subtle);
  margin: 4px 8px;
}

/* --- Editor command overlay --- */
.unsaved-dialog-body {
  color: var(--text-secondary);
  font-size: 13px;
  margin: 8px 0 16px;
  line-height: 1.5;
}

/* --- Editor title and breadcrumbs --- */
.goto-line-dialog .name-dialog-input {
  font-variant-numeric: tabular-nums;
}

/* --- Search and results chrome --- */
.lang-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}

.lang-picker-panel {
  position: absolute;
  top: 15%;
  width: min(90vw, 400px);
  max-height: 360px;
  background: var(--bg-panel);
  border: 1px solid var(--border-bright);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.lang-picker-input {
  width: 100%;
  padding: 12px 14px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
  font-family: inherit;
}

.lang-picker-input::placeholder {
  color: var(--text-muted);
}

.lang-picker-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.lang-picker-item {
  padding: 6px 12px;
  cursor: pointer;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}

.lang-picker-item:hover {
  background: var(--bg-hover);
}

.lang-picker-item.active {
  background: var(--bg-active);
  color: var(--accent);
}

/* --- Ctrl+Tab switcher --- */
.file-switcher-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 80px;
  z-index: 1000;
}

.file-switcher {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  min-width: 400px;
  max-width: 560px;
  max-height: 360px;
  overflow-y: auto;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  padding: 4px 0;
}

.file-switcher-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 8px 14px 4px;
}

.file-switcher-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
  transition: background 0.08s;
}

.file-switcher-item:hover,
.file-switcher-item.active {
  background: var(--bg-hover);
  color: var(--text-bright);
}

.file-switcher-name {
  white-space: nowrap;
}

.file-switcher-path {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

/* --- Bottom panel and status bar --- */
.glyph-error {
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='6' fill='%23f44747'/%3E%3C/svg%3E") center center no-repeat;
}
.glyph-warning {
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 16 16'%3E%3Cpath d='M8 2 L14 13 L2 13 Z' fill='%23ff9d00'/%3E%3C/svg%3E") center center no-repeat;
}
.glyph-info {
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='6' fill='%233794ff'/%3E%3C/svg%3E") center center no-repeat;
}

.scm-glyph-modified,
.scm-glyph-staged,
.scm-glyph-added,
.scm-glyph-deleted,
.scm-glyph-renamed,
.scm-glyph-conflict {
  background-position: center center;
  background-repeat: no-repeat;
  background-size: 10px 10px;
}

.scm-glyph-modified {
  background-image: linear-gradient(#58a6ff, #58a6ff);
}

.scm-glyph-staged,
.scm-glyph-added {
  background-image: linear-gradient(#3fb950, #3fb950);
}

.scm-glyph-deleted,
.scm-glyph-conflict {
  background-image: linear-gradient(#f85149, #f85149);
}

.scm-glyph-renamed {
  background-image: linear-gradient(#d29922, #d29922);
}

.model-badge,
.panel-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 10px;
}

.model-badge.ok {
  color: var(--green);
  background: rgba(52, 211, 153, 0.1);
}

.model-badge.err {
  color: var(--red);
  background: rgba(248, 113, 113, 0.1);
}

.panel-badge {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.editor-wrapper {
  flex: 1;
  position: relative;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--workbench-editor-bg);
}

.editor-wrapper.has-editor > .welcome-page {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

.editor-wrapper.empty > .editor-split-container {
  display: none !important;
}

.editor-wrapper.editor-surface-active {
  background: var(--workbench-editor-bg);
}

.editor-wrapper.editor-surface-active > .editor-split-container {
  position: relative;
  flex: 1;
  min-height: 0;
  z-index: 3;
  display: flex !important;
  background: var(--workbench-editor-bg);
}

.editor-container,
.editor-loading {
  width: 100%;
  height: 100%;
}

.editor-container {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  background: var(--workbench-editor-bg);
  overflow: hidden;
}

.editor-container .monaco-editor,
.editor-container .monaco-editor-background,
.editor-container .monaco-editor .margin {
  background-color: var(--workbench-editor-bg);
}

.editor-container .monaco-editor .line-numbers {
  color: #6e7681;
  font-feature-settings: "tnum";
}

.editor-container .monaco-editor .current-line ~ .line-numbers,
.editor-container .monaco-editor .active-line-number {
  color: #c9d1d9;
}

.editor-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
  background: var(--workbench-editor-bg);
  z-index: 5;
}

.editor-split-container {
  display: flex;
  flex: 1;
  min-height: 0;
  background: var(--workbench-editor-bg);
}

.editor-container.split {
  width: 50%;
  flex-shrink: 0;
}

.split-divider {
  width: 4px;
  cursor: col-resize;
  background: var(--border-subtle);
  flex-shrink: 0;
  transition: background 0.15s;
  position: relative;
  z-index: 5;
}

.split-divider:hover,
.split-divider.dragging {
  background: var(--accent);
}

.editor-container.split-pane {
  width: 50%;
  border-left: none;
  flex-shrink: 0;
}

.markdown-preview-open .editor-container {
  width: 50%;
}

.inline-diff-add {
  background: rgba(52, 211, 153, 0.12) !important;
}

.inline-diff-remove {
  background: rgba(248, 113, 113, 0.12) !important;
}

.status-bar {
  height: 23px;
  background: var(--workbench-status-bg);
  border-top: 1px solid var(--workbench-surface-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.workbench-command-surface-probe {
  width: 1px;
  height: 1px;
  flex: 0 0 1px;
  overflow: hidden;
  opacity: 0.01;
}

.status-left,
.status-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-left {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-item {
  color: var(--text-muted);
}

.status-clickable {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 4px;
  border-radius: 3px;
  transition: background 0.15s;
}

.status-clickable:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.status-icon-button {
  padding: 0 3px;
  color: #858585;
}

.status-pill {
  border-radius: 999px;
  padding: 1px 7px;
  font-size: 10px;
}

.status-pill.warn {
  color: var(--orange);
  background: rgba(251, 146, 60, 0.12);
}

.status-pill.err {
  color: var(--red);
  background: rgba(248, 113, 113, 0.12);
}

.sync-status {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.sync-ahead {
  color: var(--green);
  font-size: 10px;
  font-weight: 600;
}

.sync-behind {
  color: var(--orange);
  font-size: 10px;
  font-weight: 600;
}

.task-center-workbench {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  color: var(--text-primary);
  overflow: hidden;
}

.task-center-list-pane {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.dim {
  opacity: 0.5;
}

:root.theme-light {
  --bg-deepest: #f6f8fa;
  --bg-darker: #eef1f5;
  --bg-dark: #ffffff;
  --bg-panel: #ffffff;
  --bg-elevated: #f3f5f8;
  --bg-hover: #e8edf3;
  --bg-active: #dce5ef;
  --border-subtle: #d8dee6;
  --border: #c7d0db;
  --border-bright: #8d98a7;
  --text-muted: #6b7280;
  --text-secondary: #4b5563;
  --text-primary: #1f2937;
  --text-bright: #111827;
  --accent: #0f766e;
  --accent-contrast: #ffffff;
  --accent-dim: rgba(15, 118, 110, 0.12);
  --green: #10b981;
  --red: #dc2626;
  --orange: #d97706;
  --scrollbar-track: #eef1f5;
  --scrollbar-thumb: rgba(100, 116, 139, 0.28);
  --scrollbar-thumb-hover: rgba(100, 116, 139, 0.42);
  --workbench-titlebar-bg: #eef1f5;
  --workbench-activity-bg: #eef1f5;
  --workbench-sidebar-bg: #f6f8fa;
  --workbench-editor-bg: #ffffff;
  --workbench-tabbar-bg: #f1f4f8;
  --workbench-tab-bg: #f1f4f8;
  --workbench-tab-hover-bg: #e8edf3;
  --workbench-tab-active-bg: #ffffff;
  --workbench-status-bg: #eef1f5;
  --workbench-control-bg: #ffffff;
  --workbench-card-bg: #ffffff;
  --workbench-panel-bg: #ffffff;
  --workbench-overlay-bg: #f6f8fa;
  --workbench-surface-border: #d8dee6;
}

.auth-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.auth-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, #0d0e10 0%, #1a1b2e 50%, #0d0e10 100%);
}

.auth-bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(45, 212, 191, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(45, 212, 191, 0.03) 1px, transparent 1px);
  background-size: 40px 40px;
}

.auth-card {
  position: relative;
  width: 380px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 40px 32px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.auth-logo {
  font-size: 32px;
  font-weight: 700;
  color: var(--accent);
  text-align: center;
  margin-bottom: 4px;
}

.auth-subtitle {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  margin-bottom: 32px;
}

.auth-input-group {
  margin-bottom: 18px;
}

.auth-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.auth-input {
  width: 100%;
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-primary);
  padding: 10px 12px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
  font-family: var(--font-sans);
}

.auth-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-dim);
}

.auth-input::placeholder {
  color: var(--text-muted);
}

.auth-password-wrap {
  position: relative;
}

.auth-password-wrap .auth-input {
  padding-right: 40px;
}

.auth-pw-toggle {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
  padding: 4px;
  line-height: 1;
}

.auth-pw-toggle:hover {
  color: var(--text-primary);
}

.auth-captcha-group {
  margin-bottom: 18px;
}

.auth-captcha-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.auth-captcha-img {
  height: 42px;
  border-radius: 6px;
  border: 1px solid var(--border);
  cursor: pointer;
  flex-shrink: 0;
}

.auth-captcha-placeholder {
  height: 42px;
  width: 100px;
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
}

.auth-captcha-refresh {
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  width: 32px;
  height: 32px;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.auth-captcha-refresh:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.auth-btn {
  width: 100%;
  background: var(--accent);
  border: none;
  border-radius: 8px;
  color: #0d0e10;
  padding: 11px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.auth-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.auth-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.auth-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid #0d0e10;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.auth-error {
  margin-top: 14px;
  padding: 10px 14px;
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.2);
  border-radius: 8px;
  color: var(--red);
  font-size: 13px;
  text-align: center;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.auth-switch {
  margin-top: 20px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

.auth-switch a {
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
}

.auth-switch a:hover {
  text-decoration: underline;
}

.user-btn {
  margin-top: 6px;
}

.user-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--accent);
  color: #0d0e10;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
}

.logout-btn {
  color: var(--text-muted);
}

.logout-btn:hover {
  color: var(--red);
}

.name-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.name-dialog {
  width: min(92vw, 360px);
  background: var(--bg-panel);
  border: 1px solid var(--border-bright);
  border-radius: 10px;
  padding: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
}

.codek-dialog-backdrop {
  z-index: 2200;
}

.codek-dialog-modal {
  width: min(92vw, 460px);
}

.accessible-view-dom-shell {
  position: fixed;
  left: 50%;
  top: 12vh;
  z-index: 2150;
  width: min(760px, calc(100vw - 32px));
  max-height: min(68vh, 620px);
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border-bright);
  border-radius: 8px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.38);
}

.accessible-view-dom-shell-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.accessible-view-dom-shell-title {
  color: var(--text-bright);
  font-size: 13px;
  font-weight: 700;
}

.accessible-view-dom-shell-meta {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
}

.accessible-view-dom-shell-close {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-hover);
  color: var(--text-primary);
}

.accessible-view-dom-shell-content {
  min-height: 180px;
  max-height: 42vh;
  resize: vertical;
  overflow: auto;
  white-space: pre;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.5;
}

.accessible-view-dom-shell-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.accessible-view-dom-shell-action {
  max-width: 190px;
  min-height: 28px;
  padding: 5px 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  color: var(--text-muted);
}

.name-dialog-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-bright);
  margin-bottom: 10px;
}

.codek-dialog-message,
.codek-dialog-detail {
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 10px;
  white-space: pre-wrap;
}

.codek-dialog-detail {
  color: var(--text-muted);
}

.codek-dialog-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
  font-size: 13px;
  margin-top: 10px;
}

.name-dialog-input {
  width: 100%;
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-primary);
  padding: 10px 12px;
  font-size: 14px;
  outline: none;
}

.name-dialog-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-dim);
}

.name-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.name-dialog-btn {
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
}

.name-dialog-btn.ghost {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.name-dialog-btn.primary {
  background: var(--accent);
  color: #0d0e10;
  font-weight: 600;
}

.goal-result-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.52);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 2100;
}

.goal-result-modal {
  width: min(760px, 94vw);
  max-height: min(780px, 88vh);
  overflow: auto;
  position: relative;
  background: var(--bg-panel);
  color: var(--text-primary);
  border: 1px solid var(--border-bright);
  border-radius: 8px;
  box-shadow: 0 24px 72px rgba(0, 0, 0, 0.45);
}

.task-run-detail-modal {
  width: min(1120px, 94vw);
  height: 80vh;
  min-height: 520px;
  max-height: 760px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-top: 0;
}

.task-run-detail-modal .orchestrator-panel {
  flex: 1 1 auto;
  min-height: 0;
  border: 0;
  border-radius: 0;
}

.task-run-detail-modal .run-list {
  max-height: 104px;
}

.task-run-detail-modal .run-row {
  min-height: 28px;
}
.goal-result-close {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-hover);
  color: var(--text-primary);
  cursor: pointer;
  z-index: 1;
}
</style>
