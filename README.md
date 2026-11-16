# OUIJA

> **Desktop search died in 2011. OUIJA brings it back from the dead**, with the AI of today, running entirely on your computer.

OUIJA is a desktop app for Windows and Linux that resurrects a dead technology, personal desktop search, and the files it left behind: documents in formats no program opens anymore, backups nobody remembers and files sent to the trash. You ask in your own words; the spirits answer with where the file is.

## What we resurrect

**Google Desktop Search** (2004–2011) promised to search your PC the way Google searched the web. Google discontinued it in 2011 (the same era took Windows XP's search dog, Rover), and personal files were left to the mercy of folder names. Everything moved to the cloud, but our files did not: they are still there, scattered across disks, old backups and formats no program opens anymore.

OUIJA resurrects that idea and reimagines it with what was impossible in 2011:

| Google Desktop (2004–2011) | OUIJA (2026) |
|---|---|
| Keyword search | Search by **meaning**, in your own words, with local embeddings |
| Indexed modern files only | **Resurrects dead formats**: WordPerfect, WordStar, Works, Write, Lotus, DOS text (CP437/CP850), broken encodings |
| Stopped at the ZIP | Looks **inside backups** (ZIP; 7z, RAR, ARJ, LZH with 7-Zip) |
| "Search Across Computers" copied your index to Google's servers | **Everything local**: no cloud, no telemetry |
| A list of links | An answer that cites only files that exist, plus **ghosts**, **people** and **timelines** |
| Dead in 2011 | Open to **AI agents** through MCP |

And it resurrects files in three more ways:

- **Bring to the present:** a 1994 WordPerfect thesis comes back as a `.docx` (or clean UTF-8 Markdown when the file is too damaged), saved where you choose. The original is never touched.
- **The Gallows:** what you sent to the trash, with what OUIJA knew about it. From *Resurrection* you bring it back to its original place, never overwriting anything (Linux and Windows).
- **Ghosts:** forgotten files, exact copies and near-identical versions, each with its obituary.

## Features

1. **Ask the board.** "Where is the poem I wrote for Rosa?" → the 2019 document and its 2008 draft **inside a backup**, marked *Resurrected*, with its confidence level.
2. **Resurrection of dead formats.** LibreOffice conversion when available; otherwise forensic rescue from the raw bytes, encoding detection (CP437, CP850, Latin-1) and mojibake repair ("Ã±" → "ñ").
3. **Every file type is findable** by name, folder and type (images, audio, video, code…); small images are read with OCR.
4. **Ghost autopsy**, **People / Specters** with timelines (merge "Rosita" with "Rosa"), and **live change detection**.
5. **MCP server.** Kiro, Claude Desktop or any MCP agent can ask OUIJA where your files are and read the ones it resurrected. Settings shows the configuration ready to paste.
6. **Six languages:** Spanish, English, Portuguese, French, Japanese and Chinese.
7. **A haunted interface** that serves the function: séance metaphor, storm and ghosts on the welcome screen, subtle fog and distant lightning in the app, and a guided tour.

## Privacy

The index lives on your computer and no document leaves it. Network calls go only to Ollama on `localhost` and, only if you choose it, to the language-model provider you configure. Search by meaning is always local; an external provider receives only your question and short snippets of the candidate files. API keys are encrypted with the system keystore and never reach the UI.

## Use it from an AI agent (MCP)

OUIJA ships a read-only [Model Context Protocol](https://modelcontextprotocol.io) server over stdio. Open **Settings → Connect AI agents (MCP)**, copy the configuration and paste it into your agent's `mcp.json` (for Kiro: `.kiro/settings/mcp.json` or `~/.kiro/settings/mcp.json`). On Linux with the AppImage it looks like:

```json
{
  "mcpServers": {
    "ouija": { "command": "/path/to/OUIJA-0.2.0.AppImage", "args": ["--mcp"] }
  }
}
```

| Tool | What it does |
|---|---|
| `ask_ouija` | Finds files by meaning, in any language, including inside backups and old formats |
| `read_resurrected` | Reads a file as OUIJA recovers it (converted, rescued, encoding repaired). Only indexed files |
| `list_ghosts` | Forgotten files, duplicates and versions, with their obituary |
| `find_person` | Timeline of the files that mention someone |
| `recent_changes` | What was recently added, modified or deleted |

The server runs alongside the open app and only reads the index; it never modifies, moves or deletes anything.

## Install

Download the latest build from the [Releases](https://github.com/FelipeFariasAlfaro/OUIJA/releases) page. Every push to `main` publishes a new release.

- **Linux:** download `OUIJA-<version>.AppImage`, make it executable (`chmod +x`) and run it. A `.deb` is also published (`sudo apt install ./ouija_<version>_amd64.deb`).
- **Windows:** run `OUIJA-Setup-<version>.exe`. It creates desktop and Start menu shortcuts.

On first launch you pick a language, see how it works, choose a local or external language model, and the app sets itself up: it uses the Ollama you already have or downloads its own (verified with SHA-256, no administrator rights) and pulls `bge-m3` (meaning) and `qwen3.5:4b` (answers). That is about 6 GB, once, and the only thing that uses the internet. Optional add-ons read more formats: LibreOffice (old formats and *Bring to the present* as DOCX), Tesseract and Poppler (OCR), 7-Zip (RAR, 7z, ARJ, LZH).

`–` minimizes to the taskbar, `×` quits, and `Ctrl/Cmd + Shift + Space` brings it back. On GNOME the tray icon needs the AppIndicator extension; on Wayland the global shortcut depends on the desktop portal.

## Demo

`node scripts/make-fixtures.mjs` creates `fixtures/chaos/`: an RTF poem, a 2008 ZIP backup with DOS text and a WordPerfect thesis, a damaged diary, contracts, an image and an audio file. The video script is in `docs/DEMO.md`; how it was built with Kiro is in `docs/KIRO_WRITEUP.md`.

## Stack

Electron, React, TypeScript, Tailwind, SQLite (FTS5 + `sqlite-vec`), Ollama, LibreOffice, Tesseract. Optional GLIA adapter behind the `MemoryStore` interface.

## Development

```bash
npm install
npm run dev        # development
npm test           # unit and property tests
npm run e2e        # real app with Ollama (needs a display)
npm run package    # installer for your OS into release/
```

`.github/workflows/release.yml` runs on every push to `main`: typecheck, lint and tests, then the Linux and Windows installers on their own runners, published as a GitHub release `v<version>` from `package.json` (if that release already exists, the next free patch number).

Specification, steering and hooks are in `.kiro/`.

## License

[MIT](LICENSE)
