import { Bell, Blocks, CalendarRange, Globe, LayoutGrid, Laptop, Lightbulb, MessageSquareText, ShieldAlert, ShieldCheck, Sigma, Waypoints } from "lucide-react";

// `key` is the second letter of the g-shortcut (g then f opens Findings).
export const NAV = [
  { path: "", key: "o", label: "Overview", icon: LayoutGrid, group: "Monitor" },
  { path: "ask", key: "a", label: "Ask", icon: MessageSquareText, group: "Monitor" },
  { path: "findings", key: "f", label: "Findings", icon: ShieldAlert, group: "Monitor" },
  { path: "alerts", key: "l", label: "Alerts", icon: Bell, group: "Monitor" },
  { path: "devices", key: "d", label: "Devices", icon: Laptop, group: "Inventory" },
  { path: "graph", key: "n", label: "Graph", icon: Waypoints, group: "Inventory" },
  { path: "mcp", key: "m", label: "MCP servers", icon: Blocks, group: "Inventory" },
  { path: "browser", key: "b", label: "Browser", icon: Globe, group: "Inventory" },
  { path: "insights", key: "i", label: "Insights", icon: Lightbulb, group: "Activity" },
  { path: "usage", key: "u", label: "Usage", icon: Sigma, group: "Activity" },
  { path: "guard", key: "r", label: "Guard", icon: ShieldCheck, group: "Activity" },
  { path: "weekly", key: "w", label: "Weekly report", icon: CalendarRange, group: "Activity" },
] as const;

/** Document title for a route: the sidebar label, so #/mcp reads "MCP servers", not "Mcp". */
export function pageTitle(path: string[]): string {
  const n = NAV.find((x) => x.path === (path[0] || "")) || NAV[0];
  return `${n.label} – aiwarden`;
}
