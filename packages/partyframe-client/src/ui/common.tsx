/**
 * Small shared presentation pieces used by both the shared screen and the phone.
 *
 * Kept in one file because each is a handful of lines; splitting them would add
 * imports without adding clarity.
 */

import type { ReactNode } from "react";
import type { ClientPlayer, PartyError } from "@partyframe/protocol";
import { useT } from "../i18n/I18nProvider.js";
import type { ConnectionStatus } from "../net/SessionConnection.js";

/**
 * Connection indicator.
 *
 * Colour is never the only signal: the dot is always paired with a word, because
 * "the green dot means connected" is invisible to a colour-blind player and
 * unreadable from across a room.
 */
export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const t = useT();
  const label =
    status === "connected"
      ? t("controller.connected")
      : status === "reconnecting" || status === "connecting"
        ? t("controller.reconnecting")
        : t("controller.disconnected");

  const modifier =
    status === "connected"
      ? ""
      : status === "reconnecting" || status === "connecting"
        ? " status-dot--warn"
        : " status-dot--off";

  return (
    <span className="conn-badge" role="status" aria-live="polite">
      <span className={`status-dot${modifier}`} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Avatar plus colour swatch. The emoji carries identity when colours clash. */
export function PlayerAvatar({
  player,
  size = 44,
}: {
  player: Pick<ClientPlayer, "avatar" | "color" | "name">;
  size?: number;
}) {
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.55,
        background: player.color,
      }}
      aria-hidden="true"
    >
      {player.avatar}
    </span>
  );
}

/** Full-screen failure state. Never shows a stack trace or a raw server string. */
export function ErrorScreen({
  error,
  onRetry,
  children,
}: {
  error: PartyError;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="center-stage">
      <div className="error-mark" aria-hidden="true">
        💥
      </div>
      <h1 className="error-title">{t(error.messageKey)}</h1>
      {children}
      {onRetry && (
        <button type="button" className="btn btn--primary btn--big" onClick={onRetry}>
          {t("error.retry")}
        </button>
      )}
    </div>
  );
}

/** Centred spinner-free loading state; a pulsing dot reads better on a TV. */
export function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="center-stage">
      <div className="loading-pulse" aria-hidden="true" />
      <p className="loading-text" role="status">
        {message}
      </p>
    </div>
  );
}
