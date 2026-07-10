export interface SessionMetrics {
  decisions: number;
  bugfixes: number;
  architecture: number;
  filesChanged: number;
  toolCalls: number;
  messageCount: number;
  durationMinutes: number;
  branchingFactor: number;
}

export interface SessionScore {
  score: number;
  tags: string[];
  bookmark: boolean;
  note?: string;
  autoName?: string;
  summary?: string;
  metrics: SessionMetrics;
  hotFiles: string[];
  scoredAt: string;
  sessionName?: string;
}

export interface SessionChain {
  name: string;
  sessionIds: string[];
  createdAt: string;
}

export interface SessionIndex {
  version: number;
  sessions: Record<string, SessionScore>;
  chains: Record<string, SessionChain>;
}
