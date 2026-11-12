import assert from 'node:assert/strict';
import test from 'node:test';
import { approvedCategoryChanges, categoryPatch } from '../functions/category-writes.js';

test('direct category writes preserve integer-unit validation and normalize split amounts', () => {
  const row = { currency: 'USD', amountMinor: -12000 };
  const data = { amountMinor: -12000, category: 'Groceries', splits: [
    { category: 'Groceries', amount: '-80', memo: ' food ' },
    { category: 'Household Goods', amount: -40, memo: '' },
  ] };
  const patch = categoryPatch(row, data);
  assert.equal(patch.splitScale, 100);
  assert.equal(patch.splits[0].amount, -80);
  assert.equal(patch.splits[0].memo, 'food');
  assert.equal(patch.verifiedByUser, true);
  assert.throws(() => categoryPatch(row, { ...data, amountMinor: -10000 }));
  assert.throws(() => categoryPatch(row, { ...data, splits: data.splits.slice(0, 1) }));
  assert.throws(() => categoryPatch({ ...row, isSplit: true }, { ...data, quick: true }));
  assert.throws(() => categoryPatch(row, { ...data, splits: [{ ...data.splits[0], amount: -79 }, data.splits[1]] }));
  assert.throws(() => approvedCategoryChanges([]));
});
