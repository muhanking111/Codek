const assert = require("node:assert/strict")
const test = require("node:test")

const {
  ImplicitActivationEventsAdapter,
  extensionIdentifierToKey,
} = require("./implicitActivationEvents")

test("implicit activation adapter preserves explicit events and rewrites onUri like VS Code", () => {
  const adapter = new ImplicitActivationEventsAdapter()
  const events = adapter.readActivationEvents({
    identifier: { value: "Publisher.Sample", _lower: "publisher.sample" },
    main: "./extension.js",
    activationEvents: ["onUri", "onStartupFinished"],
  })

  assert.deepEqual(events, ["onUri:publisher.sample", "onStartupFinished"])
})

test("implicit activation adapter ignores contribution-only extensions without runtime entry", () => {
  const adapter = new ImplicitActivationEventsAdapter()
  adapter.register("commands", function* (contributions) {
    for (const contribution of contributions) {
      yield `onCommand:${contribution.command}`
    }
  })

  const events = adapter.readActivationEvents({
    identifier: { value: "codek.no-runtime", _lower: "codek.no-runtime" },
    contributes: { commands: [{ command: "codek.run" }] },
  })

  assert.deepEqual(events, [])
})

test("implicit activation adapter creates VS Code-style activation events map", () => {
  const adapter = new ImplicitActivationEventsAdapter()
  adapter.register("commands", function* (contributions) {
    for (const contribution of contributions) {
      if (contribution.command) yield `onCommand:${contribution.command}`
    }
  })
  adapter.register("views", function* (contributions) {
    for (const viewLocations of contributions) {
      for (const descriptors of Object.values(viewLocations)) {
        for (const descriptor of descriptors) {
          if (descriptor.id) yield `onView:${descriptor.id}`
        }
      }
    }
  })

  const extension = {
    identifier: { value: "Codek.Implicit", _lower: "codek.implicit" },
    main: "./extension.js",
    activationEvents: ["onStartupFinished"],
    contributes: {
      commands: [{ command: "codek.implicit.run" }],
      views: {
        explorer: [{ id: "codek.implicit.view" }],
      },
    },
  }

  assert.deepEqual(adapter.readActivationEvents(extension), [
    "onStartupFinished",
    "onCommand:codek.implicit.run",
    "onView:codek.implicit.view",
  ])
  const map = adapter.createActivationEventsMap([extension])
  assert.equal(Object.getPrototypeOf(map), null)
  assert.deepEqual(map["codek.implicit"], [
    "onStartupFinished",
    "onCommand:codek.implicit.run",
    "onView:codek.implicit.view",
  ])
})

test("implicit activation adapter deduplicates explicit and implicit events", () => {
  const adapter = new ImplicitActivationEventsAdapter()
  adapter.register("commands", function* (contributions) {
    for (const contribution of contributions) {
      if (contribution.command) yield `onCommand:${contribution.command}`
    }
  })

  const events = adapter.readActivationEvents({
    identifier: { value: "Codek.Dedupe", _lower: "codek.dedupe" },
    main: "./extension.js",
    activationEvents: ["onCommand:codek.dedupe.run", "onStartupFinished", "onCommand:codek.dedupe.run"],
    contributes: {
      commands: [{ command: "codek.dedupe.run" }],
    },
  })

  assert.deepEqual(events, ["onCommand:codek.dedupe.run", "onStartupFinished"])
})

test("extensionIdentifierToKey handles VS Code identifier shapes", () => {
  assert.equal(extensionIdentifierToKey("Publisher.Name"), "publisher.name")
  assert.equal(extensionIdentifierToKey({ value: "Publisher.Name" }), "publisher.name")
  assert.equal(extensionIdentifierToKey({ _lower: "publisher.name" }), "publisher.name")
})
