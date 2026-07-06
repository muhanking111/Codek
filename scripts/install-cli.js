#!/usr/bin/env node
/**
 * Codek CLI installer — creates a global `codek` shim that points at
 * cli/codek.js, without needing `npm link` (which clutters the user's
 * global node_modules).
 *
 * Linux/macOS: symlink into ~/.local/bin/codek (and a fallback to /usr/local/bin
 *              if the user has root).
 * Windows:     writes %USERPROFILE%\AppData\Local\Codek\bin\codek.cmd and
 *              prepends that dir to the user PATH via `setx`.
 *
 * Run with --uninstall to remove the shim.
 */

const fs = require("fs")
const os = require("os")
const path = require("path")
const { execSync } = require("child_process")

const REPO_ROOT = path.resolve(__dirname, "..")
const CLI_JS = path.join(REPO_ROOT, "cli", "codek.js")
const UNINSTALL = process.argv.includes("--uninstall")

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }) }

function installPosix() {
  const targetDir = path.join(os.homedir(), ".local", "bin")
  const link = path.join(targetDir, "codek")
  if (UNINSTALL) {
    if (fs.existsSync(link)) {
      fs.unlinkSync(link)
      console.log(`✓ removed ${link}`)
    } else {
      console.log(`(not installed at ${link})`)
    }
    return
  }
  ensureDir(targetDir)
  try { if (fs.existsSync(link)) fs.unlinkSync(link) } catch {}
  fs.symlinkSync(CLI_JS, link)
  try { fs.chmodSync(CLI_JS, 0o755) } catch {}
  console.log(`✓ symlinked ${link} → ${CLI_JS}`)
  if (!(process.env.PATH || "").split(":").includes(targetDir)) {
    console.log(`\nAdd this to your shell rc to put codek on PATH:`)
    console.log(`  export PATH="${targetDir}:$PATH"`)
  }
}

function installWindows() {
  const targetDir = path.join(os.homedir(), "AppData", "Local", "Codek", "bin")
  const cmdFile = path.join(targetDir, "codek.cmd")
  const ps1File = path.join(targetDir, "codek.ps1")

  if (UNINSTALL) {
    for (const f of [cmdFile, ps1File]) {
      if (fs.existsSync(f)) { fs.unlinkSync(f); console.log(`✓ removed ${f}`) }
    }
    return
  }

  ensureDir(targetDir)

  fs.writeFileSync(
    cmdFile,
    `@echo off\r\nnode "${CLI_JS.replace(/\\/g, "\\\\")}" %*\r\n`,
    "utf8",
  )
  fs.writeFileSync(
    ps1File,
    `#!/usr/bin/env pwsh\nnode "${CLI_JS.replace(/\\/g, "/")}" $args\n`,
    "utf8",
  )
  console.log(`✓ wrote ${cmdFile}`)
  console.log(`✓ wrote ${ps1File}`)

  // Add to user PATH if not already there
  try {
    const currentPath = execSync(
      `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','User')"`,
      { encoding: "utf8" },
    ).trim()
    if (!currentPath.split(";").some((p) => p && path.resolve(p) === path.resolve(targetDir))) {
      const newPath = currentPath ? `${currentPath};${targetDir}` : targetDir
      execSync(
        `powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path','${newPath.replace(/'/g, "''")}','User')"`,
        { stdio: "inherit" },
      )
      console.log(`✓ added ${targetDir} to user PATH (restart your shell to take effect)`)
    } else {
      console.log(`(${targetDir} already on user PATH)`)
    }
  } catch (e) {
    console.warn(`! could not modify PATH automatically: ${e.message}`)
    console.warn(`  add this manually: ${targetDir}`)
  }
}

if (!fs.existsSync(CLI_JS)) {
  console.error(`error: cli/codek.js not found at ${CLI_JS}`)
  process.exit(1)
}

if (process.platform === "win32") installWindows()
else installPosix()

console.log("\nrun:  codek --help")
