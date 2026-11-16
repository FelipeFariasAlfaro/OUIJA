# OUIJA

> **Desktop search died in 2011. OUIJA brings it back from the dead**, with the AI of today, running entirely on your computer.

OUIJA is a desktop app for Windows and Linux that resurrects a dead technology, personal desktop search, and the files it left behind: documents in formats no program opens anymore, backups nobody remembers and files sent to the trash. You ask in your own words; the spirits answer with where the file is.

## What we resurrect

**Google Desktop Search** (2004–2011) promised to search your PC the way Google searched the web. Google discontinued it in 2011 (the same era took Windows XP's search dog, Rover), and personal files were left to the mercy of folder names. Everything moved to the cloud, but our files did not: they are still there, scattered across disks, old backups and formats no program opens anymore.

OUIJA resurrects that idea and reimagines it with what was impossible in 2011:

| Google Desktop (2004–2011) | OUIJA (2026) |
|---|---|
| Keyword search | Search by **meaning**, in your own words, with local embeddings |
| Indexed modern files only | **Resurrects dead formats**: WordPerfect, WordStar, Works, Write, Lotus, DOS text (CP437/CP850), broken encodings, **MSN Messenger** chats, **Outlook Express** folders, `.mbox` mailboxes |
| Stopped at the ZIP | Looks **inside backups** (ZIP; 7z, RAR, ARJ, LZH with 7-Zip) |
| "Search Across Computers" copied your index to Google's servers | **Everything local**: no cloud, no telemetry |
| A list of links | An answer that cites only files that exist, plus **ghosts**, **people** and **timelines** |
| Dead in 2011 | Open to **AI agents** through MCP |

And it resurrects what those files meant:

- **The Crypt.** Open someone's digital inheritance (the PC of a parent who is gone, an old disk, the family backups) and OUIJA arranges it into a **grimoire of memories**: the years, the souls that appear in it, portraits dated by their EXIF, the *voices from beyond* (old chats and emails), what came back from dead formats, and an epitaph written only from what the files say. Export it as a PDF to keep or share.

- **Bring to the present:** a 1994 WordPerfect thesis comes back as a `.docx` (or clean UTF-8 Markdown when the file is too damaged), saved where you choose. The original is never touched.
- **The Gallows:** what you sent to the trash, with what OUIJA knew about it. From *Resurrection* you bring it back to its original place, never overwriting anything (Linux and Windows).
- **Ghosts:** forgotten files, exact copies and near-identical versions, each with its obituary.

## Features

1. **Ask the board.** "Where is the poem I wrote for Rosa?" → the 2019 document and its 2008 draft **inside a backup**, marked *Resurrected*, with its confidence level.
2. **Resurrection of dead formats.** LibreOffice conversion when available; otherwise forensic rescue from the raw bytes, encoding detection (CP437, CP850, Latin-1) and mojibake repair ("Ã±" → "ñ").
3. **Every file type is findable** by name, folder and type (images, audio, video, code…); small images are read with OCR.
4. **Ghost autopsy**, **People / Specters** with timelines (merge "Rosita" with "Rosa"), and **live change detection**.
5. **Voices from beyond.** MSN Messenger history (2006) becomes a readable conversation; Outlook Express `.dbx` folders and `.mbox` mailboxes are rescued; photos are dated by when they were taken (EXIF), not when they were copied.
6. **The Crypt** and its exportable **grimoire** (PDF).
7. **MCP server.** Kiro, Claude Desktop or any MCP agent can ask OUIJA where your files are and read the ones it resurrected. Settings shows the configuration ready to paste.
8. **Six languages:** Spanish, English, Portuguese, French, Japanese and Chinese.
9. **A haunted interface** that serves the function: séance metaphor, storm and ghosts on the welcome screen, subtle fog and distant lightning in the app, and a guided tour.

## Autopsy report

Measured on the demo folder with `npm run autopsy` ([full report](docs/AUTOPSY.md)):

- **7 of 7** dead or damaged files come back with their text; opened as plain text, only 3 of them show it.
- Finding files from what you remember, 12 questions in Spanish and English: **Recall@5 100%** and **MRR 0.96** with meaning + keywords, against 92% and 0.81 with keywords only.

## Privacy

The index lives on your computer and no document leaves it. Network calls go only to local model servers on `localhost` (Ollama, or LM Studio and similar if you choose one), to GitHub to check for new versions (can be turned off) and, only if you choose it, to the language-model provider you configure. Search by meaning is always local; an external provider receives only your question and short snippets of the candidate files. API keys are encrypted with the system keystore and never reach the UI.

## Local AI first, external AI if you want

OUIJA is designed to run with **local AI**, at no cost per question and with nothing leaving your computer. Answers can come from **any local model**: any chat model installed in Ollama, or one served on this computer by LM Studio, llama.cpp, Jan or vLLM (any server with an OpenAI-compatible API on `localhost`). Pick it in **Settings → Artificial intelligence → Answer model**, or leave it on *Automatic* to use the best one installed. Onboarding installs `qwen3.5:4b` if you have none. Search by meaning uses an Ollama embedding model (`bge-m3` by default).

If your machine is short on memory, or you want better written answers, you can switch the **answer model** to Claude, OpenAI, Gemini or DeepSeek with your own API key. Search by meaning stays local in every case.

**What a question costs.** Each question makes two small calls: one to understand it and one to write the answer from at most 8 candidate files. That is roughly **1,900 input tokens and 220 output tokens per question**. Recognizing people and summarizing documents with an external service is off by default; if you enable it, each document costs roughly **2,600 input and 250 output tokens**, once.

| Provider · model | Price per 1M tokens (input / output) | ≈ 1,000 questions | ≈ 1,000 documents (opt-in) |
|---|---|---|---|
| **Any local model** (Ollama, LM Studio, llama.cpp, Jan, vLLM…) | free | **$0** | **$0** |
| Claude Haiku 5.5 | $0.10 / $0.50 | $0.30 | $0.39 |
| Claude Sonnet 5.5 | $2 / $10 | $6.00 | $7.70 |
| Claude Opus 5.5 | $4 / $20 | $12.00 | $15.40 |
| OpenAI GPT-5.4 nano | $0.20 / $1.25 | $0.66 | $0.83 |
| OpenAI GPT-5.4 mini | $0.75 / $4.50 | $2.42 | $3.08 |
| OpenAI GPT-5.6 Sol | $5 / $30 | $16.10 | $20.50 |
| Gemini 3.1 Flash-Lite | $0.25 / $1.50 | $0.81 | $1.03 |
| Gemini 3.8 Flash ¹ | $0.75 / $3.75 | $2.25 | $2.89 |
| Gemini 3.1 Pro | $2 / $12 | $6.44 | $8.20 |
| DeepSeek V4.1 Flash ² | $0.15 / $0.60 | $0.42 | $0.54 |
| DeepSeek V4 Pro ² | $0.66 / $1.98 | $1.69 | $2.21 |

Estimates in USD with list prices as of November 2026, without prompt caching or batch discounts. Real usage varies with the length of your files' snippets and summaries, and "thinking" models may add reasoning tokens. ¹ Introductory price until December 31, 2026. ² Off-peak price; DeepSeek charges double at peak hours. Prices change often: check each provider before choosing.

Sources: [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing), [OpenAI GPT-5.4 mini and nano](https://community.openai.com/t/introducing-gpt-5-4-mini-and-nano-our-most-capable-small-models-yet/1377015), [OpenAI API pricing overview](https://www.morphllm.com/openai-api-pricing), [Gemini API pricing (Nov 2026)](https://costgoat.com/pricing/gemini-api), [DeepSeek API pricing (Nov 2026)](https://www.nxcode.io/resources/news/deepseek-api-pricing-complete-guide-2026), [DeepSeek peak and off-peak rates](https://coworker.ai/blog/deepseek-api-pricing).

## Use it from an AI agent (MCP)

OUIJA ships a read-only [Model Context Protocol](https://modelcontextprotocol.io) server over stdio. Open **Settings → Connect AI agents (MCP)**, copy the configuration and paste it into your agent's `mcp.json` (for Kiro: `.kiro/settings/mcp.json` or `~/.kiro/settings/mcp.json`). On Linux with the AppImage it looks like:

```json
{
  "mcpServers": {
    "ouija": { "command": "/path/to/OUIJA-0.5.1.AppImage", "args": ["--mcp"] }
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

OUIJA checks GitHub Releases when it opens and every 6 hours (can be turned off in Settings). On Windows and with the AppImage it downloads the new version, verifies it and installs it on restart; with the `.deb` it opens the download page.

On first launch you pick a language, see how it works, choose a local or external language model, and the app sets itself up: it uses the Ollama you already have or downloads its own (verified with SHA-256, no administrator rights) and pulls `bge-m3` (meaning) and, if you have no chat model yet, `qwen3.5:4b` (answers). That is about 6 GB, once, and the only thing that uses the internet. Optional add-ons read more formats: LibreOffice (old formats and *Bring to the present* as DOCX), Tesseract and Poppler (OCR), 7-Zip (RAR, 7z, ARJ, LZH).

`–` minimizes to the taskbar, `×` quits, and `Ctrl/Cmd + Shift + Space` brings it back. On GNOME the tray icon needs the AppIndicator extension; on Wayland the global shortcut depends on the desktop portal.

## Demo

`node scripts/make-fixtures.mjs` creates `fixtures/chaos/`: an RTF poem, a 2008 ZIP backup with DOS text and a WordPerfect thesis, a damaged diary, contracts, an image and an audio file. The video script is in `docs/DEMO.md`; how it was built with Kiro is in `docs/KIRO_WRITEUP.md`.

## Stack

Electron, React, TypeScript, Tailwind, SQLite (FTS5 + `sqlite-vec`), Ollama or any OpenAI-compatible local server, LibreOffice, Tesseract. Optional GLIA adapter behind the `MemoryStore` interface.

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
