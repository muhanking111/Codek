import { beforeEach, describe, expect, it } from "vitest"
import { activeTheme, getThemeCssVariables, normalizeColorTheme, setThemeFromWorkbenchValue } from "./theme"
import { getThemeColor, themeColorFromId } from "./themeRegistry"
import { ConfigurationService, ConfigurationTarget, settingsStore } from "./settings/settingsStore"
import { ServiceCollection } from "./vscode-adapter/platform/instantiation/common/serviceCollection"
import {
  CodekWorkbenchThemeService,
  IThemeService,
  IWorkbenchThemeService,
  workbenchThemeService,
} from "./vscode-adapter/platform/theme/common/themeService"
import { registerProductIcon, resolveProductIcon } from "./workbench/productIcons"

describe("theme compatibility", () => {
  beforeEach(() => {
    localStorage.clear()
    settingsStore.reset()
    document.documentElement.className = ""
  })

  it("normalizes VS Code and Cursor color theme names to built-in Codek themes", () => {
    expect(normalizeColorTheme("Default Dark Modern")).toBe("dark")
    expect(normalizeColorTheme("Cursor Dark")).toBe("dark")
    expect(normalizeColorTheme("Default Light Modern")).toBe("light")
    expect(normalizeColorTheme("Visual Studio Light")).toBe("light")
    expect(normalizeColorTheme("Default High Contrast")).toBe("dark")
    expect(normalizeColorTheme("unknown theme")).toBeNull()
  })

  it("applies imported workbench.colorTheme values and persists the normalized theme", () => {
    expect(setThemeFromWorkbenchValue("Default Light Modern")).toBe("light")

    expect(activeTheme.value).toBe("light")
    expect(settingsStore.get("workbench.colorTheme")).toBe("light")
    expect(localStorage.getItem("codek.theme.v1")).toBe("light")
    expect(document.documentElement.classList.contains("theme-light")).toBe(true)
    expect(document.documentElement.style.getPropertyValue("--vscode-editor-background")).toBe("#ffffff")
    expect(document.documentElement.style.getPropertyValue("--vscode-foreground")).toBe("#1f2328")
  })

  it("prefers the SettingsStore color theme and downgrades old high contrast compatibility data", () => {
    localStorage.setItem("codek.theme.v1", "light")

    settingsStore.set("workbench.colorTheme", "high-contrast")

    expect(activeTheme.value).toBe("dark")
    expect(localStorage.getItem("codek.theme.v1")).toBe("dark")
    expect(document.documentElement.classList.contains("theme-high-contrast")).toBe(false)
    expect(document.documentElement.style.getPropertyValue("--vscode-editor-background")).toBe("#1e1e1e")
  })

  it("exposes VS Code-style color token helpers with dark and light values only", () => {
    expect(themeColorFromId("editor.background")).toEqual({ id: "editor.background" })
    expect(getThemeColor("dark", "editor.background")).toBe("#1e1e1e")
    expect(getThemeCssVariables("dark")).toMatchObject({
      "--vscode-editor-background": "#1e1e1e",
      "--vscode-focusBorder": "#007fd4",
    })
    expect(getThemeColor("light", "missing.token", false)).toBeUndefined()
    expect(getThemeColor("light", "missing.token")).toBe("#000000")
  })

  it("exposes VS Code-style theme service identifiers, events, inspect and profile-aware updates", async () => {
    const configurationService = new ConfigurationService(settingsStore)
    const service = new CodekWorkbenchThemeService(configurationService)
    const colorEvents: string[] = []
    const fileIconEvents: string[] = []
    const productIconEvents: string[] = []

    service.onDidColorThemeChange((theme) => colorEvents.push(theme.settingsId))
    service.onDidFileIconThemeChange((theme) => fileIconEvents.push(theme.settingsId))
    service.onDidProductIconThemeChange((theme) => productIconEvents.push(theme.settingsId))

    expect(service._serviceBrand).toBeUndefined()
    expect(service.getColorTheme().settingsId).toBe("dark")
    expect(service.getFileIconTheme().settingsId).toBe("vs-seti")
    expect(service.getProductIconTheme().settingsId).toBe("default")
    expect(service.inspectColorTheme().effectiveValue).toBe("dark")
    expect(service.inspectProductIconTheme().effectiveValue).toBe("Default")

    await service.setColorTheme("Default Light Modern", ConfigurationTarget.USER)
    await service.setFileIconTheme("minimal", ConfigurationTarget.USER)
    await service.setProductIconTheme("default", ConfigurationTarget.USER)

    expect(service.getColorTheme()).toMatchObject({ id: "light", settingsId: "light" })
    expect(service.getFileIconTheme()).toMatchObject({ id: "minimal", settingsId: "minimal", hasFileIcons: false, hasFolderIcons: false })
    expect(service.getProductIconTheme().getIcon({ id: "search", description: "Search", defaults: { fontCharacter: "\\ea6d" } })).toEqual({ fontCharacter: "\\ea6d" })
    expect(configurationService.getValue("workbench.colorTheme")).toBe("light")
    expect(configurationService.getValue("workbench.iconTheme")).toBe("minimal")
    expect(configurationService.getValue("workbench.productIconTheme")).toBe("Default")
    expect(colorEvents).toEqual(["light"])
    expect(fileIconEvents).toEqual(["minimal"])
    expect(productIconEvents).toEqual([])

    settingsStore.replaceUserSettingsForProfile("profile-dark", {
      "workbench.colorTheme": "Default Dark Modern",
      "workbench.iconTheme": "vs-seti",
      "workbench.productIconTheme": "Default",
    })

    expect(service.getColorTheme().settingsId).toBe("dark")
    expect(service.getFileIconTheme().settingsId).toBe("vs-seti")
    expect(service.getProductIconTheme().settingsId).toBe("default")
    expect(settingsStore.getUserSettings()["workbench.productIconTheme"]).toBe("Default")
    expect(colorEvents.at(-1)).toBe("dark")
    expect(fileIconEvents.at(-1)).toBe("vs-seti")
  })

  it("updates workspace and override theme targets through the same configuration service", async () => {
    const configurationService = new ConfigurationService(settingsStore)
    const service = new CodekWorkbenchThemeService(configurationService)

    await service.setColorTheme("Default High Contrast", ConfigurationTarget.WORKSPACE)
    await service.setFileIconTheme("minimal", ConfigurationTarget.WORKSPACE)
    await service.setProductIconTheme("default", ConfigurationTarget.WORKSPACE)
    await configurationService.updateValue(
      "workbench.colorTheme",
      "Default Light Modern",
      { overrideIdentifiers: ["typescript"] },
      ConfigurationTarget.USER,
    )

    expect(settingsStore.getWorkspaceSettings()).toMatchObject({
      "workbench.colorTheme": "dark",
      "workbench.iconTheme": "minimal",
    })
    expect(settingsStore.getWorkspaceSettings()).not.toHaveProperty("workbench.productIconTheme")
    expect(service.getColorTheme().settingsId).toBe("dark")
    expect(service.getFileIconTheme().settingsId).toBe("minimal")
    expect(service.getProductIconTheme().settingsId).toBe("default")
    expect(service.inspectColorTheme().workspaceValue).toBe("dark")
    expect(service.inspectFileIconTheme().workspaceValue).toBe("minimal")
    expect(service.inspectProductIconTheme().effectiveValue).toBe("Default")
    expect(service.inspectColorTheme({ overrideIdentifier: "typescript" }).user?.override).toBe("Default Light Modern")
  })

  it("keeps theme setters on the resolved service value for object inputs and unknown values", async () => {
    const configurationService = new ConfigurationService(settingsStore)
    const service = new CodekWorkbenchThemeService(configurationService)

    await service.setColorTheme({ id: "cursor-dark", label: "Cursor Dark", settingsId: "Cursor Dark", type: "dark", monacoTheme: "vs-dark" })
    await service.setFileIconTheme({ id: "unknown-icon", label: "Unknown", settingsId: "unknown-icon", hasFileIcons: true, hasFolderIcons: true, hidesExplorerArrows: false })
    await service.setProductIconTheme({ id: "custom-product", label: "Custom", settingsId: "custom-product" })

    expect(service.getColorTheme().settingsId).toBe("dark")
    expect(service.getFileIconTheme().settingsId).toBe("unknown-icon")
    expect(service.getProductIconTheme().settingsId).toBe("default")
    expect(settingsStore.get("workbench.colorTheme")).toBe("dark")
    expect(settingsStore.get("workbench.iconTheme")).toBe("unknown-icon")
    expect(settingsStore.get("workbench.productIconTheme")).toBe("Default")
  })

  it("routes product icon theme resolution through the shared registry and disposable lifecycle", async () => {
    const configurationService = new ConfigurationService(settingsStore)
    const service = new CodekWorkbenchThemeService(configurationService)
    const contribution = { id: "agent-evidence", description: "Agent Evidence", defaults: { fontCharacter: "\\ea80" } }

    expect(resolveProductIcon("agent-evidence").codicon).toBe("codicon-timeline-view-icon")
    expect(service.getProductIconTheme().getIcon(contribution)).toEqual({ fontCharacter: "\\ea80" })

    const disposable = registerProductIcon("agent-evidence", {
      codicon: "codicon-custom-agent-evidence",
      fontCharacter: "\\eb00",
      fallback: "agent-evidence",
      label: "Agent Evidence Custom",
      paths: ["M1 1h22v22H1z"],
    })

    expect(resolveProductIcon("agent-evidence")).toMatchObject({
      codicon: "codicon-custom-agent-evidence",
      fallback: "agent-evidence",
      label: "Agent Evidence Custom",
    })
    expect(service.getProductIconTheme().getIcon(contribution)).toEqual({ fontCharacter: "\\eb00" })

    disposable.dispose()

    expect(resolveProductIcon("agent-evidence").codicon).toBe("codicon-timeline-view-icon")
    expect(service.getProductIconTheme().getIcon(contribution)).toEqual({ fontCharacter: "\\ea80" })
  })

  it("registers IThemeService and IWorkbenchThemeService to the same theme facade", () => {
    const collection = new ServiceCollection(
      [IThemeService, workbenchThemeService],
      [IWorkbenchThemeService, workbenchThemeService],
    )

    expect(collection.get(IThemeService)).toBe(workbenchThemeService)
    expect(collection.get(IWorkbenchThemeService)).toBe(workbenchThemeService)
    expect(workbenchThemeService.getColorTheme().settingsId).toBe(activeTheme.value)
  })
})
