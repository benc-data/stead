import { categories, CATEGORY_BATCH_LIMIT, fromMinor, minorDigits, toMinor } from './domain.js';

export function approvedCategoryChanges(changes, allowed = categories) {
  if (!Array.isArray(changes) || !changes.length || changes.length > CATEGORY_BATCH_LIMIT ||
      new Set(changes.map((change) => change?.key)).size !== changes.length ||
      !changes.every((change) => typeof change.key === 'string' && /^[a-f0-9]{64}$/.test(change.key)
        && allowed.includes(change.category) && allowed.includes(change.expectedCategory)
        && Number.isSafeInteger(change.amountMinor))) {
    throw new Error('Check the selected transactions and reviewed categories.');
  }
}

export function categoryPatch(row, data, allowed = categories) {
  if (!row) throw new Error('This transaction is no longer available.');
  if (!allowed.includes(data.category)) throw new Error('Choose a valid category.');
  if (row.amountMinor !== data.amountMinor) throw new Error('The bank updated this amount. Reopen the transaction and try again.');
  if (data.quick && (row.isSplit || row.splits?.length)) throw new Error('This transaction has a split. Open it individually to edit.');
  const splits = data.splits ?? [];
  if (!Array.isArray(splits) || splits.length === 1 || splits.length > 20) throw new Error('Use at least two rows for a split.');
  let total = 0;
  const clean = splits.map((split) => {
    const units = toMinor(split.amount, row.currency);
    if (!allowed.includes(split.category) || units == null || !units || Math.sign(units) !== Math.sign(row.amountMinor)
        || typeof split.memo !== 'string' || split.memo.length > 180) throw new Error('Check the split categories and amounts.');
    total += units;
    return { category: split.category, amountMinor: units, amount: fromMinor(units, row.currency), memo: split.memo.trim() };
  });
  if (splits.length && total !== row.amountMinor) throw new Error('Split amounts must add up to the transaction total.');
  return {
    category: data.category, splits: clean, isSplit: clean.length > 0,
    verifiedByUser: true, needsReview: false,
    ...(clean.length ? { splitScale: 10 ** minorDigits(row.currency) } : {}),
  };
}
