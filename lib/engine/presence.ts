// Whether a player has the game open. Each screen reports 'here' every 30s while visible and 'away'
// when the player switches app or locks the phone. Skipping a turn is only allowed for someone away.
export interface Seen { seenAt: number; awaySince: number | null }

export const HEARTBEAT_MS = 30_000;
const STALE_MS = 75_000; // no heartbeat for this long = the browser was closed or lost the connection

/** How long the player has been out of the game (0 = they have it open). */
export function awayFor(seen: Seen | undefined, now: number, fallbackSince?: number): number {
  if (!seen) return fallbackSince ? Math.max(0, now - fallbackSince) : 0;
  if (seen.awaySince) return Math.max(0, now - seen.awaySince);
  return now - seen.seenAt > STALE_MS ? now - seen.seenAt : 0;
}
