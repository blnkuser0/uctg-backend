const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

/** Parses the same short forms jsonwebtoken accepts for `expiresIn` ("30d", "12h",
 *  "15m", "3600" = seconds) so the refresh *cookie* can live exactly as long as the
 *  refresh *token* inside it. Falls back to `fallbackMs` for anything unrecognised. */
export function durationToMs(value: string, fallbackMs: number): number {
  const match = /^(\d+)\s*([smhdw])?$/i.exec(value.trim());
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = match[2] ? UNIT_MS[match[2].toLowerCase()] : 1000;
  return amount * unit;
}
