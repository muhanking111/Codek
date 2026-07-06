import { reactive, shallowRef } from "vue"

const VISION_SUPPORTED_PROVIDERS = new Set([
  "openai",
  "claude",
  "anthropic",
  "ollama",
])

const MAX_IMAGE_DIMENSION = 2048
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024

interface ImagePreview {
  file: File
  dataUrl: string
  timestamp: number
}

export const imagePreview = shallowRef<ImagePreview | null>(null)

export const multimodalState = reactive({
  isProcessing: false,
  lastError: "",
})

export function isVisionSupported(provider: string): boolean {
  return VISION_SUPPORTED_PROVIDERS.has(provider.toLowerCase())
}

export function clearImagePreview(): void {
  if (imagePreview.value?.dataUrl?.startsWith("blob:")) {
    URL.revokeObjectURL(imagePreview.value.dataUrl)
  }
  imagePreview.value = null
}

async function resizeImageIfNeeded(
  file: File,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)
      const { width, height } = img

      if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
        resolve(file as unknown as Blob)
        return
      }

      const scale = Math.min(
        MAX_IMAGE_DIMENSION / width,
        MAX_IMAGE_DIMENSION / height,
      )
      const newWidth = Math.round(width * scale)
      const newHeight = Math.round(height * scale)

      const canvas = document.createElement("canvas")
      canvas.width = newWidth
      canvas.height = newHeight
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        resolve(file as unknown as Blob)
        return
      }

      ctx.drawImage(img, 0, 0, newWidth, newHeight)
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob)
          } else {
            resolve(file as unknown as Blob)
          }
        },
        "image/jpeg",
        0.85,
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("Failed to load image for resizing"))
    }

    img.src = url
  })
}

export async function encodeImageForProvider(
  file: File,
  provider: string,
): Promise<{ base64: string; mimeType: string }> {
  multimodalState.lastError = ""

  if (!isVisionSupported(provider)) {
    const msg = `Provider "${provider}" does not support vision`
    multimodalState.lastError = msg
    throw new Error(msg)
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    const msg = "Image exceeds maximum size of 20MB"
    multimodalState.lastError = msg
    throw new Error(msg)
  }

  multimodalState.isProcessing = true

  try {
    const resized = await resizeImageIfNeeded(file)
    const mimeType = resized.type || "image/jpeg"

    return new Promise<{ base64: string; mimeType: string }>(
      (resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          multimodalState.isProcessing = false
          const result = reader.result as string
          const base64 = result.split(",")[1] || result
          resolve({ base64, mimeType })
        }
        reader.onerror = () => {
          multimodalState.isProcessing = false
          const msg = "Failed to read image file"
          multimodalState.lastError = msg
          reject(new Error(msg))
        }
        reader.readAsDataURL(resized)
      },
    )
  } catch (err) {
    multimodalState.isProcessing = false
    const msg = err instanceof Error ? err.message : "Failed to encode image"
    multimodalState.lastError = msg
    throw new Error(msg)
  }
}

interface VisionContent {
  type: string
  text?: string
  source?: {
    type: string
    media_type: string
    data: string
  }
  image_url?: {
    url: string
    detail?: string
  }
}

export function createVisionMessage(
  text: string,
  imageBase64: string,
  mimeType?: string,
): { role: string; content: VisionContent[] } {
  const content: VisionContent[] = []

  if (imageBase64) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mimeType || "image/jpeg",
        data: imageBase64,
      },
    })
  }

  if (text) {
    content.push({ type: "text", text })
  }

  return { role: "user", content }
}

export function createVisionMessageForOpenAI(
  text: string,
  imageBase64: string,
  mimeType?: string,
): { role: string; content: VisionContent[] } {
  const resolvedMime = mimeType || "image/jpeg"
  const dataUrl = `data:${resolvedMime};base64,${imageBase64}`

  const content: VisionContent[] = [
    {
      type: "image_url",
      image_url: {
        url: dataUrl,
        detail: "auto",
      },
    },
  ]

  if (text) {
    content.unshift({ type: "text", text })
  }

  return { role: "user", content }
}

export function handleImagePaste(event: ClipboardEvent): void {
  const items = event.clipboardData?.items
  if (!items) return

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.type.startsWith("image/")) {
      event.preventDefault()
      const file = item.getAsFile()
      if (file) {
        const dataUrl = URL.createObjectURL(file)
        if (imagePreview.value?.dataUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(imagePreview.value.dataUrl)
        }
        imagePreview.value = { file, dataUrl, timestamp: Date.now() }
      }
      return
    }
  }
}

export function handleImageDrop(event: DragEvent): void {
  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (file.type.startsWith("image/")) {
      event.preventDefault()
      const dataUrl = URL.createObjectURL(file)
      if (imagePreview.value?.dataUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(imagePreview.value.dataUrl)
      }
      imagePreview.value = { file, dataUrl, timestamp: Date.now() }
      return
    }
  }
}

export function getSupportedImageTypes(): string[] {
  return ["image/png", "image/jpeg", "image/gif", "image/webp"]
}