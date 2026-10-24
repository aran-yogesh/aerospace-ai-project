# solver

Pressure-drop solver (app.solver). Pure functions over app.schema.solve models: no DB, API, LLM
or constants loader; every input (fluid props, roughness, resolved K) arrives as an argument.
See docs/decisions/0005-solver.md.
