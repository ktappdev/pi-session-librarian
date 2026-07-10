# pi-session-librarian

A [pi](https://pi.dev) package that ranks, bookmarks, and organizes your coding sessions.

## Features

- **Heuristic scoring** on `session_shutdown` — every session gets a quality score 0-100.
- **LLM scoring** — `/score llm` scores the current session with the configured pi model.
- **Auto-naming** — unnamed sessions are labeled from their first user message.
- **Bookmarks** — pin sessions with `/bookmark [note]` and `/unbookmark`.
- **Rename** — `/rename <name>` sets the session display name.
- **Ranked list** — `/sessions` shows your best sessions first.
- **Filters** — `/sessions top 10`, `/sessions tagged architecture`, `/sessions bookmarked`, `/sessions chain <name>`, `/sessions search <query>`.
- **Hot files** — `/hotfiles` lists files touched across sessions.
- **Chains** — `/chain <name>` and `/chains` group related sessions.
- **Pruning** — old low-score sessions drop out of the index unless bookmarked.

## Install

```bash
pi install npm:pi-session-librarian
```

Or from git:

```bash
pi install git:github.com/ktappdev/pi-session-librarian
```

## Getting Started

Start pi and work normally. When you quit, each session is scored automatically.

```
/bookmark "fixed login bug"     → bookmark current session
/score                           → show heuristic score
/score llm                       → re-score with LLM
/sessions                        → ranked sessions for this project
/sessions top 10                 → top 10 best sessions
/sessions tagged architecture    → filter by tag
/sessions search auth            → search names, summaries, tags
/rename "auth refactor"          → set session display name
/hotfiles                        → most-touched files across all sessions
/chain my-feature                → group sessions into a named chain
/chains                          → list all chains
```

All data is stored in `.pi/session-index.json` — portable and commit-safe.

## Usage

Commands are available in any pi session:

- `/sessions` — ranked sessions for the current project
- `/sessions top 10` — top 10 sessions
- `/sessions tagged architecture` — filter by tag
- `/sessions bookmarked` — only bookmarked
- `/sessions search <query>` — search names, summaries, tags, notes
- `/bookmark [note]` — bookmark the current session
- `/unbookmark` — remove bookmark
- `/rename <name>` — set the session display name
- `/hotfiles` — most-touched files across sessions
- `/chain <name>` — add current session to a chain
- `/chains` — list chains
- `/score` or `/score heuristic` — show heuristic score
- `/score llm` — re-score with the configured pi model

## Index file

The extension stores a project-local index at `.pi/session-index.json`. This file is portable and safe to commit.

## License

MIT
