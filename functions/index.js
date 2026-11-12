import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { dateKey, forecastRecurring, fromMinor, toMinor } from './domain.js';
import { categoryOptions } from './categories.js';
import { findPlanMatches, matchesPlan } from './planner.js';
import { generateCoachBrief } from './coach.js';
import { buildCategorySuggestions, checkedCategoryRow, classifyMerchants, reviewedUpdates, validateCategoryChanges, validateCategoryKeys } from './category-review.js';
import { categoryFor, day, documentKey, fetchAccounts, normalizeAccount, normalizeTransaction } from './simplefin.js';

initializeApp();
const db = getFirestore();
const secret = defineSecret('SIMPLEFIN_ACCESS_URL');
const coachModel = defineString('GEMINI_MODEL', { default: 'gemini-3.8-flash' });
const syncStatus = db.doc('settings/sync');
const lock = db.doc('settings/syncLock');
const ledger = db.collection('transactions');
const vendorRules = db.collection('vendor_rules');
const region = 'us-central1';
const syncOptions = { region, secrets: [secret], timeoutSeconds: 300, memory: '512MiB' };
const nowSeconds = () => Math.floor(Date.now() / 1000);

async function assertMember(auth) {
  const token = auth?.token;
  if (!token?.email_verified || token.firebase?.sign_in_provider !== 'google.com') {
    throw new HttpsError('permission-denied', 'Sign in with an authorized Google account.');
  }
  const household = (await db.doc('settings/household').get()).data();
  if (!token.email || !household || ![household.primaryEmail, household.spouseEmail].includes(token.email)) {
    throw new HttpsError('permission-denied', 'This email does not have household access.');
  }
}

async function reserveSync(runId, now, manual) {
  return db.runTransaction(async (tx) => {
    const [privateState, publicState] = await tx.getAll(lock, syncStatus);
    const state = privateState.data() ?? {};
    const lastSuccess = publicState.get('lastSuccess') ?? 0;
    const cooldown = state.lastStarted ? state.lastStarted + 900 : 0;
    if (state.leaseUntil > now || cooldown > now) {
      if (manual) throw new HttpsError('resource-exhausted', 'Sync can run once every 15 minutes.', { next: Math.max(cooldown, state.leaseUntil ?? 0) });
      return null;
    }
    const start = lastSuccess ? Math.min(now - 10 * day, lastSuccess - 2 * day) : now - 400 * day;
    const ranges = [];
    for (let end = now + day; end > start && ranges.length < 5;) {
      const begin = Math.max(start, end - (ranges.length === 0 && lastSuccess ? 89 : 90) * day);
      ranges.push({ begin, end });
      end = begin;
    }
    const attempts = (state.attempts ?? []).filter((stamp) => stamp > now - day);
    if (attempts.length + ranges.length > 20) {
      const next = attempts[attempts.length + ranges.length - 21] + day;
      if (manual) throw new HttpsError('resource-exhausted', 'The daily bank sync limit has been reached.', { next });
      return null;
    }
    tx.set(lock, { runId, leaseUntil: now + 420, lastStarted: now, attempts: [...attempts, ...ranges.map(() => now)] });
    tx.set(syncStatus, { status: 'syncing', nextManualSync: now + 900 }, { merge: true });
    return ranges;
  });
}

function chunks(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}

async function storeRows(rows, rules) {
  for (const group of chunks(rows, 150)) {
    await db.runTransaction(async (tx) => {
      const refs = group.map(({ key }) => ledger.doc(key));
      const snapshots = await tx.getAll(...refs);
      for (const [index, row] of group.entries()) {
        const previous = snapshots[index].data();
        if (previous && !previous.pending && row.pending) continue;
        const changed = previous?.isSplit && previous.amountMinor !== row.amountMinor;
        const category = previous?.verifiedByUser || previous?.isSplit ? previous.category : categoryFor(row, rules);
        tx.set(refs[index], {
          ...row, category,
          ...(previous ? {} : { isSplit: false, isRecurring: false, verifiedByUser: false }),
          ...(changed ? { isSplit: false, splits: [], needsReview: true } : {}),
        }, { merge: true });
      }
    });
  }
}

async function reconcilePlans(now) {
  const [plans, rows] = await Promise.all([
    db.collection('planned_items').get(),
    ledger.where('postedDate', '>=', now - 65 * day).get(),
  ]);
  const matches = findPlanMatches(plans.docs.map((doc) => ({ ...doc.data(), key: doc.id })),
    rows.docs.map((doc) => ({ ...doc.data(), key: doc.id })));
  for (const { plan, row } of matches) {
    const planRef = plans.docs.find((doc) => doc.id === plan.key).ref;
    const transactionRef = ledger.doc(row.key);
    await db.runTransaction(async (tx) => {
      const [latestPlan, latestRow] = await tx.getAll(planRef, transactionRef);
      if (!latestPlan.exists || !latestRow.exists || !matchesPlan(latestPlan.data(), latestRow.data())) return;
      tx.update(planRef, { matchedTransactionKey: row.key, matchedAmountMinor: Math.abs(latestRow.get('amountMinor')), matchedDate: dateKey(latestRow.get('postedDate')) });
      tx.update(transactionRef, { planMatchKey: plan.key });
    });
  }
}

async function updateForecasts(now) {
  const history = await ledger.where('postedDate', '>=', now - 770 * day).get();
  const forecasts = forecastRecurring(history.docs.map((doc) => doc.data()), dateKey(now));
  const keys = new Set(forecasts.flatMap(({ transactionKeys }) => transactionKeys));
  const live = new Set();
  const writer = db.bulkWriter();
  const writes = [];
  for (const { group, transactionKeys, nextDueDate, lastChargedDate, ...fields } of forecasts) {
    const id = documentKey(group);
    live.add(id);
    writes.push(writer.set(db.doc(`recurring_forecasts/${id}`), {
      ...fields, id, nextDueDate: Timestamp.fromMillis(nextDueDate * 1000),
      lastChargedDate: Timestamp.fromMillis(lastChargedDate * 1000),
    }));
  }
  const oldForecasts = await db.collection('recurring_forecasts').get();
  for (const doc of oldForecasts.docs) {
    if (!live.has(doc.id)) writes.push(writer.delete(doc.ref));
  }
  for (const doc of history.docs) {
    if (doc.get('isRecurring') !== keys.has(doc.id)) {
      writes.push(writer.update(doc.ref, { isRecurring: keys.has(doc.id) }));
    }
  }
  await Promise.all([writer.close(), ...writes]);
}

function bridgeWarnings(result) {
  const messages = result.errlist?.length ? result.errlist.map((error) => error.msg || error.code) : result.errors ?? [];
  return messages.filter((message) => typeof message === 'string').map((message) =>
    message.replace(/https?:\/\/\S+/gi, '[link hidden]').slice(0, 300));
}

async function sync(manual) {
  const now = nowSeconds();
  const runId = randomUUID();
  const ranges = await reserveSync(runId, now, manual);
  if (!ranges) return;
  try {
    const config = secret.value();
    if (!config || config === 'UNCONNECTED') {
      const error = new Error('Bank connection is awaiting SimpleFIN setup.');
      error.publicMessage = error.message;
      throw error;
    }
    const rules = (await vendorRules.get()).docs.map((rule) => rule.data());
    const warnings = new Set();
    const latestAccounts = new Set();
    const rows = new Map();
    let count = 0;
    for (const [index, { begin, end }] of ranges.entries()) {
      const result = await fetchAccounts(config, begin, end, index === 0);
      const notices = bridgeWarnings(result);
      for (const warning of notices) warnings.add(warning);
      if (index === 0) {
        const batch = db.batch();
        for (const account of result.accounts) {
          const normalized = normalizeAccount(account, result.connections ?? [], now);
          if (!Number.isFinite(normalized.balance) || !Number.isFinite(normalized.availableBalance)) continue;
          if (!notices.length && !result.errors?.length && !result.errlist?.length) latestAccounts.add(normalized.key);
          batch.set(db.doc(`accounts/${normalized.key}`), { ...normalized, lastUpdated: FieldValue.serverTimestamp() });
        }
        await batch.commit();
      }
      for (const account of result.accounts) {
        const normalized = normalizeAccount(account, result.connections ?? [], now);
        for (const raw of account.transactions ?? []) {
          const row = normalizeTransaction(raw, normalized, now);
          if (!row) {
            warnings.add('Some bank records use an unsupported amount or date and could not be imported.');
            latestAccounts.delete(normalized.key);
            continue;
          }
          if (!rows.has(row.key) || (rows.get(row.key).pending && !row.pending)) rows.set(row.key, row);
        }
      }
    }
    count = rows.size;
    await storeRows([...rows.values()], rules);
    const pending = await ledger.where('pending', '==', true).get();
    for (const group of chunks(pending.docs.filter((doc) => latestAccounts.has(doc.get('accountId')) && !rows.has(doc.id)), 150)) {
      const batch = db.batch();
      for (const doc of group) batch.delete(doc.ref);
      await batch.commit();
    }
    await reconcilePlans(now);
    await updateForecasts(now);
    const batch = db.batch();
    batch.update(lock, { leaseUntil: 0 });
    batch.set(syncStatus, { status: 'ready', lastSuccess: now, warnings: [...warnings].slice(0, 15) }, { merge: true });
    await batch.commit();
    return { count };
  } catch (error) {
    const message = error.publicMessage ?? 'Bank sync could not finish. Try again later.';
    const batch = db.batch();
    batch.update(lock, { leaseUntil: 0 });
    batch.set(syncStatus, { status: 'error', message }, { merge: true });
    await batch.commit();
    if (manual) throw new HttpsError('unavailable', message);
    console.error('Scheduled bank sync did not finish.', error.publicMessage ?? error.name);
  }
}

export const scheduledBankSync = onSchedule({ ...syncOptions, schedule: '17 */6 * * *', timeZone: 'America/Chicago' }, () => sync(false));
export const syncBank = onCall(syncOptions, async ({ auth }) => {
  await assertMember(auth);
  return sync(true);
});

async function allowedCategories() {
  return categoryOptions((await db.doc('settings/categories').get()).get('names'));
}

async function updateTransaction(data, action) {
  const categories = await allowedCategories();
  const { key, category, splits = [], remember = false, amountMinor, quick = false } = data ?? {};
  if (!/^[a-f0-9]{64}$/.test(key ?? '') || !categories.includes(category) ||
      !Array.isArray(splits) || splits.length > 20 || splits.length === 1 || typeof remember !== 'boolean' || typeof quick !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Check the transaction category and split rows.');
  }
  const ref = ledger.doc(key);
  return db.runTransaction(async (tx) => {
    if (action) await assertActionActive(tx, action);
    const row = (await tx.get(ref)).data();
    if (!row) throw new HttpsError('not-found', 'This transaction is no longer available.');
    if (quick && row.isSplit) {
      throw new HttpsError('aborted', 'This purchase now has a split. Open it in Activity to edit the split.');
    }
    if (row.amountMinor !== amountMinor) {
      throw new HttpsError('aborted', 'The bank updated this amount. Reopen the transaction and try again.');
    }
    const validated = [];
    let total = 0;
    for (const split of splits) {
      const units = toMinor(split?.amount, row.currency);
      if (units === null || !units || Math.sign(units) !== Math.sign(row.amountMinor) ||
          !categories.includes(split?.category) || typeof split.memo !== 'string' || split.memo.length > 180) {
        throw new HttpsError('invalid-argument', 'Use a valid category and amount on every split.');
      }
      total += units;
      validated.push({ category: split.category, amount: fromMinor(units, row.currency), memo: split.memo.trim() });
    }
    if (validated.length && total !== row.amountMinor) {
      throw new HttpsError('invalid-argument', 'The split amounts must add up to the transaction total.');
    }
    tx.update(ref, { category, splits: validated, isSplit: validated.length > 0, verifiedByUser: true, needsReview: false });
    if (remember && row.vendorKey) {
      tx.set(vendorRules.doc(documentKey(row.vendorKey)), { kind: 'exact', pattern: row.vendorKey, category });
    }
    const result = { saved: true };
    if (action) completeAction(tx, action, result);
    return result;
  });
}

export const saveTransaction = onCall({ region }, async ({ auth, data }) => {
  await assertMember(auth);
  return updateTransaction(data);
});

async function suggestCategories(data) {
  const categories = await allowedCategories();
  const keys = validateCategoryKeys(data?.keys);
  const [snapshots, rules] = await Promise.all([
    db.getAll(...keys.map((key) => ledger.doc(key))),
    vendorRules.get(),
  ]);
  const rows = snapshots.map((snapshot) => ({ ...checkedCategoryRow(snapshot.data()), key: snapshot.id }));
  const suggestions = await buildCategorySuggestions(rows, rules.docs.map((rule) => rule.data()), async (merchants) => {
    const quota = db.doc('settings/categorySuggestionQuota');
    const today = dateKey(nowSeconds());
    await db.runTransaction(async (tx) => {
      const previous = (await tx.get(quota)).data();
      const requests = previous?.date === today ? previous.requests : 0;
      if (requests >= 40) throw new HttpsError('resource-exhausted', 'Today’s suggestion limit is reached. You can still review categories manually.');
      tx.set(quota, { date: today, requests: requests + 1 });
    });
    try {
      return await classifyMerchants(merchants, categories);
    } catch (error) {
      console.error('Category suggestion request failed.', error.name);
      throw new HttpsError('unavailable', 'Gemini suggestions are temporarily unavailable. You can still review categories manually.');
    }
  }, categories);
  return { suggestions };
}

async function applyCategoryBatch(data, action) {
  const changes = validateCategoryChanges(data?.changes, await allowedCategories());
  return db.runTransaction(async (tx) => {
    await assertActionActive(tx, action);
    const snapshots = await tx.getAll(...changes.map(({ key }) => ledger.doc(key)));
    const updates = reviewedUpdates(changes, snapshots);
    for (const { key, category } of updates) {
      tx.update(ledger.doc(key), { category, verifiedByUser: true, needsReview: false });
    }
    completeAction(tx, action, { updated: updates.length });
  });
}

function completeAction(tx, action, result) {
  tx.update(action, { state: 'done', result, data: FieldValue.delete() });
}

function verifyActionOwner(request, household) {
  if (!request?.email || !household || ![household.primaryEmail, household.spouseEmail].includes(request.email)) {
    throw new HttpsError('permission-denied', 'Sign in with an approved household account.');
  }
}

async function assertActionActive(tx, ref) {
  const [action, household] = await tx.getAll(ref, db.doc('settings/household'));
  const request = action.data();
  verifyActionOwner(request, household.data());
  if (request.state !== 'running' || Date.now() - request.createdAt.toMillis() > 110000) {
    throw new HttpsError('deadline-exceeded', 'This request expired. Refresh Activity and try again.');
  }
}

export const processCategoryAction = onDocumentCreated({
  document: 'category_actions/{actionId}', region, timeoutSeconds: 60, maxInstances: 4,
}, async (event) => {
  const ref = event.data?.ref;
  if (!ref) return;
  let claimed = false;
  try {
    const request = await db.runTransaction(async (tx) => {
      const [action, household] = await tx.getAll(ref, db.doc('settings/household'));
      const value = action.data();
      if (value?.state !== 'queued') return null;
      // Claiming the document prevents duplicate delivery from applying the request twice.
      tx.update(ref, { state: 'running' });
      return { value, household: household.data() };
    });
    if (!request) return;
    claimed = true;
    const { value, household } = request;
    verifyActionOwner(value, household);
    if (Date.now() - value.createdAt.toMillis() > 45000) {
      throw new HttpsError('deadline-exceeded', 'This request expired before it could start. Please try again.');
    }
    if (value.kind === 'save') return await updateTransaction(value.data, ref);
    if (value.kind === 'apply') return await applyCategoryBatch(value.data, ref);
    if (value.kind !== 'suggest') throw new HttpsError('invalid-argument', 'Choose a valid category action.');
    const result = await suggestCategories(value.data);
    await db.runTransaction(async (tx) => {
      await assertActionActive(tx, ref);
      completeAction(tx, ref, result);
    });
  } catch (error) {
    if (!claimed) throw error;
    if (!(error instanceof HttpsError)) console.error('Category action failed.', error.name);
    await ref.update({
      state: 'error',
      message: error instanceof HttpsError ? error.message : 'Stead couldn’t complete this category request. Try again.',
      data: FieldValue.delete(),
    });
  }
});

export const nightlyCoach = onSchedule({
  region, schedule: '37 21 * * *', timeZone: 'America/Chicago', timeoutSeconds: 90,
}, () => generateCoachBrief(db, coachModel.value(), nowSeconds()));
