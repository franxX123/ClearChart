# Roadmap and known limitations

## Known limitations

- Export is per page (the active one); no multi-page PDF. Connectors can't link shapes on
  different pages.
- Groups have no properties of their own: no group rotation or group resize, and a group's
  members aren't kept adjacent in z-order. Resize handles appear for a single shape only.
- Rotated shapes snap, align and route by their axis-aligned bounds; ports on rotated shapes
  leave along the nearest axis.
- Edge-only resize is still missing (corner handles only), and alignment guides apply when
  moving, not when resizing.
- Routing: obstacle avoidance is A* over shape bounds with a fixed 10 px clearance; curves
  have a single bend (no multi-point arrows), no user waypoints or line jumps. Lines between
  shapes closer than the clearance fall back to the direct route.
- Arrows: both ends can't attach to the same shape (no self-loops); pinned ends don't slide to
  face the other end; no arrow binding gap like Excalidraw's.
- Pictures: added from the sidebar file picker only (no drag-and-drop of files, no paste from
  the system clipboard); no cropping; embedded data counts against the ~5 MB autosave.
- The mouse wheel always zooms, so trackpad two-finger scrolling zooms instead of panning.
- Text: plain text, one style per shape; centered, except double-click text boxes (left-aligned,
  auto-sized) — there's no alignment control in Properties yet. Connector labels are
  single-line and always at the path midpoint.
- Clipboard is internal to the app (not the system clipboard), and is lost on reload.
- The whole page re-renders on each change and connector routes are recomputed per render —
  fine for hundreds of items, not for many thousands.
- No automated UI tests in the repo (only unit tests of pure modules and the store).
- Light theme only.

## Planned phases and where they plug in

**Phase 2 — Editor depth (done)**
- *Multiple pages:* `Doc { version: 2, title, pages[] }`, `activePageId` in the store, v1 files
  migrated in `parseDoc`; page tabs under the canvas.
- *Layers:* `Page.layers` + `layerId` per item; per-layer rendering; hidden/locked honored in
  hit-testing, attaching, marquee, routing and export.
- *Grouping:* `groupIds` per item (outermost first); selection and move expand to groups.
- *Rotation:* `rotation` on `Shape`; math in `canvas/transform.ts`; rotation handle, rotated
  resize, rotated ports and hit tests.
- *Align/distribute:* `canvas/arrange.ts` over selection units → one `commit`.
- *Better routing:* `elbowRoute` keeps its signature (plus an `obstacles` list) and falls back
  to A* around shape bounds when the direct route collides.
- *Follow-ups:* group resize/rotation, edge resize handles, multi-page PDF export, dragging
  page tabs to reorder, waypoints on lines.

**Phase 2.5 — Excalidraw-style input (done)**
- Wheel zoom, right-drag pan, right-click context menu; undo/redo and z-order moved from the
  toolbar to shortcuts and the menu.
- Arrow tool (A) with ends pinned anywhere on a shape (`Endpoint.at`, `connectors/binding.ts`,
  `ShapeDef.outline`); port dots removed; straight / elbow / curved (`bend`) routing.
- Pictures from the device (`kind: 'image'`, `io/image.ts`), aspect-locked resize, autosave
  overflow notice.
- *Follow-ups:* drop or paste image files onto the canvas, multi-point arrows, edge handles
  now that ports are gone.

**Phase 3 — Collaboration**
- Swap the doc + `history.ts` for a Yjs document (per page: a `Y.Map` of items, a `Y.Array`
  order and layers);
  `Y.UndoManager` replaces the patch history and gives per-user undo. The flat items/order
  model maps 1:1. Add a y-websocket server, presence (cursors, selections), and comments
  anchored to item ids.

**Phase 4 — Accounts and documents**
- Backend for auth, document storage (replace localStorage autosave), sharing roles
  (view/comment/edit), a dashboard with folders, revision history.

**Phase 5 — Smart features (partly done)**
- *Done:* item data (key/value fields), node/line templates with `{field}` placeholders that
  restyle linked items, CSV import of network links (device dedupe, reciprocal-row merge,
  re-import that updates instead of duplicating), deterministic force-directed layout.
- *Next:* a nodes CSV (device inventory joined by name), mirroring a file (removing links no
  longer in it), hierarchical/tiered layout, an "Add field" control and alignment in
  Properties, conditional formatting rules, templates gallery, diagrams from text or SQL, AI
  generation.

**Phase 6 — Import/export (Visio export done)**
- *Done:* Visio export (.vsdx, all pages, editable shapes and glued connectors, Shape Data).
  Not carried over yet: groups, layers, line jumps; start/end labels are separate text shapes.
- *Next:* Visio import, PDF export, draw.io import/export, embed codes, printing.

Third-party integrations (Google Workspace, Microsoft 365, Atlassian, Slack, cloud-provider
imports) are out of scope for this project.
