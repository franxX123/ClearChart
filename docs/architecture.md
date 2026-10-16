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
        │                       │   model/history  model/doc ──▶ model/page
        ▼                       ▼         │        │
   canvas/geometry ──▶ connectors/routing ──▶ shapes/library ──▶ model/types
   canvas/transform (rotation math; used by geometry and routing)
   canvas/arrange, canvas/snap, canvas/text (leaf helpers)
```

`ui/PageTabs` (under the canvas) and `ui/LayersPanel` (inside `ui/Properties`) also talk to the
store directly.

Arrows point at dependencies. `model/types.ts` and `shapes/library.ts` are leaves; the pure
helpers (`history`, `page`, `routing`, `geometry`, `transform`, `arrange`, `snap`, `text`,
`persist.parseDoc`) have no React dependency and are unit-tested in a node environment.
`canvas/transform.ts` imports only types, so `routing.ts` can use rotation math without a cycle
through `geometry.ts` (which imports routing).

`io/export.ts` imports `canvasRefs` from `Canvas.tsx` — the one place non-UI code reaches into
the rendered DOM (see Export below).

## Data model (`src/model/types.ts`)

```ts
Doc       { version: 2, title, pages: Page[], templates?, assets? }      // ≥ 1 page; assets: id → data URL
Page      { id, name, items: Record<id, Item>, order: id[], layers: Layer[] }  // order = z-order, back→front
Layer     { id, name, visible, locked }                                  // layers[] bottom→top, ≥ 1
Item      = Shape | Connector                                            // discriminated by `type`
ItemBase  { id, layerId?, groupIds? }                                    // groupIds: outermost first
Shape     ItemBase & { type:'shape', kind, x, y, w, h, rotation?, text, style: ShapeStyle }
Shape.image? { src?, asset? }                                           // kind 'image': a data URL, or an id in Doc.assets
Shape.textPosition? 'right'                                             // text drawn right of the box; arrows attach to it too
Connector ItemBase & { type:'connector', source: Endpoint, target: Endpoint, routing, bend?, label, style }
Endpoint  { shapeId?, at?, port?, x, y }                                  // routing: straight | elbow | curved
```

- **Items are stored flat by id per page**, with a separate `order` array. This makes immer
  patches small (`/pages/0/items/abc/x`) and z-order changes cheap. Shapes and connectors
  share one z-order. Item ids are unique within a page; connectors only reference shapes on
  their own page.
- **Layers** are a list per page. Paint order is layer by layer, then `order` within a layer
  (`renderOrder`). An item whose `layerId` is missing or unknown belongs to the bottom layer
  (`layerOf`), so v1 items and stale ids need no fix-up. Hidden layers aren't rendered,
  exported, routed around or hit; locked layers render but can't be hovered, selected or
  attached to (`isInteractive`).
- **Groups** are not items: each item lists the groups it is in, outermost first. Grouping
  prepends a new id to every selected item; ungrouping drops the first. Selection always
  covers whole outermost groups (`expandGroups`), so a group is never half-selected by a
  click or marquee (double-click selects one member to edit its text).
- **Coordinates are world units** (1 unit = 1 CSS px at 100 % zoom). `x, y, w, h` is the
  *unrotated* box; `rotation` (degrees clockwise, absent = 0) turns it about its center.
  Use `canvas/transform.ts` for anything that needs real positions: `shapeBox` (rotated
  bounds), `pointInShape`, `localToWorld`/`worldToLocal`. Ports rotate with the shape, and
  their exit direction snaps to the nearest axis so elbow routing still works.
- **Endpoint states** (checked in this order):
  | State | Fields | Meaning |
  | --- | --- | --- |
  | Pinned | `shapeId` + `at` | At `(at.x·w, at.y·h)` in the shape's unrotated box — on its outline or inside it. All new arrows. |
  | Fixed port (legacy) | `shapeId` + `port` | Pinned to `SHAPES[kind].ports(w,h)[port]` |
  | Floating | `shapeId` only | The side (port) of the shape closest to the other end; lines sharing a side are spread along it. Used by CSV imports (and pre-arrow-tool files). |
  | Free | no `shapeId` | Sits at `x, y` in world space |
  `x, y` is meaningful only for free ends; on attached ends it holds a stale value and is ignored.
  If an attached shape is missing, `resolveEndpoint` falls back to treating the end as free.
- **Shape geometry is not stored**, only `kind` + bounds. `SHAPES[kind]` in
  `shapes/library.ts` produces the SVG path, the outline polygon (where arrow ends snap),
  legacy ports and the text box from `(w, h)` on demand.
- **Pictures** are shapes of `kind: 'image'` carrying `image.src`, a data URL embedded in the
  document (so files are self-contained and export just works). `io/image.ts:readImageFile`
  keeps SVGs and small rasters as-is; rasters over 2000 px or 400 KB are redrawn on a canvas
  (downscaled to 2000 px) and re-encoded as JPEG when fully opaque or PNG otherwise, keeping
  whichever is smaller. `ShapeView` draws an `<image>` plus a border path that takes clicks.
  Pictures resize with their aspect ratio kept. A picture added from the sidebar has no text
  (`setEditing` ignores it); device pictures have text to their right.
- **Stored pictures (`Doc.assets`).** Device pictures are stored once per document as
  `assets[id] = dataUrl`. Elements (`NodeTemplate.image.asset`) and their devices
  (`Shape.image.asset`) refer to them by id, so 100 devices of one model add one picture to
  the file and the autosave. `model/doc.ts:shapeImageSrc` resolves a shape's picture (`src`
  first, then the asset); `Canvas` passes the result to `ShapeView` as `imageSrc`, and
  `exportVisio` decodes each distinct picture once. The store's `pruneAssets` drops assets that
  no element or shape refers to (after an element is deleted or its picture changes). The
  built-in icons (`shapes/deviceIcons.ts`, drawn for ClearChart as SVG line art) are assets
  `builtin-<key>`, stored with each document like any other picture.
- **Text beside a shape (`textPosition: 'right'`).** The text is drawn to the right of the
  box, left-aligned and vertically centered on it, one line per line break
  (`canvas/transform.ts:sideLabelBox`, 8 px gap). Box and text together form the shape's
  **attach frame** (`attachFrame`: a local rect, rotated with the shape), which is the object
  for everything but resizing:
  - `pointInShape` (hit-testing, `findAttachment`) and `shapeExtent` (`itemBounds`, so
    fit-to-view, export bounds, marquee, snapping and the import layout) use the frame.
  - Pinned ends snap onto the frame's rectangle (`binding.ts:localOutline`). Their `at`
    fractions are still of the shape's box, so a point on the text has `at.x > 1` and follows
    moves and resizes.
  - `pinnedDir` uses the frame's nearest side.
  - Floating ends use the frame's side midpoints (`routing.ts:localPorts`, same
    top/right/bottom/left indices) and spread along its sides.
  - `routeObstacles` and the anchors' `box` use the frame's bounds.

  Selection handles stay on the box (they resize the picture). `ShapeView` puts a transparent
  hit rect behind the text and the gap before it, so clicking there selects the device;
  `TextEditor` edits the text in place to the right. Files saved with the first version
  (`'below'`) are migrated to `'right'` by `parseDoc`.
- **Curved lines** store only `bend`: how far the curve's midpoint sits from the straight
  chord. The curve is a quadratic computed from the resolved ends on every render.
- **`text` kind** is a rect with `fill: 'none'` and `stroke: 'none'`; its path still uses
  `pointer-events="all"` so the transparent interior is clickable.
- **Text layout:** `style.textAlign` is `'left'` or `'center'` (absent = center). Text normally
  word-wraps inside the kind's text box. Text boxes made by double-clicking the canvas have
  `autoSize: true`: their `w`/`h` are set from the text by `canvas/text.ts:fitText` (one line
  per `\n`, no wrapping) whenever the text or font changes, and they render with
  `xml:space="preserve"` so typed spaces survive. Resizing by hand clears `autoSize`.

## State (`src/model/store.ts`)

One zustand store holds:

| Field | Persisted? | In undo history? |
| --- | --- | --- |
| `doc` | yes (autosave + files) | yes |
| `history` | no | — |
| `activePageId`, `activeLayerId` | no | no (undo/redo switches to the page it changed) |
| `pageViews` (other pages' viewports) | no | no |
| `selection`, `editingId`, `clipboard` | no | no (selection is pruned of deleted ids after undo/redo) |
| `tool` (`select`/`arrow`), `toolLocked` | no | no |
| `autosaveFull` (last autosave didn't fit) | no | no |
| `viewport` `{x, y, zoom}`, `canvasSize` | no | no |
| `showGrid`, `snapToGrid` | no | no |

Viewport maps world → screen as `screen = world * zoom + (x, y)`. `Canvas.toWorld` does the
inverse using the svg's bounding rect.

Components subscribe with narrow selectors (`useStore(currentPage)`, `useStore((s) => s.selection)`);
actions are invoked through `useStore.getState().action()` so handlers never close over stale
state. `currentPage(s)` / `currentLayer(s)` fall back to the first page / top layer when the
stored id no longer exists, so a stale id never breaks rendering.

Page-scoped actions use `updatePage(recipe)`, which runs `update` on the active page's draft.
Selection is per page and is cleared when switching pages; `pruneSelection` drops ids that
were deleted or became hidden/locked. New items go on the active layer; if it is hidden or
locked, it is made visible and unlocked in the same undo step.

On first import the store loads `loadAutosave()` and falls back to `emptyDoc()` (a blank diagram with
the built-in device elements, the same as New).

**Retired shape kinds.** The Flowchart shapes (`diamond`, `terminator`, `parallelogram`,
`document`, `cylinder`, `subprocess`) were removed. `parseDoc` (`migrateRetiredKinds`) turns
shapes and node elements of those kinds into a `roundRect` (terminator) or a `rect` (the rest).
All of them had the four standard side ports, so lines attached by port or pinned with `at`
stay attached.

## History (`src/model/history.ts`)

Pure functions over `{ past, future, batch }`; the store wraps them.

- `change(doc, h, recipe, key?)` runs `produceWithPatches`. No-op recipes produce no entry.
- History covers the whole `Doc` (all pages). After undo/redo the store reads the entry's
  patch paths (`['pages', i, …]`) and switches to that page, so the change is visible.
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
   - **Content** `<g ref={contentRef}>` — one `<g>` per visible layer (bottom to top) holding
     its items in `order`, rendered by `ShapeView` or `ConnectorView`. Locked layers get
     `pointer-events="none"`. This is exactly what export serializes, so hidden layers are
     never exported.
   - **Overlay** — selection outlines (in each shape's rotated frame), dashed group outlines,
     4 corner resize handles and a rotation handle (single selection only), the attach hint
     (tinted target shape + pinned-point dot) while drawing an arrow, connector end handles,
     the bend handle of a selected curved line, alignment guides, marquee. Sizes are divided
     by `zoom` so they stay constant on screen. The context menu is HTML over the canvas.
3. **`TextEditor`** — an absolutely positioned `<textarea>` over the shape's text box (or the
   connector label), scaled with zoom. While editing, the item's own text is hidden.

Every interactive SVG element carries `data-hit` (`shape`, `connector`, `port`, `handle`,
`cend`) and `data-id`; pointerdown routes on the closest such element (see
`interactions.md`).

The whole page re-renders on every change; `ShapeView` and `ConnectorView` are `memo`ized,
but connector points are recomputed each render (cheap at MVP scale; see `roadmap.md`).
`routeObstacles(page)` is computed once per render and shared by every elbow line.

Text is wrapped manually by `canvas/text.ts:wrapText` using canvas `measureText` (with a
character-width fallback when there's no DOM, e.g. tests) and drawn as `<text>`/`<tspan>`,
vertically centered in the kind's `textBox`.

## Persistence (`src/io/persist.ts`, `src/App.tsx`)

- **Autosave:** `useAutosave` in `App.tsx` subscribes to the store and writes the doc to
  `localStorage['clearchart:doc']` 500 ms after the last doc change. All storage access is in
  try/catch. `saveAutosave` returns false when the doc doesn't fit (browsers allow ~5 MB, and
  pictures are embedded); the store's `autosaveFull` then shows a notice in the toolbar asking
  the user to Save to a file.
- **Files:** Save downloads `<title>.clearchart.json` (pretty-printed `Doc`). Open reads a
  file through a hidden `<input type=file>` and `parseDoc`, then `loadDoc` (which resets
  history and fits the view).
- **`parseDoc`** accepts version 2 (checks there is at least one page, and per page that
  `items`/`order` exist and every id in `order` is a shape or connector; fills in missing
  layers or layer flags) and migrates version 1 files (top-level `items`/`order`) into a single
  "Page 1" with one layer. It does not deep-validate item fields — it is the place to add
  migrations when the schema changes. Autosaves go through it too.

## Export (`src/io/export.ts`)

1. `buildSvg(page)` clones the live content layer (`canvasRefs.content`), strips the invisible
   connector hit paths and `data-*`/`pointer-events` attributes, and wraps it in a standalone
   `<svg>` whose `viewBox` is `docBounds(page)` (visible items) + 20 px padding. Export is per
   page: the active one. With several pages the file name is `<title> <page name>`.
2. **SVG:** serialized with `XMLSerializer` and downloaded.
3. **PNG:** the SVG string is loaded into an `Image` from a blob URL, drawn at 2× onto a
   canvas with a white background, and downloaded via `canvas.toBlob`.

Because export reuses the rendered DOM, it is WYSIWYG for free, but it requires the canvas to
be mounted, and anything in the content layer must be self-contained SVG (inline attributes,
explicit `font-family`) — CSS from `styles.css` is not carried into the exported file.

4. **Visio (.vsdx):** `exportVisio(doc)` covers **every page** and doesn't use the DOM. It
   prepares picture bytes (PNG/JPEG/GIF as they are; SVG/WebP drawn to a canvas as PNG), then
   `io/vsdx.ts:buildVsdx` (pure) writes the OPC package and `io/zip.ts:zip` stores it:
   - one Visio page per page, sized to its visible content + 40 px; px → inches at 96/in, y flipped;
   - each visible shape (in paint order) as a Visio shape: pin at its center, `Angle` from
     `rotation` (sign flipped: Visio is counterclockwise), geometry from its SVG path flattened
     by `io/svgPath.ts` into relative `RelMoveTo`/`RelLineTo` rows (one Geometry section per
     subpath, open ones unfilled), line/fill colors, `*Trans` cells from `opacity`, a text block
     matching the kind's `textBox`, and `data` as a Shape Data (Property) section;
   - pictures as `Foreign` shapes with the image in `visio/media/` (a dashed placeholder box if
     the picture couldn't be read). Each distinct picture is written once (shapes sharing a
     `VsdxImage` object share the media part, with one relationship per page). Text beside a
     shape becomes a left-aligned text block pinned just past its right edge (`TxtPinX` =
     `Width+gap`), and pictures keep their text and Shape Data;
   - each line as a routable 1-D shape (`ObjType` 2) with its current route as geometry; attached
     ends are glued to the shape's sheet (`_WALKGLUE`/`_XFTRIGGER` formulas + `Connects`) so
     Visio keeps them attached; route style from `routing`; arrowheads, dash and opacity mapped;
   - start/end labels as separate small text shapes at the positions `connectors/labels.ts`
     computes for the canvas (Visio connectors have one text block).
   Groups, layers and hidden layers' items are not exported. The package is checked in tests by
   reading it back (`readZip`) and validating every part.

## Templates, item data and CSV import

**Data model.** Any item may carry `data` (string fields) and a `templateId` into
`Doc.templates` (`{ nodes: NodeTemplate[], lines: LineTemplate[] }`, shared by all pages,
saved and undoable). A node template stores a shape kind, size, style and text with `{field}`
placeholders; a line template stores routing, style and label / start-label / end-label
texts. `model/templates.ts:applyTemplate` fills placeholders (case-insensitive) and drops a
text line whose fields are all empty.

**Device elements and platform rules.** A node template may be a picture element
(`image: { asset }`, always `textPosition: 'right'`; its nodes are `kind: 'image'` at the
template's size, and they don't grow with their text) and may carry `platforms` (rule texts).
`templateForPlatform(templates, platform, defaultId?)` picks the element whose rule is the
longest case-insensitive substring of the platform. Elements without `builtIn` are tried first,
so a user's "9300" beats the built-in Switch's "nexus". With no match, it picks
`Templates.defaultNodeId` (else the first element). `matchPlatform` is the same without the
default fallback. Rules apply **live**, but only **positive matches move a device**. The
store's `reassignDevices(d, toDefault)` runs in the same commit as `updateTemplate` (when
rules change), `setDefaultNodeTemplate`, `addBuiltInDevices` and `importLinks`; `setItemData`
does the same inline for `hostPlatform`. It moves every *linked* device whose platform
matches a rule to its best element and restyles it. A device matching no rule keeps its
element: it may have been placed by hand, or its platform may be half-typed (the Data panel
calls `setItemData` on every keystroke, and falling back to the default there turned picture
devices into the default box). It moves to the default only when `toDefault` says the reason
it had its element is gone:
- `setDefaultNodeTemplate`: it was on the old default.
- `updateTemplate`: the element's *old* rules matched it (`rulesMatch`) and the new ones don't.
- `importLinks`: the file changed its platform, or it was on a default the dialog replaced.

Unlinked shapes are never touched. `defaultTemplates()` (`model/doc.ts`) builds the built-in elements from
`shapes/deviceIcons.ts`. Older documents keep their own elements; the store's
`addBuiltInDevices` adds the missing built-ins (by name) on request, keeping the document's
current default.

**Materialized, not computed at render.** A templated item stores the rendered result (its
`text`, labels, kind, style), so rendering, export, hit-testing and old code paths need no
template lookups. The store keeps it in sync: `setItemData` re-renders one item
(`renderNodeText` grows the node to fit, around its center); `updateTemplate` restyles every
item using that template on every page in one commit (`restyleNode`/`restyleLine`, keeping
centers and data; lines fanned out among parallel links stay curved); `deleteTemplate` and
`unlinkTemplate` just drop `templateId`. Text editing is refused for templated items.

**Import pipeline** (all pure except the last step):
1. `io/csv.ts:parseCsv` → header + rows keyed by lower-cased header.
2. `import/links.ts:buildGraph` → devices by key (trimmed, lower-cased name). Device fields
   are named after the host-side columns (`DEVICE_FIELDS`: `hostName`, `hostIP`,
   `hostPlatform`) whichever side of a row the device is on, so node templates use the CSV
   column names; the first non-empty value wins. Then links keyed by the unordered pair of `device|interface` ends, so a
   link reported from both sides is one link (`merged` counts the extra rows). Link data holds
   `hostInterface`/`neighborInterface` (oriented as first seen) and every extra column. Rows
   missing a name, or linking a device to itself, are `skipped` with their line numbers.
3. `import/plan.ts:planImport(page, graph, pickNode, lineTemplate)` (`pickNode(fields)` chooses
   each new device's element, by platform) → which devices exist
   on the page (shapes whose `data.hostName` matches), field updates for them, new nodes
   (`nodeFromTemplate`) placed by `layout/force.ts:forceLayout` (every existing shape is a fixed
   node; free nodes start near the existing devices they link to, else to the right of the
   page's content), and new lines (`lineFromTemplate`) with floating ends; links already drawn
   between the same devices on the same interfaces are skipped, and extra links between a pair
   get alternating bends (`parallelBend`). The layout sizes nodes by their extent (box plus text
   beside it). The summary counts new devices per element (`byTemplate`).
4. `store.importLinks` adds the built-in elements if the doc has no node or line templates,
   makes the dialog's choice for unmatched devices the default element, applies the plan
   (updates, `reassignDevices`, then `addToActiveLayer`) inside one history batch, selects the
   new items and fits the view. `previewImport` runs steps 1–3 for the dialog without
   committing.

**Floating-end spreading.** `connectors/routing.ts:floatingSlots(page)` groups floating ends
by shape side; sides used by several lines spread them along the side (ordered by where each
line heads, projected onto the outline) and give each a rank. `ConnectorView` uses the rank
(`endLabelStacks`) to stack end labels outward from the side (`pointAtDepth`), and moves the
two labels of a too-short line to opposite sides of it. The result is cached per frozen page.
