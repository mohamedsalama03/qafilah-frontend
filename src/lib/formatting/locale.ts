export function validateDisplayLocale(locale: string): void {
  if (
    typeof locale !== "string" ||
    !locale.trim() ||
    Intl.NumberFormat.supportedLocalesOf([locale]).length !== 1
  ) {
    throw new RangeError("An explicit supported display locale is required.");
  }
}

export function localizeDigits(value: string, locale: string): string {
  const formatter = new Intl.NumberFormat(locale, { useGrouping: false });
  // Only individual decimal digits are converted; the authoritative amount never is.
  return [...value].map((digit) => formatter.format(Number(digit))).join("");
}

export function decimalSeparator(locale: string): string {
  const separator = new Intl.NumberFormat(locale, { minimumFractionDigits: 1 })
    .formatToParts(0n)
    .find((part) => part.type === "decimal");
  if (!separator) throw new RangeError("This locale does not expose a decimal separator.");
  return separator.value;
}
