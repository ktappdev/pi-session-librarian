import {
  CONFIG_DIR_NAME,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type SessionManager,
} from "@earendil-works/pi-coding-agent";
import { complete, type Model } from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { computeScore } from "./lib/scorer.js";
import { serializeForLlm } from "./lib/llm.js";
import { getIndexPath, loadIndex, pruneIndex, saveIndex, updateSession } from "./lib/index.js";
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
      sessionName: existing?.sessionName,
    };

    // Auto-name if none exists and session name isn't already set
    const currentName = ctx.sessionManager.getSessionName?.();
    if (!currentName && !merged.sessionName && merged.autoName && merged.score > 10) {
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
    getArgumentCompletions: (prefix) => {
      const candidates = [
        { value: "top ", label: "top N" },
        { value: "tagged ", label: "tagged <tag>" },
        { value: "bookmarked", label: "bookmarked" },
        { value: "chain ", label: "chain <name>" },
        { value: "search ", label: "search <query>" },
      ];
      return candidates.filter((c) => c.value.startsWith(prefix));
    },
    handler: async (args, ctx) => {
      const index = loadIndex(ctx.cwd);
      const sessions = Object.entries(index.sessions)
        .map(([id, s]) => ({ id, ...s }))
        .sort((a, b) => b.score - a.score);

      const filter = parseFilter(args);
      const filtered = applyFilter(sessions, filter, index);

      if (filtered.length === 0) {
        const q = filter.kind === "search" ? ` matching "${filter.value}"` : "";
        ctx.ui.notify(`No sessions found${q}.`, "info");
        return;
      }

      const lines = [`Sessions for ${ctx.cwd} (ranked by score):`, ""];
      for (let i = 0; i < filtered.length; i++) {
        const s = filtered[i];
        const date = new Date(s.scoredAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        const mark = s.bookmark ? " [bookmarked]" : "";
        const title = s.sessionName || s.autoName || s.summary || "Untitled session";
        const shortId = s.id.slice(0, 8);
        lines.push(`  #${i + 1} ★ ${s.score.toString().padStart(2)}${mark} ${date} — ${title.slice(0, 50)}`);
        lines.push(`      id:${shortId}  ${describeMetrics(s)}`);
        if (s.tags.length > 0) {
          lines.push(`      Tags: ${s.tags.join(", ")}`);
        }
        if (s.note) {
          lines.push(`      Note: ${s.note.slice(0, 80)}${s.note.length > 80 ? "…" : ""}`);
        }
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
    description: "Show or recompute LLM score for this session",
    getArgumentCompletions: (prefix) => {
      const candidates = [
        { value: "heuristic", label: "heuristic" },
        { value: "llm", label: "llm" },
        { value: "rescore", label: "rescore" },
      ];
      return candidates.filter((c) => c.value.startsWith(prefix));
    },
    handler: async (args, ctx) => {
      const mode = (args ?? "").trim().toLowerCase();
      const entries = ctx.sessionManager.getEntries();

      if (mode === "heuristic" || !mode) {
        const s = computeScore(entries as any);
        ctx.ui.notify(`Heuristic score: ${s.score}\nTags: ${s.tags.join(", ") || "none"}\n${describeMetrics(s)}`, "info");
        return;
      }

      if (mode === "llm" || mode === "rescore") {
        const model = await pickModel(ctx);
        if (!model) {
          ctx.ui.notify("No model available with an API key. Set one in pi settings or environment.", "error");
          return;
        }

        ctx.ui.notify("LLM scoring session…", "info");
        try {
          const scored = await llmScore(entries, model, ctx.modelRegistry, ctx.signal);
          const updated = updateSession(ctx.cwd, ctx.sessionManager.getSessionId()!, {
            ...scored,
            scoredAt: new Date().toISOString(),
          });
          const s = updated.sessions[ctx.sessionManager.getSessionId()!];
          ctx.ui.notify(`LLM score: ${s.score}\nTags: ${s.tags.join(", ") || "none"}\nSummary: ${s.summary || "none"}`, "info");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          ctx.ui.notify(`LLM scoring failed: ${msg}`, "error");
        }
        return;
      }

      ctx.ui.notify("Usage: /score [heuristic|llm|rescore]", "error");
    },
  });

  pi.registerCommand("chain", {
    description: "Add current session to a named chain",
    getArgumentCompletions: (prefix) => {
      const index = loadIndex(process.cwd());
      const chains = Object.keys(index.chains);
      return chains
        .filter((c) => c.startsWith(prefix))
        .map((c) => ({ value: c, label: `${c} (${index.chains[c].sessionIds.length} sessions)` }));
    },
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
      saveIndex(cwd, index);
      ctx.ui.notify(`Added to chain "${name}" (${index.chains[name].sessionIds.length} sessions).`, "info");
    },
  });

  pi.registerCommand("rename", {
    description: "Rename the current session",
    handler: async (args, ctx) => {
      const name = args?.trim();
      if (!name) {
        ctx.ui.notify("Usage: /rename <name>", "error");
        return;
      }
      const sessionId = ctx.sessionManager.getSessionId();
      const cwd = ctx.cwd;
      if (!sessionId) {
        ctx.ui.notify("No session ID found.", "error");
        return;
      }
      try {
        pi.setSessionName(name);
      } catch {}
      updateSession(cwd, sessionId, { sessionName: name, autoName: name });
      ctx.ui.notify(`Session renamed to "${name}".`, "info");
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
          (s.note?.toLowerCase().includes(q) || false) ||
          s.tags.some((t) => t.toLowerCase().includes(q))
        );
      });
    default:
      return out;
  }
}

async function pickModel(ctx: ExtensionCommandContext): Promise<Model<any> | undefined> {
  if (ctx.model) {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (auth.ok && auth.apiKey) return ctx.model;
  }
  const available = await ctx.modelRegistry.getAvailable();
  if (available.length === 0) return undefined;
  // Prefer cheaper/faster models for scoring
  const preferred = available.find((m) => m.id.includes("flash") || m.id.includes("mini"));
  return preferred ?? available[0];
}

async function llmScore(
  entries: any[],
  model: Model<any>,
  modelRegistry: any,
  signal?: AbortSignal,
): Promise<Partial<SessionScore>> {
  const auth = await modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) {
    throw new Error(`No API key for ${model.provider}/${model.id}`);
  }

  const serialized = serializeForLlm(entries);
  const prompt = `Analyze this coding session and respond ONLY with a JSON object in this exact shape (no markdown, no code fences):
{
  "score": <number 0-100>,
  "tags": ["<tag>", "<tag>", ...],
  "summary": "<one-line summary>",
  "accomplishments": ["<bullet>", ...],
  "largerEffort": "<chain name or null>"
}

Rubric:
- 0-20: trivial / exploratory / throwaway
- 20-40: light work, few files, short duration
- 40-60: moderate session with clear progress
- 60-80: substantial work, decisions, multiple files
- 80-100: exceptional, architectural, deeply productive

Rules:
- score: overall quality and substance using the rubric
- tags: max 5, lowercase, concrete categories like "architecture", "bugfix", "refactoring", "creation", "testing", "decisions"
- summary: one line, max 120 chars
- accomplishments: list of concrete things done
- largerEffort: name of the chain if this is part of one, else null

<session_entries>
${serialized}
</session_entries>`;

  const context: Context = {
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
  };

  const response = await complete(
    model,
    context,
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      maxTokens: 2000,
      signal,
    },
  );

  const text = response.content
    .filter((c) => c.type === "text")
    .map((c) => (c as any).text)
    .join("\n")
    .trim();

  const parsed = parseLlmJson(text);
  const heuristics = computeScore(entries);

  if (!isLlmScore(parsed)) {
    throw new Error("LLM returned invalid score format");
  }

  return {
    score: clamp(parsed.score, 0, 100),
    tags: parsed.tags?.slice(0, 5) ?? heuristics.tags,
    summary: parsed.summary ?? heuristics.summary,
    metrics: heuristics.metrics,
    hotFiles: heuristics.hotFiles,
    autoName: heuristics.autoName,
  };
}

interface LlmScore {
  score: number;
  tags?: string[];
  summary?: string;
  accomplishments?: string[];
  largerEffort?: string | null;
}

function isLlmScore(value: unknown): value is LlmScore {
  if (!value || typeof value !== "object") return false;
  const v = value as any;
  if (typeof v.score !== "number") return false;
  if (v.tags && !Array.isArray(v.tags)) return false;
  return true;
}



function parseLlmJson(text: string): any {
  const cleaned = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract first JSON object
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    return {};
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}
