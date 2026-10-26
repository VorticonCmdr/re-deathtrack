# Circuit Lab track editor

Open `/editor.html` after `npm run dev`. The development server discovers the original circuits in `game/`. In a production build, use **Open game folder** or import individual `.trk` files. Files stay in the browser; no upload is required. New circuits work without original assets.

## Editing a circuit

- Choose a circuit thumbnail, or **+** to create a new loop.
- **Reshape (V):** drag the road to move a bend. The influence slider controls how many neighboring points follow with a soft falloff.
- **Elevation (E):** drag vertically on the road, or drag on the elevation profile. Use the inspector for exact heights, small raises/lowers, or leveling the surrounding road.
- **Scenery (O):** select a model and side, then click the road to place it. Drag a scenery diamond to move it along the route. Select a diamond to change its model/side or delete it. Model numbers correspond to `shape.tbl`; inspect their appearance in the asset viewer.
- **Pan (H):** drag to navigate; hold Space for temporary panning. Scroll to zoom around the pointer, or use the fit button.
- **Smooth selected bend** softens nearby coordinates. **Redistribute points** resamples the entire loop at approximately 30-unit spacing and remaps roadside references.
- Undo/redo, exact point selection and coordinate fields support precise revisions. The **?** button lists keyboard shortcuts.

The elevation profile stays linked to the selected road point. Optional elevation colors and point markers help inspect the layout. **Preview lap** animates a marker along the route; it is a navigation aid, not a physics simulation or drivability test.

## Saving and using tracks

Edits are automatically saved as local browser drafts after each completed action. Drafts depend on the browser and origin (including development port); clearing browser data removes them. **Save project** downloads a portable JSON document. Import that document to continue editing elsewhere. Opening a game folder restores matching local drafts; explicitly importing a file opens that file's contents.

**Export track** downloads the original binary `.trk` format. To try it in the game, make a separate copy of the original game folder, replace a city's `.trk` with the exported file using that city's filename, and select that folder in the browser port. Keep the city's `.map` for its skyline. The editor never overwrites original files. Development auto-loading uses `game/`, so a separate production/preview page is convenient for selecting the modified folder.

The editor does not edit skyline `.map` files, menu names, opponent behavior or race rules. Custom circuits still need playtesting: valid coordinates alone do not guarantee safe corners, scenery clearance or appropriate opponent driving.

## Format safeguards

The writer uses the documented `TRK:` header, roadside table and signed little-endian x/y/z triplets; see [resource layout](re/resources.md). It retains the final two continuation points and adjusts them when the start moves. Redistributing generates fresh continuation samples. Ignored zero-triplet records are preserved on import/export (including Bay Area's padding) until redistribution.

Limits enforced by the editor:

- 5–1,908 retained points including two continuation samples.
- At most 20 roadside objects (a conservative editor limit).
- Signed 16-bit integer coordinates; model IDs 0–123 and valid point references.
- Model 0 only on the right, because the file represents side using the model number's sign.
- No all-zero point after the first two: the game's loader would discard it.

Export blocks invalid data and warns about stretched segments, closing continuity and heights outside the original 0–200 range. Warnings require judgment rather than preventing experimentation. All ten supplied circuits have been checked for byte-identical import/export, including preserved padding. Editor format checks are separate from the game's existing replay verification.
