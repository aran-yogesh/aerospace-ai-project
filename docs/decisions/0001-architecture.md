# 0001. Architecture

- Status: accepted
- Date: 2026-10-18

## Context

LemmaLab parses CAD models of flow systems, solves pressure drop, and explains the results
through a chat agent. We need one source of truth for physics and constants, a desktop UI,
and room to change the agent without shipping client updates.

## Decision

1. **Monorepo with plain folders** (`backend/`, `desktop/`, `data/`, `evals/`, `docs/`), and no
   workspace tooling. Schema, constants and golden cases change in the same PR as the code.
2. **FastAPI + Postgres in Docker.** Python is where the CAD (CadQuery/OCP) and numerics stacks
   are. `docker compose` runs `lemma-core` and `lemma-postgres` the same way on every machine.
   The backend is stateless and keeps all state in Postgres, and every table has `user_id`.
3. **Thin Electron client.** It handles UI, theming and the viewer. It talks to the backend
   over HTTP and `/ws`, and has no business logic of its own.
4. **Solver, parser and constants run server-side only.** There is one versioned copy of the
   K-values and fluid data (`data/constants/`), and every result records which version
   produced it.

## Consequences

- Results are reproducible and auditable from the server alone.
- The client computes nothing without the backend. Offline mode would need a new decision.
- The backend image is large because of the CAD stack, so the dependency layer is cached.
