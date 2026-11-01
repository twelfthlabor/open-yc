import { homedir } from "node:os";
import { join } from "node:path";

export interface Paths {
  home: string; // backchannel's own state
  claudeProjects: string;
  codexSessions: string;
  claudeSettings: string;
  codexHooks: string;
}

// Each agent's documented override wins: CLAUDE_CONFIG_DIR for Claude Code, CODEX_HOME for Codex.
export function resolvePaths(env: NodeJS.ProcessEnv = process.env, userHome = homedir()): Paths {
  const claude = env.CLAUDE_CONFIG_DIR || join(userHome, ".claude");
  const codex = env.CODEX_HOME || join(userHome, ".codex");
  return {
    home: env.BACKCHANNEL_HOME || join(userHome, ".backchannel"),
    claudeProjects: join(claude, "projects"),
    codexSessions: join(codex, "sessions"),
    claudeSettings: join(claude, "settings.json"),
    codexHooks: join(codex, "hooks.json"),
  };
}
