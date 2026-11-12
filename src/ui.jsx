import { format, parseISO } from 'date-fns';
import {
  ArrowRight, Banknote, CalendarDays, Coffee, CreditCard, House,
  ShoppingBag, ShoppingCart, Zap, Car, Heart, Repeat2, Plane, Wallet, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { dateKey } from '../functions/domain.js';

const currencyFormatters = new Map();

export function money(amount, currency = 'USD') {
  if (amount == null) return '—';
  if (!/^[A-Z]{3}$/.test(currency)) return `${amount.toLocaleString()} units`;
  if (!currencyFormatters.has(currency)) {
    currencyFormatters.set(currency, new Intl.NumberFormat('en-US', { style: 'currency', currency }));
  }
  return currencyFormatters.get(currency).format(amount);
}

export function dayLabel(key) {
  return format(parseISO(key), 'MMM d');
}

export function monthLabel(month, pattern = 'MMMM yyyy') {
  return format(parseISO(`${month}-01`), pattern);
}

export function Brand() {
  return <div className="brand"><img src="/icon.svg" alt="" width="40" height="40" /><span>stead<span className="brand-dot">.</span></span></div>;
}

const categoryVisual = {
  Groceries: [ShoppingCart, 'mint'], Dining: [Coffee, 'sand'],
  Shopping: [ShoppingBag, 'lilac'], 'Household Goods': [House, 'lilac'],
  Transportation: [Car, 'blue'], Health: [Heart, 'pink'],
  Housing: [House, 'sand'], Utilities: [Zap, 'blue'],
  Subscriptions: [Repeat2, 'lilac'], Income: [Banknote, 'mint'],
  Travel: [Plane, 'blue'], Transfer: [ArrowRight, 'blue'],
};

export function CategoryIcon({ category }) {
  const [Icon, tone] = categoryVisual[category] ?? [CreditCard, 'neutral'];
  return <span className={`category-icon ${tone}`}><Icon size={17} strokeWidth={1.8} /></span>;
}

export function Empty({ icon: Icon = Wallet, title, children }) {
  return <div className="empty"><span className="category-icon mint"><Icon size={20} /></span><strong>{title}</strong><p>{children}</p></div>;
}

export function Upcoming({ items, currency, onAll }) {
  const total = items.reduce((sum, item) => sum + (item.overdue ? 0 : -item.typicalAmount), 0);
  return <section className="panel upcoming-panel">
    <div className="panel-head"><div><h2>Coming up</h2><p>Next 14 days</p></div><span className="calendar-icon"><CalendarDays size={17} /></span></div>
    <div className="committed"><span>Expected outflows</span><strong>{money(total, currency)}</strong></div>
    {items.length ? <div className="upcoming-list" tabIndex="0" aria-label="Upcoming payments">
      {items.map((item) => <div className="upcoming-row" key={`${item.id}-${item.dueDate}`}>
        <CategoryIcon category={item.category} /><div><strong>{item.payee}</strong><small>{dayLabel(item.dueDate)}{item.overdue ? ' · past expected date' : ''}</small></div><b>{money(-item.typicalAmount, currency)}</b>
      </div>)}
    </div> : <Empty icon={Repeat2} title="No payments expected">Regular bills appear here once a pattern is detected.</Empty>}
    {onAll && <button className="text-button all-recurring" onClick={onAll}>View recurring <ArrowRight size={15} /></button>}
  </section>;
}

export function Transactions({ rows, accounts, onEdit, selection }) {
  return rows.length ? <div className="transactions-list">{rows.map((row) => {
    const account = accounts.find(({ key }) => key === row.accountId);
    const split = row.isSplit || Boolean(row.splits?.length);
    const content = <>
      <CategoryIcon category={row.category} />
      <span className="transaction-name"><strong>{row.payee}</strong><small>{dayLabel(dateKey(row.postedDate))}{account ? ` · ${account.name}` : ''}
        {selection ? ` · ${split ? 'Split' : row.category}${row.pending ? ' · Pending' : ''}` : ''}</small></span>
      <span className="transaction-category">{row.needsReview ? 'Review split' : row.pending ? 'Pending' : row.isSplit ? `${row.splits.length} categories` : row.category}</span>
      <strong className={row.amountMinor > 0 ? 'positive' : ''}>{row.amountMinor > 0 ? '+' : ''}{money(row.amount, row.currency)}</strong>
    </>;
    if (selection) {
      const selected = !split && selection.keys.has(row.key);
      const disabled = split || (!selected && selection.full);
      return <label className={`transaction batch-transaction ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`} key={row.key}>
        <input type="checkbox" aria-label={`Select ${row.payee}`} disabled={disabled} checked={selected}
          onChange={(event) => selection.toggle(row.key, event.target.checked)} />
        {content}
      </label>;
    }
    return <button className="transaction" key={row.key} onClick={() => onEdit(row)}>
      {content}<ChevronRight className="row-chevron" size={16} />
    </button>;
  })}</div> : <Empty title="No transactions to show">Imported transactions will appear here.</Empty>;
}

export function MonthPicker({ month, latest, onMove, earliest }) {
  return <div className="month-picker">
    <button className="icon-button" aria-label="Previous month" disabled={month <= earliest} onClick={() => onMove(-1)}><ChevronLeft size={18} /></button>
    <span><CalendarDays size={15} /> {monthLabel(month)}</span>
    <button className="icon-button" aria-label="Next month" disabled={month >= latest} onClick={() => onMove(1)}><ChevronRight size={18} /></button>
  </div>;
}
