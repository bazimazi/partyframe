/**
 * The running commentary strip.
 *
 * Events are presentation cues, not state: if one is dropped nothing breaks, and
 * the feed intentionally shows only the last few so a TV never turns into a log
 * viewer. It is announced politely to assistive technology so a player using a
 * screen reader hears who answered and what blew up.
 */

import { useMemo } from "react";
import { PLATFORM_EVENT, type GameEventMessage } from "@partyframe/protocol";
import { useT } from "../i18n/I18nProvider.js";

const VISIBLE = 5;

/** Platform cues that exist for the lobby button, not for the feed. */
const PLATFORM_HIDDEN: ReadonlySet<string> = new Set([PLATFORM_EVENT.START_REFUSED]);

export function EventFeed({
  events,
  hiddenKinds,
}: {
  events: GameEventMessage[];
  /** Game-declared kinds to keep out of the feed (canvas-only cues). */
  hiddenKinds?: readonly string[];
}) {
  const t = useT();
  const hidden = useMemo(() => new Set(hiddenKinds ?? []), [hiddenKinds]);

  const visible = events
    .filter(
      (event) => event.messageKey && !PLATFORM_HIDDEN.has(event.kind) && !hidden.has(event.kind),
    )
    .slice(-VISIBLE)
    .reverse();

  return (
    <section className="event-feed" aria-label={t("host.events")}>
      <ul className="event-feed__list" aria-live="polite">
        {visible.map((event, index) => (
          <li
            key={`${event.at}-${event.kind}-${index}`}
            className="event-feed__item"
            data-kind={event.kind}
            // The newest line is fully opaque; older ones recede.
            style={{ opacity: 1 - index * 0.18 }}
          >
            {t(event.messageKey!, event.params)}
          </li>
        ))}
      </ul>
    </section>
  );
}
