# Extending ClearChart

Recipes for common changes. After any of them: `npm test`, `npm run typecheck`, and try it
in the browser (`npm run dev`).

## Add a new shape kind

1. **`src/model/types.ts`** — add the name to the `ShapeKind` union.
2. **`src/shapes/library.ts`** — add an entry to `SHAPES`:
   ```ts
   star: {
     path: (w, h) => `M...Z`,          // SVG path in local coords, (0,0)–(w,h)
     ports: sidePorts,                   // or a custom (w, h) => PortDef[]
     textBox: inset(8),                  // area text wraps inside
   },
   ```
   - Ports: `{ x, y, dir }` in local coordinates; `dir` is the unit vector a line leaves in
     (used by elbow routing). Convention: indices 0–3 are top, right, bottom, left. Extra
     ports go after. **Once shipped, only append** — saved connectors reference ports by index.
   - Multiple subpaths are fine (see `cylinder`, `note`), but draw every closed subpath with the
     same winding direction as the body, or the nonzero fill rule leaves unfilled holes.
3. **`LIBRARY`** (same file) — add a sidebar entry: `{ label, category, kind, w, h, style? }`.
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
2. Implement it with `commit((d) => { ...mutate draft... }, mergeKey?)`. Mutate the immer
   draft directly; don't return a new object.
3. Read other state with `get()`. Update non-doc state (selection, viewport) with `set()`.
4. If the action removes items, also prune `selection` and clear `editingId` as needed.
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

Add a function to `src/io/export.ts`. Reuse `buildSvg(doc)` for anything that can derive from
SVG (e.g. PDF via a library drawing the SVG); for data formats (e.g. CSV of shapes, Visio
XML), walk `doc.order` / `doc.items` directly. Wire a button in `ui/Toolbar.tsx` and use
`downloadBlob` + `fileSafe(doc.title)` for the filename.

## Change the document schema

1. Update `types.ts`.
2. If old files can't be read as-is, bump `Doc.version` (types + `emptyDoc`) and add a migration
   in `parseDoc` that upgrades older versions. Autosaved docs in users' localStorage go
   through the same `parseDoc`, so migrations cover them too.
3. Update `sampleDoc()` and `persist.test.ts`.

## Testing

- Tests live next to the module: `src/**/name.test.ts`, run by vitest in a **node**
  environment (no DOM). Keep testable logic in pure modules: `history`, `routing`,
  `geometry`, `snap`, `text`, `persist.parseDoc`.
- `measureText` falls back to `0.55 × fontSize` per character when there's no DOM, so text
  layout tests are approximate.
- The store is a module singleton that reads `localStorage` on import; avoid importing it in
  unit tests, or reset it with `useStore.setState(...)` in `beforeEach`.
- UI behavior has no automated tests in the repo. For end-to-end checks, Playwright against
  `npm run dev` works well (drive `page.mouse`; elements are findable by
  `[data-hit="shape"][data-id="…"]`, `.handle-se`, `[data-hit="port"]`, `.text-editor`).
