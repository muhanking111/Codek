const DEFAULT_EXTENSION_ICON_SVG = [
  "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">",
  "<rect width=\"64\" height=\"64\" rx=\"10\" fill=\"#2d3340\"/>",
  "<path d=\"M18 18h12v12H18V18Zm16 0h12v12H34V18ZM18 34h12v12H18V34Zm16 0h12v12H34V34Z\" fill=\"#b9c6d8\"/>",
  "<path d=\"M30 18h4v28h-4V18Zm-12 12h28v4H18v-4Z\" fill=\"#7aa2d6\" opacity=\".75\"/>",
  "</svg>",
].join("")

const DEFAULT_EXTENSION_ICON_DATA_URL = `data:image/svg+xml;base64,${Buffer.from(DEFAULT_EXTENSION_ICON_SVG).toString("base64")}`
const UNDEFINED_PUBLISHER = "undefined_publisher"

function normalizeExtensionId(id) {
  return String(id || "").trim()
}

function getExtensionId(publisher, name) {
  return `${publisher}.${name}`
}

function adoptToGalleryExtensionId(id) {
  return normalizeExtensionId(id).toLowerCase()
}

function getGalleryExtensionId(publisher, name) {
  return adoptToGalleryExtensionId(getExtensionId(publisher || UNDEFINED_PUBLISHER, name))
}

function sameExtensionId(a, b) {
  return normalizeExtensionId(a).toLowerCase() === normalizeExtensionId(b).toLowerCase()
}

function firstMessage(items = []) {
  const match = (Array.isArray(items) ? items : []).find((item) => item?.message || item?.error)
  return match ? String(match.message || match.error || "") : ""
}

function hasGalleryIcon(input = {}) {
  return Boolean(input.iconCacheUrl || input.iconUrl || input.iconUrlFallback)
}

function buildExtensionIconPresentation(input = {}) {
  const id = normalizeExtensionId(input.id || (input.publisher && input.name ? getGalleryExtensionId(input.publisher, input.name) : ""))
  if (hasGalleryIcon(input)) {
    return {
      icon: input.icon || "",
      iconPath: input.icon || "",
      iconUrl: input.iconUrl || "",
      iconCacheUrl: input.iconCacheUrl || "",
      iconUrlFallback: input.iconUrlFallback || "",
      iconSource: "gallery",
      iconDataUrl: DEFAULT_EXTENSION_ICON_DATA_URL,
      defaultIcon: true,
    }
  }
  if (input.icon && input.installPath) {
    return {
      icon: input.icon,
      iconPath: input.icon,
      iconUrl: "",
      iconCacheUrl: id ? `/extensions-host/installed/${encodeURIComponent(id)}/icon` : "",
      iconUrlFallback: "",
      iconSource: "manifest",
      iconDataUrl: DEFAULT_EXTENSION_ICON_DATA_URL,
      defaultIcon: true,
    }
  }
  return {
    icon: input.icon || "",
    iconPath: input.icon || "",
    iconUrl: "",
    iconCacheUrl: "",
    iconUrlFallback: "",
    iconSource: "default",
    iconDataUrl: DEFAULT_EXTENSION_ICON_DATA_URL,
    defaultIcon: true,
  }
}

function buildExtensionRuntimeStatus(input = {}) {
  const id = normalizeExtensionId(input.id)
  const installState = input.installState || {}
  const compatibility = input.compatibility || {}
  const lifecycle = input.lifecycle || {}
  const enabled = input.enabled !== false
  const activated = (Array.isArray(lifecycle.activated) ? lifecycle.activated : []).some((value) => sameExtensionId(value, id))
  const activationErrors = (Array.isArray(lifecycle.activationErrors) ? lifecycle.activationErrors : [])
    .filter((error) => sameExtensionId(error?.id || error?.extensionId, id))
  const runtimeErrors = (Array.isArray(lifecycle.runtimeErrors) ? lifecycle.runtimeErrors : [])
    .filter((error) => sameExtensionId(error?.id || error?.extensionId, id))
  const firstError = firstMessage([...activationErrors, ...runtimeErrors]) || installState.lastError || installState.error || ""

  if (String(installState.status || "").toLowerCase() === "failed" || firstError) {
    return {
      status: "error",
      label: "错误",
      detail: firstError || "扩展安装或激活失败。",
      reason: firstError ? "activation" : "install-state",
    }
  }
  if (!enabled) {
    return {
      status: "disabled",
      label: "已禁用",
      detail: "扩展已安装但当前被禁用。",
      reason: "disabled",
    }
  }
  if (compatibility.status === "blocked" || (Array.isArray(compatibility.unsupportedContributionPoints) && compatibility.unsupportedContributionPoints.length > 0)) {
    return {
      status: "unsupported",
      label: "不支持",
      detail: firstMessage(compatibility.blockers) || firstMessage(compatibility.warnings) || "该扩展使用 Codek 当前不支持的 VS Code 能力。",
      reason: "compatibility",
    }
  }
  if (activated) {
    return {
      status: "activated",
      label: "已激活",
      detail: "扩展宿主已加载并激活该扩展。",
      reason: "extension-host",
    }
  }
  if (compatibility.status === "degraded") {
    return {
      status: "enabled",
      label: "已启用",
      detail: firstMessage(compatibility.warnings) || "扩展已启用，部分贡献点为降级兼容。",
      reason: "compatibility",
    }
  }
  if (String(installState.status || "").toLowerCase() === "installing") {
    return {
      status: "installing",
      label: "安装中",
      detail: installState.phase ? `当前阶段：${installState.phase}` : "扩展正在安装。",
      reason: "install-state",
    }
  }
  return {
    status: "enabled",
    label: "已启用",
    detail: "扩展已安装并可由扩展宿主按 activationEvents 激活。",
    reason: "installed",
  }
}

module.exports = {
  DEFAULT_EXTENSION_ICON_DATA_URL,
  DEFAULT_EXTENSION_ICON_SVG,
  UNDEFINED_PUBLISHER,
  adoptToGalleryExtensionId,
  buildExtensionIconPresentation,
  buildExtensionRuntimeStatus,
  getExtensionId,
  getGalleryExtensionId,
  sameExtensionId,
}
