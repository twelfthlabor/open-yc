// Shared types for the server, the core logic and the web app.

export type AgentKind = "claude-code" | "codex";

// One normalized event from a transcript line or a hook call. Parsers turn each agent's own
// format into these, and everything downstream (posts, usage, narration) reads only these.
export type AgentEvent =
  | { kind: "session"; sessionId: string; agent: AgentKind; ts: string; cwd?: string; model?: string; branch?: string; title?: string }
  | { kind: "prompt"; sessionId: string; ts: string; text: string }
  | { kind: "text"; sessionId: string; ts: string; text: string; final: boolean }
  | { kind: "tool"; sessionId: string; ts: string; id: string; name: string; summary: string; files: string[]; mcpServer?: string; skill?: string; command?: string; inputChars: number }
  | { kind: "tool_result"; sessionId: string; ts: string; id: string; isError: boolean; excerpt: string; chars: number; sample?: string }
  | { kind: "usage"; sessionId: string; ts: string; key: string; model: string; provider: Provider; input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number; cumulative?: boolean }
  | { kind: "turn_end"; sessionId: string; ts: string; text?: string }
  | { kind: "attention"; sessionId: string; ts: string; reason: "approval" | "waiting" | "question"; text: string };

export type Provider = "anthropic" | "openai" | "google" | "other";

export type PostKind =
  | "joined" // a session appeared
  | "progress" // batched digest of tool calls, edits and narration
  | "decision"
  | "assumption"
  | "blocker" // needs approval, waiting on the user, or stuck
  | "error" // failing tests or a failed command
  | "done" // turn finished
  | "user"; // a reply the user typed

export interface Post {
  id: string;
  sessionId: string;
  ts: string;
  kind: PostKind;
  text: string;
  urgent: boolean;
  // user posts only: when the reply reached the agent, and through which hook
  delivery?: { state: "queued" | "delivered"; at?: string; via?: string };
}

export interface SessionInfo {
  id: string;
  agent: AgentKind;
  name: string; // stable pseudonym
  color: string;
  cwd: string;
  project: string; // last path segment of cwd
  branch?: string;
  title?: string;
  model?: string;
  startedAt: string;
  lastActivity: string;
  status: "working" | "blocked" | "idle";
  firstPrompt?: string;
  hooked: boolean; // the backchannel hook has reported in for this session
  introduced: boolean; // the hook told the agent about backchannel at SessionStart
  tokens: number;
  costUsd: number | null; // null when the model is not in the price table
}

export interface UsageRow {
  key: string;
  label: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  costUsd: number;
  unpriced: number; // tokens from models without a price
  calls?: number;
  estimated?: boolean;
}

export interface UsageReport {
  since: string;
  totals: UsageRow;
  byProvider: UsageRow[];
  byModel: UsageRow[];
  bySession: UsageRow[];
  byDay: UsageRow[];
  byMcp: UsageRow[]; // estimated: chars of tool inputs and results / 4
  bySkill: UsageRow[]; // estimated the same way
  pricesAsOf: string;
}

export interface Snapshot {
  sessions: SessionInfo[];
  posts: Post[];
  demo?: boolean;
}

// Server-sent events from /api/stream.
export type StreamMessage =
  | { type: "snapshot"; data: Snapshot }
  | { type: "post"; data: Post }
  | { type: "post_update"; data: Post }
  | { type: "session"; data: SessionInfo };
