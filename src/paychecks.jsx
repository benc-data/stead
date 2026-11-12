import { useState } from 'react';
import {
  ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, CircleDollarSign, Clock3,
  PiggyBank, Plus, Settings2, Sparkles, Target, Wallet,
} from 'lucide-react';
import { dateKey, fromMinor } from '../functions/domain.js';
import { buildCashPlan, goalPace, monthDays, paydays } from '../functions/planner.js';
import { cycleCategoryPace, paycheckCycle } from '../functions/cockpit.js';
import { isDemo } from './data.js';
import { FundForm, GoalForm, PlanForm, ScheduleForm } from './planner-forms.jsx';
import { dayLabel, Empty, money, MonthPicker } from './ui.jsx';

const moneyUnits = (amount, currency) => money(fromMinor(amount, currency), currency);
const signedAmount = (item, currency) => `${item.kind === 'expense' ? '−' : '+'}${moneyUnits(item.amountMinor, currency)}`;
const nextMonth = (month, shift) => {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + shift, 1)).toISOString().slice(0, 7);
};

function Calendar({ month, moveMonth, day, setDay, today, entries, add, currency }) {
  const first = `${month}-01`;
  const days = monthDays(month);
  const start = new Date(`${first}T00:00:00Z`).getUTCDay();
  const checks = new Set(paydays(first, `${month}-${days}`).map(({ dueDate }) => dueDate));
  const daily = entries.filter((item) => item.dueDate === day);
  return <section className="panel plan-panel calendar-panel">
    <div className="panel-head"><div><h2>Cash calendar</h2><p>Tap a day to see or add expected activity.</p></div><span className="calendar-icon"><CalendarDays size={18} /></span></div>
    <div className="calendar-controls"><MonthPicker month={month} earliest="2000-01" latest="2199-12" onMove={moveMonth} /></div>
    <div className="calendar-grid" aria-label="Calendar days">
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => <span className="calendar-weekday" key={label}>{label}</span>)}
      {Array.from({ length: start }, (_, i) => <span key={`blank-${i}`} />)}
      {Array.from({ length: days }, (_, i) => {
        const key = `${month}-${String(i + 1).padStart(2, '0')}`;
        const events = entries.filter((item) => item.dueDate === key);
        return <button type="button" key={key} aria-pressed={key === day} aria-current={key === today ? 'date' : undefined}
          aria-label={`${dayLabel(key)}${checks.has(key) ? ', payday' : ''}${events.length ? `, ${events.length} expected ${events.length === 1 ? 'item' : 'items'}` : ''}`}
          onClick={() => setDay(key)}><span>{i + 1}</span><span className="day-markers">
            {checks.has(key) && <i className="payday-dot" />}
            {events.some((item) => item.kind === 'expense' && !item.matchedTransactionKey) && <i className="expense-dot" />}
            {events.some((item) => item.kind === 'income' && !item.matchedTransactionKey) && <i className="income-dot" />}
            {events.some((item) => item.matchedTransactionKey) && <i className="matched-dot" />}
          </span></button>;
      })}
    </div>
    <div className="calendar-legend"><span><i className="payday-dot" /> Payday</span><span><i className="expense-dot" /> Expense</span><span><i className="income-dot" /> Income</span><span><i className="matched-dot" /> Matched</span></div>
    <div className="calendar-detail">
      <div className="panel-head"><h3>{dayLabel(day)}</h3><button className="text-button" onClick={() => add()}><Plus size={16} /> Add item</button></div>
      {daily.length ? daily.map((item) => <PlannedRow key={item.key} item={item} currency={currency} edit={add} />) :
        <p>{checks.has(day) ? 'Scheduled payday. Deposit estimates are shown in the paycheck plan.' : 'No items on this day.'}</p>}
    </div>
  </section>;
}

function PlannedRow({ item, currency, edit }) {
  const matched = Boolean(item.matchedTransactionKey);
  const Icon = matched ? Check : item.kind === 'expense' ? ArrowUpRight : ArrowDownLeft;
  const editable = item.source !== 'Recurring' && item.source !== 'Paycheck schedule' && item.source !== 'Estimated paycheck' && !matched && edit;
  const content = <>
    <span className={`category-icon ${matched || item.kind === 'income' ? 'mint' : 'sand'}`}><Icon size={17} /></span>
    <span className="plan-item-name"><strong>{item.label}</strong><small>{matched
      ? `Matched ${dayLabel(item.matchedDate)} · ${moneyUnits(item.matchedAmountMinor, currency)} posted`
      : `${dayLabel(item.dueDate)} · ${item.source ?? 'Planned'}${item.effectiveDate && item.dueDate < item.effectiveDate ? ' · overdue' : ''}`}</small></span>
    <span className="plan-item-amount"><strong className={item.kind === 'income' ? 'positive' : ''}>{signedAmount(item, currency)}</strong>
      {item.balance != null && <small>{moneyUnits(item.balance, currency)} available</small>}</span>
  </>;
  return editable ? <button className="planned-row plan-edit" onClick={() => edit(item)}>{content}</button> :
    <div className="planned-row">{content}</div>;
}

function CashProjection({ plan, account, editSchedule, editItem }) {
  const currency = account.currency;
  const missing = plan.checks.some((item) => item.total === 0 && item.source === 'Estimated paycheck');
  const short = plan.lowestUnallocated < 0;
  return <section className="panel plan-panel projection-panel" id="paycheck-runway">
    <div className="panel-head">
      <div><h2>Paycheck runway</h2><p>Through {dayLabel(plan.through)} · {account.name}</p></div>
      <button className="icon-button" aria-label="Edit paycheck amounts" onClick={editSchedule}><Settings2 size={18} /></button>
    </div>
    <div className={`runway-status ${short ? 'shortfall' : ''}`}>
      <div><span>{short ? 'Known-bill gap' : 'Lowest cash after known bills'}</span><strong>{moneyUnits(Math.abs(plan.lowestUnallocated), currency)}</strong></div>
      <span>{dayLabel(plan.lowestDate)}</span>
    </div>
    <dl className="runway-summary">
      <div><dt>Starting bank balance</dt><dd>{moneyUnits(plan.starting, currency)}</dd></div>
      <div><dt>In savings buckets</dt><dd>{moneyUnits(plan.earmarked, currency)}</dd></div>
      <div><dt>Projected available on {dayLabel(plan.through)}</dt><dd>{moneyUnits(plan.balance, currency)}</dd></div>
    </dl>
    {missing && <p className="notice"><Clock3 size={15} /> Add take-home pay to include paydays while Stead learns your deposit pattern.</p>}
    <div className="payday-chips">{plan.checks.map((item) => <span key={item.key}>
      <CalendarDays size={15} /><span>{dayLabel(item.dueDate)}<small>{item.manuallyListed ? 'On calendar' : item.received && !item.amountMinor ? 'Received' : item.total
        ? moneyUnits(item.amountMinor, currency) : item.source === 'Estimated paycheck' ? 'No estimate yet' : 'No deposit scheduled'}</small></span></span>)}</div>
    <h3 className="timeline-heading">Expected activity</h3>
    {plan.timeline.length ? <div className="plan-timeline">{plan.timeline.map((item) =>
      <PlannedRow item={item} currency={currency} edit={item.source === 'Planned' ? editItem : null} key={item.key} />)}</div>
      : <p className="empty-line">Add expenses to the calendar to see their effect here.</p>}
    <p className="projection-note">Uses the last bank balance{account.balanceDate ? ` from ${dayLabel(dateKey(account.balanceDate))}` : ''}. Holds and savings are reserved. Expenses come before deposits on the same day. Unlisted purchases are not included. The optional spending estimate is on Overview.</p>
  </section>;
}

function SavingsGoals({ goals, accounts, today, add, edit, fund }) {
  return <section className="panel plan-panel savings-panel">
    <div className="panel-head"><div><h2>Savings buckets</h2><p>Give the money you set aside a purpose.</p></div><button className="button primary" onClick={add}><Plus size={16} /> New goal</button></div>
    {goals.length ? <div className="goal-grid">{[...goals].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((goal) => {
      const pace = goalPace(goal, today);
      const account = accounts.find(({ key }) => key === goal.accountId);
      const progress = Math.min(100, Math.floor(goal.savedMinor / goal.targetMinor * 100));
      return <article className="goal-card" key={goal.key}>
        <div className="goal-top"><span className="category-icon mint"><Target size={19} /></span><button className="icon-button" aria-label={`Edit ${goal.label}`} onClick={() => edit(goal)}><Settings2 size={17} /></button></div>
        <h3>{goal.label}</h3>
        <p>{account?.name ?? 'Account'} · by {dayLabel(goal.dueDate)}</p>
        <div className="goal-amount"><strong>{moneyUnits(goal.savedMinor, goal.currency)}</strong><span> of {moneyUnits(goal.targetMinor, goal.currency)}</span></div>
        <div className="goal-meter" role="progressbar" aria-label={goal.label} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>
        <p>{!pace.remaining ? 'Goal funded' : pace.overdue ? `${moneyUnits(pace.remaining, goal.currency)} still to set aside` :
          `Set aside ${moneyUnits(pace.weeklyMinor, goal.currency)} per week to hit this goal.`}</p>
        <button className="button" onClick={() => fund(goal)}><Plus size={15} /> Set aside or release</button>
      </article>;
    })}</div> : <Empty icon={PiggyBank} title="Your first savings goal">Pick a target and a date, then add to it as money comes in.</Empty>}
  </section>;
}

function Coach({ data, plan, account, rows, settings, goals, today, onOverview, go }) {
  const [note, setNote] = useState(null);
  const [enabled, setEnabled] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const cycle = paycheckCycle({ rows, account, settings, today });
  const above = cycleCategoryPace(rows, account.currency, cycle, today)
    .comparisons.find((item) => item.priorTrend === 'above' && item.averageTrend === 'above');
  const upcoming = goals.filter((goal) => goal.accountId === account.key && goalPace(goal, today).remaining)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await data.save('coach', null, { enabled: isDemo ? false : enabled ?? data.coach.enabled ?? true, note: (note ?? data.coach.note ?? '').trim() });
      setMessage('Household note saved.');
    } catch (error) {
      setMessage(error.message || 'Could not save the note.');
    } finally {
      setSaving(false);
    }
  }

  const items = [
    [Wallet, 'Check my cash runway', plan.lowestUnallocated < 0
      ? `The plan shows a ${moneyUnits(-plan.lowestUnallocated, account.currency)} gap on ${dayLabel(plan.lowestDate)} after savings.`
      : `Your lowest projected available balance is ${moneyUnits(plan.lowestUnallocated, account.currency)} on ${dayLabel(plan.lowestDate)}.`, () => go('calendar')],
    [CircleDollarSign, 'Compare my spending', above
      ? `${above.category} is above last month and the three-month average at this point in the cycle.`
      : 'See how each category compares at the same point after payday.', onOverview],
    [Target, 'Keep a savings goal on pace', upcoming
      ? `${upcoming.label} has ${moneyUnits(goalPace(upcoming, today).remaining, upcoming.currency)} left to fund.`
      : 'Choose a target and a date to see the weekly savings needed.', () => go('goals')],
  ];
  return <div className="coach-layout">
    <section className="panel plan-panel coach-panel"><div className="panel-head"><div><h2>What do you want to check?</h2><p>These observations update with your plan.</p></div><span className="calendar-icon"><Sparkles size={18} /></span></div>
      {items.map(([Icon, title, detail, onClick]) => <button className="coach-option" key={title} onClick={onClick}>
        <span className="category-icon mint"><Icon size={18} /></span><span><strong>{title}</strong><small>{detail}</small></span><ArrowRight size={16} />
      </button>)}
    </section>
    <section className="panel plan-panel coach-panel">
      <div className="panel-head"><div><h2>Household notes</h2><p>Tell the coach about an upcoming trip or change in spending.</p></div></div>
      <form onSubmit={submit}>
        <label className="field">What’s coming up?<textarea value={note ?? data.coach.note ?? ''} maxLength={600} rows={3}
          onChange={(event) => setNote(event.target.value)} placeholder="e.g. We’re taking a trip in three weeks and want to save $500." /></label>
        {!isDemo && <label className="checkbox"><input type="checkbox" checked={enabled ?? data.coach.enabled ?? true} onChange={(event) => setEnabled(event.target.checked)} />
          Use Gemini for a nightly brief with this note and budget summaries.</label>}
        <button className="button" disabled={saving}>{saving ? 'Saving…' : 'Save note'}</button>
        {message && <p role="status">{message}</p>}
      </form>
      {data.coach.enabled !== false && data.brief.forecastVersion === 2 && data.brief.text && <div className="coach-brief"><h3>Nightly brief · {dayLabel(data.brief.date)}</h3><p>{data.brief.text}</p></div>}
      <p className="projection-note">Add a planned item or a savings goal to include it in the numbers.</p>
    </section>
  </div>;
}

export default function Paychecks({ accounts, rows, forecasts, today, onOverview, data, initialTab, initialAccountId }) {
  const [tab, setTab] = useState(initialTab);
  const [accountId, setAccountId] = useState(initialAccountId);
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [dialog, setDialog] = useState(null);
  const account = accounts.find(({ key }) => key === accountId) ??
    accounts.find(({ name }) => /checking|current account/i.test(name)) ?? accounts[0];
  if (!account) return <section className="panel"><Empty icon={Wallet} title="Connect a cash account">Paycheck projections start from a synced bank balance.</Empty></section>;
  const settings = data.schedules.find((item) => item.key === account.key);
  const plan = buildCashPlan({ account, settings, plans: data.plans, forecasts, transactions: rows, goals: data.goals, today });
  const entries = [
    ...data.plans.filter((item) => item.accountId === account.key && item.currency === account.currency),
    ...plan.timeline.filter((item) => item.source === 'Recurring'),
  ];
  const close = () => setDialog(null);
  const editItem = (item) => setDialog({ kind: 'plan', item });
  const changeMonth = (shift) => {
    const next = nextMonth(month, shift);
    setMonth(next);
    setDay(next === today.slice(0, 7) ? today : `${next}-01`);
  };

  return <>
    <div className="planner-toolbar">
      <div className="segmented planner-tabs" aria-label="Paychecks views">
        {[['calendar', 'Calendar', CalendarDays], ['goals', 'Savings goals', PiggyBank], ['coach', 'Coach', Sparkles]].map(([key, label, Icon]) =>
          <button key={key} aria-pressed={key === tab} onClick={() => setTab(key)}><Icon size={15} /> {label}</button>)}
      </div>
      {tab !== 'goals' && <label className="account-filter"><Wallet size={16} /><select aria-label="Cash account" value={account.key} onChange={(event) => setAccountId(event.target.value)}>
        {accounts.map((item) => <option value={item.key} key={item.key}>{item.name}</option>)}
      </select></label>}
    </div>
    {data.error && <p className="notice error" role="alert">{data.error}</p>}
    {tab === 'calendar' ? <>
      <button className={`mobile-runway ${plan.lowestUnallocated < 0 ? 'shortfall' : ''}`}
        onClick={() => document.getElementById('paycheck-runway')?.scrollIntoView({ block: 'start' })}>
        <span><span>{plan.lowestUnallocated < 0 ? 'Projected gap' : 'Lowest available to spend'}</span>
          <strong>{moneyUnits(Math.abs(plan.lowestUnallocated), account.currency)}</strong></span>
        <span>{dayLabel(plan.lowestDate)} <ArrowRight size={15} /></span>
      </button>
      <div className="plan-grid">
        <Calendar month={month} moveMonth={changeMonth} day={day} setDay={setDay} today={today} entries={entries} add={editItem} currency={account.currency} />
        <CashProjection plan={plan} account={account} editSchedule={() => setDialog({ kind: 'schedule' })} editItem={editItem} />
      </div>
      {entries.some((item) => item.matchedTransactionKey) && <section className="panel plan-panel matched-panel">
        <div className="panel-head"><div><h2>Recently matched</h2><p>Expected items found in posted bank activity</p></div><span className="calendar-icon"><Check size={18} /></span></div>
        {entries.filter((item) => item.matchedTransactionKey).sort((a, b) => b.matchedDate.localeCompare(a.matchedDate)).slice(0, 5)
          .map((item) => <PlannedRow item={item} currency={account.currency} key={item.key} />)}
      </section>}
    </> : tab === 'goals' ? <SavingsGoals goals={data.goals} accounts={accounts} today={today}
      add={() => setDialog({ kind: 'goal' })} edit={(goal) => setDialog({ kind: 'goal', goal })} fund={(goal) => setDialog({ kind: 'fund', goal })} />
      : <Coach data={data} plan={plan} account={account} rows={rows} settings={settings} goals={data.goals} today={today} onOverview={onOverview} go={setTab} />}
    {dialog?.kind === 'plan' && <PlanForm item={dialog.item} account={account} day={day} data={data} onClose={close} />}
    {dialog?.kind === 'schedule' && <ScheduleForm account={account} settings={settings} plan={plan} data={data} onClose={close} />}
    {dialog?.kind === 'goal' && <GoalForm goal={dialog.goal} accounts={accounts} initialAccount={account} today={today} data={data} onClose={close} />}
    {dialog?.kind === 'fund' && <FundForm goal={dialog.goal} data={data} onClose={close} />}
  </>;
}
