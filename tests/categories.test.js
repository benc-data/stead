import assert from 'node:assert/strict';
import test from 'node:test';
import { appendCategory, categoryOptions } from '../functions/categories.js';
import { approvedCategoryChanges, categoryPatch } from '../functions/category-writes.js';
import { buildCategorySuggestions, validateCategoryChanges } from '../functions/category-review.js';
import { categoryRoom, cycleCategoryPace } from '../functions/cockpit.js';

const key = 'a'.repeat(64);
const custom = 'Kids & school';
const allowed = categoryOptions([custom]);
const row = (date, amount, fields = {}) => ({ key, accountId: 'checking', currency: 'USD', category: custom,
  payee: 'School store', vendorKey: 'school store', postedDate: Date.parse(`${date}T18:00:00Z`) / 1000, amount, amountMinor: amount * 100, ...fields });

test('category creation normalizes names, preserves prior entries and rejects duplicates and invalid names', () => {
  const first = appendCategory({}, '  Kids &   school  ');
  assert.deepEqual(first, { names: [custom], keys: ['kids & school'] });
  const next = appendCategory(first, 'Pets');
  assert.deepEqual(next.names, [custom, 'Pets']);
  for (const name of ['', '   ', 'GROCERIES', 'income', 'kIDS & SCHOOL', 'a'.repeat(41), 'Line\nbreak']) {
    assert.throws(() => appendCategory(first, name));
  }
});

test('registered custom categories work for direct edits, splits and bulk writes while unregistered names are rejected', () => {
  const transaction = row('2026-11-07', -50);
  const data = { category: custom, amountMinor: -5000, splits: [
    { category: custom, amount: -35, memo: '' }, { category: 'Groceries', amount: -15, memo: '' },
  ] };
  assert.equal(categoryPatch(transaction, data, allowed).splits[0].category, custom);
  assert.throws(() => categoryPatch(transaction, data));
  const changes = [{ key, category: custom, expectedCategory: 'Uncategorized', amountMinor: -5000 }];
  approvedCategoryChanges(changes, allowed);
  assert.deepEqual(validateCategoryChanges(changes, allowed), changes);
  assert.throws(() => validateCategoryChanges(changes));
});

test('custom categories appear in pay-cycle comparisons and remaining category room, including split portions', () => {
  const today = '2026-11-07';
  const cycle = { start: '2026-10-31', nextPayday: '2026-11-15', prior: { start: '2026-09-30', end: '2026-10-07' }, average: [], year: null };
  const rows = [row('2026-09-01', -1), row('2026-10-05', -140), row(today, -50, { category: 'Other', isSplit: true,
    splits: [{ category: custom, amount: -35 }, { category: 'Transfer', amount: -15 }] })];
  const pace = cycleCategoryPace(rows, 'USD', cycle, today).comparisons.find(item => item.category === custom);
  assert.equal(pace.current, 35);
  assert.equal(pace.prior, 140);
  const room = categoryRoom({ rows, forecasts: [], currency: 'USD', cycle, today, committed: 50000 });
  assert.equal(room.items.find(item => item.category === custom).spent, 3500);
});

test('AI review and remembered vendor rules support registered custom categories and reject invented ones', async () => {
  const transaction = row('2026-11-07', -50, { category: 'Uncategorized' });
  const suggestions = await buildCategorySuggestions([transaction], [], async () => [{ index: 0, category: custom, confident: true }], allowed);
  assert.equal(suggestions[0].category, custom);
  const known = await buildCategorySuggestions([transaction], [{ kind: 'exact', pattern: 'school store', category: custom }],
    async () => { throw new Error('A remembered category must not require AI.'); }, allowed);
  assert.equal(known[0].source, 'known');
  const invented = await buildCategorySuggestions([transaction], [], async () => [{ index: 0, category: 'Invented', confident: true }], allowed);
  assert.equal(invented[0].category, 'Uncategorized');
});
