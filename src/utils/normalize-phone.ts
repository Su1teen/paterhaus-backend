/**
 * Reduces a phone number to a comparable E.164-like form: digits only, prefixed with `+`.
 * Returns undefined when there is nothing usable to normalize.
 */
export function normalizePhone(input: unknown): string | undefined {
  if (typeof input !== 'string' && typeof input !== 'number') return undefined;

  const raw = String(input).trim();
  if (raw.length === 0) return undefined;

  const digits = raw.replace(/\D+/g, '');
  if (digits.length < 6) return undefined;

  return `+${digits.replace(/^0+/, '') || digits}`;
}
