# Technical conventions

- Language: strict TypeScript. Node 24. Package manager: npm.
- `src/core` does not import `electron`. All domain logic lives there and is tested with Vitest.
- The index is accessed only through the `MemoryStore` interface.
- Electron: `contextIsolation: true`, `nodeIntegration: false`, typed IPC using types from `src/shared`.
- Paths opened with `shell.openPath` or `showItemInFolder` must be validated against the index.
- Network: only `localhost` model servers (Ollama, OpenAI-compatible local servers), GitHub Releases for update checks (can be turned off) and, if the user opts in, the official host of the chosen AI provider. No telemetry.
- External processes (soffice, tesseract): use `execFile` with an argument array, never concatenate strings into a shell.
- Property-based tests with `fast-check` for the properties listed in the requirements.
- UI text: Spanish and English through i18n. Code and identifiers in English.
- Do not add `.kiro/` to `.gitignore`.
- Do not commit, push or publish without explicit confirmation from the user.
