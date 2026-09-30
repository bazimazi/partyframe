/**
 * Player setup, the first thing a phone shows after scanning.
 *
 * Everything here is optimised for the twenty seconds between "scanned the code"
 * and "in the game": the name field is focused and pre-filled from the last
 * session, avatar and colour have working defaults, colours other players
 * already took are marked, and the join button is always reachable with one
 * thumb.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AVATARS, PLAYER_COLORS, PLAYER_COLOR_NAMES, PLAYER_NAME_MAX } from "@partyframe/protocol";
import { haptic, sfx } from "../sfx.js";
import { useT } from "../i18n/I18nProvider.js";
import { loadProfile, saveProfile } from "../net/storage.js";

type Avatar = (typeof AVATARS)[number];
type Color = (typeof PLAYER_COLORS)[number];

export interface Profile {
  name: string;
  avatar: Avatar;
  color: Color;
}

export function SetupPanel({
  roomCode,
  suggested,
  takenColors,
  busy,
  onJoin,
}: {
  roomCode: string;
  /** Server-assigned defaults, used when this phone has no saved profile. */
  suggested: { avatar: string; color: string };
  /** Colours other seated players hold right now. */
  takenColors?: ReadonlySet<string>;
  busy: boolean;
  onJoin: (profile: Profile) => void;
}) {
  const t = useT();
  const [stored] = useState(loadProfile);
  const taken = useMemo(() => takenColors ?? new Set<string>(), [takenColors]);

  const [name, setName] = useState(stored?.name ?? "");
  /**
   * The player's explicit picks. `null` means "not chosen yet": the swatch
   * then follows the server's suggestion, which lands a moment after the socket
   * opens. Without that, three phones opening the form before their rows exist
   * would all default to the same first swatch and show up on the TV in
   * identical red. A remembered profile counts as a pick.
   */
  const [pickedAvatar, setPickedAvatar] = useState<Avatar | null>(
    stored?.avatar ? pickFrom(AVATARS, stored.avatar) : null,
  );
  const [pickedColor, setPickedColor] = useState<Color | null>(
    stored?.color ? pickFrom(PLAYER_COLORS, stored.color) : null,
  );

  const avatar = pickedAvatar ?? pickFrom(AVATARS, suggested.avatar);
  // A remembered colour that someone else grabbed first gives way to a free one.
  const wanted = pickedColor ?? pickFrom(PLAYER_COLORS, suggested.color);
  const color = taken.has(wanted) ? (PLAYER_COLORS.find((c) => !taken.has(c)) ?? wanted) : wanted;

  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    // Autofocus only when there is nothing to keep: pushing the keyboard up over
    // a pre-filled form makes a returning player scroll to find the button.
    if (!stored?.name) inputRef.current?.focus();
  }, [stored?.name]);

  const trimmed = name.trim();
  const canJoin = trimmed.length > 0 && !busy;

  return (
    <form
      className="setup"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canJoin) return;
        // The first tap is also the gesture that unlocks audio on this phone.
        sfx.unlock();
        haptic(15);
        const profile: Profile = { name: trimmed, avatar, color };
        saveProfile(profile);
        onJoin(profile);
      }}
    >
      <p className="setup__room">{t("join.roomLabel", { code: roomCode })}</p>

      <label className="field">
        <span className="field__label">{t("join.yourName")}</span>
        <input
          ref={inputRef}
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("join.namePlaceholder")}
          maxLength={PLAYER_NAME_MAX}
          autoComplete="nickname"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
        />
      </label>

      <fieldset className="field setup__group">
        <legend className="field__label">{t("join.chooseAvatar")}</legend>
        <div className="chip-row">
          {AVATARS.map((option) => (
            <button
              key={option}
              type="button"
              className="chip"
              aria-pressed={avatar === option}
              aria-label={option}
              onClick={() => {
                setPickedAvatar(option);
                haptic(8);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field setup__group">
        <legend className="field__label">{t("join.chooseColor")}</legend>
        <div className="chip-row">
          {PLAYER_COLORS.map((option) => {
            const label = t(`color.${PLAYER_COLOR_NAMES[option]}`);
            const isTaken = taken.has(option) && option !== color;
            return (
              <button
                key={option}
                type="button"
                className="chip chip--color"
                style={{ background: option }}
                aria-pressed={color === option}
                aria-label={isTaken ? t("join.colorTaken", { color: label }) : label}
                aria-disabled={isTaken}
                data-taken={isTaken || undefined}
                onClick={() => {
                  if (isTaken) return;
                  setPickedColor(option);
                  haptic(8);
                }}
              >
                {color === option ? "✓" : isTaken ? "×" : ""}
              </button>
            );
          })}
        </div>
      </fieldset>

      <button type="submit" className="btn btn--primary btn--big btn--block" disabled={!canJoin}>
        {busy ? t("join.joining") : t("join.joinGame")}
      </button>
    </form>
  );
}

/** Narrows a stored string back into the allowed set, falling back to the first. */
function pickFrom<T extends readonly string[]>(options: T, value: string): T[number] {
  return (options as readonly string[]).includes(value)
    ? (value as T[number])
    : (options[0] as T[number]);
}
