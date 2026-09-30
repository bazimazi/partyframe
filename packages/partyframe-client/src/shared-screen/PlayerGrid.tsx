/**
 * Player cards for the shared screen.
 *
 * Designed to be read from four metres away: large names, large scores, and
 * every state difference carried by shape or text as well as by colour. The
 * per-player accent colour is decorative; the avatar, the name and the explicit
 * labels are what actually identify a player.
 */

import type { PlayerBadge } from "../types.js";
import type { ClientPlayer } from "@partyframe/protocol";
import { useT } from "../i18n/I18nProvider.js";
import { PlayerAvatar } from "../ui/common.js";

export type { PlayerBadge };

export function PlayerGrid({
  players,
  highlightId,
  dimmedIds,
  badges,
  showReady,
}: {
  players: ClientPlayer[];
  /** The player currently acting - drawn with a strong ring and a label. */
  highlightId?: string;
  /** Players who are out; drawn faded with an explicit marker. */
  dimmedIds?: ReadonlySet<string>;
  badges?: Record<string, PlayerBadge | undefined>;
  showReady?: boolean;
}) {
  const t = useT();

  return (
    <ul className="player-grid" data-count={players.length}>
      {players.map((player) => {
        const dimmed = dimmedIds?.has(player.id) ?? false;
        const active = highlightId === player.id;
        const badge = badges?.[player.id];

        return (
          <li
            key={player.id}
            className="player-card"
            data-active={active || undefined}
            data-dimmed={dimmed || undefined}
            data-offline={!player.connected || undefined}
            style={{ "--player-color": player.color } as React.CSSProperties}
          >
            <PlayerAvatar player={player} size={64} />

            <div className="player-card__body">
              <span className="player-card__name">{player.name}</span>
              <span className="player-card__meta">
                {player.isBot && <span className="tag tag--bot">{t("player.bot")}</span>}
                {player.spectator && (
                  <span className="tag tag--spectator">{t("player.spectator")}</span>
                )}
                {!player.connected && (
                  <span className="tag tag--offline">{t("controller.disconnected")}</span>
                )}
                {showReady && player.ready && !player.isBot && (
                  <span className="tag tag--ready">{t("controller.ready")}</span>
                )}
              </span>
            </div>

            <div className="player-card__right">
              <span className="player-card__score">{player.score}</span>
              {badge && <span className={`player-card__badge is-${badge.tone}`}>{badge.text}</span>}
            </div>

            {active && <span className="player-card__turn">{t("host.yourTurn")}</span>}
          </li>
        );
      })}
    </ul>
  );
}
