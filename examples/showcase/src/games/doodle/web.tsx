/**
 * Doodle on the web.
 *
 * The TV repaints the synchronised strokes; the drawer's phone paints locally
 * as the finger moves and streams batched points to the server; guessers get
 * a text box. Nothing here decides anything - a guess is judged by the rules,
 * and the phone only learns the verdict through its controller state and a
 * private cue.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChoiceGrid,
  Countdown,
  FuseBar,
  Scoreboard,
  TextEntry,
  defineWebGame,
  haptic,
  type ControllerPanelProps,
  type ScreenProps,
} from "@bazimazi/partyframe-client";
import { fitCanvas, paintStroke, paintStrokes } from "./canvas.js";
import {
  CANVAS_SIZE,
  PALETTE,
  WIDTHS,
  type DoodleAction,
  type DoodleControllerState,
  type DoodlePublicState,
  type Stroke,
} from "./game.js";

// ------------------------------------------------------------------ TV

export function DoodleScreen({ game, players, serverNow, t }: ScreenProps<DoodlePublicState>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const name = (id: string) => players.find((player) => player.id === id)?.name ?? "";
  const drawer = players.find((player) => player.id === game.drawerId);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const repaint = () => paintStrokes(context, game.strokes, fitCanvas(canvas));
    repaint();
    window.addEventListener("resize", repaint);
    return () => window.removeEventListener("resize", repaint);
  }, [game.strokes]);

  return (
    <div className="doodle" data-phase={game.phase}>
      <div className="doodle__stage">
        <canvas ref={canvasRef} className="doodle__canvas" aria-label={t("game.doodle.canvas")} />
        {game.phase === "pick" && (
          <div className="doodle__overlay">
            <p>{t("game.doodle.picking", { name: drawer?.name ?? "" })}</p>
            {game.deadline && (
              <Countdown endsAt={game.deadline.endsAt} serverNow={serverNow} size="small" />
            )}
          </div>
        )}
        {game.phase === "reveal" && (
          <div className="doodle__overlay">
            <p className="doodle__reveal-word">{game.hint}</p>
            <Scoreboard
              players={players}
              deltas={game.roundPoints}
              highlightIds={game.guessedIds}
              limit={5}
            />
          </div>
        )}
      </div>

      <aside className="doodle__side">
        <p className="doodle__turn">
          {t("host.round", { round: game.turn })} / {game.turns}
        </p>
        <p className="doodle__drawer">
          {drawer && (
            <span
              className="avatar"
              style={{ background: drawer.color, width: 32, height: 32, fontSize: 18 }}
            >
              {drawer.avatar}
            </span>
          )}
          {t("game.doodle.drawing", { name: drawer?.name ?? "" })}
        </p>
        <p className="doodle__hint" aria-label={t("game.doodle.hint")}>
          {game.hint}
        </p>
        {game.deadline && game.phase === "draw" && (
          <FuseBar
            startedAt={game.deadline.startedAt}
            endsAt={game.deadline.endsAt}
            serverNow={serverNow}
            label={t("game.doodle.timeLeft")}
          />
        )}
        <ul className="doodle__guesses">
          {game.guessedIds.map((id) => (
            <li key={`ok-${id}`} className="doodle__guess doodle__guess--correct">
              {t("game.doodle.gotIt", { name: name(id) })}
            </li>
          ))}
          {[...game.recent].reverse().map((guess, index) => (
            <li key={`${guess.playerId}-${index}`} className="doodle__guess">
              <strong>{name(guess.playerId)}</strong> {guess.text}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

// --------------------------------------------------------------- phones

export function DoodleController(props: ControllerPanelProps<DoodleControllerState, DoodleAction>) {
  const { envelope, t } = props;
  const { role, phase } = envelope.game;

  if (role === "drawer" && phase === "pick") return <PickPanel {...props} />;
  if (role === "drawer" && phase === "draw") return <DrawPanel {...props} />;
  if (role === "guesser" && phase === "draw") return <GuessPanel {...props} />;

  return (
    <div className="ctl-panel">
      <p className="ctl-panel__headline">
        {phase === "reveal"
          ? t("game.doodle.itWas", { word: envelope.game.word ?? envelope.game.hint })
          : t("game.doodle.waitingFor", { name: envelope.game.drawerName })}
      </p>
      {phase === "reveal" && envelope.game.points > 0 && (
        <p className="ctl-panel__sub">+{envelope.game.points}</p>
      )}
    </div>
  );
}

function PickPanel({
  envelope,
  send,
  t,
}: ControllerPanelProps<DoodleControllerState, DoodleAction>) {
  return (
    <div className="ctl-panel">
      <p className="ctl-panel__headline">{t("game.doodle.pickWord")}</p>
      <ChoiceGrid
        columns={1}
        showLetters={false}
        choices={envelope.game.wordChoices.map((word, index) => ({
          id: String(index),
          label: word,
        }))}
        onSelect={(id) => send({ type: "pick", index: Number(id) })}
      />
    </div>
  );
}

/** Points are batched so a stroke costs a handful of messages, not hundreds. */
const BATCH_MS = 70;
const BATCH_POINTS = 24;

function DrawPanel({
  envelope,
  send,
  serverNow,
  t,
}: ControllerPanelProps<DoodleControllerState, DoodleAction>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [color, setColor] = useState(0);
  const [width, setWidth] = useState(1);
  const tool = useRef({ color: 0, width: 1 });
  useEffect(() => {
    tool.current = { color, width };
  }, [color, width]);

  // Everything about the stroke in progress lives in refs: pointer events
  // fire far more often than React should render.
  const drawing = useRef(false);
  const pending = useRef<number[]>([]);
  const local = useRef<Stroke | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sizeRef = useRef(1);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const repaint = () => {
      sizeRef.current = fitCanvas(canvas);
      paintStrokes(context, [], sizeRef.current);
    };
    repaint();
    window.addEventListener("resize", repaint);
    return () => window.removeEventListener("resize", repaint);
  }, []);

  const flush = useCallback(
    (end: boolean) => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = null;
      const points = pending.current;
      pending.current = [];
      if (points.length >= 2 || end) {
        send({ type: "path", color: tool.current.color, width: tool.current.width, points, end });
      }
    },
    [send],
  );

  const toCanvas = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.round(((event.clientX - rect.left) / rect.width) * CANVAS_SIZE);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * CANVAS_SIZE);
    return [Math.max(0, Math.min(CANVAS_SIZE, x)), Math.max(0, Math.min(CANVAS_SIZE, y))];
  };

  const addPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const [x, y] = toCanvas(event);
    const context = canvasRef.current?.getContext("2d");
    const stroke = local.current;
    if (!context || !stroke) return;
    const last = stroke.p.length;
    stroke.p.push(x, y);
    // Paint just the new segment; the whole stroke is not redrawn per event.
    const segment: Stroke = {
      ...stroke,
      p: last >= 2 ? [stroke.p[last - 2]!, stroke.p[last - 1]!, x, y] : [x, y],
    };
    paintStroke(context, segment, sizeRef.current / CANVAS_SIZE);
    pending.current.push(x, y);
    if (pending.current.length >= BATCH_POINTS * 2) flush(false);
    else if (!flushTimer.current) flushTimer.current = setTimeout(() => flush(false), BATCH_MS);
  };

  const onDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    local.current = { c: tool.current.color, w: tool.current.width, p: [] };
    addPoint(event);
  };
  const onMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawing.current) addPoint(event);
  };
  const onUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    flush(true);
    local.current = null;
  };

  const repaintBlank = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) paintStrokes(context, [], sizeRef.current);
  };

  return (
    <div className="doodle-ctl">
      <p className="doodle-ctl__word">
        {t("game.doodle.drawThis")} <strong>{envelope.game.word}</strong>
      </p>
      {envelope.game.deadline && (
        <FuseBar
          startedAt={envelope.game.deadline.startedAt}
          endsAt={envelope.game.deadline.endsAt}
          serverNow={serverNow}
          label={t("game.doodle.timeLeft")}
        />
      )}
      <canvas
        ref={canvasRef}
        className="doodle-ctl__canvas"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onUp}
        aria-label={t("game.doodle.canvas")}
      />
      <div className="doodle-ctl__tools">
        <div className="chip-row">
          {PALETTE.map((swatch, index) => (
            <button
              key={swatch}
              type="button"
              className="chip chip--color"
              style={{ background: swatch }}
              aria-pressed={color === index}
              aria-label={swatch}
              onClick={() => setColor(index)}
            >
              {color === index ? "✓" : ""}
            </button>
          ))}
        </div>
        <div className="chip-row">
          {WIDTHS.map((size, index) => (
            <button
              key={size}
              type="button"
              className="chip"
              aria-pressed={width === index}
              aria-label={`${size}px`}
              onClick={() => setWidth(index)}
            >
              <span
                className="doodle-ctl__dot"
                style={{ width: size / 2 + 6, height: size / 2 + 6 }}
              />
            </button>
          ))}
          <button
            type="button"
            className="btn btn--ghost"
            disabled={envelope.game.strokeCount === 0}
            onClick={() => {
              haptic(8);
              send({ type: "undo" });
              // The local canvas cannot know which stroke went; the TV is the
              // truth, and the drawer keeps drawing from what they see there.
            }}
          >
            {t("game.doodle.undo")}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              haptic(8);
              send({ type: "clear" });
              repaintBlank();
            }}
          >
            {t("game.doodle.clear")}
          </button>
        </div>
      </div>
    </div>
  );
}

function GuessPanel({
  envelope,
  send,
  events,
  serverNow,
  t,
}: ControllerPanelProps<DoodleControllerState, DoodleAction>) {
  const { hint, guessed, points, lastGuess, drawerName, deadline } = envelope.game;

  const seen = useRef(0);
  useEffect(() => {
    for (const event of events.slice(seen.current)) {
      if (event.kind === "doodle-correct") haptic([30, 40, 30]);
      if (event.kind === "doodle-wrong") haptic(15);
    }
    seen.current = events.length;
  }, [events]);

  return (
    <div className="ctl-panel doodle-guess" data-guessed={guessed || undefined}>
      <p className="ctl-panel__sub">{t("game.doodle.drawing", { name: drawerName })}</p>
      <p className="doodle-guess__hint">{hint}</p>
      {deadline && (
        <FuseBar
          startedAt={deadline.startedAt}
          endsAt={deadline.endsAt}
          serverNow={serverNow}
          label={t("game.doodle.timeLeft")}
        />
      )}
      {guessed ? (
        <p className="ctl-panel__headline">{t("game.doodle.youGotIt", { points })}</p>
      ) : (
        <>
          <TextEntry
            placeholder={t("game.doodle.guessPlaceholder")}
            submitLabel={t("game.doodle.guess")}
            maxLength={30}
            onSubmit={(text) => send({ type: "guess", text })}
          />
          {lastGuess && !lastGuess.correct && (
            <p className="ctl-panel__sub">{t("game.doodle.nope", { text: lastGuess.text })}</p>
          )}
        </>
      )}
    </div>
  );
}

export const doodleWeb = defineWebGame<DoodlePublicState, DoodleControllerState, DoodleAction>({
  id: "doodle",
  Controller: DoodleController,
  Screen: DoodleScreen,
  activePlayerId: (game) => game.drawerId || undefined,
  badges: (game) =>
    Object.fromEntries(game.guessedIds.map((id) => [id, { text: "✓", tone: "good" as const }])),
  round: (game) => game.turn,
  sfx: { "doodle-guessed": "accept", "doodle-reveal": "score", "doodle-draw": "start" },
  hiddenEventKinds: ["doodle-draw"],
});
