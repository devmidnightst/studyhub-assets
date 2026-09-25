# Nocturne

An Ultraviolet based web proxy — plus accounts, AI chat, community chat, music, films, a code IDE, disposable VMs, and a school-filter link checker.

Built on:

- **Ultraviolet** - client-side URL + script rewriting (service worker)
- **Scramjet** - optional alternative proxy engine (switchable in settings)
- **Epoxy Transport** - HTTPS/WebSocket proxy over Wisp
- **Bare-Mux** - unified bare-client interface
- **Wisp-JS** - single-port multiplexed transport

Server is Express 5 + better-sqlite3 (WAL). Everything else is static + one websocket upgrade handler that dispatches VM/VNC, dev-app, box-terminal, and flix sockets before falling through to Wisp.

## Run

```bash
npm install && npm start
```

Default port: `8080` (override with `PORT=3000 npm start`).

## Owner account

The admin/owner account (username from `NOCTURNE_OWNER`, default `midnightsweat`) is seeded on every boot. Its password comes from `NOCTURNE_OWNER_PASSWORD`; if unset, the password in `data/owner-password` is used (a random one is generated there on first boot, mode 0600, gitignored). There is no default password.

The `data/` directory holds the database and all API keys/secrets — it is gitignored and never served over HTTP. Do not commit or publish it.

## Features

- **Proxy browser** - tabbed UI, hover-prefetch, tab cloaks, panic key (`Ctrl+Q`), switchable search engine, back/forward via popstate, UV or Scramjet engine.
- **Accounts** - scrypt-hashed signup/login, 30-day sessions, per-user cookie vault sync.
- **AI chat** (`/ai`) - Groq + Navy (OpenAI-compatible) backends with key pooling, per-user credits/quotas, saved chats. Public API at `POST /api/ai` with user-managed `noct_…` keys (`/api` console).
  - **Tiers.** Free accounts (and signed-out visitors) run on a single model — *Nocturne Flash*, served by its own OpenAI-compatible backend — with the model picker locked. Paid accounts and the owner get the full lineup. Mark someone paid from the admin panel (`data/paid-users.json`); a per-user model grant (`data/model-grants.json`) still works as a targeted override without marking them paid.
- **Chat** (`/chat`) - SSE community rooms, DMs, Giphy, reactions, giveaways, profanity + AI moderation.
- **Music** (`/music`) - Audius / Deezer / YouTube Music search and streaming. Audius and Deezer need no setup; YouTube Music *playback* (search works regardless) shells out to `yt-dlp`, which must be installed and on `PATH` — see [Configuration](#configuration).
- **Films** (`/films`) - server-side rewriting proxy of a streaming provider (`NOCTURNE_FLIX=1`).
- **Code IDE** (`/code`) - Monaco editor, projects, Wandbox/Piston execution, GitHub import, snippet sharing.
- **Runner** - run user Node/Python servers in hardened Docker containers, served at `/code/dev/<token>/` (`NOCTURNE_RUNNER=1`).
- **VMs** (`/vms`) - disposable KasmVNC browser desktops reverse-proxied through `/vm/<code>/`; plus optional per-user Docker "boxes" with a web terminal (`NOCTURNE_BOXES=1`).
- **Link checker** (`/linkcheck`) - probes 16 school-filter vendors for a URL's category/block status; SSE UI + public `/api/v1/linkcheck`.
- **Games, tools, support, applications, admin panel** (`/admin`).

## Configuration

All optional; sensible defaults otherwise.

| Variable | Purpose |
|---|---|
| `PORT` | Listen port (default 8080) |
| `NOCTURNE_OWNER` / `NOCTURNE_OWNER_PASSWORD` | Owner username / password (see above) |
| `NOCTURNE_DATA_DIR` | Where the DB + secrets live (default `./data`) |
| `NOCTURNE_RUNNER` / `NOCTURNE_BOXES` / `NOCTURNE_FLIX` | Enable those subsystems (`=1`) |
| `NOCTURNE_ALLOW_LOCAL` | Let Wisp reach loopback/private IPs (SSRF guard off) |
| `NOCTURNE_TRUST_PROXY` | Express trust-proxy setting (default 1) |
| `GROQ_API_KEYS`, `NAVY_API_KEY`, `OPENROUTER_API_KEY` | AI provider keys (or files in `data/`) |
| `NOCTURNE_FLASH_KEY` / `NOCTURNE_FLASH_BASE` | Free-tier model key / OpenAI-compatible base URL (or `data/flash-key`, `data/flash-base`) |
| `GIPHY_API_KEY`, `TMDB_API_KEY`, `XCLOUD_API_KEY`, `GITHUB_TOKEN`, `DNSFILTER_API_KEY` | Feature API keys (or files in `data/`) |
| `NOCTURNE_SUPPORT_WEBHOOK` | Discord webhook for the support inbox |

### System dependencies

- `yt-dlp` on `PATH` — required for YouTube Music *playback* (`/api/sp/audio`); everything else (search, Audius, Deezer) works without it. If missing, the app logs a warning at boot and playback requests 502 with a clear error instead of hanging silently. Install the standalone binary (no `pip` needed):
  ```bash
  sudo curl -L -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp
  sudo chmod +x /usr/local/bin/yt-dlp
  ```
- `ffmpeg` — not strictly required for the audio-only path above, but recommended alongside `yt-dlp` for format robustness (`apt install ffmpeg` / equivalent).

## Structure

```
.
├── index.js               Express + Wisp server, page/static layer, link checker
├── auth.js                accounts, sessions, owner seeding
├── db.js                  SQLite schema + shared statements
├── groq.js                AI gateway (chat, credits, public API keys)
├── chat.js                community chat + DMs (SSE)
├── music.js  flix.js      music streaming · films proxy
├── projects.js  runner.js code IDE projects · Docker code runner
├── vms.js  boxes.js       provider VMs · per-user Docker boxes
├── admin.js  applications.js  moderation.js  profanity.js  storage.js
├── filters/               per-vendor link-check probes (+ category JSON)
├── _box/  _runner/        Dockerfiles + smoke tests for boxes/runner
├── data/                  DB + secrets (gitignored, never served)
└── public/
    ├── index.html         home + proxy shell
    ├── math.mjs           transport + engine init (UV / Scramjet)
    ├── uv-worker.js       service worker (anti-cache proxy SW)
    ├── baremux/  epoxy/   (shadowed — real bundles served from node_modules)
    └── src/{css,js}       app · loader · chat · ai · music · code · admin …
```

## Shortcuts

| Key       | Action                       |
|-----------|------------------------------|
| `Ctrl+L`  | Focus URL bar                |
| `Ctrl+Q`  | Panic - redirect to Google   |
| `Esc`     | Close settings               |

## Deploying to a VPS

1. Clone / rsync the repo onto the box (never include `data/`).
2. `npm install --omit=dev`.
3. Put it behind a TLS-terminating reverse proxy (Caddy, nginx, Cloudflare).
4. Forward the websocket upgrades to this process (Caddy does it transparently).
5. For the runner/boxes, build the images in `_runner/` and `_box/` and set the matching env flags.

Example Caddyfile:

```
nocturne.example.com {
    reverse_proxy localhost:8080
}
```
