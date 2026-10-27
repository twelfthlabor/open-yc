import { useMemo, useState } from "react";
import { BarList, StackedBars, dailySeries } from "../components/Charts";
import { DataTable } from "../components/Table";
import { Block, Empty, PageHead, Seg, Stat } from "../components/ui";
import { compact, int, tokens, usd } from "../lib/format";
import type { Fleet, Tokens } from "../lib/types";

const RANGES = ["14 days", "30 days", "90 days"] as const;

type ModelRow = Tokens & { model: string };

export function Usage({ fleet }: { fleet: Fleet }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>("30 days");
  const days = parseInt(range, 10);
  const u = fleet.usage;
  const end = Object.keys(u.by_day).sort().pop();
  const series = useMemo(
    () => dailySeries(Object.fromEntries(Object.entries(u.by_day).map(([d, v]) => [d, { a: Number(v.input_tokens) || 0, b: Number(v.output_tokens) || 0 }])), days, end),
    [u.by_day, days, end],
  );
  const all = Object.values(u.by_model);
  const sum = (k: keyof Tokens) => all.reduce((a, v) => a + (Number(v[k]) || 0), 0);
  const cost = Object.values(u.by_app).reduce((a, v) => a + (Number(v.cost_usd) || 0), 0);
  const models: ModelRow[] = Object.entries(u.by_model).map(([model, v]) => ({ model, ...v }));
  const apps = Object.entries(u.by_app).map(([k, v]) => ({ key: k, label: k, value: tokens(v) })).sort((a, b) => b.value - a.value);
  const appCost = Object.entries(u.by_app).map(([k, v]) => ({ key: k, label: k, value: Number(v.cost_usd) || 0 })).filter((x) => x.value).sort((a, b) => b.value - a.value);

  return (
    <>
      <PageHead title="Usage" sub="Tokens, models and estimated spend from Claude Code, Codex and Gemini CLI transcripts on every device. Cost uses list prices; override them in config.toml." />
      <div className="strip">
        <Stat value={compact(sum("input_tokens"))} label="Input tokens" />
        <Stat value={compact(sum("output_tokens"))} label="Output tokens" />
        <Stat value={compact(sum("cache_read_tokens"))} label="Cache reads" />
        <Stat value={usd(cost)} label="Estimated spend" />
        <Stat value={Object.keys(u.by_model).length} label="Models" />
      </div>
      <Block title="Tokens per day" aside={<Seg label="Range" value={range} options={RANGES} onChange={setRange} />}>
        {series.some((p) => p.a || p.b) ? <StackedBars points={series} /> : <Empty title="No usage in this range" />}
      </Block>
      <div className="grid-even">
        <Block title="Tokens by agent">
          <BarList items={apps} empty={<Empty title="No agent usage" />} />
        </Block>
        <Block title="Estimated spend by agent">
          <BarList items={appCost} format={usd} empty={<Empty title="No priced usage">Models without a list price are counted in tokens only.</Empty>} />
        </Block>
      </div>
      <Block title="By model">
        <DataTable<ModelRow>
          label="Usage by model"
          rows={models}
          rowKey={(m) => m.model}
          initialSort={{ key: "out", dir: "desc" }}
          empty={<Empty title="No model usage" />}
          columns={[
            { key: "model", label: "Model", render: (m) => <code>{m.model}</code>, sort: (m) => m.model },
            { key: "msg", label: "Messages", num: true, render: (m) => int(m.messages), sort: (m) => m.messages || 0 },
            { key: "in", label: "Input", num: true, render: (m) => compact(m.input_tokens), sort: (m) => m.input_tokens || 0 },
            { key: "out", label: "Output", num: true, render: (m) => compact(m.output_tokens), sort: (m) => m.output_tokens || 0 },
            { key: "cache", label: "Cache read", num: true, render: (m) => compact(m.cache_read_tokens), sort: (m) => m.cache_read_tokens || 0 },
            { key: "cost", label: "Est. cost", num: true, render: (m) => (m.cost_usd === undefined ? <span className="muted">No price</span> : usd(m.cost_usd)), sort: (m) => m.cost_usd || 0 },
          ]}
        />
      </Block>
    </>
  );
}
