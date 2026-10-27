import { BarList } from "../components/Charts";
import { DataTable } from "../components/Table";
import { Block, DecisionBadge, Empty, PageHead, Stat, Tag } from "../components/ui";
import { ago, duration } from "../lib/format";
import type { BrowserDetector, BrowserEvent, BrowserProfile, Fleet } from "../lib/types";

const DECISION: Record<string, string> = { allowed: "Allowed", sent_anyway: "Sent anyway", cancelled: "Cancelled", blocked: "Blocked" };

export function Browser({ fleet }: { fleet: Fleet }) {
  const B = fleet.browser || { sites: [], detectors: [], profiles: [], events: [] };
  const t = fleet.totals;
  const secs = B.sites.reduce((a, s) => a + (s.seconds || 0), 0);
  if (!B.profiles.length) {
    return (
      <>
        <PageHead title="Browser" sub="Which AI sites people use, and what sensitive data the extension caught before it was pasted, typed or uploaded." />
        <Empty title="No browser data yet">
          Load the aiwarden extension (see <code>extension/README.md</code>) and set this collector and its token in the extension options. It reports metadata only: site, time, which detector matched and what the person chose. Prompt text never leaves the browser.
        </Empty>
      </>
    );
  }
  return (
    <>
      <PageHead title="Browser" sub="Which AI sites people use, and what sensitive data the extension caught before it was pasted, typed or uploaded. Metadata only; prompt text never leaves the browser." />
      <div className="strip">
        <Stat value={B.profiles.length} label="Browser profiles" />
        <Stat value={B.sites.length} label="AI sites used" />
        <Stat value={duration(secs)} label="Time on AI sites" />
        <Stat value={t.browser_warns || 0} label="Warnings" />
        <Stat value={t.browser_blocks || 0} label="Blocks" />
      </div>
      <div className="grid-even">
        <Block title="Time by site">
          <BarList items={B.sites.map((s) => ({ key: s.site, label: s.site, value: s.seconds }))} format={duration} />
        </Block>
        <Block title="Sensitive data caught">
          <DataTable<BrowserDetector>
            label="Detectors"
            rows={B.detectors}
            rowKey={(d) => d.detector}
            initialSort={{ key: "events", dir: "desc" }}
            empty={<Empty title="Nothing caught yet" />}
            columns={[
              { key: "d", label: "Detector", render: (d) => <code>{d.detector}</code>, sort: (d) => d.detector },
              { key: "events", label: "Events", num: true, render: (d) => d.events, sort: (d) => d.events },
              { key: "blocks", label: "Blocked", num: true, render: (d) => d.blocks, sort: (d) => d.blocks },
              { key: "anyway", label: "Sent anyway", num: true, render: (d) => d.sent_anyway, sort: (d) => d.sent_anyway },
            ]}
          />
        </Block>
      </div>
      <Block title="Events" aside={<span className="aside">Most recent first</span>}>
        <DataTable<BrowserEvent>
          label="Browser DLP events"
          rows={B.events}
          rowKey={(_, i) => String(i)}
          limit={20}
          initialSort={{ key: "ts", dir: "desc" }}
          columns={[
            { key: "ts", label: "When", render: (e) => <span className="nowrap" title={e.ts}>{ago(e.ts)}</span>, sort: (e) => e.ts },
            { key: "action", label: "Policy", render: (e) => <DecisionBadge action={e.action} /> },
            { key: "decision", label: "Outcome", render: (e) => DECISION[e.decision] || e.decision },
            { key: "site", label: "Site", render: (e) => e.site, sort: (e) => e.site },
            { key: "ch", label: "Channel", render: (e) => `${e.channel}${e.file_ext ? ` (.${e.file_ext})` : ""}` },
            { key: "det", label: "Matched", render: (e) => Object.entries(e.detectors || {}).map(([k, n]) => <Tag key={k}>{n > 1 ? `${k} ×${n}` : k}</Tag>) },
            { key: "who", label: "Profile", render: (e) => e.label || e.profile_id },
          ]}
        />
      </Block>
      <Block title="Profiles">
        <DataTable<BrowserProfile>
          label="Browser profiles"
          rows={B.profiles}
          rowKey={(p) => p.id}
          columns={[
            { key: "p", label: "Profile", render: (p) => <><span className="cell-title">{p.label || p.id}</span><span className="sub">{p.browser}</span></> },
            { key: "dev", label: "Device", render: (p) => p.hostname || p.device_id || <span className="muted">Not linked</span> },
            { key: "sites", label: "Sites", num: true, render: (p) => p.sites, sort: (p) => p.sites },
            { key: "time", label: "Time", num: true, render: (p) => duration(p.seconds), sort: (p) => p.seconds },
            { key: "blocks", label: "Blocks", num: true, render: (p) => p.blocks, sort: (p) => p.blocks },
            { key: "seen", label: "Last seen", render: (p) => ago(p.last_seen), sort: (p) => p.last_seen || "" },
          ]}
        />
      </Block>
    </>
  );
}
