import { z } from "zod";
import { decimalSeparator, localizeDigits, validateDisplayLocale } from "./locale";

const timestampSchema = z.iso.datetime({ offset: true });

export interface TimestampDisplayOptions {
  locale: string;
  timeZone: string;
}

/** Formats an explicit server instant in an explicit display zone, preserving subsecond digits. */
export function formatTimestamp(timestamp: string, options: TimestampDisplayOptions): string {
  validateDisplayLocale(options.locale);
  if (typeof options.timeZone !== "string" || !options.timeZone.trim()) {
    throw new RangeError("An explicit display timezone is required.");
  }
  if (!timestampSchema.safeParse(timestamp).success) {
    throw new RangeError("A valid server timestamp with UTC or a numeric offset is required.");
  }
  const instant = new Date(timestamp);
  if (!Number.isFinite(instant.getTime()))
    throw new RangeError("The timestamp cannot be displayed.");
  const parts = new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).formatToParts(instant);
  const subsecond = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(timestamp)?.[1];
  return parts
    .map((part) =>
      part.type === "second" && subsecond
        ? `${part.value}${decimalSeparator(options.locale)}${localizeDigits(subsecond, options.locale)}`
        : part.value,
    )
    .join("");
}
