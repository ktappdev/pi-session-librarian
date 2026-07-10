# Changelog

## 0.2.1

- Cap LLM scoring context to ~20KB, keep recent tail, prioritize compaction/branch summaries.
- Remove unused `typebox` peer dependency.
- Fix `/chain` saving bug (chain entries were silently lost).
- Add `/rename` command.
- Add session IDs to `/sessions` output.
- Recalibrate heuristic scoring weights with diminishing returns and caps.
- Harden LLM score parsing with validation and rubric.
- Improve search fallback message in `/sessions`.

## 0.2.0

- LLM scoring via `/score llm` using the currently configured pi model.
- Command argument autocomplete for `/sessions` and `/score`.
- Better `/sessions` output formatting with note display.
- Preserve manually set session names on shutdown.
- Bug fixes around `hasUI` and `sessionName`.

## 0.1.0

- Initial release.
- Heuristic scoring, auto-naming, `.pi/session-index.json`.
- `/sessions`, `/bookmark`, `/unbookmark`, `/hotfiles`, `/chain`, `/chains`, `/score`.
