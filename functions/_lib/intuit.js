export function intuitTidFromHeaders(headers) {
  if (!headers) return '';
  const names = ['intuit_tid', 'intuit-tid', 'x-intuit-tid'];
  const read = typeof headers.get === 'function'
    ? (name) => headers.get(name)
    : (name) => headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];
  for (const name of names) {
    const value = String(read(name) || '').trim();
    if (value) return value;
  }
  return '';
}

export function intuitTidSuffix(intuitTid) {
  return intuitTid ? `:intuit_tid=${intuitTid}` : '';
}
