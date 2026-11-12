import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCashPlan, categoryComparisons, findPlanMatches, goalPace, paydays, paycheckEstimates } from '../functions/planner.js';

const time = (date) => Date.parse(`${date}T18:00:00Z`) / 1000;
const row = (key, date, amountMinor, data = {}) => ({
  key, accountId: 'checking', currency: 'USD', amountMinor, amount: amountMinor / 100,
  postedDate: time(date), category: 'Groceries', payee: 'Whole Foods Market',
  description: 'POS debit Whole Foods Market #0294', vendorKey: 'whole foods market', ...data,
});
const entry = (key, dueDate, amountMinor, data = {}) => ({
  key, dueDate, amountMinor, accountId: 'checking', currency: 'USD', kind: 'expense',
  label: 'Whole Foods', ...data,
});

test('category trends use the same days across full prior months and honor split amounts', () => {
  const { comparisons, baselineMonths } = categoryComparisons([
    row('jul', '2026-07-12', 2000),
    row('aug', '2026-08-04', -2100),
    row('sep', '2026-09-05', -3300),
    row('oct', '2026-10-02', -3000),
    row('late', '2026-10-07', -10000),
    row('nov', '2026-11-04', -5000, { isSplit: true, splits: [
      { category: 'Groceries', amount: -32 }, { category: 'Dining', amount: -15 }, { category: 'Transfer', amount: -3 },
    ] }),
  ], 'USD', '2026-11', '2026-11-06');
  const groceries = comparisons.find(({ category }) => category === 'Groceries');
  assert.equal(baselineMonths, 3);
  assert.equal(groceries.prior, 30);
  assert.equal(groceries.average, 28);
  assert.equal(groceries.priorTrend, 'same');
  assert.equal(groceries.averageTrend, 'same');
  assert.equal(comparisons.find(({ category }) => category === 'Dining').averageTrend, 'above');
  assert.ok(!comparisons.some(({ category }) => category === 'Transfer'));
});

test('reconciliation pairs only unique posted items in the same account, within five dollars and near the date', () => {
  const planned = entry('p', '2026-11-06', 8000);
  const matched = row('x', '2026-11-08', -8500);
  assert.equal(findPlanMatches([planned], [matched])[0].row.key, 'x');
  assert.deepEqual(findPlanMatches([planned], [{ ...matched, pending: true }]), []);
  assert.deepEqual(findPlanMatches([planned], [{ ...matched, accountId: 'other' }]), []);
  assert.deepEqual(findPlanMatches([planned], [{ ...matched, amountMinor: -8501 }]), []);
  assert.deepEqual(findPlanMatches([planned], [{ ...matched, postedDate: time('2026-11-14') }]), []);
  assert.deepEqual(findPlanMatches([planned], [matched, { ...matched, key: 'ambiguous' }]), []);
  assert.deepEqual(findPlanMatches([planned, { ...planned, key: 'also' }], [matched]), []);
  assert.deepEqual(findPlanMatches([planned], [{ ...matched, planMatchKey: 'already used' }]), []);
});

test('semi-monthly paydays use the actual last day, and past deposits inform each slot independently', () => {
  assert.deepEqual(paydays('2028-02-15', '2028-03-01').map(({ dueDate }) => dueDate), ['2028-02-15', '2028-02-29']);
  const employer = { payee: 'Payroll', vendorKey: 'payroll', category: 'Income' };
  const estimates = paycheckEstimates([
    row('a', '2026-09-14', 120000, employer),
    row('b', '2026-10-15', 120500, employer),
    row('c', '2026-09-30', 135000, employer),
    row('d', '2026-10-30', 136000, employer),
  ], 'checking', '2026-11-06');
  assert.equal(estimates.midmonth[0].amountMinor, 120250);
  assert.equal(estimates.monthEnd[0].amountMinor, 135500);
});

test('cash forecast reserves goals and includes only dated activity without duplicating paid items', () => {
  const account = { key: 'checking', balance: 500, currency: 'USD' };
  const forecast = {
    id: 'rent', accountId: 'checking', payee: 'Rent', typicalAmount: -400, currency: 'USD',
    isActive: true, cadence: 'monthly', dueDate: '2026-11-15',
  };
  const settings = { midmonthMinor: 100000, monthEndMinor: 100000 };
  const context = {
    account, settings, forecasts: [forecast], today: '2026-11-06',
    transactions: [row('past', '2026-10-01', -1000), row('spend', '2026-10-15', -28000)],
    plans: [
      entry('rent', '2026-11-15', 40000, { label: 'Rent' }),
      entry('paid', '2026-11-09', 10000, { matchedTransactionKey: 'txn' }),
      entry('late-income', '2026-11-05', 20000, { kind: 'income' }),
    ],
    goals: [{ accountId: 'checking', currency: 'USD', savedMinor: 15000 }],
  };
  const baseline = buildCashPlan(context);
  assert.equal(baseline.lowest, -5000);
  assert.equal(baseline.lowestUnallocated, -5000);
  assert.equal(baseline.lowestDate, '2026-11-15');
  assert.equal(baseline.timeline.length, 3);
  assert.equal(baseline.balance, 195000);
  assert.equal(baseline.expected, 40000);
  assert.equal(baseline.income, 200000);
  assert.equal(buildCashPlan(context).balance, 195000);
  assert.equal(goalPace({ targetMinor: 10000, savedMinor: 1000, dueDate: '2026-11-20' }, '2026-11-06').weeklyMinor, 4500);
});


test('recurring income creates a dated cash bump and the manual calendar overrides its estimate', () => {
  const input = { account: { key: 'checking', currency: 'USD', balance: 50 }, today: '2026-11-07', transactions: [], goals: [], plans: [],
    forecasts: [{ id: 'gift', accountId: 'checking', currency: 'USD', typicalAmount: 200, payee: 'Family contribution', dueDate: '2026-11-10', cadence: 'monthly', isActive: true }] };
  const automatic = buildCashPlan(input);
  assert.equal(automatic.income, 20000);
  assert.equal(automatic.timeline[0].balance, 25000);
  const overridden = buildCashPlan({ ...input, plans: [entry('confirmed', '2026-11-10', 20000, { kind: 'income', label: 'Family contribution' })] });
  assert.equal(overridden.income, 20000);
  assert.equal(overridden.timeline.length, 1);
});


test('a recurring payroll estimate cannot duplicate an explicitly scheduled paycheck', () => {
  const result = buildCashPlan({ account: { key: 'checking', currency: 'USD', balance: 100 }, today: '2026-11-07', transactions: [], goals: [], plans: [],
    settings: { midmonthMinor: 196000, monthEndMinor: 196000 },
    forecasts: [{ id: 'payroll', accountId: 'checking', currency: 'USD', typicalAmount: 1960, payee: 'Payroll', dueDate: '2026-11-15', cadence: 'biweekly', isActive: true }] });
  assert.equal(result.income, 392000);
  assert.equal(result.timeline.length, 2);
});
