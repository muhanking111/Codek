#!/usr/bin/env node
/**
 * 从指定的本地 VS Code 源码 extensions/ 目录批量导入内置扩展到 d:/Workspace/extensions/
 *
 * 策略: VS Code 能用的全部搬入,小众语言和测试扩展一并搬。
 * 跳过: copilot(与 Codek Agent 功能冲突)、codek-chat(UI 重复)、已有同名扩展、纯目录(node_modules/types)。
 *
 * 用法:
 *   node scripts/import-vscode-extensions.js               # 实际拷贝
 *   node scripts/import-vscode-extensions.js --dry         # 只打印将拷贝什么
 *   node scripts/import-vscode-extensions.js --src <path>  # 自定义源目录
 */

"use strict"

const fs = require("fs")
const path = require("path")

const DEFAULT_SRC = path.resolve(__dirname, "..", "vendor", "vscode", "extensions")
const DST = path.resolve(__dirname, "..", "extensions")

const SKIP = new Set([
  // 真冲突
  "copilot",
  "codek-chat",
  // 非扩展(纯目录/构建文件)
  "node_modules",
  "types",
  "out",
])

// 文件扩展名/单文件,不是扩展目录
const SKIP_FILE_PATTERNS = [
  /^esbuild-.*\.mts$/,
  /^tsconfig\..*\.json$/,
  /^postinstall\.mjs$/,
  /^package(-lock)?\.json$/,
  /^cgmanifest\.json$/,
  /^\.eslintrc.*$/,
  /^CONTRIBUTING\.md$/,
  /^tsconfig\.tsbuildinfo$/,
]

function parseArgs(argv) {
  const out = { dry: false, src: DEFAULT_SRC }
  for (const arg of argv) {
    if (arg === "--dry") out.dry = true
    else if (arg.startsWith("--src=")) out.src = arg.slice(6)
    else if (arg === "--src") out._needsSrc = true
    else if (out._needsSrc) { out.src = arg; out._needsSrc = false }
  }
  return out
}

function shouldSkip(name, fullPath) {
  if (SKIP.has(name)) return "skip-list"
  if (SKIP_FILE_PATTERNS.some((re) => re.test(name))) return "non-extension-file"
  try {
    const stat = fs.statSync(fullPath)
    if (!stat.isDirectory()) return "not-a-directory"
  } catch {
    return "stat-failed"
  }
  if (!fs.existsSync(path.join(fullPath, "package.json"))) return "no-package-json"
  return null
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue
    if (entry.name === "out" && !shouldKeepOut(src)) continue
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(s, d)
    } else if (entry.isSymbolicLink()) {
      try {
        const target = fs.readlinkSync(s)
        fs.symlinkSync(target, d)
      } catch {
        fs.copyFileSync(s, d)
      }
    } else {
      fs.copyFileSync(s, d)
    }
  }
}

function shouldKeepOut(extDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(extDir, "package.json"), "utf8"))
    if (typeof pkg.main === "string" && pkg.main.startsWith("./out/")) return true
    if (typeof pkg.browser === "string" && pkg.browser.startsWith("./out/")) return true
  } catch {}
  return false
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const SRC = path.resolve(opts.src)

  if (!fs.existsSync(SRC)) {
    process.stderr.write(`[import-vsx] source missing: ${SRC}\n`)
    process.exit(1)
  }

  fs.mkdirSync(DST, { recursive: true })

  const entries = fs.readdirSync(SRC, { withFileTypes: true })
  const report = {
    src: SRC,
    dst: DST,
    dry: opts.dry,
    copied: [],
    skipped: [],
    alreadyPresent: [],
    errors: [],
  }

  for (const entry of entries) {
    const name = entry.name
    const full = path.join(SRC, name)
    const reason = shouldSkip(name, full)
    if (reason) {
      report.skipped.push({ name, reason })
      continue
    }

    const dst = path.join(DST, name)
    if (fs.existsSync(dst)) {
      report.alreadyPresent.push(name)
      continue
    }

    if (opts.dry) {
      report.copied.push({ name, copied: false, dry: true })
      continue
    }

    try {
      copyDirSync(full, dst)
      report.copied.push({ name, copied: true })
    } catch (err) {
      report.errors.push({ name, error: String(err && err.message || err) })
    }
  }

  process.stdout.write(
    `[import-vsx] from: ${SRC}\n` +
    `[import-vsx] to:   ${DST}\n` +
    `[import-vsx] dry:  ${opts.dry}\n` +
    `[import-vsx] copied:          ${report.copied.length}\n` +
    `[import-vsx] already-present: ${report.alreadyPresent.length}\n` +
    `[import-vsx] skipped:         ${report.skipped.length}\n` +
    `[import-vsx] errors:          ${report.errors.length}\n`,
  )

  if (report.errors.length) {
    process.stderr.write("[import-vsx] errors:\n")
    for (const e of report.errors) process.stderr.write(`  - ${e.name}: ${e.error}\n`)
  }

  const reportPath = path.join(DST, "_import_report.json")
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8")
  process.stdout.write(`[import-vsx] report: ${reportPath}\n`)

  if (report.errors.length > 0) process.exit(2)
}

main()
