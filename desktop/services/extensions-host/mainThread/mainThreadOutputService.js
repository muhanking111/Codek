/**
 * MainThreadOutputService — handles output channel operations from the EH.
 *
 * RPC handlers:
 *   $register(label, file, langId, extId)   — Register an output channel
 *   $update(channelId, mode, till)          — Update channel content
 *   $reveal(channelId, preserveFocus)       — Reveal channel in UI
 *   $close(channelId)                       — Close channel
 *   $dispose(channelId)                     — Dispose channel
 */

const fs = require("fs")
const path = require("path")
const { fileUriPathToFsPath } = require("../uriComponents")

const MAIN_THREAD_OUTPUT_SERVICE_NID = 30

const OutputChannelUpdateMode = {
  Append: 1,
  Replace: 2,
  Clear: 3,
}

let channelCounter = 0

function onRpc(server, method, handler) {
  server.onRpc(MAIN_THREAD_OUTPUT_SERVICE_NID, method, handler)
  server.onRpc(method, handler)
}

function register(server, opts = {}) {
  const { sendToRenderer } = opts
  const channels = new Map()

  onRpc(server, "$register", (args) => {
    const [label, file, languageId, extensionId] = args || []
    if (!label) return undefined

    channelCounter++
    const channelId = `extension-output-${extensionId || "unknown"}-#${channelCounter}-${label}`

    channels.set(channelId, {
      label,
      file,
      languageId,
      extensionId,
      backingFile: createBackingFileState(file),
    })

    if (sendToRenderer) {
      sendToRenderer("ext-host:output-register", {
        channelId,
        label,
        languageId,
        file: sanitizeFileForRenderer(file),
        ownerEvidence: buildOutputOwnerEvidence(label),
      })
    }

    return channelId
  })

  onRpc(server, "$update", async (args) => {
    const [channelId, mode, till] = args || []
    const channel = channels.get(channelId)
    if (!channel) return undefined

    const content = await readBackingFileContent(channel.backingFile, mode, till)

    if (sendToRenderer) {
      if (content !== undefined) {
        sendToRenderer("ext-host:output-content", { channelId, content, mode, till, ownerEvidence: buildOutputOwnerEvidence(channel.label) })
      }
      sendToRenderer("ext-host:output-update", { channelId, mode, till, ownerEvidence: buildOutputOwnerEvidence(channel.label) })
    }
    return undefined
  })

  onRpc(server, "$reveal", (args) => {
    const [channelId, preserveFocus] = args || []
    if (!channelId) return undefined

    if (sendToRenderer) {
      const channel = channels.get(channelId)
      sendToRenderer("ext-host:output-reveal", { channelId, preserveFocus: !!preserveFocus, ownerEvidence: buildOutputOwnerEvidence(channel?.label) })
    }
    return undefined
  })

  onRpc(server, "$close", (args) => {
    const [channelId] = args || []
    if (!channelId) return undefined

    if (sendToRenderer) {
      const channel = channels.get(channelId)
      sendToRenderer("ext-host:output-close", { channelId, ownerEvidence: buildOutputOwnerEvidence(channel?.label) })
    }
    return undefined
  })

  onRpc(server, "$dispose", (args) => {
    const [channelId] = args || []
    if (!channelId) return undefined

    if (sendToRenderer) {
      const channel = channels.get(channelId)
      sendToRenderer("ext-host:output-dispose", { channelId, ownerEvidence: buildOutputOwnerEvidence(channel?.label) })
    }
    channels.delete(channelId)
    return undefined
  })
}

function buildOutputOwnerEvidence(label) {
  return {
    owner: "MainThreadOutputService",
    rendererOwner: "OutputPanel",
    stateSource: "mainThreadOutputService/extHostOutputChannel",
    outputServiceOwner: "outputLogTelemetryService",
    channelLabel: typeof label === "string" ? label : "",
    evidenceState: "partial",
    uiOwnerState: "partial",
    rawOutputPayloadIncluded: false,
  }
}

function createBackingFileState(file) {
  const filePath = toLocalFilePath(file)
  return {
    path: filePath,
    offset: 0,
  }
}

function sanitizeFileForRenderer(file) {
  const filePath = toLocalFilePath(file)
  if (!filePath) return undefined
  return { scheme: "file", path: filePath }
}

function toLocalFilePath(file) {
  if (!file || typeof file !== "object") return undefined
  if (file.scheme && file.scheme !== "file") return undefined
  if (typeof file.fsPath === "string" && file.fsPath) return normalizeAbsolutePath(file.fsPath)
  if (typeof file.path === "string" && file.path) return normalizeAbsolutePath(fileUriPathToFsPath(file.path))
  return undefined
}

function normalizeAbsolutePath(value) {
  const normalized = path.normalize(value)
  return path.isAbsolute(normalized) ? normalized : undefined
}

async function readBackingFileContent(state, mode, till) {
  if (!state?.path) return undefined
  try {
    const stats = await fs.promises.stat(state.path)
    if (!stats.isFile()) return undefined
    if (mode === OutputChannelUpdateMode.Clear || mode === OutputChannelUpdateMode.Replace) {
      state.offset = hasValidOffset(till) ? sanitizeOffset(till) : stats.size
    }
    if (stats.size < state.offset) state.offset = 0
    const start = Math.min(state.offset, stats.size)
    if (mode === OutputChannelUpdateMode.Clear) return ""
    if (stats.size <= start) return ""
    const handle = await fs.promises.open(state.path, "r")
    try {
      const length = stats.size - start
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, start)
      state.offset = start + bytesRead
      return buffer.subarray(0, bytesRead).toString("utf8")
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (error?.code === "ENOENT") return undefined
    return undefined
  }
}

function sanitizeOffset(value) {
  const offset = Number(value)
  return Number.isFinite(offset) && offset >= 0 ? offset : 0
}

function hasValidOffset(value) {
  const offset = Number(value)
  return Number.isFinite(offset) && offset >= 0
}

module.exports = {
  MAIN_THREAD_OUTPUT_SERVICE_NID,
  register,
  _test: {
    buildOutputOwnerEvidence,
    readBackingFileContent,
    toLocalFilePath,
  },
}
