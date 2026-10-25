# Deathtrack browser port

A faithful port of Dynamix/Activision's *Deathtrack* (1989, DOS) to HTML, CSS and vanilla JavaScript. The game logic is translated function by function from the original executable and runs against an emulated real-mode memory image and EGA hardware model. Original files are required and never bundled.

Status, verified scenarios and limitations: [docs/STATUS.md](docs/STATUS.md).

## Run

Requires Node 20.19+ or 22.12+ and your own copy of the game in `game/` (the supported build is listed in `src/data/manifest.json`).

```sh
npm install
npm run dev        # open the printed URL; viewer.html is the asset inspector
```

- **Controls:** mouse for menus. In a race: Up/Down to accelerate and brake, Left/Right to steer, Space to fire, number keys for weapons, Esc for the in-race menu, P to pause.
- **Demo mode:** `?args=demo`.
- **Hardware options:** `?video=cga` (CGA, 640x200 two-colour), `?sound=adlib` (OPL2 music), `?sound=mt32` (MIDI to a Web MIDI output you connect). The default is EGA with the PC speaker.
- **Best-effort mode:** `?mode=demo` reports unsupported paths instead of stopping.
- **Production:** `npm run build` writes `dist/` without any game files. Visitors select their own game folder, and nothing is uploaded.

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
