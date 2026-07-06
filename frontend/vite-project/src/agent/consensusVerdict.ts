export type ConsensusVerdict = "pass" | "fail" | "needs-fix" | "unknown"

export interface ParsedConsensusVerdict {
  verdict: ConsensusVerdict
  reason?: string
  evidence: string[]
}

const VERDICT_RE = /\b(pass|fail|needs-fix|needs_fix|needs fix|unknown)\b/i

export function parseConsensusVerdict(output: string): ParsedConsensusVerdict {
  const json = parseVerdictJson(output)
  if (json) return json

  const match = output.match(VERDICT_RE)
  if (!match) return { verdict: "unknown", evidence: [] }

  const normalized = normalizeVerdict(match[1])
  return {
    verdict: normalized,
    reason: extractReasonFallback(output),
    evidence: extractEvidenceFallback(output),
  }
}

function parseVerdictJson(output: string): ParsedConsensusVerdict | null {
  for (const candidate of jsonCandidates(output)) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>
      const verdict = normalizeVerdict(parsed.verdict)
      if (verdict === "unknown") continue
      return {
        verdict,
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        evidence: Array.isArray(parsed.evidence)
          ? parsed.evidence.filter((item): item is string => typeof item === "string")
          : [],
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

function jsonCandidates(output: string): string[] {
  const candidates: string[] = []
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/gi) || []
  for (const block of fenced) {
    const inner = block.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
    if (inner) candidates.push(inner)
  }

  const objectMatch = output.match(/\{[\s\S]*\}/)
  if (objectMatch) candidates.push(objectMatch[0])
  return candidates
}

function normalizeVerdict(value: unknown): ConsensusVerdict {
  if (typeof value !== "string") return "unknown"
  const normalized = value.trim().toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-")
  if (normalized === "pass" || normalized === "fail" || normalized === "needs-fix") return normalized
  return "unknown"
}

function extractReasonFallback(output: string): string | undefined {
  const match = output.match(/\breason\s*[:=-]\s*(.+)$/im)
  return match?.[1]?.trim().slice(0, 500)
}

function extractEvidenceFallback(output: string): string[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /\bevidence\s*[:=-]/i.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/\bevidence\s*[:=-]\s*/i, "").trim())
    .filter(Boolean)
  return lines.slice(0, 5)
}
