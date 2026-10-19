# Golden cases

Reference problems with known answers that check the solver, parser and agent end to end.
Each case is a folder with the input (CAD file or component list + fluid + flow), the expected
`SolveResult` and the tolerance, and the citation for the expected answer.

- **CI only, never shipped.** This folder is not in the Docker image (the build context is
  `backend/`) and must never be packaged with the desktop app.
- An expected value changes only with a cited reason, in a PR of its own.
- When `data/constants` versions change, re-run the goldens and note any drift in the PR.
