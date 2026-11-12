import { useRef, useState } from 'react';
import { Check, GripVertical, ListFilter, X } from 'lucide-react';
import { useCategories } from './categories.jsx';
import { CategoryIcon, money } from './ui.jsx';
import { categoryError } from './category-error.js';

export default function QuickSort({ rows, save, onClose }) {
  const { options: categories } = useCategories();
  const eligible = rows.filter((row) => !row.isSplit);
  const [selected, setSelected] = useState('');
  const [ghost, setGhost] = useState(null);
  const [over, setOver] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const drag = useRef(null);
  const options = eligible.filter((row) => row.amountMinor < 0).slice(0, 5);
  const row = options.find(({ key }) => key === selected);
  const targetAt = ({ clientX, clientY }) => document.elementFromPoint(clientX, clientY)?.closest('[data-sort-category]')?.dataset.sortCategory;

  async function assign(transaction, category) {
    if (saving || !transaction || !category) return;
    setSaving(true);
    setStatus('');
    setError(false);
    try {
      await save({ key: transaction.key, category, amountMinor: transaction.amountMinor, splits: [], quick: true });
      setSelected('');
      setStatus(`${transaction.payee} moved to ${category}.`);
    } catch (problem) {
      setError(true);
      setStatus(categoryError(problem, 'Could not move this transaction. Try again.'));
    } finally {
      setSaving(false);
    }
  }

  function start(event, transaction) {
    if (saving || event.button !== 0 || !event.isPrimary) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { transaction, x: event.clientX, y: event.clientY, moving: false };
    setSelected(transaction.key);
  }
  function move(event) {
    const active = drag.current;
    if (!active) return;
    if (!active.moving && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 6) return;
    active.moving = true;
    setGhost({ label: active.transaction.payee, x: event.clientX, y: event.clientY });
    setOver(targetAt(event));
  }
  function end(event, cancelled = false) {
    const active = drag.current;
    drag.current = null;
    setGhost(null);
    setOver(null);
    if (active?.moving && !cancelled) assign(active.transaction, targetAt(event));
  }

  return <section className="panel quick-sort" aria-labelledby="quick-sort-heading">
    <div className="panel-head"><div><div className="deck-kicker"><ListFilter size={14} /> QUICK SORT</div>
      <h2 id="quick-sort-heading">Put purchases in their place</h2>
      <p>Drag a grip onto a category, or tap a purchase and then a category.</p></div>
      <button className="icon-button" aria-label="Close quick sort" onClick={onClose}><X size={18} /></button></div>
    <div className="sort-palette" aria-label="Category drop targets">
      {categories.filter((category) => category !== 'Income').map((category) => <button key={category}
        data-sort-category={category} className={over === category ? 'drag-over' : ''}
        disabled={saving || (!row && !ghost)} onClick={() => assign(row, category)}>{category}</button>)}
    </div>
    {options.length ? <div className="sort-transactions">{options.map((item) => <div className={`sort-transaction ${selected === item.key ? 'selected' : ''}`} key={item.key}>
      <button className="sort-grip" aria-label={`Drag or select ${item.payee}`} aria-pressed={selected === item.key} disabled={saving}
        onPointerDown={(event) => start(event, item)} onPointerMove={move} onPointerUp={(event) => end(event)}
        onPointerCancel={(event) => end(event, true)} onLostPointerCapture={(event) => end(event, true)}
        onClick={(event) => { if (event.detail === 0) setSelected(item.key); }}><GripVertical size={19} /></button>
      <button className="sort-select" onClick={() => setSelected(item.key)} aria-pressed={selected === item.key} disabled={saving}>
        <CategoryIcon category={item.category} /><span><strong>{item.payee}</strong><small>{item.category}</small></span>
        <b>{money(item.amount, item.currency)}</b>
      </button>
    </div>)}</div> : <p className="empty-line">Single-category purchases appear here. Split purchases can be edited in the ledger.</p>}
    {status && <p className={`sort-status ${error ? 'error' : ''}`} role="status">{!error && <Check size={15} />}{status}</p>}
    {ghost && <div className="sort-ghost" style={{ left: ghost.x, top: ghost.y }}>{ghost.label}</div>}
  </section>;
}
