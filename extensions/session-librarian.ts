import { CONFIG_DIR_NAME, type ExtensionAPI, type ExtensionCommandContext, type SessionManager } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { computeScore } from "./lib/scorer.js";
import { getIndexPath, loadIndex, pruneIndex, updateSession } from "./lib/index.js";
import type { SessionIndex, SessionScore } from "./lib/types.js";

export default function (pi: ExtensionAPI) {
  // On shutdown, score the session and write index
  pi.on("session_shutdown", async (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    const header = ctx.sessionManager.getHeader();
    const sessionId = ctx.sessionManager.getSessionId();
    if (!header?.cwd || !sessionId) return;

    const score = computeScore(entries as any);
    const existing = loadIndex(header.cwd).sessions[sessionId];

    // Preserve bookmark/note if already set
    const merged: SessionScore = {
      ...score,
      bookmark: existing?.bookmark ?? false,
      note: existing?.note,
    };

    // Auto-name if none exists
    const currentName = ctx.sessionManager.getSessionName?.() ?? (ctx as any).pi?.getSessionName?.();
    if (!currentName && merged.autoName && merged.score > 10) {
      try {
        pi.setSessionName(merged.autoName);
        merged.sessionName = merged.autoName;
      } catch {}
    }

    updateSession(header.cwd, sessionId, merged);
    pruneIndex(header.cwd);
  });

  // --- Commands ---

  pi.registerCommand("sessions", {
    description: "Show ranked sessions for current project",
    handler: async (args, ctx) => {
      const index = loadIndex(ctx.cwd);
      const sessions = Object.entries(index.sessions)
        .map(([id, s]) => ({ id, ...s }))
        .sort((a, b) => b.score - a.score);

      const filter = parseFilter(args);
      const filtered = applyFilter(sessions, filter, index);

      if (filtered.length === 0) {
        ctx.ui.notify("No sessions found.", "info");
        return;
      }

      const lines = [`Sessions for ${ctx.cwd} (ranked by score):`, ""];
      for (let i = 0; i < filtered.length; i++) {
        const s = filtered[i];
        const date = new Date(s.scoredAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        const mark = s.bookmark ? " [bookmarked]" : "";
        const title = s.sessionName || s.autoName || s.summary || "Untitled session";
        lines.push(`  #${i + 1} ★ ${s.score}${mark} ${date} — ${title}`);
        if (s.tags.length > 0) {
          lines.push(`      Tags: ${s.tags.join(", ")}`);
        }
        lines.push(`      ${describeMetrics(s)}`);
        lines.push("");
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("bookmark", {
    description: "Bookmark current session with optional note",
    handler: async (args, ctx) => {
      const sessionId = ctx.sessionManager.getSessionId();
      const cwd = ctx.cwd;
      if (!sessionId) {
        ctx.ui.notify("No session ID found.", "error");
        return;
      }
      const note = args?.trim() ? args.trim() : undefined;
      const updated = updateSession(cwd, sessionId, { bookmark: true, note });
      const s = updated.sessions[sessionId];
      ctx.ui.notify(`Session bookmarked${note ? ` with note "${note}"` : ""}. Score: ${s.score}.`, "info");
    },
  });

  pi.registerCommand("unbookmark", {
    description: "Remove bookmark from current session",
    handler: async (_args, ctx) => {
      const sessionId = ctx.sessionManager.getSessionId();
      const cwd = ctx.cwd;
      if (!sessionId) {
        ctx.ui.notify("No session ID found.", "error");
        return;
      }
      updateSession(cwd, sessionId, { bookmark: false, note: undefined });
      ctx.ui.notify("Bookmark removed.", "info");
    },
  });

  pi.registerCommand("hotfiles", {
    description: "Show most-touched files across all sessions",
    handler: async (_args, ctx) => {
      const index = loadIndex(ctx.cwd);
      const counts: Record<string, number> = {};
      for (const s of Object.values(index.sessions)) {
        for (const f of s.hotFiles ?? []) {
          counts[f] = (counts[f] || 0) + 1;
        }
      }
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      if (sorted.length === 0) {
        ctx.ui.notify("No hot files yet.", "info");
        return;
      }
      const lines = ["Hot files:", ""];
      for (let i = 0; i < sorted.length; i++) {
        lines.push(`  ${i + 1}. ${sorted[i][0]} — touched in ${sorted[i][1]} sessions`);
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("score", {
    description: "Show current heuristic score for this session",
    handler: async (_args, ctx) => {
      const entries = ctx.sessionManager.getEntries();
      const s = computeScore(entries as any);
      ctx.ui.notify(`Current session score: ${s.score}\nTags: ${s.tags.join(", ") || "none"}\n${describeMetrics(s)}`, "info");
    },
  });

  pi.registerCommand("chain", {
    description: "Add current session to a named chain",
    handler: async (args, ctx) => {
      const name = args?.trim();
      if (!name) {
        ctx.ui.notify("Usage: /chain <name>", "error");
        return;
      }
      const sessionId = ctx.sessionManager.getSessionId();
      const cwd = ctx.cwd;
      if (!sessionId) {
        ctx.ui.notify("No session ID found.", "error");
        return;
      }
      const index = loadIndex(cwd);
      index.chains[name] = index.chains[name] ?? {
        name,
        sessionIds: [],
        createdAt: new Date().toISOString(),
      };
      if (!index.chains[name].sessionIds.includes(sessionId)) {
        index.chains[name].sessionIds.push(sessionId);
      }
      updateSession(cwd, sessionId, {}); // ensure index write
      ctx.ui.notify(`Added to chain "${name}" (${index.chains[name].sessionIds.length} sessions).`, "info");
    },
  });

  pi.registerCommand("chains", {
    description: "List all session chains for current project",
    handler: async (_args, ctx) => {
      const index = loadIndex(ctx.cwd);
      const names = Object.keys(index.chains);
      if (names.length === 0) {
        ctx.ui.notify("No chains yet.", "info");
        return;
      }
      const lines = ["Chains:", ""];
      for (const name of names) {
        const c = index.chains[name];
        lines.push(`  • ${name} — ${c.sessionIds.length} sessions`);
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}

function describeMetrics(s: SessionScore): string {
  const m = s.metrics;
  const parts: string[] = [];
  if (m.decisions) parts.push(`${m.decisions} decision${m.decisions === 1 ? "" : "s"}`);
  if (m.bugfixes) parts.push(`${m.bugfixes} bugfix`);
  if (m.architecture) parts.push(`${m.architecture} architecture`);
  if (m.filesChanged) parts.push(`${m.filesChanged} file${m.filesChanged === 1 ? "" : "s"}`);
  if (m.durationMinutes) parts.push(`${m.durationMinutes} min`);
  if (parts.length === 0) parts.push("light session");
  return parts.join(", ");
}

interface Filter {
  kind?: "top" | "tag" | "bookmarked" | "chain" | "search" | "all";
  value?: string;
  limit?: number;
}

function parseFilter(args: string): Filter {
  const trimmed = (args ?? "").trim();
  if (!trimmed) return { kind: "all" };

  const tokens = trimmed.split(/\s+/);
  if (tokens[0] === "top" && tokens[1]) {
    return { kind: "top", limit: parseInt(tokens[1], 10) || 10 };
  }
  if (tokens[0] === "tagged" && tokens[1]) {
    return { kind: "tag", value: tokens[1] };
  }
  if (tokens[0] === "bookmarked") {
    return { kind: "bookmarked" };
  }
  if (tokens[0] === "chain" && tokens[1]) {
    return { kind: "chain", value: tokens[1] };
  }
  if (tokens[0] === "search" && tokens[1]) {
    return { kind: "search", value: tokens.slice(1).join(" ") };
  }
  return { kind: "search", value: trimmed };
}

function applyFilter(
  sessions: Array<SessionScore & { id: string }>,
  filter: Filter,
  index: SessionIndex,
): Array<SessionScore & { id: string }> {
  let out = sessions;
  switch (filter.kind) {
    case "top":
      return out.slice(0, filter.limit);
    case "tag":
      return out.filter((s) => s.tags.includes(filter.value ?? ""));
    case "bookmarked":
      return out.filter((s) => s.bookmark);
    case "chain": {
      const chain = index.chains[filter.value ?? ""];
      if (!chain) return [];
      const ids = new Set(chain.sessionIds);
      return out.filter((s) => ids.has(s.id)).sort((a, b) => {
        const ai = chain.sessionIds.indexOf(a.id);
        const bi = chain.sessionIds.indexOf(b.id);
        return ai - bi;
      });
    }
    case "search":
      return out.filter((s) => {
        const q = filter.value?.toLowerCase() ?? "";
        return (
          (s.sessionName?.toLowerCase().includes(q) || false) ||
          (s.autoName?.toLowerCase().includes(q) || false) ||
          (s.summary?.toLowerCase().includes(q) || false) ||
          s.tags.some((t) => t.toLowerCase().includes(q))
        );
      });
    default:
      return out;
  }
}
