# Deathtrack asset formats and viewer

The port is playable; most resource layouts are now established by the translated loaders and renderer. The inspector at `viewer.html` exposes those layouts without starting a race. This replaces the initial inspector's “unknown map/model/effect” status.

Use `npm run dev`, then open `/viewer.html`. Local development discovers `game/`. A production build requires **Open game folder** and reads the selected files locally; nothing is uploaded. Decoded resources are generated in memory and exported only on request. Original and decoded assets remain excluded from the repository and production bundle.

## Coverage

Counts refer to the 92-file distribution in `src/data/manifest.json`.

| Resource | Established content | Inspector |
| --- | --- | --- |
| `*.bmp`, `*.scr`, `bitmaps.blk`, `activisi`, bitmap in `pals.blk` | 179 packed-color frames altogether | Image previews, palette selection, native-resolution PNG export |
| `fonts.blk` | Three monochrome fonts, 96 glyphs each | Glyph atlases and PNG export |
| `PAL:` in `pals.blk` and `activisi` | Three EGA palettes plus CGA mapping data | Actual EGA color mapping, all 64 words, CGA bytes, JSON |
| `SND:IBM:` in `pals.blk` | Eleven PC-speaker effect programs | Play/seek, WAV export, command listings, selectable device timing |
| `danger.mus`, `trax.mus` | Standard MIDI inside compressed `SND:` | Basic note audition, note timeline/JSON, complete MIDI export |
| Ten `*.map` files | Six skyline strips each, 1920×25 panorama | Scrollable panorama, individual strips, PNG and decoded bytes |
| Ten `*.trk` files | Road centreline, elevation, roadside object references | Top-down layout, elevation profile, point selection, object table and model links, PNG/JSON |
| Thirteen `*.tbl` files | 136 models, 1,195 groups, 3,525 faces | Model selection, rotation/tilt, auto-rotation, wireframe, structure, PNG/JSON |
| `title.ttm` | 477 decoded bytes, 88 commands in 13 parts | Command disassembly, part filter, referenced-asset links, JSON/bytes |
| `hi_score` | Ten 19-byte name/winnings records | File-order table and JSON |
| BAT/BAK/DIZ/PST distribution text | Text and DOS-era glyphs | Text preview (Windows-1252 approximation) and raw bytes |
| Executables, empty marker, other files | Raw data; executable used by port | Byte inspection and original download |

The original-byte inspector and download remain available alongside decoded previews. `*.RCT` save schemas are documented in [resources](re/resources.md#writes-save-games-and-hi_score), but the viewer does not yet provide a save editor or semantic save preview.

## Using the viewer

- Search filenames or filter by extension. Names from a selected folder are resolved case-insensitively for companion resources.
- Images and model previews use an embedded palette when present, otherwise the main palette from `pals.blk`, otherwise standard EGA. Choose a different palette explicitly to inspect alternate states. Selection redraws the current previews and affects PNG output.
- A `.map` is **not a road map**: use **Open track layout** to view the corresponding `.trk`. Roadside labels are zero-based `shape.tbl` indices. Open the object table and select a model to inspect it.
- Model 0 is the sole preview model in each driver/car file. `shape.tbl` has indices 0–123. Geometry-only inspection excludes normal vectors from camera-fit bounds.
- Effect playback requires both the supported `pals.blk` and `DTRACK.EXE`. Other assets do not require the executable. A missing/mismatched executable produces a playback message; command inspection still works.
- Switching assets stops audio and auto-rotation, and releases effect audio URLs. No inspector operation writes to the game's saves or source files.

## Chunk framing and compression

Integer fields are little-endian unless specified otherwise. A resource chunk is a four-byte ASCII tag ending in `:`, followed by a uint32 size/flags field. Bit 31 marks a container; bits 0–30 give payload length, excluding the eight-byte header. A file may contain several top-level chunks. The chunk tree reports absolute file offsets. `TRK:` and save-file `RAC:` signatures do **not** use this framing.

The compression envelope consists of a method byte, uint32 decoded length and encoded data:

- Method 0: raw bytes.
- Method 1: RLE. Controls 1–127 copy literals; controls 129–255 repeat the next byte `control & 127` times; 128 does nothing.
- Method 2: Dynamix LZW. LSB-first codes begin at 9 bits and grow to 12; 0–255 are literals, 256 resets the dictionary, 257 is the first dictionary entry. Reset padding differs from GIF. The inspector stops at the declared output length and rejects invalid codes/lengths; the original stream reader has slightly different EOF handling.

The earlier independent JavaScript decoder remains in `src/formats.js`. [Resource analysis](re/resources.md#decompression-compared-with-srcformatsjs) records byte-for-byte agreement with the translated stream implementation across all 58 local LZW streams, including two reset codes. The updated audit also validates semantic layouts downstream of decompression.

## Images, fonts and palettes

### BMP and SCR

`BMP:INF:` contains uint16 frame count, all widths, then all heights (not interleaved width/height pairs). `BIN:` holds the compression envelope. Decoded pixels are top-down, two per byte, high nibble first. All local widths are even. `SCR:BIN:` decodes to 32,000 bytes for a 320×200 screen. These are not Windows BMPs.

`bitmaps.blk` contains 78 frames in several BMP containers. The global 179-frame total also includes three pointer frames in `pals.blk` and the logo screen in `activisi`. PNG exports use native dimensions; CSS scales previews with nearest-neighbor sampling. Compositing, transparency and aspect-ratio correction are not applied by the image inspector.

### Fonts

Each `FNT:` payload begins with bytes `{width, height, firstCharacter, count}`, followed by glyph rows, MSB first. The three fonts are 4×5, 6×6 and 8×8, all beginning at character 32 with 96 glyphs. Sizes are 484, 580 and 772 bytes: `4 + count × height × ceil(width/8)`. The viewer inserts spacing in its glyph atlases.

### EGA palettes

`PAL:EGA:` is 128 bytes / 64 words. `29f6:225b` transforms each word to `(lo & 15) | ((hi >> 4) << 8)` in two drawing tables. `29f6:22c9` activates the first 16 colors using their low nibbles. IRGB values 8–15 become attribute codes 0x10–0x17 in the 200-line mode, where bit 4 means intensity and color 6 is brown. The inspector uses this 16-color mapping instead of treating all 64 words as display colors.

Words 16–31 and 48–63 participate in drawing remaps/dither pairs. The inspector exposes all words but does not reproduce the driver's dither patterns. CGA data is inspectable/exportable, but CGA image conversion is left to the playable port. See [graphics](re/graphics.md) and `src/game/{egadrv,cgadrv}.js` for adapter behavior.

## MAP: race skylines

All ten files use method-2 compression and decode to 24,026 bytes:

| Offset | Field |
| --- | --- |
| 0 | uint16 strip count, 6 |
| 2 | Six uint16 widths in **bytes**, 160 each |
| 14 | Six uint16 heights, 25 each |
| 26 | Six 4,000-byte packed-pixel strips |

Each strip is 320×25; concatenating them horizontally yields 1920×25. The race renderer wraps the strip index as the camera turns. The viewer preserves strip order and provides both a scrollable joined panorama and individual-strip exports. The loader is `1000:1208`, the EGA consumer `2f73:000f`.

## TRK: road geometry and scenery

A `TRK:` header is followed by uint16 object count, then that many `{uint16 pointIndex, int16 signedShape}` records. The remainder is `{int16 x,y,z}` centreline points, six bytes each. From the third record onward the loader drops all-zero points. The shipped tracks have 877–1,892 retained points. Points are roughly 30 units apart; z is height.

The sign of a shape chooses side: positive is left, non-positive is right; absolute value is a `shape.tbl` model index. From point `p` and its successor `q`, left-side placement is `(p.x + 8*(p.y-q.y), p.y + 8*(q.x-p.x), p.z)`; the right side reverses the lateral displacement. All object references are validated against the parsed model table in the audit.

The viewer plots the actual point sequence, colors it by elevation, adds a profile and exposes exact point/object coordinates. It does not invent road widths, collision shapes or terrain meshes. See `1000:4fae` and `2524:18f4` / [track analysis](re/resources.md#trk).

## TBL: 3D models

All thirteen files share the same format. `shape.tbl` contains 124 models; the nine driver and three player-car files contain one each. The race uses `shape.tbl` for all cars and objects; the individual files serve shop/driver previews. TBL files do not contain car statistics.

1. The file begins with relative far pointers `{uint16 offset, uint16 paragraph}` terminated by a zero dword. Model byte offset is `paragraph*16 + offset`.
2. A model begins with int16 radius, one reserved byte, uint8 vertex count (including normals), and uint16 model-relative vertex-array offset. Vertices are signed x/y/z words.
3. LOD entries `{uint16 threshold, uint16 detailOffset}` follow at +6, terminated by 0xffff. Every local model has one entry `(1, 0x0c)`.
4. A detail block has flags, reference-vertex byte and model-relative group offsets terminated by 0xffff. Flag bit 7 suppresses drawing.
5. A group has flags, sort-vertex byte and model-relative face offsets terminated by 0xffff.
6. A face has normal-vertex index (0xff means two-sided), two color bytes and vertex indices terminated by 0xff.

The inspector validates pointer bounds, normal/face indices, reference and sort vertices, and exposes both colors in JSON/structure views. Its rotatable display is an **orthographic inspection renderer**, with average-depth painter ordering and the first color's low nibble. It does not claim to match the game's group sorting, backface test, near clipping, perspective or two-color rasterization. The playable port implements these in `src/game/render3d.js`, `raceview.js` and the adapter drivers. See [model layout](re/resources.md#tbl-shapetbl-driver-and-car-tables).

## PC-speaker effects

`pals.blk` contains a `SND:` container. `INF:` gives count 11; `IBM:` unpacks to 501 bytes. The first eleven dwords are offsets to streams. Each stream has an eight-byte header `{type, length, 0, 0}` (all type 0), followed by commands.

Commands use `opcode & 0x7e` and usually a uint16 operand. Fields include duration (02), divisor (04), pitch slide (06), gate (0a), phase step (1c), wave depth (1e) and loop counter (20). Wave select is 2e; relative call is 7a, hold is 7c (no operand), loop is 7e. Duration zero ends the voice. Bits/sign comparisons and wrap behavior matter: see [effect tick](re/input-timer-sound.md#effect-tick-334e0000-di-based-register-code).

The viewer does **not** implement a second effect interpreter. `src/viewer/effects.js` loads the supported executable with `createMachine`, copies/relocates the bank into a private inspection memory image, starts one voice using `f334e_01d3` and calls `f334e_0078` tick by tick. This preserves the missing-ITM behavior: wave(0) reads the relocated IBM table and bank bytes. The chosen inspection segment is above the range where that quirk could change the shipped effects. No game loop, storage or filesystem write runs.

Tick timing is selectable: PC speaker `1193182/4096` Hz, AdLib `1193182/8192` Hz, MT-32 `1193182/512` Hz. This changes effect duration, not the output hardware: all three options audition the **speaker effect**. The waveform follows the port's approximate square-wave/one-pole-low-pass output with rates above 15 kHz silenced. WAV exports are mono 44.1 kHz, 16-bit PCM. They are synthesized auditions, not sampled original audio or reference-verified analog output.

All eleven effects terminate and produce non-silent PCM at all three timing settings. Streams 7 and 10 contain trailing unreachable bytes, shown separately from their reachable command listing.

## MIDI music

Both `.mus` resources decode directly to standard MIDI format 0, one track, 96 ticks per quarter note. MIDI header fields are big-endian.

| File | MIDI bytes | Notes | Event duration |
| --- | ---: | ---: | ---: |
| `danger.mus` | 2,807 | 299 | 32.2 s |
| `trax.mus` | 44,814 | 5,924 | 99.5 s |

The inspector's simple Web Audio audition handles tempo changes, running status, note on/off and velocity. It does not synthesize the Roland SysEx, instruments or controller changes. Export retains the **complete original MIDI**, and note JSON/timeline make its structure inspectable. For the translated AdLib driver or external MT-32 output, run the playable port with its hardware options; see [hardware paths](re/hardware-paths.md).

## Title script and scores

`title.ttm` is a compressed `TTM:` leaf. The indexer `2524:0a7c` sizes ASCII opcodes; `2524:0c66` executes each part ending in `/`. Resource loads have NUL-terminated filenames; other commands have zero, one, two or four word operands. The viewer follows the translated indexer's sizes and shows offsets, part numbers, operation names and signed arguments. All 477 bytes are consumed into 88 commands / 13 parts. Resource links include DYNAMIX.BMP, CITYLINE.BMP, TITLE.BMP and CITYPIC.SCR. Execution/timing stays in the game, rather than a second title animator in the viewer.

`hi_score` is ten records of 15 name bytes (NUL-terminated within the field) and uint32 winnings. The table is displayed in **file order**, matching the format; the game's insertion logic does not maintain a sorted file. JSON preserves slot indices.

## Validation and boundaries

`npm run audit:assets` uses the inspector parsers across the full local distribution and checks sizes, pointer/index bounds, track-to-model references, MIDI parsing, title-command coverage and effect termination/non-silent PCM. Expected totals:

```
92 files; 179 image frames; 3 fonts; 3 palettes; 2 music tracks;
10 skylines / 60 strips; 10 tracks; 136 models / 1195 groups / 3525 faces;
11 effects at 3 timing settings; 88 script commands; 10 high-score records;
0 failures.
```

`npm run verify` remains the port's asset-identity, module and DOSBox-scenario check. `npm run build` checks both game and viewer bundles. Browser inspection exercises model selection/wireframe, track links, panorama, effect playback and title disassembly. These checks establish parser/UI behavior, not pixel-perfect inspector rendering or audio fidelity.

The primary local references are [resource loaders](re/resources.md), [graphics](re/graphics.md), [input/timer/sound](re/input-timer-sound.md) and the translated functions they identify. Initial LZW/bitmap investigation also consulted the public [ScummVM DGDS decompressor](https://github.com/scummvm/scummvm/blob/master/engines/dgds/decompress.cpp) and [image loader](https://github.com/scummvm/scummvm/blob/master/engines/dgds/image.cpp); Deathtrack-specific schemas now come from this port's executable analysis.
