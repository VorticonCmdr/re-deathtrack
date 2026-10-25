# Deathtrack asset formats

Findings from the 92 files in this local Deathtrack (1989) distribution. Multi-byte integer fields are little-endian unless stated otherwise. Extensions are not reliable format identifiers. The viewer reads original bytes at runtime; no converted assets are needed.

## Coverage

| Files / resource | Observed representation | Viewer support |
| --- | --- | --- |
| `*.bmp` | `BMP:` containers, `INF:` dimensions, compressed `BIN:` pixels | All frames, PNG export |
| `*.scr` | `SCR:` container, compressed `BIN:` | 320 × 200 image, PNG export |
| `bitmaps.blk` | Multiple consecutive `BMP:` containers | All 78 frames |
| `fonts.blk` | Three consecutive `FNT:` chunks | Three glyph atlases |
| `pals.blk` | `SND:`, two `PAL:` containers and one `BMP:` container | Palette words and three sprites; effects not playable |
| `activisi` | `PAL:` and `SCR:` containers | Logo screen, palette word inspection |
| `danger.mus`, `trax.mus` | Compressed `SND:` containing standard MIDI | Synthesized audition and `.mid` download |
| `*.map` | Compression envelope without chunk header | Decompression, byte inspection/download; map semantics unknown |
| `*.trk` | `TRK:` signature followed by binary records | Raw inspection only; not a standard chunk container |
| `*.tbl` | Untagged binary data | Raw inspection; model/table layout unresolved |
| `title.ttm` | Compressed `TTM:` command stream | Decompression, byte inspection/download; commands not executed |
| `*.exe`, `DTRACK.EX_` | DOS executable images | Raw inspection/download; never executed |
| `*.bat`, `demo.bak`, `file_id.diz`, `tetris.pst` | DOS text / distribution material | Text and raw preview; legacy glyphs may differ |
| `hi_score` | 190-byte state file | Raw inspection; fields unresolved |
| `Deathtrack (1989).ba1` | Empty distribution file | Listed and downloadable |

## Chunk framing

A chunk has a four-byte ASCII tag ending in `:`, then a 32-bit length/flags field. Bit 31 marks a container. Bits 0–30 give payload length, excluding the eight-byte header. Containers contain complete child chunks. More than one top-level chunk may occur in a file. The parser rejects truncated headers and out-of-range lengths.

`TRK:` files are an exception: their following bytes are records, not a valid chunk length.

## Compression envelope

Compressed leaves start with a method byte and a uint32 decoded length, followed by compressed bytes:

- `0`: uncompressed bytes.
- `1`: byte run-length encoding. Values 1–127 copy that many literals; 129–255 repeat the following byte `control & 127` times; 128 is a no-op.
- `2`: LSB-first LZW, initially 9-bit codes, growing to 12 bits. Literals are 0–255, reset is 256, first dictionary entry is 257. No GIF end marker is required; the declared output length terminates decoding. Reset padding and dictionary-width timing follow the Dynamix variant.

The decoder validates output size and limits decoded allocations to 16 MiB. All local image, music, title-script and map streams decode without errors. This establishes structural validity, not complete semantic understanding of every decoded resource.

## Bitmaps and screens

`INF:` stores uint16 frame count, then all widths as uint16 values, then all heights. It does **not** interleave width/height pairs. `BIN:` decodes to consecutive image payloads, each holding two horizontal pixels per byte: high nibble first, low nibble second. Local widths are even. Images are top-down with no Windows BMP header.

`SCR:` resources in this distribution decode to 32,000 bytes, representing 320 × 200 pixels. All 179 frames across BMP/SCR/BLK and `activisi` are decoded and checked against their dimensions. Previews use the conventional 16-color EGA palette; original palette switching, CGA dithering, transparency/compositing and display aspect correction are not emulated. PNGs preserve native dimensions.

## Fonts

Each `FNT:` payload begins with four bytes: glyph width, height, starting character code, glyph count. Glyph rows follow, MSB first, one byte per row for these fonts. The three fonts are 4×5, 6×6 and 8×8, each with 96 characters beginning at code 32. Payload sizes are exactly `4 + count × height × ceil(width/8)` (484, 580, 772 bytes). The viewer adds spacing between glyphs in its atlas.

## Palettes and PC-speaker effects

`PAL:` containers contain `EGA:` (128 bytes) and `CGA:` (162 bytes). The viewer shows low-nibble EGA swatches alongside word values. The full mapping/state semantics remain unresolved; swatches are an inspection aid, not an applied palette emulator.

The first chunk of `pals.blk` is `SND:`, not a palette. Its `INF:` contains six bytes (`d9 59 0b 00 00 00`), and its `IBM:` leaf has an uncompressed envelope yielding 501 bytes. The initial eleven uint32 values are increasing offsets beginning at 44, consistent with eleven sound command streams and the `0b` count in INF. Command opcodes, pitch/timing and termination need verification against the executable. No misleading raw-PCM playback is provided.

## Music

The `SND:` payload in each `.mus` file decompresses directly to an `MThd` standard MIDI file (big-endian MIDI header fields). Both are format 0, one track, 96 ticks per quarter note. MIDI includes Roland SysEx/instrument configuration.

| File | MIDI size | Parsed notes | Duration from MIDI events |
| --- | ---: | ---: | ---: |
| `danger.mus` | 2,807 bytes | 299 | 32.2 seconds |
| `trax.mus` | 44,814 bytes | 5,924 | 99.5 seconds |

The Web Audio audition respects note on/off, velocity, running status and tempo changes. It uses simple oscillators, ignores SysEx/program/controller synthesis, and is not an authentic MT-32 or percussion renderer. The complete original MIDI—including SysEx—is retained on export. Switching assets stops playback.

## Remaining reverse engineering

1. Decode the eleven IBM sound-effect command streams and verify timing/pitch in the executable.
2. Establish `.tbl` model/vertex/face and material records, then render actual geometry.
3. Correlate decompressed `.map` and `.trk` records with road geometry and object placement.
4. Decode/execute `title.ttm` instructions and resolve referenced resources.
5. Reproduce original palette state, compositing, aspect ratio and music hardware.

The names `shape.tbl`, `mycar*.tbl` and driver `.tbl` files suggest model-related data, but this is not yet a verified schema. The inspector deliberately labels these as binary instead of displaying invented geometry.

## References and validation

The public [ScummVM DGDS decompression reference](https://github.com/scummvm/scummvm/blob/master/engines/dgds/decompress.cpp) and [image loader](https://github.com/scummvm/scummvm/blob/master/engines/dgds/image.cpp) informed investigation of Dynamix framing, LZW and pixel packing. The implementation here is a compact JavaScript decoder checked against the actual local files; no C++ source is vendored. Later DGDS games are not assumed to share every Deathtrack format.

Run `npm run audit:assets` to reproduce the structural audit. Expected: 92 files, 179 frames, 2 music tracks, 10 maps, 3 fonts, zero failures. Browser checks cover the decoded car image and music controls; full hardware/audio fidelity remains unverified.
