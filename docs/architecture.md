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

Graph templates add `src/templates/`: pure `rules`, `graph` (parse + plan an import) and
`layout`, plus `store` (the template library, a second zustand store) and `persist`.
`ShapeView` and `model/store` use `templates/rules` for placeholders and part placement;
`ui/TemplateLibrary`, `ui/ComponentDialog` and `ui/ImportDialog` sit on top. See
[Graph templates and import](#graph-templates-and-import).

Not shown: `ui/TabBar` (one tab per open diagram, along the bottom of the canvas),
`ui/libraryActions` (places a sidebar entry: shape, line or image), `ui/ContextMenu` + `ui/canvasMenu` (the
canvas right-click menu), `ui/overlays` + `ui/Overlays` (a small UI store and host for the
component dialogs and toast messages), and the pure helpers `model/groups` and `canvas/wheel`.

`io/export.ts` imports `canvasRefs` from `Canvas.tsx` — the one place non-UI code reaches into
the rendered DOM (see Export below).

## Data model (`src/model/types.ts`)

```ts
Doc       { version: 1, title, items: Record<id, Item>, order: id[],      // order = z-order, back→front
            components?: Record<id, NodeComponent> }                      // definitions used by component shapes
Item      = Shape | Connector                                            // discriminated by `type`
Shape     { id, type:'shape', kind, x, y, w, h, text, style: ShapeStyle,
            src?,                                                        // kind 'image': data URL
            componentId?, data?,                                         // kind 'component': def + record
            groups? }                                                    // group ids, innermost first
Connector { id, type:'connector', source: Endpoint, target: Endpoint, routing, label, style,
            sourceLabel?, targetLabel?, data?, groups? }                 // end labels, e.g. interfaces
Endpoint  { shapeId?, port?, perimeter?, x, y }
NodeComponent { id, name, rule: Rule | null, w, h, parts: Part[] }       // Part = Shape minus id/type/data
Rule      { field, values: string[] }
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
  | Perimeter | `shapeId` + `perimeter`, no `port` | Where the line from the shape's center toward the other end crosses its bounding box (graph import uses this so links fan out instead of sharing 4 ports) |
  | Free | no `shapeId` | Sits at `x, y` in world space |
  `x, y` is meaningful only for free ends; on attached ends it holds a stale value and is ignored.
  If an attached shape is missing, `resolveEndpoint` falls back to treating the end as free.
- **Shape geometry is not stored**, only `kind` + bounds. `SHAPES[kind]` in
  `shapes/library.ts` produces the SVG path, ports and text box from `(w, h)` on demand.
- **`text` kind** is a rect with `fill: 'none'` and `stroke: 'none'`; its path still uses
  `pointer-events="all"` so the transparent interior is clickable.
- **Opacity** is optional style: `ShapeStyle.fillOpacity` (the fill only) and
  `ShapeStyle.opacity` / `ConnectorStyle.opacity` (the whole item), 0–1, missing = 1. They render
  as `fill-opacity` / `opacity` attributes (`ShapeView.opacityAttr` omits them when opaque), so
  export keeps them. Component instances use `style.opacity` too (`styleComponents`).
- **Sidebar entries** (`LIBRARY`) are `ShapeEntry` (a kind + size + style) or `LineEntry`
  (`kind: 'line'`, the Arrow tile, placed by `addLine` as a free connector). Basic entries carry a
  `shortcut` digit. The Rounded rectangle, Ellipse and Note tiles were removed, but those kinds
  stay in `SHAPES` for saved diagrams; Circle is an `ellipse` with equal sides.
- **Groups are lists on the items** (`model/groups.ts`). `item.groups` holds group ids,
  innermost first; grouping appends a new id to every member and ungrouping pops the last
  one, so the members of a group share a tail of their lists and nesting needs no group table.
  The outermost id (`topGroup`) is what a click selects. Deleting members can't leave a dangling
  group, and copies get fresh ids (`remapGroups`) so a pasted group is a new group.

## State (`src/model/store.ts`)

One zustand store holds:

| Field | Persisted? | In undo history? |
| --- | --- | --- |
| `doc` | yes (autosave + files) | yes |
| `history` | no | — |
| `selection`, `editingId` | no | no (selection is pruned of deleted ids after undo/redo) |
| `viewport` `{x, y, zoom}`, `canvasSize` | no | no |
| `tabs`, `activeTab` | yes (autosave) | no |
| `parked` | its docs, yes | — |
| `clipboard` `{ items, components }` | no | no |
| `showGrid`, `snapToGrid` | no | no |

**Tabs.** Each tab is a separate diagram. `doc`, `history`, `selection`, `viewport` and
`editingId` are always the **active** tab's; the others wait in `parked[id]` as
`{ doc, history, selection, viewport }`. `switchTab` ends any open batch, parks the active
tab and unparks the target, so every action and component keeps working on "the" doc and
never needs a tab id. A parked `viewport` of `null` (tabs restored after a reload, new tabs)
means fit to screen when shown. `newTab(doc?)` inserts after the active tab; `closeTab` shows a
neighbour, and closing the last tab leaves a fresh empty one.

**Clipboard.** Shared by all tabs. `copy` snapshots the selected items, turning line ends
attached to shapes outside the selection into free points, and includes the definitions of any
component instances, so `paste` into another tab adds those definitions to its
`doc.components` in the same commit (rule 11). `paste(at)` centers the copies on a point (the
context menu's position); without it they land 20 px from the previous paste.

The template library is a separate store, `useTemplates` in `templates/store.ts`: saved to
`localStorage['clearchart:templates']` on every change, exported/imported as
`clearchart-templates.json`, and **not** part of undo history.

Viewport maps world → screen as `screen = world * zoom + (x, y)`. `Canvas.toWorld` does the
inverse using the svg's bounding rect.

Components subscribe with narrow selectors (`useStore((s) => s.doc)`); actions are invoked
through `useStore.getState().action()` so handlers never close over stale state.

On first import the store loads `loadWorkspace()` (all autosaved tabs) and falls back to one tab
with `sampleDoc()`.

UI state that isn't part of a document (the open component dialog, the toast message, the last
template used) lives in a third small store, `useOverlays` in `ui/overlays.ts`, rendered by
`<Overlays/>` in `App.tsx`. `startNodeComponent`/`startLineComponent` there check the selection
and either open the dialog or show a toast.

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
   - **Overlay** — selection outlines, a dashed box around each fully selected group, 4 corner
     resize handles (single selection only), connection ports for the hovered shape, connector
     end handles, alignment guides, marquee. Sizes are divided by `zoom` so they stay constant
     on screen.
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

- **Autosave:** `useAutosave` in `App.tsx` subscribes to the store. Each tab's doc is stored
  under `localStorage['clearchart:doc:<tabId>']`, written 500 ms after the last change to the
  active doc; parked docs can't change, so only the active tab is ever pending, and switching
  tabs (or `pagehide`) flushes it. `localStorage['clearchart:tabs']` =
  `{ version: 1, tabs, active }` is written whenever tabs open, close or switch; a closed tab's
  key is removed. One key per tab means a full quota fails one tab's save, not all of them.
  `loadWorkspace` skips unreadable tabs and moves the single-diagram autosave
  (`clearchart:doc`, from before tabs) into the first tab; that key is deleted once the index
  and every tab doc are saved. All storage access is in try/catch; failure is silent.
- **Files:** Save downloads `<title>.clearchart.json` (pretty-printed `Doc`). Open reads a
  file through a hidden `<input type=file>` and `parseDoc`, then opens it in a new tab
  (`newTab(doc)`), or in the current one (`loadDoc`) if nothing has been drawn there yet.
- **`parseDoc`** checks `version === 1`, that `items`/`order` exist, and that every id in
  `order` is a shape or connector; malformed `groups` are dropped. It does not deep-validate item fields — it is the place to
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

Images are embedded as data URLs (`io/image.ts` downscales rasters to at most 512 px), so they
export and autosave like any other attribute; large images count against the ~5 MB
localStorage quota.

## Graph templates and import

**Template library.** A `GraphTemplate` is `{ id, name, fields, nodes: NodeComponent[],
links: LinkComponent[] }`. A node component is a snapshot of shapes (text may contain
`{{field}}` placeholders, images allowed) taken from the canvas selection by
`rules.partsFromSelection`; a link component is a `ConnectorStyle` + routing + label template.
Each has a `rule` (`field` is one of `values`, trimmed and case-insensitive) or `null` for the
default. Order within a template is priority: `pickNode`/`pickLink` return the first match,
then the first default, then the caller falls back to a plain box/line. A link rule matches if
either end's record matches.

**Instances.** Placing a component adds a `Shape` with `kind: 'component'`, `componentId` and
optional `data`, and copies the definition into `doc.components` in the same `update()` (so it
undoes together, and a diagram renders without the library). `ShapeView` draws each part with
its box scaled to the instance size (stroke widths and font sizes are not scaled) and fills
placeholders from `data` at render time — the resolved text is derived, never stored. Without
`data` (placed by hand) placeholders stay visible. Ports, hit tests and selection use the
instance's bounding box, like any shape. Saving an edited component also refreshes its copy in
the open doc. **Break apart** (`store.breakApart`) replaces an instance with its parts as plain
shapes, text filled in.

**Import pipeline** (`templates/graph.ts`, all pure):

1. `parseGraph(json)` — `[[nodeA, nodeB], …]` → string records + the union of field names;
   errors name the bad edge.
2. `planImport(doc, edges, template, opts)` — `opts` is the key field, the end-label field and
   the link-only fields (kept out of node data). Nodes are deduped by key value
   (trimmed, case-insensitive), within the file and against shapes already in the doc whose
   `data[key]` matches (those are reused and never moved). A link's identity is the unordered
   pair of keys plus each side's end label, so repeated and reversed rows, and links already
   drawn, are skipped. Returns new shapes, connectors (perimeter ends, end labels, middle label
   from the link component), the component definitions used, and a report.
3. `layoutPlan(doc, plan)` → `layout.forceLayout`: Fruchterman–Reingold over the new nodes,
   with existing neighbors as fixed points. Deterministic: breadth-first seeding beside placed
   neighbors, several seeded attempts for small graphs keeping the one with the fewest crossing
   lines, then overlap removal and grid snapping.
4. `store.importGraph(plan)` commits everything in one `update()` (one undo step), with the new
   lines behind all shapes, then selects the new items and fits the view.

`ImportDialog` runs `planImport` live for its preview and again on Import (against the current
doc), then `layoutPlan` and `importGraph`.
