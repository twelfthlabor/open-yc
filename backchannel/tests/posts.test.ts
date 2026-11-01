import { describe, expect, it } from "vitest";
import { PostBuilder, sentences } from "../src/core/posts.ts";
import type { AgentEvent } from "../src/core/types.ts";

const S = "s1";
const at = (sec: number) => new Date(Date.UTC(2026, 9, 28, 12, 0, sec)).toISOString();
let id = 0;
const builder = () => new PostBuilder({ digestMs: 20_000, newId: () => `p${id++}` });
const tool = (sec: number, tid: string, name: string, summary: string, files: string[] = [], extra: object = {}): AgentEvent => ({ kind: "tool", sessionId: S, ts: at(sec), id: tid, name, summary, files, inputChars: 10, ...extra });
const result = (sec: number, tid: string, isError: boolean, excerpt = ""): AgentEvent => ({ kind: "tool_result", sessionId: S, ts: at(sec), id: tid, isError, excerpt, chars: 10 });
const text = (sec: number, t: string, final = false): AgentEvent => ({ kind: "text", sessionId: S, ts: at(sec), text: t, final });

describe("progress digests", () => {
  it("folds tool calls into one post when the window closes", () => {
    const b = builder();
    expect(b.ingest(text(0, "Let me look at the routes first."))).toEqual([]);
    b.ingest(tool(1, "t1", "Edit", "edited src/routes.ts", ["/r/src/routes.ts"]));
    b.ingest(tool(2, "t2", "Edit", "edited src/app.ts", ["/r/src/app.ts"]));
    b.ingest(tool(3, "t3", "Bash", "npm test"));
    b.ingest(result(4, "t3", false));
    expect(b.flush(Date.parse(at(10)))).toEqual([]); // window still open
    const [p] = b.flush(Date.parse(at(21)));
    expect(p).toMatchObject({ kind: "progress", urgent: false });
    expect(p.text).toBe("Let me look at the routes first. (edited src/routes.ts, src/app.ts, ran npm test, tests passed)");
  });

  it("lists at most three files", () => {
    const b = builder();
    for (const [i, f] of ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"].entries()) b.ingest(tool(i, `t${i}`, "Write", `wrote ${f}`, [`/x/${f}`]));
    expect(b.flush(Date.parse(at(30)))[0].text).toBe("Edited x/a.ts, x/b.ts, x/c.ts and 2 more.");
  });

  it("names MCP servers used", () => {
    const b = builder();
    b.ingest(tool(0, "m", "mcp__linear__create_issue", "linear · create_issue", [], { mcpServer: "linear" }));
    expect(b.flush(Date.parse(at(30)))[0].text).toBe("Used linear over MCP.");
  });
});

describe("immediate posts", () => {
  it("posts tagged decisions, assumptions and blockers right away", () => {
    const b = builder();
    const out = b.ingest(text(0, "Reading the schema.\nDecision: use SQLite for the cache.\nAssumption: the API is internal only.\nBlocked: need the staging DB password."));
    expect(out.map((p) => [p.kind, p.text, p.urgent])).toEqual([
      ["decision", "use SQLite for the cache.", false],
      ["assumption", "the API is internal only.", false],
      ["blocker", "need the staging DB password.", true],
    ]);
  });

  it("finds untagged decisions and assumptions", () => {
    const b = builder();
    const out = b.ingest(text(0, "I'll go with zod for validation. I'm assuming Node 22 is available."));
    expect(out.map((p) => p.kind)).toEqual(["decision", "assumption"]);
  });

  it("closes the open digest before an immediate post so the order holds", () => {
    const b = builder();
    b.ingest(tool(0, "t1", "Read", "read a.ts"));
    const out = b.ingest(text(1, "Decision: keep the old API."));
    expect(out.map((p) => p.kind)).toEqual(["progress", "decision"]);
  });

  it("reports failing tests at once and a stuck agent after three failures in a row", () => {
    const b = builder();
    b.ingest(tool(0, "t1", "Bash", "npm test"));
    expect(b.ingest(result(1, "t1", true, "FAIL auth.test.ts"))).toEqual([expect.objectContaining({ kind: "error", text: "Tests are failing: FAIL auth.test.ts", urgent: true })]);
    const b2 = builder();
    for (let i = 0; i < 3; i++) b2.ingest(tool(i * 2, `c${i}`, "Bash", "curl localhost:3000"));
    expect(b2.ingest(result(1, "c0", true, "refused"))).toEqual([]);
    expect(b2.ingest(result(3, "c1", true, "refused"))).toEqual([]);
    const stuck = b2.ingest(result(5, "c2", true, "connection refused"));
    expect(stuck.at(-1)).toMatchObject({ kind: "blocker", urgent: true });
    expect(stuck.at(-1)!.text).toContain("3 failed calls in a row");
  });

  it("recognises a test run by its command when the summary is a description", () => {
    const b = builder();
    b.ingest(tool(0, "t1", "Bash", "Run the tests", [], { command: "node --test" }));
    expect(b.ingest(result(1, "t1", true, "not ok 1 - adds"))[0]).toMatchObject({ kind: "error", text: "Tests are failing: not ok 1 - adds" });
  });

  it("reads failures from test output when a pipe hid the exit code", () => {
    const b = builder();
    b.ingest(tool(0, "t1", "Bash", "Run node tests", [], { command: "node --test 2>&1 | tail -60" }));
    const out = "✖ adds two numbers (1.2ms)\nℹ tests 1\nℹ pass 0\nℹ fail 1";
    expect(b.ingest({ ...result(1, "t1", false, "✖ adds two numbers (1.2ms)"), sample: out } as AgentEvent)[0]).toMatchObject({ kind: "error", text: "Tests are failing: ✖ adds two numbers (1.2ms)" });
    b.ingest(tool(2, "t2", "Bash", "Rerun", [], { command: "node --test | tail" }));
    expect(b.ingest({ ...result(3, "t2", false, "✔ adds"), sample: "✔ adds two numbers\nℹ pass 1\nℹ fail 0" } as AgentEvent)).toEqual([]);
  });

  it("resets the failure count after a success", () => {
    const b = builder();
    for (const [i, err] of [true, true, false, true, true].entries()) {
      b.ingest(tool(i, `t${i}`, "Bash", "make"));
      expect(b.ingest(result(i, `t${i}`, err)).some((p) => p.kind === "blocker")).toBe(false);
    }
  });

  it("posts approvals and questions as urgent blockers", () => {
    const b = builder();
    expect(b.ingest({ kind: "attention", sessionId: S, ts: at(0), reason: "approval", text: "Bash: rm -rf dist" })[0]).toMatchObject({ kind: "blocker", text: "Needs your approval: Bash: rm -rf dist", urgent: true });
    expect(b.ingest({ kind: "attention", sessionId: S, ts: at(1), reason: "question", text: "Postgres or SQLite?" })[0].text).toBe("Asks: Postgres or SQLite?");
  });

  it("posts a done summary at the end of a turn, not the final text twice", () => {
    const b = builder();
    expect(b.ingest(text(0, "All set. Added the endpoint and two tests. Run npm test to check.", true))).toEqual([]);
    const [done] = b.ingest({ kind: "turn_end", sessionId: S, ts: at(1), text: "All set. Added the endpoint and two tests. Run npm test to check." });
    expect(done).toMatchObject({ kind: "done", text: "Done: All set. Added the endpoint and two tests." });
  });

  it("does not repeat the same post within ten minutes", () => {
    const b = builder();
    expect(b.ingest(text(0, "Decision: use pnpm."))).toHaveLength(1);
    expect(b.ingest(text(30, "Decision: use pnpm."))).toHaveLength(0);
  });

  it("announces new tasks from prompts", () => {
    const b = builder();
    expect(b.ingest({ kind: "prompt", sessionId: S, ts: at(0), text: "Add rate limiting to /login\nmore detail" })[0].text).toBe("Picked up a new task: Add rate limiting to /login");
  });
});

describe("sentences", () => {
  it("drops code blocks and markdown, and keeps link text only", () => {
    expect(sentences("**Done.** Ran `npm test`.\n```\nlog\n```\nNext: deploy.")).toEqual(["Done.", "Ran npm test.", "Next: deploy."]);
    expect(sentences("Created [todo.txt](D:\\w\\todo.txt).")).toEqual(["Created todo.txt."]);
  });

  it("leaves tagged lines out of the done summary and strips markdown from tags", () => {
    const b = builder();
    const tagged = b.ingest(text(0, "Decision: port `8080`.\nWrote config.json.", true));
    expect(tagged[0]).toMatchObject({ kind: "decision", text: "port 8080." });
    expect(b.ingest({ kind: "turn_end", sessionId: S, ts: at(1), text: "Decision: port `8080`.\nWrote config.json." })[0].text).toBe("Done: Wrote config.json.");
  });

  it("writes command descriptions in lower case inside a digest", () => {
    const b = builder();
    b.ingest(tool(0, "t1", "Bash", "Rerun the tests"));
    b.ingest(tool(1, "t2", "Bash", "NODE_ENV=test npm start"));
    expect(b.flush(Date.parse(at(30)))[0].text).toBe("Ran rerun the tests; NODE_ENV=test npm start.");
  });
});
