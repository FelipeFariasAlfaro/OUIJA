# UI style

- Dark mode by default, near-black background with one accent color (spectral violet).
- Frameless-look window with rounded corners.
- Result cards: name, path, highlighted snippet, date, "Open" and "Show folder" buttons.
- Subtle animation with Framer Motion: results appear like "apparitions" (fade + slight float). Duration under 300 ms.
- Keyboard first: arrows to navigate, Enter to open, Esc to minimize.
- Respect `prefers-reduced-motion`.
- All text goes through i18n (ES/EN).
