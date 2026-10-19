# 0001. System architecture

- Status: accepted
- Date: 2026-10-18

## Context

LemmaLab parses CAD models of flow systems, solves pressure drop, and explains the results
through a chat agent. We need one source of truth for physics and constants, a desktop UI,
and room to iterate on the agent without shipping client updates.

## Decision

1. **Monorepo.** `desktop/`, `backend/`, `data/`, `evals/` and `docs/` live in one repository
   so schema, constants and goldens change together with the code.
2. **Python FastAPI backend** (`lemma-core`). Python is where the CAD (CadQuery/OCP) and
   numerics stacks are. FastAPI with Pydantic v2 gives typed contracts we can share with the client.
3. **Postgres** for all state. The backend is stateless, so any instance can serve any
   request. Every table has `user_id`.
4. **Thin Electron client.** Only UI, theming and the 3D viewer. No physics, constants or
   parsing on the client. It talks to the backend over HTTP and the `/ws/session/{id}` socket.
5. **Server-side solver, parser and constants.** One versioned copy of the K-values and fluid
   data (`data/`), and every result records which version produced it.

## Consequences

- Results are reproducible and auditable from the server side alone.
- The client needs a network connection to compute anything. Offline mode would need a new decision.
- The Docker image is large because of the CAD stack. We accept that and cache the dependency layer.
- An LLM provider can be swapped with an env var (`LLM_PROVIDER`) behind `app.llm`.
