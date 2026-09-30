# Deployment

A partyframe app is a Node process (the game server) and a static web app (the
TV and the phones). They can share one origin or be hosted apart.

## One origin (recommended)

Build the web app, then let the server serve it:

```ts
await listen({
  defaultGameId: "tap",
  games: [tapGame],
  staticDir: "dist",        // the Vite build
  publicBaseUrl: process.env.PUBLIC_URL,
});
```

`listen()` serves `staticDir` with an SPA fallback (`/game`, `/join/ABCD` load
`index.html`), immutable caching for hashed `/assets/`, correct MIME types and
no path traversal. Phones and the TV then talk to the same origin they were
served from, so nothing needs configuring on the client.

Environment the server reads by default:

| Variable | Meaning |
| --- | --- |
| `PORT` | Port to listen on (default 2567) |
| `PUBLIC_URL` | Public origin for QR codes when behind a proxy (see below) |
| `NODE_ENV=production` | Disables developer tools regardless of options |

## Split hosting

Host the web app on a CDN and the server elsewhere. Tell the web app where the
server is, either at build time:

```
VITE_SERVER_URL=https://party-api.example.com
VITE_PUBLIC_URL=https://party.example.com
```

or at runtime before rendering:

```ts
configureClient({ serverUrl: "https://party-api.example.com" });
```

The server's `corsOrigin` defaults to `*` for its small JSON API; set it to
your web origin if you prefer.

## Behind a proxy

The QR code must encode the address a *phone* can open. By default that is
the page's own origin, which is right whenever the TV opened the app at its
public address. If the TV reaches the app through a private hostname (a
reverse proxy, a tunnel, a Docker network), set `publicBaseUrl` on the server
or `VITE_PUBLIC_URL` on the web app.

WebSockets must pass through the proxy (`Upgrade` headers). Room lookups are
rate limited per address using `X-Forwarded-For` when present.

## Health and lifecycle

- `GET /api/health` → `{ ok, sessions, uptimeSeconds }` for load balancers.
- `listen()` returns `{ port, close() }`. Colyseus also installs `SIGINT`/`SIGTERM`
  handlers for a graceful shutdown that disconnects sessions cleanly.
- Sessions expire after 10 minutes with nobody connected and after 3 hours
  regardless (`sessionTimeoutMs`, `sessionMaxAgeMs`). `maxSessions` (default
  500) refuses new sessions beyond that many live ones.

## Local network parties

For a game night on a laptop you need no deployment at all: run the server
and the Vite dev server, and open the TV page on the laptop's **LAN address**
(`http://192.168.1.5:5173/`, not `localhost`). The TV warns when it is open on
`localhost`, because the QR code would then point phones at themselves.

## Custom HTTP routes

`listen({ onRequest })` is consulted for any request the API does not handle,
before the static directory:

```ts
await listen({
  games,
  defaultGameId: "tap",
  onRequest: (req, res) => {
    if (req.url === "/api/stats") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ... }));
      return true;
    }
    return false;
  },
});
```

For a larger app you can instead take `gameServer` and `httpServer` from the
returned `PartyServer` and mount your own framework.
