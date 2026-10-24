/* aiwarden browser DLP: pure detection logic, shared by the content script and Node tests.
 *
 * Nothing in this module returns matched values. Results are {kind, category, count} only, so a
 * caller can never accidentally log or transmit the sensitive text it found.
 */
(function (root) {
  "use strict";

  const MAX_SCAN = 2 * 1024 * 1024; // characters; longer inputs are scanned up to this point
  const MAX_FILE_INSPECT = 1024 * 1024; // bytes

  // Ported from src/aiwarden/secrets.py (_PATTERNS). Order matters: specific before generic.
  // Stored as [source, flags] so each scan builds fresh RegExp objects (no shared lastIndex).
  const SECRET_PATTERNS = [
    ["private_key", "-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----", ""],
    ["anthropic_key", "sk-ant-[A-Za-z0-9_\\-]{20,}", ""],
    ["openai_key", "sk-(?:proj-|svcacct-)?[A-Za-z0-9_\\-]{20,}", ""],
    ["github_token", "\\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\\b|\\bgithub_pat_[A-Za-z0-9_]{40,}", ""],
    ["aws_access_key", "\\b(?:AKIA|ASIA)[A-Z0-9]{16}\\b", ""],
    ["slack_token", "\\bxox[abposr]-[A-Za-z0-9\\-]{10,}", ""],
    ["google_api_key", "\\bAIza[0-9A-Za-z_\\-]{35}\\b", ""],
    ["stripe_key", "\\b(?:sk|rk)_live_[0-9A-Za-z]{20,}", ""],
    ["gitlab_token", "\\bglpat-[0-9A-Za-z_\\-]{20,}", ""],
    ["huggingface_token", "\\bhf_[A-Za-z0-9]{30,}\\b", ""],
    ["npm_token", "\\bnpm_[A-Za-z0-9]{36}\\b", ""],
    ["jwt", "\\beyJ[A-Za-z0-9_\\-]{10,}\\.eyJ[A-Za-z0-9_\\-]{10,}\\.[A-Za-z0-9_\\-]{10,}", ""],
    ["url_credentials", "\\b[a-z][a-z0-9+.\\-]{0,30}://[^/\\s:@]{1,256}:[^/\\s@]{3,256}@", ""],
    ["bearer_token", "\\bbearer\\s+[A-Za-z0-9_\\-\\.=]{20,}", "i"],
  ];

  const PII = ["credit_card", "ssn", "sin", "email_bulk", "customer_list"];
  const DETECTORS = SECRET_PATTERNS.map((p) => p[0]).concat(PII, ["sensitive_file"]);

  const LABELS = {
    private_key: "Private key",
    anthropic_key: "Anthropic API key",
    openai_key: "OpenAI API key",
    github_token: "GitHub token",
    aws_access_key: "AWS access key",
    slack_token: "Slack token",
    google_api_key: "Google API key",
    stripe_key: "Stripe live key",
    gitlab_token: "GitLab token",
    huggingface_token: "Hugging Face token",
    npm_token: "npm token",
    jwt: "JSON Web Token",
    url_credentials: "Password in a URL",
    bearer_token: "Bearer token",
    credit_card: "Credit card number",
    ssn: "US Social Security number",
    sin: "Canadian Social Insurance number",
    email_bulk: "Many email addresses",
    customer_list: "Customer / contact list",
    sensitive_file: "Credential or key file",
  };

  const CATEGORY = {};
  for (const k of DETECTORS) CATEGORY[k] = PII.includes(k) ? "pii" : "secret";

  const DEFAULT_POLICY = {};
  for (const k of DETECTORS) DEFAULT_POLICY[k] = CATEGORY[k] === "pii" ? "warn" : "block";

  const ACTIONS = ["allow", "warn", "block"];

  function luhn(digits) {
    let sum = 0;
    let dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = digits.charCodeAt(i) - 48;
      if (dbl) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      dbl = !dbl;
    }
    return sum % 10 === 0;
  }

  function cardNetwork(d) {
    const p2 = +d.slice(0, 2);
    const p3 = +d.slice(0, 3);
    const p4 = +d.slice(0, 4);
    const n = d.length;
    if (d[0] === "4" && (n === 13 || n === 16 || n === 19)) return true; // Visa
    if (((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) && n === 16) return true; // Mastercard
    if ((p2 === 34 || p2 === 37) && n === 15) return true; // Amex
    if ((p4 === 6011 || p2 === 65 || (p3 >= 644 && p3 <= 649)) && n >= 16) return true; // Discover
    if (p2 === 35 && n >= 16) return true; // JCB
    if ((p2 === 36 || p2 === 38 || (p3 >= 300 && p3 <= 305)) && n === 14) return true; // Diners
    return false;
  }

  function countCards(text) {
    let n = 0;
    for (const m of text.matchAll(/(?<![\d.\-])\d(?:[ \-]?\d){12,18}(?![\d.\-]*\d)/g)) {
      const raw = m[0];
      const seps = raw.match(/[ \-]/g);
      // Separators, if present, must be one kind (4111 1111 1111 1111, not 2024-01 11 ...).
      if (seps && new Set(seps).size > 1) continue;
      const d = raw.replace(/[ \-]/g, "");
      if (/^(\d)\1+$/.test(d)) continue;
      if (cardNetwork(d) && luhn(d)) n++;
    }
    return n;
  }

  const SSN_KEYWORD = /\b(?:ssn|social security|soc\.? ?sec)/i;
  const SIN_KEYWORD = /\b(?:sin|social insurance|numéro d'assurance sociale)\b/i;

  function nearKeyword(text, index, re) {
    return re.test(text.slice(Math.max(0, index - 40), index));
  }

  function ssnValid(a, g, s) {
    return a !== "000" && a !== "666" && a[0] !== "9" && g !== "00" && s !== "0000";
  }

  function countSsn(text) {
    let n = 0;
    for (const m of text.matchAll(/(?<![\d\-])(\d{3})([- ])(\d{2})\2(\d{4})(?![\d\-])/g)) {
      if (ssnValid(m[1], m[3], m[4])) n++;
    }
    for (const m of text.matchAll(/(?<![\d\-])(\d{3})(\d{2})(\d{4})(?![\d\-])/g)) {
      if (ssnValid(m[1], m[2], m[3]) && nearKeyword(text, m.index, SSN_KEYWORD)) n++;
    }
    return n;
  }

  function countSin(text) {
    let n = 0;
    for (const m of text.matchAll(/(?<![\d\-])(\d{3})([- ]?)(\d{3})\2(\d{3})(?![\d\-])/g)) {
      const d = m[1] + m[3] + m[4];
      if (d[0] === "0" && d.startsWith("000")) continue;
      if (d[0] === "8") continue; // not issued
      if (!luhn(d)) continue;
      if (m[2] !== "" || nearKeyword(text, m.index, SIN_KEYWORD)) n++;
    }
    return n;
  }

  const EMAIL_RE = /[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9\-]{1,63}(?:\.[A-Za-z0-9\-]{1,63})*\.[A-Za-z]{2,24}/g;
  const EMAIL_ONE = /^[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9\-]{1,63}(?:\.[A-Za-z0-9\-]{1,63})*\.[A-Za-z]{2,24}$/;

  function countEmails(text) {
    const seen = new Set();
    for (const m of text.matchAll(EMAIL_RE)) {
      // A URL credential like https://user@host is not an email address someone is sharing.
      const before = text.slice(Math.max(0, m.index - 3), m.index);
      if (before.endsWith("://") || before.endsWith("//")) continue;
      seen.add(m[0].toLowerCase());
      if (seen.size > 100000) break;
    }
    return seen.size;
  }

  const PII_HEADER = /^(?:(?:first|last|full|given|family|sur|contact|customer|client|account|company|business)[ _\-]?name|name|e-?mail(?:[ _\-]?address)?|phone(?:[ _\-]?(?:number|no))?|mobile|tel(?:ephone)?|cell|company|organi[sz]ation|employer|customer|client|contact|account|address|street|city|zip|postal[ _\-]?code|dob|date[ _\-]?of[ _\-]?birth|birthday|ssn|sin|title|job[ _\-]?title)$/i;

  function splitRow(line, sep) {
    let s = line.trim();
    if (sep === "|") {
      if (s.startsWith("|")) s = s.slice(1);
      if (s.endsWith("|")) s = s.slice(0, -1);
    }
    return s.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
  }

  // Finds the largest block of consecutive lines that parse as a table with a stable column count.
  function bestTable(lines) {
    let best = null;
    for (const sep of [",", "\t", ";", "|"]) {
      let start = 0;
      while (start < lines.length) {
        const cols = lines[start].includes(sep) ? splitRow(lines[start], sep).length : 0;
        if (cols < 2) {
          start++;
          continue;
        }
        let end = start + 1;
        const rows = [splitRow(lines[start], sep)];
        while (end < lines.length) {
          const l = lines[end];
          if (sep === "|" && /^\s*\|?\s*:?-{2,}/.test(l)) {
            end++;
            continue;
          }
          const r = splitRow(l, sep);
          if (r.length !== cols) break;
          rows.push(r);
          end++;
        }
        if (!best || rows.length > best.rows.length) best = { sep, cols, rows };
        start = end;
      }
    }
    return best;
  }

  function countCustomerRows(text, minRows) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < minRows) return 0;
    const t = bestTable(lines.slice(0, 50000));
    if (!t) return 0;
    const [head, ...body] = t.rows;
    const piiHeaders = head.filter((h) => PII_HEADER.test(h)).length;
    if (piiHeaders >= 2 && body.length >= minRows) return body.length;
    // Headerless: one column that is mostly email addresses, plus at least one other column.
    const all = t.rows;
    if (all.length >= minRows && t.cols >= 2) {
      for (let c = 0; c < t.cols; c++) {
        const emails = all.filter((r) => EMAIL_ONE.test(r[c])).length;
        if (emails >= minRows && emails / all.length >= 0.8) return all.length - (EMAIL_ONE.test(head[c]) ? 0 : 1);
      }
    }
    return 0;
  }

  function finding(kind, count) {
    return { kind, category: CATEGORY[kind], count };
  }

  /** Scan free text. opts: {emailThreshold=5, minRows=10}. Returns [{kind, category, count}]. */
  function scanText(text, opts) {
    if (typeof text !== "string" || text === "") return [];
    const o = Object.assign({ emailThreshold: 5, minRows: 10 }, opts || {});
    const t = text.length > MAX_SCAN ? text.slice(0, MAX_SCAN) : text;
    const out = [];
    const taken = [];
    for (const [kind, src, flags] of SECRET_PATTERNS) {
      let n = 0;
      for (const m of t.matchAll(new RegExp(src, "g" + flags))) {
        const s = m.index;
        const e = s + m[0].length;
        if (taken.some(([ts, te]) => s < te && ts < e)) continue;
        taken.push([s, e]);
        n++;
      }
      if (n) out.push(finding(kind, n));
    }
    const cards = countCards(t);
    if (cards) out.push(finding("credit_card", cards));
    const ssn = countSsn(t);
    if (ssn) out.push(finding("ssn", ssn));
    const sin = countSin(t);
    if (sin) out.push(finding("sin", sin));
    const emails = countEmails(t);
    if (emails >= o.emailThreshold) out.push(finding("email_bulk", emails));
    const rows = countCustomerRows(t, o.minRows);
    if (rows) out.push(finding("customer_list", rows));
    return out;
  }

  const TEXT_EXT = /\.(?:txt|md|markdown|csv|tsv|json|jsonl|ndjson|xml|yaml|yml|toml|ini|cfg|conf|env|log|sql|html?|css|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|ps1|bat|swift|scala|r|pem|key|properties|tf|vcf)$/i;
  const SENSITIVE_NAME = /(?:^|[\\/])(?:\.env(?:\.(?!example$|sample$|template$)[\w.\-]+)?|id_(?:rsa|dsa|ecdsa|ed25519)(?!\.pub)|[^\\/]*\.(?:pem|key|p12|pfx|jks|keystore|ppk|kdbx)|[\w\-]+\.env|\.?netrc|\.git-credentials|\.npmrc|\.pypirc|(?:aws_)?credentials(?:\.[\w]+)?|[\w\-]*secrets?\.(?:json|ya?ml|toml|env))$/i;

  function isInspectable(meta) {
    if (!meta || typeof meta.size !== "number" || meta.size > MAX_FILE_INSPECT) return false;
    const type = String(meta.type || "");
    if (/^(?:image|audio|video|font)\//.test(type)) return false;
    if (/^text\/|json|xml|csv|yaml|javascript|x-sh|x-python|sql/.test(type)) return true;
    return TEXT_EXT.test(String(meta.name || ""));
  }

  function fileExt(name) {
    const m = /\.([A-Za-z0-9]{1,10})$/.exec(String(name || ""));
    return m ? m[1].toLowerCase() : "";
  }

  /** Check a file by name, and by content if text was read (caller reads only when isInspectable). */
  function scanFile(meta, text, opts) {
    const findings = [];
    if (SENSITIVE_NAME.test(String((meta && meta.name) || ""))) findings.push(finding("sensitive_file", 1));
    const inspected = typeof text === "string";
    if (inspected) {
      for (const f of scanText(text, opts)) findings.push(f);
    }
    return { findings, inspected, ext: fileExt(meta && meta.name), size: (meta && meta.size) || 0 };
  }

  function actionFor(kind, policy) {
    const v = policy && policy[kind];
    return ACTIONS.includes(v) ? v : DEFAULT_POLICY[kind] || "warn";
  }

  /** The strictest action across findings, and which detectors triggered it. */
  function decide(findings, policy) {
    let rank = 0;
    for (const f of findings || []) rank = Math.max(rank, ACTIONS.indexOf(actionFor(f.kind, policy)));
    const action = ACTIONS[rank];
    const triggered = (findings || []).filter((f) => actionFor(f.kind, policy) !== "allow").map((f) => f.kind);
    return { action, triggered };
  }

  /** Non-reversible short fingerprint (FNV-1a 32-bit), used only in-page to key a one-shot bypass. */
  function textHash(s) {
    let h = 0x811c9dc5;
    const str = String(s);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0") + ":" + str.length;
  }

  const api = {
    DETECTORS, LABELS, CATEGORY, DEFAULT_POLICY, ACTIONS, MAX_FILE_INSPECT,
    scanText, scanFile, isInspectable, decide, actionFor, textHash, luhn,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AIWardenDetect = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
