import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { Plus } from 'lucide-react';
import { appendCategory, categoryOptions, CATEGORY_NAME_LIMIT } from '../functions/categories.js';
import { isDemo } from './data.js';
import { db } from './firestore-client.js';

const demoKey = 'stead-demo-categories-v1';
const CategoryContext = createContext({ options: categoryOptions(), ready: false });

export function CategoryProvider({ children }) {
  const [registry, setRegistry] = useState(() => {
    if (isDemo) { try { return JSON.parse(localStorage.getItem(demoKey)) ?? {}; } catch {} }
    return {};
  });
  const [ready, setReady] = useState(isDemo);
  const [error, setError] = useState('');
  useEffect(() => {
    if (isDemo) return;
    return onSnapshot(doc(db, 'settings', 'categories'), { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache && !snapshot.exists()) return;
      setRegistry(snapshot.data() ?? {});
      setReady(true);
      setError('');
    }, () => setError('Categories could not be loaded. Refresh to try again.'));
  }, []);
  const options = useMemo(() => categoryOptions(registry.names), [registry]);
  async function add(value) {
    if (!ready) throw new Error(error || 'Categories are still loading. Try again in a moment.');
    let next;
    if (isDemo) next = appendCategory(registry, value);
    else next = await runTransaction(db, async (tx) => {
      const ref = doc(db, 'settings', 'categories');
      const current = await tx.get(ref);
      const updated = appendCategory(current.data(), value);
      tx.set(ref, updated);
      return updated;
    });
    if (isDemo) localStorage.setItem(demoKey, JSON.stringify(next));
    setRegistry((current) => (current.names?.length ?? 0) > next.names.length ? current : next);
    return next.names.at(-1);
  }
  return <CategoryContext.Provider value={{ options, custom: registry.names ?? [], ready, error, add }}>{children}</CategoryContext.Provider>;
}

export const useCategories = () => useContext(CategoryContext);

export function CategoryCreator({ onCreated, onCancel, autoFocus = false }) {
  const { add, ready, error: loadError } = useCategories();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);
  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);
  async function create() {
    if (saving || !name.trim() || !ready) return;
    setSaving(true);
    setError('');
    try {
      const created = await add(name);
      setName('');
      onCreated?.(created);
    } catch (problem) {
      setError(problem.code === 'permission-denied' ? 'The category could not be saved. Refresh and try again.' : problem.message || 'The category could not be saved.');
    } finally { setSaving(false); }
  }
  return <div className="category-create">
    <input ref={input} aria-label="New category name" placeholder="e.g. Kids & school" maxLength={CATEGORY_NAME_LIMIT} value={name} disabled={saving}
      onChange={(event) => setName(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); create(); }
        if (event.key === 'Escape' && onCancel) { event.preventDefault(); event.stopPropagation(); if (!saving) onCancel(); }
      }} />
    <div className="category-create-actions"><button className="button" type="button" disabled={saving || !ready || !name.trim()} onClick={create}>
      <Plus size={15} />{saving ? 'Adding…' : 'Add category'}</button>
      {onCancel && <button className="text-button" type="button" disabled={saving} onClick={onCancel}>Cancel</button>}</div>
    {(error || loadError) && <p className="notice error" role="alert">{error || loadError}</p>}
  </div>;
}

export function CategorySettings() {
  const { custom, ready } = useCategories();
  const [message, setMessage] = useState('');
  return <section className="panel settings-panel category-settings">
    <div className="panel-head"><div><h2>Categories</h2><p>Add categories for the way your family spends. They’re shared with both of you.</p></div></div>
    <CategoryCreator onCreated={(name) => setMessage(`${name} added.`)} />
    {message && <p className="category-message" role="status">{message}</p>}
    {custom.length > 0 && <ul className="custom-category-list" aria-label="Custom categories">{custom.map((name) => <li key={name}>{name}</li>)}</ul>}
    {!ready && <p role="status">Loading categories…</p>}
  </section>;
}
