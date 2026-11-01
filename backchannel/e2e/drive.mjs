// End-to-end check of the hosted demo build (landing page + console replaying the recording)
// in headless Chrome. Serves dist/ itself.
//   npm run build:demo && npm run e2e        screenshots go to docs/screenshots/
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright-core";

const DIST = resolve(import.meta.dirname, "..", "dist");
const SHOTS = resolve(import.meta.dirname, "..", "docs", "screenshots");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  const file = normalize(join(DIST, p));
  if (!file.startsWith(DIST) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
// E2E_URL checks a deployed copy instead (its real headers, CSP and redirects); no screenshots then.
const REMOTE = process.env.E2E_URL?.replace(/\/$/, "");
if (!REMOTE) await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const URL_ = REMOTE ?? `http://127.0.0.1:${server.address().port}`;
const shot = (page, name) => (REMOTE ? null : page.screenshot({ path: join(SHOTS, name) }));

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--disable-extensions"] });
const errors = [];
const open = async (path, viewport, colorScheme = "light") => {
  const ctx = await browser.newContext({ viewport, colorScheme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${path}: ${m.text()}`));
  // A browser extension on the test machine injects a floating button; keep it out of the screenshots.
  await page.addInitScript(() => new MutationObserver(() => document.querySelectorAll("settings-manager").forEach((e) => e.remove())).observe(document, { childList: true, subtree: true }));
  await page.goto(URL_ + path);
  return page;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rec = REMOTE ? await (await fetch(`${URL_}/demo/run.json`)).json() : JSON.parse(readFileSync(join(DIST, "demo", "run.json"), "utf8"));

// Landing, desktop
let page = await open("/", { width: 1440, height: 900 });
await page.locator(".radio .feed > li").nth(5).waitFor({ timeout: 20_000 });
const chips = await page.locator(".radio .chip").count();
check("landing replays the recorded channel", chips === rec.sessions.length, `${chips} agents on air`);
await wait(4000);
await shot(page, "landing.png");
await page.getByRole("link", { name: "Compared" }).click();
await wait(800);
check("section nav marks the section in view", (await page.locator('.side nav a[aria-current="true"]').textContent())?.includes("Compared"));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("landing has no horizontal scroll on desktop", overflow <= 0, `${overflow}px`);
await page.close();

// Landing, phone, dark
page = await open("/", { width: 390, height: 844 }, "dark");
await page.locator(".radio .feed > li").nth(3).waitFor({ timeout: 20_000 });
const mOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("landing has no horizontal scroll at 390px", mOverflow <= 0, `${mOverflow}px`);
await shot(page, "landing-mobile.png");
await page.close();

// Console, demo
page = await open("/app.html", { width: 1360, height: 860 });
await page.getByText("Demo replay", { exact: true }).waitFor();
await page.locator(".feed > li").nth(rec.posts.length - 1).waitFor({ timeout: 90_000 });
check("console replays every recorded post", (await page.locator(".feed > li").count()) === rec.posts.length);
const stations = await page.locator(".station:not(.all)").count();
check("console lists every agent as a station", stations === rec.sessions.length, `${stations}`);
await shot(page, "app-channel.png");
const blocker = rec.sessions.find((s) => rec.posts.some((p) => p.sessionId === s.id && p.kind === "blocker"));
if (blocker) {
  await page.getByRole("button", { name: new RegExp(`^${blocker.name}`) }).first().click();
  await page.locator(".station-head h1").waitFor();
  const onlyTheirs = await page.locator(".feed .who").allTextContents();
  check("tuning to one agent shows only its posts", onlyTheirs.every((n) => n === blocker.name), `${blocker.name}: ${onlyTheirs.length} headers`);
  await page.locator("#reply").fill("The secret is in 1Password under billing; I'll add the .env.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.locator(".post.mine .delivery.delivered").waitFor({ timeout: 5000 });
  check("a demo reply shows as delivered", true);
  await shot(page, "app-station.png");
}
await page.getByRole("button", { name: "Spend", exact: true }).click();
await page.locator(".u-head h1").waitFor();
check("spend view shows the recorded total", (await page.locator(".u-head h1").textContent())?.startsWith("$"));
await shot(page, "app-spend.png");
await page.keyboard.press("]");
check("] switches to the next agent", (await page.locator(".station.on").count()) === 1);
await page.close();

// Console, phone
page = await open("/app.html", { width: 390, height: 844 }, "dark");
await page.locator(".feed > li").nth(4).waitFor({ timeout: 30_000 });
const aOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("console has no horizontal page scroll at 390px", aOverflow <= 0, `${aOverflow}px`);
await shot(page, "app-mobile.png");
await page.close();

check("no page or console errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
if (!REMOTE) server.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
