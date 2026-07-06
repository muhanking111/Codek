# Packaging Runtime Source Boundary

Codek packaging must be self-contained under the repository checkout.

- An external VS Code checkout may be used only as a local read-only reference source for migration review.
- This boundary protects Codek's Agent Workbench flow and required VS Code foundation work; it is not a plan to keep importing the full VS Code source tree.
- Build and package scripts must read migrated VS Code runtime source from `vendor/vscode` or already-copied Codek files.
- Electron packages must load the frontend from `desktop/frontend-dist`, which is synced by `scripts/build.js`; `desktop/package.json` must not include parent-directory frontend dist paths.
- Generated packaged sources, including `desktop/services/extensions-host/bundle/extHost.bundle.mjs` and its source map, must not retain `SourceMirror/vscode` source paths.
- `scripts/build-ext-host.js` builds from the vendored `vendor/vscode/src/vs/workbench/api/node/extensionHostProcess.ts` closure. It does not require `vendor/vscode/node_modules`; VS Code `src/vs` files are bundled, and bare package imports are intentionally externalized to the extension-host bundle runtime dependencies. The generated `desktop/services/extensions-host/bundle/external-modules.json` records those externals and whether each package is present under `desktop/services/extensions-host/bundle/node_modules`.

Regression guard:

```powershell
npm run check:vscode-source-boundary
```

The guard scans runtime/build/package sources and the extension-host generated bundle/source map. Documentation and ordinary source comments may still mention the external reference path, but packaged generated files are scanned raw because they ship with the app.

Extension-host bundle regeneration:

```powershell
node scripts/vscode-dependency-closure-importer.js --refresh-vendor --src <local-vscode-source> --entry src/vs/workbench/api/node/extensionHostProcess.ts
node scripts/build-ext-host.js
```

The first command is the only allowed external VS Code checkout read in this workflow, and its output must stay inside `vendor/vscode`. The second command must succeed from the repository root without `CODEK_VSCODE_SOURCE_ROOT` pointing outside the repository.
