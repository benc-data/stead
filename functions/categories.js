import { categories } from './domain.js';

export const CUSTOM_CATEGORY_LIMIT = 100;
export const CATEGORY_NAME_LIMIT = 40;

export function categoryOptions(custom = []) {
  return [...new Set([...categories, ...custom.filter((name) => typeof name === 'string' && name.length > 0)])];
}

export function appendCategory(previous = {}, value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('Enter a category name.');
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!name || name.length > CATEGORY_NAME_LIMIT) throw new Error(`Use a category name of 1–${CATEGORY_NAME_LIMIT} characters.`);
  const names = previous.names ?? [];
  if (categoryOptions(names).some((existing) => existing.toLowerCase() === name.toLowerCase())) {
    throw new Error('That category already exists. Choose it from the list.');
  }
  if (names.length >= CUSTOM_CATEGORY_LIMIT) throw new Error('You can add up to 100 custom categories.');
  return { names: [...names, name], keys: [...(previous.keys ?? []), name.toLowerCase()] };
}

// Calculations retain every saved category, including historical split parts.
export function categoriesInRows(rows) {
  return categoryOptions(rows.flatMap((row) => [row.category, ...(row.splits ?? []).map((split) => split.category)]));
}
