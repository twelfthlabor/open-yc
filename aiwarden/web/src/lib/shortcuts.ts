import { NAV } from "../components/nav";

// Two-key "go to" shortcuts in the style of Linear and GitHub: press g, then a page letter.
export type Shortcut = { pending: "g" } | { go: string } | { help: true } | null;

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (/^(input|textarea|select)$/i.test(el.tagName || "") || !!el.isContentEditable);
}

export function shortcut({ key, prev, target, mod }: { key: string; prev: string; target: EventTarget | null; mod: boolean }): Shortcut {
  if (mod || isTyping(target)) return null;
  if (prev === "g") {
    const n = NAV.find((x) => x.key === key.toLowerCase());
    return n ? { go: n.path } : null;
  }
  if (key === "g") return { pending: "g" };
  if (key === "?") return { help: true };
  return null;
}

/** How long the second key of a g-sequence may wait. */
export const SEQUENCE_MS = 1200;
