import { describe, expect, it, vi } from "vitest"
import { localize, localize2 } from "../nls"
import { URI } from "../base/common/uri"
import { createCodekEnvironmentService, defaultCodekEnvironmentHome, IEnvironmentService } from "./environment/common/environment"
import {
  CodekLoggerService,
  ConsoleLogger,
  createLoggerFromOldEntryProxy,
  getLogLevel,
  LogLevel,
  LogLevelToString,
  NullLogService,
  parseLogLevel,
} from "./log/common/log"
import { createCodekProductService, defaultCodekProductService, IProductService, productSchemaId } from "./product/common/productService"
import { ServiceCollection } from "./instantiation/common/serviceCollection"
import { SyncDescriptor } from "./instantiation/common/descriptors"
import { InstantiationService } from "./instantiation/common/instantiationService"
import { createDecorator } from "./instantiation/common/instantiation"

describe("VS Code platform shim foundation", () => {
  it("formats NLS messages and preserves localize2 original/value semantics", () => {
    expect(localize("hello", "Hello {0}", "Codek")).toBe("Hello Codek")
    expect(localize({ key: "count", comment: ["count files"] }, "{0} files", 3)).toBe("3 files")
    expect(localize2("save", "Save {0}", "file")).toEqual({ value: "Save file", original: "Save file" })
  })

  it("supports built NLS descriptor lookup with formatted original fallback", () => {
    globalThis._VSCODE_NLS_MESSAGES = ["已保存 {0}"]

    expect(localize(0, "Saved {0}", "file.ts")).toBe("已保存 file.ts")
    expect(localize2(0, "Saved {0}", "file.ts")).toEqual({ value: "已保存 file.ts", original: "Saved file.ts" })
    expect(localize(1, "Fallback {0}", "message")).toBe("Fallback message")
    expect(() => localize(2, null)).toThrow("!!! NLS MISSING: 2 !!!")

    globalThis._VSCODE_NLS_MESSAGES = undefined
  })

  it("exposes product and environment service identifiers with Codek defaults", () => {
    const collection = new ServiceCollection([IProductService, defaultCodekProductService])
    const environment = createCodekEnvironmentService({ verbose: true })
    collection.set(IEnvironmentService, environment)

    expect(String(IProductService)).toBe("productService")
    expect(String(IEnvironmentService)).toBe("environmentService")
    expect(collection.get(IProductService)).toMatchObject({
      nameShort: "Codek",
      applicationName: "codek",
      dataFolderName: ".codek",
      urlProtocol: "codek",
    })
    expect(collection.get(IEnvironmentService)).toMatchObject({
      disableTelemetry: true,
      isBuilt: false,
      logsHome: environment.logsHome,
      stateResource: URI.joinPath(defaultCodekEnvironmentHome, "state.json"),
    })
    expect(productSchemaId).toBe("vscode://schemas/vscode-product")
  })

  it("keeps product and environment factories locally overridable without changing service identity", () => {
    const product = createCodekProductService({ version: "1.2.3", commit: "abc123" })
    const environment = createCodekEnvironmentService(
      { logLevel: "warning" },
      { codekHome: "C:\\Users\\Codek\\.codek-test", isBuilt: true, disableTelemetry: false },
    )

    expect(String(IProductService)).toBe("productService")
    expect(String(IEnvironmentService)).toBe("environmentService")
    expect(product).toMatchObject({ applicationName: "codek", version: "1.2.3", commit: "abc123" })
    expect(environment).toMatchObject({ isBuilt: true, disableTelemetry: false, logLevel: "warning" })
    expect(environment.logsHome.fsPath).toContain(".codek-test")
    expect(environment.agentSessionsWorkspace?.fsPath).toContain("agentSessions")
  })

  it("supports VS Code log level parsing, events, and console logger filtering", () => {
    const service = new NullLogService()
    const listener = vi.fn()
    service.onDidChangeLogLevel(listener)

    service.setLevel(LogLevel.Trace)
    expect(listener).toHaveBeenCalledWith(LogLevel.Trace)
    expect(parseLogLevel("warn")).toBe(LogLevel.Warning)
    expect(LogLevelToString(LogLevel.Error)).toBe("error")
    expect(getLogLevel({ verbose: false, logLevel: "debug" })).toBe(LogLevel.Debug)

    const sink = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new ConsoleLogger(LogLevel.Warning, sink)
    logger.info("ignored")
    logger.warn("kept")

    expect(sink.info).not.toHaveBeenCalled()
    expect(sink.warn).toHaveBeenCalledWith("kept")
  })

  it("supports logger service events, per-resource levels, visibility, and old entry proxy", () => {
    const sink = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const service = new CodekLoggerService(LogLevel.Info, URI.file("D:\\Workspace\\.codek\\logs"), sink)
    const loggersListener = vi.fn()
    const levelListener = vi.fn()
    const visibilityListener = vi.fn()
    service.onDidChangeLoggers(loggersListener)
    service.onDidChangeLogLevel(levelListener)
    service.onDidChangeVisibility(visibilityListener)

    const logger = createLoggerFromOldEntryProxy(service, "legacy/output:channel", "Legacy Output", LogLevel.Warning)
    logger.info("ignored")
    logger.error("kept")

    const registered = Array.from(service.getRegisteredLoggers())
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({ id: "legacy/output:channel", name: "Legacy Output", logLevel: LogLevel.Warning })
    expect(registered[0].resource.fsPath).toContain("legacyoutputchannel.log")
    expect(loggersListener).toHaveBeenCalledWith({ added: [registered[0]], removed: [] })
    expect(sink.info).not.toHaveBeenCalled()
    expect(sink.error).toHaveBeenCalledWith("kept")

    service.setLogLevel(registered[0].resource, LogLevel.Debug)
    expect(levelListener).toHaveBeenCalledWith([registered[0].resource, LogLevel.Debug])
    expect(service.getLogLevel(registered[0].resource)).toBe(LogLevel.Debug)

    service.setVisibility("legacy/output:channel", false)
    expect(visibilityListener).toHaveBeenCalledWith([registered[0].resource, false])
    expect(service.getRegisteredLogger(registered[0].resource)?.hidden).toBe(true)

    service.deregisterLogger("legacy/output:channel")
    expect(Array.from(service.getRegisteredLoggers())).toHaveLength(0)
  })

  it("creates services from SyncDescriptor and injects decorator dependencies", () => {
    interface IDemoService { readonly _serviceBrand: undefined; readonly value: string }
    const IDemoService = createDecorator<IDemoService>("demoService")

    class DemoService implements IDemoService {
      declare readonly _serviceBrand: undefined
      readonly value = "demo"
    }

    class Consumer {
      constructor(
        readonly label: string,
        readonly demoService: IDemoService,
      ) {}
    }
    IDemoService(Consumer, undefined as unknown as string, 1)

    const collection = new ServiceCollection([IDemoService, new SyncDescriptor(DemoService)])
    const instantiationService = new InstantiationService(collection, true)
    const consumer = instantiationService.createInstance(Consumer, "consumer")

    expect(consumer.label).toBe("consumer")
    expect(consumer.demoService.value).toBe("demo")
    expect(collection.get(IDemoService)).toBe(consumer.demoService)
  })
})
