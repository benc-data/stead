import { collection, deleteDoc, doc, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { app, auth, emulator } from './data.js';
import { moveAccount } from '../functions/cockpit.js';

import { db } from './firestore-client.js';
import { categoryPatch, approvedCategoryChanges } from '../functions/category-writes.js';
export { db } from './firestore-client.js';

export async function syncBank() {
  const { connectFunctionsEmulator, getFunctions, httpsCallable } = await import('firebase/functions');
  const functions = getFunctions(app, 'us-central1');
  if (emulator) connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  return httpsCallable(functions, 'syncBank', { timeout: 310000 })();
}

export async function submitCategoryAction(kind, data) {
  const user = auth.currentUser;
  if (!user?.email) throw new Error('Sign in to change categories.');
  const request = doc(collection(db, 'category_actions'));
  await runTransaction(db, (tx) => {
    tx.set(request, { uid: user.uid, email: user.email, kind, data, state: 'queued', createdAt: serverTimestamp() });
    return Promise.resolve();
  });
  return new Promise((resolve, reject) => {
    let stop;
    const finish = (callback, value) => {
      clearTimeout(timeout);
      stop?.();
      callback(value);
    };
    const timeout = setTimeout(() => {
      finish(reject, new Error('Stead hasn’t confirmed this request. Refresh Activity to check before retrying.'));
    }, 80000);
    stop = onSnapshot(request, (snapshot) => {
      const action = snapshot.data();
      if (action?.state === 'done') finish(resolve, action.result);
      else if (action?.state === 'error') finish(reject, new Error(action.message));
      else return;
      deleteDoc(request).catch(() => {});
    }, (error) => finish(reject, error));
  });
}

export function saveTransaction(data, categories) {
  if (data.splits?.length > 4) return submitCategoryAction('save', data);
  return runTransaction(db, async (tx) => {
    const ref = doc(db, 'transactions', data.key);
    const snapshot = await tx.get(ref);
    const row = snapshot.data();
    const patch = categoryPatch(row, data, categories);
    tx.update(ref, patch);
    if (data.remember && row.vendorKey) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([row.vendorKey])));
      const id = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
      tx.set(doc(db, 'vendor_rules', id), { kind: 'exact', pattern: row.vendorKey, category: data.category });
    }
    return { saved: true };
  });
}

export function applyCategories(changes, categories) {
  approvedCategoryChanges(changes, categories);
  return runTransaction(db, async (tx) => {
    const refs = changes.map(({ key }) => doc(db, 'transactions', key));
    const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
    const patches = changes.map((change, index) => {
      const row = snapshots[index].data();
      if (!row || (row.category !== change.expectedCategory && row.category !== change.category)) {
        throw new Error('A transaction changed during review. Refresh Activity and try again.');
      }
      return categoryPatch(row, { ...change, quick: true, splits: [] }, categories);
    });
    refs.forEach((ref, index) => tx.update(ref, patches[index]));
    return { updated: refs.length };
  });
}

export function saveAccountPosition(accounts, key, offset) {
  const ref = doc(db, 'settings', 'accountOrder');
  return runTransaction(db, async (tx) => {
    const snapshot = await tx.get(ref);
    tx.set(ref, { ids: moveAccount(accounts, snapshot.get('ids'), key, offset) });
  });
}

export function useHousehold(uid, page) {
  const [state, setState] = useState({});
  const [recent, setRecent] = useState(null);
  const [history, setHistory] = useState(null);
  const [older, setOlder] = useState(null);
  const [cutoffs] = useState(() => {
    const now = Date.now() / 1000;
    return { recent: now - 45 * 86400, history: now - 414 * 86400 };
  });
  useEffect(() => {
    if (!uid) return;
    const sources = {
      accounts: collection(db, 'accounts'),
      forecasts: collection(db, 'recurring_forecasts'),
      sync: doc(db, 'settings', 'sync'),
      accountOrder: doc(db, 'settings', 'accountOrder'),
    };
    const fail = () => setState((current) => ({ ...current, error: 'Household data could not be loaded. Try signing in again.' }));
    const stops = Object.entries(sources).map(([key, ref]) => onSnapshot(ref, { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache && snapshot.docs && snapshot.empty) return;
      const value = snapshot.docs ? snapshot.docs.map((record) => ({ ...record.data(), key: record.id })) : snapshot.data() ?? {};
      setState((current) => ({ ...current, [key]: value }));
    }, fail));
    stops.push(onSnapshot(query(collection(db, 'transactions'), where('postedDate', '>=', cutoffs.recent)), { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache && snapshot.empty) return;
      setRecent(snapshot.docs.map((record) => ({ ...record.data(), key: record.id })));
    }, fail));
    return () => stops.forEach((stop) => stop());
  }, [uid, cutoffs]);
  const recentLoaded = recent !== null;
  useEffect(() => {
    if (!uid || !recentLoaded) return;
    return onSnapshot(query(collection(db, 'transactions'), where('postedDate', '>=', cutoffs.history), where('postedDate', '<', cutoffs.recent)), (snapshot) => {
      setHistory(snapshot.docs.map((record) => ({ ...record.data(), key: record.id })));
    }, () => setState((current) => ({ ...current, error: 'Older history could not be loaded.' })));
  }, [uid, recentLoaded, cutoffs]);
  useEffect(() => {
    if (!uid || page !== 'transactions') return;
    return onSnapshot(query(collection(db, 'transactions'), where('postedDate', '<', cutoffs.history)), (snapshot) => {
      setOlder(snapshot.docs.map((record) => ({ ...record.data(), key: record.id })));
    }, () => setState((current) => ({ ...current, error: 'Older activity could not be loaded.' })));
  }, [uid, page, cutoffs]);
  useEffect(() => {
    if (!uid || page !== 'settings') return;
    return onSnapshot(collection(db, 'vendor_rules'), (snapshot) => {
      setState((current) => ({ ...current, rules: snapshot.docs.map((record) => ({ ...record.data(), key: record.id })) }));
    });
  }, [uid, page]);
  const transactions = useMemo(() => [...(recent ?? []), ...(history ?? []), ...(page === 'transactions' ? older ?? [] : [])], [recent, history, older, page]);
  return { ...state, transactions, transactionsLoaded: recentLoaded, historyLoading: history === null };
}
