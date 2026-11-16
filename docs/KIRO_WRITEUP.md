# How OUIJA was built with Kiro

OUIJA resurrects **desktop search**, the idea Google Desktop Search (2004–2011) took to its grave, and reimagines it with local AI: it finds files by meaning, resurrects dead formats (WordPerfect, WordStar, DOS text), looks inside old backups, brings files back from the trash and exposes all of it to AI agents through MCP. Desktop app for Windows and Linux, built from scratch during the Kiroween 2026 period (Resurrection category).

## What was used and what was not

| Kiro feature | Use |
|---|---|
| Specs | Yes: `.kiro/specs/ouija/` (requirements, design, tasks). |
| Steering | Yes: `.kiro/steering/` (product, technical conventions, UI style). |
| Hooks | Yes: typecheck and tests on saving code. |
| Property-based tests (PBT) | Yes, with `fast-check`: the properties listed in the spec. |
| MCP | Yes, in both directions: OUIJA **is** an MCP server, and Kiro uses it (`.kiro/settings/mcp.json`). |
| Powers, Kiro Crew, custom agents | Not used in this project. |

## Specs: from requirement to test

The requirements are written in EARS format ("WHEN… THE system SHALL…") and end with a list of **verifiable properties**. Every task in the plan (`tasks.md`) cites the requirements it covers. Progress was ticked task by task and the design was corrected when reality contradicted it: floppy and CD images were dropped as useless, and indexing of every file type was added when tests with real folders showed that a search tool that only knows documents cannot find a logo.

Compared with "vibe coding", the spec gave two concrete things: a definition of done per task and a contract (`MemoryStore`, `OuijaApi`) that allowed building the core without a UI and the UI without the core.

## Steering

- `product.md`: non-negotiable principles (everything local, never modify the user's files, cite only paths that exist). They prevented local decisions that would have broken them, for example opening arbitrary paths from the UI.
- `tech.md`: conventions (strict TypeScript, `src/core` free of Electron, `execFile` with argument arrays, typed IPC).
- `ui-style.md`: dark theme, subtle animation, keyboard first, ES/EN i18n.

## Hook

`typecheck-on-save` runs `npm run typecheck` and the tests whenever a `.ts` or `.tsx` file is saved. It caught contract regressions early when the shape of `Hit` and `IndexedDoc` changed.

## MCP: Kiro talking to OUIJA

OUIJA ships a read-only MCP server over stdio (`ask_ouija`, `read_resurrected`, `list_ghosts`, `find_person`, `recent_changes`). It reuses the same core as the app in a *passive* mode: it only reads the index the app keeps up to date (SQLite in WAL mode, so both can run at once), never starts watchers, never touches the user's files and answers without a language model, because the caller already is one.

The workspace includes `.kiro/settings/mcp.json` pointing at the dev build (disabled by default; enable it after `npm run build`). With it, Kiro can answer "what did my 2008 thesis draft say about Rosa?" by calling `ask_ouija`, getting back a WordPerfect file inside a ZIP backup, and reading it with `read_resurrected`, which converts or rescues the text on the fly. That closes the loop of the resurrection: a 1990s file format that no program opens becomes context for a 2026 agent. The e2e suite drives the real server over stdio while the app is open.

## Property-based tests

| Property | What it guarantees |
|---|---|
| P1 | Every path cited in an answer exists in the index, even if the model invents files. |
| P2 | Re-indexing without changes does not alter the index. |
| P3 | After forgetting a path, no search returns it. |
| P4 | Extracting or opening a container does not modify the original. |
| P5 | In local mode the app only talks to the local machine. |
| P6 | Encoding repair is idempotent and does not alter correct text. |
| P7 | The container reader never throws on corrupt files. |
| P8 | Every timeline entity references files that exist. |
| P9 | Only a provider's official host (or localhost in tests) is accepted for an external service. |
| P10 | Resurrecting from the trash never modifies an existing file at the destination. |

What they found that example-based tests would not have:

- Indexing updated the last-access time of every file, so everything looked recently used. Fixed by reading with `O_NOATIME`.
- The mojibake round-trip property failed on `"Ñ“"`: it is ambiguous by nature and was documented as a known limit.
- Short DOS text with accents was read as Windows-1252 (`"d¡a"`, `"Concepci¢n"`); a penalty for symbols inside words was added.

**Manual mutation testing** was also applied: after each task the key rule was deliberately broken (no citation check, no index check, export that overwrites, allowing a remote server, removing the CRC…) and a test was confirmed to fail. Once a mutation failed nothing, which revealed a weak test that was then strengthened.

## Verification with the real app

Besides the 373 unit and property tests, `npm run e2e` (53 tests) launches the real Electron app against real local models (`bge-m3` and `qwen3.5:4b` through Ollama) over `fixtures/chaos/`: it checks renderer isolation, network blocking, search inside a ZIP, WordPerfect rescue, repair of damaged text, the external-provider flow against a simulated server, the Gallows against a fake trash, the MCP server over stdio, *Bring to the present* and the six interface languages.

## What I would do differently

Add a hook that runs the e2e tests before packaging, and try Kiro Crew to translate the interface in parallel with feature work.
