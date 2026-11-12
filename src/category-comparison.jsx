import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Equal, Layers3 } from 'lucide-react';
import { fromMinor } from '../functions/domain.js';
import { CategoryIcon, Empty, money } from './ui.jsx';

const trends = { above: ['Above', ArrowUpRight], below: ['Below', ArrowDownRight], same: ['Similar', Equal] };
const periods = [['prior', 'Last month'], ['average', '3-month avg.'], ['year', 'Last year']];

export default function CategoryComparison({ data, allocation, cycle, currency, loading }) {
  const [expanded, setExpanded] = useState(false);
  const [reference, setReference] = useState('prior');
  const byCategory = new Map(allocation?.items.map((item) => [item.category, item]));
  const known = new Map(data.comparisons.map((item) => [item.category, item]));
  const rows = [...data.comparisons, ...[...byCategory.keys()].filter((key) => !known.has(key)).map((category) => ({ category, current: 0 }))];
  const baseline = periods.find(([key]) => key === reference)[1];
  const unavailable = reference === 'year' ? !data.yearAvailable : reference === 'prior' ? !data.priorAvailable : !data.baselineMonths;
  return <section className="panel pace-panel" id="category-pace">
    <div className="panel-head"><div><div className="deck-kicker">SPENDING &amp; ROOM</div><h2>Category pace</h2>
      <p>{cycle.elapsed === 0 ? 'Payday spending' : `Same point in the pay cycle · ${cycle.elapsed} ${cycle.elapsed === 1 ? 'day' : 'days'} after payday`}</p></div>
      <span className="calendar-icon"><Layers3 size={18} /></span></div>
    <div className="pace-tabs segmented" aria-label="Pay cycle comparison">
      {periods.map(([key, label]) => <button key={key} aria-pressed={reference === key} onClick={() => setReference(key)}>{label}</button>)}
    </div>
    {rows.length ? <>
      <div className="pace-table" role="table" aria-label="Spending by category and available room">
        <div className="pace-row pace-head" role="row">
          <span role="columnheader">Category</span><span role="columnheader">Spent</span>
          <span role="columnheader">{baseline}</span><span role="columnheader">Room left</span>
        </div>
        {rows.slice(0, expanded ? rows.length : 5).map((item) => {
          const available = byCategory.get(item.category)?.available ?? 0;
          const [label, Icon] = trends[item[`${reference}Trend`]] ?? [];
          return <div className="pace-row" role="row" key={item.category}>
            <span className="pace-category" role="rowheader"><CategoryIcon category={item.category} /><strong>{item.category}</strong></span>
            <span className="pace-spent" role="cell"><strong>{money(item.current, currency)}</strong>{item.pending > 0 && <small>{money(item.pending, currency)} pending</small>}</span>
            <span className="pace-reference" role="cell">{money(item[reference], currency)}
              {Icon && <span className={`trend ${item[`${reference}Trend`]}`}><Icon size={12} /> {label}</span>}</span>
            <span className={available > 0 ? 'pace-room has-room' : 'pace-room'} role="cell">
              {money(allocation ? fromMinor(available, currency) : null, currency)}</span>
          </div>;
        })}
      </div>
      <div className="pace-footer">
        {rows.length > 5 && <button className="text-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer categories' : `Show all ${rows.length} categories`}</button>}
        {allocation && <span>{money(fromMinor(allocation.unassigned, currency), currency)} unassigned</span>}
      </div>
    </> : <Empty icon={Layers3} title="Category pace will appear after sync">Posted purchases and split categories are included.</Empty>}
    <div className="pace-note">
      {loading && <p role="status">Loading older comparisons…</p>}
      {!loading && unavailable && <p>{baseline} needs a comparable pay cycle in your imported bank history.</p>}
      {reference === 'average' && data.baselineMonths > 0 && data.baselineMonths < 3 &&
        <p>Average uses {data.baselineMonths} available {data.baselineMonths === 1 ? 'cycle' : 'cycles'}.</p>}
      <p>Current spending includes pending purchases. Historical comparisons use posted purchases.</p>
      <details><summary>How category room works</summary>
        <p>Stead reserves known bills, bank holds, and savings buckets first. It estimates flexible needs from spending before this payday, subtracts spending so far, and allocates remaining cash to essentials first. Any excess stays unassigned. Category spending includes purchases across linked accounts in this currency.</p>
      </details>
    </div>
  </section>;
}
