# Changelog

All notable changes to OUIJA. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.5.1] - 2026-11-16

### Changed
- Latest changes: hovering a file shows "Show folder" and "Open file".
- README: features list updated (Summon filters, Crypt guide, About, automatic updates, Exorcism).

## [0.5.0] - 2026-11-16

### Changed
- The index is rebuilt once after updating (new readers and dates).

### Added
- **The Crypt** tab: open someone's digital inheritance (a folder, an old disk, a backup) and read it as a grimoire of memories: years, souls, portraits, voices, resurrected files and an epitaph written only from the index. Export the grimoire as PDF.
- A **(?)** guide in the Crypt explains each step with its real status (folder handed over, files read, souls recognized, model for the epitaph) and a button to fix what is missing.
- **Voices from beyond:** MSN Messenger history (XML), Outlook Express `.dbx` folders and `.mbox` mailboxes are read and searchable.
- Photos are dated by their EXIF date (when they were taken), not when they were copied.
- **Autopsy report:** `npm run autopsy` measures resurrection and search quality on the demo folder and writes `docs/AUTOPSY.md`.
- **Exorcism** (last card in Settings): erase all of OUIJA's data and reopen from the welcome screen, after a confirmation; optionally keep the AI engine and models. Your files are never touched.
- **About** button (?) next to the tabs: a sinister credits modal with embers, red fog and a tombstone, with the author, email, repository and LinkedIn. Only those links can be opened.

## [0.4.0] - 2026-11-16

### Added
- **Any local model.** Settings lists the chat models installed in Ollama and the ones served by LM Studio, llama.cpp, Jan or vLLM on this computer; choose one or leave *Automatic*.

### Changed
- The app data folder is now `ouija` (for example `~/.config/ouija` or `%APPDATA%\ouija`). An existing `medium` folder is renamed automatically on first launch, keeping the index, settings and models.
- Internal names, IPC channels and environment variables no longer use the old name.

## [0.3.0] - 2026-11-16

### Added
- **Automatic updates.** OUIJA checks GitHub Releases when it opens and every 6 hours. On Windows and with the AppImage it downloads the new version, verifies it and installs it on restart; with the `.deb` it opens the download page. It can be turned off in Settings, which also has a "Check now" button.
- **Filters in Summon.** Narrow a question by file type and by date (last month, last year, over 5 years ago). The question is asked again when a filter changes.
- **Search and filters in Ghosts.** Find ghosts by name, path, summary, people or topics, and filter them by category and file type.
- README section on local versus external AI, with estimated costs per provider.

### Changed
- The "Search" tab is now **"Summon"** in every language.
- The release workflow publishes `latest*.yml` and blockmaps so installed apps can update themselves, and uses this changelog as the release notes.

## [0.2.0] - 2026-11-16

### Added
- **MCP server** (read-only, over stdio): `ask_ouija`, `read_resurrected`, `list_ghosts`, `find_person` and `recent_changes`. It runs alongside the open app; Settings shows the configuration ready to paste.
- **Bring to the present:** save a resurrected file as `.docx`/`.xlsx` (LibreOffice) or UTF-8 Markdown, never overwriting anything.
- **Portuguese, French, Japanese and Chinese**, besides Spanish and English.
- **Guided tour** after onboarding, replayable from Settings.
- **Spooky ambience:** storm, lightning and drifting ghosts on the welcome screen; subtle fog, distant lightning and ghosts in the app (can be turned off).
- **People / Specters:** search by name, and open or show the files that mention someone.
- **File types in searches:** choose in Settings which of the file types found are included.
- Clear button in the search box, provider logos, and a Settings card that says which AI does each task.

### Changed
- Resizable, maximizable window with a larger default size.
- New ghost logo and app icon.

## [0.1.0] - 2026-11-15

### Added
- Search your files by meaning with local AI (Ollama, `bge-m3` and `qwen3.5:4b`), including files inside ZIP backups.
- Resurrection of old formats (WordPerfect, WordStar, Works, old Office, DOS text) and repair of broken encodings.
- Every file type is findable by name, folder and type; OCR for small images.
- Ghosts with obituaries, people and timelines.
- Live change detection, and the Gallows: view the trash and restore files without overwriting.
- Optional external AI (Claude, OpenAI, Gemini, DeepSeek) with keys encrypted by the system keystore.
- Onboarding with automatic setup of Ollama and the models.
- Linux (AppImage, deb) and Windows (NSIS) installers built on every push to `main`.

[0.5.1]: https://github.com/FelipeFariasAlfaro/OUIJA/releases/tag/v0.5.1
[0.5.0]: https://github.com/FelipeFariasAlfaro/OUIJA/releases/tag/v0.5.0
[0.4.0]: https://github.com/FelipeFariasAlfaro/OUIJA/releases/tag/v0.4.0
[0.3.0]: https://github.com/FelipeFariasAlfaro/OUIJA/releases/tag/v0.3.0
[0.2.0]: https://github.com/FelipeFariasAlfaro/OUIJA/releases/tag/v0.2.0
[0.1.0]: https://github.com/FelipeFariasAlfaro/OUIJA/releases/tag/v0.1.0
