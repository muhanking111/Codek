import { beforeEach, describe, expect, it, vi } from "vitest"
import { mount } from "@vue/test-utils"
import ExtensionDetails from "./ExtensionDetails.vue"
import { EXTENSIONS_WORKBENCH_COMMAND_IDS, extensionWorkbenchService } from "../extensions/extensionsWorkbenchService"
import type { ExtensionDetailsPayload } from "../extensions/ehClient"

vi.mock("../extensions/extensionsWorkbenchService", async () => {
  const actual = await vi.importActual<typeof import("../extensions/extensionsWorkbenchService")>("../extensions/extensionsWorkbenchService")
  return {
    ...actual,
    extensionWorkbenchService: {
      ...actual.extensionWorkbenchService,
      getEditorViewModel: vi.fn(),
      open: vi.fn(),
      rollback: vi.fn(),
    },
  }
})

const samplePayload = (): ExtensionDetailsPayload => ({
  reportKind: "extension-details",
  createdAt: 1710000000000,
  ready: true,
  id: "sample.publisher-extension",
  extension: {
    id: "sample.publisher-extension",
    displayName: "Sample Extension",
    description: "Adds focused evidence views",
    version: "1.2.3",
    publisher: "sample",
    downloads: 42,
    categories: ["Other"],
    source: "open-vsx",
    sourceUrl: "https://open-vsx.org/extension/sample/publisher-extension",
    license: "MIT",
    verified: true,
    engines: { vscode: "^1.90.0" },
    extensionDependencies: ["sample.dependency"],
    extensionPack: [],
    contributes: {
      commands: [{ command: "sample.run", title: "运行示例" }],
      configuration: { properties: { "sample.enabled": { type: "boolean" } } },
      views: { explorer: [{ id: "sample.tree", name: "示例视图" }] },
    },
  },
  installed: {
    id: "sample.publisher-extension",
    version: "1.2.3",
    enabled: true,
    installPath: "D:\\Workspace\\extensions\\sample.publisher-extension",
    builtin: false,
    availability: {
      status: "activated",
      label: "已激活",
      detail: "扩展宿主已加载并激活该扩展。",
      reason: "extension-host",
    },
  },
  readme: {
    id: "sample.publisher-extension",
    available: true,
    length: 48,
    text: "# Sample Extension\n\n**Evidence** and rollback notes.",
  },
  versions: [{ version: "1.2.3", targetPlatforms: ["win32-x64"] }],
  latestVersion: "1.2.3",
  installPlan: {
    reportKind: "extension-install-plan",
    id: "sample.publisher-extension",
    readyToInstall: true,
    requiresConfirmation: true,
    dependencies: ["sample.dependency"],
    extensionPack: [],
    missingDependencies: ["sample.dependency"],
    missingExtensionPack: [],
    operations: [{ kind: "dependency", id: "sample.dependency", status: "pending" }],
    warnings: [{ id: "target-platform", severity: "info", message: "win32-x64 compatible" }],
  },
  compatibility: {
    available: true,
    status: "compatible",
    blockers: [],
    warnings: [{ id: "api", message: "部分 API 走 Codek shim" }],
    unsupportedContributionPoints: [],
    partialContributionPoints: ["views"],
  },
  installState: {
    id: "sample.publisher-extension",
    status: "installed",
    version: "1.2.3",
    updatedAt: 1710000000000,
    installSource: "marketplace",
    lastBackup: "D:/Workspace/backups/sample.publisher-extension",
  },
  audit: [{ extensionId: "sample.publisher-extension", action: "install-plan", status: "ready", createdAt: 1710000000000 }],
})

describe("ExtensionDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(extensionWorkbenchService.getEditorViewModel).mockReturnValue(null as never)
    vi.mocked(extensionWorkbenchService.open).mockResolvedValue(null as never)
    vi.mocked(extensionWorkbenchService.rollback).mockResolvedValue({ success: true })
  })

  it("renders the shared service-backed detail summary and avoids a second install state", async () => {
    vi.mocked(extensionWorkbenchService.getEditorViewModel).mockReturnValue({
      id: "sample.publisher-extension",
      title: "Sample Extension",
      displayName: "Sample Extension",
      description: "Adds focused evidence views",
      publisher: "sample",
      version: "1.2.3",
      source: "open-vsx",
      readmeSummary: "Sample Extension Evidence and rollback notes.",
      installPlanSummary: "安装计划就绪；需要确认；待安装依赖 1 个；警告 1 条",
      compatibilitySummary: "兼容；1 个警告；1 个部分支持贡献点",
      installState: "installed",
      statusLabel: "已激活",
      statusDetail: "扩展宿主已加载并激活该扩展。",
      metadata: [],
      actions: [{ id: "open", label: "打开详情", enabled: true }],
      evidence: { installPlanReady: true, requiresConfirmation: true, warnings: ["win32-x64 compatible"], audit: [] },
      detailSummary: {
        source: "extensionsWorkbenchService",
        serviceId: "extensionsWorkbenchService",
        extensionId: "sample.publisher-extension",
        label: "已激活",
        detail: "扩展宿主已加载并激活该扩展。",
        installState: "installed",
        installPlanReady: true,
        requiresConfirmation: true,
        trustGate: { required: true, detail: "install requires trust", warnings: ["win32-x64 compatible"] },
        availability: { status: "activated", label: "已激活", detail: "扩展宿主已加载并激活该扩展。", reason: "extension-host" },
        usabilityRows: [
          {
            id: "commands",
            label: "命令",
            status: "ready",
            statusLabel: "已接入",
            detail: "扩展声明的命令会进入 Codek 命令面板和扩展工作台动作。",
          },
          {
            id: "configuration",
            label: "配置",
            status: "ready",
            statusLabel: "已接入",
            detail: "配置贡献会进入 Codek 设置和设置 JSON 路径。",
          },
          {
            id: "views",
            label: "Tree/View 视图",
            status: "pending",
            statusLabel: "部分接入",
            detail: "该扩展声明了视图贡献，但当前 Codek 只支持其中一部分视图能力。",
          },
        ],
        rollbackRisk: { available: true, lastBackup: "D:/Workspace/backups/sample.publisher-extension", detail: "可回滚到最近备份：D:/Workspace/backups/sample.publisher-extension" },
        actionIds: ["open", "disable", "uninstall", "rollback"],
        actionCommands: [
          {
            source: "extensionsWorkbenchService",
            serviceId: "extensionsWorkbenchService",
            stateSource: "extensionsWorkbenchService",
            actionId: "open",
            commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Open,
            owner: "extensionsWorkbenchService",
            vscodeOwner: "extensionsActions",
            route: "workbench.commandRegistry",
            enabled: true,
            label: "打开",
            detail: "扩展宿主已加载并激活该扩展。",
            noSecondInstallState: true,
          },
          {
            source: "extensionsWorkbenchService",
            serviceId: "extensionsWorkbenchService",
            stateSource: "extensionsWorkbenchService",
            actionId: "disable",
            commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Disable,
            owner: "extensionsWorkbenchService",
            vscodeOwner: "extensionsActions",
            route: "workbench.commandRegistry",
            enabled: true,
            label: "禁用",
            detail: "通过现有扩展宿主禁用路径执行",
            noSecondInstallState: true,
          },
          {
            source: "extensionsWorkbenchService",
            serviceId: "extensionsWorkbenchService",
            stateSource: "extensionsWorkbenchService",
            actionId: "uninstall",
            commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Uninstall,
            owner: "extensionsWorkbenchService",
            vscodeOwner: "extensionsActions",
            route: "workbench.commandRegistry",
            enabled: true,
            label: "卸载",
            detail: "通过现有扩展宿主卸载路径执行",
            noSecondInstallState: true,
          },
          {
            source: "extensionsWorkbenchService",
            serviceId: "extensionsWorkbenchService",
            stateSource: "extensionsWorkbenchService",
            actionId: "rollback",
            commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Rollback,
            owner: "extensionsWorkbenchService",
            vscodeOwner: "extensionsActions",
            route: "workbench.commandRegistry",
            enabled: true,
            label: "回滚",
            detail: "恢复最近一次安装备份",
            noSecondInstallState: true,
          },
        ],
        manageActionOwner: {
          source: "extensionsWorkbenchService",
          serviceId: "extensionsWorkbenchService",
          stateSource: "extensionsWorkbenchService",
          actionId: "manage",
          commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Manage,
          owner: "extensionsWorkbenchService",
          vscodeOwner: "extensionsActions",
          route: "workbench.commandRegistry",
          enabled: true,
          label: "管理扩展",
          detail: "打开扩展详情，并从统一扩展服务派生管理动作",
          noSecondInstallState: true,
        },
        manageSecondaryActions: [
          {
            source: "extensionsWorkbenchService",
            serviceId: "extensionsWorkbenchService",
            stateSource: "extensionsWorkbenchService",
            actionId: "disable",
            commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Disable,
            owner: "extensionsWorkbenchService",
            vscodeOwner: "extensionsActions",
            route: "workbench.commandRegistry",
            enabled: true,
            label: "禁用",
            detail: "通过现有扩展宿主禁用路径执行",
            noSecondInstallState: true,
          },
          {
            source: "extensionsWorkbenchService",
            serviceId: "extensionsWorkbenchService",
            stateSource: "extensionsWorkbenchService",
            actionId: "uninstall",
            commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Uninstall,
            owner: "extensionsWorkbenchService",
            vscodeOwner: "extensionsActions",
            route: "workbench.commandRegistry",
            enabled: true,
            label: "卸载",
            detail: "通过现有扩展宿主卸载路径执行",
            noSecondInstallState: true,
          },
          {
            source: "extensionsWorkbenchService",
            serviceId: "extensionsWorkbenchService",
            stateSource: "extensionsWorkbenchService",
            actionId: "rollback",
            commandId: EXTENSIONS_WORKBENCH_COMMAND_IDS.Rollback,
            owner: "extensionsWorkbenchService",
            vscodeOwner: "extensionsActions",
            route: "workbench.commandRegistry",
            enabled: true,
            label: "回滚",
            detail: "恢复最近一次安装备份",
            noSecondInstallState: true,
          },
        ],
        noSecondInstallState: true,
        localFirst: true,
        goesThroughEhClient: true,
      },
      payload: samplePayload(),
    } as never)

    const wrapper = mount(ExtensionDetails, {
      props: { extensionId: "sample.publisher-extension" },
    })

    await wrapper.vm.$nextTick()

    expect(wrapper.attributes("data-extension-gallery-detail-state-source")).toBe("service")
    expect(wrapper.attributes("data-extension-gallery-detail-trust-gate-required")).toBe("true")
    expect(wrapper.attributes("data-extension-gallery-action-ids")).toContain("rollback")
    expect(wrapper.attributes("data-extension-gallery-action-command-ids")).toContain(EXTENSIONS_WORKBENCH_COMMAND_IDS.Disable)
    expect(wrapper.attributes("data-extension-gallery-action-owner")).toBe("extensionsWorkbenchService")
    expect(wrapper.attributes("data-extension-gallery-manage-command-id")).toBe(EXTENSIONS_WORKBENCH_COMMAND_IDS.Manage)
    expect(wrapper.attributes("data-extension-gallery-manage-secondary-actions")).toContain(`uninstall:${EXTENSIONS_WORKBENCH_COMMAND_IDS.Uninstall}`)
    expect(wrapper.attributes("data-extension-gallery-usability-statuses")).toContain("commands:已接入")
    expect(wrapper.attributes("data-extension-gallery-usability-statuses")).toContain("views:部分接入")
    expect(wrapper.text()).toContain("需要确认")
    expect(wrapper.text()).toContain("可回滚")
    expect(wrapper.text()).toContain("安装后可用性")
    expect(wrapper.text()).toContain("命令")
    expect(wrapper.text()).toContain("Tree/View 视图")
    expect(wrapper.text()).toContain("已接入")
    expect(wrapper.text()).toContain("来自扩展市场的扩展条目")
    expect(wrapper.text()).toContain("说明文档已读取")
    expect(wrapper.text()).not.toContain("Adds focused evidence views")
    expect(wrapper.text()).not.toContain("Evidence and rollback notes")
  })
})
