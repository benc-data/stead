import { dateKey, expenseMinor, fromMinor, shiftDays, toMinor } from './domain.js';
import { categoriesInRows } from './categories.js';
import { buildCashPlan, paydays, paycheckEstimates, similarVendor } from './planner.js';

const dayMillis = 86400000;
const distance = (from, to) => (Date.parse(to) - Date.parse(from)) / dayMillis;
const essentials = new Set(['Groceries', 'Household Goods', 'Housing', 'Transportation', 'Health', 'Utilities']);

export function orderAccounts(accounts, ids = []) {
  const ranks = new Map(ids.map((id, index) => [id, index]));
  return [...accounts].sort((a, b) => (ranks.get(a.key) ?? Infinity) - (ranks.get(b.key) ?? Infinity)
    || a.name.localeCompare(b.name));
}

export function moveAccount(accounts, ids, key, offset) {
  const next = orderAccounts(accounts, ids).map((account) => account.key);
  const index = next.indexOf(key);
  if (index >= 0 && index + offset >= 0 && index + offset < next.length) {
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
  }
  return next;
}

export function cashAccount(accounts, currency, schedules, preferred) {
  const eligible = accounts.filter((account) => account.currency === currency);
  return eligible.find((account) => account.key === preferred)
    ?? eligible.find((account) => schedules.some(({ key }) => key === account.key))
    ?? eligible.find(({ name }) => /checking|current account/i.test(name))
    ?? eligible.find(({ balance }) => balance >= 0)
    ?? eligible[0];
}

export function paycheckCycle({ rows, account, settings, today }) {
  const slots = paydays(shiftDays(today, -422), shiftDays(today, 33));
  const deposits = new Map();
  const estimates = account ? paycheckEstimates(rows, account.key, today) : {};
  for (const row of rows) {
    if (!account || row.accountId !== account.key || row.currency !== account.currency ||
        row.pending || row.amountMinor <= 0 || row.category !== 'Income' || !row.postedDate) continue;
    const date = dateKey(row.postedDate);
    if (date > today) continue;
    const slot = slots.find(({ dueDate }) => Math.abs(distance(dueDate, date)) <= 3);
    if (!slot) continue;
    const estimate = estimates[slot.slot]?.find(({ vendor }) => vendor === row.vendorKey);
    const manual = settings?.[`${slot.slot}Minor`];
    const close = manual > 0 && Math.abs(row.amountMinor - manual) <= toMinor(5, row.currency);
    if (!estimate && !close) continue;
    if (!deposits.has(slot.dueDate)) deposits.set(slot.dueDate, []);
    deposits.get(slot.dueDate).push({ date, estimate: Boolean(estimate) });
  }

  const anchors = slots.map((slot) => {
    const candidates = deposits.get(slot.dueDate) ?? [];
    const regular = candidates.filter(({ estimate }) => estimate);
    const verified = regular.length ? regular : candidates;
    const dates = new Set(verified.map(({ date }) => date));
    const posted = dates.size === 1 ? verified[0].date : null;
    return { ...slot, start: posted ?? slot.dueDate, posted: Boolean(posted) };
  });
  // A scheduled deposit that is due today is still ahead until we see it post.
  const index = anchors.findLastIndex(({ start, posted }) => start < today || (start === today && posted));
  const current = anchors[index];
  const next = anchors[index + 1];
  const elapsed = distance(current.start, today);
  const peers = anchors.slice(0, index).filter(({ slot }) => slot === current.slot);
  const reference = (peer) => {
    if (!peer) return null;
    const end = shiftDays(peer.start, elapsed);
    const following = anchors[anchors.indexOf(peer) + 1];
    return following && end < following.start ? { start: peer.start, end } : null;
  };
  return {
    start: current.start, posted: current.posted, day: elapsed + 1, elapsed, nextPayday: next.start,
    prior: reference(peers.at(-1)),
    average: peers.slice(-3).map(reference).filter(Boolean),
    year: reference(peers.at(-12)),
    historicalCycles: peers.slice(-3).map((peer) => ({
      start: peer.start, end: shiftDays(anchors[anchors.indexOf(peer) + 1].start, -1),
    })),
  };
}

function totalsByCategory(rows) {
  const totals = new Map();
  for (const row of rows) {
    if (row.amountMinor >= 0) continue;
    const splits = row.isSplit ? row.splits ?? [] : [{ category: row.category, amount: row.amount }];
    for (const { category, amount } of splits) {
      if (!category || ['Income', 'Transfer'].includes(category)) continue;
      const units = toMinor(amount, row.currency);
      if (units < 0) totals.set(category, (totals.get(category) ?? 0) - units);
    }
  }
  return totals;
}

export function cycleCategoryPace(rows, currency, cycle, today) {
  const dated = rows.filter((row) => row.currency === currency && row.postedDate)
    .map((row) => ({ row, date: dateKey(row.postedDate) })).filter(({ date }) => date <= today);
  const posted = dated.filter(({ row }) => !row.pending);
  const earliest = posted.reduce((first, { date }) => !first || date < first ? date : first, null);
  const totals = (period) => period && earliest && earliest <= period.start
    ? totalsByCategory(posted.filter(({ date }) => date >= period.start && date <= period.end).map(({ row }) => row)) : null;
  const thisCycle = dated.filter(({ date }) => date >= cycle.start).map(({ row }) => row);
  const current = dated.length ? totalsByCategory(thisCycle) : null;
  const pending = totalsByCategory(thisCycle.filter((row) => row.pending));
  const prior = totals(cycle.prior);
  const year = totals(cycle.year);
  const averages = cycle.average.map(totals).filter(Boolean);
  const toAmount = (units) => units == null ? null : fromMinor(units, currency);
  const compare = (units, reference) => {
    if (units == null || reference == null) return null;
    const tolerance = Math.max(toMinor(5, currency), reference * .05);
    return Math.abs(units - reference) <= tolerance ? 'same' : units > reference ? 'above' : 'below';
  };
  const comparisons = categoriesInRows(rows).filter((category) => !['Income', 'Transfer'].includes(category)).map((category) => {
    const now = current ? current.get(category) ?? 0 : null;
    const last = prior ? prior.get(category) ?? 0 : null;
    const annual = year ? year.get(category) ?? 0 : null;
    const avg = averages.length
      ? averages.reduce((sum, period) => sum + (period.get(category) ?? 0), 0) / averages.length : null;
    return {
      category, current: toAmount(now), pending: toAmount(pending.get(category) ?? 0), prior: toAmount(last), average: toAmount(avg), year: toAmount(annual),
      priorTrend: compare(now, last), averageTrend: compare(now, avg), yearTrend: compare(now, annual),
    };
  }).filter((row) => row.current || row.prior || row.average || row.year);
  return {
    comparisons: comparisons.sort((a, b) => Math.max(b.current, b.prior, b.average, b.year) - Math.max(a.current, a.prior, a.average, a.year)),
    baselineMonths: averages.length, currentAvailable: Boolean(current), priorAvailable: Boolean(prior), yearAvailable: Boolean(year),
  };
}

export function cycleSpendingPrediction({ rows, account, cycle, forecasts, plans, today, through }) {
  const posted = rows.filter((row) => row.accountId === account.key && row.currency === account.currency && !row.pending && row.postedDate)
    .map((row) => ({ row, date: dateKey(row.postedDate) })).filter(({ date }) => date < today);
  const first = posted.reduce((earliest, { date }) => date < earliest ? date : earliest, today);
  const periods = (cycle.historicalCycles ?? []).filter((period) => first <= period.start);
  const repeating = forecasts.filter((item) => item.isActive && item.accountId === account.key && item.typicalAmount < 0);
  const planned = plans.filter((item) => item.accountId === account.key && item.kind === 'expense');
  const byDate = new Map();
  for (const { row, date } of posted) {
    if (row.planMatchKey || row.isRecurring || repeating.some((item) => similarVendor(item.payee, row.payee)) ||
        planned.some((item) => similarVendor(item.label, row.payee))) continue;
    byDate.set(date, (byDate.get(date) ?? 0) + expenseMinor(row));
  }
  const days = [];
  // Today is already partly spent. Predictions start tomorrow, preserving the
  // observed bank balance instead of estimating the same purchases twice.
  for (let date = shiftDays(today, 1); date < through; date = shiftDays(date, 1)) {
    const offset = distance(cycle.start, date);
    const comparable = periods.map((period) => ({ ...period, date: shiftDays(period.start, offset) }))
      .filter((period) => period.date <= period.end);
    const amountMinor = comparable.length >= 2
      ? Math.round(comparable.reduce((sum, period) => sum + (byDate.get(period.date) ?? 0), 0) / comparable.length) : null;
    days.push({ date, amountMinor, samples: comparable.length });
  }
  return { days, months: periods.length, available: days.length > 0 && days.every((day) => day.amountMinor != null) };
}

export function runwayToPayday({ account, settings, plans, forecasts, rows, goals, today, nextPayday, cycle }) {
  const plan = buildCashPlan({ account, settings, plans, forecasts, transactions: rows, goals, today, through: nextPayday });
  const phase = cycle ?? paycheckCycle({ rows, account, settings, today });
  const prediction = cycleSpendingPrediction({ rows, account, cycle: phase, forecasts, plans, today, through: nextPayday });
  let estimated = 0;
  let lastDate;
  let scenarioLowest = plan.opening;
  const points = plan.points.map((point) => {
    if (point.date !== lastDate) estimated += prediction.days.find((day) => day.date === point.date)?.amountMinor ?? 0;
    lastDate = point.date;
    const projected = point.committed - estimated;
    scenarioLowest = Math.min(scenarioLowest, projected);
    return { ...point, projected };
  });
  return {
    ...plan, nextPayday, days: distance(today, nextPayday), points, committed: plan.balance,
    projected: points.at(-1).projected, estimatedSpending: estimated, prediction, scenarioLowest,
    bills: plan.timeline.filter((item) => item.kind === 'expense'),
    deposits: plan.timeline.filter((item) => item.kind === 'income'),
  };
}

export function categoryRoom({ rows, forecasts, currency, cycle, today, committed }) {
  const start = shiftDays(cycle.start, -28);
  const dated = rows.filter((row) => row.currency === currency && row.postedDate)
    .map((row) => ({ row, date: dateKey(row.postedDate) })).filter(({ date }) => date <= today);
  const earliest = dated.filter(({ row }) => !row.pending).reduce((first, { date }) => !first || date < first ? date : first, null);
  if (!earliest) return null;
  const baseStart = earliest > start ? earliest : start;
  const days = distance(baseStart, cycle.start);
  if (days < 14) return null;
  const recurring = forecasts.filter((item) => item.isActive && item.currency === currency && item.typicalAmount < 0);
  const everyday = dated.filter(({ row }) => !row.planMatchKey && !row.isRecurring &&
    !recurring.some((item) => item.accountId === row.accountId && similarVendor(item.payee, row.payee)));
  const historic = totalsByCategory(everyday.filter(({ date, row }) => !row.pending && date >= baseStart && date < cycle.start).map(({ row }) => row));
  const spent = totalsByCategory(everyday.filter(({ date }) => date >= cycle.start).map(({ row }) => row));
  const length = distance(cycle.start, cycle.nextPayday);
  const room = Math.max(0, committed);
  const items = [...new Set([...historic.keys(), ...spent.keys()])].map((category) => {
    const used = spent.get(category) ?? 0;
    const target = Math.round((historic.get(category) ?? 0) * length / days);
    return { category, spent: used, target, need: Math.max(0, target - used), available: 0 };
  });
  let leftover = room;
  for (const group of [items.filter((item) => essentials.has(item.category)), items.filter((item) => !essentials.has(item.category))]) {
    const need = group.reduce((sum, item) => sum + item.need, 0);
    if (!need || !leftover) continue;
    const pool = Math.min(need, leftover);
    let allocated = 0;
    const fractions = group.map((item) => {
      const share = item.need / need * pool;
      item.available = Math.floor(share);
      allocated += item.available;
      return { item, remainder: share - item.available };
    }).sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < pool - allocated; i++) fractions[i].item.available++;
    leftover -= pool;
  }
  return {
    items: items.sort((a, b) => b.target - a.target || b.spent - a.spent),
    room, allocated: room - leftover, unassigned: leftover,
  };
}
