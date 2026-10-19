# harness

The agent loop goes here: takes a chat turn, calls the LLM through `app.llm`, invokes tools
(parser, solver, constants lookups), and streams events over `/ws/session/{id}`.

Rules: stateless between requests (load and save everything through `app.db`), and never
compute physics inline. The agent calls the solver.
