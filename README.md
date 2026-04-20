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
- **Bridge / virtual Modbus server** — exposes a Modbus TCP server on a configurable port (default 5020) so external systems can read live internal values
- **Mappings** — link internal source registers to external server registers; direction: `internal_to_external`, `external_to_internal`, or `bidirectional`
- **Transform pipeline** — per-mapping ordered steps: `scale`, `offset`, `invert`, `clamp`, `abs`
- **Write forwarding** — values written by external Modbus clients are decoded, transformed, and forwarded to internal Modbus holding registers
- **Watchdogs** — monitor selected external registers; UI alert when value has not changed within a configurable timeout (`ok` / `stale` / `disabled` / `error`)
- **Virtual Variables** — named, typed in-memory variables (float32 / uint16 / int16 / uint32 / int32 / bool / string); readable and writable by mappings and MQTT; manually settable from the UI
- **MQTT integration** — connect to any MQTT broker; publish internal registers, external registers, virtual variables, or watchdog states on change; subscribe to topics to ingest values into virtual variables (JSON path extraction, transforms, type coercion)
- **Mapping extensions** — mappings now support variable sources (`sourceType: variable`) and variable or internal-register targets (`targetType: variable | internal`)

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
| GET | `/api/external-registers` | List external (server-side) registers |
| POST | `/api/external-registers` | Create an external register |
| PUT | `/api/external-registers/:id` | Update an external register |
| DELETE | `/api/external-registers/:id` | Delete an external register |
| GET | `/api/mappings` | List mappings |
| POST | `/api/mappings` | Create a mapping |
| PUT | `/api/mappings/:id` | Update a mapping |
| DELETE | `/api/mappings/:id` | Delete a mapping |
| GET | `/api/watchdogs` | List watchdogs |
| POST | `/api/watchdogs` | Create a watchdog |
| PUT | `/api/watchdogs/:id` | Update a watchdog |
| DELETE | `/api/watchdogs/:id` | Delete a watchdog |
| GET | `/api/bridge/status` | Bridge runtime: server status + mapping + watchdog states |
| GET | `/api/bridge/server/settings` | External Modbus server settings |
| PUT | `/api/bridge/server/settings` | Update external server settings |
| POST | `/api/bridge/server/start` | Start the external Modbus TCP server |
| POST | `/api/bridge/server/stop` | Stop the external Modbus TCP server |
| GET | `/api/variables` | List virtual variables (merged with live runtime state) |
| POST | `/api/variables` | Create a virtual variable |
| PUT | `/api/variables/:id` | Update a virtual variable |
| PATCH | `/api/variables/:id/value` | Manually set a variable value |
| DELETE | `/api/variables/:id` | Delete a variable (blocked if referenced by mappings or subscriptions) |
| GET | `/api/mqtt/config` | MQTT broker configuration (password masked) |
| PUT | `/api/mqtt/config` | Update MQTT broker settings |
| GET | `/api/mqtt/status` | MQTT connection status |
| POST | `/api/mqtt/connect` | Connect to MQTT broker |
| POST | `/api/mqtt/disconnect` | Disconnect from MQTT broker |
| POST | `/api/mqtt/reconnect` | Force reconnect |
| GET | `/api/mqtt/subscriptions` | List MQTT subscriptions |
| POST | `/api/mqtt/subscriptions` | Create an MQTT subscription |
| PUT | `/api/mqtt/subscriptions/:id` | Update an MQTT subscription |
| DELETE | `/api/mqtt/subscriptions/:id` | Delete an MQTT subscription |
| GET | `/api/mqtt-publish-rules` | List MQTT publish rules |
| POST | `/api/mqtt-publish-rules` | Create a publish rule |
| PUT | `/api/mqtt-publish-rules/:id` | Update a publish rule |
| DELETE | `/api/mqtt-publish-rules/:id` | Delete a publish rule |

---

## Project structure

```
src/
  app/           Express setup and startup
  api/           Route handlers
  config/        Environment config
  domain/        Domain model classes (Source, Register, Mapping, ExternalRegister, Watchdog, VirtualVariable, MqttConfig, MqttSubscription, MqttPublishRule)
  middleware/    Error handler
  modbus/        Modbus TCP client, server, value encoder/decoder/transformer
  persistence/   JSON file store
    data/        Runtime JSON files (auto-created, gitignored)
  repositories/  Data access layer (all entity types)
  services/      Business logic: polling, bridge, watchdog, VPN, external server, MQTT, variables
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
| `external_registers.json` | External (server-side) register definitions |
| `mappings.json` | Mapping rules (register↔register, register↔variable, variable↔internal) |
| `watchdogs.json` | Watchdog definitions |
| `external_server_settings.json` | External Modbus TCP server host/port/enabled |
| `virtual_variables.json` | Virtual variable definitions |
| `mqtt_subscriptions.json` | MQTT subscription rules (topic → variable) |
| `mqtt_publish_rules.json` | MQTT publish rules (source → topic) |
| `mqtt_config.json` | MQTT broker connection settings (password stored in plaintext) |

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
- **Bridge — Modbus server protocol**: The external server supports FC03 (read holding registers), FC06 (write single register), FC16 (write multiple registers) only. Coil / discrete-input / input registers are not exposed externally.
- **Bridge — write forwarding**: Write forwarding to internal devices only supports `holding` register type. Coil writes are not implemented.
- **Bridge — transform direction**: One `transforms` array per mapping applies in both forward and reverse directions. Configure separate mappings with distinct transforms if asymmetric transformation is needed.
- **Bridge — server port**: Default listen port is 5020 (non-privileged). Standard Modbus port 502 requires root on Linux.
- **Bridge — connection state**: External server client count and bridge mapping states are in-memory and reset on restart.
- **Watchdog — actions**: Currently only tracks `ok` / `stale` state with UI alert. Automated actions (relay write, alarm trigger) are not yet implemented.
- **MQTT — password at rest**: The MQTT broker password is stored in plaintext in `mqtt_config.json`. It is included in export/import snapshots.
- **MQTT — TLS**: TLS flag is passed to the `mqtt` client but no certificate validation or client-cert options are exposed in the UI.
- **MQTT — QoS**: QoS 1/2 require a persistent session. The current client uses `clean: true`; messages may be lost on reconnect for QoS > 0 subscriptions.
- **Virtual variables — persistence**: Variable runtime values (currentValue, source, lastUpdatedAt) are in-memory and reset on server restart. Only the definition (name, dataType, initialValue) persists.
- **Virtual variables — string type**: The `string` dataType bypasses the numeric encode/decode pipeline. Transforms (scale, offset, clamp) have no effect on string variables.
- **Referential integrity**: DELETE requests are blocked at the API level when an entity is still referenced by another (e.g. deleting an external register that is used by a mapping or watchdog). The UI shows the error as a toast and in the debug panel; referenced entities must be deleted first.
- **Data file recovery**: On startup, corrupt JSON data files (truncated or invalid JSON) are automatically replaced with the default empty collection and a warning is logged. Any data in the corrupt file is lost; restore from an export snapshot if needed.
- **Atomic writes**: All JSON data file writes use an atomic write-then-rename sequence to prevent partial-write corruption on power loss or crash. A `.tmp` file in the data directory is created transiently during each write.
- **Startup order**: The external Modbus server must be fully initialised before the bridge and watchdog polling loops start. A crash or timeout during `initServer()` will prevent bridge/watchdog from starting; the HTTP API remains available.
- **Transform safety**: Scale and offset transforms throw an error if the result is non-finite (e.g. scaling by `Infinity`). The mapping is placed in error state until the transform configuration is corrected. Clamp bounds that are not finite numbers are silently ignored.
- **MQTT path extraction**: The `jsonPath` extraction for MQTT subscriptions blocks traversal through `__proto__`, `constructor`, and `prototype` keys to prevent prototype pollution.
