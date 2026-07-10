import { readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SessionIndex, SessionScore } from "./types.js";

const INDEX_FILE = "session-index.json";

export function getIndexPath(cwd: string): string {
  // Use .pi dir; for pi packages CONFIG_DIR_NAME is exported, but we avoid importing runtime here.
  return join(cwd, ".pi", INDEX_FILE);
}

export function loadIndex(cwd: string): SessionIndex {
  const path = getIndexPath(cwd);
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as SessionIndex;
    if (parsed?.version === 1 && parsed?.sessions && parsed?.chains) {
      return parsed;
    }
  } catch {}
  return { version: 1, sessions: {}, chains: {} };
}

export function saveIndex(cwd: string, index: SessionIndex): void {
  const path = getIndexPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(index, null, 2));
  renameSync(tmp, path);
}

export function updateSession(cwd: string, sessionId: string, data: Partial<SessionScore>): SessionIndex {
  const index = loadIndex(cwd);
  const existing = index.sessions[sessionId] ?? {
    score: 0,
    tags: [],
    bookmark: false,
    metrics: {
      decisions: 0,
      bugfixes: 0,
      architecture: 0,
      filesChanged: 0,
      toolCalls: 0,
      messageCount: 0,
      durationMinutes: 0,
      branchingFactor: 0,
    },
    hotFiles: [],
    scoredAt: new Date().toISOString(),
  };
  index.sessions[sessionId] = { ...existing, ...data, scoredAt: new Date().toISOString() } as SessionScore;
  saveIndex(cwd, index);
  return index;
}

export function pruneIndex(cwd: string, days = 90, scoreThreshold = 30): SessionIndex {
  const index = loadIndex(cwd);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  for (const [id, session] of Object.entries(index.sessions)) {
    const scored = new Date(session.scoredAt).getTime();
    if (scored < cutoff && session.score < scoreThreshold && !session.bookmark) {
      delete index.sessions[id];
    }
  }
  // Clean chains pointing to deleted sessions
  for (const chain of Object.values(index.chains)) {
    chain.sessionIds = chain.sessionIds.filter((id) => id in index.sessions);
  }
  saveIndex(cwd, index);
  return index;
}
