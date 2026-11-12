import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryRoom, cycleSpendingPrediction, cycleCategoryPace, moveAccount, orderAccounts, paycheckCycle, runwayToPayday } from '../functions/cockpit.js';

const account = { key: 'checking', name: 'Checking', balance: 500, availableBalance: 500, currency: 'USD' };
const row = (key, date, amount, fields = {}) => ({
  key, accountId: account.key, postedDate: Date.parse(`${date}T18:00:00Z`) / 1000,
  currency: 'USD', amount, amountMinor: Math.round(amount * 100), category: 'Groceries', payee: 'Market', ...fields,
});
const paycheck = (date) => row(date, date, 1900, { category: 'Income', payee: 'Payroll', vendorKey: 'payroll' });

test('posted payroll aligns the same phase of prior monthly pay cycles and last year', () => {
  const today = '2026-11-03';
  const rows = [
    paycheck('2026-10-30'), paycheck('2026-09-30'), paycheck('2026-08-31'), paycheck('2026-07-31'), paycheck('2025-10-30'),
    row('early', '2025-10-16', -19),
    row('year', '2025-11-03', -35),
    row('jul', '2026-08-03', -20),
    row('aug', '2026-09-03', -40),
    row('prior', '2026-10-03', -60),
    row('prior-outside', '2026-10-05', -75),
    row('current', '2026-11-03', -50, { isSplit: true, splits: [
      { category: 'Groceries', amount: -45 }, { category: 'Transfer', amount: -5 },
    ] }),
  ];
  const cycle = paycheckCycle({ rows, account, today });
  assert.equal(cycle.posted, true);
  assert.equal(cycle.start, '2026-10-30');
  assert.equal(cycle.elapsed, 4);
  assert.equal(cycle.nextPayday, '2026-11-15');
  assert.deepEqual(cycle.prior, { start: '2026-09-30', end: '2026-10-04' });
  const pace = cycleCategoryPace(rows, 'USD', cycle, today);
  assert.equal(pace.baselineMonths, 3);
  assert.deepEqual(pace.comparisons[0], {
    category: 'Groceries', current: 45, pending: 0, prior: 60, average: 40, year: 35,
    priorTrend: 'below', averageTrend: 'same', yearTrend: 'above',
  });
  assert.equal(cycleCategoryPace(rows.slice(0, 4), 'USD', cycle, today).yearAvailable, false);
});

test('unposted payday remains the forecast endpoint and a posted paycheck starts the new cycle', () => {
  const today = '2026-11-15';
  const settings = { midmonthMinor: 190000 };
  const pending = { ...paycheck(today), pending: true };
  const unposted = paycheckCycle({ rows: [pending], account, settings, today });
  assert.equal(unposted.nextPayday, today);
  assert.equal(unposted.prior, null);
  const posted = paycheckCycle({ rows: [paycheck(today)], account, settings, today });
  assert.equal(posted.elapsed, 0);
  assert.equal(posted.nextPayday, '2026-11-30');
});

test('runway preserves the pre-deposit low point and reserves matching pending holds once', () => {
  const today = '2026-11-10';
  const nextPayday = '2026-11-15';
  const rows = [
    row('history', '2026-10-03', -90),
    row('hold', today, -80, { pending: true, payee: 'Internet' }),
    row('other-hold', today, -12, { pending: true, payee: 'Transit' }),
  ];
  const input = { account: { ...account, availableBalance: 408 }, rows, forecasts: [], today, nextPayday,
    settings: { midmonthMinor: 190000 },
    plans: [
      { key: 'bill', accountId: account.key, currency: 'USD', dueDate: '2026-11-12', kind: 'expense', amountMinor: 8000, label: 'Internet bill' },
      { key: 'due', accountId: account.key, currency: 'USD', dueDate: nextPayday, kind: 'expense', amountMinor: 15000, label: 'School fees' },
      { key: 'later', accountId: account.key, currency: 'USD', dueDate: '2026-11-16', kind: 'expense', amountMinor: 5000, label: 'Vet' },
    ],
    goals: [{ accountId: account.key, currency: 'USD', savedMinor: 10000 }],
  };
  const runway = runwayToPayday(input);
  assert.equal(runway.held, 9200);
  assert.equal(runway.opening, 30800);
  assert.equal(runway.expected, 15000);
  assert.equal(runway.lowest, 15800);
  assert.equal(runway.committed, 205800);
  assert.equal(runway.income, 190000);
  assert.equal(runway.points.at(-1).committed, 205800);
});

test('category room reserves cash for essentials first and decreases after purchases', () => {
  const today = '2026-11-06';
  const cycle = { start: '2026-10-31', nextPayday: '2026-11-15' };
  const rows = [row('g', '2026-10-03', -280), row('d', '2026-10-05', -140, { category: 'Dining' })];
  const input = { rows, forecasts: [], currency: 'USD', cycle, today, committed: 16000 };
  const room = categoryRoom(input);
  assert.equal(room.items[0].available, 15000);
  assert.equal(room.items[1].available, 1000);
  const updated = categoryRoom({ ...input, rows: [...rows, row('new', today, -30)] });
  assert.equal(updated.items[0].available, 12000);
  assert.equal(updated.allocated + updated.unassigned, 16000);
  assert.equal(categoryRoom({ ...input, committed: -500 }).allocated, 0);
});

test('shared account ranks override names and newly linked accounts follow ranked ones', () => {
  const accounts = [account, { key: 'card', name: 'Card' }, { key: 'saving', name: 'Savings' }];
  assert.deepEqual(orderAccounts(accounts, ['saving', 'checking']).map(({ key }) => key), ['saving', 'checking', 'card']);
  assert.deepEqual(moveAccount(accounts, ['saving', 'checking'], 'checking', -1), ['checking', 'saving', 'card']);
});

test('pending purchases use current spending and room but stay out of historical benchmarks', () => {
  const today = '2026-11-06';
  const cycle = { start: '2026-10-31', nextPayday: '2026-11-15',
    prior: { start: '2026-09-30', end: '2026-10-06' }, average: [], year: null };
  const rows = [
    row('coverage', '2026-09-12', -15),
    row('historic', '2026-10-04', -280),
    row('old-pending', '2026-10-03', -40, { pending: true }),
    row('posted', today, -20),
    row('pending', today, -34, { pending: true }),
  ];
  const groceries = cycleCategoryPace(rows, 'USD', cycle, today).comparisons[0];
  assert.equal(groceries.current, 54);
  assert.equal(groceries.pending, 34);
  assert.equal(groceries.prior, 280);
  assert.equal(categoryRoom({ rows, forecasts: [], currency: 'USD', cycle, today, committed: 60000 }).items[0].spent, 5400);
});


test('dated cashflow warns about tomorrow’s gap even when a later deposit repairs it', () => {
  const input = { account: { ...account, balance: 0, availableBalance: 0 }, rows: [], goals: [], forecasts: [],
    today: '2026-11-07', nextPayday: '2026-11-15', settings: { midmonthMinor: 0 }, plans: [
      { key: 'bill', accountId: account.key, currency: 'USD', dueDate: '2026-11-08', kind: 'expense', amountMinor: 2000, label: 'Bill' },
      { key: 'check', accountId: account.key, currency: 'USD', dueDate: '2026-11-10', kind: 'income', amountMinor: 20000, label: 'Gift' },
    ] };
  const result = runwayToPayday(input);
  assert.equal(result.firstGap, '2026-11-08');
  assert.equal(result.lowestDate, '2026-11-08');
  assert.equal(result.lowest, -2000);
  assert.equal(result.committed, 18000);
  assert.equal(result.points.find((point) => point.date === '2026-11-08').committed, -2000);
  assert.equal(result.points.find((point) => point.date === '2026-11-10').committed, 18000);
  assert.equal(result.expected, 2000);
  // A same-day deposit cannot conceal a bill that could clear first.
  const sameDay = runwayToPayday({ ...input, plans: input.plans.map((item) => ({ ...item, dueDate: '2026-11-08' })) });
  assert.equal(sameDay.lowest, -2000);
  assert.equal(sameDay.committed, 18000);
});

test('optional prediction follows actual cycle days and excludes transfers, bills and other accounts', () => {
  const cycle = { start: '2026-10-31', historicalCycles: [
    { start: '2026-07-31', end: '2026-08-14' },
    { start: '2026-08-31', end: '2026-09-14' },
    { start: '2026-09-30', end: '2026-10-14' },
  ] };
  const rows = [row('coverage', '2026-07-01', -1),
    row('a', '2026-08-08', -30), row('b', '2026-09-08', -60), row('c', '2026-10-08', -90),
    row('wrong-day', '2026-09-09', -45), row('bill', '2026-10-08', -500, { payee: 'Internet', isRecurring: true }),
    row('transfer', '2026-10-08', -700, { category: 'Transfer' }),
    row('card', '2026-10-08', -900, { accountId: 'card' }),
    row('pending', '2026-10-08', -800, { pending: true }),
  ];
  const prediction = cycleSpendingPrediction({ rows, account, cycle, forecasts: [], plans: [], today: '2026-11-07', through: '2026-11-11' });
  assert.equal(prediction.available, true);
  assert.equal(prediction.months, 3);
  assert.deepEqual(prediction.days.map(({ amountMinor }) => amountMinor), [6000, 1500, 0]);
  assert.equal(cycleSpendingPrediction({ rows: rows.slice(2), account, cycle, forecasts: [], plans: [], today: '2026-11-07', through: '2026-11-11' }).available, false);
  const runway = runwayToPayday({ account, cycle, rows: rows.filter((row) => !row.pending), forecasts: [], plans: [], goals: [], today: '2026-11-07', nextPayday: '2026-11-11' });
  assert.equal(runway.lowest, 50000);
  assert.equal(runway.estimatedSpending, 7500);
  assert.equal(runway.projected, 42500);
});
