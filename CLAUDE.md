# ClearChart — notes for Claude and contributors

ClearChart is a browser diagramming editor modeled on Lucidchart's public behavior
(clean-room: no Lucid code, assets or shape libraries). Current state: single-page core
editor MVP — shapes, connectors, styling, undo/redo, JSON save/load, SVG/PNG export — plus
nested grouping, a right-click menu (right-drag pans), tabs (one diagram per tab), number-key
shape shortcuts, fill/element opacity, images and **graph
templates**: reusable components with match rules, used to build network topology diagrams
from a JSON edge list (Import graph).

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
| `src/model/types.ts` | The document schema (`Doc`, `Shape`, `Connector`, `Endpoint`). Start here. |
| `src/model/doc.ts` | Defaults, factories (`makeShape`, `makeConnector`), `isShape`/`isConnector`, sample doc |
| `src/model/history.ts` | Pure undo/redo over immer patches: `change`, batches, merge keys |
| `src/model/store.ts` | The single zustand store: active tab's doc + history, parked tabs, UI state, every action |
| `src/model/groups.ts` | Pure group helpers: `item.groups` lists, expand selection, group/ungroup, remap on copy |
| `src/shapes/library.ts` | Per-kind geometry (`SHAPES`: path, ports, text box) and sidebar entries (`LIBRARY`) |
| `src/connectors/routing.ts` | Endpoint resolution, straight/elbow routing, attach hit-testing |
| `src/connectors/ConnectorView.tsx` | Line, arrowheads, label rendering |
| `src/canvas/Canvas.tsx` | SVG canvas, all pointer interactions, overlay (selection/handles/ports/guides) |
| `src/canvas/{geometry,snap,text,wheel}.ts` | Pure helpers: hit tests & bounds, alignment snapping, text wrap, wheel zoom/pan |
| `src/canvas/ShapeView.tsx`, `TextEditor.tsx` | Shape rendering; HTML textarea overlay for in-place text editing |
| `src/ui/` | Toolbar, tab bar, shape library sidebar, properties panel, keyboard shortcuts |
| `src/ui/ContextMenu.tsx`, `canvasMenu.ts` | Right-click menu component; the canvas menu's items |
| `src/ui/libraryActions.ts` | `placeEntry`: puts a sidebar entry (shape, Arrow line, image) on the canvas; digit-key lookup |
| `src/ui/overlays.ts`, `Overlays.tsx` | Small UI store + host: component dialogs, toast messages, selection checks |
| `src/io/` | JSON file save/open, per-tab localStorage autosave, SVG/PNG export, image file reading |
| `src/templates/types.ts`, `rules.ts` | Graph template types; rule matching, `{{field}}` placeholders, selection → component parts |
| `src/templates/graph.ts` | Edge-list parsing (`parseGraph`), import planning/dedupe (`planImport`), `layoutPlan` |
| `src/templates/layout.ts` | Pure force-directed layout used by import |
| `src/templates/store.ts`, `persist.ts` | The template library: its own zustand store, localStorage + file import/export |
| `src/ui/TemplateLibrary.tsx`, `ComponentDialog.tsx`, `ImportDialog.tsx`, `Modal.tsx` | Template sidebar section and dialogs |

## Rules that are easy to break

1. **All document changes go through `useStore.getState().update(recipe, mergeKey?)`**
   (the `commit` function in `store.ts`). Never `set({ doc })` directly except in
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
   render via `connectorPoints(doc, c)`. Don't cache points in the doc.
7. **Canvas layers:** everything inside `contentRef` (`<g ref={contentRef}>` in `Canvas.tsx`)
   is what SVG/PNG export clones. Editor-only visuals (selection, handles, ports, guides,
   marquee) belong in the overlay group after it. Content must look right as standalone SVG
   (use attributes, not CSS classes from `styles.css`).
8. **Pointer capture retargets `click`/`dblclick` to the `<svg>`.** Use
   `document.elementFromPoint` or a geometric hit test (`hitShape`), not `e.target`, in any
   handler that fires after a pointerdown on the canvas.
9. **Port indices are persisted.** A connector stores `port: number` into the shape's
   `ports()` array. Changing the order/count of an existing kind's ports breaks saved
   diagrams — append only, and keep the top/right/bottom/left convention for indices 0–3.
10. **Keyboard shortcuts must ignore typing**: the global handler in `ui/shortcuts.ts`
    bails out when focus is in an input/textarea/select or inside a `.modal` or
    `.context-menu` (only the digit shape keys pass through sliders/checkboxes, which don't
    take digits). Keep that for any new handler.
11. **Templates live outside the doc.** The library (`templates/store.ts`) is shared across
    diagrams and has no undo. A placed component is a `Shape` of kind `component` whose
    definition is *copied* into `doc.components` in the same `update()` that adds it, so
    diagrams stay self-contained. Never render from the library; render from `doc.components`.
12. **`doc`, `history`, `selection`, `viewport` are the active tab.** Other tabs sit in
    `parked` and only `newTab`/`switchTab`/`closeTab` touch it; every other action works on the
    active tab, and nothing outside the store should read or write `parked` docs. Anything that
    can move items between tabs (the clipboard) must carry the component definitions with them.
13. **Selection acts on whole groups.** Code that selects by pointer (press, marquee, right-click)
    goes through `expandToGroups`/`wholeGroupsOnly`; code that clones items calls
    `remapGroups`. Only double-click selects a single member.

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
