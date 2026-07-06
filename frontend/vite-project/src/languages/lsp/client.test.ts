import { describe, expect, it, vi } from "vitest"
import { IpcTransport, monacoUriToLspDocUri } from "./client"
import { bindLspModelDocument } from "./modelBinding"

describe("lsp client transport", () => {
  it("filters preload IPC payloads by server id before notifying listeners", () => {
    const handlers: Array<(payload: { serverId?: string; message?: string }) => void> = []
    ;(window as any).codek = {
      lsp: {
        start: vi.fn(),
        stop: vi.fn(),
        onMessage: (callback) => {
          handlers.push(callback)
          return () => {}
        },
        send: vi.fn(),
      },
    }

    const transport = new IpcTransport("typescript")
    const listener = vi.fn()
    transport.onMessage(listener)

    handlers[0]?.({ serverId: "json", message: "{\"jsonrpc\":\"2.0\"}" })
    handlers[0]?.({ serverId: "typescript", message: "{\"jsonrpc\":\"2.0\",\"id\":1}" })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith("{\"jsonrpc\":\"2.0\",\"id\":1}")
  })

  it("prefers bound document URIs over anonymous Monaco model URIs", () => {
    const model = {
      uri: {
        toString: () => "inmemory://model/1",
      },
    }

    bindLspModelDocument(model as never, {
      filePath: "src/app.ts",
      documentUri: "file:///src/app.ts",
    })

    expect(monacoUriToLspDocUri(model.uri)).toBe("file:///src/app.ts")
  })

  it("forwards outgoing IPC sends with the server id", () => {
    const send = vi.fn()
    ;(window as any).codek = {
      lsp: {
        start: vi.fn(),
        stop: vi.fn(),
        onMessage: () => () => {},
        send,
      },
    }

    const transport = new IpcTransport("json")
    transport.send("{\"jsonrpc\":\"2.0\"}")

    expect(send).toHaveBeenCalledWith("json", "{\"jsonrpc\":\"2.0\"}")
  })
})
