import { categoriesInRows } from './categories.js';
import { dateKey, expenseMinor, fromMinor, shiftDays, toMinor, vendorKey } from './domain.js';

const dayMillis = 86400000;
const dateMillis = (key) => Date.parse(`${key}T00:00:00Z`);
const dayDistance = (first, second) => (dateMillis(first) - dateMillis(second)) / dayMillis;
const paydaySlots = ['midmonth', 'monthEnd'];

export function monthDays(month) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}

export function paydays(from, through) {
  const dates = [];
  let month = from.slice(0, 7);
  while (month <= through.slice(0, 7)) {
    for (const [index, day] of [15, monthDays(month)].entries()) {
      const dueDate = `${month}-${day}`;
      if (dueDate >= from && dueDate <= through) dates.push({ dueDate, slot: paydaySlots[index] });
    }
    month = shiftDays(`${month}-${monthDays(month)}`, 1).slice(0, 7);
  }
  return dates;
}

export function categoryComparisons(rows, currency, month, today) {
  const currentDay = month === today.slice(0, 7) ? Number(today.slice(-2)) : 31;
  const previous = [];
  let first = `${month}-01`;
  for (let i = 0; i < 3; i++) {
    first = `${shiftDays(first, -1).slice(0, 7)}-01`;
    previous.push(first);
  }
  const periods = [`${month}-01`, ...previous];
  const totals = new Map(periods.map((period) => [period, new Map()]));
  let earliest;
  for (const row of rows) {
    if (row.pending || row.currency !== currency || !row.postedDate) continue;
    const date = dateKey(row.postedDate);
    if (date > today) continue;
    if (!earliest || date < earliest) earliest = date;
    const bucket = totals.get(`${date.slice(0, 7)}-01`);
    if (!bucket || row.amountMinor >= 0 || Number(date.slice(-2)) > currentDay) continue;
    const splits = row.isSplit ? row.splits : [{ category: row.category, amount: row.amount }];
    for (const split of splits ?? []) {
      if (split.category === 'Transfer') continue;
      const amount = toMinor(split.amount, currency);
      if (amount != null) bucket.set(split.category, (bucket.get(split.category) ?? 0) + Math.max(0, -amount));
    }
  }
  const comparable = previous.filter((period) => earliest && earliest <= period);
  const baseline = (period, category) => totals.get(period)?.get(category) ?? 0;
  const aboutSame = (amount, reference) => {
    if (reference == null) return null;
    const threshold = Math.max(toMinor(5, currency), Math.abs(reference) * 0.05);
    return Math.abs(amount - reference) <= threshold ? 'same' : amount > reference ? 'above' : 'below';
  };
  const comparisons = categoriesInRows(rows).map((category) => {
    const current = baseline(periods[0], category);
    const prior = comparable.includes(previous[0]) ? baseline(previous[0], category) : null;
    const average = comparable.length ? comparable.reduce((sum, period) => sum + baseline(period, category), 0) / comparable.length : null;
    return {
      category, current: fromMinor(current, currency),
      prior: prior == null ? null : fromMinor(prior, currency),
      average: average == null ? null : fromMinor(average, currency),
      priorTrend: aboutSame(current, prior), averageTrend: aboutSame(current, average),
    };
  }).filter((row) => row.current || row.prior || row.average);
  return {
    comparisons: comparisons.sort((a, b) => Math.max(b.current, b.prior ?? 0, b.average ?? 0) - Math.max(a.current, a.prior ?? 0, a.average ?? 0)),
    baselineMonths: comparable.length,
  };
}

const ignoredWords = new Set(['payment', 'bill', 'charge', 'card', 'online', 'monthly', 'autopay', 'annual', 'inc', 'llc']);

export function similarVendor(a, b) {
  const leftKey = vendorKey(a);
  const rightKey = vendorKey(b);
  if (leftKey && leftKey === rightKey) return true;
  const meaningful = (key) => [...new Set(key.split(' ').filter((word) => word.length > 2 && !ignoredWords.has(word)))];
  const left = meaningful(leftKey);
  const right = meaningful(rightKey);
  if (!left.length || !right.length) return false;
  const shared = left.filter((word) => right.includes(word)).length;
  const shorter = Math.min(left.length, right.length);
  return shared >= shorter && (shared >= 2 || left[0] === right[0]);
}

export function matchesPlan(plan, row) {
  if (plan.matchedTransactionKey || row.planMatchKey || row.pending || !row.postedDate ||
    plan.accountId !== row.accountId || plan.currency !== row.currency ||
    Math.sign(row.amountMinor) !== (plan.kind === 'income' ? 1 : -1)) return false;
  const difference = dayDistance(dateKey(row.postedDate), plan.dueDate);
  return difference >= -3 && difference <= 7 &&
    Math.abs(plan.amountMinor - Math.abs(row.amountMinor)) <= toMinor(5, plan.currency) &&
    (similarVendor(plan.label, row.payee) || similarVendor(plan.label, row.description ?? ''));
}

export function findPlanMatches(plans, rows) {
  const choices = new Map();
  const timesChosen = new Map();
  for (const plan of plans) {
    const candidates = rows.filter((row) => matchesPlan(plan, row));
    choices.set(plan.key, candidates);
    for (const row of candidates) timesChosen.set(row.key, (timesChosen.get(row.key) ?? 0) + 1);
  }
  return plans.flatMap((plan) => {
    const candidates = choices.get(plan.key);
    if (candidates.length !== 1 || timesChosen.get(candidates[0].key) !== 1) return [];
    return [{ plan, row: candidates[0] }];
  });
}

function median(numbers) {
  const ordered = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : Math.round((ordered[middle - 1] + ordered[middle]) / 2);
}

export function paycheckEstimates(rows, accountId, today) {
  const earliest = shiftDays(today, -135);
  const slots = paydays(shiftDays(earliest, -3), shiftDays(today, 3));
  const buckets = { midmonth: new Map(), monthEnd: new Map() };
  for (const row of rows) {
    if (row.accountId !== accountId || row.pending || row.amountMinor <= 0 ||
      row.category !== 'Income' || !row.postedDate || !row.vendorKey) continue;
    const date = dateKey(row.postedDate);
    if (date < earliest || date > today) continue;
    const slot = slots.find(({ dueDate }) => Math.abs(dayDistance(date, dueDate)) <= 3);
    if (!slot) continue;
    const bucket = buckets[slot.slot];
    if (!bucket.has(row.vendorKey)) bucket.set(row.vendorKey, new Map());
    const periods = bucket.get(row.vendorKey);
    if (!periods.has(slot.dueDate)) periods.set(slot.dueDate, []);
    periods.get(slot.dueDate).push(row);
  }
  return Object.fromEntries(paydaySlots.map((slot) => {
    const estimates = [];
    for (const [vendor, periods] of buckets[slot]) {
      const groups = [...periods.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 4);
      if (groups.length < 2) continue;
      const amounts = groups.map(([, deposits]) => deposits.reduce((sum, row) => sum + row.amountMinor, 0));
      const typical = median(amounts);
      if (amounts.filter((amount) => Math.abs(amount - typical) <= typical * 0.2).length < 2) continue;
      estimates.push({ vendor, amountMinor: typical });
    }
    return [slot, estimates];
  }));
}

function recurringEntries(forecasts, account, today, through) {
  const items = [];
  const intervals = { weekly: 7, biweekly: 14 };
  for (const forecast of forecasts) {
    if (!forecast.isActive || forecast.accountId !== account.key || forecast.currency !== account.currency ||
      !forecast.typicalAmount || forecast.dueDate < shiftDays(today, -3)) continue;
    let date = forecast.dueDate;
    const startDay = Number(date.slice(-2));
    while (date <= through) {
      items.push({
        key: `recurring-${forecast.id}-${date}`, dueDate: date, label: forecast.payee,
        amountMinor: Math.abs(toMinor(forecast.typicalAmount, account.currency)),
        kind: forecast.typicalAmount < 0 ? 'expense' : 'income', source: 'Recurring',
      });
      if (intervals[forecast.cadence]) {
        date = shiftDays(date, intervals[forecast.cadence]);
        continue;
      }
      if (!['monthly', 'annual'].includes(forecast.cadence)) break;
      const [year, month] = date.split('-').map(Number);
      const next = new Date(Date.UTC(year, month - 1 + (forecast.cadence === 'monthly' ? 1 : 12), 1)).toISOString().slice(0, 7);
      date = `${next}-${String(Math.min(startDay, monthDays(next))).padStart(2, '0')}`;
    }
  }
  return items;
}

// All balances below are spendable cash, after holds and savings. No estimated
// everyday spending is mixed into this dated obligations ledger.
export function buildCashPlan({ account, settings, plans, forecasts, transactions, goals, today, through: requestedThrough }) {
  const schedule = paydays(today, shiftDays(today, 50)).slice(0, 2);
  const through = requestedThrough ?? schedule.at(-1).dueDate;
  const estimates = paycheckEstimates(transactions, account.key, today);
  const listed = plans.filter((item) => item.accountId === account.key && item.currency === account.currency);
  const planned = listed.filter((item) => !item.matchedTransactionKey && item.dueDate <= through && (item.kind === 'expense' || item.dueDate >= today));
  const payrollVendors = new Set(Object.values(estimates).flat().map(({ vendor }) => vendor));
  const recurring = recurringEntries(forecasts, account, today, through).filter((item) => {
    if (item.kind === 'income' && (payrollVendors.has(vendorKey(item.label)))) return false;
    return !listed.some((plan) => plan.kind === item.kind && Math.abs(dayDistance(plan.dueDate, item.dueDate)) <= 3 &&
      Math.abs(plan.amountMinor - item.amountMinor) <= toMinor(5, account.currency) && similarVendor(plan.label, item.label));
  });
  const checks = schedule.map((entry) => {
    const estimatesForSlot = estimates[entry.slot];
    const manual = settings?.[`${entry.slot}Minor`];
    const total = manual ?? estimatesForSlot.reduce((sum, row) => sum + row.amountMinor, 0);
    const recent = transactions.filter((row) => row.accountId === account.key && !row.pending && row.amountMinor > 0 &&
      row.postedDate && dateKey(row.postedDate) <= today && Math.abs(dayDistance(dateKey(row.postedDate), entry.dueDate)) <= 3);
    const posted = recent.filter((row) => estimatesForSlot.some(({ vendor }) => vendor === row.vendorKey));
    const exactManual = manual && !posted.length ? recent.filter((row) =>
      row.category === 'Income' && Math.abs(row.amountMinor - manual) <= toMinor(5, account.currency)) : [];
    const received = posted.reduce((sum, row) => sum + row.amountMinor, 0) + (exactManual.length === 1 ? exactManual[0].amountMinor : 0);
    const manuallyListed = listed.some((item) => item.kind === 'income' && Math.abs(dayDistance(item.dueDate, entry.dueDate)) <= 3 &&
      (similarVendor(item.label, 'Paycheck') || payrollVendors.has(vendorKey(item.label))) && Math.abs(item.amountMinor - total) <= toMinor(5, account.currency));
    return {
      ...entry, key: `pay-${entry.dueDate}`, label: 'Paycheck',
      kind: 'income', source: manual != null ? 'Paycheck schedule' : 'Estimated paycheck',
      amountMinor: manuallyListed ? 0 : Math.max(0, total - received), total, received, manuallyListed,
    };
  });
  const earmarked = goals.filter((goal) => goal.accountId === account.key && goal.currency === account.currency)
    .reduce((sum, goal) => sum + goal.savedMinor, 0);
  const starting = toMinor(account.balance, account.currency) ?? 0;
  const entries = [...planned.map((item) => ({ ...item, source: 'Planned' })), ...recurring.filter((item) => item.kind !== 'income' || !checks.some((check) =>
      (check.amountMinor > 0 || check.received || check.manuallyListed) && /\b(payroll|paycheck|salary)\b/i.test(item.label) &&
      Math.abs(dayDistance(check.dueDate, item.dueDate)) <= 3 && Math.abs(check.total - item.amountMinor) <= toMinor(5, account.currency))),
    ...checks.filter((item) => item.amountMinor > 0 && item.dueDate <= through)]
    .map((item) => ({ ...item, effectiveDate: item.dueDate < today ? today : item.dueDate }))
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || (a.kind === b.kind ? 0 : a.kind === 'expense' ? -1 : 1));
  let pending = 0;
  const covered = new Map();
  for (const row of transactions) {
    if (row.accountId !== account.key || row.currency !== account.currency || !row.pending || row.amountMinor >= 0) continue;
    pending -= row.amountMinor;
    const possible = entries.filter((item) => item.kind === 'expense' && !covered.has(item.key) &&
      (!row.postedDate || Math.abs(dayDistance(item.dueDate, dateKey(row.postedDate))) <= 7) &&
      Math.abs(item.amountMinor + row.amountMinor) <= toMinor(5, account.currency) && similarVendor(item.label, row.payee));
    if (possible.length === 1) covered.set(possible[0].key, -row.amountMinor);
  }
  const available = toMinor(account.availableBalance, account.currency);
  const held = Math.max(0, pending, available == null ? 0 : starting - available);
  const opening = starting - earmarked - held;
  let balance = opening;
  let lowest = opening;
  let lowestDate = today;
  let firstGap = opening < 0 ? today : null;
  let expected = 0;
  let income = 0;
  const points = [{ date: today, committed: opening, label: 'Cash after holds & savings' }];
  const timeline = [];
  for (let day = today; day <= through; day = shiftDays(day, 1)) {
    const daily = entries.filter((item) => item.effectiveDate === day);
    for (const item of daily) {
      const onHold = item.kind === 'expense' ? Math.min(item.amountMinor, covered.get(item.key) ?? 0) : 0;
      const stillDue = item.amountMinor - onHold;
      balance += stillDue * (item.kind === 'expense' ? -1 : 1);
      if (item.kind === 'expense') expected += stillDue;
      else income += stillDue;
      if (balance < lowest) { lowest = balance; lowestDate = day; }
      if (balance < 0 && !firstGap) firstGap = day;
      timeline.push({ ...item, onHold, stillDue, balance });
      points.push({ date: day, committed: balance, label: item.label, kind: item.kind });
    }
    if (!daily.length && day !== today) points.push({ date: day, committed: balance });
  }
  return {
    timeline, checks, through, earliestPayday: checks[0].dueDate, starting, opening, held, balance,
    lowest, lowestDate, firstGap, earmarked, lowestUnallocated: lowest, estimates, points, expected, income,
  };
}

export function goalPace(goal, today) {
  const remaining = Math.max(0, goal.targetMinor - goal.savedMinor);
  const weeks = Math.max(1, Math.ceil(dayDistance(goal.dueDate, today) / 7));
  return { remaining, weeklyMinor: Math.ceil(remaining / weeks), overdue: goal.dueDate < today && remaining > 0 };
}
