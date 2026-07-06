import type { CodekExtensionAPI } from "./api"

interface ExtensionManifest {
  name: string
  displayName?: string
  version: string
  description?: string
  main?: string
}

interface ExtensionInfo {
  id: string
  name: string
  version: string
  description: string
  dirPath: string
  manifest: ExtensionManifest
  enabled: boolean
}

type ExtensionEventHandler = (extension: ExtensionInfo, err?: Error) => void

let extensionsCache: ExtensionInfo[] | null = null

export class ExtensionManager {
  extensions: ExtensionInfo[]
  activated: Map<string, CodekExtensionAPI>
  events: {
    onActivate: ExtensionEventHandler
    onDeactivate: ExtensionEventHandler
    onError: (extension: ExtensionInfo, err: Error) => void
  }

  constructor(options: {
    onActivate?: ExtensionEventHandler
    onDeactivate?: ExtensionEventHandler
    onError?: (extension: ExtensionInfo, err: Error) => void
  } = {}) {
    this.extensions = []
    this.activated = new Map()
    this.events = {
      onActivate: options.onActivate || (() => {}),
      onDeactivate: options.onDeactivate || (() => {}),
      onError: options.onError || (() => {}),
    }
  }

  async scanExtensions(userDataDir: string): Promise<ExtensionInfo[]> {
    if (extensionsCache) return extensionsCache

    const extensions: ExtensionInfo[] = []
    const extDir = `${userDataDir}/.codek/extensions`

    const dirs = await this._listDirs(extDir)
    if (!dirs) return []

    for (const name of dirs) {
      const dirPath = `${extDir}/${name}`
      const manifest = await this._readManifest(dirPath)
      if (manifest) {
        extensions.push({
          id: manifest.name || name,
          name: manifest.displayName || manifest.name || name,
          version: manifest.version || "0.0.0",
          description: manifest.description || "",
          dirPath,
          manifest,
          enabled: true,
        })
      }
    }

    extensionsCache = extensions
    return extensions
  }

  async activate(extension: ExtensionInfo, apiProvider: (ext: ExtensionInfo) => Promise<CodekExtensionAPI>): Promise<void> {
    if (this.activated.has(extension.id)) return

    try {
      const mainPath = `${extension.dirPath}/${extension.manifest.main || "extension.js"}`
      const exists = await this._fileExists(mainPath)
      if (!exists) throw new Error(`Entry point not found: ${mainPath}`)

      const code = await this._readFile(mainPath)
      const api = await apiProvider(extension)

      // Extensions execute in the renderer JS realm — there is no true isolation
      // without spawning a separate BrowserView. As a defense-in-depth measure we
      // shadow the privileged globals (window.codek, fetch, XMLHttpRequest, eval,
      // document, parent, top, opener) so a naïve `window.codek.runCommand("rm ...")`
      // cannot smuggle past the declared `api` surface. A determined attacker can
      // still escape via prototype walks; we treat extensions as low-trust and
      // recommend reviewing them before install.
      const blocked = Object.freeze({})
      const sandboxedSource = `
        "use strict";
        var window = undefined, globalThis = undefined, self = undefined;
        var codek = undefined, fetch = undefined, XMLHttpRequest = undefined;
        var document = undefined, parent = undefined, top = undefined, opener = undefined;
        var eval = undefined, Function = undefined;
        var __blocked = arguments[2];
        void __blocked;
        ${code};
        if (typeof activate !== "undefined") return activate;
        if (typeof module !== "undefined" && typeof module.exports === "function") return module.exports;
        return function() {};
      `
      const activateFn = new (globalThis as { Function: FunctionConstructor }).Function("api", "require", "__blocked", sandboxedSource)

      const fn = activateFn(Object.freeze({ ...api }), null, blocked)
      if (typeof fn === "function") {
        await fn(api)
      }

      this.activated.set(extension.id, api)
      this.events.onActivate(extension)
    } catch (err) {
      this.events.onError(extension, err as Error)
      throw err
    }
  }

  async deactivate(extension: ExtensionInfo): Promise<void> {
    const api = this.activated.get(extension.id)
    if (api && typeof api.dispose === "function") {
      try { api.dispose() } catch { /* ignore */ }
    }
    this.activated.delete(extension.id)
    this.events.onDeactivate(extension)
  }

  isActivated(id: string): boolean {
    return this.activated.has(id)
  }

  invalidateCache(): void {
    extensionsCache = null
  }

  private async _readManifest(dirPath: string): Promise<ExtensionManifest | null> {
    try {
      const content = await this._readFile(`${dirPath}/manifest.json`)
      return JSON.parse(content)
    } catch {
      return null
    }
  }

  private async _readFile(filePath: string): Promise<string> {
    if (typeof window !== "undefined" && window.codek?.readFile) {
      return window.codek.readFile(filePath)
    }
    if (typeof fetch !== "undefined") {
      const res = await fetch(`codek://fs/read?path=${encodeURIComponent(filePath)}`)
      if (!res.ok) throw new Error(`Cannot read: ${filePath}`)
      return res.text()
    }
    throw new Error("No file reader available")
  }

  private async _fileExists(filePath: string): Promise<boolean> {
    if (typeof window !== "undefined" && window.codek?.statFile) {
      const stat = await window.codek.statFile(filePath)
      return stat?.exists === true
    }
    return true
  }

  private async _listDirs(dirPath: string): Promise<string[]> {
    if (typeof window !== "undefined" && window.codek?.listDir) {
      const entries = await window.codek.listDir(dirPath)
      return entries?.filter((e: { isDirectory: boolean }) => e.isDirectory).map((e: { name: string }) => e.name) || []
    }
    return []
  }
}

export const extensionManager = new ExtensionManager()
