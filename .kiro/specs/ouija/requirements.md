# Requirements: OUIJA

## Introduction

OUIJA is a desktop app (Windows and Linux) for personal digital archaeology. It lives in the system tray. It resurrects files in old or damaged formats, makes them searchable by meaning, tells the story of each forgotten file and reconstructs who appears in your digital past. All processing is local.

## Requirements

### R1. Folder indexing
**Story:** As a user, I want to choose folders so OUIJA indexes them.
1. WHEN the user adds a folder, THE system SHALL walk it recursively and record every supported file with path, hash, size, modification time and last-access time.
2. THE system SHALL respect a configurable exclusion list (by default `node_modules`, `.git`, hidden key folders).
3. WHEN a file has not changed (same hash), THE system SHALL skip re-indexing it.
4. WHILE indexing, THE system SHALL show progress (processed / total).
5. WHEN a file changes, is created or is deleted in a watched folder, THE system SHALL update the index without re-indexing the rest.

### R2. Compressed containers
**Story:** As a user, I want what is inside my compressed backups to be indexed.
1. THE system SHALL open ZIP containers read-only, without extracting them to the user's disk.
2. WHERE `7z` is available, THE system SHALL also open 7z, RAR, ARJ and LZH.
3. WHEN a container holds supported files, THE system SHALL treat them as indexable files with the virtual path `container::inner/path`.
4. THE system SHALL tolerate damaged containers: IF an entry cannot be read, THEN THE system SHALL log the error and continue with the others.
5. THE system SHALL mark as "resurrected" any content obtained from an old format or rescued from a damaged file.

### R3. Document resurrection
**Story:** As a user, I want my old documents to be readable.
1. THE system SHALL extract text from TXT, MD, PDF, DOCX and RTF.
2. THE system SHALL convert DOC, WPD and WPS with a local converter (LibreOffice headless).
3. IF the converter does not support or fails on a file (for example WordStar), THEN THE system SHALL apply forensic rescue: extract text strings from the binary, detect the encoding and rebuild readable text.
4. THE system SHALL detect and repair text corrupted by old encodings (CP437, CP850, Latin-1, mojibake such as "Ã±").
5. IF a PDF contains no text, THEN THE system SHALL apply local OCR with Tesseract.
6. IF extraction fails, THEN THE system SHALL log the error per file and continue.
7. THE system SHALL store resurrected text in the app data folder and SHALL NOT modify the original.
8. THE system SHALL show a confidence indicator (high, medium, low) for recovered text.

### R4. Local semantic memory
**Story:** As a user, I want search to understand meaning.
1. THE system SHALL split each document into chunks and generate embeddings with a local multilingual model (Ollama).
2. THE system SHALL generate a short summary per file with the language model.
3. THE system SHALL access the index only through the `MemoryStore` interface.
4. THE system SHALL provide a SQLite implementation (FTS5 + `sqlite-vec`) and, optionally, a GLIA adapter.
5. THE system SHALL keep the whole index on the user's computer.

### R5. Natural-language search
**Story:** As a user, I want to ask "where is the poem for Rosa?" and get the path.
1. WHEN the user submits a question, THE system SHALL run hybrid search (vectors + FTS) and re-rank the results.
2. THE system SHALL interpret implicit filters (type, date range, folder, person) with the language model.
3. THE system SHALL return a written answer and a list of matches with name, path, highlighted snippet and date.
4. THE system SHALL cite only paths that exist in the index.
5. IF there are not enough matches, THEN THE system SHALL say so and not invent files.
6. WHERE the language model is unavailable, THE system SHALL offer hybrid search without a written answer (light mode).

### R6. Ghost autopsy
**Story:** As a user, I want to understand the story of my forgotten files.
1. THE system SHALL list as ghosts the documents neither opened nor modified for longer than a configurable threshold (default 3 years) and exact or near-identical duplicates (versions).
2. WHEN the user opens a ghost, THE system SHALL show an "obituary": creation date, last use, summary, people and topics mentioned, and related files.
3. THE obituary SHALL rely only on index metadata and content. IF a piece of data is unavailable, THEN THE system SHALL omit it.
4. THE system SHALL group near-identical versions and point out the most recent one.
5. THE system SHALL NOT delete, move or modify the user's files.

### R7. People and timeline
**Story:** As a user, I want to know who appears in my files and when.
1. THE system SHALL extract entities (people, places, projects) from each document with the language model and store them with a reference to the file.
2. THE system SHALL unify variants of the same name (for example "Rosa", "Rosita") only when there is enough evidence, and SHALL let the user merge or split manually.
3. WHEN the user looks up a person, THE system SHALL show the files where they appear ordered on a timeline.
4. THE system SHALL allow asking about entities in natural language ("which files talk about Rosa?").

### R8. Palette and tray
**Story:** As a user, I want to open search quickly from anywhere.
1. THE system SHALL run in the system tray with a context menu (Open, Index now, Quit).
2. WHEN the user presses the global shortcut or clicks the icon, THE system SHALL show the search window.
3. WHEN the user presses `Esc`, THE system SHALL minimize it.
4. THE system SHALL show results as cards with "Open file" and "Show folder" buttons.
5. WHEN the result is inside a container, THE system SHALL show "Show container" and offer to export the recovered file to a folder chosen by the user.
6. THE system SHALL allow keyboard navigation and opening with `Enter`.
7. IF the global shortcut is unavailable (for example Wayland), THEN THE system SHALL keep access through the tray icon and say so.

### R9. Privacy
1. THE system SHALL NOT send document content off the computer.
2. THE system SHALL limit network connections to `localhost`, except for the initial component download (R11) and the external service the user explicitly chooses (R12). Both are visible and can be skipped or disabled.
3. THE system SHALL offer "Forget everything", which removes the index, entities and resurrected texts.

### R10. Theme
1. THE system SHALL use a dark interface with a séance theme: files as apparitions, folders and media as graves.
2. THE system SHALL offer the interface in Spanish and English.

### R11. First run
**Story:** As a user, I want to open OUIJA for the first time and have it ready without installing anything by hand.
1. WHEN run for the first time, THE system SHALL ask for the language (Spanish or English) before anything else and apply it immediately.
2. THE system SHALL explain how it works with a slideshow navigable with buttons, dots and keyboard.
3. THE system SHALL detect the local engine and models already installed and SHALL NOT download them again.
4. IF the local engine is missing, THEN THE system SHALL download it from the official Ollama releases, verify its SHA-256 digest, install it in the data folder and start it, without administrator rights.
5. IF a model is missing, THEN THE system SHALL download it showing progress. THE system SHALL skip the answer model if the computer has little memory.
6. IF a download fails (no connection, no space, wrong digest), THEN THE system SHALL state the reason in plain language and allow retrying, without leaving half-written files.
7. THE system SHALL offer the user's usual folders with one click and SHALL reject any other path that does not come from the system picker.
8. THE system SHALL allow continuing without the models, in light mode.
9. THE system SHALL list the missing optional add-ons (LibreOffice, Tesseract, Poppler, 7-Zip) with the command to install them, without blocking anything.

### R12. Local or external language model
**Story:** As a user, I want to choose whether answers come from a model on my computer or a service such as Claude, OpenAI, Gemini or DeepSeek, and change it whenever I like.
1. THE system SHALL ask from the first run whether the language model will be local or external, and SHALL allow changing it in Settings.
2. THE system SHALL always compute embeddings on the computer, whichever language model is chosen.
3. WHEN the user chooses an external service, THE system SHALL follow this flow: choose provider, enter the API key, validate it, show the list of models that key can use, choose one and save.
4. THE system SHALL test the chosen model with a minimal query before saving, and SHALL NOT save anything if it fails.
5. THE system SHALL store the key encrypted with the system keystore. IF the system has no secure keystore, THEN THE system SHALL keep it in memory only and say so.
6. THE key SHALL NOT return to the UI or appear in settings, logs or error messages.
7. THE system SHALL state clearly what is sent to the service: the question and, for up to 8 candidate files, name, date, summary and a short snippet; never full paths.
8. THE system SHALL NOT send the full text of documents (people recognition, summaries) to an external service without explicit permission, off by default.
9. THE system SHALL connect only to each provider's official servers, over https.
10. IF the service rejects the key, has no balance or does not respond, THEN THE system SHALL answer in light mode and state the reason.

### R13. Changes, Gallows and Resurrection
1. THE system SHALL detect new, modified and deleted files in the folders it was given (live, plus a backup rescan) and show the latest ones in the Search view.
2. THE first indexing of a folder SHALL NOT record changes.
3. THE Gallows tab SHALL list what is in the trash (Linux and Windows) with origin, date, size and, if OUIJA knew it, what it was about.
4. THE Resurrection section SHALL restore marked items to their original place or to a chosen folder.
5. THE system SHALL NOT overwrite anything when resurrecting: if a file with the same name exists, it renames the restored one to "(resucitado)".
6. THE UI SHALL be able to act only on items from the last trash read (max 200 at a time) and show only paths resurrected in the session.

### R14. File types in searches
1. THE Settings view SHALL list the file types found in the index, with how many files of each.
2. THE user SHALL be able to leave types out of searches; by default every type is included.
3. Leaving a type out SHALL NOT delete or re-index anything, and SHALL apply also when search filters are relaxed.

### R15. MCP server
1. THE system SHALL offer a read-only MCP server over stdio with tools to find files by meaning, read recovered text, list ghosts, find people and list recent changes.
2. THE server SHALL read only files present in the index and SHALL NOT modify, move or delete anything.
3. THE server SHALL run alongside the open app without blocking it, and SHALL NOT load API keys.
4. THE Settings view SHALL show a ready-to-paste configuration with the paths of the current installation.

### R16. Languages
1. THE interface SHALL be available in Spanish, English, Portuguese, French, Japanese and Chinese, and answers SHALL be written in the chosen language.
2. THE first run SHALL preselect the system language when OUIJA speaks it, and English otherwise.

### R17. Bring to the present
1. WHEN a result was resurrected, THE user SHALL be able to save a copy in a current format: DOCX or XLSX through LibreOffice, or UTF-8 Markdown with the recovered text.
2. THE system SHALL NOT overwrite existing files nor modify the original.

### R18. Any local model
1. THE answer model SHALL be any chat model installed in Ollama or served on this computer by an OpenAI-compatible server, chosen in Settings, or the best installed one when set to Automatic.
2. THE system SHALL accept local model servers only on localhost.

### R19. The Crypt (digital inheritance)
1. THE system SHALL present a handed-over folder as a crypt: files per year, people, places, portraits, voices, resurrected files and ghosts, using only index data.
2. THE epitaph SHALL be written by the language model only from the crypt data, following the same privacy rules as summaries; without a model, a template SHALL be used.
3. THE user SHALL be able to export the crypt as a PDF grimoire, rendered in an isolated window without scripts or network.

### R20. Voices from beyond
1. THE system SHALL read MSN Messenger history, Outlook Express `.dbx` folders and `.mbox` mailboxes, marking the first two as resurrected.
2. THE date of a photo SHALL be the EXIF date when it is older than the file dates.

### R21. Autopsy report
1. THE project SHALL include a reproducible benchmark on the demo folder that measures recovered dead formats, recall@1, recall@5 and MRR, with and without semantic search.

## Verifiable properties (PBT)

- P1: every path cited in an answer exists in the index.
- P2: re-indexing an unchanged file does not alter the index.
- P3: after `forget(path)`, no search returns that path.
- P4: no extraction operation modifies the original (hash before = hash after), including media and containers.
- P5: in local mode, no operation opens connections to hosts other than `localhost`.
- P6: encoding repair is idempotent (repairing twice equals once) and does not alter text that is already correct.
- P7: the container reader never throws on corrupt files: it returns the readable entries and logged errors.
- P8: every timeline entity references at least one existing file in the index.
- P9: no host other than a provider's official one (or localhost in tests) is accepted as the destination of an external service.
- P10: resurrecting never modifies a file that already exists at the destination.

## Out of scope (v1)

Audio and video content, macOS, cloud sync, file editing, floppy and CD images (FAT, ISO), recovering files already emptied from the trash (needs raw disk access and has no guarantee), a full own parser for WordPerfect/WordStar (LibreOffice and forensic rescue are used).
