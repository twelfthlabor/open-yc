"""Estimated $ cost of agent token usage.

UPDATE ME: list prices change. Prices are USD per million tokens and were last reviewed on
PRICES_AS_OF. Override or add models in ~/.aiwarden/config.toml:

    [prices."claude-sonnet-4-5"]
    input = 3.0
    output = 15.0
    cache_read = 0.30     # optional; defaults to 0.1 x input
    cache_write = 3.75    # optional; defaults to 1.25 x input

Sources:
- Anthropic entries marked verified=True: the Claude API model table as cached on 2026-10-06
  in Anthropic's claude-api reference, plus its prompt-caching notes (cache write = 1.25x input
  for the 5-minute TTL, cache read ~0.1x input unless listed). Re-check them against
  https://platform.claude.com/docs/en/about-claude/pricing (not fetched for this table).
- Older Anthropic models (claude-opus-4-5, -opus-4-1, -opus-4, -sonnet-4-5, -sonnet-4,
  claude-3-5-haiku) and all OpenAI and Google entries are from memory and NOT verified
  against https://openai.com/api/pricing or https://ai.google.dev/gemini-api/docs/pricing.
  They are flagged verified=False, and `aiwarden usage` says so.

The numbers are list prices. They ignore batch/priority discounts, long-context surcharges and
subscription plans (a Claude Max or ChatGPT plan is not billed per token), so treat the result
as "what this usage would cost on the API".
"""
from __future__ import annotations

import re

PRICES_AS_OF = "2026-10-06"

# model id prefix -> (input, output, cache_read, cache_write, verified)
_TABLE: dict[str, tuple[float, float, float | None, float | None, bool]] = {
    # Anthropic (verified against the cached model table)
    "claude-fable-5-1": (10.0, 50.0, 0.25, None, True),
    "claude-mythos-5-1": (10.0, 50.0, 0.25, None, True),
    "claude-fable-5": (10.0, 50.0, 1.0, None, True),
    "claude-opus-5-5": (4.0, 20.0, 0.20, None, True),
    "claude-opus-5": (5.0, 25.0, None, None, True),
    "claude-opus-4-8": (5.0, 25.0, None, None, True),
    "claude-opus-4-7": (5.0, 25.0, None, None, True),
    "claude-opus-4-6": (5.0, 25.0, None, None, True),
    "claude-opus-4-5": (5.0, 25.0, None, None, False),
    "claude-opus-4-1": (15.0, 75.0, None, None, False),
    "claude-opus-4": (15.0, 75.0, None, None, False),
    "claude-sonnet-5-5": (2.0, 10.0, 0.20, None, True),
    "claude-sonnet-5": (2.0, 10.0, None, None, True),
    "claude-sonnet-4-6": (3.0, 15.0, None, None, True),
    "claude-sonnet-4-5": (3.0, 15.0, None, None, False),
    "claude-sonnet-4": (3.0, 15.0, None, None, False),
    "claude-haiku-5-5": (0.10, 0.50, None, None, True),
    "claude-haiku-4-5": (1.0, 5.0, None, None, True),
    "claude-3-5-haiku": (0.80, 4.0, None, None, False),
    # OpenAI (unverified)
    "gpt-5-codex": (1.25, 10.0, 0.125, 0.0, False),
    "gpt-5-mini": (0.25, 2.0, 0.025, 0.0, False),
    "gpt-5-nano": (0.05, 0.40, 0.005, 0.0, False),
    "gpt-5": (1.25, 10.0, 0.125, 0.0, False),
    "gpt-4.1": (2.0, 8.0, 0.50, 0.0, False),
    "o3": (2.0, 8.0, 0.50, 0.0, False),
    # Google (unverified; <=200k-token prompt tier)
    "gemini-2.5-pro": (1.25, 10.0, 0.31, 0.0, False),
    "gemini-2.5-flash-lite": (0.10, 0.40, 0.025, 0.0, False),
    "gemini-2.5-flash": (0.30, 2.50, 0.075, 0.0, False),
}

_DATE_SUFFIX = re.compile(r"(-\d{8}|@\d{8}|-latest)$")
_PROVIDER_PREFIX = re.compile(r"^(anthropic\.|us\.anthropic\.|models/|openai/|google/)")


def _entry(inp: float, out: float, cr: float | None, cw: float | None, verified: bool) -> dict:
    return {"input": inp, "output": out, "cache_read": inp * 0.1 if cr is None else cr,
            "cache_write": inp * 1.25 if cw is None else cw, "verified": verified}


def default_prices() -> dict[str, dict]:
    return {k: _entry(*v) for k, v in _TABLE.items()}


def load_prices(config: dict | None = None) -> dict[str, dict]:
    """Built-in table plus [prices."<model>"] overrides from config.toml."""
    prices = default_prices()
    for model, p in ((config or {}).get("prices") or {}).items():
        if not isinstance(p, dict):
            continue
        try:
            inp, out = float(p["input"]), float(p["output"])
            cr = float(p["cache_read"]) if "cache_read" in p else None
            cw = float(p["cache_write"]) if "cache_write" in p else None
        except (KeyError, TypeError, ValueError):
            continue
        prices[str(model)] = {**_entry(inp, out, cr, cw, True), "override": True}
    return prices


def _norm(model: str) -> str:
    m = _PROVIDER_PREFIX.sub("", model.strip().lower())
    m = re.sub(r"-v\d+(:\d+)?$", "", m)  # bedrock "...-v1:0"
    return _DATE_SUFFIX.sub("", m)


def price_for(model: str | None, prices: dict[str, dict] | None = None) -> dict | None:
    """Exact id first, then the longest table prefix (claude-sonnet-4-5-20250929 -> claude-sonnet-4-5)."""
    if not model:
        return None
    prices = prices if prices is not None else default_prices()
    if model in prices:
        return prices[model]
    m = _norm(model)
    if m in prices:
        return prices[m]
    best = max((k for k in prices if m.startswith(k) and (len(m) == len(k) or m[len(k)] in "-.:@")),
               key=len, default=None)
    return prices[best] if best else None


def input_includes_cache(app: str) -> bool:
    """OpenAI (Codex) and Gemini count cached prompt tokens inside input_tokens; Anthropic does not."""
    return app in {"codex", "gemini-cli"}


def cost_of(model: str | None, tokens: dict, provider_input_includes_cache: bool = False,
            prices: dict[str, dict] | None = None) -> float | None:
    """USD for one block of tokens, or None if the model has no price."""
    p = price_for(model, prices)
    if p is None:
        return None
    inp = int(tokens.get("input_tokens") or 0)
    cr = int(tokens.get("cache_read_tokens") or 0)
    cw = int(tokens.get("cache_write_tokens") or 0)
    if provider_input_includes_cache:
        inp = max(0, inp - cr)
    out = int(tokens.get("output_tokens") or 0)
    return (inp * p["input"] + out * p["output"] + cr * p["cache_read"] + cw * p["cache_write"]) / 1_000_000
