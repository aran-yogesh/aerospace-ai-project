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

`make up`, `down`, `logs`, `test` (pytest in the container), `lint` (ruff + desktop ESLint),
`migrate` (Alembic), `format`.
