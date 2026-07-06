const fs = require("fs")
const path = require("path")
const { getExtensionId } = require("./extensionScanner")
const { fileUriPathToFsPath, pathToFileUriPath } = require("./uriComponents")

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function asArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function buildIconThemeCatalog(extensions = []) {
  const themes = []
  for (const extension of Array.isArray(extensions) ? extensions : []) {
    if (!isObject(extension) || extension.enabled === false || !isObject(extension.contributes)) continue
    const installPath = getInstallPath(extension)
    for (const theme of asArray(extension.contributes.iconThemes)) {
      if (!isObject(theme) || !theme.id || !theme.path || !installPath) continue
      themes.push({
        id: String(theme.id),
        label: String(theme.label || theme.id),
        extensionId: getExtensionId(extension),
        path: String(theme.path),
        absolutePath: resolveInside(installPath, String(theme.path)),
      })
    }
  }
  return themes.filter((theme) => Boolean(theme.absolutePath))
}

function loadFileIconTheme(themeId, extensions = []) {
  const catalog = buildIconThemeCatalog(extensions)
  const selected = catalog.find((theme) => theme.id === themeId) || catalog.find((theme) => theme.id === "vs-seti") || catalog[0]
  if (!selected) {
    return { found: false, themeId, label: themeId, icons: emptyIconTheme() }
  }

  try {
    const raw = fs.readFileSync(selected.absolutePath, "utf8")
    const parsed = JSON.parse(raw)
    return {
      found: true,
      themeId: selected.id,
      label: selected.label,
      extensionId: selected.extensionId,
      path: selected.path,
      icons: normalizeIconTheme(parsed, selected.absolutePath),
    }
  } catch (err) {
    return {
      found: false,
      themeId: selected.id,
      label: selected.label,
      extensionId: selected.extensionId,
      path: selected.path,
      error: err.message,
      icons: emptyIconTheme(),
    }
  }
}

function normalizeIconTheme(theme, themeFilePath = "") {
  const definitions = isObject(theme.iconDefinitions) ? theme.iconDefinitions : {}
  const themeDir = themeFilePath ? path.dirname(themeFilePath) : ""
  const fonts = normalizeFonts(theme.fonts, themeDir)
  const defaultFontId = fonts[0]?.id || ""
  const normalized = {
    definitions: normalizeDefinitions(definitions, themeDir, defaultFontId),
    fonts,
    file: normalizeIconReference(theme.file, definitions, themeDir, defaultFontId),
    folder: normalizeIconReference(theme.folder, definitions, themeDir, defaultFontId),
    folderExpanded: normalizeIconReference(theme.folderExpanded, definitions, themeDir, defaultFontId),
    rootFolder: normalizeIconReference(theme.rootFolder, definitions, themeDir, defaultFontId),
    rootFolderExpanded: normalizeIconReference(theme.rootFolderExpanded, definitions, themeDir, defaultFontId),
    fileExtensions: normalizeIconMap(theme.fileExtensions, definitions, themeDir, defaultFontId),
    fileNames: normalizeIconMap(theme.fileNames, definitions, themeDir, defaultFontId),
    folderNames: normalizeIconMap(theme.folderNames, definitions, themeDir, defaultFontId),
    folderNamesExpanded: normalizeIconMap(theme.folderNamesExpanded, definitions, themeDir, defaultFontId),
    rootFolderNames: normalizeIconMap(theme.rootFolderNames, definitions, themeDir, defaultFontId),
    rootFolderNamesExpanded: normalizeIconMap(theme.rootFolderNamesExpanded, definitions, themeDir, defaultFontId),
    languageIds: normalizeIconMap(theme.languageIds, definitions, themeDir, defaultFontId),
    light: normalizeThemeVariant(theme.light, definitions, themeDir, defaultFontId),
    highContrast: normalizeThemeVariant(theme.highContrast, definitions, themeDir, defaultFontId),
    showLanguageModeIcons: !!theme.showLanguageModeIcons,
    hidesExplorerArrows: !!theme.hidesExplorerArrows,
  }
  applySetiCompatibilityAliases(normalized)
  return normalized
}

function applySetiCompatibilityAliases(theme) {
  const definitions = theme.definitions || {}
  const setExtension = (extension, definitionId) => {
    if (theme.fileExtensions[extension] || !definitions[definitionId]) return
    theme.fileExtensions[extension] = definitions[definitionId]
  }
  const setName = (name, definitionId) => {
    if (theme.fileNames[name] || !definitions[definitionId]) return
    theme.fileNames[name] = definitions[definitionId]
  }

  for (const extension of ["js", "mjs", "cjs", "jsx"]) setExtension(extension, "_javascript")
  for (const extension of ["ts", "mts", "cts", "tsx"]) setExtension(extension, "_typescript")
  for (const extension of ["json", "jsonc", "json5"]) setExtension(extension, "_json")
  for (const extension of ["pak", "dat", "dll", "dylib", "exe", "node", "so", "bin"]) setExtension(extension, "_default")
  for (const extension of ["asar", "br", "gz", "rar", "tar", "7z"]) setExtension(extension, "_zip")
  for (const extension of ["eot", "otf", "ttf", "woff", "woff2"]) setExtension(extension, "_font")
  setExtension("vue", "_vue")
  setExtension("wasm", "_wasm")
  setExtension("wat", "_wat")

  setName("package.json", "_npm")
  setName("package-lock.json", "_npm")
  setName("npm-shrinkwrap.json", "_npm")
  setName("tsconfig.json", "_tsconfig")
  setName("jsconfig.json", "_javascript")
  setName("vite.config.ts", "_vite")
  setName("vite.config.js", "_vite")
  setName("vite.config.mts", "_vite")
  setName("vite.config.mjs", "_vite")
  setName("license", "_license")
  setName("licence", "_license")
  setName("license.txt", "_license")
  setName("licence.txt", "_license")
  setName("license.md", "_license")
  setName("licence.md", "_license")
}

function normalizeDefinitions(definitions, themeDir = "", defaultFontId = "") {
  const out = {}
  for (const [id, definition] of Object.entries(definitions)) {
    if (!isObject(definition)) continue
    out[id] = normalizeDefinition(id, definition, themeDir, defaultFontId)
  }
  return out
}

function normalizeThemeVariant(variant, definitions, themeDir, defaultFontId = "") {
  if (!isObject(variant)) return null
  return {
    file: normalizeIconReference(variant.file, definitions, themeDir, defaultFontId),
    folder: normalizeIconReference(variant.folder, definitions, themeDir, defaultFontId),
    folderExpanded: normalizeIconReference(variant.folderExpanded, definitions, themeDir, defaultFontId),
    rootFolder: normalizeIconReference(variant.rootFolder, definitions, themeDir, defaultFontId),
    rootFolderExpanded: normalizeIconReference(variant.rootFolderExpanded, definitions, themeDir, defaultFontId),
    fileExtensions: normalizeIconMap(variant.fileExtensions, definitions, themeDir, defaultFontId),
    fileNames: normalizeIconMap(variant.fileNames, definitions, themeDir, defaultFontId),
    folderNames: normalizeIconMap(variant.folderNames, definitions, themeDir, defaultFontId),
    folderNamesExpanded: normalizeIconMap(variant.folderNamesExpanded, definitions, themeDir, defaultFontId),
    rootFolderNames: normalizeIconMap(variant.rootFolderNames, definitions, themeDir, defaultFontId),
    rootFolderNamesExpanded: normalizeIconMap(variant.rootFolderNamesExpanded, definitions, themeDir, defaultFontId),
    languageIds: normalizeIconMap(variant.languageIds, definitions, themeDir, defaultFontId),
  }
}

function normalizeIconMap(source, definitions, themeDir = "", defaultFontId = "") {
  const out = {}
  if (!isObject(source)) return out
  for (const [key, iconId] of Object.entries(source)) {
    const icon = normalizeIconReference(iconId, definitions, themeDir, defaultFontId)
    if (icon) out[String(key).toLowerCase()] = icon
  }
  return out
}

function normalizeIconReference(iconId, definitions, themeDir = "", defaultFontId = "") {
  if (typeof iconId !== "string" || !iconId) return null
  const definition = definitions[iconId]
  return normalizeDefinition(iconId, isObject(definition) ? definition : {}, themeDir, defaultFontId)
}

function normalizeDefinition(id, definition, themeDir = "", defaultFontId = "") {
  const fontId = typeof definition.fontId === "string" && definition.fontId ? definition.fontId : defaultFontId
  return {
    id,
    fontCharacter: typeof definition.fontCharacter === "string" ? definition.fontCharacter : "",
    fontColor: typeof definition.fontColor === "string" ? definition.fontColor : "",
    fontSize: typeof definition.fontSize === "string" ? definition.fontSize : "",
    fontId,
    fontFamily: fontId,
    iconPath: normalizeResourcePath(definition.iconPath, themeDir),
  }
}

function normalizeFonts(fonts, themeDir = "") {
  return asArray(fonts).filter(isObject).map((font) => ({
    id: typeof font.id === "string" ? font.id : "",
    weight: typeof font.weight === "string" ? font.weight : "",
    style: typeof font.style === "string" ? font.style : "",
    size: typeof font.size === "string" ? font.size : "",
    src: asArray(font.src).filter(isObject).map((source) => ({
      path: normalizeResourcePath(source.path, themeDir),
      format: typeof source.format === "string" ? source.format : "",
    })).filter((source) => source.path),
  })).filter((font) => font.id && font.src.length)
}

function normalizeResourcePath(resourcePath, themeDir = "") {
  if (typeof resourcePath !== "string" || !resourcePath || !themeDir) return ""
  const resolved = resolveInside(themeDir, resourcePath)
  if (!resolved) return ""
  return new URL(pathToFileUriPath(resolved), "codek-extension-resource://").toString()
}

function emptyIconTheme() {
  return {
    definitions: {},
    fonts: [],
    file: null,
    folder: null,
    folderExpanded: null,
    rootFolder: null,
    rootFolderExpanded: null,
    fileExtensions: {},
    fileNames: {},
    folderNames: {},
    folderNamesExpanded: {},
    rootFolderNames: {},
    rootFolderNamesExpanded: {},
    languageIds: {},
    light: null,
    highContrast: null,
    showLanguageModeIcons: false,
    hidesExplorerArrows: false,
  }
}

function getInstallPath(extension) {
  const raw = extension.installPath || extension.extensionLocation?.path
  if (!raw) return ""
  return path.resolve(fileUriPathToFsPath(String(raw).replace(/^file:\/\//, "")))
}

function resolveInside(baseDir, relativePath) {
  const base = path.resolve(baseDir)
  const target = path.resolve(base, relativePath)
  if (target !== base && !target.startsWith(base + path.sep)) return ""
  return target
}

module.exports = {
  buildIconThemeCatalog,
  loadFileIconTheme,
  normalizeIconTheme,
}
