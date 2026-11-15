# OUIJA

> Summon your forgotten files. Resurrect dead file formats, search by meaning and hunt digital ghosts. Everything runs locally.

Built for the Kiroween Hackathon 2026 (**Resurrection** category). Desktop app for Windows and Linux.

## What it does

1. **Resurrection**: converts old formats (.wpd, .wps, .doc), recovers text from binaries, repairs corrupted encodings and looks inside your ZIP backups. Every file of any type can be found by name, folder and type (images, audio, video, code…).
2. **Local semantic search**: ask in plain language ("where is the poem for Rosa?") and get the file path, even inside a ZIP. Embeddings and the language model run on your machine through Ollama.
3. **Ghost autopsy**: detects duplicates, versions and forgotten documents, and tells the story of each one as an obituary.
4. **People and timeline**: reconstructs who appears in your files and when.
5. **Changes and Gallows**: OUIJA notices new, modified and deleted files. The *Gallows* tab shows what is in the trash, and *Resurrection* brings files back (Linux and Windows; it never overwrites anything).

The app lives in the system tray. A global shortcut opens a search palette with results and buttons to open a file or show its folder.

## Privacy

The index lives on your computer. No document leaves it. There are no network calls except to Ollama on `localhost` and, only if you choose it, to the language-model provider you configure (see below).

## Stack

Electron, React, TypeScript, Tailwind, SQLite (FTS5 + `sqlite-vec`), Ollama, Tesseract. GLIA is an optional adapter behind the `MemoryStore` interface (not implemented in this version).

## First run

On first launch you pick a language (Spanish or English), see how it works, and the app sets itself up: it uses the Ollama you already have or downloads its own (verified with SHA-256, no administrator rights) and pulls the `bge-m3` (meaning) and `qwen3.5:4b` (answers) models. That is about 6 GB, once, and the only thing that uses the internet. On low-memory machines it skips the answer model and stays in light mode.

**Language model:** during onboarding you choose whether answers come from a local model (private) or an external service (Claude, OpenAI, Gemini or DeepSeek, with your own key: pick a provider, paste the key, it is validated, choose one of the models that key can use, and it is tested before saving). You can change it later in Settings. Semantic search is always local; only your question and short snippets of the candidate files are sent to the service. The key is stored encrypted with your system's keystore.

Optional, to read more formats (onboarding shows the command for each): LibreOffice (old formats), Tesseract and Poppler (OCR), 7-Zip (RAR, 7z, ARJ, LZH).

## Install

Download the latest build from the [Releases](https://github.com/FelipeFariasAlfaro/OUIJA/releases) page. Every push to `main` publishes a new release.

- **Linux:** download `OUIJA-<version>.AppImage`, make it executable (`chmod +x`) and run it. A `.deb` is also published (`sudo apt install ./ouija_<version>_amd64.deb`).
- **Windows:** run `OUIJA-Setup-<version>.exe`. It creates desktop and Start menu shortcuts.

When it opens you get a normal window. `–` minimizes it to the taskbar or dock; one click brings it back. You can also open it from the tray icon, with the shortcut `Ctrl/Cmd + Shift + Space`, or by launching OUIJA again. `Esc` minimizes and `×` quits. While it is open (even minimized) it watches your folders and keeps the index up to date.

On GNOME the tray icon needs the AppIndicator extension (Ubuntu ships it enabled). On Wayland the global shortcut depends on the desktop portal; if it is unavailable, Settings says so.

## Demo

`node scripts/make-fixtures.mjs` creates `fixtures/chaos/`, a messy folder with an RTF poem, a 2008 ZIP backup with DOS text and a WordPerfect file, a damaged diary, contracts, an image and an audio file. The script is in `docs/DEMO.md`. How it was built with Kiro: `docs/KIRO_WRITEUP.md`.

## Development

```bash
npm install
npm run dev        # development
npm test           # unit and property tests
npm run e2e        # real app with Ollama (needs a display)
npm run package    # build an installer for your OS into release/
```

Packaging must run on the target OS so the right native library is included (the release workflow does this on GitHub Actions).

## Releases

`.github/workflows/release.yml` runs on every push to `main`: it checks types, lint and tests, builds the Linux and Windows installers on their own runners and publishes them as a GitHub release tagged `v<major>.<minor>.<run number - 1>` (the first run publishes `v0.1.0`). The base version comes from `package.json`.

## Status

Under construction. Specification in `.kiro/specs/medium/`.

## License

[MIT](LICENSE)
