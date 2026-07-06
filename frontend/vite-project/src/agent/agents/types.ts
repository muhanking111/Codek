export type SubAgentId = "planner" | "architect" | "executor" | "security" | "reviewer"

export interface SubAgentSpec {
  id: SubAgentId
  name: string
  description: string
  systemPrompt: string
  tools: "read-only" | "all"
  modelHint: "lightweight" | "default" | "full"
  outputSchema: Record<string, unknown>
}

export interface PlanOutput {
  analysis: string
  boundaries: string[]
  risks: Array<{ risk: string; level: "high" | "medium" | "low" }>
  plans: Array<{
    name: string
    pros: string[]
    cons: string[]
    effort: string
  }>
}

export interface ArchitectOutput {
  techStack: Record<string, string>
  projectStructure: string[]
  keyDecisions: string[]
  constraints: string[]
}

export interface ExecutorStep {
  id: string
  description: string
  instruction: string
  verify: string
  model: "lightweight" | "default" | "full"
  dependsOn: string[]
}

export interface ExecutorOutput {
  steps: ExecutorStep[]
}

export interface SecurityIssue {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
  file: string
  line: number
  description: string
  fix: string
}

export interface SecurityOutput {
  issues: SecurityIssue[]
  passed: boolean
}

export interface ReviewIssue {
  description: string
  file: string
  line: number
  severity: "HIGH" | "MEDIUM" | "LOW"
  suggestedFix: string
}

export interface ReviewOutput {
  compileErrors: string[]
  logicIssues: ReviewIssue[]
  qualityIssues: ReviewIssue[]
  approved: boolean
}

export interface DeliveryReport {
  filesChanged: Array<{
    path: string
    changes: string
  }>
  verificationResults: Array<{
    type: string
    passed: boolean
    details: string
  }>
  summary: string
}
