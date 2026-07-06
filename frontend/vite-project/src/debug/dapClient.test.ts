import { afterEach, describe, expect, it, vi } from "vitest"
import { createCodekTransport } from "./dapClient"

describe("createCodekTransport", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("uses the nested preload DAP API and normalizes start results", async () => {
    const onEvent = vi.fn(() => () => {})
    const send = vi.fn(async () => undefined)
    const stop = vi.fn(async () => undefined)
    const start = vi.fn(async () => ({ sessionId: "dap-1", pid: 123 }))
    vi.stubGlobal("window", {
      codek: { dap: { start, stop, send, onEvent } },
    })

    const transport = createCodekTransport()

    await expect(transport.start("node", { cwd: "D:/Workspace" })).resolves.toBe("dap-1")
    await transport.send("dap-1", JSON.stringify({ type: "request" }))
    await transport.stop("dap-1")

    expect(start).toHaveBeenCalledWith("node", { cwd: "D:/Workspace" })
    expect(send).toHaveBeenCalledWith("dap-1", JSON.stringify({ type: "request" }))
    expect(stop).toHaveBeenCalledWith("dap-1")
  })

  it("unwraps DAP event payloads from preload", () => {
    let listener: ((payload: { message?: string }) => void) | undefined
    vi.stubGlobal("window", {
      codek: {
        dap: {
          start: vi.fn(),
          stop: vi.fn(),
          send: vi.fn(),
          onEvent: (callback) => {
            listener = callback
            return () => {}
          },
        },
      },
    })
    const callback = vi.fn()

    createCodekTransport().onEvent(callback)
    listener?.({ message: "{\"type\":\"event\",\"event\":\"initialized\"}" })

    expect(callback).toHaveBeenCalledWith("{\"type\":\"event\",\"event\":\"initialized\"}")
  })
})
