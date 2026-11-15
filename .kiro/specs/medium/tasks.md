# Tasks: OUIJA

- [x] 1. Project scaffolding
  - [x] 1.1 Initialize Electron + Vite + React + TypeScript + Tailwind, Vitest, fast-check and ESLint
  - [x] 1.2 Create `src/core`, `src/main`, `src/renderer`, `src/shared`
  - [x] 1.3 Configure `electron-builder` for Windows and Linux (AppImage/deb)
  - _Requirements: R8_

- [x] 2. Memory core
  - [x] 2.1 Define `MemoryStore` and shared types
  - [x] 2.2 Implement `SqliteStore` (FTS5 + sqlite-vec)
  - [x] 2.3 Property tests P2 and P3
  - _Requirements: R4_

- [x] 3. Compressed containers
  - [x] 3.1 Read-only ZIP reader
  - [x] 3.2 7z/RAR/ARJ/LZH through optional `7z`
  - [x] 3.3 Virtual paths `container::path` and corruption tolerance
  - [x] 3.4 Property tests P4 and P7
  - _Requirements: R2_

- [x] 4. Document extraction and rescue
  - [x] 4.1 TXT, MD, PDF, DOCX, RTF extractors
  - [x] 4.2 DOC/WPD/WPS conversion with LibreOffice headless
  - [x] 4.3 Forensic string rescue for unsupported formats
  - [x] 4.4 Encoding detection and repair, with confidence score
  - [x] 4.5 OCR with Tesseract for PDFs without text
  - [x] 4.6 Property tests P4 and P6
  - _Requirements: R3_

- [x] 5. Indexing
  - [x] 5.1 Scanner with exclusions, hash and access times
  - [x] 5.2 Chunker, embedder (Ollama) and per-file summary
  - [x] 5.3 Batch pipeline with progress
  - [x] 5.4 Incremental watcher
  - _Requirements: R1, R4_

- [x] 6. Search and orchestration
  - [x] 6.1 Hybrid search with RRF
  - [x] 6.2 Orchestrator: structured query and cited answer
  - [x] 6.3 Path validation and light mode
  - [x] 6.4 Property test P1
  - _Requirements: R5_

- [x] 7. Ghosts and obituaries
  - [x] 7.1 Detection of duplicates and near-identical versions
  - [x] 7.2 Detection of unused files by threshold
  - [x] 7.3 Obituary generator from the index
  - _Requirements: R6_

- [x] 8. People and timeline
  - [x] 8.1 Entity extraction with the language model
  - [x] 8.2 Name unification with evidence and manual merge
  - [x] 8.3 Entity queries and timeline
  - [x] 8.4 Property test P8
  - _Requirements: R7_

- [x] 9. Desktop application
  - [x] 9.1 Tray, context menu and global shortcut with a Wayland notice
  - [x] 9.2 Main window, minimizable, with its own buttons
  - [x] 9.3 Typed IPC, security hardening and export of recovered files
  - [x] 9.4 Network blocking outside localhost and test P5
  - _Requirements: R8, R9_

- [x] 10. Interface
  - [x] 10.1 Search and result cards with keyboard navigation
  - [x] 10.2 Ghosts (with obituary) and People (with timeline) views
  - [x] 10.3 Settings (folders, exclusions, threshold, models, "Forget everything")
  - [x] 10.4 Séance theme, animations and ES/EN i18n
  - _Requirements: R6, R7, R8, R10_

- [x] 11. Demo and delivery
  - [x] 11.1 Fixtures: ZIP with DOS text and WPD, files with mojibake and binaries (`scripts/make-fixtures.mjs` → `fixtures/chaos/`)
  - [x] 11.2 E2E with Playwright (`tests/e2e/demo.e2e.ts`): "poem for Rosa" in the current document and in the 2008 backup
  - [x] 11.3 Linux package (AppImage and deb), README and video script (`docs/DEMO.md`). Windows installer is built on GitHub Actions
  - [x] 11.4 Write-up of how Kiro was used (`docs/KIRO_WRITEUP.md`)

- [x] 12. First run
  - [x] 12.1 Setup manager: detect, download and verify the local engine, start it and pull models
  - [x] 12.2 Welcome screen: language, slides and setup with suggested folders
  - [x] 12.3 Unit tests of the manager and e2e of the full flow
  - _Requirements: R11, R9_

- [x] 13. Local or external language model
  - [x] 13.1 Claude, OpenAI, Gemini and DeepSeek clients (models for the key, structured answer, clear errors)
  - [x] 13.2 Configuration service: validate, test, save; keys encrypted with the system keystore
  - [x] 13.3 Selector in onboarding and Settings (provider, key, validate, model, save)
  - [x] 13.4 Unit tests and e2e with a simulated provider
  - _Requirements: R12, R9_

- [x] 14. Changes, Gallows and Resurrection
  - [x] 14.1 Change log (SQLite), backup rescan and "Latest changes" view
  - [x] 14.2 Trash reading (freedesktop and Windows) and non-overwriting restore
  - [x] 14.3 Gallows tab with Condemned and Resurrection; detection option in Settings
  - [x] 14.4 Unit tests and e2e with a fake trash
  - _Requirements: R13_

- [x] 15. Rename and release automation
  - [x] 15.1 Rename the app to OUIJA and redraw the logo
  - [x] 15.2 GitHub Actions workflow that builds Windows and Linux installers and publishes a release on every push to `main`
