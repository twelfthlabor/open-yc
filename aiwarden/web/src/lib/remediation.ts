// How to fix each finding the scanner raises (src/aiwarden/risk.py). Keyed by rule id; the finding's own
// `detail` says what was found, this says what to change. `cmd` is shown as a copyable command.
export interface Fix {
  why: string;
  steps: string[];
  cmd?: string;
}

export const REMEDIATION: Record<string, Fix> = {
  MCP001: {
    why: "Anything that can read the config file, including other agents and synced dotfiles, gets the token.",
    steps: [
      "Revoke or rotate the token at the provider; assume it has been copied.",
      "Reference it from the environment instead, e.g. \"env\": {\"GITHUB_TOKEN\": \"${GITHUB_TOKEN}\"}, and keep the value in the OS keychain or a secret manager.",
      "Re-scan to confirm the config no longer holds the value.",
    ],
    cmd: "aiwarden scan --fail-on high",
  },
  MCP002: {
    why: "Tool calls, results and auth headers cross the network in clear text.",
    steps: ["Switch the server URL to https://.", "If the server cannot serve TLS, put it behind a TLS proxy or reach it over a VPN only."],
  },
  MCP003: {
    why: "npx -y / uvx fetch whatever version is newest at every launch, so a hijacked release runs on the next start.",
    steps: ["Pin an exact version in the args, e.g. @modelcontextprotocol/server-github@2025.4.8 or uvx pkg==1.2.3.", "Review the changelog before bumping the pin."],
    cmd: "aiwarden mcp-scan",
  },
  MCP004: {
    why: "A prompt injection anywhere can make the agent read or rewrite any file under that root.",
    steps: ["Replace /, C:\\ or the home directory with the project directories the server actually needs.", "Use a separate server entry per project if needed."],
  },
  MCP005: {
    why: "Agents with this server can run arbitrary commands with your user's rights.",
    steps: ["Remove the server if the agent's own shell tool is enough.", "Otherwise install the pre-execution guard so destructive commands are blocked before they run."],
    cmd: "aiwarden hooks install --agent all",
  },
  AGT001: {
    why: "Every shell command, including rm -rf and force-pushes, runs without a prompt.",
    steps: ["Replace Bash / Bash(*) in permissions.allow with the specific commands you trust, e.g. Bash(npm test:*).", "Install the guard to catch what the allowlist lets through."],
    cmd: "aiwarden hooks install --agent claude-code",
  },
  AGT002: {
    why: "bypassPermissions skips every confirmation, for every tool.",
    steps: ["Remove permissions.defaultMode or set it to \"default\" or \"acceptEdits\".", "Use bypass mode only inside a disposable container or VM."],
  },
  AGT003: {
    why: "With approval_policy=never and danger-full-access, Codex runs every command unreviewed and unsandboxed.",
    steps: ["Set sandbox_mode = \"workspace-write\" in ~/.codex/config.toml.", "Use approval_policy = \"on-request\" outside throwaway environments."],
    cmd: "aiwarden hooks install --agent codex",
  },
  AGT004: {
    why: "Nothing stops a destructive command or a secret write before it runs.",
    steps: ["Install the pre-tool hook. It blocks or asks before rm -rf ~, DROP DATABASE, force-pushes to main and secret leaks."],
    cmd: "aiwarden hooks install --agent all",
  },
  EXT001: {
    why: "Page contents of every site, internal apps included, can reach a third-party AI service.",
    steps: ["Remove the extension, or restrict its site access to \"On click\" or specific sites in the browser's extension settings.", "Block it fleet-wide with the browser's ExtensionInstallBlocklist policy if it is not approved."],
  },
};
