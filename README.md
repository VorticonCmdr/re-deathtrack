# Deathtrack browser port

A faithful port of Dynamix/Activision's *Deathtrack* (1989, DOS) to HTML, CSS and vanilla JavaScript. The game logic is translated function by function from the original executable and runs against an emulated real-mode memory image and EGA hardware model. Original files are required and never bundled.

Status, verified scenarios and limitations: [docs/STATUS.md](docs/STATUS.md).

## How to play

**Play online: <https://www.decompile.tools/re-deathtrack/>**

1. You need your own copy of *Deathtrack* (PC, 1989). The game files are not included and cannot be downloaded here. The supported build is listed in [`src/data/manifest.json`](src/data/manifest.json).
2. Open the page in a desktop browser (Chrome, Edge or Firefox) and click **Open Deathtrack folder**.
3. Select the folder that contains `DTRACK.EXE` and the other game files. They are read locally in your browser and are never uploaded.
4. Click or press a key once to enable sound (browsers start audio only after you interact with the page).

**Controls**

| Where | Input |
|-------|-------|
| Menus | Mouse |
| Race | Up / Down: accelerate / brake · Left / Right: steer · Space: fire · number keys: select weapon |
| Race | Esc: in-race menu · P: pause |

**Options** (add to the URL, e.g. `…/re-deathtrack/?video=cga`):

- `?args=demo`: attract-mode demo.
- `?video=cga`: CGA graphics instead of EGA.
- `?sound=adlib` (AdLib/OPL2 music), `?sound=mt32` (default: Web MIDI output if connected, otherwise a built-in approximate synth), `?sound=speaker` (PC speaker only). `?synth=builtin` forces the built-in synth.
- `?mode=demo`: best-effort mode that reports unsupported paths instead of stopping.

Other pages on the same site: [`remaster.html`](https://www.decompile.tools/re-deathtrack/remaster.html) (modern championship), [`viewer.html`](https://www.decompile.tools/re-deathtrack/viewer.html) (asset inspector) and [`editor.html`](https://www.decompile.tools/re-deathtrack/editor.html) (track editor). Each one asks for the same game folder. The vehicle editor needs the local Node server and does not work on the hosted site.

## Run locally

Requires Node 20.19+ or 22.12+ and your own copy of the game in `game/` (the supported build is listed in `src/data/manifest.json`).

```sh
npm install
npm run dev        # open the printed URL; game/ is served automatically, no folder prompt
```

- The URL options and controls are the same as above.
- **Production:** `npm run build` writes `dist/` without any game files. Visitors select their own game folder, and nothing is uploaded. Every push to `main` deploys `dist/` to GitHub Pages (`.github/workflows/pages.yml`).

## Modern championship

Open `/remaster.html` for the independent Babylon.js remaster. Race all ten original cities against nine original named rivals, track season standings, and defend your title at a higher difficulty. Practice lets you choose any circuit. Choose Hellcat, Crusher or Pitbull, upgrade six component families, buy finite ammunition, upgrade lasers, particle beams, rockets and homing missiles, repair damage and use live pits. Cash, equipment and championship progress save locally, separately from the faithful port at `/`.

Arrows/WASD drive, **1–7 / X** selects a weapon, **F** fires, **T** cycles missile targets, Space is the handbrake, **E** enters a marked pit when stopped, **C** changes camera, **P / Esc** pauses and **Q** recovers. **R** restarts practice or retires the current championship round. Modern physics run at 60 Hz. See [scope, controls and limitations](docs/remaster.md).

## Asset viewer

Open `/viewer.html` to browse images/fonts with palette selection, all 136 rotatable models, ten road layouts with elevation and roadside-model links, and ten skyline panoramas. `pals.blk` exposes eleven playable effects with WAV export using the translated sound interpreter. Music has note timelines/MIDI export; the title script and high-score file have structured views.

The viewer works with a selected local folder in production too. Models are rendered for inspection, not pixel-identically to the game; music auditions use simple synthesis. See [format coverage and limitations](docs/asset-formats.md).

## Track editor

Open `/editor.html` for **Circuit Lab**: a canvas editing workspace with circuit thumbnails, soft-falloff road and elevation brushes, roadside placement, undo/redo, local drafts, and original `.trk` export. Start from an original circuit or create a new loop. See [the editor guide](docs/track-editor.md) for controls, saving and playtesting exports.

## Verify

```sh
npm run verify           # asset identity, unit tests, closed-loop race replay against DOSBox checkpoints
npm run verify:browser   # real Chrome: boot -> menus -> race with keyboard and mouse
npm run audit:assets     # structural audit of the original resource files
```

The race replay needs a local DOSBox capture, recreated with the recipe in `docs/scenarios/demo-race-start.json`.

## Documentation

- `docs/re/identity.md`: executable identity, the patched byte, the address mapping, and the hardware boundary.
- `docs/porting-conventions.md` and `docs/TRANSLATION_BRIEF.md`: how translated code is written.
- `docs/re/environment.md`: external inputs, the timing model, and the documented approximations.
- `docs/re/{graphics,input-timer-sound,resources,gameflow,race}.md`: analysis notes.
- `docs/asset-formats.md`: resource formats used by the asset inspector.

`game/`, `ghidra/`, `.local/` (unpacked executables, exports, captures) and `dist/` are git-ignored. Never commit original or derived game data.

The remaster now includes rear-deployed mines and caltrops (6/7 + F), passive ram/wheel spikes, three-model garage upgrades and pit resupply. Tyre damage affects grip and persists between events.

Gun models II/III are now available in the garage. Rivals have distinct equipment and pace, safer overtaking decisions and less aggressive contact/hazard damage. Reproduce AI balance measurements with `node scripts/measure-remaster-balance.mjs 3 900` (local game files required).

Crests now launch cars into gravity-driven jumps with landing feedback. The live rear-view mirror shows pursuing rivals; toggle it in Settings. Weapon instruments sit on the right between race time and speed.

Remaster controls: **J** toggles autopilot (driving input immediately takes over; weapons remain manual). **H** cycles Full / Minimal / Hidden HUD. Settings offers individual display toggles, remembered on this device.

**Driver & saves** manages your driver name, portable save exports/imports and recovery copies. **Continue career** opens the saved championship garage. One active driver is kept per practice/career mode; exported files can hold additional careers. Saves contain progress, not original game assets, and resume between events rather than mid-race.

**Archive** contains the original rival biographies, ten track dossiers with circuit/pit maps, and a rotatable Hellcat/Crusher/Pitbull showroom. Supply the complete original folder for portraits and city illustrations; these optional images are never embedded in the project.

Archive also includes **Driver statistics** and **Top money winners**: current-career/season figures, local remaster earning records, and the original read-only HI_SCORE table when supplied. Original cash records and remaster career earnings are labeled separately.

**Title & credits** presents original artwork and contributors. **Watch demo** runs a separate race without changing your saves. **Sound on** enables audio; Settings has independent music/effects volumes. Include DANGER.MUS and TRAX.MUS for synthesized playback of the original menu/race music.

Settings → **Controls & comfort** adds keyboard rebinding, reduced camera shake/speed zoom and standard gamepad race controls. Connect a controller and press a button to detect it; release sticks/buttons to arm. Menus and confirmation dialogs remain keyboard/mouse-operated.

### Vehicle Foundry

`npm run vehicle:studio` opens a local Node-backed vehicle authoring workspace at
`http://127.0.0.1:5188/vehicles.html`: four wireframe views, component/vertex editing,
mirroring, history and JSON/OBJ export. Open original vehicles from `game/` or import
`.TBL` files, edit existing geometry/colors, and export original-format copies. The shared MCP is available with
`npm run vehicle:mcp`; `npm run vehicle:tool -- vehicle_list '{}'` calls it through
a real client. See [editor and MCP setup](docs/vehicle-editor.md). Custom vehicle
race integration is separate from authoring.
