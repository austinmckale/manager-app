import { toNumber } from "@/lib/utils";

type TimeEntryRange = {
  start: Date;
  end: Date | null;
  breakMinutes?: number | null;
};

export function getWorkedMinutes(entry: TimeEntryRange): number {
  if (!entry.end) return 0;
  const rawMinutes = (entry.end.getTime() - entry.start.getTime()) / 60000;
  const breakMinutes = Math.max(0, toNumber(entry.breakMinutes));
  return Math.max(0, rawMinutes - breakMinutes);
}

export function getWorkedHours(entry: TimeEntryRange): number {
  return getWorkedMinutes(entry) / 60;
}

export function getLaborCost(entry: TimeEntryRange & { hourlyRateLoaded: unknown }): number {
  return getWorkedHours(entry) * toNumber(entry.hourlyRateLoaded);
}
