import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCategorySuggestions, reviewedUpdates, validateCategoryChanges, validateCategoryKeys } from '../functions/category-review.js';

const key = (number) => number.toString(16).padStart(64, '0');
const row = (number, fields = {}) => ({
  key: key(number), category: 'Uncategorized', amountMinor: -1524,
  payee: 'Family Dental 123456 abc@example.com', vendorKey: 'family dental', ...fields,
});
const snapshot = (value) => ({ data: () => value });
const change = (number, fields = {}) => ({
  key: key(number), category: 'Health', expectedCategory: 'Uncategorized', amountMinor: -1524, ...fields,
});

test('classification shares only sanitized merchant labels and directions, with same-merchant requests grouped', async () => {
  const rows = [
    row(1), row(2, { amountMinor: -5100 }),
    row(3, { payee: 'Starbucks', vendorKey: 'starbucks' }),
    row(4, { payee: 'Online payment', vendorKey: 'online payment', amountMinor: 1924 }),
  ];
  const result = await buildCategorySuggestions(rows, [], async (merchants) => {
    assert.deepEqual(merchants, [
      { index: 0, merchant: 'Family Dental', direction: 'outgoing' },
      { index: 1, merchant: 'Online payment', direction: 'incoming' },
    ]);
    return [{ index: 0, category: 'Health', confident: true }, { index: 1, category: 'Transfer', confident: false }];
  });
  assert.deepEqual(result.map(({ key: id, category, source, confident }) => [id, category, source, confident]), [
    [key(1), 'Health', 'gemini', true], [key(2), 'Health', 'gemini', true],
    [key(3), 'Dining', 'known', true], [key(4), 'Transfer', 'gemini', false],
  ]);
});

test('invalid, duplicated, and uncertain no-category model responses leave saved categories as-is', async () => {
  const rows = [
    row(1, { category: 'Other' }), row(2, { payee: 'Unknown market' }), row(3, { payee: '2222222' }),
  ];
  const result = await buildCategorySuggestions(rows, [], async () => [
    { index: 0, category: 'Health', confident: true },
    { index: 0, category: 'Dining', confident: true },
    { index: 1, category: 'Uncategorized', confident: false },
    { index: 7, category: 'Health', confident: true },
  ]);
  assert.deepEqual(result.map(({ category, source, confident }) => [category, source, confident]), [
    ['Other', 'manual', false], ['Uncategorized', 'manual', false], ['Uncategorized', 'manual', false],
  ]);
});

test('approved batches reject duplicate keys, invalid categories, splits, and concurrent changes', () => {
  assert.throws(() => validateCategoryKeys([key(1), key(1)]), { code: 'invalid-argument' });
  assert.throws(() => validateCategoryKeys(Array.from({ length: 26 }, (_, index) => key(index))), { code: 'invalid-argument' });
  assert.throws(() => validateCategoryChanges([change(1, { category: 'unknown' })]), { code: 'invalid-argument' });
  const changes = [change(1), change(2)];
  assert.deepEqual(reviewedUpdates(changes, [
    snapshot(row(1, { category: 'Health', verifiedByUser: true })), snapshot(row(2)),
  ]), [change(2)]);
  assert.throws(() => reviewedUpdates(changes, [snapshot(row(1)), snapshot(row(2, { category: 'Shopping' }))]), { code: 'aborted' });
  assert.throws(() => reviewedUpdates(changes, [snapshot(row(1)), snapshot(row(2, { isSplit: true }))]), { code: 'aborted' });
  assert.throws(() => reviewedUpdates(changes, [snapshot(row(1)), snapshot(row(2, { amountMinor: -1400 }))]), { code: 'aborted' });
});
