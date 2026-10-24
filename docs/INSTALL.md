# Installing LemmaLab for development

This guide takes you from a fresh machine to the LemmaLab desktop app running against a local
backend. Expect about 15 minutes, most of it the first Docker build.

LemmaLab has two parts:

- **Backend** (`lemma-core`): a FastAPI service plus the STEP parser (CadQuery/OCP). It always
  runs in Docker, with **Postgres 16** (`lemma-postgres`) next to it. You don't need Python or CAD
  libraries on your machine.
- **Desktop app**: Electron + React, run with Node on your machine.

> Tested on macOS (Apple silicon and Intel). Linux should work the same way. On Windows, use
> WSL2 for the `make` commands (see [Windows](#windows)).

---

## 1. Prerequisites

| Tool | Version | Check | Notes |
| --- | --- | --- | --- |
| Git | any recent | `git --version` | |
| Docker Desktop (or Docker Engine + Compose v2) | Compose v2+ | `docker compose version` | Give Docker at least **4 GB RAM** and about **10 GB of disk**. The image includes the CAD stack. |
| GNU Make | 3.81+ | `make --version` | Preinstalled on macOS and most Linux. |
| Node.js | **22.18 or newer** (LTS 22 or 24 recommended) | `node --version` | Electron 44 needs 22.12 or newer. The review scripts run `.ts` files directly, which needs 22.18 or newer. |
| npm | ships with Node | `npm --version` | |

Not needed: Python, uv, Postgres, or CadQuery on your machine. They all live in the backend image.
(Install [uv](https://docs.astral.sh/uv/) only if you want to run backend tools outside Docker.)

**macOS quick install** with [Homebrew](https://brew.sh):

```bash
brew install git node
brew install --cask docker
```

Then **open Docker Desktop once** and wait for "Engine running" before continuing.

---

## 2. Get the code

```bash
git clone https://github.com/aran-yogesh/aerospace-ai-project.git lemmalab
cd lemmalab
```

---

## 3. Configure the environment

```bash
cp .env.example .env
```

The defaults work for local development. `make` also creates `.env` for you if it's missing.
The values:

| Variable | Default | What it's for |
| --- | --- | --- |
| `APP_ENV` | `local` | `local`, `test`, `staging` or `production`. Outside production, CORS accepts any `localhost` port. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `lemma` / `change-me` / `lemma` | Credentials for the local Postgres container. |
| `DATABASE_URL` | `...@localhost:5433/lemma` | Only used when you run backend tools **outside** Docker. Inside Docker it's built from the `POSTGRES_*` values. |
| `LLM_PROVIDER` / `LLM_API_KEY` | `none` / empty | Not used yet. Leave them as they are. |

Never commit `.env`. It is in `.gitignore`.

---

## 4. Start the backend

```bash
make up
```

This builds the `lemma-core` image, starts Postgres, runs the database migrations and waits
until both services are healthy.

- **The first build takes 5 to 10 minutes**, because it downloads CadQuery/OCP wheels. Later runs
  use the cache and take seconds.
- Ports used: **8000** (API) and **5433** (Postgres on your host, so it won't clash with a local
  Postgres on 5432).

Check that it works:

```bash
curl localhost:8000/health
```

You should get `{"status":"ok","db":"ok"}`. Interactive API docs are at
<http://localhost:8000/docs>.

---

## 5. Run the desktop app

In a second terminal:

```bash
cd desktop
npm install
npm run dev
```

- npm 11 may print `npm warn install-scripts ... fsevents`. That's safe to ignore: nothing
  in the project needs that script.
- **The first `npm run dev` prints `Downloading Electron binary...`** and fetches about 100 MB
  once. Later starts are instant.

The LemmaLab window opens. The status bar at the bottom should say **BACKEND CONNECTED**.

Try it end to end:

1. Click **NEW PROJECT** and give it a name.
2. Drag `evals/golden/07_feed_line.step` into the viewer, or click **BROWSE** and pick it.
3. After about a second you should see the model, **6 components** in the left pane and
   `PARSED · 6 COMPONENTS` in the status bar. Click a component to select it.

Make sure the backend is still running (`make up`) whenever you use the app. If you stop it,
the status bar switches to **BACKEND OFFLINE** within about 5 seconds.

---

## 6. Run the tests and checks

From the repo root:

```bash
make test          # all backend tests inside Docker (API, WebSocket, golden parser, type drift)
make test-golden   # golden CAD tests only, with a results table
make lint          # ruff (backend) + ESLint and color check (desktop)
```

From `desktop/`:

```bash
npm run typecheck
npm run build      # typecheck, then build the production app into out/
```

Optional end-to-end UI check. It uploads every golden file through the real app and takes the
review screenshots:

```bash
make e2e
```

This starts a separate backend on port 18001 (`E2E_PORT` to change it) with its own fresh
`lemma_e2e` database, runs the Playwright flow, then drops the database. Your dev data is never
touched. `make test` likewise uses a throwaway `lemma_test` database. If old `Test · ...`
projects show up in the app, remove them with `make clean-dev-data`.

---

## Everyday commands

| Command | What it does |
| --- | --- |
| `make up` | Rebuild if needed, start everything, migrate, wait until healthy |
| `make down` | Stop the containers. **Your data is kept.** |
| `make logs` | Follow the backend and Postgres logs |
| `make ps` | Show container status |
| `make migrate` | Apply database migrations by hand (`make up` already does this) |
| `make types` | Regenerate desktop TypeScript types after changing `backend/app/schema/` |
| `make golden` | Regenerate the synthetic golden STEP files after editing `evals/golden/generate.py` |
| `make format` | Auto-fix backend lint and formatting |
| `make help` | List all targets |

Backend code is mounted into the container and reloads automatically when you save. The
desktop app hot-reloads the UI. Changes to `src/main` or `src/preload` restart Electron.

### After pulling new changes

```bash
make up                    # rebuilds the image if backend dependencies changed, and runs new migrations
cd desktop && npm install  # if package.json changed
```

---

## Troubleshooting

**`Cannot connect to the Docker daemon`**
Docker Desktop isn't running. Open it (`open -a Docker` on macOS), wait for "Engine running",
then run `make up` again.

**`make up` fails while building, or the build is very slow**
Make sure Docker has at least 4 GB RAM and enough disk (Docker Desktop → Settings → Resources).
To retry from a clean cache: `docker compose build --no-cache lemma-core`.

**Port already in use (8000, 5433 or 5173)**
Something else is using it. Find it with `lsof -nP -iTCP:5433 -sTCP:LISTEN`.

- For Postgres, set `POSTGRES_HOST_PORT=5434` in `.env` (and use the same port in
  `DATABASE_URL`), then run `make up`.
- If Vite finds 5173 busy, it moves to 5174 on its own, and the backend accepts any localhost
  port in local mode.

**The status bar says BACKEND OFFLINE**
Check that `curl localhost:8000/health` returns `"db":"ok"`. If it returns `"db":"down"`,
Postgres isn't healthy: run `make ps` and `make logs`.

**Migration error like `relation "projects" already exists`**
Your local database has tables from an older checkout. If you don't need the local data, reset
it. **This deletes all local projects and uploads:**

```bash
docker compose down -v
make up
```

**`Electron failed to install correctly`, or the Electron binary is missing**
The first-run download was interrupted (network or proxy). Inside `desktop/`, run
`rm -rf node_modules/electron && npm install`, then start `npm run dev` again so it downloads
again. Behind a proxy, set `ELECTRON_MIRROR` or `HTTPS_PROXY` first.

**`npm install` warns about the Node version, or `npm run phase1` fails with a syntax error on a `.ts` file**
Your Node is too old. Upgrade to 22.18 or newer (`node --version`).

**An upload fails with `parser_unavailable` or `timeout`**
Look at `make logs`. The parser runs in a separate process with a 60 s timeout and a memory cap.
Very large assemblies may need more memory for Docker.

---

## Windows

The `make` targets need a Unix shell. Use **WSL2** (Ubuntu) with Docker Desktop's WSL2 backend
enabled:

1. Clone the repo inside WSL (for example `~/lemmalab`), then run steps 3 and 4 from the WSL shell.
2. Run the desktop app (step 5) from WSL with WSLg, or from Windows with Node installed there.
   It reaches the backend at `http://localhost:8000` either way.

Native Windows without WSL isn't supported yet.

---

## Where things live

| Path | What |
| --- | --- |
| `backend/` | FastAPI service, parser (`app/cad_parser`), schema, migrations, tests |
| `desktop/` | Electron + React app ([desktop/README.md](../desktop/README.md)) |
| `evals/golden/` | Golden STEP files and their expected results (CI only, never shipped) |
| `data/constants/` | Versioned engineering constants |
| `docs/decisions/` | Architecture decision records (start with 0001) |

Uploaded files are stored in the `lemma-uploads` Docker volume and the database in
`lemma-pgdata`. Neither lives in the repo.
