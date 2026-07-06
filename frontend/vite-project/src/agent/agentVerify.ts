import { executeSandbox } from '../sandbox/sandboxClient'
import { diagnoseError, buildFixStrategy, planRetry } from './diagnostics'
import type { Diagnosis } from './diagnostics'

export interface AgentTask {
  id: string
  description: string
  status: 'pending' | 'running' | 'blocked' | 'completed' | 'failed'
  result?: unknown
  error?: string
}

export interface TestResult {
  passed: boolean
  total: number
  failed: number
  output: string
  error?: string
}

export interface RetryStrategy {
  maxAttempts: number
  backoffMs: number
  shouldRetry: (error: Error, attempt: number) => boolean
}

const DEFAULT_RETRY_STRATEGY: RetryStrategy = {
  maxAttempts: 3,
  backoffMs: 1000,
  shouldRetry: (error, attempt) => {
    // 重试条件: 不是用户拒绝 + 未超过最大次数
    return !error.message.includes('rejected by user') && attempt < 3
  },
}

export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  strategy: RetryStrategy = DEFAULT_RETRY_STRATEGY,
  onRetry?: (attempt: number, error: Error) => void,
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= strategy.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (!strategy.shouldRetry(lastError, attempt)) {
        throw lastError
      }

      if (onRetry) {
        onRetry(attempt, lastError)
      }

      if (attempt < strategy.maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, strategy.backoffMs * attempt))
      }
    }
  }

  throw lastError || new Error('All retry attempts failed')
}

export async function runTests(
  testCommand: string,
  language: 'javascript' | 'python' | 'java' = 'javascript',
): Promise<TestResult> {
  const testCode = buildTestRunner(testCommand, language)

  const result = await executeSandbox({
    language,
    code: testCode,
    timeoutMs: 60000, // 测试可能需要更长时间
  })

  return parseTestOutput(result.output, result.error, result.success)
}

function buildTestRunner(testCommand: string, language: string): string {
  switch (language) {
    case 'javascript':
      return `
const { execSync } = require('child_process');
try {
  const output = execSync('${testCommand.replace(/'/g, "\\'")}'', { encoding: 'utf-8', stdio: 'pipe' });
  console.log(output);
  process.exit(0);
} catch (error) {
  console.error(error.stdout || error.message);
  process.exit(error.status || 1);
}
`

    case 'python':
      return `
import subprocess
import sys
try:
    result = subprocess.run('${testCommand.replace(/'/g, "\\'")}'', shell=True, capture_output=True, text=True)
    print(result.stdout)
    sys.exit(result.returncode)
except Exception as e:
    print(str(e), file=sys.stderr)
    sys.exit(1)
`

    case 'java':
      return `
import java.io.*;
public class TestRunner {
    public static void main(String[] args) {
        try {
            Process p = Runtime.getRuntime().exec("${testCommand.replace(/"/g, '\\"')}");
            BufferedReader reader = new BufferedReader(new InputStreamReader(p.getInputStream()));
            String line;
            while ((line = reader.readLine()) != null) {
                System.out.println(line);
            }
            System.exit(p.waitFor());
        } catch (Exception e) {
            e.printStackTrace();
            System.exit(1);
        }
    }
}
`

    default:
      throw new Error(`Unsupported language: ${language}`)
  }
}

function parseTestOutput(output: string, error: string, success: boolean): TestResult {
  // Jest 格式
  const jestMatch = output.match(/(\d+) passed.*?(\d+) failed/)
  if (jestMatch) {
    const passed = parseInt(jestMatch[1], 10)
    const failed = parseInt(jestMatch[2], 10)
    return {
      passed: failed === 0,
      total: passed + failed,
      failed,
      output,
    }
  }

  // Pytest 格式
  const pytestMatch = output.match(/(\d+) passed.*?(\d+) failed/)
  if (pytestMatch) {
    const passed = parseInt(pytestMatch[1], 10)
    const failed = parseInt(pytestMatch[2], 10)
    return {
      passed: failed === 0,
      total: passed + failed,
      failed,
      output,
    }
  }

  // JUnit 格式
  const junitMatch = output.match(/Tests run: (\d+).*Failures: (\d+)/)
  if (junitMatch) {
    const total = parseInt(junitMatch[1], 10)
    const failed = parseInt(junitMatch[2], 10)
    return {
      passed: failed === 0,
      total,
      failed,
      output,
    }
  }

  // 通用: 根据退出码判断
  return {
    passed: success,
    total: 1,
    failed: success ? 0 : 1,
    output,
    error: success ? undefined : error || 'Test failed',
  }
}

export async function verifyTaskCompletion(task: AgentTask): Promise<boolean> {
  // 如果任务描述中包含测试关键词,自动运行测试验证
  const needsTest =
    task.description.toLowerCase().includes('test') ||
    task.description.toLowerCase().includes('验证') ||
    task.description.toLowerCase().includes('确保')

  if (!needsTest) {
    return true // 无需测试,认为完成
  }

  try {
    const testResult = await runTests('npm test')
    return testResult.passed
  } catch {
    return false
  }
}

export function buildRetryPrompt(task: AgentTask, error: string, attempt: number): string {
  const diagnosis = diagnoseError(error)
  const strategy = buildFixStrategy(diagnosis)
  return `
Previous attempt ${attempt} failed with error:
${error}

Task: ${task.description}

${strategy}

Provide a corrected implementation that addresses the root cause.
`
}

export interface DiagnoseAndRetryResult {
  diagnosis: Diagnosis
  shouldRetry: boolean
  guidance: string
  promptInjection: string
}

export function diagnoseAndPlan(error: string, previousAttempts: number, taskDescription = ''): DiagnoseAndRetryResult {
  const diagnosis = diagnoseError(error)
  const retry = planRetry(diagnosis, previousAttempts)
  const promptInjection = retry.shouldRetry
    ? `Auto-diagnosis for task "${taskDescription}":\n${retry.guidance}`
    : ''
  return {
    diagnosis,
    shouldRetry: retry.shouldRetry,
    guidance: retry.guidance,
    promptInjection,
  }
}
