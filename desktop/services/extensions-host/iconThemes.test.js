const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const { buildIconThemeCatalog, loadFileIconTheme } = require("./iconThemes")

test("loadFileIconTheme reads VS Code icon theme maps from extension contributions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-icon-theme-"))
  const themeDir = path.join(root, "icons")
  fs.mkdirSync(themeDir, { recursive: true })
  fs.writeFileSync(path.join(themeDir, "file.svg"), "<svg />", "utf8")
  fs.writeFileSync(path.join(themeDir, "theme.json"), JSON.stringify({
    fonts: [{ id: "seti", src: [{ path: "./seti.woff", format: "woff" }], weight: "normal", style: "normal", size: "150%" }],
    iconDefinitions: {
      "_file": { fontCharacter: "\\E001", fontColor: "#cccccc", fontId: "seti", iconPath: "./file.svg" },
      "_ts": { fontCharacter: "\\E002", fontColor: "#519aba", fontSize: "20px" },
      "_src": { fontCharacter: "\\E003", fontColor: "#8dc149" },
      "_root": { fontCharacter: "\\E004", fontColor: "#d6a85f" },
    },
    file: "_file",
    folder: "_src",
    rootFolder: "_root",
    fileExtensions: { ts: "_ts" },
    folderNames: { src: "_src" },
    light: {
      fileExtensions: { ts: "_file" },
    },
  }), "utf8")

  const extensions = [{
    id: "codek.theme",
    enabled: true,
    installPath: root,
    contributes: {
      iconThemes: [{ id: "codek-icons", label: "Codek Icons", path: "./icons/theme.json" }],
    },
  }]

  assert.equal(buildIconThemeCatalog(extensions)[0].id, "codek-icons")
  const loaded = loadFileIconTheme("codek-icons", extensions)
  assert.equal(loaded.found, true)
  assert.equal(loaded.icons.fileExtensions.ts.fontColor, "#519aba")
  assert.equal(loaded.icons.folderNames.src.fontCharacter, "\\E003")
  assert.equal(loaded.icons.rootFolder.fontCharacter, "\\E004")
  assert.equal(loaded.icons.file.fontFamily, "seti")
  assert.match(loaded.icons.file.iconPath, /^codek-extension-resource:\/\/\//)
  assert.match(loaded.icons.fonts[0].src[0].path, /^codek-extension-resource:\/\/\//)
  assert.doesNotMatch(loaded.icons.file.iconPath, /%3A/i)
  assert.doesNotMatch(loaded.icons.fonts[0].src[0].path, /%3A/i)
  assert.equal(loaded.icons.fonts[0].id, "seti")
  assert.equal(loaded.icons.fonts[0].size, "150%")
  assert.equal(loaded.icons.fileExtensions.ts.fontSize, "20px")
  assert.equal(loaded.icons.light.fileExtensions.ts.id, "_file")
})

test("loadFileIconTheme fills common Seti aliases when bundled theme mappings are sparse", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-icon-theme-seti-aliases-"))
  const themeDir = path.join(root, "icons")
  fs.mkdirSync(themeDir, { recursive: true })
  fs.writeFileSync(path.join(themeDir, "theme.json"), JSON.stringify({
    fonts: [{ id: "seti", src: [{ path: "./seti.woff", format: "woff" }] }],
    iconDefinitions: {
      "_default": { fontCharacter: "\\E001", fontColor: "#cccccc" },
      "_typescript": { fontCharacter: "\\E099", fontColor: "#519aba" },
      "_json": { fontCharacter: "\\E055", fontColor: "#cbcb41" },
      "_npm": { fontCharacter: "\\E071", fontColor: "#cb3837" },
      "_vue": { fontCharacter: "\\E0A1", fontColor: "#8dc149" },
    },
    file: "_default",
    fileExtensions: { vue: "_vue" },
  }), "utf8")

  const loaded = loadFileIconTheme("sparse-seti", [{
    id: "codek.theme",
    enabled: true,
    installPath: root,
    contributes: {
      iconThemes: [{ id: "sparse-seti", label: "Sparse Seti", path: "./icons/theme.json" }],
    },
  }])

  assert.equal(loaded.icons.fileExtensions.ts.id, "_typescript")
  assert.equal(loaded.icons.fileExtensions.json.id, "_json")
  assert.equal(loaded.icons.fileExtensions.vue.id, "_vue")
  assert.equal(loaded.icons.fileNames["package.json"].id, "_npm")
})

test("loadFileIconTheme fills VS Code/Electron artifact aliases through Seti glyph definitions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-icon-theme-artifact-aliases-"))
  const themeDir = path.join(root, "icons")
  fs.mkdirSync(themeDir, { recursive: true })
  fs.writeFileSync(path.join(themeDir, "theme.json"), JSON.stringify({
    fonts: [{ id: "seti", src: [{ path: "./seti.woff", format: "woff" }] }],
    iconDefinitions: {
      "_default": { fontCharacter: "\\E023", fontColor: "#8b949e" },
      "_font": { fontCharacter: "\\E033", fontColor: "#519aba" },
      "_license": { fontCharacter: "\\E05A", fontColor: "#cbcb41" },
      "_wasm": { fontCharacter: "\\E0AA", fontColor: "#d6a85f" },
      "_zip": { fontCharacter: "\\E0A9", fontColor: "#6d8086" },
    },
    file: "_default",
    fileExtensions: {},
    fileNames: {},
  }), "utf8")

  const loaded = loadFileIconTheme("artifact-seti", [{
    id: "codek.theme",
    enabled: true,
    installPath: root,
    contributes: {
      iconThemes: [{ id: "artifact-seti", label: "Artifact Seti", path: "./icons/theme.json" }],
    },
  }])

  assert.equal(loaded.icons.fileExtensions.pak.id, "_default")
  assert.equal(loaded.icons.fileExtensions.dat.id, "_default")
  assert.equal(loaded.icons.fileExtensions.dll.id, "_default")
  assert.equal(loaded.icons.fileExtensions.node.id, "_default")
  assert.equal(loaded.icons.fileExtensions.asar.id, "_zip")
  assert.equal(loaded.icons.fileExtensions.woff.id, "_font")
  assert.equal(loaded.icons.fileExtensions.wasm.id, "_wasm")
  assert.equal(loaded.icons.fileNames.license.id, "_license")
})

test("loadFileIconTheme follows VS Code default font id when icon definitions omit fontId", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-icon-theme-default-font-"))
  const themeDir = path.join(root, "icons")
  fs.mkdirSync(themeDir, { recursive: true })
  fs.writeFileSync(path.join(themeDir, "seti.woff"), "", "utf8")
  fs.writeFileSync(path.join(themeDir, "theme.json"), JSON.stringify({
    fonts: [{ id: "seti", src: [{ path: "./seti.woff", format: "woff" }] }],
    iconDefinitions: {
      "_file": { fontCharacter: "\\E001", fontColor: "#cccccc" },
      "_folder": { fontCharacter: "\\E002", fontColor: "#d6a85f" },
    },
    file: "_file",
    folder: "_folder",
  }), "utf8")

  const loaded = loadFileIconTheme("default-font-icons", [{
    id: "codek.theme",
    enabled: true,
    installPath: root,
    contributes: {
      iconThemes: [{ id: "default-font-icons", label: "Default Font Icons", path: "./icons/theme.json" }],
    },
  }])

  assert.equal(loaded.icons.file.fontId, "seti")
  assert.equal(loaded.icons.file.fontFamily, "seti")
  assert.equal(loaded.icons.folder.fontId, "seti")
})

test("loadFileIconTheme rejects icon theme paths outside the extension", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-icon-theme-"))
  const loaded = loadFileIconTheme("bad-icons", [{
    id: "codek.bad",
    enabled: true,
    installPath: root,
    contributes: {
      iconThemes: [{ id: "bad-icons", label: "Bad", path: "../theme.json" }],
    },
  }])

  assert.equal(loaded.found, false)
  assert.deepEqual(loaded.icons.fileExtensions, {})
})

test("loadFileIconTheme strips icon resources that escape the extension root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-icon-theme-"))
  const icons = path.join(root, "icons")
  fs.mkdirSync(icons, { recursive: true })
  fs.writeFileSync(path.join(icons, "theme.json"), JSON.stringify({
    iconDefinitions: {
      "_bad": { iconPath: "../outside.svg", fontCharacter: "\\E010" },
      "_good": { iconPath: "./good.svg", fontCharacter: "\\E011" },
    },
    file: "_bad",
    folder: "_good",
  }), "utf8")
  fs.writeFileSync(path.join(icons, "good.svg"), "<svg />", "utf8")

  const loaded = loadFileIconTheme("safe-icons", [{
    id: "codek.safe",
    enabled: true,
    installPath: root,
    contributes: {
      iconThemes: [{ id: "safe-icons", label: "Safe", path: "./icons/theme.json" }],
    },
  }])

  assert.equal(loaded.icons.file.iconPath, "")
  assert.match(loaded.icons.folder.iconPath, /^codek-extension-resource:\/\/\//)
  assert.doesNotMatch(loaded.icons.folder.iconPath, /%3A/i)
})
