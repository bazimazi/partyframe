/**
 * Tap Race on the web: a phone button and a Phaser scene for the TV.
 *
 * The scene is loaded lazily through `scene`, so Phaser never reaches the phone
 * bundle. Compare with `../reflex/web.tsx`, which renders the TV in React.
 */

import { defineWebGame, sfx, type ControllerPanelProps } from "@bazimazi/partyframe-client";
import type { TapAction, TapControllerState, TapPublicState } from "./game.js";

export function TapController({
  envelope,
  send,
  t,
}: ControllerPanelProps<TapControllerState, TapAction>) {
  const { taps, target } = envelope.game;
  return (
    <div className="ctl-panel">
      <p className="ctl-panel__headline">
        {taps} / {target}
      </p>
      <p className="ctl-panel__sub">{t("game.tap.firstTo", { target })}</p>
      <button
        type="button"
        className="btn btn--primary btn--big btn--block tap-button"
        disabled={!envelope.active}
        onClick={() => {
          sfx.play("tick");
          send({ type: "tap" });
        }}
      >
        {t("game.tap.tap")}
      </button>
    </div>
  );
}

export const tapWeb = defineWebGame<TapPublicState, TapControllerState, TapAction>({
  id: "tap",
  Controller: TapController,
  scene: () => import("./scene.js").then((module) => module.TapScene),
  sfx: { "tap-finished": "win" },
});
