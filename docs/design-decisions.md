# Design decisions

Short records of choices that shape the code. Each lists what was chosen, why, and the
trade-off accepted. If you reverse one, update this file.

## 1. Clean-room clone of Lucidchart

**Chosen:** recreate features from Lucidchart's publicly visible behavior and docs. No
decompiled code, copied assets, icons or shape libraries.
**Why:** avoids ToS and copyright problems. All shape geometry in `shapes/library.ts` is
hand-written from first principles.
**Trade-off:** shapes and behaviors are approximations, not pixel matches.

## 2. SVG rendering, not Canvas2D/WebGL

**Why:** native hit-testing per element, crisp text and strokes at any zoom, CSS cursors,
and SVG export by cloning the DOM.
**Trade-off:** slows down with thousands of elements (every item is DOM). Acceptable for
typical diagrams; revisit with virtualization if needed (see roadmap).

## 3. Flat items map + `order` array

**Why:** small immer patches, O(1) lookup by id, z-order changes touch only `order`, and the
structure is CRDT-friendly for future collaboration.
**Trade-off:** no grouping/nesting yet; groups will need a parent reference or group items.

## 4. Undo via immer patches, not snapshots

**Why:** memory stays proportional to what changed, and patches are the natural unit for
future sync/collaboration. Batches and merge keys give gesture-level and typing-level undo.
**Trade-off:** every doc mutation must go through `update()`; a direct `set({ doc })` is
invisible to history. The merge window (1 s) is a heuristic.

## 5. Derived geometry is never stored

**Why:** connector routes, ports and shape paths are computed from shape bounds on render, so
moving a shape automatically updates attached lines and there's no cached state to go stale.
**Trade-off:** recomputed every render; fine at MVP scale.

## 6. Three endpoint states (fixed port / auto port / free)

**Why:** matches how Lucid feels: drop on a dot to pin, drop on the body to "float" to the
best side, drop in space to leave a dangling end.
**Trade-off:** port indices are persisted, so a kind's port list must stay append-only.

## 7. Deleting a shape detaches its lines instead of deleting them

**Why:** matches Lucidchart and avoids surprising data loss; ends are frozen at their last
position (`deleteSelection` in `store.ts`).
**Trade-off:** can leave orphaned lines the user must clean up.

## 8. Corner-only resize handles

**Why:** side-midpoint handles would sit exactly on the top/right/bottom/left connection
ports, making it ambiguous whether a drag resizes or starts a line.
**Trade-off:** you can't resize a single edge; corners move two edges. A future fix is to
offset ports outside the shape or show handles only for selected shapes and ports only
when hovering unselected ones.

## 9. Simple elbow routing, no obstacle avoidance

**Why:** a 20 px stub plus case analysis gives clean results for typical flowcharts and is
fully deterministic and unit-testable (`routing.test.ts`).
**Trade-off:** lines can cross shapes when the layout is awkward. Real orthogonal routing
(visibility graph + A*) is a roadmap item.

## 10. Manual text wrapping with `<text>`, not `<foreignObject>`

**Why:** `foreignObject` content is unreliable when an SVG is rasterized through `<img>` for
PNG export and in other SVG consumers. Measuring with canvas `measureText` keeps export
faithful.
**Trade-off:** no rich text (per-span styles, lists, links) yet; center alignment only.

## 11. Arrowheads drawn as paths, not `<marker>`

**Why:** markers can't inherit the line color portably (`context-stroke` support varies),
and markers complicate export. Paths computed in `ConnectorView` match the line exactly; filled
heads also retract the line end so its butt doesn't poke through the tip.

## 12. Export clones the live DOM

**Why:** WYSIWYG with zero duplicated rendering code.
**Trade-off:** export requires the mounted canvas (`canvasRefs.content`), and content-layer
markup must not depend on page CSS.

## 13. One page per document in the MVP

**Why:** scope. The schema (`Doc.items/order`) is designed so pages can wrap it later
(`Doc.pages[]` each with its own items/order) behind a `version: 2` migration in `parseDoc`.

## 14. Single global zustand store, actions read `getState()`

**Why:** minimal boilerplate, selectors keep re-renders narrow, and pointer handlers stay
correct across renders by reading current state rather than closures.
**Trade-off:** the store is a module singleton (one editor per page, and tests of the store
would share state — current tests only cover pure modules).
