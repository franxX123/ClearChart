# Canvas interactions

All pointer handling lives in `src/canvas/Canvas.tsx`. The `<svg>` owns the handlers and calls
`setPointerCapture` on pointerdown, so a gesture keeps receiving events even if the cursor
leaves the canvas.

## The drag state machine

The in-progress gesture is a `useRef<Drag | null>` (a ref, not state, so moves don't
re-render by themselves). `Drag` is a discriminated union:

| `kind` | Started by | On move | On release |
| --- | --- | --- | --- |
| `pan` | middle button, or left button while Space is held | shift `viewport` by screen delta | — |
| `move` | pointerdown on a `shape`/`connector` | after 3 screen px: `beginBatch`, snap, move selected shapes + free ends of selected connectors | `endBatch`; if it never moved and multi-selected, select just the clicked item |
| `resize` | pointerdown on a corner `handle` | recompute edges from the corner, grid-snap moved edges, enforce 10 px minimum | `endBatch` |
| `marquee` | pointerdown on empty canvas | selection = items fully inside the box (plus prior selection if Shift) | clear the box |
| `connect` | pointerdown on a `port` (new line) or a `cend` (existing line end) | `findAttachment` → set the end to port / shape body / free point | new line that never left its port → `abortBatch` and select the shape; otherwise `endBatch` |

With no drag active, pointermove only updates `hoverId` (shape under cursor, padded by 10
screen px) to show its ports.

Key thresholds are in screen pixels and converted with `/ zoom`: move starts after 3 px,
port pick radius 10 px, alignment snap 6 px, click-vs-drag for new lines 8 px.

## Routing a pointerdown

`(e.target as Element).closest('[data-hit]')` decides what was pressed:

| `data-hit` | Element | Extra attributes |
| --- | --- | --- |
| `port` | overlay circle on the hovered shape | `data-id` (shape), `data-port` (index) |
| `cend` | overlay circle at a selected connector's end | `data-id` (connector), `data-end` (`source`/`target`) |
| `handle` | overlay corner square of the single selected shape | `data-id`, `data-handle` (`nw`/`ne`/`se`/`sw`) |
| `shape` | `<g>` from `ShapeView` | `data-id` |
| `connector` | `<g>` from `ConnectorView` (includes a 10 px transparent hit path) | `data-id` |
| none | empty canvas | — |

Overlay elements render after content, so ports and handles win over the shape beneath them.

**Selection rules on shape/connector press:** Shift toggles membership (and pressing an
already-selected item with Shift deselects it without dragging); a plain press on an
unselected item replaces the selection; a plain press on a selected item keeps the
selection so the whole group can be dragged.

**After pointer capture, `click`/`dblclick` target the `<svg>`**, so `onDoubleClick` uses
`document.elementFromPoint`. Do the same for any new click-type handler.

## Snapping (moves)

`snap.ts:snapMove(movingRect, otherRects, threshold, grid)` is applied to the union of the
selected shapes' bounds:

1. Per axis, find the closest match between the moving rect's left/center/right (or
   top/middle/bottom) and every other shape's — within `threshold` it snaps and emits a
   `Guide` line (drawn pink in the overlay).
2. On an axis with no alignment match, fall back to the 10 px grid if snapping is on.

Resize snaps moved edges to the grid only (no alignment guides yet). New shapes snap their
top-left to the grid. Arrow-key nudges never snap.

## Attaching connector ends

`routing.ts:findAttachment(doc, point, radius)`:

1. The nearest port of any shape within `radius` → fixed port end.
2. Else the topmost shape whose bounds contain the point → auto port end.
3. Else `null` → the end becomes free at the cursor.

`Canvas` additionally refuses a port identical to the line's other end (no zero-length
lines). While dragging, the overlay highlights the target port (filled dot) or the target
shape body (tinted rect).

## Routing

`connectorPoints(doc, c)` resolves both ends (`resolveEndpoint`; auto ports pick the port
nearest the other end's anchor) and then:

- `straight` → two points.
- `elbow` → `elbowRoute`: leave each attached end along its port direction for a 20 px stub,
  join the stubs with one or two orthogonal bends chosen by case (both horizontal, both
  vertical, or mixed; handles facing/away/same-direction ports), then `simplify` removes
  duplicate and collinear points. Free ends get no stub; their direction is inferred from
  the dominant axis toward the other end. There is no obstacle avoidance.

## Text editing

Double-click a shape or connector, or press Enter with one item selected → `setEditing(id)`.
`TextEditor` mounts a textarea over the text area, commits on blur, Esc, or Ctrl/Cmd+Enter
(Enter alone also commits connector labels, which are single-line). The text edit is one
normal `update()` (one undo step). Keydown inside the editor calls `stopPropagation` so
global shortcuts don't fire.

## Other inputs

- **Wheel:** registered natively with `{ passive: false }` (React's is passive).
  Ctrl/Cmd+wheel or trackpad pinch zooms around the cursor (`zoomBy(factor, screenPoint)`);
  plain wheel pans.
- **Drag from sidebar:** HTML5 drag-and-drop with MIME `application/x-clearchart-shape`
  carrying the `LIBRARY` index; `onDrop` adds the shape centered at the drop point. Clicking a
  tile adds it at the viewport center.

## Keyboard shortcuts (`src/ui/shortcuts.ts`)

| Keys | Action |
| --- | --- |
| Ctrl/Cmd+Z · Ctrl/Cmd+Shift+Z · Ctrl/Cmd+Y | undo · redo · redo |
| Ctrl/Cmd+C · X · V · D | copy · cut · paste (offset 20 px, repeats cascade) · duplicate |
| Ctrl/Cmd+A | select all |
| Ctrl/Cmd+S | save JSON file |
| Ctrl/Cmd+] · [ | bring to front · send to back |
| Ctrl/Cmd+= · - · 0 | zoom in · out · 100 % |
| Shift+1 | fit to screen |
| Delete / Backspace | delete selection (attached lines stay, detached) |
| Arrows (Shift = 10 px) | nudge selection |
| Enter | edit text of the single selected item |
| Esc | clear selection |
| Space (hold) | pan with left drag (handled in `Canvas.tsx`) |

The handler ignores events whose target is inside an input, textarea, select or
contenteditable element.
