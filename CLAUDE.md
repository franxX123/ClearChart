# ClearChart — notes for Claude and contributors

ClearChart is a browser diagramming editor modeled on Lucidchart's public behavior
(clean-room: no Lucid code, assets or shape libraries). Current state: core editor plus
phase 2 — shapes, connectors, styling, undo/redo, JSON save/load, SVG/PNG export, multiple
pages, layers (hide/lock), grouping, rotation, align/distribute, obstacle-avoiding elbow lines,
an Excalidraw-style Arrow tool (ends pin anywhere on a shape; straight/elbow/curved), embedded
pictures, wheel zoom / right-drag pan, a right-click menu, and **CSV network import** with
node/line **templates** (custom components) and force-directed layout.

**Stack:** React 19 + TypeScript 7 + Vite 8, zustand (state), immer (patches for undo),
nanoid (ids), vitest (tests). No backend, no CSS framework, no UI library.

```sh
npm run dev        # editor at http://localhost:5173
npm test           # vitest, node environment (no DOM)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build
```

## Where things live

| Path | Responsibility |
| --- | --- |
| `src/model/types.ts` | The document schema (`Doc` → `Page` → `Layer`/`Item`; `Shape`, `Connector`, `Endpoint`). Start here. |
| `src/model/doc.ts` | Defaults, factories (`makeShape`, `makeConnector`), `isShape`/`isConnector`, sample doc |
| `src/model/page.ts` | Pure page helpers: layers (`layerOf`, `renderOrder`, `isInteractive`), groups (`expandGroups`, `groupUnits`), copying |
| `src/model/history.ts` | Pure undo/redo over immer patches: `change`, batches, merge keys |
| `src/model/store.ts` | The single zustand store: doc + history + UI state (active page/layer), and every action |
| `src/shapes/library.ts` | Per-kind geometry (`SHAPES`: path, outline polygon, legacy ports, text box) and sidebar entries (`LIBRARY`) |
| `src/shapes/deviceIcons.ts` | Built-in device pictures (own line art) and their starting platform rules |
| `src/connectors/routing.ts` | Endpoint resolution, straight/elbow (A* around shapes)/curved routing, attach hit-testing |
| `src/model/templates.ts` | Node/line templates: `{field}` placeholders, making and restyling items from templates, defaults |
| `src/io/csv.ts` | RFC 4180 CSV parser |
| `src/io/vsdx.ts`, `zip.ts`, `svgPath.ts` | Visio export: document → .vsdx parts (pure), stored-ZIP writer/reader, SVG path flattening |
| `src/connectors/labels.ts` | Where a line's middle and end labels go (shared by the canvas and the Visio export) |
| `src/import/links.ts`, `plan.ts` | Links CSV → device/link graph (dedupe, merge reciprocal rows) → what to add/update on a page |
| `src/layout/force.ts` | Deterministic force-directed layout for imported devices |
| `src/connectors/binding.ts` | Pinned arrow ends: snap onto a shape's outline, pinned point/direction as the shape moves |
| `src/connectors/ConnectorView.tsx` | Line, arrowheads, label rendering |
| `src/canvas/Canvas.tsx` | SVG canvas, all pointer interactions (Select/Arrow/Place tools, pan, context menu), overlay (selection/handles/guides) |
| `src/canvas/{geometry,snap,text}.ts` | Pure helpers: hit tests & bounds, alignment snapping, text wrap |
| `src/canvas/transform.ts` | Rotation math (leaf module): local↔world, rotated bounds, `resizeRect`, `snapAngle` |
| `src/canvas/arrange.ts` | Align/distribute offsets |
| `src/canvas/ShapeView.tsx`, `TextEditor.tsx` | Shape rendering; HTML textarea overlay for in-place text editing |
| `src/ui/` | Toolbar (tools, Import CSV), shape library (+ Graphs templates), properties (+ Data) + layers panels, page tabs, context menu, dialogs (`Modal`, `ImportDialog`, `TemplateDialogs`, opened via `dialogState.ts`), keyboard shortcuts |
| `src/io/` | JSON file save/open, localStorage autosave, SVG/PNG/Visio export, picture loading (`image.ts`) |

## Rules that are easy to break

1. **All document changes go through `useStore.getState().update(recipe, mergeKey?)`**
   (the `commit` function in `store.ts`), or `updatePage(recipe)` for edits to the active
   page — which is almost all of them. Never `set({ doc })` directly except in
   `undo`/`redo`/`loadDoc` — doing so bypasses history and silently breaks undo.
2. **Continuous gestures are batched.** Drag/resize/connect call `beginBatch()` on start,
   `update()` on every move, and `endBatch()` (or `abortBatch()` to cancel) on release, so the
   whole gesture is one undo step. Forgetting `endBatch` leaves history in batch mode.
3. **High-frequency input edits pass a merge key** (e.g. `styleShapes({ fill }, 'fill')`).
   Edits with the same key within 1 s collapse into one undo entry. Discrete toggles
   (bold, arrow type) pass no key.
4. **In event handlers and store actions, read state via `useStore.getState()`**, not from
   values captured at render time — handlers in `Canvas.tsx` are created per render but
   pointer sequences span many renders.
5. **`Doc` must stay plain JSON**: no class instances, Maps, Dates or functions. It is
   serialized to files and localStorage and diffed by immer.
6. **Derived data is never stored.** Connector geometry is recomputed from shapes on every
   render via `connectorPoints(page, c)`. Don't cache points in the doc.
11. **Respect layers and groups in hit-testing.** Anything that picks items (hover, attach,
    marquee, select all) must skip hidden and locked layers (`isInteractive`), and pressing
    an item selects its whole outermost group (`expandGroups`). Rotated shapes are hit-tested
    with `pointInShape` and measured with `shapeBox`, never with raw `x/y/w/h`.
12. **Templated items are derived from template + `data`.** An item with a `templateId` gets
    its look and text/labels from `Doc.templates` and its own `data`; they're stored
    (materialized) but must be re-rendered whenever either changes — use `setItemData`,
    `updateTemplate` and the `restyle*`/`render*Text` helpers in `model/templates.ts`, never
    write `text`/labels of a templated item directly (`setEditing` refuses them).
13. **Don't name two files in one folder alike except for case** (e.g. `dialogs.ts` and
    `Dialogs.tsx`): Windows file systems are case-insensitive and imports resolve to the
    wrong one.
7. **Canvas layers:** everything inside `contentRef` (`<g ref={contentRef}>` in `Canvas.tsx`)
   is what SVG/PNG export clones. Editor-only visuals (selection, handles, guides, attach
   hints, marquee) belong in the overlay group after it. Content must look right as standalone SVG
   (use attributes, not CSS classes from `styles.css`).
8. **Pointer capture retargets `click`/`dblclick` to the `<svg>`.** Use
   `document.elementFromPoint` or a geometric hit test (`hitShape`), not `e.target`, in any
   handler that fires after a pointerdown on the canvas.
9. **Arrow ends are pinned with `at`** (fractions of the shape's unrotated box); new code
   never writes `port`. But files from before the Arrow tool still store `port: number` into
   the shape's `ports()` array, so **port indices remain persisted**: never reorder or remove
   an existing kind's ports (append only, top/right/bottom/left = 0–3). Every kind also needs
   an `outline` polygon that matches its path, or arrow ends snap to the wrong edge.
10. **Keyboard shortcuts must ignore typing**: the global handler in `ui/shortcuts.ts`
    bails out when focus is in an input/textarea/select. Keep that for any new handler.
11. **Pictures may be stored by reference.** `Shape.image` is `{ src }` or `{ asset }` (an id
    into `Doc.assets`); read it through `shapeImageSrc(shape, doc.assets)`, never `image.src`
    alone. Shapes with `textPosition: 'right'` draw text outside their box, and box + text form
    one attach frame (`attachFrame`): hit-test with `pointInShape`, measure with `shapeExtent`,
    snap ends with `binding.ts` (`localOutline`/`localFrame`), never with raw `x/y/w/h`.

## Definition of done

`npm test` and `npm run typecheck` pass, `npm run build` succeeds, and the change has been
tried in the browser (create/move/connect/undo the thing you touched). Pure logic
(routing, snapping, history, parsing) gets unit tests next to the module (`*.test.ts`).

## Deeper docs

- `docs/architecture.md` — data model, state flow, rendering layers, history, persistence, export
- `docs/interactions.md` — canvas pointer state machine, hit routing, snapping, attaching, shortcuts
- `docs/design-decisions.md` — why things are built this way, and the trade-offs accepted
- `docs/extending.md` — recipes: new shape, new style property, new action/shortcut, schema change
- `docs/roadmap.md` — known limitations and where future features (pages, collaboration…) plug in
