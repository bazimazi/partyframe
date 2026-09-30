/**
 * A ranked score list for the shared screen.
 *
 * Ranks are computed here from `score` (ties share a rank), so a game only
 * hands over its players. Rows animate into their new position through CSS
 * `order` plus a transition, which is cheap and needs no layout measurement.
 */

import type { ClientPlayer } from "@partyframe/protocol";
import { useT } from "../../i18n/I18nProvider.js";
import { PlayerAvatar } from "../common.js";

export interface ScoreboardProps {
  players: ClientPlayer[];
  /** Ids to draw with an accent ring, e.g. this round's winners. */
  highlightIds?: ReadonlySet<string> | string[];
  /** Points gained this round, shown as "+n" beside the score. */
  deltas?: Record<string, number>;
  /** Show the session win tally. */
  showWins?: boolean;
  /** Keep the list short on a busy screen. */
  limit?: number;
}

export function Scoreboard({ players, highlightIds, deltas, showWins, limit }: ScoreboardProps) {
  const t = useT();
  const highlight = highlightIds instanceof Set ? highlightIds : new Set(highlightIds ?? []);
  const ranked = [...players].sort((a, b) => b.score - a.score || a.seat - b.seat);
  const visible = limit ? ranked.slice(0, limit) : ranked;
  // Ties share a rank: 1, 1, 3.
  const rows = visible.map((player, index) => ({
    player,
    rank: index > 0 && visible[index - 1]!.score === player.score ? -1 : index + 1,
  }));
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i]!.rank === -1) rows[i]!.rank = rows[i - 1]!.rank;
  }

  return (
    <ol className="scoreboard">
      {rows.map(({ player, rank }, index) => {
        const delta = deltas?.[player.id];
        return (
          <li
            key={player.id}
            className="scoreboard__row"
            data-rank={rank}
            data-highlight={highlight.has(player.id) || undefined}
            style={{ order: index, "--player-color": player.color } as React.CSSProperties}
          >
            <span className="scoreboard__rank">{rank}</span>
            <PlayerAvatar player={player} size={40} />
            <span className="scoreboard__name">
              {player.name}
              {player.isBot && <span className="tag tag--bot">{t("player.bot")}</span>}
              {showWins && player.wins > 0 && (
                <span className="tag tag--wins">{t("host.wins", { count: player.wins })}</span>
              )}
            </span>
            {delta !== undefined && delta !== 0 && (
              <span
                key={`${player.score}-${delta}`}
                className="scoreboard__delta"
                data-negative={delta < 0 || undefined}
              >
                {delta > 0 ? `+${delta}` : delta}
              </span>
            )}
            <span className="scoreboard__score">{player.score}</span>
          </li>
        );
      })}
    </ol>
  );
}
