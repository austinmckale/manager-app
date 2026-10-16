const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type CalendarDate = { year: number; month: number; day: number };

export function zonedParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday ?? "",
  };
}

function timeZoneOffsetMs(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const hour = Number(value.hour) % 24;
  const wall = Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day), hour, Number(value.minute), Number(value.second));
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

export function zonedDateTimeToUtc(year: number, month: number, day: number, timeZone: string) {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const utc = guess - timeZoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - timeZoneOffsetMs(new Date(utc), timeZone));
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day));
  next.setUTCDate(next.getUTCDate() + days);
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

export function reportingWeek(now: Date, timeZone = "America/New_York") {
  const today = zonedParts(now, timeZone);
  const sinceMonday = WEEKDAY_INDEX[today.weekday];
  if (sinceMonday === undefined) throw new Error("Could not resolve the reporting week.");
  const thisMonday = addCalendarDays(today, -sinceMonday);
  const lastMonday = addCalendarDays(thisMonday, -7);
  const lastSunday = addCalendarDays(thisMonday, -1);
  const start = zonedDateTimeToUtc(lastMonday.year, lastMonday.month, lastMonday.day, timeZone);
  const end = zonedDateTimeToUtc(thisMonday.year, thisMonday.month, thisMonday.day, timeZone);
  const startText = `${MONTHS[lastMonday.month - 1]} ${lastMonday.day}`;
  const endText = `${MONTHS[lastSunday.month - 1]} ${lastSunday.day}, ${lastSunday.year}`;
  const label =
    lastMonday.year !== lastSunday.year
      ? `${startText}, ${lastMonday.year}–${endText}`
      : lastMonday.month !== lastSunday.month
        ? `${startText}–${endText}`
        : `${startText}–${lastSunday.day}, ${lastSunday.year}`;
  return { start, end, label, timeZone };
}
