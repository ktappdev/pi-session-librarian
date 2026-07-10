import { truncateTail, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";

const LLM_MAX_BYTES = 20_000;
const MESSAGE_SNIPPET = 200;

export function serializeForLlm(entries: any[], maxBytes = LLM_MAX_BYTES): string {
  const snippets: string[] = [];

  // Prioritize structural entries and compact summaries first
  for (const entry of entries) {
    if (entry.type === "session") {
      snippets.push(`[session] cwd: ${entry.cwd} id: ${entry.id}`);
    } else if (entry.type === "session_info") {
      snippets.push(`[session_name] ${entry.name}`);
    } else if (entry.type === "compaction") {
      snippets.push(`[compaction] ${summarize(entry.summary, 400)}`);
    } else if (entry.type === "branch_summary") {
      snippets.push(`[branch_summary] ${summarize(entry.summary, 400)}`);
    } else if (entry.type === "label") {
      snippets.push(`[label] ${entry.label}`);
    } else if (entry.type === "custom") {
      snippets.push(`[custom ${entry.customType}] ${summarize(JSON.stringify(entry.data), 300)}`);
    } else if (entry.type === "custom_message") {
      snippets.push(`[custom_message ${entry.customType}] ${summarize(entry.content, 200)}`);
    } else if (entry.type === "model_change") {
      snippets.push(`[model_change] ${entry.provider}/${entry.modelId}`);
    } else if (entry.type === "thinking_level_change") {
      snippets.push(`[thinking_level] ${entry.thinkingLevel}`);
    }
  }

  // Then messages, but keep them short and skip noisy tool result bodies
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (!msg) continue;

    if (msg.role === "user") {
      const text = extractText(msg, MESSAGE_SNIPPET);
      if (text) snippets.push(`[user] ${text}`);
    } else if (msg.role === "assistant") {
      const text = extractText(msg, MESSAGE_SNIPPET);
      const toolCalls = (msg.content || [])
        .filter((c: any) => c.type === "toolCall")
        .map((c: any) => c.name)
        .join(", ");
      if (toolCalls) {
        snippets.push(`[assistant] ${text}${text ? " " : ""}[tools: ${toolCalls}]`);
      } else if (text) {
        snippets.push(`[assistant] ${text}`);
      }
    } else if (msg.role === "toolResult") {
      // Skip most tool result bodies; include only file-related hits
      if (["read", "write", "edit"].includes(msg.toolName)) {
        snippets.push(`[toolResult ${msg.toolName}] ${extractText(msg, 100)}`);
      } else {
        snippets.push(`[toolResult ${msg.toolName}]`);
      }
    } else if (msg.role === "bashExecution") {
      snippets.push(`[bash] ${summarize(msg.command, 120)}`);
    }
  }

  const joined = snippets.join("\n");
  const trunc = truncateTail(joined, { maxLines: DEFAULT_MAX_LINES, maxBytes: maxBytes });
  return trunc.content;
}

function summarize(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

function extractText(msg: any, max: number): string {
  if (!msg) return "";
  if (typeof msg.content === "string") return summarize(msg.content, max);
  if (Array.isArray(msg.content)) {
    const text = msg.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join(" ")
      .trim();
    return summarize(text, max);
  }
  return "";
}
