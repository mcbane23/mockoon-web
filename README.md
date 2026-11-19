# Maketa

Maketa is a web interface for building and running mock APIs. You create an environment, add
routes and responses, press Start, and the mock API answers on its own port. Everything is done
from a browser, so Maketa can run on one machine in your local network and be used from any other.

Environments are stored as plain JSON files in the [Mockoon](https://mockoon.com) data format.
Maketa runs them with Mockoon's open-source engine (`@mockoon/commons` and
`@mockoon/commons-server`, MIT licence), so a file made in the Mockoon desktop application opens
in Maketa and a file saved by Maketa opens in Mockoon.

Maketa is an independent project. It is not affiliated with, endorsed by or supported by the
Mockoon team.

## Requirements

- Node.js 22 or newer
- [pnpm](https://pnpm.io) 10

## Running

```sh
pnpm install
pnpm build
pnpm start
```

On start the server prints the addresses of the interface (one for each network address of the
machine, for example `http://192.168.1.10:4400`), the data directory and, on the very first start,
a generated password:

```
UI: http://192.168.1.10:4400
Data directory: /home/me/maketa/data
Generated password: k3J9wQx7LmP2aZ8d
The password is stored in /home/me/maketa/data/auth.json
```

Open the address in a browser on any machine in the network and log in with that password.

### Development

```sh
pnpm dev
```

starts the server on port 4400 (bound to `127.0.0.1`, without a password) and the Vite dev server
on <http://localhost:5173>.

| Command       | What it does                                                |
| ------------- | ----------------------------------------------------------- |
| `pnpm check`  | Formatting, lint, type check and unit tests of all packages |
| `pnpm test`   | Unit tests (server and web)                                 |
| `pnpm e2e`    | End-to-end tests in Chromium (run `pnpm build` first)       |
| `pnpm format` | Format the code with Prettier                               |

The end-to-end tests need a browser once: `pnpm --filter @maketa/e2e exec playwright install chromium`.

## Configuration

All variables are optional.

| Variable               | Default   | Meaning                                                                                                                                                                           |
| ---------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAKETA_PORT`          | `4400`    | Port of the interface and its API.                                                                                                                                                |
| `MAKETA_HOST`          | `0.0.0.0` | Address the interface listens on. The default is every network address, which makes it reachable in the local network. `127.0.0.1` limits it to the machine itself.               |
| `MAKETA_DATA_DIR`      | `./data`  | Where `settings.json`, `auth.json` and the environments created by Maketa are stored. Relative to the working directory.                                                          |
| `MAKETA_PASSWORD`      | empty     | Password of the interface. Wins over the password in `auth.json`.                                                                                                                 |
| `MAKETA_AUTH`          | `on`      | `off` turns the password off completely. **Then anyone who can reach the port can edit environments and write JSON files on the server.** Any other value is an error at start.   |
| `MAKETA_ALLOWED_HOSTS` | empty     | Extra host names (comma separated) through which the interface may be opened when no password is required. Only needed for a DNS name that is not the name of the machine itself. |

### Password

With `MAKETA_AUTH=on` (the default) a password is required whenever the interface is reachable
from other machines, because the API can write files on the server. The password comes from, in
this order:

1. `MAKETA_PASSWORD`, when set;
2. the `password` field of `data/auth.json`;
3. when neither exists, a random password that is generated on the first start, written to
   `data/auth.json` and printed to the console.

You can edit `data/auth.json` by hand; the change applies after a restart and logs out every
device. The login does not expire.

No password is asked when `MAKETA_HOST` is a loopback address (`127.0.0.1`, `::1`, `localhost`) and
`MAKETA_PASSWORD` is not set.

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

- **Open** takes an absolute path **on the machine where Maketa runs**. The file is edited in
  place, which is convenient when the same file is also used by Mockoon or kept in a repository.
- **Import** uploads a file from the computer where the browser is (button or drag and drop onto
  the list of environments) and stores a copy in `data/environments/`.
- **Export** in the menu of an environment downloads its JSON file.

Files of older Mockoon versions are migrated to the current format when they are opened. Fields
that Maketa does not edit are written back exactly as they were.

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
- Running environments are started again after a restart of Maketa

Works when the environment runs, but is not editable in Maketa (edit it in the Mockoon desktop
application; Maketa keeps it intact):

- Proxy mode and proxy headers
- TLS options
- Data buckets and callbacks (existing ones can be selected and are executed)
- CRUD and WebSocket routes (only their common fields are editable)

Not supported: Mockoon Cloud features, OpenAPI import and export, recording of proxied requests,
environment variables and global variables management, the admin API of the engine (it is
switched off).

## Security

Maketa is made for a local network you trust.

- By default the interface listens on every network address and is protected by a password.
- With `MAKETA_AUTH=off`, anyone who can reach the port can change environments and write JSON
  files on the disk of the server with the rights of the account Maketa runs under. The server
  prints a warning about this on every start.
- The login does not expire. Whoever gets the session cookie (for example by listening to HTTP
  traffic in the network) has access until the password is changed. Changing the password in
  `auth.json` and restarting logs out every device.
- The connection is plain HTTP: the password, the session cookie and all content travel
  unencrypted. Do not expose Maketa to the internet. If you ever need that, put a reverse proxy
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
pm2 start apps/server/dist/index.js --name maketa
pm2 save
```

**systemd (Linux)**, in `/etc/systemd/system/maketa.service`:

```ini
[Unit]
Description=Maketa
After=network.target

[Service]
User=maketa
WorkingDirectory=/opt/maketa
ExecStart=/usr/bin/node apps/server/dist/index.js
Environment=MAKETA_DATA_DIR=/var/lib/maketa
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now maketa
journalctl -u maketa   # the generated password is printed here on the first start
```

**Windows**: with [NSSM](https://nssm.cc)

```bat
nssm install Maketa "C:\Program Files\nodejs\node.exe" apps\server\dist\index.js
nssm set Maketa AppDirectory C:\maketa
nssm start Maketa
```

or with Task Scheduler: create a task that runs "At startup" with the program
`C:\Program Files\nodejs\node.exe`, the argument `apps\server\dist\index.js` and "Start in" set
to the Maketa folder.

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
