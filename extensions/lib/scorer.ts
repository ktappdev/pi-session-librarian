import type { SessionMetrics, SessionScore } from "./types.js";

export type SessionEntryLike = any;

export function computeScore(entries: SessionEntryLike[]): SessionScore {
  const metrics = computeMetrics(entries);
  const tags = new Set<string>();
  let score = 0;

  // Decisions
  score += metrics.decisions * 15;
  if (metrics.decisions > 0) tags.add("decisions");

  // Bugfixes
  score += metrics.bugfixes * 12;
  if (metrics.bugfixes > 0) tags.add("bugfix");

  // Architecture
  score += metrics.architecture * 10;
  if (metrics.architecture > 0) tags.add("architecture");

  // Files touched
  score += metrics.filesChanged * 2;
  if (metrics.filesChanged > 0) tags.add("files");

  // Tool calls
  score += metrics.toolCalls * 0.5;

  // Duration
  score += metrics.durationMinutes * 0.1;

  // Messages
  score += metrics.messageCount * 0.2;

  // Compaction bonus
  const hasCompaction = entries.some((e) => e.type === "compaction");
  if (hasCompaction) score += 5;

  // Branching penalty
  score -= metrics.branchingFactor * 5;

  // Short session penalty
  if (metrics.durationMinutes > 0 && metrics.durationMinutes < 5) score -= 20;

  // Tag bonuses for activity signals
  if (hasCompaction) tags.add("substantial");
  if (metrics.branchingFactor > 0) tags.add("exploration");

  const hotFiles = Array.from(extractFiles(entries)).map((f) => f);

  // Detect creation/refactoring/testing
  if (detectedCreation(entries, hotFiles)) tags.add("creation");
  if (detectedRefactoring(entries)) tags.add("refactoring");
  if (detectedTesting(entries)) tags.add("testing");

  score = Math.max(0, Math.min(100, Math.round(score)));

  const { autoName, summary } = deriveNameAndSummary(entries, score);

  return {
    score,
    tags: Array.from(tags).slice(0, 5),
    bookmark: false,
    metrics,
    hotFiles: hotFiles.slice(0, 20),
    scoredAt: new Date().toISOString(),
    autoName,
    summary,
  };
}

function computeMetrics(entries: SessionEntryLike[]): SessionMetrics {
  const metrics: SessionMetrics = {
    decisions: 0,
    bugfixes: 0,
    architecture: 0,
    filesChanged: 0,
    toolCalls: 0,
    messageCount: 0,
    durationMinutes: 0,
    branchingFactor: 0,
  };

  const files = new Set<string>();
  const firstTs = entries[0]?.timestamp ? Date.parse(entries[0].timestamp as any) : 0;
  const lastTs = entries[entries.length - 1]?.timestamp ? Date.parse(entries[entries.length - 1].timestamp as any) : 0;
  if (firstTs && lastTs) {
    metrics.durationMinutes = Math.max(0, Math.round((lastTs - firstTs) / 60000));
  }

  for (const entry of entries) {
    if (entry.type === "message") {
      const msg = (entry as any).message;
      metrics.messageCount += 1;
      if (msg?.role === "assistant" && Array.isArray(msg.content)) {
        const toolCalls = msg.content.filter((c: any) => c.type === "toolCall");
        metrics.toolCalls += toolCalls.length;
      }
      if (msg?.role === "assistant" && typeof msg.content === "string") {
        const lower = msg.content.toLowerCase();
        if (lower.includes("fix") || lower.includes("bug") || lower.includes("resolved")) {
          metrics.bugfixes += 1;
        }
      }
      if (msg?.role === "user" && typeof msg.content === "string") {
        // user intent signals
      }
    }

    if (entry.type === "custom" || entry.type === "custom_message") {
      const custom = (entry as any).customType;
      const data = (entry as any).data ?? {};
      if (custom === "mem_save" || custom === "decision" || data?.type === "decision") {
        metrics.decisions += 1;
      }
      if (custom === "bugfix" || data?.type === "bugfix") {
        metrics.bugfixes += 1;
      }
      if (custom === "architecture" || data?.type === "architecture") {
        metrics.architecture += 1;
      }
    }

    if (entry.type === "branch_summary") {
      metrics.branchingFactor += 1;
    }
  }

  for (const file of extractFiles(entries)) {
    files.add(file);
  }
  metrics.filesChanged = files.size;

  return metrics;
}

export function extractFiles(entries: SessionEntryLike[]): Set<string> {
  const files = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = (entry as any).message;
    if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;

    for (const block of msg.content) {
      if (block.type !== "toolCall") continue;
      const args = block.arguments || {};
      if (block.name === "read" || block.name === "write" || block.name === "edit") {
        if (args?.path) files.add(args.path);
      } else if (block.name === "bash" && args?.command) {
        const cmd = args.command as string;
        const matches = cmd.match(/(?:cat|less|head|tail|vim|nano|code)\s+([A-Za-z0-9_\-/\.]+)/g);
        if (matches) {
          for (const m of matches) {
            const parts = m.split(/\s+/);
            if (parts[1]) files.add(parts[1]);
          }
        }
      }
    }
  }
  return files;
}

function detectedCreation(entries: SessionEntryLike[], hotFiles: string[]): boolean {
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = (entry as any).message;
    if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === "toolCall" && block.name === "write") {
        const args = block.arguments || {};
        if (args?.path) {
          // naive creation signal: write without prior read to same path in this session
          return true;
        }
      }
    }
  }
  return false;
}

function detectedRefactoring(entries: SessionEntryLike[]): boolean {
  let editCount = 0;
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = (entry as any).message;
    if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === "toolCall" && block.name === "edit") {
        editCount += 1;
      }
    }
  }
  return editCount >= 3;
}

function detectedTesting(entries: SessionEntryLike[]): boolean {
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = (entry as any).message;
    if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === "toolCall" && block.name === "bash") {
        const cmd = (block.arguments?.command || "") as string;
        if (/(?:test|jest|vitest|mocha|pytest|cargo test|go test|npm test|bun test)/i.test(cmd)) {
          return true;
        }
      }
    }
  }
  return false;
}

function deriveNameAndSummary(entries: SessionEntryLike[], score: number): { autoName?: string; summary?: string } {
  const firstUser = entries.find((e) => {
    if (e.type !== "message") return false;
    const msg = (e as any).message;
    return msg?.role === "user";
  });
  const lastAssistant = [...entries].reverse().find((e) => {
    if (e.type !== "message") return false;
    const msg = (e as any).message;
    return msg?.role === "assistant";
  });

  const firstText = extractText((firstUser as any)?.message);
  const lastText = extractText((lastAssistant as any)?.message);

  let autoName: string | undefined;
  if (firstText && firstText.length > 3 && !/^\s*(hi|hello|hey|help)\s*$/i.test(firstText)) {
    autoName = firstText.slice(0, 50).trim();
    // remove trailing punctuation
    autoName = autoName.replace(/[\?\!\.,;:]+$/, "");
    if (autoName.length > 50) autoName = autoName.slice(0, 50) + "…";
  }

  let summary: string | undefined;
  if (lastText) {
    const firstSentence = lastText.split(/[\.\!\?]\s+/)[0];
    if (firstSentence && firstSentence.length > 5) {
      summary = firstSentence.slice(0, 120) + (firstSentence.length > 120 ? "…" : "");
    }
  }
  if (!summary && autoName) {
    summary = `Score ${score}: ${autoName}`;
  }

  return { autoName, summary };
}

function extractText(msg: any): string {
  if (!msg) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join(" ");
  }
  return "";
}
