/**
 * Test Handshake — spawns EH bundle with named pipe IPC, performs VS Code protocol handshake.
 *
 * PersistentProtocol frame format (13-byte header + data):
 *   [1 byte: type] [4 bytes: id (BE)] [4 bytes: ack (BE)] [4 bytes: data len (BE)] [data]
 *
 * Protocol message types: 1=Regular, 2=Control, 3=Ack, 8=Resume, 9=KeepAlive
 * Application message types: 1=Initialized, 2=Ready, 3=Terminate
 *
 * Run: node desktop/services/extensions-host/test-handshake.js
 */

const net = require("net")
const { spawn } = require("child_process")
const path = require("path")

const PIPE_NAME = `\\\\.\\pipe\\codek-ext-host-test-${Date.now()}`
const BUNDLE_PATH = path.join(__dirname, "bundle", "extHost.bundle.mjs")

const HEADER_LEN = 13
const ProtocolMessageType = { Regular: 1, Ack: 3, Resume: 8, KeepAlive: 9 }
const MessageType = { Initialized: 1, Ready: 2, Terminate: 3 }

// Parser: reads PersistentProtocol frames
function createParser(onMessage, onRaw) {
  let buf = Buffer.alloc(0)
  return (chunk) => {
    buf = Buffer.concat([buf, chunk])
    onRaw?.(chunk)
    while (buf.length >= HEADER_LEN) {
      const type = buf[0]
      const id = buf.readUInt32BE(1)
      const ack = buf.readUInt32BE(5)
      const dataLen = buf.readUInt32BE(9)
      const totalLen = HEADER_LEN + dataLen
      if (buf.length < totalLen) break
      const data = buf.slice(HEADER_LEN, totalLen)
      buf = buf.slice(totalLen)
      onMessage({ type, id, ack, data, dataLen })
    }
  }
}

function makeFrame(type, id, ack, data) {
  const buf = Buffer.isBuffer(data) ? data : (data ? Buffer.from(data, "utf8") : Buffer.alloc(0))
  const header = Buffer.alloc(HEADER_LEN)
  header[0] = type
  header.writeUInt32BE(id, 1)
  header.writeUInt32BE(ack, 5)
  header.writeUInt32BE(buf.length, 9)
  return Buffer.concat([header, buf])
}

async function main() {
  console.log("[test] Creating pipe:", PIPE_NAME)

  const pipeServer = net.createServer((socket) => {
    console.log("[test] ✅ EH connected to pipe")
    let msgId = 0

    let nextServerId = 1  // Server's message id counter (EH's _incomingMsgId starts at 0, expects first msg id=1)
    let lastReceivedId = 0

    const parser = createParser((msg) => {
      const typeName = {
        1: "Regular", 2: "Control", 3: "Ack", 5: "Disconnect",
        6: "ReplayRequest", 7: "Pause", 8: "Resume", 9: "KeepAlive",
      }[msg.type] || `Type${msg.type}`

      console.log(`[test] Frame: ${typeName} id=${msg.id} ack=${msg.ack} dataLen=${msg.dataLen} dataHex=${msg.data.slice(0, 20).toString("hex")}`)

      // Track the last received id from the EH
      if (msg.type === ProtocolMessageType.Regular) {
        lastReceivedId = msg.id
      }

      // Only respond to Regular messages; protocol internal messages need no response
      if (msg.type !== ProtocolMessageType.Regular) {
        return
      }

      if (msg.dataLen === 1 && msg.data[0] === MessageType.Ready) {
        console.log("[test] ✅ ← Ready received!")

        // Helper: convert Windows path to file:// URI
        // Helper: create UriComponents (not a string) — URI.revive() expects this format
        const toUriComponents = (p) => ({
          scheme: "file",
          authority: "",
          path: p.replace(/\\/g, "/"),
          query: "",
          fragment: "",
        })
        const rootUri = toUriComponents(__dirname)

        // Send InitData with all required fields matching IExtensionHostInitData
        const initData = JSON.stringify({
          version: "1.96.0",
          quality: "stable",
          commit: "codek-dev",
          parentPid: process.pid,
          environment: {
            isExtensionDevelopmentDebug: false,
            appName: "codek",
            appHost: "desktop",
            appRoot: rootUri,
            appLanguage: "zh-cn",
            isExtensionTelemetryLoggingOnly: false,
            appUriScheme: "file",
            globalStorageHome: toUriComponents(path.join(__dirname, ".global-storage")),
            workspaceStorageHome: toUriComponents(path.join(__dirname, ".workspace-storage")),
            extensionDevelopmentLocationURI: null,
            extensionTestsLocationURI: null,
          },
          workspace: {
            id: "00000000-0000-0000-0000-000000000000",
            folders: [],
            name: "codek",
          },
          extensions: {
            versionId: 1,
            allExtensions: [],
            activationEvents: {},
            myExtensions: [],
          },
          telemetryInfo: {
            sessionId: "00000000-0000-0000-0000-000000000000",
            machineId: "codek-machine",
            sqmId: "",
            devDeviceId: "",
            firstSessionDate: new Date().toISOString(),
          },
          logLevel: 3,
          loggers: [],
          logsLocation: toUriComponents(path.join(__dirname, ".logs")),
          autoStart: true,
          remote: { isRemote: false, authority: "", connectionData: null },
          consoleForward: { includeStack: false, logNative: false },
          uiKind: 1,
        })

        socket.write(makeFrame(ProtocolMessageType.Regular, nextServerId++, lastReceivedId, initData))
        console.log("[test] → InitData sent")
        return
      }

      if (msg.type === ProtocolMessageType.Regular && msg.dataLen === 1 && msg.data[0] === MessageType.Initialized) {
        console.log("[test] ✅ ← Initialized received!")
        console.log("[test] ✅✅✅ HANDSHAKE COMPLETE!")

        setTimeout(() => {
          socket.write(makeFrame(ProtocolMessageType.Regular, nextServerId++, lastReceivedId, Buffer.from([MessageType.Terminate])))
          setTimeout(() => {
            socket.end()
            pipeServer.close()
            process.exit(0)
          }, 200)
        }, 300)
        return
      }
    }, (chunk) => {})

    socket.on("data", parser)
    socket.on("error", (err) => console.error("[test] Pipe error:", err.message))
  })

  pipeServer.listen(PIPE_NAME, () => {
    console.log("[test] Pipe listening, spawning EH...")

    const env = {
      ...process.env,
      VSCODE_EXTHOST_IPC_HOOK: PIPE_NAME,
      VSCODE_ESM_ENTRYPOINT: "vs/workbench/api/node/extensionHostProcess",
      ELECTRON_RUN_AS_NODE: "1",
    }

    const child = spawn("node", ["--experimental-vm-modules", BUNDLE_PATH], {
      env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    })
    child.stdout.on("data", (d) => console.log(`[EH] ${d.toString().trim()}`))
    child.stderr.on("data", (d) => console.error(`[EH:err] ${d.toString().trim()}`))
    child.on("exit", (code) => { console.log(`[test] EH exited with code ${code}`); pipeServer.close() })
  })

  setTimeout(() => { console.log("[test] ❌ Handshake timeout"); process.exit(1) }, 20000)
}

main().catch((err) => { console.error("[test] Fatal:", err.message); process.exit(1) })
