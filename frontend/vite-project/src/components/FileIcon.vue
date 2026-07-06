<template>
  <span
    v-if="!isDir"
    class="file-icon-svg"
    :class="`icon-theme-${iconTheme}`"
    :style="{ color: iconColor }"
    :data-file-icon-theme-id="currentFileIconTheme.settingsId"
    data-file-icon-theme-service="workbenchThemeService"
    :data-file-icon-source="themeSource || 'fallback'"
  >
    <img v-if="themeIconSrc" class="theme-image-icon" :src="themeIconSrc" alt="" draggable="false" />
    <span
      v-else-if="themeGlyph"
      class="theme-font-icon"
      :style="{ fontFamily: themeFontFamily, fontWeight: themeFontWeight, fontStyle: themeFontStyle, fontSize: themeFontSize }"
    >{{ themeGlyph }}</span>
    <span
      v-else-if="fallbackGlyph"
      class="theme-font-icon fallback-seti-glyph"
      :style="{ fontFamily: fallbackFontFamily, fontSize: fallbackFontSize }"
    >{{ fallbackGlyph }}</span>
  </span>
</template>

<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { ensureFileIconTheme, fileIconThemeFontLoadVersion, getFileIconThemeFontSize, getVisibleFileIconThemeSource, installFileIconThemeFonts, resolveFileIconThemeIcon } from '../extensions/iconThemes'
import { resolveFallbackFileIcon } from '../workbench/fileIconResolver'
import { workbenchThemeService } from '../vscode-adapter/platform/theme/common/themeService'

const props = defineProps({
  name: { type: String, default: '' },
  isDir: { type: Boolean, default: false },
  isOpen: { type: Boolean, default: false },
  ignored: { type: Boolean, default: false },
})

const currentFileIconTheme = ref(workbenchThemeService.getFileIconTheme())
const loadedFileIconTheme = ref(null)
const fileIconThemeChange = workbenchThemeService.onDidFileIconThemeChange((theme) => {
  currentFileIconTheme.value = theme
})

const EMPTY_ICON = {
  type: '',
  color: '',
  className: '',
  glyph: '',
  label: '',
  fontFamily: '',
  fontSize: '',
}

watch(
  () => [currentFileIconTheme.value.settingsId, props.isDir],
  ([themeId, isDir]) => {
    if (isDir) return
    void loadFileIconTheme(themeId)
  },
  { immediate: true },
)

onUnmounted(() => fileIconThemeChange.dispose())

const fallbackIcon = computed(() => props.isDir ? EMPTY_ICON : resolveFallbackFileIcon(props.name, false, props.isOpen))
const themeSource = computed(() => {
  void fileIconThemeFontLoadVersion.value
  return getVisibleFileIconThemeSource(loadedFileIconTheme.value, visibleThemeIcon.value)
})
const fallbackGlyph = computed(() => themeSource.value ? '' : fallbackIcon.value.glyph || '')
const fallbackFontFamily = computed(() => fallbackIcon.value.fontFamily || 'seti, codicon, ui-monospace, monospace')
const fallbackFontSize = computed(() => fallbackIcon.value.fontSize || '150%')

const themeIcon = computed(() => props.isDir ? null : resolveFileIconThemeIcon(
  loadedFileIconTheme.value,
  props.name,
  false,
  props.isOpen,
))

const visibleThemeIcon = computed(() => {
  if (props.isDir) return null
  const icon = themeIcon.value
  if (!icon) return null
  if (icon === loadedFileIconTheme.value?.icons?.file) return null
  return icon
})

const iconTheme = computed(() => sanitizeThemeName(currentFileIconTheme.value.settingsId))

const iconColor = computed(() => {
  if (currentFileIconTheme.value.settingsId === 'minimal') return '#8A8F98'
  if (currentFileIconTheme.value.settingsId === 'monochrome') return 'currentColor'
  if (props.ignored) return '#5f6673'
  if (visibleThemeIcon.value?.fontColor) return visibleThemeIcon.value.fontColor
  return fallbackIcon.value.color
})

const themeIconSrc = computed(() => {
  if (themeSource.value !== 'image') return ''
  const src = visibleThemeIcon.value?.iconPath || ''
  if (!src) return ''
  if (src.startsWith('codek-extension-resource://')) return src
  if (src.startsWith('data:image/')) return src
  if (/^https?:\/\//i.test(src)) return src
  return ''
})

const themeGlyph = computed(() => {
  if (themeSource.value !== 'glyph') return ''
  if (themeIconSrc.value) return ''
  const value = visibleThemeIcon.value?.fontCharacter || ''
  if (!value) return ''
  if (value.startsWith('\\')) {
    const hex = value.replace(/^\\[uU]?/, '')
    const codePoint = Number.parseInt(hex, 16)
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ''
  }
  return value
})

const themeFont = computed(() => {
  const fontId = visibleThemeIcon.value?.fontId || visibleThemeIcon.value?.fontFamily || ''
  return loadedFileIconTheme.value?.icons?.fonts?.find((font) => font.id === fontId) || null
})

const themeFontFamily = computed(() => {
  const family = visibleThemeIcon.value?.fontFamily || visibleThemeIcon.value?.fontId || ''
  return family ? `${family}, codicon, ui-monospace, monospace` : 'codicon, ui-monospace, monospace'
})
const themeFontWeight = computed(() => themeFont.value?.weight || 'normal')
const themeFontStyle = computed(() => themeFont.value?.style || 'normal')
const themeFontSize = computed(() => getFileIconThemeFontSize(loadedFileIconTheme.value, visibleThemeIcon.value) || '16px')

async function loadFileIconTheme(themeId) {
  const theme = await ensureFileIconTheme(themeId)
  if (themeId !== currentFileIconTheme.value.settingsId) return
  loadedFileIconTheme.value = theme
  installFileIconThemeFonts(theme)
}

function sanitizeThemeName(value) {
  return String(value || 'codek-default').replace(/[^a-z0-9_-]/gi, '-').toLowerCase()
}

</script>

<style scoped>
@font-face {
  font-family: "seti";
  src: url("../../../../extensions/theme-seti/icons/seti.woff") format("woff");
  font-weight: normal;
  font-style: normal;
  font-display: block;
}

.file-icon-svg {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  line-height: 16px;
  opacity: 0.96;
  vertical-align: text-bottom;
}

.theme-image-icon {
  width: 16px;
  height: 16px;
  object-fit: contain;
  display: block;
}

.theme-font-icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 16px;
  speak: never;
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}

</style>
