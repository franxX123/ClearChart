# Canvas interactions

All pointer handling lives in `src/canvas/Canvas.tsx`. The `<svg>` owns the handlers and calls
`setPointerCapture` on pointerdown, so a gesture keeps receiving events even if the cursor
leaves the canvas.

## The drag state machine

The in-progress gesture is a `useRef<Drag | null>` (a ref, not state, so moves don't
re-render by themselves). `Drag` is a discriminated union:

| `kind` | Started by | On move | On release |
| --- | --- | --- | --- |
| `pan` | right or middle button, or left button while Space is held | after 4 screen px (`PAN_SLOP`): shift `viewport` by screen delta, `grabbing` cursor | a right press that never moved opens the context menu at that point |
| `move` | pointerdown on a `shape`/`connector` | after 3 screen px: `beginBatch`, snap, move selected shapes + free ends of selected connectors | `endBatch`; if it never moved and multi-selected, select just the clicked item and its group |
| `resize` | pointerdown on a corner `handle` | `geometry.resizeRect`: move the dragged corner's edges, grid-snap them, 10 px minimum; with **Shift**, scale uniformly from the opposite corner (no grid snap). A `W × H` readout follows the corner | `endBatch` |
| `marquee` | pointerdown on empty canvas | selection = items fully inside the box, groups only when all their members are inside (plus prior selection if Shift) | clear the box |
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

**Selection rules on shape/connector press:** a press acts on the item's whole outermost
group (`groups.expandToGroups`). Shift toggles membership (and pressing an already-selected
item with Shift deselects its group without dragging); a plain press on an unselected item
replaces the selection; a plain press on a selected item keeps the selection so everything
selected can be dragged.

**Groups.** Double-click selects the single item under the cursor (and starts text editing if
it has text), which is how you reach inside a group; while one member is selected, dragging
moves only it. A fully selected group gets a dashed box in the overlay. A multi-selection has
no resize handles, so groups can't be resized as a whole.

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
nearest the other end's anchor; perimeter ends, used by graph import, sit where the
center-to-center line meets the shape's bounding box) and then:

- `straight` → two points.
- `elbow` → `elbowRoute`: leave each attached end along its port direction for a 20 px stub,
  join the stubs with one or two orthogonal bends chosen by case (both horizontal, both
  vertical, or mixed; handles facing/away/same-direction ports), then `simplify` removes
  duplicate and collinear points. Free ends get no stub; their direction is inferred from
  the dominant axis toward the other end. There is no obstacle avoidance.

## Text editing

Double-click a shape or connector, or press Enter with one item selected → `setEditing(id)`.
`setEditing` ignores `image` and `component` shapes: a component's text comes from its data,
edited in the Properties panel.
`TextEditor` mounts a textarea over the text area, commits on blur, Esc, or Ctrl/Cmd+Enter
(Enter alone also commits connector labels, which are single-line). The text edit is one
normal `update()` (one undo step). Keydown inside the editor calls `stopPropagation` so
global shortcuts don't fire.

## Right-click menu

The right button pans when dragged, so the menu opens on **release** of a right press that
didn't move (`openMenuAt`, rule 8: it uses `elementFromPoint`, with `hitShape` as a fallback for
ports and handles drawn over a shape). The browser's `contextmenu` event on the `<svg>` is always
prevented and otherwise ignored while a right press is in progress or within 300 ms of one
(Linux/macOS fire it on press, Windows after release). A keyboard-triggered menu (Menu key,
Shift+F10: `button` isn't 2, Chrome reports -1) anywhere outside text fields and dialogs opens
the canvas menu at the pointer, via a window listener. Right-clicking an item that isn't
selected selects it and its group first; right-clicking empty canvas keeps the selection. The menu
(`ui/ContextMenu.tsx`, items from `ui/canvasMenu.ts`) is portaled to `body`, clamped inside the
window and focused:

Undo · Redo | Copy · Paste (centered where you right-clicked) · Duplicate | Group · Ungroup |
Bring to front · Send to back | Create as Node Component… · Create as Line Component… ·
Break apart (single component only) | Delete

Items that can't act are disabled, except the two Create items, which show a toast explaining
what to select (the same check as the sidebar's **+ Node / + Line from selection**). When
opened from the menu, the component dialog asks which template to save into (default: the last
one used; or create a new one). Arrow keys/Home/End move between items, Enter runs one, and the
menu closes on Esc, a press outside, the wheel, window blur or resize.

## Other inputs

- **Wheel:** registered natively with `{ passive: false }` (React's is passive).
  The wheel, and trackpad pinch (which arrives as ctrl+wheel), zoom around the cursor:
  scroll up to zoom in. `canvas/wheel.ts:wheelZoomFactor` converts line/page deltas to pixels,
  caps each event at 120 px and gives about 1.15× per mouse notch (pinch steps use a faster
  rate). **Shift+wheel pans** (`wheelPan`): horizontally for a mouse, whichever axis the browser
  reports it on; freely for a two-axis trackpad scroll. Right-drag, middle-drag and Space+drag
  pan too.
- **Drag from sidebar:** HTML5 drag-and-drop with MIME `application/x-clearchart-shape`
  carrying the `LIBRARY` index; `onDrop` places the entry centered at the drop point. Clicking a
  tile places it at the viewport center; a digit key places a Basic entry under the pointer
  (`canvasRefs.pointer`, the last pointer position over the canvas). All three go through
  `ui/libraryActions.ts:placeEntry`: shapes → `addShape`, the **Arrow** line entry → `addLine`
  (a free, straight 120 px line with an end arrow, whose ends can then be dragged onto shapes),
  Image → file picker.
- **Component tiles** (Graph templates section) drag with `application/x-clearchart-component`
  carrying `{ templateId, componentId }`; the drop looks the definition up in the template
  library and calls `addComponent`. Line component rows aren't draggable; clicking one applies
  its style to the selected lines.
- **Images:** the Image tile opens a file picker; image files dropped from the desktop onto the
  canvas are placed at the drop point (each next one offset 20 px).

## Keyboard shortcuts (`src/ui/shortcuts.ts`)

| Keys | Action |
| --- | --- |
| Ctrl/Cmd+Z · Ctrl/Cmd+Shift+Z · Ctrl/Cmd+Y | undo · redo · redo |
| Ctrl/Cmd+G · Ctrl/Cmd+Shift+G | group · ungroup |
| Ctrl/Cmd+C · X · V · D | copy · cut · paste (offset 20 px, repeats cascade) · duplicate |
| Ctrl/Cmd+A | select all |
| Ctrl/Cmd+S | save JSON file |
| Ctrl/Cmd+] · [ | bring to front · send to back |
| Ctrl/Cmd+= · - · 0 | zoom in · out · 100 % |
| Shift+1 | fit to screen |
| 1 · 2 · 3 · 4 · 5 · 6 · 7 | place Rectangle · Circle · Triangle · Hexagon · Text · Arrow · Image (picker) under the pointer |
| Delete / Backspace | delete selection (attached lines stay, detached) |
| Arrows (Shift = 10 px) | nudge selection |
| Enter | edit text of the single selected item |
| Esc | clear selection |
| Space (hold) | pan with left drag (handled in `Canvas.tsx`) |
| Shift (while resizing) | keep proportions |

The handler ignores events whose target is inside an input, textarea, select or
contenteditable element, or anywhere inside a dialog (`.modal`) or the right-click menu
(`.context-menu`) — otherwise Backspace on a focused dialog button would delete the canvas
selection, and arrow keys in the menu would nudge it. Space-to-pan has the same guard. The one
exception: the digit shape keys still work while a slider, checkbox, radio or color input has
focus, since those don't take typed digits (so you can drag Opacity, then press 2).
Tabs have no shortcuts: browsers reserve Ctrl+T / Ctrl+W.
Dialogs close on Esc or a click on the backdrop.
