# Design decisions

Short records of choices that shape the code. Each lists what was chosen, why, and the
trade-off accepted. If you reverse one, update this file.

## 1. Clean-room clone of Lucidchart

**Chosen:** recreate features from Lucidchart's publicly visible behavior and docs. No
decompiled code, copied assets, icons or shape libraries.
**Why:** avoids ToS and copyright problems. All shape geometry in `shapes/library.ts` is
hand-written from first principles.
**Trade-off:** shapes and behaviors are approximations, not pixel matches.

## 2. SVG rendering, not Canvas2D/WebGL

**Why:** native hit-testing per element, crisp text and strokes at any zoom, CSS cursors,
and SVG export by cloning the DOM.
**Trade-off:** slows down with thousands of elements (every item is DOM). Acceptable for
typical diagrams; revisit with virtualization if needed (see roadmap).

## 3. Flat items map + `order` array

**Why:** small immer patches, O(1) lookup by id, z-order changes touch only `order`, and the
structure is CRDT-friendly for future collaboration.
**Trade-off:** nesting isn't expressed structurally; groups are a per-item list (see 15).

## 4. Undo via immer patches, not snapshots

**Why:** memory stays proportional to what changed, and patches are the natural unit for
future sync/collaboration. Batches and merge keys give gesture-level and typing-level undo.
**Trade-off:** every doc mutation must go through `update()`; a direct `set({ doc })` is
invisible to history. The merge window (1 s) is a heuristic.

## 5. Derived geometry is never stored

**Why:** connector routes, ports and shape paths are computed from shape bounds on render, so
moving a shape automatically updates attached lines and there's no cached state to go stale.
**Trade-off:** recomputed every render; fine at MVP scale.

## 6. Arrow ends pin anywhere on a shape (no connection dots)

**Chosen:** Excalidraw-style. An Arrow tool draws from anywhere; a dropped end is stored as
`at`, fractions of the shape's unrotated box. Near the edge it snaps onto the shape's outline
polygon; further in, it pins exactly where dropped. The blue port dots were removed.
**Why:** users wanted to connect to any part of any shape, not to four fixed points, and to
point at things inside pictures. Fractions of the box follow moves, resizes and rotation with
no extra bookkeeping.
**Trade-off:** no automatic "facing side" — an end stays where it was pinned even if the other
shape moves behind it. Files from before keep their `port`/auto-port ends, so port indices
are still persisted and a kind's port list must stay append-only.

## 7. Deleting a shape detaches its lines instead of deleting them

**Why:** matches Lucidchart and avoids surprising data loss; ends are frozen at their last
position (`deleteSelection` in `store.ts`).
**Trade-off:** can leave orphaned lines the user must clean up.

## 8. Corner-only resize handles

**Why:** originally, side-midpoint handles would have sat on the connection ports. Ports are
gone now (6), so edge handles could be added.
**Trade-off:** you can't resize a single edge; corners move two edges.

## 9. Simple elbow routing first, A* only when it collides

**Why:** a 20 px stub plus case analysis gives clean, predictable results for typical
flowcharts and is cheap, so it stays the default. Only when that route crosses a shape do we
run A* over a sparse orthogonal grid (obstacle edges + endpoints) with a bend penalty. Lines
that were fine before phase 2 render exactly as they did.
**Trade-off:** routes are recomputed every render (A* only for colliding lines); shapes more
than 200 px outside the endpoints' box are ignored, and tightly packed shapes (gaps under
the 10 px clearance) fall back to the direct route. Rotated shapes are avoided by their
axis-aligned bounds.

## 10. Manual text wrapping with `<text>`, not `<foreignObject>`

**Why:** `foreignObject` content is unreliable when an SVG is rasterized through `<img>` for
PNG export and in other SVG consumers. Measuring with canvas `measureText` keeps export
faithful.
**Trade-off:** no rich text (per-span styles, lists, links) yet; center alignment only.

## 11. Arrowheads drawn as paths, not `<marker>`

**Why:** markers can't inherit the line color portably (`context-stroke` support varies),
and markers complicate export. Paths computed in `ConnectorView` match the line exactly; filled
heads also retract the line end so its butt doesn't poke through the tip.

## 12. Export clones the live DOM

**Why:** WYSIWYG with zero duplicated rendering code.
**Trade-off:** export requires the mounted canvas (`canvasRefs.content`), and content-layer
markup must not depend on page CSS.

## 13. Pages wrap the old document shape

**Chosen:** `Doc { version: 2, pages: Page[] }`, each page with its own `items/order/layers`;
`parseDoc` migrates v1 files into one page. One history covers the whole doc, and undo/redo
switches to the page it changed.
**Why:** a page is exactly the MVP document, so every pure helper only changed `doc` → `page`.
One history keeps undo simple and matches Lucid's behavior.
**Trade-off:** export is per page (the active one); connectors can't link shapes on different
pages; selection doesn't survive a page switch.

## 14. Single global zustand store, actions read `getState()`

**Why:** minimal boilerplate, selectors keep re-renders narrow, and pointer handlers stay
correct across renders by reading current state rather than closures.
**Trade-off:** the store is a module singleton (one editor per page, and tests of the store
would share state — current tests only cover pure modules).

## 15. Groups as a per-item `groupIds` list, not group items

**Chosen:** each item carries `groupIds` (outermost first); there is no group object.
**Why:** keeps `items` a flat map of drawable things (nothing to skip in rendering, routing,
hit-testing or export), nested groups fall out naturally, and grouping/ungrouping are small
patches on the members. Copying remaps group ids so copies form their own group.
**Trade-off:** a group has no properties of its own (name, rotation, resize as a unit), and
group z-order isn't kept contiguous.

## 16. Layers by `layerId` reference with a bottom-layer fallback

**Chosen:** `Page.layers[]` plus an optional `layerId` on items; unknown or missing ids mean
"bottom layer". Z-order stays one `order` array, painted layer by layer.
**Why:** no migration for existing items, deleting/reordering a layer is a small patch, and a
stale id can never orphan an item. Visibility and lock are document state (saved, undoable).
**Trade-off:** `bringToFront` reorders within a layer only, and layer membership must be
resolved through `layerOf` rather than read directly.

## 17. Rotation stored on the shape, everything else derived

**Chosen:** `rotation` (degrees, absent = 0) about the center; `x/y/w/h` stay the unrotated box.
Ports, hit tests, bounds and resize go through `canvas/transform.ts`.
**Why:** the shape library's local geometry is untouched, rendering is one SVG transform, and
text/ports rotate for free. Port directions snap to the nearest axis so elbow routing keeps
working.
**Trade-off:** alignment, snapping and routing use the rotated shape's axis-aligned bounds,
which are larger than the shape at non-right angles. Groups can't be rotated as a unit.

## 18. The wheel zooms; panning is a drag

**Chosen:** the plain mouse wheel always zooms around the cursor; panning is a right-button
drag (or middle-button / Space + left drag). A right-click without movement opens the context
menu, decided on pointerup after a 4 px threshold.
**Why:** requested — wheel-to-zoom is what users of map-like canvases expect, and it frees the
right button for panning.
**Trade-off:** on trackpads, two-finger scrolling zooms instead of panning. Undo/redo and z-order
moved out of the toolbar into shortcuts and the right-click menu, so they are less visible.

## 19. Pictures are embedded data URLs, downscaled on the way in

**Chosen:** `image.src` is a data URL inside the document; big rasters are shrunk to 2000 px
and re-encoded (JPEG when opaque).
**Why:** files and autosaves stay self-contained (no asset server, no broken links), immer
patches and undo work unchanged, and SVG/PNG export embeds the picture for free.
**Trade-off:** documents grow with every picture, and browser autosave (~5 MB) can fill up —
the toolbar then warns to Save to a file. Copying a picture duplicates its data.

## 20. Template output is stored on items, and kept in sync by the store

**Chosen:** an item made from a template stores its rendered text, labels and look, plus
`templateId` and `data`; the store re-renders on data or template changes.
**Why:** every existing consumer (rendering, export, hit-testing, routing, copy/paste) keeps
working on plain items with no template lookups, and undo of a template change is one patch set.
**Trade-off:** a templated item's text can't be hand-edited (it would be overwritten), and
style edits on one item last only until its template changes.

## 21. Imported links use floating ends, spread along shared sides

**Chosen:** imported lines attach without `at`/`port`, so each end uses the side facing the
other device; several lines on one side are spread out and their labels stacked.
**Why:** auto-laid-out diagrams get moved around; floating ends keep links tidy as devices
move, and spreading keeps interface labels readable on busy switches.
**Trade-off:** dragging an end pins it (`at`) and it stops spreading; spreading is computed
per render (cached per page).

## 22. Deterministic force-directed layout, existing shapes fixed

**Chosen:** Fruchterman–Reingold with spiral start positions (no randomness), every existing
shape fixed, then an overlap-removal pass and grid snapping.
**Why:** the same file gives the same picture (testable, no surprises on re-import), and a
re-import never moves what the user already arranged.
**Trade-off:** O(n²) per iteration (fine for hundreds of devices); it optimizes distances, not
crossings or tiers.

## 23. Visio export writes the package directly, with no dependencies

**Chosen:** `io/vsdx.ts` writes the .vsdx XML parts itself and `io/zip.ts` stores them in a ZIP
without compression; shape outlines are our SVG paths flattened to polylines; lines are
master-less routable connectors glued with Visio's own glue formulas.
**Why:** no library dependency or server, deterministic output that unit tests can read back and
validate, and every shape kind (including pictures and rotated shapes) exports the same way.
**Trade-off:** files are larger than Visio's own (no compression); curves are polylines, so
resizing in Visio scales them but doesn't keep "true" arcs; connectors aren't Visio's "Dynamic
connector" master, so some Visio connector menus may differ. It was validated structurally
(ZIP, XML, relationships, content types) — not by opening in Visio during development.

## 24. Opacity fades the whole item

**Chosen:** one `opacity` (0–1) per shape or line style, rendered as an SVG `opacity` attribute
on the item's group, so fill, border, text, arrowheads and labels fade together (and SVG/PNG/Visio
exports keep it).
**Why:** the common case ("fade this out") with one control; works the same for pictures.
**Trade-off:** no separate fill-only transparency (a fill color with alpha could add that later).

## 25. Device pictures: generic built-ins plus uploads, stored once

**Chosen:** the built-in device icons are simple line art drawn for ClearChart. Real product
pictures come from the user (**+ Device picture**). Pictures live once in `Doc.assets`, and
elements and devices refer to them by id.
**Why:** vendor icons and product photos are copyrighted; bundling them would break the
clean-room rule. Storing by reference keeps a 100-switch import from storing the same photo
100 times in files and the ~5 MB browser autosave.
**Trade-off:** a device picture copied to another document travels as an asset reference, so
pasting into a document without that asset shows an empty picture. Assets are pruned only
after element changes, not after deleting devices, so a deleted device's unused picture stays
until the next element change.

## 26. Platform rules: longest substring, your elements first, applied live

**Chosen:** an element's rules are plain texts matched as case-insensitive substrings of
`hostPlatform`; the longest matching rule wins, but the user's own elements are tried before
the built-in ones; new devices from an import that match nothing get the default element.
Rule, default and platform changes move linked devices immediately, but only toward a
**positive match**. A device matching no rule keeps its element, except devices on the old
default (when the default changes) and devices an edited rule used to match.
**Why:** platform strings vary ("N9K-C93180YC-FX", "cisco WS-C2960X-48FPD-L", "Nexus 9300"),
and substrings cover them without regex. Plain longest-match would let generic built-in words
("nexus", 5 letters) beat a user's specific model ("9300", 4), so the user's elements come
first. Live application makes the panel the single place to decide how devices look. Falling
back to the default on *any* non-match was tried first. It turned a hand-placed picture into
the default box as soon as the first letter of a platform was typed, since the Data panel
applies each keystroke.
**Trade-off:** a matching rule still overrides a hand-picked element (unlink to keep a look).
Typing a platform can pass through a shorter match on the way, e.g. "Catalyst" shows the
built-in Switch before "C9300" reaches the user's element. A device whose platform stops
matching through a data edit keeps its old element until a rule or the default changes.

## 27. Text beside a shape, and arrows attach to it as part of the shape

**Chosen:** `textPosition: 'right'` draws the text to the right of the shape's box. The box
and the text together form one **attach frame**, which is hit-tested, attached to (pinned ends
snap onto it, floating ends use its sides), measured and routed around. Selection handles stay
on the box. Pinned ends keep storing `at` as fractions of the box, beyond 1 on the text.
**Why:** requested. A first version put the text below the picture and attached links to the
picture only. Users read a device as picture plus name, so they expect to drop an arrow on
either, and text on the right keeps diagrams with many devices compact vertically. One frame
makes every consumer (attaching, ports, spreading, obstacles, bounds) agree without special
cases. Files from the first version are migrated (`'below'` → `'right'`) on load.
**Trade-off:** floating ends are centered on the whole block, so a line from the top or bottom
meets it between the picture and the text, and one from the right meets the text's edge. The
text is unwrapped, so very long values make wide devices. The Visio export glues lines to the
shape sheet, so Visio re-routes them to the picture when shapes move there.
