# How OUIJA was built with Kiro

OUIJA is a desktop app (Windows and Linux) that finds files by meaning using local models, resurrects old or damaged formats and finds digital "ghosts". It was built from scratch during the Kiroween 2026 period (Resurrection category).

## What was used and what was not

| Kiro feature | Use |
|---|---|
| Specs | Yes: `.kiro/specs/medium/` (requirements, design, tasks). |
| Steering | Yes: `.kiro/steering/` (product, technical conventions, UI style). |
| Hooks | Yes, one: typecheck on saving code. |
| Property-based tests (PBT) | Yes, with `fast-check`: the properties listed in the spec. |
| MCP, Powers, Kiro Crew, custom agents | Not used in this project. |

## Specs: from requirement to test

The requirements are written in EARS format ("WHEN… THE system SHALL…") and end with a list of **verifiable properties**. Every task in the plan (`tasks.md`) cites the requirements it covers. Progress was ticked task by task and the design was corrected when reality contradicted it: floppy and CD images were dropped as useless, and indexing of every file type was added when tests with real folders showed that a search tool that only knows documents cannot find a logo.

Compared with "vibe coding", the spec gave two concrete things: a definition of done per task and a contract (`MemoryStore`, `MediumApi`) that allowed building the core without a UI and the UI without the core.

## Steering

- `product.md`: non-negotiable principles (everything local, never modify the user's files, cite only paths that exist). They prevented local decisions that would have broken them, for example opening arbitrary paths from the UI.
- `tech.md`: conventions (strict TypeScript, `src/core` free of Electron, `execFile` with argument arrays, typed IPC).
- `ui-style.md`: dark theme, subtle animation, keyboard first, ES/EN i18n.

## Hook

`typecheck-on-save` runs `npm run typecheck` and the tests whenever a `.ts` or `.tsx` file is saved. It caught contract regressions early when the shape of `Hit` and `IndexedDoc` changed.

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

Besides the 365 unit and property tests, `npm run e2e` (45 tests) launches the real Electron app against real Ollama (`bge-m3` and `qwen3.5:4b`) over `fixtures/chaos/`: it checks renderer isolation, network blocking, search inside a ZIP, WordPerfect rescue, repair of damaged text, the external-provider flow against a simulated server, and the Gallows against a fake trash.

## What I would do differently

Use an MCP server to expose the search to other agents, and a hook that runs the e2e tests before packaging.
