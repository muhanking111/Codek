<template>
  <div class="settings-panel">
    <aside class="settings-sidebar">
      <div class="settings-sidebar-head">
        <div>
          <div class="settings-sidebar-kicker">Codek</div>
          <div class="settings-sidebar-title">设置</div>
        </div>
        <span class="settings-sidebar-pill">本地</span>
      </div>

      <div class="settings-account">
        <div class="settings-account-avatar">C</div>
        <div class="settings-account-info">
          <div class="settings-account-name">Codek</div>
          <div class="settings-account-plan">本地工作区</div>
        </div>
      </div>

      <div class="settings-search-wrap">
        <svg class="settings-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <input
          v-model="searchQuery"
          class="settings-search-input"
          type="text"
          placeholder="搜索设置  Ctrl+F"
          @keydown.esc="searchQuery = ''"
        />
      </div>

      <nav class="settings-nav" aria-label="设置分类">
        <template v-for="group in filteredNavGroups" :key="group.label">
          <div class="settings-nav-group-label">{{ group.label }}</div>
          <button
            v-for="g in group.items"
            :key="g.id"
            class="settings-nav-item"
            :class="{ active: activeSection === g.id }"
            :title="g.description"
            @click="activeSection = g.id"
          >
            <component :is="g.icon" class="settings-nav-icon" />
            <span>{{ g.label }}</span>
            <span v-if="g.badge" class="settings-nav-badge">{{ g.badge }}</span>
          </button>
        </template>
        <div v-if="filteredNavGroups.length === 0" class="settings-nav-empty">
          没有找到相关设置
        </div>
      </nav>
    </aside>

    <main class="settings-main">
      <div class="settings-main-inner">
      <header class="settings-page-header">
        <div class="settings-page-copy">
          <div class="settings-page-kicker">{{ currentSectionMeta.kicker }}</div>
          <h1 class="settings-page-title">{{ currentSectionMeta.label }}</h1>
          <p class="settings-page-desc">{{ currentSectionMeta.description }}</p>
        </div>
        <div class="settings-page-state">
          <span class="settings-page-state-dot" />
          <span>{{ currentSectionMeta.state }}</span>
        </div>
      </header>

      <div
        v-if="settingsQueryEvidence"
        class="settings-query-evidence"
        data-codek-smoke="settings-query-evidence"
        :data-settings-query="settingsQueryEvidence.query"
        :data-settings-section="settingsQueryEvidence.section"
        :data-settings-tag="settingsQueryEvidence.tag"
        :data-settings-contract="settingsQueryEvidence.contract"
      >
        <span class="settings-query-label">查询</span>
        <code>{{ settingsQueryEvidence.query }}</code>
        <span class="settings-query-desc">{{ settingsQueryEvidence.description }}</span>
      </div>

      <section v-if="activeSection === 'general'" class="settings-section-block">
        <h2 class="settings-h2">通用</h2>
        <div class="settings-section-desc">Codek 设置已按 Cursor 风格产品设置和 VS Code 兼容编辑器设置拆分。</div>

        <div class="settings-entry-grid">
          <button class="settings-entry-card" type="button" @click="activeSection = 'codek-settings'">
            <span class="settings-entry-title">Codek 设置</span>
            <span class="settings-entry-desc">模型、智能体、多智能体、沙箱、索引、隐私和自动化任务。</span>
          </button>
          <button class="settings-entry-card" type="button" @click="activeSection = 'vscode-settings'">
            <span class="settings-entry-title">VS Code 兼容设置</span>
            <span class="settings-entry-desc">复用 VS Code 兼容设置定义、settings.json 和 keybindings.json。</span>
          </button>
        </div>

        <SchemaSettingsSection group="general" />

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">{{ t('settings.theme') }}</div>
            <div class="settings-row-desc">{{ t('settings.themeDesc') }}</div>
          </div>
          <div class="settings-row-control">
            <CodekSegmented
              :model-value="currentTheme"
              :options="themeSegmentOptions"
              aria-label="主题"
              @change="handleThemeChange($event as ThemeId)"
            />
          </div>
        </div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">自动保存</div>
            <div class="settings-row-desc">自动保存已修改但尚未写入磁盘的文件</div>
          </div>
          <div class="settings-row-control">
            <CodekSelect
              :model-value="autoSaveMode"
              :options="autoSaveSelectOptions"
              aria-label="自动保存"
              @change="$emit('changeAutoSave', $event)"
            />
          </div>
        </div>
      </section>

      <section v-if="activeSection === 'codek-settings'" class="settings-section-block">
        <h2 class="settings-h2">Codek 设置</h2>
        <div class="settings-section-desc">对应 Cursor Settings：这里只放 Codek / Codex / 智能体自己的产品能力，不和 VS Code 原生编辑器设置混在一起。</div>

        <div class="settings-entry-grid">
          <button class="settings-entry-card" type="button" @click="activeSection = 'models'">
            <span class="settings-entry-title">模型与供应商</span>
            <span class="settings-entry-desc">Ollama、OpenAI 兼容、Anthropic、CCSwitch 和补全模型。</span>
          </button>
          <button class="settings-entry-card" type="button" @click="activeSection = 'agent'">
            <span class="settings-entry-title">智能体与沙箱</span>
            <span class="settings-entry-desc">智能体模式、审批策略、沙箱等级和可写路径。</span>
          </button>
          <button class="settings-entry-card" type="button" @click="activeSection = 'rules'">
            <span class="settings-entry-title">规则与记忆</span>
            <span class="settings-entry-desc">用户规则、项目规则、Cursor rules 兼容和记忆管理。</span>
          </button>
          <button class="settings-entry-card" type="button" @click="activeSection = 'indexing'">
            <span class="settings-entry-title">索引与上下文</span>
            <span class="settings-entry-desc">代码库索引、Embedding、Web 搜索和上下文来源。</span>
          </button>
          <button class="settings-entry-card" type="button" @click="activeSection = 'privacy'">
            <span class="settings-entry-title">隐私</span>
            <span class="settings-entry-desc">本地优先、遥测、云端模型限制和日志策略。</span>
          </button>
          <button class="settings-entry-card" type="button" @click="activeSection = 'release'">
            <span class="settings-entry-title">发布与验收</span>
            <span class="settings-entry-desc">发布质量门、CI 契约、验收矩阵和最近报告。</span>
          </button>
        </div>

        <SchemaSettingsSection group="agent" />
      </section>

      <section v-if="activeSection === 'vscode-settings'" class="settings-section-block">
        <h2 class="settings-h2">VS Code 兼容设置</h2>
        <div class="settings-section-desc">对应 Cursor 的 VS Code 设置入口：复用 VS Code 兼容 key，承载编辑器、文件、搜索、SCM、扩展和工作台设置。</div>

        <div class="settings-entry-grid">
          <button class="settings-entry-card" type="button" @click="activeSection = 'editor'">
            <span class="settings-entry-title">编辑器</span>
            <span class="settings-entry-desc">editor.fontSize、editor.wordWrap、editor.minimap.enabled 等。</span>
          </button>
          <button class="settings-entry-card" type="button" @click="activeSection = 'files'">
            <span class="settings-entry-title">文件</span>
            <span class="settings-entry-desc">files.autoSave、files.encoding、files.exclude 等。</span>
          </button>
          <button class="settings-entry-card" type="button" @click="activeSection = 'keybindings'">
            <span class="settings-entry-title">键盘快捷方式</span>
            <span class="settings-entry-desc">VS Code 风格快捷键与 keybindings.json。</span>
          </button>
          <button class="settings-entry-card" type="button" @click="activeSection = 'advanced'">
            <span class="settings-entry-title">设置 JSON</span>
            <span class="settings-entry-desc">直接查看、导入和导出 settings.json 兼容配置。</span>
          </button>
          <button class="settings-entry-card" type="button" @click="activeSection = 'extensions'">
            <span class="settings-entry-title">扩展</span>
            <span class="settings-entry-desc">扩展主机、VSIX 和扩展贡献设置。</span>
          </button>
        </div>

        <SchemaSettingsSection group="general" />
        <SchemaSettingsSection group="editor" />
        <SchemaSettingsSection group="files" />
        <SchemaSettingsSection group="search" />
        <SchemaSettingsSection group="source-control" />
      </section>

      <section v-if="activeSection === 'appearance'" class="settings-section-block">
        <h2 class="settings-h2">外观</h2>
        <div class="settings-section-desc">工作台层面的视觉设置，尽量对齐 VS Code 的设置概念。</div>

        <SchemaSettingsSection group="appearance" />

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">{{ t('settings.theme') }}</div>
            <div class="settings-row-desc">{{ t('settings.themeDesc') }}</div>
          </div>
          <div class="settings-row-control">
            <CodekSegmented
              :model-value="currentTheme"
              :options="themeSegmentOptions"
              aria-label="主题"
              @change="handleThemeChange($event as ThemeId)"
            />
          </div>
        </div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">工作台布局</div>
            <div class="settings-row-desc">活动栏、侧边栏位置、面板位置、状态栏显隐。</div>
          </div>
          <span class="settings-pill alt">计划中</span>
        </div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">图标主题</div>
            <div class="settings-row-desc">VS Code 兼容文件图标主题需要先补齐主题贡献能力。</div>
          </div>
          <span class="settings-pill alt">需要 VS Code 主题服务</span>
        </div>
      </section>

      <section v-if="activeSection === 'files'" class="settings-section-block">
        <h2 class="settings-h2">文件</h2>
        <div class="settings-section-desc">文件保存、编码和 VS Code 兼容的文件行为。</div>

        <SchemaSettingsSection group="files" />

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">自动保存</div>
            <div class="settings-row-desc">对应 VS Code 的 files.autoSave，用于当前编辑器。</div>
          </div>
          <div class="settings-row-control">
            <CodekSelect
              :model-value="autoSaveMode"
              :options="autoSaveSelectOptions"
              aria-label="文件自动保存"
              @change="$emit('changeAutoSave', $event)"
            />
          </div>
        </div>

      </section>

      <section v-if="activeSection === 'models'" class="settings-section-block">
        <h2 class="settings-h2">模型</h2>
        <div class="settings-section-desc">融合 Cursor 风格模型设置，以及 Codek 已有的本地 Ollama、OpenAI 兼容、Anthropic 和 CCSwitch 供应商。</div>

        <div class="settings-matrix">
          <div class="settings-matrix-item ready">
            <span class="settings-matrix-label">聊天模型</span>
            <span>{{ modelSettings.provider }} / {{ activeModel || modelSettings.preferredModel }}</span>
          </div>
          <div class="settings-matrix-item ready">
            <span class="settings-matrix-label">供应商路由</span>
            <span>本地 + 云端</span>
          </div>
          <div class="settings-matrix-item">
            <span class="settings-matrix-label">补全模型</span>
            <CodekComboBox
              :model-value="completionModelOverride"
              :options="completionModelComboOptions"
              aria-label="补全模型"
              placeholder="输入或选择补全模型"
              @change="onCompletionModelChange"
              title="覆盖行内（Tab）补全使用的模型"
            />
          </div>
          <div class="settings-matrix-item planned">
            <span class="settings-matrix-label">Embedding 模型</span>
            <span>需要索引设置支持</span>
          </div>
        </div>

        <div class="model-list">
          <div class="model-row">
            <div class="model-row-label">
              <div class="model-row-name">
                Ollama（本地）
                <span
                  class="settings-pill"
                  :class="{ alt: !ollamaOk }"
                >{{ ollamaOk ? '在线' : '离线' }}</span>
              </div>
              <div class="model-row-id">ollama</div>
            </div>
            <div class="model-row-actions">
              <template v-if="modelSettings.provider === 'ollama'">
                <CodekComboBox
                  class="model-row-select"
                  :style="ollamaModelSelectStyle"
                  :model-value="selectedModel"
                  :options="ollamaModelComboOptions"
                  :disabled="!ollamaOk || availableModelOptions.length === 0"
                  aria-label="当前 Ollama 模型"
                  placeholder="输入或选择 Ollama 模型"
                  @change="$emit('changeModel', $event)"
                  :title="availableModelOptions.length === 0 ? '没有本地模型，请启动 Ollama 并拉取模型' : '当前模型'"
                />
                <button class="settings-btn model-row-refresh" @click="$emit('refreshModels')" title="刷新">↻</button>
              </template>
              <button
                class="toggle-switch"
                :class="{ active: modelSettings.provider === 'ollama' }"
                @click="handleProviderChange('ollama')"
                :title="modelSettings.provider === 'ollama' ? '当前供应商' : '点击启用'"
              >
                <span class="toggle-knob" />
              </button>
            </div>
          </div>
        </div>

        <div class="cloud-section-header">
          <div>
            <div class="cloud-section-title">云端供应商</div>
            <div class="cloud-section-desc">每条配置都是一个独立的 API 通道,鼠标移上去显示操作。</div>
          </div>
          <button class="settings-btn cloud-add-btn" @click="handleAddProvider">+ 新建供应商</button>
        </div>

        <div class="ccs-card">
          <div class="ccs-card-main">
            <div class="ccs-card-title">CCSwitch 配置</div>
            <div class="ccs-card-desc">
              <template v-if="ccsInfo && ccsInfo.exists">
                发现 <b>{{ ccsInfo.claudeCount }}</b> 个 CCS Claude 供应商 / <b>{{ ccsInfo.codexCount }}</b> 个 CCS Codex 供应商:<span class="ccs-card-path"> {{ ccsInfo.path }}</span>
              </template>
              <template v-else-if="ccsInfo">
                未发现 cc-switch.db:<span class="ccs-card-path"> {{ ccsInfo.path }}</span>
              </template>
              <template v-else>正在扫描 cc-switch 配置...</template>
            </div>
          </div>
          <div class="ccs-card-actions">
            <button class="settings-btn ccs-btn" :disabled="ccsScanning" @click="scanCcs">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              {{ ccsScanning ? '扫描中...' : '刷新' }}
            </button>
            <button class="settings-btn ccs-btn ccs-btn-primary" :disabled="!ccsInfo || !ccsInfo.exists" @click="ccsImportOpen = true">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              导入 CCSwitch 配置
            </button>
          </div>
        </div>

        <div v-if="cloudProviders.length === 0" class="cloud-empty">
          还没有配置云端供应商,点击右上角"新建供应商"或导入 CCSwitch 配置。
        </div>

        <template v-else>
          <div class="cloud-cat-header">
            <span class="cloud-cat-title">Anthropic</span>
            <span class="cloud-cat-count">{{ anthropicProviders.length }}</span>
          </div>
          <div v-if="anthropicProviders.length === 0" class="cloud-empty cloud-empty-mini">该分类暂无供应商。</div>
          <div v-else class="cloud-grid">
            <div
              v-for="cp in anthropicProviders"
              :key="cp.id"
              class="cloud-card"
              :class="{ active: modelSettings.activeAnthropicProviderId === cp.id }"
              @click="handleActivateProvider(cp.id)"
            >
              <div class="cloud-card-head">
                <div class="cloud-card-head-main">
                  <div class="cloud-card-name">{{ cp.name || '未命名' }}</div>
                  <span v-if="modelSettings.activeAnthropicProviderId === cp.id" class="settings-pill cloud-active-pill">使用中</span>
                </div>
                <div class="cloud-card-actions" @click.stop>
                  <button class="cloud-icon-btn" title="测试模型" @click="handleTestProvider(cp)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>
                  <button class="cloud-icon-btn" title="启用" @click="handleActivateProvider(cp.id)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>
                  <button class="cloud-icon-btn" title="编辑" @click="handleEditProvider(cp)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                  <button class="cloud-icon-btn cloud-icon-danger" title="删除" @click="handleDeleteProvider(cp)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg></button>
                </div>
              </div>
              <div class="cloud-card-meta">
                <span class="cloud-card-proto">Anthropic</span>
                <span class="cloud-card-model">{{ cp.model || '(未设置模型)' }}</span>
              </div>
              <div class="cloud-card-url">{{ cp.baseUrl || '(未设置 base URL)' }}</div>
            </div>
          </div>

          <div class="cloud-cat-header">
            <span class="cloud-cat-title">OpenAI 兼容</span>
            <span class="cloud-cat-count">{{ openaiProviders.length }}</span>
          </div>
          <div v-if="openaiProviders.length === 0" class="cloud-empty cloud-empty-mini">该分类暂无供应商。</div>
          <div v-else class="cloud-grid">
            <div
              v-for="cp in openaiProviders"
              :key="cp.id"
              class="cloud-card"
              :class="{ active: modelSettings.activeOpenAIProviderId === cp.id }"
              @click="handleActivateProvider(cp.id)"
            >
              <div class="cloud-card-head">
                <div class="cloud-card-head-main">
                  <div class="cloud-card-name">{{ cp.name || '未命名' }}</div>
                  <span v-if="modelSettings.activeOpenAIProviderId === cp.id" class="settings-pill cloud-active-pill">使用中</span>
                </div>
                <div class="cloud-card-actions" @click.stop>
                  <button class="cloud-icon-btn" title="测试模型" @click="handleTestProvider(cp)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>
                  <button class="cloud-icon-btn" title="启用" @click="handleActivateProvider(cp.id)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>
                  <button class="cloud-icon-btn" title="编辑" @click="handleEditProvider(cp)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                  <button class="cloud-icon-btn cloud-icon-danger" title="删除" @click="handleDeleteProvider(cp)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg></button>
                </div>
              </div>
              <div class="cloud-card-meta">
                <span class="cloud-card-proto">OpenAI 兼容</span>
                <span class="cloud-card-model">{{ cp.model || '(未设置模型)' }}</span>
              </div>
              <div class="cloud-card-url">{{ cp.baseUrl || '(未设置 base URL)' }}</div>
            </div>
          </div>
        </template>

        <details class="settings-collapse">
          <summary class="settings-collapse-summary">
            <svg class="settings-collapse-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            <span>Ollama 地址</span>
          </summary>
          <div class="settings-row settings-row-stack">
            <div class="settings-row-info">
              <div class="settings-row-title">Ollama 地址</div>
              <div class="settings-row-desc">本地 Ollama API 端点。</div>
            </div>
            <CodekInput
              :model-value="modelSettings.ollamaHost"
              variant="url"
              placeholder="http://localhost:11434"
              aria-label="Ollama 地址"
              @change="handleOllamaHostChange"
            />
          </div>
        </details>

        <div v-if="modelSettings.provider === 'ollama'" class="settings-row settings-row-stack">
          <div class="settings-row-info">
            <div class="settings-row-title">当前 Ollama 模型</div>
            <div class="settings-row-desc">
              <span class="settings-pill alt">当前：{{ activeModel || '-' }}</span>
            </div>
          </div>
        </div>

        <details class="settings-collapse">
          <summary class="settings-collapse-summary">
            <svg class="settings-collapse-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            <span>模型参数</span>
          </summary>

          <div class="settings-row settings-row-stack">
            <div class="settings-row-info">
              <div class="settings-row-title">Temperature：{{ modelSettings.temperature }}</div>
            </div>
            <input class="settings-range" type="range" min="0" max="2" step="0.1" :value="modelSettings.temperature" @input="handleParamChange('temperature', $event)" />
          </div>
          <div class="settings-row settings-row-stack">
            <div class="settings-row-info">
              <div class="settings-row-title">Top P：{{ modelSettings.topP }}</div>
            </div>
            <input class="settings-range" type="range" min="0" max="1" step="0.05" :value="modelSettings.topP" @input="handleParamChange('topP', $event)" />
          </div>
          <div class="settings-row settings-row-stack">
            <div class="settings-row-info">
              <div class="settings-row-title">最大 Token 数：{{ modelSettings.maxTokens }}</div>
            </div>
            <input class="settings-range" type="range" min="128" max="8192" step="128" :value="modelSettings.maxTokens" @input="handleParamChange('maxTokens', $event)" />
          </div>
        </details>
      </section>

      <section v-if="activeSection === 'editor'" class="settings-section-block">
        <h2 class="settings-h2">编辑器</h2>
        <div class="settings-section-desc">核心编辑器控制项，后续会映射到 VS Code 的 editor.* 设置。</div>

        <SchemaSettingsSection group="editor" />

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">保存时格式化</div>
            <div class="settings-row-desc">保存文件时运行格式化工具</div>
          </div>
          <button class="toggle-switch" :class="{ active: formatOnSave }" @click="$emit('toggleFormatOnSave')">
            <span class="toggle-knob" />
          </button>
        </div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">保存时 Lint</div>
            <div class="settings-row-desc">保存文件时运行 Lint 检查</div>
          </div>
          <button class="toggle-switch" :class="{ active: lintOnSave }" @click="$emit('toggleLintOnSave')">
            <span class="toggle-knob" />
          </button>
        </div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">实时协作</div>
            <div class="settings-row-desc">与其他人实时编辑同一组文件</div>
          </div>
          <button class="toggle-switch" :class="{ active: collabEnabled }" @click="$emit('toggleCollab')">
            <span class="toggle-knob" />
          </button>
        </div>

      </section>

      <section v-if="activeSection === 'search'" class="settings-section-block">
        <h2 class="settings-h2">搜索</h2>
        <div class="settings-section-desc">工作区搜索和 ignore 文件行为。</div>

        <SchemaSettingsSection group="search" />

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">使用 Ignore 文件</div>
            <div class="settings-row-desc">计划支持 VS Code 兼容的 search.useIgnoreFiles 和 .gitignore 处理。</div>
          </div>
          <span class="settings-pill alt">计划中</span>
        </div>
      </section>

      <section v-if="activeSection === 'source-control'" class="settings-section-block">
        <h2 class="settings-h2">源代码管理</h2>
        <div class="settings-section-desc">Git 设置，以及未来的 VS Code SCM 兼容能力。</div>

        <SchemaSettingsSection group="source-control" />

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">Git 自动拉取</div>
            <div class="settings-row-desc">扩展主机配置里已有默认值，但前端统一设置存储尚未接管。</div>
          </div>
          <span class="settings-pill alt">需要设置存储</span>
        </div>
      </section>

      <section v-if="activeSection === 'extensions'" class="settings-section-block">
        <h2 class="settings-h2">扩展</h2>
        <div class="settings-section-desc">管理已安装的 VS Code 扩展、查看扩展主机状态、从 .vsix 文件安装。</div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">扩展主机状态</div>
            <div class="settings-row-desc">{{ extHostStatusText }}</div>
          </div>
          <div class="settings-row-actions">
            <button class="settings-btn" @click="reloadExtHost" :disabled="extHostBusy || extInstallBusy">重载扩展主机</button>
            <button class="settings-btn primary" @click="pickAndInstallVsix" :disabled="extInstallBusy">
              {{ extInstallBusy ? '安装中...' : '从 .vsix 安装' }}
            </button>
          </div>
        </div>

        <div class="settings-row" v-if="extError">
          <div class="settings-row-info settings-error-text">{{ extError }}</div>
        </div>
        <div class="settings-row" v-if="extInstallMessage">
          <div class="settings-row-info settings-success-text">{{ extInstallMessage }}</div>
        </div>

        <div class="settings-row">
          <div class="settings-row-info settings-row-info-full">
            <div class="settings-row-title">已安装扩展 ({{ extInstalledList.length }})</div>
            <div class="settings-table-wrap">
              <div v-if="extInstalledList.length === 0" class="settings-table-empty">暂无已安装扩展。前往 Marketplace 浏览。</div>
              <table v-else class="settings-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>发行者</th>
                    <th>版本</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="ext in extInstalledList" :key="ext.id">
                    <td>
                      {{ ext.displayName || ext.id }}
                      <span v-if="ext.builtin" class="settings-pill settings-inline-pill">内置</span>
                    </td>
                    <td>{{ ext.publisher }}</td>
                    <td>{{ ext.version }}</td>
                    <td>{{ getInstalledExtensionStatusLabel(ext) }}</td>
                    <td>
                      <button v-if="!ext.builtin" class="settings-btn settings-table-action" @click="toggleExt(ext)">
                        {{ isInstalledExtensionDisabled(ext) ? '启用' : '禁用' }}
                      </button>
                      <button v-if="!ext.builtin" class="settings-btn" @click="uninstallExt(ext.id)">卸载</button>
                      <span v-else class="settings-muted-text">不可卸载</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">运行状态</div>
            <div class="settings-row-desc">激活扩展数：{{ extHostStatus.activated || 0 }}</div>
          </div>
        </div>
      </section>

      <section v-if="activeSection === 'agent'" class="settings-section-block">
        <h2 class="settings-h2">智能体</h2>
        <div class="settings-section-desc">将 Cursor 风格智能体控制项映射到 Codek 已有的智能体、沙箱和审批策略模块。</div>

        <SchemaSettingsSection group="agent" />

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">沙箱级别</div>
            <div class="settings-row-desc">
              标准 = 仅启用 namespace 隔离。
              严格 = Linux 上增加 --unshare-user-try、--clearenv；Windows 上使用 AppContainer。
              加固 = 严格模式 + seccomp 过滤器（Linux 需要 CODEK_SECCOMP_BPF）。
            </div>
          </div>
          <CodekSelect
            v-model="sandboxLevel"
            :options="sandboxLevelOptions"
            aria-label="沙箱级别"
            @change="saveSandboxSettings"
          />
        </div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">沙箱中阻断网络</div>
            <div class="settings-row-desc">开启后，沙箱工具运行时会加上 --unshare-net，并清理代理环境变量。</div>
          </div>
          <button
            class="toggle-switch settings-switch-wide"
            :class="{ active: sandboxBlockNetwork }"
            type="button"
            role="switch"
            :aria-checked="sandboxBlockNetwork"
            @click="toggleSandboxBlockNetwork"
          >
            <span class="toggle-knob" />
            <span class="settings-switch-label">{{ sandboxBlockNetwork ? '已阻断' : '未阻断' }}</span>
          </button>
        </div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">可写路径白名单</div>
            <div class="settings-row-desc">每行一个路径。除 projectRoot 外，沙箱工具也可以写入这些路径。</div>
            <CodekTextarea
              v-model="sandboxWritable"
              variant="code"
              :rows="3"
              placeholder="/tmp/codek-cache&#10;~/.config/codek"
              aria-label="可写路径白名单"
              @change="saveSandboxSettings"
            />
          </div>
        </div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">命令审批策略</div>
            <div class="settings-row-desc">sandboxPolicy.ts 已有允许/阻断规则；在开放编辑前先作为只读设置展示。</div>
          </div>
          <span class="settings-pill">代码中已支持</span>
        </div>
      </section>

      <section v-if="activeSection === 'rules'" class="settings-section-block">
        <h2 class="settings-h2">规则与记忆</h2>
        <div class="settings-section-desc">Cursor 风格的用户规则、项目规则和记忆能力会逐步变成 Codek 的一等设置。</div>

        <SchemaSettingsSection group="rules-memory" />
      </section>

      <section v-if="activeSection === 'indexing'" class="settings-section-block">
        <h2 class="settings-h2">索引与上下文</h2>
        <div class="settings-section-desc">管理代码库索引、文档、Web 搜索和上下文控制。</div>

        <SchemaSettingsSection group="indexing" />

        <div class="settings-row settings-row-stack">
          <div class="settings-row-info">
            <div class="settings-row-title">代码库索引</div>
            <div class="settings-row-desc">
              <span class="settings-pill" :class="{ alt: !indexState.size }">
                {{ indexState.size > 0 ? `${indexState.size} 个文件` : '暂无索引' }}
              </span>
              <span v-if="indexState.lastBuilt" class="settings-row-sub">
                · 上次构建 {{ formatRelative(indexState.lastBuilt) }}
              </span>
            </div>
          </div>
          <div class="settings-row-actions">
            <button class="settings-btn" :disabled="indexState.busy" @click="refreshIndexSize">
              {{ indexState.busy ? '处理中...' : '刷新' }}
            </button>
            <button class="settings-btn primary" :disabled="indexState.busy" @click="rebuildIndex">
              {{ indexState.busy && indexState.action === 'rebuild' ? `重建中 ${indexState.progress}%` : '重建索引' }}
            </button>
            <button class="settings-btn alt" :disabled="indexState.busy" @click="clearIndex">清空</button>
          </div>
          <div v-if="indexState.busy && indexState.action === 'rebuild'" class="settings-progress">
            <div class="settings-progress-bar" :style="{ width: indexState.progress + '%' }"></div>
          </div>
          <div v-if="indexState.message" class="settings-row-sub">{{ indexState.message }}</div>
        </div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">Web 搜索供应商</div>
            <div class="settings-row-desc">webSearch.ts 已支持 SearXNG、SerpAPI 和 Bing；这里还需要安全的凭据配置界面。</div>
          </div>
          <span class="settings-pill alt">需要界面接线</span>
        </div>
      </section>

      <section v-if="activeSection === 'privacy'" class="settings-section-block">
        <h2 class="settings-h2">隐私</h2>
        <div class="settings-section-desc">本地优先地控制云端模型、索引、遥测和日志。</div>

        <SchemaSettingsSection group="privacy" />
      </section>

      <section v-if="activeSection === 'release'" class="settings-section-block" data-codek-smoke="settings-release-page">
        <h2 class="settings-h2">发布与验收</h2>
        <div class="settings-section-desc">集中查看发布质量门、CI 契约和真实项目验收矩阵。默认只读取最近报告，完整 Electron smoke 仍由本机发布前手动运行。</div>

        <div class="settings-matrix release-matrix">
          <div class="settings-matrix-item" :class="{ ready: releaseGateReport?.ready }">
            <span class="settings-matrix-label">发布质量门</span>
            <span>{{ releaseGateReport ? (releaseGateReport.ready ? '就绪' : '需处理') : '暂无报告' }}</span>
          </div>
          <div class="settings-matrix-item" :class="{ ready: acceptanceReport?.ready }">
            <span class="settings-matrix-label">发布验收</span>
            <span>{{ acceptanceReport ? `${acceptanceReport.passed}/${acceptanceReport.total}` : '暂无报告' }}</span>
          </div>
          <div
            class="settings-matrix-item"
            :class="{ ready: realTrialDetail?.mainWorkspaceUntouchedBeforeAccept && realTrialDetail?.rollbackAvailable }"
          >
            <span class="settings-matrix-label">真实试运行</span>
            <span>{{ realTrialStatusLabel }}</span>
          </div>
          <div
            class="settings-matrix-item"
            :class="{ ready: readinessReport?.ready, planned: readinessReport?.status === 'degraded' }"
          >
            <span class="settings-matrix-label">企业预检</span>
            <span>{{ readinessReport?.statusLabel || '待刷新' }}</span>
          </div>
          <div
            class="settings-matrix-item"
            :class="{ ready: latestRunActionAudit?.status === 'success', planned: latestRunActionAudit?.status === 'started', danger: latestRunActionAudit?.status === 'error' }"
          >
            <span class="settings-matrix-label">主操作审计</span>
            <span>{{ runActionAuditStatusLabel }}</span>
          </div>
          <div class="settings-matrix-item ready">
            <span class="settings-matrix-label">CI 契约</span>
            <span>include-build</span>
          </div>
          <div class="settings-matrix-item planned">
            <span class="settings-matrix-label">完整门</span>
            <span>本机手动 --full</span>
          </div>
        </div>

        <div class="settings-row-stack release-card" data-codek-smoke="settings-readiness-summary">
          <div class="release-gate-head">
            <div>
              <div class="settings-row-title">企业级运行预检</div>
              <div class="settings-row-desc">{{ readinessSubtitle }}</div>
            </div>
            <span :class="{ ready: readinessReport?.ready, danger: readinessReport?.status === 'blocked' }">
              {{ readinessReport?.statusLabel || '待刷新' }}
            </span>
          </div>
          <div class="release-actions">
            <button class="settings-btn" :disabled="readinessBusy" @click="refreshReadinessState">刷新预检</button>
          </div>
          <div v-if="readinessReport" class="release-ci-grid">
            <span>项目根目录</span>
            <strong>{{ readinessReport.projectRoot || '未打开' }}</strong>
            <span>检查项</span>
            <strong>{{ readinessReport.summary.passed }}/{{ readinessReport.summary.total }}</strong>
            <span>需处理</span>
            <strong>{{ readinessReport.summary.warning }}</strong>
            <span>阻断</span>
            <strong>{{ readinessReport.summary.failed }}</strong>
            <span>下一步</span>
            <strong>{{ readinessReport.nextAction }}</strong>
          </div>
          <div v-if="readinessReport?.checks?.length" class="release-scenario-list">
            <div
              v-for="check in readinessReport.checks.slice(0, 9)"
              :key="check.id"
              class="release-scenario-row"
              :class="{ failed: check.status === 'failed', warning: check.status === 'warning' }"
            >
              <span>{{ check.title }}</span>
              <strong>{{ check.statusLabel }}</strong>
              <small>{{ check.detail }}</small>
            </div>
          </div>
          <div v-if="readinessHistory.length" class="release-scenario-list">
            <div
              v-for="item in readinessHistory.slice(0, 4)"
              :key="item.jsonPath"
              class="release-scenario-row"
              :class="{ failed: item.status === 'blocked', warning: item.status === 'degraded' }"
            >
              <span>{{ item.statusLabel || item.status }}</span>
              <strong>{{ item.summary.passed }}/{{ item.summary.total }}</strong>
              <small>{{ item.nextAction }}</small>
            </div>
          </div>
          <div v-if="readinessMarkdownPath" class="release-path" :title="readinessMarkdownPath">{{ readinessMarkdownPath }}</div>
          <div v-if="!readinessReport" class="settings-callout">预检会读取当前工作区设置、发布质量门、发布验收、真实试运行最新报告和编排器当前任务状态。</div>
        </div>

        <div class="settings-row-stack release-card" data-codek-smoke="settings-release-evidence-export">
          <div class="release-gate-head">
            <div>
              <div class="settings-row-title">发布证据链导出</div>
              <div class="settings-row-desc">{{ releaseEvidenceSubtitle }}</div>
            </div>
            <span :class="{ ready: releaseEvidenceReport?.ready, danger: releaseEvidenceReport?.status === 'missing' }">
              {{ releaseEvidenceReport?.statusLabel || '待导出' }}
            </span>
          </div>
          <div class="release-actions">
            <button class="settings-btn" :disabled="releaseEvidenceBusy" @click="exportSettingsReleaseEvidence">
              {{ releaseEvidenceBusy ? '正在导出' : '导出 Markdown' }}
            </button>
            <button
              class="settings-btn"
              data-codek-smoke="settings-release-evidence-open"
              :disabled="!releaseEvidenceMarkdownPath"
              :title="releaseEvidenceMarkdownPath || '暂无可打开的发布证据链 Markdown'"
              @click="openReleaseEvidenceReport()"
            >
              打开 Markdown
            </button>
          </div>
          <div v-if="releaseEvidenceReport" class="release-evidence-latest">
            <div>
              <span>最近导出</span>
              <strong>{{ releaseEvidenceReport.statusLabel }}</strong>
            </div>
            <div>
              <span>证据状态</span>
              <strong>{{ releaseEvidenceReport.summary.ready }}/{{ releaseEvidenceReport.summary.total }} 就绪 · {{ releaseEvidenceReport.summary.missing }} 缺失</strong>
            </div>
            <div>
              <span>导出时间</span>
              <strong>{{ formatEvidenceTime(releaseEvidenceReport.createdAt) }}</strong>
            </div>
            <div>
              <span>LLM 用量</span>
              <strong data-codek-smoke="settings-release-evidence-llm-usage">
                {{ releaseEvidenceLlmUsage?.totalRequests || 0 }} 次 · {{ releaseEvidenceLlmUsage?.totalTokens || 0 }} tokens
              </strong>
            </div>
            <div>
              <span>本地估算成本</span>
              <strong data-codek-smoke="settings-release-evidence-llm-cost" :title="releaseEvidenceLlmCostTitle">
                {{ formatUsdCost(releaseEvidenceLlmUsage?.estimatedCostUsd || 0) }}
              </strong>
            </div>
            <div v-if="releaseEvidenceCodebaseContext">
              <span>代码库上下文</span>
              <strong data-codek-smoke="settings-release-evidence-codebase-context" :title="releaseEvidenceCodebaseContextTitle">
                {{ releaseEvidenceCodebaseContext.statusLabel }}
              </strong>
            </div>
            <div v-if="releaseEvidenceSandboxSecurity">
              <span>沙箱安全</span>
              <strong data-codek-smoke="settings-release-evidence-sandbox-security" :title="releaseEvidenceSandboxSecurityTitle">
                {{ releaseEvidenceSandboxSecurity.statusLabel }}
              </strong>
            </div>
            <div v-if="releaseEvidenceTaskRuns">
              <span>任务运行证据</span>
              <strong data-codek-smoke="settings-release-evidence-task-runs" :title="releaseEvidenceTaskRunsTitle">
                {{ releaseEvidenceTaskRuns.statusLabel }}
              </strong>
            </div>
            <div v-if="releaseEvidenceAxEnterpriseGate">
              <span>AX 门禁</span>
              <strong data-codek-smoke="settings-release-evidence-ax-gate" :title="releaseEvidenceAxEnterpriseGateTitle">
                {{ releaseEvidenceAxEnterpriseGate.statusLabel }}
              </strong>
            </div>
            <div>
              <span>Markdown 路径</span>
              <button class="release-link-btn" :disabled="!releaseEvidenceMarkdownPath" :title="releaseEvidenceMarkdownPath" @click="openReleaseEvidenceReport()">
                {{ releaseEvidenceMarkdownPath || '暂无路径' }}
              </button>
            </div>
          </div>
          <div v-else class="release-evidence-latest">
            <div>
              <span>最近导出</span>
              <strong>暂无报告</strong>
            </div>
            <div>
              <span>证据状态</span>
              <strong>0/0 就绪 · 0 缺失</strong>
            </div>
            <div>
              <span>导出时间</span>
              <strong>尚未导出</strong>
            </div>
            <div>
              <span>LLM 用量</span>
              <strong data-codek-smoke="settings-release-evidence-llm-usage">0 次 · 0 tokens</strong>
            </div>
            <div>
              <span>本地估算成本</span>
              <strong data-codek-smoke="settings-release-evidence-llm-cost" title="暂无 LLM 用量成本估算">$0.0000</strong>
            </div>
          </div>
          <div v-if="releaseEvidenceReport?.gaps?.length" class="release-scenario-list" data-codek-smoke="settings-release-evidence-gaps">
            <div
              v-for="gap in releaseEvidenceReport.gaps.slice(0, 3)"
              :key="gap.id"
              class="release-scenario-row"
              :class="{ failed: gap.severity === 'high', warning: gap.severity === 'medium' }"
            >
              <span>{{ gap.title }}</span>
              <strong>{{ formatEvidenceGapStatus(gap.status) }}</strong>
              <small :title="gap.reason">{{ gap.reason }} · {{ gap.action }}</small>
            </div>
          </div>
          <div v-else class="settings-callout" data-codek-smoke="settings-release-evidence-gaps">
            {{ releaseEvidenceReport ? '证据链未发现阻塞缺口，发布前仍建议打开 Markdown 做人工复核。' : '尚未导出发布证据链。点击“导出 Markdown”后会汇总本地最新与历史证据，不会触发智能体执行、发布、上传或 PR。' }}
          </div>
          <div v-if="releaseEvidenceReport" class="release-ci-grid">
            <span>可用证据</span>
            <strong>{{ releaseEvidenceReport.summary.available }}/{{ releaseEvidenceReport.summary.total }}</strong>
            <span>就绪证据</span>
            <strong>{{ releaseEvidenceReport.summary.ready }}</strong>
            <span>缺失证据</span>
            <strong>{{ releaseEvidenceReport.summary.missing }}</strong>
            <span>生成时间</span>
            <strong>{{ formatEvidenceTime(releaseEvidenceReport.createdAt) }}</strong>
            <template v-if="releaseEvidenceLlmUsage">
              <span>provider usage</span>
              <strong>{{ releaseEvidenceLlmUsage.providerUsageRequests }}</strong>
              <span>估算 usage</span>
              <strong>{{ releaseEvidenceLlmUsage.estimatedUsageRequests }}</strong>
              <span>已配置价格</span>
              <strong>{{ releaseEvidenceLlmUsage.pricedRequests || 0 }}</strong>
              <span>缺价格</span>
              <strong>{{ releaseEvidenceLlmUsage.unpricedRequests || 0 }}</strong>
            </template>
            <template v-if="releaseEvidenceCodebaseContext">
              <span>上下文来源</span>
              <strong>{{ releaseEvidenceCodebaseContext.sources }}</strong>
              <span>索引状态</span>
              <strong :title="releaseEvidenceCodebaseContextTitle">{{ releaseEvidenceCodebaseContext.indexStatus.state }}/{{ releaseEvidenceCodebaseContext.indexStatus.freshness }}</strong>
              <span>截断来源</span>
              <strong>{{ releaseEvidenceCodebaseContext.truncatedSources }}</strong>
              <span>预算溢出</span>
              <strong>{{ releaseEvidenceCodebaseContext.overflowChars }}</strong>
            </template>
            <template v-if="releaseEvidenceSandboxSecurity">
              <span>隔离任务</span>
              <strong>{{ releaseEvidenceSandboxSecurity.isolatedAssignments }}/{{ releaseEvidenceSandboxSecurity.assignmentCount }}</strong>
              <span>质量门</span>
              <strong>{{ releaseEvidenceSandboxSecurity.qualityGateStatus }}</strong>
              <span>阻断命令</span>
              <strong>{{ releaseEvidenceSandboxSecurity.commandAuthorizationBlocked }}</strong>
              <span>权限越界</span>
              <strong>{{ releaseEvidenceSandboxSecurity.patchPermissionViolations }}</strong>
            </template>
            <template v-if="releaseEvidenceTaskRuns">
              <span>任务通过</span>
              <strong>{{ releaseEvidenceTaskRuns.passed }}/{{ releaseEvidenceTaskRuns.total }}</strong>
              <span>失败任务</span>
              <strong>{{ releaseEvidenceTaskRuns.failed }}</strong>
              <span>阻断/跳过</span>
              <strong>{{ releaseEvidenceTaskRuns.blocked + releaseEvidenceTaskRuns.skipped }}</strong>
              <span>并发任务</span>
              <strong>{{ releaseEvidenceTaskRuns.runs?.filter((item) => item.hasParallelSteps).length || 0 }}</strong>
            </template>
            <template v-if="releaseEvidenceAxEnterpriseGate">
              <span>AX 就绪</span>
              <strong>{{ releaseEvidenceAxEnterpriseGate.readyCount }}/{{ releaseEvidenceAxEnterpriseGate.total }}</strong>
              <span>AX 阻断</span>
              <strong>{{ releaseEvidenceAxEnterpriseGate.blocked }}</strong>
              <span>AX 缺口</span>
              <strong>{{ releaseEvidenceAxEnterpriseGate.missing }}</strong>
            </template>
          </div>
          <div v-if="releaseEvidenceLlmUsage?.unpricedModels?.length" class="settings-callout">
            未配置价格模型：{{ releaseEvidenceLlmUsage.unpricedModels.slice(0, 3).map((item) => `${item.provider || 'unknown'}/${item.model || 'unknown'}(${item.requests || 0})`).join('、') }}
          </div>
          <div v-if="releaseEvidenceHistory.length" class="release-scenario-list">
            <div
              v-for="item in releaseEvidenceHistory.slice(0, 4)"
              :key="item.jsonPath"
              class="release-scenario-row"
              :class="{ failed: item.status === 'missing', warning: item.status === 'degraded' }"
            >
              <span>{{ item.statusLabel || item.status }}</span>
              <strong>{{ item.summary.ready }}/{{ item.summary.total }}</strong>
              <small :title="item.markdownPath">
                {{ formatEvidenceTime(item.createdAt) }} ·
                <button class="release-inline-open" :disabled="!item.markdownPath" @click="openReleaseEvidenceReport(item.markdownPath)">打开</button>
                · {{ item.markdownPath }}
              </small>
            </div>
          </div>
          <div v-if="releaseEvidenceMarkdownPath" class="release-path" :title="releaseEvidenceMarkdownPath">{{ releaseEvidenceMarkdownPath }}</div>
          <div v-if="!releaseEvidenceReport" class="settings-callout">导出只汇总本地最新与历史证据，不会触发智能体执行、发布、上传或 PR。</div>
        </div>

        <div class="settings-row-stack release-card" data-codek-smoke="settings-run-action-audit-summary">
          <div class="settings-row-info settings-row-info-full">
            <div class="settings-row-title">控制台动作审计</div>
            <div class="settings-row-desc">{{ runActionAuditSubtitle }}</div>
          </div>
          <div v-if="runActionAuditHistory.length" class="release-scenario-list">
            <div
              v-for="item in runActionAuditHistory.slice(0, 5)"
              :key="item.id"
              class="release-scenario-row"
              :class="{ failed: item.status === 'error', warning: item.status === 'started' }"
            >
              <span>{{ item.title || item.actionId }}</span>
              <strong>{{ formatRunActionAuditStatus(item.status) }}</strong>
              <small :title="item.error || item.projectRoot">
                {{ item.runId || '无 run' }} · {{ item.durationMs || 0 }}ms · {{ item.error || item.summary || item.projectRoot || '已记录' }}
              </small>
            </div>
          </div>
          <div v-else class="settings-callout">暂无控制台主操作审计。进入任务中心执行主操作后，这里会展示已开始、成功、失败历史。</div>
        </div>

        <div class="settings-row-stack release-card" data-codek-smoke="settings-release-gate">
          <div class="settings-row-info settings-row-info-full">
            <div class="settings-row-title">发布质量门</div>
            <div class="settings-row-desc">{{ releaseGateSubtitle }}</div>
          </div>
          <div class="release-actions">
            <button class="settings-btn" :disabled="releaseBusy" @click="runSettingsReleaseGate('quick')">快速门</button>
            <button class="settings-btn" :disabled="releaseBusy" @click="runSettingsReleaseGate('build')">构建门</button>
            <button class="settings-btn" :disabled="releaseBusy" @click="runSettingsReleaseGate('full')">完整门</button>
          </div>
          <div v-if="releaseGateReport" class="release-step-list">
            <div
              v-for="step in releaseGateReport.steps"
              :key="step.id"
              class="release-step-row"
              :class="{ failed: !step.passed }"
            >
              <span>{{ step.label || step.id }}</span>
              <strong>{{ step.passed ? '通过' : '失败' }}</strong>
              <small :title="step.command">{{ step.command }}</small>
            </div>
          </div>
          <div v-if="releaseGateJsonPath" class="release-path" :title="releaseGateJsonPath">{{ releaseGateJsonPath }}</div>
        </div>

        <div class="settings-row-stack release-card" data-codek-smoke="settings-acceptance-summary">
          <div class="settings-row-info settings-row-info-full">
            <div class="settings-row-title">发布验收矩阵</div>
            <div class="settings-row-desc">{{ acceptanceSubtitle }}</div>
          </div>
          <div class="release-actions">
            <CodekSelect
              v-model="acceptanceTaskSet"
              :options="acceptanceTaskSetOptions"
              aria-label="发布验收任务集"
            />
            <button class="settings-btn" :disabled="acceptanceBusy" @click="runSettingsAcceptance">运行验收</button>
          </div>
          <div v-if="acceptanceReport?.matrix?.scenarios?.length" class="release-scenario-list">
            <div
              v-for="scenario in acceptanceReport.matrix.scenarios.slice(0, 6)"
              :key="scenario.id"
              class="release-scenario-row"
              :class="{ failed: !scenario.passed }"
            >
              <span>{{ scenario.label || scenario.id }}</span>
              <strong>{{ scenario.passed ? '通过' : '失败' }}</strong>
              <small>{{ formatAcceptanceStrategy(scenario.strategy) }}</small>
            </div>
          </div>
          <div v-if="acceptanceMarkdownPath" class="release-path" :title="acceptanceMarkdownPath">{{ acceptanceMarkdownPath }}</div>
        </div>

        <div class="settings-row-stack release-card" data-codek-smoke="settings-real-workspace-trial-summary">
          <div class="settings-row-info settings-row-info-full">
            <div class="settings-row-title">真实工作区试运行</div>
            <div class="settings-row-desc">{{ realTrialSubtitle }}</div>
          </div>
          <div v-if="realTrialDetail" class="release-ci-grid">
            <span>运行状态</span>
            <strong>{{ realTrialReport?.finalStatusLabel || realTrialDetail.status }}</strong>
            <span>执行策略</span>
            <strong>{{ formatAcceptanceStrategy(realTrialDetail.executionStrategy) }}</strong>
            <span>写入模式</span>
            <strong>{{ realTrialDetail.writeMode }}</strong>
            <span>变更文件</span>
            <strong>{{ realTrialDetail.filesChanged.length }}</strong>
            <span>确认前主工作区</span>
            <strong>{{ realTrialDetail.mainWorkspaceUntouchedBeforeAccept ? '未污染' : '需复核' }}</strong>
            <span>回滚</span>
            <strong>{{ realTrialDetail.rollbackAvailable ? '可用' : '不可用' }}</strong>
          </div>
          <div v-else class="settings-callout">暂无真实工作区试运行报告。运行 `npm run smoke:real-workspace-trial` 或在智能体面板发起试运行后，这里会显示最新和历史摘要。</div>
          <div v-if="realTrialDetail?.routerReason" class="release-trial-note">{{ realTrialDetail.routerReason }}</div>
          <div v-if="realTrialDetail?.filesChanged.length" class="release-scenario-list">
            <div
              v-for="file in realTrialDetail.filesChanged.slice(0, 6)"
              :key="file"
              class="release-scenario-row"
            >
              <span>{{ file }}</span>
              <strong>变更</strong>
              <small>{{ realTrialDetail.workspaceRoot }}</small>
            </div>
          </div>
          <div v-if="realTrialHistory.length" class="release-scenario-list">
            <div
              v-for="item in realTrialHistory.slice(0, 4)"
              :key="item.runId"
              class="release-scenario-row"
              :class="{ failed: item.finalStatus !== 'completed' }"
            >
              <span>{{ item.runId }}</span>
              <strong>{{ item.finalStatus }}</strong>
              <small>{{ formatAcceptanceStrategy(item.executionStrategy) }} · {{ item.filesChanged.length }} 个文件</small>
            </div>
          </div>
          <div v-if="realTrialMarkdownPath" class="release-path" :title="realTrialMarkdownPath">{{ realTrialMarkdownPath }}</div>
        </div>

        <div class="settings-row-stack release-card" data-codek-smoke="settings-release-ci">
          <div class="settings-row-info settings-row-info-full">
            <div class="settings-row-title">CI 契约</div>
            <div class="settings-row-desc">{{ releaseCiSubtitle }}</div>
          </div>
          <div class="release-ci-grid" data-codek-smoke="settings-release-ci-check">
            <span>pull_request</span>
            <strong>已启用</strong>
            <span>push main/master</span>
            <strong>已启用</strong>
            <span>workflow_dispatch</span>
            <strong>已启用</strong>
            <span>full smoke</span>
            <strong>本机手动</strong>
            <span>workflow</span>
            <strong :title="releaseCiCheckReport?.workflowPath || '安装态尚未读取 CI workflow'">{{ releaseCiCheckReport ? (releaseCiCheckReport.ok ? '通过' : '需处理') : '未读取' }}</strong>
            <span>最新证据链</span>
            <strong :title="releaseCiCheckReport?.releaseEvidence?.evidencePath || '暂无发布证据最新报告'">{{ releaseCiCheckReport?.releaseEvidence?.exists ? '已读取' : '未生成' }}</strong>
            <span>证据新鲜度</span>
            <strong data-codek-smoke="settings-release-ci-freshness" :title="releaseEvidenceFreshnessTitle">
              {{ releaseEvidenceFreshnessLabel }}
            </strong>
            <span>契约检查</span>
            <strong>{{ releaseCiCheckReport ? releaseCiCheckReport.checks.filter((check) => check.passed).length : 0 }}/{{ releaseCiCheckReport?.checks.length || 0 }}</strong>
          </div>
          <div v-if="releaseCiCheckReport?.releaseEvidence?.warnings?.length || releaseCiCheckReport?.warnings?.length" class="release-scenario-list">
            <div
              v-for="warning in [...(releaseCiCheckReport?.releaseEvidence?.warnings || []), ...(releaseCiCheckReport?.warnings || [])].slice(0, 4)"
              :key="warning.id"
              class="release-scenario-row warning"
            >
              <span>{{ warning.label }}</span>
              <strong>提示</strong>
              <small>{{ warning.detail || warning.id }}</small>
            </div>
          </div>
          <div v-if="releaseCiCheckReport?.checks?.length" class="release-scenario-list">
            <div
              v-for="check in releaseCiCheckReport.checks.slice(0, 4)"
              :key="check.id"
              class="release-scenario-row"
              :class="{ failed: !check.passed }"
            >
              <span>{{ check.label }}</span>
              <strong>{{ check.passed ? '通过' : '失败' }}</strong>
              <small>{{ check.detail || check.id }}</small>
            </div>
          </div>
        </div>
      </section>

      <section v-if="activeSection === 'languages'" class="settings-section-block">
        <h2 class="settings-h2">语言</h2>

        <SchemaSettingsSection group="languages" />

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-title">JDK 版本</div>
            <div class="settings-row-desc">供 Java 语言服务使用。</div>
          </div>
          <CodekSelect
            :model-value="langSettings.jdkVersion"
            :options="jdkOptions"
            aria-label="JDK 版本"
            @change="handleJdkVersionChange"
          />
        </div>

        <div class="settings-row settings-row-stack">
          <div class="settings-row-info">
            <div class="settings-row-title">启用语言</div>
            <div class="settings-row-desc">控制语言服务和代码补全是否启用。</div>
          </div>
          <div class="lang-grid">
            <label
              v-for="lang in languageList"
              :key="lang.id"
              class="lang-chip"
              :class="{ active: lang.enabled }"
            >
              <input type="checkbox" class="lang-checkbox" :checked="lang.enabled" @change="handleToggleLanguage(lang.id)" />
              <span class="lang-label">{{ lang.label }}</span>
              <span class="lang-ext">{{ lang.extension }}</span>
            </label>
          </div>
        </div>
      </section>

      <section v-if="activeSection === 'keybindings'" class="settings-section-block">
        <h2 class="settings-h2">快捷键</h2>
        <KeybindingSettings />
      </section>

      <section v-if="activeSection === 'advanced'" class="settings-section-block">
        <h2 class="settings-h2">高级</h2>
        <div class="settings-section-desc">VS Code 兼容和迁移控制。</div>

        <SettingsJsonPanel />

        <div class="settings-row settings-row-stack vscode-import-card" data-codek-smoke="vscode-import-card">
          <div class="settings-row-info settings-row-info-full">
            <div class="settings-row-title">VS Code / Cursor 配置迁移</div>
            <div class="settings-row-desc">
              读取本机 VS Code、Cursor、VS Code Insiders 的 User 数据，导入 settings.json、keybindings.json、snippets，并生成扩展清单。
            </div>
          </div>

          <div class="vscode-import-toolbar">
            <CodekSelect
              class="vscode-import-select"
              :model-value="selectedVsCodeImportSource"
              :options="vsCodeImportSourceOptions"
              placeholder="选择配置来源"
              aria-label="选择 VS Code 或 Cursor 配置来源"
              :disabled="vsCodeImportBusy"
              @change="handleVsCodeImportSourceChange"
            />
            <CodekSelect
              class="vscode-import-mode"
              :model-value="vsCodeImportMode"
              :options="vsCodeImportModeOptions"
              aria-label="导入模式"
              :disabled="vsCodeImportBusy"
              @change="vsCodeImportMode = $event as 'merge' | 'replace'"
            />
            <button class="settings-btn" type="button" :disabled="vsCodeImportBusy" @click="refreshVsCodeImportSources">
              {{ vsCodeImportBusy ? '处理中...' : '扫描来源' }}
            </button>
            <button class="settings-btn primary" type="button" :disabled="!selectedVsCodeImportSource || vsCodeImportBusy" @click="runVsCodeImport">
              导入
            </button>
          </div>

          <div v-if="vsCodeImportError" class="settings-error-text">{{ vsCodeImportError }}</div>

          <div v-if="vsCodeImportPreview" class="vscode-import-summary">
            <div class="vscode-import-count">
              <strong>{{ vsCodeImportPreview.settingsCount }}</strong>
              <span>设置</span>
            </div>
            <div class="vscode-import-count">
              <strong>{{ vsCodeImportPreview.keybindingsCount }}</strong>
              <span>快捷键</span>
            </div>
            <div class="vscode-import-count">
              <strong>{{ vsCodeImportPreview.snippetsCount }}</strong>
              <span>代码片段</span>
            </div>
            <div class="vscode-import-count">
              <strong>{{ vsCodeImportPreview.extensionsCount }}</strong>
              <span>扩展清单</span>
            </div>
            <div class="vscode-import-count">
              <strong>{{ vsCodeImportPreview.profilesCount }}</strong>
              <span>配置文件</span>
            </div>
          </div>

          <div v-if="vsCodeImportPreview && vsCodeImportProfileOptions.length > 1" class="vscode-import-profile-row">
            <div class="settings-row-info">
              <div class="settings-row-title">配置文件</div>
              <div class="settings-row-desc">选择默认用户配置或某个 VS Code 配置文件导入。</div>
            </div>
            <CodekSelect
              class="vscode-import-profile-select"
              :model-value="selectedVsCodeImportProfile"
              :options="vsCodeImportProfileOptions"
              aria-label="选择 VS Code 配置文件"
              :disabled="vsCodeImportBusy"
              @change="selectedVsCodeImportProfile = $event"
            />
          </div>

          <div v-if="vsCodeImportPreview?.extensions?.length" class="vscode-import-extension-list">
            <span class="settings-muted-text">已识别扩展：</span>
            <span v-for="extensionId in visibleVsCodeImportExtensions" :key="extensionId" class="settings-pill alt">{{ extensionId }}</span>
            <span v-if="vsCodeImportPreview.extensions.length > visibleVsCodeImportExtensions.length" class="settings-muted-text">
              另有 {{ vsCodeImportPreview.extensions.length - visibleVsCodeImportExtensions.length }} 个
            </span>
          </div>

          <div v-if="vsCodeImportResult" class="settings-callout">
            已导入 {{ vsCodeImportResult.settings.imported }} 项设置、{{ vsCodeImportResult.keybindings.imported }} 条快捷键、{{ vsCodeImportResult.snippets.imported }} 个代码片段。
            扩展已写入清单：{{ vsCodeImportResult.extensions.manifestPath || '未生成' }}。扩展安装仍需在扩展页确认，避免冲突扩展自动破坏当前工作台。
          </div>
        </div>

        <div class="settings-row settings-row-stack vscode-import-card" data-codek-smoke="workbench-profile-card">
          <div class="settings-row-info settings-row-info-full">
            <div class="settings-row-title">Codek 配置文件</div>
            <div class="settings-row-desc">
              保存和切换当前用户设置和快捷键快照。VS Code / Cursor 迁移完成后会自动生成同名配置文件，主题会按 Codek 内置主题自动映射。
            </div>
          </div>

          <div class="vscode-profile-toolbar">
            <CodekInput
              v-model="profileNameDraft"
              placeholder="配置文件名称"
              aria-label="配置文件名称"
            />
            <button class="settings-btn" type="button" @click="saveCurrentWorkbenchProfile">
              保存当前配置
            </button>
            <button class="settings-btn" type="button" :disabled="profileFileBusy" @click="pickAndImportWorkbenchProfileFile">
              导入 .code-profile
            </button>
          </div>

          <div v-if="profileError" class="settings-error-text">{{ profileError }}</div>
          <div v-if="profileFileMessage" class="settings-callout">{{ profileFileMessage }}</div>

          <div v-if="workbenchProfileSummaries.length" class="vscode-profile-list">
            <div
              v-for="profile in workbenchProfileSummaries"
              :key="profile.id"
              class="vscode-profile-row"
              :class="{ active: profile.active }"
            >
              <div class="vscode-profile-main">
                <strong>{{ profile.name }}</strong>
                <small>
                  {{ formatProfileSource(profile.source) }} · {{ profile.settingsCount }} 项设置 · {{ profile.keybindingsCount }} 条快捷键
                  <template v-if="profile.colorTheme"> · 主题 {{ formatProfileTheme(profile.colorTheme) }}</template>
                </small>
              </div>
              <div class="vscode-profile-actions">
                <button class="settings-btn" type="button" :disabled="profile.active" @click="switchWorkbenchProfile(profile.id)">
                  {{ profile.active ? '当前' : '切换' }}
                </button>
                <button class="settings-btn" type="button" :disabled="profileFileBusy" @click="exportWorkbenchProfileFile(profile.id)">
                  导出
                </button>
                <button class="settings-btn alt" type="button" @click="removeWorkbenchProfile(profile.id)">
                  删除
                </button>
              </div>
            </div>
          </div>
          <div v-else class="settings-callout">暂无配置文件。保存当前配置，或从 VS Code / Cursor 导入后会自动生成。</div>
        </div>

        <div class="settings-row settings-row-stack">
          <div class="settings-row-info">
            <div class="settings-row-title">VS Code 底层差距</div>
            <div class="settings-row-desc">Codek 目前使用 Monaco 加实验性的 VS Code 扩展主机桥接，还不是 Cursor 基于的完整 VS Code Workbench 分支。</div>
          </div>
          <div class="settings-callout">
            要完全接近 Cursor，需要迁移到 VS Code OSS Workbench，或继续当前兼容层路线，并补齐设置、命令、扩展、主题、任务、调试和 SCM 服务。
          </div>
        </div>
      </section>
      </div>
    </main>

    <Teleport to="body">
      <div v-if="ccsImportOpen" class="cloud-modal-mask">
        <div class="cloud-modal ccs-import-modal" @mousedown.stop>
          <div class="cloud-modal-head">
            <div class="cloud-modal-title">从 CCSwitch 导入供应商</div>
            <button class="cloud-modal-close" @click="ccsImportOpen = false">×</button>
          </div>
          <div class="cloud-modal-body">
            <div class="cloud-modal-hint">选择要导入的应用类型,导入后将自动归入对应分类。</div>
            <div class="ccs-import-grid">
              <button class="ccs-import-tile" :disabled="ccsImporting || !ccsInfo || ccsInfo.claudeCount === 0" @click="handleImportCcs('claude')">
                <div class="ccs-import-tile-title">从 Claude 导入</div>
                <div class="ccs-import-tile-desc">将 CCS 中 Claude 配置导入到 <b>Anthropic</b> 分类</div>
                <div class="ccs-import-tile-count">{{ ccsInfo ? ccsInfo.claudeCount : 0 }} 个供应商</div>
              </button>
              <button class="ccs-import-tile" :disabled="ccsImporting || !ccsInfo || ccsInfo.codexCount === 0" @click="handleImportCcs('codex')">
                <div class="ccs-import-tile-title">从 Codex 导入</div>
                <div class="ccs-import-tile-desc">将 CCS 中 Codex 配置导入到 <b>OpenAI 兼容</b> 分类</div>
                <div class="ccs-import-tile-count">{{ ccsInfo ? ccsInfo.codexCount : 0 }} 个供应商</div>
              </button>
            </div>
          </div>
          <div class="cloud-modal-foot">
            <button class="settings-btn" :disabled="ccsImporting" @click="ccsImportOpen = false">取消</button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="editorOpen" class="cloud-modal-mask">
        <div class="cloud-modal" @mousedown.stop>
          <div class="cloud-modal-head">
            <div class="cloud-modal-title">{{ editorIsNew ? '新建供应商' : '编辑供应商' }}</div>
            <button class="cloud-modal-close" @click="closeEditor">×</button>
          </div>

          <div class="cloud-modal-tabs">
            <button class="cloud-modal-tab" :class="{ active: editorTab === 'form' }" @click="editorTab = 'form'">基本配置</button>
            <button class="cloud-modal-tab" :class="{ active: editorTab === 'config' }" @click="editorTab = 'config'">config.toml</button>
            <button class="cloud-modal-tab" :class="{ active: editorTab === 'auth' }" @click="editorTab = 'auth'">auth.json</button>
          </div>

          <div v-if="editorTab === 'form'" class="cloud-modal-body">
            <label class="cloud-field">
              <span>名称</span>
              <CodekInput v-model="editorDraft.name" placeholder="例如: DeepSeek / Moonshot / OpenAI 官方" />
            </label>
            <label class="cloud-field">
              <span>协议</span>
              <CodekSegmented
                v-model="editorDraft.protocol"
                :options="cloudProtocolOptions"
                aria-label="供应商协议"
              />
            </label>
            <label class="cloud-field">
              <span>接口地址</span>
              <CodekInput v-model="editorDraft.baseUrl" variant="url" :placeholder="editorDraft.protocol === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1'" />
            </label>
            <label class="cloud-field">
              <span>API 密钥</span>
              <CodekInput v-model="editorDraft.apiKey" variant="secret" :placeholder="editorDraft.protocol === 'anthropic' ? 'sk-ant-...' : 'sk-...'" />
            </label>
            <label class="cloud-field">
              <span>模型</span>
              <div class="cloud-model-row">
                <CodekComboBox
                  v-model="editorDraft.model"
                  class="cloud-model-combo"
                  :options="fetchedModelComboOptions"
                  :loading="fetchingModels"
                  :placeholder="editorDraft.protocol === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o-mini'"
                  aria-label="供应商默认模型"
                />
                <button type="button" class="settings-btn cloud-fetch-btn" :disabled="fetchingModels" @click="fetchModelList">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 4 21 10 15 10"/></svg>
                  {{ fetchingModels ? '获取中...' : '获取模型列表' }}
                </button>
              </div>
            </label>
          </div>

          <div v-else-if="editorTab === 'config'" class="cloud-modal-body">
            <div class="cloud-modal-hint">config.toml — 修改后点击"保存"会同步回基本配置</div>
            <CodekTextarea class="cloud-modal-textarea" v-model="editorConfigToml" variant="code" :spellcheck="false" />
          </div>

          <div v-else class="cloud-modal-body">
            <div class="cloud-modal-hint">auth.json — 仅在本地 localStorage 中保存,不会上传</div>
            <CodekTextarea class="cloud-modal-textarea" v-model="editorAuthJson" variant="code" :spellcheck="false" />
          </div>

          <div class="cloud-modal-foot">
            <button class="settings-btn" @click="closeEditor">取消</button>
            <button class="settings-btn cloud-modal-primary" @click="saveEditor">保存</button>
          </div>
        </div>
      </div>

      <div class="cloud-toast-stack">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="cloud-toast"
          :class="{ ok: toast.kind === 'ok', err: toast.kind === 'err', info: toast.kind === 'info' }"
        >
          <div class="cloud-toast-title">{{ toast.title }}</div>
          <div v-if="toast.body" class="cloud-toast-body">{{ toast.body }}</div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, h, reactive, onMounted, onUnmounted, watch } from "vue"
import { useI18n } from "../i18n/index"
import {
  modelSettings,
  setOllamaHost,
  setProvider,
  setModelParams,
  setJdkVersion,
  toggleLanguage,
  JDK_VERSIONS,
  LANGUAGE_SUPPORTS,
  langSettings,
  PROVIDERS,
  addCloudProvider,
  updateCloudProvider,
  deleteCloudProvider,
  activateCloudProvider,
} from "../ai/models.js"
import { activeTheme, normalizeColorTheme, setTheme, setThemeFromWorkbenchValue, type ThemeId } from "../theme"
import KeybindingSettings from "./KeybindingSettings.vue"
import CodekComboBox, { type CodekComboBoxOption } from "./settings-controls/CodekComboBox.vue"
import CodekInput from "./settings-controls/CodekInput.vue"
import CodekSegmented, { type CodekSegmentedOption } from "./settings-controls/CodekSegmented.vue"
import CodekSelect, { type CodekSelectOption } from "./settings-controls/CodekSelect.vue"
import CodekTextarea from "./settings-controls/CodekTextarea.vue"
import SchemaSettingsSection from "./SchemaSettingsSection.vue"
import SettingsJsonPanel from "./SettingsJsonPanel.vue"
import { getCompletionModelOverride, setCompletionModelOverride } from "../ai/completionModelSettings"
import { workspace } from "../workspace/manager.js"
import { buildIndex } from "../ai/indexer"
import { api } from "../lib/api"
import { settingsStore } from "../settings/settingsStore"
import { workbenchProfileStore, type ProfileSource, type WorkbenchProfileSummary } from "../settings/profileStore"
import { readUserKeybindingsFile } from "../settings/keybindingsFileClient"
import {
  importVsCodeUserData,
  listVsCodeImportSources,
  previewVsCodeImport,
  type VsCodeImportPreview,
  type VsCodeImportResult,
  type VsCodeImportSource,
} from "../settings/vscodeImportClient"
import { userDataProfileImportExportService } from "../vscode-adapter/workbench/services/userDataProfile/browser/userDataProfileImportExportService"
import {
  checkOrchestratorReadiness,
  exportReleaseEvidenceSummary,
  getLatestAcceptanceReport,
  getLatestReleaseEvidenceSummary,
  getLatestReleaseGateReport,
  getLatestRealWorkspaceTrialReport,
  getReleaseCiCheckReport,
  listOrchestratorRunActionAudits,
  openEvalReport,
  runAcceptanceReport,
  runReleaseGateReport,
  type AcceptanceReportSummary,
  type AcceptanceTaskSetId,
  type AcceptanceTaskSetOption,
  type OrchestratorReadinessHistoryItem,
  type OrchestratorReadinessReport,
  type OrchestratorRunActionAudit,
  type RealWorkspaceTrialHistoryItem,
  type ReleaseEvidenceHistoryItem,
  type ReleaseEvidenceSummary,
  type ReleaseCiCheckReport,
  type ReleaseGateMode,
  type ReleaseGateReport,
  type RunTaskReport,
} from "../agent/orchestratorClient"

interface IndexState {
  size: number
  lastBuilt: number | null
  busy: boolean
  action: "rebuild" | "clear" | "refresh" | null
  progress: number
  message: string
}

const indexState = reactive<IndexState>({
  size: 0,
  lastBuilt: null,
  busy: false,
  action: null,
  progress: 0,
  message: "",
})

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

async function refreshIndexSize(): Promise<void> {
  if (!workspace.projectRoot) return
  indexState.busy = true
  indexState.action = "refresh"
  try {
    const result = await api.post<{ count: number }>("/index/size", { projectRoot: workspace.projectRoot })
    indexState.size = result?.count ?? 0
    indexState.message = ""
  } catch (err) {
    indexState.message = `刷新失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    indexState.busy = false
    indexState.action = null
  }
}

async function rebuildIndex(): Promise<void> {
  if (!workspace.projectRoot) {
    indexState.message = "尚未选择项目根目录。"
    return
  }
  indexState.busy = true
  indexState.action = "rebuild"
  indexState.progress = 0
  indexState.message = "正在扫描项目..."
  try {
    await api.post("/index/clear", { projectRoot: workspace.projectRoot })
    indexState.progress = 10
    indexState.message = "正在索引文件..."
    await buildIndex({ projectRoot: workspace.projectRoot })
    indexState.progress = 100
    indexState.lastBuilt = Date.now()
    indexState.message = "已完成。"
    await refreshIndexSize()
  } catch (err) {
    indexState.message = `重建失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    indexState.busy = false
    indexState.action = null
  }
}

async function clearIndex(): Promise<void> {
  if (!workspace.projectRoot) return
  indexState.busy = true
  indexState.action = "clear"
  try {
    await api.post("/index/clear", { projectRoot: workspace.projectRoot })
    indexState.size = 0
    indexState.lastBuilt = null
    indexState.message = "索引已清空。"
  } catch (err) {
    indexState.message = `清空失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    indexState.busy = false
    indexState.action = null
  }
}

const completionModelOverride = ref<string>(getCompletionModelOverride())
function onCompletionModelChange(value: string) {
  completionModelOverride.value = value
  setCompletionModelOverride(value)
}
const unsubscribeCompletionModel = settingsStore.subscribe((settings) => {
  const next = settings["codek.ai.completionModel"]
  completionModelOverride.value = typeof next === "string" ? next : ""
})
let profileStorageChangeUnsubscribe: (() => void) | undefined
onUnmounted(unsubscribeCompletionModel)
onUnmounted(() => {
  profileListSubscription.dispose()
  currentProfileSubscription.dispose()
  profileStorageChangeUnsubscribe?.()
})

type SandboxLevel = "standard" | "strict" | "paranoid"
const SANDBOX_STORAGE_KEY = "codek-sandbox-settings"

interface SandboxSettings {
  level: SandboxLevel
  blockNetwork: boolean
  writablePaths: string[]
}

function loadSandboxSettings(): SandboxSettings {
  try {
    const raw = localStorage.getItem(SANDBOX_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SandboxSettings>
      return {
        level: (parsed.level as SandboxLevel) || "standard",
        blockNetwork: parsed.blockNetwork !== false,
        writablePaths: Array.isArray(parsed.writablePaths) ? parsed.writablePaths : [],
      }
    }
  } catch {}
  return { level: "standard", blockNetwork: true, writablePaths: [] }
}

const initialSandbox = loadSandboxSettings()
const sandboxLevel = ref<SandboxLevel>(initialSandbox.level)
const sandboxBlockNetwork = ref<boolean>(initialSandbox.blockNetwork)
const sandboxWritable = ref<string>(initialSandbox.writablePaths.join("\n"))

function saveSandboxSettings(): void {
  const writablePaths = sandboxWritable.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
  const settings: SandboxSettings = {
    level: sandboxLevel.value,
    blockNetwork: sandboxBlockNetwork.value,
    writablePaths,
  }
  try { localStorage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(settings)) } catch {}
  const codekApi = window.codek?.api
  if (codekApi) codekApi("POST", "/sandbox/settings", settings).catch(() => {})
}

function toggleSandboxBlockNetwork(): void {
  sandboxBlockNetwork.value = !sandboxBlockNetwork.value
  saveSandboxSettings()
}

const { t } = useI18n()

type SectionId =
  | "general"
  | "codek-settings"
  | "vscode-settings"
  | "appearance"
  | "editor"
  | "files"
  | "search"
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
  | "advanced"

const activeSection = ref<SectionId>("general")
const searchQuery = ref("")
const activeSettingsQuery = ref("")

// Extension management state wired to the extension host.
import {
  reloadExtensionHost as ehReload,
  installVsixFile as ehInstallVsix,
  ehStatus as ehGetStatus,
  type VsixMetadata as VsixMeta,
} from "../extensions/ehClient"
import { extensionWorkbenchService } from "../extensions/extensionsWorkbenchService"

const extInstalledList = ref<VsixMeta[]>([])
const extHostStatus = ref<{ state: string; activated: number; error?: string }>({ state: "unknown", activated: 0 })
const extError = ref("")
const extHostBusy = ref(false)
const extInstallBusy = ref(false)
const extInstallMessage = ref("")
const vsCodeImportSources = ref<VsCodeImportSource[]>([])
const selectedVsCodeImportSource = ref("")
const selectedVsCodeImportProfile = ref("default")
const vsCodeImportPreview = ref<VsCodeImportPreview | null>(null)
const vsCodeImportResult = ref<VsCodeImportResult | null>(null)
const vsCodeImportBusy = ref(false)
const vsCodeImportError = ref("")
const vsCodeImportMode = ref<"merge" | "replace">("merge")
const workbenchProfileSummaries = ref<WorkbenchProfileSummary[]>(workbenchProfileStore.list())
const profileListSubscription = workbenchProfileStore.onDidChangeProfiles(() => refreshWorkbenchProfiles())
const currentProfileSubscription = workbenchProfileStore.onDidChangeCurrentProfile(() => refreshWorkbenchProfiles())
profileStorageChangeUnsubscribe = window.codek?.onUserDataProfileChanged?.(() => {
  void hydrateWorkbenchProfiles({ force: true })
})
const profileNameDraft = ref("")
const profileError = ref("")
const profileFileBusy = ref(false)
const profileFileMessage = ref("")
const releaseGateReport = ref<ReleaseGateReport | null>(null)
const releaseGateJsonPath = ref("")
const releaseBusy = ref(false)
const acceptanceReport = ref<AcceptanceReportSummary | null>(null)
const acceptanceMarkdownPath = ref("")
const acceptanceBusy = ref(false)
const acceptanceTaskSet = ref<AcceptanceTaskSetId>("standard")
const acceptanceTaskSets = ref<AcceptanceTaskSetOption[]>([
  { id: "standard", label: "标准", description: "完整发布验收" },
  { id: "quick", label: "快速", description: "开发态快速回归" },
  { id: "risk", label: "风险", description: "质量门、冲突和恢复动作" },
])
const realTrialReport = ref<RunTaskReport | null>(null)
const realTrialMarkdownPath = ref("")
const realTrialHistory = ref<RealWorkspaceTrialHistoryItem[]>([])
const readinessReport = ref<OrchestratorReadinessReport | null>(null)
const readinessBusy = ref(false)
const readinessMarkdownPath = ref("")
const readinessHistory = ref<OrchestratorReadinessHistoryItem[]>([])
const runActionAuditHistory = ref<OrchestratorRunActionAudit[]>([])
const releaseEvidenceReport = ref<ReleaseEvidenceSummary | null>(null)
const releaseEvidenceMarkdownPath = ref("")
const releaseEvidenceHistory = ref<ReleaseEvidenceHistoryItem[]>([])
const releaseEvidenceBusy = ref(false)
const releaseCiCheckReport = ref<ReleaseCiCheckReport | null>(null)

const extHostStatusText = computed(() => {
  const s = extHostStatus.value
  if (s.error) return `错误：${s.error}`
  return `状态：${s.state}（已激活 ${s.activated || 0}）`
})

function isInstalledExtensionDisabled(ext: VsixMeta): boolean {
  const availabilityStatus = String(ext.availability?.status || ext.status || "").toLowerCase()
  return availabilityStatus === "disabled" || ext.enabled === false
}

function getInstalledExtensionStatusLabel(ext: VsixMeta): string {
  return ext.availability?.label || ext.statusLabel || (isInstalledExtensionDisabled(ext) ? "已禁用" : "已启用")
}

async function refreshExtState() {
  try { extInstalledList.value = await extensionWorkbenchService.showInstalled() } catch (e) { extError.value = (e as Error).message }
  try { extHostStatus.value = await ehGetStatus() } catch {}
}

async function reloadExtHost() {
  extHostBusy.value = true
  extError.value = ""
  try {
    await ehReload()
    await refreshExtState()
  } catch (e) {
    extError.value = (e as Error)?.message || "重载失败"
  } finally {
    extHostBusy.value = false
  }
}

async function uninstallExt(id: string) {
  extError.value = ""
  try {
    const result = await extensionWorkbenchService.uninstall(id)
    if (!result.success) {
      extError.value = result.error || "卸载失败"
      return
    }
    await refreshExtState()
  } catch (e) {
    extError.value = (e as Error).message
  }
}

async function toggleExt(ext: VsixMeta) {
  extError.value = ""
  try {
    const result = isInstalledExtensionDisabled(ext)
      ? await extensionWorkbenchService.enable(ext.id)
      : await extensionWorkbenchService.disable(ext.id)
    if (!result.success) {
      extError.value = result.error || "切换扩展状态失败"
      return
    }
    await refreshExtState()
  } catch (e) {
    extError.value = (e as Error).message
  }
}

async function pickAndInstallVsix() {
  const codek: any = (window as any).codek
  extError.value = ""
  extInstallMessage.value = ""
  extInstallBusy.value = true
  try {
    if (!codek || typeof codek.openFileDialog !== "function") {
      extError.value = "当前运行环境不支持文件选择。"
      return
    }
    const result = await codek.openFileDialog({
      title: "选择 .vsix 扩展包",
      filters: [{ name: "VS Code Extension", extensions: ["vsix"] }],
      readContent: false,
    })
    const filePath = (result && (result.filePath || result.path || result[0])) || ""
    if (!filePath) {
      extInstallMessage.value = "已取消安装。"
      return
    }
    extInstallMessage.value = `正在安装：${filePath}`
    const r = await ehInstallVsix(filePath)
    if (!r.success) {
      extError.value = r.error || "安装失败"
      extInstallMessage.value = ""
      return
    }
    await refreshExtState()
    extInstallMessage.value = "扩展安装完成。"
  } catch (e) {
    extError.value = (e as Error)?.message || "安装失败"
  } finally {
    extInstallBusy.value = false
  }
}

// Lazy-load when extensions tab is opened.
watch(activeSection, (s) => {
  if (s === "extensions") refreshExtState()
  if (s === "release") refreshReleaseState()
})

const props = withDefaults(defineProps<{
  ollamaOk?: boolean
  selectedModel?: string
  activeModel?: string
  availableModels?: unknown[]
  formatOnSave?: boolean
  lintOnSave?: boolean
  collabEnabled?: boolean
  autoSaveMode?: string
  settingsQuery?: string
}>(), {
  ollamaOk: false,
  selectedModel: "",
  activeModel: "",
  availableModels: () => [],
  formatOnSave: false,
  lintOnSave: true,
  collabEnabled: false,
  autoSaveMode: "off",
  settingsQuery: "",
})

defineEmits(["changeModel", "refreshModels", "toggleFormatOnSave", "toggleLintOnSave", "toggleCollab", "changeAutoSave"])

const availableModelOptions = computed(() =>
  props.availableModels.filter((model): model is string => typeof model === "string" && model.length > 0),
)
const completionBaseModelOptions: CodekComboBoxOption[] = [
  { value: "", label: "（使用当前聊天模型）" },
  { value: "qwen2.5-coder:0.5b", label: "qwen2.5-coder:0.5b（Ollama，快速）" },
  { value: "qwen2.5-coder:1.5b", label: "qwen2.5-coder:1.5b (Ollama)" },
  { value: "qwen2.5-coder:3b", label: "qwen2.5-coder:3b (Ollama)" },
]
const completionModelComboOptions = computed<CodekComboBoxOption[]>(() => {
  const seen = new Set<string>()
  return [...completionBaseModelOptions, ...availableModelOptions.value.map((model) => ({ value: model, label: model }))]
    .filter((option) => {
      const key = String(option.value)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
})
const ollamaModelComboOptions = computed<CodekComboBoxOption[]>(() => (
  availableModelOptions.value.length > 0
    ? availableModelOptions.value.map((model) => ({ value: model, label: model }))
    : [{ value: "", label: "（无模型）" }]
))
const ollamaModelSelectStyle = computed(() => {
  const modelName = props.selectedModel || props.activeModel || modelSettings.preferredModel || "deepseek-v4:latest"
  const chars = Math.max(16, Math.min(56, String(modelName).length + 5))
  return { "--model-select-ch": `${chars}ch` }
})

const makeIcon = (path: string) => () => h(
  "svg",
  { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" },
  [h("path", { d: path })]
)

const IconGeneral = makeIcon("M12 1l2.39 6.84L21 9.27l-5.27 4.59L17.18 21 12 17.6 6.82 21l1.45-7.14L3 9.27l6.61-1.43z")
const IconModels = makeIcon("M21 16.5V7.5L12 3 3 7.5v9L12 21z M3 7.5l9 4.5 9-4.5 M12 12v9")
const IconEditor = makeIcon("M3 17.25V21h3.75L17.81 9.94l-3.75-3.75z M14.06 6.19l3.75 3.75")
const IconLanguages = makeIcon("M2 12h20 M12 2a15 15 0 0 1 0 20 M12 2a15 15 0 0 0 0 20 M3 16h18 M3 8h18")
const IconKeys = makeIcon("M3 11h13a4 4 0 1 1 0 8H3z M8 11V7a4 4 0 0 1 8 0")
const IconAppearance = makeIcon("M12 3a9 9 0 0 0 0 18h1.5a1.5 1.5 0 0 0 0-3H13a1.5 1.5 0 0 1 0-3h2a6 6 0 0 0 0-12z")
const IconFiles = makeIcon("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6")
const IconSearch = makeIcon("M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z M21 21l-4.35-4.35")
const IconSourceControl = makeIcon("M6 3v6a3 3 0 0 0 3 3h6 M18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z")
const IconExtensions = makeIcon("M9 3H5a2 2 0 0 0-2 2v4h6z M9 3h6v6H9z M15 3h4a2 2 0 0 1 2 2v4h-6z M3 9h6v6H3z M15 9h6v6h-6z M9 15h6v6H9z")
const IconAgent = makeIcon("M12 2v4 M5 8h14a2 2 0 0 1 2 2v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7a2 2 0 0 1 2-2z M8 13h.01 M16 13h.01")
const IconRules = makeIcon("M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01")
const IconIndexing = makeIcon("M4 4h16v4H4z M4 10h16v4H4z M4 16h16v4H4z")
const IconPrivacy = makeIcon("M12 2l7 4v6c0 5-3 8-7 10-4-2-7-5-7-10V6z")
const IconRelease = makeIcon("M12 3v12 M8 7l4-4 4 4 M5 21h14 M7 17h10")
const IconAdvanced = makeIcon("M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z")

type SettingsIcon = ReturnType<typeof makeIcon>

interface NavItem {
  id: SectionId
  label: string
  icon: SettingsIcon
  kicker: string
  description: string
  keywords: string[]
  badge?: string
}

interface NavGroup {
  label: string
  items: NavItem[]
}

interface LanguageSupport {
  id: string
  label: string
  extension: string
  icon?: string
}

const cloudProviders = computed<any[]>(() => Array.isArray(modelSettings.cloudProviders) ? modelSettings.cloudProviders as any[] : [])
const enabledLanguages = computed<string[]>(() =>
  Array.isArray(langSettings.enabledLanguages) ? langSettings.enabledLanguages as string[] : [],
)

const navGroups = computed<NavGroup[]>(() => [
  {
    label: "设置",
    items: [
      {
        id: "codek-settings",
        label: "Codek 设置",
        icon: IconAgent,
        kicker: "设置",
        description: "Codek、Codex、智能体、多智能体、沙箱、索引和隐私设置。",
        keywords: ["codek", "codex", "agent", "multi-agent", "sandbox", "goals", "设置"],
      },
      {
        id: "vscode-settings",
        label: "VS Code 兼容设置",
        icon: IconEditor,
        kicker: "设置",
        description: "VS Code 兼容编辑器、文件、搜索、扩展、快捷键和 JSON 设置。",
        keywords: ["vscode", "settings json", "keybindings", "editor", "files", "设置"],
      },
      {
        id: "general",
        label: "通用",
        icon: IconGeneral,
        kicker: "设置",
        description: "基础界面、主题和保存行为。",
        keywords: ["language", "theme", "auto save", "语言", "主题", "保存"],
      },
      {
        id: "appearance",
        label: "外观",
        icon: IconAppearance,
        kicker: "工作台",
        description: "主题、图标主题和工作台布局。",
        keywords: ["appearance", "theme", "workbench", "layout", "icon theme", "外观", "布局"],
      },
      {
        id: "editor",
        label: "编辑器",
        icon: IconEditor,
        kicker: "编辑器",
        description: "编辑器字体、缩进、换行、保存时格式化和建议。",
        keywords: ["editor", "format", "lint", "font", "tab", "word wrap", "minimap", "编辑器", "格式化"],
      },
      {
        id: "files",
        label: "文件",
        icon: IconFiles,
        kicker: "文件",
        description: "自动保存、编码、换行符和文件排除。",
        keywords: ["files", "auto save", "encoding", "eol", "exclude", "文件", "编码"],
      },
      {
        id: "search",
        label: "搜索",
        icon: IconSearch,
        kicker: "搜索",
        description: "搜索包含、排除和 ignore 文件行为。",
        keywords: ["search", "glob", "ignore", "exclude", "搜索"],
      },
      {
        id: "source-control",
        label: "源代码管理",
        icon: IconSourceControl,
        kicker: "Git",
        description: "Git、提交和 SCM 行为。",
        keywords: ["git", "scm", "source control", "commit", "源代码管理"],
      },
      {
        id: "extensions",
        label: "扩展",
        icon: IconExtensions,
        kicker: "扩展",
        description: "扩展宿主、Marketplace、VSIX 和 VS Code API 兼容。",
        keywords: ["extensions", "marketplace", "vsix", "open vsx", "vscode api", "扩展"],
        badge: "实验",
      },
      {
        id: "keybindings",
        label: "快捷键",
        icon: IconKeys,
        kicker: "快捷键",
        description: "查看和调整编辑器快捷键。",
        keywords: ["keyboard", "shortcut", "keybinding", "快捷键"],
      },
      {
        id: "advanced",
        label: "高级",
        icon: IconAdvanced,
        kicker: "高级",
        description: "设置 JSON、导入 VS Code / Cursor 设置和底层兼容路线。",
        keywords: ["advanced", "settings json", "import vscode", "import cursor", "高级", "迁移"],
      },
    ],
  },
  {
    label: "智能",
    items: [
      {
        id: "models",
        label: "模型",
        icon: IconModels,
        kicker: "智能",
        description: "管理本地模型、云端供应商和模型参数。",
        keywords: ["models", "ollama", "openai", "anthropic", "ccswitch", "模型", "供应商"],
        badge: cloudProviders.value.length > 0 ? String(cloudProviders.value.length) : undefined,
      },
      {
        id: "agent",
        label: "智能体",
        icon: IconAgent,
        kicker: "智能体",
        description: "智能体模式、审批策略和沙箱行为。",
        keywords: ["agent", "composer", "approval", "sandbox", "auto", "智能体"],
      },
      {
        id: "rules",
        label: "规则与记忆",
        icon: IconRules,
        kicker: "规则",
        description: "用户规则、项目规则和记忆管理。",
        keywords: ["rules", "memory", "memories", "cursor rules", "规则", "记忆"],
        badge: "计划",
      },
      {
        id: "indexing",
        label: "索引",
        icon: IconIndexing,
        kicker: "上下文",
        description: "代码库索引、Web 搜索、上下文和文档源。",
        keywords: ["indexing", "context", "web search", "embedding", "索引", "上下文"],
      },
      {
        id: "privacy",
        label: "隐私",
        icon: IconPrivacy,
        kicker: "隐私",
        description: "隐私模式、本地优先和云端模型限制。",
        keywords: ["privacy", "telemetry", "cloud", "local", "隐私"],
      },
      {
        id: "release",
        label: "发布与验收",
        icon: IconRelease,
        kicker: "发布",
        description: "发布质量门、CI 契约、验收矩阵和最近报告。",
        keywords: ["release", "ci", "gate", "acceptance", "smoke", "发布", "验收", "质量门"],
      },
      {
        id: "languages",
        label: "语言",
        icon: IconLanguages,
        kicker: "语言",
        description: "配置语言服务、JDK 版本和语言开关。",
        keywords: ["language server", "jdk", "java", "typescript", "语言服务"],
      },
    ],
  },
])

const filteredNavGroups = computed<NavGroup[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return navGroups.value

  return navGroups.value
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        [item.label, item.kicker, item.description, ...item.keywords]
          .join(" ")
          .toLowerCase()
          .includes(query),
      ),
    }))
    .filter((group) => group.items.length > 0)
})

const flatNavItems = computed(() => navGroups.value.flatMap((group) => group.items))

function getSectionState(id: SectionId) {
  if (id === "codek-settings") return "Codek 产品设置"
  if (id === "vscode-settings") return "VS Code 兼容"
  if (id === "models") {
    const count = cloudProviders.value.length
    return count > 0 ? `${count} 个供应商` : "仅本地"
  }
  if (id === "extensions") return "实验性 VS Code EH"
  if (id === "rules" || id === "advanced") return "计划中"
  if (id === "release") return releaseGateReport.value?.ready ? "发布就绪" : "待检查"
  if (id === "agent" || id === "indexing" || id === "privacy") return "部分接线"
  if (id === "languages") return `已启用 ${enabledLanguages.value.length} 个`
  return "已本地保存"
}

const currentSectionMeta = computed(() => {
  const item = flatNavItems.value.find((navItem) => navItem.id === activeSection.value) || flatNavItems.value[0]
  return { ...item, state: getSectionState(item.id) }
})

const settingsQueryEvidence = computed(() => {
  const query = activeSettingsQuery.value.trim()
  if (!query || activeSection.value !== "vscode-settings") return null
  const tag = query.startsWith("@tag:") ? query.slice("@tag:".length) : ""
  return {
    query,
    tag,
    section: activeSection.value,
    contract: "IPreferencesService.openUserSettings",
    description: tag === "workspaceTrust"
      ? "已按 VS Code @tag 查询筛选工作区信任设置。"
      : "已按查询筛选 VS Code 兼容设置。",
  }
})

const vsCodeImportSourceOptions = computed<CodekSelectOption[]>(() =>
  vsCodeImportSources.value.map((source) => ({
    value: source.userDir,
    label: `${source.label}${source.exists ? "" : "（未发现）"} - ${source.userDir}`,
  })),
)

const vsCodeImportModeOptions: CodekSelectOption[] = [
  { value: "merge", label: "合并导入" },
  { value: "replace", label: "替换导入" },
]

const vsCodeImportProfileOptions = computed<CodekSelectOption[]>(() => {
  const preview = vsCodeImportPreview.value
  if (!preview) return [{ value: "default", label: "默认 User 配置" }]
  return [
    { value: "default", label: `默认 User 配置（${preview.settingsCount} 项设置）` },
    ...(preview.profiles || []).map((profile) => ({
      value: profile.id,
      label: `${profile.name || profile.id}（${profile.settingsCount} 项设置）`,
    })),
  ]
})

const visibleVsCodeImportExtensions = computed(() => (vsCodeImportPreview.value?.extensions || []).slice(0, 8))

async function refreshVsCodeImportSources(): Promise<void> {
  vsCodeImportBusy.value = true
  vsCodeImportError.value = ""
  try {
    const sources = await listVsCodeImportSources()
    vsCodeImportSources.value = sources
    const firstExisting = sources.find((source) => source.exists) || sources[0]
    if (firstExisting && !selectedVsCodeImportSource.value) {
      selectedVsCodeImportSource.value = firstExisting.userDir
      await loadVsCodeImportPreview(firstExisting.userDir)
    }
  } catch (error: any) {
    vsCodeImportError.value = error?.message || String(error)
  } finally {
    vsCodeImportBusy.value = false
  }
}

async function loadVsCodeImportPreview(userDir: string): Promise<void> {
  if (!userDir) return
  vsCodeImportBusy.value = true
  vsCodeImportError.value = ""
  vsCodeImportResult.value = null
  try {
    vsCodeImportPreview.value = await previewVsCodeImport(userDir)
    selectedVsCodeImportProfile.value = "default"
  } catch (error: any) {
    vsCodeImportPreview.value = null
    vsCodeImportError.value = error?.message || String(error)
  } finally {
    vsCodeImportBusy.value = false
  }
}

function handleVsCodeImportSourceChange(userDir: string): void {
  selectedVsCodeImportSource.value = userDir
  void loadVsCodeImportPreview(userDir)
}

async function runVsCodeImport(): Promise<void> {
  if (!selectedVsCodeImportSource.value) return
  vsCodeImportBusy.value = true
  vsCodeImportError.value = ""
  try {
    const result = await importVsCodeUserData(
      selectedVsCodeImportSource.value,
      vsCodeImportMode.value,
      selectedVsCodeImportProfile.value,
    )
    vsCodeImportResult.value = result
    syncImportedUserProfile(result)
    pushToast("ok", "迁移完成", `已导入 ${result.settings.imported} 项设置和 ${result.keybindings.imported} 条快捷键`)
  } catch (error: any) {
    vsCodeImportError.value = error?.message || String(error)
    pushToast("err", "迁移失败", vsCodeImportError.value)
  } finally {
    vsCodeImportBusy.value = false
  }
}

function syncImportedUserProfile(result: VsCodeImportResult): void {
  if (!result.profileTemplate) return
  const profile = workbenchProfileStore.importFromVsCodeTemplate({
    template: result.profileTemplate,
    snapshot: result.profileSnapshot,
    id: `imported-${detectProfileSource(result.source)}-${result.profileId || "default"}`,
    source: detectProfileSource(result.source),
    activate: true,
  })
  setThemeFromWorkbenchValue(profile.settings["workbench.colorTheme"])
}

function refreshWorkbenchProfiles(): void {
  workbenchProfileSummaries.value = workbenchProfileStore.list()
}

async function hydrateWorkbenchProfiles(options: { force?: boolean } = {}): Promise<void> {
  try {
    if (options.force) {
      await workbenchProfileStore.refreshFromProfileStorage()
    } else {
      await workbenchProfileStore.hydrateFromProfileStorage()
    }
    refreshWorkbenchProfiles()
  } catch {
    // Profiles keep localStorage as a fallback when desktop profile storage is unavailable.
  }
}

async function pickAndImportWorkbenchProfileFile(): Promise<void> {
  profileError.value = ""
  profileFileMessage.value = ""
  profileFileBusy.value = true
  try {
    await syncWorkbenchProfileContentHandlers()
    const result = await userDataProfileImportExportService.importProfileFromFile()
    if (result.status === "cancelled") {
      profileFileMessage.value = "已取消导入。"
      return
    }
    setThemeFromWorkbenchValue(result.profile.settings["workbench.colorTheme"])
    profileFileMessage.value = `已导入：${result.profile.name}`
    pushToast("ok", "配置文件已导入", result.profile.name)
  } catch (error: any) {
    profileError.value = error?.message || String(error)
    pushToast("err", "配置文件导入失败", profileError.value)
  } finally {
    profileFileBusy.value = false
  }
}

async function exportWorkbenchProfileFile(profileId: string): Promise<void> {
  profileError.value = ""
  profileFileMessage.value = ""
  profileFileBusy.value = true
  try {
    await syncWorkbenchProfileContentHandlers()
    const result = await userDataProfileImportExportService.exportProfileToFile(profileId)
    if (result.status === "cancelled") {
      profileFileMessage.value = "已取消导出。"
      return
    }
    profileFileMessage.value = `已导出：${result.filePath}`
    pushToast("ok", "配置文件已导出", result.filePath)
  } catch (error: any) {
    profileError.value = error?.message || String(error)
    pushToast("err", "配置文件导出失败", profileError.value)
  } finally {
    profileFileBusy.value = false
  }
}

async function syncWorkbenchProfileContentHandlers(): Promise<void> {
  try {
    await userDataProfileImportExportService.syncExtensionProfileContentHandlers()
  } catch (error: any) {
    profileFileMessage.value = `扩展配置文件供应商暂不可用，继续使用本地文件：${error?.message || String(error)}`
  }
}

async function saveCurrentWorkbenchProfile(): Promise<void> {
  profileError.value = ""
  try {
    const name = profileNameDraft.value.trim() || `Codek 配置文件 ${workbenchProfileSummaries.value.length + 1}`
    const keybindings = await readUserKeybindingsFile().then((file) => file.keybindings).catch(() => [])
    workbenchProfileStore.saveCurrent(name, { source: "manual", keybindings })
    profileNameDraft.value = ""
    pushToast("ok", "配置文件已保存", name)
  } catch (error: any) {
    profileError.value = error?.message || String(error)
    pushToast("err", "配置文件保存失败", profileError.value)
  }
}

function switchWorkbenchProfile(profileId: string): void {
  profileError.value = ""
  try {
    const profile = workbenchProfileStore.switchTo(profileId)
    setThemeFromWorkbenchValue(profile.settings["workbench.colorTheme"])
    pushToast("ok", "配置文件已切换", profile.name)
  } catch (error: any) {
    profileError.value = error?.message || String(error)
    pushToast("err", "配置文件切换失败", profileError.value)
  }
}

function removeWorkbenchProfile(profileId: string): void {
  profileError.value = ""
  try {
    workbenchProfileStore.remove(profileId)
  } catch (error: any) {
    profileError.value = error?.message || String(error)
  }
}

function detectProfileSource(sourcePath: string): ProfileSource {
  const source = sourcePath.toLowerCase()
  if (source.includes("cursor")) return "cursor"
  if (source.includes("code")) return "vscode"
  return "codek"
}

function formatProfileSource(source: ProfileSource): string {
  if (source === "cursor") return "Cursor"
  if (source === "vscode") return "VS Code"
  if (source === "manual") return "手动"
  return "Codek"
}

function formatProfileTheme(value: string): string {
  const normalized = normalizeColorTheme(value)
  if (normalized === "light") return "浅色"
  if (normalized === "dark") return "深色"
  return value
}

const releaseGateSubtitle = computed(() => {
  if (releaseBusy.value) return "发布质量门正在运行"
  if (!releaseGateReport.value) return "尚未生成 release gate 报告"
  const passed = releaseGateReport.value.steps.filter((step) => step.passed).length
  const total = releaseGateReport.value.plannedSteps.length || releaseGateReport.value.steps.length
  return `${formatReleaseGateMode(releaseGateReport.value.mode)} · ${passed}/${total} 步通过 · ${releaseGateReport.value.durationMs || 0}ms`
})

const acceptanceSubtitle = computed(() => {
  if (acceptanceBusy.value) return "发布验收正在运行"
  if (!acceptanceReport.value) return "尚未生成发布验收报告"
  const matrix = acceptanceReport.value.matrix
  const taskSet = formatAcceptanceTaskSet(acceptanceReport.value.taskSet)
  return `${taskSet} · 检查 ${acceptanceReport.value.passed}/${acceptanceReport.value.total} · 场景 ${matrix?.passed || 0}/${matrix?.total || 0}`
})

const realTrialDetail = computed(() => realTrialReport.value?.realWorkspaceTrial || null)

const realTrialStatusLabel = computed(() => {
  const trial = realTrialDetail.value
  if (!trial) return "暂无报告"
  if (!trial.mainWorkspaceUntouchedBeforeAccept) return "需复核"
  if (trial.status === "completed" && trial.rollbackAvailable) return "可验收"
  return trial.status || realTrialReport.value?.finalStatusLabel || "已记录"
})

const realTrialSubtitle = computed(() => {
  const trial = realTrialDetail.value
  if (!trial) return "尚未生成真实工作区试运行报告"
  const strategy = formatAcceptanceStrategy(trial.executionStrategy)
  const files = trial.filesChanged.length
  const safety = trial.mainWorkspaceUntouchedBeforeAccept ? "确认前主工作区未污染" : "主工作区需复核"
  const rollback = trial.rollbackAvailable ? "可回滚" : "无回滚"
  return `${strategy} · ${files} 个文件 · ${safety} · ${rollback}`
})

const readinessSubtitle = computed(() => {
  if (readinessBusy.value) return "正在刷新企业级运行预检"
  if (!readinessReport.value) return "尚未执行运行预检"
  const summary = readinessReport.value.summary
  return `${readinessReport.value.statusLabel} · ${summary.passed}/${summary.total} 通过 · ${summary.warning} 个需处理 · ${summary.failed} 个阻断`
})

const latestRunActionAudit = computed(() => runActionAuditHistory.value[0] || null)

const runActionAuditStatusLabel = computed(() => {
  const latest = latestRunActionAudit.value
  if (!latest) return "暂无记录"
  return formatRunActionAuditStatus(latest.status)
})

const runActionAuditSubtitle = computed(() => {
  const latest = latestRunActionAudit.value
  if (!latest) return "尚未记录企业运行控制台主操作"
  const time = new Date(latest.finishedAt || latest.createdAt).toLocaleString()
  const duration = latest.durationMs ? ` · ${latest.durationMs}ms` : ""
  const detail = latest.status === "error" && latest.error ? ` · ${latest.error}` : duration
  return `${latest.title || latest.actionId} · ${formatRunActionAuditStatus(latest.status)} · ${time}${detail}`
})

const releaseEvidenceSubtitle = computed(() => {
  if (releaseEvidenceBusy.value) return "正在生成发布验收证据链 Markdown"
  if (!releaseEvidenceReport.value) return "尚未导出发布验收证据链"
  const summary = releaseEvidenceReport.value.summary
  return `${releaseEvidenceReport.value.statusLabel} · ${summary.available}/${summary.total} 项可用 · ${summary.ready} 项就绪`
})

const releaseEvidenceLlmUsage = computed(() => {
  if (!releaseEvidenceReport.value) return null
  return releaseEvidenceReport.value.evidence?.llmUsage || {
    available: false,
    ready: false,
    statusLabel: "暂无记录",
    totalRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    providerUsageRequests: 0,
    estimatedUsageRequests: 0,
    estimatedCostUsd: 0,
    costCurrency: "USD",
    costEstimated: true,
    pricedRequests: 0,
    unpricedRequests: 0,
    unpricedModels: [],
  }
})

const releaseEvidenceLlmCostTitle = computed(() => {
  const usage = releaseEvidenceLlmUsage.value
  if (!usage) return "暂无 LLM 用量成本估算"
  const unpriced = usage.unpricedRequests || 0
  const priced = usage.pricedRequests || 0
  return `本地价格表估算，不代表真实账单；已配置价格 ${priced} 次，缺价格 ${unpriced} 次。`
})

const releaseEvidenceCodebaseContext = computed(() => releaseEvidenceReport.value?.evidence?.codebaseContext || null)

const releaseEvidenceCodebaseContextTitle = computed(() => {
  const context = releaseEvidenceCodebaseContext.value
  if (!context) return "暂无代码库上下文发布证据"
  const index = context.indexStatus
  return [
    `run ${context.runId || "-"}`,
    `sources ${context.sources}`,
    `workspace ${context.workspaceSources}`,
    `indexed ${index.indexedFiles}/${index.indexableFiles}`,
    `excluded ${index.excludedFiles}`,
    `warnings ${context.warnings}`,
    `truncated ${context.truncatedSources}`,
    `overflow ${context.overflowChars}`,
  ].join(" · ")
})

const releaseEvidenceSandboxSecurity = computed(() => releaseEvidenceReport.value?.evidence?.sandboxSecurity || null)

const releaseEvidenceSandboxSecurityTitle = computed(() => {
  const sandbox = releaseEvidenceSandboxSecurity.value
  if (!sandbox) return "暂无沙箱安全发布证据"
  const isolation = Object.entries(sandbox.workspaceIsolationTypes || {})
    .map(([type, count]) => `${type}:${count}`)
    .join(", ") || "-"
  const violations = sandbox.violations?.map((item) => item.id).join(", ") || "none"
  return [
    `run ${sandbox.runId || "-"}`,
    `isolation ${isolation}`,
    `permission ${sandbox.permissionStatus}/${sandbox.permissionRisk || "-"}`,
    `paths ${sandbox.writePathCount}`,
    `commands ${sandbox.commandAllowlistCount}`,
    `gate ${sandbox.qualityGateStatus}`,
    `blocked ${sandbox.commandAuthorizationBlocked}`,
    `violations ${violations}`,
  ].join(" · ")
})

const releaseEvidenceTaskRuns = computed(() => releaseEvidenceReport.value?.evidence?.taskRuns || null)

const releaseEvidenceTaskRunsTitle = computed(() => {
  const taskRuns = releaseEvidenceTaskRuns.value
  if (!taskRuns) return "暂无任务运行发布证据"
  const latest = taskRuns.latest
    ? `${taskRuns.latest.name || taskRuns.latest.id || "-"}:${taskRuns.latest.status}/${taskRuns.latest.durationMs ?? "-"}ms`
    : "-"
  const parallelRuns = taskRuns.runs?.filter((item) => item.hasParallelSteps).length || 0
  return [
    `total ${taskRuns.total}`,
    `通过 ${taskRuns.passed}`,
    `失败 ${taskRuns.failed}`,
    `阻断 ${taskRuns.blocked}`,
    `运行中 ${taskRuns.running}`,
    `并行 ${parallelRuns}`,
    `最新 ${latest}`,
  ].join(" 路 ")
})

const releaseEvidenceAxEnterpriseGate = computed(() => releaseEvidenceReport.value?.evidence?.axEnterpriseGate || null)

const releaseEvidenceAxEnterpriseGateTitle = computed(() => {
  const gate = releaseEvidenceAxEnterpriseGate.value
  if (!gate) return "暂无 AX 企业级门禁发布证据"
  return [
    `就绪 ${gate.readyCount}/${gate.total}`,
    `阻断 ${gate.blocked}`,
    `缺口 ${gate.missing}`,
    `状态 ${gate.status || "-"}`,
  ].join(" · ")
})

const releaseCiSubtitle = computed(() => {
  const report = releaseCiCheckReport.value
  if (!report) return "尚未读取 CI 契约检查结果"
  const passed = report.checks.filter((check) => check.passed).length
  const warnings = report.warnings.length + (report.releaseEvidence?.warnings?.length || 0)
  const evidence = report.releaseEvidence?.exists ? "已读取最新证据链" : "未发现最新证据链"
  return `${report.ok ? "契约通过" : "契约需处理"} · ${passed}/${report.checks.length} 项通过 · ${evidence} · ${releaseEvidenceFreshnessLabel.value} · ${warnings} 个提示`
})

const releaseEvidenceFreshnessLabel = computed(() => {
  const evidence = releaseCiCheckReport.value?.releaseEvidence
  if (!evidence?.exists) return "未生成"
  if (evidence.fresh) return "新鲜"
  return "可能过期"
})

const releaseEvidenceFreshnessTitle = computed(() => {
  const evidence = releaseCiCheckReport.value?.releaseEvidence
  if (!evidence?.exists) return evidence?.evidencePath || "暂无发布证据最新报告"
  const created = evidence.createdAt ? formatEvidenceTime(evidence.createdAt) : "未知时间"
  const age = formatDurationMs(evidence.ageMs || 0)
  const max = formatDurationMs(evidence.maxAgeMs || 0)
  return `生成时间：${created}；年龄：${age}；建议阈值：${max}`
})

async function refreshReleaseState(): Promise<void> {
  const [releaseGate, acceptance, realTrial, readiness, runActionAudits, releaseEvidence, releaseCi] = await Promise.all([
    getLatestReleaseGateReport(),
    getLatestAcceptanceReport(),
    getLatestRealWorkspaceTrialReport(),
    checkOrchestratorReadiness({
      projectRoot: workspace.projectRoot || "",
      settings: settingsStore.getAll(),
    }),
    listOrchestratorRunActionAudits(),
    getLatestReleaseEvidenceSummary(),
    getReleaseCiCheckReport(),
  ])
  releaseGateReport.value = releaseGate.report
  releaseGateJsonPath.value = releaseGate.jsonPath
  acceptanceReport.value = acceptance.report
  acceptanceMarkdownPath.value = acceptance.markdownPath
  if (acceptance.taskSets.length) acceptanceTaskSets.value = acceptance.taskSets
  if (acceptance.report?.taskSet) acceptanceTaskSet.value = acceptance.report.taskSet
  realTrialReport.value = realTrial.report
  realTrialMarkdownPath.value = realTrial.markdownPath
  realTrialHistory.value = realTrial.history
  readinessReport.value = readiness.report
  readinessMarkdownPath.value = readiness.markdownPath
  readinessHistory.value = readiness.history
  runActionAuditHistory.value = runActionAudits.history
  releaseEvidenceReport.value = releaseEvidence.report
  releaseEvidenceMarkdownPath.value = releaseEvidence.markdownPath
  releaseEvidenceHistory.value = releaseEvidence.history
  releaseCiCheckReport.value = releaseCi
}

async function refreshReadinessState(): Promise<void> {
  if (readinessBusy.value) return
  readinessBusy.value = true
  try {
    const result = await checkOrchestratorReadiness({
      projectRoot: workspace.projectRoot || "",
      settings: settingsStore.getAll(),
    })
    readinessReport.value = result.report
    readinessMarkdownPath.value = result.markdownPath
    readinessHistory.value = result.history
  } finally {
    readinessBusy.value = false
  }
}

async function runSettingsReleaseGate(mode: ReleaseGateMode): Promise<void> {
  if (releaseBusy.value) return
  releaseBusy.value = true
  try {
    const result = await runReleaseGateReport(mode)
    releaseGateReport.value = result.report
    releaseGateJsonPath.value = result.jsonPath
  } finally {
    releaseBusy.value = false
  }
}

async function runSettingsAcceptance(): Promise<void> {
  if (acceptanceBusy.value) return
  acceptanceBusy.value = true
  try {
    const result = await runAcceptanceReport(acceptanceTaskSet.value)
    acceptanceReport.value = result.report
    acceptanceMarkdownPath.value = result.markdownPath
    if (result.taskSets.length) acceptanceTaskSets.value = result.taskSets
  } finally {
    acceptanceBusy.value = false
  }
}

async function exportSettingsReleaseEvidence(): Promise<void> {
  if (releaseEvidenceBusy.value) return
  releaseEvidenceBusy.value = true
  try {
    const result = await exportReleaseEvidenceSummary()
    releaseEvidenceReport.value = result.report
    releaseEvidenceMarkdownPath.value = result.markdownPath
    releaseEvidenceHistory.value = result.history
  } finally {
    releaseEvidenceBusy.value = false
  }
}

async function openReleaseEvidenceReport(markdownPath = releaseEvidenceMarkdownPath.value): Promise<void> {
  if (!markdownPath) return
  await openEvalReport(markdownPath)
}

function formatReleaseGateMode(mode?: string): string {
  if (mode === "quick") return "快速门"
  if (mode === "build") return "构建门"
  if (mode === "full") return "完整门"
  return mode || "未知模式"
}

function formatAcceptanceTaskSet(value?: string): string {
  if (value === "quick") return "快速"
  if (value === "risk") return "风险"
  return "标准"
}

function formatAcceptanceStrategy(value?: string): string {
  if (value === "multi-agent") return "多智能体"
  if (value === "single-agent") return "单智能体"
  return value || "未评估"
}

function formatRunActionAuditStatus(status?: string): string {
  if (status === "started") return "已开始"
  if (status === "success") return "成功"
  if (status === "error") return "失败"
  return status || "未知"
}

function formatEvidenceTime(value?: number): string {
  if (!value) return "-"
  return new Date(value).toLocaleString()
}

function formatUsdCost(value?: number): string {
  return `$${Number(value || 0).toFixed(6)}`
}

function formatDurationMs(value?: number): string {
  const ms = Math.max(0, Number(value || 0))
  const hours = Math.floor(ms / (60 * 60 * 1000))
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const restHours = hours % 24
    return restHours > 0 ? `${days} 天 ${restHours} 小时` : `${days} 天`
  }
  if (hours > 0) return `${hours} 小时`
  const minutes = Math.floor(ms / (60 * 1000))
  return `${minutes} 分钟`
}

function formatEvidenceGapStatus(status?: string): string {
  if (status === "missing") return "缺失"
  if (status === "not_ready") return "未就绪"
  return status || "未知"
}

watch(searchQuery, () => {
  const query = searchQuery.value.trim()
  if (!query) return
  const hasActive = filteredNavGroups.value.some((group) => group.items.some((item) => item.id === activeSection.value))
  if (!hasActive) {
    const firstMatch = filteredNavGroups.value[0]?.items[0]
    if (firstMatch) activeSection.value = firstMatch.id
  }
})

watch(activeSection, (section) => {
  if (section === "advanced" && vsCodeImportSources.value.length === 0) {
    void refreshVsCodeImportSources()
  }
})

watch(() => props.settingsQuery, (query) => {
  activeSettingsQuery.value = String(query || "")
  if (activeSettingsQuery.value) searchQuery.value = activeSettingsQuery.value
}, { immediate: true })

function openSection(section: SectionId, query = ""): void {
  activeSection.value = section
  activeSettingsQuery.value = String(query || "")
  searchQuery.value = activeSettingsQuery.value
}

defineExpose({ openSection })

const autoSaveOptions = [
  { id: "off", label: "关闭" },
  { id: "afterDelay", label: "延迟后" },
  { id: "onFocusChange", label: "失去焦点时" },
]
const autoSaveSelectOptions = autoSaveOptions.map((option) => ({ value: option.id, label: option.label }))
const sandboxLevelOptions: CodekSelectOption[] = [
  { value: "standard", label: "标准" },
  { value: "strict", label: "严格" },
  { value: "paranoid", label: "加固" },
]

const providers = Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label }))
void providers

const jdkOptions = JDK_VERSIONS.map((v) => ({ value: v.value, label: v.label }))
const acceptanceTaskSetOptions = computed<CodekSelectOption[]>(() =>
  acceptanceTaskSets.value.map((option) => ({ value: option.id, label: option.label })),
)

const languageList = computed(() => (Object.values(LANGUAGE_SUPPORTS) as LanguageSupport[]).map((l) => ({
  id: l.id,
  label: l.label,
  extension: l.extension,
  icon: l.icon,
  enabled: enabledLanguages.value.includes(l.id),
})))

const currentTheme = computed(() => activeTheme.value)

const themeSegmentOptions = computed<CodekSegmentedOption[]>(() => [
  { value: "dark", label: t("settings.themeDark") },
  { value: "light", label: t("settings.themeLight") },
])
const cloudProtocolOptions: CodekSegmentedOption[] = [
  { value: "openai", label: "OpenAI 兼容" },
  { value: "anthropic", label: "Anthropic" },
]

function handleThemeChange(themeId: ThemeId) {
  setTheme(themeId)
}

function handleProviderChange(providerId: string) {
  setProvider(providerId)
}

function handleOllamaHostChange(value: string) {
  if (value.trim()) setOllamaHost(value)
}

function handleParamChange(field: string, event: Event) {
  const raw = parseFloat((event.target as HTMLInputElement)?.value)
  if (isNaN(raw)) return
  setModelParams({ [field]: field === "maxTokens" ? Math.round(raw) : raw })
}

function handleJdkVersionChange(value: string) {
  setJdkVersion(value || "17")
}

function handleToggleLanguage(langId: string) {
  toggleLanguage(langId)
}

interface CloudDraft {
  id: string
  name: string
  protocol: "openai" | "anthropic"
  baseUrl: string
  apiKey: string
  model: string
}

const editorOpen = ref(false)
const editorIsNew = ref(false)
const editorTab = ref<"form" | "config" | "auth">("form")
const editorDraft = reactive<CloudDraft>({
  id: "",
  name: "",
  protocol: "openai",
  baseUrl: "",
  apiKey: "",
  model: "",
})

const editorConfigToml = computed({
  get: () => {
    return [
      `name = "${editorDraft.name.replace(/"/g, '\\"')}"`,
      `protocol = "${editorDraft.protocol}"`,
      `base_url = "${editorDraft.baseUrl}"`,
      `model = "${editorDraft.model}"`,
    ].join("\n")
  },
  set: (raw: string) => {
    const lines = raw.split(/\r?\n/)
    for (const line of lines) {
      const m = line.match(/^\s*([a-zA-Z_]+)\s*=\s*"([^"]*)"\s*$/)
      if (!m) continue
      const [, key, val] = m
      if (key === "name") editorDraft.name = val
      else if (key === "protocol" && (val === "openai" || val === "anthropic")) editorDraft.protocol = val
      else if (key === "base_url") editorDraft.baseUrl = val
      else if (key === "model") editorDraft.model = val
    }
  },
})

const editorAuthJson = computed({
  get: () => JSON.stringify({ api_key: editorDraft.apiKey }, null, 2),
  set: (raw: string) => {
    try {
      const node = JSON.parse(raw)
      if (node && typeof node.api_key === "string") editorDraft.apiKey = node.api_key
    } catch {
      // ignore invalid JSON during typing
    }
  },
})

const fetchedModels = ref<string[]>([])
const fetchingModels = ref(false)
const fetchedModelComboOptions = computed<CodekComboBoxOption[]>(() =>
  fetchedModels.value.map((model) => ({ value: model, label: model })),
)

async function fetchModelList() {
  if (!editorDraft.baseUrl.trim() || !editorDraft.apiKey.trim()) {
    pushToast("err", "无法获取", "请先填写接口地址和 API 密钥")
    return
  }
  fetchingModels.value = true
  try {
    const codek = (window as any).codek
    if (!codek || typeof codek.api !== "function") {
      pushToast("err", "桌面 API 不可用")
      return
    }
    const result = await codek.api("POST", "/llm/models", {
      protocol: editorDraft.protocol,
      baseUrl: editorDraft.baseUrl,
      apiKey: editorDraft.apiKey,
    })
    const data = result && (result.data || result)
    if (data && data.success) {
      const list: string[] = Array.isArray(data.models) ? data.models : []
      fetchedModels.value = list
      if (list.length === 0) {
        pushToast("info", "未发现模型", "供应商返回空列表")
      } else {
        pushToast("ok", `获取到 ${list.length} 个模型`)
      }
    } else {
      pushToast("err", "获取失败", (data && data.error) || (result && result.error) || "未知错误")
    }
  } catch (e: any) {
    pushToast("err", "获取异常", e?.message || String(e))
  } finally {
    fetchingModels.value = false
  }
}

interface CcsInfo {
  exists: boolean
  path: string
  claudeCount: number
  codexCount: number
}

const ccsInfo = ref<CcsInfo | null>(null)
const ccsScanning = ref(false)
const ccsImportOpen = ref(false)
const ccsImporting = ref(false)

const anthropicProviders = computed(() =>
  cloudProviders.value.filter((p: any) => p.protocol === "anthropic"),
)
const openaiProviders = computed(() =>
  cloudProviders.value.filter((p: any) => p.protocol !== "anthropic"),
)

async function scanCcs() {
  ccsScanning.value = true
  try {
    const codek = (window as any).codek
    if (!codek || typeof codek.api !== "function") {
      pushToast("err", "桌面 API 不可用")
      return
    }
    const result = await codek.api("GET", "/ccswitch/scan")
    const data = result && (result.data || result)
    if (data && data.success) {
      ccsInfo.value = {
        exists: !!data.exists,
        path: String(data.path || ""),
        claudeCount: Number(data.claudeCount || 0),
        codexCount: Number(data.codexCount || 0),
      }
    } else {
      ccsInfo.value = { exists: false, path: String((data && data.path) || ""), claudeCount: 0, codexCount: 0 }
      pushToast("err", "扫描失败", (data && data.error) || (result && result.error) || "未知错误")
    }
  } catch (e: any) {
    pushToast("err", "扫描异常", e?.message || String(e))
  } finally {
    ccsScanning.value = false
  }
}

async function handleImportCcs(appType: "claude" | "codex") {
  if (ccsImporting.value) return
  ccsImporting.value = true
  try {
    const codek = (window as any).codek
    if (!codek || typeof codek.api !== "function") {
      pushToast("err", "桌面 API 不可用")
      return
    }
    const result = await codek.api("POST", "/ccswitch/import", { appType })
    const data = result && (result.data || result)
    if (data && data.success) {
      const entries: Array<Partial<CloudDraft>> = Array.isArray(data.entries) ? data.entries : []
      let added = 0
      for (const entry of entries) {
        if (!entry || !entry.baseUrl || !entry.apiKey) continue
        addCloudProvider({
          name: entry.name || (appType === "claude" ? "CCS Claude" : "CCS Codex"),
          protocol: entry.protocol === "anthropic" ? "anthropic" : "openai",
          baseUrl: entry.baseUrl,
          apiKey: entry.apiKey,
          model: entry.model || "",
        })
        added += 1
      }
      pushToast("ok", `已导入 ${added} 个供应商`, appType === "claude" ? "Anthropic 分类" : "OpenAI 兼容 分类")
      ccsImportOpen.value = false
    } else {
      pushToast("err", "导入失败", (data && data.error) || (result && result.error) || "未知错误")
    }
  } catch (e: any) {
    pushToast("err", "导入异常", e?.message || String(e))
  } finally {
    ccsImporting.value = false
  }
}

onMounted(() => {
  void hydrateWorkbenchProfiles()
  scanCcs()
})

function openEditor(draft: Partial<CloudDraft>, isNew: boolean) {
  editorDraft.id = draft.id || ""
  editorDraft.name = draft.name || ""
  editorDraft.protocol = draft.protocol === "anthropic" ? "anthropic" : "openai"
  editorDraft.baseUrl = draft.baseUrl || ""
  editorDraft.apiKey = draft.apiKey || ""
  editorDraft.model = draft.model || ""
  editorIsNew.value = isNew
  editorTab.value = "form"
  fetchedModels.value = []
  editorOpen.value = true
}

function closeEditor() {
  editorOpen.value = false
}

function saveEditor() {
  if (!editorDraft.name.trim()) editorDraft.name = "未命名"
  if (editorIsNew.value) {
    addCloudProvider({ ...editorDraft })
  } else if (editorDraft.id) {
    updateCloudProvider(editorDraft.id, { ...editorDraft })
  }
  editorOpen.value = false
  pushToast("info", "已保存", editorDraft.name)
}

function handleAddProvider() {
  openEditor({
    name: "",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
  }, true)
}

function handleEditProvider(cp: CloudDraft) {
  openEditor(cp, false)
}

function handleActivateProvider(id: string) {
  activateCloudProvider(id)
}

function handleDeleteProvider(cp: CloudDraft) {
  if (!confirm(`确定删除供应商 "${cp.name}" 吗?`)) return
  deleteCloudProvider(cp.id)
}

interface Toast {
  id: number
  kind: "ok" | "err" | "info"
  title: string
  body?: string
}
const toasts = ref<Toast[]>([])
let toastSeq = 0
function pushToast(kind: Toast["kind"], title: string, body?: string) {
  const id = ++toastSeq
  toasts.value = [...toasts.value, { id, kind, title, body }]
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, 5000)
}

async function handleTestProvider(cp: CloudDraft) {
  pushToast("info", `测试 ${cp.name || "供应商"}...`, "发送 hi")
  try {
    const codek = (window as any).codek
    if (!codek || typeof codek.api !== "function") {
      pushToast("err", "测试失败", "桌面 API 不可用")
      return
    }
    const result = await codek.api("POST", "/llm/test", {
      protocol: cp.protocol,
      baseUrl: cp.baseUrl,
      apiKey: cp.apiKey,
      model: cp.model,
    })
    const data = result && (result.data || result)
    if (data && data.success) {
      pushToast("ok", `${cp.name || "供应商"} 可用`, (data.reply || "").slice(0, 200))
    } else {
      pushToast("err", `${cp.name || "供应商"} 测试失败`, (data && data.error) || (result && result.error) || "未知错误")
    }
  } catch (e: any) {
    pushToast("err", "测试异常", e?.message || String(e))
  }
}
</script>

<style scoped>
.settings-panel {
  --setting-control-height: 36px;
  --setting-control-radius: 11px;
  --setting-control-bg: var(--bg-elevated, rgba(255,255,255,0.06));
  --setting-control-bg-hover: var(--bg-hover);
  --setting-control-border: var(--border-subtle, rgba(255,255,255,0.08));
  --setting-control-focus: var(--accent);
  height: 100%;
  min-height: 0;
  display: flex;
  background: var(--bg-deepest);
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  color-scheme: dark;
}

.settings-sidebar {
  width: 284px;
  height: 100%;
  min-height: 0;
  flex-shrink: 0;
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  padding: 16px 12px 14px;
  gap: 14px;
  background: var(--bg-darker);
  overflow: hidden;
}

.settings-sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 4px 2px;
}

.settings-sidebar-kicker {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  line-height: 1.2;
  text-transform: uppercase;
}

.settings-sidebar-title {
  color: var(--text-bright);
  font-size: 20px;
  font-weight: 650;
  line-height: 1.2;
}

.settings-sidebar-pill {
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--bg-dark);
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 600;
}

.settings-account {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-dark);
}

.settings-account-avatar {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  flex-shrink: 0;
}

.settings-account-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.settings-account-name {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-account-plan {
  font-size: 11px;
  color: var(--text-muted);
}

.settings-search-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0 9px;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.settings-search-wrap:focus-within {
  border-color: var(--accent);
  background: var(--bg-dark);
  box-shadow: 0 0 0 2px var(--accent-dim);
}

.settings-search-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.settings-search-input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  font-family: inherit;
  min-width: 0;
}

.settings-search-input::placeholder {
  color: var(--text-muted);
}

.settings-nav {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--text-muted) 42%, transparent) transparent;
}

.settings-nav-group-label {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  margin: 12px 8px 5px;
  text-transform: uppercase;
}

.settings-nav-sep {
  height: 1px;
  background: var(--border-subtle);
  margin: 6px 4px;
}

.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  background: none;
  text-align: left;
  color: var(--text-secondary);
  min-height: 32px;
  padding: 7px 9px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s, color 0.12s;
  width: 100%;
}

.settings-nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.settings-nav-item.active {
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-active));
  color: var(--text-bright);
}

.settings-nav-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.settings-nav-item span:not(.settings-nav-badge) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-nav-item.active .settings-nav-icon {
  color: var(--accent);
}

.settings-nav-badge {
  min-width: 18px;
  height: 18px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
}

.settings-nav-empty {
  margin: 10px 8px;
  padding: 12px 10px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.settings-main {
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: clamp(22px, 3vw, 34px) clamp(24px, 4vw, 56px) 44px;
  min-width: 0;
  background: var(--bg-deepest);
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--text-muted) 42%, transparent) transparent;
}

.settings-main-inner {
  width: 100%;
  max-width: 1480px;
  margin: 0 auto;
}

.settings-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
  padding-right: 44px;
}

.settings-page-copy {
  min-width: 0;
}

.settings-page-kicker {
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.settings-page-title {
  color: var(--text-bright);
  font-size: 26px;
  font-weight: 650;
  line-height: 1.15;
  margin: 5px 0 6px;
}

.settings-page-desc {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
}

.settings-page-state {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  color: var(--text-secondary);
  background: var(--bg-dark);
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
}

.settings-page-state-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-dim);
}

.settings-nav::-webkit-scrollbar,
.settings-main::-webkit-scrollbar,
.cloud-modal-body::-webkit-scrollbar,
.cloud-toast-body::-webkit-scrollbar {
  width: 9px;
  height: 9px;
}

.settings-nav::-webkit-scrollbar-track,
.settings-main::-webkit-scrollbar-track,
.cloud-modal-body::-webkit-scrollbar-track,
.cloud-toast-body::-webkit-scrollbar-track {
  background: transparent;
}

.settings-nav::-webkit-scrollbar-thumb,
.settings-main::-webkit-scrollbar-thumb,
.cloud-modal-body::-webkit-scrollbar-thumb,
.cloud-toast-body::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--text-muted) 34%, transparent);
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}

.settings-nav::-webkit-scrollbar-thumb:hover,
.settings-main::-webkit-scrollbar-thumb:hover,
.cloud-modal-body::-webkit-scrollbar-thumb:hover,
.cloud-toast-body::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--text-muted) 52%, transparent);
  border: 2px solid transparent;
  background-clip: padding-box;
}

@media (max-width: 900px) {
  .settings-sidebar {
    width: 232px;
  }
  .settings-main {
    padding: 26px 28px 36px;
  }
  .settings-page-header {
    padding-right: 44px;
  }
}

@media (max-width: 760px) {
  .settings-panel {
    min-width: 680px;
  }
  .settings-sidebar {
    width: 218px;
    padding: 14px 10px;
  }
  .settings-main {
    padding: 20px 18px 28px;
  }
  .settings-page-header {
    flex-direction: column;
    gap: 10px;
    padding-right: 44px;
  }
  .settings-page-title {
    font-size: 24px;
  }
  .settings-row {
    align-items: stretch;
  }
  .settings-row-control,
  .settings-select,
  .codek-segmented {
    width: 100%;
  }
  .cloud-fetch-btn,
  .settings-btn {
    justify-content: center;
  }
}

.settings-section-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: none;
  margin: 0;
}

.settings-h2 {
  display: none;
}

.settings-section-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin: -2px 0 8px;
  line-height: 1.5;
}

.settings-matrix {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}

.settings-matrix-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-dark);
  color: var(--text-secondary);
  font-size: 12px;
}

.settings-matrix-item .codek-input-shell,
.settings-matrix-item .codek-textarea-shell,
.settings-matrix-item .codek-combo {
  width: 100%;
}

.settings-matrix-item.ready {
  border-color: rgba(45, 212, 191, 0.22);
}

.settings-matrix-item.planned {
  border-style: dashed;
}

.settings-matrix-label {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.settings-callout {
  border: 1px solid rgba(96, 165, 250, 0.25);
  border-radius: 6px;
  background: rgba(96, 165, 250, 0.08);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.55;
  padding: 11px 12px;
}

.settings-entry-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.settings-entry-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-height: 86px;
  padding: 13px 15px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-dark);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  font-family: inherit;
}

.settings-entry-card:hover {
  border-color: var(--border-bright);
  background: color-mix(in srgb, var(--bg-dark) 84%, var(--bg-hover));
}

.settings-entry-title {
  color: var(--text-bright);
  font-size: 13px;
  font-weight: 650;
}

.settings-entry-desc {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 15px;
  background: var(--bg-dark);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  flex-wrap: wrap;
  transition: border-color 0.12s, background 0.12s;
}

.settings-row:hover {
  border-color: var(--border-bright);
  background: color-mix(in srgb, var(--bg-dark) 86%, var(--bg-hover));
}

.settings-row-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

.settings-row-stack .settings-row-info {
  flex: 0 0 auto;
}

.release-card {
  padding: 14px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-dark);
}

.release-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.release-gate-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.release-gate-head > div {
  min-width: 0;
}

.release-gate-head > span {
  flex-shrink: 0;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 11px;
}

.release-gate-head > span.ready {
  border-color: rgba(45, 212, 191, 0.35);
  color: var(--accent);
}

.release-gate-head > span.danger {
  border-color: rgba(248, 113, 113, 0.45);
  color: #f87171;
}

.release-step-list,
.release-scenario-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.release-step-row,
.release-scenario-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 48px;
  gap: 5px 8px;
  align-items: center;
  padding: 7px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 11px;
}

.release-step-row.failed,
.release-scenario-row.failed {
  border-color: rgba(248, 113, 113, 0.5);
}

.release-scenario-row.warning {
  border-color: rgba(250, 204, 21, 0.4);
}

.release-step-row span,
.release-step-row small,
.release-scenario-row span,
.release-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.release-step-row strong,
.release-scenario-row strong {
  color: var(--text-secondary);
  font-weight: 600;
}

.release-step-row.failed strong,
.release-scenario-row.failed strong {
  color: #f87171;
}

.release-step-row small,
.release-scenario-row small {
  grid-column: 1 / -1;
  color: var(--text-muted);
}

.release-path {
  color: var(--text-muted);
  font-size: 11px;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
}

.release-evidence-latest {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
}

.release-evidence-latest > div {
  min-width: min(180px, 100%);
  flex: 1 1 180px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.release-evidence-latest span {
  color: var(--text-muted);
  font-size: 11px;
}

.release-evidence-latest strong,
.release-link-btn {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.release-link-btn,
.release-inline-open {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.release-link-btn:disabled,
.release-inline-open:disabled {
  color: var(--text-muted);
  cursor: default;
}

.release-trial-note {
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.release-ci-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 7px 12px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 12px;
}

.release-ci-grid strong {
  color: var(--text-secondary);
  font-weight: 600;
  text-align: right;
  min-width: 0;
  overflow-wrap: anywhere;
}

.settings-row-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.settings-inline-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.settings-inline-check input {
  accent-color: var(--accent);
}

.settings-row-sub {
  font-size: 11px;
  color: var(--text-muted, #8a8d92);
  margin-left: 6px;
}

.settings-progress {
  width: 100%;
  height: 4px;
  background: var(--bg-hover);
  border-radius: 2px;
  overflow: hidden;
}

.settings-progress-bar {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s;
}

.settings-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast, var(--bg-deepest));
}

.settings-btn.alt {
  background: transparent;
  color: #f87171;
  border-color: #f87171;
}

.settings-row-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1 1 220px;
}

.settings-row-info-full {
  width: 100%;
}

.settings-error-text {
  color: var(--danger, #d9534f);
}

.settings-success-text {
  color: var(--accent);
}

.settings-muted-text {
  color: var(--text-muted);
}

.settings-row-title {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 600;
}

.settings-row-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.settings-row-control {
  flex-shrink: 0;
  flex-basis: auto;
}

.settings-query-evidence {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: -8px 0 20px;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 12px;
}

.settings-query-label {
  color: var(--text-muted);
  font-weight: 650;
}

.settings-query-evidence code {
  color: var(--text-bright);
  font-family: var(--font-mono, "JetBrains Mono", monospace);
}

.settings-query-desc {
  min-width: 0;
}

.settings-select {
  min-width: 160px;
  max-width: 100%;
  height: var(--setting-control-height);
  background-color: var(--setting-control-bg);
  border: 1px solid var(--setting-control-border);
  border-radius: var(--setting-control-radius);
  color: var(--text-primary);
  padding: 0 10px;
  font-size: 13px;
  outline: none;
  font-family: inherit;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238b96a0' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 30px;
  cursor: pointer;
  transition: border-color 0.12s ease, background-color 0.12s ease, box-shadow 0.12s ease;
}

.settings-select:hover {
  background-color: var(--setting-control-bg-hover);
  border-color: var(--border-bright, var(--border));
}

.settings-select option {
  background: var(--bg-dark);
  color: var(--text-primary);
}

.settings-select:focus {
  border-color: var(--setting-control-focus);
  box-shadow: 0 0 0 2px var(--accent-dim);
}

.settings-input {
  width: 100%;
  min-height: var(--setting-control-height);
  box-sizing: border-box;
  background: var(--setting-control-bg);
  border: 1px solid var(--setting-control-border);
  border-radius: var(--setting-control-radius);
  color: var(--text-primary);
  padding: 0 12px;
  font-size: 13px;
  outline: none;
  font-family: inherit;
  transition: border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
}

.settings-input:hover {
  background: var(--setting-control-bg-hover);
  border-color: var(--border-bright, var(--border));
}

.settings-input:focus {
  border-color: var(--setting-control-focus);
  box-shadow: 0 0 0 2px var(--accent-dim);
}

.settings-textarea {
  width: 100%;
  min-height: 88px;
  background: var(--setting-control-bg);
  border: 1px solid var(--setting-control-border);
  border-radius: var(--setting-control-radius);
  color: var(--text-primary);
  padding: 8px 10px;
  font-size: 12px;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  resize: vertical;
  outline: none;
  transition: border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
}

.settings-textarea:hover {
  background: var(--setting-control-bg-hover);
  border-color: var(--border-bright, var(--border));
}

.settings-textarea.compact {
  min-height: 72px;
}

.settings-textarea:focus {
  border-color: var(--setting-control-focus);
  box-shadow: 0 0 0 2px var(--accent-dim);
}

.settings-range {
  width: 100%;
  accent-color: var(--accent);
  cursor: pointer;
}

.settings-pill {
  font-size: 10px;
  color: var(--accent);
  background: rgba(45, 212, 191, 0.12);
  border: 1px solid rgba(45, 212, 191, 0.18);
  border-radius: 999px;
  padding: 2px 8px;
}

.settings-pill.alt {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.settings-inline-pill {
  margin-left: 6px;
}

.settings-table-wrap {
  margin-top: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--text-muted) 42%, transparent) transparent;
}

.settings-table-wrap::-webkit-scrollbar {
  width: 9px;
  height: 9px;
}

.settings-table-wrap::-webkit-scrollbar-track {
  background: transparent;
}

.settings-table-wrap::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--text-muted) 34%, transparent);
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}

.settings-table-empty {
  padding: 16px;
  color: var(--text-muted);
}

.settings-table {
  width: 100%;
  min-width: 620px;
  border-collapse: collapse;
}

.settings-table th,
.settings-table td {
  text-align: left;
  padding: 8px;
}

.settings-table th {
  background: var(--bg-secondary, rgba(0, 0, 0, 0.05));
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
}

.settings-table tr + tr {
  border-top: 1px solid var(--border);
}

.settings-table-action {
  margin-right: 6px;
}

.settings-btn {
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-primary);
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

.settings-btn:hover {
  border-color: var(--border-bright);
  background: var(--bg-hover);
}

.settings-stack-inline {
  display: flex;
  gap: 8px;
  align-items: center;
}

.settings-stack-inline .settings-select {
  flex: 1;
}

.model-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-dark);
  overflow: hidden;
}

.model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 15px;
}

.model-row + .model-row {
  border-top: 1px solid var(--border-subtle);
}

.model-row-label {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.model-row-name {
  font-size: 13px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-row-id {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono, "JetBrains Mono", monospace);
}

.model-row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 1 auto;
  min-width: 0;
  max-width: min(100%, 62vw);
}

.model-row-select {
  width: clamp(160px, var(--model-select-ch, 24ch), 560px);
  max-width: min(100%, 56vw);
  flex: 0 1 clamp(160px, var(--model-select-ch, 24ch), 560px);
}

.model-row-select :deep(.codek-combo-menu) {
  width: max(100%, min(520px, 72vw));
  right: auto;
}

.model-row-refresh {
  padding: 4px 8px;
  font-size: 12px;
  line-height: 1;
}

.settings-collapse {
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-dark);
  overflow: hidden;
}

.settings-collapse > .settings-row,
.settings-collapse > .settings-row-stack {
  border-radius: 0;
  border-left: none;
  border-right: none;
  border-bottom: none;
  border-top: 1px solid var(--border-subtle);
  background: transparent;
}

.settings-collapse-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 13px 15px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
  list-style: none;
  user-select: none;
}

.settings-collapse-summary::-webkit-details-marker {
  display: none;
}

.settings-collapse-arrow {
  color: var(--text-muted);
  transition: transform 0.15s;
  transform: rotate(-90deg);
}

.settings-collapse[open] .settings-collapse-arrow {
  transform: rotate(0deg);
}

.toggle-switch {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-deepest);
  cursor: pointer;
  position: relative;
  transition: background 0.2s, border-color 0.2s;
  padding: 0;
  flex-shrink: 0;
}

.toggle-switch.settings-switch-wide {
  width: auto;
  min-width: 96px;
  height: 30px;
  padding: 0 10px 0 4px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.toggle-switch.active {
  background: var(--accent);
  border-color: var(--accent);
}

.toggle-knob {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--text-primary);
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform 0.2s;
}

.toggle-switch.active .toggle-knob {
  transform: translateX(16px);
  background: var(--bg-dark);
}

.settings-switch-wide .toggle-knob {
  position: relative;
  top: auto;
  left: auto;
  flex: 0 0 auto;
}

.settings-switch-wide.active .toggle-knob {
  transform: none;
}

.settings-switch-label {
  color: inherit;
  font-size: 12px;
  white-space: nowrap;
}

.lang-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.lang-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  background: var(--bg-deepest);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.lang-chip:hover {
  border-color: var(--border-bright);
}

.lang-chip.active {
  border-color: var(--accent);
  background: rgba(45, 212, 191, 0.1);
}

.lang-checkbox {
  display: none;
}

.lang-label {
  color: var(--text-primary);
}

.lang-ext {
  color: var(--text-muted);
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 10px;
}

.cloud-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  padding: 2px 2px 0;
}

.cloud-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-bright);
}

.cloud-section-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
}

.cloud-add-btn {
  flex-shrink: 0;
}

.cloud-empty {
  padding: 16px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
  background: var(--bg-dark);
}

.cloud-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 8px;
}

.cloud-card {
  border: 1px solid var(--border-subtle);
  background: var(--bg-dark);
  border-radius: 6px;
  padding: 12px 14px 14px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 92px;
}

.cloud-card:hover {
  border-color: var(--border-bright);
  background: var(--bg-hover);
}

.cloud-card.active {
  border-color: var(--accent);
  background: rgba(45, 212, 191, 0.06);
}

.cloud-card-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.cloud-card-head-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.cloud-card-name {
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-bright);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cloud-active-pill {
  flex: 0 0 auto;
  color: var(--accent);
  background: rgba(45, 212, 191, 0.15);
}

.cloud-card-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 11px;
  color: var(--text-muted);
}

.cloud-card-proto {
  padding: 2px 6px;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  color: var(--text-secondary);
}

.cloud-card-model {
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  color: var(--text-secondary);
}

.cloud-card-url {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cloud-card-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
  background: var(--bg-dark);
  border-radius: 6px;
  padding: 2px;
  align-self: center;
  flex: 0 0 auto;
}

.cloud-card:hover .cloud-card-actions,
.cloud-card.active .cloud-card-actions {
  opacity: 1;
}

.cloud-icon-btn {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-secondary);
  border-radius: 4px;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}

.cloud-icon-btn:hover {
  background: var(--bg-deepest);
  border-color: var(--border);
  color: var(--text-bright);
}

.cloud-icon-danger:hover {
  color: #f87171;
  border-color: #f87171;
}

.cloud-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.cloud-modal {
  width: min(560px, 100%);
  max-height: 90vh;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.45);
}

.cloud-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-subtle);
}

.cloud-modal-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-bright);
}

.cloud-modal-close {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
  padding: 2px 8px;
}

.cloud-modal-close:hover {
  color: var(--text-bright);
}

.cloud-modal-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 14px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.cloud-modal-tab {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 8px 12px;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  font-family: inherit;
  border-bottom: 2px solid transparent;
}

.cloud-modal-tab:hover {
  color: var(--text-primary);
}

.cloud-modal-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.cloud-modal-body {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  min-height: 320px;
}

.cloud-modal-hint {
  font-size: 11px;
  color: var(--text-muted);
}

.cloud-modal-textarea {
  width: 100%;
  min-height: 280px;
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  padding: 10px 12px;
  font-size: 12px;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  resize: vertical;
  outline: none;
}

.cloud-modal-textarea:focus {
  border-color: var(--accent);
}

.cloud-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.cloud-model-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.cloud-model-combo {
  flex: 1;
  min-width: 0;
}

.cloud-fetch-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.cloud-fetch-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.cloud-modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border-subtle);
}

.cloud-modal-primary {
  background: var(--accent);
  color: var(--accent-contrast, var(--bg-deepest));
  border-color: var(--accent);
}

.cloud-modal-primary:hover {
  background: var(--accent);
  filter: brightness(1.08);
}

.cloud-toast-stack {
  position: fixed;
  bottom: 24px;
  left: 24px;
  z-index: 1100;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  max-width: 320px;
  pointer-events: none;
}
.cloud-toast { pointer-events: auto; }

.cloud-toast {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 6px;
  padding: 10px 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  font-size: 12px;
  color: var(--text-primary);
  animation: cloudToastIn 0.18s ease-out;
}

.cloud-toast.ok {
  border-left-color: var(--accent);
}

.cloud-toast.err {
  border-left-color: #f87171;
}

.cloud-toast.info {
  border-left-color: #60a5fa;
}

.cloud-toast-title {
  font-weight: 600;
  color: var(--text-bright);
  margin-bottom: 2px;
}

.cloud-toast-body {
  color: var(--text-secondary);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow: auto;
}

@keyframes cloudToastIn {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}

.ccs-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 15px;
  margin-bottom: 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-dark);
}
.ccs-card-main { flex: 1; min-width: 0; }
.ccs-card-title {
  font-weight: 600;
  margin-bottom: 4px;
}
.ccs-card-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  word-break: break-all;
}
.ccs-card-path {
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  opacity: 0.75;
  margin-left: 4px;
}
.ccs-card-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.vscode-import-card {
  gap: 12px;
}

.vscode-import-toolbar {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(120px, 150px) auto auto;
  gap: 8px;
  align-items: center;
}

.vscode-import-select,
.vscode-import-mode,
.vscode-import-profile-select {
  min-width: 0;
}

.vscode-import-summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(84px, 1fr));
  gap: 8px;
}

.vscode-import-count {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-panel);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.vscode-import-count strong {
  color: var(--text-bright);
  font-size: 18px;
  line-height: 1;
}

.vscode-import-count span {
  color: var(--text-muted);
  font-size: 11px;
}

.vscode-import-profile-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(180px, 260px);
  gap: 12px;
  align-items: center;
}

.vscode-profile-toolbar {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.vscode-profile-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vscode-profile-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-panel);
}

.vscode-profile-row.active {
  border-color: rgba(45, 212, 191, 0.45);
  background: rgba(45, 212, 191, 0.08);
}

.vscode-profile-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.vscode-profile-main strong {
  color: var(--text-bright);
  font-size: 13px;
}

.vscode-profile-main small {
  color: var(--text-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vscode-profile-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.vscode-import-extension-list {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
}

.ccs-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.ccs-btn-primary {
  background: var(--accent);
  color: var(--accent-contrast, #fff);
  border-color: var(--accent);
}
.ccs-btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cloud-cat-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 2px 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.cloud-cat-title { color: var(--text); }
.cloud-cat-count {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(127, 127, 127, 0.15);
  color: var(--text-muted);
}
.cloud-empty-mini {
  padding: 12px 16px;
  font-size: 12px;
  opacity: 0.7;
}

.ccs-import-modal { max-width: 560px; }
.ccs-import-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 8px;
}
.ccs-import-tile {
  text-align: left;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated, transparent);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.1s;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text);
}
.ccs-import-tile:hover:not(:disabled) {
  border-color: var(--accent);
  transform: translateY(-1px);
}
.ccs-import-tile:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ccs-import-tile-title { font-weight: 600; font-size: 14px; }
.ccs-import-tile-desc { font-size: 12px; color: var(--text-muted); line-height: 1.4; }
.ccs-import-tile-count {
  margin-top: 4px;
  font-size: 11px;
  color: var(--accent);
  font-weight: 600;
}

@media (max-width: 700px) {
  .cloud-section-header,
  .ccs-card {
    align-items: stretch;
    flex-direction: column;
  }

  .vscode-import-toolbar,
  .vscode-import-summary,
  .vscode-import-profile-row,
  .vscode-profile-toolbar,
  .vscode-profile-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .ccs-card-actions,
  .cloud-model-row,
  .cloud-modal-foot {
    flex-direction: column;
  }

  .cloud-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .cloud-card-head {
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }

  .cloud-card-actions {
    opacity: 1;
    margin-top: 4px;
    align-self: flex-start;
  }

  .ccs-import-grid {
    grid-template-columns: 1fr;
  }
}
</style>
