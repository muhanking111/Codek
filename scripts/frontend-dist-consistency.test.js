const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  assertDistReferencesExist,
  assertDistTreesMatch,
  extractJsReferences,
} = require("./frontend-dist-consistency")

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, "utf8")
}

test("frontend dist consistency detects stale dynamic import chunks", () => {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-frontend-dist-missing-"))
  writeFile(path.join(distDir, "index.html"), [
    "<!doctype html>",
    "<script type=\"module\" src=\"./assets/index-current.js\"></script>",
  ].join("\n"))
  writeFile(path.join(distDir, "assets", "index-current.js"), "import(`./typescript-stale.js`)\n")

  assert.throws(
    () => assertDistReferencesExist(distDir),
    /index-current\.js -> \.\/typescript-stale\.js/,
  )
})

test("frontend dist consistency compares source and desktop outputs", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-frontend-dist-compare-"))
  const sourceDist = path.join(fixtureRoot, "frontend", "vite-project", "dist")
  const desktopDist = path.join(fixtureRoot, "desktop", "frontend-dist")
  writeFile(path.join(sourceDist, "index.html"), "<script type=\"module\" src=\"./assets/index-a.js\"></script>\n")
  writeFile(path.join(sourceDist, "assets", "index-a.js"), "console.info('source')\n")
  writeFile(path.join(desktopDist, "index.html"), "<script type=\"module\" src=\"./assets/index-a.js\"></script>\n")
  writeFile(path.join(desktopDist, "assets", "index-a.js"), "console.info('desktop')\n")

  assert.throws(
    () => assertDistTreesMatch(sourceDist, desktopDist),
    /assets\/index-a\.js: content differs/,
  )
})

test("frontend dist consistency extracts Vite module dependency references", () => {
  const refs = extractJsReferences("const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||([\"./typescript-BtwKQRu2.js\",\"./theme.css\"])))=>i.map(i=>d[i]); import(`./typescript-BuPZ2V3M.js`)")
  assert.deepEqual(refs, ["./typescript-BtwKQRu2.js", "./theme.css", "./typescript-BuPZ2V3M.js"])
})

test("frontend dist consistency ignores runtime metadata strings in JavaScript bundles", () => {
  const refs = extractJsReferences("const metadata = { path: \"./seti.woff\" }")
  assert.deepEqual(refs, [])
})

test("frontend dist consistency extracts plain generated dynamic import references", () => {
  const refs = extractJsReferences("import(`./typescript-BuPZ2V3M.js`)")
  assert.deepEqual(refs, ["./typescript-BuPZ2V3M.js"])
})
