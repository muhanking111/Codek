# Third Party Notices

Codek uses open source components and ecosystem interfaces. This file is a public-release checklist, not a full legal audit.

## Runtime And Desktop

- Electron: desktop application runtime.
- electron-builder: installer and packaged artifact generation.
- electron-updater: update integration dependency, not an enabled public update service in BA.
- node-pty: terminal PTY integration.
- better-sqlite3: local storage support.

## Editor And Workbench

- Monaco Editor: browser editor foundation.
- VS Code ecosystem concepts: workbench, activity bar, settings, extensions, tasks, debug adapters and related UX patterns.
- OpenVSX / extension ecosystem metadata may be used for extension discovery and icons where available.

## Frontend

- Vue and Vite: frontend application and build tooling.
- lucide icons where present in the UI.

## AI And Agent Integrations

Codek can connect to model providers through local configuration. Provider names, model names and API names remain trademarks or names of their owners. Do not commit API keys or provider credentials.

## Brand Boundaries

Codek is not VS Code, Cursor, Codex, OpenAI, Microsoft or Eclipse Foundation software. References to those names describe compatibility goals, inspiration, ecosystem interfaces or user-facing comparisons only.

## Public Release Action

Before a public GitHub Release, regenerate dependency notices from the package lock files and review license compatibility for production distribution.
