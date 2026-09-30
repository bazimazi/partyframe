/**
 * End-of-match results.
 *
 * The winner is stated in words, not only implied by position: a podium alone is
 * ambiguous from the back of a room, and a tie has no podium at all. The rematch
 * button is the primary action because nobody has to rescan anything - the
 * session, its code and every seat survive into the next match.
 */

import type { ClientPlayer } from "@partyframe/protocol";
import { useT } from "../i18n/I18nProvider.js";
import { PlayerAvatar } from "../ui/common.js";
import { Confetti } from "../ui/game/Confetti.js";
import { Scoreboard } from "../ui/game/Scoreboard.js";

export function ResultsView({
  players,
  winnerIds,
  onRematch,
  onLobby,
}: {
  players: ClientPlayer[];
  /** Winner ids from the server. Several mean a tie; none means no winner. */
  winnerIds: string[];
  onRematch: () => void;
  onLobby: () => void;
}) {
  const t = useT();
  const ranked = [...players]
    .filter((player) => !player.spectator)
    .sort((a, b) => b.score - a.score || a.seat - b.seat);
  const winners = ranked.filter((player) => winnerIds.includes(player.id));
  const showWins = players.some((player) => player.wins > 0);

  const title =
    winners.length === 1
      ? t("host.winner", { name: winners[0]!.name })
      : winners.length > 1
        ? t("host.winners", { names: winners.map((player) => player.name).join(" & ") })
        : t("host.noWinner");

  // Podium order: second, first, third - so the winner stands in the middle.
  const podium = [ranked[1], ranked[0], ranked[2]].filter(
    (player): player is ClientPlayer => player !== undefined,
  );

  return (
    <div className="results">
      <Confetti active={winners.length > 0} colors={winners.map((player) => player.color)} />
      <h1 className="results__title">{title}</h1>

      {ranked.length > 0 && (
        <ol className="podium" data-count={podium.length}>
          {podium.map((player) => {
            const place = ranked.indexOf(player) + 1;
            return (
              <li
                key={player.id}
                className="podium__step"
                data-place={place}
                data-winner={winnerIds.includes(player.id) || undefined}
                style={{ "--player-color": player.color } as React.CSSProperties}
              >
                <PlayerAvatar player={player} size={place === 1 ? 112 : 80} />
                <span className="podium__name">{player.name}</span>
                <span className="podium__score">{player.score}</span>
                <span className="podium__block">{place === 1 ? "🏆" : place}</span>
              </li>
            );
          })}
        </ol>
      )}

      {ranked.length > 3 && (
        <>
          <h2 className="results__subtitle">{t("host.finalScores")}</h2>
          <Scoreboard players={ranked} highlightIds={winnerIds} showWins={showWins} />
        </>
      )}

      <div className="results__actions">
        <button type="button" className="btn btn--primary btn--big" onClick={onRematch}>
          {t("host.playAgain")}
        </button>
        <button type="button" className="btn btn--ghost btn--big" onClick={onLobby}>
          {t("host.backToLobby")}
        </button>
      </div>
    </div>
  );
}
