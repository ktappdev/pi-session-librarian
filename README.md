# pi-session-librarian

A [pi](https://pi.dev) package that ranks, bookmarks, and organizes your coding sessions.

## Features

- **Heuristic scoring** on `session_shutdown` — every session gets a quality score 0-100.
- **Auto-naming** — unnamed sessions are labeled from their first user message.
- **Bookmarks** — pin sessions with `/bookmark [note]` and `/unbookmark`.
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

## Usage

Commands are available in any pi session:

- `/sessions` — ranked sessions for the current project
- `/bookmark [note]` — bookmark the current session
- `/unbookmark` — remove bookmark
- `/hotfiles` — most-touched files across sessions
- `/chain <name>` — add current session to a chain
- `/chains` — list chains
- `/score` — show current session's heuristic score

## Index file

The extension stores a project-local index at `.pi/session-index.json`. This file is portable and safe to commit.

## License

MIT
