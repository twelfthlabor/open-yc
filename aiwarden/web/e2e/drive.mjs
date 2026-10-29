// End-to-end check of the console against a synthetic collector (scripts/demo.py), in a real Chromium.
//   npm run build && npm run e2e
// Env: E2E_OUT (screenshot dir, default ./e2e-out), CHROMIUM (browser path; default: the newest Playwright download).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const OUT = process.env.E2E_OUT || "e2e-out";
const TOKEN = "e2e-token-0123456789";
mkdirSync(OUT, { recursive: true });

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "ms-playwright"),
    join(homedir(), ".cache", "ms-playwright"),
    join(homedir(), "Library", "Caches", "ms-playwright"),
  ].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => +b.split("-")[1] - +a.split("-")[1]);
    for (const d of dirs) {
      for (const rel of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux64/chrome", "chrome-linux/chrome",
        "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
        const p = join(root, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined; // let playwright-core try its own default
}

function startDemo(port, extra = []) {
  return new Promise((resolve, reject) => {
    const py = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
    const p = spawn(py, ["scripts/demo.py", "--port", String(port), "--token", TOKEN, ...extra], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const t = setTimeout(() => reject(new Error(`demo did not start: ${out}`)), 30000);
    p.stdout.on("data", (b) => {
      out += b;
      const m = /on (http:\/\/[^/\s]+)\//.exec(out);
      if (m && out.includes("open:")) {
        clearTimeout(t);
        resolve({ proc: p, url: m[1] });
      }
    });
    p.stderr.on("data", (b) => (out += b));
    p.on("exit", (c) => reject(new Error(`demo exited ${c}: ${out}`)));
  });
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const port = 18000 + Math.floor(Math.random() * 2000);
const demo = await startDemo(port);
const emptyDemo = await startDemo(port + 1, ["--empty"]);
const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
const problems = [];

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1, ...opts });
  const page = await ctx.newPage();
  // 401 (the wrong-token step) and 422 (the unparseable question) are expected responses, not errors
  page.on("console", (m) => {
    const t = m.text();
    if ((m.type() === "error" || /Content Security Policy/i.test(t)) && !/status of (401|422)/.test(t)) problems.push(`${m.type()}: ${t}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return { ctx, page };
}

try {
  // 1. Connect screen, wrong token, then the token link that `aiwarden serve` prints
  {
    const { ctx, page } = await newPage();
    await page.goto(`${demo.url}/`);
    await page.getByRole("heading", { name: "Connect to this collector" }).waitFor();
    await page.screenshot({ path: join(OUT, "connect-light.png") });
    await page.getByLabel("Collector token").fill("wrong-token-000");
    await page.getByRole("button", { name: "Connect" }).click();
    await page.getByRole("alert").waitFor();
    check("wrong token is rejected with a message", await page.getByText("That token was rejected").isVisible());
    await ctx.close();
  }

  const { ctx, page } = await newPage();
  await page.goto(`${demo.url}/#token=${TOKEN}`);
  await page.locator("h1.posture").waitFor();
  check("token link signs in and is removed from the URL", !page.url().includes(TOKEN), page.url());
  const posture = await page.locator("h1.posture").innerText();
  check("overview headline describes the fleet", /6 devices run 13 AI apps and 15 MCP servers/.test(posture), posture);
  check("overview shows token chart", await page.locator(".chart svg").first().isVisible());
  await page.locator(".chart svg").first().hover({ position: { x: 400, y: 100 } });
  check("chart tooltip on hover", await page.locator(".tip").first().isVisible());
  await page.screenshot({ path: join(OUT, "overview-light.png"), fullPage: true });

  // 2. command palette
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Jump to a page or device, or ask a question").fill("lena");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => location.hash.startsWith("#/devices/dev-lena"));
  await page.locator(".graph > svg").waitFor();
  check("command palette jumps to a device", page.url().includes("devices/dev-lena"));
  const nodes = await page.locator(".graph g.node").count();
  check("device relationship graph renders nodes", nodes > 8, `${nodes} nodes`);
  await page.locator(".graph g.node").first().locator("circle").last().click();
  check("selecting a node shows details", await page.locator(".graph-info").isVisible());
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.screenshot({ path: join(OUT, "device-light.png"), fullPage: true });

  // 3. findings filter via headline link
  await page.goto(`${demo.url}/#/`);
  await page.locator("h1.posture a.risk").click();
  await page.waitForFunction(() => location.hash === "#/findings?sev=high");
  await page.getByRole("heading", { level: 1, name: "Findings" }).waitFor();
  const findingRows = page.locator("table[aria-label='Findings'] tbody tr");
  await findingRows.first().waitFor();
  // poll briefly: React may still be committing the filtered list
  await page.waitForFunction(() => document.querySelectorAll("table[aria-label='Findings'] tbody tr").length === 6, null, { timeout: 5000 }).catch(() => {});
  const rows = await findingRows.count();
  check("headline link opens high-and-above findings", rows === 6, `${rows} rows`);
  await page.getByPlaceholder("Filter by rule, device or text").fill("plaintext");
  await page.waitForFunction(() => document.querySelectorAll("table[aria-label='Findings'] tbody tr").length === 3, null, { timeout: 5000 }).catch(() => {});
  check("findings text filter", (await page.locator("table[aria-label='Findings'] tbody tr").count()) === 3);
  await page.screenshot({ path: join(OUT, "findings-light.png"), fullPage: true });

  // 3b. finding peek: open a row, step with j, close with Escape; filters survive
  await findingRows.first().click();
  const peek = page.getByRole("dialog", { name: "Finding details" });
  await peek.waitFor();
  check("finding row opens the side panel", (await peek.locator(".peek-pos").textContent())?.trim() === "1 / 3");
  check("peek links to the device", (await peek.locator("a[href^='#/devices/']").count()) === 1);
  await page.keyboard.press("j");
  await page.waitForFunction(() => document.querySelector(".peek-pos")?.textContent?.trim() === "2 / 3", null, { timeout: 3000 }).catch(() => {});
  check("j moves to the next finding", (await peek.locator(".peek-pos").textContent())?.trim() === "2 / 3");
  await page.screenshot({ path: join(OUT, "findings-peek.png") });
  await page.keyboard.press("Escape");
  await peek.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  check("Escape closes the panel and keeps the filter", (await peek.count()) === 0 && (await findingRows.count()) === 3);

  // 3c. g-shortcuts and the shortcut list
  await page.locator("body").click({ position: { x: 5, y: 5 } }); // focus out of the filter field
  await page.keyboard.press("g");
  await page.keyboard.press("u");
  await page.waitForFunction(() => location.hash === "#/usage", null, { timeout: 3000 }).catch(() => {});
  check("g then u opens Usage", (await page.evaluate(() => location.hash)) === "#/usage");
  await page.keyboard.press("Shift+Slash");
  check("? lists the shortcuts", await page.getByRole("dialog", { name: "Keyboard shortcuts" }).isVisible());
  await page.keyboard.press("Escape");

  // 4. ask
  await page.goto(`${demo.url}/#/ask`);
  await page.getByRole("button", { name: "top 5 users by cost" }).click();
  await page.locator(".answer table.data tbody tr").first().waitFor();
  check("ask answers a suggested question", (await page.locator(".answer table.data tbody tr").count()) === 5);
  await page.getByRole("textbox", { name: "Question" }).fill("what is the airspeed of a swallow");
  await page.getByRole("button", { name: /^Ask/ }).click();
  await page.locator(".answer .error").first().waitFor();
  check("ask explains an unparseable question", /could not understand/.test(await page.locator(".answer .error").first().innerText()));
  await page.screenshot({ path: join(OUT, "ask-light.png"), fullPage: true });

  // 5. guard tester
  await page.goto(`${demo.url}/#/guard`);
  await page.getByRole("button", { name: "Check" }).click();
  await page.locator(".verdict").waitFor();
  check("guard tester blocks force-push", /GRD020/.test(await page.locator(".verdict").innerText()));
  await page.locator(".examples button", { hasText: "git status" }).click();
  await page.waitForFunction(() => document.querySelector(".verdict")?.textContent?.includes("git status"));
  check("guard tester allows git status", /would run/.test(await page.locator(".verdict").innerText()));
  await page.locator(".tester select").selectOption("codex");
  await page.locator(".examples button", { hasText: "rm -rf" }).click();
  await page.waitForFunction(() => document.querySelector(".verdict")?.textContent?.includes("rm -rf"));
  check("guard tester handles Codex argv commands", /blocked/.test(await page.locator(".verdict").innerText()));
  check("guard rules table loads", (await page.locator("table[aria-label='Guard rules'] tbody tr").count()) > 10);
  await page.screenshot({ path: join(OUT, "guard-light.png"), fullPage: true });

  // 6. the rest of the pages render without errors
  for (const [path, heading] of [["usage", "Usage"], ["mcp", "MCP servers"], ["browser", "Browser"], ["alerts", "Alerts"], ["weekly", "Weekly report"], ["devices", "Devices"]]) {
    await page.goto(`${demo.url}/#/${path}`);
    await page.getByRole("heading", { level: 1, name: heading }).waitFor();
    await page.locator(".loading").waitFor({ state: "detached" }); // hash navigation has no network-idle signal
    check(`${path} page renders`, true);
    await page.screenshot({ path: join(OUT, `${path}-light.png`), fullPage: true });
  }
  await page.goto(`${demo.url}/#/alerts`);
  await page.locator("table[aria-label='Activity alerts'] tbody tr").first().waitFor();
  check("alerts show spend spikes", /spike/i.test(await page.locator("table[aria-label='Activity alerts']").innerText()));
  const inv = await page.locator("table[aria-label='Inventory alerts']").innerText();
  check("inventory alerts are not called new", /Plaintext secret on/.test(inv) && !/New /.test(inv) && !/newly/.test(inv));

  // 7. dark theme
  await page.goto(`${demo.url}/#/`);
  await page.getByRole("button", { name: /^Theme: system/ }).click(); // system -> light
  await page.getByRole("button", { name: /^Theme: light/ }).click(); // light -> dark
  check("theme switch sets dark", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await page.locator("h1.posture").waitFor();
  await page.screenshot({ path: join(OUT, "overview-dark.png"), fullPage: true });
  await page.goto(`${demo.url}/#/devices/dev-maya`);
  await page.locator(".graph > svg").waitFor();
  await page.screenshot({ path: join(OUT, "device-dark.png"), fullPage: true });
  await ctx.close();

  // 8. phone width
  {
    const { ctx: m, page: p } = await newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.goto(`${demo.url}/#token=${TOKEN}`);
    await p.locator("h1.posture").waitFor();
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("no horizontal scroll at 375px", overflow <= 0, `${overflow}px`);
    await p.screenshot({ path: join(OUT, "overview-mobile.png"), fullPage: true });
    await p.getByRole("button", { name: "Open menu" }).click();
    await p.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Guard" }).click();
    await p.getByRole("heading", { level: 1, name: "Guard" }).waitFor();
    await p.waitForTimeout(400); // drawer slide-out
    check("mobile drawer navigates", p.url().endsWith("#/guard"));
    const o2 = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("guard page fits at 375px", o2 <= 0, `${o2}px`);
    await p.screenshot({ path: join(OUT, "guard-mobile.png"), fullPage: true });
    await p.goto(`${demo.url}/#/findings`);
    await p.locator("table[aria-label='Findings'] tbody tr").first().click();
    const mp = p.getByRole("dialog", { name: "Finding details" });
    await mp.waitFor();
    await p.waitForTimeout(400); // slide-in
    const box = await mp.boundingBox();
    check("finding panel fits at 375px", !!box && box.x >= 0 && box.x + box.width <= 375, box ? `${Math.round(box.x)}..${Math.round(box.x + box.width)}` : "no box");
    await p.screenshot({ path: join(OUT, "findings-peek-mobile.png") });
    await m.close();
  }

  // 9. empty collector
  {
    const { ctx: e, page: p } = await newPage({ colorScheme: "dark" });
    await p.goto(`${emptyDemo.url}/#token=${TOKEN}`);
    await p.getByText("No devices have reported yet.").waitFor();
    check("empty fleet explains how to send the first report", await p.locator(".terminal").isVisible());
    await p.screenshot({ path: join(OUT, "empty-dark.png") });
    await e.close();
  }

  // 10. untrusted report text renders as text
  {
    const { ctx: x, page: p } = await newPage();
    await p.goto(`${demo.url}/#token=${TOKEN}`);
    await p.locator("h1.posture").waitFor();
    const injected = await p.evaluate(async (token) => {
      const r = {
        schema: "aiwarden.report/v1", generated_at: new Date().toISOString(),
        device: { id: "dev-evil", hostname: "<img src=x onerror=window.__pwned=1>", user: "<b>x</b>", os: "Linux" },
        apps: [{ id: "a", name: "<script>window.__pwned=1</script>", kind: "cli" }], mcp_servers: [], browser_extensions: [], guard_events: [],
        findings: [{ rule: "X1", severity: "high", title: "<img src=x onerror=window.__pwned=1>", subject: "s", detail: "", location: "" }],
        graph: { nodes: [{ id: "device:dev-evil", type: "device", label: "<svg onload=window.__pwned=1>" }], edges: [] }, summary: { findings: { high: 1 } },
      };
      const res = await fetch("/api/reports", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(r) });
      return res.status;
    }, TOKEN);
    check("hostile report is accepted by the collector", injected === 200, String(injected));
    await p.goto(`${demo.url}/#/findings`);
    await p.reload(); // a hash-only goto keeps the loaded fleet
    await p.getByText("<img src=x onerror=window.__pwned=1>").first().waitFor();
    await p.goto(`${demo.url}/#/devices/dev-evil`);
    await p.locator(".graph > svg").waitFor();
    check("hostile report strings render as text, not HTML", injected === 200 && !(await p.evaluate(() => window.__pwned)));
    await x.close();
  }

  check("no console errors or CSP violations", problems.length === 0, problems.slice(0, 5).join(" | "));
} catch (e) {
  check("e2e run", false, e.stack || String(e));
} finally {
  await browser.close();
  demo.proc.kill();
  emptyDemo.proc.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${OUT}`);
process.exit(failed.length ? 1 : 0);
