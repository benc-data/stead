import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { fromMinor, toMinor } from '../functions/domain.js';

const fromUnits = (amount, currency) => amount == null ? '' : String(fromMinor(amount, currency));
const parsed = (value, currency) => toMinor(value, currency);
const validAmount = (units) => units != null && units > 0 && units <= 100000000000;
const minDate = '2000-01-01';
const maxDate = '2199-12-31';

function Dialog({ title, children, onClose, save, remove, invalid, action = 'Save' }) {
  const ref = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { ref.current.showModal(); }, []);
  async function finish(callback) {
    setSaving(true);
    setError('');
    try {
      await callback();
      onClose();
    } catch (problem) {
      setError(problem.code === 'permission-denied' ? 'This entry can no longer be changed. Reload the plan and try again.' : (problem.message || 'Could not save your changes.'));
      setSaving(false);
    }
  }
  return <dialog className="editor planner-dialog" ref={ref} aria-labelledby="planner-dialog-title" onCancel={(event) => {
    event.preventDefault();
    if (!saving) onClose();
  }}>
    <form onSubmit={(event) => { event.preventDefault(); if (!saving && !invalid) finish(save); }}>
      <div className="dialog-heading"><h2 id="planner-dialog-title">{title}</h2><button className="icon-button" aria-label="Close editor" type="button" disabled={saving} onClick={onClose}><X size={20} /></button></div>
      <div className="planner-fields">{children}</div>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="editor-actions">
        {remove && <button className="button delete-button" type="button" disabled={saving} onClick={() => finish(remove)}>Delete</button>}
        <button className="button" type="button" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="button primary" disabled={saving || invalid}>{saving ? 'Saving…' : action}</button>
      </div>
    </form>
  </dialog>;
}

export function PlanForm({ item, account, day, data, onClose }) {
  const [kind, setKind] = useState(item?.kind ?? 'expense');
  const [label, setLabel] = useState(item?.label ?? '');
  const [amount, setAmount] = useState(fromUnits(item?.amountMinor, account.currency));
  const [dueDate, setDueDate] = useState(item?.dueDate ?? day);
  const amountMinor = parsed(amount, account.currency);
  const valid = label.trim() && validAmount(amountMinor) && dueDate >= minDate && dueDate <= maxDate;
  const save = () => data.save('plans', item?.key, {
    kind, label: label.trim(), accountId: account.key, currency: account.currency, amountMinor, dueDate,
  });
  return <Dialog title={item ? 'Edit expected item' : 'Add expected item'} onClose={onClose} save={save} invalid={!valid}
    remove={item ? () => data.remove('plans', item.key) : null} action={item ? 'Save changes' : 'Add to calendar'}>
    <label className="field">Type<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="expense">Expense</option><option value="income">Income</option></select></label>
    <label className="field">{kind === 'expense' ? 'Vendor or expense name' : 'Income source'}
      <input required maxLength={100} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={kind === 'expense' ? 'e.g. Internet bill' : 'e.g. Holiday gift'} />
    </label>
    <div className="planner-input-row">
      <label className="field">Amount ({account.currency})<input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label>
      <label className="field">Expected date<input required type="date" min={minDate} max={maxDate} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
    </div>
    <p>Planned for {account.name}. Use the name you expect to see on the bank transaction so Stead can match it.</p>
  </Dialog>;
}

export function ScheduleForm({ account, settings, plan, data, onClose }) {
  const [mid, setMid] = useState(fromUnits(settings?.midmonthMinor, account.currency));
  const [end, setEnd] = useState(fromUnits(settings?.monthEndMinor, account.currency));
  const amounts = [[mid, 'midmonthMinor'], [end, 'monthEndMinor']].filter(([value]) => value.trim())
    .map(([value, key]) => [key, parsed(value, account.currency)]);
  const valid = amounts.every(([, amount]) => amount === 0 || validAmount(amount));
  const placeholders = Object.fromEntries(Object.entries(plan.estimates)
    .map(([slot, rows]) => [slot, rows.length ? fromUnits(rows.reduce((sum, item) => sum + item.amountMinor, 0), account.currency) : 'Auto estimate']));
  return <Dialog title="Paycheck amounts" onClose={onClose} save={() => data.save('schedules', account.key, Object.fromEntries(amounts))}
    invalid={!valid} action="Save schedule">
    <p>Enter the combined take-home pay expected in {account.name} on each payday. Leave a field blank to estimate from past deposits, or enter 0 if no deposit is expected.</p>
    <label className="field">15th of the month<input inputMode="decimal" placeholder={placeholders.midmonth} value={mid} onChange={(event) => setMid(event.target.value)} /></label>
    <label className="field">Last day of the month<input inputMode="decimal" placeholder={placeholders.monthEnd} value={end} onChange={(event) => setEnd(event.target.value)} /></label>
  </Dialog>;
}

export function GoalForm({ goal, accounts, initialAccount, today, data, onClose }) {
  const [accountId, setAccountId] = useState(goal?.accountId ?? initialAccount.key);
  const account = accounts.find(({ key }) => key === accountId) ?? initialAccount;
  const [label, setLabel] = useState(goal?.label ?? '');
  const [target, setTarget] = useState(fromUnits(goal?.targetMinor, account.currency));
  const [saved, setSaved] = useState('');
  const [dueDate, setDueDate] = useState(goal?.dueDate ?? '');
  const targetMinor = parsed(target, account.currency);
  const savedMinor = saved.trim() ? parsed(saved, account.currency) : 0;
  const valid = label.trim() && validAmount(targetMinor) && (savedMinor === 0 || validAmount(savedMinor)) &&
    dueDate >= minDate && dueDate <= maxDate;
  const save = () => data.save('goals', goal?.key, {
    accountId: account.key, currency: account.currency, label: label.trim(), targetMinor, dueDate,
    ...(goal ? {} : { savedMinor }),
  });
  return <Dialog title={goal ? 'Edit savings goal' : 'Create savings goal'} onClose={onClose} save={save} invalid={!valid}
    remove={goal ? () => data.remove('goals', goal.key) : null} action={goal ? 'Save goal' : 'Create goal'}>
    <label className="field">What are you saving for?<input required maxLength={100} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Summer vacation" /></label>
    <label className="field">Account<select value={account.key} disabled={Boolean(goal)} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((item) => <option value={item.key} key={item.key}>{item.name}</option>)}</select></label>
    <div className="planner-input-row">
      <label className="field">Target ({account.currency})<input required inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="0.00" /></label>
      <label className="field">Save by<input required type="date" min={goal ? minDate : today} max={maxDate} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
    </div>
    {!goal && <label className="field">Already set aside ({account.currency})<input inputMode="decimal" value={saved} onChange={(event) => setSaved(event.target.value)} placeholder="0.00" /></label>}
    <p>Bucket savings are set aside within this account and reduce the amount shown as available to spend.</p>
  </Dialog>;
}

export function FundForm({ goal, data, onClose }) {
  const [amount, setAmount] = useState('');
  const [operation, setOperation] = useState('add');
  const amountMinor = parsed(amount, goal.currency);
  const remove = operation === 'release';
  return <Dialog title={goal.label} onClose={onClose} save={() => data.adjustGoal(goal.key, remove ? -amountMinor : amountMinor)}
    invalid={!validAmount(amountMinor) || (remove && amountMinor > goal.savedMinor)} action={remove ? 'Release savings' : 'Set aside'}>
    <label className="field">Action<select value={operation} onChange={(event) => setOperation(event.target.value)}><option value="add">Set money aside</option><option value="release">Release earmarked money</option></select></label>
    <label className="field">Amount ({goal.currency})<input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label>
    <p>This updates the bucket within Stead. Your bank balance changes when money actually moves.</p>
  </Dialog>;
}
