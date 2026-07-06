# ESLint Suppression Baseline

This project uses ESLint 9 suppressions in `.eslint-suppressions.json` only as a historical baseline for pre-existing Vue/TypeScript lint violations.

Rules for this branch:

- Do not add suppressions for new agentmemory, lifecycle, consensus, or Ruflo adapter code.
- New and edited feature code must pass the normal rules without `any`, unused symbols, empty blocks, or debug logs.
- The baseline should be pruned by module in follow-up cleanup work once those legacy files are fixed.
- `npm run lint` remains the quality gate; warnings are not suppressed.
