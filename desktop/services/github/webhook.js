/**
 * GitHub WebHook — receives GitHub webhook events for auto-review.
 * Listens on port 3081 for pull_request events.
 */

const http = require("http")
const crypto = require("crypto")

let server = null

function startWebhookServer(port = 3081, secret = "", onEvent) {
  if (server) return

  server = http.createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(405); res.end(); return }

    let body = ""
    req.on("data", (c) => { body += c })
    req.on("end", () => {
      // Verify signature
      const signature = req.headers["x-hub-signature-256"] || ""
      if (secret) {
        const hmac = crypto.createHmac("sha256", secret).update(body).digest("hex")
        if (signature !== `sha256=${hmac}`) {
          res.writeHead(403)
          res.end("Invalid signature")
          return
        }
      }

      const event = req.headers["x-github-event"]
      const payload = JSON.parse(body)
      res.writeHead(200)
      res.end("OK")

      if (onEvent) onEvent(event, payload)
    })
  })

  server.listen(port, () => {
    console.log(`[github-webhook] Listening on port ${port}`)
  })
}

function stopWebhookServer() {
  if (server) { server.close(); server = null }
}

module.exports = { startWebhookServer, stopWebhookServer }
