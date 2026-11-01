import { describe, expect, it } from "vitest";
import { NarrationQueue, STALE_PROGRESS_MS, phrase, priorityOf } from "../src/core/narrate.ts";
import type { Post, PostKind } from "../src/core/types.ts";

let n = 0;
const post = (kind: PostKind, sessionId = "a", text = `${kind} ${n}`): Post => ({ id: `p${n++}`, sessionId, ts: "2026-10-28T12:00:00.000Z", kind, text, urgent: kind === "blocker" || kind === "error" });

describe("narration queue", () => {
  it("ranks blockers over decisions over progress", () => {
    expect([priorityOf(post("blocker")), priorityOf(post("decision")), priorityOf(post("progress"))]).toEqual([0, 1, 2]);
  });

  it("plays urgent posts first and keeps arrival order within a priority", () => {
    const q = new NarrationQueue();
    q.enqueue(post("progress", "a", "p1"), "Wren", 0);
    q.enqueue(post("decision", "a", "d1"), "Wren", 0);
    q.enqueue(post("blocker", "b", "b1"), "Tern", 0);
    q.enqueue(post("blocker", "b", "b2"), "Tern", 0);
    const order = [q.next(0), q.next(0), q.next(0), q.next(0)].map((u) => u?.text);
    expect(order).toEqual(["Heads up. Tern. b1", "Heads up. Tern. b2", "Wren. d1", "Wren. p1"]);
  });

  it("asks to interrupt only when an urgent post arrives during something less urgent", () => {
    const q = new NarrationQueue();
    q.enqueue(post("progress"), "Wren", 0);
    q.next(0);
    expect(q.enqueue(post("decision"), "Wren", 0)).toBe(false);
    expect(q.enqueue(post("blocker"), "Wren", 0)).toBe(true);
    q.next(0); // now playing the blocker
    expect(q.enqueue(post("error"), "Wren", 0)).toBe(false);
  });

  it("when tuned to one agent, plays only urgent posts from the others", () => {
    const q = new NarrationQueue({ focus: "a" });
    expect(q.wants(post("progress", "a"))).toBe(true);
    expect(q.wants(post("progress", "b"))).toBe(false);
    expect(q.wants(post("done", "b"))).toBe(false);
    expect(q.wants(post("blocker", "b"))).toBe(true);
  });

  it("in urgent-only mode plays blockers and errors only, and never reads the user's own posts", () => {
    const q = new NarrationQueue({ mode: "urgent" });
    expect(q.wants(post("decision"))).toBe(false);
    expect(q.wants(post("error"))).toBe(true);
    expect(new NarrationQueue().wants(post("user"))).toBe(false);
  });

  it("drops stale progress and trims the queue from the least important end", () => {
    const q = new NarrationQueue({ max: 3 });
    q.enqueue(post("progress", "a", "old"), "Wren", 0);
    expect(q.next(STALE_PROGRESS_MS + 1)).toBeNull();
    q.enqueue(post("decision", "a", "d1"), "Wren", 0);
    q.enqueue(post("progress", "a", "p1"), "Wren", 0);
    q.enqueue(post("progress", "a", "p2"), "Wren", 0);
    q.enqueue(post("blocker", "a", "b1"), "Wren", 0);
    expect(q.pending.map((u) => u.text)).toEqual(["Heads up. Wren. b1", "Wren. d1", "Wren. p1"]);
  });

  it("says links as 'a link' and strips markdown", () => {
    expect(phrase(post("done", "a", "Done: see https://example.com/pr/1 and `README`"), "Wren")).toBe("Wren. Done: see a link and README");
  });
});
