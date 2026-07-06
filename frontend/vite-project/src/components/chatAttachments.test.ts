import { describe, expect, it } from "vitest"
import {
  MAX_TEXT_ATTACHMENT_BYTES,
  buildAttachmentContextBlock,
  buildProviderMessages,
  detectAttachmentKind,
  readChatAttachment,
} from "./chatAttachments"

describe("chatAttachments", () => {
  it("detects text files by mime type and extension", () => {
    expect(detectAttachmentKind(new File(["hello"], "notes.md", { type: "" }))).toBe("text")
    expect(detectAttachmentKind(new File(["hello"], "notes.txt", { type: "text/plain" }))).toBe("text")
    expect(detectAttachmentKind(new File(["raw"], "archive.zip", { type: "application/zip" }))).toBe("binary")
  })

  it("reads text attachment content for chat context", async () => {
    const attachment = await readChatAttachment(new File(["export const value = 1\n"], "demo.ts", { type: "text/typescript" }))

    expect(attachment.status).toBe("ready")
    expect(attachment.kind).toBe("text")
    expect(attachment.content).toContain("export const value")
    expect(buildAttachmentContextBlock([attachment])).toContain("--- 文件: demo.ts")
  })

  it("rejects oversized text attachments instead of silently sending metadata only", async () => {
    const attachment = await readChatAttachment(new File(["x".repeat(MAX_TEXT_ATTACHMENT_BYTES + 1)], "large.md", { type: "text/markdown" }))

    expect(attachment.status).toBe("error")
    expect(attachment.error).toContain("超过")
    expect(buildAttachmentContextBlock([attachment])).toContain("未加入上下文")
  })

  it("reads image attachment as data url metadata", async () => {
    const attachment = await readChatAttachment(new File(["fake"], "shot.png", { type: "image/png" }))

    expect(attachment.status).toBe("ready")
    expect(attachment.kind).toBe("image")
    expect(attachment.dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(buildAttachmentContextBlock([attachment])).toContain("图片: shot.png")
  })

  it("builds OpenAI image content parts from image attachments", async () => {
    const attachment = await readChatAttachment(new File(["fake"], "shot.png", { type: "image/png" }))
    const result = buildProviderMessages("openai", "看一下这张图", [attachment])
    const content = result.messages[0].content

    expect(Array.isArray(content)).toBe(true)
    expect(content).toEqual([
      { type: "text", text: "看一下这张图" },
      { type: "image_url", image_url: { url: attachment.dataUrl, detail: "auto" } },
    ])
    expect(result.warnings).toEqual([])
  })

  it("builds Anthropic image source parts without storing raw image in text", async () => {
    const attachment = await readChatAttachment(new File(["fake"], "shot.png", { type: "image/png" }))
    const result = buildProviderMessages("anthropic", "描述图片", [attachment])
    const content = result.messages[0].content

    expect(Array.isArray(content)).toBe(true)
    expect(JSON.stringify(content)).toContain('"type":"image"')
    expect(JSON.stringify(content)).toContain('"media_type":"image/png"')
    expect(JSON.stringify(content)).not.toContain("data:image/png;base64")
  })

  it("downgrades images for providers without vision support", async () => {
    const attachment = await readChatAttachment(new File(["fake"], "shot.png", { type: "image/png" }))
    const result = buildProviderMessages("ollama", "解释附件", [attachment])

    expect(typeof result.messages[0].content).toBe("string")
    expect(String(result.messages[0].content)).toContain("图片附件未发送为多模态输入")
    expect(result.warnings[0]).toContain("不支持图片")
  })
})
