export function hasAsciiControlCharacters(value: string, includeSpace = false): boolean {
  const upperBound = includeSpace ? 32 : 31;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= upperBound || code === 127) return true;
  }
  return false;
}
