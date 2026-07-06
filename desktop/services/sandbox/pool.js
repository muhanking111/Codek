/**
 * SandboxPool — keeps a small pool of pre-warmed sandbox configs ready to
 * reduce bwrap/sandbox-exec cold-start latency.
 *
 * Note: this pool deals in *configurations*, not live processes. Each "lease"
 * is a sandbox config descriptor that callers pass to spawnSandboxed().
 */

const sandbox = require("./index")

const DEFAULT_MAX = 5
const DEFAULT_IDLE = 2

class SandboxPool {
  constructor({ maxSize = DEFAULT_MAX, idleSize = DEFAULT_IDLE } = {}) {
    this.maxSize = maxSize
    this.idleSize = idleSize
    this.idle = []
    this.busy = new Set()
    this.waiters = []
  }

  _makeConfig(projectRoot) {
    const policy = sandbox.getPolicy ? sandbox.getPolicy() : { sandboxMode: "workspace-write" }
    return {
      id: `sbx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      projectRoot,
      mode: policy.sandboxMode || "workspace-write",
      createdAt: Date.now(),
    }
  }

  prewarm(projectRoot) {
    while (this.idle.length < this.idleSize) {
      this.idle.push(this._makeConfig(projectRoot))
    }
  }

  acquire(projectRoot) {
    if (this.idle.length > 0) {
      const cfg = this.idle.pop()
      cfg.projectRoot = projectRoot || cfg.projectRoot
      this.busy.add(cfg.id)
      return Promise.resolve(cfg)
    }
    if (this.busy.size < this.maxSize) {
      const cfg = this._makeConfig(projectRoot)
      this.busy.add(cfg.id)
      return Promise.resolve(cfg)
    }
    return new Promise((resolve) => this.waiters.push({ projectRoot, resolve }))
  }

  release(cfg) {
    if (!cfg || !cfg.id) return
    this.busy.delete(cfg.id)
    const waiter = this.waiters.shift()
    if (waiter) {
      cfg.projectRoot = waiter.projectRoot || cfg.projectRoot
      this.busy.add(cfg.id)
      waiter.resolve(cfg)
      return
    }
    if (this.idle.length < this.idleSize) {
      this.idle.push(cfg)
    }
    // otherwise drop
  }

  stats() {
    return { idle: this.idle.length, busy: this.busy.size, waiting: this.waiters.length }
  }
}

let _instance = null
function getPool() {
  if (!_instance) _instance = new SandboxPool()
  return _instance
}

module.exports = { SandboxPool, getPool }
