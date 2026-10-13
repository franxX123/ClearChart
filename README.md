# ClearChart

A browser diagramming editor inspired by Lucidchart, built clean-room from its public behavior.
Core editor plus phase 2: canvas, shapes, connectors, styling, save/load and export, multiple pages,
layers, grouping, rotation, align/distribute, and lines that route around shapes.

```sh
npm install
npm run dev      # start the editor at http://localhost:5173
npm test         # unit tests (vitest)
npm run build    # type-check and build to dist/
```

## Using it

- **Add shapes:** click one in the left panel, or drag it onto the canvas.
- **Draw arrows:** press **A** (or the Arrow button) and drag — from empty space or from a shape. Drop the
  end on any part of a shape: near its edge it snaps onto the outline, further in it pins exactly there.
  Pinned ends follow the shape when it moves, resizes or rotates. The tool returns to Select after one arrow
  (double-click the Arrow button to keep it on). In the right panel, Routing switches between straight, elbow
  (goes around shapes) and curved (drag the diamond handle to bend it).
- **Pictures:** click **Image** in the left panel to add a PNG, JPEG, GIF, WebP or SVG from your computer.
  It behaves like a shape (rotate, layers, groups, arrows); corners keep its proportions (Shift stretches).
  Pictures are stored inside the document; big ones are shrunk to 2000 px.
- **Edit text:** double-click a shape or line (or press Enter). Esc or Ctrl+Enter finishes. The editor is
  see-through, so you type right on the shape.
- **Add text anywhere:** double-click empty canvas and start typing. The text box grows as you type (Enter
  for a new line); click away to finish. Leave it empty and it disappears.
- **Navigate:** the mouse wheel zooms around the cursor; drag with the right mouse button (or Space+drag, or
  the middle button) to pan; Shift+1 fits.
- **Right-click** for Undo, Redo, Cut, Copy, Paste (at the cursor), Duplicate, Delete, Bring to front and
  Send to back.
- **Pages:** tabs under the canvas — `+` adds a page, double-click renames, Duplicate/Delete on the right.
- **Layers:** in the right panel — click a layer to draw on it, toggle visibility and lock, reorder, rename
  (double-click). Move a selection with the Layer dropdown under Arrange.
- **Rotate:** drag the round handle above a selected shape (Shift = 15° steps), or type an angle.
- **Group / align:** select several items, then Ctrl+G (Ctrl+Shift+G ungroups), or use the Arrange buttons
  to align edges/centers and distribute evenly.
- **Shortcuts:** Ctrl+Z / Ctrl+Shift+Z undo/redo, Ctrl+C / X / V / D, Ctrl+A, Delete, arrows to nudge
  (Shift = 10px), Ctrl+] / Ctrl+[ for z-order, Ctrl+G / Ctrl+Shift+G to group/ungroup, A / V for the
  Arrow / Select tool, Ctrl+S to save.

### Importing a network from CSV

**Import CSV** (toolbar) draws devices and the links between them from a CSV with one row per
link. Headers (any case): `hostName, hostInterface, hostIP, hostPlatform, neighborName,
neighborInterface, neighborIP, neighborPlatform` — only `hostName` and `neighborName` are
required; any other columns are kept as data on the link. Try `samples/network-links.csv`.

- Each device is drawn once (matched by name, ignoring case) with its name, IP and platform;
  each link is a line with the interface names at its ends, next to their device.
- A link reported from both sides (A→B and B→A on the same interfaces) is drawn once; several
  links between the same two devices fan out as curves.
- New devices are laid out automatically; devices already on the page (same name) are reused
  and keep their place, and their fields are updated. Links already drawn aren't added again.
- The dialog shows what will happen first (new / existing devices and links, merged
  duplicates, skipped rows). The whole import is one undo step.

### Graph components (templates)

Style a shape and give it text with CSV column names in braces, e.g. `hostName: {hostName}` /
`IP: {hostIP}` / `platform: {hostPlatform}`, then right-click → **Save as node template**. (A
device that appears as the neighbor in the CSV fills these from its neighborName / neighborIP /
neighborPlatform columns.) Lines work the same way
(use their Start/End label fields, e.g. `{hostInterface}`) → **Save as line template**.
Templates appear under **Graphs** in the left panel, which starts with a ready-made node
(**Device**) and line (**Link**): click or drag a node template to add one;
click a line template to draw arrows with it. Imports let you pick which templates to use.
Items made from a template keep their fields — edit them under **Data** in the right panel —
and follow the template: edit it (⋯ on its tile, or right-click an item) and every item made
from it updates. **Unlink** detaches an item.

Work autosaves to the browser's localStorage (a notice appears if pictures make it too big — then use
**Save**). **Save** / **Open** use `.clearchart.json` files.

## Developer docs

Start with [`CLAUDE.md`](CLAUDE.md) (conventions and gotchas), then:
[architecture](docs/architecture.md) · [interactions](docs/interactions.md) ·
[design decisions](docs/design-decisions.md) · [extending](docs/extending.md) ·
[roadmap](docs/roadmap.md).

## Layout

| Path | What's there |
| --- | --- |
| `src/model/` | Document types, factories, zustand store, undo history (immer patches) |
| `src/shapes/library.ts` | Shape geometry: SVG path, connection ports, text box per kind; sidebar entries |
| `src/connectors/` | Endpoint resolution, straight/elbow routing, connector rendering |
| `src/canvas/` | SVG canvas and pointer interactions, snapping/guides, text wrapping and editing |
| `src/ui/` | Toolbar, shape library, properties panel, keyboard shortcuts |
| `src/io/` | JSON save/load, autosave, SVG/PNG export |

## Not yet built

Real-time collaboration, accounts and sharing, data linking, auto-layout, and other import/export formats
(see [roadmap](docs/roadmap.md)).
# ClearChart
