# LemmaLab

Pressure-drop analysis for flow systems from CAD, with an engineering assistant.

## Setup

```bash
git clone <repo-url> lemmalab && cd lemmalab
cp .env.example .env
make up
cd desktop && npm i && npm run dev
```

`make up` starts the backend (`lemma-core`, port 8000) and Postgres (`lemma-postgres`, port 5433).
To check it: `curl localhost:8000/health` should return `{"status":"ok","db":"ok"}`.

## Layout

| Path | What |
| --- | --- |
| `backend/` | FastAPI service (Python 3.12, uv, SQLAlchemy, Alembic) |
| `desktop/` | Electron + React app ([desktop/README.md](desktop/README.md)) |
| `data/constants/` | Versioned K-values and fluid properties |
| `evals/golden/` | Golden cases, used in CI only and never shipped |
| `docs/decisions/` | Architecture decision records |
| `docs/screenshots/` | Screenshots for phase reviews |

## Make targets

| Target | What |
| --- | --- |
| `make up` / `down` / `logs` | Start (runs migrations), stop, follow logs |
| `make test` | All backend tests in the container: API, WebSocket, golden parser, type drift |
| `make test-golden` | Golden parser tests only, with the results table |
| `make golden` | Regenerate the synthetic golden STEP files and `.expected.json` |
| `make types` | Regenerate desktop TypeScript types from the Pydantic schema |
| `make lint` / `format` | Ruff + desktop ESLint and color check / auto-fix |
| `make migrate` | Apply Alembic migrations |

## Golden CAD tests

`evals/golden/` holds synthetic STEP files built with CadQuery (`generate.py`), each with an
`NN_name.expected.json` component graph. Real customer files go in `evals/golden/real/` with
their own expected JSON, and are picked up automatically. The golden files are used in CI only
and are never shipped.

```bash
make test-golden   # prints: file | expected | found | max length err % | parse s | result
make golden        # rebuild the synthetic files after editing generate.py
```

The table is also written to `evals/golden/RESULTS.md`. Regenerated `.step` files always
differ, because the STEP header has a timestamp, so commit them only when the geometry changes.

## Desktop review scripts

With the backend up, from `desktop/`:

```bash
npm run build && npm run phase1   # uploads every golden file through the UI, takes the
                                  # phase 1 screenshots, audits console + CSP (prod)
npm run phase1:dev -- --no-shots  # same audit against the dev server
```

These scripts create projects named `Test · ...` in the dev database.
