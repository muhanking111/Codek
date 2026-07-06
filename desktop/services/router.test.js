const test = require("node:test")
const assert = require("node:assert/strict")

const router = require("./router")

test("dispatch matches pathname and passes decoded query parameters", async () => {
  router.clearRoutes()
  router.register("GET", "/extensions-host/marketplace/search", async ({ query }) => {
    return { query }
  })

  const result = await router.dispatch({
    method: "GET",
    path: "/extensions-host/marketplace/search?q=prettier%20vue&pageSize=5&category=Themes",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.query, {
    q: "prettier vue",
    pageSize: "5",
    category: "Themes",
  })
})

test("dispatch keeps route params decoded while ignoring query for matching", async () => {
  router.clearRoutes()
  router.register("POST", "/extensions-host/extensions/:id/toggle", async ({ params, query }) => {
    return { params, query }
  })

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/extensions/publisher.name/toggle?source=settings",
    body: { enabled: false },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.params, { id: "publisher.name" })
  assert.deepEqual(result.data.query, { source: "settings" })
})

test("dispatch prefers earlier static goal routes over later dynamic goal id routes", async () => {
  router.clearRoutes()
  const goalRoutes = require("./goalRoutes")
  goalRoutes.register(router)

  const incomplete = await router.dispatch({
    method: "GET",
    path: "/api/goals/incomplete",
  })
  const queue = await router.dispatch({
    method: "GET",
    path: "/api/goals/queue",
  })

  assert.equal(incomplete.ok, true)
  assert.deepEqual(incomplete.data, { goals: [] })
  assert.equal(queue.ok, true)
  assert.deepEqual(queue.data, { queue: [] })
})

test("scheduler runtime health routes expose latest and run reports", async () => {
  router.clearRoutes()
  const goalRoutes = require("./goalRoutes")
  goalRoutes.register(router)

  const run = await router.dispatch({
    method: "POST",
    path: "/api/scheduler/runtime-health/run",
    body: { write: false, auditHistory: [{ id: "audit_1" }] },
  })

  assert.equal(run.ok, true)
  assert.equal(run.data.reportKind, "goal-runtime-health")
  assert.equal(run.data.summary.failed, 0)

  const latest = await router.dispatch({
    method: "GET",
    path: "/api/scheduler/runtime-health",
  })

  assert.equal(latest.ok, true)
  assert.equal(latest.data.reportKind, "goal-runtime-health")
})
