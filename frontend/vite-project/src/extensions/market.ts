interface MarketExtension {
  id: string
  name: string
  version: string
  description: string
  author: string
  download: string
  icon: string
}

const MARKET_URL = "https://raw.githubusercontent.com/codek/codek-extensions/main/extensions.json"

const DEFAULT_MARKET: MarketExtension[] = [
  {
    id: "codek-gitlens",
    name: "Codek GitLens",
    version: "1.0.0",
    description: "Enhanced Git integration with git blame, history, and diff view.",
    author: "Codek Team",
    download: "https://github.com/codek/codek-extensions/releases/download/v1.0.0/codek-gitlens.zip",
    icon: "git",
  },
]

export async function fetchMarketplace(): Promise<MarketExtension[]> {
  try {
    const res = await fetch(MARKET_URL)
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data)) return data
    }
  } catch {
    // fallback to default market
  }
  return DEFAULT_MARKET
}

export async function downloadExtension(downloadUrl: string, destDir: string): Promise<boolean> {
  const response = await fetch(downloadUrl)
  if (!response.ok) throw new Error(`Download failed: ${response.status}`)

  const blob = await response.blob()

  if (typeof window !== "undefined" && window.codek?.extractZip) {
    await window.codek.extractZip(await blob.arrayBuffer(), destDir)
  }

  return true
}