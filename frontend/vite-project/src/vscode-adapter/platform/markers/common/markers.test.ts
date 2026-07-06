import { describe, expect, it, vi } from "vitest"
import { URI } from "../../../base/common/uri"
import { getSingletonServiceDescriptors } from "../../instantiation/common/extensions"
import { InstantiationService } from "../../instantiation/common/instantiationService"
import { ServiceCollection } from "../../instantiation/common/serviceCollection"
import {
  IMarkerService,
  MarkerService,
  MarkerSeverity,
  globalMarkerService,
  makeMarkerKey,
  normalizeMarkerData,
  sortMarkers,
  toCodekSeverity,
  toMarkerSeverity,
} from "./markers"

describe("marker adapter", () => {
  it("maps VS Code marker severities to Codek severities", () => {
    expect(toMarkerSeverity("warning")).toBe(MarkerSeverity.Warning)
    expect(toMarkerSeverity(8)).toBe(MarkerSeverity.Error)
    expect(toCodekSeverity(MarkerSeverity.Info)).toBe("info")
    expect(toCodekSeverity(MarkerSeverity.Hint)).toBe("ai")
  })

  it("normalizes marker ranges to one-based positions", () => {
    expect(normalizeMarkerData({ startLineNumber: 0, startColumn: 0, message: "bad", severity: "error" })).toEqual(
      expect.objectContaining({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }),
    )
  })

  it("creates stable marker keys compatible with VS Code marker identity", () => {
    expect(makeMarkerKey({ source: "ts", code: "E1", message: "bad¦pipe", startLineNumber: 2, startColumn: 3 })).toBe(
      "¦ts¦E1¦bad\\¦pipe¦2¦3¦2¦4¦",
    )
  })

  it("sorts markers by severity, file and range", () => {
    const sorted = sortMarkers([
      { file: "b.ts", severity: "info", startLineNumber: 1 },
      { file: "a.ts", severity: "error", startLineNumber: 5 },
      { file: "a.ts", severity: "error", startLineNumber: 2 },
      { file: "a.ts", severity: "warning", startLineNumber: 1 },
    ])

    expect(sorted.map((marker) => `${marker.file}:${marker.severity}:${marker.startLineNumber}`)).toEqual([
      "a.ts:error:2",
      "a.ts:error:5",
      "a.ts:warning:1",
      "b.ts:info:1",
    ])
  })

  it("registers a VS Code-style marker service identifier and singleton", () => {
    const service = new MarkerService()
    const collection = new ServiceCollection([IMarkerService, service])
    const instantiationService = new InstantiationService(collection)

    const resolved = instantiationService.invokeFunction((accessor) => accessor.get(IMarkerService))

    expect(String(IMarkerService)).toBe("markerService")
    expect(resolved).toBe(service)
    expect(resolved._serviceBrand).toBeUndefined()
    expect(globalMarkerService._serviceBrand).toBeUndefined()
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === IMarkerService && instance === globalMarkerService)).toBe(true)
  })

  it("changes, reads, removes and reports marker statistics by owner and resource", async () => {
    const service = new MarkerService()
    const resource = URI.file("D:/repo/src/App.vue")
    const changed = vi.fn()
    service.onMarkerChanged(changed)

    service.changeOne("typescript", resource, [
      { startLineNumber: 3, startColumn: 2, endLineNumber: 3, message: "bad", severity: MarkerSeverity.Error },
      { startLineNumber: 4, startColumn: 1, endLineNumber: 4, message: "warn", severity: MarkerSeverity.Warning },
    ])

    expect(service.read({ owner: "typescript", resource }).map((marker) => `${marker.owner}:${marker.resource.fsPath.replace(/\\/g, "/")}:${marker.message}`)).toEqual([
      "typescript:d:/repo/src/App.vue:bad",
      "typescript:d:/repo/src/App.vue:warn",
    ])
    expect(service.getStatistics()).toEqual({ errors: 1, warnings: 1, infos: 0, unknowns: 0 })
    await Promise.resolve()
    expect(changed).toHaveBeenLastCalledWith([resource])

    service.remove("typescript", [resource])
    await Promise.resolve()

    expect(service.read({ owner: "typescript", resource })).toEqual([])
    expect(service.getStatistics()).toEqual({ errors: 0, warnings: 0, infos: 0, unknowns: 0 })
  })

  it("coalesces marker changed events per microtask like VS Code marker service", async () => {
    const service = new MarkerService()
    const app = URI.file("D:/repo/src/App.vue")
    const main = URI.file("D:/repo/src/main.ts")
    const changed = vi.fn()
    service.onMarkerChanged(changed)

    service.changeOne("lint", app, [{ startLineNumber: 1, startColumn: 1, message: "lint", severity: "warning" }])
    service.changeOne("compiler", app, [{ startLineNumber: 2, startColumn: 1, message: "compile", severity: "error" }])
    service.changeOne("lint", main, [{ startLineNumber: 3, startColumn: 1, message: "main", severity: "info" }])

    expect(changed).not.toHaveBeenCalled()
    await Promise.resolve()

    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed.mock.calls[0][0].map((resource: URI) => resource.fsPath.replace(/\\/g, "/"))).toEqual([
      "d:/repo/src/App.vue",
      "d:/repo/src/main.ts",
    ])
  })

  it("does not emit marker changes when clearing a missing owner/resource tuple", async () => {
    const service = new MarkerService()
    const resource = URI.file("D:/repo/src/missing.ts")
    const changed = vi.fn()
    service.onMarkerChanged(changed)

    service.changeOne("lint", resource, [])
    await Promise.resolve()

    expect(changed).not.toHaveBeenCalled()
  })

  it("replaces all markers for an owner without clearing other owners", () => {
    const service = new MarkerService()
    const app = URI.file("D:/repo/src/App.vue")
    const main = URI.file("D:/repo/src/main.ts")

    service.changeOne("lint", app, [{ startLineNumber: 1, startColumn: 1, message: "old", severity: "warning" }])
    service.changeOne("compiler", app, [{ startLineNumber: 2, startColumn: 1, message: "compile", severity: "error" }])
    service.changeAll("lint", [
      [main, [{ startLineNumber: 5, startColumn: 1, message: "new", severity: "info" }]],
    ])

    expect(service.read({ owner: "lint" }).map((marker) => `${marker.resource.fsPath.replace(/\\/g, "/")}:${marker.message}`)).toEqual([
      "d:/repo/src/main.ts:new",
    ])
    expect(service.read({ owner: "compiler" }).map((marker) => marker.message)).toEqual(["compile"])
  })

  it("supports severity filters and take limits when reading markers", () => {
    const service = new MarkerService()
    const app = URI.file("D:/repo/src/App.vue")
    service.changeOne("mixed", app, [
      { startLineNumber: 1, startColumn: 1, message: "info", severity: "info" },
      { startLineNumber: 2, startColumn: 1, message: "error", severity: "error" },
      { startLineNumber: 3, startColumn: 1, message: "hint", severity: "ai" },
    ])

    expect(service.read({ severities: MarkerSeverity.Error | MarkerSeverity.Info, take: 1 }).map((marker) => marker.message)).toEqual([
      "error",
    ])
  })

  it("exposes readonly owner/resource evidence without adding another marker source", () => {
    const service = new MarkerService()
    const app = URI.file("D:/repo/src/App.vue")
    const main = URI.file("D:/repo/src/main.ts")

    service.changeOne("eslint", app, [
      { startLineNumber: 1, startColumn: 1, message: "lint", severity: "warning" },
    ])
    service.changeOne("typescript", app, [
      { startLineNumber: 2, startColumn: 1, message: "compile", severity: "error" },
    ])
    service.changeOne("typescript", main, [
      { startLineNumber: 3, startColumn: 1, message: "main", severity: "info" },
    ])

    expect(service.getOwnerEvidenceSnapshot()).toEqual({
      serviceId: "markerService",
      stateSource: "markerService",
      readonlyEvidence: true,
      ownerCount: 2,
      resourceCount: 2,
      markerCount: 3,
      owners: [
        {
          owner: "eslint",
          resourceCount: 1,
          markerCount: 1,
          resources: [{ resourcePreview: app.toString(), markerCount: 1 }],
        },
        {
          owner: "typescript",
          resourceCount: 2,
          markerCount: 2,
          resources: [
            { resourcePreview: app.toString(), markerCount: 1 },
            { resourcePreview: main.toString(), markerCount: 1 },
          ],
        },
      ],
    })
    expect(service.read()).toHaveLength(3)
  })
})
