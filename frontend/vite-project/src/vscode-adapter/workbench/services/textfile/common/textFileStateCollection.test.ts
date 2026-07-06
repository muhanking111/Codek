import { describe, expect, it } from "vitest"
import { createTextFileStateCollection } from "./textFileStateCollection"

describe("VS Code text file state collection adapter", () => {
  function createCollection() {
    const projection = { dirtyFiles: {} as Record<string, unknown>, externalChanges: {} as Record<string, unknown> }
    const collection = createTextFileStateCollection({
      projection,
      normalizePath: (path) => String(path || "").replace(/\\/g, "/"),
    })
    return { collection, projection }
  }

  it("projects dirty and external states into legacy records", () => {
    const { collection, projection } = createCollection()

    collection.markDirty("src\\main.ts")
    expect(projection.dirtyFiles).toHaveProperty("src/main.ts")

    collection.markExternal("src/main.ts")
    expect(projection.externalChanges).toHaveProperty("src/main.ts")

    collection.markClean("src/main.ts")
    expect(projection.dirtyFiles).not.toHaveProperty("src/main.ts")
    expect(projection.externalChanges).toHaveProperty("src/main.ts")

    collection.markSaved("src/main.ts")
    expect(projection.externalChanges).not.toHaveProperty("src/main.ts")
  })

  it("moves existing state and removes old legacy projection", () => {
    const { collection, projection } = createCollection()

    collection.markDirty("src/main.ts")
    collection.markExternal("src/main.ts")
    collection.move("src/main.ts", "src/app.ts")

    expect(projection.dirtyFiles).not.toHaveProperty("src/main.ts")
    expect(projection.externalChanges).not.toHaveProperty("src/main.ts")
    expect(projection.dirtyFiles).toHaveProperty("src/app.ts")
    expect(projection.externalChanges).toHaveProperty("src/app.ts")
  })

  it("does not hydrate state from legacy projection records", () => {
    const { collection, projection } = createCollection()
    projection.dirtyFiles["src/old.ts"] = true
    projection.externalChanges["src/old.ts"] = true

    expect(collection.isDirty("src/old.ts")).toBe(false)
    expect(collection.hasExternalChange("src/old.ts")).toBe(false)

    collection.move("src/old.ts", "src/new.ts")

    expect(collection.isDirty("src/new.ts")).toBe(false)
    expect(collection.hasExternalChange("src/new.ts")).toBe(false)
    expect(projection.dirtyFiles).not.toHaveProperty("src/old.ts")
    expect(projection.externalChanges).not.toHaveProperty("src/old.ts")
  })

  it("tracks lifecycle state names", () => {
    const { collection } = createCollection()

    expect(collection.stateName("src/main.ts")).toBe("saved")
    collection.markPendingSave("src/main.ts")
    expect(collection.stateName("src/main.ts")).toBe("pendingSave")
    collection.markConflict("src/main.ts")
    expect(collection.isState("src/main.ts", "conflict")).toBe(true)
    collection.markOrphan("src/main.ts")
    expect(collection.isState("src/main.ts", "orphan")).toBe(true)
    collection.markError("src/main.ts")
    expect(collection.isState("src/main.ts", "error")).toBe(true)
  })

  it("enumerates dirty and external paths from the state collection", () => {
    const { collection } = createCollection()

    collection.markDirty("src/main.ts")
    collection.markExternal("src/other.ts")

    expect(collection.paths({ dirty: true })).toEqual(["src/main.ts"])
    expect(collection.paths({ external: true })).toEqual(["src/other.ts"])
  })

  it("clears model and projection together", () => {
    const { collection, projection } = createCollection()
    collection.markDirty("src/main.ts")
    collection.markExternal("src/other.ts")

    collection.clear()

    expect(projection.dirtyFiles).toEqual({})
    expect(projection.externalChanges).toEqual({})
    expect(collection.stateName("src/main.ts")).toBe("saved")
  })
})
