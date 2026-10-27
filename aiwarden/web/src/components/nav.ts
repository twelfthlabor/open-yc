import { Bell, Blocks, CalendarRange, Globe, LayoutGrid, Laptop, MessageSquareText, ShieldAlert, ShieldCheck, Sigma } from "lucide-react";

export const NAV = [
  { path: "", label: "Overview", icon: LayoutGrid, group: "Monitor" },
  { path: "ask", label: "Ask", icon: MessageSquareText, group: "Monitor" },
  { path: "findings", label: "Findings", icon: ShieldAlert, group: "Monitor" },
  { path: "alerts", label: "Alerts", icon: Bell, group: "Monitor" },
  { path: "devices", label: "Devices", icon: Laptop, group: "Inventory" },
  { path: "mcp", label: "MCP servers", icon: Blocks, group: "Inventory" },
  { path: "browser", label: "Browser", icon: Globe, group: "Inventory" },
  { path: "usage", label: "Usage", icon: Sigma, group: "Activity" },
  { path: "guard", label: "Guard", icon: ShieldCheck, group: "Activity" },
  { path: "weekly", label: "Weekly report", icon: CalendarRange, group: "Activity" },
] as const;
