const StateType = Object.freeze({
  Idle: "idle",
  Disabled: "disabled",
  CheckingForUpdates: "checking for updates",
  AvailableForDownload: "available for download",
  Downloading: "downloading",
  Downloaded: "downloaded",
  Updating: "updating",
  Ready: "ready",
})

const UpdateType = Object.freeze({
  Archive: "archive",
})

const DisablementReason = Object.freeze({
  MissingConfiguration: "missingConfiguration",
  Policy: "policy",
})

function normalizeDownloadFlag(value) {
  return value === true
}

function createUpdateService(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString()
  const updateSource = normalizeUpdateSource(options.updateSource || process.env.CODEK_UPDATE_SOURCE)
  const enterprisePolicy = normalizeEnterprisePolicy(options.enterprisePolicy)
  const history = []
  let state = State.Idle(false)
  record(state)

  function record(nextState) {
    state = {
      ...nextState,
      timestamp: now(),
      stateSource: "desktopUpdateService",
    }
    history.push(state)
    if (history.length > 50) history.splice(0, history.length - 50)
    return state
  }

  function policySnapshot() {
    return {
      updateSourceConfigured: Boolean(updateSource),
      enterprisePolicy,
    }
  }

  function blockedState() {
    if (!enterprisePolicy.allowed) {
      return State.Disabled(DisablementReason.Policy, enterprisePolicy.reason || "enterprise_policy_denied")
    }
    if (!updateSource) {
      return null
    }
    return null
  }

  function snapshot(extra = {}) {
    return {
      available: state.type === StateType.AvailableForDownload,
      checkedAt: latestCheckedAt(),
      state,
      history: history.map((entry) => ({ ...entry })),
      policy: policySnapshot(),
      ...extra,
    }
  }

  function latestCheckedAt() {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (history[index].type === StateType.CheckingForUpdates || history[index].checkedAt) {
        return history[index].checkedAt || history[index].timestamp
      }
    }
    return ""
  }

  async function checkForUpdates({ explicit = true, download = false } = {}) {
    const lifecycle = []
    const blocked = blockedState()
    if (blocked) {
      lifecycle.push(record(blocked))
      return snapshot({
        downloadRequested: download,
        lifecycle,
        message: "企业策略已阻止桌面更新检查。",
      })
    }

    lifecycle.push(record(State.CheckingForUpdates(explicit)))
    if (!updateSource) {
      lifecycle.push(record(State.Idle(true, "missing_update_source")))
      return snapshot({
        available: false,
        checkedAt: lifecycle[0].timestamp,
        downloadRequested: download,
        lifecycle,
        message: download
          ? "当前未配置桌面更新源，已记录自动下载请求。"
          : "当前未配置桌面更新源，已完成本地检查请求。",
      })
    }

    const update = {
      version: String(updateSource.version || "unknown"),
      productVersion: updateSource.productVersion,
      url: updateSource.url,
    }
    lifecycle.push(record(State.AvailableForDownload(update, true)))
    if (download) {
      lifecycle.push(record(State.Downloading(update, explicit)))
      lifecycle.push(record(State.Downloaded(update, explicit)))
    }
    return snapshot({
      available: true,
      checkedAt: lifecycle[0].timestamp,
      downloadRequested: download,
      lifecycle,
      message: download ? "已发现更新并完成本地下载阶段。" : "已发现可下载更新。",
    })
  }

  async function downloadUpdate({ explicit = true } = {}) {
    const lifecycle = []
    if (!updateSource) {
      lifecycle.push(record(State.Idle(true, "missing_update_source")))
      return snapshot({
        available: false,
        downloadRequested: true,
        lifecycle,
        message: "当前未配置桌面更新源，无法下载更新。",
      })
    }
    const update = {
      version: String(updateSource.version || "unknown"),
      productVersion: updateSource.productVersion,
      url: updateSource.url,
    }
    lifecycle.push(record(State.Downloading(update, explicit)))
    lifecycle.push(record(State.Downloaded(update, explicit)))
    return snapshot({
      available: true,
      downloadRequested: true,
      lifecycle,
      message: "已完成本地下载阶段。",
    })
  }

  async function applyUpdate({ explicit = true } = {}) {
    const lifecycle = []
    if (!updateSource) {
      lifecycle.push(record(State.Idle(true, "missing_update_source")))
      return snapshot({
        available: false,
        lifecycle,
        message: "当前未配置桌面更新源，无法应用更新。",
      })
    }
    const update = {
      version: String(updateSource.version || "unknown"),
      productVersion: updateSource.productVersion,
      url: updateSource.url,
    }
    lifecycle.push(record(State.Updating(update, explicit)))
    lifecycle.push(record(State.Ready(update, explicit)))
    return snapshot({
      available: true,
      lifecycle,
      message: "更新已准备好，将在重启后生效。",
    })
  }

  return {
    get state() {
      return state
    },
    snapshot,
    checkForUpdates,
    downloadUpdate,
    applyUpdate,
  }
}

const State = {
  Idle(notAvailable = false, error) {
    return {
      type: StateType.Idle,
      updateType: UpdateType.Archive,
      notAvailable,
      ...(error ? { error } : {}),
    }
  },
  Disabled(reason, error) {
    return {
      type: StateType.Disabled,
      reason,
      ...(error ? { error } : {}),
    }
  },
  CheckingForUpdates(explicit) {
    return {
      type: StateType.CheckingForUpdates,
      explicit,
    }
  },
  AvailableForDownload(update, canInstall) {
    return {
      type: StateType.AvailableForDownload,
      update,
      canInstall,
    }
  },
  Downloading(update, explicit) {
    return {
      type: StateType.Downloading,
      update,
      explicit,
      overwrite: false,
    }
  },
  Downloaded(update, explicit) {
    return {
      type: StateType.Downloaded,
      update,
      explicit,
      overwrite: false,
    }
  },
  Updating(update, explicit) {
    return {
      type: StateType.Updating,
      update,
      explicit,
    }
  },
  Ready(update, explicit) {
    return {
      type: StateType.Ready,
      update,
      explicit,
      overwrite: false,
    }
  },
}

function normalizeUpdateSource(value) {
  if (!value) return null
  if (typeof value === "string") {
    return {
      url: value,
      version: process.env.CODEK_UPDATE_VERSION || "unknown",
      productVersion: process.env.npm_package_version,
    }
  }
  if (typeof value === "object") return value
  return null
}

function normalizeEnterprisePolicy(value) {
  if (!value || typeof value !== "object") {
    return {
      allowed: true,
      reason: "",
      policyRule: "",
    }
  }
  return {
    allowed: value.allowed !== false,
    reason: String(value.reason || ""),
    policyRule: String(value.policyRule || ""),
  }
}

function register(router, options = {}) {
  const service = createUpdateService(options)

  router.register("GET", "/updates/state", async () => service.snapshot())

  router.register("POST", "/updates/check", async ({ body }) => {
    const download = normalizeDownloadFlag(body?.download)
    return service.checkForUpdates({ explicit: true, download })
  })

  router.register("POST", "/updates/download", async () => service.downloadUpdate({ explicit: true }))

  router.register("POST", "/updates/apply", async () => service.applyUpdate({ explicit: true }))
}

module.exports = {
  DisablementReason,
  State,
  StateType,
  UpdateType,
  createUpdateService,
  register,
}
