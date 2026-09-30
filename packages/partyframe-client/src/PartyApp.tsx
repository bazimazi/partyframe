/**
 * Default host + join shell.
 *
 * A host app that only needs the built-in routes can render `<PartyApp />`
 * after `bindKit()`. Apps with their own router should render `<PartyRoutes />`
 * inside it instead, or compose the individual routes themselves.
 *
 * Routes:
 *
 * - `/`            game picker (redirects to `/game` with a single game)
 * - `/game`        the shared screen; `?game=id` picks a game, `?room=CODE` resumes
 * - `/join`        type a room code
 * - `/join/:code`  the phone controller, which is what the QR code encodes
 */

import { BrowserRouter, Route, Routes } from "react-router-dom";
import { HostRoute } from "./shared-screen/HostRoute.js";
import { LandingRoute } from "./shared-screen/LandingRoute.js";
import { JoinLanding } from "./controller/JoinLanding.js";
import { JoinRoute } from "./controller/JoinRoute.js";
import { I18nProvider } from "./i18n/I18nProvider.js";

export function PartyRoutes() {
  return (
    <I18nProvider>
      <Routes>
        <Route path="/" element={<LandingRoute />} />
        <Route path="/game" element={<HostRoute />} />
        <Route path="/join" element={<JoinLanding />} />
        <Route path="/join/:code" element={<JoinRoute />} />
      </Routes>
    </I18nProvider>
  );
}

export function PartyApp({ basename }: { basename?: string } = {}) {
  return (
    <BrowserRouter basename={basename}>
      <PartyRoutes />
    </BrowserRouter>
  );
}
