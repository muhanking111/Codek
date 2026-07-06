function hasHelpFlag(argv = []) {
  return argv.includes("--help") || argv.includes("-h")
}

function collectInvalidCliArgs(argv = [], spec = {}) {
  const flags = new Set(["--help", "-h", ...(spec.flags || [])])
  const valueOptions = spec.valueOptions || []
  return argv.filter((arg) => {
    if (flags.has(arg)) return false
    const matchedValueOption = valueOptions.find((prefix) => arg.startsWith(prefix))
    if (!matchedValueOption) return true
    return arg.slice(matchedValueOption.length).length === 0
  })
}

function formatHelp(config = {}) {
  const options = config.options || []
  return [
    `Usage: node scripts/${config.scriptName || "script.js"} [options]`,
    "",
    config.description || "",
    "",
    "Options:",
    "  -h, --help  Show this help and exit without writing reports.",
    ...options.map((option) => `  ${option}`),
    "",
  ].join("\n")
}

function printHelp(config = {}, stream = process.stdout) {
  stream.write(formatHelp(config))
}

function printInvalidArgs(config = {}, invalidArgs = [], stream = process.stderr) {
  stream.write(`Invalid option(s): ${invalidArgs.join(", ")}\n`)
  stream.write(`Run \`node scripts/${config.scriptName || "script.js"} --help\` for usage.\n`)
}

function handleReadOnlyCliFlags(argv = [], config = {}, spec = {}) {
  if (hasHelpFlag(argv)) {
    printHelp(config)
    return 0
  }
  const invalidArgs = collectInvalidCliArgs(argv, spec)
  if (invalidArgs.length > 0) {
    printInvalidArgs(config, invalidArgs)
    return 1
  }
  return null
}

module.exports = {
  collectInvalidCliArgs,
  formatHelp,
  handleReadOnlyCliFlags,
  hasHelpFlag,
  printHelp,
  printInvalidArgs,
}
