# Architecture

## Module dependencies

```
                 main.tsx → App.tsx
                               │
        ┌──────────────┬───────┴────────┬───────────────┐
     ui/Toolbar   ui/ShapeLibrary   canvas/Canvas   ui/Properties      ui/shortcuts
        │              │            │   │    │           │                 │
        │              │   ShapeView│   │    │TextEditor │                 │
        │              │            │ ConnectorView      │                 │
        ▼              ▼            ▼   ▼    ▼           ▼                 ▼
   io/export ──▶ io/persist     ┌──────── model/store (zustand) ◀──────────┘
        │                       │         │        │
        │                       │   model/history  model/doc
        ▼                       ▼         │        │
   canvas/geometry ──▶ connectors/routing ──▶ shapes/library ──▶ model/types
   canvas/snap, canvas/text (leaf helpers)
```

Arrows point at dependencies. `model/types.ts` and `shapes/library.ts` are leaves; the pure
helpers (`history`, `routing`, `geometry`, `snap`, `text`, `persist.parseDoc`) have no React
dependency and are unit-tested in a node environment.

`io/export.ts` imports `canvasRefs` from `Canvas.tsx` — the one place non-UI code reaches into
the rendered DOM (see Export below).

## Data model (`src/model/types.ts`)

```ts
Doc       { version: 1, title, items: Record<id, Item>, order: id[] }   // order = z-order, back→front
Item      = Shape | Connector                                            // discriminated by `type`
Shape     { id, type:'shape', kind, x, y, w, h, text, style: ShapeStyle }
Connector { id, type:'connector', source: Endpoint, target: Endpoint, routing, label, style }
Endpoint  { shapeId?, port?, x, y }
```

- **Items are stored flat by id**, with a separate `order` array. This makes immer patches
  small (`/items/abc/x`) and z-order changes cheap. Shapes and connectors share one z-order.
- **Coordinates are world units** (1 unit = 1 CSS px at 100 % zoom). `x, y` is the top-left
  corner; there is no rotation yet.
- **Endpoint has three states:**
  | State | Fields | Meaning |
  | --- | --- | --- |
  | Fixed port | `shapeId` + `port` | Pinned to `SHAPES[kind].ports(w,h)[port]` |
  | Auto port | `shapeId`, no `port` | Uses whichever of the shape's ports is closest to the other end |
  | Free | no `shapeId` | Sits at `x, y` in world space |
  `x, y` is meaningful only for free ends; on attached ends it holds a stale value and is ignored.
  If an attached shape is missing, `resolveEndpoint` falls back to treating the end as free.
- **Shape geometry is not stored**, only `kind` + bounds. `SHAPES[kind]` in
  `shapes/library.ts` produces the SVG path, ports and text box from `(w, h)` on demand.
- **`text` kind** is a rect with `fill: 'none'` and `stroke: 'none'`; its path still uses
  `pointer-events="all"` so the transparent interior is clickable.

## State (`src/model/store.ts`)

One zustand store holds:

| Field | Persisted? | In undo history? |
| --- | --- | --- |
| `doc` | yes (autosave + files) | yes |
| `history` | no | — |
| `selection`, `editingId`, `clipboard` | no | no (selection is pruned of deleted ids after undo/redo) |
| `viewport` `{x, y, zoom}`, `canvasSize` | no | no |
| `showGrid`, `snapToGrid` | no | no |

Viewport maps world → screen as `screen = world * zoom + (x, y)`. `Canvas.toWorld` does the
inverse using the svg's bounding rect.

Components subscribe with narrow selectors (`useStore((s) => s.doc)`); actions are invoked
through `useStore.getState().action()` so handlers never close over stale state.

On first import the store loads `loadAutosave()` and falls back to `sampleDoc()`.

## History (`src/model/history.ts`)

Pure functions over `{ past, future, batch }`; the store wraps them.

- `change(doc, h, recipe, key?)` runs `produceWithPatches`. No-op recipes produce no entry.
- Each entry keeps forward `patches` and `inverse` patches. Undo applies `inverse`,
  redo applies `patches`. The stack is capped at 200 entries (`MAX_ENTRIES`).
- **Batch:** while `h.batch` is open, patches accumulate into it (inverse patches are
  *prepended*, so undoing replays them in reverse order). `endBatch` pushes it as one entry;
  `abortBatch` applies its inverse to the doc and drops it (used to cancel a click-on-port that
  didn't become a line).
- **Merge key:** a non-batched change whose `key` matches the last entry's key within
  `MERGE_WINDOW_MS` (1 s) is folded into that entry. Used for color pickers, number fields,
  label/title typing and arrow-key nudges.
- Any new change clears `future` (standard linear history).

## Rendering (`src/canvas/Canvas.tsx`)

The canvas is one `<svg>` filling its container, with the HTML text editor positioned on top:

1. **Grid** — a `<pattern>` in screen space whose `patternTransform` follows the viewport.
   Minor lines are hidden below 50 % zoom.
2. **World group** `transform="translate(x y) scale(zoom)"`, containing:
   - **Content** `<g ref={contentRef}>` — every item in `doc.order`, rendered by `ShapeView`
     or `ConnectorView`. This is exactly what export serializes.
   - **Overlay** — selection outlines, 4 corner resize handles (single selection only),
     connection ports for the hovered shape, connector end handles, alignment guides,
     marquee. Sizes are divided by `zoom` so they stay constant on screen.
3. **`TextEditor`** — an absolutely positioned `<textarea>` over the shape's text box (or the
   connector label), scaled with zoom. While editing, the item's own text is hidden.

Every interactive SVG element carries `data-hit` (`shape`, `connector`, `port`, `handle`,
`cend`) and `data-id`; pointerdown routes on the closest such element (see
`interactions.md`).

The whole doc re-renders on every change; `ShapeView` and `ConnectorView` are `memo`ized,
but connector points are recomputed each render (cheap at MVP scale; see `roadmap.md`).

Text is wrapped manually by `canvas/text.ts:wrapText` using canvas `measureText` (with a
character-width fallback when there's no DOM, e.g. tests) and drawn as `<text>`/`<tspan>`,
vertically centered in the kind's `textBox`.

## Persistence (`src/io/persist.ts`, `src/App.tsx`)

- **Autosave:** `useAutosave` in `App.tsx` subscribes to the store and writes the doc to
  `localStorage['clearchart:doc']` 500 ms after the last doc change. All storage access is in
  try/catch; failure is silent.
- **Files:** Save downloads `<title>.clearchart.json` (pretty-printed `Doc`). Open reads a
  file through a hidden `<input type=file>` and `parseDoc`, then `loadDoc` (which resets
  history and fits the view).
- **`parseDoc`** checks `version === 1`, that `items`/`order` exist, and that every id in
  `order` is a shape or connector. It does not deep-validate item fields — it is the place to
  add migrations when the schema changes.

## Export (`src/io/export.ts`)

1. `buildSvg` clones the live content layer (`canvasRefs.content`), strips the invisible
   connector hit paths and `data-*`/`pointer-events` attributes, and wraps it in a standalone
   `<svg>` whose `viewBox` is `docBounds(doc)` + 20 px padding.
2. **SVG:** serialized with `XMLSerializer` and downloaded.
3. **PNG:** the SVG string is loaded into an `Image` from a blob URL, drawn at 2× onto a
   canvas with a white background, and downloaded via `canvas.toBlob`.

Because export reuses the rendered DOM, it is WYSIWYG for free, but it requires the canvas to
be mounted, and anything in the content layer must be self-contained SVG (inline attributes,
explicit `font-family`) — CSS from `styles.css` is not carried into the exported file.
