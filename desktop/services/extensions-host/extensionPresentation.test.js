const assert = require("node:assert/strict")
const test = require("node:test")

const {
  DEFAULT_EXTENSION_ICON_DATA_URL,
  buildExtensionIconPresentation,
  buildExtensionRuntimeStatus,
  getGalleryExtensionId,
} = require("./extensionPresentation")

test("getGalleryExtensionId follows VS Code publisher.name lower-case gallery identity", () => {
  assert.equal(getGalleryExtensionId("Microsoft", "Python"), "microsoft.python")
  assert.equal(getGalleryExtensionId("", "theme-pack"), "undefined_publisher.theme-pack")
})

test("buildExtensionIconPresentation prefers gallery icon then manifest icon then default icon", () => {
  const gallery = buildExtensionIconPresentation({
    id: "publisher.extension",
    iconUrl: "https://example.com/icon.png",
    iconCacheUrl: "/extensions-host/marketplace/icon/publisher.extension",
    iconUrlFallback: "https://fallback.example.com/icon.png",
    icon: "media/local.svg",
    installPath: "D:\\Workspace\\extensions\\publisher.extension",
  })
  assert.equal(gallery.iconSource, "gallery")
  assert.equal(gallery.iconCacheUrl, "/extensions-host/marketplace/icon/publisher.extension")
  assert.equal(gallery.iconUrl, "https://example.com/icon.png")
  assert.equal(gallery.iconUrlFallback, "https://fallback.example.com/icon.png")
  assert.equal(gallery.iconDataUrl, DEFAULT_EXTENSION_ICON_DATA_URL)

  const local = buildExtensionIconPresentation({
    id: "publisher.extension",
    icon: "media/local.svg",
    installPath: "D:\\Workspace\\extensions\\publisher.extension",
  })
  assert.equal(local.iconSource, "manifest")
  assert.equal(local.iconPath, "media/local.svg")
  assert.equal(local.iconCacheUrl, "/extensions-host/installed/publisher.extension/icon")

  const fallback = buildExtensionIconPresentation({ id: "publisher.extension" })
  assert.equal(fallback.iconSource, "default")
  assert.equal(fallback.iconDataUrl, DEFAULT_EXTENSION_ICON_DATA_URL)
})

test("buildExtensionRuntimeStatus exposes enabled, activated, error and unsupported states", () => {
  assert.deepEqual(buildExtensionRuntimeStatus({
    id: "publisher.disabled",
    enabled: false,
    installState: { status: "disabled" },
    compatibility: { status: "compatible", warnings: [] },
    lifecycle: { activated: ["publisher.other"], activationErrors: [], runtimeErrors: [] },
  }), {
    status: "disabled",
    label: "已禁用",
    detail: "扩展已安装但当前被禁用。",
    reason: "disabled",
  })

  const activated = buildExtensionRuntimeStatus({
    id: "publisher.active",
    enabled: true,
    installState: { status: "installed" },
    compatibility: { status: "compatible", warnings: [] },
    lifecycle: { activated: ["publisher.active"], activationErrors: [], runtimeErrors: [] },
  })
  assert.equal(activated.status, "activated")
  assert.equal(activated.reason, "extension-host")

  const errored = buildExtensionRuntimeStatus({
    id: "publisher.error",
    enabled: true,
    installState: { status: "installed" },
    compatibility: { status: "compatible", warnings: [] },
    lifecycle: {
      activated: [],
      activationErrors: [{ id: "publisher.error", message: "Cannot load module" }],
      runtimeErrors: [],
    },
  })
  assert.equal(errored.status, "error")
  assert.equal(errored.detail, "Cannot load module")

  const unsupported = buildExtensionRuntimeStatus({
    id: "publisher.unsupported",
    enabled: true,
    installState: { status: "installed" },
    compatibility: { status: "blocked", blockers: [{ message: "Unsupported webviews" }], warnings: [] },
    lifecycle: { activated: [], activationErrors: [], runtimeErrors: [] },
  })
  assert.equal(unsupported.status, "unsupported")
  assert.equal(unsupported.detail, "Unsupported webviews")
})
