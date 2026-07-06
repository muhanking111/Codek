/**
 * MainThreadFileSystemEvents — handles file watcher registration from the EH.
 *
 * RPC handlers:
 *   $watch(extensionId, session, resource, opts)   — Start watching a path
 *   $unwatch(session)                                — Stop watching
 *
 * Uses chokidar for file watching (same as Codek's file watcher).
 */

const fs = require("fs")
const { fileUriPathToFsPath, toFileUriComponents } = require("../uriComponents")

const MAIN_THREAD_FILE_SYSTEM_EVENT_SERVICE_NID = 51

let chokidar = null
try { chokidar = require("chokidar") } catch {}

const watchers = new Map()

function uriToPath(uri) {
  if (!uri) return null
  if (uri.scheme && uri.scheme !== "file") return null
  let p = uri.path || ""
  return fileUriPathToFsPath(p)
}

function onRpc(server, method, handler) {
  server.onRpc(MAIN_THREAD_FILE_SYSTEM_EVENT_SERVICE_NID, method, handler)
  server.onRpc(method, handler)
}

function register(server, opts = {}) {
  onRpc(server, "$watch", (args) => {
    const [extensionId, session, resource, watchOpts] = args || []
    if (!resource || session == null) return undefined

    const dirPath = uriToPath(resource)
    if (!dirPath || !fs.existsSync(dirPath)) return undefined

    const recursive = watchOpts?.recursive !== false

    // Stop existing watcher for this session if any
    const existing = watchers.get(session)
    if (existing) {
      existing.close()
      watchers.delete(session)
    }

    if (!chokidar) {
      return undefined
    }

    const pattern = recursive ? `${dirPath}/**/*` : `${dirPath}/*`
    const watcher = chokidar.watch(pattern, {
      ignoreInitial: true,
      persistent: false,
      depth: recursive ? undefined : 0,
    })

    watcher.on("all", (event, filePath) => {
      // Forward to renderer if available
      if (opts.sendToRenderer) {
        opts.sendToRenderer("ext-host:file-changed", {
          session,
          event,
          uri: toFileUriComponents(filePath),
        })
      }
    })

    watchers.set(session, watcher)
    return undefined
  })

  onRpc(server, "$unwatch", (args) => {
    const [session] = args || []
    if (session == null) return undefined

    const watcher = watchers.get(session)
    if (watcher) {
      watcher.close()
      watchers.delete(session)
    }
    return undefined
  })
}

module.exports = { MAIN_THREAD_FILE_SYSTEM_EVENT_SERVICE_NID, register }
