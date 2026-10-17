# ClearChart

A browser diagramming editor inspired by Lucidchart, built clean-room from its public behavior.
This is the core-editor MVP: canvas, shapes, connectors, styling, save/load and export.

```sh
npm install
npm run dev      # start the editor at http://localhost:5173
npm test         # unit tests (vitest)
npm run build    # type-check and build to dist/
```

## Using it

- **Add shapes:** click one in the left panel, drag it onto the canvas, or press its number with the mouse
  over the canvas: 1 Rectangle, 2 Circle, 3 Triangle, 4 Hexagon, 5 Text, 6 Arrow, 7 Image.
  **Arrow** is a line: drag its ends onto shapes, and change arrows (none/arrow/open) and straight/elbow
  routing in the right panel.
- **Resize:** drag a corner; hold **Shift** to keep proportions (a circle stays a circle). The size shows
  while you drag, so equal sides (a square) are easy to hit.
- **Style:** Fill (background), **Fill opacity** and **Opacity** (whole element) in the right panel; lines
  have Opacity too.
- **Connect:** hover a shape, then drag from one of its blue dots onto another shape. Drop on a dot to
  pin the line to that point, or on the shape's body to let it pick the facing side.
- **Edit text:** double-click a shape or line (or press Enter). Esc or Ctrl+Enter finishes.
- **Navigate:** scroll to zoom (up = in); right-drag, Shift+scroll or Space+drag to pan; Shift+1 to fit.
- **Group:** select things and press Ctrl+G (Ctrl+Shift+G to ungroup). Clicking any member selects
  the group; double-click to pick out one item. Groups can contain groups.
- **Right-click** (without dragging) for undo/redo, copy/paste/duplicate, group/ungroup, z-order, delete,
  and **Create as Node / Line Component** from the selection. The toolbar keeps only file, export and zoom
  buttons.
- **Shortcuts:** Ctrl+Z / Ctrl+Shift+Z, Ctrl+G / Ctrl+Shift+G, Ctrl+C / X / V / D, Ctrl+A, Delete,
  arrows to nudge (Shift = 10px), Ctrl+] / Ctrl+[ for z-order, Ctrl+S to save.
- **Tabs** (along the bottom of the canvas): each tab is its own diagram with its own undo history.
  **New** and **+** open a tab,
  **Open** loads a file into a new tab, middle-click or ✕ closes one. Copy/paste works across tabs.

All open tabs autosave to the browser's localStorage. **Save** / **Open** use `.clearchart.json` files.

### Graph templates (network topology from JSON)

1. **Build a component on the canvas** from shapes, text and images (Image tile, or drop image
   files on the canvas). Put `{{field}}` in text to show node data, e.g. `{{name}}` and `{{ip}}`.
2. In **Graph templates**, click **+ New** to create a template, select your shapes and click
   **+ Node from selection** (or right-click them → **Create as Node Component**, which lets you pick
   or create the template in the dialog). Give it a rule — a field and the values it matches, e.g.
   `platform` is one of `cisco 9200, cisco 9300` — or tick **Default** for everything else.
   Select a line and click **+ Line from selection** for a line component (color, width, pattern,
   label such as `{{cableType}}`) with its own rule. Order is priority: first match wins (▲/▼ to reorder).
3. **Import graph** in the toolbar takes a JSON edge list,
   `[[{"name":"sw1","ip":"…","platform":"cisco 9300","interface":"Gi1/0/1","cableType":"fiber"}, {…}], …]`.
   Pick the template, the field that identifies a device (default `name`), the field shown
   at each line end (default `interface`) and which fields describe the link. Each device is
   drawn once, including devices already on the canvas from an earlier import; repeated links
   are skipped. The whole import is one undo step. Try it with `samples/topology.json`.

Selecting a placed component shows its data in the right panel; **Break apart** turns it back
into ordinary shapes. Templates are saved in the browser and can be exported/imported as a file.

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
| `src/io/` | JSON save/load, autosave, SVG/PNG export, images |
| `src/templates/` | Graph templates: rules, edge-list import planning, force layout, template library |

## Not yet built

Multiple pages per file, layers, rotation, align/distribute, real-time collaboration, accounts and sharing,
data linking beyond JSON edge lists, hierarchical auto-layout, and other import/export formats.
# ClearChart
