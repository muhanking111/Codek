const assert = require("node:assert/strict")
const test = require("node:test")

const updates = require("../index.js")

test("desktop updates service registers check route", async () => {
  const routes = new Map()
  const router = {
    register(method, routePath, handler) {
      routes.set(`${method} ${routePath}`, handler)
    },
  }

  updates.register(router)
  const result = await routes.get("POST /updates/check")({
    body: {
      download: true,
    },
  })

  assert.equal(result.available, false)
  assert.equal(result.downloadRequested, true)
  assert.match(result.checkedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(result.state.type, "idle")
  assert.equal(result.state.notAvailable, true)
  assert.equal(result.lifecycle.at(0).type, "checking for updates")
  assert.equal(result.lifecycle.at(-1).type, "idle")
  assert.equal(result.policy.updateSourceConfigured, false)
  assert.equal(result.policy.enterprisePolicy.allowed, true)
})

test("desktop updates service exposes VS Code-style lifecycle without a configured feed", async () => {
  const routes = new Map()
  const router = {
    register(method, routePath, handler) {
      routes.set(`${method} ${routePath}`, handler)
    },
  }

  updates.register(router, { now: () => "2026-06-28T00:00:00.000Z" })

  const initial = await routes.get("GET /updates/state")({ body: {} })
  assert.equal(initial.state.type, "idle")
  assert.equal(initial.state.notAvailable, false)

  const checked = await routes.get("POST /updates/check")({ body: { download: false } })
  assert.deepEqual(checked.lifecycle.map((state) => state.type), [
    "checking for updates",
    "idle",
  ])
  assert.deepEqual(checked.history.map((state) => state.type), [
    "idle",
    "checking for updates",
    "idle",
  ])
  assert.equal(checked.message, "当前未配置桌面更新源，已完成本地检查请求。")

  const downloaded = await routes.get("POST /updates/download")({ body: {} })
  assert.equal(downloaded.state.type, "idle")
  assert.equal(downloaded.policy.updateSourceConfigured, false)
  assert.equal(downloaded.lifecycle.at(-1).error, "missing_update_source")

  const applied = await routes.get("POST /updates/apply")({ body: {} })
  assert.equal(applied.state.type, "idle")
  assert.equal(applied.lifecycle.at(-1).error, "missing_update_source")
})
