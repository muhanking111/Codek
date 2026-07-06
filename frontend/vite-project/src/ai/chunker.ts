/**
 * Chunker — splits files into chunks for vector indexing.
 * 256 tokens per chunk, 32 token overlap.
 */

const TOKENS_PER_CHUNK = 256
const TOKEN_OVERLAP = 32

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export interface Chunk {
  text: string
  startLine: number
  endLine: number
  tokenCount: number
}

export function chunkFile(content: string, filePath: string): Chunk[] {
  const lines = content.split('\n')
  const chunks: Chunk[] = []
  let currentChunk: string[] = []
  let currentTokens = 0
  let startLine = 1
  let overlapBuffer: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineTokens = estimateTokens(line)

    if (currentTokens + lineTokens > TOKENS_PER_CHUNK && currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.join('\n'),
        startLine,
        endLine: i,
        tokenCount: currentTokens,
      })

      // Maintain overlap
      const overlapLines: string[] = []
      let overlapTokens = 0
      for (let j = currentChunk.length - 1; j >= 0 && overlapTokens < TOKEN_OVERLAP; j--) {
        const t = estimateTokens(currentChunk[j])
        if (overlapTokens + t > TOKEN_OVERLAP) break
        overlapLines.unshift(currentChunk[j])
        overlapTokens += t
      }
      overlapBuffer = overlapLines
      currentChunk = [...overlapBuffer]
      currentTokens = overlapTokens
      startLine = Math.max(1, i - overlapBuffer.length + 1)
    }

    currentChunk.push(line)
    currentTokens += lineTokens
  }

  if (currentChunk.length > 0) {
    chunks.push({
      text: currentChunk.join('\n'),
      startLine,
      endLine: lines.length,
      tokenCount: currentTokens,
    })
  }

  return chunks
}
