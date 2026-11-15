# Design: OUIJA

## Architecture

```
┌────────────────────────── Electron ──────────────────────────┐
│ Renderer (React + TS + Tailwind)                             │
│   Search · Results · Ghosts · People · Gallows · Settings    │
│        │ typed IPC (contextBridge)                           │
│ Main process                                                 │
│   Tray · Global shortcut · Window · Opener                   │
│        │                                                     │
│ Core (TypeScript, no Electron dependencies)                  │
│   Scanner → Extractors → Chunker → Embedder → MemoryStore    │
│   Watcher · Orchestrator (LLM) · GhostHunter                 │
└───────────────┬──────────────────────────────┬───────────────┘
                │ HTTP localhost               │ local processes
              Ollama                  Tesseract · LibreOffice headless
```

`core` does not import Electron, so it is tested with Vitest and could be exposed as an MCP server.

## Repo structure

```
src/
  core/
    memory/        MemoryStore.ts, SqliteStore.ts, GliaStore.ts (optional)
    extract/       txt, md, pdf, docx, rtf, legacy (soffice), ocr
    indexing/      scanner.ts, watcher.ts, chunker.ts, pipeline.ts
    ai/            ollama.ts, embedder.ts, orchestrator.ts, providers/
    ghosts/        duplicates.ts, versions.ts, stale.ts
  main/            tray.ts, shortcut.ts, window.ts, ipc.ts, core/ (settings, setup, secrets, trash)
  renderer/        App.tsx, components/, views/, onboarding/, i18n.ts
  shared/          types.ts, ipc.ts (IPC and domain contracts)
tests/             unit/, property/, e2e/
```

## Digital archaeology approach

```
src/core/
  media/      container.ts (ZIP, optional 7z), vpath.ts
  extract/    ...legacy.ts (LibreOffice), carve.ts (forensic rescue), encoding.ts (detection and repair)
  ghosts/     ..., obituary.ts
  entities/   extract.ts, resolve.ts, timeline.ts
```

- **Containers:** read-only readers. Nothing is extracted to the user's disk. Each entry produces a `VirtualFile` with a path such as `backup.zip::DIR/FILE.WPD`, on-demand content and metadata.
- **Forensic rescue (`carve.ts`):** looks for runs of printable bytes in the binary, tries candidate encodings (CP437, CP850, Latin-1, UTF-8), scores by the share of recognizable words and returns text with a confidence level.
- **Repair (`encoding.ts`):** detects mojibake (for example "Ã±" → "ñ") by reversing the wrong decoding. It is idempotent (P6).
- **Entities:** the LLM returns JSON `{people, places, projects}` per file. `resolve.ts` unifies variants by string similarity and co-occurrence, and respects saved manual merges.
- **Obituary:** a template that combines index metadata with the summary. The LLM only rephrases text that is already present and adds no data.
- **New tables:** `entities(id, kind, name)`, `entity_files(entity_id, file_id)`, `entity_merges(a, b, manual)`. Columns `files.container` and `files.confidence`.

## Ghosts (decisions)

- **Near-identical versions:** content similarity, not semantic. 3-word shingles, MinHash (128 permutations) and LSH (32 bands) avoid comparing everything with everything. Default threshold: estimated Jaccard ≥ 0.6. Two different texts on the same topic are not versions.
- **Last use:** the greater of `atime` and `mtime`. Indexing must not alter `atime`: reads use `O_NOATIME` (Linux, own files only). On Windows access time is usually disabled by the system, so `mtime` rules.
- **`born`:** the oldest date between creation and modification. A copy can have a creation time later than `mtime`.
- **Keep:** in each group, the member with the most recent `mtime` (ties broken by path). It is the only one not listed as a ghost for belonging to the group.
- Containers and files with errors do not count as documents.

## Core interface

```ts
interface MemoryStore {
  upsert(doc: IndexedDoc, chunks: Chunk[]): Promise<void>;
  search(q: HybridQuery): Promise<Hit[]>;   // vectors + FTS + filters
  forget(path: string): Promise<void>;
  forgetAll(): Promise<void>;
  listFiles(filter?: FileFilter): Promise<IndexedDoc[]>;
  hasPath(path: string): Promise<boolean>;
}
```

## Data model (SQLite)

- `files(id, path UNIQUE, hash, size, mtime, atime, ext, summary, resurrected, error)`
- `chunks(id, file_id, ord, text)` + virtual table `chunks_fts` (FTS5)
- `chunk_vec` (sqlite-vec, dimension of the embedding model)
- `changes` (detected new / modified / removed files, deduplicated within 60 s, capped at 1000)

## Hybrid search

1. The Orchestrator asks the LLM for JSON `{query, extensions?, dateFrom?, dateTo?, folder?}`.
2. KNN runs on `chunk_vec` and BM25 on `chunks_fts` with the filters.
3. Reciprocal Rank Fusion and grouping by file.
4. The LLM writes the answer using only the retrieved fragments. Paths are validated against `hasPath`.
5. Light mode: steps 1 and 4 are skipped.

## Local models (default)

- Embeddings: `bge-m3` through Ollama (multilingual), always local.
- LLM: `qwen3.5:4b` through Ollama, or an external provider (Claude, OpenAI, Gemini, DeepSeek) chosen by the user.

## Resurrection

`legacy` calls `soffice --headless --convert-to txt` on a temporary copy. The original is never touched (P4). The resulting text is stored in `<userData>/resurrected/<hash>.txt`.

## Changes, Gallows and trash resurrection

- A watcher (chokidar) plus a backup rescan every 15 minutes record new, modified and removed files. The first indexing of a folder is silent. A removed file keeps a snapshot of its summary.
- The Gallows reads the trash: freedesktop (`~/.local/share/Trash` and per-mount `.Trash-<uid>`) on Linux, `$Recycle.Bin` (`$I` v1/v2) on Windows. macOS is not supported.
- Restoring never overwrites (`link` / `COPYFILE_EXCL`, renamed to `(resucitado)`), only acts on ids from the last read (max 200 at a time) and goes to the original place or a folder chosen in a dialog.
- Recovering files already removed from the trash is out of scope: it needs raw disk access and offers no guarantee.

## Tray and window

- `Tray` with a context menu. A normal framed-by-the-app window with its own minimize and close buttons, present in the taskbar.
- Global shortcut with `globalShortcut`. On Wayland a registration failure is detected and a notice is shown; the tray icon keeps working.
- On GNOME the tray icon needs the AppIndicator extension. This is documented in the README.

## Security

- `contextIsolation: true`, `nodeIntegration: false`, minimal API exposed through `contextBridge`.
- Paths opened with `shell.openPath` and `showItemInFolder` must come from the index.
- Network blocking: `session.webRequest` rejects hosts other than `localhost` in local mode (P5).
- API keys are encrypted with the system keystore and never return to the renderer.

## Tests

- Unit tests with Vitest.
- Properties with `fast-check`.
- E2E with Playwright over Electron and a messy sample folder (`fixtures/chaos/`).

## Decisions

- Electron instead of Tauri: Node already available, more predictable tray and window, lower schedule risk.
- GLIA behind `MemoryStore` to keep the product independent.
