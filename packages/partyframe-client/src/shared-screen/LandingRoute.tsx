/**
 * The front page of a multi-game host.
 *
 * Lists what the server has installed and links each game to `/game?game=id`.
 * A server with a single game skips this page entirely and goes straight to
 * the lobby, which is what the QR-and-go experience expects.
 */

import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/I18nProvider.js";
import { LocaleSwitcher } from "../i18n/LocaleSwitcher.js";
import { useServerConfig } from "../net/useServerConfig.js";
import { LoadingScreen } from "../ui/common.js";

export function LandingRoute() {
  const t = useT();
  const { config, loaded } = useServerConfig();

  if (!loaded) return <LoadingScreen message={t("host.connecting")} />;
  if (config.games.length <= 1) return <Navigate to="/game" replace />;

  return (
    <div className="landing">
      <header className="landing__header">
        <h1 className="landing__title">{t("app.title")}</h1>
        <p className="landing__tagline">{t("app.tagline")}</p>
        <LocaleSwitcher />
      </header>

      <h2 className="landing__heading">{t("app.chooseGame")}</h2>
      <ul className="landing__games">
        {config.games.map((game) => (
          <li key={game.id} className="landing__game">
            <span className="landing__game-name">{t(game.nameKey)}</span>
            <span className="landing__game-meta">
              {t("app.players", { min: game.minPlayers, max: game.maxPlayers })}
            </span>
            <Link
              className="btn btn--primary btn--big"
              to={`/game?game=${encodeURIComponent(game.id)}`}
            >
              {t("app.play")}
            </Link>
          </li>
        ))}
      </ul>

      <p className="landing__join">
        <Link className="btn btn--ghost" to="/join">
          {t("join.title")}
        </Link>
      </p>
    </div>
  );
}
