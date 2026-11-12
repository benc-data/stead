import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowRight, ArrowUp, CalendarRange, ListChecks, Sparkles, CircleHelp, Landmark, LayoutDashboard, ListFilter, ListTree,
  LockKeyhole, LogOut, RefreshCw, Repeat2, Search, Settings, ShieldCheck, WifiOff,
} from 'lucide-react';
import { CATEGORY_BATCH_LIMIT, dateKey, upcomingOutflows, vendorKey } from '../functions/domain.js';
import { cashAccount, categoryRoom, cycleCategoryPace, moveAccount, orderAccounts, paycheckCycle, runwayToPayday } from '../functions/cockpit.js';
import { isDemo, logout } from './data.js';
import { applyCategories, saveAccountPosition, saveTransaction, submitCategoryAction, syncBank, useHousehold } from './household-data.js';
import { demoData } from './demo.js';
import { TransactionEditor } from './editor.jsx';
import { Brand, CategoryIcon, dayLabel, Empty, money, Transactions, Upcoming } from './ui.jsx';
import { FlightDeck } from './cockpit.jsx';
import QuickSort from './quick-sort.jsx';
import { CategoryProvider, CategorySettings, useCategories } from './categories.jsx';
import BulkCategories from './bulk-categories.jsx';
import { categoryError } from './category-error.js';
import { usePlannerData } from './planner-data.js';
import './planner.css';
import './cockpit.css';
import './bulk-categories.css';

const Paychecks = lazy(() => import('./paychecks.jsx'));

const navigation = [
  ['overview', 'Overview', LayoutDashboard],
  ['transactions', 'Activity', ListTree],
  ['paychecks', 'Paychecks', CalendarRange],
  ['recurring', 'Recurring', Repeat2],
  ['accounts', 'Accounts', Landmark],
  ['settings', 'Settings', Settings],
];
const descriptions = {
  overview: 'Cash, spending, and your next move.',
  transactions: 'Review purchases, assign categories, and split shared expenses.',
  paychecks: 'Plan cash around the 15th and month-end.',
  recurring: 'See expected bills, subscriptions, and income.',
  accounts: 'Balances from your linked bank and card accounts.',
  settings: 'Manage bank sync and review saved vendor rules.',
};
const emptyArray = [];
function useClock() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(tick, 15000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(id); window.removeEventListener('focus', tick); };
  }, []);
  return now;
}

function demoCategorySuggestions(rows) {
  const examples = { 'whole foods market': 'Groceries', 'blue bottle coffee': 'Dining', 'neighborhood market': 'Groceries', shell: 'Transportation' };
  return rows.map((row) => {
    const known = examples[row.vendorKey];
    return { key: row.key, category: known ?? row.category, currentCategory: row.category, amountMinor: row.amountMinor,
      source: known ? 'known' : 'manual', confident: Boolean(known) };
  });
}

function Ledger({ rows, accounts, onEdit, save, saveBatch, quickSort, setQuickSort }) {
  const [search, setSearch] = useState('');
  const [account, setAccount] = useState('');
  const [count, setCount] = useState(50);
  const [batch, setBatch] = useState(false);
  const [uncategorized, setUncategorized] = useState(false);
  const [selection, setSelection] = useState(new Set());
  const [review, setReview] = useState(null);
  const [status, setStatus] = useState('');
  const query = search.trim().toLowerCase();
  const filtered = rows.filter((row) => (!account || account === row.accountId)
    && (!batch || !uncategorized || row.category === 'Uncategorized')
    && (!query || [row.payee, row.description, row.category, ...(row.splits ?? []).map((split) => split.category)]
      .some((value) => value?.toLowerCase().includes(query))));
  const visible = filtered.slice(0, count);
  const selectable = (row) => !row.isSplit && !row.splits?.length;
  const selected = rows.filter((row) => selection.has(row.key) && selectable(row));
  const full = selected.length >= CATEGORY_BATCH_LIMIT;

  function toggle(key, checked) {
    setSelection((previous) => {
      const next = new Set(rows.filter((row) => previous.has(row.key) && selectable(row)).map((row) => row.key));
      if (checked && next.size < CATEGORY_BATCH_LIMIT) next.add(key);
      if (!checked) next.delete(key);
      return next;
    });
  }

  function selectVisible() {
    const next = new Set(selected.map(({ key }) => key));
    for (const row of visible) {
      if (next.size >= CATEGORY_BATCH_LIMIT) break;
      if (selectable(row)) next.add(row.key);
    }
    setSelection(next);
  }

  async function openReview(withAI) {
    if (!selected.length) return;
    const token = Symbol();
    setReview({ token, rows: selected, loading: withAI });
    if (!withAI) return;
    try {
      const { suggestions } = isDemo ? { suggestions: demoCategorySuggestions(selected) }
        : await submitCategoryAction('suggest', { keys: selected.map(({ key }) => key) });
      setReview((current) => current?.token === token ? { ...current, loading: false, suggestions } : current);
    } catch (error) {
      const warning = categoryError(error, 'AI suggestions are unavailable right now.');
      setReview((current) => current?.token === token ? { ...current, loading: false, warning } : current);
    }
  }

  async function apply(changes) {
    await saveBatch(changes);
    setReview(null);
    setSelection(new Set());
    setBatch(false);
    setStatus(`Saved ${changes.length} ${changes.length === 1 ? 'transaction category' : 'transaction categories'}.`);
  }

  return <div className="activity-stack">
    {quickSort && !batch && <QuickSort rows={filtered} save={save} onClose={() => setQuickSort(false)} />}
    <section className="panel activity-panel">
      <div className="activity-tools">
        <label className="search"><Search size={18} /><input aria-label="Search transactions" placeholder="Search transactions" value={search} onChange={(event) => { setSearch(event.target.value); setCount(50); }} /></label>
        <label className="account-filter"><ListFilter size={16} /><select aria-label="Filter by account" value={account} onChange={(event) => { setAccount(event.target.value); setCount(50); }}><option value="">All accounts</option>{accounts.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
        {!batch && !quickSort && <button className="button" onClick={() => setQuickSort(true)}><ListFilter size={16} /> Quick sort</button>}
        {!batch && <button className="button" onClick={() => { setBatch(true); setStatus(''); }}><ListChecks size={17} /> Bulk categorize</button>}
      </div>
      {batch && <div className="batch-bar">
        <div className="batch-heading"><strong>{selected.length} of {CATEGORY_BATCH_LIMIT} selected</strong>
          <button className="text-button" onClick={() => { setBatch(false); setSelection(new Set()); }}>Cancel selection</button></div>
        <div className="batch-options">
          <label className="checkbox"><input type="checkbox" checked={uncategorized} onChange={(event) => setUncategorized(event.target.checked)} /> Uncategorized only</label>
          <button className="text-button" disabled={full || !visible.some((row) => selectable(row) && !selection.has(row.key))} onClick={selectVisible}>Select visible</button>
          {Boolean(selected.length) && <button className="text-button" onClick={() => setSelection(new Set())}>Clear</button>}
        </div>
        <div className="batch-actions">
          <button className="button primary" disabled={!selected.length} onClick={() => openReview(true)}><Sparkles size={16} /> Suggest categories</button>
          <button className="button" disabled={!selected.length} onClick={() => openReview(false)}>Review manually</button>
        </div>
        <p>Gemini uses merchant labels and whether money came in or went out. Review all changes before saving.</p>
      </div>}
      {status && <p className="notice" role="status">{status}</p>}
      {filtered.length || (!query && !account && !batch) ? <Transactions rows={visible} accounts={accounts} onEdit={onEdit}
        selection={batch ? { keys: selection, full, toggle } : null} />
        : <Empty icon={Search} title="No matches">Try a different filter or search.</Empty>}
      {filtered.length > count && <button className="button show-more" onClick={() => setCount(count + 50)}>Show more transactions</button>}
    </section>
    {review && <BulkCategories review={review} onApply={apply} onClose={() => setReview(null)} />}
  </div>;
}

function AccountList({ accounts, move, go }) {
  const [reorder, setReorder] = useState(false);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false);
  async function moveOne(account, offset) {
    setWorking(true);
    setStatus('');
    setFailed(false);
    try {
      await move(account.key, offset);
      setStatus(`${account.name} moved ${offset < 0 ? 'up' : 'down'}.`);
    } catch (error) {
      setFailed(true);
      setStatus(error.message || 'Could not save the new order.');
    } finally {
      setWorking(false);
    }
  }

  if (!accounts.length) return <section className="panel"><Empty icon={Landmark} title="No accounts connected">Accounts appear after the first successful SimpleFIN sync.</Empty></section>;
  return <>
    {accounts.length > 1 && <div className="account-order-toolbar"><p>Shared across both household members.</p>
      <button className="button" aria-pressed={reorder} onClick={() => setReorder(!reorder)}>{reorder ? 'Done reordering' : 'Reorder accounts'}</button>
    </div>}
    <div className="account-grid">{accounts.map((item, index) => <section className="panel account-card" key={item.key}>
      <div className="account-card-top">
        <span className="category-icon mint"><Landmark size={19} /></span>
        {reorder && <div className="account-order-actions"><span aria-label={`Position ${index + 1}`}>{index + 1}</span>
          <button className="icon-button" aria-label={`Move ${item.name} up`} disabled={!index || working} onClick={() => moveOne(item, -1)}><ArrowUp size={17} /></button>
          <button className="icon-button" aria-label={`Move ${item.name} down`} disabled={index === accounts.length - 1 || working} onClick={() => moveOne(item, 1)}><ArrowDown size={17} /></button>
        </div>}
      </div>
      <h2>{item.name}</h2><p>{item.orgName}</p>
      <strong>{money(item.balance, item.currency)}</strong>
      <small>Available balance {money(item.availableBalance, item.currency)}</small>
      {item.balanceDate && <small>Bank balance as of {dayLabel(dateKey(item.balanceDate))}</small>}
    </section>)}</div>
    <section className="panel account-payment-note"><h2>Card &amp; loan payments</h2>
      <p>The bank feed currently provides balances and transactions, without minimum payments or due dates. Repeating payments can appear under Recurring. Add any missing payment amount and date to the cash account it will leave.</p>
      <button className="text-button" onClick={() => go('paychecks', 'calendar')}>Plan a payment <ArrowRight size={16} /></button>
    </section>
    <p className={failed ? 'notice error' : 'sr-only'} role="status">{status}</p>
  </>;
}

function RecurringPage({ forecasts, upcoming, currency }) {
  const active = forecasts.filter((item) => item.isActive && item.currency === currency).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return <div className="feature-grid recurring-page">
    <section className="panel recurring-panel">
      <div className="panel-head"><div><h2>Detected patterns</h2><p>Estimated from posted transactions</p></div></div>
      {active.length ? active.map((item) => <div className="upcoming-row" key={item.id}>
        <CategoryIcon category={item.category} /><div><strong>{item.payee}</strong><small className="cadence">{item.cadence} · {dayLabel(item.dueDate)}</small></div>
        <b className={item.typicalAmount > 0 ? 'positive' : ''}>{item.typicalAmount > 0 ? '+' : ''}{money(item.typicalAmount, currency)}</b>
      </div>) : <Empty icon={Repeat2} title="No patterns detected yet">Forecasts need at least three regular, similarly priced transactions.</Empty>}
    </section>
    <Upcoming items={upcoming} currency={currency} />
  </div>;
}

function SettingsPage({ profile, sync, rules, refresh, busy, cooldown }) {
  return <div className="settings-stack">
    <CategorySettings />
    <section className="panel settings-panel">
      <div className="panel-head"><div><h2>SimpleFIN Bridge</h2><p>{sync.lastSuccess ? `Last synced ${dayLabel(dateKey(sync.lastSuccess))}` : 'Waiting for first bank sync'}</p></div><span className="calendar-icon"><Landmark size={18} /></span></div>
      <button className="button" disabled={busy || cooldown > 0} onClick={refresh}><RefreshCw size={16} className={busy ? 'spin' : ''} /> {busy ? 'Syncing…' : cooldown > 0 ? `Try again in ${cooldown}m` : 'Sync now'}</button>
      <p>Scheduled sync runs every six hours after the bank connection is configured.</p>
    </section>
    <section className="panel settings-panel">
      <div className="panel-head"><div><h2>Vendor rules</h2><p>Choose “Use this category” when editing a transaction to remember it for future imports.</p></div></div>
      {rules.length ? <ul className="rules-list">{rules.map((rule) => <li key={rule.key}><span>{rule.pattern}</span><strong>{rule.category}</strong></li>)}</ul>
        : <Empty icon={CircleHelp} title="No rules saved yet" />}
    </section>
    {!isDemo && <section className="panel settings-panel"><div className="panel-head"><div><h2>Google account</h2><p>{profile.email}</p></div><ShieldCheck size={20} /></div>
      <button className="button" onClick={() => logout()}><LogOut size={16} /> Sign out</button>
    </section>}
  </div>;
}

export default function Dashboard({ session }) {
  return <CategoryProvider><HouseholdDashboard session={session} /></CategoryProvider>;
}

function HouseholdDashboard({ session }) {
  const { options: categoryOptions } = useCategories();
  const [page, setPage] = useState('overview');
  const live = useHousehold(isDemo ? null : session.uid, page);
  const [demo, setDemo] = useState(() => isDemo ? demoData() : null);
  const source = isDemo ? demo : live;
  const { accounts: bankAccounts = emptyArray, transactions = emptyArray, forecasts = emptyArray, rules = emptyArray, sync = {} } = source;
  const [demoOrder, setDemoOrder] = useState([]);
  const accountIds = isDemo ? demoOrder : source.accountOrder?.ids;
  const accounts = useMemo(() => orderAccounts(bankAccounts, accountIds), [bankAccounts, accountIds]);
  const [editor, setEditor] = useState(null);
  const [paychecksTab, setPaychecksTab] = useState('calendar');
  const [quickSort, setQuickSort] = useState(false);
  const [cashKey, setCashKey] = useState('');
  const [selectedCurrency, setSelectedCurrency] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [message, setMessage] = useState('');
  const now = useClock();
  const today = dateKey(now);
  const currencies = [...new Set([...accounts.map(({ currency }) => currency), ...transactions.map(({ currency }) => currency)])].sort();
  const currency = selectedCurrency || (currencies.includes('USD') ? 'USD' : currencies[0] || 'USD');
  const rows = useMemo(() => [...transactions].sort((a, b) => b.postedDate - a.postedDate), [transactions]);
  const planner = usePlannerData(today, rows);
  const account = cashAccount(accounts, currency, planner.schedules, cashKey);
  const paycheckSettings = planner.schedules.find(({ key }) => key === account?.key);
  const cycle = useMemo(() => paycheckCycle({ rows, account, settings: paycheckSettings, today }), [rows, account, paycheckSettings, today]);
  const pace = useMemo(() => cycleCategoryPace(rows, currency, cycle, today), [rows, currency, cycle, today]);
  const runway = useMemo(() => account && !planner.loading && !planner.error ? runwayToPayday({
    account, settings: paycheckSettings, plans: planner.plans, forecasts, rows, goals: planner.goals, today, nextPayday: cycle.nextPayday, cycle,
  }) : null, [account, paycheckSettings, planner.loading, planner.error, planner.plans, forecasts, rows, planner.goals, today, cycle]);
  const allocation = useMemo(() => runway ? categoryRoom({
    rows, forecasts, currency, cycle, today, committed: runway.lowest,
  }) : null, [runway, rows, forecasts, currency, cycle, today]);
  const upcoming = upcomingOutflows(forecasts, currency, today);
  const busy = syncBusy || (sync.status === 'syncing' && now < sync.nextManualSync);
  const cooldown = Math.max(0, Math.ceil((Math.max(sync.nextManualSync ?? 0, retryAt) - now) / 60));
  const loading = !isDemo && !source.error && (!source.transactionsLoaded || !['accounts', 'forecasts'].every((key) => key in source));

  async function saveBatch(changes) {
    if (!isDemo) return applyCategories(changes, categoryOptions);
    const byKey = new Map(changes.map((change) => [change.key, change.category]));
    setDemo((previous) => ({
      ...previous,
      transactions: previous.transactions.map((row) => byKey.has(row.key)
        ? { ...row, category: byKey.get(row.key), verifiedByUser: true, needsReview: false } : row),
    }));
  }

  function go(next, section) {
    if (next === 'paychecks') setPaychecksTab(section ?? 'calendar');
    if (next === 'transactions') setQuickSort(section === 'sort');
    setPage(next);
    window.scrollTo(0, 0);
  }

  async function refresh() {
    if (busy || cooldown) return;
    setMessage('');
    setSyncBusy(true);
    try {
      if (isDemo) {
        setDemo((previous) => ({ ...previous, sync: { lastSuccess: now, status: 'ready', nextManualSync: now + 900 } }));
        setMessage('Sample bank data refreshed.');
      } else {
        await syncBank();
        setMessage('Bank sync finished.');
      }
    } catch (error) {
      setRetryAt(error.details?.next ?? 0);
      setMessage(error.code === 'functions/internal' ? 'Bank sync is unavailable. Check your Firebase setup.' : error.message);
    } finally {
      setSyncBusy(false);
    }
  }

  async function reorderAccount(key, offset) {
    if (isDemo) setDemoOrder((previous) => moveAccount(accounts, previous, key, offset));
    else await saveAccountPosition(accounts, key, offset);
  }

  async function save(changes) {
    if (!isDemo) return saveTransaction(changes, categoryOptions);
    setDemo((previous) => {
      const row = previous.transactions.find(({ key }) => key === changes.key);
      if (!row) return previous;
      const key = vendorKey(row.payee);
      return {
        ...previous,
        transactions: previous.transactions.map((transaction) => transaction.key === changes.key
          ? { ...transaction, category: changes.category, splits: changes.splits, isSplit: changes.splits.length > 0, verifiedByUser: true, needsReview: false }
          : transaction),
        rules: changes.remember
          ? [...previous.rules.filter((rule) => rule.pattern !== key), { key, pattern: key, category: changes.category }]
          : previous.rules,
      };
    });
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <div className="side-caption">WORKSPACE</div>
      <nav aria-label="Household navigation">{navigation.map(([key, label, Icon]) => <button key={key}
        data-page={key} className={key === page ? 'active' : ''} aria-current={key === page ? 'page' : undefined} onClick={() => go(key)}><Icon size={19} strokeWidth={1.8} /><span>{label}</span></button>)}</nav>
      <div className="side-footer"><span className="avatar"><ShieldCheck size={18} /></span><div><strong>Household</strong><small>{isDemo ? 'Demo workspace' : 'Private workspace'}</small></div></div>
    </aside>
    <main className="main">
      <header className="topline">
        <div className="desktop-label"><span className="workspace-dot" /> Household workspace</div>
        <div className="mobile-brand"><Brand /></div>
        <div className="top-actions">{isDemo && <span className="demo-badge">Demo data</span>}
          <button className="button sync-button" aria-label={busy ? 'Syncing bank' : 'Sync bank'} disabled={busy || cooldown > 0} title={cooldown > 0 ? `Sync available in ${cooldown} minutes` : 'Sync bank'} onClick={refresh}>
            <RefreshCw size={15} className={busy ? 'spin' : ''} /><span>{busy ? 'Syncing…' : 'Sync bank'}</span>
          </button><button className="icon-button mobile-settings" aria-label="Settings" aria-current={page === 'settings' ? 'page' : undefined} onClick={() => go('settings')}><Settings size={17} /></button></div>
      </header>
      <div className={page === 'overview' ? 'content content-overview' : 'content'}>
        <header className="page-heading"><div>
          <div className="eyebrow">{page === 'overview' ? 'HOUSEHOLD FLIGHT DECK' : 'YOUR HOUSEHOLD'}</div>
          <h1>{page === 'overview' ? 'Flight deck' : page === 'transactions' ? 'Transactions' : navigation.find(([key]) => key === page)[1]}</h1>
          <p>{descriptions[page]}</p>
        </div>
          {currencies.length > 1 && ['overview', 'recurring'].includes(page) && <div className="heading-actions">
            <select aria-label="Spending currency" value={currency} onChange={(event) => setSelectedCurrency(event.target.value)}>
              {currencies.map((code) => <option key={code} value={code}>{/^[A-Z]{3}$/.test(code) ? code : 'Other units'}</option>)}
            </select>
          </div>}
        </header>
        {source.error && <p className="notice error" role="alert"><WifiOff size={16} /> {source.error}</p>}
        {(message || (sync.status === 'error' && sync.message)) && <p className="notice" role="status">{message || sync.message}</p>}
        {Boolean(sync.warnings?.length) && <div className="notice" role="status"><div><strong>SimpleFIN reported</strong><ul>{sync.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div></div>}
        {loading ? <div className="panel"><Empty title="Loading household data" /></div> :
          page === 'overview' ? <>
            <FlightDeck account={account} accounts={accounts} selectAccount={setCashKey}
              cycle={cycle} runway={runway} allocation={allocation} pace={pace} planner={planner} currency={currency}
              today={today} go={go} historyLoading={!isDemo && live.historyLoading} sync={sync} onSync={refresh} syncDisabled={busy || cooldown > 0} />
            <section className="panel activity-panel">
              <div className="panel-head"><div><h2>Recent activity</h2><p>Latest bank transactions</p></div><button className="text-button" onClick={() => go('transactions', 'sort')}><ListFilter size={15} /> Quick sort</button></div>
              <Transactions rows={rows.slice(0, 5)} accounts={accounts} onEdit={setEditor} />
            </section>
          </> : page === 'transactions' ? <Ledger rows={rows} accounts={accounts} onEdit={setEditor} save={save} saveBatch={saveBatch} quickSort={quickSort} setQuickSort={setQuickSort} />
            : page === 'paychecks' ? <Suspense fallback={<section className="panel"><Empty title="Loading paycheck plan" /></section>}><Paychecks accounts={accounts} rows={rows} forecasts={forecasts} today={today} data={planner} initialTab={paychecksTab} initialAccountId={account?.key} onOverview={() => go('overview')} /></Suspense>
            : page === 'recurring' ? <RecurringPage forecasts={forecasts} upcoming={upcoming} currency={currency} />
            : page === 'accounts' ? <AccountList go={go} accounts={accounts} move={reorderAccount} />
            : <SettingsPage profile={session.profile} sync={sync} rules={rules} refresh={refresh} busy={busy} cooldown={cooldown} />}
      </div>
      <footer className="main-footer"><LockKeyhole size={13} /> Private household budgeting</footer>
    </main>
    {editor && <TransactionEditor row={editor} history={rows} onSave={save} onClose={() => setEditor(null)} />}
  </div>;
}
