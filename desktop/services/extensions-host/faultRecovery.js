/**
 * Fault Recovery — handles Extension Host crash recovery, reconnection, and timeouts.
 *
 * Features:
 *   - Auto-restart EH process on crash
 *   - Configurable max restart attempts with backoff
 *   - Graceful termination and cleanup
 *   - Crash log for diagnostics
 */

const MAX_RESTART_ATTEMPTS = 3
const RESTART_BACKOFF_MS = [1000, 3000, 5000]

/**
 * Wrap an ExtensionHostServer with auto-restart capability.
 * @param {object} server - ExtensionHostServer instance
 * @param {object} [options]
 * @param {number} [options.maxRestarts=3]
 * @returns {object} { getState, getAttempts }
 */
function wrapWithAutoRestart(server, options = {}) {
  let restartAttempts = 0
  let restartTimer = null
  let lastCrashTime = 0
  let lastCrashError = null
  let enabled = true

  function getState() {
    return {
      running: server.isRunning,
      restartAttempts,
      lastCrashTime,
      lastCrashError: lastCrashError?.message || null,
      enabled,
    }
  }

  function getAttempts() {
    return restartAttempts
  }

  function resetAttempts() {
    restartAttempts = 0
  }

  // Listen for EH exit
  const originalStop = server.stop.bind(server)
  const originalStart = server.start.bind(server)

  server.on("exit", (code) => {
    if (!enabled) return
    lastCrashTime = Date.now()

    if (code !== 0 && code !== null) {
      lastCrashError = new Error(`EH exited with code ${code}`)
      console.error(`[fault-recovery] EH crashed with code ${code}`)

      if (restartAttempts < (options.maxRestarts || MAX_RESTART_ATTEMPTS)) {
        const delay = (options.backoff || RESTART_BACKOFF_MS)[restartAttempts] || 5000
        restartAttempts++

        console.log(`[fault-recovery] Auto-restart in ${delay}ms (attempt ${restartAttempts})`)
        restartTimer = setTimeout(() => {
          if (!enabled) return
          console.log(`[fault-recovery] Restarting EH...`)
          originalStart(server._initData || {}).catch((err) => {
            console.error(`[fault-recovery] Restart failed: ${err.message}`)
          })
        }, delay)
      } else {
        console.error(`[fault-recovery] Max restart attempts (${restartAttempts}) reached, not restarting`)
      }
    }
  })

  // Override start to reset attempt counter on successful start
  server.on("ready", () => {
    restartAttempts = 0
    console.log("[fault-recovery] EH ready, restart counter reset")
  })

  // Override stop to cancel pending restart
  server.stop = function (...args) {
    enabled = false
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
    return originalStop(...args)
  }

  return { getState, getAttempts, resetAttempts }
}

module.exports = { wrapWithAutoRestart }
