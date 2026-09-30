/**
 * Bot identity.
 *
 * Bots are first-class players: they get a name, an avatar and a colour from the
 * same pools humans draw from, so the lobby and the scoreboard treat them
 * identically. The only visible difference is a small marker on the player card,
 * which exists for honesty, not for mechanics.
 */

import { AVATARS, PLAYER_COLORS } from "@partyframe/protocol";

/** Short, easy-to-read names that will not be mistaken for a real player's. */
const BOT_NAMES = [
  "Botly",
  "Circuit",
  "Pixel",
  "Widget",
  "Gizmo",
  "Sprocket",
  "Chip",
  "Nova",
  "Echo",
  "Blip",
  "Cogs",
  "Fizz",
];

export interface BotIdentity {
  name: string;
  avatar: string;
  color: string;
}

/**
 * Builds a bot identity that does not collide with anyone already seated.
 *
 * Falls back to a numbered name if every name in the pool is taken, which can
 * only happen in a session larger than the pool and is handled rather than
 * risking two identical player cards on the TV.
 */
export function makeBotIdentity(
  index: number,
  takenNames: ReadonlySet<string>,
  takenColors: ReadonlySet<string>,
): BotIdentity {
  const name =
    BOT_NAMES.find((candidate) => !takenNames.has(candidate.toLowerCase())) ?? `Bot ${index + 1}`;

  const color =
    PLAYER_COLORS.find((candidate) => !takenColors.has(candidate)) ??
    PLAYER_COLORS[index % PLAYER_COLORS.length]!;

  // Bots always get the robot-ish end of the avatar pool where possible.
  const avatar = AVATARS[(AVATARS.indexOf("🤖") + index) % AVATARS.length]!;

  return { name, avatar, color };
}
