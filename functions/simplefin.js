import { createHash } from 'node:crypto';
import { toMinor, fromMinor, vendorKey } from './domain.js';

export const day = 86400;

export function documentKey(...parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function bridgeUrl(value) {
  const url = new URL(value);
  if (!['https://bridge.simplefin.org', 'https://beta-bridge.simplefin.org'].includes(url.origin) || url.search || url.hash) {
    throw new Error('Expected a SimpleFIN Bridge URL.');
  }
  return url;
}

export function claimUrl(token) {
  const url = bridgeUrl(Buffer.from(token.trim(), 'base64').toString('utf8'));
  if (url.username || url.password || !/^\/simplefin\/claim\/[\w.-]+$/.test(url.pathname)) {
    throw new Error('Expected a SimpleFIN setup token.');
  }
  return url;
}

export function accessCredentials(value) {
  const url = bridgeUrl(value.trim());
  if (!url.username || !url.password || !/^\/simplefin\/?$/.test(url.pathname)) {
    throw new Error('SimpleFIN returned an invalid access URL.');
  }
  const auth = Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64');
  url.username = '';
  url.password = '';
  url.pathname = '/simplefin/accounts';
  return { url, authorization: `Basic ${auth}` };
}

export async function fetchAccounts(secret, start, end, pending) {
  const { url, authorization } = accessCredentials(secret);
  if (url.hostname === 'beta-bridge.simplefin.org') url.searchParams.set('version', '2');
  url.searchParams.set('start-date', start);
  url.searchParams.set('end-date', end);
  if (pending) url.searchParams.set('pending', '1');
  const response = await fetch(url, {
    headers: { Authorization: authorization, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const messages = {
      402: 'SimpleFIN requires an active Bridge subscription.',
      403: 'SimpleFIN access was rejected. Check the Bridge connection.',
      429: 'SimpleFIN is rate limiting requests. Try again later.',
    };
    const error = new Error(messages[response.status] ?? 'SimpleFIN is temporarily unavailable.');
    error.publicMessage = error.message;
    throw error;
  }
  const result = await response.json();
  if (!Array.isArray(result.accounts)) throw new Error('Invalid account response.');
  return result;
}

export function normalizeAccount(account, connections, now) {
  const connection = connections.find((item) => item.conn_id === account.conn_id);
  const orgName = connection?.name || account.org?.name || account.org?.domain || 'SimpleFIN';
  const key = documentKey(account.conn_id || account.org?.['sfin-url'] || account.org?.domain || '', account.id);
  return {
    key, id: account.id, name: account.name, orgName, currency: account.currency,
    balance: Number(account.balance),
    availableBalance: Number(account['available-balance'] ?? account.balance),
    balanceDate: account['balance-date'] ?? now,
  };
}

export function normalizeTransaction(raw, account, now) {
  const amountMinor = toMinor(raw.amount, account.currency);
  const postedDate = Number(raw.posted) || (raw.pending ? Number(raw.transacted_at) || now : 0);
  if (amountMinor === null || !postedDate || !raw.id) return null;
  const description = String(raw.description || '').trim().slice(0, 500);
  const payee = String(raw.payee || raw.extra?.payee || description || 'Unknown vendor').trim().slice(0, 180);
  return {
    key: documentKey(account.key, raw.id),
    id: raw.id, accountId: account.key, currency: account.currency, postedDate,
    amount: fromMinor(amountMinor, account.currency), amountMinor,
    description, payee, vendorKey: vendorKey(payee),
    pending: raw.pending === true,
  };
}

const commonVendors = [
  [/^(publix|trader joe s|whole foods|aldi|kroger)\b/u, 'Groceries'],
  [/^(chevron|shell|exxon|mobil)\b/u, 'Transportation'],
  [/^(netflix|spotify|hulu)\b/u, 'Subscriptions'],
  [/^(starbucks|chipotle|sweetgreen)\b/u, 'Dining'],
  [/^(online payment thank you|credit card payment|transfer to savings|transfer from checking)\b/u, 'Transfer'],
];

export function categoryFor(row, rules) {
  const exact = rules.find((rule) => rule.kind !== 'regex' && vendorKey(rule.pattern) === row.vendorKey);
  if (exact) return exact.category;
  for (const rule of rules) {
    if (rule.kind !== 'regex') continue;
    try {
      if (new RegExp(rule.pattern, 'iu').test(row.vendorKey)) return rule.category;
    } catch {
      continue;
    }
  }
  const known = commonVendors.find(([pattern]) => pattern.test(row.vendorKey));
  return known?.[1] ?? (row.amountMinor > 0 ? 'Income' : 'Uncategorized');
}
