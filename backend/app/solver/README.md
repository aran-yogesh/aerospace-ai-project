# solver

The pressure-drop solver goes here. It takes `FlowPath` + `Component`s + `Fluid` from
`app.schema` and returns a `SolveResult`.

Rules: pure functions with no I/O, K-values only from `app.constants` (each one carries its
`source` and `match`), and every result records `constants_version`. Golden cases are in
`evals/golden/` at the repo root.
