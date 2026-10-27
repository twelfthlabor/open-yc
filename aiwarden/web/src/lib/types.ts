// Shapes of the collector JSON (server.py aggregate, report.build_report). Every string here came from a
// device report, so it is untrusted: render it as text only, never as HTML.
export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface Tokens {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cost_usd?: number;
  sessions?: number;
  tool_calls?: number;
  messages?: number;
}

export interface Finding {
  rule: string;
  severity: string;
  title: string;
  detail?: string;
  location?: string;
  subject?: string;
  hostname?: string;
  device_id?: string;
}

export interface Summary {
  apps?: number;
  running?: number;
  mcp_servers?: number;
  remote_mcp_servers?: number;
  plaintext_secrets?: number;
  findings?: Partial<Record<Severity, number>>;
  tokens?: number;
  cost_usd?: number;
  risky_events?: number;
  guard_blocks?: number;
  guard_installed?: boolean;
}

export interface DeviceRow {
  id: string;
  hostname: string;
  user: string;
  os: string;
  generated_at?: string;
  received_at?: string;
  summary: Summary;
}

export interface GuardEvent {
  ts?: string;
  app?: string;
  tool?: string;
  action?: string;
  rule?: string | null;
  would_be?: string | null;
  hostname?: string;
}

export interface BrowserSite { site: string; seconds: number; visits: number; profiles: number; events: number; blocks: number; warns: number }
export interface BrowserDetector { detector: string; events: number; blocks: number; warns: number; sent_anyway: number; cancelled: number }
export interface BrowserProfile { id: string; label: string; browser: string; hostname?: string | null; device_id?: string | null; sites: number; seconds: number; events: number; blocks: number; last_seen?: string | null }
export interface BrowserEvent { ts: string; label?: string; profile_id: string; site: string; channel: string; file_ext?: string | null; detectors: Record<string, number>; action: string; decision: string }

export interface BrowserData {
  sites: BrowserSite[];
  detectors: BrowserDetector[];
  profiles: BrowserProfile[];
  events: BrowserEvent[];
  by_day?: Record<string, { seconds: number; visits: number }>;
}

export interface Fleet {
  generated_at: string;
  totals: Record<string, number> & { findings: Partial<Record<Severity, number>> };
  devices: DeviceRow[];
  apps: Record<string, { name?: string; vendor?: string; kind?: string; devices: number; running: number }>;
  mcp_packages: { package: string; devices: number; clients: string[] }[];
  findings: Finding[];
  usage: { by_model: Record<string, Tokens>; by_day: Record<string, Tokens>; by_app: Record<string, Tokens> };
  guard_events: GuardEvent[];
  browser: BrowserData;
}

export interface McpServer {
  id?: string;
  client: string;
  scope: string;
  name: string;
  transport: string;
  package?: string | null;
  url?: string | null;
  command?: string | null;
  secrets: { field: string; kind: string; redacted: string }[];
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  meta?: { max_severity?: string; findings?: number; [k: string]: unknown };
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  meta?: Record<string, unknown>;
}

export interface RiskyEvent { timestamp?: string; app: string; tool: string; rule: string; action: string; subject?: string }

export interface Report {
  generated_at: string;
  aiwarden_version?: string;
  device: { id: string; hostname: string; user: string; os: string; arch?: string; team?: string };
  apps: { id: string; name: string; vendor?: string; kind?: string; running?: boolean; version?: string | null }[];
  mcp_servers: McpServer[];
  browser_extensions: { browser: string; name: string; version?: string; broad_access?: boolean }[];
  usage?: {
    by_app: Record<string, Tokens>;
    by_model: Record<string, Tokens>;
    by_day: Record<string, Tokens>;
    tools?: Record<string, number>;
    mcp_calls?: Record<string, Record<string, number>>;
    risky_events?: RiskyEvent[];
  } | null;
  guard_events: GuardEvent[];
  findings: Finding[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  summary: Summary;
}

export interface Rules {
  guard: { id: string; action: string; description: string }[];
  mcp_scan: { id: string; severity: string; description: string }[];
}

export interface Decision {
  action: string;
  rule: string | null;
  reason: string;
  would_be: string | null;
}

export type Row = Record<string, unknown>;

export interface AskResult {
  query: Record<string, unknown> & { entity: string; metric?: string; group_by?: string[] };
  translated_by: string;
  result: {
    rows: Row[];
    total: number;
    window: { since: string; until: string } | null;
    previous_window?: { since: string; until: string };
    notes: string[];
  };
}

export interface Alert {
  id: string;
  rule: string;
  severity: string;
  title: string;
  detail: string;
  hostname?: string;
  user?: string;
  team?: string | null;
}

export interface Change {
  current: number;
  previous: number;
  change_pct: number | null;
}

export type Breakdown = { tokens: number; cost_usd: number; previous_tokens: number; change_pct: number | null } & Record<string, unknown>;

export interface Weekly {
  as_of: string;
  period: { since: string; until: string };
  previous_period: { since: string; until: string };
  devices: number;
  totals: { tokens: Change; cost_usd: Change; sessions: Change };
  by_team: Breakdown[];
  by_user: Breakdown[];
  by_app: Breakdown[];
  mcp_calls: Row[];
  mcp_servers_configured: number;
  findings: {
    by_severity: Record<string, number>;
    serious: { severity: string; rule: string; title: string; hostname: string; user: string; team: string | null }[];
  };
  guard_blocks: { total: number; by_rule: Row[]; by_user: Row[] };
  risky_events: Row[];
  apps: Row[];
}
