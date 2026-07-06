const assert = require("node:assert/strict")
const test = require("node:test")

const {
  collectReportFailures,
  largeFileMarker,
  minimumWindowLineCount,
} = require("./workbench-large-file-256mb-smoke")

const expectedFixtureRoot = "D:/Workspace/.codek/large-file-256mb-fixture"
const expectedBytes = 260 * 1024 * 1024
const minWindowBytes = 32 * 1024 * 1024

function makeReadyReport(metricPatch = {}) {
  const markerSample = `line 000001 ${largeFileMarker}`
  return {
    projectRoot: expectedFixtureRoot,
    createdAt: "2026-06-24T00:00:10.000Z",
    ready: true,
    acceptance: {
      largeFileRealContentVisible: true,
      largeFileUserScrollAvoidsBlankViewport: true,
    },
    metrics: {
      largeFileRealContentVisible: true,
      largeFileViewportTextVisible: true,
      largeFileDeepViewportTextVisible: true,
      largeFileNextWindowViewportTextVisible: true,
      largeFileUserPageDownViewportTextVisible: true,
      largeFileUserScrollBottomLoaded: true,
      largeFileUserScrollBottomOffsetAdvanced: true,
      largeFileUserScrollBottomViewportTextVisible: true,
      largeFileUserScrollbarDragDispatched: true,
      largeFileUserScrollbarDragScrollAdvanced: true,
      largeFileUserScrollbarDragDirectLoadRequired: false,
      largeFileUserScrollbarDragDirectLoaded: false,
      largeFileUserScrollbarDragLoaded: true,
      largeFileUserScrollbarDragOffsetAdvanced: true,
      largeFileUserScrollbarDragViewportTextVisible: true,
      largeFileUserEndViewportTextVisible: true,
      largeFileFinalWindowViewportTextVisible: true,
      largeFileReopenViewportTextVisible: true,
      largeFileReopenRealContentVisible: true,
      largeFileContinuousWindowVisible: true,
      largeFileRangeStateVisible: true,
      largeFileNextWindowLoaded: true,
      largeFileNextWindowVisible: true,
      largeFileFinalWindowLoaded: true,
      largeFileFinalWindowVisible: true,
      extremeFileAutoWindowNavigation: true,
      largeFileEditorLineCount: minimumWindowLineCount,
      largeFileEditorValueLength: minWindowBytes,
      largeFileActiveFileContentLength: minWindowBytes,
      largeFileRangeStateBytesRead: minWindowBytes,
      largeFileRangeStateWindowBytes: minWindowBytes,
      largeFileWindowNavigationRequired: true,
      largeFileRangeStateReadOnly: false,
      largeFileDeepViewportLine: 2500,
      largeFileDeepViewportProbe: {
        editorViewport: {
          visibleRanges: [{ startLineNumber: 2380, endLineNumber: 2520 }],
          position: { lineNumber: 2490 },
        },
        visibleNonEmptyViewLineCount: 20,
      },
      largeFileDeepViewportTextSample: markerSample,
      largeFileNextWindowViewportTextSample: markerSample,
      largeFileUserPageDownViewportTextSample: markerSample,
      largeFileUserScrollBottomViewportTextSample: markerSample,
      largeFileUserScrollbarDragViewportTextSample: markerSample,
      largeFileUserEndViewportTextSample: markerSample,
      largeFileFinalWindowViewportTextSample: markerSample,
      largeFileReopenViewportTextSample: markerSample,
      largeFileFinalWindowHasNext: false,
      largeFileFinalWindowOffset: expectedBytes - minWindowBytes,
      largeFileFinalWindowWindowBytes: minWindowBytes,
      largeFileFinalWindowSize: expectedBytes,
      largeFileFinalWindowVisitedOffsets: [0, minWindowBytes, expectedBytes - minWindowBytes],
      largeFileUserScrollTargetOffset: minWindowBytes,
      largeFileUserScrollBottomOffset: minWindowBytes,
      largeFileUserScrollbarDragTargetOffset: expectedBytes - minWindowBytes,
      largeFileUserScrollbarDragOffset: expectedBytes - minWindowBytes,
      largeFileUserScrollbarDragScrollBefore: 100,
      largeFileUserScrollbarDragScrollAfter: 200,
      ...metricPatch,
    },
  }
}

test("large-file 256MiB gate accepts final-window scrollbar drag without direct window load requirement", () => {
  const failures = collectReportFailures(makeReadyReport(), {
    expectedFixtureRoot,
    bytes: expectedBytes,
    runStartedAtMs: Date.parse("2026-06-24T00:00:00.000Z"),
  })

  assert.deepEqual(failures, [])
})

test("large-file 256MiB gate still fails when direct scrollbar drag load is required but absent", () => {
  const failures = collectReportFailures(makeReadyReport({
    largeFileUserScrollbarDragDirectLoadRequired: true,
    largeFileUserScrollbarDragDirectLoaded: false,
  }), {
    expectedFixtureRoot,
    bytes: expectedBytes,
    runStartedAtMs: Date.parse("2026-06-24T00:00:00.000Z"),
  })

  assert.ok(failures.includes("largeFileUserScrollbarDragDirectLoaded is not true while direct load is required"))
})
