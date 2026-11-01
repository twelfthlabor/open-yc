// Stable call signs for sessions, so the chat reads like a team channel instead of a list of UUIDs.
// The same session id always gets the same name and color.

const NAMES = [
  "Wren", "Heron", "Kestrel", "Finch", "Plover", "Swift", "Tern", "Lark",
  "Ibis", "Merlin", "Osprey", "Robin", "Egret", "Linnet", "Pipit", "Avocet",
  "Dunlin", "Shrike", "Sparrow", "Starling", "Thrush", "Warbler", "Petrel", "Curlew",
];

// Hues chosen to stay readable on both the dark and light themes.
const COLORS = ["#f97362", "#f5a524", "#4ec9a5", "#59a7ff", "#b38cff", "#ff7ab6", "#7dd3fc", "#c3e66e"];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function callSign(sessionId: string, taken: Set<string> = new Set()): string {
  const start = hash(sessionId) % NAMES.length;
  for (let i = 0; i < NAMES.length; i++) {
    const name = NAMES[(start + i) % NAMES.length];
    if (!taken.has(name)) return name;
  }
  return `${NAMES[start]}-${sessionId.slice(0, 4)}`;
}

export function colorFor(sessionId: string): string {
  return COLORS[hash(`c${sessionId}`) % COLORS.length];
}
