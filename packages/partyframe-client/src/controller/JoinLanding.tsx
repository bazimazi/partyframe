/**
 * Manual room-code entry.
 *
 * The QR code lands on `/join/:code`. This page is the fallback when a camera
 * cannot read the TV, or when someone types the four letters from across the room.
 */

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { RoomCodeSchema } from "@partyframe/protocol";
import { useT } from "../i18n/I18nProvider.js";

export function JoinLanding() {
  const t = useT();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const parsed = RoomCodeSchema.safeParse(code);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!parsed.success) return;
    navigate(`/join/${parsed.data}`);
  };

  return (
    <div className="center-stage">
      <h1 className="join-landing__title">{t("join.title")}</h1>
      <form className="join-landing" onSubmit={onSubmit}>
        <label className="field">
          <span className="field__label">{t("join.enterCode")}</span>
          <input
            className="input input--code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder={t("join.codePlaceholder")}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={4}
            aria-invalid={code.length > 0 && !parsed.success}
          />
        </label>
        <button
          type="submit"
          className="btn btn--primary btn--big btn--block"
          disabled={!parsed.success}
        >
          {t("join.go")}
        </button>
      </form>
    </div>
  );
}
