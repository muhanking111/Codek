// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\platform\theme\common\themeService.ts
// - D:\SourceMirror\vscode\src\vs\workbench\services\themes\common\workbenchThemeService.ts
// - D:\SourceMirror\vscode\src\vs\workbench\services\themes\common\themeConfiguration.ts
//
// Codek keeps the existing Vue rendering surface, but theme state flows through
// the same ConfigurationService keys that VS Code workbench themes use.

import { Emitter, type Event } from "../../../base/common/event"
import { createDecorator, refineServiceDecorator } from "../../instantiation/common/instantiation"
import { InstantiationType, registerSingleton } from "../../instantiation/common/extensions"
import {
  ConfigurationTarget,
  workbenchConfigurationService,
  type IConfigurationService,
  type SettingsConfigurationInspectValue,
} from "../../../../settings/settingsStore"
import { getWorkbenchSettings } from "../../../../settings/workbenchSettings"
import type { ConfigurationOverrides } from "../../configuration/common/configurationModel"
import { THEMES, getMonacoTheme, getThemeColor, getThemeColors, getThemeTypeSelector, normalizeColorTheme, type ThemeId } from "../../../../themeRegistry"
import {
  resolveProductIconDefinition,
  type ProductIconContribution,
  type ProductIconDefinition,
} from "../../../../workbench/productIcons"

export interface IWorkbenchTheme {
  readonly id: string
  readonly label: string
  readonly settingsId: string | null
}

export interface IColorTheme extends IWorkbenchTheme {
  readonly type: ThemeId
  readonly monacoTheme: string
  readonly typeSelector: "vs" | "vs-dark"
  readonly tokenColorMap: string[]
  getColor(color: string, useDefault?: boolean): string | undefined
  defines(color: string): boolean
}

export interface IFileIconTheme extends IWorkbenchTheme {
  readonly hasFileIcons: boolean
  readonly hasFolderIcons: boolean
  readonly hidesExplorerArrows: boolean
}

export interface IProductIconTheme extends IWorkbenchTheme {
  getIcon(iconContribution: ProductIconContribution): ProductIconDefinition | undefined
}

export type ThemeReference<TTheme extends IWorkbenchTheme = IWorkbenchTheme> = string | (Partial<TTheme> & Pick<IWorkbenchTheme, "settingsId">) | undefined

export interface IThemeService {
  readonly _serviceBrand: undefined
  readonly onDidColorThemeChange: Event<IColorTheme>
  getColorTheme(): IColorTheme
  readonly onDidFileIconThemeChange: Event<IFileIconTheme>
  getFileIconTheme(): IFileIconTheme
  getProductIconTheme(): IProductIconTheme
  readonly onDidProductIconThemeChange: Event<IProductIconTheme>
}

export interface IWorkbenchThemeService extends IThemeService {
  setColorTheme(themeId: ThemeReference<IColorTheme>, settingsTarget?: ConfigurationTarget): Promise<IColorTheme>
  setFileIconTheme(iconThemeId: ThemeReference<IFileIconTheme>, settingsTarget?: ConfigurationTarget): Promise<IFileIconTheme>
  setProductIconTheme(iconThemeId: ThemeReference<IProductIconTheme>, settingsTarget?: ConfigurationTarget): Promise<IProductIconTheme>
  getColorThemes(): Promise<IColorTheme[]>
  getFileIconThemes(): Promise<IFileIconTheme[]>
  getProductIconThemes(): Promise<IProductIconTheme[]>
  inspectColorTheme(overrides?: ConfigurationOverrides): SettingsConfigurationInspectValue<string>
  inspectFileIconTheme(overrides?: ConfigurationOverrides): SettingsConfigurationInspectValue<string>
  inspectProductIconTheme(overrides?: ConfigurationOverrides): SettingsConfigurationInspectValue<string>
}

export const IThemeService = createDecorator<IThemeService>("themeService")
export const IWorkbenchThemeService = refineServiceDecorator<IThemeService, IWorkbenchThemeService>(IThemeService)

const COLOR_THEME_SETTING = "workbench.colorTheme"
const FILE_ICON_THEME_SETTING = "workbench.iconTheme"
const PRODUCT_ICON_THEME_SETTING = "workbench.productIconTheme"

const FILE_ICON_THEME_LABELS: Record<string, string> = {
  "vs-seti": "VS Code Seti",
  minimal: "Minimal",
  monochrome: "Monochrome",
  "codek-default": "VS Code Seti",
}

const PRODUCT_ICON_THEME_LABELS: Record<string, string> = {
  default: "Default Product Icons",
  Default: "Default Product Icons",
  "": "Default Product Icons",
}

export class CodekWorkbenchThemeService implements IWorkbenchThemeService {
  declare readonly _serviceBrand: undefined

  private readonly onDidColorThemeChangeEmitter = new Emitter<IColorTheme>()
  readonly onDidColorThemeChange: Event<IColorTheme> = this.onDidColorThemeChangeEmitter.event

  private readonly onDidFileIconThemeChangeEmitter = new Emitter<IFileIconTheme>()
  readonly onDidFileIconThemeChange: Event<IFileIconTheme> = this.onDidFileIconThemeChangeEmitter.event

  private readonly onDidProductIconThemeChangeEmitter = new Emitter<IProductIconTheme>()
  readonly onDidProductIconThemeChange: Event<IProductIconTheme> = this.onDidProductIconThemeChangeEmitter.event

  private currentColorTheme: IColorTheme
  private currentFileIconTheme: IFileIconTheme
  private currentProductIconTheme: IProductIconTheme

  constructor(private readonly configurationService: IConfigurationService = workbenchConfigurationService) {
    this.currentColorTheme = this.resolveColorTheme(configurationService.getValue(COLOR_THEME_SETTING))
    this.currentFileIconTheme = this.resolveFileIconTheme(configurationService.getValue(FILE_ICON_THEME_SETTING))
    this.currentProductIconTheme = this.resolveProductIconTheme(configurationService.getValue(PRODUCT_ICON_THEME_SETTING))
    this.configurationService.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(COLOR_THEME_SETTING)) {
        const next = this.resolveColorTheme(this.configurationService.getValue(COLOR_THEME_SETTING))
        if (next.settingsId !== this.currentColorTheme.settingsId) {
          this.currentColorTheme = next
          this.onDidColorThemeChangeEmitter.fire(next)
        }
      }
      if (event.affectsConfiguration(FILE_ICON_THEME_SETTING)) {
        const next = this.resolveFileIconTheme(this.configurationService.getValue(FILE_ICON_THEME_SETTING))
        if (next.settingsId !== this.currentFileIconTheme.settingsId) {
          this.currentFileIconTheme = next
          this.onDidFileIconThemeChangeEmitter.fire(next)
        }
      }
      if (event.affectsConfiguration(PRODUCT_ICON_THEME_SETTING)) {
        const next = this.resolveProductIconTheme(this.configurationService.getValue(PRODUCT_ICON_THEME_SETTING))
        if (next.settingsId !== this.currentProductIconTheme.settingsId) {
          this.currentProductIconTheme = next
          this.onDidProductIconThemeChangeEmitter.fire(next)
        }
      }
    })
  }

  getColorTheme(): IColorTheme {
    return this.currentColorTheme
  }

  getFileIconTheme(): IFileIconTheme {
    return this.currentFileIconTheme
  }

  getProductIconTheme(): IProductIconTheme {
    return this.currentProductIconTheme
  }

  async setColorTheme(themeId: ThemeReference<IColorTheme>, settingsTarget = ConfigurationTarget.USER): Promise<IColorTheme> {
    const normalized = this.resolveColorTheme(this.getThemeReferenceSettingsId(themeId))
    await this.configurationService.updateValue(COLOR_THEME_SETTING, normalized.settingsId, { preserveExplicitValue: true }, settingsTarget)
    return this.getColorTheme()
  }

  async setFileIconTheme(iconThemeId: ThemeReference<IFileIconTheme>, settingsTarget = ConfigurationTarget.USER): Promise<IFileIconTheme> {
    const normalized = this.resolveFileIconTheme(this.getThemeReferenceSettingsId(iconThemeId))
    await this.configurationService.updateValue(FILE_ICON_THEME_SETTING, normalized.settingsId, settingsTarget)
    return this.getFileIconTheme()
  }

  async setProductIconTheme(iconThemeId: ThemeReference<IProductIconTheme>, settingsTarget = ConfigurationTarget.USER): Promise<IProductIconTheme> {
    const normalized = this.resolveProductIconTheme(this.getThemeReferenceSettingsId(iconThemeId))
    await this.configurationService.updateValue(PRODUCT_ICON_THEME_SETTING, normalized.settingsId === "default" ? undefined : normalized.settingsId, settingsTarget)
    return this.getProductIconTheme()
  }

  async getColorThemes(): Promise<IColorTheme[]> {
    return THEMES.map((theme) => this.createColorTheme(theme.id))
  }

  async getFileIconThemes(): Promise<IFileIconTheme[]> {
    return ["vs-seti", "minimal", "monochrome"].map((themeId) => this.createFileIconTheme(themeId))
  }

  async getProductIconThemes(): Promise<IProductIconTheme[]> {
    return [this.createProductIconTheme("default")]
  }

  inspectColorTheme(overrides?: ConfigurationOverrides): SettingsConfigurationInspectValue<string> {
    return this.configurationService.inspect<string>(COLOR_THEME_SETTING, overrides)
  }

  inspectFileIconTheme(overrides?: ConfigurationOverrides): SettingsConfigurationInspectValue<string> {
    return this.configurationService.inspect<string>(FILE_ICON_THEME_SETTING, overrides)
  }

  inspectProductIconTheme(overrides?: ConfigurationOverrides): SettingsConfigurationInspectValue<string> {
    return this.configurationService.inspect<string>(PRODUCT_ICON_THEME_SETTING, overrides)
  }

  private resolveColorTheme(value: unknown): IColorTheme {
    return this.createColorTheme(normalizeColorTheme(value) ?? "dark")
  }

  private createColorTheme(themeId: ThemeId): IColorTheme {
    const meta = THEMES.find((theme) => theme.id === themeId)
    return {
      id: themeId,
      type: themeId,
      label: meta?.name ?? themeId,
      settingsId: themeId,
      monacoTheme: getMonacoTheme(themeId),
      typeSelector: getThemeTypeSelector(themeId),
      tokenColorMap: Object.values(getThemeColors(themeId)),
      getColor: (color, useDefault = true) => getThemeColor(themeId, color, useDefault),
      defines: (color) => getThemeColor(themeId, color, false) !== undefined,
    }
  }

  private resolveFileIconTheme(value: unknown): IFileIconTheme {
    return this.createFileIconTheme(getWorkbenchSettings({ [FILE_ICON_THEME_SETTING]: value }).iconTheme)
  }

  private createFileIconTheme(themeId: string): IFileIconTheme {
    return {
      id: themeId,
      label: FILE_ICON_THEME_LABELS[themeId] ?? themeId,
      settingsId: themeId,
      hasFileIcons: themeId !== "minimal",
      hasFolderIcons: themeId !== "minimal",
      hidesExplorerArrows: false,
    }
  }

  private resolveProductIconTheme(value: unknown): IProductIconTheme {
    return this.createProductIconTheme(this.normalizeProductIconThemeId(value))
  }

  private normalizeProductIconThemeId(value: unknown): string {
    const raw = typeof value === "string" ? value.trim() : ""
    if (raw.toLowerCase() === "default") return "default"
    return raw && PRODUCT_ICON_THEME_LABELS[raw] ? raw : "default"
  }

  private createProductIconTheme(themeId: string): IProductIconTheme {
    return {
      id: themeId,
      label: PRODUCT_ICON_THEME_LABELS[themeId] ?? themeId,
      settingsId: themeId,
      getIcon: (iconContribution) => resolveProductIconDefinition(iconContribution),
    }
  }

  private getThemeReferenceSettingsId(theme: ThemeReference): string | null | undefined {
    return typeof theme === "object" ? theme.settingsId : theme
  }
}

export const workbenchThemeService = new CodekWorkbenchThemeService(workbenchConfigurationService)
registerSingleton(IThemeService, workbenchThemeService, InstantiationType.Delayed)
registerSingleton(IWorkbenchThemeService, workbenchThemeService, InstantiationType.Delayed)
