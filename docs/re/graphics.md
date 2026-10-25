# Graphics stack (EGA path)

Evidence levels: **static** (disassembly / bytes), **inferred**, **unknown**. Everything here is static unless marked. Addresses are Ghidra `seg:off` of `/DTRACK_U.EXE`; `DS:` is DGROUP `36fa`.

Register shorthand: `GCn` = graphics controller index n (port 3CE/3CF), `SEQ2` = sequencer map mask (3C4/3C5 index 2), `ATC` = attribute controller (3C0), `CRTC` = port from BIOS `0040:0063` (3D4 on colour EGA). "Write colour c" in write mode 2 means the CPU byte's low nibble.

## Overview

Three layers:

1. **Driver table** (`DS:4924`, 35 far pointers). `1ff8:20ff` detects or forces an adapter, stores the id in `DS:385d` (returned to the caller, who stores it in `DS:95d6`), copies the adapter's table with `1ff8:21bc`, and calls the adapter's init. For EGA (id 2) the table is `DS:4d9c`, the init is `29f6:13b5` (slot 0).
2. **Library** in `1ff8` that clips, picks colours and calls slots: text `23ba`, line `2454`, polygon `256d`, ellipse `3194`, rectangle `3810`, clipped pixel `3cf9`/`3d2b`, font load/select `356e`/`3692`, palette load/select `3b7a`/`3c64`, full-screen picture `2fca`, bitmap group load `0006`, plus `JMPF` stubs `2541`-`2559`, `3cf1`, `3cf5`, `5282`, `5286`.
3. **Game-side helpers** in `1000` (page pointer setters `1000:026a`-`02c4`, retrace wait `1000:aeaa`) and the per-adapter ground renderer `2f73:02a4` / sky blit `2f73:000f`.

Page model (EGA): video memory is used as four regions per plane. `A000`, `A200`, `A400` are 8 KiB pages (40 bytes x 200 rows = 8000 bytes each), `A600:0000` up is scratch used while converting bitmaps, and the game uploads the sky panorama at `A734:0000` up (`1000:132d`, `1000:13f9`).

| Global | Meaning |
| --- | --- |
| `DS:3854` | displayed page segment (CRTC start). Init `A000` |
| `DS:3852` | back page segment. Init `A200` |
| `DS:3850` | third page segment, a static background store. Init `A400` |
| `DS:3858` | **destination** segment for every drawing slot |
| `DS:3856` | **source** segment for page copies (slots 4, 5, 23) |

`3856`/`3858` are pointers the game sets explicitly (they are not updated by the flip). After init `3858 = [3852]`, `3856 = [3854]` (`1ff8:21a9`, `2524:02c4`). The race loop sets `3858 = [3852]` before drawing (`1000:b301`, `1000:ba7a`, ...) and flips with slot 8 (`1000:05bf`, argument 0, no retrace wait). Slot 8 swaps `3854`/`3852` and writes only CRTC register 0Ch.

Data flow for assets: `SCR:BIN:` (full screen) and `BMP:BIN:` (sprite groups) are 4 bpp packed pixels (high nibble = left pixel), decompressed by the resource stream functions (`1ff8:0d47` open, `11f0` read, `1310` size, `100d` close; method byte `02` and a u32 unpacked size precede the data in `car1.scr`, `title.bmp`; see `docs/re/resources.md`). Pictures are drawn opaque by slot 17. Sprites are converted once by slot 14 into a planar copy plus a 1 bpp transparency mask and drawn by slot 3. Fonts (`FNT:`) are 1 bpp and drawn by slot 1. Palettes (`PAL:EGA:`) fill a 10 x 32 colour table at `DS:41a4`/`DS:4424`; slot 20 programs the 16 EGA palette registers through INT 10h AX=1000h.

### Driver invariant state

Between slot calls the EGA is left in: **GC5 = 02** (write mode 2, read mode 0), **SEQ2 = 0F**, **GC3 = 00** (replace, no rotate), GC0/GC1 = 0. GC8 (bit mask) and GC4 (read map) are not invariant: every routine that depends on GC8 sets it first. Set by slot 0 (`29f6:1409`) and re-established by `1ff8:52b1` (GC5=2, GC3=0, GC8=FF) before `2fca` and `3810`. Exceptions are listed per slot.

Every slot that writes in write mode 2 or with a partial bit mask first reads the target byte (`MOV AL,ES:[DI]` / `MOV AH,ES:[DI]`) to load the latches. A faithful EGA model (latches, GC0/1/3/4/5/8, SEQ2) makes a literal translation pixel-exact. The semantic descriptions below were checked to give the same pixels, including the latch-reuse cases in `REP STOSB` (see Translation notes).

## Function catalogue

### Driver selection and EGA table

| addr | proposed name | purpose | blocking? | notes |
| --- | --- | --- | --- | --- |
| `1ff8:20ff` | `gfxSelectAdapter(req, mask)` | `req` (byte, `[bp+6]`): 0 = auto. Else index into `DS:49b6` (`00 01 02 04 08 10 20 40 80`) giving a mask. `mask` (`[bp+8]`) used when `req`=0. Stores mask `49b5`, BIOS equipment video bits `49b4` (`1ff8:23a2`), id `385d`. id 1 → `4e3c`, init `2fd2:0252`; 2 → `4d9c`, init `29f6:13b5`; 3 → `4f84`, `3168:009e`; 4 → `4ec8`, `3373:000b`; 5/8 → `2c2c` (all zero in the file), `32e3:0007`. Writes DS to `0000:04F0`. Copies `3854`→`3856`, `3852`→`3858`. Returns id | no | caller `2524:0522` passes `(0, [95d6])`; `[95d6]` is set to 0x0F (`2524:0444`) and then by `G?` (`2524:04ca` GE=2, `04d2` GH=8, `04da` GC=1, `04e2` GT=4), then overwritten with the result (`2524:052a`) |
| `1ff8:21f5` | `gfxDetect` (near) | INT 10h AX=1A00h, AH=12h BL=10h, `0040:0087` bit 3, CRTC 0Fh write test (3D4), Hercules 3BA bit 7 toggle. Mask bit 2 + EGA present + `0040:0087` bit3 = 0 → 2. If the VGA BIOS answers 1A00h with BL/BH 7/8 → 8 only when mask has bit 7 or is FF | no | short spin loops only. Mask 0x0F with EGA/VGA hardware takes the `229e` EGA test → 2 |
| `1ff8:21bc` | `copyDriverTable` (near) | `SI` → `DS:4924`, 0x23 dwords (`REP MOVSW`, CX = 0x46). Leaves CX = 0, which slot 0 relies on | no | |
| `1ff8:21e2` | `gfxRestoreMode` | if `49b4`≠FF: set BIOS equipment bits from it and INT 10h AX=3 (`1ff8:237f`) | no | shutdown |
| `1ff8:52b1` | `egaResetState` | if `385d`=2: GC5=02, GC3=00, GC8=FF | no | |

EGA table `DS:4d9c` (slot → target): 0 `13b5`, 1 `16ec`, 2 `19b1`, 3 `00a7`, 4 `1be8`, 5 `1c4c`, 6 `1cda`, 7 `1d05`, 8 `1d9c`, 9 `13b4`, 10 `1ece`, 11 `1ddc`, 12 `21ad`, 13 `1f4c`, 14 `1f8d`, 15 `13b4`, 16 `13b4`, 17 `23d8`, 18 `13b4`, 19 `225b`, 20 `22c9`, 21 `2344`, 22 `238d`, 23 `1ff8:44b4`, 24 `0002`, 25 `0044`, 26 `0066`, 27 `141a`, 28-34 `13b4`. All in `29f6` unless written. `29f6:13b4` is a lone `RETF`.

How slots are reached (static search for `[0x4924+4n]`): `CALLF`/`JMPF` sites are `1ff8:2442` (1), `2538` (2), `2541`-`2559` (3-9), `33b1`/`342f`/`34d6`/`3554`/`395e`/`397f` (10), `3661` (12), `0185` (13), `027f` (14), `035f` (15), `03b0` (16), `5282` (17), `5286` (18), `3c29` (19), `3c8a` (20), `3d22` (21), `3d54` (22), `3cf1` (25), `3cf5` (26), `2565`/`2903` (27). Slot 11 is loaded as a far pointer into `DS:3870` (`1ff8:32c0`, `3856`) and called through it. Slot 0 is called directly by `20ff`. No reference to slots 23 or 24 through the table was found; slot 23's code `1ff8:44b4` is called directly (`1000:1b40`, `2524:0c66`, `2524:172c`, `2524:2058`). Slot 24 has no caller found (static).

### EGA slots (`29f6`)

| slot / addr | proposed name | purpose | blocking? |
| --- | --- | --- | --- |
| 0 `13b5` | `egaInit` | mode 0Dh, page and colour tables | no |
| 1 `16ec` | `egaDrawGlyph` | one font glyph | no |
| 2 `19b1` | `egaLine` | unclipped line, x1 ≤ x2 | no |
| 3 `00a7` | `egaDrawSprite` | masked sprite, optional clip | no |
| 4 `1be8` | `egaCopyRect` | latch copy page→page | no |
| 5 `1c4c` | `egaSaveRect` | page → planar buffer | no |
| 6 `1cda` | `egaSaveRectSize` | buffer size for slot 5 | no |
| 7 `1d05` | `egaRestoreRect` | planar buffer → page | no |
| 8 `1d9c` | `egaFlip(wait)` | swap pages, CRTC 0Ch, optional retrace | yes if `wait`≠0 |
| 10 `1ece` | `egaHSpanSolid` | solid horizontal span | no |
| 11 `1ddc` | `egaHSpanDither` | 2-colour dithered span | no |
| 12 `21ad` | `egaLoadFontData` | DOS alloc + read glyph data | no (file I/O) |
| 13 `1f4c` | `egaSpriteBytesNeeded` | size of converted sprite group | no |
| 14 `1f8d` | `egaConvertSprites` | packed → planar + mask | no |
| 17 `23d8` | `egaBlitPacked` | opaque packed 4 bpp blit | no |
| 19 `225b` | `egaReadPalette` | 128-byte PAL chunk → colour table | no (file I/O) |
| 20 `22c9` | `egaSetPalette` | activate palette p, INT 10h 1000h x16 | no |
| 21 `2344` | `egaGetPixel` | read pixel from `[3858]` | no |
| 22 `238d` | `egaPutPixel` | write pixel to `[3858]` | no |
| 23 `1ff8:44b4` | `dissolveRect` | LFSR dissolve `[3856]` → `[3854]` | no wait, CPU-paced |
| 24 `0002` | `egaSetHRetrace(a,b)` | CRTC 05h/06h after retrace | yes |
| 25 `0044` | `egaSetBorder(c)` | INT 10h AX=1001h | no |
| 26 `0066` | `egaSetPaletteReg(r,c)` | direct ATC write | no |
| 27 `141a` | `egaFillSpans` | span list fill, dithered | no |
| 9,15,16,18,28-34 `13b4` | `nop` | `RETF` | no |

Internal code in `29f6`:

| addr | name | notes |
| --- | --- | --- |
| `29f6:022c`, `039e`, `05d1`, `0818`, `0a73`, `0ce2`, `0f39`, `117c` | `spriteShift0..7` | slot 3 bodies, reached by `JMP [SS:2c1b + 2*shift]` at `29f6:022a`. Ghidra's functions `118b`, `11ba`, `12e9`, `1179` are fragments of these. Shift 1-4 use `SHR AX,1` x s and take AL. Shift 5-7 use `SHL AX,1` x (8-s) and take AH. Same result |
| `29f6:13ab` | slot 3 epilogue | `POP DS, ES, DI, SI; ADD SP,0Ah; POP BP; RETF` |
| `29f6:14e8` (`144d` jumps to it) | `fillSpansDither` | slot 27 dithered branch |
| `29f6:2034` | `packedToPlanar(srcOff, srcSeg, dstOff, dstSeg, groups)` | 4 bytes in → 1 byte per plane |
| `29f6:2137` | `vramPlanesToMem(vramOff, vramSeg, dstOff, dstSeg, n)` | read plane 0..3, n bytes each, appended |
| `29f6:216a` | `vramMaskToMem(vramOff, vramSeg, dstOff, dstSeg, n)` | `~(p0|p1|p2|p3)` per byte |
| `29f6:2327` | `pixelAddr` (near) | in AX=y, BX=x → BX = y*40 + x/8, CL = 7-(x&7), AH = 1 |

#### Slot 0 `29f6:13b5` egaInit (no args; needs CX = 0 on entry)

1. `[3861] = 0x10` (colour count). `[3854]=A000`, `[3852]=A200`, `[3850]=A400`.
2. INT 10h AX=000Dh. The BIOS default EGA palette stays (registers 0-7 = 0-7, 8-15 = 10h-17h). Border not touched.
3. `SI = CX` (0, left by `21bc`). For i = 0..15: word `c = i*0x0101` stored at `41a4+2i`, `41c4+2i`, `4424+2i`, `4444+2i`, `46a4+2i`. So palette 0 entries 0..31 = (i,i) on both dither rows, and `46a4[i] = i*0x101`.
4. Row table `DS:3d3e[y] = 40*y`, y = 0..199 (word).
5. SEQ2 = 0F, GC5 = 02.

#### Slot 1 `29f6:16ec` egaDrawGlyph

Registers in: `AX` = character (only AL matters), `DX` = x, `BP` = y, `ES` = page (caller sets `[3858]`). Preserves DX, SI, BP, DS. Font = the **current** font in slot 0 of the font arrays: width `[3874]`, height `[3888]`, first char `[389c]`, count `[38b0]`, data segment `[38c4]` (data starts at offset 0). Colours: `[3868]` fg byte, `[3869]` bg byte. `[3842]` ≠ 0 means transparent (fg only).

- `idx = (AL - [389c]) & 0xFF` as a byte. Skip the glyph when the byte subtraction gives `JL` (signed less) or idx ≥ count (aligned path: unsigned `JC`; unaligned path: signed `JL`).
- Glyph rows are `bpr` bytes, MSB = leftmost pixel, `h` rows per glyph, glyphs contiguous.
- **Aligned path** (x&7 = 0 and w&7 = 0): `bpr = w/8`, glyph offset = `idx * ((h*bpr) & 0xFF)` (`MUL BL`, 8-bit). Per row, per byte b: opaque: GC8 = b, latch read, write fg; GC8 = ~b, latch read, write bg. Transparent: GC8 = b, write fg. Row advance 40.
- **Unaligned path**: `bpr = ceil(w/8)`, offset = `idx * ((h*bpr) & 0xFF)`, `s = x&7`, `edge = DS:5010[w&7]` (`ff 80 c0 e0 f0 ff fc fe`; entry 5 is FF, not F8, data as shipped).
  - s = 0 (only when w&7 ≠ 0): like aligned, but the bg mask of the last byte of each row is `~b & edge`. Transparent mode has no edge mask.
  - s ≠ 0: each row writes `bpr+1` screen bytes. Screen byte k gets fg mask `((g[k-1]<<8 | g[k]) >> s) & 0xFF` with `g[-1] = 0`, `g[bpr] = 0`. Opaque: bg mask is the same shift of `~g` with `~g[-1]` replaced by 0 and the last real byte `~g[bpr-1] & edge`, and `~g[bpr]` = 0. So bg is painted only inside the glyph cell.
- No clipping here (the library clips per glyph).

#### Slot 2 `29f6:19b1` egaLine

Registers in: `BX`=x1, `CX`=y1, `DX`=x2, `SI`=y2, `ES` = page. Requires x1 ≤ x2 (unsigned; the caller swaps). Colour: `c = low byte of 41a4[[384e]]` (`[3862]` is set to the word; the write uses AL). No clipping. Each plot: GC8 = one-bit mask, latch read, write `c` (write mode 2). The bit mask comes from `DS:501a[x&7]` (`80 40 .. 01`); moving right is `ROR mask,1` with `DI++` on carry. `rowstep` = +40 if y2 > y1, else -40.

```
plot(x1,y1)
if x1==x2 && y1==y2: done                      // single pixel
if y1==y2: repeat (x2-x1): x++; plot           // horizontal
if x1==x2: repeat |y2-y1|: y+=step; plot        // vertical (|dy|+1 pixels)
dx = x2-x1; dy = |y2-y1|
if dx == dy:                                    // 1a89
  loop: x++ ; plot;
        if that step crossed a byte (mask wrapped 01->80):
             if --cnt==0: done   // QUIRK: ends one row short of (x2,y2)
             y+=step; plot
        else: y+=step; plot; if --cnt==0: done
  (cnt starts at dx)
if dy < dx:                                     // 1acf, x-major
  q = dx div (dy+1); f = ((dx mod (dy+1)) << 16) div (dy+1); acc = 0
  rem = dx; run = q+1
  loop: if rem-run < 0 (signed): run = rem; rem = 0 else rem -= run
        repeat run: x++; plot
        if rem == 0: done
        y+=step; plot                            // same x, staircase
        acc += f (16-bit); run = q + carry
if dy > dx:                                     // 1b52, y-major
  q = dy div (dx+1); f = ((dy mod (dx+1)) << 16) div (dx+1); acc = 0
  rem = dy; run = q+1
  loop: same clamp of run against rem
        repeat run: y+=step; plot
        if rem == 0: done
        x++; plot
        acc += f; run = q + carry
```

All arithmetic 16-bit unsigned (`DIV`). The result is a 4-connected staircase.

#### Slot 3 `29f6:00a7` egaDrawSprite(spr, x, y)

Stack: `[bp+6]` = near pointer to a 5-word sprite record `{seg, planeOff, maskOff, w, h}` (written by slot 14), `[bp+8]` = x, `[bp+a]` = y. ES = `[3858]`. Planes in memory: `seg:planeOff` holds plane 0, 1, 2, 3 (each `P = (w>>3 & 0xFF) * (h & 0xFF)` bytes, 8-bit `MUL`), `seg:maskOff` holds the mask, 1 = transparent. Rows are `w>>3` bytes (w must be a multiple of 8). Plane enable mask `[384f]` (bit p = plane p).

Setup:
- `[384b]` = 0 (no clip): start row y, `s = x&7`, first screen byte `x>>3`, `cols = w>>3`, rows = h, left/right clip flags `F = 0`, source row skip 0.
- `[384b]` ≠ 0 (clip, `29f6:011d`):
  - Top: if y < ymin (signed): `rows = h-(ymin-y)`, return if ≤ 0; skip `(ymin-y)*cols` source bytes (8-bit `MUL DL`); y = ymin.
  - Bottom: if `y + rows > ymax` (unsigned): `rows = ymax - y + 1`, return if ≤ 0.
  - `L = xmin & ~7`. If x < L (signed): `wp = (w&~7) - (L-x)`, return if ≤ 0; `s = wp & 7` (= x&7); skip `(s + L - x) >> 3` source bytes; start byte `L>>3`; F |= 1. Else start byte `x>>3`, `s = x&7`, `wp = w&~7`.
  - `R = (xmax+1) & ~7`. If `start + wp ≥ R` (unsigned, start in pixels): `wp = R - start`, return if ≤ 0; F |= 2.
  - `cols = wp>>3`; if F = 3 and x&7 ≠ 0: cols -= 1. Source row skip = `(w>>3) - cols`, destination skip = `40 - cols`.
  - **Clipping is byte-granular on x**: effective window `[xmin & ~7, ((xmax+1) & ~7) - 1]`, exact on y.
- Dispatch on s (`JMP [SS:2c1b+2s]`).

Body, per sprite (shift s, `C = cols`):
1. Phase 1 (write mode 2, SEQ2 = F): for each row, for screen bytes 0..C-1 (and byte C when s ≠ 0): `m = ((M[k-1] << 8 | M[k]) >> s) & 0xFF` where M[k] are mask bytes of the row; `M[-1]` = FF, or the real previous mask byte if F&1; `M[C]` = FF, or the real next byte if F&2. GC8 = ~m, latch read, write colour 0. So every opaque pixel is cleared to 0 in all four planes.
2. GC5 = 0 (write mode 0), GC8 = FF.
3. Phase 2, for p = 0..3, only if `[384f]` bit p: SEQ2 = 1<<p, GC4 = p; for the same bytes, `ES:[DI] |= ((D[k-1]<<8 | D[k]) >> s) & 0xFF` with `D[-1]`/`D[C]` = 0 unless F&1/F&2 (then the real neighbour byte). Plane data pointer advances by P per plane whether or not the plane is enabled.
4. SEQ2 = F, GC5 = 2, return through `13ab`.

Net effect: every sprite pixel whose mask bit is 0 becomes `colour & [384f]`; mask-1 pixels are untouched. Exit state: GC8 = FF, GC4 = last enabled plane (3 normally).

#### Slot 4 `29f6:1be8` egaCopyRect(x, y, w, h)

GC5 = 1 (latch copy). Byte columns `x>>3` .. `((x+w+7) & ~7)>>3 - 1`, rows y .. y+h-1. Copies `[3856]:off` → `[3858]:off` (same offsets, `REP MOVSB`). All four planes (SEQ2 = F). GC5 = 2 on exit. No clipping. h = 0 → 65536 rows (`DEC DX; JNZ`), static.

#### Slot 5 `29f6:1c4c` egaSaveRect(bufOff, bufSeg, x, y, w, h) / Slot 7 `29f6:1d05` egaRestoreRect(same)

Buffer pointer normalised: `seg += off>>4`, `off &= 15`. `nb = ((x+w)>>3) - (x>>3) + 1` bytes (one more than needed when x+w is byte aligned), `words = ceil(nb/2)`. Buffer layout: plane 3 rows, then plane 2, plane 1, plane 0; each plane `h` rows of `2*words` bytes.

- Slot 5 reads from `[3856]`: GC5 = 0, GC8 = FF, GC0 = 0, then for GC4 = 3,2,1,0 copy rows with `REP MOVSW`. GC5 = 2 on exit; GC4 left at 0.
- Slot 7 writes to `[3858]`: GC5 = 0, GC8 = FF, GC0 = 0, then SEQ2 = 8,4,2,1 and copy rows back. GC5 = 2, SEQ2 = F on exit.
- `2*words` can exceed the rectangle by up to 2 bytes and run into column 40 (next row's byte 0). Restore writes those bytes too.

#### Slot 6 `29f6:1cda` egaSaveRectSize(w, h)

`b = (w>>3) + 1 + (w&7 ? 1 : 0)`, rounded up to even; returns `DX:AX = h*b*4` (32-bit). Upper bound for slot 5 with any x.

#### Slot 8 `29f6:1d9c` egaFlip(wait)

```
newShown = [3852]; [3852] = [3854]; [3854] = newShown
OUT CRTC: index 0Ch = low byte of (newShown >> 4)   // A000→00, A200→20, A400→40
if wait != 0: while (IN 3DA & 8): ;  while !(IN 3DA & 8): ;
```

CRTC 0Dh (start low) is never written. `3856`/`3858` unchanged. The only caller (`1000:05bf`) passes 0.

#### Slot 10 `29f6:1ece` egaHSpanSolid / Slot 11 `29f6:1ddc` egaHSpanDither

Registers in: `BX` = x, `CX` = width (≤ 0 → nothing), `DI` = row offset (`3d3e[y]`), `ES` = page. Both assume write mode 2. Masks: left `DS:502c[x&7]` (`ff 7f .. 01`), right `DS:5034[n]` (`00 80 c0 .. fe`).

- Slot 10: colour = `AL`. If `(x&7) + width < 8`: one byte, GC8 = left & right[(x&7)+width]. Else left partial byte (GC8 = left), full bytes `(width - (8-(x&7))) >> 3` with GC8 = FF, then a right partial byte if the remainder & 7 ≠ 0.
- Slot 11: `AX`, `DX` = two dither words. `[386a] ^= 1`; if the result ≠ 0, `AX = DX`. Then `AH` goes to even x pixels (GC8 & AA) and `AL` to odd x pixels (GC8 & 55), as two passes over the same byte range.

#### Slot 12 `29f6:21ad` egaLoadFontData(fp, i, buf)

`[bp+6]` FILE*, `[bp+8]` font index i, `[bp+a]` near buffer (≥ 80 bytes). Uses `[3874+i]` w, `[3888+i]` h, `[38b0+i]` count (set by `1ff8:356e` before the call).
- `size = ((h * ceil(w/8)) & 0xFF) * count` (two 8-bit `MUL`s; the second uses only the low byte of the first product).
- INT 21h AH=48h for `ceil(size/16)` paragraphs; failure → return 0. `38c4[i] = seg`.
- `q = size div 80`, `r = size mod 80` (8-bit `DIV BL`; divide overflow if q > 255). Reads `q` blocks of 80 bytes with `1000:c214 (fread)` into `buf` and copies each to `seg:off`; the loop decrements a byte from q to 0, so **q = 0 reads 256 blocks**. Then reads `r` bytes and copies them.
- Returns `i` (the pushed SI).

#### Slot 13 `29f6:1f4c` egaSpriteBytesNeeded(list, pExtra)

`list` = near pointer to a 0-terminated array of near pointers to sprite records. `sum = Σ (w>>1) * h` (32-bit); returns `DX:AX = sum + sum/4` (4 planes + mask). Writes 0 to `*pExtra` (no second buffer needed on EGA).

#### Slot 14 `29f6:1f8d` egaConvertSprites(list, off, seg, lenLo, lenHi)

`off:seg` = far buffer holding all sprites' packed 4 bpp data back to back, `len` = byte count of that data. Buffer must have `1.25*len` room.
1. `packedToPlanar(off, seg, 0, A600, len>>2)` (`29f6:2034`): GC5 = 2 then 0, GC8 = FF; for each 4 input bytes (8 pixels, high nibble first) write one byte to each plane at `A600:di` (SEQ2 = 1,2,4,8 for planes 0..3; bit 7 = leftmost pixel). Source segment advances 1000h when the second word's `SI` wraps. Exit GC5 = 2, SEQ2 = F.
2. VRAM offset `v = 0`. For each record r: `n = ((w>>1)*h) >> 2` (= w*h/8); `r.seg = seg`, `r.planeOff = off`, `r.maskOff = off + 4n`; `vramPlanesToMem(v, A600, off, seg, n)` writes plane 0..3 (GC4 = 0..3, n bytes each) to `seg:off`; `vramMaskToMem(v, A600, off+4n, seg, n)` writes `~(p0|p1|p2|p3)` (GC4 = 0..3, read via 3CF). `v += n`; `off += 5n`, then normalised into seg:off (seg += off>>4, off &= 15).
3. Leaves GC4 = 3. Clobbers ES with the last list pointer (`POP ES` of a pushed BX, harmless).

Transparency colour: **0** (mask bit set iff all four plane bits are 0).

#### Slot 17 `29f6:23d8` egaBlitPacked(srcOff, srcSeg, x, y, w, h)

Opaque. GC5 = 0, GC8 = FF. Destination `[3858]`, first byte `x>>3` (x truncated to a byte boundary), `bpr = w>>3`, rows h. Source normalised (`seg += off>>4`, `off &= 15`), rows contiguous, `w/2` bytes per row. For each 4 source bytes: 8 pixels → one byte per plane, written with SEQ2 = 1,2,4,8. If `w>>3 = 0` one group is still written per row (`DEC BP; JLE`). Exit SEQ2 = F, GC5 = 2, GC3 = 0. No clipping, no segment wrap handling.

#### Slot 19 `29f6:225b` egaReadPalette(fp, p)

Reads 128 bytes (`fread(local,0x80,1,fp)`). Words `w0..w31` → `41a4[p*32+i] = (hibyte>>4)<<8 | (lobyte & 0x0F)`; words `w32..w63` → `4424[p*32+i]` the same way. Returns p.

#### Slot 20 `29f6:22c9` egaSetPalette(p)

p = 0 → nothing. For c = 0..15:
- `41a4[c] = c`, `4424[c] = c`, `46a4[c] = c` (word c: high byte 0).
- `41c4[c] = 41a4[p*32+16+c]`, `4444[c] = 4424[p*32+16+c]` (logical colours 16-31 of palette 0 = those of p).
- `v = 41a4[p*32+c] & 0x0F`; if v ≥ 8: v += 8 (→ 10h-17h, intensity bit 4 of the 200-line EGA monitor); INT 10h AX=1000h, BL = c, BH = v.

#### Slot 21 `29f6:2344` egaGetPixel(x, y) / Slot 22 `29f6:238d` egaPutPixel(x, y, c)

Both use `[3858]` and `2327` (offset `y*40 + x/8`, not the row table).
- Get: for GC4 = 3,2,1,0 collect bit `7-(x&7)` → returns colour 0..15. Exit SEQ2 = F, GC5 = 2, GC4 = 0.
- Put: GC8 = bit, GC5 = 2, GC3 = 0, latch read, write `c` (byte at `[bp+a]`, raw colour, no table). Then GC8 = FF, GC5 = 0, GC3 = 0, SEQ2 = F, GC5 = 2.

#### Slot 23 `1ff8:44b4` dissolveRect(x, y, w, h, unit) (self-modifying)

Copies the rectangle from `[3856]` to the **displayed** page `[3854]` one unit at a time in pseudo-random order. Patches immediates at `CS:45cf`, `45d7`, `45dd`, `45e4`, `45e8`, `45fb`, `4601`, `4605`, `4608` each call.
- `shift = floor(log2(unit))`; if that is 0, `shift = high byte of w` (so unit 1 with 256 ≤ w < 512 becomes 2-pixel units). `cols = (w >> shift) & 0xFF`; h = 0 → return.
- LFSR taps `T = DS:4d42[bitlen(h)]` (words at `4d44..4d52`: `0110 0240 0500 0ca0 1b00 3500 6000 b400` for bitlen 1..8). State `S` (16-bit), `BL` = column, `BH` = row.
- EGA: GC5 = 0 (= 1 when shift = 3), GC0 = 0, GC1 = 0, select SEQ index 2. Handler by shift: `1ff8:466b` (1 px), `466d` (2 px), `466f` (4 px), `464b` (8 px). Unit masks from `DS:4d6c + (7>>shift)`: `ff`, `f0 0f`, `c0 30 0c 03`, `80 40 .. 01`.

```
S = h<<8 | cols
loop:
  lsb = S&1; S >>= 1; if lsb: S ^= T
  if BH > h: continue
  if BH == h: if BL == cols: break else continue
  if BL >= cols: continue
  plot(BL, BH)
after loop: plot(0,0) once (state 0 is never produced), then exit
plot(col,row): r = (y & 0xFF00) | ((y + row) & 0xFF)     // 8-bit add
               off = 3d3e[r]; u = col + (x >> shift)
  shift 3: DS=[3856], ES=[3854]; MOVSB at off+u            // latch copy, 8 px
  else:    byte = off + (u >> (3-shift)); GC8 = mask[u & (7>>shift)]
           read planes 0..3 of [3856]:byte (GC4 = 0..3)
           latch read [3854]:byte; write planes 3,2,1,0 (SEQ2 = 8,4,2,1)
```

Exit (EGA): SEQ2 = F, GC5 = 2. GC8 is left at the last unit mask, GC4 at 3, GC0/GC1 at 0. No retrace wait: on hardware the visible speed is CPU-bound.

#### Slot 24 `29f6:0002` egaSetHRetrace(a, b)

CRTC 05h = `0x15 - a`, CRTC 06h = `6 - b`, written with interrupts off after waiting for the **end** of a vertical retrace (`IN CRTC+6` bit 3: wait until set, then until clear; slot 8 and `1000:aeaa` wait for the start instead). No caller found.

#### Slot 25 `29f6:0044` egaSetBorder(c)

`BH = c & 0x0F`; if `[385d]` = 2 and BH ≥ 8: BH += 8. INT 10h AX=1001h (overscan). Shared by the CGA and Tandy tables. Called with 0 at the end of race frames (`1000:05f5`, `1000:0617`, both conditional).

#### Slot 26 `29f6:0066` egaSetPaletteReg(r, c)

`c ≥ 8 → c += 8`. With interrupts off: `IN 3DA`; `OUT 3C0, r` (bit 5 clear: display blanked); `OUT 3C0, c`; `IN 3DA`; `OUT 3C0, 20h`. Used by palette cycling `2524:478a`.

#### Slot 27 `29f6:141a` egaFillSpans(SI = list)

`SI` → `{y, count, (x1,x2) x count}` words. ES = `[3858]`. GC5 = 2, GC8 = FF. Colour `c = [384d]`: `A = 41a4[c]`, `B = 4424[c]`; `[3864] = A`.
- `A == B` (`1450`): each row y..y+count-1: if x2 ≥ x1 (signed), solid span x1..x2 inclusive with colour `AL` (masks `4e28[x&7]` = `ff 7f .. 01`, `4e30[n]` = `00 80 .. fe`).
- `A ≠ B` (`14e8`, AX = B on entry): even rows (y&1 = 0) use A, odd rows B; within a row AH → even x pixels (mask & AA), AL → odd x (mask & 55).
- Rows with x2 < x1 are skipped. No clipping.

### `1ff8` library

| addr | proposed name | purpose | blocking? | notes |
| --- | --- | --- | --- | --- |
| `1ff8:23ba` | `drawText(str, x, y)` | NUL-terminated near string, current font | no | below |
| `1ff8:2454` | `drawLine(x1, y1, x2, y2)` | clip then slot 2, colour `[384e]` | no | below |
| `1ff8:2541` | `drawSprite(spr, x, y)` | `JMPF` slot 3 | no | |
| `1ff8:2545` | `copyRect(x, y, w, h)` | `JMPF` slot 4 | no | |
| `1ff8:2549` | `saveRect(off, seg, x, y, w, h)` | `JMPF` slot 5 | no | |
| `1ff8:254d` | `saveRectSize(w, h)` | `JMPF` slot 6 | no | |
| `1ff8:2551` | `restoreRect(off, seg, x, y, w, h)` | `JMPF` slot 7 | no | |
| `1ff8:2555` | `flipPages(wait)` | `JMPF` slot 8 | if wait | |
| `1ff8:2559` | `slot9(x, y, w, h)` | `JMPF` slot 9, EGA no-op | no | called `(0,0,320,100)` each race frame |
| `1ff8:255d` | `fillSpans(list)` | slot 27 with SI = arg | no | no caller |
| `1ff8:256d` | `drawPolygon(n, xs, ys)` | outline or filled convex polygon | no | below; returns span-list pointer or 0 |
| `1ff8:2926` | `polyLines` (near) | SI = xs, DI = ys, BP = count: `drawLine(xs[i+1], ys[i+1], xs[i], ys[i])` | no | |
| `1ff8:293d`, `2958`, `298b`, `29b1`, `29ee` | edge setup (near) | vertical, steep, diagonal, shallow-right, shallow-left | no | below |
| `1ff8:2a29` | `edgeWalk` (near) | computed jump into the unrolled table `2a50`-`2fc7` | no | 200 blocks of 7 bytes, `RET` at `2fc8` |
| `1ff8:4df6` | `clipPolygon` | Sutherland-Hodgman on x then y | no | below |
| `1ff8:2fca` | `loadScreen(name|fp)` | `SCR:BIN:` → slot 17 bands on `[3858]` | no (file I/O) | below |
| `1ff8:3194` | `drawEllipse(r, cx, cy)` | filled + outlined circle, x scaled 1.25 | no | below |
| `1ff8:356e` | `loadFont(name|fp)` | next `FNT:` chunk → free font slot 1..19 | no (file I/O) | below |
| `1ff8:3692` | `selectFont(i)` | i = 0: return index whose segment equals `[38c4]` (0 if none); else copy font i into slot 0 | no | |
| `1ff8:3722` | `freeFont(i)` | clears slot 0 if current, INT 21h 49h (`3ae2`), `38c4[i] = 0` | no | |
| `1ff8:3784` / `37b8` | `fontWidth(i)` / `fontHeight(i)` | i = 0 → current | no | |
| `1ff8:37ec` | `fontValid(i)` (near) | 0 < i < 20 and `38c4[i]` ≠ 0 | no | |
| `1ff8:3810` | `drawRect(x, y, w, h)` | outline `[384e]`, fill `[384d]` if `[384c]` | no | below |
| `1ff8:3b7a` | `loadPalette(name|fp)` | free slot 1..9 in `DS:4186`; chunk `DS:4b86[385d]` (`PAL:EGA:` for 2); slot 19; `4186[i] = i` | no (file I/O) | default extension `.pal` (`4b81`) |
| `1ff8:3c64` | `selectPalette(i)` | i = 0 → return `[4186]`; valid i → slot 20, `[4186] = i` | no | |
| `1ff8:3ca6` | `freePalette(i)` | `4186[i] = 0`, `[4186] = 0` if current | no | |
| `1ff8:3cce` | `paletteValid(i)` (near) | 0 < i < 10 and `4186[i]` ≠ 0 | no | |
| `1ff8:3cf1` | `setBorder(c)` | `JMPF` slot 25 | no | |
| `1ff8:3cf5` | `setPaletteReg(r, c)` | `JMPF` slot 26 | no | |
| `1ff8:3cf9` | `getPixelClipped(x, y)` | if `[384b]` and outside the inclusive clip box → -1, else slot 21 | no | |
| `1ff8:3d2b` | `putPixelClipped(x, y, c)` | same test, else slot 22 | no | |
| `1ff8:5282` / `5286` | `blitPacked` / `blitPackedAlt` | `JMPF` slot 17 / slot 18 (no-op on EGA) | no | |
| `1ff8:0006` | `loadSpriteGroup(name|fp)` | `BMP:INF:` + `BMP:BIN:` → converted sprite list | no (file I/O) | below |
| `1ff8:044c` | `freeSpriteList(list)` | `free(list[0])`, `free(list)` (`1000:c280`) | no | |
| `1ff8:0476` | `unloadSpriteGroup(list)` | checks (`0590`, `04e8`), INT 21h 49h on `list[0]->seg`, then `044c` | no | |
| `1ff8:3a88` | `dosAllocBytes(lo, hi)` | INT 21h 48h, returns far `seg:0` or 0; `(-1,-1)` → largest block size in bytes | no | |
| `1ff8:3ae2` | `dosFree(off, seg)` | INT 21h 49h | no | |

#### `1ff8:23ba` drawText(str, x, y)

- ES = `[3858]`. `[3869] = low byte of 46a4[[3841]]` (bg), `[3868] = low byte of 46a4[[3840]]` (fg). `46a4` has 16 entries (identity).
- If `[384b]`: return when y < ymin (signed), or when `(y with AL += [3888], 8-bit) > ymax` (signed). **A string whose bottom row equals ymax is not drawn** (the test is y+h > ymax, not y+h-1).
- Per character until NUL: if clip: x < xmin → skip glyph; else if `x + w - 1 > xmax` → stop the whole string. Draw with slot 1 (AX = char, DX = x, BP = y). `x += [3874]`.

#### `1ff8:2454` drawLine(x1, y1, x2, y2)

ES = `[3858]`. If `[384b]` = 0 skip to the end step. Each stage: if both points are out → return; if only the first is out → clip it; if only the second → swap the points, then clip the (new) first. Clip of point 1 against bound B: `t = IMUL/IDIV` signed 16-bit truncation.

| stage | out test | update |
| --- | --- | --- |
| ymin | `y < ymin` signed | `x1 += (x2-x1)*(ymin-y1) / (y2-y1)`; `y1 = ymin` |
| xmin | `x < xmin` signed | `y1 += (y2-y1)*(xmin-x1) / (x2-x1)`; `x1 = xmin` |
| ymax | `y > ymax` **unsigned** | `x1 += (x2-x1)*(ymax-y1) / (y2-y1)`; `y1 = ymax` |
| xmax | `x > xmax` **unsigned** | `y1 += (y2-y1)*(xmax-x1) / (x2-x1)`; `x1 = xmax` |

End: if `x1 > x2` (unsigned) swap points; slot 2 with BX=x1, CX=y1, DX=x2, SI=y2. Without clipping, negative x is treated as unsigned by the swap and slot 2 draws garbage.

#### `1ff8:256d` drawPolygon(n, xs, ys)

Arrays (words, 20 entries each): input/clip output `38ec` (x), `3914` (y); temp `393c`/`3964`; outline copy `398c`/`39b4`; count `39dc`. Span buffer: `DS:39f0 + 4*y` = `{xl, xr}` per row (segment `DS+0x39f`, offset `4*y`). Returns `[49d2]` (span header pointer) or 0.

1. `[49d2] = 0`. n ≥ 0: copy n xs/ys into `38ec`/`3914`, `[39dc] = n`. n < 0: no copy and the code then returns (n < 2).
2. n = 2 → `polyLines` with count 1 (one line). n < 2 → return.
3. `[384c]` = 0 (outline): `xs[n] = xs[0]`, `ys[n] = ys[0]`; `polyLines(n)`; return.
4. Filled: if `[384e]` ≠ `[384d]`: save the closed polygon (n+1 points) in `398c`/`39b4`, `[49d4] = n`.
5. If `[384b]`: `clipPolygon`. Count 2 → one line and return; < 2 → return. (No outline in these cases.)
6. Walk i = count-1 down to 0, dropping a vertex equal to the previously kept one (initially vertex 0). Kept vertices go to `393c`/`3964` in **reverse** order. Track top = min y, ties → larger x (strictly), and bottom = max y, ties → smaller-or-equal x (later wins).
7. minY = maxY → `drawLine(xBottom, maxY, xTop, minY)` and return. Kept count 2 → same line. < 2 → return.
8. Orientation (`26b7`): with `a` = next vertex after top, `b` = previous: `dxn = xa-xt, dyn = ya-yt`, `dxp = xb-xt, dyp = yb-yt`. dyn = 0 → dyn = 1, dxn = ±7FFFh by sign; dyp = 0 → dyp = 1, dxp = 8001h if negative else 7FFFh. Keep the order when (dxp < 0 and dxn ≥ 0), reverse when (dxp ≥ 0 and dxn ≤ 0); if both are negative, negate both and swap the pairs; then compare `dxp/dyp` against `dxn/dyn` as unsigned 16.16 quotients (integer part, then fraction): reverse if next < prev, keep otherwise. Keep = copy `393c` → `38ec` as is; reverse = copy reversed and remap the top/bottom indices (`k → count-1-k`, in words).
9. Chain 1: vertices from top forward (wrapping) until y ≥ bottomY. Chain 2: from bottom forward until y ≤ topY. Edges of chain 1 write the **right** word (`+2`), edges of chain 2 the **left** word (`+0`). A row shared by two edges keeps the later edge's value.
10. Edge rasterisation per edge (a→b), `dx = |xa-xb|`, `dy = |ya-yb|`. Unrolled store loop: `store x; row += ±1; acc += F (16-bit); x += I + carry`. Count `dy+1` rows (8-bit; > 200 would jump before the table).
    - dx = 0 (`293d`, tested first, so also a single point): rows from min y to max y, x constant.
    - dy = 0 (`288c`): one store at row ya: right word gets max x, left word min x.
    - dx = dy (`298b`): start at the upper point, x ±1 per row.
    - dx < dy (`2958`): start at the left point's row, step toward the right point's row. `F = ((dx+1) << 16) div (dy+1)`, `I = 0`, `acc0 = F` → `x_k = xl + floor((k+1)*F / 65536)`.
    - dx > dy, left word (`29ee`): start at the left point. `I = (dx+1) div (dy+1)`, `F = (((dx+1) mod (dy+1)) << 16) div (dy+1)`, `acc0 = F` → `x_k = xl + k*I + floor((k+1)*F / 65536)`.
    - dx > dy, right word (`29b1`): start at the right point. Same I, F; stored step is `-(I + (F≠0))` with `acc0 = -F mod 65536`, adding `-F mod 65536` → `x_k = xr - k*I - floor(((k+1)*F - 1) / 65536)` for F > 0, `xr - k*I` for F = 0.
11. Header at `SI = 0x39f0 + 4*(topY-1)`: `[SI] = topY`, `[SI+2] = bottomY - topY + 1`; slot 27; `[49d2] = SI`.
12. If `[384e]` ≠ `[384d]`: `polyLines` over the saved unclipped copy (`398c`/`39b4`, `[49d4]` lines).

#### `1ff8:4df6` clipPolygon

Two passes. Pass x: `38ec/3914` → `393c/3964` with outcodes 1 = x < xmin, 2 = x > xmax. Pass y: `393c/3964` → `38ec/3914` with 8 = y < ymin, 4 = y > ymax. Compares signed. For each edge prev P (index i-1, wrapping from the last vertex) → current C, codes cp, cc:

- both 0: emit C.
- `cp & cc` ≠ 0: emit nothing.
- cp = 0, cc ≠ 0: emit the intersection **based on C**: `y = yC + (yP-yC)*(B-xC) / (xP-xC)` (pass x; mirrored for pass y). Priority: xmin before xmax (pass x), ymin before ymax (pass y).
- cp ≠ 0, cc = 0: emit the intersection **based on P** (`y = yP + (yC-yP)*(B-xP)/(xC-xP)`), then C.
- both ≠ 0, disjoint: intersection based on P for cp's bound, then intersection based on C for cc's bound.

`IMUL`/`IDIV` 16-bit, truncation toward zero; the base point matters for rounding. If pass x leaves ≤ 1 vertex, the result is copied back and pass y is skipped. Output can exceed 20 vertices and overrun the following arrays (no check).

#### `1ff8:3810` drawRect(x, y, w, h)

`egaResetState`; ES = `[3858]`. Fill words `[3864] = 41a4[[384d]]`, `[3866] = 4424[[384d]]`; `[3870]` = slot 10 if equal, else slot 11. Outline `[3862] = 41a4[[384e]]`.
1. w ≤ 0 or h ≤ 0 → return.
2. If `[384b]` = **1** (exactly): clip each side, set flags: 1 left (x = xmin, w adjusted), 2 top, 4 right (`w = xmax+1-x`), 8 bottom. Fully out → return.
3. If `[384c]` and `[384e]` = `[384d]`: skip the outline.
4. Outline with `[384b]` temporarily 0: if not left-clipped: `drawLine(x, y, x, y+h-1)`, x++, w--. If not right-clipped: `drawLine(x+w-1, y, x+w-1, y+h-1)`, w--. **If w goes negative here (w = 1 unclipped) the code jumps to the exit with the saved `[384b]` still pushed: stack corruption** (static; presumably never called that way). If h < 3 and both top and bottom clipped → skip. Else top row (if not top-clipped): slot 10 at row y with `AL` of `[3862]`, y++, h--; bottom row (if not bottom-clipped): slot 10 at row y+h-1, h--. Restore `[384b]`.
5. If `[384c]` and h > 0: `[386a] = y & 1` once, then each row: `[3870]` with `AX = [3864]`, `DX = [3866]`. Slot 11 toggles first, so **even rows use the 4424 word and odd rows the 41a4 word** (opposite to polygons and ellipses).

#### `1ff8:3194` drawEllipse(r, cx, cy)

ES = `[3858]`. r < 1 → return; r = 1 → `putPixelClipped(cx, cy, [384d])` (raw colour); r > 102 → r = 102.
1. Midpoint circle: `x = 0, y = r, d = 3 - 2r, W = 2*floor(1.25r)`. While x ≤ y: for (row k = r-y, horizontal x) and (row k = r-x, horizontal y): `in[k] = floor(1.25*(r-h))` where h is the other coordinate (`49ec`), `len[k] = W - 2*in[k]` (`4aba`). Stop after x = y; else `d += 4x+6`; if the old d ≥ 0: `d -= 4y-4`, y--; x++.
2. Derive per row (bytes, 8-bit): `out[0] = len[0]`, `fill[0] = 0`; for k = 1..r: `out[k] = in[k-1] - in[k] + 1`, `fill[k] = len[k] - 2*out[k]`; if `fill[k]` = 0 then `out[k] = 2*out[k]`. (`4a53` = out, `4aba` = fill.)
3. Colours: fill `[3864]`/`[3866]` and `[3870]` as in drawRect; outline `[3862]`. Box left `L = cx - floor(1.25r)`, width `W`. Horizontal window `[lo, hi)` relative to L: no clip → `[0, W & 0xFF)`; clip → `lo = max(0, xmin-L)`, `hi = xmax-L+1` if `L+W > xmax`, else W; fully out → return.
4. Upper half: rows `cy-r .. cy-1` with k = 0..r-1 (clipped to ymin/ymax). Lower half: rows `cy .. cy+r` with k = r..0. Lower clipping against ymin tests the **index** for ≤ 0, not the row count (static quirk).
5. Each row: `a = in[k]`; if a > hi (signed byte) skip the row. Left outline `[a, a+out)`, fill `[.., ..+fill)` if `[384c]` (else skipped over), right outline `[.., ..+out)`, each clamped to `[lo, hi)`, drawn with slot 10 (outline, `AL` of `[3862]`) or `[3870]` (fill, `AX = [3866]`, `DX = [3864]`). If `fill[k]` = 0 the rest of the row is skipped (the doubled left outline covers it).
6. Dither phase: upper half sets `[386a] = y&1` every row → even rows 41a4, odd rows 4424. **Lower half sets it only once at its first row**; afterwards only slot 11 toggles it, so a row that draws no fill span shifts the phase for the rows below.

#### `1ff8:2fca` loadScreen(name|fp)

`egaResetState`. If the argument is not an open stream (`4de0`), open it (`4a48`) and close at the end (`4da4`). Find `SCR:BIN:` (`4ade`), open a decompressing stream (`0d47`, mode `"r"`). Buffer `malloc(0xC80)` halving until success; `rows = size / 160`. For y = 0, rows, ... < 200: read `size` bytes (`11f0`), `blitPacked(buf, DS, 0, y, 320, rows)`. With the normal 3200-byte buffer this is 10 bands of 20 rows. (A fallback buffer of 400 bytes would read 400 bytes per 2-row band and misalign, static.) If `[385f]` (never written, initial 0) it would also load `SCR:VGA:` through slot 18. Returns 1 on success.

#### `1ff8:0006` loadSpriteGroup(name|fp)

`BMP:INF:` = u16 n, u16 w[n], u16 h[n]. Allocates a near list of n+1 pointers and n records of 10 bytes (`list[i] = base + 10i`, `list[n] = 0`), fills `w`/`h`. `slot13` → size; `dosAllocBytes(size)`. Reads the whole decompressed `BMP:BIN:` in 0x7FFF-byte pieces, then `slot14(list, off, seg, totalLen)` where totalLen is from `1310`. `BMP:VGA:` path skipped (`[385f]` = 0) except that slot 16 (no-op) is called. Returns the list pointer, or 0 on failure. Example: `title.bmp` INF = 1 sprite, 304 x 35.

#### `1ff8:356e` loadFont(name|fp) and FNT format

Find a free slot i in 1..19 (`38c4[i]` = 0), else return 0. Open if needed (default extension `.fnt`, `DS:4b29`). Find the chunk named by `[4b2e]` → `"FNT:"` (`DS:4b24`). Read 4 bytes: `w, h, first, count` → `3874[i]`, `3888[i]`, `389c[i]`, `38b0[i]`; then slot 12. Returns i or 0. `fonts.blk` holds three consecutive `FNT:` chunks: 4x5, 6x6, 8x8, each first = 20h, count = 60h, 1 byte per row (sizes 484, 580, 772 including the 4-byte header). `2524:00c4`/`00d2` load them in sequence from one open FILE*, so each `chunkSeek(fp,"FNT:",0)` returns the next `FNT:` chunk (see `resources.md`, chunkSeek).

### `2f73` and game-side helpers

| addr | proposed name | purpose | blocking? | notes |
| --- | --- | --- | --- | --- |
| `2f73:02a4` | `drawGroundByAdapter` | `JMP [DS:2afc + 2*[95d6]]`: id 1 → `035f`, 2 → `02ae`, 3 → `03ed`, 4 → `035f` | no | **not a page flip**: it draws the ground/road rows below the horizon. Called once per race frame (`1000:051b`) |
| `2f73:02ae` | `egaDrawGround` | rows `[8db2]-1 .. 99` of the back buffer `[3858]` from 8-byte records at `DS:9252 + 8*row` | no | below |
| `2f73:0469` | `egaGroundMiddle` (near) | precise span `[a, b]` colour AL | no | masks `DS:2ac6` (`00 7f .. 01`), `DS:2ace` (`00 80 .. fe`) |
| `2f73:000f` | `drawSky(top, start, xoff, pan)` | EGA: latch copy of the sky from VRAM to `[3852]` (back page) | no | below |
| `2f73:035f`, `03ed`, `0513`, `0564`, `05bb`, `05d8` | CGA / Tandy / mode-4 variants | skipped | | |
| `1000:026a`-`02c4` | page pointer setters | `026a`: src=[3852], dst=[3854]; `0278`: dst=[3852], src=[3854]; `0286`: both [3852]; `0290`: src=[3852], dst=[3850]; `029e` same; `02ac`: both [3850]; `02b6`: src=[3850], dst=[3854]; `02c4`: src=[3850], dst=[3852] | no | `1000:0304` = `copyRect(0,0,320,200)`; `02d2` = third page → back page; `02dc` also copies back → displayed |
| `1000:02ea` | `resetClip` | clip = (0,0)-(319,199), `[384f] = 0F` | no | |
| `1000:aeaa` | `waitVRetraceStart` | `IN 3DA` bit 3: wait clear, then wait set | **yes** | far; only caller `2524:4816` |
| `1000:ae8e` | `egaSetWriteMode(m)` (near, EGA only) | GC5 = m, GC3 = 0, GC8 = FF | no | sky upload |
| `1000:ad8e` | game copy of `packedToPlanar` (near) | same algorithm as `29f6:2034` | no | sky upload to `A734:0000` (`1000:13b4`) |
| `1000:a536` | `setMode6` | INT 10h AX=0006h | no | `1000:00a7` |
| `2524:470a` / `2524:478a` | `paletteCycleSetup` / `paletteCycleStep` | rotate a list of palette-register colours every `[5abe]+1` calls, wait retrace, write with slot 26 | step: yes | EGA/Tandy only (`385d` = 2 or 3) |

#### `2f73:02ae` egaDrawGround

GC5 = 2, GC index 8 selected. ES = `[3858]`. Records at `DS:9252 + 8*(row)`: `w0` = middle colour (low byte), `w1` = b (middle right, inclusive), `w2` = a (middle left), byte 6 = left colour, byte 7 = right colour. Rows from `r0 = [8db2]-1` (only if < 99) to 99:
1. If a > b (unsigned): a = b = 0.
2. GC8 = FF; bytes `0 .. ceil(a/8)-1` = left colour.
3. GC8 = FF; bytes `b>>3 .. 39` = right colour.
4. If a ≠ b: pixels `a..b` = middle colour (`0469`: one byte with mask `2ace[(b+1)&7] & (a&7 ? 2ac6[a&7] : FF)` when a and b+1 share a byte (`(a ^ (b+1)) & 1F8h` = 0); else left partial byte (skipped when a&7 = 0, then one more full byte), full bytes, right partial byte if `(b+1)&7` ≠ 0).

Order matters: when a and b fall in the same byte the right colour overwrites the left part of that byte; with a = b the middle is not drawn at all. Exit GC5 = 2.

#### `2f73:000f` drawSky (EGA branch `2f73:0022`)

GC5 = 1, SEQ2 = F, ES = `[3852]`. `skip = max(0, top - start)`, first row `start + skip`, row count `[9642] - skip` (0 → return). Panorama segment `k = pan div 320` (subtraction loop), source `[9bce+4k]:[9bd0+4k]` far pointer + 40*skip. `c = xoff >> 3`. Each row: copy bytes `c..39` of segment k to columns `0..39-c`; if c ≠ 0 copy bytes `0..c-1` of segment `(k+1) mod 6` to columns `40-c..39`. Source rows are 40 bytes. GC5 = 2 on exit. Source and destination are both VRAM, so this is a latch copy.

## Data

| DS offset | width | init | meaning |
| --- | --- | --- | --- |
| `3840` | u8 | 0 | text fg colour index (→ `46a4`) |
| `3841` | u8 | 0 | text bg colour index |
| `3842` | u8 | 0 | text transparent flag (≠0: fg only) |
| `3843` / `3845` | s16 | 0 / 319 | clip xmin / xmax (inclusive) |
| `3847` / `3849` | s16 | 0 / 199 | clip ymin / ymax (inclusive) |
| `384b` | u8 | 0 | clip enable. `3810` tests `== 1`, others `≠ 0`. Game sets 1 (`2524:02a1`, `1000:04f9`) |
| `384c` | u8 | 1 | fill enable (polygon, rect, ellipse) |
| `384d` | u8 | 0 | fill colour (logical 0-31) |
| `384e` | u8 | 0 | line / outline colour |
| `384f` | u8 | 0F | sprite plane enable mask (slot 3 phase 2) |
| `3850`/`3852`/`3854` | u16 | set by slot 0 | third / back / displayed page segments |
| `3856`/`3858` | u16 | | source / destination segments |
| `385c` | u8 | 0 | Tandy BIOS flag (`1ff8:528a`) |
| `385d` | u8 | | adapter id (2 = EGA) |
| `385f` | u8 | 0 | load VGA chunks; never written (static) |
| `3861` | u8 | | colour count (EGA 10h) |
| `3862` | u16 | | outline/line colour word (`41a4[...]`) |
| `3864` / `3866` | u16 | | fill dither words (41a4 / 4424 entry) |
| `3868` / `3869` | u8 | | glyph fg / bg colour for slot 1 |
| `386a` | u16 | | dither row phase, toggled by slot 11 |
| `3870` | far ptr | | span routine: slot 10 or slot 11 |
| `3874+i`, `3888+i`, `389c+i`, `38b0+i` | u8[20] | | font width, height, first char, count; i = 0 is the current font |
| `38c4+2i` | u16[20] | 0 | font data segment (0 = free) |
| `38ec`, `3914` | s16[20] | | polygon x / y (input and final) |
| `393c`, `3964` | s16[20] | | polygon temp x / y |
| `398c`, `39b4` | s16[20] | | saved closed outline x / y |
| `39dc` | s16 | | polygon vertex count |
| `39f0 + 4y` | s16[2] x 200 | | span buffer `{xl, xr}`; header for a fill sits at `39f0 + 4*(top-1)` |
| `3d3e + 2y` | u16[200] | | row offset `40*y` |
| `4186+i` | u8[10] | 0 | palette slot used (`4186` itself = current palette index) |
| `41a4 + 64p + 2c` | u16 [10][32] | | palette p colour c, even rows: high byte = even-x colour, low byte = odd-x colour |
| `4424 + 64p + 2c` | u16 [10][32] | | same for odd rows |
| `46a4 + 2c` | u16[16] | | text colour remap (identity, low byte used) |
| `4924` | far ptr[35] | `1ff8:20fe` (RETF) x 35 | active driver table |
| `49b4` / `49b5` | u8 | FF / | BIOS video equipment bits / adapter request mask |
| `49c0`-`49d4` | u16 | | polygon temporaries (top idx, bottom idx, chain counts, current word offset `49cc`, result `49d2`, outline count `49d4`) |
| `49ec`, `4a53`, `4aba` | u8[103] | | ellipse inset / outline length / fill length per row |
| `4b21` | u16 | | ellipse destination segment |
| `4d42` | u16[9] | | dissolve LFSR taps (index = 2*bitlen(h)) |
| `4d54`/`4d5c`/`4d64` | u16[4] | | dissolve handlers per shift (EGA / CGA / other) |
| `4d6c` | u8[15] | | dissolve unit masks |
| `4d9c` | far ptr[35] | | EGA driver table |
| `4e28` / `4e30` | u8[8] | | left masks `ff>>n` / right masks `~(ff>>n)` (slot 27) |
| `4e38`/`4e39`/`4e3a` | u8/u8/u16 | | slot 27 temps (even colour, odd colour, rows left) |
| `5010` | u8[8] | `ff 80 c0 e0 f0 ff fc fe` | glyph right-edge masks |
| `5018` | u8 | | current edge mask |
| `501a` | u8[8] | `80 .. 01` | single-pixel masks (slot 2) |
| `5022`-`5029` | | | slot 2 temps (mask, q, f, saved rem, acc) |
| `502c` / `5034` | u8[8] | | left / right masks (slots 10, 11) |
| `503c`/`503d` | u8 | | slot 11 colour bytes |
| `503e`, `5040` | u16 | | slot 12 font segment, size then q/r |
| `5042`-`5046` | u16 | | slot 17 bytes per row, row skip, rows left |
| `2c10`-`2c19` | | | slot 3 temps: right bound, shift, flags, src skip, dst skip, plane size |
| `2c1b` | u16[8] | `022c 039e 05d1 0818 0a73 0ce2 0f39 117c` | slot 3 shift jump table |
| `2ac6` / `2ace` | u8[8] | | `2f73` middle span masks |
| `2afc` | u16[5] | `0000 035f 02ae 03ed 035f` | `2f73:02a4` jump table by adapter id |
| `8db2` | u16 | | horizon row + 1 for the ground renderer |
| `9252 + 8r` | 8 bytes | | ground row record (see `2f73:02ae`) |
| `9642` | u16 | | sky height in rows |
| `9bce + 4k` | far ptr[6] | | sky panorama segments in VRAM |
| `95d6` | u16 | 0F | requested adapter mask, then the adapter id |

Colour model (EGA): a logical colour index c selects `41a4[c]`/`4424[c]` of palette 0. Entries 0-15 are solid register c after slot 20 (word c). Entries 16-31 are copied from the loaded palette and give a 2x2 ordered dither: (even row, even x) = high byte of `41a4`, (even row, odd x) = low byte of `41a4`, odd rows the same from `4424`. Lines and outlines use only the low byte of `41a4`. `PAL:EGA:` chunk = 128 bytes: 32 words for 41a4 then 32 for 4424; per word, low nibble of byte 0 → low byte, high nibble of byte 1 → high byte. Entries 0-15 low nibble = EGA palette register values (≥ 8 programmed as +8). Example `activisi`: registers `0 8 15 4 9 1 7 11 7 7 7 15 7 7 7 7`, entries 16-23 = `0..7`.

## Environment touch points

| what | where |
| --- | --- |
| INT 10h AX=000Dh | `29f6:13d1` |
| INT 10h AX=1000h (palette reg) | `29f6:2315` |
| INT 10h AX=1001h (border) | `29f6:0062` |
| INT 10h AX=1A00h, AH=12h BL=10h | `1ff8:2211`, `2251`, `22a8` (detection) |
| INT 10h AX=0003h, AX=0006h | `1ff8:2246` etc., `1ff8:239e`, `1000:a539` |
| BIOS data `0040:0063` (CRTC port), `0040:0010` (equipment), `0040:0087` | slots 8, 24, 26; `1ff8:2235`, `22af` |
| `0000:04F0` | DS stored by `1ff8:21a5` |
| `F000:FFFE`, `C000:0000` | Tandy test `1ff8:528a` |
| port 3C4/3C5 (SEQ2) | slots 0, 3, 7, 14, 17, 21, 22, 23; `2f73:0034` |
| port 3CE/3CF (GC0,1,3,4,5,8) | all drawing slots, `1ff8:52b1`, `2f73`, `1000:ad8e`, `1000:ae8e` |
| port 3C0 (ATC), 3DA read | slot 26 |
| port 3DA bit 3 (vertical retrace) | slot 8 (if wait), slot 24, `1000:aeaa` |
| CRTC 0Ch | slot 8 |
| CRTC 05h/06h | slot 24 |
| CRTC 0Fh (3D4), 3BA | detection |
| INT 21h AH=48h / 49h | slot 12, `1ff8:3a88`, `1ff8:3ae2` |
| `fread` (`1000:c214`) | slots 12, 19, `356e`, `0006` |
| files: `fonts.blk` (`FNT:`), palettes (`PAL:EGA:`, e.g. `activisi`, `pals.blk`), `*.scr` (`SCR:BIN:`), `*.bmp`/`bitmaps.blk` (`BMP:INF:`, `BMP:BIN:`) | via resource layer |

## Translation notes

- **Model the EGA, then translate literally.** `src/engine/ega.js` should implement 4 planes x 64 KiB, latches loaded on every CPU read, read mode 0 with GC4, write modes 0/1/2, GC0/GC1 set/reset, GC3 function and rotate (only replace is used, but `1000:ae8e` and slot 22 set it), GC8, SEQ2. With that, every slot can be ported line by line and stays pixel-exact. A semantic fast path must reproduce the quirks below.
- **Latch reuse in `REP STOSB`**: slots 11 and 27 (dither) and slot 1 draw middle bytes with a partial bit mask and one latch read for the whole run. Pass 1 (mask AA) fills the unmasked pixels from the latch of the left-edge byte; pass 2 (mask 55) reloads the latch from the first middle byte, which now has the right even pixels. The final pixels equal the pure dither; a model that ignores latches still gets the same final image for these routines.
- **Register arguments**: slots 1, 2, 10, 11, 27 take registers (listed above). Slot 0 needs CX = 0. Slot 1 preserves DX, SI, BP. Slot 3 ends through the shared epilogue `13ab`.
- **8-bit arithmetic**: slot 1 glyph offset (`MUL BL`), slot 12 size and block count, slot 3 plane size and top skip, `23ba` y+h, slot 23 row add, `3194` tables. Port these with `u8()`.
- **Signedness**: `2454` uses signed tests for ymin/xmin and unsigned for ymax/xmax; final swap unsigned. `clipPolygon` all signed. Slot 3 top/left signed, bottom/right unsigned.
- **Byte-granular sprite clipping** in x (see slot 3).
- **Dither phase** differs: polygons (slot 27) and ellipses use the 41a4 word on even rows, rectangles the 4424 word on even rows, and the ellipse lower half can drift.
- **Line quirk**: diagonal lines end one row short when the last step crosses a byte boundary (`29f6:1ab7`).
- **Self-modifying code**: slot 23 patches its own immediates and a `JMP rel8`. Translate as parameters.
- **Jump tables**: slot 3 shift (`DS:2c1b`), polygon edge walk (computed `JMP DX` into `2a50`-`2fc8`, 7 bytes per row), `2f73:02a4` (`DS:2afc`), slot 23 handler (`DS:4d54`).
- **Blocking**: slot 8 is called with 0 (no wait); in hardware the CRTC latches the start address at retrace, so the flip shows on the next refresh. The port should present `[3854]` at the next host frame. `1000:aeaa` and `2524:478a` must `yield* retrace()`. Slot 23 has no waits but draws on the visible page; to show the dissolve the port has to spread it over frames (APPROX, rate unknown).
- **Never-used paths**: slots 15, 16, 18 (`BMP:VGA:`, `SCR:VGA:`) because `[385f]` = 0; slot 24 (no caller found).
- **Stack bug** in `drawRect` with w = 1 (step 4). Do not "fix" silently; trap it with `unsupported()` if reached.
- Slot 12 with a font smaller than 80 bytes would read 256 blocks; the shipped fonts are 480, 576, 768 bytes (q = 6, 7, 9).
- `1ff8:0006` uses near `malloc` (`1000:c272`) for the list and records: their addresses are DGROUP offsets that callers store.

## Open questions

- Arguments and call sites of `dissolveRect` (`1000:1b40`, `2524:0c66`, `2524:172c`, `2524:2058`) and the dissolve speed to emulate: **unknown**.
- Resource helpers (`4de0` chunkIsOpen, `4ade` chunkSeek, `4d72` chunkLen, `4da4` chunkClose, `0d47` streamOpenFile, `11f0` streamRead, `1310` streamSize, `100d`) are specified in `docs/re/resources.md`. Its chunkSeek table (n = 0: current chunk if unread, else the next) explains why consecutive `loadFont` calls on one FILE* get the 4x5, 6x6 and 8x8 fonts in order.
- Who fills `DS:9252` (ground records), `DS:9642` and the sky pointer table `DS:9bce` beyond `1000:1208`-`1515`: game code, not analysed here.
- Slot 24 (CRTC 05h/06h) has no caller found by a search for `[0x4984]` and direct calls: **static**, an indirect call cannot be excluded.
- Slot 9 / `1ff8:2559` is a no-op on EGA; its purpose on other adapters (called with `(0,0,320,100)` each frame) is **unknown**.
- Whether the game ever calls `drawRect` with w = 1 and outline: **unknown**.
- `1ff8:21f5` returns 8 (VGA) only when the mask has bit 7 or is FF; with the default mask 0x0F on VGA hardware it returns 2. Observed EGA under DOSBox (identity.md) agrees: **inferred**.
