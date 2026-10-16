# Extending ClearChart

Recipes for common changes. After any of them: `npm test`, `npm run typecheck`, and try it
in the browser (`npm run dev`).

## Add a new shape kind

1. **`src/model/types.ts`** — add the name to the `ShapeKind` union.
2. **`src/shapes/library.ts`** — add an entry to `SHAPES`:
   ```ts
   star: {
     path: (w, h) => `M...Z`,          // SVG path in local coords, (0,0)–(w,h)
     outline: (w, h) => [...],           // the same edge as a closed polygon (sample curves)
     ports: sidePorts,                   // or a custom (w, h) => PortDef[]
     textBox: inset(8),                  // area text wraps inside
   },
   ```
   - Outline: arrow ends dropped near the edge snap onto this polygon (`connectors/binding.ts`).
     It must follow the visible path, or ends land off the shape. Use `arc(...)` for curves.
   - Ports: `{ x, y, dir }` in local (unrotated) coordinates; `dir` is the unit vector a line
     leaves in (used by elbow routing). New arrows no longer use ports — they exist for files
     saved before the Arrow tool. Convention: indices 0–3 are top, right, bottom, left.
     **Once shipped, only append** — saved connectors reference ports by index.
   - Multiple subpaths are fine (see `note`), but draw every closed subpath with the
     same winding direction as the body, or the nonzero fill rule leaves unfilled holes.
3. **`LIBRARY`** (same file) — add a sidebar entry: `{ label, category, kind, w, h, style?, shortcut? }`.
   `shortcut` is a number key that arms its draw tool (Basic uses 1–5; `ARROW_SHORTCUT` is 6);
   keep them unique (`library.test.ts` checks). Set `keepAspect: true` on the `SHAPES` entry for
   a kind that should keep its proportions when resized (like `circle` and `image`).
   A new `category` value also needs adding to the `LibraryEntry['category']` union; the
   sidebar groups by category automatically.
4. TypeScript will flag `SHAPES` until the kind has an entry (it's a `Record<ShapeKind, …>`).

## Add a style property (e.g. shape opacity)

1. `types.ts` — add the field to `ShapeStyle` (or `ConnectorStyle`).
2. `model/doc.ts` — add a default to `DEFAULT_SHAPE_STYLE` / `DEFAULT_CONNECTOR_STYLE`.
3. Render it in `canvas/ShapeView.tsx` (or `connectors/ConnectorView.tsx`) as an SVG
   attribute — not CSS — so it survives export.
4. Add a control in `ui/Properties.tsx` using `ColorField` / `NumberField` / `SelectField`,
   calling `styleShapes({ prop }, 'prop')` (pass a merge key for continuous inputs).
5. **Old documents** won't have the field. Either tolerate `undefined` in the view
   (`st.opacity ?? 1`) or fill defaults in `parseDoc` (`io/persist.ts`).

## Add a store action

In `src/model/store.ts`:

1. Declare it in the `State` interface.
2. Implement it with `commitPage((p) => { ...mutate the page draft... }, mergeKey?)` for
   anything on the active page, or `commit((d) => …)` for doc-level changes (title, pages).
   Mutate the immer draft directly; don't return a new object. Use `currentPage(get())` to
   read the page as it is now, and the helpers in `model/page.ts` (`translateItems`,
   `expandGroups`, `layerOf`…) rather than re-deriving layer or group rules.
3. Read other state with `get()`. Update non-doc state (selection, viewport) with `set()`.
4. If the action removes items or hides/locks them, call `pruneSelection()` (or clear
   `selection`/`editingId` yourself).
5. Call it from UI as `useStore.getState().myAction()`.

For a multi-step gesture, call `beginBatch()` first and `endBatch()` / `abortBatch()` at
the end instead of making each step its own action.

## Add a keyboard shortcut

Add a line in `src/ui/shortcuts.ts`. Use the `run(fn)` helper (it calls
`preventDefault`). Put modifier combos inside the `if (mod)` block. Update the shortcut table
in `docs/interactions.md` and the README.

## Add a canvas interaction

1. Add a variant to the `Drag` union in `Canvas.tsx`.
2. Start it in `onPointerDown` — usually keyed off a new `data-hit` value on an overlay
   element. Call `beginBatch()` if it edits the doc.
3. Handle it in `onPointerMove` and finish it in `onPointerUp` (`endBatch()`); clear any
   transient overlay state (guides, hints).
4. Put the visuals in the overlay group, sized with `/ z` so they're constant on screen.
5. Keep math in a pure helper (`geometry.ts`, `snap.ts`, `routing.ts`) and unit-test it.

## Add an export format

Add a function to `src/io/export.ts`. Reuse `buildSvg(page)` for anything that can derive from
SVG (e.g. PDF via a library drawing the SVG; `buildSvg` only works for the page on the
canvas); for data formats, walk each page's `renderOrder` (visible items, paint order) —
`io/vsdx.ts` is a worked example: geometry via `io/svgPath.ts:flattenPath`, line routes via
`connectorPoints`, label positions via `connectors/labels.ts`, packaging via `io/zip.ts`.
Keep the builder pure (bytes in, bytes out) so it can be tested by reading the result back. Wire a button in `ui/Toolbar.tsx` and use
`downloadBlob` + `fileSafe(doc.title)` for the filename.

## Change the document schema

1. Update `types.ts`.
2. Prefer optional fields with a sensible "absent" meaning (as `rotation`, `layerId` and
   `groupIds` do) — then old files need no migration. If old files can't be read as-is, bump
   `Doc.version` (types + `emptyDoc`) and add a migration in `parseDoc` that upgrades older
   versions (see the v1 → v2 page migration). Autosaved docs in users' localStorage go
   through the same `parseDoc`, so migrations cover them too.
3. Update the test fixture (`src/test/exampleDoc.ts`) and `persist.test.ts`.
4. **Removing a shape kind** breaks saved diagrams that use it, unless `parseDoc` maps it to a
   kind that still exists. See `RETIRED_KINDS` in `io/persist.ts`, which keeps the four side
   ports so attached lines survive.

## Testing

- Tests live next to the module: `src/**/name.test.ts`, run by vitest in a **node**
  environment (no DOM). Keep testable logic in pure modules: `history`, `page`, `routing`,
  `geometry`, `transform`, `arrange`, `snap`, `text`, `persist.parseDoc`.
- `measureText` falls back to `0.55 × fontSize` per character when there's no DOM, so text
  layout tests are approximate.
- The store is a module singleton that reads `localStorage` on import (absent in node, so it
  starts from the sample doc). `store.test.ts` drives it through actions after
  `loadDoc(...)`, which resets doc, history and selection; reset other fields with
  `useStore.setState(...)` in `beforeEach`.
- UI behavior has no automated tests in the repo. For end-to-end checks, Playwright against
  `npm run dev` works well (drive `page.mouse`; elements are findable by
  `[data-hit="shape"][data-id="…"]`, `.handle-se`, `[data-hit="cend"]`, `[data-hit="bend"]`, `.context-menu`, `.text-editor`). Use
  the real mouse for right-button drags (`page.mouse.down({ button: 'right' })`) — synthetic
  pointer events can't take pointer capture.

## Add a CSV column or a template field

- **A new link column** needs no code: any column not in `LINK_COLUMNS`
  (`import/links.ts`) is kept in the link's `data` and can be shown with `{columnName}` in a
  line template.
- **A new per-device field** (e.g. `hostSite` / `neighborSite` → `{hostSite}`): add both
  column names to `LINK_COLUMNS` (so they aren't treated as link data), add the host-side name
  to `DEVICE_FIELDS`, and fill it in `buildGraph`'s `device(...)` call, like IP and platform.
  Mention it in the README and in the dialogs' placeholder hint (`ui/TemplateDialogs.tsx`).
- **Renaming a device field** breaks saved documents unless `parseDoc` migrates it — see
  `migrateDeviceFields` in `io/persist.ts` (it renamed the first import's name/ip/platform).
- **A new field in the default templates:** edit `DEVICE_FIELDS_TEXT` / `defaultTemplates()`
  in `model/doc.ts` (only affects documents that don't have templates yet).

## Add a built-in device picture or platform rule

- Add a `device(key, name, rules, frame, body)` entry to `BUILT_IN_DEVICES` in
  `shapes/deviceIcons.ts`. Draw the body on the 64×64 grid with the helpers (`arrow`, `arc`,
  `lines`, `dot`), and set `frame` tightly around it (plus the stroke), so links attach where the
  drawing is. The element's size comes from the frame's aspect ratio. Keep it original line
  art, not vendor artwork.
- Keys are persisted (asset id `builtin-<key>`); names are how **Add built-in devices** tells
  what a document already has. Don't rename either.
- Rules are lower-case substrings; check them against real platform strings in
  `deviceIcons.test.ts` (longer rules win among built-ins, e.g. "c91" over "c9").
- New and changed built-ins only reach new documents, or documents through **Add built-in
  devices**. Existing documents keep the pictures and rules they stored.
