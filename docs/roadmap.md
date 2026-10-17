# Roadmap and known limitations

## Known limitations (MVP)

- One page per document (open several diagrams side by side in tabs); no layers.
- No rotation, align/distribute, lock, or edge-only resize (corner handles only; Shift keeps
  proportions but then ignores the grid). Groups can't
  be resized as a whole, have no name or style of their own, and dragging a member out of its
  group's area doesn't remove it from the group (use Ungroup).
- Elbow routing has no obstacle avoidance; no curved lines, waypoints or line jumps.
- Text: plain text, centered, one style per shape; connector labels are single-line and
  always at the path midpoint.
- Clipboard is internal to the app (not the system clipboard), and is lost on reload; it is
  shared between tabs.
- Undo history, selection and zoom are per tab and kept only while the page is open.
- With the wheel set to zoom, a trackpad's two-finger scroll zooms too; pan with Shift+scroll,
  Space+drag or middle-drag.
- Alignment guides apply when moving, not when resizing.
- The whole doc re-renders on each change and connector routes are recomputed per render —
  fine for hundreds of items, not for many thousands.
- No automated UI tests in the repo (only pure-module unit tests).
- Light theme only.
- Graph import: parallel links between the same two devices (e.g. port-channel members) draw
  on top of each other; the force layout is O(n²) per iteration (about 150 ms for 160 nodes,
  fine into the hundreds) and has no notion of tiers (core/distribution/access). Re-importing
  doesn't update the data of devices already on the canvas.
- Component instances use the definition copied into the doc; editing a component in the
  library refreshes it only in the open diagram.
- Images are data URLs inside the doc, so many large images can exhaust localStorage autosave
  (files still save).

## Planned phases and where they plug in

**Phase 2 — Editor depth**
- *Multiple pages:* `Doc` → `{ version: 2, title, pages: [{ id, name, items, order }] }`, with
  `activePageId` in the store; migrate v1 in `parseDoc`. `Canvas`, `docBounds`, export and
  actions operate on the active page.
- *Layers:* a `layers` list per page and a `layerId` per item; render per layer, honor
  hidden/locked in hit-testing.
- *Done:* grouping (`item.groups`, nested), tabs (one diagram each), right-click menu.
- *Group resize:* scale every member's box around the group's bounds in one batch.
- *Rotation:* `rotation` on `Shape`; render with a rotate transform; ports and hit tests must
  rotate points (put the math in `geometry.ts`).
- *Align/distribute:* pure functions over selected bounds → one `commit`.
- *Better routing:* replace `elbowRoute` with grid/visibility-graph A* around shape bounds;
  keep the same signature so the view is unchanged.

**Phase 3 — Collaboration**
- Swap the doc + `history.ts` for a Yjs document (`Y.Map` of items, `Y.Array` order);
  `Y.UndoManager` replaces the patch history and gives per-user undo. The flat items/order
  model maps 1:1. Add a y-websocket server, presence (cursors, selections), and comments
  anchored to item ids.

**Phase 4 — Accounts and documents**
- Backend for auth, document storage (replace localStorage autosave), sharing roles
  (view/comment/edit), a dashboard with folders, revision history.

**Phase 5 — Smart features**
- *Done:* shape data (`Shape.data`), rule-based components (graph templates), import from a
  JSON edge list with force-directed auto-layout.
- Next: CSV/sheet import into the same `planImport` pipeline, re-import that updates the data
  of existing nodes, hierarchical (tiered) layout as a `layoutPlan` option, conditional
  formatting rules, templates gallery, diagrams generated from text or SQL, AI generation.

**Phase 6 — Import/export**
- PDF export, Visio (VSDX) and draw.io import/export, embed codes, printing.

Third-party integrations (Google Workspace, Microsoft 365, Atlassian, Slack, cloud-provider
imports) are out of scope for this project.
