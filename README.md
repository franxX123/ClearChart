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

- **Add shapes:** click one in the left panel, or drag it onto the canvas.
- **Connect:** hover a shape, then drag from one of its blue dots onto another shape. Drop on a dot to
  pin the line to that point, or on the shape's body to let it pick the facing side.
- **Edit text:** double-click a shape or line (or press Enter). Esc or Ctrl+Enter finishes.
- **Navigate:** scroll or Space+drag to pan, Ctrl+scroll to zoom, Shift+1 to fit.
- **Shortcuts:** Ctrl+Z / Ctrl+Shift+Z, Ctrl+C / X / V / D, Ctrl+A, Delete, arrows to nudge (Shift = 10px),
  Ctrl+] / Ctrl+[ for z-order, Ctrl+S to save.

Work autosaves to the browser's localStorage. **Save** / **Open** use `.clearchart.json` files.

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

Multiple pages, layers, grouping, rotation, align/distribute, real-time collaboration, accounts and sharing,
data linking, auto-layout, and other import/export formats.
# ClearChart
