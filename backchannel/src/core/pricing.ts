// Estimated $ cost of agent token usage, at API list prices (USD per million tokens).
//
// Ported from aiwarden's pricing table (open-yc/aiwarden/src/aiwarden/pricing.py), same caveats:
// - Anthropic entries marked verified come from Anthropic's model table as cached on 2026-10-06.
//   Cache writes cost 1.25x input for the 5-minute TTL and 2x input for the 1-hour TTL; cache
//   reads cost 0.1x input unless listed.
// - OpenAI and Google entries are from memory and NOT verified; the usage view says so.
// - A Claude Max or ChatGPT plan is not billed per token, so read these as "what this usage would
//   cost on the API". Models missing from the table are reported as unpriced, never as $0.
import type { Provider } from "./types.ts";

export const PRICES_AS_OF = "2026-10-06";

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  verified: boolean;
}

// model id prefix -> [input, output, cacheRead | null, verified]
const TABLE: Record<string, [number, number, number | null, boolean]> = {
  "claude-fable-5-1": [10.0, 50.0, 0.25, true],
  "claude-mythos-5-1": [10.0, 50.0, 0.25, true],
  "claude-fable-5": [10.0, 50.0, 1.0, true],
  "claude-opus-5-5": [4.0, 20.0, 0.2, true],
  "claude-opus-5": [5.0, 25.0, null, true],
  "claude-opus-4-8": [5.0, 25.0, null, true],
  "claude-opus-4-7": [5.0, 25.0, null, true],
  "claude-opus-4-6": [5.0, 25.0, null, true],
  "claude-opus-4-5": [5.0, 25.0, null, false],
  "claude-opus-4-1": [15.0, 75.0, null, false],
  "claude-opus-4": [15.0, 75.0, null, false],
  "claude-sonnet-5-5": [2.0, 10.0, 0.2, true],
  "claude-sonnet-5": [2.0, 10.0, null, true],
  "claude-sonnet-4-6": [3.0, 15.0, null, true],
  "claude-sonnet-4-5": [3.0, 15.0, null, false],
  "claude-sonnet-4": [3.0, 15.0, null, false],
  "claude-haiku-5-5": [0.1, 0.5, null, true],
  "claude-haiku-4-5": [1.0, 5.0, null, true],
  "claude-3-5-haiku": [0.8, 4.0, null, false],
  "gpt-5-codex": [1.25, 10.0, 0.125, false],
  "gpt-5-mini": [0.25, 2.0, 0.025, false],
  "gpt-5-nano": [0.05, 0.4, 0.005, false],
  "gpt-5": [1.25, 10.0, 0.125, false],
  "gpt-4.1": [2.0, 8.0, 0.5, false],
  o3: [2.0, 8.0, 0.5, false],
  "gemini-2.5-pro": [1.25, 10.0, 0.31, false],
  "gemini-2.5-flash-lite": [0.1, 0.4, 0.025, false],
  "gemini-2.5-flash": [0.3, 2.5, 0.075, false],
};

function norm(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^(anthropic\.|us\.anthropic\.|models\/|openai\/|google\/)/, "")
    .replace(/-v\d+(:\d+)?$/, "")
    .replace(/(-\d{8}|@\d{8}|-latest)$/, "");
}

// Exact id first, then the longest table prefix that ends on a separator
// (claude-sonnet-4-5-20250929 -> claude-sonnet-4-5; gpt-5.6-terra does not match gpt-5).
export function priceFor(model: string | undefined): Price | null {
  if (!model) return null;
  const m = norm(model);
  let best: string | null = null;
  for (const k of Object.keys(TABLE)) {
    if (m === k || (m.startsWith(k) && "-:@".includes(m[k.length]))) {
      if (!best || k.length > best.length) best = k;
    }
  }
  if (!best) return null;
  const [input, output, cr, verified] = TABLE[best];
  return { input, output, cacheRead: cr ?? input * 0.1, verified };
}

export interface Tokens {
  input: number; // uncached input
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export function costOf(model: string | undefined, t: Tokens): number | null {
  const p = priceFor(model);
  if (!p) return null;
  return (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite5m * p.input * 1.25 + t.cacheWrite1h * p.input * 2) / 1_000_000;
}

export function providerOf(model: string): Provider {
  const m = model.toLowerCase();
  if (m.includes("claude")) return "anthropic";
  if (/^(gpt|o\d|codex)/.test(m)) return "openai";
  if (m.includes("gemini")) return "google";
  return "other";
}
