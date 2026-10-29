import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** value used for sorting; columns without it are not sortable */
  sort?: (row: T) => number | string;
  num?: boolean;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  onRow?: (row: T) => void;
  /** highlights the row open in a side panel */
  active?: (row: T) => boolean;
  /** receives the rows in display order whenever sorting or the rows change */
  onOrder?: (rows: T[]) => void;
  initialSort?: { key: string; dir: "asc" | "desc" };
  limit?: number;
  label: string;
  empty?: ReactNode;
}

export function DataTable<T>({ columns, rows, rowKey, onRow, active, onOrder, initialSort, limit, label, empty }: Props<T>) {
  const [sort, setSort] = useState(initialSort);
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const get = col.sort;
    const out = [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      return typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    });
    return sort!.dir === "desc" ? out.reverse() : out;
  }, [rows, sort, columns]);
  useEffect(() => onOrder?.(sorted), [sorted, onOrder]);
  const visible = limit && !showAll ? sorted.slice(0, limit) : sorted;
  if (!rows.length) return <>{empty}</>;
  return (
    <div className="table-wrap">
      <table className="data" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th key={c.key} className={c.num ? "num" : undefined} aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => setSort({ key: c.key, dir: active && sort!.dir === "desc" ? "asc" : "desc" })}
                    >
                      {c.label}
                      {active && (sort!.dir === "desc" ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => (
            <tr
              key={rowKey(r, i)}
              className={[onRow ? "link" : "", active?.(r) ? "active" : ""].join(" ").trim() || undefined}
              aria-current={active?.(r) ? "true" : undefined}
              tabIndex={onRow ? 0 : undefined}
              onClick={onRow ? () => onRow(r) : undefined}
              onKeyDown={onRow ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onRow(r)) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={[c.num ? "num" : "", c.className || ""].join(" ").trim() || undefined}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {limit && sorted.length > limit && (
        <button className="btn" style={{ marginTop: 12 }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${sorted.length}`}
        </button>
      )}
    </div>
  );
}
