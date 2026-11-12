import { dateKey, shiftDays, vendorKey } from '../functions/domain.js';

const merchants = [
  ['Whole Foods Market', 'Groceries', 98.64],
  ['Blue Bottle Coffee', 'Dining', 14.50],
  ['Target', 'Household Goods', 76.32],
  ['Trader Joe’s', 'Groceries', 64.79],
  ['Shell', 'Transportation', 43.82],
  ['Sweetgreen', 'Dining', 22.80],
  ['Bookshop', 'Shopping', 38.40],
  ['Neighborhood Market', 'Groceries', 57.12],
  ['Home Depot', 'Household Goods', 52.91],
  ['Corner Bistro', 'Dining', 63.16],
  ['Walgreens', 'Health', 19.81],
  ['Delta Air Lines', 'Travel', 179.32],
];

export function makeDemo(today) {
  const transactions = [];
  for (let daysAgo = 0; daysAgo < 420; daysAgo++) {
    const day = shiftDays(today, -daysAgo);
    const month = Number(day.slice(5, 7));
    const weekday = new Date(day).getUTCDay();
    const n = Number(day.slice(-2));
    if (weekday === 3 || (weekday === 0 && n > 7)) continue;
    const merchant = merchants[(n + weekday * 2 + month * 2) % merchants.length];
    const [payee, category, cost] = merchant;
    const amountMinor = -Math.round(cost * 100 * (0.92 + (month % 4) * 0.07));
    const key = `demo-${day}`;
    const isSplit = payee === 'Target' && daysAgo > 10;
    const groceries = Math.round(amountMinor * 0.65);
    transactions.push({
      key, id: key, accountId: daysAgo % 3 ? 'card' : 'checking',
      currency: 'USD', payee, category, vendorKey: vendorKey(payee), description: payee,
      amount: amountMinor / 100, amountMinor, postedDate: Date.parse(`${day}T18:00:00Z`) / 1000,
      pending: false, isSplit, verifiedByUser: isSplit,
      splits: isSplit ? [
        { category: 'Groceries', amount: groceries / 100, memo: '' },
        { category: 'Household Goods', amount: (amountMinor - groceries) / 100, memo: '' },
      ] : [],
    });
  }
  const [market, cafe, target] = merchants;
  for (const [i, [payee, category, cost]] of [market, cafe, target].entries()) {
    const key = `demo-feature-${i}`;
    transactions.push({
      key, id: key, accountId: 'card', currency: 'USD', payee, category,
      vendorKey: vendorKey(payee), description: payee, amount: -cost, amountMinor: -Math.round(cost * 100),
      postedDate: Date.parse(`${shiftDays(today, -i)}T20:00:00Z`) / 1000,
      pending: false, isSplit: false, verifiedByUser: false, splits: [],
    });
  }
  transactions.push({
    key: 'demo-pending', id: 'demo-pending', accountId: 'checking', currency: 'USD',
    payee: 'Neighborhood Market', description: 'Neighborhood Market', vendorKey: 'neighborhood market',
    category: 'Groceries', amount: -26.47, amountMinor: -2647,
    postedDate: Date.parse(`${today}T19:00:00Z`) / 1000, pending: true, isSplit: false, splits: [],
  });
  const forecasts = [
    ['Spotify', 'Subscriptions', -11.99, 'monthly', 2],
    ['Fiber internet', 'Utilities', -65, 'monthly', 5],
    ['Rent', 'Housing', -1450, 'monthly', 9],
    ['Payroll', 'Income', 1960, 'biweekly', 8],
    ['Netflix', 'Subscriptions', -15.49, 'monthly', 12],
  ].map(([payee, category, typicalAmount, cadence, days], i) => ({
    id: `forecast-${i}`, payee, category, typicalAmount, cadence, dueDate: shiftDays(today, days),
    isActive: true, currency: 'USD', accountId: ['Spotify', 'Netflix'].includes(payee) ? 'card' : 'checking',
  }));
  return {
    transactions, forecasts,
    accounts: [
      { key: 'checking', name: 'Everyday Checking', orgName: 'Example Credit Union', balance: 3840.62, availableBalance: 3809.12, currency: 'USD' },
      { key: 'card', name: 'Rewards Card', orgName: 'Example Bank', balance: -812.19, availableBalance: 4187.81, currency: 'USD' },
      { key: 'savings', name: 'Household Savings', orgName: 'Example Credit Union', balance: 12405, availableBalance: 12405, currency: 'USD' },
    ],
    rules: [{ key: 'whole-foods', pattern: 'whole foods market', category: 'Groceries' }],
    sync: { status: 'ready', lastSuccess: Math.floor(Date.now() / 1000) },
  };
}

export const demoData = () => makeDemo(dateKey(Date.now() / 1000));
