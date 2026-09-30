/**
 * Tap Race on the TV, drawn with Phaser.
 *
 * The scene pulls from the `StageBridge` inside its own update loop and never
 * touches React. Each player gets a bar that fills towards the target.
 */

import Phaser from "phaser";
import { drainEvents, type GameSceneClass, type StageBridge } from "@bazimazi/partyframe-client";
import type { TapPublicState } from "./game.js";

const FONT = "Inter, system-ui, sans-serif";

class TapSceneImpl extends Phaser.Scene {
  static readonly KEY = "tap";
  private bridge!: StageBridge;
  private rows = new Map<
    string,
    { label: Phaser.GameObjects.Text; bar: Phaser.GameObjects.Rectangle }
  >();
  private title!: Phaser.GameObjects.Text;

  constructor() {
    super(TapSceneImpl.KEY);
  }

  init(data: { bridge: StageBridge }) {
    this.bridge = data.bridge;
  }

  create() {
    this.title = this.add.text(40, 28, "", {
      fontFamily: FONT,
      fontSize: "28px",
      color: "#94a3b8",
    });
  }

  override update() {
    for (const event of drainEvents(this.bridge)) {
      if (event.kind === "tap-finished") this.cameras.main.flash(300, 34, 197, 94);
    }

    const game = this.bridge.game as TapPublicState | null;
    if (!game) return;
    this.title.setText(`First to ${game.target} taps`);

    const width = this.scale.width - 80;
    this.bridge.players.forEach((player, index) => {
      let row = this.rows.get(player.id);
      const y = 90 + index * 64;
      if (!row) {
        row = {
          label: this.add.text(40, y, "", { fontFamily: FONT, fontSize: "30px", color: "#f8fafc" }),
          bar: this.add.rectangle(40, y + 44, 0, 10, 0xffffff).setOrigin(0, 0.5),
        };
        this.rows.set(player.id, row);
      }
      const taps = game.taps[player.id] ?? 0;
      row.label.setText(`${player.avatar}  ${player.name}   ${taps}`);
      row.bar.setFillStyle(Phaser.Display.Color.HexStringToColor(player.color).color);
      row.bar.width = Math.min(1, taps / game.target) * width;
    });
  }
}

export const TapScene = TapSceneImpl as GameSceneClass;
