import { useEffect, useRef, useState } from 'react';
import { Plus, Sparkles, Trash2, X } from 'lucide-react';
import { fromMinor, minorDigits, smartSplit, toMinor } from '../functions/domain.js';
import { CategoryIcon, money } from './ui.jsx';
import { CategoryCreator, useCategories } from './categories.jsx';
import { categoryError } from './category-error.js';

export function CategorySelect({ value, onChange, label }) {
  const { options } = useCategories();
  const [creating, setCreating] = useState(false);
  return <div className="category-picker"><select aria-label={label} value={value} onChange={(event) => {
    if (event.target.value === '') setCreating(true);
    else onChange(event.target.value);
  }}>
    {[...new Set([...options, value].filter(Boolean))].map((category) => <option key={category}>{category}</option>)}
    <option value="">＋ Add category…</option>
  </select>
  {creating && <CategoryCreator autoFocus onCancel={() => setCreating(false)} onCreated={(name) => { onChange(name); setCreating(false); }} />}
  </div>;
}

export function TransactionEditor({ row, history, onSave, onClose }) {
  const dialog = useRef(null);
  const [category, setCategory] = useState(row.category);
  const [remember, setRemember] = useState(false);
  const [splits, setSplits] = useState(() => (row.splits ?? []).map((split) => ({
    ...split, amount: String(Math.abs(split.amount)), localKey: crypto.randomUUID(),
  })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const suggested = smartSplit(row, history);
  const amounts = splits.map((split) => toMinor(split.amount, row.currency));
  const remaining = Math.abs(row.amountMinor) - amounts.reduce((sum, amount) => sum + (amount ?? 0), 0);
  const valid = !splits.length || (splits.length >= 2 && amounts.every((amount) => amount > 0) && remaining === 0);
  const canSplit = Math.abs(row.amountMinor) >= 2;
  useEffect(() => { dialog.current.showModal(); }, []);

  const update = (key, field, value) => setSplits((current) =>
    current.map((split) => split.localKey === key ? { ...split, [field]: value } : split));
  const blankSplit = (nextCategory, amount = '') => ({ category: nextCategory, amount, memo: '', localKey: crypto.randomUUID() });

  function addSplit() {
    if (!splits.length) {
      const half = Math.floor(Math.abs(row.amountMinor) / 2);
      setSplits([
        blankSplit(category, String(fromMinor(half, row.currency))),
        blankSplit('Other', String(fromMinor(Math.abs(row.amountMinor) - half, row.currency))),
      ]);
    } else {
      setSplits((current) => [...current, blankSplit('Other', remaining > 0 ? String(fromMinor(remaining, row.currency)) : '')]);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!valid || saving) return;
    setError('');
    setSaving(true);
    try {
      await onSave({
        key: row.key, category, remember, amountMinor: row.amountMinor,
        splits: splits.map((split, index) => ({
          category: split.category, memo: split.memo ?? '',
          amount: fromMinor(amounts[index] * Math.sign(row.amountMinor), row.currency),
        })),
      });
      onClose();
    } catch (problem) {
      setError(categoryError(problem, 'The transaction could not be saved. Try again.'));
      setSaving(false);
    }
  }

  return <dialog ref={dialog} aria-labelledby="edit-title" className="editor" onCancel={(event) => {
    event.preventDefault();
    if (!saving) onClose();
  }}>
    <form onSubmit={submit}>
      <div className="editor-head">
        <CategoryIcon category={row.category} /><div><h2 id="edit-title">{row.payee}</h2><p>{money(row.amount, row.currency)}{row.pending ? ' · Pending' : ''}</p></div>
        <button type="button" className="icon-button" aria-label="Close editor" disabled={saving} onClick={onClose}><X size={20} /></button>
      </div>
      {row.needsReview && <p className="notice">The bank changed this amount. Review the category and split again.</p>}
      <div className="field"><span>Category</span><CategorySelect value={category} onChange={setCategory} label="Category" /></div>
      {row.vendorKey && <label className="checkbox"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Use this category for future purchases from this vendor</label>}
      <div className="split-head">
        <div><h3>Split transaction</h3><p>Assign parts of the total to different categories.</p></div>
        <button type="button" className="button small" disabled={suggested.length < 2} title={suggested.length < 2 ? 'Needs previous splits for this vendor' : ''} onClick={() =>
          setSplits(suggested.map((split) => blankSplit(split.category, String(Math.abs(split.amount)))))}><Sparkles size={15} /> Smart Split</button>
      </div>
      {splits.map((split, i) => <div className="split-row" key={split.localKey}>
        <CategorySelect label={`Split ${i + 1} category`} value={split.category} onChange={(value) => update(split.localKey, 'category', value)} />
        <input aria-label={`Split ${i + 1} amount`} value={split.amount} inputMode={minorDigits(row.currency) ? 'decimal' : 'numeric'} onChange={(event) => update(split.localKey, 'amount', event.target.value)} />
        <button type="button" className="icon-button" aria-label={`Remove split ${i + 1}`} onClick={() => setSplits((current) => current.filter((part) => part.localKey !== split.localKey))}><Trash2 size={17} /></button>
        <input className="split-memo" aria-label={`Split ${i + 1} memo`} placeholder="Memo (optional)" maxLength={180} value={split.memo ?? ''} onChange={(event) => update(split.localKey, 'memo', event.target.value)} />
      </div>)}
      {canSplit && <button type="button" className="text-button add-split" disabled={splits.length >= 20} onClick={addSplit}><Plus size={17} /> {splits.length ? 'Add another split' : 'Add split'}</button>}
      {splits.length > 0 && <p className="remainder" aria-live="polite">{remaining < 0 ? 'Over by ' : 'Remaining '}{money(fromMinor(Math.abs(remaining), row.currency), row.currency)}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="editor-actions"><button type="button" className="button" onClick={onClose} disabled={saving}>Cancel</button><button className="button primary" disabled={!valid || saving}>{saving ? 'Saving…' : 'Save changes'}</button></div>
    </form>
  </dialog>;
}
