# Product: OUIJA

Desktop app (Windows and Linux, Electron) for personal digital archaeology: it resurrects files in old or damaged formats, makes them searchable by meaning, tells the story of forgotten files and reconstructs who appears in your past. Kiroween Hackathon 2026 project, Resurrection category. It must be original: do not copy code from other projects.

## Principles

- Local by default. Documents never leave the computer. Explicit, optional exceptions: the initial download of components and an external AI service that the user chooses with their own key (it only receives the question and short snippets; full text only with permission).
- API keys never return to the UI, are never stored in clear text and are never logged.
- Never modify, move or delete the user's files. Container readers are read-only.
- Answers cite only paths that exist in the index. If nothing matches, say so.
- Obituaries and timelines use only data present in the index. Do not invent facts.
- Recovered text always shows its confidence level.
- GLIA is only an optional adapter behind `MemoryStore`. The product does not depend on it.
- v1 scope: TXT, MD, PDF, DOCX, RTF; DOC/WPD/WPS via LibreOffice; forensic rescue for the rest; ZIP containers (and 7z/RAR/ARJ/LZH with optional `7z`). No floppy or CD images.

## UI tone

Mysterious but clear and useful. Séance metaphor (files as apparitions, media as graves, obituaries, the Gallows for the trash). Clarity always wins over effect.
