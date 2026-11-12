import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Sparkles, X } from 'lucide-react';
import { fromMinor } from '../functions/domain.js';
import { CategorySelect } from './editor.jsx';
import { CategoryIcon, money } from './ui.jsx';
import { categoryError } from './category-error.js';

function draft(row, suggestion) {
  const current = suggestion?.currentCategory ?? row.category;
  const category = suggestion?.category ?? current;
  return {
    key: row.key, amountMinor: suggestion?.amountMinor ?? row.amountMinor, expectedCategory: current, category,
    apply: Boolean(suggestion?.confident && category !== current),
    source: suggestion?.source ?? 'manual',
    confident: suggestion?.confident ?? false,
  };
}

export default function BulkCategories({ review, onApply, onClose }) {
  const dialog = useRef(null);
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current.showModal(); }, []);

  const suggestions = new Map((review.suggestions ?? []).map((item) => [item.key, item]));
  const drafts = review.rows.map((row) => ({ ...draft(row, suggestions.get(row.key)), ...edits[row.key] }));
  const approved = drafts.filter((item) => item.apply);
  const update = (key, fields) => setEdits((current) => ({ ...current, [key]: { ...current[key], ...fields } }));

  async function submit(event) {
    event.preventDefault();
    if (review.loading || saving || !approved.length) return;
    setSaving(true);
    setError('');
    try {
      await onApply(approved.map(({ key, category, expectedCategory, amountMinor }) => ({ key, category, expectedCategory, amountMinor })));
    } catch (problem) {
      setError(categoryError(problem, 'Couldn’t save these categories. Try again.'));
      setSaving(false);
    }
  }

  return <dialog ref={dialog} className="editor bulk-review" aria-labelledby="bulk-review-title" onCancel={(event) => {
    event.preventDefault();
    if (!saving) onClose();
  }}>
    <form onSubmit={submit}>
      <div className="bulk-review-head">
        <span className="category-icon mint"><Sparkles size={18} /></span>
        <div><h2 id="bulk-review-title">Review categories</h2><p>{review.rows.length} selected · Choose which changes to apply</p></div>
        <button type="button" className="icon-button" aria-label="Close category review" disabled={saving} onClick={onClose}><X size={19} /></button>
      </div>
      {review.loading ? <p className="bulk-review-loading" role="status"><LoaderCircle size={20} className="spin" /> Looking up category suggestions…</p> : <>
        {review.warning && <p className="notice" role="status">{review.warning} You can choose categories below.</p>}
        <fieldset className="bulk-review-rows" disabled={saving}>
          {review.rows.map((row, index) => {
            const item = drafts[index];
            const source = item.source === 'known' ? 'Known vendor'
              : item.source === 'gemini' ? item.confident ? 'AI suggestion' : 'Check this guess' : 'Choose a category';
            return <div className={`bulk-review-row ${item.apply ? 'approved' : ''}`} key={row.key}>
              <div className="bulk-review-row-title">
                <CategoryIcon category={item.expectedCategory} />
                <div><strong>{row.payee}</strong><small>Current · {item.expectedCategory}{row.pending ? ' · Pending' : ''}</small></div>
                <b>{money(fromMinor(item.amountMinor, row.currency), row.currency)}</b>
              </div>
              <div className="bulk-review-row-fields">
                <CategorySelect label={`Category for ${row.payee}`} value={item.category}
                  onChange={(category) => update(row.key, { category, apply: category !== item.expectedCategory })} />
                <label className="checkbox"><input type="checkbox" aria-label={`Apply category for ${row.payee}`}
                  checked={item.apply} onChange={(event) => update(row.key, { apply: event.target.checked })} /> Apply</label>
              </div>
              <small className="bulk-review-source">{edits[row.key]?.category !== undefined ? 'Edited by you' : source}</small>
            </div>;
          })}
        </fieldset>
      </>}
      <div className="bulk-review-footer">
        {error && <p className="notice error" role="alert">{error}</p>}
        <div className="editor-actions">
          <button type="button" className="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={review.loading || saving || !approved.length}>
            <Check size={16} /> {saving ? 'Saving…' : `Apply ${approved.length} ${approved.length === 1 ? 'category' : 'categories'}`}
          </button>
        </div>
      </div>
    </form>
  </dialog>;
}
