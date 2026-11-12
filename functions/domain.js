export const CATEGORY_BATCH_LIMIT = 25;

export const categories = [
  'Uncategorized', 'Groceries', 'Dining', 'Household Goods', 'Transportation',
  'Housing', 'Utilities', 'Shopping', 'Health', 'Entertainment', 'Subscriptions',
  'Travel', 'Income', 'Transfer', 'Other',
];

const daySeconds = 86400;
const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function dateKey(seconds) {
  const parts = Object.fromEntries(dateFormat.formatToParts(seconds * 1000).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateParts(key) {
  return key.split('-').map(Number);
}

function civilSeconds(key) {
  const [year, month, day] = dateParts(key);
  return Date.UTC(year, month - 1, day) / 1000;
}

function isoDate(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

export function shiftDays(key, days) {
  return isoDate(civilSeconds(key) + days * daySeconds);
}

function shiftMonth(key, months) {
  const [year, month, day] = dateParts(key);
  const end = new Date(Date.UTC(year, month + months, 0)).getUTCDate();
  return isoDate(Date.UTC(year, month - 1 + months, Math.min(day, end)) / 1000);
}

const currencyDigits = new Map();

export function minorDigits(currency) {
  if (!/^[A-Z]{3}$/.test(currency)) return 2;
  if (!currencyDigits.has(currency)) {
    currencyDigits.set(currency, new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits);
  }
  return currencyDigits.get(currency);
}

export function toMinor(amount, currency) {
  const digits = minorDigits(currency);
  const decimal = String(amount).trim().replace(/^([+-]?)\./, '$1' + '0.');
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!match || /[1-9]/.test((match[3] || '').slice(digits))) return null;
  const units = Number(match[2] + (match[3] || '').slice(0, digits).padEnd(digits, '0'));
  return Number.isSafeInteger(units) ? (match[1] === '-' ? -units : units) : null;
}

export function fromMinor(units, currency) {
  return units / 10 ** minorDigits(currency);
}

export function vendorKey(payee) {
  return payee.normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/^\s*(?:pos debit|debit card purchase|card purchase|purchase authorized on)\s+/u, '')
    .replace(/^\d{1,2}\/\d{1,2}\s+/u, '')
    .replace(/\s+#?\d{3,}(?:\s|$)/gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function smartSplit(transaction, history) {
  const weights = new Map();
  const prior = history.filter((row) =>
    row.key !== transaction.key && !row.pending && row.isSplit && row.splits?.length &&
    row.vendorKey === transaction.vendorKey && row.currency === transaction.currency &&
    Math.sign(row.amountMinor) === Math.sign(transaction.amountMinor),
  ).sort((a, b) => b.postedDate - a.postedDate).slice(0, 5);
  for (const row of prior) {
    for (const split of row.splits) {
      const amount = toMinor(split.amount, row.currency);
      if (amount === null) continue;
      weights.set(split.category, (weights.get(split.category) ?? 0) + Math.abs(amount / row.amountMinor));
    }
  }
  const weightTotal = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  if (!weightTotal) return [];
  const total = Math.abs(transaction.amountMinor);
  const allocated = [...weights].map(([category, weight]) => {
    const exact = total * (weight / weightTotal);
    return { category, units: Math.floor(exact), remainder: exact % 1 };
  });
  const byRemainder = [...allocated].sort((a, b) => b.remainder - a.remainder);
  const unallocated = total - allocated.reduce((sum, row) => sum + row.units, 0);
  for (let i = 0; i < unallocated; i++) byRemainder[i].units++;
  return allocated.filter(({ units }) => units > 0).map(({ category, units }) => ({
    category, amount: fromMinor(units * Math.sign(transaction.amountMinor), transaction.currency), memo: '',
  }));
}

export function expenseMinor(row) {
  if (row.amountMinor >= 0 || (!row.isSplit && row.category === 'Transfer')) return 0;
  const excluded = row.isSplit ? (row.splits ?? [])
    .filter(({ category }) => category === 'Transfer')
    .reduce((sum, split) => sum + Math.abs(toMinor(split.amount, row.currency) ?? 0), 0) : 0;
  return Math.max(0, -row.amountMinor - excluded);
}

export function spending(transactions, currency, month, averageCount, today) {
  const active = month === today.slice(0, 7);
  const monthStart = `${month}-01`;
  const [year, monthNumber] = dateParts(monthStart);
  const end = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const elapsed = active ? dateParts(today)[2] : end;
  const previous = shiftMonth(monthStart, -1).slice(0, 7);
  const months = new Map();
  let earliest;
  for (const row of transactions) {
    if (row.pending || row.currency !== currency || !row.postedDate) continue;
    const key = dateKey(row.postedDate);
    if (key > today) continue;
    if (!earliest || key < earliest) earliest = key;
    const period = key.slice(0, 7);
    if (!months.has(period)) months.set(period, Array(31).fill(0));
    months.get(period)[dateParts(key)[2] - 1] += expenseMinor(row);
  }

  const totals = (period) => {
    let sum = 0;
    return (months.get(period) ?? Array(31).fill(0)).map((amount) => (sum += amount));
  };
  const current = totals(month);
  const prior = earliest && earliest.slice(0, 7) <= previous ? totals(previous) : null;
  const baselines = Array.from({ length: averageCount }, (_, index) => shiftMonth(monthStart, -index - 1))
    .filter((start) => earliest && start >= earliest)
    .map((start) => totals(start.slice(0, 7)));
  const average = baselines.length
    ? current.map((_, index) => baselines.reduce((sum, baseline) => sum + baseline[index], 0) / baselines.length)
    : null;

  const spent = current[elapsed - 1];
  const priorPartial = Boolean(prior && earliest > `${previous}-01`);
  const priorPace = priorPartial ? null : prior?.[elapsed - 1];
  return {
    spent: fromMinor(spent, currency),
    pace: priorPace ? (spent - priorPace) / priorPace : null,
    priorPace: priorPace == null ? null : fromMinor(priorPace, currency),
    priorPartial,
    priorTotal: prior ? fromMinor(prior[30], currency) : null,
    averageTotal: average ? fromMinor(average[30], currency) : null,
    baselineMonths: baselines.length,
    projected: fromMinor(spent * end / elapsed, currency),
    series: current.map((amount, index) => ({
      day: index + 1,
      current: index < elapsed ? fromMinor(amount, currency) : null,
      previous: prior ? fromMinor(prior[index], currency) : null,
      average: average ? fromMinor(average[index], currency) : null,
    })),
  };
}

const cadences = [['weekly', 7], ['biweekly', 14], ['monthly', 30], ['annual', 365]];

export function forecastRecurring(transactions, today) {
  const groups = new Map();
  for (const row of transactions) {
    // A card/loan payment is a transfer for spending reports, but it still
    // consumes cash on its payment date. Ordinary transfers stay excluded.
    const debtPayment = row.amountMinor < 0 && /credit[ -]?card|loan.*(?:payment|pmt)|(?:payment|pmt).*loan|card.*(?:payment|autopay)|(?:auto|vehicle|mortgage|student).*(?:payment|pmt)/i.test(row.payee ?? '');
    if (row.pending || !row.postedDate || !row.amountMinor || !row.vendorKey || (row.category === 'Transfer' && !debtPayment)) continue;
    const group = JSON.stringify([row.accountId, row.vendorKey, row.currency, Math.sign(row.amountMinor)]);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
  }
  const forecasts = [];
  for (const [group, rows] of groups) {
    const recent = rows.sort((a, b) => b.postedDate - a.postedDate).slice(0, 3);
    if (recent.length < 3) continue;
    const dates = recent.map((row) => dateKey(row.postedDate));
    const intervals = dates.slice(1).map((date, i) => (civilSeconds(dates[i]) - civilSeconds(date)) / daySeconds);
    const mean = recent.reduce((sum, row) => sum + row.amountMinor, 0) / recent.length;
    const cadence = cadences.find(([, days]) => intervals.every((interval) => Math.abs(interval - days) <= 3));
    if (!cadence || recent.some((row) => Math.abs(row.amountMinor - mean) > Math.abs(mean) * 0.05)) continue;
    const [label, days] = cadence;
    const next = label === 'monthly' || label === 'annual'
      ? shiftMonth(dates[0], label === 'monthly' ? 1 : 12)
      : shiftDays(dates[0], days);
    if (next < shiftDays(today, -3)) continue;
    const { payee, currency, category, postedDate, accountId } = recent[0];
    forecasts.push({
      group, payee, currency, category, accountId, typicalAmount: fromMinor(Math.round(mean), currency),
      cadence: label, dueDate: next, nextDueDate: civilSeconds(next), lastChargedDate: postedDate,
      isActive: true, transactionKeys: recent.map(({ key }) => key),
    });
  }
  return forecasts;
}

export function upcomingOutflows(forecasts, currency, today) {
  const end = shiftDays(today, 13);
  const items = [];
  for (const forecast of forecasts) {
    if (!forecast.isActive || forecast.currency !== currency || forecast.typicalAmount >= 0) continue;
    const cadence = cadences.find(([label]) => label === forecast.cadence);
    if (!cadence || forecast.dueDate < shiftDays(today, -3)) continue;
    let due = forecast.dueDate;
    while (due <= end) {
      items.push({ ...forecast, dueDate: due, overdue: due < today });
      due = forecast.cadence === 'monthly' || forecast.cadence === 'annual'
        ? shiftMonth(due, forecast.cadence === 'monthly' ? 1 : 12)
        : shiftDays(due, cadence[1]);
    }
  }
  return items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
