"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../detect.js");

const kinds = (text, opts) => Object.fromEntries(D.scanText(text, opts).map((f) => [f.kind, f.count]));
const has = (text, kind, opts) => kinds(text, opts)[kind] > 0;

// Fixture secrets are assembled at runtime so this file does not itself look like it leaks keys.
const GH = "ghp_" + "QQ".repeat(18);
const ANTH = "sk-ant-api03-" + "a1B2".repeat(8);
const OPENAI = "sk-proj-" + "Zx9_".repeat(8);
const AWS = "AKIA" + "ABCDEFGHIJKLMNOP";
const STRIPE = "sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc";
const GOOGLE = "AIza" + "SyA1234567890abcdefghijklmnopqrstuv";
const JWT = "eyJhbGciOiJIUzI1NiJ9" + ".eyJzdWIiOiIxMjM0NTY3ODkwIn0" + ".dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

test("secrets: each provider format is detected", () => {
  assert.ok(has(`my token is ${GH}`, "github_token"));
  assert.ok(has(`key=${AWS}`, "aws_access_key"));
  assert.ok(has(`stripe ${STRIPE}`, "stripe_key"));
  assert.ok(has(`g ${GOOGLE}`, "google_api_key"));
  assert.ok(has(`jwt ${JWT}`, "jwt"));
  assert.ok(has("xoxb-" + "1234567890-abcdefghij", "slack_token"));
  assert.ok(has("glpat-" + "abcdefghij0123456789", "gitlab_token"));
  assert.ok(has("hf_" + "a".repeat(34), "huggingface_token"));
  assert.ok(has("npm_" + "a".repeat(36), "npm_token"));
  assert.ok(has("postgres://admin:hunter22@db.corp.example.com/prod", "url_credentials"));
  assert.ok(has("Authorization: bearer " + "abcDEF123456ghiJKL7890xyz", "bearer_token"));
  assert.ok(has("-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----", "private_key"));
  assert.ok(has("-----BEGIN OPENSSH PRIVATE KEY-----", "private_key"));
});

test("secrets: anthropic key is not double-reported as openai", () => {
  const k = kinds(`ANTHROPIC_API_KEY=${ANTH}`);
  assert.equal(k.anthropic_key, 1);
  assert.equal(k.openai_key, undefined);
  assert.equal(kinds(`OPENAI_API_KEY=${OPENAI}`).openai_key, 1);
});

test("secrets: repeated scans are stable (no shared lastIndex state)", () => {
  for (let i = 0; i < 5; i++) assert.equal(kinds(`a ${GH} b ${GH}`).github_token, 2);
});

test("findings never carry the matched value", () => {
  const out = JSON.stringify(D.scanText(`${GH} ${ANTH} 4111 1111 1111 1111 123-45-6789`));
  for (const s of [GH, ANTH, "4111", "6789"]) assert.ok(!out.includes(s), s);
});

test("no false positives on normal prose and env-var references", () => {
  const prose = "Can you help me write a polite email to my landlord about the broken heater? " +
    "We moved in on 2024-03-01 and the order number was 1234567890. Call me at 555-123-4567.";
  assert.deepEqual(D.scanText(prose), []);
  const code = [
    "import os",
    "client = OpenAI(api_key=os.environ[\"OPENAI_API_KEY\"])",
    "const key = process.env.ANTHROPIC_API_KEY;",
    "headers = {'Authorization': f'Bearer {token}'}",
    "curl -H \"Authorization: Bearer $GITHUB_TOKEN\" https://api.github.com/user",
    "export AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}",
    "id = '550e8400-e29b-41d4-a716-446655440000'  # uuid",
    "ts = 1717171717171",
    "url = 'https://user@example.com/path'",
  ].join("\n");
  assert.deepEqual(D.scanText(code), []);
});

test("credit cards: Luhn-valid numbers only", () => {
  assert.ok(has("card 4111 1111 1111 1111 exp 12/29", "credit_card"));
  assert.ok(has("5500-0000-0000-0004", "credit_card"));
  assert.ok(has("amex 378282246310005", "credit_card"));
  assert.ok(!has("card 4111 1111 1111 1112", "credit_card"), "Luhn failure");
  assert.ok(!has("tracking 1234567812345678", "credit_card"), "Luhn failure / no network prefix");
  assert.ok(!has("0000 0000 0000 0000", "credit_card"));
});

test("SSN: structurally valid, formatted or keyworded", () => {
  assert.ok(has("SSN 123-45-6789", "ssn"));
  assert.ok(has("her social security number is 123456789", "ssn"));
  assert.ok(!has("000-12-3456", "ssn"));
  assert.ok(!has("666-12-3456", "ssn"));
  assert.ok(!has("900-12-3456", "ssn"));
  assert.ok(!has("123-00-6789", "ssn"));
  assert.ok(!has("123-45-0000", "ssn"));
  assert.ok(!has("invoice 123456789", "ssn"), "bare 9 digits without a keyword");
});

test("SIN: Luhn-valid Canadian SIN", () => {
  assert.ok(has("SIN: 046 454 286", "sin"));
  assert.ok(has("046-454-286", "sin"));
  assert.ok(has("social insurance number 046454286", "sin"));
  assert.ok(!has("046 454 287", "sin"), "Luhn failure");
  assert.ok(!has("ref 046454286", "sin"), "bare 9 digits without a keyword");
});

test("bulk email: threshold of unique addresses", () => {
  assert.ok(!has("email me at jane.doe@example.com", "email_bulk"), "single email");
  const four = ["a", "b", "c", "d"].map((x) => `${x}@corp.com`).join(", ");
  assert.ok(!has(four, "email_bulk"));
  const five = ["a", "b", "c", "d", "e"].map((x) => `${x}@corp.com`).join(", ");
  assert.equal(kinds(five).email_bulk, 5);
  assert.ok(!has(`${five}, a@corp.com`.replace(/e@/, "a@"), "email_bulk"), "duplicates do not count");
  assert.ok(has(four, "email_bulk", { emailThreshold: 3 }));
});

function customerCsv(n, sep = ",") {
  const rows = [["name", "email", "phone", "company"].join(sep)];
  for (let i = 0; i < n; i++) rows.push([`Person ${i}`, `p${i}@client${i}.com`, `555-01${String(i).padStart(2, "0")}`, `Acme ${i}`].join(sep));
  return rows.join("\n");
}

test("customer list: CSV / TSV / markdown with PII-shaped headers", () => {
  assert.equal(kinds(customerCsv(12)).customer_list, 12);
  assert.ok(has(customerCsv(10, "\t"), "customer_list"));
  const md = customerCsv(11, " | ").split("\n").map((l) => `| ${l} |`);
  md.splice(1, 0, "|---|---|---|---|");
  assert.ok(has(md.join("\n"), "customer_list"));
});

test("customer list: headerless rows with an email column", () => {
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push(`Person ${i},p${i}@x${i}.com,Acme ${i}`);
  assert.ok(has(rows.join("\n"), "customer_list"));
});

test("customer list: short tables and non-PII tables are ignored", () => {
  assert.ok(!has(customerCsv(5), "customer_list"), "short table");
  const metrics = ["date,requests,errors,latency_ms"];
  for (let i = 0; i < 30; i++) metrics.push(`2024-01-${String(i + 1).padStart(2, "0")},${1000 + i},${i},${120 + i}`);
  assert.ok(!has(metrics.join("\n"), "customer_list"));
});

test("files: sensitive names, inspection limits", () => {
  const f = (name, size = 100, type = "") => ({ name, size, type });
  assert.ok(D.scanFile(f(".env"), null).findings.some((x) => x.kind === "sensitive_file"));
  assert.ok(D.scanFile(f("id_rsa"), null).findings.some((x) => x.kind === "sensitive_file"));
  assert.ok(D.scanFile(f("prod.env"), null).findings.some((x) => x.kind === "sensitive_file"));
  assert.deepEqual(D.scanFile(f(".env.example"), null).findings, []);
  assert.deepEqual(D.scanFile(f("id_rsa.pub"), null).findings, []);
  assert.ok(D.scanFile(f("server.pem"), null).findings.some((x) => x.kind === "sensitive_file"));
  assert.ok(D.scanFile(f("aws_credentials.txt"), null).findings.some((x) => x.kind === "sensitive_file"));
  assert.deepEqual(D.scanFile(f("notes.txt"), "hello world").findings, []);
  assert.equal(D.isInspectable(f("data.csv", 2000, "text/csv")), true);
  assert.equal(D.isInspectable(f("data.csv", 2 * 1024 * 1024, "text/csv")), false, "over 1MB");
  assert.equal(D.isInspectable(f("photo.png", 2000, "image/png")), false);
  assert.equal(D.isInspectable(f("main.py", 2000, "")), true);
  const r = D.scanFile(f("customers.csv", 4000, "text/csv"), customerCsv(15));
  assert.ok(r.inspected && r.findings.some((x) => x.kind === "customer_list"));
  assert.equal(D.scanFile(f("photo.png", 2000, "image/png"), null).inspected, false);
});

test("policy: defaults block secrets, warn on PII; per-detector override", () => {
  assert.equal(D.DEFAULT_POLICY.github_token, "block");
  assert.equal(D.DEFAULT_POLICY.credit_card, "warn");
  assert.equal(D.DEFAULT_POLICY.customer_list, "warn");
  const both = D.scanText(`${GH}\n${customerCsv(12)}`);
  assert.equal(D.decide(both).action, "block");
  assert.equal(D.decide(D.scanText(customerCsv(12))).action, "warn");
  // The CSV also contains 12 emails, so email_bulk must be relaxed too for the whole paste to pass.
  assert.equal(D.decide(D.scanText(customerCsv(12)), { customer_list: "allow" }).action, "warn");
  const relaxed = D.decide(D.scanText(customerCsv(12)), { customer_list: "allow", email_bulk: "allow" });
  assert.equal(relaxed.action, "allow");
  assert.deepEqual(relaxed.triggered, []);
  assert.equal(D.decide(D.scanText(customerCsv(12)), { customer_list: "block" }).action, "block");
  assert.equal(D.decide([]).action, "allow");
  assert.equal(D.decide(D.scanText(GH), { github_token: "bogus" }).action, "block", "invalid override falls back to default");
});

test("every detector has a label, category and default action", () => {
  for (const k of D.DETECTORS) {
    assert.ok(D.LABELS[k], k);
    assert.ok(["secret", "pii"].includes(D.CATEGORY[k]), k);
    assert.ok(["allow", "warn", "block"].includes(D.DEFAULT_POLICY[k]), k);
  }
});

test("large input is bounded and does not throw", () => {
  const big = "lorem ipsum ".repeat(300000) + GH;
  const t0 = Date.now();
  D.scanText(big);
  assert.ok(Date.now() - t0 < 3000);
  assert.deepEqual(D.scanText(""), []);
  assert.deepEqual(D.scanText(null), []);
});

test("textHash is stable and does not contain the text", () => {
  assert.equal(D.textHash("abc"), D.textHash("abc"));
  assert.notEqual(D.textHash("abc"), D.textHash("abd"));
  assert.ok(!String(D.textHash("secretvalue")).includes("secret"));
});
