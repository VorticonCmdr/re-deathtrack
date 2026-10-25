# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Browser port of Dynamix/Activision's *Deathtrack* (1989, DOS). Current milestone is only an **asset inspector** ("Asset Garage", `viewer.html`) in vanilla JS + Vite. The game itself is not ported. `index.html` just redirects to `viewer.html`.

## Commands

Requires Node 20.19+ or 22.12+.

```sh
npm install
npm run dev            # Vite on 127.0.0.1; open viewer.html
npm run build          # dist/ (index + viewer entry points, relative base './' for GitHub Pages subpaths)
npm run preview
npm run audit:assets   # structural validation of every file in game/
```

There is no test runner or linter. `npm run audit:assets` is the regression check for format code. Expected output: `{files:92, frames:179, music:2, maps:10, fonts:3, failures:0}`, exit code 1 on any failure. It needs the local `game/` folder.

## Original game files

- `game/` holds the original distribution (92 files, including `DTRACK.EXE`). It is git-ignored. **Never commit or force-add originals or decoded assets**, and never bundle them into `dist/`.
- In dev, a Vite plugin in `vite.config.js` serves `game/` via `/__assets` (JSON listing) and `/__asset/<name>`. The production build has no asset server. Users pick their own folder with the `webkitdirectory` input, and files stay in the browser.
- `ghidra/` holds the local Ghidra project (git-ignored; embeds proprietary binaries). `.local/` holds unpacked executables, Ghidra exports and DOSBox scratch copies (git-ignored).

## Architecture

- `src/formats.js`: pure decoders shared by browser and Node, with no DOM use:
  - `chunks()` parses Dynamix chunk framing: 4-byte tag ending in `:`, then a u32 where bit 31 means container and bits 0–30 give the payload length.
  - `unpack()` reads the compression envelope (method byte + u32 size; 0 = raw, 1 = RLE, 2 = Dynamix LSB-first LZW).
  - `images()` handles `BMP:`/`SCR:` with `INF:` and `BIN:`. `INF:` holds the count, then all widths, then all heights (not interleaved). Pixels are 4bpp, high nibble first.
  - `EGA` holds the preview palette.
- `src/audio.js`: `midiNotes()` (SMF parser, also used by the audit) plus a simple Web Audio oscillator player. `SND:` in `.mus` files decompresses to standard MIDI.
- `src/viewer.js`: the whole UI as one `show(file)` dispatcher. Files are detected by content tag, not extension. `TRK:` files are excluded from chunk parsing because their length field is not valid. `.map` files are bare compression envelopes. A `generation` token cancels stale async renders.
- `scripts/audit-assets.mjs` imports `src/formats.js` and `src/audio.js` directly, so decoder changes must stay Node-compatible.

`docs/asset-formats.md` is the authoritative record of format findings, what is verified versus unknown, and the remaining RE work (PC-speaker SFX in `pals.blk`, `.tbl` models, `.map`/`.trk` track data, `title.ttm` execution, palette state). Update it when format knowledge changes. Don't present guessed semantics as decoded: the viewer deliberately labels unknown formats as raw binary.

## Code style

Code is written in a dense, minified-looking style: many statements per line, terse names, arrow helpers, and almost no comments. Match it when editing these files.
