import { beforeEach, describe, expect, it, vi } from "vitest"
import { getOutputChannel } from "../utils/outputChannel"
import { LogLevel } from "../vscode-adapter/platform/log/common/log"
import {
  CodekOutputLogTelemetryService,
  createOutputLogTelemetryService,
  globalOutputLogTelemetryService,
} from "./outputLogTelemetryService"
import { settingsStore } from "../settings/settingsStore"

describe("outputLogTelemetryService", () => {
  beforeEach(() => {
    vi.setSystemTime(1000)
    settingsStore.reset()
    globalOutputLogTelemetryService.reset()
  })

  it("manages output channel lifecycle through create append clear and show", () => {
    const service = createOutputLogTelemetryService({ now: () => 1000, idFactory: () => "entry-1" })

    const channel = service.createOutputChannel(" Tasks ", { source: "taskRunner", user: true })
    channel.appendLine("first")
    channel.warn("careful")
    service.showChannel("Tasks", false)

    expect(service.getActiveChannelName()).toBe("Tasks")
    expect(service.getVisibleChannelName()).toBe("Tasks")
    expect(service.getChannelDescriptor("Tasks")).toEqual(expect.objectContaining({
      id: "Tasks",
      label: "Tasks",
      entryCount: 2,
      stateSource: "outputLogTelemetryService",
      user: true,
      log: false,
      sources: expect.arrayContaining(["taskRunner"]),
      lifecycle: "registered",
    }))
    expect(service.getOutputSnapshot("Tasks")).toEqual(expect.objectContaining({
      channelName: "Tasks",
      activeChannelName: "Tasks",
      visibleChannelName: "Tasks",
      isVisible: true,
      entryCount: 2,
      warnCount: 1,
      errorCount: 0,
      updateMode: "append",
      preview: "first\ncareful",
      ownerEvidence: expect.objectContaining({
        owner: "outputLogTelemetryService",
        rendererOwner: "OutputPanel",
        mainThreadOwner: "MainThreadOutputService",
        stateSource: "outputLogTelemetryService",
        outputServiceId: "outputService",
        evidenceState: "partial",
        uiOwnerState: "partial",
        remainingGap: expect.stringContaining("App.vue"),
        nextAuthorizedFiles: expect.not.arrayContaining([
          "frontend/vite-project/src/App.vue",
        ]),
        vscodeSourceReferences: expect.arrayContaining([
          "src/vs/workbench/services/output/common/output.ts",
          "src/vs/workbench/services/output/common/delayedLogChannel.ts",
        ]),
      }),
    }))

    service.clearChannel("Tasks")

    expect(service.getOutputSnapshot("Tasks").entryCount).toBe(0)
    expect(service.getOutputSnapshot("Tasks").updateMode).toBe("clear")
    expect(channel.getEntries()).toEqual([])
  })

  it("supports VS Code-style replace hide dispose and renderer-facing visibility projection", () => {
    const service = createOutputLogTelemetryService({ now: () => 3000, idFactory: () => "entry-2" })
    const channel = service.createOutputChannel("Runner", { source: "task", log: true })

    channel.append("old")
    channel.replace("new")
    channel.show(false)

    expect(channel.getLogEntries()).toEqual([
      expect.objectContaining({ logLevel: LogLevel.Info, timestamp: 3000 }),
    ])
    expect(service.getOutputSnapshot("Runner")).toEqual(expect.objectContaining({
      channelName: "Runner",
      visibleChannelName: "Runner",
      isVisible: true,
      entryCount: 1,
      preview: "new",
      updateMode: "replace",
    }))

    service.hideChannel("Runner")
    expect(service.getOutputSnapshot("Runner")).toEqual(expect.objectContaining({
      visibleChannelName: "",
      isVisible: false,
    }))

    channel.dispose()
    expect(service.getChannelDescriptor("Runner")).toEqual(expect.objectContaining({
      lifecycle: "disposed",
      entryCount: 0,
    }))
    expect(service.getChannel("Runner")).toBeUndefined()
  })

  it("projects log source and level without writing below the configured threshold", () => {
    const service = createOutputLogTelemetryService()
    const logger = service.createLogger("ext-host", {
      source: "extensionHost",
      logLevel: LogLevel.Warning,
      hidden: true,
      rotating: { resource: "log:///ext-host.log", maxEntries: 20, rotatedEntries: 2 },
    })

    logger.info("hidden")
    logger.warn("visible warning", { requestId: "safe" })
    logger.error(new Error("visible error"))

    expect(service.getChannelDescriptor("ext-host")).toEqual(expect.objectContaining({
      log: true,
      hidden: true,
      visible: false,
      logLevel: "warn",
      rotating: expect.objectContaining({
        resource: "log:///ext-host.log",
        maxEntries: 20,
        rotatedEntries: 2,
      }),
    }))
    const entries = service.getOutputChannel("ext-host").getEntries()
    expect(entries.map((entry) => [entry.level, entry.source, entry.message])).toEqual([
      ["warn", "extensionHost", "visible warning {\"requestId\":\"safe\"}"],
      ["error", "extensionHost", "visible error"],
    ])
    expect(service.getLogProjection()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        channelName: "ext-host",
        source: "extensionHost",
        level: "warn",
        message: "visible warning {\"requestId\":\"safe\"}",
      }),
      expect.objectContaining({
        channelName: "ext-host",
        source: "extensionHost",
        level: "error",
        message: "visible error",
      }),
    ]))

    service.setChannelVisibility("ext-host", true)
    expect(service.getChannelDescriptor("ext-host")).toEqual(expect.objectContaining({
      hidden: false,
      visible: true,
    }))
  })

  it("records evidence-safe output and log action projections without raw payload values", () => {
    const service = createOutputLogTelemetryService({ now: () => 4000, idFactory: () => "entry-3", maxActionEvents: 8 })
    const channel = service.createOutputChannel("Evidence", { source: "agent", user: true })

    channel.append("secret-token-value")
    channel.replace("replacement")
    channel.show(false)
    service.hideChannel("Evidence")
    service.clearChannel("Evidence")

    expect(service.getActionProjection()).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "append", channelName: "Evidence", messageLength: 18, messagePreview: "secret-token-value" }),
      expect.objectContaining({ action: "replace", channelName: "Evidence", messageLength: 11, messagePreview: "replacement" }),
      expect.objectContaining({ action: "show", channelName: "Evidence", preserveFocus: false }),
      expect.objectContaining({ action: "hide", channelName: "Evidence" }),
    ]))
    expect(service.getEvidenceActionProjection()).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "append", channelName: "Evidence", messageLength: 18, messagePreview: "[REDACTED]" }),
      expect.objectContaining({ action: "replace", channelName: "Evidence", messageLength: 11, messagePreview: "[REDACTED]" }),
      expect.objectContaining({ action: "show", channelName: "Evidence", preserveFocus: false }),
      expect.objectContaining({ action: "hide", channelName: "Evidence" }),
    ]))
    expect(JSON.stringify(service.getEvidenceActionProjection())).not.toContain("secret-token-value")
    expect(JSON.stringify(service.getEvidenceActionProjection())).not.toContain("replacement")
  })

  it("projects owner evidence without leaking long output or marking UI owner connected", () => {
    const service = createOutputLogTelemetryService({ now: () => 4100, idFactory: () => "entry-4" })
    const longSecret = `sk-secret-${"x".repeat(300)}`
    service.appendLine("Evidence", longSecret)
    service.showChannel("Evidence", false)

    const evidence = service.getOwnerEvidence("Evidence")

    expect(evidence).toEqual(expect.objectContaining({
      owner: "outputLogTelemetryService",
      rendererOwner: "OutputPanel",
      mainThreadOwner: "MainThreadOutputService",
      stateSource: "outputLogTelemetryService",
      outputServiceId: "outputService",
      logChannelOwner: "outputLogTelemetryService.createLogger",
      channelName: "Evidence",
      channelCount: 1,
      evidenceState: "partial",
      uiOwnerState: "partial",
      remainingGap: expect.stringContaining("App.vue"),
      nextAuthorizedFiles: expect.arrayContaining([
        "frontend/vite-project/src/components/OutputPanel.vue",
        "frontend/vite-project/src/workbench/outputLogTelemetryService.ts",
      ]),
    }))
    expect(JSON.stringify(evidence)).not.toContain(longSecret)
    expect(JSON.stringify(evidence)).not.toContain("connected")
  })

  it("stores classified telemetry only as local redacted evidence and never exposes raw secrets", () => {
    const service = createOutputLogTelemetryService({ now: () => 2000 })
    settingsStore.set("telemetry.telemetryLevel", "error")

    expect(service.recordTelemetryEvent("all", "usage.skipped")).toBe(false)
    expect(service.recordTelemetryEvent("crash", "renderer.crashed", {
      reason: "oom",
      dumpPath: "C:/Users/alice/AppData/Local/Temp/codek.dmp",
    })).toBe(true)
    expect(service.recordTelemetryEvent("error", "agent.failed", {
      token: "sk-secret",
      path: "C:/Users/alice/project/file.ts",
      nested: {
        Authorization: "Bearer abc",
        message: "safe",
      },
    })).toBe(true)

    const evidence = service.getTelemetryEvidence()
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "crash",
        name: "renderer.crashed",
        timestamp: 2000,
        transport: "localEvidenceOnly",
        classification: "SystemMetaData",
        payload: {
          reason: "oom",
          dumpPath: "[USER_PATH]/AppData/Local/Temp/codek.dmp",
        },
      }),
      expect.objectContaining({
        type: "error",
        name: "agent.failed",
        timestamp: 2000,
        transport: "localEvidenceOnly",
        classification: "SystemMetaData",
        payload: {
          token: "[REDACTED]",
          path: "[USER_PATH]/project/file.ts",
          nested: {
            Authorization: "[REDACTED]",
            message: "safe",
          },
        },
      }),
    ])
    expect(JSON.stringify(evidence)).not.toContain("sk-secret")
    expect(JSON.stringify(evidence)).not.toContain("Bearer abc")
    expect(JSON.stringify(evidence)).not.toContain("alice")
  })

  it("records crash reporter metadata without raw dumps, stacks, or workspace paths", () => {
    const service = createOutputLogTelemetryService({ now: () => 5000 })
    settingsStore.set("telemetry.telemetryLevel", "crash")

    expect(service.recordCrashReport({
      processType: "renderer",
      reason: "crashed",
      exitCode: 133,
      dumpPath: "C:/Users/alice/AppData/Local/Temp/codek/crash.dmp",
      workspacePath: "D:/Workspace/packages/app",
      stack: "Error: token sk-secret\n at file:///D:/Workspace/src/main.ts:1:1",
      metadata: {
        sessionId: "session-1",
        Authorization: "Bearer abc",
      },
    })).toBe(true)

    expect(service.getCrashReports()).toEqual([
      {
        type: "crash",
        name: "crash.renderer",
        timestamp: 5000,
        transport: "localEvidenceOnly",
        classification: "SystemMetaData",
        redaction: {
          secrets: true,
          userPaths: true,
          dumps: true,
          stacks: true,
        },
        metadata: {
          processType: "renderer",
          reason: "crashed",
          exitCode: 133,
          dumpAvailable: true,
          dumpPath: "[REDACTED_DUMP_PATH]",
          workspace: "[WORKSPACE_PATH_REDACTED]",
          sessionId: "session-1",
          Authorization: "[REDACTED]",
        },
      },
    ])
    expect(JSON.stringify(service.getCrashReports())).not.toContain("sk-secret")
    expect(JSON.stringify(service.getCrashReports())).not.toContain("D:/Workspace/packages/app")
    expect(JSON.stringify(service.getCrashReports())).not.toContain("crash.dmp")
  })

  it("keeps old outputChannel entry points as proxies to the unified service", () => {
    const oldChannel = getOutputChannel("Legacy")
    oldChannel.appendLine("from old path")
    globalOutputLogTelemetryService.showChannel("Legacy")

    expect(oldChannel.getEntries()).toEqual([
      expect.objectContaining({
        channelName: "Legacy",
        level: "info",
        message: "from old path\n",
      }),
    ])
    expect(globalOutputLogTelemetryService.getOutputSnapshot("Legacy")).toEqual(expect.objectContaining({
      stateSource: "outputLogTelemetryService",
      entryCount: 1,
      preview: "from old path\n",
    }))
  })

  it("can reset focused service state between tests", () => {
    const service = new CodekOutputLogTelemetryService()
    service.appendLine("Workbench", "kept")

    service.reset()

    expect(service.getChannelDescriptors()).toEqual([])
    expect(service.getTelemetryEvidence()).toEqual([])
    expect(service.getActiveChannelName()).toBe("Workbench")
  })
})
