const fs = require("fs")
const path = require("path")

const { fileUriPathToFsPath, toFileUriComponents } = require("../uriComponents")

function findBuiltInBundlePath(rootDir, id, language) {
  if (!id || !language) return ""
  const candidates = [
    path.join(rootDir, "extensions", id, "l10n", `bundle.l10n.${language}.json`),
    path.join(rootDir, "extensions", id, "l10n", `bundle.l10n.${language.toLowerCase()}.json`),
    path.join(rootDir, "extensions", id, "package.nls.json"),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) || ""
}

function register(server, opts = {}) {
  const rootDir = opts.rootDir || process.cwd()

  server.onRpc("$fetchBuiltInBundleUri", (args) => {
    const [id, language] = args || []
    const bundlePath = findBuiltInBundlePath(rootDir, id, language)
    return bundlePath ? toFileUriComponents(bundlePath) : undefined
  })

  server.onRpc("$fetchBundleContents", (args) => {
    const [uriComponents] = args || []
    if (!uriComponents || uriComponents.scheme !== "file" || !uriComponents.path) return "{}"
    const filePath = fileUriPathToFsPath(uriComponents.path)
    return fs.readFileSync(filePath, "utf8")
  })
}

module.exports = {
  findBuiltInBundlePath,
  register,
}
