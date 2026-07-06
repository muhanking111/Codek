const path = require("path")

function pathToFileUriPath(filePath, platform = process.platform) {
  let normalized = String(filePath || "").replace(/\\/g, "/")
  if (platform === "win32" && /^[A-Za-z]:\//.test(normalized)) {
    normalized = `/${normalized}`
  }
  return normalized
}

function fileUriPathToFsPath(uriPath, platform = process.platform, separator = path.sep) {
  let normalized = String(uriPath || "")
  if (platform === "win32" && /^\/[A-Za-z]:\//.test(normalized)) {
    normalized = `${normalized[1].toLowerCase()}${normalized.slice(2)}`
  }
  return normalized.replace(/\//g, separator)
}

function toFileUriComponents(filePath, platform = process.platform) {
  const uriPath = pathToFileUriPath(filePath, platform)
  return {
    $mid: 1,
    scheme: "file",
    authority: "",
    path: uriPath,
    query: "",
    fragment: "",
    fsPath: fileUriPathToFsPath(uriPath, platform, platform === "win32" ? "\\" : path.sep),
    ...(platform === "win32" ? { _sep: 1 } : {}),
  }
}

module.exports = {
  fileUriPathToFsPath,
  pathToFileUriPath,
  toFileUriComponents,
}
