# 0003. 3D viewer

- Status: accepted
- Date: 2026-10-18

## Context

Phase 1 shows the parsed STEP assembly in 3D. The backend tessellates with ocp-tessellate
into the three-cad-viewer "Shapes" format (root `/system`, one leaf per component,
`/system/comp_N`, geometry as inline base64 buffers, coordinates in meters). The spec
asked for three-cad-viewer behind our own interface, provided its license is permissive.
The viewer also has to:

- look like the rest of the app: matte grayscale, crisp edges, a transparent background
  over the `.halftone` texture, colors from theme tokens, and live theme switching
- show none of the library's UI chrome (tree, toolbar, info panel)
- run under the production CSP: `style-src 'self' 'nonce-…'`, `script-src 'self'`, with no
  `unsafe-inline` or `unsafe-eval`

## Evaluation of three-cad-viewer

| | |
| --- | --- |
| Library | `three-cad-viewer` 5.1.3 (npm) |
| License | **MIT** (`node_modules/three-cad-viewer/LICENSE`, Copyright 2021 Bernhard Walter) |
| Depends on | `three` 0.184.0 (pinned), `n8ao` 1.10.1, `postprocessing` 6.39.0 |

The license is permissive, so it was allowed. We installed it and read the 5.1.3 build. We
did not use it, for these reasons:

1. **CSP.** `Viewer` can only be built from a `Display`. `Display` writes its whole UI as
   an HTML template through `innerHTML`, and that template has inline `style="…"`
   attributes (`style="flex: 1"`, `style="width: 100%"`, …). The tree view also writes
   `<span style="color:…">` through `innerHTML`. Our production policy has no
   `'unsafe-inline'`, so each of these attributes is a CSP violation (the Phase 0 audit
   requires zero). Allowing them would mean adding `'unsafe-inline'` to `style-src`, which
   also cancels the nonce. We rejected that.
2. **Chrome.** The tree, toolbar, tabs, info panel and the 122 KB stylesheet would have to be
   hidden with CSS overrides against private class names that change between releases.
3. **Look.** Its materials, highlighting and studio and post-processing pipeline
   (`n8ao`, `postprocessing`) are built for a different look. To get our token-driven
   matte and edge look, we would have to drive its internals.
4. **Weight.** The ESM build is 3.6 MB and bundles its own copy of three.js r184.

The spec allows falling back to plain three.js when the library fights the look, the
chrome or the CSP. It fights all three.

## Decision

**We build the viewer on plain three.js and keep three-cad-viewer's data format.**
`three-cad-viewer` is not a dependency. The backend still emits its Shapes format, so we
can switch back to the library behind the same wrapper if its CSP issues are fixed upstream.

| Package | Version | License | Use |
| --- | --- | --- | --- |
| `three` | ~0.184.0 | MIT | WebGL renderer, `OrbitControls`, `LineSegments2` / `LineMaterial` (addons) |
| `@types/three` | ~0.184.1 | MIT | types (dev) |
| `@tanstack/react-query` | ^5.104.4 | MIT | server state (projects, files, graph, mesh) |

### Module layout (`desktop/src/renderer/src/viewer/`)

The rest of the app imports only from `@/viewer` (`index.ts`):

- `shapes.ts` decodes the Shapes tree: flat or nested arrays, inline `{buffer, dtype}` b64
  buffers, the `{instances, shapes}` wrapper with `{ref}` parts, and `loc` transforms. Leaves
  are grouped by component id, which is the first path segment below the root.
- `theme.ts` reads the `--viewer-*` tokens with `getComputedStyle` on a probe element that
  carries `data-theme`.
- `CadViewer.ts` contains the renderer, the camera, picking, styling and the section view.
- `Viewer3D.tsx` is the React host. It contains the canvas, our toolbar (FIT, ISO, TOP,
  FRONT, SECTION) and the selection callout with its leader line.

### Wrapper interface (`CadViewerApi`)

```ts
load(shapes: MeshShapes): void
highlight(id: string | null): void      // hover look, visual only
select(id: string | null): void         // selected look, visual only
clearSelection(): void
fitTo(id?: string): void                // one component, or the whole model
setTheme(mode: 'light' | 'dark'): void  // re-reads the tokens
colorBy(map: Record<string, string> | null): void   // Phase 2 stub (stored, not drawn)
onSelect(cb: (id: string | null) => void): () => void  // canvas pick; null = empty space
onHover(cb: (id: string | null) => void): () => void
```

Ids are component ids (`comp_7`). `highlight` and `select` do not fire the callbacks, so
`WorkspaceContext` (`selectedId`, `hoveredId`) can push its state into the viewer without
loops. `Viewer3D` also uses three members that are not part of the API: `setView(iso|top|front)`,
`setSection(on)` and `onFrame(cb)`, which reports the selected component's screen anchor
after every rendered frame.

### Look

- **Camera and fit.** The camera is orthographic and Z-up. `OrbitControls` runs without
  damping and with zoom to cursor. Fit frames the vertices' actual on-screen extent, not a
  bounding sphere. A single component is framed with extra room for its callout. Near and
  far scale with the model, which is about 0.3 m across, in meters.
- **Faces.** `MeshLambertMaterial` (matte) under an ambient light and a headlight that
  follows the camera. Faces are double sided and use polygon offset so the edges stay
  crisp.
- **Edges.** The B-rep edges from the tessellation are drawn as `LineSegments2` at 1 CSS
  px, so they stay crisp on Retina. If a leaf has no edges, the viewer falls back to 30°
  feature edges.
- **Colors** come from `tokens.css`:
  - dark: `--viewer-model #5A5A5A`, edges `#F2F2F2` at `--viewer-edge-opacity 0.6`
  - light: `#D0D0D0`, edges `#111111` at `0.7`
  - hover: the fill moves 15% toward white (`--viewer-hover-lift`)
  - selected: the accent is mixed 85% over the fill (`--viewer-selected-mix`), with
    full-opacity accent edges
- **Background.** The canvas is cleared to alpha 0, so the `.halftone` background shows
  through.
- **Section.** Each component is cut by its own plane through its center, facing the
  camera. For straight parts the plane contains their long axis, so pipes are cut
  lengthwise. The near half of every part is removed and every bore is visible, whatever
  the layout. Picking ignores clipped hits.
- **Callout.** The callout is a filled `Callout` with a 1px accent SVG polyline and a 4px
  square terminal. Both are repositioned on every rendered frame by direct DOM writes, with
  no React renders. The leader lands on the area-weighted surface centroid, which lies on
  the axis or inside the bore for pipes, bends and cones, so it stays on the part from any
  view.
- **Motion.** The model fades in over 120 ms. Camera moves are instant, because the
  motion rule allows only opacity and color animation.

### CSP

No CSP change was needed. three.js uses no `eval` or `new Function`, no workers and no
`blob:` URLs. Shaders are strings compiled by WebGL. Element styles are set through CSSOM
(`element.style`), which `style-src` does not govern. `connect-src` already allowed
`ws://localhost:*`, which covers `/ws/files/{id}`. The Phase 1 audit (`npm run phase1`)
reports 0 console errors and 0 violations in both dev and prod.

## Consequences

- We own about 1,100 lines of viewer code (camera, picking, styling, section, decoding and the React host).
  Measurement, an exploded view and a clipping UI are not built.
- Bundle: the production renderer bundle is 2.2 MB minified, with three.js and its addons
  included. three-cad-viewer's ESM build alone is 3.6 MB.
- Phase 2 coloring (`colorBy`) only has to recolor the per-component fill materials,
  which already exist.
