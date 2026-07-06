function asSet(value = "") {
  return new Set(String(value || "")
    .split(/[,\n;]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean))
}

function publisherFromExtension(extension = {}) {
  const id = String(extension.id || "").trim()
  if (extension.publisher || extension.namespace) return String(extension.publisher || extension.namespace).trim().toLowerCase()
  const dot = id.indexOf(".")
  return dot > 0 ? id.slice(0, dot).toLowerCase() : ""
}

function readPublisherPolicy(env = process.env) {
  return {
    allow: asSet(env.CODEK_EXTENSION_PUBLISHER_ALLOW),
    deny: asSet(env.CODEK_EXTENSION_PUBLISHER_DENY),
  }
}

function evaluatePublisherPolicy(extension = {}, options = {}) {
  const policy = options.policy || readPublisherPolicy(options.env)
  const publisher = publisherFromExtension(extension)
  const allowedByList = policy.allow.size === 0 || policy.allow.has(publisher)
  const deniedByList = publisher && policy.deny.has(publisher)
  const blocked = !allowedByList || deniedByList
  return {
    publisher,
    allowConfigured: policy.allow.size > 0,
    denyConfigured: policy.deny.size > 0,
    allowed: !blocked,
    blocked,
    reason: !publisher
      ? "publisher_missing"
      : deniedByList
        ? "publisher_denied"
        : !allowedByList
          ? "publisher_not_allowed"
          : "",
  }
}

module.exports = {
  evaluatePublisherPolicy,
  publisherFromExtension,
  readPublisherPolicy,
}
