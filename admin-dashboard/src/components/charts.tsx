import { useEffect, useMemo, useRef, useState } from 'react';
import { Row, shortDate } from '../lib';

export type Series = { key: string; label: string; color: string; fmt?: (n: number) => string };

/** useElementWidth — responsive SVG without a chart library. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(Math.max(280, Math.floor(e[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/**
 * Multi-series line chart: 2px lines, ≥8px hover markers with a 2px surface ring, crosshair + tooltip,
 * legend whenever there are ≥2 series, recessive grid. One y-axis only.
 */
export function LineChart({
  data, xKey = 'date', series, height = 220, yFmt, xFmt = shortDate,
}: { data: Row[]; xKey?: string; series: Series[]; height?: number; yFmt: (n: number) => string; xFmt?: (s: string) => string }) {
  const { ref, w } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 52, r: 12, t: 10, b: 24 };
  const iw = w - m.l - m.r;
  const ih = height - m.t - m.b;

  const max = useMemo(() => niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)))), [data, series]);
  const x = (i: number) => m.l + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => m.t + ih - (v / max) * ih;

  if (!data.length) return <div className="empty">No data for this range</div>;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const xTickEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(iw / 80))));

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = data.length <= 1 ? 0 : Math.round((px / r.width) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  };

  const tipLeft = hover == null ? 0 : Math.min(w - 170, Math.max(0, x(hover) + 12));

  return (
    <div className="chart" ref={ref}>
      {series.length >= 2 && (
        <div className="legend">
          {series.map((s) => (<span key={s.key}><i style={{ background: s.color }} />{s.label}</span>))}
        </div>
      )}
      <svg width={w} height={height} role="img" aria-label={series.map((s) => s.label).join(', ')} onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">{yFmt(t)}</text>
          </g>
        ))}
        {data.map((d, i) => (i % xTickEvery === 0 ? (
          <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--text-muted)">{xFmt(String(d[xKey]))}</text>
        ) : null))}
        {series.map((s) => (
          <path
            key={s.key}
            d={data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(Number(d[s.key]) || 0).toFixed(1)}`).join(' ')}
            fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
          />
        ))}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} stroke="var(--text-muted)" strokeDasharray="3 3" strokeWidth={1} />
            {series.map((s) => (
              <circle key={s.key} cx={x(hover)} cy={y(Number(data[hover][s.key]) || 0)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
            ))}
          </g>
        )}
        <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onMouseMove={onMove} />
      </svg>
      {hover != null && (
        <div className="tip" style={{ left: tipLeft, top: 28 }}>
          <b>{xFmt(String(data[hover][xKey]))}</b>
          {series.map((s) => (
            <div key={s.key}>
              <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: s.color, marginRight: 6 }} />{s.label}</span>
              <span className="num">{(s.fmt || yFmt)(Number(data[hover][s.key]) || 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Horizontal bars (rounded data end anchored to the baseline). Value text stays in ink; bar carries the hue. */
export function BarList({
  rows, labelKey, valueKey, fmt, onClick, max, secondary,
}: { rows: Row[]; labelKey: string; valueKey: string; fmt: (n: number) => string; onClick?: (r: Row) => void; max?: number; secondary?: (r: Row) => string }) {
  const top = max ?? Math.max(0, ...rows.map((r) => Number(r[valueKey]) || 0));
  if (!rows.length) return <div className="empty">No data</div>;
  return (
    <div className="barlist">
      {rows.map((r, i) => {
        const v = Number(r[valueKey]) || 0;
        return (
          <div key={i} className={`barrow ${onClick ? 'click' : ''}`} onClick={onClick ? () => onClick(r) : undefined} title={String(r[labelKey])}>
            <span className="barlabel">{String(r.label ?? r[labelKey])}{secondary ? <span className="muted"> · {secondary(r)}</span> : null}</span>
            <div className="bartrack"><div className="barfill" style={{ width: `${top > 0 ? Math.max(1.5, (v / top) * 100) : 0}%` }} /></div>
            <span className="num">{fmt(v)}</span>
          </div>
        );
      })}
    </div>
  );
}
