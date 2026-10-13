# Canvas interactions

All pointer handling lives in `src/canvas/Canvas.tsx`. The `<svg>` owns the handlers and calls
`setPointerCapture` on pointerdown, so a gesture keeps receiving events even if the cursor
leaves the canvas.

## The drag state machine

The in-progress gesture is a `useRef<Drag | null>` (a ref, not state, so moves don't
re-render by themselves). `Drag` is a discriminated union:

| `kind` | Started by | On move | On release |
| --- | --- | --- | --- |
| `pan` | right or middle button, or left button while Space is held | shift `viewport` by screen delta (right button: only after 4 px) | right button that never moved → open the context menu |
| `move` | pointerdown on a `shape`/`connector` | after 3 screen px: `beginBatch`, snap, move selected shapes + free ends of selected connectors | `endBatch`; if it never moved and multi-selected, select just the clicked item (or its group) |
| `resize` | pointerdown on a corner `handle` | `resizeRect`: edges recomputed in the shape's rotated frame, opposite corner fixed, grid-snap (unrotated only), 10 px minimum | `endBatch` |
| `rotate` | pointerdown on the `rotate` handle | angle from the shape center to the cursor (`snapAngle`: 1° steps, 15° with Shift, sticks to right angles within 3°) | `endBatch` |
| `bend` | pointerdown on a curved line's `bend` handle | `bend` = cursor's signed distance from the chord (`bendThrough`) | `endBatch` |
| `marquee` | pointerdown on empty canvas | selection = items fully inside the box (plus prior selection if Shift) | clear the box |
| `draw` | any pointerdown while the **Place tool** is on (anywhere, even over shapes) | a shape entry, after 4 screen px: `beginBatch` + `drawShape`, then resize to `drawRect(start, cursor, square, grid)` (square for circles unless Shift; Shift squares other shapes) | drawn: `endBatch`; a click: `addShape` centered there, `addTextBox` for Text, `addFromTemplate` for a Graphs element; then back to Select unless locked |
| `connect` | any pointerdown while the **Arrow tool** is on (new arrow: `beginBatch` + `addConnector` from the attachment under the cursor, or a free point), or a `cend` (existing line end) | `findAttachment` → pin the end to a shape, or leave it free at the cursor | new arrow under 8 px → `abortBatch` (a click draws nothing); otherwise `endBatch`, and the tool returns to Select unless locked |

`resize` keeps the aspect ratio for pictures (`resizeRect(…, keepAspect)`); Shift inverts
that (stretches a picture, keeps proportions of any other shape).

With no drag active, pointermove only matters with the Arrow tool: it previews where an arrow
would start (`attachHint`). There are no connection-port dots.

Key thresholds are in screen pixels and converted with `/ zoom`: move starts after 3 px,
right-drag pan after 4 px, arrow-end outline snap 8 px, alignment snap 6 px, click-vs-drag for
new arrows 8 px.

## Tools

`store.tool` is `'select'` or `'arrow'`. **A** or the toolbar's Arrow button picks the Arrow
tool, **V**/Esc or the Select button go back. The tool resets to Select after one arrow; a
double-click on the Arrow button locks it (`toolLocked`) for drawing several. While the Arrow
tool is on, every press on the canvas starts an arrow (even on a shape) and the cursor is a
crosshair; double-click doesn't edit text.

## Routing a pointerdown

`(e.target as Element).closest('[data-hit]')` decides what was pressed:

| `data-hit` | Element | Extra attributes |
| --- | --- | --- |
| `cend` | overlay circle at a selected connector's end | `data-id` (connector), `data-end` (`source`/`target`) |
| `handle` | overlay corner square of the single selected shape | `data-id`, `data-handle` (`nw`/`ne`/`se`/`sw`) |
| `rotate` | overlay circle above the single selected shape | `data-id` |
| `bend` | overlay diamond at the midpoint of the single selected curved line | `data-id` |
| `shape` | `<g>` from `ShapeView` | `data-id` |
| `connector` | `<g>` from `ConnectorView` (includes a 10 px transparent hit path) | `data-id` |
| none | empty canvas | — |

Overlay elements render after content, so handles win over the shape beneath them.
Handles are drawn inside a `<g>` with the shape's own transform, so they sit on its rotated
corners. Items on locked layers inherit `pointer-events="none"` and never become the target;
hidden layers aren't rendered at all.

**Selection rules on shape/connector press:** the pressed item stands for its whole
outermost group (`expandGroups`). Shift toggles membership (and pressing an already-selected
item with Shift deselects its group without dragging); a plain press on an unselected item
replaces the selection; a plain press on a selected item keeps the selection so everything
selected can be dragged. The marquee selects selectable items fully inside it, then expands
to whole groups. Double-click selects only the item under the cursor (to edit its text, even
inside a group).

**After pointer capture, `click`/`dblclick` target the `<svg>`**, so `onDoubleClick` and the
context menu use `document.elementFromPoint`. Do the same for any new click-type handler.

## Context menu

A right-button press starts a `pan`; if the pointer is released without moving 4 px, the
canvas opens `ui/ContextMenu.tsx` at the cursor instead (from pointerup, so it behaves the
same on every OS; the native `contextmenu` event is always suppressed). Opening it selects the
item under the cursor (its whole group) if it isn't selected already, or clears the selection
over empty canvas. Items: Undo, Redo · Cut, Copy, Paste, Duplicate, Delete · Bring to front,
Send to back, each with its shortcut and disabled when it can't apply. **Paste from the menu
lands centered on the point that was right-clicked** (`paste(at)`). The menu closes on Esc, a
press outside it, the wheel, window blur, or after an item runs; ↑/↓ move between items. Its
keydown stops propagation so global shortcuts don't fire behind it.

## Snapping (moves)

`snap.ts:snapMove(movingRect, otherRects, threshold, grid)` is applied to the union of the
selected shapes' (rotated) bounds, against every other visible shape's bounds:

1. Per axis, find the closest match between the moving rect's left/center/right (or
   top/middle/bottom) and every other shape's — within `threshold` it snaps and emits a
   `Guide` line (drawn pink in the overlay).
2. On an axis with no alignment match, fall back to the 10 px grid if snapping is on.

Resize snaps moved edges to the grid only (no alignment guides yet), and only for unrotated
shapes. New shapes snap their top-left to the grid. Arrow-key nudges never snap.

## Align and distribute

`canvas/arrange.ts` turns a list of bounds into per-rect offsets. The store's `align` /
`distribute` split the selection into units (each outermost group, or a lone shape;
`groupUnits`), use each unit's combined shape bounds, and move every member of a unit by the
same offset in one `update`. Align targets the selection's combined bounds; distribute keeps
the first and last unit (by center) in place and equalizes the gaps between them.

## Attaching arrow ends

`routing.ts:findAttachment(page, point, snap)` takes the topmost selectable shape whose
(rotated) box, grown by `snap` (8 screen px), contains the point, and pins the end there with
`binding.ts:bindPoint`:

- within `snap` of the shape's **outline** (`SHAPES[kind].outline`, a polygon; curves are
  sampled) → the nearest point on the outline;
- otherwise → exactly where it was dropped, inside the shape (e.g. pointing at part of a
  picture).

The result is stored as `at` — fractions of the shape's unrotated box — so the end follows
when the shape moves, resizes or rotates. No shape → `null`, and the end is free at the cursor.

`Canvas` refuses to attach both ends of one line to the same shape. While drawing or dragging
an end, the overlay tints the target shape and marks the exact pinned point with a dot.

Ends that use `port`, or neither `at` nor `port` (floating: CSV imports and older files),
keep resolving as before; dragging such an end re-attaches it with `at`, which also takes it
out of floating-end spreading.

## Routing

`connectorPoints(page, c)` resolves both ends (`resolveEndpoint`: a pinned `at` end leaves
along the outward axis of the nearest side of the shape's box, rotated with the shape; legacy
port ends use the port) and then:

- `straight` → two points. New arrows start straight.
- `curved` → a quadratic curve whose midpoint sits `bend` px off the chord, sampled into 33
  points (`curvePoints`), so arrowheads, labels, bounds, hit-testing and export work on it as
  on any polyline. Switching a line to curved gives it a bend of 20 % of its length.
- `elbow` → `elbowRoute(a, b, obstacles)`:
  1. **Direct route:** leave each attached end along its port direction for a 20 px stub,
     join the stubs with one or two orthogonal bends chosen by case (both horizontal, both
     vertical, or mixed; handles facing/away/same-direction ports), then `simplify` removes
     duplicate and collinear points. Free ends get no stub; their direction is inferred from
     the dominant axis toward the other end.
  2. If that route passes through the interior of any visible shape's bounds
     (`routeObstacles`, including the line's own shapes), **route around them** with
     `orthogonalPath`: A* over the sparse grid of every obstacle edge (inflated by 10 px
     clearance) plus both stub ends. Each bend costs 40 px of length, so routes prefer few
     turns. Stubs are lengthened until they clear their own shape's margin. The path may not
     reverse out of a port, and arrives facing into the target port. Only obstacles within
     200 px of the box spanning both ends are considered (keeps the grid small).
  3. If there's no clear path (e.g. shapes closer together than the clearance), the direct
     route is used.

## Text editing

**Double-click** (Select tool, `onDoubleClick` in `Canvas.tsx`, using `elementFromPoint`):

| Under the cursor | Result |
| --- | --- |
| a shape or line | edit its text / label (`setEditing(id)`; selects just that item, even inside a group) |
| any other overlay hit (resize/rotate handle, line end, bend handle) | nothing |
| empty canvas | **new text box** (`addTextBox`): auto-sized, left-aligned, starting at the cursor, editing at once |

Enter with one item selected also starts editing (not for pictures).

`TextEditor` mounts a textarea **with no background** (the shape shows through) and a faint
dashed `outline` (not a border, so it doesn't shift the text). It is laid out to match the
render: over a wrapping shape it covers the text box with the wrapped lines vertically
centered (`paddingTop`, line count from `ShapeView.textLines`); for an auto-sized box it sits
at the box's corner with the box padding and grows with what you type (`fitText`,
`white-space: pre`). While editing, the shape's own text and selection outline are hidden.

It commits on blur, Esc, or Ctrl/Cmd+Enter (Enter alone also commits connector labels, which
are single-line) via `commitText`: one `update()`, so one undo step; auto-sized boxes are
re-fitted in the same update. A **new** text box is created inside an open history batch
(`editingNew`): committing text ends the batch (creation + text = one undo step), while
leaving it empty aborts the batch, so it disappears without an undo entry. Anything that
stops editing otherwise (page switch, delete, hiding its layer) drops an unsaved new box the
same way. Keydown inside the editor calls `stopPropagation` so global shortcuts don't fire.

Auto-sized boxes refit when their font size, bold or italic change; resizing one by a corner
clears `autoSize`, turning it into a fixed box whose text wraps.

## Pages and layers UI

- **Page tabs** (`ui/PageTabs.tsx`, under the canvas): click switches page (selection is
  cleared, the page's last viewport is restored or it is fitted), `+` adds a page,
  double-click renames (Enter commits, Esc cancels), Duplicate/Delete act on the active page.
- **Layers panel** (`ui/LayersPanel.tsx`, bottom of the properties panel): rows are listed top
  layer first. Clicking a row makes it the active layer (new shapes, lines and pastes go
  there). Row buttons toggle visibility and lock, move the layer up/down, and delete it (with
  its items, after a confirm). Double-click a name to rename. The **Layer** dropdown under
  Arrange moves the selection to another layer.

## Other inputs

- **Wheel:** registered natively with `{ passive: false }` (React's is passive). **The wheel
  always zooms** around the cursor (`zoomBy(factor, screenPoint)`), including trackpad
  two-finger scrolling; `deltaMode` lines/pages are normalized, and pinch (ctrl+wheel) uses a
  faster rate. Pan with a right-button drag, a middle-button drag, or Space + left drag.
- **Sidebar tiles arm a tool:** clicking a shape tile (or a Graphs node tile) calls
  `setPlacing({ kind: 'shape', entry } | { kind: 'template', id })`, switching to the **Place**
  tool (`tool: 'place'`, the tile shown `active`, crosshair cursor). Clicking it again disarms;
  double-clicking locks the tool (`toolLocked`) for several placements. The Image tile opens
  the file picker instead (the picture goes at the view center). The Basic section ends with an
  **Arrow** tile that toggles the Arrow tool like the toolbar button.
- **Drag from sidebar:** HTML5 drag-and-drop with MIME `application/x-clearchart-shape`
  carrying the `LIBRARY` index; `onDrop` adds the shape centered at the drop point.
- **Focus:** a press on the canvas blurs whatever panel field or tile has focus, so keyboard
  shortcuts (Delete…) act on the canvas right away. The shortcut handler ignores keys only while
  you're typing — text inputs, textareas, selects and editables. Sliders, color pickers and
  checkboxes don't block shortcuts, though arrow keys still move a focused slider instead of
  nudging.
- **Delete on a Graphs tile:** Delete or Backspace on a focused node or line tile asks, then
  deletes that element (`deleteTemplate`, undoable). The key stops at the tile, so the canvas
  selection isn't deleted too.
- **Graphs (templates):** the shape panel's Graphs section lists `Doc.templates`; new
  documents (and ones saved before templates existed) start with `defaultTemplates()` — the
  built-in device picture elements and a Link line (`model/doc.ts`). Picture elements show their
  picture as the tile; the default element has a *default* badge; the tooltip lists its
  platform rules. **+ Device picture** asks for an image (`pickImageFile` → `readImageFile`),
  makes an element from it (`addDeviceTemplate`, named after the file, at most 96 px) and opens
  its editor. **Add built-in devices** appears while any built-in element (matched by name) is
  missing and runs `addBuiltInDevices`. A node
  template tile adds a node at the view center on click, or at the drop point when dragged
  (MIME payload `template:<id>`, see `TEMPLATE_DRAG_PREFIX`). A line template tile picks it for
  the Arrow tool (`setArrowTemplate`); new arrows are then made from it until the tool returns
  to Select. The ⋯ button opens the template editor (name, text/labels with `{fields}`, *Use
  the look of the selected item*, Delete). For node elements it also edits the picture
  (*Add / Change / Remove picture*), the platform rules (comma-separated), whether it's the
  default, and, for box elements, whether the text is inside or to the right. A picture change is held
  in the dialog until Save, and Save applies everything in one history batch (one undo step).
- **Import CSV** (toolbar): file picker → `ImportDialog` (preview counts, new devices per
  element, skipped rows; the element for devices matching no rule, which becomes the default;
  the line template) → `importLinks`. Dialogs are opened through `ui/dialogState.ts` and rendered
  by `ui/Dialogs.tsx`; `Modal` stops key propagation so global shortcuts don't fire.
- **Templates from the canvas:** right-click one shape or line → *Save as node/line
  template…*; on a templated item → *Edit template…* / *Update template from this item*
  (copies its look, not its text). The Properties **Data** section edits a selected item's
  fields (every placeholder its template uses, plus its other data) and offers *Edit* /
  *Unlink*.
- **Pictures:** the sidebar's Image tile opens a file picker (`io/image.ts:pickImageFile`);
  `readImageFile` turns the file into a data URL (see `architecture.md`) and `addImage` puts it
  at the viewport center, at most 400 px on its longer side.
- **Text beside a device:** the text is part of the device. Clicking it selects the device
  (its hit rect is inside the shape's group). Dropping an arrow end on it attaches there:
  attaching tests the attach frame (box plus text), and the hover highlight shows that whole
  frame. Double-click edits the text in place to the right of the shape, but only for unlinked
  devices (a linked device's text comes from its element and fields).

## Keyboard shortcuts (`src/ui/shortcuts.ts`)

| Keys | Action |
| --- | --- |
| Ctrl/Cmd+Z · Ctrl/Cmd+Shift+Z · Ctrl/Cmd+Y | undo · redo · redo (no toolbar buttons; also in the context menu) |
| Ctrl/Cmd+C · X · V · D | copy · cut · paste (offset 20 px, repeats cascade) · duplicate |
| Ctrl/Cmd+A | select all (selectable layers only) |
| Ctrl/Cmd+G · Ctrl/Cmd+Shift+G | group · ungroup (removes the outermost group) |
| Ctrl/Cmd+S | save JSON file |
| Ctrl/Cmd+] · [ | bring to front · send to back (also in the context menu) |
| Ctrl/Cmd+= · - · 0 | zoom in · out · 100 % |
| Shift+1 | fit to screen |
| Delete / Backspace | delete selection (attached lines stay, detached; also in the context menu); on a focused Graphs tile, delete that element |
| 1 · 2 · 3 · 4 · 5 · 6 | Place tool: Rectangle · Circle · Triangle · Text · Image (opens the file picker) · Arrow tool (`LibraryEntry.shortcut`, `ARROW_SHORTCUT`; keypad digits too) |
| A · V | Arrow tool · Select tool |
| Arrows (Shift = 10 px) | nudge selection |
| Enter | edit text of the single selected item (not pictures) |
| Esc | back to the Select tool and clear selection |
| Space (hold) | pan with left drag (handled in `Canvas.tsx`) |

The handler ignores events whose target is inside an input, textarea, select or
contenteditable element.
