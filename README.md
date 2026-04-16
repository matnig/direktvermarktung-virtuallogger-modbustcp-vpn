# modbus-bridge

A configurable Modbus TCP bridge for energy and industrial applications.

Configure Modbus TCP sources and register definitions through a web UI or REST API. The service polls devices on user-defined intervals, decodes register values, and exposes live readings through a runtime status API.

---

## One-command install

Run either of these in your terminal. The script clones the repo, installs dependencies, and starts the app.

```bash
# curl
curl -fsSL https://raw.githubusercontent.com/OWNER/modbus-bridge/main/install.sh | bash

# wget
wget -qO- https://raw.githubusercontent.com/OWNER/modbus-bridge/main/install.sh | bash
```

> Replace `OWNER` with the GitHub username or organisation before use.

The app installs to `~/modbus-bridge` by default. Override with:

```bash
MODBUS_BRIDGE_DIR=/opt/modbus-bridge curl -fsSL https://...install.sh | bash
```

Open **http://localhost:3000** after the server starts.

---

## Quick start (manual / developer)

```bash
git clone https://github.com/OWNER/modbus-bridge.git
cd modbus-bridge
npm install
npm run dev
```

Open **http://localhost:3000** in your browser.

No manual file setup is required. Data folders and JSON storage files are created automatically on first start.

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | ≥ 18.18.0 |
| npm | ≥ 9 |

No database. No Docker required. Runs fully local with JSON file storage.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with nodemon — auto-restarts on source file changes |
| `npm start` | Start for production / stable local use |
| `npm test` | Run the test suite (Node built-in test runner) |
| `npm run test:watch` | Re-run tests on file save |

---

## Environment variables

Copy `.env.example` to `.env` to override defaults. All variables are optional.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `src/persistence/data/` | Path for JSON data files |

```bash
cp .env.example .env
# edit .env as needed
```

> The app does **not** load `.env` automatically. Use a tool like
> [`dotenv-cli`](https://www.npmjs.com/package/dotenv-cli) or export the
> variables in your shell if you need to override defaults:
>
> ```bash
> PORT=4000 npm run dev
> ```

---

## What it does

- **Sources** — configure Modbus TCP devices (host, port, unit ID, polling interval)
- **Registers** — map register addresses to typed values (holding / input / coil / discrete-input, uint16 / int16 / uint32 / int32 / float32 / bool)
- **Profiles** — reusable templates that can be applied to a source to bulk-create registers
- **Runtime polling** — background scheduler reads all enabled sources on their configured intervals and stores live values in memory
- **Live UI** — browser view shows current register values, per-source status, last success / error, and next scheduled poll
- **Export / Import** — full configuration snapshot as a single JSON file
- **VPN Settings** — store and manage an OpenVPN configuration through the web UI; connect / disconnect from the UI; connection state tracked in memory
- **Language switch** — UI supports English and German; selected language is persisted in `localStorage`

---

## API overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sources` | List all sources |
| POST | `/api/sources` | Create a source |
| PUT | `/api/sources/:id` | Update a source |
| DELETE | `/api/sources/:id` | Delete a source |
| GET | `/api/registers` | List registers (optional `?sourceId=`) |
| POST | `/api/registers` | Create a register |
| PUT | `/api/registers/:id` | Update a register |
| DELETE | `/api/registers/:id` | Delete a register |
| GET | `/api/profiles` | List profiles |
| POST | `/api/profiles` | Create a profile |
| POST | `/api/profiles/:id/apply` | Apply profile to a source |
| GET | `/api/runtime/status` | Live polling state + register values |
| POST | `/api/runtime/poll-once` | Trigger a manual poll cycle |
| POST | `/api/runtime/start` | Start the background polling loop |
| POST | `/api/runtime/stop` | Stop the background polling loop |
| GET | `/api/export` | Export full config as JSON |
| POST | `/api/export/import` | Import a config snapshot |
| GET | `/api/vpn` | Config metadata + connection state (no secrets, no file content) |
| PUT | `/api/vpn` | Save settings (type, enabled, remoteHost, username, credentials) |
| POST | `/api/vpn/upload` | Store .ovpn profile from `{ content, filename }` body |
| DELETE | `/api/vpn/profile` | Remove stored .ovpn file and clear metadata |
| POST | `/api/vpn/connect` | Spawn OpenVPN using the stored profile; poll GET for state |
| POST | `/api/vpn/disconnect` | Stop the active OpenVPN process |
| GET | `/api/health` | Health check |

---

## Project structure

```
src/
  app/           Express setup and startup
  api/           Route handlers
  config/        Environment config
  domain/        Domain model classes
  middleware/    Error handler
  modbus/        Modbus TCP client and value decoder
  persistence/   JSON file store
    data/        Runtime JSON files (auto-created, gitignored)
  repositories/  Data access layer
  services/      Business logic and runtime polling engine
  validation/    Input validation
public/
  public_index.html   Web UI
  i18n/
    translations.js   EN + DE translation strings
```

---

## Data storage

Configuration is stored as JSON files under `src/persistence/data/` (or the path set in `DATA_DIR`).

| File | Contents |
|------|----------|
| `sources.json` | Modbus TCP device configurations |
| `registers.json` | Register definitions |
| `profiles.json` | Profile templates |
| `settings.json` | Application settings |
| `vpn.json` | VPN settings + uploaded file metadata (no credentials, no file content) |
| `vpn_secrets.json` | VPN password and passphrase (excluded from export/import) |
| `vpn-profile.ovpn` | Stored OpenVPN profile file (excluded from export/import, mode 0600) |

Files are created automatically on first run. They are gitignored — each environment gets its own fresh data.

---

## Security notice

> **Warning — experimental VPN implementation.** This project is a development tool and prototype. Before deploying in any environment with network access:
>
> - VPN credentials (password, passphrase) are stored in **plaintext** in `vpn_secrets.json`. Protect the data directory with filesystem permissions. In production, replace this with an OS keychain or secrets manager.
> - There is **no authentication** on the HTTP API. The web UI and all REST endpoints are open to anyone who can reach the server. Use firewall rules or a reverse proxy with authentication to restrict access.
> - The VPN feature directly spawns the `openvpn` CLI. Running a process that manages network interfaces requires elevated privileges. Do not run modbus-bridge as root without understanding the implications.

---

## Limitations

- JSON file storage only — not suitable for high-volume or multi-process deployments
- No authentication — all API endpoints and the web UI are unauthenticated
- Modbus connection pooled per host:port; one client instance per server process
- Register polling is sequential per source (not parallel across registers)
- **VPN — OS requirements**: The `openvpn` binary must be installed on the host and typically requires `root` or `CAP_NET_ADMIN`. In production, run via a privileged helper script or a systemd service unit that has the required capabilities.
- **VPN — state persistence**: Connection state (connected / disconnected / error) is in-memory only and resets when the server restarts.
- **VPN — secrets at rest**: Password and passphrase are stored in plaintext in `vpn_secrets.json`. This file is excluded from export snapshots but is not encrypted.
- **VPN — content limit**: Profile content is limited to 100 KB. Upload validation checks for known OpenVPN config keywords; unusual or custom `.ovpn` dialects may be rejected.
- **i18n**: All main UI labels are translated (EN/DE). Server-side validation error messages are in English only.
