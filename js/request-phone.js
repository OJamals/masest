// Preserve the caller's country code and formatting; never infer a dialing region.
export function normalizeRequestPhone(value) {
  if (typeof value !== 'string') return '';
  const phone = value.trim();
  if (phone.length > 40 || !/^\+?[\d\s().-]+$/.test(phone)) return '';
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? phone : '';
}
