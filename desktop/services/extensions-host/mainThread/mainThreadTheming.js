/**
 * MainThreadTheming — handles theme changes from the Extension Host.
 *
 * RPC handlers:
 *   $setColorTheme(theme)     — Apply a color theme
 */

function register(server, opts = {}) {
  server.onRpc("$setColorTheme", (args) => {
    const [theme, target] = args || []
    if (!theme) return undefined
    console.log(`[main-thread:theming] Set theme: ${theme}`)
    if (typeof opts.updateConfiguration === "function") {
      opts.updateConfiguration("workbench.colorTheme", theme, target)
    }

    if (opts.sendToRenderer) {
      opts.sendToRenderer("ext-host:theme", { theme })
    }
    return undefined
  })

  server.onRpc("$setFileIconTheme", (args) => {
    const [iconTheme, target] = args || []
    if (!iconTheme) return undefined
    console.log(`[main-thread:theming] Set file icon theme: ${iconTheme}`)
    if (typeof opts.updateConfiguration === "function") {
      opts.updateConfiguration("workbench.iconTheme", iconTheme, target)
    }
    if (opts.sendToRenderer) {
      opts.sendToRenderer("ext-host:fileIconTheme", { iconTheme })
    }
    return undefined
  })

  // Also handle the color theme map request from EH
  server.onRpc("$getColorThemes", () => {
    return [
      { id: "dark", label: "Default Dark Modern", settingsId: "dark" },
      { id: "light", label: "Default Light Modern", settingsId: "light" },
      { id: "high-contrast", label: "Default High Contrast", settingsId: "high-contrast" },
    ]
  })

  server.onRpc("$getFileIconThemes", () => {
    return [
      { id: "vs-seti", label: "VS Code Seti", settingsId: "vs-seti" },
      { id: "minimal", label: "Minimal", settingsId: "minimal" },
      { id: "monochrome", label: "Monochrome", settingsId: "monochrome" },
    ]
  })
}

module.exports = { register }
