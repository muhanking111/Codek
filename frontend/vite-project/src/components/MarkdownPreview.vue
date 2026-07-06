<template>
  <div class="markdown-preview">
    <div class="preview-toolbar">
      <span class="preview-title">{{ t('markdownPreview.title') }}</span>
      <div class="toolbar-spacer" />
      <button class="toolbar-btn" :title="t('markdownPreview.close')" @click="emit('close')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
    <div ref="previewBody" class="preview-body" v-html="renderedHtml" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '../i18n/index'

const props = defineProps<{
  content: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()
const previewBody = ref<HTMLElement | null>(null)

const renderedHtml = computed<string>(() => renderMarkdown(props.content))

watch(() => props.content, () => {
  if (previewBody.value) {
    previewBody.value.scrollTop = previewBody.value.scrollHeight
  }
})

interface TokenRule {
  pattern: RegExp
  replace: (match: string, ...groups: string[]) => string
}

const INLINE_RULES: TokenRule[] = [
  {
    pattern: /```(\w*)\n([\s\S]*?)```/g,
    replace: (_match, lang, code) =>
      `<pre class="md-code-block"><code class="lang-${escapeHtml(lang)}">${escapeHtml(code)}</code></pre>`,
  },
  {
    pattern: /`([^`\n]+)`/g,
    replace: (_match, code) => `<code class="md-inline-code">${escapeHtml(code)}</code>`,
  },
  {
    pattern: /\*\*\*(.+?)\*\*\*/g,
    replace: (_match, text) => `<strong><em>${text}</em></strong>`,
  },
  {
    pattern: /\*\*(.+?)\*\*/g,
    replace: (_match, text) => `<strong>${text}</strong>`,
  },
  {
    pattern: /\*(.+?)\*/g,
    replace: (_match, text) => `<em>${text}</em>`,
  },
  {
    pattern: /~~(.+?)~~/g,
    replace: (_match, text) => `<del>${text}</del>`,
  },
  {
    pattern: /\[([^\]]+)\]\(([^)]+)\)/g,
    replace: (_match, text, href) =>
      `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${text}</a>`,
  },
  {
    pattern: /!\[([^\]]*)\]\(([^)]+)\)/g,
    replace: (_match, alt, src) =>
      `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" class="md-image" />`,
  },
]

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderInline(text: string): string {
  let result = text
  for (const rule of INLINE_RULES) {
    result = result.replace(rule.pattern, rule.replace)
  }
  return result
}

function renderMarkdown(source: string): string {
  const lines = source.split('\n')
  const htmlParts: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (line.startsWith('```')) {
      const langMatch = line.match(/^```(\w*)/)
      const lang = langMatch ? langMatch[1] : ''
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index].startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }
      index += 1
      htmlParts.push(
        `<pre class="md-code-block"><code class="lang-${escapeHtml(lang)}">${escapeHtml(codeLines.join('\n'))}</code></pre>`,
      )
      continue
    }

    if (line.startsWith('# ')) {
      htmlParts.push(`<h1 class="md-h1">${renderInline(line.slice(2))}</h1>`)
      index += 1
      continue
    }

    if (line.startsWith('## ')) {
      htmlParts.push(`<h2 class="md-h2">${renderInline(line.slice(3))}</h2>`)
      index += 1
      continue
    }

    if (line.startsWith('### ')) {
      htmlParts.push(`<h3 class="md-h3">${renderInline(line.slice(4))}</h3>`)
      index += 1
      continue
    }

    if (line.startsWith('#### ')) {
      htmlParts.push(`<h4 class="md-h4">${renderInline(line.slice(5))}</h4>`)
      index += 1
      continue
    }

    if (line.startsWith('> ')) {
      const quoteLines: string[] = []
      while (index < lines.length && lines[index].startsWith('> ')) {
        quoteLines.push(lines[index].slice(2))
        index += 1
      }
      htmlParts.push(`<blockquote class="md-blockquote">${renderInline(quoteLines.join('<br>'))}</blockquote>`)
      continue
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      const listItems: string[] = []
      while (index < lines.length && (lines[index].startsWith('- ') || lines[index].startsWith('* '))) {
        listItems.push(lines[index].slice(2))
        index += 1
      }
      htmlParts.push(
        `<ul class="md-ul">${listItems.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`,
      )
      continue
    }

    if (/^\d+\.\s/.test(line)) {
      const listItems: string[] = []
      while (index < lines.length && /^\d+\.\s/.test(lines[index])) {
        listItems.push(lines[index].replace(/^\d+\.\s/, ''))
        index += 1
      }
      htmlParts.push(
        `<ol class="md-ol">${listItems.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ol>`,
      )
      continue
    }

    if (line.startsWith('---') || line.startsWith('***') || line.startsWith('___')) {
      htmlParts.push('<hr class="md-hr" />')
      index += 1
      continue
    }

    if (line.trim() === '') {
      index += 1
      continue
    }

    if (line.includes('|')) {
      const tableRows: string[][] = []
      while (index < lines.length && lines[index].includes('|')) {
        const row = lines[index]
          .split('|')
          .map((cell) => cell.trim())
          .filter((cell) => cell !== '')
        if (row.length > 0 && !row.every((cell) => /^[-:]+$/.test(cell))) {
          tableRows.push(row)
        }
        index += 1
      }

      if (tableRows.length > 0) {
        const header = tableRows[0]
        const body = tableRows.slice(1)
        htmlParts.push(
          `<table class="md-table"><thead><tr>${header.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
        )
      }
      continue
    }

    htmlParts.push(`<p class="md-p">${renderInline(line)}</p>`)
    index += 1
  }

  return htmlParts.join('\n')
}
</script>

<style scoped>
.markdown-preview {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-left: 1px solid var(--border-subtle);
}

.preview-toolbar {
  display: flex;
  align-items: center;
  padding: 0 12px;
  height: 32px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.preview-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.toolbar-spacer {
  flex: 1;
}

.toolbar-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
}

.toolbar-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.preview-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.7;
}

.preview-body :deep(.md-h1) {
  font-size: 26px;
  font-weight: 700;
  color: var(--text-bright);
  margin: 24px 0 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-subtle);
}

.preview-body :deep(.md-h2) {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-bright);
  margin: 20px 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-subtle);
}

.preview-body :deep(.md-h3) {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-bright);
  margin: 16px 0 8px;
}

.preview-body :deep(.md-h4) {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-bright);
  margin: 14px 0 6px;
}

.preview-body :deep(.md-p) {
  margin: 8px 0;
}

.preview-body :deep(.md-blockquote) {
  border-left: 3px solid var(--accent);
  padding: 8px 16px;
  margin: 12px 0;
  background: var(--accent-dim);
  border-radius: 0 6px 6px 0;
  color: var(--text-secondary);
}

.preview-body :deep(.md-ul),
.preview-body :deep(.md-ol) {
  padding-left: 24px;
  margin: 8px 0;
}

.preview-body :deep(.md-ul) {
  list-style-type: disc;
}

.preview-body :deep(.md-ol) {
  list-style-type: decimal;
}

.preview-body :deep(li) {
  margin: 4px 0;
}

.preview-body :deep(.md-code-block) {
  background: var(--bg-darker);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 14px 16px;
  margin: 12px 0;
  overflow-x: auto;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 13px;
  line-height: 1.6;
}

.preview-body :deep(.md-inline-code) {
  background: var(--bg-elevated);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 0.9em;
  color: var(--accent);
}

.preview-body :deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
}

.preview-body :deep(.md-table th) {
  background: var(--bg-elevated);
  font-weight: 600;
  text-align: left;
  padding: 8px 12px;
  border: 1px solid var(--border);
}

.preview-body :deep(.md-table td) {
  padding: 6px 12px;
  border: 1px solid var(--border);
}

.preview-body :deep(.md-hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 20px 0;
}

.preview-body :deep(a) {
  color: var(--accent);
  text-decoration: none;
}

.preview-body :deep(a:hover) {
  text-decoration: underline;
}

.preview-body :deep(.md-image) {
  max-width: 100%;
  border-radius: 6px;
  margin: 8px 0;
}

.preview-body :deep(strong) {
  font-weight: 600;
  color: var(--text-bright);
}

.preview-body :deep(em) {
  font-style: italic;
}

.preview-body :deep(del) {
  text-decoration: line-through;
  opacity: 0.6;
}
</style>
