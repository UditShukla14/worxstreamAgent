import { Row, compact, int, pct100, usd } from '../lib';
import { Card } from './ui';

/** Nova and Raven side by side, and their sum: the cumulative picture for whatever range is selected. */
export default function ByApp({ rows, title = 'By AI app', sub = 'Cumulative across Nova and Raven. Each app is billed from its own wallet.' }: { rows: Row[]; title?: string; sub?: string }) {
  if (!rows?.length) return null;
  const total = rows.reduce((a, r) => ({
    billable_usd: a.billable_usd + r.billable_usd, cost_usd: a.cost_usd + r.cost_usd, call_count: a.call_count + r.call_count, total_tokens: a.total_tokens + r.total_tokens,
  }), { billable_usd: 0, cost_usd: 0, call_count: 0, total_tokens: 0 });
  const margin = total.billable_usd > 0 ? ((total.billable_usd - total.cost_usd) / total.billable_usd) * 100 : 0;
  const share = (r: Row) => (total.billable_usd > 0 ? pct100((r.billable_usd / total.billable_usd) * 100, 0) : '–');
  return (
    <Card title={title} sub={sub}>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>App</th>
              <th className="r">Revenue</th>
              <th className="r">Share</th>
              <th className="r">Anthropic cost</th>
              <th className="r">Margin</th>
              <th className="r">Model calls</th>
              <th className="r">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.app}>
                <td><b>{r.name}</b></td>
                <td className="r num">{usd(r.billable_usd)}</td>
                <td className="r num">{share(r)}</td>
                <td className="r num">{usd(r.cost_usd)}</td>
                <td className="r num">{r.billable_usd ? pct100(r.margin_pct) : '–'}</td>
                <td className="r num">{int(r.call_count)}</td>
                <td className="r num">{compact(r.total_tokens)}</td>
              </tr>
            ))}
            <tr>
              <td><b>Cumulative</b></td>
              <td className="r num"><b>{usd(total.billable_usd)}</b></td>
              <td className="r num">100%</td>
              <td className="r num"><b>{usd(total.cost_usd)}</b></td>
              <td className="r num"><b>{total.billable_usd ? pct100(margin) : '–'}</b></td>
              <td className="r num"><b>{int(total.call_count)}</b></td>
              <td className="r num"><b>{compact(total.total_tokens)}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
