import { getKeybindingContext, registerKeybinding, unregisterKeybinding } from "../keybindings"
import { api } from "../lib/api"
import { registerLanguageSet, type Disposable, type LanguageContribution } from "../languages/languageRegistry"
import { executeCommand, getCommand, registerCommand } from "../workbench/commandRegistry"
import { registerView, registerViewContainer, type ViewLocation } from "../workbench/viewRegistry"
import { MenuId, MenuRegistry, type VscodeCommandAction } from "../vscode-adapter/platform/actions/common/menuRegistry"
import { installExtensionHostRuntimeBridge } from "./extensionHostRuntimeBridge"
import { registerExtensionWorkbenchContributions, type ExtensionsWorkbenchService } from "./extensionsWorkbenchService"

interface ApiClient {
  get<T = unknown>(path: string): Promise<T>
  post<T = unknown>(path: string, body?: unknown): Promise<T>
}

interface CommandPaletteLike {
  registerCommands?: (commands: Array<{
    id: string
    label: string
    category: string
    action?: () => void
  }>) => void
}

interface ExtensionCommandContribution {
  id: string
  title: string
  category?: string
  enablement?: string
}

interface ExtensionViewContainerContribution {
  id: string
  name: string
  location?: ViewLocation
  icon?: string
}

interface ExtensionViewContribution {
  id: string
  name: string
  containerId: string
  location?: ViewLocation
  when?: string
  icon?: string
}

interface ExtensionKeybindingContribution {
  command: string
  key: string
  when?: string
}

interface ExtensionMenuContribution {
  location: string
  command: string
  alt?: string
  when?: string
  group?: string
  order?: number
  extensionId?: string
}

interface ExtensionLanguageContribution extends LanguageContribution {}

interface WorkbenchContributionsResponse {
  commands?: ExtensionCommandContribution[]
  viewsContainers?: ExtensionViewContainerContribution[]
  views?: ExtensionViewContribution[]
  menus?: ExtensionMenuContribution[]
  keybindings?: ExtensionKeybindingContribution[]
  languages?: ExtensionLanguageContribution[]
  summary?: {
    extensions?: number
    commands?: number
    viewsContainers?: number
    views?: number
    menus?: number
    keybindings?: number
    languages?: number
  }
}

export interface LoadExtensionWorkbenchContributionsOptions {
  apiClient?: ApiClient
  commandPalette?: CommandPaletteLike | null
  extensionsWorkbenchService?: ExtensionsWorkbenchService
}

export interface LoadExtensionWorkbenchContributionsResult {
  ok: boolean
  summary: Required<NonNullable<WorkbenchContributionsResponse["summary"]>>
  error?: string
}

const EMPTY_SUMMARY = {
  extensions: 0,
  commands: 0,
  viewsContainers: 0,
  views: 0,
  menus: 0,
  keybindings: 0,
  languages: 0,
}

let activeContributionSession: Disposable | null = null

export async function loadExtensionWorkbenchContributions(
  options: LoadExtensionWorkbenchContributionsOptions = {},
): Promise<LoadExtensionWorkbenchContributionsResult> {
  const client = options.apiClient ?? api
  installExtensionHostRuntimeBridge()
  if (typeof window !== "undefined" && window.codek) {
    window.__codekSmokeExtensionHostRuntimeBridgeReady = true
  }

  try {
    registerExtensionWorkbenchContributions(options.extensionsWorkbenchService)
    const response = await client.get<WorkbenchContributionsResponse>("/extensions-host/workbench-contributions")
    const commands = Array.isArray(response?.commands) ? response.commands : []
    const viewContainers = Array.isArray(response?.viewsContainers) ? response.viewsContainers : []
    const views = Array.isArray(response?.views) ? response.views : []
    const menus = Array.isArray(response?.menus) ? response.menus : []
    const keybindings = Array.isArray(response?.keybindings) ? response.keybindings : []
    const languages = Array.isArray(response?.languages) ? response.languages : []
    const sessionDisposables: Disposable[] = []

    activeContributionSession?.dispose()
    activeContributionSession = createDisposableSession(sessionDisposables)

    const languageSession = registerLanguageSet(languages.map((language) => ({
      ...language,
      source: "extension",
    })))
    sessionDisposables.push(languageSession)
    const registeredLanguages = languages.filter((language) => typeof language?.id === "string" && language.id.trim()).length

    for (const container of viewContainers) {
      if (!container.id) continue
      sessionDisposables.push(registerViewContainer({
        id: container.id,
        name: container.name || container.id,
        location: container.location || "activityBar",
        source: "extension",
        icon: container.icon,
      }))
    }

    for (const view of views) {
      if (!view.id || !view.containerId) continue
      sessionDisposables.push(registerView({
        id: view.id,
        name: view.name || view.id,
        containerId: view.containerId,
        location: view.location || "sideBar",
        source: "extension",
        when: view.when,
        icon: view.icon,
      }))
    }

    const commandActions = new Map<string, VscodeCommandAction>()
    for (const command of commands) {
      if (!command.id) continue
      const title = command.title || command.id
      const category = command.category || "Extensions"
      const action: VscodeCommandAction = {
        id: command.id,
        title,
        category,
        precondition: command.enablement,
        metadata: { description: title },
      }
      commandActions.set(command.id, action)
      sessionDisposables.push(MenuRegistry.addCommand(action))
      sessionDisposables.push(registerCommand({
        id: command.id,
        title,
        category,
        source: "extension",
        precondition: command.enablement,
        handler: async (...args: unknown[]) => {
          const result = await client.post("/extensions-host/commands/execute", {
            commandId: command.id,
            args,
          })
            ensureCommandSucceeded(result)
        },
      }))
    }

    for (const menu of menus) {
      if (!menu.command) continue
      const menuId = toMenuId(menu.location)
      if (!menuId) continue
      const command = commandActions.get(menu.command) || createFallbackCommandAction(menu.command)
      const alt = menu.alt ? commandActions.get(menu.alt) || createFallbackCommandAction(menu.alt) : undefined
      sessionDisposables.push(MenuRegistry.appendMenuItem(menuId, {
        command,
        alt,
        when: menu.when,
        group: menu.group,
        order: menu.order,
      }))
    }

    for (const keybinding of keybindings) {
      const sequence = parseKeybindingSequence(keybinding.key)
      if (!keybinding.command || sequence.length === 0) continue
      if (!getCommand(keybinding.command)) {
        sessionDisposables.push(registerCommand({
          id: keybinding.command,
          title: keybinding.command,
          category: "Extensions",
          source: "extension",
          handler: async (...args: unknown[]) => {
            const result = await client.post("/extensions-host/commands/execute", {
              commandId: keybinding.command,
              args,
            })
            ensureCommandSucceeded(result)
          },
        }))
        const action = createFallbackCommandAction(keybinding.command)
        commandActions.set(keybinding.command, action)
        sessionDisposables.push(MenuRegistry.addCommand(action))
      }
      const primary = sequence[sequence.length - 1]
      const bindingId = keybinding.command
      registerKeybinding({
        id: bindingId,
        commandId: keybinding.command,
        key: primary.key,
        ctrl: primary.ctrl,
        shift: primary.shift,
        alt: primary.alt,
        ...(sequence.length > 1 ? { sequence } : {}),
        description: keybinding.command,
        when: keybinding.when,
        action: async () => {
          await executeCommand(keybinding.command, [], getKeybindingContext())
        },
      })
      sessionDisposables.push({ dispose: () => unregisterKeybinding(bindingId) })
    }

    return {
      ok: true,
      summary: {
        extensions: Number(response?.summary?.extensions ?? 0),
        commands: commands.length,
        viewsContainers: viewContainers.length,
        views: views.length,
        menus: menus.length,
        keybindings: keybindings.length,
        languages: registeredLanguages,
      },
    }
  } catch (error) {
    return {
      ok: false,
      summary: EMPTY_SUMMARY,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function createDisposableSession(disposables: Disposable[]): Disposable {
  return {
    dispose() {
      for (const disposable of disposables.splice(0).reverse()) disposable.dispose()
    },
  }
}

function createFallbackCommandAction(commandId: string): VscodeCommandAction {
  return {
    id: commandId,
    title: commandId,
    category: "Extensions",
    metadata: { description: commandId },
  }
}

function toMenuId(location: string): MenuId | null {
  const normalized = String(location || "").toLowerCase()
  const known: Record<string, MenuId> = {
    commandpalette: MenuId.CommandPalette,
    "explorer/context": MenuId.ExplorerContext,
    "editor/context": MenuId.EditorContext,
    "editor/title": MenuId.EditorTitle,
    "editor/title/context": MenuId.EditorTitleContext,
    "view/title": MenuId.ViewTitle,
    "scm/title": MenuId.SCMTitle,
    "scm/resource/context": MenuId.SCMResourceContext,
    "testing/item/context": MenuId.TestItem,
    "menubar/file": MenuId.MenubarFileMenu,
    "menubar/edit": MenuId.MenubarEditMenu,
    "menubar/selection": MenuId.MenubarSelectionMenu,
    "menubar/view": MenuId.MenubarViewMenu,
    "menubar/go": MenuId.MenubarGoMenu,
    "menubar/help": MenuId.MenubarHelpMenu,
  }
  return known[normalized] ?? MenuId.for(location)
}

function ensureCommandSucceeded(result: unknown): void {
  if (!result || typeof result !== "object" || !("success" in result)) return
  const response = result as { success?: boolean; message?: string; error?: string }
  if (response.success === false) {
    throw new Error(response.message || response.error || "扩展命令执行失败")
  }
}

function parseKeybindingSequence(input: string): Array<{ key: string; ctrl: boolean; shift: boolean; alt: boolean }> {
  return String(input || "")
    .split(/\s+/)
    .map(parseKeybindingStroke)
    .filter((stroke): stroke is { key: string; ctrl: boolean; shift: boolean; alt: boolean } => Boolean(stroke))
}

function parseKeybindingStroke(input: string): { key: string; ctrl: boolean; shift: boolean; alt: boolean } | null {
  const parts = String(input || "")
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
  if (parts.length === 0) return null

  const key = parts[parts.length - 1]
  return {
    key,
    ctrl: parts.includes("ctrl") || parts.includes("cmd") || parts.includes("meta") || parts.includes("ctrlcmd"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt") || parts.includes("option"),
  }
}
