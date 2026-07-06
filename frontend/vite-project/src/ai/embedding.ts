import { embedText } from "./backend"

const EMBED_MODEL = "nomic-embed-text"
const TF_IDF_DIMENSION = 256

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
  "neither", "each", "every", "all", "any", "few", "more", "most", "other",
  "some", "such", "no", "only", "own", "same", "than", "too", "very",
  "just", "because", "if", "when", "where", "how", "what", "which", "who",
  "whom", "this", "that", "these", "those", "i", "me", "my", "myself",
  "we", "our", "ours", "ourselves", "you", "your", "yours", "yourself",
  "he", "him", "his", "himself", "she", "her", "hers", "herself",
  "it", "its", "itself", "they", "them", "their", "theirs", "themselves",
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
}

function computeTfIdfVector(
  tokens: string[],
  idfMap: Map<string, number>,
): number[] {
  const vec = new Array(TF_IDF_DIMENSION).fill(0)
  const termFreq = new Map<string, number>()

  for (const token of tokens) {
    termFreq.set(token, (termFreq.get(token) ?? 0) + 1)
  }

  for (const [term, freq] of termFreq) {
    const idf = idfMap.get(term) ?? 1
    const tf = freq / tokens.length
    const tfidf = tf * idf

    let hash = 0
    for (let i = 0; i < term.length; i++) {
      hash = ((hash * 31 + term.charCodeAt(i)) % TF_IDF_DIMENSION + TF_IDF_DIMENSION) % TF_IDF_DIMENSION
    }
    vec[hash] += tfidf
  }

  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm
    }
  }

  return vec
}

export async function encodeWithOllama(text: string): Promise<number[] | null> {
  try {
    const embedding = await embedText(EMBED_MODEL, text)
    if (embedding && Array.isArray(embedding)) return embedding
    return null
  } catch {
    return null
  }
}

export class TfIdfEncoder {
  private readonly documentFrequency: Map<string, number> = new Map()
  private documentCount = 0

  addDocument(text: string): void {
    const tokens = new Set(tokenize(text))
    this.documentCount++
    for (const token of tokens) {
      this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1)
    }
  }

  getIdfMap(): Map<string, number> {
    const idfMap = new Map<string, number>()
    for (const [term, df] of this.documentFrequency) {
      idfMap.set(term, Math.log((this.documentCount + 1) / (df + 1)) + 1)
    }
    return idfMap
  }

  encode(text: string): number[] {
    const tokens = tokenize(text)
    const idfMap = this.getIdfMap()
    return computeTfIdfVector(tokens, idfMap)
  }

  reset(): void {
    this.documentFrequency.clear()
    this.documentCount = 0
  }
}

const globalEncoder = new TfIdfEncoder()

export async function encode(text: string): Promise<number[]> {
  const ollamaVec = await encodeWithOllama(text)
  if (ollamaVec) return ollamaVec
  globalEncoder.addDocument(text)
  return globalEncoder.encode(text)
}
