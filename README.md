# Mockpit

Mockpit is a web interface for building and running mock APIs. You create an environment, add
routes and responses, press Start, and the mock API answers on its own port. Everything is done
from a browser, so Mockpit can run on one machine in your local network and be used from any other.

Environments are stored as plain JSON files in the [Mockoon](https://mockoon.com) data format.
Mockpit runs them with Mockoon's open-source engine (`@mockoon/commons` and
`@mockoon/commons-server`, MIT licence), so a file made in the Mockoon desktop application opens
in Mockpit and a file saved by Mockpit opens in Mockoon.

Mockpit is an independent project. It is not affiliated with, endorsed by or supported by the
Mockoon team. "Mockoon" is a registered trademark of its owner and is used here only to describe
compatibility. Licences of the bundled software are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Requirements

- Node.js 22 or newer
- [pnpm](https://pnpm.io) 10

or only Docker, see [Docker](#docker).

## Running

```sh
pnpm install
pnpm build
pnpm start
```

On start the server prints the addresses of the interface (one for each network address of the
machine, for example `http://192.168.1.10:3300`), the data directory and, on the very first start,
a generated password:

```
UI: http://192.168.1.10:3300
Data directory: /home/me/mockpit/data
Generated password: k3J9wQx7LmP2aZ8d
The password is stored in /home/me/mockpit/data/auth.json
```

Open the address in a browser on any machine in the network and log in with that password.

### Docker

An image is published to the GitHub Container Registry on every merge to `main`
(`ghcr.io/mcbane23/mockoon-web:latest`) and for every `v*` tag (for example `:1.2.0`), for
`linux/amd64` and `linux/arm64`.

The easiest way is the [`docker-compose.yml`](docker-compose.yml) in this repository:

```sh
curl -O https://raw.githubusercontent.com/mcbane23/mockoon-web/main/docker-compose.yml
docker compose up -d
docker compose logs mockpit   # the generated password is printed on the first start
```

Then open `http://<address of the machine>:3300`. The address printed in the logs is the address
inside the container; use the address of the machine running Docker instead. Update with
`docker compose pull && docker compose up -d`.

Or with `docker run`:

```sh
docker run -d --name mockpit -p 3300:3300 -p 3001-3020:3001-3020 \
  -v mockpit-data:/data ghcr.io/mcbane23/mockoon-web:latest
```

Things to know:

- All data (`settings.json`, `auth.json`, environments) is in `/data`, kept in the `mockpit-data`
  volume. To keep it in a folder on the host, mount that folder on `/data` instead; it must be
  writable by uid 1000 (the `node` user the container runs as).
- Mock APIs are only reachable on the ports that are published. The compose file publishes
  3001–3020, the ports new environments get; change the range if your environments use others.
- The configuration variables below work as environment variables of the container.
  `MOCKPIT_HOST`, `MOCKPIT_PORT` and `MOCKPIT_DATA_DIR` are already set and rarely need changing.
- **Open** takes a path inside the container, so it only sees files under `/data` or in folders
  you mount. **Import** uploads from the browser and needs nothing extra.

To build the image yourself: `docker build -t mockpit .`

### Development

```sh
pnpm dev
```

starts the server on port 3300 (bound to `127.0.0.1`, without a password) and the Vite dev server
on <http://localhost:5173>.

| Command       | What it does                                                |
| ------------- | ----------------------------------------------------------- |
| `pnpm check`  | Formatting, lint, type check and unit tests of all packages |
| `pnpm test`   | Unit tests (server and web)                                 |
| `pnpm e2e`    | End-to-end tests in Chromium (run `pnpm build` first)       |
| `pnpm format` | Format the code with Prettier                               |

The end-to-end tests need a browser once: `pnpm --filter @mockpit/e2e exec playwright install chromium`.

## Configuration

All variables are optional. The application was called Maketa before, so the former `MAKETA_*`
names still work when the `MOCKPIT_*` one is not set.

If the start fails with `EACCES: permission denied` on the port, the operating system has reserved
that port (on Windows, Hyper-V, WSL and Docker Desktop reserve port ranges; list them with
`netsh interface ipv4 show excludedportrange protocol=tcp`). Pick another port with `MOCKPIT_PORT`,
for example `$env:MOCKPIT_PORT=8480; pnpm start` in PowerShell or `MOCKPIT_PORT=8480 pnpm start` in a
Unix shell.

| Variable                | Default   | Meaning                                                                                                                                                                           |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MOCKPIT_PORT`          | `3300`    | Port of the interface and its API.                                                                                                                                                |
| `MOCKPIT_HOST`          | `0.0.0.0` | Address the interface listens on. The default is every network address, which makes it reachable in the local network. `127.0.0.1` limits it to the machine itself.               |
| `MOCKPIT_DATA_DIR`      | `./data`  | Where `settings.json`, `auth.json` and the environments created by Mockpit are stored. Relative to the working directory.                                                         |
| `MOCKPIT_PASSWORD`      | empty     | Password of the interface. Wins over the password in `auth.json`.                                                                                                                 |
| `MOCKPIT_AUTH`          | `on`      | `off` turns the password off completely. **Then anyone who can reach the port can edit environments and write JSON files on the server.** Any other value is an error at start.   |
| `MOCKPIT_ALLOWED_HOSTS` | empty     | Extra host names (comma separated) through which the interface may be opened when no password is required. Only needed for a DNS name that is not the name of the machine itself. |

### Password

With `MOCKPIT_AUTH=on` (the default) a password is required whenever the interface is reachable
from other machines, because the API can write files on the server. The password comes from, in
this order:

1. `MOCKPIT_PASSWORD`, when set;
2. the `password` field of `data/auth.json`;
3. when neither exists, a random password that is generated on the first start, written to
   `data/auth.json` and printed to the console.

You can edit `data/auth.json` by hand; the change applies after a restart and logs out every
device. The login does not expire.

No password is asked when `MOCKPIT_HOST` is a loopback address (`127.0.0.1`, `::1`, `localhost`) and
`MOCKPIT_PASSWORD` is not set.

## Where the data is

```
data/
├─ settings.json      list of environments, interface state, application settings
├─ auth.json          password and session secret (mode 0600)
└─ environments/
   └─ <name>-<first 8 characters of the uuid>.json
```

New, imported and duplicated environments are stored in `data/environments/`. An environment
opened from another location stays in its own file and is saved there.

Files are watched: when an environment file is changed by another program (a text editor, `git
pull`, the Mockoon desktop application), the interface shows the new content without a reload and
a running mock picks it up.

## Using an existing Mockoon file

- **Open** takes an absolute path **on the machine where Mockpit runs**. The file is edited in
  place, which is convenient when the same file is also used by Mockoon or kept in a repository.
- **Import** uploads a file from the computer where the browser is (button or drag and drop onto
  the list of environments) and stores a copy in `data/environments/`.
- **Export** in the menu of an environment downloads its JSON file.

Files of older Mockoon versions are migrated to the current format when they are opened. Fields
that Mockpit does not edit are written back exactly as they were.

## Features

Supported:

- Environments: create, open, import, export, duplicate, close, reorder; name, port, hostname, API
  prefix, latency, CORS and environment headers
- Start, stop and restart; changes of routes and responses apply to the next request without a
  restart; a change of port or hostname restarts the environment automatically
- HTTP routes and folders with drag and drop, duplicate, enable and disable, filter
- Several responses for a route, with response modes (rules, random, sequential, default only,
  fallback)
- Response status, headers, latency and body (inline with a JSON, XML or HTML editor, file, or
  data bucket), with Mockoon templating
- Response rules with every target and operator, AND/OR and invert
- Live request logs with request and response details
- Running environments are started again after a restart of Mockpit

Works when the environment runs, but is not editable in Mockpit (edit it in the Mockoon desktop
application; Mockpit keeps it intact):

- Proxy mode and proxy headers
- TLS options
- Data buckets and callbacks (existing ones can be selected and are executed)
- CRUD and WebSocket routes (only their common fields are editable)

Not supported: Mockoon Cloud features, OpenAPI import and export, recording of proxied requests,
environment variables and global variables management, the admin API of the engine (it is
switched off).

## Security

Mockpit is made for a local network you trust.

- By default the interface listens on every network address and is protected by a password.
- With `MOCKPIT_AUTH=off`, anyone who can reach the port can change environments and write JSON
  files on the disk of the server with the rights of the account Mockpit runs under. The server
  prints a warning about this on every start.
- The login does not expire. Whoever gets the session cookie (for example by listening to HTTP
  traffic in the network) has access until the password is changed. Changing the password in
  `auth.json` and restarting logs out every device.
- The connection is plain HTTP: the password, the session cookie and all content travel
  unencrypted. Do not expose Mockpit to the internet. If you ever need that, put a reverse proxy
  with HTTPS or an SSH tunnel in front of it.
- The API can write JSON files at any absolute path (Open) and read the files that responses use
  as their body. Run the process under a normal user account, not as root or administrator.
- Without a password, the `Host` and `Origin` headers are checked so that a malicious web page in
  your browser cannot send requests to the API.
- Mock APIs listen on every interface unless a hostname is set, the same as in Mockoon, so they
  are reachable in the local network. Set the hostname of an environment to `127.0.0.1` to limit
  it to the server machine.

## Running in the background

Build first (`pnpm install && pnpm build`), then use whichever tool you prefer.

**pm2**

```sh
pm2 start apps/server/dist/index.js --name mockpit
pm2 save
```

**systemd (Linux)**, in `/etc/systemd/system/mockpit.service`:

```ini
[Unit]
Description=Mockpit
After=network.target

[Service]
User=mockpit
WorkingDirectory=/opt/mockpit
ExecStart=/usr/bin/node apps/server/dist/index.js
Environment=MOCKPIT_DATA_DIR=/var/lib/mockpit
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now mockpit
journalctl -u mockpit   # the generated password is printed here on the first start
```

**Windows**: with [NSSM](https://nssm.cc)

```bat
nssm install Mockpit "C:\Program Files\nodejs\node.exe" apps\server\dist\index.js
nssm set Mockpit AppDirectory C:\mockpit
nssm start Mockpit
```

or with Task Scheduler: create a task that runs "At startup" with the program
`C:\Program Files\nodejs\node.exe`, the argument `apps\server\dist\index.js` and "Start in" set
to the Mockpit folder.

## Project layout

```
packages/shared   types shared by the server and the web interface
apps/server       Fastify server: storage, engine runtime, API, events, authentication
apps/web          React interface (Vite)
e2e               Playwright end-to-end tests
```

## Licence

MIT, see [LICENSE](LICENSE). Licences of the bundled third-party software are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
