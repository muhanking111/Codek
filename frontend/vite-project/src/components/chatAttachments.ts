export const MAX_TEXT_ATTACHMENT_BYTES = 160 * 1024
export const MAX_TEXT_CONTEXT_CHARS = 24_000
export const MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024

export type ChatAttachmentKind = "text" | "image" | "binary"
export type ChatAttachmentStatus = "ready" | "truncated" | "error"

export interface ChatAttachment {
  id: string
  name: string
  size: number
  type: string
  kind: ChatAttachmentKind
  status: ChatAttachmentStatus
  content?: string
  dataUrl?: string
  preview?: string
  error?: string
  truncated?: boolean
}

export type AttachmentProviderType = "openai" | "claude" | "anthropic" | "ollama" | string

export type ProviderMessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "auto" } }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }

export interface ProviderMessageBuildResult {
  messages: Array<{ role: string; content: string | ProviderMessageContentPart[] }>
  warnings: string[]
}

export interface ProviderMessageBuildOptions {
  textAttachmentBlock?: string | null
}

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "jsonc",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "vue",
  "css",
  "scss",
  "less",
  "html",
  "xml",
  "py",
  "java",
  "go",
  "rs",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "kt",
  "swift",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "yaml",
  "yml",
  "toml",
  "ini",
  "env",
  "gitignore",
  "dockerfile",
])

function makeAttachmentId(file: File): string {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${file.name}`
}

function getExtension(name: string): string {
  const lower = name.toLowerCase()
  if (lower === "dockerfile" || lower.endsWith(".dockerfile")) return "dockerfile"
  const index = lower.lastIndexOf(".")
  return index >= 0 ? lower.slice(index + 1) : lower
}

export function detectAttachmentKind(file: Pick<File, "name" | "type">): ChatAttachmentKind {
  if (file.type.startsWith("image/")) return "image"
  if (file.type.startsWith("text/")) return "text"
  if (TEXT_EXTENSIONS.has(getExtension(file.name))) return "text"
  return "binary"
}

async function readAsText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    try {
      return await file.text()
    } catch {
      // Some DOM test shims expose File.text but do not implement it fully.
    }
  }

  if (typeof file.arrayBuffer === "function") {
    const buffer = await file.arrayBuffer()
    return new TextDecoder("utf-8").decode(buffer)
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(reader.error || new Error("读取文本失败"))
    reader.readAsText(file, "utf-8")
  })
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(reader.error || new Error("读取图片失败"))
    reader.readAsDataURL(file)
  })
}

function clipTextContent(text: string): { content: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_CONTEXT_CHARS) {
    return { content: text, truncated: false }
  }
  return {
    content: text.slice(0, MAX_TEXT_CONTEXT_CHARS),
    truncated: true,
  }
}

export async function readChatAttachment(file: File): Promise<ChatAttachment> {
  const base = {
    id: makeAttachmentId(file),
    name: file.name,
    size: file.size,
    type: file.type,
    kind: detectAttachmentKind(file),
  }

  if (base.kind === "image") {
    if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
      return {
        ...base,
        status: "error",
        error: `图片超过 ${formatAttachmentSize(MAX_IMAGE_ATTACHMENT_BYTES)}，不会加入上下文。`,
      }
    }

    try {
      const dataUrl = await readAsDataUrl(file)
      return {
        ...base,
        status: "ready",
        dataUrl,
        preview: `[图片] ${file.name}`,
      }
    } catch (error) {
      return {
        ...base,
        status: "error",
        error: error instanceof Error ? error.message : "读取图片失败",
      }
    }
  }

  if (base.kind === "text") {
    if (file.size > MAX_TEXT_ATTACHMENT_BYTES) {
      return {
        ...base,
        status: "error",
        error: `文本文件超过 ${formatAttachmentSize(MAX_TEXT_ATTACHMENT_BYTES)}，不会加入上下文。`,
      }
    }

    try {
      const raw = await readAsText(file)
      const clipped = clipTextContent(raw)
      return {
        ...base,
        status: clipped.truncated ? "truncated" : "ready",
        content: clipped.content,
        preview: clipped.content.slice(0, 240),
        truncated: clipped.truncated,
      }
    } catch (error) {
      return {
        ...base,
        status: "error",
        error: error instanceof Error ? error.message : "读取文本失败",
      }
    }
  }

  return {
    ...base,
    status: "error",
    error: "暂不支持把该二进制文件加入对话上下文。",
  }
}

export function formatAttachmentSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`
  return `${Math.round(size / 1024 / 102.4) / 10} MB`
}

export function buildAttachmentContextBlock(files: ChatAttachment[]): string {
  const readyFiles = files.filter((file) => file.status !== "error")
  const failedFiles = files.filter((file) => file.status === "error")
  if (readyFiles.length === 0 && failedFiles.length === 0) return ""

  const lines: string[] = ["附件上下文:"]
  for (const file of readyFiles) {
    const size = formatAttachmentSize(file.size)
    if (file.kind === "text") {
      lines.push(`\n--- 文件: ${file.name} (${size}${file.truncated ? ", 已截断" : ""}) ---`)
      lines.push(file.content || "")
      lines.push(`--- 结束: ${file.name} ---`)
    } else if (file.kind === "image") {
      lines.push(`- 图片: ${file.name} (${size}${file.type ? `, ${file.type}` : ""})，已读取为 Data URL，可供多模态管线使用。`)
    }
  }

  if (failedFiles.length > 0) {
    lines.push("\n未加入上下文的附件:")
    for (const file of failedFiles) {
      lines.push(`- ${file.name}: ${file.error || "读取失败"}`)
    }
  }

  return lines.join("\n").trim()
}

function dataUrlParts(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl)
  if (!match) return null
  return { mimeType: match[1], base64: match[2] }
}

function supportsAttachmentVision(provider: AttachmentProviderType): boolean {
  const normalized = provider.toLowerCase()
  return normalized === "openai" || normalized === "claude" || normalized === "anthropic"
}

function buildTextAttachmentBlock(files: ChatAttachment[]): string {
  return buildAttachmentContextBlock(files.filter((file) => file.kind !== "image"))
}

export function buildProviderMessages(
  provider: AttachmentProviderType,
  text: string,
  files: ChatAttachment[] = [],
  options: ProviderMessageBuildOptions = {},
): ProviderMessageBuildResult {
  const normalizedProvider = provider.toLowerCase()
  const warnings: string[] = []
  const textBlock = typeof options.textAttachmentBlock === "string"
    ? options.textAttachmentBlock
    : buildTextAttachmentBlock(files)
  const readyImages = files.filter((file) => file.kind === "image" && file.status !== "error" && file.dataUrl)
  const failedImages = files.filter((file) => file.kind === "image" && (file.status === "error" || !file.dataUrl))
  const textContent = [textBlock, text].filter(Boolean).join("\n").trim()

  for (const file of failedImages) {
    warnings.push(`${file.name}: ${file.error || "图片未读取成功，未加入多模态消息"}`)
  }

  if (readyImages.length === 0) {
    return {
      messages: [{ role: "user", content: textContent }],
      warnings,
    }
  }

  if (!supportsAttachmentVision(normalizedProvider)) {
    warnings.push(`当前 provider 不支持图片 content part，${readyImages.length} 个图片附件已降级为文本说明。`)
    const imageLines = readyImages.map((file) => `- 图片: ${file.name} (${formatAttachmentSize(file.size)}${file.type ? `, ${file.type}` : ""})`)
    return {
      messages: [{ role: "user", content: [textContent, "图片附件未发送为多模态输入:", ...imageLines].filter(Boolean).join("\n") }],
      warnings,
    }
  }

  const parts: ProviderMessageContentPart[] = []
  if (textContent) parts.push({ type: "text", text: textContent })

  for (const file of readyImages) {
    const parsed = dataUrlParts(file.dataUrl || "")
    if (!parsed) {
      warnings.push(`${file.name}: Data URL 格式无效，未加入多模态消息。`)
      continue
    }
    if (normalizedProvider === "openai") {
      parts.push({ type: "image_url", image_url: { url: file.dataUrl || "", detail: "auto" } })
    } else {
      parts.push({
        type: "image",
        source: {
          type: "base64",
          media_type: parsed.mimeType,
          data: parsed.base64,
        },
      })
    }
  }

  return {
    messages: [{ role: "user", content: parts.length ? parts : textContent }],
    warnings,
  }
}
