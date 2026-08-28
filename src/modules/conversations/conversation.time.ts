const ALMATY_TIME_ZONE = 'Asia/Almaty';
const ALMATY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: ALMATY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

function formattedParts(date: Date): Omit<DateParts, 'millisecond'> {
  const parts = Object.fromEntries(
    ALMATY_FORMATTER.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

function isValidCalendarDate(parts: DateParts): boolean {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond),
  );
  return (
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day &&
    date.getUTCHours() === parts.hour &&
    date.getUTCMinutes() === parts.minute &&
    date.getUTCSeconds() === parts.second
  );
}

export function parseAlmatyTime(value: string | null): string | null {
  if (!value) return null;

  const match =
    /^(\d{4})-(\d{2})-(\d{2}), (\d{2}):(\d{2})(?::(\d{2})\.(\d{1,3}))?$/.exec(value);
  if (!match) return null;

  const parts: DateParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
    millisecond: Number((match[7] ?? '0').padEnd(3, '0')),
  };
  if (!isValidCalendarDate(parts)) return null;

  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  let instant = localAsUtc;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const represented = formattedParts(new Date(instant));
    const representedAsUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second,
      parts.millisecond,
    );
    instant = localAsUtc - (representedAsUtc - instant);
  }

  const resolved = new Date(instant);
  const check = formattedParts(resolved);
  if (
    check.year !== parts.year ||
    check.month !== parts.month ||
    check.day !== parts.day ||
    check.hour !== parts.hour ||
    check.minute !== parts.minute ||
    check.second !== parts.second
  ) {
    return null;
  }

  return resolved.toISOString();
}
