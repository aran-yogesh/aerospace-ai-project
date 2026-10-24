# 0006: Dataset confirm: what is frozen and what is free

Status: accepted (Phase 2)

## Context

A pressure-drop number is only useful if anyone can later say exactly what produced it.
Inputs come from four places: the parsed geometry, the user's setup (fluid, state point,
material, K overrides), versioned constants (K table, materials, fluid tables) and the
solver code. Any of them can change after a result was produced.

## Decision

Solving is split into two steps.

1. **Confirm** (`POST /files/{id}/datasets`) freezes everything that determines the answer
   except the operating point, into an immutable `datasets` row:
   - `graph_hash`: sha256 of the stored system graph,
   - `setup`: a copy of the setup (fluid, T, P, material, K overrides),
   - `resolved_k`: one row per path component with K, reference diameter, method, source,
     match (exact | family | computed | user | missing) and verification status,
   - `segments`: the solver input built from those rows,
   - `fluid_props` and `roughness`, each value with its unit and source,
   - `constants_versions` (k_values, materials, fluids) and `solver_version`,
   - `content_hash`: sha256 of canonical JSON of all of the above (sorted keys, no
     whitespace, floats written with repr). Identical inputs give the same hash.

   Confirm refuses with 409 `unresolved` (and the component ids) while any K is missing,
   409 `network_topology` for anything but a single line, and 422 `setup_invalid` when the
   fluid properties cannot be computed. There is no silent default for a missing K: the
   user enters one or explicitly marks the part "no loss" (K = 0, source "user: no loss").

2. **Solve** (`POST /datasets/{id}/solve`, `{mode, value}`) is free: any number of runs, at
   any flow (mode `dp`) or pressure drop (mode `flow`), against the same dataset. Each run
   stores its input, result, status and runtime. The same dataset and input always give the
   same result, because the solver is a pure function of the frozen data.

## Immutability and staleness

- Datasets are never updated. There is no update endpoint or repository function, and a
  SQLAlchemy `before_update` listener on `Dataset` raises if anything tries.
- Changing the setup after a confirm never touches the dataset. Instead the dataset becomes
  **stale** when its setup snapshot or graph hash differs from the file's current ones, or a
  newer dataset exists for the file. The UI shows "SETUP CHANGED · RECONFIRM", and solving
  a stale dataset returns 409 `dataset_stale`. Reverting the setup to the confirmed values
  makes the latest dataset current again; nothing is lost either way.
- Old datasets and runs stay readable, so a past number can always be traced.

## Why

- Traceability: every number points at a dataset hash, and the hash covers every input.
- Cheap iteration: sweeping flow or pressure drop is the common loop, and it should not
  require re-reviewing K values each time.
- Review once: confirming is the moment the user looks at approximate (family/unverified)
  and user-entered K values; it should happen when those change, not on every solve.

## Not covered

- Constants changing on disk after a confirm do not make a dataset stale (the dataset keeps
  the values it froze, with their versions). Reconfirm to pick up new constants.
- Deduplicating identical confirms: a second identical confirm creates a new row with the
  same `content_hash`.
