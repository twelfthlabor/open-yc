import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Logo } from "../components/Shell";

export function Connect({ onConnect, rejected }: { onConnect: (token: string) => void; rejected: boolean }) {
  const [value, setValue] = useState("");
  return (
    <div className="connect">
      <div className="connect-art">
        <span className="brand">
          <Logo size={26} />
          aiwarden
        </span>
        <h1>See every AI agent your team runs.</h1>
        <p>Apps, MCP servers, secrets and spend on every laptop, plus a guard that stops destructive agent actions before they happen.</p>
        <div className="terminal" aria-label="Start a collector">
          <span className="p">$</span> aiwarden serve --local{"\n"}
          aiwarden collector on http://127.0.0.1:8765/{"\n"}
          <span className="ok">token: …</span>
        </div>
      </div>
      <div className="connect-form">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) onConnect(value.trim());
          }}
        >
          <h2>Connect to this collector</h2>
          <p className="muted" style={{ margin: 0 }}>
            Paste the token that <code>aiwarden serve</code> printed, or open the link it printed and you are signed in already.
          </p>
          {rejected && (
            <p className="error" role="alert">
              That token was rejected. Copy it again from the collector output, or from AIWARDEN_TOKEN.
            </p>
          )}
          <label>
            Collector token
            <span className="field">
              <KeyRound size={15} />
              <input type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="current-password" autoFocus spellCheck={false} />
            </span>
          </label>
          <button className="btn primary" type="submit" disabled={!value.trim()} style={{ height: 42 }}>
            Connect
          </button>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            The token stays in this browser and is sent only to this collector.
          </p>
        </form>
      </div>
    </div>
  );
}
