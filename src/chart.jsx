import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fromMinor } from '../functions/domain.js';
import { dayLabel, money } from './ui.jsx';

function CashTooltip({ active, payload, currency, showPrediction }) {
  if (!active || !payload?.length) return null;
  const { date, committed, projected, label } = payload[0].payload;
  return <div className="runway-tooltip"><strong>{dayLabel(date)}</strong>
    <span>Bills &amp; income <b>{money(fromMinor(committed, currency), currency)}</b></span>
    {label && <small>{label}</small>}
    {showPrediction && <span>With spending estimate <b>{money(fromMinor(projected, currency), currency)}</b></span>}
  </div>;
}

export function CashBurndown({ runway, currency, showPrediction = false }) {
  const first = Date.parse(runway.points[0].date);
  const points = runway.points.map((point, index, all) => {
    const sameDay = all.filter((item) => item.date === point.date);
    const order = sameDay.indexOf(point);
    return { ...point, x: (Date.parse(point.date) - first) / 86400000 + .7 * order / sameDay.length };
  });
  const ticks = [...new Set([0, Math.floor(runway.days / 2), runway.days])];
  const precision = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const formatAxis = (value) => precision.format(fromMinor(value, currency));
  return <div className="runway-chart" aria-label="Projected cash burndown chart">
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={points} margin={{ top: 12, right: 13, bottom: 4, left: 0 }}>
        <defs><linearGradient id="cash-burn-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ddf5a0" stopOpacity={.32} /><stop offset="100%" stopColor="#ddf5a0" stopOpacity={.025} />
        </linearGradient></defs>
        <CartesianGrid vertical={false} stroke="#ffffff1f" />
        <XAxis dataKey="x" type="number" domain={[0, runway.days + .8]} ticks={ticks} tickFormatter={(day) => dayLabel(new Date(first + day * 86400000).toISOString().slice(0, 10))}
          axisLine={false} tickLine={false} tickMargin={9} tick={{ fill: '#c7d7cd', fontSize: 11 }} />
        <YAxis tickFormatter={formatAxis} width={42} tickCount={4} domain={[(value) => Math.min(0, value), (value) => Math.max(1, value)]}
          axisLine={false} tickLine={false} tick={{ fill: '#c7d7cd', fontSize: 11 }} />
        <ReferenceLine y={0} stroke="#ffffff65" strokeDasharray="3 4" />
        <Tooltip content={<CashTooltip currency={currency} showPrediction={showPrediction} />} cursor={{ stroke: '#e3efdc60' }} />
        {showPrediction && <Line dataKey="projected" type="stepAfter" stroke="#a1b7b1" strokeWidth={1.6} strokeDasharray="4 5" dot={false} isAnimationActive={false} />}
        <Area dataKey="committed" type="stepAfter" fill="url(#cash-burn-fill)" stroke={runway.lowest < 0 ? '#ffc9a5' : '#dff2a3'}
          strokeWidth={2.7} dot={points.length <= 2} activeDot={{ r: 4 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  </div>;
}
