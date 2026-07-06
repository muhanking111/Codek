import { describe, expect, it, vi } from "vitest"
import { ServiceCollection } from "../../../../platform/instantiation/common/serviceCollection"
import { InstantiationService } from "../../../../platform/instantiation/common/instantiationService"
import { CodekBulkEditService } from "../../../services/bulkEdit/common/bulkEditService"
import { CodekReplaceService, IReplaceService } from "./replaceService"

describe("CodekReplaceService", () => {
  it("registers a VS Code-style replace service identifier", () => {
    const bulkEditService = new CodekBulkEditService({ readFile: async () => "", saveFile: async () => true })
    const service = new CodekReplaceService({ bulkEditService })
    const collection = new ServiceCollection([IReplaceService, service])
    const instantiationService = new InstantiationService(collection)

    const resolved = instantiationService.invokeFunction((accessor) => accessor.get(IReplaceService))

    expect(String(IReplaceService)).toBe("replaceService")
    expect(resolved).toBe(service)
    expect(resolved._serviceBrand).toBeUndefined()
  })

  it("dry-runs one precise search match through BulkEdit", async () => {
    const saveFile = vi.fn(async () => true)
    const service = new CodekReplaceService({
      bulkEditService: new CodekBulkEditService({
        readFile: async () => "const value = needle + needle\n",
        saveFile,
      }),
    })

    const result = await service.replaceOne({
      pattern: /needle/g,
      replaceText: "haystack",
      matches: [{
        path: "src/repeated.ts",
        matches: [{
          line: 1,
          column: 15,
          matchLength: 6,
          occurrences: [
            { column: 15, matchLength: 6 },
            { column: 24, matchLength: 6 },
          ],
        }],
      }],
      dryRun: true,
    })

    expect(result.summary.editCount).toBe(1)
    expect(result.summary.changedFiles).toEqual(["src/repeated.ts"])
    expect(saveFile).not.toHaveBeenCalled()
  })

  it("replaces all known matches from real workspace content instead of using a blind content.replace fallback", async () => {
    const saveFile = vi.fn(async () => true)
    const service = new CodekReplaceService({
      bulkEditService: new CodekBulkEditService({
        readFile: async (path) => {
          if (path === "src/a.ts") return "needle needle other\n"
          if (path === "src/b.ts") return "prefix needle suffix\n"
          return null
        },
        saveFile,
      }),
    })

    const result = await service.replaceAll({
      pattern: /needle/g,
      replaceText: "haystack",
      matches: [
        {
          path: "src/a.ts",
          matches: [{
            line: 1,
            column: 1,
            matchLength: 6,
            occurrences: [
              { column: 1, matchLength: 6 },
              { column: 8, matchLength: 6 },
            ],
          }],
        },
        {
          path: "src/b.ts",
          matches: [{ line: 1, column: 8, matchLength: 6 }],
        },
      ],
    })

    expect(result.applied).toBe(true)
    expect(saveFile).toHaveBeenCalledWith(
      "src/a.ts",
      "haystack haystack other\n",
      expect.objectContaining({ reason: "search replace" }),
    )
    expect(saveFile).toHaveBeenCalledWith(
      "src/b.ts",
      "prefix haystack suffix\n",
      expect.objectContaining({ reason: "search replace" }),
    )
    expect(result.summary.editCount).toBe(3)
  })

  it("reports skipped replace operations when no match metadata can be converted to edits", async () => {
    const service = new CodekReplaceService({
      bulkEditService: new CodekBulkEditService({
        readFile: async () => "no matching content\n",
        saveFile: async () => true,
      }),
    })

    const result = await service.replaceOne({
      pattern: /needle/g,
      replaceText: "haystack",
      matches: [{ path: "src/a.ts", matches: [{ line: 1 }] }],
    })

    expect(result.applied).toBe(false)
    expect(result.summary.skippedFiles).toEqual(["src/a.ts"])
  })
})
