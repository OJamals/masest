export function formatStripeMinor(value, currency, currencyExponent) {
  if (!Number.isSafeInteger(value)) return '—';
  const exponent = Number.isInteger(currencyExponent) && currencyExponent >= 0 && currencyExponent <= 2
    ? currencyExponent
    : 2;
  const amount = value / (10 ** exponent);
  return `${String(currency || 'USD').toUpperCase()} ${amount.toLocaleString('en-US', {
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  })}`;
}
