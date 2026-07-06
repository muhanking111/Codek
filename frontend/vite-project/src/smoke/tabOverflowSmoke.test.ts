import { describe, expect, it } from "vitest"

import { openTabOverflowSmokeFiles } from "./tabOverflowSmoke"

describe("tab overflow smoke file opening", () => {
  it("opens files through the real open callback and records progress stages", async () => {
    const opened = new Set<string>()
    const stages: string[] = []
    const paths = Array.from({ length: 3 }, (_value, index) => `src/tab-${index}.txt`)

    const result = await openTabOverflowSmokeFiles({
      paths,
      openFile: async (path) => {
        opened.add(path)
        return true
      },
      isOpen: (path) => opened.has(path),
      minOpenCount: 2,
      perFileTimeoutMs: 1000,
      setStage: (stage) => stages.push(stage),
    })

    expect(result).toEqual(paths)
    expect(stages).toContain("open-files:start")
    expect(stages).toContain("open-file:start")
    expect(stages).toContain("open-file:done")
    expect(stages).toContain("open-files:min-reached")
    expect(stages.at(-1)).toBe("open-files:done")
  })

  it("fails with the stuck path instead of waiting for the global Electron timeout", async () => {
    await expect(openTabOverflowSmokeFiles({
      paths: ["src/stuck.txt"],
      openFile: () => new Promise(() => {}),
      isOpen: () => false,
      perFileTimeoutMs: 1,
    })).rejects.toThrow(/open src\/stuck\.txt/)
  })

  it("recovers a stuck open path through an explicit smoke fallback", async () => {
    const opened = new Set<string>()
    const stages: string[] = []

    const result = await openTabOverflowSmokeFiles({
      paths: ["src/stuck.txt"],
      openFile: () => new Promise(() => {}),
      recoverOpenFile: async (path) => {
        opened.add(path)
        return true
      },
      isOpen: (path) => opened.has(path),
      perFileTimeoutMs: 5,
      setStage: (stage) => stages.push(stage),
    })

    expect(result).toEqual(["src/stuck.txt"])
    expect(stages).toContain("open-file:recover")
    expect(stages).toContain("open-file:done")
  })
})
