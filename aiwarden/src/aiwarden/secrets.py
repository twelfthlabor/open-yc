"""Secret detection and redaction. Values are never returned unredacted."""
from __future__ import annotations

import re
from dataclasses import dataclass

# Ordered: more specific patterns first, so a span matched earlier is not re-reported.
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("private_key", re.compile(r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----")),
    ("anthropic_key", re.compile(r"sk-ant-[A-Za-z0-9_\-]{20,}")),
    ("openai_key", re.compile(r"sk-(?:proj-|svcacct-)?[A-Za-z0-9_\-]{20,}")),
    ("github_token", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}")),
    ("aws_access_key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("slack_token", re.compile(r"\bxox[abposr]-[A-Za-z0-9\-]{10,}")),
    ("google_api_key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
    ("stripe_key", re.compile(r"\b(?:sk|rk)_live_[0-9A-Za-z]{20,}")),
    ("gitlab_token", re.compile(r"\bglpat-[0-9A-Za-z_\-]{20,}")),
    ("huggingface_token", re.compile(r"\bhf_[A-Za-z0-9]{30,}\b")),
    ("npm_token", re.compile(r"\bnpm_[A-Za-z0-9]{36}\b")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}")),
    ("url_credentials", re.compile(r"\b[a-z][a-z0-9+.\-]{0,30}://[^/\s:@]{1,256}:[^/\s@]{3,256}@")),
    ("bearer_token", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9_\-\.=]{20,}")),
]

_SECRET_KEY_RE = re.compile(
    r"(?i)(?:^|[_\-.])(?:api[_\-]?key|apikey|secret|token|password|passwd|pwd|auth|authorization|"
    r"credential|private[_\-]?key|access[_\-]?key|client[_\-]?secret|pat|session[_\-]?key|cookie)(?:$|[_\-.])"
)
# Names that contain "token" but are configuration, not credentials.
_NON_SECRET_KEY_RE = re.compile(r"(?i)max[_\-]?tokens?|tokens?[_\-]?(?:limit|count|budget)|tokenizer")

_PLACEHOLDER_RE = re.compile(
    r"^\s*$|^\$\{[^}]*\}$|^\$[A-Z_][A-Z0-9_]*$|^%[A-Z_][A-Z0-9_]*%$|^<[^>]*>$|^\{\{[^}]*\}\}$|"
    r"(?i:^(?:your[_\-\s]?[a-z_\-\s]*|changeme|xxx+|placeholder|example|todo|none|null|redacted|\*+)$)"
)


@dataclass(frozen=True)
class SecretMatch:
    kind: str
    redacted: str


def redact(value: str) -> str:
    """Keep a short prefix so humans can recognize the credential type, nothing more."""
    if len(value) <= 8:
        return "***"
    keep = min(6, len(value) // 4)
    return f"{value[:keep]}…({len(value)} chars)"


def is_placeholder(value: str) -> bool:
    return bool(_PLACEHOLDER_RE.match(value or ""))


def looks_like_secret_key(name: str) -> bool:
    if _NON_SECRET_KEY_RE.search(name):
        return False
    return bool(_SECRET_KEY_RE.search(name))


def find_secrets(text: str) -> list[SecretMatch]:
    if not text:
        return []
    found: list[SecretMatch] = []
    taken: list[tuple[int, int]] = []
    for kind, pat in _PATTERNS:
        for m in pat.finditer(text):
            s, e = m.span()
            if any(s < te and ts < e for ts, te in taken):
                continue
            taken.append((s, e))
            found.append(SecretMatch(kind, redact(m.group(0))))
    return found


def scrub(text: str) -> str:
    """Replace every detected secret in free text with a redacted marker."""
    spans: list[tuple[int, int, str]] = []
    for kind, pat in _PATTERNS:
        for m in pat.finditer(text or ""):
            s, e = m.span()
            if not any(s < te and ts < e for ts, te, _ in spans):
                spans.append((s, e, kind))
    for s, e, kind in sorted(spans, reverse=True):
        text = f"{text[:s]}<redacted:{kind}>{text[e:]}"
    return text


def value_is_secret(key: str, value: str) -> SecretMatch | None:
    """A config value is a secret if it matches a known format, or if the key name says
    it is a credential and the value is a literal (not a ${VAR} reference)."""
    if not isinstance(value, str) or is_placeholder(value):
        return None
    hits = find_secrets(value)
    if hits:
        return hits[0]
    if looks_like_secret_key(key) and len(value) >= 8:
        return SecretMatch("named_secret", redact(value))
    return None
