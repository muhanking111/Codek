import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearCommands, executeCommand, getCommand } from "../workbench/commandRegistry"
import { ContextKeyService } from "../workbench/contextKeys"
import { clearViews, getViewContainers, getViews, registerDefaultWorkbenchViews } from "../workbench/viewRegistry"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import { InstantiationService } from "../vscode-adapter/platform/instantiation/common/instantiationService"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"
import {
  globalTestingService,
  ITestProfileService,
  ITestResultService,
  ITestingService,
  registerTestingCallbackCommands,
  registerTestingWorkbenchViews,
  TESTING_CALLBACK_COMMAND_IDS,
  TESTING_COVERAGE_COMMAND_IDS,
  TESTING_PEEK_COMMAND_IDS,
  TESTING_RUN_COMMAND_IDS,
  TESTING_VIEW_IDS,
  TestingService,
} from "./testingService"

describe("testingService", () => {
  beforeEach(() => {
    globalTestingService.reset()
    clearCommands()
    clearViews()
  })

  it("registers controllers, profiles and test results into one VS Code-style projection", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 2, label: "Debug focused", group: "debug", isDefault: false })
    service.addProfile({ controllerId: "vitest", profileId: 1, label: "Run focused", group: "run", isDefault: true })
    service.appendResult({ id: "result:app", controllerId: "vitest", testId: "app", label: "app.test.ts", state: "failed", durationMs: 42, messages: ["expected true"] })
    service.appendResult({ id: "result:scm", controllerId: "vitest", testId: "scm", label: "scmRegistry.test.ts", state: "passed", durationMs: 7, messages: [] })

    expect(service.getControllerProfiles("vitest").map((profile) => profile.label)).toEqual(["Run focused", "Debug focused"])
    expect(service.getGroupDefaultProfiles("run").map((profile) => profile.profileId)).toEqual([1])
    expect(service.getRunSummary()).toEqual({
      total: 2,
      passed: 1,
      failed: 1,
      running: 0,
      skipped: 0,
      errored: 0,
      state: "failed",
    })
    expect(service.getProjection()).toEqual(expect.objectContaining({
      controllers: [{ id: "vitest", label: "Vitest" }],
      profiles: expect.arrayContaining([expect.objectContaining({ profileId: 1 })]),
      results: expect.arrayContaining([expect.objectContaining({ id: "result:app", state: "failed" })]),
    }))
  })

  it("publishes completed run snapshots to ExtHostTesting without a second result state source", () => {
    const service = new TestingService()
    const published: unknown[] = []
    service.setExtensionHostCallbacks({
      cancelRun: vi.fn(),
      configureProfile: vi.fn(),
      getCoverageDetails: vi.fn(async () => []),
      provideTestFollowups: vi.fn(async () => []),
      executeTestFollowup: vi.fn(async () => {}),
      disposeTestFollowups: vi.fn(),
      publishTestResults: vi.fn((results) => published.push(...results)),
    })

    service.registerController({ id: "vitest", label: "Vitest" })
    service.upsertItem({ controllerId: "vitest", id: "vitest", label: "Vitest", expand: "expanded" })
    service.upsertItem({ controllerId: "vitest", id: "vitest\u0000suite", parentId: "vitest", label: "suite", expand: "notExpandable" })
    service.startRun({ id: "run:publish", controllerId: "vitest", profileId: 1, group: "run", testIds: ["vitest\u0000suite"], label: "Publish run" })
    service.startRunTask("run:publish", { id: "task:1", controllerId: "vitest", name: "Vitest task", running: true })
    service.appendOutput("run:publish", "expected true", { testId: "vitest\u0000suite", locationUri: "file:///workspace/suite.test.ts" })
    service.updateRunItemState("run:publish", "vitest\u0000suite", "failed", 14, ["assertion failed"])

    service.completeRun("run:publish")

    expect(published).toEqual([expect.objectContaining({
      id: "run:publish",
      controllerId: "vitest",
      label: "Publish run",
      state: "failed",
      source: "TestingService.completeRun()",
      vscodeSourcePath: "src/vs/workbench/api/browser/mainThreadTesting.ts",
      noSecondState: true,
      summary: expect.objectContaining({ total: 1, failed: 1, state: "failed" }),
      tests: [expect.objectContaining({
        id: "run:publish:vitest\u0000suite",
        testId: "vitest\u0000suite",
        state: "failed",
        messages: ["expected true", "assertion failed"],
      })],
      tasks: [expect.objectContaining({ id: "task:1", name: "Vitest task" })],
      output: [expect.objectContaining({ message: "expected true", locationUri: "file:///workspace/suite.test.ts" })],
    })])
    expect(service.getProjection().upperOwnerProjection.resultService.eventProjection.onResultsChanged).toBe("emitter-backed")
  })

  it("cleans profiles and results when a controller is removed", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 1, label: "Run", group: "run", isDefault: true })
    service.upsertItem({ controllerId: "vitest", id: "vitest", label: "Vitest root", expand: "expanded" })
    service.upsertItem({ controllerId: "vitest", id: "vitest\u0000app", parentId: "vitest", label: "app", expand: "notExpandable" })
    service.startRun({ id: "run:1", controllerId: "vitest", profileId: 1, group: "run", testIds: ["vitest\u0000app"], label: "Run app" })
    service.appendResult({ id: "result:app", controllerId: "vitest", testId: "app", label: "app", state: "passed", durationMs: 1, messages: [] })

    service.unregisterController("vitest")

    expect(service.getProjection()).toEqual(expect.objectContaining({
      controllers: [],
      profiles: [],
      items: [],
      runs: [],
      results: [],
      runSummary: expect.objectContaining({ total: 0, state: "unknown" }),
      resultHistory: expect.objectContaining({
        status: "notAvailable",
        stateSource: "TestingService runs/results/output",
        retainedRunCount: 0,
        retainedResultCount: 0,
        hasAnyResults: false,
        isRunning: false,
        runs: [],
        adapter: expect.objectContaining({
          kind: "test-result-service-history-projection",
          noSecondState: true,
        }),
      }),
      resultStorage: expect.objectContaining({
        status: "notAvailable",
        storageKey: "storedTestResults",
        retainedResultIds: [],
        serializedResults: [],
        noSecondState: true,
      }),
      testResultsViewPaneShell: expect.objectContaining({
        status: "notAvailable",
        containerId: TESTING_VIEW_IDS.ResultsContainer,
        viewId: TESTING_VIEW_IDS.Results,
        stateSource: "TestingService.getResultHistoryProjection()+getResultPeekProjection()",
        runCount: 0,
        resultCount: 0,
        treeRowCount: 0,
        rows: [],
        noSecondState: true,
      }),
      coverage: expect.objectContaining({ status: "notAvailable" }),
      resultPeek: expect.objectContaining({ status: "notAvailable", entries: [] }),
      coverageTree: expect.objectContaining({ status: "notAvailable", nodes: [] }),
      coverageView: expect.objectContaining({ status: "notAvailable", nodes: [] }),
      coverageDecorations: expect.objectContaining({ status: "notAvailable" }),
      coverageRendererShell: expect.objectContaining({
        status: "notAvailable",
        nodeCount: 0,
        rows: [],
      }),
      coverageEditorContributionShell: expect.objectContaining({
        status: "notAvailable",
        contributionId: "editor.contrib.coverageDecorations",
      }),
      continuousContextKeys: expect.objectContaining({
        stateSource: "TestingService profiles+runs+items",
        serviceLevelKeys: {
          "testing.supportsContinuousRun": false,
          "testing.isContinuousModeOn": false,
        },
        itemContextKeys: [],
        noSecondState: true,
      }),
      testingExplorerContract: expect.objectContaining({
        status: "partial",
        rows: [],
        noSecondState: true,
      }),
      upperOwnerProjection: expect.objectContaining({
        status: "partial",
        collection: expect.objectContaining({
          controllerCount: 0,
          itemCount: 0,
          noSecondState: true,
        }),
        resultService: expect.objectContaining({
          retainedRunCount: 0,
          retainedResultCount: 0,
          noSecondState: true,
        }),
        noSecondState: true,
      }),
      coverageOwnerFeasibility: expect.objectContaining({
        status: "partial",
        noSecondState: true,
      }),
      actions: [],
      contract: service.getContractAudit(),
    }))
  })

  it("projects test item tree, run lifecycle, output messages and coverage placeholder from one service", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 1, label: "Run focused", group: "run", isDefault: true })
    service.addProfile({ controllerId: "vitest", profileId: 3, label: "Coverage focused", group: "coverage", isDefault: true })
    service.upsertItem({ controllerId: "vitest", id: "vitest", label: "Vitest root", expand: "expanded" })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src/testing/testingService.test.ts",
      parentId: "vitest",
      label: "testingService.test.ts",
      uri: "file:///workspace/src/testing/testingService.test.ts",
      expand: "expanded",
      tags: ["unit"],
    })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src/testing/testingService.test.ts\u0000run lifecycle",
      parentId: "vitest\u0000src/testing/testingService.test.ts",
      label: "run lifecycle",
      uri: "file:///workspace/src/testing/testingService.test.ts",
      expand: "notExpandable",
      sortText: "001",
    })

    service.startRun({
      id: "run:1",
      controllerId: "vitest",
      profileId: 1,
      group: "run",
      testIds: ["vitest\u0000src/testing/testingService.test.ts\u0000run lifecycle"],
      label: "Run focused",
    })
    service.appendOutput("run:1", "collected 1 test", { testId: "vitest\u0000src/testing/testingService.test.ts\u0000run lifecycle" })
    service.updateRunItemState("run:1", "vitest\u0000src/testing/testingService.test.ts\u0000run lifecycle", "passed", 12)
    service.completeRun("run:1")

    expect(service.getItems().map((item) => [item.id, item.depth, item.childrenIds])).toEqual([
      ["vitest", 0, ["vitest\u0000src/testing/testingService.test.ts"]],
      ["vitest\u0000src/testing/testingService.test.ts", 1, ["vitest\u0000src/testing/testingService.test.ts\u0000run lifecycle"]],
      ["vitest\u0000src/testing/testingService.test.ts\u0000run lifecycle", 2, []],
    ])
    expect(service.getRuns()).toEqual([
      expect.objectContaining({
        id: "run:1",
        state: "passed",
        completedAt: expect.any(Number),
        output: [expect.objectContaining({ message: "collected 1 test", testId: "vitest\u0000src/testing/testingService.test.ts\u0000run lifecycle" })],
      }),
    ])
    expect(service.getResults()).toEqual([
      expect.objectContaining({
        id: "run:1:vitest\u0000src/testing/testingService.test.ts\u0000run lifecycle",
        state: "passed",
        durationMs: 12,
        messages: ["collected 1 test"],
      }),
    ])
    expect(service.getProjection()).toEqual(expect.objectContaining({
      coverage: {
        status: "placeholder",
        reason: "coverage profile registered but no coverage data has been published",
        files: [],
      },
      resultPeek: expect.objectContaining({
        status: "available",
        latestRunId: "run:1",
        entries: [expect.objectContaining({
          runId: "run:1",
          testId: "vitest\u0000src/testing/testingService.test.ts\u0000run lifecycle",
          messages: ["collected 1 test"],
          output: [expect.objectContaining({ message: "collected 1 test" })],
          canCancel: false,
          evidenceUri: "codek-testing://vitest/result-peek/run%3A1/vitest%00src%2Ftesting%2FtestingService.test.ts%00run%20lifecycle",
        })],
      }),
      coverageTree: expect.objectContaining({
        status: "placeholder",
        nodes: [],
      }),
      coverageView: expect.objectContaining({
        status: "placeholder",
        nodes: [],
        showInline: false,
      }),
      coverageDecorations: expect.objectContaining({
        status: "notAvailable",
      }),
      runSummary: expect.objectContaining({ total: 1, passed: 1, state: "passed" }),
    }))
  })

  it("propagates retired result evidence into result peek and Testing Explorer rows without a second state source", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 1, label: "Run", group: "run", isDefault: true })
    service.upsertItem({ controllerId: "vitest", id: "vitest", label: "Vitest root", expand: "expanded" })
    service.upsertItem({ controllerId: "vitest", id: "vitest\u0000src", parentId: "vitest", label: "src", expand: "expanded" })
    service.upsertItem({ controllerId: "vitest", id: "vitest\u0000src\u0000owner.test.ts", parentId: "vitest\u0000src", label: "owner.test.ts", expand: "notExpandable" })
    service.upsertItem({ controllerId: "vitest", id: "vitest\u0000other.test.ts", parentId: "vitest", label: "other.test.ts", expand: "notExpandable" })
    service.startRun({
      id: "run:retire",
      controllerId: "vitest",
      profileId: 1,
      group: "run",
      testIds: ["vitest\u0000src\u0000owner.test.ts", "vitest\u0000other.test.ts"],
      label: "Run retire",
    })
    service.updateRunItemState("run:retire", "vitest\u0000src\u0000owner.test.ts", "failed", 4, ["expected true"])
    service.updateRunItemState("run:retire", "vitest\u0000other.test.ts", "passed", 2)

    service.markResultsRetired(["vitest\u0000src"])

    expect(service.getResults()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        testId: "vitest\u0000src\u0000owner.test.ts",
        retired: true,
      }),
      expect.objectContaining({
        testId: "vitest\u0000other.test.ts",
        retired: false,
      }),
    ]))
    expect(service.getResultPeekProjection()).toEqual(expect.objectContaining({
      entries: expect.arrayContaining([
        expect.objectContaining({
          testId: "vitest\u0000src\u0000owner.test.ts",
          retired: true,
        }),
        expect.objectContaining({
          testId: "vitest\u0000other.test.ts",
          retired: false,
        }),
      ]),
    }))
    expect(service.getTestingExplorerContractProjection()).toEqual(expect.objectContaining({
      rows: expect.arrayContaining([
        expect.objectContaining({
          id: "vitest\u0000src",
          retired: true,
        }),
        expect.objectContaining({
          id: "vitest\u0000src\u0000owner.test.ts",
          retired: true,
        }),
        expect.objectContaining({
          id: "vitest\u0000other.test.ts",
          retired: false,
        }),
      ]),
      noSecondState: true,
    }))
    expect(service.getUpperOwnerProjection().liveResultLifecycle).toEqual(expect.objectContaining({
      retiredResultIds: ["run:retire:vitest\u0000src\u0000owner.test.ts"],
      retiredTestIds: ["vitest\u0000src\u0000owner.test.ts"],
      noSecondState: true,
    }))

    const projection = service.getProjection()
    projection.results[0].retired = false
    projection.resultPeek.entries[0].retired = false
    projection.testingExplorerContract.rows[0].retired = false
    expect(service.getResultPeekProjection().entries.find((entry) => entry.testId === "vitest\u0000src\u0000owner.test.ts")?.retired).toBe(true)
    expect(service.getTestingExplorerContractProjection().rows.find((row) => row.id === "vitest\u0000src")?.retired).toBe(true)
  })

  it("derives result peek and coverage tree adapter projections from TestingService without a second state source", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 1, label: "Run", group: "run", isDefault: true })
    service.addProfile({ controllerId: "vitest", profileId: 2, label: "Coverage", group: "coverage", isDefault: true })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src/example.test.ts",
      label: "example.test.ts",
      uri: "file:///workspace/src/example.test.ts",
      expand: "notExpandable",
    })

    service.startRun({
      id: "run:peek",
      controllerId: "vitest",
      profileId: 1,
      group: "run",
      testIds: ["vitest\u0000src/example.test.ts"],
      label: "Run example",
    })
    service.appendOutput("run:peek", "Assertion failed", {
      testId: "vitest\u0000src/example.test.ts",
      locationUri: "file:///workspace/src/example.test.ts#L12",
    })
    service.updateRunItemState("run:peek", "vitest\u0000src/example.test.ts", "failed", 33, ["expected true"])
    service.publishCoverage([{
      id: "coverage:example",
      uri: "file:///workspace/src/example.ts",
      statement: { covered: 7, total: 10 },
      branch: { covered: 1, total: 2 },
      declaration: { covered: 0, total: 0 },
      testIds: ["vitest\u0000src/example.test.ts"],
    }])

    expect(service.getResultPeekProjection()).toEqual({
      status: "available",
      latestRunId: "run:peek",
      entries: [expect.objectContaining({
        id: "run:peek:vitest\u0000src/example.test.ts",
        runId: "run:peek",
        testId: "vitest\u0000src/example.test.ts",
        label: "example.test.ts",
        state: "failed",
        durationMs: 33,
        messages: ["Assertion failed", "expected true"],
        output: [expect.objectContaining({
          message: "Assertion failed",
          offset: 0,
          locationUri: "file:///workspace/src/example.test.ts#L12",
        })],
        locationUri: "file:///workspace/src/example.test.ts#L12",
        canCancel: true,
        commandIds: ["testing.run", "testing.debug", TESTING_PEEK_COMMAND_IDS.OpenOutputPeek, TESTING_CALLBACK_COMMAND_IDS.CancelRun],
        evidenceUri: "codek-testing://vitest/result-peek/run%3Apeek/vitest%00src%2Fexample.test.ts",
      })],
      adapter: expect.objectContaining({
        codekOwner: "TestingService.getResultPeekProjection()",
        noSecondState: true,
        blockedOwners: expect.arrayContaining([
          "TestingOutputPeekController",
          "PeekViewWidget/editor contribution integration",
        ]),
      }),
    })

    expect(service.getCoverageTreeProjection()).toEqual({
      status: "available",
      reason: undefined,
      nodes: [expect.objectContaining({
        id: "coverage:example",
        uri: "file:///workspace/src/example.ts",
        label: "example.ts",
        statementPercent: 70,
        branchPercent: 50,
        declarationPercent: null,
        testIds: ["vitest\u0000src/example.test.ts"],
        detailsAvailable: true,
        commandIds: [
          "testing.coverage",
          TESTING_COVERAGE_COMMAND_IDS.OpenCoverage,
          TESTING_COVERAGE_COMMAND_IDS.FilterToTest,
          TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
        ],
        evidenceUri: "codek-testing://coverage-tree/coverage%3Aexample",
      })],
      adapter: expect.objectContaining({
        codekOwner: "TestingService.getCoverageTreeProjection()",
        noSecondState: true,
        blockedOwners: expect.arrayContaining([
          "TestCoverageView/TestCoverageTree DOM owner",
          "Full CodeCoverageDecorations editor contribution",
        ]),
      }),
    })

    expect(service.getProjection()).toEqual(expect.objectContaining({
      resultHistory: service.getResultHistoryProjection(),
      resultPeek: service.getResultPeekProjection(),
      coverageTree: service.getCoverageTreeProjection(),
      coverageView: service.getCoverageViewProjection(),
      coverageDecorations: service.getCoverageEditorDecorationsProjection(),
      contract: expect.objectContaining({ noSecondState: true }),
    }))
  })

  it("projects TestResultService retained history evidence from runs results and output without a second state source", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 1, label: "Run", group: "run", isDefault: true })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src/example.test.ts",
      label: "example.test.ts",
      uri: "file:///workspace/src/example.test.ts",
      expand: "notExpandable",
    })

    service.startRun({
      id: "run:history:1",
      controllerId: "vitest",
      profileId: 1,
      group: "run",
      testIds: ["vitest\u0000src/example.test.ts"],
      label: "Run history",
    })
    service.appendOutput("run:history:1", "failure output", { testId: "vitest\u0000src/example.test.ts" })
    service.updateRunItemState("run:history:1", "vitest\u0000src/example.test.ts", "failed", 31, ["expected true"])
    service.completeRun("run:history:1")

    const history = service.getResultHistoryProjection()

    expect(history).toEqual(expect.objectContaining({
      status: "available",
      stateSource: "TestingService runs/results/output",
      retainedRunCount: 1,
      retainedResultCount: 1,
      hasAnyResults: true,
      isRunning: false,
      runs: [
        expect.objectContaining({
          id: "run:history:1",
          controllerId: "vitest",
          group: "run",
          profileId: 1,
          continuous: false,
          testIds: ["vitest\u0000src/example.test.ts"],
          outputMessageCount: 1,
          resultIds: ["run:history:1:vitest\u0000src/example.test.ts"],
          summary: expect.objectContaining({
            total: 1,
            failed: 1,
            state: "failed",
          }),
        }),
      ],
      adapter: expect.objectContaining({
        kind: "test-result-service-history-projection",
        codekOwner: "TestingService.getResultHistoryProjection()",
        implementedOwners: expect.arrayContaining([
          "retained run list from TestingService.getRuns()",
          "retained result list from TestingService.getResults()",
          "isRunning/hasAnyResults context evidence",
          "ITestResultService onResultsChanged event source",
          "ITestResultStorage storedTestResults serialization evidence",
        ]),
        blockedOwners: expect.arrayContaining([
          "LiveTestResult disposable lifecycle and telemetry",
        ]),
        noSecondState: true,
      }),
    }))

    history.runs[0].resultIds.push("mutated")
    history.adapter.blockedOwners.push("mutated")
    const fresh = service.getResultHistoryProjection()
    expect(fresh.runs[0].resultIds).not.toContain("mutated")
    expect(fresh.adapter.blockedOwners).not.toContain("mutated")
    expect(service.getProjection().resultHistory).toEqual(fresh)
  })

  it("owns service-level ITestResultService events lookup clear and storage evidence without a second result state", () => {
    const service = new TestingService()
    const resultEvents: unknown[] = []
    const testEvents: unknown[] = []
    const resultDisposable = service.onResultsChanged((event) => resultEvents.push(event))
    const testDisposable = service.onTestChanged((event) => testEvents.push(event))

    service.registerController({ id: "vitest", label: "Vitest" })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src/service-owner.test.ts",
      label: "service-owner.test.ts",
      uri: "file:///workspace/src/service-owner.test.ts",
      expand: "notExpandable",
    })
    service.startRun({
      id: "run:service-owner",
      controllerId: "vitest",
      group: "run",
      testIds: ["vitest\u0000src/service-owner.test.ts"],
      label: "Service owner",
    })
    service.appendOutput("run:service-owner", "failed output", {
      testId: "vitest\u0000src/service-owner.test.ts",
      locationUri: "file:///workspace/src/service-owner.test.ts#L4",
    })
    service.updateRunItemState("run:service-owner", "vitest\u0000src/service-owner.test.ts", "failed", 18, ["expected true"])
    service.completeRun("run:service-owner", "failed")

    const resultId = "run:service-owner:vitest\u0000src/service-owner.test.ts"
    expect(service.getResult(resultId)).toEqual(expect.objectContaining({ id: resultId, state: "failed" }))
    expect(service.getStateById("vitest\u0000src/service-owner.test.ts")?.[0]).toEqual(expect.objectContaining({ id: resultId, state: "failed" }))
    expect(service.resultsList).toEqual([expect.objectContaining({ id: resultId })])
    expect(resultEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ inserted: expect.objectContaining({ id: resultId }) }),
      expect.objectContaining({ completed: expect.objectContaining({ id: "run:service-owner", noSecondState: true }) }),
    ]))
    expect(testEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: expect.objectContaining({ id: resultId }), reason: "newMessage" }),
      expect.objectContaining({ result: expect.objectContaining({ id: resultId, state: "failed" }), reason: "computedStateChange" }),
    ]))

    const storage = service.getResultStorageProjection()
    expect(storage).toEqual(expect.objectContaining({
      status: "available",
      stateSource: "TestingService runs/results/output",
      storageKey: "storedTestResults",
      retainedResultIds: ["run:service-owner"],
      serializedResults: [expect.objectContaining({
        id: "run:service-owner",
        tests: [expect.objectContaining({ id: resultId })],
        output: [expect.objectContaining({ message: "failed output" })],
        noSecondState: true,
      })],
      adapter: expect.objectContaining({
        kind: "test-result-storage-projection",
        codekOwner: "TestingService.getResultStorageProjection()",
        implementedOwners: expect.arrayContaining([
          "storedTestResults key evidence",
          "completed result serialization from TestingService.createPublishedResultSnapshot()",
        ]),
        blockedOwners: expect.arrayContaining([
          "TestResultStorage workspaceStorageHome file owner",
          "result output stream persistence",
        ]),
        noSecondState: true,
      }),
      noSecondState: true,
    }))

    storage.serializedResults[0].tests[0].messages.push("mutated")
    storage.adapter.blockedOwners.push("mutated")
    const freshStorage = service.getResultStorageProjection()
    expect(freshStorage.serializedResults[0].tests[0].messages).not.toContain("mutated")
    expect(freshStorage.adapter.blockedOwners).not.toContain("mutated")
    expect(service.getProjection().resultStorage).toEqual(freshStorage)

    service.clear()
    expect(service.getResults()).toEqual([])
    expect(resultEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ removed: [expect.objectContaining({ id: resultId })] }),
    ]))

    resultDisposable.dispose()
    testDisposable.dispose()
  })

  it("projects a Test Results ViewPane shell from TestingService history without claiming the VS Code tree owner", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 1, label: "Run", group: "run", isDefault: true })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src/results.test.ts",
      label: "results.test.ts",
      uri: "file:///workspace/src/results.test.ts",
      expand: "notExpandable",
    })

    service.startRun({
      id: "run:results-view",
      controllerId: "vitest",
      profileId: 1,
      group: "run",
      testIds: ["vitest\u0000src/results.test.ts"],
      label: "Results View",
    })
    service.appendOutput("run:results-view", "expected true\n", {
      testId: "vitest\u0000src/results.test.ts",
      locationUri: "file:///workspace/src/results.test.ts",
    })
    service.updateRunItemState("run:results-view", "vitest\u0000src/results.test.ts", "failed", 9, ["assertion failed"])
    service.completeRun("run:results-view", "failed")

    const shell = service.getTestResultsViewPaneShellProjection()

    expect(shell).toEqual(expect.objectContaining({
      status: "available",
      containerId: TESTING_VIEW_IDS.ResultsContainer,
      viewId: TESTING_VIEW_IDS.Results,
      stateSource: "TestingService.getResultHistoryProjection()+getResultPeekProjection()",
      runCount: 1,
      resultCount: 1,
      treeRowCount: 2,
      selectedRunId: "run:results-view",
      selectedEntryId: "run:results-view:vitest\u0000src/results.test.ts",
      noSecondState: true,
      adapter: expect.objectContaining({
        kind: "test-results-viewpane-shell",
        codekOwner: "App.vue:data-codek-smoke=\"testing-results-viewpane-shell-owner\"",
        implementedOwners: expect.arrayContaining([
          "Test Results panel container DOM evidence",
          "read-only result tree rows from TestingService result history",
          "selected TestResultPeek entry evidence",
        ]),
        blockedOwners: expect.arrayContaining([
          "VS Code TestResultsViewContent SplitView DOM owner",
          "VS Code OutputPeekTree WorkbenchCompressibleObjectTree owner",
          "TestResultsViewContent FollowupActionWidget owner",
        ]),
        noSecondState: true,
      }),
    }))
    expect(shell.rows).toEqual([
      expect.objectContaining({
        id: "run:results-view",
        role: "treeitem",
        kind: "run",
        label: "Results View",
        depth: 0,
        state: "failed",
        resultIds: ["run:results-view:vitest\u0000src/results.test.ts"],
      }),
      expect.objectContaining({
        id: "run:results-view:vitest\u0000src/results.test.ts",
        role: "treeitem",
        kind: "test",
        runId: "run:results-view",
        testId: "vitest\u0000src/results.test.ts",
        label: "results.test.ts",
        depth: 1,
        state: "failed",
        messageCount: 2,
        outputMessageCount: 1,
        locationUri: "file:///workspace/src/results.test.ts",
      }),
    ])

    shell.rows[0].resultIds.push("mutated")
    shell.adapter.blockedOwners.push("mutated")
    const fresh = service.getTestResultsViewPaneShellProjection()
    expect(fresh.rows[0].resultIds).not.toContain("mutated")
    expect(fresh.adapter.blockedOwners).not.toContain("mutated")
    expect(service.getProjection().testResultsViewPaneShell).toEqual(fresh)
  })

  it("projects Testing upper owner contracts from one service while keeping VS Code UI and lifecycle owners blocked", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 7, label: "Run fallback", group: "run", isDefault: false })
    service.addProfile({ controllerId: "vitest", profileId: 3, label: "Debug default", group: "debug", isDefault: true })
    service.addProfile({ controllerId: "vitest", profileId: 5, label: "Coverage default", group: "coverage", isDefault: true })
    service.upsertItem({ controllerId: "vitest", id: "vitest", label: "Vitest root", expand: "expanded", busy: true })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src/owner.test.ts",
      parentId: "vitest",
      label: "owner.test.ts",
      uri: "file:///workspace/src/owner.test.ts",
      expand: "notExpandable",
    })

    service.startRun({
      id: "run:upper",
      controllerId: "vitest",
      profileId: 7,
      group: "run",
      testIds: ["vitest\u0000src/owner.test.ts"],
      label: "Upper owner run",
    })
    service.appendOutput("run:upper", "failure output", {
      testId: "vitest\u0000src/owner.test.ts",
      locationUri: "file:///workspace/src/owner.test.ts#L4",
    })
    service.updateRunItemState("run:upper", "vitest\u0000src/owner.test.ts", "failed", 9, ["expected true"])
    service.markResultsRetired(["vitest\u0000src/owner.test.ts"])

    const projection = service.getUpperOwnerProjection("vitest")

    expect(projection).toEqual(expect.objectContaining({
      status: "partial",
      stateSource: "TestingService controllers/profiles/items/runs/results/output",
      collection: {
        status: "projected",
        controllerCount: 1,
        itemCount: 2,
        rootIds: ["vitest"],
        busyItemIds: ["vitest"],
        diffListener: expect.objectContaining({
          status: "blocked",
          forwardedBridge: "MainThreadTesting.$subscribeToDiffs -> ExtHostTesting.$syncTests",
          blockedOwner: "ITestService.collection onDidProcessDiff listener",
        }),
        noSecondState: true,
      },
      resultService: expect.objectContaining({
        status: "projected",
        retainedRunCount: 1,
        retainedResultCount: 1,
        runningRunIds: ["run:upper"],
        completedRunIds: [],
        outputMessageCount: 1,
        retiredResultIds: ["run:upper:vitest\u0000src/owner.test.ts"],
        eventProjection: {
          onResultsChanged: "emitter-backed",
          onTestChanged: "emitter-backed",
          owner: "TestingService onResultsChanged/onTestChanged",
        },
        storage: expect.objectContaining({
          status: "projected",
          owner: "TestingService.getResultStorageProjection()",
          storageKey: "storedTestResults",
          blockedOwners: expect.arrayContaining([
            "TestResultStorage workspaceStorageHome file owner",
            "result output stream persistence",
          ]),
        }),
        noSecondState: true,
      }),
      liveResultLifecycle: expect.objectContaining({
        status: "partial",
        runningRunIds: ["run:upper"],
        completedRunIds: [],
        cancellableRunIds: ["run:upper"],
        retiredResultIds: ["run:upper:vitest\u0000src/owner.test.ts"],
        retiredTestIds: ["vitest\u0000src/owner.test.ts"],
        blockedOwners: expect.arrayContaining([
          "LiveTestResult task model",
          "dispose/telemetry lifecycle",
        ]),
        noSecondState: true,
      }),
      profileDefaults: expect.objectContaining({
        status: "projected",
        defaultsByControllerAndGroup: {
          vitest: {
            debug: [3],
            coverage: [5],
          },
        },
        fallbackProfileIdsByControllerAndGroup: {
          vitest: {
            run: 7,
            debug: 3,
            coverage: 5,
          },
        },
        blockedOwners: expect.arrayContaining([
          "TestProfileService onDidChange default synchronization",
          "ExtHostTesting.$setDefaultRunProfiles",
        ]),
        noSecondState: true,
      }),
      messageFollowups: expect.objectContaining({
        status: "partial",
        resultPeekEntryCount: 1,
        messageCount: 2,
        messagesWithLocationCount: 2,
        implementedOwners: expect.arrayContaining([
          "TestingService.provideTestFollowups provider facade",
          "ExtHostTesting.$provideTestFollowups/$executeTestFollowup/$disposeTestFollowups bridge",
        ]),
        blockedOwners: expect.arrayContaining([
          "TestingOutputPeekController/PeekViewWidget owner for visible message reveal",
          "OutputPeekTree/TestMessageElement owner for selecting a TestMessage subject",
          "TestResultsViewContent FollowupActionWidget owner for requesting, rendering, executing, and disposing followup handles",
        ]),
        blockedReason: expect.stringContaining("result-peek shell descriptor"),
        noSecondState: true,
      }),
      uiOwners: expect.objectContaining({
        status: "blocked",
        testingExplorer: expect.objectContaining({
          blockedReason: expect.stringContaining("TestingExplorerView"),
        }),
        resultPeek: expect.objectContaining({
          blockedReason: expect.stringContaining("LiveTestResult instances"),
        }),
        coverageEditor: expect.objectContaining({
          blockedReason: expect.stringContaining("ICodeEditor/TextModel"),
        }),
        noSecondState: true,
      }),
      noSecondState: true,
    }))

    projection.collection.busyItemIds.push("mutated")
    projection.resultService.runningRunIds.push("mutated")
    projection.resultService.retiredResultIds.push("mutated")
    projection.resultService.storage.blockedOwners.push("mutated")
    projection.profileDefaults.defaultsByControllerAndGroup.vitest?.debug?.push(999)
    projection.liveResultLifecycle.blockedOwners.push("mutated")
    projection.liveResultLifecycle.retiredTestIds.push("mutated")
    projection.messageFollowups.blockedOwners.push("mutated")
    projection.uiOwners.resultPeek.blockedMatrix?.push({
      capability: "mutated",
      blockedOwner: "mutated",
      blockedReason: "mutated",
    })
    const fresh = service.getUpperOwnerProjection("vitest")
    expect(fresh.collection.busyItemIds).not.toContain("mutated")
    expect(fresh.resultService.runningRunIds).not.toContain("mutated")
    expect(fresh.resultService.retiredResultIds).not.toContain("mutated")
    expect(fresh.resultService.storage.blockedOwners).not.toContain("mutated")
    expect(fresh.profileDefaults.defaultsByControllerAndGroup.vitest?.debug).not.toContain(999)
    expect(fresh.liveResultLifecycle.blockedOwners).not.toContain("mutated")
    expect(fresh.liveResultLifecycle.retiredTestIds).not.toContain("mutated")
    expect(fresh.messageFollowups.blockedOwners).not.toContain("mutated")
    expect(fresh.uiOwners.resultPeek.blockedMatrix?.map((entry) => entry.capability)).not.toContain("mutated")
    expect(service.getProjection("vitest").upperOwnerProjection).toEqual(fresh)
  })

  it("opens coverage view and editor decoration shell projections from TestingService coverage state", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 2, label: "Coverage", group: "coverage", isDefault: true })
    service.publishCoverage([
      {
        id: "coverage:low",
        uri: "file:///workspace/src/low.ts",
        statement: { covered: 1, total: 10 },
        branch: { covered: 0, total: 2 },
        testIds: ["vitest\u0000low"],
      },
      {
        id: "coverage:high",
        uri: "file:///workspace/src/high.ts",
        statement: { covered: 9, total: 10 },
        branch: { covered: 1, total: 2 },
        declaration: { covered: 1, total: 1 },
        testIds: ["vitest\u0000high"],
      },
    ])

    const opened = service.openCoverage("coverage:high")
    expect(opened).toEqual(expect.objectContaining({
      status: "available",
      selectedCoverageId: "coverage:high",
      showInline: false,
      sortOrder: "location",
      commandIds: expect.arrayContaining([
        TESTING_COVERAGE_COMMAND_IDS.OpenCoverage,
        TESTING_COVERAGE_COMMAND_IDS.ToggleInlineCoverage,
        TESTING_COVERAGE_COMMAND_IDS.FilterToTest,
        TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
      ]),
      shellAdapter: expect.objectContaining({
        kind: "coverage-view-shell-adapter",
        codekOwner: "TestingService.getCoverageViewProjection()",
        noSecondState: true,
        implementedOwners: expect.arrayContaining([
          "selected coverage id",
          "filter-to-test id",
          "inline coverage visibility",
        ]),
        blockedOwners: expect.arrayContaining([
          "TestCoverageView ViewPane DOM",
          "WorkbenchCompressibleObjectTree/TestCoverageTree renderer",
        ]),
      }),
    }))
    expect(opened.nodes.map((node) => node.id)).toEqual(["coverage:high", "coverage:low"])

    service.setCoverageInlineVisible(true)
    service.setCoverageFilterToTest("vitest\u0000high")
    service.setCoverageSortOrder("coverage")

    expect(service.getCoverageViewProjection()).toEqual(expect.objectContaining({
      status: "available",
      selectedCoverageId: "coverage:high",
      filteredToTestId: "vitest\u0000high",
      showInline: true,
      sortOrder: "coverage",
      nodes: [expect.objectContaining({
        id: "coverage:high",
        detailsAvailable: true,
        statementPercent: 90,
      })],
    }))

    expect(service.getCoverageEditorDecorationsProjection("file:///workspace/src/high.ts#L1")).toEqual(expect.objectContaining({
      status: "available",
      uri: "file:///workspace/src/high.ts",
      selectedCoverageId: "coverage:high",
      decoration: expect.objectContaining({
        id: "coverage:high",
        filteredToTestId: "vitest\u0000high",
        showInline: true,
        hasPerTestCoverage: true,
        commandIds: expect.arrayContaining([
          TESTING_COVERAGE_COMMAND_IDS.ToggleInlineCoverage,
          TESTING_COVERAGE_COMMAND_IDS.GoToNextMissedLine,
          TESTING_COVERAGE_COMMAND_IDS.GoToPreviousMissedLine,
          TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
        ]),
        evidenceUri: "codek-testing://coverage-decorations/coverage%3Ahigh",
      }),
      rangeModelShell: expect.objectContaining({
        coverageId: "coverage:high",
        lineRangeHint: { startLineNumber: 1, endLineNumber: 10 },
        detailAccessorCommandId: TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
        noSecondState: true,
      }),
      adapter: expect.objectContaining({
        kind: "coverage-editor-decoration-projection",
        codekOwner: "TestingService.getCoverageEditorDecorationsProjection()",
        noSecondState: true,
        implementedOwners: expect.arrayContaining([
          "selected coverage file lookup",
          "inline coverage state projection",
          "CoverageDetailsModel range model shell evidence",
        ]),
        blockedOwners: expect.arrayContaining([
          "ICodeEditor contribution registration",
          "CoverageDetailsModel statement/branch ranges",
          "coverage toolbar overlay widget",
        ]),
      }),
    }))

    const descriptor = service.getCoverageEditorDecorationsProjection()
    descriptor.decoration?.testIds.push("mutated")
    descriptor.adapter.blockedOwners.push("mutated")

    const fresh = service.getCoverageEditorDecorationsProjection()
    expect(fresh.decoration?.testIds).not.toContain("mutated")
    expect(fresh.adapter.blockedOwners).not.toContain("mutated")
  })

  it("projects coverage renderer and editor contribution shell evidence without a second Testing state source", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 2, label: "Coverage", group: "coverage", isDefault: true })
    service.publishCoverage([
      {
        id: "coverage:alpha",
        uri: "file:///workspace/src/alpha.ts",
        statement: { covered: 2, total: 4 },
        branch: { covered: 1, total: 2 },
        testIds: ["vitest\u0000alpha"],
      },
      {
        id: "coverage:beta",
        uri: "file:///workspace/src/beta.ts",
        statement: { covered: 4, total: 4 },
        branch: { covered: 2, total: 2 },
        testIds: ["vitest\u0000beta"],
      },
    ])
    service.openCoverage("coverage:alpha")
    service.setCoverageInlineVisible(true)
    service.setCoverageFilterToTest("vitest\u0000alpha")

    const renderer = service.getCoverageRendererShellProjection()
    expect(renderer).toEqual(expect.objectContaining({
      status: "available",
      containerId: TESTING_VIEW_IDS.Container,
      viewId: TESTING_VIEW_IDS.Coverage,
      stateSource: "TestingService.getCoverageViewProjection()",
      selectedCoverageId: "coverage:alpha",
      filteredToTestId: "vitest\u0000alpha",
      showInline: true,
      nodeCount: 1,
      commandIds: expect.arrayContaining([
        TESTING_COVERAGE_COMMAND_IDS.OpenCoverage,
        TESTING_COVERAGE_COMMAND_IDS.ToggleInlineCoverage,
        TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
      ]),
      adapter: expect.objectContaining({
        kind: "coverage-renderer-shell",
        codekOwner: "App.vue:data-agent-evidence-surface=\"testing\"",
        noSecondState: true,
        implementedOwners: expect.arrayContaining([
          "projection-backed coverage row DOM smoke",
          "sort/filter/inline state data attributes",
        ]),
        blockedOwners: expect.arrayContaining([
          "ViewPane lifecycle and layout owner",
          "WorkbenchCompressibleObjectTree/TestCoverageTree virtualization",
        ]),
      }),
    }))
    expect(renderer.rows).toEqual([expect.objectContaining({
      id: "coverage:alpha",
      role: "treeitem",
      selected: true,
      ariaLabel: expect.stringContaining("alpha.ts"),
      statementPercent: 50,
      commandIds: expect.arrayContaining([TESTING_COVERAGE_COMMAND_IDS.FilterToTest]),
    })])

    const editorShell = service.getCoverageEditorContributionShellProjection("file:///workspace/src/alpha.ts#L12")
    expect(editorShell).toEqual(expect.objectContaining({
      status: "available",
      contributionId: "editor.contrib.coverageDecorations",
      stateSource: "TestingService.getCoverageEditorDecorationsProjection()",
      uri: "file:///workspace/src/alpha.ts",
      selectedCoverageId: "coverage:alpha",
      commandIds: expect.arrayContaining([
        TESTING_COVERAGE_COMMAND_IDS.ToggleInlineCoverage,
        TESTING_COVERAGE_COMMAND_IDS.GoToNextMissedLine,
        TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
      ]),
      adapter: expect.objectContaining({
        kind: "coverage-editor-contribution-shell",
        codekOwner: "TestingService.getCoverageEditorContributionShellProjection()",
        noSecondState: true,
        blockedOwners: expect.arrayContaining([
          "ICodeEditor contribution registration",
          "CoverageDetailsModel statement/branch ranges",
        ]),
      }),
    }))

    renderer.rows[0].testIds.push("mutated")
    renderer.adapter.blockedOwners.push("mutated")
    editorShell.decoration?.testIds.push("mutated")
    editorShell.adapter.blockedOwners.push("mutated")

    const freshRenderer = service.getCoverageRendererShellProjection()
    const freshEditorShell = service.getCoverageEditorContributionShellProjection("file:///workspace/src/alpha.ts")
    expect(freshRenderer.rows[0].testIds).not.toContain("mutated")
    expect(freshRenderer.adapter.blockedOwners).not.toContain("mutated")
    expect(freshEditorShell.decoration?.testIds).not.toContain("mutated")
    expect(freshEditorShell.adapter.blockedOwners).not.toContain("mutated")
    expect(service.getProjection()).toEqual(expect.objectContaining({
      coverageRendererShell: service.getCoverageRendererShellProjection(),
      coverageEditorContributionShell: service.getCoverageEditorContributionShellProjection(),
    }))
  })

  it("audits full coverage view and editor owner feasibility without regressing CA shell evidence", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 2, label: "Coverage", group: "coverage", isDefault: true })
    service.publishCoverage([{
      id: "coverage:owner",
      uri: "file:///workspace/src/owner.ts",
      statement: { covered: 3, total: 5 },
      branch: { covered: 1, total: 2 },
      testIds: ["vitest\u0000owner"],
    }])
    service.openCoverage("coverage:owner")
    service.setCoverageInlineVisible(true)

    const audit = service.getCoverageOwnerFeasibilityAudit("file:///workspace/src/owner.ts#L1")

    expect(audit).toEqual(expect.objectContaining({
      status: "partial",
      noSecondState: true,
      codekStateSource: "TestingService coverage projections",
      vscodeSourcePaths: expect.arrayContaining([
        "src/vs/workbench/contrib/testing/browser/testCoverageView.ts",
        "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
        "src/vs/workbench/contrib/testing/common/testCoverageService.ts",
        "src/vs/workbench/contrib/testing/common/testCoverage.ts",
      ]),
      fullOwnerMigration: {
        canClaimFullOwner: false,
        viewPaneOwnerReady: false,
        editorContributionOwnerReady: false,
        blockedReason: expect.stringContaining("ViewPane/TestCoverageTree"),
      },
    }))

    expect(audit.viewOwner).toEqual(expect.objectContaining({
      status: "partial",
      evidenceFrom: "TestingService.getCoverageRendererShellProjection()",
      implementedOwners: expect.arrayContaining([
        "projection-backed coverage row DOM smoke",
        "coverage command id evidence",
      ]),
      blockedOwners: expect.arrayContaining([
        "ViewPane lifecycle and layout owner",
        "WorkbenchCompressibleObjectTree/TestCoverageTree virtualization",
        "ResourceLabels and ActionBar/menu runner integration",
      ]),
      requiredOwners: expect.arrayContaining([
        "TestCoverageView extends ViewPane",
        "TestCoverageTree wraps WorkbenchCompressibleObjectTree",
      ]),
    }))
    expect(audit.viewPaneOwnerContract).toEqual({
      status: "blocked",
      stateSource: "TestingService.getCoverageViewProjection()",
      codekCanProvide: expect.arrayContaining([
        "selected coverage id",
        "filter-to-test id",
        "inline coverage visibility",
        "coverage sort order",
        "coverage tree row snapshots and command ids",
        "CoverageDetailsModel range model shell evidence",
      ]),
      vscodeRequiredOwners: expect.arrayContaining([
        "TestCoverageView extends ViewPane renderBody/layoutBody/collapseAll",
        "TestCoverageTree WorkbenchCompressibleObjectTree virtualization and identity provider",
        "ResourceLabels file/folder label rendering with decorations",
        "ActionBar/MenuId.TestCoverageFilterItem and ViewTitle action runner",
      ]),
      blockedReason: expect.stringContaining("does not own the VS Code ViewPane/TestCoverageTree DOM lifecycle"),
    })
    expect(audit.editorContributionOwner).toEqual(expect.objectContaining({
      status: "partial",
      evidenceFrom: "TestingService.getCoverageEditorContributionShellProjection()",
      implementedOwners: expect.arrayContaining([
        "selected editor coverage lookup evidence",
        "per-test coverage capability flag",
        "CoverageDetailsModel range model shell evidence",
      ]),
      blockedOwners: expect.arrayContaining([
        "ICodeEditor contribution registration",
        "CoverageDetailsModel statement/branch ranges",
        "model decorations/minimap/injected text",
        "coverage toolbar overlay widget",
      ]),
      requiredOwners: expect.arrayContaining([
        "CodeCoverageDecorations registered as editor.contrib.coverageDecorations",
        "CoverageDetailsModel ranges",
        "CoverageToolbarWidget overlay widget",
      ]),
      genericEditorShellContract: expect.objectContaining({
        status: "blocked",
        stateSource: "TestingService.getCoverageEditorDecorationsProjection()",
        noSecondState: true,
        requiredEditorApis: expect.arrayContaining([
          "ICodeEditor.getModel()/onDidChangeModel/onWillChangeModel",
          "ICodeEditor.addOverlayWidget/removeOverlayWidget",
          "ICodeEditor.getContribution(editor.contrib.coverageDecorations)",
        ]),
        requiredTextModelApis: expect.arrayContaining([
          "ITextModel.changeDecorations/deltaDecorations",
          "IModelDecorationOptions.minimap MinimapPosition.Gutter",
          "InjectedTextOptions before/after inline text",
        ]),
        expectedAdapterMethods: expect.arrayContaining([
          "registerEditorContribution(CodeCoverageDecorations.ID)",
          "applyCoverageDecorations(uri, ranges, showInline, showMinimap)",
          "wireCoverageNavigationCommands(goToNextMissedLine/goToPreviousMissedLine)",
        ]),
        wiringPrerequisites: expect.arrayContaining([
          "generic editor shell owner/adapter authorized by main thread",
          "Testing coverage projection wired to the active Codek editor model uri",
          "TestingService.requestCoverageDetails() result mapped into CoverageDetailsModel-compatible ranges",
        ]),
        blockedReason: expect.stringContaining("no authorized generic ICodeEditor/TextModel shell adapter"),
      }),
    }))
    expect(audit.remainingBlockers).toEqual(expect.arrayContaining([
      "Full TestCoverageView/TestCoverageTree ViewPane owner is not migrated.",
      "Full CodeCoverageDecorations ICodeEditor contribution is not registered.",
      "CoverageDetailsModel range mapping/minimap/injected text/overlay toolbar are still blocked.",
    ]))

    const renderer = service.getCoverageRendererShellProjection()
    const editorShell = service.getCoverageEditorContributionShellProjection("file:///workspace/src/owner.ts")
    expect(renderer.rows[0]).toEqual(expect.objectContaining({
      id: "coverage:owner",
      selected: true,
      role: "treeitem",
    }))
    expect(editorShell).toEqual(expect.objectContaining({
      status: "available",
      contributionId: "editor.contrib.coverageDecorations",
      stateSource: "TestingService.getCoverageEditorDecorationsProjection()",
      rangeModelShell: expect.objectContaining({
        kind: "coverage-details-range-model-shell",
        stateSource: "TestingService.getCoverageEditorDecorationsProjection()",
        coverageId: "coverage:owner",
        uri: "file:///workspace/src/owner.ts",
        lineRangeHint: { startLineNumber: 1, endLineNumber: 5 },
        detailAccessorCommandId: TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
        minimap: {
          projected: false,
          blockedOwner: "ITextModel.deltaDecorations/MinimapPosition",
        },
        injectedText: {
          projected: false,
          blockedOwner: "InjectedTextOptions",
        },
        overlayToolbar: {
          projected: false,
          blockedOwner: "CoverageToolbarWidget",
        },
        noSecondState: true,
      }),
      genericEditorShellContract: expect.objectContaining({
        status: "blocked",
        requiredEditorApis: expect.arrayContaining([
          "ICodeEditor.changeDecorations/create owner-scoped decorations",
          "ICodeEditor.changeViewZones",
        ]),
        requiredTextModelApis: expect.arrayContaining([
          "ITextModel.getAllDecorations",
          "ITextModel.getValueInRange",
        ]),
        noSecondState: true,
      }),
    }))
    expect(service.getProjection()).toEqual(expect.objectContaining({
      coverageOwnerFeasibility: service.getCoverageOwnerFeasibilityAudit(),
    }))
  })

  it("projects coverage range model shell evidence from TestingService without claiming ICodeEditor ownership", () => {
    const service = new TestingService()
    service.publishCoverage([{
      id: "coverage:range",
      uri: "file:///workspace/src/range.ts",
      statement: { covered: 0, total: 3 },
      branch: { covered: 0, total: 1 },
      testIds: ["vitest\u0000range"],
    }])
    service.openCoverage("coverage:range")
    service.setCoverageFilterToTest("vitest\u0000range")
    service.setCoverageInlineVisible(true)

    const projection = service.getCoverageEditorDecorationsProjection("file:///workspace/src/range.ts?version=1")

    expect(projection).toEqual(expect.objectContaining({
      status: "available",
      uri: "file:///workspace/src/range.ts",
      selectedCoverageId: "coverage:range",
      decoration: expect.objectContaining({
        id: "coverage:range",
        filteredToTestId: "vitest\u0000range",
        showInline: true,
        hasPerTestCoverage: true,
        commandIds: expect.arrayContaining([
          TESTING_COVERAGE_COMMAND_IDS.GoToNextMissedLine,
          TESTING_COVERAGE_COMMAND_IDS.GoToPreviousMissedLine,
          TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
        ]),
      }),
      rangeModelShell: expect.objectContaining({
        coverageId: "coverage:range",
        lineRangeHint: { startLineNumber: 1, endLineNumber: 3 },
        detailAccessorCommandId: TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
        blockedReason: expect.stringContaining("real range mapping"),
        noSecondState: true,
      }),
      adapter: expect.objectContaining({
        implementedOwners: expect.arrayContaining([
          "CoverageDetailsModel range model shell evidence",
        ]),
        blockedOwners: expect.arrayContaining([
          "ICodeEditor contribution registration",
          "model decorations/minimap/injected text",
          "coverage toolbar overlay widget",
        ]),
      }),
    }))
    expect(projection.rangeModelShell?.minimap.projected).toBe(false)
    expect(projection.rangeModelShell?.injectedText.projected).toBe(false)
    expect(projection.rangeModelShell?.overlayToolbar.projected).toBe(false)

    const shell = service.getCoverageEditorContributionShellProjection("file:///workspace/src/range.ts")
    expect(shell.rangeModelShell).toEqual(projection.rangeModelShell)
    expect(service.getCoverageOwnerFeasibilityAudit("file:///workspace/src/range.ts").remainingBlockers).toEqual(expect.arrayContaining([
      "Full CodeCoverageDecorations ICodeEditor contribution is not registered.",
      "CoverageDetailsModel range mapping/minimap/injected text/overlay toolbar are still blocked.",
    ]))
  })

  it("creates evidence-safe run debug and coverage actions without executing tests or mutating git", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 1, label: "Run", group: "run", isDefault: true })
    service.addProfile({ controllerId: "vitest", profileId: 2, label: "Debug", group: "debug", isDefault: true })
    service.upsertItem({ controllerId: "vitest", id: "vitest", label: "Vitest root", expand: "expanded" })
    service.upsertItem({ controllerId: "vitest", id: "vitest\u0000suite", parentId: "vitest", label: "suite", expand: "notExpandable" })

    const runAction = service.createRunAction({ group: "run", testIds: ["vitest\u0000suite"] })
    const debugAction = service.createRunAction({ group: "debug", testIds: ["vitest\u0000suite"] })
    const unavailableCoverageAction = service.createRunAction({ group: "coverage", testIds: ["vitest\u0000suite"] })

    expect(runAction).toEqual(expect.objectContaining({
      commandId: "testing.run",
      safeToExecute: false,
      mutatesWorkspace: false,
      mutatesGitIndex: false,
      profileId: 1,
      evidenceUri: "codek-testing://vitest/run/vitest%00suite",
    }))
    expect(debugAction).toEqual(expect.objectContaining({
      commandId: "testing.debug",
      safeToExecute: false,
      mutatesWorkspace: false,
      mutatesGitIndex: false,
      approvalRequired: true,
    }))
    expect(unavailableCoverageAction).toEqual(expect.objectContaining({
      commandId: "testing.coverage",
      enabled: false,
      reason: "No default coverage profile is registered for the selected tests",
    }))
    expect(service.getProjection().actions.map((action) => action.commandId)).toEqual(["testing.run", "testing.debug"])
  })

  it("resolves through testingService and testProfileService identifiers", () => {
    const service = new TestingService()
    const collection = new ServiceCollection([ITestingService, service], [ITestProfileService, service], [ITestResultService, service])
    const instantiationService = new InstantiationService(collection)

    expect(String(ITestingService)).toBe("testingService")
    expect(String(ITestProfileService)).toBe("testProfileService")
    expect(String(ITestResultService)).toBe("testResultService")
    expect(instantiationService.invokeFunction((accessor) => accessor.get(ITestingService))).toBe(service)
    expect(instantiationService.invokeFunction((accessor) => accessor.get(ITestProfileService))).toBe(service)
    expect(instantiationService.invokeFunction((accessor) => accessor.get(ITestResultService))).toBe(service)
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === ITestingService && instance === globalTestingService)).toBe(true)
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === ITestResultService && instance === globalTestingService)).toBe(true)
  })

  it("exposes VS Code testing contract evidence with the extension-host bridge connected", () => {
    const service = new TestingService()
    const contract = service.getContractAudit()

    expect(contract).toEqual(expect.objectContaining({
      codekStateSource: "TestingService.getProjection()",
      codekServiceIds: ["testingService", "testProfileService", "testResultService"],
      vscodeServiceId: "testService",
      noSecondState: true,
    }))
    expect(contract.vscodeSourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/testing/common/testService.ts",
      "src/vs/workbench/contrib/testing/common/testResultService.ts",
      "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
      "src/vs/workbench/api/browser/mainThreadTesting.ts",
      "src/vs/workbench/api/common/extHostTesting.ts",
    ]))
    expect(contract.extensionHostBridge).toEqual(expect.objectContaining({
      codekMainThreadAdapter: "desktop/services/extensions-host/mainThread/mainThreadTesting.js",
      status: "connected",
      adapterEvidence: {
        rpcMethods: expect.arrayContaining([
          "$registerTestController",
          "$updateController",
          "$removeTestProfile",
          "$publishDiff",
          "$addTestsToRun",
          "$appendCoverage",
          "$getCoverageDetails",
          "$runTests",
          "$startContinuousRun",
        ]),
        rendererEventChannels: expect.arrayContaining([
          "ext-host:testing-controller",
          "ext-host:testing-profile-update",
          "ext-host:testing-item",
          "ext-host:testing-item-remove",
          "ext-host:testing-run-start",
          "ext-host:testing-coverage",
        ]),
        backChannels: expect.arrayContaining([
          "ext-host:testing-cancel -> ExtHostTesting.$cancelExtensionTestRun",
          "ext-host:testing-configure-profile -> ExtHostTesting.$configureRunProfile",
          "ext-host:testing-coverage-details -> ExtHostTesting.$getCoverageDetails",
        ]),
      },
      callbacks: {
        cancellation: "connected",
        profileConfigure: "connected",
        coverageDetails: "connected",
        continuousRun: "projected",
      },
      coverageShellAudit: expect.objectContaining({
        status: "projected",
        stateSource: "TestingService coverage projections",
        noSecondState: true,
        implementedEvidence: expect.arrayContaining([
          "TestingService.getCoverageEditorDecorationsProjection()",
          "TestingService.getCoverageOwnerFeasibilityAudit()",
        ]),
        blockedOwners: expect.arrayContaining([
          "Full CodeCoverageDecorations ICodeEditor contribution",
          "CoverageDetailsModel range mapping/minimap/injected text/overlay toolbar",
        ]),
        blockedReason: expect.stringContaining("generic editor shell/App.vue ownership"),
      }),
    }))
    expect(contract.serviceOwnerMatrix).toEqual(expect.arrayContaining([
      expect.objectContaining({
        vscodeServiceId: "ITestService",
        decoratorId: "testService",
        status: "projected",
        codekOwner: "TestingService",
        codekStateSource: "TestingService controllers/items/runs/profiles",
        implementedEvidence: expect.arrayContaining([
          "ITestingService singleton uses the same TestingService instance",
          "MainThreadTesting controller/item/run RPCs project into TestingService",
        ]),
        blockedOwners: expect.arrayContaining([
          "ITestService.collection diff listener and busy provider model",
          "ITestService.registerExtHost followup provider owner",
        ]),
        noSecondState: true,
      }),
      expect.objectContaining({
        vscodeServiceId: "ITestProfileService",
        decoratorId: "testProfileService",
        status: "projected",
        codekOwner: "TestingService",
        codekStateSource: "TestingService profiles map",
        blockedOwners: expect.arrayContaining([
          "TestProfileService StoredValue preferred-profile persistence",
          "ExtHostTesting.$setDefaultRunProfiles synchronization",
        ]),
        noSecondState: true,
      }),
      expect.objectContaining({
        vscodeServiceId: "ITestResultService",
        decoratorId: "testResultService",
        status: "projected",
        codekOwner: "TestingService result service facade",
        codekStateSource: "TestingService runs/results/output",
        implementedEvidence: expect.arrayContaining([
          "ITestResultService singleton aliases the same TestingService instance for result service evidence",
          "TestingService.onResultsChanged emits inserted/completed/removed result events",
          "TestingService.onTestChanged emits computed state, message, and retired result item events",
          "TestingService.getResultStorageProjection serializes completed results with storedTestResults key evidence",
          "getResultHistoryProjection derives retained run/result summaries from TestingService maps",
        ]),
        blockedOwners: expect.arrayContaining([
          "LiveTestResult create/push/clear/dispose lifecycle",
          "TestResultStorage workspaceStorageHome file owner and output stream persistence",
        ]),
        noSecondState: true,
      }),
      expect.objectContaining({
        vscodeServiceId: "LiveTestResult",
        status: "blocked",
        blockedOwners: expect.arrayContaining([
          "LiveTestResult task model",
          "coverage detail lookup by result/task owner",
        ]),
        blockedReason: expect.stringContaining("retired-state evidence"),
        noSecondState: true,
      }),
      expect.objectContaining({
        vscodeServiceId: "TestMessageFollowupProvider",
        status: "partial",
        implementedEvidence: expect.arrayContaining([
          "TestingService.provideTestFollowups forwards TestMessage followup requests to extensionHostCallbacks",
          "desktop MainThreadTesting forwards followup IPC to ExtHostTesting VS Code RPC methods",
        ]),
        blockedOwners: expect.arrayContaining([
          "TestingOutputPeekController/PeekViewWidget owner for visible message reveal",
          "OutputPeekTree/TestMessageElement owner for selecting a TestMessage subject",
          "TestResultsViewContent FollowupActionWidget owner for requesting, rendering, executing, and disposing followup handles",
        ]),
        blockedReason: expect.stringContaining("FollowupActionWidget"),
        noSecondState: true,
      }),
    ]))
    expect(contract.extensionHostBridge.rpcMethodMatrix.controllerAndItem).toEqual(expect.arrayContaining([
      expect.objectContaining({
        vscodeMethod: "$registerTestController",
        vscodeOwner: "MainThreadTestingShape",
        status: "projected",
        rendererChannel: "ext-host:testing-controller",
      }),
      expect.objectContaining({
        vscodeMethod: "$publishDiff",
        vscodeOwner: "MainThreadTestingShape",
        status: "projected",
        rendererChannel: "ext-host:testing-item / ext-host:testing-item-remove",
      }),
      expect.objectContaining({
        vscodeMethod: "$subscribeToDiffs",
        status: "forwarded",
        backChannel: "MainThreadTesting.$subscribeToDiffs -> ExtHostTesting.$syncTests",
      }),
    ]))
    expect(contract.extensionHostBridge.rpcMethodMatrix.runProfile).toEqual(expect.arrayContaining([
      expect.objectContaining({
        vscodeMethod: "$publishTestRunProfile",
        status: "projected",
        rendererChannel: "ext-host:testing-profile",
      }),
      expect.objectContaining({
        vscodeMethod: "$configureRunProfile",
        vscodeOwner: "ExtHostTestingShape",
        status: "forwarded",
        backChannel: "ext-host:testing-configure-profile -> ExtHostTesting.$configureRunProfile",
      }),
      expect.objectContaining({
        vscodeMethod: "$setDefaultRunProfiles",
        status: "blocked",
        blockedOwner: "VS Code TestProfileService active/default profile synchronization",
      }),
    ]))
    expect(contract.extensionHostBridge.rpcMethodMatrix.runLifecycle).toEqual(expect.arrayContaining([
      expect.objectContaining({
        vscodeMethod: "$runTests",
        status: "forwarded",
        backChannel: "MainThreadTesting.$runTests -> ExtHostTesting.$runControllerTests",
      }),
      expect.objectContaining({
        vscodeMethod: "$startContinuousRun",
        status: "forwarded",
        rendererChannel: "ext-host:testing-run-start",
      }),
      expect.objectContaining({
        vscodeMethod: "$startedTestRunTask",
        status: "projected",
        rendererChannel: "ext-host:testing-run-task-start",
      }),
      expect.objectContaining({
        vscodeMethod: "$finishedTestRunTask",
        status: "projected",
        rendererChannel: "ext-host:testing-run-task-finish",
      }),
      expect.objectContaining({
        vscodeMethod: "$cancelExtensionTestRun",
        vscodeOwner: "ExtHostTestingShape",
        status: "forwarded",
      }),
    ]))
    expect(contract.extensionHostBridge.rpcMethodMatrix.resultAndCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        vscodeMethod: "$appendOutputToRun",
        status: "projected",
        rendererChannel: "ext-host:testing-run-output",
      }),
      expect.objectContaining({
        vscodeMethod: "$appendCoverage",
        status: "projected",
        rendererChannel: "ext-host:testing-coverage",
      }),
      expect.objectContaining({
        vscodeMethod: "$getCoverageDetails",
        vscodeOwner: "MainThreadTestingShape",
        status: "stubbed",
        blockedOwner: "VS Code TestCoverage/LiveTestResult coverage detail lookup",
      }),
      expect.objectContaining({
        vscodeMethod: "$getCoverageDetails",
        vscodeOwner: "ExtHostTestingShape",
        status: "forwarded",
        backChannel: "ext-host:testing-coverage-details -> ExtHostTesting.$getCoverageDetails",
      }),
      expect.objectContaining({
        vscodeMethod: "$publishTestResults",
        vscodeOwner: "ExtHostTestingShape",
        status: "forwarded",
        backChannel: "TestingService.completeRun -> extensionHostRuntimeBridge.publishExtHostTestingResults -> desktop mainThreadTesting ext-host:testing-publish-results -> ExtHostTesting.$publishTestResults",
      }),
    ]))
    expect(contract.extensionHostBridge.rpcMethodMatrix.extHostCallbacks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        vscodeMethod: "$refreshTests",
        status: "forwarded",
        backChannel: "ext-host:testing-refresh-tests -> ExtHostTesting.$refreshTests",
      }),
      expect.objectContaining({
        vscodeMethod: "$expandTest",
        status: "forwarded",
        backChannel: "ext-host:testing-expand-test -> ExtHostTesting.$expandTest",
      }),
      expect.objectContaining({
        vscodeMethod: "$getTestsRelatedToCode",
        status: "forwarded",
        backChannel: "ext-host:testing-tests-related-to-code -> ExtHostTesting.$getTestsRelatedToCode",
      }),
      expect.objectContaining({
        vscodeMethod: "$getCodeRelatedToTest",
        status: "forwarded",
        backChannel: "ext-host:testing-code-related-to-test -> ExtHostTesting.$getCodeRelatedToTest",
      }),
      expect.objectContaining({
        vscodeMethod: "$provideTestFollowups",
        status: "forwarded",
        backChannel: "ext-host:testing-provide-followups -> ExtHostTesting.$provideTestFollowups",
      }),
      expect.objectContaining({
        vscodeMethod: "$executeTestFollowup",
        status: "forwarded",
        backChannel: "ext-host:testing-execute-followup -> ExtHostTesting.$executeTestFollowup",
      }),
      expect.objectContaining({
        vscodeMethod: "$disposeTestFollowups",
        status: "forwarded",
        backChannel: "ext-host:testing-dispose-followups -> ExtHostTesting.$disposeTestFollowups",
      }),
    ]))
    contract.extensionHostBridge.adapterEvidence.rpcMethods.push("mutated")
    contract.extensionHostBridge.rpcMethodMatrix.extHostCallbacks[0].status = "projected"
    contract.extensionHostBridge.coverageShellAudit.blockedOwners.push("mutated")
    contract.serviceOwnerMatrix[0].implementedEvidence.push("mutated")
    contract.serviceOwnerMatrix[4].blockedOwners.push("mutated")
    const fresh = service.getContractAudit()
    expect(fresh.extensionHostBridge.adapterEvidence.rpcMethods).not.toContain("mutated")
    expect(fresh.extensionHostBridge.rpcMethodMatrix.extHostCallbacks[0].status).toBe("forwarded")
    expect(fresh.extensionHostBridge.coverageShellAudit.blockedOwners).not.toContain("mutated")
    expect(fresh.serviceOwnerMatrix[0].implementedEvidence).not.toContain("mutated")
    expect(fresh.serviceOwnerMatrix[4].blockedOwners).not.toContain("mutated")
    expect(contract.remainingGaps.join(" ")).toContain("Agent Evidence")
    expect(contract.remainingGaps.join(" ")).toContain("full VS Code Testing tree provider")
    expect(contract.remainingGaps.join(" ")).toContain("TestingContinuousRunService")
    expect(service.getProjection().contract).toEqual(fresh)
  })

  it("audits visible Testing UI callback bindings without pretending the VS Code explorer is migrated", () => {
    const service = new TestingService()
    const contract = service.getContractAudit()

    expect(contract.uiBinding).toEqual(expect.objectContaining({
      codekVisibleSurfacePath: "frontend/vite-project/src/App.vue:data-agent-evidence-surface=\"testing\"",
      callbackCommandBinding: "commandRegistry",
    }))
    expect(contract.uiBinding.vscodeVisibleEntryPaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/testing/browser/testExplorerActions.ts",
      "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
      "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsTree.ts",
      "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
      "src/vs/workbench/contrib/testing/common/testCoverage.ts",
    ]))
    expect(contract.uiBinding.visibleActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        commandId: TESTING_CALLBACK_COMMAND_IDS.CancelRun,
        codekBinding: "registered-command-facade",
        visibleInCodek: false,
        vscodeEntry: expect.stringContaining("CancelTestRunAction"),
      }),
      expect.objectContaining({
        commandId: TESTING_PEEK_COMMAND_IDS.OpenOutputPeek,
        codekBinding: "registered-command-facade",
        visibleInCodek: false,
        vscodeEntry: expect.stringContaining("ITestingPeekOpener.open()"),
      }),
      expect.objectContaining({
        commandId: TESTING_CALLBACK_COMMAND_IDS.ConfigureProfile,
        codekBinding: "registered-command-facade",
        visibleInCodek: false,
        vscodeEntry: expect.stringContaining("ConfigureTestProfilesAction"),
      }),
      expect.objectContaining({
        commandId: TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
        codekBinding: "registered-command-facade",
        visibleInCodek: false,
        vscodeEntry: expect.stringContaining("CoverageDetailsModel"),
      }),
    ]))
    expect(contract.uiBinding.blockedUiGaps.join(" ")).toContain("No standalone Codek Test Explorer")
    expect(contract.uiBinding.blockedUiGaps.join(" ")).toContain("coverage tree")
  })

  it("publishes a minimal Explorer result peek and coverage tree capability snapshot", () => {
    const service = new TestingService()
    const contract = service.getContractAudit()

    expect(contract.uiCapabilities.treeProvider).toEqual(expect.objectContaining({
      status: "partial",
      codekOwner: "TestingService",
      codekStateSource: "TestingService.getProjection().items/actions/runSummary",
      commandIds: expect.arrayContaining([
        "testing.run",
        "testing.debug",
        "testing.coverage",
        TESTING_CALLBACK_COMMAND_IDS.ConfigureProfile,
      ]),
      reason: expect.stringContaining("does not own a VS Code TestingExplorerView"),
      missingOwnership: expect.arrayContaining([
        "TestingExplorerViewModel and Tree/List projections",
        "TestingContinuousRunService UI ownership",
      ]),
    }))
    expect(contract.uiCapabilities.treeProvider.vscodeSourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
      "src/vs/workbench/contrib/testing/common/testingContinuousRunService.ts",
    ]))

    expect(contract.uiCapabilities.resultPeek).toEqual(expect.objectContaining({
      status: "partial",
      codekStateSource: "TestingService.getResultHistoryProjection()+getResultPeekProjection()",
      commandIds: expect.arrayContaining([
        TESTING_PEEK_COMMAND_IDS.OpenOutputPeek,
        TESTING_CALLBACK_COMMAND_IDS.CancelRun,
        "testing.run",
        "testing.debug",
      ]),
      reason: expect.stringContaining("service-level event/storage evidence"),
      missingOwnership: expect.arrayContaining([
        "OutputPeekTree and Test Results View content",
        "TestingOutputPeekController editor contribution and PeekViewWidget",
        "LiveTestResult object lifecycle and file-backed TestResultStorage output persistence",
      ]),
    }))
    expect(contract.uiCapabilities.resultPeek.vscodeSourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsTree.ts",
      "src/vs/workbench/contrib/testing/common/testResultService.ts",
    ]))

    expect(contract.uiCapabilities.coverageTree).toEqual(expect.objectContaining({
      status: "partial",
      codekStateSource: "TestingService.getCoverageTreeProjection()",
      commandIds: expect.arrayContaining([
        TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
        TESTING_COVERAGE_COMMAND_IDS.OpenCoverage,
        TESTING_COVERAGE_COMMAND_IDS.ToggleInlineCoverage,
        TESTING_COVERAGE_COMMAND_IDS.FilterToTest,
        "testing.coverage",
      ]),
      reason: expect.stringContaining("coverage view and editor decoration shell projections"),
      missingOwnership: expect.arrayContaining([
        "Full TestCoverageView/TestCoverageTree DOM owner",
        "Full CodeCoverageDecorations editor contribution",
        "CoverageDetailsModel range mapping/minimap/injected text/overlay toolbar",
      ]),
    }))
    expect(contract.uiCapabilities.coverageTree.vscodeSourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/testing/browser/testCoverageView.ts",
      "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
      "src/vs/workbench/contrib/testing/common/testCoverageService.ts",
    ]))
  })

  it("audits precise Testing owner contracts for explorer tree result peek coverage editor and continuous run", () => {
    const service = new TestingService()
    const contract = service.getContractAudit()

    expect(contract.ownerContracts.testExplorerTree).toEqual(expect.objectContaining({
      status: "projected",
      codekStateSource: "TestingService.getProjection().items/actions/runSummary",
      noSecondState: true,
      vscodeSourcePaths: expect.arrayContaining([
        "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
        "src/vs/workbench/contrib/testing/browser/explorerProjections/treeProjection.ts",
        "src/vs/workbench/contrib/testing/browser/testingExplorerFilter.ts",
        "src/vs/workbench/contrib/testing/common/testingContinuousRunService.ts",
      ]),
      codekCanProvide: expect.arrayContaining([
        "parent-child test item projections",
        "run/debug/coverage command descriptors and commandRegistry execution entrypoints",
      ]),
      vscodeRequiredOwners: expect.arrayContaining([
        "TestingExplorerView extends ViewPane renderBody/layoutBody/focus",
        "TestingExplorerViewModel and TestingObjectTree lifecycle",
        "TestingExplorerFilter input/action bar and context keys",
      ]),
      blockedMatrix: expect.arrayContaining([
        expect.objectContaining({
          capability: "TestingExplorerView pane shell",
          blockedOwner: "TestingExplorerView extends ViewPane renderBody/layoutBody/focus owner",
        }),
        expect.objectContaining({
          capability: "TestingViewPaneContainer sidebar owner",
          blockedOwner: "TestingViewPaneContainer extends ViewPaneContainer instance and sidebar DOM lifecycle",
        }),
        expect.objectContaining({
          capability: "WorkbenchObjectTree virtualization",
          blockedOwner: "TestingObjectTree extends WorkbenchObjectTree DOM virtualization, keyboard, and optimized-view-state saver",
        }),
      ]),
      blockedReason: expect.stringContaining("does not own the VS Code TestingExplorerView ViewPane"),
    }))

    expect(contract.ownerContracts.resultPeek).toEqual(expect.objectContaining({
      status: "projected",
      codekStateSource: "TestingService.getResultHistoryProjection()/getResultPeekProjection()/openResultPeek()",
      noSecondState: true,
      vscodeSourcePaths: expect.arrayContaining([
        "src/vs/workbench/contrib/testing/common/testResultService.ts",
        "src/vs/workbench/contrib/testing/browser/testingOutputPeek.ts",
        "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsViewContent.ts",
        "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsTree.ts",
      ]),
      codekCanProvide: expect.arrayContaining([
        "retained run/result history snapshots and per-run summaries",
        "latest run id and result entries",
        "testing.openOutputPeek descriptor",
      ]),
      vscodeRequiredOwners: expect.arrayContaining([
        "LiveTestResult object lifecycle and file-backed TestResultStorage output persistence",
        "TestingOutputPeekController and PeekViewWidget editor contribution",
        "TestResultsViewContent/TestResultsTree DOM and action runner",
      ]),
      availableEvidence: expect.arrayContaining([
        expect.objectContaining({
          capability: "retained result history projection",
          stateSource: "TestingService.getResultHistoryProjection()",
        }),
        expect.objectContaining({
          capability: "TestResultService events",
          stateSource: "TestingService onResultsChanged/onTestChanged",
        }),
        expect.objectContaining({
          capability: "result storage persistence",
          stateSource: "TestingService.getResultStorageProjection()",
        }),
      ]),
      blockedMatrix: expect.arrayContaining([
        expect.objectContaining({
          capability: "LiveTestResult lifecycle",
          blockedOwner: "LiveTestResult object/disposable/telemetry owner",
        }),
        expect.objectContaining({
          capability: "file-backed result output persistence",
          blockedOwner: "TestResultStorage workspaceStorageHome/output stream owner",
        }),
        expect.objectContaining({
          capability: "visible result peek UI",
          blockedOwner: "TestingOutputPeekController/PeekViewWidget/TestResultsViewContent",
        }),
        expect.objectContaining({
          capability: "Test Results panel shell rows",
          blockedOwner: "TestResultsViewContent SplitView/TestResultsTree render owner",
        }),
        expect.objectContaining({
          capability: "message followup actions",
          blockedOwner: "FollowupActionWidget request/render/execute/dispose owner",
        }),
      ]),
      blockedReason: expect.stringContaining("does not own LiveTestResult instances"),
    }))

    expect(contract.ownerContracts.coverageEditor).toEqual(expect.objectContaining({
      status: "projected",
      codekStateSource: "TestingService.getCoverageEditorDecorationsProjection()/getCoverageEditorContributionShellProjection()",
      noSecondState: true,
      vscodeSourcePaths: expect.arrayContaining([
        "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
        "src/vs/workbench/contrib/testing/common/testCoverageService.ts",
      ]),
      codekCanProvide: expect.arrayContaining([
        "selected coverage file lookup",
        "CoverageDetailsModel range model shell",
      ]),
      vscodeRequiredOwners: expect.arrayContaining([
        "CodeCoverageDecorations registered as editor.contrib.coverageDecorations",
        "ICodeEditor model/configuration/mouse/decorations/view zones/overlay widget APIs",
        "CoverageToolbarWidget and minimap/injected text decorations",
      ]),
      blockedReason: expect.stringContaining("generic ICodeEditor/TextModel contribution shell"),
    }))

	    expect(contract.ownerContracts.continuousRun).toEqual(expect.objectContaining({
	      status: "projected",
	      codekStateSource: "TestingService continuous run facade -> TestingService.startRun projection",
	      noSecondState: true,
      vscodeSourcePaths: expect.arrayContaining([
        "src/vs/workbench/contrib/testing/common/testingContinuousRunService.ts",
        "src/vs/workbench/contrib/testing/common/testServiceImpl.ts",
        "src/vs/workbench/contrib/testing/browser/testExplorerActions.ts",
        "src/vs/workbench/api/browser/mainThreadTesting.ts",
      ]),
	      codekCanProvide: expect.arrayContaining([
	        "$startContinuousRun bridge event evidence",
	        "TestingService.startContinuousRun/stopContinuousRun/toggleContinuousRunForTest executable facade",
	        "run-start projection with continuous request metadata",
	        "service-level testing.supportsContinuousRun/testing.isContinuousModeOn context-key evidence derived from profiles+runs",
	      ]),
      vscodeRequiredOwners: expect.arrayContaining([
        "TestingContinuousRunService prefix-tree running state",
        "lastContinuousRunProfileIds workspace storage",
        "profile default-change restart via CancellationTokenSource",
        "selectContinuousRunProfiles quick pick and last-run profile preselection",
        "TestingExplorerView item context overlay for testing.isParentRunningContinuously and action refresh",
      ]),
      availableEvidence: expect.arrayContaining([
        expect.objectContaining({
          capability: "ExtHost continuous run bridge",
          stateSource: "desktop mainThreadTesting.$startContinuousRun",
        }),
        expect.objectContaining({
          capability: "continuous run request metadata",
          stateSource: "TestingService.startRun()/getRuns()",
        }),
	        expect.objectContaining({
	          capability: "service-level start/stop continuous run facade",
	          stateSource: "TestingService.startContinuousRun()/stopContinuousRun()",
	        }),
	        expect.objectContaining({
	          capability: "service-level continuous context keys",
	          stateSource: "TestingService.getContinuousContextKeyProjection()",
	        }),
      ]),
      blockedMatrix: expect.arrayContaining([
        expect.objectContaining({
          capability: "global/test-specific running state",
          blockedOwner: "TestingContinuousRunService running WellDefinedPrefixTree",
        }),
        expect.objectContaining({
          capability: "last-run profile persistence",
          blockedOwner: "StoredValue<Set<number>> lastContinuousRunProfileIds",
        }),
        expect.objectContaining({
          capability: "restart/cancel on profile changes",
          blockedOwner: "CancellationTokenSource plus testProfileService.onDidChange autorun",
        }),
        expect.objectContaining({
          capability: "visible explorer actions and context keys",
          blockedOwner: "TestingExplorerView/testExplorerActions/TestingContextKeys",
        }),
      ]),
	      blockedReason: expect.stringContaining("does not own VS Code continuous-run storage"),
	    }))

    contract.ownerContracts.testExplorerTree.codekCanProvide.push("mutated")
    contract.ownerContracts.resultPeek.vscodeRequiredOwners.push("mutated")
    contract.ownerContracts.coverageEditor.vscodeSourcePaths.push("mutated")
    contract.ownerContracts.continuousRun.codekCanProvide.push("mutated")
    contract.ownerContracts.continuousRun.availableEvidence?.push({
      capability: "mutated",
      stateSource: "mutated",
      evidence: "mutated",
    })
    contract.ownerContracts.continuousRun.blockedMatrix?.push({
      capability: "mutated",
      blockedOwner: "mutated",
      blockedReason: "mutated",
    })
    contract.ownerContracts.resultPeek.availableEvidence?.push({
      capability: "mutated",
      stateSource: "mutated",
      evidence: "mutated",
    })
    contract.ownerContracts.resultPeek.blockedMatrix?.push({
      capability: "mutated",
      blockedOwner: "mutated",
      blockedReason: "mutated",
    })
    contract.ownerContracts.continuousRun.actionContextMatrix?.[1].contextKeys.push("mutated")
    const fresh = service.getContractAudit()
    expect(fresh.ownerContracts.testExplorerTree.codekCanProvide).not.toContain("mutated")
    expect(fresh.ownerContracts.resultPeek.vscodeRequiredOwners).not.toContain("mutated")
    expect(fresh.ownerContracts.coverageEditor.vscodeSourcePaths).not.toContain("mutated")
    expect(fresh.ownerContracts.continuousRun.codekCanProvide).not.toContain("mutated")
    expect(fresh.ownerContracts.continuousRun.availableEvidence?.map((entry) => entry.capability)).not.toContain("mutated")
    expect(fresh.ownerContracts.continuousRun.blockedMatrix?.map((entry) => entry.capability)).not.toContain("mutated")
    expect(fresh.ownerContracts.resultPeek.availableEvidence?.map((entry) => entry.capability)).not.toContain("mutated")
    expect(fresh.ownerContracts.resultPeek.blockedMatrix?.map((entry) => entry.capability)).not.toContain("mutated")
    expect(fresh.ownerContracts.continuousRun.actionContextMatrix?.flatMap((entry) => entry.contextKeys)).not.toContain("mutated")
  })

  it("projects continuous run metadata through TestingService while blocking VS Code ContinuousRunService owners", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 7, label: "Watch", group: "run", isDefault: true, supportsContinuousRun: true })
    service.upsertItem({ controllerId: "vitest", id: "vitest", label: "Vitest root", expand: "expanded" })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src/testing/testingService.test.ts",
      parentId: "vitest",
      label: "testingService.test.ts",
      expand: "notExpandable",
    })

    service.startRun({
      id: "run:continuous",
      controllerId: "vitest",
      profileId: 7,
      group: "run",
      testIds: ["vitest\u0000src/testing/testingService.test.ts"],
      label: "Continuous run",
      continuous: true,
    })

    const projection = service.getProjection()
    const continuousRun = projection.runs.find((run) => run.id === "run:continuous")
    expect(continuousRun).toEqual(expect.objectContaining({
      continuous: true,
      profileId: 7,
      group: "run",
      testIds: ["vitest\u0000src/testing/testingService.test.ts"],
    }))
	    expect(projection.contract.ownerContracts.continuousRun).toEqual(expect.objectContaining({
	      status: "projected",
	      codekStateSource: "TestingService continuous run facade -> TestingService.startRun projection",
      noSecondState: true,
      availableEvidence: expect.arrayContaining([
        expect.objectContaining({
          capability: "continuous run request metadata",
          evidence: expect.stringContaining("request.continuous"),
        }),
        expect.objectContaining({
          capability: "single service projection",
          stateSource: "TestingService.getProjection().runs",
        }),
	        expect.objectContaining({
	          capability: "service-level start/stop continuous run facade",
	          stateSource: "TestingService.startContinuousRun()/stopContinuousRun()",
	        }),
	        expect.objectContaining({
	          capability: "service-level continuous context keys",
	          stateSource: "TestingService.getContinuousContextKeyProjection()",
	        }),
      ]),
      blockedMatrix: expect.arrayContaining([
	        expect.objectContaining({
	          blockedOwner: "TestingContinuousRunService running WellDefinedPrefixTree",
	          blockedReason: expect.stringContaining("does not own VS Code's WellDefinedPrefixTree semantics"),
	        }),
        expect.objectContaining({
          blockedOwner: "TestingExplorerView/testExplorerActions/TestingContextKeys",
          blockedReason: expect.stringContaining("does not migrate TestingExplorerView"),
        }),
      ]),
      actionContextMatrix: expect.arrayContaining([
        expect.objectContaining({
          surface: "continuous run request metadata",
          codekProjection: "projected",
          evidence: expect.stringContaining("continuous/profile/test metadata"),
        }),
	        expect.objectContaining({
	          surface: "Test Explorer item toggle continuous run",
	          codekProjection: "projected",
          contextKeys: expect.arrayContaining([
            "testing.supportsContinuousRun",
            "testing.isContinuousModeOn",
            "testing.isParentRunningContinuously",
          ]),
	          blockedOwner: "TestingExplorerView + MenuId.TestItem visible action runner",
	        }),
	        expect.objectContaining({
	          surface: "Test Explorer view title start/stop continuous run",
	          codekProjection: "projected",
          contextKeys: expect.arrayContaining([
            "view == workbench.view.testing",
            "testing.supportsContinuousRun",
            "testing.isContinuousModeOn",
          ]),
	          blockedOwner: "ViewTitle menu + TestingExplorerView action refresh",
	        }),
        expect.objectContaining({
          surface: "continuous run profile selection",
          codekProjection: "projected",
          blockedOwner: expect.stringContaining("IQuickInputService"),
        }),
        expect.objectContaining({
          surface: "Testing context keys",
          codekProjection: "projected",
          contextKeys: expect.arrayContaining([
            "testing.isContinuousModeOn",
            "testing.supportsContinuousRun",
            "testing.isParentRunningContinuously",
          ]),
          blockedOwner: expect.stringContaining("TestingExplorerView context overlay consumer"),
        }),
      ]),
    }))
    expect(projection.continuousContextKeys).toEqual(expect.objectContaining({
      stateSource: "TestingService profiles+runs+items",
      serviceLevelKeys: {
        "testing.supportsContinuousRun": true,
        "testing.isContinuousModeOn": true,
      },
      implementedKeys: [
        "testing.supportsContinuousRun",
        "testing.isContinuousModeOn",
        "testing.isParentRunningContinuously",
      ],
      menuOverlayBlockedKeys: [
        "testing.isParentRunningContinuously",
      ],
      blockedKeys: [],
      noSecondState: true,
    }))
  })

  it("documents the continuous run action and context-key owner matrix without migrating the Explorer UI", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 9, label: "Watch", group: "run", isDefault: true, supportsContinuousRun: true })
    service.startRun({
      id: "run:watch",
      controllerId: "vitest",
      profileId: 9,
      group: "run",
      testIds: ["vitest\u0000src/watch.test.ts"],
      continuous: true,
    })

    const projection = service.getProjection()
    const matrix = projection.contract.ownerContracts.continuousRun.actionContextMatrix ?? []
    const bySurface = new Map(matrix.map((entry) => [entry.surface, entry]))

    expect(projection.runs).toEqual([
      expect.objectContaining({
        id: "run:watch",
        continuous: true,
        profileId: 9,
        testIds: ["vitest\u0000src/watch.test.ts"],
      }),
    ])
    expect(bySurface.get("continuous run request metadata")).toEqual(expect.objectContaining({
      vscodeEntry: "testingContinuousRunService.ts start() -> testService.startContinuousRun({ continuous: true })",
      codekProjection: "projected",
      blockedOwner: "none",
    }))
	    expect(bySurface.get("Test Explorer item toggle continuous run")).toEqual(expect.objectContaining({
	      vscodeEntry: "testExplorerActions.ts ContinuousRunTestAction/ContinuousRunUsingProfileTestAction",
	      codekProjection: "projected",
      contextKeys: [
        "testing.supportsContinuousRun",
        "testing.isContinuousModeOn",
        "testing.isParentRunningContinuously",
      ],
	      blockedOwner: "TestingExplorerView + MenuId.TestItem visible action runner",
	    }))
	    expect(bySurface.get("Test Explorer view title start/stop continuous run")).toEqual(expect.objectContaining({
	      vscodeEntry: "testExplorerActions.ts StartContinuousRunAction/StopContinuousRunAction",
	      codekProjection: "projected",
	      blockedOwner: "ViewTitle menu + TestingExplorerView action refresh",
	    }))
    expect(bySurface.get("continuous run profile selection")).toEqual(expect.objectContaining({
      vscodeEntry: "testExplorerActions.ts selectContinuousRunProfiles()",
      codekProjection: "projected",
      blockedOwner: "IQuickInputService + StoredValue<Set<number>> lastContinuousRunProfileIds",
    }))
    expect(bySurface.get("Testing context keys")).toEqual(expect.objectContaining({
      vscodeEntry: "testingContextKeys.ts isContinuousModeOn/supportsContinuousRun/isParentRunningContinuously",
      codekProjection: "projected",
      blockedOwner: "TestingExplorerView context overlay consumer",
    }))
    expect(matrix.every((entry) => entry.blockedReason.length > 0)).toBe(true)
    expect(projection.contract.ownerContracts.continuousRun.noSecondState).toBe(true)
  })

  it("projects continuous context keys from TestingService into ContextKeyService without a second state source", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 1, label: "Run", group: "run", isDefault: true })
    service.addProfile({ controllerId: "vitest", profileId: 2, label: "Watch", group: "run", isDefault: false, supportsContinuousRun: true })
    service.upsertItem({ controllerId: "vitest", id: "vitest", label: "Vitest root", expand: "expanded" })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src",
      parentId: "vitest",
      label: "src",
      expand: "expanded",
    })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src\u0000watch.test.ts",
      parentId: "vitest\u0000src",
      label: "watch.test.ts",
      expand: "notExpandable",
    })

    let projection = service.getContinuousContextKeyProjection()
    expect(projection.serviceLevelKeys).toEqual({
      "testing.supportsContinuousRun": true,
      "testing.isContinuousModeOn": false,
    })
    expect(projection.itemContextKeys.find((item) => item.testId === "vitest\u0000src\u0000watch.test.ts")).toEqual(
      expect.objectContaining({
        supportsContinuousRun: true,
        isContinuousModeOn: false,
        isParentRunningContinuously: false,
        contextKeyState: {
          "testing.supportsContinuousRun": true,
          "testing.isContinuousModeOn": false,
          "testing.isParentRunningContinuously": false,
        },
      }),
    )

    service.startRun({
      id: "run:watch-src",
      controllerId: "vitest",
      profileId: 2,
      group: "run",
      testIds: ["vitest\u0000src"],
      continuous: true,
    })
    projection = service.getContinuousContextKeyProjection()
    const contextKeyService = new ContextKeyService()
    contextKeyService.updateContext(projection.serviceLevelKeys)

    expect(contextKeyService.getContextKeyValue("testing.supportsContinuousRun")).toBe(true)
    expect(contextKeyService.getContextKeyValue("testing.isContinuousModeOn")).toBe(true)
    expect(projection.itemContextKeys.find((item) => item.testId === "vitest\u0000src")).toEqual(
      expect.objectContaining({
        isContinuousModeOn: true,
        isParentRunningContinuously: false,
      }),
    )
    expect(projection.itemContextKeys.find((item) => item.testId === "vitest\u0000src\u0000watch.test.ts")).toEqual(
      expect.objectContaining({
        isContinuousModeOn: true,
        isParentRunningContinuously: true,
      }),
    )

    service.completeRun("run:watch-src", "passed")
    expect(service.getContinuousContextKeyProjection().serviceLevelKeys).toEqual({
      "testing.supportsContinuousRun": true,
      "testing.isContinuousModeOn": false,
    })
  })

  it("starts and stops item continuous runs through a TestingService facade without a second state source", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 1, label: "Run", group: "run", isDefault: true })
    service.addProfile({ controllerId: "vitest", profileId: 2, label: "Watch", group: "run", isDefault: true, supportsContinuousRun: true })
    service.upsertItem({ controllerId: "vitest", id: "vitest", label: "Vitest root", expand: "expanded" })
    service.upsertItem({ controllerId: "vitest", id: "vitest\u0000src", parentId: "vitest", label: "src", expand: "expanded" })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src\u0000watch.test.ts",
      parentId: "vitest\u0000src",
      label: "watch.test.ts",
      expand: "notExpandable",
    })

    const started = service.startContinuousRun({ testId: "vitest\u0000src" })

    expect(started).toEqual(expect.objectContaining({
      id: "continuous:vitest:2:vitest%00src",
      controllerId: "vitest",
      profileId: 2,
      group: "run",
      testIds: ["vitest\u0000src"],
      continuous: true,
      state: "running",
    }))
    expect(service.getRuns()).toEqual([
      expect.objectContaining({
        id: "continuous:vitest:2:vitest%00src",
        continuous: true,
        profileId: 2,
        testIds: ["vitest\u0000src"],
      }),
    ])
    expect(service.getContinuousContextKeyProjection()).toEqual(expect.objectContaining({
      serviceLevelKeys: {
        "testing.supportsContinuousRun": true,
        "testing.isContinuousModeOn": true,
      },
      itemContextKeys: expect.arrayContaining([
        expect.objectContaining({
          testId: "vitest\u0000src",
          isContinuousModeOn: true,
          isParentRunningContinuously: false,
        }),
        expect.objectContaining({
          testId: "vitest\u0000src\u0000watch.test.ts",
          isContinuousModeOn: true,
          isParentRunningContinuously: true,
        }),
      ]),
    }))

    expect(service.stopContinuousRun({ testId: "vitest\u0000src" })).toEqual([
      expect.objectContaining({
        id: "continuous:vitest:2:vitest%00src",
        state: "skipped",
        continuous: true,
      }),
    ])
    expect(service.getContinuousContextKeyProjection().serviceLevelKeys).toEqual({
      "testing.supportsContinuousRun": true,
      "testing.isContinuousModeOn": false,
    })
  })

  it("toggles a specific continuous run item while leaving parent-run blocking to TestingExplorerView", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 7, label: "Watch", group: "run", isDefault: true, supportsContinuousRun: true })
    service.upsertItem({ controllerId: "vitest", id: "vitest", label: "Vitest root", expand: "expanded" })
    service.upsertItem({ controllerId: "vitest", id: "vitest\u0000suite", parentId: "vitest", label: "suite", expand: "expanded" })
    service.upsertItem({ controllerId: "vitest", id: "vitest\u0000suite\u0000case", parentId: "vitest\u0000suite", label: "case", expand: "notExpandable" })

    const parentRun = service.toggleContinuousRunForTest("vitest\u0000suite")
    const childContext = service.getContinuousContextKeyProjection().itemContextKeys.find((item) => item.testId === "vitest\u0000suite\u0000case")

    expect(parentRun.action).toBe("started")
    expect(parentRun.run).toEqual(expect.objectContaining({
      id: "continuous:vitest:7:vitest%00suite",
      continuous: true,
      testIds: ["vitest\u0000suite"],
    }))
    expect(childContext).toEqual(expect.objectContaining({
      isContinuousModeOn: true,
      isParentRunningContinuously: true,
    }))

    const stopped = service.toggleContinuousRunForTest("vitest\u0000suite")
    expect(stopped.action).toBe("stopped")
    expect(stopped.stoppedRuns).toEqual([
      expect.objectContaining({
        id: "continuous:vitest:7:vitest%00suite",
        state: "skipped",
      }),
    ])
    expect(service.getContinuousContextKeyProjection().itemContextKeys.find((item) => item.testId === "vitest\u0000suite\u0000case")).toEqual(
      expect.objectContaining({
        isContinuousModeOn: false,
        isParentRunningContinuously: false,
      }),
    )
  })

  it("exposes continuous run service contract coverage while keeping storage restart and Explorer DOM owners blocked", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 3, label: "Watch", group: "run", isDefault: true, supportsContinuousRun: true })
    service.upsertItem({ controllerId: "vitest", id: "vitest", label: "Vitest root", expand: "expanded" })

    const globalRun = service.startContinuousRun({ controllerId: "vitest" })
    const contract = service.getContractAudit().ownerContracts.continuousRun

    expect(globalRun).toEqual(expect.objectContaining({
      id: "continuous:vitest:3:vitest",
      testIds: ["vitest"],
      continuous: true,
    }))
    expect(contract).toEqual(expect.objectContaining({
      status: "projected",
      codekStateSource: "TestingService continuous run facade -> TestingService.startRun projection",
      noSecondState: true,
      codekCanProvide: expect.arrayContaining([
        "TestingService.startContinuousRun/stopContinuousRun/toggleContinuousRunForTest executable facade",
      ]),
      availableEvidence: expect.arrayContaining([
        expect.objectContaining({
          capability: "service-level start/stop continuous run facade",
          stateSource: "TestingService.startContinuousRun()/stopContinuousRun()",
          evidence: expect.stringContaining("single TestingService run map"),
        }),
      ]),
      blockedMatrix: expect.arrayContaining([
        expect.objectContaining({
          blockedOwner: "StoredValue<Set<number>> lastContinuousRunProfileIds",
        }),
        expect.objectContaining({
          blockedOwner: "CancellationTokenSource plus testProfileService.onDidChange autorun",
        }),
        expect.objectContaining({
          blockedOwner: "TestingExplorerView/testExplorerActions/TestingContextKeys",
        }),
      ]),
      actionContextMatrix: expect.arrayContaining([
        expect.objectContaining({
          surface: "Test Explorer item toggle continuous run",
          codekProjection: "projected",
          evidence: expect.stringContaining("toggleContinuousRunForTest"),
          blockedOwner: "TestingExplorerView + MenuId.TestItem visible action runner",
        }),
        expect.objectContaining({
          surface: "Test Explorer view title start/stop continuous run",
          codekProjection: "projected",
          evidence: expect.stringContaining("startContinuousRun/stopContinuousRun"),
          blockedOwner: "ViewTitle menu + TestingExplorerView action refresh",
        }),
      ]),
    }))
    expect(contract.blockedReason).toContain("storage")
    expect(contract.blockedReason).toContain("Explorer action refresh")
    expect(service.stopContinuousRun()).toEqual([expect.objectContaining({ id: "continuous:vitest:3:vitest" })])
  })

  it("projects Testing Explorer prefix tree, reveal storage and restart-cancel lifecycle evidence without a DOM owner", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 3, label: "Watch", group: "run", isDefault: true, supportsContinuousRun: true })
    service.upsertItem({ controllerId: "vitest", id: "vitest", label: "Vitest root", expand: "expanded" })
    service.upsertItem({ controllerId: "vitest", id: "vitest\u0000src", parentId: "vitest", label: "src", expand: "expanded" })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src\u0000explorer.test.ts",
      parentId: "vitest\u0000src",
      label: "explorer.test.ts",
      uri: "file:///workspace/src/explorer.test.ts",
      expand: "notExpandable",
    })
    service.startContinuousRun({ testId: "vitest\u0000src" })

    const contract = service.getTestingExplorerContractProjection({
      revealTestId: "vitest\u0000src\u0000explorer.test.ts",
      persistedState: {
        expandedIds: ["vitest", "vitest\u0000src"],
        viewMode: "tree",
        sorting: "location",
      },
    })

    expect(contract).toEqual(expect.objectContaining({
      status: "partial",
      stateSource: "TestingService.getProjection().items/runs/profiles",
      noSecondState: true,
      blockedReason: expect.stringContaining("TestingExplorerView"),
      vscodeSourcePaths: expect.arrayContaining([
        "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
        "src/vs/workbench/contrib/testing/browser/testingViewPaneContainer.ts",
        "src/vs/workbench/contrib/testing/browser/explorerProjections/testingObjectTree.ts",
        "src/vs/workbench/contrib/testing/browser/testExplorerActions.ts",
        "src/vs/workbench/contrib/testing/common/testExplorerFilterState.ts",
        "src/vs/workbench/contrib/testing/common/testingContinuousRunService.ts",
        "src/vs/workbench/contrib/testing/common/storedValue.ts",
      ]),
      rows: [
        expect.objectContaining({ id: "vitest", depth: 0, prefixPath: ["vitest"], childIds: ["vitest\u0000src"] }),
        expect.objectContaining({ id: "vitest\u0000src", depth: 1, prefixPath: ["vitest", "src"], childIds: ["vitest\u0000src\u0000explorer.test.ts"] }),
        expect.objectContaining({
          id: "vitest\u0000src\u0000explorer.test.ts",
          depth: 2,
          prefixPath: ["vitest", "src", "explorer.test.ts"],
          parentChain: ["vitest", "vitest\u0000src"],
          revealState: "target",
          isParentRunningContinuously: true,
        }),
      ],
    }))
    expect(contract.persistedState).toEqual({
      status: "projected",
      source: "external TestingExplorerView persistedState input",
      expandedIds: ["vitest", "vitest\u0000src"],
      selectedId: "vitest\u0000src\u0000explorer.test.ts",
      revealId: "vitest\u0000src\u0000explorer.test.ts",
      viewMode: "tree",
      sorting: "location",
      blockedOwner: "IStorageService/StoredValue owned by VS Code TestingExplorerView",
    })
    expect(contract.lifecycle).toEqual(expect.objectContaining({
      activeContinuousRunIds: ["continuous:vitest:3:vitest%00src"],
      prefixRunningRoots: ["vitest\u0000src"],
      restartOnProfileChange: expect.objectContaining({
        status: "blocked",
        blockedOwner: "TestingContinuousRunService autorunIterableDelta + CancellationTokenSource",
      }),
      cancelOrder: expect.objectContaining({
        status: "projected",
        order: ["vitest\u0000src\u0000explorer.test.ts", "vitest\u0000src"],
      }),
    }))

    contract.rows[0].childIds.push("mutated")
    contract.persistedState.expandedIds.push("mutated")
    contract.lifecycle.activeContinuousRunIds.push("mutated")

    const fresh = service.getTestingExplorerContractProjection({ revealTestId: "vitest\u0000src\u0000explorer.test.ts" })
    expect(fresh.rows[0].childIds).not.toContain("mutated")
    expect(fresh.persistedState.expandedIds).not.toContain("mutated")
    expect(fresh.lifecycle.activeContinuousRunIds).not.toContain("mutated")
  })

  it("projects TestingExplorerViewModel, TestingObjectTree and filter/action adapter evidence from the same TestingService rows", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 3, label: "Watch", group: "run", isDefault: true, supportsContinuousRun: true })
    service.upsertItem({ controllerId: "vitest", id: "vitest", label: "Vitest root", expand: "expanded" })
    service.upsertItem({ controllerId: "vitest", id: "vitest\u0000src", parentId: "vitest", label: "src", expand: "expanded" })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src\u0000owner-a.test.ts",
      parentId: "vitest\u0000src",
      label: "owner-a.test.ts",
      uri: "file:///workspace/src/owner-a.test.ts",
      expand: "notExpandable",
    })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src\u0000owner-b.test.ts",
      parentId: "vitest\u0000src",
      label: "owner-b.test.ts",
      uri: "file:///workspace/src/owner-b.test.ts",
      expand: "notExpandable",
    })
    service.startContinuousRun({ testId: "vitest\u0000src\u0000owner-a.test.ts" })

    const contract = service.getTestingExplorerContractProjection({
      persistedState: {
        expandedIds: ["vitest", "vitest\u0000src"],
        selectedId: "vitest\u0000src\u0000owner-a.test.ts",
        viewMode: "list",
        sorting: "status",
        filterText: 'owner-a, !owner-b @failed @vitest:"slow tag" !@vitest:flaky',
      },
    })

    expect(contract.viewModelAdapter).toEqual(expect.objectContaining({
      status: "partial",
      codekOwner: "TestingService.getTestingExplorerContractProjection()",
      stateSource: "TestingService items/runs/profiles + persistedState input",
      vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts#TestingExplorerViewModel",
      projectionKind: "ListProjection",
      viewMode: "list",
      sorting: "status",
      welcomeExperience: "none",
      hasPendingReveal: false,
      selectedId: "vitest\u0000src\u0000owner-a.test.ts",
      appliedRowIds: ["vitest", "vitest\u0000src", "vitest\u0000src\u0000owner-a.test.ts", "vitest\u0000src\u0000owner-b.test.ts"],
      implementedEvidence: expect.arrayContaining([
        "applied rows are derived from TestingService.getItems() and not a second tree store",
      ]),
      blockedOwners: expect.arrayContaining([
        "TestingExplorerViewModel MutableDisposable<ITestTreeProjection> lifecycle",
        "RunOnceScheduler applyProjectionChanges/refilter timing",
      ]),
      noSecondState: true,
    }))
    expect(contract.objectTreeAdapter).toEqual(expect.objectContaining({
      status: "partial",
      codekOwner: "TestingService.getTestingExplorerContractProjection()",
      stateSource: "TestingService item parent/child links",
      vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/explorerProjections/testingObjectTree.ts",
      identityProvider: "TestingObjectTree element.treeId -> TestingService row.id",
      visibleRowIds: ["vitest\u0000src\u0000owner-a.test.ts", "vitest\u0000src\u0000owner-b.test.ts", "vitest\u0000src", "vitest"],
      focusedRowId: "vitest\u0000src\u0000owner-a.test.ts",
      selectedRowId: "vitest\u0000src\u0000owner-a.test.ts",
      blockedOwners: expect.arrayContaining([
        "TestingObjectTree extends WorkbenchObjectTree DOM virtualization and element lifecycle",
        "TestingObjectTree.getOptimizedViewState live collapse-state saver",
      ]),
      noSecondState: true,
    }))
    expect(contract.objectTreeAdapter.optimizedViewState).toEqual({
      children: {
        vitest: {
          collapsed: false,
          children: {
            src: {
              collapsed: false,
              children: {
                "owner-a.test.ts": { collapsed: true },
                "owner-b.test.ts": { collapsed: true },
              },
            },
          },
        },
      },
    })
    expect(contract.filterActionAdapter).toEqual(expect.objectContaining({
      status: "partial",
      codekOwner: "TestingService.getContinuousContextKeyProjection()+TestingService.createRunAction()",
      stateSource: "TestingService profiles/runs/items",
      contextKeys: expect.arrayContaining([
        "view == workbench.view.testing",
        "testing.supportsContinuousRun",
        "testing.isContinuousModeOn",
        "testing.isParentRunningContinuously",
        "testing.canRefreshTests",
        "testing.testResultState",
      ]),
      actionRunner: "registered-command-facade",
      blockedOwners: expect.arrayContaining([
        "TestingExplorerFilter input and TestExplorerFilterState glob/text owner",
        "MenuId.TestItem context overlay creation per visible tree element",
        "MenuId.ViewTitle action runner scoped to Testing.ExplorerViewId",
        "TestExplorerActionRunner selection/context routing for MenuItemAction",
      ]),
      noSecondState: true,
    }))
    expect(contract.filterActionAdapter.filterTerms).toEqual({
      currentDoc: "blocked-dom-owner",
      openedFiles: "blocked-editor-owner",
      hidden: "projected",
      failed: "projected",
      executed: "projected",
      text: "blocked-filter-input-owner",
    })
    expect(contract.domOwnerAdapter).toEqual(expect.objectContaining({
      status: "partial",
      codekOwner: "TestingService.getTestingExplorerContractProjection()",
      stateSource: "TestingService rows + filter/action adapter",
      containerSelector: '[data-codek-smoke="testing-explorer-viewpane-shell-owner"]',
      treeSelector: '[data-testing-explorer-object-tree="true"]',
      rowSelector: "[data-testing-explorer-row-id]",
      filterInputSelector: '[data-testing-explorer-filter-input="true"]',
      storageKey: "testing.filterHistory2",
      rowCount: 4,
      visibleRowIds: ["vitest\u0000src\u0000owner-a.test.ts", "vitest\u0000src\u0000owner-b.test.ts", "vitest\u0000src", "vitest"],
      dataAttributes: expect.objectContaining({
        stateSource: "data-testing-explorer-state-source",
        rowId: "data-testing-explorer-row-id",
        rowCommandIds: "data-testing-explorer-row-command-ids",
        filterValue: "data-testing-explorer-filter-value",
        noSecondState: "data-testing-explorer-no-second-state",
      }),
      implementedEvidence: expect.arrayContaining([
        "App.vue Testing Explorer DOM hook renders shell/filter/object-tree attributes from TestingService rows/filter/action projections.",
        "row data attributes map directly to TestingExplorerContractProjection.rows without a second tree store.",
        "ViewPaneContainer/TestingViewPaneContainer evidence is represented as a DOM shell selector only; Codek does not claim the VS Code container instance.",
        "IStorageService evidence is limited to external persistedState input and storage-key reporting; Codek does not write VS Code StoredValue state.",
        "MenuId.TestItem/MenuId.ViewTitle evidence is limited to command ids and context-key projections; visible action runner ownership remains blocked.",
      ]),
      blockedOwners: expect.arrayContaining([
        "TestingExplorerView extends ViewPane renderBody/layoutBody/focus",
        "TestingViewPaneContainer sidebar container DOM owner",
        "TestingObjectTree extends WorkbenchObjectTree DOM virtualization and element lifecycle",
        "TestingExplorerFilter input widget, suggest history, and dropdown action bar",
        "IStorageService/StoredValue-backed filter history, fuzzy state, view mode, sorting, and collapse persistence",
        "MenuId.TestItem/MenuId.ViewTitle visible action runner",
      ]),
      noSecondState: true,
    }))
    expect(contract.domOwnerAdapter.vscodeSourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/testing/browser/testing.contribution.ts",
      "src/vs/workbench/contrib/testing/browser/testingViewPaneContainer.ts",
      "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
      "src/vs/workbench/contrib/testing/browser/explorerProjections/testingObjectTree.ts",
      "src/vs/workbench/contrib/testing/browser/testingExplorerFilter.ts",
      "src/vs/workbench/contrib/testing/common/testExplorerFilterState.ts",
    ]))
    expect(contract.domOwnerMatrix).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "TestingExplorerView pane shell",
        status: "partial",
        vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
        codekProjection: "TestingService.getTestingExplorerContractProjection().domOwnerAdapter",
        requiredOwner: "TestingExplorerView extends ViewPane renderBody/layoutBody/focus owner",
      }),
      expect.objectContaining({
        capability: "TestingViewPaneContainer sidebar owner",
        status: "blocked",
        vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/testingViewPaneContainer.ts",
        requiredOwner: "TestingViewPaneContainer extends ViewPaneContainer instance and sidebar DOM lifecycle",
      }),
      expect.objectContaining({
        capability: "WorkbenchObjectTree virtualization",
        status: "partial",
        vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/explorerProjections/testingObjectTree.ts",
        codekProjection: "TestingService.getTestingExplorerContractProjection().objectTreeAdapter",
      }),
    ]))
    expect(contract.domOwnerAdapter.filterInput).toEqual({
      value: 'owner-a, !owner-b @failed @vitest:"slow tag" !@vitest:flaky',
      placeholder: "Filter (e.g. text, !exclude, @tag)",
      includeTags: ["vitest\u0000slow tag"],
      excludeTags: ["vitest\u0000flaky"],
      globList: [
        { include: true, text: "owner-a" },
        { include: false, text: "owner-b" },
      ],
      filterTerms: ["@failed"],
      blockedOwner: "TestingExplorerFilter input DOM + TestExplorerFilterState",
    })
    expect(contract.implementedEvidence).toEqual(expect.arrayContaining([
      "ViewPaneContainer/WorkbenchObjectTree/IStorageService/MenuId owner evidence is recorded as partial projection plus explicit blocked owner matrix",
    ]))
    expect(contract.blockedOwners).toEqual(expect.arrayContaining([
      "TestingExplorerView ViewPane DOM/layout/focus owner",
      "TestingViewPaneContainer sidebar container owner",
      "WorkbenchObjectTree DOM virtualization and keyboard accessibility owner",
      "IStorageService/StoredValue-backed TestingExplorerView view mode/sorting/filter/collapse persistence",
      "MenuId.TestItem/MenuId.ViewTitle visible action runner owner",
    ]))
    expect(contract.blockedReason).toContain("TestingExplorerView/ViewPaneContainer DOM")
    expect(contract.blockedReason).toContain("IStorageService/StoredValue persistence")
    expect(contract.blockedReason).toContain("MenuId.TestItem/ViewTitle action runner")

    contract.viewModelAdapter.appliedRowIds.push("mutated")
    contract.objectTreeAdapter.visibleRowIds.push("mutated")
    contract.objectTreeAdapter.optimizedViewState.children!.vitest.collapsed = true
    contract.filterActionAdapter.contextKeys.push("mutated")
    contract.domOwnerAdapter.visibleRowIds.push("mutated")
    contract.domOwnerAdapter.filterInput.globList[0].text = "mutated"
    contract.domOwnerAdapter.blockedOwners.push("mutated")
    contract.domOwnerMatrix[0].nextAuthorizedFiles.push("mutated")
    const fresh = service.getTestingExplorerContractProjection({
      persistedState: {
        expandedIds: ["vitest", "vitest\u0000src"],
        selectedId: "vitest\u0000src\u0000owner-a.test.ts",
        viewMode: "list",
        sorting: "status",
        filterText: 'owner-a, !owner-b @failed @vitest:"slow tag" !@vitest:flaky',
      },
    })
    expect(fresh.viewModelAdapter.appliedRowIds).not.toContain("mutated")
    expect(fresh.objectTreeAdapter.visibleRowIds).not.toContain("mutated")
    expect(fresh.objectTreeAdapter.optimizedViewState.children!.vitest.collapsed).toBe(false)
    expect(fresh.filterActionAdapter.contextKeys).not.toContain("mutated")
    expect(fresh.domOwnerAdapter.visibleRowIds).not.toContain("mutated")
    expect(fresh.domOwnerAdapter.filterInput.globList[0].text).toBe("owner-a")
    expect(fresh.domOwnerMatrix[0].nextAuthorizedFiles).not.toContain("mutated")
    expect(fresh.domOwnerAdapter.blockedOwners).not.toContain("mutated")

    const pendingReveal = service.getTestingExplorerContractProjection({
      revealTestId: "vitest\u0000src\u0000missing.test.ts",
    })
    expect(pendingReveal.viewModelAdapter.hasPendingReveal).toBe(true)
    expect(pendingReveal.objectTreeAdapter.focusedRowId).toBeUndefined()
  })

  it("projects Testing Explorer controller and action owner evidence through TestingService commandRegistry execution", async () => {
    const service = new TestingService()
    const registration = registerTestingCallbackCommands(service)
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 1, label: "Run", group: "run", isDefault: true })
    service.addProfile({ controllerId: "vitest", profileId: 2, label: "Debug", group: "debug", isDefault: true })
    service.addProfile({ controllerId: "vitest", profileId: 3, label: "Coverage", group: "coverage", isDefault: true })
    service.upsertItem({ controllerId: "vitest", id: "vitest", label: "Vitest root", expand: "expanded" })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src\u0000controller-owner.test.ts",
      parentId: "vitest",
      label: "controller-owner.test.ts",
      uri: "file:///workspace/src/controller-owner.test.ts",
      expand: "notExpandable",
    })

    const beforeExecution = service.getTestingExplorerContractProjection({
      revealTestId: "vitest\u0000src\u0000controller-owner.test.ts",
    })

    expect(beforeExecution.controllerOwner).toEqual(expect.objectContaining({
      status: "projected",
      codekOwner: "TestingService controllers/profiles/items",
      vscodeSourcePath: "src/vs/workbench/api/browser/mainThreadTesting.ts",
      controllerIds: ["vitest"],
      profileIdsByController: { vitest: [1, 2, 3] },
      itemCountByController: { vitest: 2 },
      noSecondState: true,
      implementedEvidence: expect.arrayContaining([
        "controller snapshots from TestingService.registerController()",
        "MainThreadTesting bridge event channels feed the same TestingService state",
      ]),
      blockedOwners: expect.arrayContaining([
        "VS Code IMainThreadTestController object identity and observable capabilities",
        "Full ITestService.registerTestController ownership alias",
      ]),
    }))
    expect(beforeExecution.ownerEvidence).toEqual(expect.objectContaining({
      status: "partial",
      stateSource: "TestingService controllers/profiles/items/runs/results/output",
      noSecondState: true,
      vscodeSourcePaths: expect.arrayContaining([
        "src/vs/workbench/contrib/testing/common/testService.ts",
        "src/vs/workbench/contrib/testing/common/testServiceImpl.ts",
        "src/vs/workbench/api/common/extHostTesting.ts",
        "src/vs/workbench/api/browser/mainThreadTesting.ts",
        "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
      ]),
      testServiceOwner: expect.objectContaining({
        status: "partial",
        codekOwner: "TestingService",
        source: "TestingService controllers/profiles/items/runs/results/output",
        serviceIds: expect.arrayContaining([
          String(ITestingService),
          String(ITestProfileService),
          String(ITestResultService),
        ]),
        noSecondState: true,
      }),
      testControllerOwner: expect.objectContaining({
        status: "projected",
        controllerIds: ["vitest"],
        profileIdsByController: { vitest: [1, 2, 3] },
        itemCountByController: { vitest: 2 },
        noSecondState: true,
      }),
      testExplorerOwner: expect.objectContaining({
        status: "partial",
        visibleRowIds: [
          "vitest",
          "vitest\u0000src\u0000controller-owner.test.ts",
        ],
        blockedOwners: expect.arrayContaining([
          "TestingExplorerView ViewPane instance",
          "TestingObjectTree WorkbenchObjectTree DOM virtualization",
        ]),
        noSecondState: true,
      }),
      resultOwner: expect.objectContaining({
        status: "projected",
        retainedRunCount: 0,
        retainedResultCount: 0,
        runningRunIds: [],
        completedRunIds: [],
        noSecondState: true,
      }),
      runProfileOwner: expect.objectContaining({
        status: "projected",
        profileIdsByController: { vitest: [1, 2, 3] },
        defaultProfileIdsByControllerAndGroup: {
          vitest: {
            run: [1],
            debug: [2],
            coverage: [3],
          },
        },
        noSecondState: true,
      }),
      testItemSource: expect.objectContaining({
        status: "projected",
        rowCount: 2,
        rootIds: ["vitest"],
        sampleEvidenceUris: [
          "codek-testing://explorer/vitest",
          "codek-testing://explorer/vitest%00src%00controller-owner.test.ts",
        ],
        noSecondState: true,
      }),
      remainingUiOwnerGap: expect.objectContaining({
        status: "blocked",
        blockedOwners: expect.arrayContaining([
          "generic workbench shell/App.vue wiring outside this TestingService-only lane",
        ]),
        blockedReason: expect.stringContaining("Full Test Explorer UI owner remains blocked"),
        noSecondState: true,
      }),
    }))
    expect(beforeExecution.actionOwner).toEqual(expect.objectContaining({
      status: "partial",
      codekOwner: "TestingService.createRunAction()+commandRegistry",
      noSecondState: true,
      commandExecution: [
        expect.objectContaining({ commandId: TESTING_RUN_COMMAND_IDS.Run, status: "registered-command-facade" }),
        expect.objectContaining({ commandId: TESTING_RUN_COMMAND_IDS.Debug, status: "registered-command-facade" }),
        expect.objectContaining({ commandId: TESTING_RUN_COMMAND_IDS.Coverage, status: "registered-command-facade" }),
      ],
      blockedOwners: expect.arrayContaining([
        "TestingExplorerView runInView visible action runner",
        "MenuId.TestItem/TestItemGutter action overlay",
      ]),
    }))
    expect(beforeExecution.actionOwner.actions.map((action) => action.commandId)).toEqual([
      TESTING_RUN_COMMAND_IDS.Run,
      TESTING_RUN_COMMAND_IDS.Debug,
      TESTING_RUN_COMMAND_IDS.Coverage,
    ])

    await executeCommand(TESTING_RUN_COMMAND_IDS.Run, [{ testId: "vitest\u0000src\u0000controller-owner.test.ts" }])
    await executeCommand(TESTING_RUN_COMMAND_IDS.Debug, [{ testId: "vitest\u0000src\u0000controller-owner.test.ts" }])
    await executeCommand(TESTING_RUN_COMMAND_IDS.Coverage, [{ testId: "vitest\u0000src\u0000controller-owner.test.ts" }])

    expect(service.getRuns().map((run) => `${run.group}:${run.profileId}:${run.testIds.join(",")}`).sort()).toEqual([
      "run:1:vitest\u0000src\u0000controller-owner.test.ts",
      "debug:2:vitest\u0000src\u0000controller-owner.test.ts",
      "coverage:3:vitest\u0000src\u0000controller-owner.test.ts",
    ].sort())

    beforeExecution.controllerOwner.controllerIds.push("mutated")
    beforeExecution.controllerOwner.profileIdsByController.vitest.push(99)
    beforeExecution.ownerEvidence.testControllerOwner.controllerIds.push("mutated")
    beforeExecution.ownerEvidence.runProfileOwner.defaultProfileIdsByControllerAndGroup.vitest.run?.push(99)
    beforeExecution.ownerEvidence.testExplorerOwner.visibleRowIds.push("mutated")
    beforeExecution.ownerEvidence.remainingUiOwnerGap.blockedOwners.push("mutated")
    beforeExecution.actionOwner.actions[0].testIds.push("mutated")
    beforeExecution.actionOwner.commandExecution[0].status = "blocked"
    const fresh = service.getTestingExplorerContractProjection()
    expect(fresh.controllerOwner.controllerIds).toEqual(["vitest"])
    expect(fresh.controllerOwner.profileIdsByController.vitest).toEqual([1, 2, 3])
    expect(fresh.ownerEvidence.testControllerOwner.controllerIds).toEqual(["vitest"])
    expect(fresh.ownerEvidence.runProfileOwner.defaultProfileIdsByControllerAndGroup.vitest.run).toEqual([1])
    expect(fresh.ownerEvidence.testExplorerOwner.visibleRowIds).not.toContain("mutated")
    expect(fresh.ownerEvidence.remainingUiOwnerGap.blockedOwners).not.toContain("mutated")
    expect(fresh.ownerEvidence.resultOwner).toEqual(expect.objectContaining({
      retainedRunCount: 3,
      retainedResultCount: 3,
      runningRunIds: expect.arrayContaining([
        "run:run:vitest:1:vitest%00src%00controller-owner.test.ts",
        "run:debug:vitest:2:vitest%00src%00controller-owner.test.ts",
        "run:coverage:vitest:3:vitest%00src%00controller-owner.test.ts",
      ]),
      completedRunIds: [],
      noSecondState: true,
    }))
    expect(fresh.actionOwner.actions[0].testIds).not.toContain("mutated")
    expect(fresh.actionOwner.commandExecution[0].status).toBe("registered-command-facade")

    registration.dispose()
  })

  it("registers Testing workbench views as a projection-backed shell adapter without claiming real result peek or coverage ownership", () => {
    registerDefaultWorkbenchViews()
    const registration = registerTestingWorkbenchViews()
    const service = new TestingService()
    const contract = service.getContractAudit()

    expect(getViewContainers("activityBar", {
      testingEnabled: true,
      testingProviderCount: 1,
    }).map((container) => container.id)).toContain(TESTING_VIEW_IDS.Container)
    expect(getViews(TESTING_VIEW_IDS.Container, {
      testingEnabled: true,
      testingProviderCount: 1,
      testingCoverageOpen: false,
    }).map((view) => view.id)).toEqual([TESTING_VIEW_IDS.Explorer])
    expect(getViews(TESTING_VIEW_IDS.Container, {
      testingEnabled: true,
      testingProviderCount: 1,
      testingDefaultPlaceholderVisible: true,
    }).map((view) => view.id)).not.toContain(TESTING_VIEW_IDS.Default)
    expect(getViews(TESTING_VIEW_IDS.Container, {
      testingEnabled: true,
      testingProviderCount: 1,
      testingCoverageOpen: true,
    }).map((view) => view.id)).toEqual([TESTING_VIEW_IDS.Explorer, TESTING_VIEW_IDS.Coverage])
    expect(getViews(TESTING_VIEW_IDS.ResultsContainer, {
      testingEnabled: true,
      testingHasResults: true,
    }).map((view) => view.id)).toEqual([TESTING_VIEW_IDS.Results])

    expect(contract.workbenchViews).toEqual(expect.objectContaining({
      codekRegistration: "viewRegistry",
      noSecondState: true,
    }))
    expect(contract.workbenchViews.vscodeSourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/testing/browser/testing.contribution.ts",
      "src/vs/workbench/contrib/testing/browser/testingOutputPeek.ts",
      "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
    ]))
    expect(contract.workbenchViews.containers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: TESTING_VIEW_IDS.Container,
        status: "partial",
        codekOwner: "registerTestingWorkbenchViews",
      }),
      expect.objectContaining({
        id: TESTING_VIEW_IDS.ResultsContainer,
        status: "blocked",
      }),
    ]))
    expect(contract.workbenchViews.views).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: TESTING_VIEW_IDS.Explorer,
        status: "partial",
        codekOwner: "TestingService.getProjection()",
        when: "testingEnabled && testingProviderCount != 0",
      }),
      expect.objectContaining({
        id: TESTING_VIEW_IDS.Coverage,
        status: "partial",
        codekOwner: "TestingService.getProjection()",
        reason: expect.stringContaining("projection-backed coverage view shell"),
      }),
      expect.objectContaining({
        id: TESTING_VIEW_IDS.Results,
        status: "blocked",
        reason: expect.stringContaining("result peek ownership"),
      }),
    ]))
    expect(contract.workbenchViews.editorContributions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "editor.contrib.testingOutputPeek",
        status: "blocked",
        missingOwner: expect.stringContaining("TestingOutputPeekController"),
      }),
      expect.objectContaining({
        id: "editor.contrib.coverageDecorations",
        status: "partial",
        codekOwner: "TestingService.getCoverageEditorDecorationsProjection()",
        missingOwner: expect.stringContaining("Full CodeCoverageDecorations"),
      }),
    ]))

    registration.dispose()
    expect(getViewContainers("activityBar", {
      testingEnabled: true,
      testingProviderCount: 1,
      testingCoverageOpen: true,
    }).map((container) => container.id)).not.toContain(TESTING_VIEW_IDS.Container)
    expect(getViews(TESTING_VIEW_IDS.Container, {
      testingDefaultPlaceholderVisible: true,
    })).toHaveLength(0)
    expect(getViewContainers("panel", {
      testingEnabled: true,
      testingHasResults: true,
    })).toHaveLength(0)
  })

  it("keeps Testing UI owner feasibility blocked to the Agent Evidence surface when no Test Explorer component owner exists", () => {
    registerTestingWorkbenchViews()
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 1, label: "Run", group: "run", isDefault: true })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src/owner.test.ts",
      label: "owner.test.ts",
      uri: "file:///workspace/src/owner.test.ts",
      expand: "notExpandable",
    })

    const contract = service.getContractAudit()
    const explorerView = contract.workbenchViews.views.find((view) => view.id === TESTING_VIEW_IDS.Explorer)
    const testingContainer = getViewContainers("activityBar", {
      testingEnabled: true,
      testingProviderCount: 1,
    }).find((container) => container.id === TESTING_VIEW_IDS.Container)
    const visibleTestingViews = getViews(TESTING_VIEW_IDS.Container, {
      testingEnabled: true,
      testingProviderCount: 1,
      testingCoverageOpen: false,
    })

    expect(testingContainer).toEqual(expect.objectContaining({
      id: TESTING_VIEW_IDS.Container,
      source: "vscode",
    }))
    expect(visibleTestingViews.map((view) => view.id)).toEqual([TESTING_VIEW_IDS.Explorer])
    expect(contract.uiBinding.codekVisibleSurfacePath).toBe("frontend/vite-project/src/App.vue:data-agent-evidence-surface=\"testing\"")
    expect(explorerView).toEqual(expect.objectContaining({
      status: "partial",
      codekOwner: "TestingService.getProjection()",
      reason: expect.stringContaining("projection-backed Test Explorer contract"),
    }))
    expect(contract.uiCapabilities.treeProvider).toEqual(expect.objectContaining({
      status: "partial",
      codekStateSource: "TestingService.getProjection().items/actions/runSummary",
      reason: expect.stringContaining("does not own a VS Code TestingExplorerView"),
      missingOwnership: expect.arrayContaining([
        "TestingExplorerViewModel and Tree/List projections",
        "TestExplorerFilterState and context-key driven sorting/filtering",
      ]),
    }))
    expect(contract.ownerContracts.testExplorerTree).toEqual(expect.objectContaining({
      status: "projected",
      codekStateSource: "TestingService.getProjection().items/actions/runSummary",
      blockedReason: expect.stringContaining("does not own the VS Code TestingExplorerView ViewPane"),
      noSecondState: true,
    }))
    expect(service.getProjection()).toEqual(expect.objectContaining({
      items: [expect.objectContaining({ id: "vitest\u0000src/owner.test.ts" })],
      contract: expect.objectContaining({
        noSecondState: true,
        ownerContracts: expect.objectContaining({
          testExplorerTree: expect.objectContaining({
            codekStateSource: "TestingService.getProjection().items/actions/runSummary",
          }),
        }),
      }),
    }))
  })

  it("audits Testing view shell feasibility through viewRegistry without claiming the real Test Explorer tree owner", () => {
    registerTestingWorkbenchViews()
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 1, label: "Run", group: "run", isDefault: true })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src/shell.test.ts",
      label: "shell.test.ts",
      uri: "file:///workspace/src/shell.test.ts",
      expand: "notExpandable",
    })

    const contract = service.getContractAudit()
    const shell = contract.workbenchViews.viewShellOwnerFeasibility
    const testingViews = getViews(TESTING_VIEW_IDS.Container, {
      testingEnabled: true,
      testingProviderCount: 1,
    })

    expect(testingViews).toEqual([
      expect.objectContaining({
        id: TESTING_VIEW_IDS.Explorer,
        containerId: TESTING_VIEW_IDS.Container,
        source: "vscode",
        userDescription: expect.stringContaining("显示测试控制器、测试项、运行记录和覆盖率证据。"),
      }),
    ])
    expect(shell).toEqual(expect.objectContaining({
      status: "partial",
      shellSource: "viewRegistry",
      treeStateSource: "TestingService.getProjection().items/actions/runSummary",
      noSecondState: true,
      canExpressShell: expect.arrayContaining([
        "Testing activity container registration",
        "Test Explorer view descriptor visibility keyed by testingProviderCount",
      ]),
      canProjectTreeEvidence: expect.arrayContaining([
        "tree-shaped TestItemProjection rows",
        "run/debug/coverage command descriptors",
      ]),
      blockedOwners: expect.arrayContaining([
        "TestingExplorerView extends ViewPane",
        "TestingExplorerViewModel and TestingObjectTree",
        "TestingExplorerFilter and action bars",
      ]),
      blockedReason: expect.stringContaining("viewRegistry can express the Testing view shell"),
    }))
    expect(shell.vscodeSourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/testing/browser/testing.contribution.ts",
      "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
    ]))
    expect(service.getProjection()).toEqual(expect.objectContaining({
      items: [expect.objectContaining({ id: "vitest\u0000src/shell.test.ts" })],
      contract: expect.objectContaining({
        workbenchViews: expect.objectContaining({
          viewShellOwnerFeasibility: expect.objectContaining({
            treeStateSource: "TestingService.getProjection().items/actions/runSummary",
            noSecondState: true,
          }),
        }),
      }),
    }))
  })

  it("audits the reusable generic workbench shell boundary before a real Testing ViewPane/ObjectTree adapter", () => {
    registerTestingWorkbenchViews()
    const service = new TestingService()
    const contract = service.getContractAudit()
    const shell = contract.workbenchViews.genericWorkbenchShellFeasibility

    expect(shell).toEqual(expect.objectContaining({
      status: "partial",
      shellSource: "viewRegistry+ViewsService+workbenchLayoutService",
      noSecondState: true,
      reusableOwners: expect.arrayContaining([
        "viewRegistry descriptor registration for Testing sidebar and Test Results panel containers",
        "ViewsService openView/openViewContainer routing onto the shared WorkbenchLayoutService",
        "WorkbenchLayoutService pane-composite active/visible state without a second view state",
      ]),
      verifiedContracts: expect.arrayContaining([
        "workbenchViewsSidebarPanelIntegration opens TESTING_VIEW_IDS.Explorer through ViewsService",
        "TestingService.getContractAudit().workbenchViews exposes the descriptor-level shell as partial only",
      ]),
      missingOwners: expect.arrayContaining([
        "VS Code SyncDescriptor(TestingViewPaneContainer) instance construction",
        "TestingExplorerView extends ViewPane renderBody/layoutBody/focus lifecycle",
        "TestingObjectTree extends WorkbenchObjectTree/ListService DOM virtualization and keyboard owner",
        "TestResultsViewContent SplitView/OutputPeekTree/FollowupActionWidget DOM owner",
        "generic App.vue/workbench shell slot that mounts registered ViewPane descriptors",
      ]),
      nextAuthorizedFiles: [
        "frontend/vite-project/src/workbench/workbenchLayoutUiAdapter.ts",
        "frontend/vite-project/src/vscode-adapter/workbench/services/views/common/viewsService.ts",
        "frontend/vite-project/src/App.vue",
      ],
    }))
    expect(shell.vscodeSourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/testing/browser/testing.contribution.ts",
      "src/vs/workbench/contrib/testing/browser/testingViewPaneContainer.ts",
      "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsViewContent.ts",
      "src/vs/workbench/browser/parts/views/viewPaneContainer.ts",
      "src/vs/workbench/services/views/common/viewsService.ts",
      "src/vs/workbench/services/layout/browser/layoutService.ts",
    ]))
    expect(shell.blockedReason).toContain("does not instantiate VS Code ViewPaneContainer/ViewPane/ObjectTree classes")
    expect(contract.workbenchViews.containers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: TESTING_VIEW_IDS.Container, status: "partial" }),
      expect.objectContaining({ id: TESTING_VIEW_IDS.ResultsContainer, status: "blocked" }),
    ]))
  })

  it("audits Testing Explorer action owner feasibility through viewRegistry without claiming item overlay ownership", () => {
    registerTestingWorkbenchViews()
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({
      controllerId: "vitest",
      profileId: 7,
      label: "Watch",
      group: "run",
      isDefault: true,
      supportsContinuousRun: true,
    })
    service.upsertItem({ controllerId: "vitest", id: "vitest", label: "Vitest root", expand: "expanded" })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src/action-owner.test.ts",
      parentId: "vitest",
      label: "action-owner.test.ts",
      expand: "notExpandable",
    })
    service.startRun({
      id: "run:watch-root",
      controllerId: "vitest",
      profileId: 7,
      group: "run",
      testIds: ["vitest"],
      continuous: true,
    })

    const contract = service.getContractAudit()
    const actionOwner = contract.workbenchViews.actionOwnerFeasibility
    const contextKeys = service.getContinuousContextKeyProjection()
    const testingViews = getViews(TESTING_VIEW_IDS.Container, {
      testingEnabled: true,
      testingProviderCount: 1,
      testingCoverageOpen: false,
    })

    expect(testingViews).toEqual([
      expect.objectContaining({
        id: TESTING_VIEW_IDS.Explorer,
        source: "vscode",
        when: "testingEnabled && testingProviderCount != 0",
      }),
    ])
    expect(actionOwner).toEqual(expect.objectContaining({
      status: "partial",
      shellSource: "viewRegistry",
      stateSource: "TestingService.getContinuousContextKeyProjection()",
      noSecondState: true,
      vscodeSourcePaths: expect.arrayContaining([
        "src/vs/workbench/contrib/testing/browser/testExplorerActions.ts",
        "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
        "src/vs/workbench/contrib/testing/common/testingContextKeys.ts",
      ]),
      canExpressActionEvidence: expect.arrayContaining([
        "Test Explorer view descriptor visibility keyed by testingProviderCount",
        "MenuService can evaluate MenuId.ViewTitle and MenuId.TestItem when/toggled metadata from context keys",
        "continuous-run service-level context-key evidence for ViewTitle gating",
        "continuous-run item context-key evidence for MenuId.TestItem gating",
      ]),
      canProjectContextKeys: [
        "testing.supportsContinuousRun",
        "testing.isContinuousModeOn",
        "testing.isParentRunningContinuously",
      ],
	      blockedOwners: expect.arrayContaining([
	        "TestingExplorerView.updateActions() refresh owner",
	        "TestingExplorerViewModel getActionableElementActions context overlay",
	      ]),
	      blockedReason: expect.stringContaining("TestingService now owns a minimal continuous run start/stop facade"),
	    }))
    expect(contextKeys.serviceLevelKeys).toEqual({
      "testing.supportsContinuousRun": true,
      "testing.isContinuousModeOn": true,
    })
    expect(contextKeys.itemContextKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({
        testId: "vitest\u0000src/action-owner.test.ts",
        supportsContinuousRun: true,
        isContinuousModeOn: true,
        isParentRunningContinuously: true,
      }),
    ]))
    expect(contextKeys.menuOverlayBlockedKeys).toEqual(["testing.isParentRunningContinuously"])
    expect(contextKeys.blockedKeys).toEqual([])
	    expect(contract.ownerContracts.continuousRun.actionContextMatrix).toEqual(expect.arrayContaining([
	      expect.objectContaining({
	        surface: "Test Explorer item toggle continuous run",
	        codekProjection: "projected",
	        blockedOwner: "TestingExplorerView + MenuId.TestItem visible action runner",
	      }),
	      expect.objectContaining({
	        surface: "Test Explorer view title start/stop continuous run",
	        codekProjection: "projected",
	        blockedOwner: "ViewTitle menu + TestingExplorerView action refresh",
	      }),
	    ]))

    actionOwner.canProjectContextKeys.push("mutated")
    actionOwner.blockedOwners.push("mutated")
    const fresh = service.getContractAudit().workbenchViews.actionOwnerFeasibility
    expect(fresh.canProjectContextKeys).toEqual([
      "testing.supportsContinuousRun",
      "testing.isContinuousModeOn",
      "testing.isParentRunningContinuously",
    ])
    expect(fresh.blockedOwners).not.toContain("mutated")
  })

  it("clones Testing workbench view audit data so callers cannot mutate owner evidence", () => {
    const service = new TestingService()
    const contract = service.getContractAudit()

    contract.workbenchViews.containers[0].status = "available"
    contract.workbenchViews.views[0].reason = "mutated"
    contract.workbenchViews.actionOwnerFeasibility.blockedOwners.push("mutated")
    contract.workbenchViews.editorContributions.length = 0

    const fresh = service.getContractAudit()
    expect(fresh.workbenchViews.containers[0].status).toBe("partial")
    expect(fresh.workbenchViews.views[0].reason).toContain("TestingExplorerView")
    expect(fresh.workbenchViews.actionOwnerFeasibility.blockedOwners).not.toContain("mutated")
    expect(fresh.workbenchViews.editorContributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "editor.contrib.testingOutputPeek" }),
    ]))
  })

  it("clones Testing UI capability audit data so callers cannot mutate service ownership evidence", () => {
    const service = new TestingService()
    const contract = service.getContractAudit()

    contract.uiCapabilities.treeProvider.status = "available"
    contract.uiCapabilities.resultPeek.missingOwnership.push("mutated")
    contract.uiCapabilities.coverageTree.vscodeSourcePaths.length = 0

    const fresh = service.getContractAudit()
    expect(fresh.uiCapabilities.treeProvider.status).toBe("partial")
    expect(fresh.uiCapabilities.resultPeek.missingOwnership).not.toContain("mutated")
    expect(fresh.uiCapabilities.coverageTree.vscodeSourcePaths).toContain("src/vs/workbench/contrib/testing/browser/testCoverageView.ts")
    expect(fresh.uiCapabilities.coverageTree.commandIds).toContain(TESTING_COVERAGE_COMMAND_IDS.OpenCoverage)
  })

  it("opens result peek through a TestingService shell adapter without a second state source", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 1, label: "Run", group: "run", isDefault: true })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src/example.test.ts",
      label: "example.test.ts",
      uri: "file:///workspace/src/example.test.ts",
      expand: "notExpandable",
    })
    service.startRun({
      id: "run:peek",
      controllerId: "vitest",
      profileId: 1,
      group: "run",
      testIds: ["vitest\u0000src/example.test.ts"],
    })
    service.appendOutput("run:peek", "Assertion failed", {
      testId: "vitest\u0000src/example.test.ts",
      locationUri: "file:///workspace/src/example.test.ts#L12",
    })
    service.updateRunItemState("run:peek", "vitest\u0000src/example.test.ts", "failed", 33, ["expected true"])

    const descriptor = service.openResultPeek({
      runId: "run:peek",
      testId: "vitest\u0000src/example.test.ts",
    })

    expect(descriptor).toEqual(expect.objectContaining({
      status: "ready",
      commandId: TESTING_PEEK_COMMAND_IDS.OpenOutputPeek,
      targetUri: "file:///workspace/src/example.test.ts#L12",
      selectedEntry: expect.objectContaining({
        runId: "run:peek",
        testId: "vitest\u0000src/example.test.ts",
        messages: ["Assertion failed", "expected true"],
      }),
      projection: service.getResultPeekProjection(),
      shellAdapter: expect.objectContaining({
        kind: "result-peek-shell-adapter",
        codekOwner: "TestingService.openResultPeek()",
        preservesAgentEvidence: true,
        noSecondState: true,
        blockedOwners: expect.arrayContaining([
          "TestingOutputPeekController editor contribution",
          "PeekViewWidget ownership",
        ]),
      }),
    }))
    expect(descriptor.shellAdapter.vscodeSourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/testing/browser/testingOutputPeek.ts",
      "src/vs/workbench/contrib/testing/browser/testExplorerActions.ts",
      "src/vs/workbench/contrib/testing/common/testingPeekOpener.ts",
    ]))

    descriptor.selectedEntry?.messages.push("mutated")
    descriptor.projection.entries[0].messages.push("mutated")

    const fresh = service.openResultPeek()
    expect(fresh.selectedEntry?.messages).not.toContain("mutated")
    expect(fresh.projection.entries[0].messages).not.toContain("mutated")
  })

  it("documents the minimal result peek and coverage editor shell owner matrix", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 1, label: "Run", group: "run", isDefault: true })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src/matrix.test.ts",
      label: "matrix.test.ts",
      uri: "file:///workspace/src/matrix.test.ts",
      expand: "notExpandable",
    })
    service.startRun({
      id: "run:matrix",
      controllerId: "vitest",
      profileId: 1,
      group: "run",
      testIds: ["vitest\u0000src/matrix.test.ts"],
    })
    service.appendOutput("run:matrix", "expected matrix to pass", {
      testId: "vitest\u0000src/matrix.test.ts",
      locationUri: "file:///workspace/src/matrix.test.ts#L8",
    })
    service.updateRunItemState("run:matrix", "vitest\u0000src/matrix.test.ts", "failed", 12, ["expected matrix to pass"])
    service.completeRun("run:matrix", "failed")
    service.publishCoverage([{
      id: "coverage:matrix",
      uri: "file:///workspace/src/matrix.ts",
      statement: { covered: 2, total: 4 },
      branch: { covered: 0, total: 2 },
      testIds: ["vitest\u0000src/matrix.test.ts"],
    }])
    service.openCoverage("coverage:matrix")
    service.setCoverageInlineVisible(true)

    const resultPeekReady = service.openResultPeek({ runId: "run:matrix", testId: "vitest\u0000src/matrix.test.ts" })
    const resultPeekMissing = service.openResultPeek({ testId: "vitest\u0000missing.test.ts" })
    const coverageEditorReady = service.getCoverageEditorContributionShellProjection("file:///workspace/src/matrix.ts#L2")
    const coverageEditorMissing = service.getCoverageEditorContributionShellProjection("file:///workspace/src/missing.ts")
    const coverageOwnerAudit = service.getCoverageOwnerFeasibilityAudit("file:///workspace/src/matrix.ts")

    const matrix = {
      resultPeekShell: {
        usable: resultPeekReady.status === "ready",
        unavailableReason: resultPeekMissing.reason,
        commandId: resultPeekReady.commandId,
        targetUri: resultPeekReady.targetUri,
        stateSource: resultPeekReady.shellAdapter.codekOwner,
        vscodeOwnerPaths: resultPeekReady.shellAdapter.vscodeSourcePaths,
        blockedOwners: resultPeekReady.shellAdapter.blockedOwners,
        noSecondState: resultPeekReady.shellAdapter.noSecondState,
      },
      coverageEditorShell: {
        usable: coverageEditorReady.status === "available",
        unavailableReason: coverageEditorMissing.reason,
        contributionId: coverageEditorReady.contributionId,
        stateSource: coverageEditorReady.stateSource,
        commandIds: coverageEditorReady.commandIds,
        vscodeOwnerPaths: coverageEditorReady.adapter.vscodeSourcePaths,
        blockedOwners: coverageEditorReady.adapter.blockedOwners,
        genericEditorBlockedReason: coverageEditorReady.genericEditorShellContract.blockedReason,
        noSecondState: coverageEditorReady.adapter.noSecondState,
      },
      fullVsCodeOwners: {
        resultPeek: resultPeekReady.shellAdapter.blockedOwners,
        coverageEditorContribution: coverageOwnerAudit.editorContributionOwner.blockedOwners,
        canClaimCoverageEditorOwner: coverageOwnerAudit.fullOwnerMigration.editorContributionOwnerReady,
      },
    }

    expect(matrix).toEqual({
      resultPeekShell: {
        usable: true,
        unavailableReason: "requested test result peek entry was not found",
        commandId: TESTING_PEEK_COMMAND_IDS.OpenOutputPeek,
        targetUri: "file:///workspace/src/matrix.test.ts#L8",
        stateSource: "TestingService.openResultPeek()",
        vscodeOwnerPaths: expect.arrayContaining([
          "src/vs/workbench/contrib/testing/browser/testingOutputPeek.ts",
          "src/vs/workbench/contrib/testing/common/testingPeekOpener.ts",
        ]),
        blockedOwners: expect.arrayContaining([
          "TestingOutputPeekController editor contribution",
          "PeekViewWidget ownership",
          "OutputPeekTree action runner and TestResultsViewContent DOM tree",
        ]),
        noSecondState: true,
      },
      coverageEditorShell: {
        usable: true,
        unavailableReason: "no coverage file matches the requested editor uri",
        contributionId: "editor.contrib.coverageDecorations",
        stateSource: "TestingService.getCoverageEditorDecorationsProjection()",
        commandIds: expect.arrayContaining([
          TESTING_COVERAGE_COMMAND_IDS.ToggleInlineCoverage,
          TESTING_COVERAGE_COMMAND_IDS.GoToNextMissedLine,
          TESTING_CALLBACK_COMMAND_IDS.CoverageDetails,
        ]),
        vscodeOwnerPaths: expect.arrayContaining([
          "src/vs/workbench/contrib/testing/browser/codeCoverageDecorations.ts",
          "src/vs/workbench/contrib/testing/common/testCoverageService.ts",
        ]),
        blockedOwners: expect.arrayContaining([
          "ICodeEditor contribution registration",
          "CoverageDetailsModel statement/branch ranges",
          "model decorations/minimap/injected text",
          "coverage toolbar overlay widget",
        ]),
        genericEditorBlockedReason: expect.stringContaining("no authorized generic ICodeEditor/TextModel shell adapter"),
        noSecondState: true,
      },
      fullVsCodeOwners: {
        resultPeek: expect.arrayContaining([
          "TestingOutputPeekController editor contribution",
          "PeekViewWidget ownership",
        ]),
        coverageEditorContribution: expect.arrayContaining([
          "ICodeEditor contribution registration",
          "coverage toolbar overlay widget",
        ]),
        canClaimCoverageEditorOwner: false,
      },
    })
  })

  it("routes Testing UI command facades through the extension-host callbacks without creating a second state source", async () => {
    const service = new TestingService()
    const callbacks = {
      cancelRun: vi.fn(),
      configureProfile: vi.fn(),
      getCoverageDetails: vi.fn(async () => [{ type: "statement", executed: 1, count: 1 }]),
      provideTestFollowups: vi.fn(async () => []),
      executeTestFollowup: vi.fn(async () => {}),
      disposeTestFollowups: vi.fn(),
      publishTestResults: vi.fn(),
    }
    service.setExtensionHostCallbacks(callbacks)
    registerTestingCallbackCommands(service)
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({
      controllerId: "vitest",
      profileId: 1,
      label: "Run",
      group: "run",
      isDefault: true,
      configureCommandId: "vitest.configure",
    })
    service.upsertItem({ controllerId: "vitest", id: "vitest", label: "Vitest", expand: "expanded" })
    service.upsertItem({ controllerId: "vitest", id: "vitest\u0000suite", parentId: "vitest", label: "suite", expand: "notExpandable" })
    service.startRun({ id: "run:1", controllerId: "vitest", profileId: 1, group: "run", testIds: ["vitest\u0000suite"] })
    service.publishCoverage([{
      id: "coverage:1",
      uri: "file:///workspace/src/test.ts",
      statement: { covered: 1, total: 1 },
      testIds: ["vitest\u0000suite"],
    }])

    expect(getCommand(TESTING_PEEK_COMMAND_IDS.OpenOutputPeek)).toEqual(expect.objectContaining({ source: "vscode" }))
    expect(getCommand(TESTING_CALLBACK_COMMAND_IDS.CancelRun)).toEqual(expect.objectContaining({ source: "vscode" }))
    expect(getCommand(TESTING_CALLBACK_COMMAND_IDS.ConfigureProfile)).toEqual(expect.objectContaining({ source: "vscode" }))
    expect(getCommand(TESTING_CALLBACK_COMMAND_IDS.CoverageDetails)).toEqual(expect.objectContaining({ source: "vscode" }))
    expect(getCommand(TESTING_COVERAGE_COMMAND_IDS.OpenCoverage)).toEqual(expect.objectContaining({ source: "vscode" }))
    expect(getCommand(TESTING_COVERAGE_COMMAND_IDS.ToggleInlineCoverage)).toEqual(expect.objectContaining({ source: "vscode" }))
    expect(getCommand(TESTING_COVERAGE_COMMAND_IDS.FilterToTest)).toEqual(expect.objectContaining({ source: "vscode" }))
    expect(getCommand(TESTING_COVERAGE_COMMAND_IDS.ViewChangeSorting)).toEqual(expect.objectContaining({ source: "vscode" }))

    await expect(executeCommand(TESTING_PEEK_COMMAND_IDS.OpenOutputPeek, [{ runId: "run:1", testId: "vitest\u0000suite" }], { testingHasResults: true })).resolves.toBe(true)
    await expect(executeCommand(TESTING_CALLBACK_COMMAND_IDS.CancelRun, [{ runId: "run:1", taskId: "task:1" }])).resolves.toBe(true)
    await expect(executeCommand(TESTING_CALLBACK_COMMAND_IDS.ConfigureProfile, ["vitest", 1])).resolves.toBe(true)
    await expect(executeCommand(TESTING_CALLBACK_COMMAND_IDS.CoverageDetails, [{ coverageId: "coverage:1", testId: "vitest\u0000suite" }])).resolves.toBe(true)
    await expect(executeCommand(TESTING_COVERAGE_COMMAND_IDS.OpenCoverage, ["coverage:1"], { testingCoverageOpen: true })).resolves.toBe(true)
    await expect(executeCommand(TESTING_COVERAGE_COMMAND_IDS.ToggleInlineCoverage, [], { testingCoverageOpen: true })).resolves.toBe(true)
    await expect(executeCommand(TESTING_COVERAGE_COMMAND_IDS.FilterToTest, ["vitest\u0000suite"], { testingCoverageOpen: true })).resolves.toBe(true)
    await expect(executeCommand(TESTING_COVERAGE_COMMAND_IDS.ViewChangeSorting, ["coverage"], { testingCoverageOpen: true })).resolves.toBe(true)
    await expect(service.requestCoverageDetails({ coverageId: "coverage:1", testId: "vitest\u0000suite" })).resolves.toEqual([{ type: "statement", executed: 1, count: 1 }])

    expect(callbacks.cancelRun).toHaveBeenCalledWith({ runId: "run:1", taskId: "task:1" })
    expect(callbacks.configureProfile).toHaveBeenCalledWith({ controllerId: "vitest", profileId: 1 })
    expect(callbacks.getCoverageDetails).toHaveBeenCalledWith({ coverageId: "coverage:1", testId: "vitest\u0000suite" })
    expect(service.getProjection()).toEqual(expect.objectContaining({
      runs: [expect.objectContaining({ id: "run:1" })],
      coverage: expect.objectContaining({ status: "available" }),
      coverageView: expect.objectContaining({
        selectedCoverageId: "coverage:1",
        filteredToTestId: "vitest\u0000suite",
        showInline: true,
        sortOrder: "coverage",
      }),
      coverageDecorations: expect.objectContaining({
        status: "available",
        selectedCoverageId: "coverage:1",
      }),
      contract: expect.objectContaining({
        codekStateSource: "TestingService.getProjection()",
        noSecondState: true,
      }),
    }))
  })

  it("bridges test message followup provider execute and dispose through the single TestingService callbacks", async () => {
    const service = new TestingService()
    const callbacks = {
      cancelRun: vi.fn(),
      configureProfile: vi.fn(),
      getCoverageDetails: vi.fn(async () => []),
      provideTestFollowups: vi.fn(async () => [
        { id: 7, title: "Explain failure", command: "testing.explainFailure", args: ["vitest\u0000suite"] },
        { id: Number.NaN, title: "invalid" },
        { id: 8, title: "" },
      ]),
      executeTestFollowup: vi.fn(async () => {}),
      disposeTestFollowups: vi.fn(),
      publishTestResults: vi.fn(),
    }
    service.setExtensionHostCallbacks(callbacks)

    await expect(service.provideTestFollowups({
      testId: "vitest\u0000suite",
      resultId: "run:1",
      taskId: "task:1",
      message: { message: "failed", type: 0 },
    })).resolves.toEqual([
      { id: 7, title: "Explain failure", command: "testing.explainFailure", args: ["vitest\u0000suite"] },
    ])
    await expect(service.executeTestFollowup(7)).resolves.toBe(true)
    expect(service.disposeTestFollowups([7, Number.NaN])).toBe(true)

    expect(callbacks.provideTestFollowups).toHaveBeenCalledWith({
      testId: "vitest\u0000suite",
      resultId: "run:1",
      taskId: "task:1",
      message: { message: "failed", type: 0 },
    })
    expect(callbacks.executeTestFollowup).toHaveBeenCalledWith(7)
    expect(callbacks.disposeTestFollowups).toHaveBeenCalledWith([7])
    expect(service.getUpperOwnerProjection().messageFollowups).toEqual(expect.objectContaining({
      status: "partial",
      implementedOwners: expect.arrayContaining([
        "TestingService.provideTestFollowups provider facade",
        "ExtHostTesting.$provideTestFollowups/$executeTestFollowup/$disposeTestFollowups bridge",
      ]),
      blockedOwners: [
        "TestingOutputPeekController/PeekViewWidget owner for visible message reveal",
        "OutputPeekTree/TestMessageElement owner for selecting a TestMessage subject",
        "TestResultsViewContent FollowupActionWidget owner for requesting, rendering, executing, and disposing followup handles",
      ],
      blockedReason: expect.stringContaining("FollowupActionWidget"),
      noSecondState: true,
    }))
  })

  it("projects TestResultsViewContent LiveTestResult and file-backed storage owner gaps from one TestingService state source", () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({ controllerId: "vitest", profileId: 1, label: "Run", group: "run", isDefault: true })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src\u0000owner-gap.test.ts",
      label: "owner-gap.test.ts",
      uri: "file:///workspace/src/owner-gap.test.ts",
      expand: "notExpandable",
    })
    service.startRun({
      id: "run:owner-gap",
      controllerId: "vitest",
      profileId: 1,
      group: "run",
      testIds: ["vitest\u0000src\u0000owner-gap.test.ts"],
    })
    service.startRunTask("run:owner-gap", { id: "task:owner-gap", controllerId: "vitest", name: "Vitest task", running: true })
    service.appendOutput("run:owner-gap", "owner gap failed", {
      testId: "vitest\u0000src\u0000owner-gap.test.ts",
      locationUri: "file:///workspace/src/owner-gap.test.ts#L12",
    })

    const runningUpper = service.getUpperOwnerProjection()
    const runningResultsShell = service.getTestResultsViewPaneShellProjection()
    expect(runningUpper.liveResultLifecycle.lifecycleMatrix).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "run insertion and completion",
        status: "projected",
        codekProjection: "TestingService.startRun()/completeRun()",
      }),
      expect.objectContaining({
        capability: "task lifecycle and raw output",
        status: "partial",
        requiredOwner: "LiveTestResult task list, TaskRawOutput append/read stream, and task-level change events",
      }),
      expect.objectContaining({
        capability: "dispose and telemetry",
        status: "blocked",
        requiredOwner: "LiveTestResult DisposableStore and telemetry owner",
      }),
    ]))
    expect(runningUpper.liveResultLifecycle.runningRunIds).toEqual(["run:owner-gap"])
    expect(runningResultsShell.domOwnerMatrix).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "Test Results panel shell rows",
        status: "partial",
        codekProjection: "TestingService.getTestResultsViewPaneShellProjection().rows",
      }),
      expect.objectContaining({
        capability: "live result output refresh",
        requiredOwner: "LiveTestResult.onComplete/onChange listeners inside TestResultsViewContent/TestResultsTree",
      }),
      expect.objectContaining({
        capability: "message followup actions",
        status: "blocked",
        requiredOwner: "FollowupActionWidget request/render/execute/dispose owner",
      }),
    ]))
    expect(runningResultsShell.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "run:owner-gap", kind: "run", outputMessageCount: 1 }),
      expect.objectContaining({ id: "run:owner-gap:vitest\u0000src\u0000owner-gap.test.ts", kind: "test", outputMessageCount: 1 }),
    ]))

    service.finishRunTask("run:owner-gap", "task:owner-gap")
    service.completeRun("run:owner-gap", "failed")
    const storage = service.getResultStorageProjection()
    const completedUpper = service.getUpperOwnerProjection()

    expect(storage.fileBackedOwnerMatrix).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "storedTestResults manifest",
        status: "projected",
        codekProjection: "TestingService.getResultStorageProjection().retainedResultIds",
      }),
      expect.objectContaining({
        capability: "workspaceStorageHome result files",
        status: "blocked",
        requiredOwner: "TestResultStorage directory/readForResultId/writeForResultId/deleteResult owner",
      }),
      expect.objectContaining({
        capability: "raw output stream persistence",
        status: "partial",
        requiredOwner: "LiveTestResult TaskRawOutput stream and file-backed output replay owner",
      }),
    ]))
    expect(storage.retainedResultIds).toEqual(["run:owner-gap"])
    expect(completedUpper.resultService.storage.fileBackedOwnerMatrix).toEqual(storage.fileBackedOwnerMatrix)
    expect(completedUpper.liveResultLifecycle.completedRunIds).toEqual(["run:owner-gap"])

    storage.fileBackedOwnerMatrix[0].nextAuthorizedFiles.push("mutated")
    runningResultsShell.domOwnerMatrix[0].nextAuthorizedFiles.push("mutated")
    completedUpper.liveResultLifecycle.lifecycleMatrix[0].nextAuthorizedFiles.push("mutated")

    expect(service.getResultStorageProjection().fileBackedOwnerMatrix[0].nextAuthorizedFiles).not.toContain("mutated")
    expect(service.getTestResultsViewPaneShellProjection().domOwnerMatrix[0].nextAuthorizedFiles).not.toContain("mutated")
    expect(service.getUpperOwnerProjection().liveResultLifecycle.lifecycleMatrix[0].nextAuthorizedFiles).not.toContain("mutated")
  })

  it("executes a Testing Explorer run action through commandRegistry while keeping the DOM owner blocked", async () => {
    const service = new TestingService()
    service.registerController({ id: "vitest", label: "Vitest" })
    service.addProfile({
      controllerId: "vitest",
      profileId: 1,
      label: "Run focused",
      group: "run",
      isDefault: true,
    })
    service.addProfile({
      controllerId: "vitest",
      profileId: 2,
      label: "Debug focused",
      group: "debug",
      isDefault: true,
    })
    service.addProfile({
      controllerId: "vitest",
      profileId: 3,
      label: "Coverage focused",
      group: "coverage",
      isDefault: true,
    })
    service.upsertItem({ controllerId: "vitest", id: "vitest", label: "Vitest", expand: "expanded" })
    service.upsertItem({
      controllerId: "vitest",
      id: "vitest\u0000src\u0000explorer.test.ts",
      parentId: "vitest",
      label: "explorer.test.ts",
      expand: "notExpandable",
    })

    registerTestingCallbackCommands(service)

    const contract = service.getTestingExplorerContractProjection({ revealTestId: "vitest\u0000src\u0000explorer.test.ts" })
    const row = contract.rows.find((candidate) => candidate.id === "vitest\u0000src\u0000explorer.test.ts")

    expect(getCommand(TESTING_RUN_COMMAND_IDS.Run)).toEqual(expect.objectContaining({ source: "vscode" }))
    expect(getCommand(TESTING_RUN_COMMAND_IDS.Debug)).toEqual(expect.objectContaining({ source: "vscode" }))
    expect(getCommand(TESTING_RUN_COMMAND_IDS.Coverage)).toEqual(expect.objectContaining({ source: "vscode" }))
    expect(row).toEqual(expect.objectContaining({
      commandIds: expect.arrayContaining([TESTING_RUN_COMMAND_IDS.Run]),
      revealState: "target",
    }))

    await expect(executeCommand(TESTING_RUN_COMMAND_IDS.Run, [{
      controllerId: "vitest",
      testIds: ["vitest\u0000src\u0000explorer.test.ts"],
    }])).resolves.toBe(true)

    expect(service.getRuns()).toEqual([
      expect.objectContaining({
        id: "run:run:vitest:1:vitest%00src%00explorer.test.ts",
        controllerId: "vitest",
        profileId: 1,
        group: "run",
        testIds: ["vitest\u0000src\u0000explorer.test.ts"],
        state: "running",
      }),
    ])
    expect(service.getResults()).toEqual([
      expect.objectContaining({
        testId: "vitest\u0000src\u0000explorer.test.ts",
        state: "queued",
      }),
    ])
    expect(service.getContractAudit().ownerContracts.testExplorerTree).toEqual(expect.objectContaining({
      status: "projected",
      blockedReason: expect.stringContaining("does not own the VS Code TestingExplorerView ViewPane"),
      noSecondState: true,
    }))
  })
})
