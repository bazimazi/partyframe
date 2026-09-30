/**
 * Developer tools.
 *
 * Rendered only when the server reports `devTools: true`, which it refuses to do
 * in a production build. Every command it sends is also re-checked server-side,
 * so an attacker crafting the message by hand against a production server gets a
 * `NOT_ALLOWED` rather than a free round skip.
 *
 * Exists because the flows that are hardest to test by hand - reconnection,
 * timeouts, a full lobby - are the ones most likely to break. Game-specific
 * shortcuts come from the game's `devCommands`, published by the server.
 */

import { useState } from "react";
import type { SessionAction } from "@partyframe/protocol";
import { useT } from "../i18n/I18nProvider.js";
import { buildJoinUrl, resolveServerHttpUrl } from "../net/endpoint.js";

/** Latency presets matching the conditions the network tests exercise. */
const LATENCY_PRESETS = [0, 50, 100, 250] as const;

export function DevPanel({
  roomCode,
  latencyMs,
  clockOffsetMs,
  status,
  gameCommands,
  send,
}: {
  roomCode: string;
  latencyMs: number;
  clockOffsetMs: number;
  status: string;
  /** Names of the active game's `devCommands`. */
  gameCommands: readonly string[];
  send: (action: SessionAction) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [latency, setLatency] = useState(0);

  const command = (name: string) => () => send({ type: "dev-command", command: name });

  /**
   * Adds artificial delay to every inbound message on the server.
   *
   * Server-wide rather than per-client on purpose: the interesting failures are
   * the ones where the shared screen and a phone disagree about timing, and that
   * only shows up when both are slowed together.
   */
  const applyLatency = (milliseconds: number) => {
    setLatency(milliseconds);
    void fetch(`${resolveServerHttpUrl()}/api/dev/latency`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ milliseconds }),
    }).catch(() => undefined);
  };

  return (
    <div className="dev-panel" data-open={open || undefined}>
      <button
        type="button"
        className="dev-panel__toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        🛠 {t("dev.title")}
      </button>

      {open && (
        <div className="dev-panel__body">
          <dl className="dev-panel__stats">
            <div>
              <dt>{t("dev.status")}</dt>
              <dd>{status}</dd>
            </div>
            <div>
              <dt>{t("dev.rtt")}</dt>
              <dd>{latencyMs} ms</dd>
            </div>
            <div>
              <dt>{t("dev.clockOffset")}</dt>
              <dd>{Math.round(clockOffsetMs)} ms</dd>
            </div>
          </dl>

          <div className="dev-panel__actions">
            <button type="button" className="btn btn--ghost" onClick={command("add-bot")}>
              {t("dev.addBot")}
            </button>
            <button type="button" className="btn btn--ghost" onClick={command("remove-bot")}>
              {t("dev.removeBot")}
            </button>
            <button type="button" className="btn btn--ghost" onClick={command("end-session")}>
              {t("dev.endSession")}
            </button>
          </div>

          {gameCommands.length > 0 && (
            <div className="dev-panel__row">
              <span className="dev-panel__row-label">{t("dev.gameCommands")}</span>
              <div className="dev-panel__actions">
                {gameCommands.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="btn btn--ghost"
                    onClick={command(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="dev-panel__row">
            <span className="dev-panel__row-label">{t("dev.simulateLatency")}</span>
            <div className="segmented" role="group">
              {LATENCY_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="segmented__option"
                  aria-pressed={latency === preset}
                  onClick={() => applyLatency(preset)}
                >
                  {preset === 0 ? t("dev.off") : `${preset}ms`}
                </button>
              ))}
            </div>
          </div>

          {roomCode && (
            <p className="dev-panel__hint">
              {t("dev.openController")}:{" "}
              <a href={buildJoinUrl(roomCode)} target="_blank" rel="noreferrer">
                {buildJoinUrl(roomCode)}
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
