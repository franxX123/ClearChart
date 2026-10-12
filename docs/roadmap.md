# Roadmap and known limitations

## Known limitations (MVP)

- Single page per document; no layers.
- No grouping, rotation, align/distribute, lock, or edge-only resize (corner handles only).
- Elbow routing has no obstacle avoidance; no curved lines, waypoints or line jumps.
- Text: plain text, centered, one style per shape; connector labels are single-line and
  always at the path midpoint.
- Clipboard is internal to the app (not the system clipboard), and is lost on reload.
- Alignment guides apply when moving, not when resizing.
- The whole doc re-renders on each change and connector routes are recomputed per render —
  fine for hundreds of items, not for many thousands.
- No automated UI tests in the repo (only pure-module unit tests).
- Light theme only.

## Planned phases and where they plug in

**Phase 2 — Editor depth**
- *Multiple pages:* `Doc` → `{ version: 2, title, pages: [{ id, name, items, order }] }`, with
  `activePageId` in the store; migrate v1 in `parseDoc`. `Canvas`, `docBounds`, export and
  actions operate on the active page.
- *Layers:* a `layers` list per page and a `layerId` per item; render per layer, honor
  hidden/locked in hit-testing.
- *Grouping:* a `group` item type with `children: id[]`, or `parentId` on items; selection
  and move expand groups.
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
- Shape data (key/value per shape), data linking from CSV/sheets, conditional formatting
  rules, auto-layout (tree/hierarchy), templates gallery, diagrams generated from text or
  SQL, AI generation.

**Phase 6 — Import/export**
- PDF export, Visio (VSDX) and draw.io import/export, embed codes, printing.

Third-party integrations (Google Workspace, Microsoft 365, Atlassian, Slack, cloud-provider
imports) are out of scope for this project.
