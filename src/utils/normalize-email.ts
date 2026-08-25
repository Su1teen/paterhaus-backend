const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normalizeEmail(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;

  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0 || !EMAIL_PATTERN.test(trimmed)) return undefined;

  return trimmed;
}
