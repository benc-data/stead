import { addDoc, collection, deleteDoc, doc, onSnapshot, runTransaction, setDoc, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { dateKey, shiftDays } from '../functions/domain.js';
import { findPlanMatches } from '../functions/planner.js';
import { isDemo } from './data.js';
import { db } from './firestore-client.js';

const group = { plans: 'planned_items', goals: 'savings_goals', schedules: 'paycheck_settings' };
const demoKey = 'stead-demo-planner-v1';
const empty = { plans: [], goals: [], schedules: [], coach: {}, brief: {} };
const sample = (today) => ({
  plans: [
    { key: 'vet', accountId: 'checking', currency: 'USD', label: 'Vet visit', amountMinor: 8500, dueDate: shiftDays(today, 3), kind: 'expense' },
    { key: 'gifts', accountId: 'checking', currency: 'USD', label: 'Holiday gifts', amountMinor: 15000, dueDate: shiftDays(today, 14), kind: 'expense' },
  ],
  goals: [
    { key: 'vacation', accountId: 'checking', currency: 'USD', label: 'Spring getaway', targetMinor: 120000, savedMinor: 42500, dueDate: shiftDays(today, 84) },
    { key: 'emergency', accountId: 'savings', currency: 'USD', label: 'Emergency cushion', targetMinor: 250000, savedMinor: 175000, dueDate: shiftDays(today, 105) },
  ],
  schedules: [{ key: 'checking', midmonthMinor: 196000, monthEndMinor: 196000 }],
  coach: { enabled: false, note: '' },
  brief: {},
});

export function usePlannerData(today, rows) {
  const [state, setState] = useState(() => {
    if (!isDemo) return {};
    try {
      return JSON.parse(localStorage.getItem(demoKey)) ?? sample(today);
    } catch {
      return sample(today);
    }
  });
  useEffect(() => {
    if (isDemo) {
      try { localStorage.setItem(demoKey, JSON.stringify(state)); } catch {}
    }
  }, [state]);
  useEffect(() => {
    if (isDemo) return;
    const targets = {
      ...Object.fromEntries(Object.entries(group).map(([key, path]) => [key, collection(db, path)])),
      coach: doc(db, 'settings', 'coach'),
      brief: doc(db, 'settings', 'coachBrief'),
    };
    const unsubscribes = Object.entries(targets).map(([key, ref]) => onSnapshot(ref, { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.docs && snapshot.empty && snapshot.metadata.fromCache) return;
      const items = snapshot.docs ? snapshot.docs.map((record) => ({ ...record.data(), key: record.id })) : snapshot.data() ?? {};
      setState((current) => ({ ...current, [key]: items }));
    }, () => setState((current) => ({ ...current, error: 'The paycheck plan could not be loaded.' }))));
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, []);

  async function save(kind, key, fields) {
    if (!isDemo) {
      if (kind === 'coach') return setDoc(doc(db, 'settings', 'coach'), fields);
      if (kind === 'schedules') return setDoc(doc(db, group[kind], key), fields);
      if (key) {
        const ref = doc(db, group[kind], key);
        return kind === 'goals' ? updateDoc(ref, fields) : setDoc(ref, fields);
      }
      return addDoc(collection(db, group[kind]), fields);
    }
    if (kind === 'coach') return setState((current) => ({ ...current, coach: fields }));
    const itemKey = key ?? crypto.randomUUID();
    setState((current) => {
      const previous = current[kind].find((item) => item.key === itemKey);
      const items = [...current[kind].filter((item) => item.key !== itemKey), { ...previous, ...fields, key: itemKey }];
      if (kind === 'schedules') {
        return { ...current, schedules: items.map((item) => item.key === itemKey ? { ...fields, key: itemKey } : item) };
      }
      if (kind !== 'plans') return { ...current, [kind]: items };
      const matchedRows = new Set(items.map((item) => item.matchedTransactionKey).filter(Boolean));
      const matches = new Map(findPlanMatches(items, rows.filter((row) => !matchedRows.has(row.key)))
        .map(({ plan, row }) => [plan.key, row]));
      return { ...current, plans: items.map((item) => {
        const row = matches.get(item.key);
        return row ? {
          ...item, matchedTransactionKey: row.key, matchedAmountMinor: Math.abs(row.amountMinor),
          matchedDate: dateKey(row.postedDate),
        } : item;
      }) };
    });
  }

  async function remove(kind, key) {
    if (!isDemo) return deleteDoc(doc(db, group[kind], key));
    setState((current) => ({ ...current, [kind]: current[kind].filter((item) => item.key !== key) }));
  }

  async function adjustGoal(key, amountMinor) {
    const adjusted = (saved) => Math.max(0, Math.min(100000000000, saved + amountMinor));
    if (!isDemo) {
      const ref = doc(db, 'savings_goals', key);
      return runTransaction(db, async (tx) => {
        const goal = await tx.get(ref);
        if (!goal.exists()) throw new Error('This goal is no longer available.');
        tx.update(ref, { savedMinor: adjusted(goal.get('savedMinor')) });
      });
    }
    setState((current) => ({
      ...current,
      goals: current.goals.map((goal) => goal.key === key ? { ...goal, savedMinor: adjusted(goal.savedMinor) } : goal),
    }));
  }

  const loading = !isDemo && !state.error && ['plans', 'goals', 'schedules'].some((key) => !(key in state));
  return { ...empty, ...state, loading, save, remove, adjustGoal };
}
