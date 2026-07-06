# Codek VS Code Vendor Mirror

This directory is the self-contained VS Code source mirror used by Codek migration tooling.

Use `npm run vscode:import-closure -- --entry <src/vs/...>` to import a dependency closure from this mirror into Codek adapter code. The default source is this repository-local mirror and the default output is `frontend/vite-project/src/vscode-adapter/generated/vscode`.

Use `--out <repo-local adapter dir>` when a migration needs a different generated adapter target. Relative VS Code aliases are rewritten for generated adapter output, and the importer writes:

- `_import_report.json` for copied files and import edges.
- `_missing_shims.json` for unresolved external, `vs/*`, relative, css, or nls shims.

Only explicit refresh runs may read an external VS Code checkout:

```powershell
npm run vscode:import-closure -- --refresh-vendor --src D:\SourceMirror\vscode --entry <src/vs/...>
```

Refresh output, reports, shim manifests, and `_mirror_manifest.json` must stay inside `vendor/vscode`. Runtime, build, and packaged Codek code must not reference `D:\SourceMirror` directly.
