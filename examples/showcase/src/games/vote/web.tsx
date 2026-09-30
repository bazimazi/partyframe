/**
 * Most Likely To on the web: the prompt on the TV, faces on the phones, then
 * bars that grow as the votes are revealed.
 */

import {
  ChoiceGrid,
  Countdown,
  PlayerAvatar,
  Scoreboard,
  defineWebGame,
  type ControllerPanelProps,
  type ScreenProps,
} from "@bazimazi/partyframe-client";
import type { VoteAction, VoteControllerState, VotePublicState } from "./game.js";

export function VoteScreen({ game, players, serverNow, t }: ScreenProps<VotePublicState>) {
  const reveal = game.phase === "reveal";
  const total = Math.max(1, ...Object.values(game.tally));

  return (
    <div className="vote" data-phase={game.phase}>
      <header className="vote__header">
        <span>
          {t("host.round", { round: game.round })} / {game.rounds}
        </span>
        {game.deadline && game.phase === "vote" && (
          <Countdown endsAt={game.deadline.endsAt} serverNow={serverNow} size="small" />
        )}
      </header>

      <p className="vote__lead">{t("game.vote.mostLikelyTo")}</p>
      <p className="vote__prompt">{game.prompt}</p>

      {game.phase === "vote" && (
        <p className="vote__count">
          {t("game.vote.voted", { count: game.votedIds.length, total: players.length })}
        </p>
      )}

      {reveal && (
        <>
          <ul className="vote__bars">
            {[...players]
              .sort((a, b) => (game.tally[b.id] ?? 0) - (game.tally[a.id] ?? 0) || a.seat - b.seat)
              .map((player) => {
                const count = game.tally[player.id] ?? 0;
                const voters = Object.entries(game.votes)
                  .filter(([, target]) => target === player.id)
                  .map(([voter]) => players.find((p) => p.id === voter)?.avatar ?? "");
                return (
                  <li
                    key={player.id}
                    className="vote__bar"
                    data-top={game.topIds.includes(player.id) || undefined}
                    style={
                      {
                        "--player-color": player.color,
                        "--fill": `${(count / total) * 100}%`,
                      } as React.CSSProperties
                    }
                  >
                    <PlayerAvatar player={player} size={40} />
                    <span className="vote__bar-name">{player.name}</span>
                    <span className="vote__bar-track">
                      <span className="vote__bar-fill" />
                    </span>
                    <span className="vote__bar-voters" aria-hidden="true">
                      {voters.join(" ")}
                    </span>
                    <strong className="vote__bar-count">{count}</strong>
                  </li>
                );
              })}
          </ul>
          <Scoreboard players={players} deltas={game.roundPoints} limit={4} />
        </>
      )}
    </div>
  );
}

export function VoteController({
  envelope,
  send,
  players,
  me,
  t,
}: ControllerPanelProps<VoteControllerState, VoteAction>) {
  const { phase, prompt, myVote, points } = envelope.game;
  const others = players.filter((player) => player.id !== me?.id && !player.spectator);

  return (
    <div className="ctl-panel vote-ctl" data-phase={phase}>
      <p className="ctl-panel__sub">{t("game.vote.mostLikelyTo")}</p>
      <p className="ctl-panel__headline vote-ctl__prompt">{prompt}</p>
      {phase === "reveal" ? (
        <p className="ctl-panel__sub">
          {points > 0 ? t("game.vote.youScored", { points }) : t("game.vote.noPoints")}
        </p>
      ) : (
        <ChoiceGrid
          showLetters={false}
          choices={others.map((player) => ({
            id: player.id,
            label: (
              <span className="vote-ctl__choice">
                <span
                  className="avatar"
                  style={{ background: player.color, width: 28, height: 28, fontSize: 16 }}
                >
                  {player.avatar}
                </span>
                {player.name}
              </span>
            ),
            color: player.color,
          }))}
          selectedId={myVote}
          disabled={!envelope.active}
          onSelect={(id) => send({ type: "vote", playerId: id })}
        />
      )}
      {myVote && phase === "vote" && <p className="ctl-panel__sub">{t("game.vote.locked")}</p>}
    </div>
  );
}

export const voteWeb = defineWebGame<VotePublicState, VoteControllerState, VoteAction>({
  id: "vote",
  Controller: VoteController,
  Screen: VoteScreen,
  round: (game) => game.round,
  sfx: { "vote-reveal": "score" },
});
