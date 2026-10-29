import { Bell, Blocks, CalendarRange, Globe, LayoutGrid, Laptop, MessageSquareText, ShieldAlert, ShieldCheck, Sigma } from "lucide-react";

// `key` is the second letter of the g-shortcut (g then f opens Findings).
export const NAV = [
  { path: "", key: "o", label: "Overview", icon: LayoutGrid, group: "Monitor" },
  { path: "ask", key: "a", label: "Ask", icon: MessageSquareText, group: "Monitor" },
  { path: "findings", key: "f", label: "Findings", icon: ShieldAlert, group: "Monitor" },
  { path: "alerts", key: "l", label: "Alerts", icon: Bell, group: "Monitor" },
  { path: "devices", key: "d", label: "Devices", icon: Laptop, group: "Inventory" },
  { path: "mcp", key: "m", label: "MCP servers", icon: Blocks, group: "Inventory" },
  { path: "browser", key: "b", label: "Browser", icon: Globe, group: "Inventory" },
  { path: "usage", key: "u", label: "Usage", icon: Sigma, group: "Activity" },
  { path: "guard", key: "r", label: "Guard", icon: ShieldCheck, group: "Activity" },
  { path: "weekly", key: "w", label: "Weekly report", icon: CalendarRange, group: "Activity" },
] as const;
