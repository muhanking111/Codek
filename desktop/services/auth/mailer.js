const net = require("net")
const tls = require("tls")
const os = require("os")

const PROVIDER_PRESETS = {
  "qq.com":      { host: "smtp.qq.com",       port: 465, secure: true },
  "vip.qq.com":  { host: "smtp.qq.com",       port: 465, secure: true },
  "foxmail.com": { host: "smtp.qq.com",       port: 465, secure: true },
  "163.com":     { host: "smtp.163.com",      port: 465, secure: true },
  "126.com":     { host: "smtp.126.com",      port: 465, secure: true },
  "yeah.net":    { host: "smtp.yeah.net",     port: 465, secure: true },
  "sina.com":    { host: "smtp.sina.com",     port: 465, secure: true },
  "sina.cn":     { host: "smtp.sina.cn",      port: 465, secure: true },
  "sohu.com":    { host: "smtp.sohu.com",     port: 465, secure: true },
  "aliyun.com":  { host: "smtp.aliyun.com",   port: 465, secure: true },
  "139.com":     { host: "smtp.139.com",      port: 465, secure: true },
  "gmail.com":   { host: "smtp.gmail.com",    port: 465, secure: true },
  "outlook.com": { host: "smtp.office365.com", port: 587, secure: false, starttls: true },
  "hotmail.com": { host: "smtp.office365.com", port: 587, secure: false, starttls: true },
  "live.com":    { host: "smtp.office365.com", port: 587, secure: false, starttls: true },
  "icloud.com":  { host: "smtp.mail.me.com",  port: 587, secure: false, starttls: true },
  "yahoo.com":   { host: "smtp.mail.yahoo.com", port: 465, secure: true },
}

function presetFor(email) {
  const at = (email || "").indexOf("@")
  if (at < 0) return null
  const domain = email.slice(at + 1).toLowerCase()
  return PROVIDER_PRESETS[domain] || null
}

function getConfig() {
  const fromEnv = process.env.CODEK_SMTP_FROM || process.env.CODEK_SMTP_USER || ""
  const preset = presetFor(fromEnv) || {}
  const host = process.env.CODEK_SMTP_HOST || preset.host || ""
  const port = parseInt(process.env.CODEK_SMTP_PORT || "", 10) || preset.port || 465
  const secure = process.env.CODEK_SMTP_SECURE
    ? process.env.CODEK_SMTP_SECURE === "true"
    : (preset.secure !== undefined ? preset.secure : port === 465)
  const starttls = process.env.CODEK_SMTP_STARTTLS
    ? process.env.CODEK_SMTP_STARTTLS === "true"
    : !!preset.starttls
  const user = process.env.CODEK_SMTP_USER || ""
  const pass = process.env.CODEK_SMTP_PASS || ""
  const from = fromEnv || user
  return { host, port, secure, starttls, user, pass, from }
}

function isConfigured() {
  const c = getConfig()
  return !!(c.host && c.user && c.pass && c.from)
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let buf = ""
    const onData = (chunk) => {
      buf += chunk.toString("utf8")
      const lines = buf.split(/\r?\n/)
      const last = lines[lines.length - 2]
      if (last && /^\d{3} /.test(last)) {
        socket.off("data", onData)
        socket.off("error", onError)
        const code = parseInt(last.slice(0, 3), 10)
        resolve({ code, text: buf })
      }
    }
    const onError = (err) => {
      socket.off("data", onData)
      reject(err)
    }
    socket.on("data", onData)
    socket.once("error", onError)
  })
}

function send(socket, line) {
  return new Promise((resolve, reject) => {
    socket.write(line + "\r\n", "utf8", (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function expect(socket, expected) {
  const resp = await readResponse(socket)
  if (Array.isArray(expected) ? !expected.includes(resp.code) : resp.code !== expected) {
    throw new Error(`SMTP unexpected response: ${resp.text.trim()}`)
  }
  return resp
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secured = tls.connect({
      socket,
      host,
      servername: host,
    }, () => resolve(secured))
    secured.once("error", reject)
  })
}

function connect(host, port, secure) {
  return new Promise((resolve, reject) => {
    const onErr = (e) => reject(e)
    if (secure) {
      const s = tls.connect({ host, port, servername: host }, () => {
        s.off("error", onErr)
        resolve(s)
      })
      s.once("error", onErr)
    } else {
      const s = net.createConnection({ host, port }, () => {
        s.off("error", onErr)
        resolve(s)
      })
      s.once("error", onErr)
    }
  })
}

function buildMessage({ from, to, subject, text, html }) {
  const date = new Date().toUTCString()
  const boundary = "codek_" + Math.random().toString(36).slice(2)
  const encodedSubject = "=?UTF-8?B?" + Buffer.from(subject, "utf8").toString("base64") + "?="
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `Date: ${date}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]
  const parts = []
  parts.push(`--${boundary}`)
  parts.push(`Content-Type: text/plain; charset=UTF-8`)
  parts.push(`Content-Transfer-Encoding: base64`)
  parts.push("")
  parts.push(Buffer.from(text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"))
  if (html) {
    parts.push(`--${boundary}`)
    parts.push(`Content-Type: text/html; charset=UTF-8`)
    parts.push(`Content-Transfer-Encoding: base64`)
    parts.push("")
    parts.push(Buffer.from(html, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"))
  }
  parts.push(`--${boundary}--`)
  return headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n")
}

async function smtpSend({ to, subject, text, html }) {
  const cfg = getConfig()
  if (!cfg.host || !cfg.user || !cfg.pass || !cfg.from) {
    throw new Error("SMTP 未配置")
  }
  const hostname = os.hostname() || "codek.local"
  let socket = await connect(cfg.host, cfg.port, cfg.secure)
  try {
    await expect(socket, 220)
    await send(socket, `EHLO ${hostname}`)
    await expect(socket, 250)
    if (cfg.starttls && !cfg.secure) {
      await send(socket, "STARTTLS")
      await expect(socket, 220)
      socket = await upgradeToTls(socket, cfg.host)
      await send(socket, `EHLO ${hostname}`)
      await expect(socket, 250)
    }
    await send(socket, "AUTH LOGIN")
    await expect(socket, 334)
    await send(socket, Buffer.from(cfg.user, "utf8").toString("base64"))
    await expect(socket, 334)
    await send(socket, Buffer.from(cfg.pass, "utf8").toString("base64"))
    await expect(socket, 235)
    await send(socket, `MAIL FROM:<${cfg.from}>`)
    await expect(socket, 250)
    await send(socket, `RCPT TO:<${to}>`)
    await expect(socket, [250, 251])
    await send(socket, "DATA")
    await expect(socket, 354)
    const body = buildMessage({ from: cfg.from, to, subject, text, html })
    const dotStuffed = body.replace(/\r?\n\./g, "\r\n..")
    await send(socket, dotStuffed + "\r\n.")
    await expect(socket, 250)
    await send(socket, "QUIT")
  } finally {
    try { socket.end() } catch {}
    try { socket.destroy() } catch {}
  }
}

async function sendVerificationCode(toEmail, code, ttlMs) {
  const ttlMin = Math.round(ttlMs / 60000)
  const subject = `Codek 密码重置验证码：${code}`
  const text = `您正在重置 Codek 账号密码。\n\n验证码：${code}\n\n该验证码 ${ttlMin} 分钟内有效。如非本人操作，请忽略此邮件。`
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937;">
      <h2 style="color:#111827;margin:0 0 12px;">Codek 密码重置</h2>
      <p style="margin:0 0 16px;color:#374151;">您正在重置 Codek 账号密码。请使用以下验证码完成操作：</p>
      <div style="font-size:28px;font-weight:700;letter-spacing:6px;padding:14px 20px;background:#111827;color:#2dd4bf;border-radius:8px;text-align:center;display:inline-block;">${code}</div>
      <p style="margin:16px 0 0;color:#6b7280;font-size:13px;">验证码 ${ttlMin} 分钟内有效。如非本人操作，请忽略此邮件。</p>
    </div>
  `
  if (!isConfigured()) {
    console.warn(`[mailer] SMTP 未配置，开发模式打印验证码 → ${toEmail} : ${code}`)
    return { delivered: false, devMode: true }
  }
  await smtpSend({ to: toEmail, subject, text, html })
  return { delivered: true, devMode: false }
}

module.exports = {
  sendVerificationCode,
  isConfigured,
  getConfig,
  presetFor,
}
