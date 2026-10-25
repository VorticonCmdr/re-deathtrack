# Deathtrack browser port

First milestone: an original-resource inspector in HTML, CSS and vanilla JavaScript. The game itself is not ported yet.

## Run

Use Node 20.19+ or 22.12+ and npm:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite, then `viewer.html`. During development the viewer discovers files in `game/`. Alternatively, use **Open game folder**. Folder selection reads files locally in the browser; nothing is uploaded.

- Search/filter all 92 original files.
- View 179 decoded bitmap/screen frames and three font atlases; export PNGs.
- Inspect palette words, chunk trees, text and binary data.
- Play both music tracks using a basic Web Audio synthesizer; export their decompressed MIDI.
- Inspect decompressed maps and title commands.

PC-speaker effects, 3D models, track geometry and title animation execution are not implemented. MIDI playback is a note audition, not authentic Roland MT-32 emulation. See [asset format notes](docs/asset-formats.md) for exact coverage and unknowns.

## Build / GitHub Pages

```sh
npm run build
npm run preview
```

Publish the contents of `dist/` when ready. Relative asset URLs support a GitHub Pages repository subpath. The production bundle contains no original game files and no asset server. Visitors select their own local `game/` folder. No deployment has been configured or performed yet.

`game/`, `node_modules/` and `dist/` are ignored by Git. Do not force-add original resources. No decoded game assets are checked in either.

## Validate formats

```sh
npm run audit:assets
```

This reads local originals, validates chunk bounds/decompression/image dimensions, parses music and reports coverage. It needs `game/`; it is not an emulator or a gameplay test.
