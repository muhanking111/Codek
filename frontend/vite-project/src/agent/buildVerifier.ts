import { executeSandbox } from "../sandbox/sandboxClient"
import { diagnoseAndPlan } from "./agentVerify"
import type { Diagnosis } from "./diagnostics"

export interface VerificationCommands {
  lint?: string
  build?: string
  test?: string
}

export interface VerificationStepResult {
  command: string
  stage: "lint" | "build" | "test"
  success: boolean
  output: string
  error?: string
  diagnosis?: Diagnosis
}

export interface VerificationReport {
  passed: boolean
  steps: VerificationStepResult[]
  failingStage?: VerificationStepResult["stage"]
  guidance?: string
}

export interface DetectionContext {
  readFile?: (path: string) => Promise<string | null>
  projectRoot: string
}

export async function detectProjectCommands(ctx: DetectionContext): Promise<VerificationCommands> {
  const commands: VerificationCommands = {}
  try {
    const pkgPath = `${ctx.projectRoot.replace(/\\/g, "/")}/package.json`
    const text = ctx.readFile ? await ctx.readFile(pkgPath) : null
    if (text) {
      const pkg = JSON.parse(text) as { scripts?: Record<string, string> }
      const scripts = pkg.scripts || {}
      if (scripts.lint) commands.lint = "npm run lint"
      if (scripts.build) commands.build = "npm run build"
      if (scripts.test) commands.test = "npm test"
    }
  } catch {
    /* ignore parse errors */
  }

  if (Object.keys(commands).length === 0) {
    commands.test = "npm test"
  }
  return commands
}

interface RunContext {
  language?: "javascript" | "python" | "java"
}

async function runCommand(command: string, stage: VerificationStepResult["stage"], ctx: RunContext): Promise<VerificationStepResult> {
  const language = ctx.language || "javascript"
  const code = language === "python"
    ? `import subprocess, sys\nr = subprocess.run(${JSON.stringify(command)}, shell=True, capture_output=True, text=True)\nprint(r.stdout)\nprint(r.stderr, file=sys.stderr)\nsys.exit(r.returncode)`
    : `const { execSync } = require('child_process');\ntry { console.log(execSync(${JSON.stringify(command)}, { encoding: 'utf-8', stdio: 'pipe' })); process.exit(0); } catch (e) { console.error(e.stdout?.toString() || ''); console.error(e.stderr?.toString() || e.message); process.exit(e.status || 1); }`

  const result = await executeSandbox({
    language,
    code,
    timeoutMs: 180_000,
  })

  const success = result.success && result.exitCode === 0
  const step: VerificationStepResult = {
    command,
    stage,
    success,
    output: result.output,
    error: success ? undefined : (result.error || result.output),
  }

  if (!success) {
    const { diagnosis } = diagnoseAndPlan(step.error || step.output, 0)
    step.diagnosis = diagnosis
  }

  return step
}

export async function runVerification(
  commands: VerificationCommands,
  ctx: RunContext = {},
): Promise<VerificationReport> {
  const steps: VerificationStepResult[] = []
  const ordered: Array<[VerificationStepResult["stage"], string | undefined]> = [
    ["lint", commands.lint],
    ["build", commands.build],
    ["test", commands.test],
  ]

  for (const [stage, command] of ordered) {
    if (!command) continue
    const result = await runCommand(command, stage, ctx)
    steps.push(result)
    if (!result.success) {
      return {
        passed: false,
        steps,
        failingStage: stage,
        guidance: result.diagnosis ? `Failed ${stage}: ${result.diagnosis.summary}` : `Failed ${stage}`,
      }
    }
  }

  return { passed: true, steps }
}

export async function verifyAndDiagnose(
  detectionCtx: DetectionContext,
  runCtx: RunContext = {},
): Promise<VerificationReport> {
  const commands = await detectProjectCommands(detectionCtx)
  return runVerification(commands, runCtx)
}
