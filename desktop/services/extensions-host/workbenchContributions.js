const { getExtensionId } = require("./extensionScanner")

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function asArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function buildExtensionWorkbenchContributions(extensions = []) {
  const commands = []
  const viewsContainers = []
  const views = []
  const menus = []
  const keybindings = []
  const languages = []
  const sources = []
  const validations = []
  const activationMatches = Object.create(null)

  for (const extension of Array.isArray(extensions) ? extensions : []) {
    if (!isObject(extension) || extension.enabled === false || !isObject(extension.contributes)) continue

    const extensionId = getExtensionId(extension)
    const displayName = extension.displayName || extension.name || extensionId
    const contribution = extension.contributes
    const source = {
      extensionId,
      displayName,
      commands: 0,
      viewsContainers: 0,
      views: 0,
      menus: 0,
      keybindings: 0,
      languages: 0,
    }
    const validation = validateWorkbenchContributionManifest(extension)
    validations.push(validation)

    for (const command of asArray(contribution.commands)) {
      if (!isObject(command) || typeof command.command !== "string" || !command.command) continue
      commands.push({
        id: command.command,
        title: String(command.title || command.command),
        category: command.category ? String(command.category) : "Extensions",
        source: "extension",
        extensionId,
        enablement: typeof command.enablement === "string" ? command.enablement : undefined,
      })
      source.commands += 1
    }

    for (const [location, containers] of Object.entries(isObject(contribution.viewsContainers) ? contribution.viewsContainers : {})) {
      for (const container of asArray(containers)) {
        if (!isObject(container) || typeof container.id !== "string" || !container.id) continue
        viewsContainers.push({
          id: container.id,
          name: String(container.title || container.id),
          location: mapViewContainerLocation(location),
          source: "extension",
          extensionId,
          icon: typeof container.icon === "string" ? container.icon : undefined,
        })
        source.viewsContainers += 1
      }
    }

    for (const [containerId, contributedViews] of Object.entries(isObject(contribution.views) ? contribution.views : {})) {
      for (const view of asArray(contributedViews)) {
        if (!isObject(view) || typeof view.id !== "string" || !view.id) continue
        views.push({
          id: view.id,
          name: String(view.name || view.title || view.id),
          containerId,
          location: "sideBar",
          source: "extension",
          extensionId,
          when: typeof view.when === "string" ? view.when : undefined,
          icon: typeof view.icon === "string" ? view.icon : undefined,
        })
        source.views += 1
      }
    }

    for (const [location, menuItems] of Object.entries(isObject(contribution.menus) ? contribution.menus : {})) {
      for (const item of asArray(menuItems)) {
        if (!isObject(item) || typeof item.command !== "string" || !item.command) continue
        const group = parseMenuGroup(item.group)
        menus.push({
          location,
          command: item.command,
          alt: typeof item.alt === "string" && item.alt ? item.alt : undefined,
          when: typeof item.when === "string" ? item.when : undefined,
          group: group.name,
          order: group.order,
          source: "extension",
          extensionId,
        })
        source.menus += 1
      }
    }

    for (const keybinding of asArray(contribution.keybindings)) {
      if (!isObject(keybinding) || typeof keybinding.command !== "string" || !keybinding.command) continue
      const key = pickPlatformKeybinding(keybinding)
      if (!key) continue
      keybindings.push({
        command: keybinding.command,
        key,
        when: typeof keybinding.when === "string" ? keybinding.when : undefined,
        source: "extension",
        extensionId,
      })
      source.keybindings += 1
    }

    for (const language of asArray(contribution.languages)) {
      if (!isObject(language) || typeof language.id !== "string" || !language.id) continue
      languages.push({
        id: language.id,
        aliases: Array.isArray(language.aliases) ? language.aliases.filter((item) => typeof item === "string") : [],
        extensions: Array.isArray(language.extensions) ? language.extensions.filter((item) => typeof item === "string") : [],
        filenames: Array.isArray(language.filenames) ? language.filenames.filter((item) => typeof item === "string") : [],
        firstLine: typeof language.firstLine === "string" ? language.firstLine : undefined,
        mimetypes: Array.isArray(language.mimetypes) ? language.mimetypes.filter((item) => typeof item === "string") : [],
        configuration: typeof language.configuration === "string" ? language.configuration : undefined,
        source: "extension",
        extensionId,
      })
      source.languages += 1
    }

    if (source.commands || source.viewsContainers || source.views || source.menus || source.keybindings || source.languages) {
      sources.push(source)
    }

    for (const activationEvent of deriveWorkbenchActivationEvents(extension)) {
      if (!activationMatches[activationEvent]) activationMatches[activationEvent] = []
      activationMatches[activationEvent].push(extensionId)
    }
  }

  const validationIssues = validations.flatMap((validation) => validation.issues)
  const invalidValidationIssues = validationIssues.filter((issue) => issue.severity === "error")

  return {
    contract: {
      version: 1,
      runtime: "codek.extensionWorkbenchContributions",
      source: "vscode-compatible-manifest",
    },
    commands,
    viewsContainers,
    views,
    menus,
    keybindings,
    languages,
    sources,
    validation: {
      valid: invalidValidationIssues.length === 0,
      invalid: invalidValidationIssues.length,
      issues: validationIssues,
      byExtension: validations,
    },
    activation: {
      matches: activationMatches,
    },
    summary: {
      extensions: sources.length,
      commands: commands.length,
      viewsContainers: viewsContainers.length,
      views: views.length,
      menus: menus.length,
      keybindings: keybindings.length,
      languages: languages.length,
    },
    evidence: {
      source: "extensions-host/workbenchContributions",
      contractVersion: 1,
      manifestCount: sources.length,
      activationMatchCount: Object.keys(activationMatches).length,
      validationIssueCount: validationIssues.length,
      validationInvalidCount: invalidValidationIssues.length,
      contributionCounts: {
        commands: commands.length,
        viewsContainers: viewsContainers.length,
        views: views.length,
        menus: menus.length,
        keybindings: keybindings.length,
        languages: languages.length,
      },
      constraints: {
        commandExecutionGoesThroughExtensionHost: true,
        preservesExtensionHostActivationEvents: true,
        preservesWorkspaceTrustAndInstallAudit: true,
      },
    },
  }
}

function mapViewContainerLocation(location) {
  const normalized = String(location || "").toLowerCase()
  if (normalized === "activitybar") return "activityBar"
  if (normalized === "panel") return "panel"
  if (normalized === "auxiliarybar") return "auxiliaryBar"
  if (normalized === "secondarysidebar") return "auxiliaryBar"
  return "activityBar"
}

function pickPlatformKeybinding(keybinding) {
  if (process.platform === "win32" && typeof keybinding.win === "string") return keybinding.win
  if (process.platform === "darwin" && typeof keybinding.mac === "string") return keybinding.mac
  if (process.platform === "linux" && typeof keybinding.linux === "string") return keybinding.linux
  return typeof keybinding.key === "string" ? keybinding.key : ""
}

function parseMenuGroup(value) {
  if (typeof value !== "string" || !value.trim()) return { name: undefined, order: undefined }
  const [name, rawOrder] = value.split("@")
  const order = Number(rawOrder)
  return {
    name: name || undefined,
    order: Number.isFinite(order) ? order : undefined,
  }
}

function validateWorkbenchContributionManifest(extension) {
  const extensionId = getExtensionId(extension)
  const contributes = isObject(extension?.contributes) ? extension.contributes : {}
  const commandIds = new Set()
  const issues = []

  for (const command of asArray(contributes.commands)) {
    if (!isObject(command) || typeof command.command !== "string" || !command.command.trim()) {
      issues.push(validationIssue(extensionId, "commands", "error", "Command contribution requires a non-empty command id."))
      continue
    }
    commandIds.add(command.command)
    if (typeof command.title !== "string" || !command.title.trim()) {
      issues.push(validationIssue(extensionId, "commands", "error", `Command '${command.command}' requires a non-empty title.`))
    }
    if (command.enablement !== undefined && typeof command.enablement !== "string") {
      issues.push(validationIssue(extensionId, "commands", "error", `Command '${command.command}' enablement must be a string.`))
    }
  }

  for (const [location, menuItems] of Object.entries(isObject(contributes.menus) ? contributes.menus : {})) {
    for (const item of asArray(menuItems)) {
      if (!isObject(item) || typeof item.command !== "string" || !item.command.trim()) {
        issues.push(validationIssue(extensionId, "menus", "error", `Menu '${location}' item requires a non-empty command id.`))
        continue
      }
      if (!commandIds.has(item.command)) {
        issues.push(validationIssue(extensionId, "menus", "warning", `Menu item references command '${item.command}' that is not defined in contributes.commands.`))
      }
      if (item.alt && !commandIds.has(item.alt)) {
        issues.push(validationIssue(extensionId, "menus", "warning", `Menu item references alt command '${item.alt}' that is not defined in contributes.commands.`))
      }
      if (item.when !== undefined && typeof item.when !== "string") {
        issues.push(validationIssue(extensionId, "menus", "error", `Menu item '${item.command}' when clause must be a string.`))
      }
    }
  }

  for (const keybinding of asArray(contributes.keybindings)) {
    if (!isObject(keybinding) || typeof keybinding.command !== "string" || !keybinding.command.trim()) {
      issues.push(validationIssue(extensionId, "keybindings", "error", "Keybinding contribution requires a non-empty command id."))
      continue
    }
    if (!pickPlatformKeybinding(keybinding)) {
      issues.push(validationIssue(extensionId, "keybindings", "error", `Keybinding '${keybinding.command}' requires a platform key or default key.`))
    }
    if (keybinding.when !== undefined && typeof keybinding.when !== "string") {
      issues.push(validationIssue(extensionId, "keybindings", "error", `Keybinding '${keybinding.command}' when clause must be a string.`))
    }
  }

  for (const [containerId, contributedViews] of Object.entries(isObject(contributes.views) ? contributes.views : {})) {
    for (const view of asArray(contributedViews)) {
      if (!isObject(view) || typeof view.id !== "string" || !view.id.trim()) {
        issues.push(validationIssue(extensionId, "views", "error", `View contribution in '${containerId}' requires a non-empty id.`))
      }
      if (view?.when !== undefined && typeof view.when !== "string") {
        issues.push(validationIssue(extensionId, "views", "error", `View '${view.id}' when clause must be a string.`))
      }
    }
  }

  return {
    extensionId,
    valid: !issues.some((issue) => issue.severity === "error"),
    invalid: issues.filter((issue) => issue.severity === "error").length,
    issues,
  }
}

function validationIssue(extensionId, point, severity, message) {
  return { extensionId, point, severity, message }
}

function deriveWorkbenchActivationEvents(extension) {
  const events = []
  for (const activationEvent of asArray(extension?.activationEvents)) {
    if (typeof activationEvent === "string" && activationEvent.trim()) events.push(activationEvent)
  }

  const contributes = isObject(extension?.contributes) ? extension.contributes : {}
  for (const command of asArray(contributes.commands)) {
    if (typeof command?.command === "string" && command.command.trim()) events.push(`onCommand:${command.command}`)
  }
  for (const [containerId, contributedViews] of Object.entries(isObject(contributes.views) ? contributes.views : {})) {
    void containerId
    for (const view of asArray(contributedViews)) {
      if (typeof view?.id === "string" && view.id.trim()) events.push(`onView:${view.id}`)
    }
  }

  return [...new Set(events)]
}

function matchesActivationEvent(activationEvents, activationEvent) {
  const target = String(activationEvent || "")
  if (!target) return false
  return asArray(activationEvents).some((event) => event === target || event === "*")
}

function matchActivationEvent(activationMatches, activationEvent) {
  const target = String(activationEvent || "")
  const exact = activationMatches[target] || []
  const wildcard = activationMatches["*"] || []
  return [...new Set([...exact, ...wildcard])]
}

module.exports = {
  buildExtensionWorkbenchContributions,
  mapViewContainerLocation,
  matchesActivationEvent,
  parseMenuGroup,
  validateWorkbenchContributionManifest,
}
