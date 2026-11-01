// Turns a tool call into a short human summary, the files it touches, and the MCP server or
// skill it belongs to. Shared by the Claude Code and Codex parsers.

type Rec = Record<string, any>;

export function firstLine(text: string, max = 120): string {
  const line = String(text ?? "").trim().split(/\r?\n/).find((l) => l.trim()) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function baseName(path: string): string {
  const parts = String(path).split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/");
}

// Files named in an apply_patch body: "*** Update File: a/b.ts", "*** Add File: …", "*** Delete File: …".
export function patchFiles(patch: string): string[] {
  const files = new Set<string>();
  for (const m of String(patch).matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\r\n"]+)/g)) files.add(m[1].trim());
  return [...files];
}

// Undo JS string escapes in one pass, so "\\n" in "D:\\notes" stays a backslash and an n.
export function unescapeJs(text: string): string {
  const map: Record<string, string> = { "\\\\": "\\", "\\n": "\n", "\\r": "\r", "\\t": "\t", '\\"': '"' };
  return text.replace(/\\[\\nrt"]/g, (m) => map[m]);
}

export interface ToolDescription {
  name: string;
  summary: string;
  files: string[];
  mcpServer?: string;
  skill?: string;
  command?: string; // shell tools: the command itself (the summary may be its description)
}

export function describeTool(name: string, input: Rec): ToolDescription {
  const d: ToolDescription = { name, summary: name, files: [] };
  if (name.startsWith("mcp__")) {
    const [, server = "", tool = ""] = name.split("__");
    d.mcpServer = server;
    d.summary = `${server} · ${tool}`;
    return d;
  }
  switch (name) {
    case "Bash":
    case "PowerShell":
    case "shell":
    case "exec_command":
    case "local_shell": {
      const cmd = Array.isArray(input.command) ? input.command.join(" ") : String(input.command ?? input.cmd ?? "");
      d.summary = input.description ? String(input.description) : firstLine(cmd, 100);
      d.command = cmd.slice(0, 500);
      break;
    }
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit": {
      const file = String(input.file_path ?? input.notebook_path ?? "");
      if (file) d.files.push(file);
      d.summary = `${name === "Write" ? "wrote" : "edited"} ${baseName(file)}`;
      break;
    }
    case "apply_patch": {
      const body = typeof input === "string" ? input : String(input.input ?? input.patch ?? JSON.stringify(input));
      d.files = patchFiles(body);
      d.summary = `patched ${d.files.map(baseName).join(", ") || "files"}`;
      break;
    }
    case "Read":
      d.summary = `read ${baseName(String(input.file_path ?? ""))}`;
      break;
    case "Grep":
    case "Glob":
      d.summary = `searched for ${firstLine(String(input.pattern ?? ""), 60)}`;
      break;
    case "WebFetch":
      d.summary = `fetched ${firstLine(String(input.url ?? ""), 80)}`;
      break;
    case "WebSearch":
      d.summary = `searched the web for ${firstLine(String(input.query ?? ""), 60)}`;
      break;
    case "Agent":
    case "Task":
      d.summary = `started a subagent: ${firstLine(String(input.description ?? input.prompt ?? ""), 80)}`;
      break;
    case "Skill": {
      const skill = String(input.skill ?? input.command ?? input.name ?? "");
      d.skill = skill || undefined;
      d.summary = `used the ${skill} skill`;
      break;
    }
    case "TodoWrite":
      d.summary = "updated its task list";
      break;
    default:
      break;
  }
  return d;
}

const TEST_RUNNER = /\b(vitest|jest|pytest|mocha|go test|cargo test|npm (run )?test|pnpm (run )?test|yarn test|bun test|playwright test|unittest|rspec|dotnet test|mvn test|gradle test|deno test|make test|node --test)(?![\w-])/i;

// Agents often pipe test output through `tail` or `head`, which hides the exit code, so a test
// run also counts as failing when its output says so. Returns the first line that does.
const FAIL_LINE = /(✖|✗|×\s|^not ok\b|\bAssertionError\b|\b[1-9]\d* (failed|failing)\b|\bfail(ures|ed)?:? [1-9]\d*\b|\bTests?:\s+[1-9]\d* failed)/i;
const FAIL_WORD = /\bFAIL(ED)?\b/; // upper case only: "fail 0" in a summary is a pass

export function testFailure(output: string): string | null {
  for (const line of String(output).split(/\r?\n/)) {
    const t = line.trim();
    if (t && (FAIL_LINE.test(t) || FAIL_WORD.test(t))) return t;
  }
  return null;
}

export function isTestCommand(summaryOrCommand: string): boolean {
  return TEST_RUNNER.test(summaryOrCommand);
}
