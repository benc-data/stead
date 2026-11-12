export function categoryError(error, fallback) {
  if (error.code === 'permission-denied') return 'Your session couldn’t authorize this request. Sign back in and try again.';
  if (error.code === 'unavailable') return 'Stead couldn’t reach the server. Check your connection and try again.';
  return error.message && !/^internal\b/i.test(error.message) ? error.message : fallback;
}
