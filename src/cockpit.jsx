import { lazy, Suspense, useState } from 'react';
import { ArrowRight, CalendarClock, CircleAlert, Gauge, ListChecks, Sparkles } from 'lucide-react';
import { dateKey, fromMinor, shiftDays } from '../functions/domain.js';
const CashBurndown = lazy(() => import('./chart.jsx').then((module) => ({ default: module.CashBurndown })));
import CategoryComparison from './category-comparison.jsx';
import { dayLabel, Empty, money } from './ui.jsx';

const amount = (minor, currency) => money(fromMinor(minor, currency), currency);

function featuredAdvice({ runway, pace, brief, coach, today, currency }) {
  if (runway?.lowest < 0) {
    const nextDeposit = runway.deposits.find((item) => item.effectiveDate >= runway.firstGap);
    return {
      title: `Cash needs attention ${dayLabel(runway.firstGap)}`,
      text: `Dated bills leave a gap of up to ${amount(-runway.lowest, currency)} on ${dayLabel(runway.lowestDate)}. ${nextDeposit
        ? `An expected ${amount(nextDeposit.stillDue, currency)} deposit on ${dayLabel(nextDeposit.effectiveDate)} is included, but money is needed before it arrives. Check whether a bill’s timing can move while protecting family essentials.`
        : 'Confirm bill dates and any income still missing from the calendar, keeping food, housing and other essentials first.'}`,
    };
  }
  if (coach.enabled !== false && brief.forecastVersion === 2 && brief.text && brief.date >= shiftDays(today, -1)) {
    return { title: 'Today’s briefing', text: brief.text, date: brief.date };
  }
  if (!runway) return { title: 'Start with a cash account', text: 'Sync a checking account and add upcoming bills to get your first plan check.' };
  const higher = pace.comparisons.filter(({ averageTrend, category }) => averageTrend === 'above' && category !== 'Uncategorized')
    .sort((a, b) => (b.current - b.average) - (a.current - a.average))[0];
  if (higher) return {
    title: `Keep an eye on ${higher.category.toLowerCase()}`,
    text: `Spending here is ${money(higher.current - higher.average, currency)} above your usual pace. Check what your family still needs before payday and add any known purchases to the calendar.`,
  };
  return {
    title: 'Known bills are covered',
    text: `Your lowest available cash is ${amount(runway.lowest, currency)} after dated bills and expected deposits. Groceries, fuel and other purchases missing from the calendar still need room. The optional spending estimate can help plan for them.`,
  };
}

export function FlightDeck({ account, accounts, selectAccount, cycle, runway, allocation, pace, planner, currency, today, go, sync, onSync, syncDisabled, historyLoading }) {
  const [showPrediction, setShowPrediction] = useState(false);
  const balanceAsOf = account?.balanceDate ? dateKey(account.balanceDate) : null;
  const olderBalance = balanceAsOf && balanceAsOf < shiftDays(today, -2);
  const advice = planner.loading && account ? { title: 'Checking your plan', text: 'Stead is loading expected bills and savings.' }
    : olderBalance && runway?.lowest >= 0 ? { title: 'Check your bank balance', text: `The bank last reported this balance on ${dayLabel(balanceAsOf)}. Check for recent purchases before making new plans.` }
    : featuredAdvice({ runway, pace, brief: planner.brief, coach: planner.coach, today, currency });
  const short = runway?.lowest < 0;
  return <div className="flight-deck">
    <div className="deck-grid">
      <section className="deck-runway" aria-labelledby="deck-runway-title">
        <div className="runway-top">
          <div><div className="deck-kicker"><Gauge size={15} /> CASH RUNWAY</div><h2 id="deck-runway-title">Until next payday</h2></div>
          {account && <span className="runway-date"><CalendarClock size={15} /> {dayLabel(cycle.nextPayday)}</span>}
        </div>
        {runway ? <>
          <div className="deck-runway-amount">
            <div><span>{short ? 'Known-bill gap' : 'Lowest cash after known bills'}</span>
              <strong>{amount(Math.abs(runway.lowest), currency)}</strong></div>
            <span className={`runway-badge ${short ? 'warn' : ''}`}><i />{short ? 'Timing gap' : olderBalance ? 'Older balance' : 'Bills covered'}</span>
          </div>
          <p className="runway-explanation">{short
            ? `First below $0 ${dayLabel(runway.firstGap)} · lowest ${dayLabel(runway.lowestDate)}`
            : `Lowest point ${dayLabel(runway.lowestDate)} · includes dated income`}</p>
          <div className="runway-legend"><span><i /> Bills &amp; expected income</span>
            {showPrediction && runway.prediction.available && <span><i /> With spending estimate</span>}</div>
          <Suspense fallback={<div className="runway-chart" role="status">Loading chart…</div>}><CashBurndown runway={runway} currency={currency} showPrediction={showPrediction && runway.prediction.available} /></Suspense>
          <dl className="runway-numbers">
            <div><dt>Cash after holds &amp; savings</dt><dd>{amount(runway.opening, currency)}</dd></div>
            <div><dt>Bills still to clear</dt><dd>{amount(runway.expected, currency)}</dd></div>
            <div><dt>Expected income</dt><dd>{amount(runway.income, currency)}</dd></div>
          </dl>
          <label className="runway-prediction checkbox"><input type="checkbox" checked={showPrediction && runway.prediction.available} disabled={!runway.prediction.available}
            onChange={(event) => setShowPrediction(event.target.checked)} /><span>Show day-by-day spending estimate</span></label>
          <details className="runway-method"><summary>How this forecast works</summary><p>{runway.prediction.available
            ? `Uses the same day after payday in ${runway.prediction.months} prior months, excluding known repeating bills and transfers. ${amount(runway.estimatedSpending, currency)} estimated before payday. This estimate is separate from the bill gap.`
            : 'The spending estimate needs at least two comparable past pay cycles. The main forecast uses dated bills and income.'}
            {' '}Expenses are placed before deposits on the same day. Unlisted purchases can change the result.</p></details>
          <div className="runway-caption">
            <label><span className="sr-only">Forecast account</span><select value={account.key} onChange={(event) => selectAccount(event.target.value)}>
              {accounts.filter((item) => item.currency === currency).map((item) => <option value={item.key} key={item.key}>{item.name}</option>)}
            </select></label>
            <span>{balanceAsOf ? `Balance ${dayLabel(balanceAsOf)}`
              : sync.lastSuccess ? 'Last synced balance' : 'Bank balance'}</span>
          </div>
        </> : <div className="runway-empty">
          <p>{planner.loading ? 'Loading bills and savings…' : account ? 'The cash plan couldn’t be loaded.' : 'Sync your bank to see what’s left before payday.'}</p>
          {!account && <button className="button" disabled={syncDisabled} onClick={onSync}>Sync bank</button>}
        </div>}
      </section>
      <section className="deck-coach panel" aria-labelledby="featured-coach-title">
        <div className="deck-coach-head"><span className="deck-coach-icon"><Sparkles size={21} /></span>
          <div><div className="deck-kicker">DAILY COACH</div><span>{advice.date ? `Briefed ${dayLabel(advice.date)}` : `Plan check · ${dayLabel(today)}`}</span></div></div>
        <h2 id="featured-coach-title">{advice.title}</h2>
        <p className="coach-featured-text">{advice.text}</p>
        <div className="coach-featured-actions">
          <button className="text-button" onClick={() => go('paychecks', short ? 'calendar' : 'coach')}>
            {short ? 'Review expected bills' : 'Open coach'} <ArrowRight size={16} />
          </button>
          {runway && <span>{cycle.posted ? 'Posted payday' : 'Scheduled cycle'} · {dayLabel(cycle.start)}</span>}
        </div>
      </section>
    </div>
    <div className="deck-details">
      <CategoryComparison loading={historyLoading} data={pace} allocation={allocation} cycle={cycle} currency={currency} />
      <section className="panel deck-bills">
        <div className="panel-head"><div><div className="deck-kicker">BEFORE PAYDAY</div><h2>Bills &amp; income</h2>{account && <p>Through {dayLabel(cycle.nextPayday)} from this account</p>}</div><span className="calendar-icon"><ListChecks size={18} /></span></div>
        {runway?.timeline.length ? <ul>{runway.timeline.slice(0, 8).map((bill) => <li key={bill.key}>
          <div><strong>{bill.label}</strong><small>{bill.dueDate < today ? 'Past expected date' : dayLabel(bill.dueDate)} · {bill.onHold ? 'Pending hold' : bill.source}</small></div>
          <b className={bill.kind === 'income' ? 'positive' : ''}>{bill.kind === 'income' ? '+' : '−'}{amount(bill.amountMinor, currency)}</b>
        </li>)}</ul> : <Empty icon={runway ? ListChecks : CircleAlert} title={runway ? 'No dated activity in this window' : 'Bills will appear here'} />}
        <button className="text-button" onClick={() => go('paychecks', 'calendar')}>Open cash calendar <ArrowRight size={16} /></button>
      </section>
    </div>
  </div>;
}
