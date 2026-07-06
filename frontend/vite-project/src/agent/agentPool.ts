import { Agent } from "./agent.ts"
import type { AgentOptions } from "./agent.ts"

export interface AgentPoolOptions {
  maxConcurrency?: number
  agentFactory: () => Agent
}

interface PendingAcquire {
  resolve: (agent: Agent) => void
}

export class AgentPool {
  private readonly maxConcurrency: number
  private readonly agentFactory: () => Agent
  private readonly available: Agent[] = []
  private readonly inUse = new Set<Agent>()
  private readonly waiting: PendingAcquire[] = []
  private created = 0

  constructor(options: AgentPoolOptions) {
    this.maxConcurrency = options.maxConcurrency ?? 3
    this.agentFactory = options.agentFactory
  }

  async acquire(): Promise<Agent> {
    if (this.available.length > 0) {
      const agent = this.available.pop()!
      this.inUse.add(agent)
      return agent
    }

    if (this.created < this.maxConcurrency) {
      const agent = this.agentFactory()
      this.created++
      this.inUse.add(agent)
      return agent
    }

    return new Promise<Agent>((resolve) => {
      this.waiting.push({ resolve })
    })
  }

  release(agent: Agent): void {
    if (!this.inUse.has(agent)) return
    this.inUse.delete(agent)
    agent.reset()

    const waiter = this.waiting.shift()
    if (waiter) {
      this.inUse.add(agent)
      waiter.resolve(agent)
    } else {
      this.available.push(agent)
    }
  }

  drain(): void {
    for (const waiter of this.waiting) {
      waiter.resolve(this.agentFactory())
    }
    this.waiting.length = 0
    this.available.length = 0
    this.inUse.clear()
    this.created = 0
  }

  get stats(): { available: number; inUse: number; waiting: number; created: number } {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      waiting: this.waiting.length,
      created: this.created,
    }
  }
}

export function createAgentPool(baseOptions: Omit<AgentOptions, "onMessage" | "onStream" | "onDone">, maxConcurrency = 3): AgentPool {
  return new AgentPool({
    maxConcurrency,
    agentFactory: () => new Agent(baseOptions),
  })
}
