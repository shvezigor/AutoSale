import type { DashboardPeriod } from '@autosale/contracts/dashboard';

const TIMEZONE = 'Europe/Kyiv' as const;
const PERIOD_DAYS: Record<DashboardPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 };
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  timeZoneName: 'longOffset',
});

type LocalDate = { year: number; month: number; day: number };

export type DashboardPeriodRange = {
  key: DashboardPeriod;
  start: Date;
  previousStart: Date;
  end: Date;
  dates: string[];
};

export function dashboardPeriodRange(key: DashboardPeriod, now = new Date()): DashboardPeriodRange {
  const days = PERIOD_DAYS[key];
  const today = localDateFor(now);
  const startDate = addDays(today, -(days - 1));
  const previousStartDate = addDays(startDate, -days);
  return {
    key,
    start: localMidnight(startDate),
    previousStart: localMidnight(previousStartDate),
    end: new Date(now),
    dates: Array.from({ length: days }, (_, index) => formatLocalDate(addDays(startDate, index))),
  };
}

function localDateFor(date: Date): LocalDate {
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return { year: parts.year!, month: parts.month!, day: parts.day! };
}

function addDays(date: LocalDate, amount: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + amount));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function localMidnight(date: LocalDate): Date {
  const localWallTime = Date.UTC(date.year, date.month - 1, date.day);
  let instant = new Date(localWallTime);
  instant = new Date(localWallTime - timezoneOffsetMs(instant));
  return new Date(localWallTime - timezoneOffsetMs(instant));
}

function timezoneOffsetMs(date: Date): number {
  const label = offsetFormatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /^GMT(?:(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?)?$/.exec(label);
  if (!match?.groups?.sign) return 0;
  const minutes = Number(match.groups.hours) * 60 + Number(match.groups.minutes ?? 0);
  return minutes * 60_000 * (match.groups.sign === '+' ? 1 : -1);
}

function formatLocalDate(date: LocalDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}
