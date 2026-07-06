import { describe, expect, it } from "vitest"
import { getFilepathHintForBlock, isApplicableCodeBlock, parseCodeBlocks } from "./diffApply"

describe("diffApply code block targeting", () => {
  it("does not offer file apply actions for shell command blocks", () => {
    expect(isApplicableCodeBlock({ language: "bash", content: "cat src/cart.js" })).toBe(false)
    expect(
      isApplicableCodeBlock({ language: "powershell", content: "Get-Content src/cart.js" }),
    ).toBe(false)
    expect(isApplicableCodeBlock({ language: "", content: "npm test" })).toBe(false)
  })

  it("infers a single open editor as the apply target when the block has no explicit path", () => {
    const hint = getFilepathHintForBlock(
      { language: "ts", content: "export function total() {\n  return 1\n}" },
      { openFiles: ["src/cart.ts"] },
    )

    expect(hint).toBe("src/cart.ts")
  })

  it("keeps explicit file hints from fenced languages", () => {
    const [block] = parseCodeBlocks("```ts:src/cart.ts\nexport const cart = []\n```")

    expect(block).toEqual(
      expect.objectContaining({
        language: "ts",
        filepath: "src/cart.ts",
      }),
    )
    expect(isApplicableCodeBlock(block)).toBe(true)
    expect(getFilepathHintForBlock(block, { openFiles: ["src/other.ts"] })).toBe("src/cart.ts")
  })

  it("allows explicit file paths even when the language label is usually command-like", () => {
    const [block] = parseCodeBlocks("```sh:scripts/start.sh\n#!/usr/bin/env bash\necho ready\n```")

    expect(block.filepath).toBe("scripts/start.sh")
    expect(isApplicableCodeBlock(block)).toBe(true)
  })
})
