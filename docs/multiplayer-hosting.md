# Multiplayer while keeping GitHub Pages

The website remains https://printrune.github.io/bb/ and the code remains in Printrune/bb. A separate Node service owns the shared fight and sends each device the same state. No database is required. Local practice still runs entirely in a worker and does not wait for the server.

## Current deployment

Online multiplayer is enabled. The GitHub `GAME_SERVER_URL` variable points to `https://battlebots-arena-xcd8.onrender.com`. The Render service is `srv-dbt6fps9v7es73cbduk0`, in the confirmed dev's workspace, using the Free plan in Frankfurt. It allows one private two-player match at a time. Automatic server deployment is off; GitHub Pages publishes on pushes to `codex/arena-demo`.

The service was created through the Render integration using the same settings as the blueprint. Its signing secret was generated securely and stored only in Render. The following activation steps describe how to recreate the setup; use the existing service for routine updates.

## Activate free hosting

1. Connect a Render account and deploy the repository's `render.yaml` from `codex/arena-demo`. The blueprint explicitly selects the **Free** service and one concurrent two-player room.
2. Set the service's `DEMO_PASSWORD` to the agreed arena password. Render generates `SESSION_SECRET`. Never put either value in GitHub variables, client code, invitation links, or a commit.
3. Keep `ALLOWED_ORIGINS=https://printrune.github.io`. It is an origin, so it must not include `/bb/`.
4. Verify the new service's HTTPS URL with the multiplayer checks below.
5. Set the GitHub Actions repository variable `GAME_SERVER_URL` to that HTTPS origin, without a path. Run **Publish GitHub game**. The Pages build passes it to `VITE_GAME_SERVER_URL`.
6. Open `/bb/` on both devices. Create a match on one, open its invitation on the other, and ready both players.

[Create the service from this repository](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FPrintrune%2Fbb%2Ftree%2Fcodex%2Farena-demo).

Render's free service sleeps after 15 idle minutes and can take about a minute to wake. The login dialog allows time for this and can be closed to play Practice. Active inbound WebSocket messages keep a match awake. Free usage limits still apply; availability and performance are not guaranteed. Use the Free tier and no paid add-ons. [Render free limits](https://render.com/docs/free).

## Authentication and connections

The server accepts only its own browser origin and exact configured origins. Its outer HTTP gate handles CORS before Colyseus matchmaking. Requests use signed bearer sessions; WebSocket upgrades validate the same session through the SDK's authentication parameter. Pages does not depend on third-party cookies, which headset and mobile browsers may block. The existing same-origin cookie login still works for a server-hosted client.

Sessions and reconnect seats are scoped to the configured server. The password is only sent to its login endpoint. Both players' damage, hazards, result, and rematch come from one authoritative Rapier simulation. A temporary dropped connection restores the seat automatically. Refreshing a Pages tab returns to the menu; rejoin using its invitation.

## Verify

For local checks, start the server on port 3002 with `ALLOWED_ORIGINS=http://127.0.0.1:3000`. Build Pages with `VITE_GAME_SERVER_URL=http://127.0.0.1:3002`, then preview `dist/pages` at port 3000 with base `/bb/`.

Run `pnpm verify:pages-multiplayer` with `VERIFY_BASE_URL` and `VERIFY_PAGES_ORIGIN` set to the server and website origins. It verifies real clients with separate signed sessions and no cookies. Run the existing `pnpm verify:multiplayer` for the full same-origin fight, rematch, and reconnect check. Run `pnpm verify:load` with `VERIFY_LOAD_ROOMS=1` against the free service before sharing it.

Do not claim public multiplayer is active until the service is deployed, the GitHub variable is set, and the published Pages client has joined a shared fight successfully.
