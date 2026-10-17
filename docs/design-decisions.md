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
**Trade-off:** the store is a module singleton (one editor per page, and store tests share
state — `model/store.test.ts` resets it before each test).

## 15. Components are one shape, with their definition copied into the doc

**Chosen:** a placed component is a single `Shape` (`kind: 'component'`) that references a
definition in `doc.components`; the template library lives in its own store.
**Why:** move, resize, ports, connectors, hit-testing, copy/paste and export all work unchanged
for one rect-bounded item, with no grouping system needed. Copying the definition keeps saved
diagrams self-contained (they open on another machine without the library) and stores each
image once per diagram rather than per node.
**Trade-off:** parts can't be selected individually (use Break apart), and editing a component
in the library updates only the open diagram, not other saved diagrams.

## 16. Import plans are pure; layout is deterministic

**Chosen:** `planImport` and `forceLayout` are pure functions of the doc and the file; the
store only commits the result. The layout uses seeded starts, never `Math.random` or a clock.
**Why:** dedupe and matching are unit-testable in node, the dialog can preview counts live,
and importing the same file twice gives the same picture.
**Trade-off:** layout cost is O(n²) per iteration with a fixed iteration count; very large
networks (thousands of nodes) would need a Barnes–Hut or tiered layout.

## 17. Imported links attach at the perimeter, labels run along the line

**Chosen:** imported connector ends use `Endpoint.perimeter` (center-to-center line clipped to
the bounding box) instead of the 4 ports, and end labels are drawn rotated along their line.
**Why:** a core switch may have dozens of links; with 4 ports they pile onto the same points
and their interface labels overlap. Fanning out from the center gives each link its own spot,
and labels on diverging lines separate naturally.
**Trade-off:** rotated text reads sideways on steep lines; the perimeter is the bounding box,
so lines to round components stop at the box edge rather than the curve.

## 18. Tabs are separate diagrams, swapped in and out of one store

**Chosen:** each tab is its own `Doc` with its own history; the store keeps the active tab in
`doc`/`history`/`selection`/`viewport` and parks the rest. Not Lucid-style pages inside one
file (decision 13 still holds: a file is one diagram).
**Why:** a diagram per client or site is the common case here, each saves to its own file, and
no action, component or the history module needed a tab id — switching is a swap. Undo stays
per diagram, as users expect.
**Trade-off:** pasting between tabs has to carry component definitions along (the clipboard
does), and parked tabs keep their history in memory, so many large open tabs use more memory.
History is still not persisted across reloads.

## 19. Groups are id lists on items, not a group table

**Chosen:** `item.groups` lists group ids innermost first; the outermost is what a click
selects. Grouping expands the selection to whole groups first, then appends one id.
**Why:** nested groups with no extra structure to keep consistent: deleting items can't
leave empty groups, undo is the same patch mechanism, files stay plain JSON, and copies just
remap ids.
**Trade-off:** "the group" has no record of its own (no group name, bounds or style), and a
group can't be resized as a unit; finding a group's members scans `doc.order` (fine at this
scale).
