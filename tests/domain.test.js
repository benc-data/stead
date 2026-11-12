import assert from 'node:assert/strict';
import test from 'node:test';
import { dateKey, forecastRecurring, smartSplit, spending, toMinor, upcomingOutflows } from '../functions/domain.js';
import { accessCredentials, claimUrl, normalizeAccount, normalizeTransaction } from '../functions/simplefin.js';

const time = (date) => Date.parse(`${date}T18:00:00Z`) / 1000;
const row = (key, date, amountMinor, extra = {}) => ({
  key, postedDate: time(date), amountMinor, currency: 'USD', accountId: 'checking',
  category: 'Groceries', payee: 'Target', vendorKey: 'target', ...extra,
});

test('spending compares the same date and uses complete available months for the benchmark', () => {
  const stats = spending([
    row('sep', '2026-09-23', -10000),
    row('oct-early', '2026-10-05', -4000),
    row('oct-late', '2026-10-25', -5000),
    row('nov', '2026-11-04', -8000, { isSplit: true, splits: [
      { category: 'Groceries', amount: -60 }, { category: 'Transfer', amount: -20 },
    ] }),
    row('pending', '2026-11-05', -2000, { pending: true }),
    row('income', '2026-11-05', 5000),
  ], 'USD', '2026-11', 3, '2026-11-06');
  assert.equal(stats.spent, 60);
  assert.equal(stats.priorPace, 40);
  assert.equal(stats.priorTotal, 90);
  assert.equal(stats.pace, 0.5);
  assert.equal(stats.projected, 300);
  assert.equal(stats.baselineMonths, 1);
  assert.equal(stats.averageTotal, 90);
  assert.equal(stats.series[6].current, null);
  assert.equal(dateKey(Date.parse('2026-11-07T04:59:00Z') / 1000), '2026-11-06');
});

test('smart splits use only the last five matching settled transactions and allocate exact minor units', () => {
  const older = row('older', '2026-10-01', -1000, {
    isSplit: true, splits: [{ category: 'Travel', amount: -10 }],
  });
  const history = Array.from({ length: 5 }, (_, i) => row(String(i), `2026-10-2${i}`, -1000, {
    isSplit: true, splits: [{ category: 'Groceries', amount: -6.50 }, { category: 'Household Goods', amount: -3.50 }],
  }));
  const result = smartSplit(row('current', '2026-11-06', -3333), [older, ...history]);
  assert.deepEqual(result.map(({ category, amount }) => [category, amount]), [['Groceries', -21.66], ['Household Goods', -11.67]]);
  assert.equal(result.reduce((sum, { amount }) => sum + toMinor(amount, 'USD'), 0), -3333);
  assert.equal(toMinor('3.001', 'USD'), null);
  assert.equal(toMinor('3.001', 'KWD'), 3001);
  assert.equal(toMinor('3.00', 'JPY'), 3);
});

test('recurring forecasts use cadence and amount tolerance and list each payment in the next 14 days', () => {
  const bill = { category: 'Subscriptions' };
  const forecasts = forecastRecurring([
    row('a', '2026-10-19', -1000, bill),
    row('b', '2026-10-26', -1010, bill),
    row('c', '2026-11-02', -990, bill),
    row('x', '2026-10-19', 9000), row('y', '2026-10-26', 9000), row('z', '2026-11-02', 9000),
  ], '2026-11-06');
  assert.equal(forecasts.length, 2);
  assert.deepEqual(upcomingOutflows(forecasts, 'USD', '2026-11-06').map(({ dueDate, typicalAmount }) => [dueDate, typicalAmount]), [
    ['2026-11-09', -10], ['2026-11-16', -10],
  ]);
  assert.deepEqual(upcomingOutflows(forecasts, 'USD', '2026-11-22'), []);
});

test('SimpleFIN credentials are scoped to Bridge and transaction IDs are namespaced by account', () => {
  const token = Buffer.from('https://beta-bridge.simplefin.org/simplefin/claim/DEMO-v2-123').toString('base64');
  assert.equal(claimUrl(token).hostname, 'beta-bridge.simplefin.org');
  assert.throws(() => claimUrl(Buffer.from('https://evil.example/simplefin/claim/test').toString('base64')));
  const { url, authorization } = accessCredentials('https://sample:p%40ss@bridge.simplefin.org/simplefin');
  assert.equal(url.href, 'https://bridge.simplefin.org/simplefin/accounts');
  assert.equal(authorization, `Basic ${Buffer.from('sample:p@ss').toString('base64')}`);
  const base = { id: '100', name: 'Account', balance: '9.99', currency: 'USD' };
  const v1 = normalizeAccount({ ...base, org: { domain: 'bank.example' } }, [], 1);
  const v2 = normalizeAccount({ ...base, conn_id: 'connection' }, [{ conn_id: 'connection', name: 'Bank' }], 1);
  const raw = { id: 'txn/1', description: 'POS Debit Target #3451', amount: '-3.10', pending: true, posted: 0 };
  const pending = normalizeTransaction(raw, v1, 1000);
  assert.equal(pending.vendorKey, 'target');
  assert.equal(pending.postedDate, 1000);
  assert.equal(pending.amountMinor, -310);
  assert.equal(pending.key, normalizeTransaction({ ...raw, posted: 1500, pending: false }, v1, 1600).key);
  assert.notEqual(pending.key, normalizeTransaction(raw, v2, 1000).key);
  assert.equal(v2.orgName, 'Bank');
});


test('regular card and loan cash payments remain forecastable when categorized as transfers', () => {
  const paymentRows = ['2026-08-10', '2026-09-10', '2026-10-10'].flatMap((date, i) => [
    { key: `payment-${i}`, accountId: 'checking', currency: 'USD', postedDate: Date.parse(`${date}T18:00:00Z`) / 1000,
      amountMinor: -25000, amount: -250, category: 'Transfer', payee: 'Citi Card Online Payment', vendorKey: 'citi card online payment' },
    { key: `transfer-${i}`, accountId: 'checking', currency: 'USD', postedDate: Date.parse(`${date}T18:00:00Z`) / 1000,
      amountMinor: -15000, amount: -150, category: 'Transfer', payee: 'Transfer to savings', vendorKey: 'transfer to savings' },
    { key: `credit-${i}`, accountId: 'card', currency: 'USD', postedDate: Date.parse(`${date}T18:00:00Z`) / 1000,
      amountMinor: 25000, amount: 250, category: 'Transfer', payee: 'Citi Card Online Payment', vendorKey: 'citi card online payment' },
  ]);
  const result = forecastRecurring(paymentRows, '2026-11-07');
  assert.equal(result.length, 1);
  assert.equal(result[0].accountId, 'checking');
  assert.equal(result[0].dueDate, '2026-11-10');
  assert.equal(result[0].typicalAmount, -250);
});
