/**
 * Codek Inspect bridge — drop this in your dev page (e.g. via <script src="/codek-inspect.js">)
 * to let the Codek VisualEditor jump from clicked DOM elements back to the source file/line.
 *
 * Strategy: in dev builds, framework tooling (vite-plugin-vue, babel-plugin-jsx-source) annotates
 * elements with __source / data-v-loc attributes. We surface whichever is present.
 *
 * Sends to parent window:
 *   { type: "codek-click", file: "src/components/Foo.vue", line: 42 }
 */
(function () {
  if (window.__codekInspectAttached) return
  window.__codekInspectAttached = true

  function findSource(el) {
    while (el && el !== document.body) {
      // React (babel-plugin-jsx-source)
      const reactKey = Object.keys(el).find((k) => k.startsWith("__reactFiber"))
      if (reactKey) {
        const fiber = el[reactKey]
        const src = fiber && fiber._debugSource
        if (src && src.fileName) return { file: src.fileName, line: src.lineNumber || 1 }
      }
      // Vue (vite-plugin-vue with reactivityTransform)
      if (el.__vueParentComponent) {
        const type = el.__vueParentComponent.type
        if (type && type.__file) return { file: type.__file, line: 1 }
      }
      // data attribute fallback (manual annotation)
      const dataLoc = el.getAttribute && el.getAttribute("data-codek-loc")
      if (dataLoc) {
        const [file, lineStr] = dataLoc.split(":")
        return { file, line: parseInt(lineStr || "1", 10) }
      }
      el = el.parentElement
    }
    return null
  }

  let overlay = null
  function ensureOverlay() {
    if (overlay) return overlay
    overlay = document.createElement("div")
    overlay.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #3b82f6;background:rgba(59,130,246,0.1);transition:all 0.08s;display:none;"
    document.body.appendChild(overlay)
    return overlay
  }

  let inspectMode = false

  function moveOverlay(el) {
    if (!el) return
    const r = el.getBoundingClientRect()
    const o = ensureOverlay()
    o.style.display = "block"
    o.style.left = r.left + "px"
    o.style.top = r.top + "px"
    o.style.width = r.width + "px"
    o.style.height = r.height + "px"
  }

  function hideOverlay() {
    if (overlay) overlay.style.display = "none"
  }

  function onMouseOver(e) {
    if (!inspectMode) return
    moveOverlay(e.target)
  }

  function onClick(e) {
    if (!inspectMode) return
    e.preventDefault()
    e.stopPropagation()
    const src = findSource(e.target)
    if (src && window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "codek-click", file: src.file, line: src.line }, "*")
    }
    inspectMode = false
    hideOverlay()
  }

  function onKey(e) {
    if (e.key === "Escape") { inspectMode = false; hideOverlay() }
  }

  // Toggle inspect mode from parent
  window.addEventListener("message", (e) => {
    if (e.data && e.data.type === "codek-inspect-toggle") {
      inspectMode = !!e.data.enabled
      if (!inspectMode) hideOverlay()
    }
  })

  document.addEventListener("mouseover", onMouseOver, true)
  document.addEventListener("click", onClick, true)
  document.addEventListener("keydown", onKey, true)

  // Signal readiness
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: "codek-inspect-ready" }, "*")
  }
})()
