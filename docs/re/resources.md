# Resources, file I/O and C runtime services

Evidence levels: **static** (disassembly or bytes), **file-checked** (a static layout confirmed against every relevant file in `game/` with a scratchpad script), **inferred**, **unknown**. Ghidra jump targets in segment `1ff8` print as `0x2000:X`, which is `1ff8:X+0x80`. Where Ghidra shows a call to `0x1000:0446`/`0x1000:0347` from inside `1ff8:0006`, the raw bytes (`0e e8 95 04`, `e9 8c 03`) show the targets are `1ff8:04c6` and `1ff8:03c7`. The decompile of `1ff8:0006` wrongly inlines the body of `1000:0344` (the fatal exit) there.

## Overview

The game uses four layers.

1. **The MSC 5.x C runtime** (`1000:c000-ffff`): stdio (`FILE` streams), low-level `open/read/write/close/lseek`, heap, long arithmetic, string and number formatting. The game reaches it mostly through far thunks at `1000:c000-c34x`. See [C runtime](#c-runtime-services).
2. **The Dynamix chunk-file library** (`1ff8:4748-4de0`). It opens a file with `fopen`, keeps a 4-entry table of per-file traversal state, and seeks to the n-th chunk whose tag path (`"BMP:BIN:"` …) matches. See [Chunk files](#chunk-file-library-1ff84748-4de0).
3. **The Dynamix stream codec** (`1ff8:05d2-20fe`). It is a handle-based reader and writer for the 5-byte compression envelope (method 0 raw, 1 RLE, 2 LZW). Its source is a `FILE` or a far memory block. See [Stream codec](#stream-codec-1ff805d2-20fe).
4. **Resource loaders**:
   - library loaders in `1ff8`: bitmap `0006`, screen `2fca`, font `356e`, palette `3b7a`
   - game loaders in `2524`: music `4b34`, TTM script `08de`
   - the sound-effect bank loader `32e3:009a`
   - raw file loaders in `1000`: `.MAP` `1208`, `.TRK` `4fae`, `.tbl` via `ad0a`, `HI_SCORE` `5136/51bc`, saves `525a/52ec`

**Names.**
- Most files go through `2524:2be8(name)`, which builds `DS:99ec = DS:8f0c + "\" + name`.
- `DS:8f0c` is the directory of `argv[0]`. `main` (`1000:0010`) also `chdir`s to it.
- `.tbl` paths are also prefixed with `DS:8f0c` (through `2be8`), but then go through `1000:ac4c`, which always appends `".tbl"`. Only `*.RCT` saves use paths relative to the current directory.

**Startup order** (`1000:0010`):
1. `SLY.BMP` probe (`38e4`)
2. `PALS.BLK`: sound bank, two palettes, pointer bitmap
3. `danger.mus`
4. `fonts.blk` (`2524:009e`)
5. title loop:
   - `TITLE.TTM` (`2524:0584`)
   - `ACTIVISIO` logo (`2524:4850`, run by TTM opcode `'*'` in `2524:0c66`)
6. `POSTWAR.SCR` (`03f6`)
7. `bitmaps.blk` (`2524:012e`)
8. `SHAPE` (`1000:a53c` → `shape.tbl`)
9. `trax.mus` (`2524:01da`, only when 128 KiB of DOS memory is free)

Per race (`1000:32b8`), the game loads `<CITY>.MAP` and then `<CITY>.TRK`. Driver and car `.tbl` files plus `.BMP`/`.SCR` screens are loaded on demand.

## Function catalogue

### Chunk-file library and loaders (1ff8, 2524, 32e3)

| addr | proposed name | purpose | blocking? | notes |
|---|---|---|---|---|
| 1ff8:48ea | chunkSlotFind(fp) | Returns the address of the slot in `DS:8a98[4]` whose word 0 equals `fp`, or 0. `fp=0` finds a free slot | no | near; scans index 3→0 |
| 1ff8:491e | chunkSlotReset(slot) | Zeroes the 0x44-byte slot except `fp` (+0) and level-0 end (+0x1c/+0x1e), then calls `rewind(fp)` (`c256`) | no | near |
| 1ff8:4970 | tagPathEq(a,b,n) | Returns 1 if `a` and `b` are equal for up to `n` chars or both end; 0 at the first mismatch | no | near. A NUL in `a` with a non-NUL in `b` keeps comparing |
| 1ff8:4a48 | chunkOpen(name) | `fopen(name,"rb")` (`c1a2`), `fseek(fp,0,2)`, `ftell` → slot end[0] = len \| 0x80000000, `491e`. Returns the `FILE*` (near) or 0 | no (blocking stance in [Translation notes](#translation-notes)) | A failed open leaves the slot free |
| 1ff8:4aae | chunkRestore(slot) | Copies the snapshot at DS:8dd8 back into the slot, `fseek(fp, slot.pos, 0)`, returns −1L | no | near |
| 1ff8:4ade | chunkSeek(fp, path, n) | Moves to the n-th chunk whose full tag path equals `path` and returns the data offset as a **long** in DX:AX, or −1L | no | See [chunkSeek](#chunkseek-1ff84ade) |
| 1ff8:4d72 | chunkLen(fp) | Returns the current chunk's payload length (slot +0x40, as a long in DX:AX) or −1 | no | The decompile shows only AX. Callers use DX:AX (`1ff8:01f4`, `2524:4bb1`) |
| 1ff8:4da4 | chunkClose(fp) | Sets the slot's `fp` to 0 and calls `fclose(fp)` (`c264`). Returns 1, or 0 if not open | no | |
| 1ff8:4de0 | chunkIsOpen(x) | Returns `48ea(x)!=0`. Loaders use it to decide whether their argument is an open chunk `FILE*` or a filename | no | see the trap in [Translation notes](#translation-notes) |
| 1ff8:49a6 | chunkSave(buf, fp) | Copies the 0x44-byte slot into `buf` | no | no direct callers |
| 1ff8:49ec | chunkLoad(buf) | Copies `buf` into the slot keyed by `buf[0]` and seeks to `buf.pos` | no | no direct callers |
| 1ff8:0006 | loadBitmap(fpOrName) | Loads a `BMP:` resource (INF, BIN; VGA only when DS:385f≠0). Returns a near **bitmap handle** or 0 | no | See [Bitmap](#bitmap-bmp-bmpblk-pals-blk-bmp) |
| 1ff8:044c | bitmapFreeHeader(h) | `free(h[0])` then `free(h)` | no | `c280` = free plus `malloc(0xffff)`, see runtime |
| 1ff8:0476 | freeBitmap(h) | If registered (`0590`): unregister (`04e8`), `DosFree(seg of frame 0)` (`3ae2`), `044c` | no | |
| 1ff8:04c6 | bitmapSlotFree() | Returns the highest index i (39→0) with `DS:5af4[i]==0`, or −1 | no | |
| 1ff8:04e8 / 054a / 0590 | bitmapUnreg / bitmapCount / bitmapIsReg | Scan `DS:5b44[40]` for the handle | no | |
| 1ff8:052a | bitmapReg(h, count, idx) | `DS:5af4[idx]=count`, `DS:5b44[idx]=h` | no | |
| 1ff8:2fca | loadScreen(fpOrName) | Decodes `SCR:BIN:` straight to the current draw page in bands through driver slot 17 (`1ff8:5282` → `JMPF [0x4968]`). Returns 1 or 0 | no | See [Screen](#screen-scr-activisi-scr) |
| 1ff8:356e | loadFont(fpOrName) | Finds a free font slot 1..19, then `FNT:` (`[0x4b2e]` → "FNT:"). Appends ".fnt" when the name has no '.'. Reads the 4-byte header into slot tables, then driver slot 12 reads the glyphs. Returns the slot or 0 | no | See [Font](#font-fontsblk) |
| 1ff8:3692 | selectFont(n) | n=0 returns the current font index (searches `DS:38c6[]` for `DS:38c4`). Otherwise, if valid (`37ec`), copies slot n's w/h/first/count and segment into slot 0 and returns n | no | Not resource I/O: it switches the active font |
| 1ff8:3722 | freeFont(n) | `DosFree(DS:38c4[n])`, clears the slot, and clears slot 0 when it was current | no | |
| 1ff8:3b7a | loadPalette(fpOrName) | Finds a free palette slot 1..9 (`DS:4186[]`). Appends ".pal" when the name has no '.'. Seeks the per-adapter tag `DS:4b86[[385d]]` ("PAL:EGA:" for EGA), then driver slot 19 reads 128 bytes. Returns the slot or 0 | no | Quirk: every failure stores 0 into `DS:4186` (the current-palette byte) (`1ff8:3c53`) |
| 1ff8:3c64 | setPalette(n) | n=0 returns `(s8)DS:4186`. A valid n calls driver slot 20 (INT 10h AX=1000h ×16), sets `DS:4186=n` and returns n. Otherwise returns 0 | no | |
| 1ff8:3ca6 | freePalette(n) | `DS:4186[n]=0`, and the current byte too when it equals n | no | |
| 1ff8:3cce | paletteValid(n) | `0<n<10 && DS:4186[n]` | no | |
| 2524:4b34 | loadMusic(fpOrName) | `SND:` leaf, decoded in one `11f0` call into a DOS block of the decoded size. Returns a far pointer `seg:0` or 0:0 | no | See [Music](#music-mus) |
| 2524:4c8a | freeMusic(far) | `3ae2` | no | |
| 2524:4cb6 | musicStop() | → `1000:c715` | no | |
| 2524:03f2 | musicPlay(far) | `musicStop()`. When music is enabled (`DS:1fb2`) and `far≠0`, calls `1000:c60a(far,1)` | no | |
| 2524:01da | loadTrax() | `malloc(0xffff)`, then probes `DosAlloc(0x20000)`. On success frees the probe and loads `trax.mus` into `DS:8f02/8f04`. Otherwise frees `danger.mus` (`8f06`) and sets `DS:1fb2=0` (music off) | no | |
| 2524:08de | loadTtm(fpOrName) | `TTM:` leaf → near `malloc(decoded)`. Registers in the first free of 5 slots: start `DS:05da[i]`, end `DS:05e4[i] = start+len−1`. Returns i, or −1 | no | Returns 0 (looks like slot 0) and leaks the buffer when all 5 slots are full |
| 2524:0c66 | ttmRun(entry) | TTM interpreter. Resource opcodes are listed under [TTM](#ttm-script-titlettm) | yes (inferred, animation) | Owned by the TTM analysis; only resource opcodes are listed here |
| 2524:2be8 | buildGamePath(name) | `DS:99ec = "" ; strcpy(99ec, 8f0c); strcat(99ec, "\\"); strcat(99ec, name)` | no | One static buffer: each call overwrites the last result |
| 32e3:009a | loadSoundBank(fpOrName) | Finds a free record in `DS:2c2c[10]` (0x16 bytes each), then reads `SND:INF:`, `SND:IBM:` (relocated) and `SND:ITM:`. Returns the 1-based bank number or 0 | no | Segment 32e3 is not only the Hercules driver; this code serves every adapter (called from `main`) |
| 32e3:01f1 | loadSndIbm(rec, fp, tag) | `026a`, then adds the block base (32-bit) to each non-zero dword of the first `rec.count` (`+0x10`) offsets | no | |
| 32e3:026a | loadSndChunk(rec, fp, tag) | Seeks `tag`, decodes into `DosAlloc(decoded)` in 20000-byte steps, and appends a node `{far data, next, tag[9]}` | no | 16-byte nodes are `malloc(0x10)` for second and later nodes |
| 32e3:05ba | selectSoundBank(n) | `DS:9a40 = n−1` when bank n is loaded. Returns 1 or 0 | no | |
| 1ff8:4636 / 48db | farNormalize | DX:AX → `seg+(off>>4) : off&15` | no | register args (4636) |
| 1ff8:481b | farMemcpy(dst, src, n) | Normalises both pointers, then `MOVSW`/`MOVSB` | no | The odd-alignment branch at 4840 is dead (`TEST` clears CF) |
| 1ff8:4855 | farMemset(dst, b, nLong) | Fills in 32000-byte steps | no | |
| 1ff8:3a88 | DosAlloc(lo, hi) | Bytes → paragraphs (rounded up; only bits 4-19 of the size survive), INT 21h AH=48h. Returns DX:AX = `seg:0`, or 0:0. `(0xffff,0xffff)` returns the largest free block in bytes (`BX<<4`) | no | asm. The paragraph count is 16-bit, so sizes ≥ 1 MiB wrap |
| 1ff8:3ae2 | DosFree(off, seg) | INT 21h AH=49h with ES=seg (`[BP+8]`). Ghidra shows `MOV AX,ES`; read it as `MOV ES,AX` | no | The offset is ignored |
| 1ff8:39c2 | hugeRead(off, seg, cntLo, cntHi, fd) | INT 21h AH=3Fh loop. Each read is at most the bytes left before the segment end (64 KiB−1 when off=0) or the remaining count. When the offset carries, adds 0x1000 to the segment. Stops on CF, 0 bytes, or a cut-to-segment-end read. Returns the long count read | no | `CLI`/`STI` around INT 21h. Only caller is `1000:ad0a` |
| 1ff8:3a26 | hugeWrite(off, seg, cntLo, cntHi, fd) | Same with AH=40h. Stops on a short write | no | no direct callers (dead, static) |
| 1ff8:190a | (fragment of RLE memory decoder) | The second half of `1ff8:18c6`, the method-1 decoder used when the stream source is memory (`DS:9aa4&0x20==0`) | no | Gap-fill function that starts mid-routine; Ghidra warns about overlapping instructions. Do not translate it as a unit |
| 1ff8:4df6 | clipPolygon | Clips the polygon in `DS:38ec[]`/`3914[]` (count `DS:39dc`) to `DS:3843/3845`, using 32-bit interpolation | no | **Not a resource function**, despite the task list. Its caller is `1ff8:256d` (graphics) |

### Stream codec (1ff8:05d2-20fe)

| addr | proposed name | purpose | blocking? | notes |
|---|---|---|---|---|
| 1ff8:0bd6 | streamAlloc() | Takes the first free handle in `DS:980e[100]` and `calloc(1,0x21)` (`c308`) into it and `DS:8e9a`. Returns the handle or −1 | no | |
| 1ff8:0b05 | modeHasR(s) | 1 if the string contains 'r' | no | |
| 1ff8:0c50 | streamSetMethod(m, mode) | m<3: work buffer `calloc(1, read?tab.rbuf:0x80)` into stream +0. If the far-work size (read: `tab.rfar`; write: `tab.wfar`) is non-zero: `DosAlloc` it, unless DS:37c4/37c6 supplies a preset block. Sets +0x20 = m. Returns m or −1 | no | |
| 1ff8:0a5f | streamSelect(h) | Loads the stream into the codec globals (`DS:8e9a`, `aa98`, `8ebc/8ebe`, `99eb`, `aa1c`, `9aa4`, `9b08` or `99b8/99ba`). Returns 0 if `h` is not open | no | |
| 1ff8:0b5f | streamFree(h) | Frees the work buffer, the far work block (unless preset) and the struct; clears the handle. Returns −1 | no | |
| 1ff8:0d47 | streamOpenFile(m, fp, mode, lenLo, lenHi) | **Read** ('r'): method = `fgetc(fp)`; limit = len (+0x0e); decoded size = `fread(+0x12, 1, 4)`; codec init `tab[m].dinit`; flags \|= 0x60. **Write**: `fputc(m)`, 4-byte placeholder, `tab[m].einit`; flags \|= 0x20. Returns the handle or −1 | no | `m` is ignored in read mode; callers pass 0 or −1 |
| 1ff8:0edf | streamOpenMem(m, far, mode, lenLo, lenHi) | Same, with a far memory source or destination | no | no direct callers (static) |
| 1ff8:11f0 | streamRead(h, dstFar, n) | Decodes up to `n` (16-bit) bytes to `dst`. Returns the count, or −1 for a bad handle | no | Stops early only when the compressed input is exhausted |
| 1ff8:1191 | streamFill(h, n) | Drains the 128-byte ring at stream +0 (`10fa`), then runs the decoder `tab[m].decode`, then drains again. Adds to the position (+0x16) | no | near |
| 1ff8:123f | streamWrite(h, srcFar, n) | Pushes through the 128-byte ring and the encoder `tab[m].encode(0)`. Returns the encoded byte count `DS:896e` | no | no direct game callers found (static) |
| 1ff8:100d | streamClose(h) | Write mode: flush (`tab[m].encode(1)`), then patch the 4-byte decoded size at `ftell_at_open+1` and seek to the end. Always calls `streamFree`. Returns `DS:896e` | no | |
| 1ff8:1310 | streamSize(h) | Returns the header's decoded size as a long in DX:AX | no | |
| 1ff8:14f9 | streamRewind(h) | Read only: re-runs decoder init and seeks to data+5 | no | |
| 1ff8:1346 (+1378/138b/13a1/13b4) | streamSeek(h, off, whence) | Decodes forward or rewinds to reach `off` (whence 0/1/2 through AX) | no | Gap-fill fragments that share BP frames. No direct game callers |
| 1ff8:0739 / 07ad | srcGetc / srcRead | One byte, or n bytes, from the file or memory source, bounded by the limit (+0x0e) | no | `07ad` refills the LZW code buffer |
| 1ff8:0870 / 0904 / 0998 | outCopy / outFill / outByte | Write decoded bytes to `DS:9638` (far dst, when `9aa4&0x40`) or skip them (seek mode). Overflow goes to the ring | no | `08e3`, `0962`, `09da` and the 6-byte thunks are tail fragments |
| 1ff8:05d2 | decodeRaw | Copies `srcGetc` to `outByte` | no | method 0 |
| 1ff8:0605 / 18c6 | decodeRle (file / memory) | See [Decompression](#decompression-compared-with-srcformatsjs) | no | method 1 |
| 1ff8:15fc (15e0) | decodeLzw | Uses a far dictionary block (prefix words at +0, suffix bytes at +0x2720, stack at +0x3720) | no | method 2. Hand-written asm. Ghidra's 15e0 starts 0x1c bytes early |
| 1ff8:17ff | lzwGetCode | Code-group reader, described under [Decompression](#decompression-compared-with-srcformatsjs) | no | register returns |
| 1ff8:204a | lzwDecodeInit | Clears 0x3aa1 dictionary bytes, sets width 9, max 0x1ff, next 0x101 | no | |
| 1ff8:066d / 1f14 / 1a12, 19ba / 1c40 / 1df8 / 1ed4 | encoders (raw / RLE / LZW) and LZW encoder init | Write side | no | Not analysed in detail. No game code writes a compressed stream (see [Writes](#writes-save-games-and-hi_score)) |

### Game-level loaders (1000)

| addr | proposed name | purpose | blocking? | notes |
|---|---|---|---|---|
| 1000:0010 | main | Startup and resource order, see Overview | yes | |
| 1000:38e4 | loadSlyProbe(name) | `freeBitmap(DS:9bc2)`, `malloc(0xffff)`, then `9bc2 = loadBitmap(path)`, then `045a` | no (`045a` → `c00e` returns at once with motor bits 0; see the stance) | Called with "SLY.BMP" while DS:1fba=0. `main` sets `DS:9b84=1` when it fails |
| 1000:390a | freeSlyProbe | Frees `DS:9bc2` and calls `malloc(0xffff)` | no | |
| 1000:03f6 | showPostwar | `POSTWAR.SCR` → `loadScreen` | yes (inferred, screen fades) | |
| 1000:1692 | showDash | `"DASH" + itoa([9b0c],10) + ".SCR"` → `loadScreen` | unknown | |
| 1000:1e64 | showWin | `WIN.BMP` → `loadBitmap`/`freeBitmap`; `"MYCAR"+itoa([9b0c])` → `2c46:00b4`; winnings text via `ultoa` (`df12`); driver `.BMP` via `33be` | unknown | |
| 1000:1cee | showOpponent | Driver name `DS:17b6[[8db4]]` → `2c46:00b4` (driver `.tbl`) | unknown | |
| 1000:33be | driverBmpName(i) | `DS:a8d8 = DS:17b6[i] + ".BMP"` | no | |
| 1000:2dd0 | showCarScreen | `DS:18b8[[9b0c]]` ("CAR1".."CAR3") + ".SCR" → `loadScreen` | unknown | |
| 1000:32b8 | loadTrackFiles | `DS:1cb4[[9808]]` + ".MAP" → `1208`; strip the extension, + ".TRK" → `4fae` | unknown | |
| 1000:1208 | loadMap(path) | `fopen` and `filelength(fp->_file)`; `streamOpenFile(0, fp, "r", len)`; `streamRead` | no | layout under [.MAP](#map) |
| 1000:4fae | loadTrk(path) | Raw `open`/`read`/`close` | no | layout under [.TRK](#trk) |
| 1000:a53c / 2c46:006e / 2c46:00b4 / 1000:ad0a | shape and car table loaders | `name.tbl` → `ad0a` (open, filelength, halloc, `hugeRead`, close) | no | layout under [.tbl](#tbl-shapetbl-driver-and-car-tables) |
| 2524:4850 | showActivision (TTM opcode `'*'`) | `ACTIVISIO` → palette, `setPalette`, `loadScreen` (same FILE), close | yes (timed loop on `1000:a39c`) | The file in `game/` is `activisi`: `ACTIVISIO` fails on DOS 8.3 unless truncated (see open questions) |
| 1000:5136 / 51bc / 25bc | hiScoreLoad / hiScoreSave / hiScoreInsert | See [Writes](#writes-save-games-and-hi_score) | no | |
| 1000:525a / 52ec / 5368 | saveLoad / saveWrite / saveSerialize | See [Writes](#writes-save-games-and-hi_score) | no | |

## Chunk-file library (1ff8:4748-4de0)

### Slot structure, `DS:8a98 + 0x44·i`, i=0..3 (static)

| off | width | meaning |
|---|---|---|
| +0x00 | u16 | `FILE*` (near pointer into the MSC `_iob`). 0 = free |
| +0x02 | char[0x19] | current tag path, e.g. `"BMP:BIN:"`; 4 chars per level, NUL-terminated |
| +0x1c | u32 × 6 | `end[level]`: absolute end offset of the chunk open at each level, **with the container flag (bit 31) kept**. Index = depth/4. end[0] = file length \| 0x80000000 |
| +0x38 | s16 | depth in bytes (0, 4, 8 …) |
| +0x3a | s16 | match counter for the current path (index of the last match) |
| +0x3c | u32 | current position: the data offset of the current chunk (after its 8-byte header) |
| +0x40 | u32 | current chunk payload length, flag masked off (bits 0-30) |

`DS:8dd8` (0x44 bytes) holds a snapshot taken by `4ade` at its start. `4aae` restores it on failure.

### chunkSeek (1ff8:4ade)

**Signature:** `long chunkSeek(FILE *fp, const char *path, int n)`. It returns `slot.pos` in DX:AX, or −1L.

**Validation.** It returns −1L when `fp` is 0 or not open, when `strlen(path)` is 0, or when that length is not a multiple of 4 (`4b06-4b21`).

**Choosing the start** (addresses in `4b47-4bf7`). `same` means `tagPathEq(path, slot.path, 25)`.

| case | action | counter stored on success |
|---|---|---|
| `!same && n<=0` | Continue from the current position, no reset, n=1 | 0 |
| `!same && n>0` | Reset (`491e`), search the n-th match from the file start | n |
| `same && n==0 && ftell(fp)==pos` | Return `pos` at once. The chunk is still unread | unchanged |
| `same && n==-1` | `fseek(pos)`, return `pos` | unchanged |
| `same && n==0`, chunk consumed | Next match (n=1) | counter+1 (counter 0: stored 0) |
| `same && n>0 && n==counter` | `fseek(pos)`, return `pos` | unchanged |
| `same && n>counter` (counter≠0) | Search `n−counter` more matches forward | n |
| `same && n<counter`, or counter==0 | Reset and search from the start | n |

So `n=0` means "the current chunk if it has not been read yet, otherwise the next one". The test is done with `ftell`, which is why the port's `FILE` layer must report exact positions after a streamed payload.

**Traversal** (`4bfc-4d6e`) is a depth-first walk over the chunk tree:

1. **Step past the current chunk.** If `end[depth]` has bit 31 set (container), the walk descends: it calls `fseek(pos)` and leaves `pos` unchanged. Otherwise it skips the chunk: `pos += len`, then `fseek`.
2. **Count.** `if (n-- == 0)` the walk is done (`4d5b`).
3. **Pop finished levels** (`4c34`). While `end[depth]&0x7fffffff == pos`: at depth 0 this is end of file, so `4aae` returns −1L; otherwise `depth -= 4`.
4. **Enter or skip** (`4c64`). If the chunk at `depth` is a leaf, skip it and go back to step 3. If it is a container, read the child header (`4c96`):
   - `fread(slot+2+depth, 1, 4, fp)` must return 4.
   - `depth += 4`, which must stay below 0x18, so at most 5 levels.
   - Write NUL after the tag and do `pos += 8`.
   - `fread(&len, 4, 1, fp)` must return 1.
   - Set `end[depth] = pos + len_with_flag` and `len &= 0x7fffffff`.
   - **len == 0 fails the whole search** (`4d17`).
   - `len` must be strictly less than the file length (`4d20-4d38`).
5. **Match test.** If `depth == strlen(path)` and `tagPathEq(slot.path, path, len)`, go to step 2. Otherwise go to step 3.

**Storage rule.** On success the counter is stored and `pos` is returned. The file is left positioned at the payload start.

**Errors.** Any I/O or validation failure restores the snapshot, seeks back to the old `pos` and returns −1L.

**Consequences:**
- A `TRK:` file cannot be read through this library: its length field is invalid. `.MAP` files have no chunk header at all. Both are read by other code.
- The flag-kept `end[]` values compare correctly only because `pos` stays below 2 GiB.

### Loader conventions

Every `1ff8`/`2524`/`32e3` loader takes `fpOrName`:
- If `chunkIsOpen(x)` is true, it uses that `FILE*` without closing it, and the next load continues from the current position.
- Otherwise it calls `chunkOpen(x)` and `chunkClose`s the file before returning.

This is how `PALS.BLK`, `fonts.blk` and `bitmaps.blk` hold several resources of one type, read in file order with `n=0`. The `pals.blk` chunk order is SND, PAL, PAL, BMP (file-checked); `main` reads it as sound bank, palette, palette, bitmap.

## Stream codec (1ff8:05d2-20fe)

### Envelope

The envelope is the same as in `docs/asset-formats.md`: `u8 method, u32 decodedSize, data…`.

- `0d47` reads the method with `fgetc` and the size with `fread(…,1,4)`. It then sets the input position counter (+0x0a) to 5. The limit (+0x0e) is the caller's length, which **includes** the 5 header bytes. Input reads stop at `pos == limit`.
- Callers pass `chunkLen` for chunk leaves, or `filelength` for `.MAP`.

### Stream struct (0x21 bytes, `calloc`; handle table `DS:980e[100]`)

| off | width | meaning |
|---|---|---|
| +0x00 | u16 | near work/ring buffer (`calloc` of 0x80) |
| +0x02 | u32 | far work block (LZW dictionary, `DosAlloc(0x3ab3)` for reading) |
| +0x06 | u16 or u32 | `FILE*` (file source), or far pointer (memory source) |
| +0x0a | u32 | input bytes consumed, including the 5-byte header |
| +0x0e | u32 | input limit (caller's length) |
| +0x12 | u32 | decoded size, from the header in read mode, or bytes written so far in write mode |
| +0x16 | u32 | decoded bytes delivered (`1191`) |
| +0x1a / +0x1b | u8 | ring head / tail (mod 0x80) |
| +0x1c | u32 | `ftell(fp)` at open, the offset of the method byte. `100d` patches the size at +1; `14f9` rewinds to +5 |
| +0x20 | u8 | method in bits 0-4. 0x20 = file-backed, 0x40 = read mode |

### Method table at `DS:37c8` (entries of 0x0e bytes; m = 0..2)

| m | rbuf | rfar | wfar | decode | encode | einit | dinit |
|---|---|---|---|---|---|---|---|
| 0 raw | 0x80 | 0 | 0 | 05d2 | 066d | 0 | 0 |
| 1 RLE | 0x80 | 0 | 0 | 0605 | 1f14 | 0 | 0 |
| 2 LZW | 0x80 | 0x3ab3 | 0x7566 | 15fc | 1a12 | 19ba | 204a |

`0c50` rejects `m >= 3`, returning −1. A file with another method byte makes the open fail.

### Decompression compared with `src/formats.js`

**Method 0 (raw).** The decoder copies bytes until the input reaches its limit.

**Method 1 (RLE)** (`0605`, file source). The control byte `c` is handled as follows:
- `c & 0x80` clear: copy `c` literal bytes (`0870`).
- `c & 0x80` set: read one byte and repeat it `c & 0x7f` times (`0904`).

So `0x00` and `0x80` are both no-ops. This matches `formats.js`.

**Method 2 (LZW)** (`15fc`, `17ff`, `204a`):
- Codes are LSB-first.
- Code 256 resets the dictionary, sets next to 0x101 and raises the reset flag `DS:95d8`.
- An entry is added only while `next < 0x1000`.
- The KwKwK case is handled (`DS:8db6`, first byte of the previous string).

**How `17ff` reads codes.** It reads input in **groups of `width` bytes** into `DS:37f2` (`07ad`), so one group is 8 codes. It starts a new group when any of these holds:
- the current group is used up, with limit = bytes·8 − (width−1) bits;
- the width grows, which happens when `next > max`. At width 12, max = 0x1000 and the width never grows again;
- the reset flag is set, which brings back width 9 and max 0x1ff.

In each case the unread bits of the old group are discarded. A group read that returns 0 bytes ends decoding (−1).

**Reset code** (`1ff8:164e-166c`):
1. Fill the 256 prefix words with 0.
2. Set the reset flag `[95d8]=1` and set **next = 0x100** (`XCHG AL,AH` at 1661), not 0x101.
3. Read the next code (width 9, new group) and process it on the normal path.

That path adds a dead entry at 0x100 with the pre-reset code as prefix. Code 256 is always taken as reset before any lookup, so that entry is never used. The first code of a stream (`15e0`) adds nothing, and `next` starts at 0x101.

**Equivalence with `formats.js`:**
- `formats.js` adds no entry after a reset and skips to a group boundary only on the reset code. It grows the width at the same moment as the original (when `next` reaches `1<<width` after an addition).
- In both decoders the first growth comes exactly 256 codes after the stream start or after a reset, then every 2^k codes. Each of those counts is a multiple of 8, so the growth-time group discard in the original never skips real data.
- **Regression-validated:** the scratchpad script `lzwcheck.mjs` re-implements the original group reader as described here: groups of `width` bytes, discard on growth and on reset, next=0x100 after a reset, stop when the input runs out. On all 58 method-2 streams in `game/` (every LZW leaf plus the 10 maps), its output equals `formats.js` `unpack` byte for byte, including length. The streams contain 2 reset codes. `npm run audit:assets` also passes (92 files, 179 frames, 0 failures).

**End of decoding.** The original stops when the **input** is exhausted, or when the caller's `n` is satisfied. It never checks the declared size. `formats.js` stops at the declared size and throws on a mismatch. Callers compare the result with `streamSize`:
- `08de` and `4b34` fail on a mismatch.
- `0006` and `2fca` do not check.

**Pointer advance.** `0006`, `32e3:026a` and `2fca` advance the far destination by the chunk size, adding 0x1000 to the segment when the offset carries (huge-pointer arithmetic).

## File types: loaders and in-memory layout

| file | loader(s) | path build | tag path(s) read | result |
|---|---|---|---|---|
| `*.bmp`, `bitmaps.blk` (5 BMPs), `pals.blk` (1 BMP) | `1ff8:0006` | `2be8`, or the TTM opcode '2' string, or `33be` / `0xc04` | `BMP:INF:`, `BMP:BIN:`, (`BMP:VGA:` only when `DS:385f`≠0) | bitmap handle (below) |
| `*.scr`, `activisi` | `1ff8:2fca` | `2be8` (`POSTWAR.SCR`, `DASH<n>.SCR`, `CAR<n>.SCR`, TTM '1' string) | `SCR:BIN:` (`SCR:VGA:`) | drawn to the current page; nothing kept |
| `fonts.blk` | `1ff8:356e` ×3 | `2be8("fonts.blk")` | `FNT:` | font slots, DS:8e72/8e98/8eb4 |
| palettes (`pals.blk`, `activisi`, TTM '7') | `1ff8:3b7a` | `2be8` | `PAL:EGA:` (per adapter) | palette slot. `pals.blk` → `DS:a252[0..1]`; TTM → `DS:59ee` / `DS:05fc[]` |
| `pals.blk` SND | `32e3:009a` | `2be8("PALS.BLK")` | `SND:INF:`, `SND:IBM:`, `SND:ITM:` | sound bank 1 → `DS:8f9c`, selected by `32e3:05ba` |
| `*.mus` | `2524:4b34` | `2be8("danger.mus"/"trax.mus")` | `SND:` (leaf) | far DOS block of decoded MIDI. `DS:8f06/8f08` = danger, `DS:8f02/8f04` = trax |
| `title.ttm` | `2524:08de` | `2be8("TITLE.TTM")` | `TTM:` (leaf) | near heap buffer, `DS:05da[i]`/`05e4[i]` |
| `*.map` | `1000:1208` | `2be8(city+".MAP")` | none (whole file is one envelope) | skyline strips, see [.MAP](#map) |
| `*.trk` | `1000:4fae` | `.MAP` path with ".TRK" instead | none (`TRK:` signature, raw records) | arrays at DS:5c00 … |
| `*.tbl` | `1000:ad0a` via `2c46:006e`/`00b4` | `2be8` (`"SHAPE"`, driver name, `"MYCAR"+n`), then `1000:ac4c(path,"tbl")` → DS:5aa4 | none (raw) | huge DOS block, far-pointer table relocated |
| `hi_score` | `1000:5136` / `51bc` | `2be8("HI_SCORE")` | none (raw) | DS:1504 names, DS:1b30 scores |
| `*.RCT` | `1000:525a` / `52ec` | picker text at DS:a8d8, forced to `.RCT` (`2524:3b96`), **cwd-relative** | `RAC:` signature | DGROUP arrays (see Writes) |
| `.pal` / `.fnt` default extensions | `3b7a` / `356e` | appended when the name has no '.' | | No such files ship; every call passes a name with an extension, or an open `FILE*` |

### Bitmap (`BMP:`, bitmaps.blk, pals.blk BMP)

`loadBitmap` (`1ff8:0006`) works in these steps (static):

1. **Slot.** `idx = bitmapSlotFree()`. If it is negative, jump to cleanup and return 0.
   - Trap: cleanup tests `[BP-2]` (the "I opened the file" flag) **before it has been written**, so stale stack contents decide whether `chunkClose(fpOrName)` runs (`1ff8:03c7` and following).
2. **Count.** Seek `BMP:INF:` and read the count `u16 N`.
3. **Handle.** `h = malloc(2N+2)` and `h[0] = rec = malloc(10N)`. For i ≥ 1, `h[i] = rec + 10i`; `h[N] = 0`.
4. **Sizes.** Read N widths into `rec_i+6`, then N heights into `rec_i+8`. The widths are not interleaved with the heights, as in `formats.js` (file-checked by the audit).
5. **Buffers.** Driver slot 13 (EGA `29f6:1f4c`) returns `total = Σ(w/2·h) · 5/4` and sets `aux=0`. `pix = DosAlloc(total)`; `aux` is allocated only when non-zero.
6. **Pixels.** Seek `BMP:BIN:` and open a stream. `streamRead(…, 0x7fff)` runs repeatedly into `pix` (huge advance) until it returns less than 0x7fff.
7. **Conversion.** Driver slot 14 (EGA `29f6:1f8d`) converts in place, using video RAM `A600:0000` as scratch through the EGA latches. Then `streamClose`.
8. **VGA.** The `BMP:VGA:` branch runs only when `DS:385f`≠0.
9. **Register.** `bitmapReg(h, N, idx)`.

**EGA frame record** (10 bytes, `h[i]`), set by `29f6:1f8d`:

| off | width | meaning |
|---|---|---|
| +0 | u16 | segment of frame data (normalised) |
| +2 | u16 | offset of the 4 bit-plane block (q = (w/2·h)/4 bytes per plane, plane order 1,2,4,8) |
| +4 | u16 | offset of the 1-bit mask block (q bytes), = +2 + 4q |
| +6 | u16 | width in pixels |
| +8 | u16 | height |

- Frames are consecutive in one DOS block; frame i+1 starts right after frame i's mask.
- Only `rec[0]`'s segment is freed (`freeBitmap`).
- The plane and mask contents are produced by `29f6:2034/2137/216a`. Their exact bit order belongs to the EGA analysis. Inferred: the source is packed 4 bpp, high nibble first.

**Globals that receive handles:**
- `pals.blk` → `DS:9bf6` (pointer bitmap; fatal message `DS:00ad` when it fails)
- `bitmaps.blk` → `DS:965a`, `9a80`, `9aea`, `9bbe`, `8dc0` (fatal `DS:0190`/`01b4`)
- `SLY.BMP` probe → `DS:9bc2`
- TTM opcode '2' → `DS:9234`, `DS:578a`, `DS:0608[DS:5786]`

### Screen (`SCR:`, `activisi` SCR)

`loadScreen` (`1ff8:2fca`) works in these steps:

1. Call `52b1` (EGA: GC mode 2, write mode setup).
2. Seek `SCR:BIN:` and open a stream.
3. `buf = malloc(0xc80)`, halving the size until the allocation succeeds. `rows = size/160`.
4. For y = 0; y < 200; y += rows: `streamRead(buf, size)`, then driver slot 17 (`[0x4968]`, EGA `29f6:23d8`) with `(buf far, x=0, y, w=0x140, rows)`.
5. Free `buf`, close the stream, return 1.

The image is fixed at 320×200, packed 4 bpp, 160 bytes per row, with no `INF:` (file-checked: every SCR decodes to 32000 bytes). The `SCR:VGA:` branch is skipped on EGA.

### Font (`fonts.blk`)

`loadFont` (`1ff8:356e`) works in these steps:

1. Read 4 bytes after `FNT:` into the slot tables:
   - `DS:3874[n]` width
   - `DS:3888[n]` height
   - `DS:389c[n]` first char
   - `DS:38b0[n]` count
2. Driver slot 12 (EGA `29f6:21ad`) allocates `((ceil(w/8)·h) & 0xff) · count` bytes with INT 21h AH=48h. The 8-bit `MUL` truncates the first product.
3. It stores the segment in `DS:38c4[n]` and reads the glyphs in 80-byte `fread`s into that block, at offset 0, in file order.

The resulting layout is glyph-major, then row, then byte (MSB = leftmost), the same as the file (file-checked sizes 484/580/772).

Quirks:
- The 80-byte loop decrements an 8-bit count after each read, so a font smaller than 80 bytes would loop 256 times (`29f6:222c`). That does not happen with the shipped fonts.
- Slot 0 is the active font, copied in by `selectFont`.
- `main` stores fonts 1-3 in `DS:8e72` (4×5), `8e98` (6×6) and `8eb4` (8×8), and selects `8eb4`.

### Palette (`PAL:`)

The data is `PAL:EGA:`, 128 bytes = 64 little-endian words.

**Loading** (`29f6:225b`). Each word becomes `(lo & 0x0f) | ((hi >> 4) << 8)`:
- Words 0-31 go to `DS:41a4 + 0x40·n`.
- Words 32-63 go to `DS:4424 + 0x40·n`.

**Activation** (`29f6:22c9`, n≠0):
1. Zero entries c=0..15 of slot 0 in `41a4`, `4424` and `46a4`.
2. Copy `41c4[n][c]` → `41c4[0][c]` and `4444[n][c]` → `4444[0][c]`. These are the second halves (words 16-31 and 48-63).
3. Program the attribute register c with BIOS INT 10h AX=1000h, BL=c, BH = `v<8 ? v : v+8`, where `v = 41a4[n][c] & 0xf`.

**Meaning:**
- Words 0-15 are the 16 EGA colours (4-bit IRGB; 8-15 map to the intensified attribute codes 0x10-0x17).
- The second halves supply logical colors 16–31 as 2×2 ordered dither pairs: high/low bytes select even/odd x, `41a4`/`4424` select even/odd rows. See [graphics color model](graphics.md) for the translated consumers.
- The `CGA:` sub-chunk is not read on EGA.

**Globals:** `pals.blk` palettes go to `DS:a252/a254`. `main` activates `a252`, and many screens restore it (`setPalette([a252])`).

### Sound-effect bank (`pals.blk` SND)

`loadSoundBank` (`32e3:009a`) reads into record `r = DS:2c2c + 0x16·k`:
1. `SND:INF:`: read `u16 skip` (0x59d9, discarded), then `u16 → r+0x10` (count = 11), then `u16 → r+0x12` (0).
2. `SND:IBM:` (`01f1`): decoded into a DOS block whose far pointer goes to `r+0`. The tag is copied to `r+6`. The first `count` dwords of the block are offsets; each non-zero one gets the block base added as a 32-bit value.
3. `SND:ITM:`: a node pointer goes to `r+0x14`, or 0. `pals.blk` has no ITM chunk.

**Record layout:**

| off | width | meaning |
|---|---|---|
| +0 | far ptr | decoded IBM block |
| +4 | near ptr | next node (`malloc(0x10)`) |
| +6 | char[9] | tag path |
| +0x10 | u16 | count |
| +0x12 | u16 | INF word 3 |
| +0x14 | u16 | ITM node or 0 |

The block holds 11 relocated far pointers to PC-speaker command streams. Their command format and missing-ITM quirk are now translated in `src/game/sfx.js`; see [effect tick and bank data](input-timer-sound.md#effect-tick-334e0000-di-based-register-code). The asset viewer reuses that interpreter for individual-effect auditions. `main` stores the bank number in `DS:8f9c` and selects it with `32e3:05ba` (`DS:9a40`).

### Music (`.mus`)

`loadMusic` (`2524:4b34`) works in these steps:

1. Seek `SND:` (the top-level leaf) and open a stream.
2. `size = streamSize`, `p = DosAlloc(size)`.
3. Make **one** call, `streamRead(p, (u16)size)`.
4. Success requires `read == size` with the high word 0. Files are below 64 KiB: 2807 and 44814 bytes (file-checked).

On a mismatch it closes the stream and chunk file a second time (harmless no-ops), calls near `free(0)`, **leaks the DOS block** and returns 0:0.

**Result:** a far pointer `seg:0` to a standard MIDI file (format 0, 96 tpq). It is consumed by `1000:c60a`, now translated in `src/game/music.js`; see [music tick](input-timer-sound.md#music-tick-1000c731) and [hardware paths](hardware-paths.md).

### TTM script (`title.ttm`)

`loadTtm` (`2524:08de`) produces a near heap copy of the decoded `TTM:` payload (477 bytes). The interpreter `2524:0c66` reads opcodes as ASCII characters followed by arguments.

**Resource opcodes** (static). Each takes an inline NUL-terminated file name, which goes through `2be8`:

| opcode | action |
|---|---|
| `'1'` | `loadScreen` |
| `'2'` | `freeBitmap` of the current bitmap, then `loadBitmap` into `DS:9234` / `0608[DS:5786]` |
| `'4'` | `freeFont` of the current font, then `loadFont` into `DS:5784` / `05f0[DS:59f0]` |
| `'7'` | `freePalette`, then `loadPalette` into `DS:59ee` / `05fc[DS:578e]` and `setPalette` |
| `'\v'` / `'\f'` / `'\r'` | free palette / bitmap / font |
| `'8'` / `'9'` / `` '`' `` | select a bitmap / palette / font slot |
| `'*'` | skip 2 bytes, run `showActivision` (`2524:4850`), which loads `ACTIVISIO` |

The decoded `title.ttm` contains `2DYNAMIX.BMP`, `2CITYLINE.BMP`, `2TITLE.BMP` and `1CITYPIC.SCR` (file-checked).

### .MAP

Analysed with scratchpad scripts and checked against all 10 maps.

**Loader** (`1000:1208`):
1. `fopen` "rb" with the fopen-retry thunk `c1a2`.
2. `len = filelength(*(u8*)(fp+7))` (`e3d0`, using `fp->_file`).
3. `streamOpenFile(0, fp, "r", len)`, then a series of `streamRead` calls, then `streamClose` and `fclose`.

**Decoded layout** (file-checked, all 10 maps: LZW, 24026 bytes):

| off | type | meaning |
|---|---|---|
| 0 | u16 | N strips (= 6) |
| 2 | u16 × N | widths **in bytes** (160). Read into DS:9642 and then overwritten by the heights (static quirk) |
| 2+2N | u16 × N | heights (25), DS:9642 |
| 2+4N | bytes | Σ h·160 bytes of packed 4 bpp pixels, high nibble first |

Together the strips form a 1920×25 skyline panorama: six 320×25 strips, x wraps modulo 6 strips.

**Storage by adapter `DS:95d6`:**
- **2 (EGA):** a temporary buffer of 4000 bytes, halved until the allocation succeeds. `1000:ad8e` converts packed to planar into **video RAM at `A734:0000`**, then `ae8e(2)`. Stride 0x28.
- **3:** one linear buffer.
- **Others:** the CGA driver `2fd2:014e`.

`DS:9bce[i]` = far pointer to strip i. The EGA consumer is `2f73:000f`, which draws strip = x/320 mod 6 with row clipping.

### .TRK

Analysed with scratchpad scripts and checked against all 10 tracks. File size = 6 + 4N + 6·records exactly.

**Loader** (`1000:4fae`): `open(path, 0x8000)`, `read`, `close`. Errors go to `1000:6d62`: 3 open, 2 signature, 4 read.

| file off | type | destination | meaning |
|---|---|---|---|
| 0 | 4 bytes | | only `[0]=='T'` and `[3]==':'` checked |
| 4 | s16 N | DS:5c00 | roadside object count (11-19) |
| 6 | N × {u16, s16} | DS:9dfe[i], DS:aa46[i] | track point index; signed shape: sign = side (>0 left, ≤0 right), `abs()` = **shape.tbl model index** |
| 6+4N | {s16 x, y, z} × until EOF | DS:5c9e/5ca0/5ca2, stride 6 | track centreline points, about 30 units apart, closed loop. z = height (−1..200). From index 2 on, an all-zero record is dropped, not stored and not counted |

**After the read:** `DS:9b0a = DS:8986 = count−1`, and `DS:8988 = count−2` is used for wrap-around.

**Bounds:** none. The space from `DS:5c9e` up to the next known global (`DS:8958`, an LZW variable) holds 1908 points. The largest shipped track (orlando, 1892 points) ends at `DS:88e6`, so the shipped data overflows nothing. A longer file would overwrite the globals above (static; this does not prove that the range 5c9e-8958 has no other users).

**EOF handling:** EOF is a 0-byte read on a record's first word. A 0-byte read on its 2nd or 3rd word, or a −1, gives error 4.

**Objects** (`2524:18f4`, slots 20+k):
- Position:
  - x = x_p + 8·(y_p − y_{p+1})
  - y = y_p + 8·(x_{p+1} − x_p)
  - mirrored for the right side
  - z = z_p
- Pitch = `atan2Bin(0x1e, Δz)` (`2c46:3220`, binary angles, 0x10000 = 360°).
- Heading = track heading − 0x4000.
- Drawn by `1000:aae4([aa1e+2·slot], &8f9e[3k], &a9a4[3k])`.
- Shapes ≤ 11 are replaced by shape 3 under a distance condition (`a832` path: distance > 50).
- `1000:8b94` computes the signed along-track distance from player point `DS:96f2`, stored in `DS:89cc`.

### .tbl (`shape.tbl`, driver and car tables)

All 13 `.tbl` files use one 3D-model format. File-checked across 136 models, 1195 groups and 3525 faces, with zero index violations.

**Loading:**
- **shape.tbl.** `main` calls `2be8("SHAPE")`, then `1000:a53c(DS:99ec)` (`1000:01e8-01f8`). Only a NULL argument would fall back to `DS:2a3e` "shape" (cwd-relative); `main` is the only caller. `a53c` calls `2c46:006e`:
  1. Free the old table at `DS:2a6a/2a6c`.
  2. `ac4c(name,"tbl")` → `DS:5aa4`, which copies `name`, then `'.'`, then `"tbl"`, with no bound and no check for an existing extension. The result is `<gamedir>\SHAPE.tbl`.
  3. `1000:ad0a`, which does `open(…,0x8000)`, `filelength`, `halloc(len,1)`, `hugeRead` and `close`. It calls `1000:ad82` → fatal `DS:2a7d` "FATAL ERROR: Unable to load 3D shape table." when the open fails, the allocation is NULL, or the offset is ≠0.
  4. Store the far pointer in `DS:2a6a` and `DS:98dc/98de` (current table), then relocate (`2c46:000a`).
  5. `a53c` then sets `[9640]=7` (projection shift), `[a8a2]=0x80`, `[8ec0]=1` (near plane) and `[8e8a]=0x2a44` (identity colour map 00..1f).
- **Driver and car tables** (`2c46:00b4`). Same steps, pointer in `DS:2a6e`:
  - `1000:1cee` loads driver tables, names from `DS:17b6[1..9]`: SLY, MEGA, ANGEL, LURKER, MENACE, CRIMSON, MANIAC, WRECKER, MELISSA.
  - `1000:1e64` loads `MYCAR0..2`.
  - Both are used only for the preview of model 0 (`1000:1d74`). `1000:047c` reselects shape.tbl for the race; **in the race every car and object comes from shape.tbl**.
  - Bug to preserve: `2c46:00be` skips the free whenever the old pointer is non-zero, so each load leaks the previous block.

**Header.** The file starts with a table of far pointers {u16 off, u16 para}, relative to the file start and ended by a zero dword. `2c46:000a` adds the base with a 32-bit add. shape.tbl has 124 entries (`para:0000`, padded to 0x200); each car or driver file has 1 entry (`0001:0000`).

**Model** (offsets model-relative):

| off | type | meaning |
|---|---|---|
| +0 | s16 | bounding radius (`2c46:1504`) |
| +2 | u8 | always 0, unknown |
| +3 | u8 | nv = vertex count, normals included |
| +4 | u16 | offset of nv × {s16 x, y, z}. The vertex array is always last |
| +6 | list | LOD {u16 threshold, u16 detailOff}, ended by 0xFFFF. The first entry with threshold ≤ `[98fc]` (signed) is used. Every file has one entry (1, 0x0C) |

**Detail block:** u8 flags (bit 7 = draw nothing), u8 reference vertex, then u16 group offsets ended by 0xFFFF.

**Group:** u8 flags (0, 0xC0, 0x80; no reader found), u8 sort vertex, then u16 face offsets ended by 0xFFFF. Groups are sorted far to near with the 32-bit dot product `2c46:14b3`: DX compared signed, then AX unsigned.

**Face:**
- b0 = normal vertex (0xFF = two-sided)
- b1 = colour, through `[8e8a]` → `DS:384e`
- b2 = second colour → `DS:384d` (dither pair, inferred)
- b3… = vertex indices, ended by 0xFF

A face is drawn when `14b3(b0,b3)` gives DX < 0.

**Transform** (`2c46:1317`/`13ad`/`10d2`):
- Rotate with the Q14 3×3 matrix at `[9236]`, keeping the high word after `SHL`×2, then add `[9bf8..9bfc]`.
- Project: `sx = [9b8e] + (x'<<[9640])/y'` and `sy = [9bb8] − (z'<<[9640])/y'`, using signed `IDIV`. Near clip is y' < `[8ec0]`.

**No car statistics are stored in `.tbl` files** (static: relocation is the only parse).

## Writes: save games and hi_score

Only two kinds of file are written (static): `HI_SCORE` with `open`/`write`, and `*.RCT` with `fopen("wb")`/`fwrite`. The only delete is `unlink(DS:a8d8)` when a save's `fclose` fails. No compressed stream is written: every `streamOpenFile` call passes "r". No checksums, no encryption.

### HI_SCORE (190 bytes; file-checked against `game/hi_score`)

The file is 10 records × 19 bytes with no header:

| off | size | field |
|---|---|---|
| 0 | 15 | name, NUL-terminated within 15. Bytes after the NUL are leftovers (`strcpy` into a fixed field) |
| 15 | 4 | u32 winnings (`DS:a22a[0]`), compared unsigned |

- **Load** (`1000:5136`): `open(path, 0x8000)` (O_RDONLY\|O_BINARY), then 10 × (`read(fd, DS:1b58[i], 15)`, `read(fd, &DS:1b30[i], 4)`), then `close` and `045a`. Read results are ignored. Returns 1, or 0 when the open fails.
- **Save** (`1000:51bc`): `open(path, 0x8301, 0x80)` (O_WRONLY\|O_CREAT\|O_TRUNC\|O_BINARY, S_IWRITE), then the same 10 × 2 writes using `write` = `1000:dd26`. A write error stops the loop. When the open fails it shows message 0xd (`6d76(0xd,0)`).
- **Insert** (`1000:25bc`, called from `397c` when `[9a3e]==0`):
  1. If no `score[i] < W`, return.
  2. Otherwise k = the minimum entry, scanning 9→0 with strict `<` (ties go to the highest index).
  3. Set `score[k]=W`, `strcpy(name[k], DS:1792)` and save. The table stays **unsorted**.
- **Memory:** names at `DS:1504+15i` through the pointer table `DS:1b58[10]`, scores u32 at `DS:1b30[10]`. The EXE defaults are 10 × "NEW KID       ", 0.
- **Gate:** `1000:39ae` calls `5136` before every screen dispatch. A missing file shows message 0xd and **does not dispatch**, so the port must supply a HI_SCORE.

### .RCT save file (428 bytes, static)

**Format:** `"RAC:"` + 424-byte body. Only `[0]=='R'` and `[3]==':'` are checked on load.

**Body** (`1000:5368`, the same routine for both directions, through the function pointer `DS:8e94` = `fread` `d6a0` or `fwrite` `d886`). First come 10 records (i = 0..9) of 36 bytes:

| rec off | size | source |
|---|---|---|
| 0 | 2 | 96dc+2i |
| 2 | 2 | 8e5c+2i |
| 4 | 2 | 9b0e+2i |
| 6 | 2 | a8c4+2i |
| 8 | 2 | 9238+2i |
| 10 | 2 | 9a86+2i |
| 12 | 2 | 5c04+2i |
| 14 | 4 | a22a+4i (u32 cash/winnings; [0] = player) |
| 18 | 2 | 1c5c+2i |
| 20 | 2 | 9aa6+2i |
| 22 | 10 | bytes 9926+i+10j, j = 0..9 (column i of a 10×10 matrix) |
| 32 | 2 | 9b6c+2i |
| 34 | 2 | 1c48+2i |

At body offset 360 follow:
- 6 words `1fc8..1fd2`
- 9 words `1fd4..1fe4`
- 10 words: `d24`, `8eb8`, `9b0c`, `115e`, `1160`, `d28`, `a670`, `8dac`, `8eb6`, `aa9e`
- 14 bytes at `DS:1792` (player name, its NUL not saved)

The meaning of most fields is unknown. `d28` is incremented per race (`1000:3986`). `8eb8` is printed as 2 digits into `DS:065c` after a successful `fclose`.

**Error quirks** (`6d62` ids 0x21-0x25):
- When the open fails, the game still calls `fclose(NULL)`.
- On a short header or body transfer the `FILE` is never closed.
- The return value of the final 14-byte transfer is not checked.

**Picker** (`1000:4f28`/`4dc0`, `2524:2db2`):
1. `findfirst("*.*", 0x10)` and `findnext` add directories whose attribute is exactly 0x10, decorated with `" (DIR)"`.
2. `findfirst("*.RCT", 0)` and `findnext` add files.
3. Up to 220 entries (`malloc(0x1b8)`), with no bound check.
4. Selecting a directory calls `chdir` (`2524:35b0`). Changing drive uses INT 21h AH=0Eh/36h with a temporary INT 24h handler (`2524:3ada/3b06`, which writes into code segment 2524).

## C runtime services

MSC 5.x, medium model. Evidence is static unless marked otherwise.

### Conventions

- **Calling.** Runtime functions are **near** (`RET`), with the first argument at `[BP+4]`.
  - Game code in other segments calls the far thunks `1000:c0xx-c32x` (`RETF`, first argument at `[BP+6]`). The thunks only re-push their arguments.
  - Exception: `c080`/`c094`/`c0a8` do no stack cleanup, because their targets end in `RET 8`.
- **Error globals.**
  - `errno` is `DS:53e3` and `_doserrno` is `DS:53ee`.
  - `1000:ed62` maps a DOS error in AL through `DS:5432`; codes above 0x13 are clamped. A non-zero AH is taken as the errno value directly (9 EBADF, 0x16 EINVAL, 0x11 EEXIST, 0x18 EMFILE, 0x1c ENOSPC).
  - Shared epilogues: `ed4f` sets AX=DX=−1 on CF; `ed3c` returns AX = 0 or −1.
- **Low-level file tables.**
  - `_osfile[h]` at `DS:53f2`: 0x01 open, 0x02 EOF, 0x04 CRLF pending, 0x20 append, 0x40 device, 0x80 text.
  - `_nfile` at `DS:53f0`; `_fmode` at `DS:5575` (0x80 = binary).
- **`FILE` = `_iob[]` at `DS:5446`**, 8 bytes per entry:
  - fields: `+0 _ptr`, `+2 _cnt` (s16), `+4 _base`, `+6 _flag`, `+7 _file`
  - `_flag` bits: 0x01 read, 0x02 write, 0x04 unbuffered, 0x08 malloc'd buffer, 0x10 EOF, 0x20 error, 0x40 string, 0x80 read/write
  - `_iob2[]` at `DS:54e6`, 6 bytes per stream: `_flag2`, `_charbuf`, `_bufsiz`, `_tmpnum`
  - The last entry is at `DS:555e`.
- **Fatal errors and stack checks.**
  - `1000:eab4` is `_chkstk` (ignore in JS).
  - `1000:d43f` is the fatal path: it prints R60xx and exits with 0xff. In JS, throw.

### Far thunks (1000:c000-c34x)

| addr | name / target | purpose | blocking? | game callers / notes |
|---|---|---|---|---|
| c00e | floppyMotorOffWait (game code, near) | If `[385c]==0`: sets `0:0440=1` and polls `0:043F&3`, up to 20×65535 loops | no (by the stance: with the port's motor bits at 0 it returns at once; in the original it is a bounded busy-wait) | `1000:045a` |
| c03e / c0c0 / c0f4 / c156 | → 4808 / 4d06 / 4bd4 / 031a | Game UI drawing, not runtime | ? | |
| c058 | strlen | inline `REPNE SCASB` | no | 14 callers |
| c070 | delayTicks(n) | `a3aa`: `[5a9e]=n`, then loops `a3a0` while `[5a9e]>0`. Timer callback `1000:a3be` (slot 0xd) decrements it | **yes** | `2524:0c34` |
| c080 / c094 / c0a8 | uldiv / lmul / ulmod | far wrappers of `e9c0` / `e8a8` / `ea22` | no | `2524:156a`, `3cd6`, `0624` |
| c0bc, c144 | rand | `CALL a3ca; RETF` | no | c144: `2524:0624`, `1e30`, `21d2`. c0bc unreferenced |
| c0d4 | chdir → e70b | | no | `1000:4dc0`, `2524:35b0` |
| c0e2 | getcwd → e740 | | no | `1000:4dc0`, `2524:3020` |
| c10c | strcmp | inline; unsigned bytes; returns −1, 0 or 1 | no | `2524:308a` |
| c132 | stricmp → e504 | | no | `2524:043c` (argv) |
| c148 | abs(int) | abs(−32768) = −32768 | no | `1000:77c8`, `2524:18f4`, `3cd6` |
| c15a / c16c / c180 / c18e / c1ee | open (2 or 3 args) / close / read / lseek | | no | no references found |
| c1a2 | fopenRetry(name, mode) | `fopen` (`d678`). If it returns NULL and `[1fba]≠0`: `[a462]++` and retry, **with no limit** | no (by the stance: the port turns the endless retry into `unsupported()`) | `1000:1208`, `1ff8:4a48` |
| c1d6 | fseek → df34 | | no | 1ff8 library |
| c206 | ftell → e1d4 | long result | no | `1ff8:0d47`, `4a48`, `4ade` |
| c214 / c22c | fread → d6a0 / fwrite → d886 | | no | library, drivers / `0d47`, `100d` |
| c244 / c31a | fputc → d9c2 / fgetc → d9ea | | no | codec |
| c256 | rewind → e350 | | no | `1ff8:491e` |
| c264 | fclose → d5be | | no | `1000:1208`, `1ff8:0d47`, `4da4` |
| c272 | malloc → de60 | near heap | no | 13 callers |
| c280 | free | `de4e(p)`, then `de60(0xffff)` with the result discarded | no | coalescing side effect (inferred) |
| c298 / c2ce / c2f6 | strcat / strcpy / strrchr (→ e4da) | inline / inline / | no | |
| c308 | calloc → dea6 | | no | `1ff8:0bd6`, `0c50` |

### Low-level I/O (INT 21h)

| addr | C signature | semantics for JS | game callers |
|---|---|---|---|
| daa4 | `int open(char *path, int oflag, int pmode)` | oflag: access in bits 0-1, plus 0x0008 APPEND, 0x0100 CREAT, 0x0200 TRUNC, 0x0400 EXCL, 0x4000 TEXT, 0x8000 BINARY. Uses AH=3Dh, or AH=3Ch when CREAT is set and the file is missing. pmode without 0x80 makes the file read-only. Returns the handle (sets `_osfile`) or −1 with errno | `1000:4fae`, `5136`, `51bc`, `ad0a` (0x8000 read); `51bc` (0x8301, 0x80 write); `f040` |
| dc48 | `int read(int h, void *buf, unsigned n)` | AH=3Fh. Binary: the byte count, short at EOF. Text mode (unused): drops CR before LF, stops at ^Z | `4fae`, `5136`, stdio |
| dd26 | `int write(int h, void *buf, unsigned n)` | AH=40h. Append mode seeks to the end first. Text mode converts LF→CRLF. 0 bytes written → ENOSPC, −1 | `1000:51bc`, stdio |
| da2a | `long lseek(int h, long off, int whence)` | AH=42h. A resulting position < 0 → EINVAL. Success clears the EOF bit | stdio, `e3d0` |
| da0a | `int close(int h)` | AH=3Eh. Returns 0 or −1 (EBADF) | `4fae`, `5136`, `51bc`, `ad0a`, `d5be` |
| e3d0 | `long filelength(int h)` | lseek(cur), lseek(end), restore. Returns −1L on error. **Not malloc** | `1000:1208` (with `fp->_file`), `ac8e`, `ad0a` |
| e70b | `int chdir(char *p)` | AH=3Bh | `main` (`8f0c`), `1000:0344` (`a902`, at exit), `c0d4` |
| e740 / e754 | `char *getcwd(char *buf, int n)` = `_getdcwd(0, buf, n)` | Builds `"X:\"` and calls AH=47h. NULL buf → malloc. Too long → ERANGE, returns NULL | `main` (`a902`, 0x3b; failure → fatal 0x42), picker |
| e7fe | `int unlink(char *p)` | AH=41h | `1000:5368` (`unlink(DS:a8d8)` after a failed `fclose` in write mode), `d5be` (tmpfiles; the game creates none) |
| e704 / e718 | mkdir / rmdir | | unreferenced |
| fd0a / fd1c | bdos / intdos | raw INT 21h | `e754` only |

### stdio

| addr | function | notes |
|---|---|---|
| d678 | `FILE *fopen(name, mode)` | `fa6e` takes the first `_iob` entry with `(_flag&0x83)==0` and sets `_file=0xff`. Then `f040` maps mode to oflag (`r` 0, `w` 0x301, `a` 0x109, `+` RDWR with `_flag` 0x80, `b` 0x8000, `t` 0x4000) and calls `open(…, 0x1a4)`. `[5684]++` |
| d5be | `int fclose(FILE*)` | fflush, free the buffer, close. Unlinks `"\<tmpnum>"` when `_tmpnum` is set. Returns 0 or −1 |
| d6a0 / d886 | `fread` / `fwrite(buf, size, n, fp)` | `size*n` is a 16-bit product. Multiples of 512 on unbuffered binary streams go straight to `read`/`write`. Return the number of whole items |
| df34 | `int fseek(fp, long, whence)` | whence 0..2, else EINVAL. Reuses the buffer when the target is inside it (uses `e8dc`, `e80c`, `e8a8`). Clears EOF |
| e1d4 | `long ftell(fp)` | `lseek(h,0,1)` minus buffered `_cnt`, with a text-mode correction |
| e350 | `void rewind(fp)` | fflush, clear EOF/error, `lseek(0)` |
| d9ea / d9c2 | `fgetc` / `fputc` | `_filbuf` `ed90` / `_flsbuf` `ee50` |
| efd4 | `_getbuf` | The first I/O on a stream **mallocs a 512-byte buffer from the near heap**. When that fails, a 1-byte `_charbuf` is used instead |
| e382 / f1a6 | vsprintf / `_output` | Only reached from the unreferenced debug routine `1000:bfd8` (MDA text at B000). **The game never uses printf; `_output` need not be ported** |

### Memory

| addr | C signature | semantics | callers |
|---|---|---|---|
| de60 | `void *malloc(unsigned n)` | Near heap in DGROUP, first fit. The first call initialises the heap (`fbfc`). Growth goes through `fe6c`/`fe2a`/`feda` (AH=4Ah, or a new segment via AH=48h). Returns 0 on failure | `c272`, `1000:3a1e`, `3b46`, `3bb6`, `4778`, `47be`, `ac8e`, stdio |
| de4e | `void free(void *p)` | Sets bit 0 of the header word at p−2. NULL is a no-op | `c280`, `4778`, `47be` |
| dea6 | `void *calloc(unsigned n, unsigned size)` | `lmul`; a product > 0xffff returns 0; then memset 0 | `c308` |
| e43c | `void huge *halloc(long n, unsigned size)` | Rejects 0, ≥ 0xFFFF0, and > 128 KiB unless size is a power of two. Pads between 64 KiB and 128 KiB so no element straddles a segment. AH=48h, zero-filled. Returns `seg:0` or 0 | `1000:ad0a` (`halloc(filelength,1)`) |
| e430 | `hfree(void huge*)` | AH=49h on the segment | unreferenced; the game frees with `1ff8:3ae2` |
| fe6c | heap-grow helper | **Not halloc** (the task list's label is wrong) | `fbfc` |

### Long arithmetic

Each takes `(a_lo, a_hi, b_lo, b_hi)`, returns DX:AX, and pops its own arguments (`RET 8`).

| addr | name | semantics | JS |
|---|---|---|---|
| e8a8 | `_aNlmul` | low 32 bits of a·b | `lmul` = `Math.imul` |
| e80c | `_aNldiv` | signed, truncates toward 0; the quotient is negated when exactly one operand is negative. b=0 raises INT 0. −2³¹/−1 wraps | `s32(Math.trunc(a/b))`, throw on 0 |
| e8dc | `_aNlrem` | signed; result has the sign of the dividend | `s32(a % b)` |
| e9c0 | `_aNuldiv` | unsigned | `u32(Math.floor(a/b))` |
| ea22 | `_aNulrem` | unsigned | `u32(a % b)` |
| e97e | `*(long*)p /= b` | `RET 6`, `(p, b_lo, b_hi)` | |
| e9a0 | `*(ulong*)p >>= n` | `RET 4`, `(p, n)`, via `fe1e` (DX:AX >>= CL, register args) | |

Callers:
- `e80c`: `1000:1208`, `24c4`, `4808`, `598c`, `5a88`, `5c7c`, `77c8`, `996c`, `aa2a`, `aae4`, `b234`, `b6dc`, `be7e`, `d384`, `df34`, `e97e`
- `e8a8`: `24c4`, `4808`, `598c`, `5a88`, `5c7c`, `84be`, `c094`, `dea6`, `df34`
- `e8dc`: `2230`, `df34`
- `e9c0`: `3760`, `598c`, `c080`
- `ea22`: `3760`, `c0a8`

There are no long-shift-left or signed-shift helpers: the game inlines those.

### Strings and conversion

| addr | C signature | semantics | callers |
|---|---|---|---|
| e4da | `char *strrchr(char*, int)` | c=0 finds the terminator | `c2f6` |
| e504 | `int stricmp(char*, char*)` | folds A-Z to lower case, unsigned compare, returns −1, 0 or 1 | `c132` |
| e546 | `memmove` | copies backward when the ranges overlap | `1000:4f8c` |
| fd64 / fd90 | `memcpy` / `memset` | | stdio, calloc |
| fc5c / fc1c / fc8e | strcpy / strcat / strlen | runtime-internal copies | |
| df1c | `int toupper(int c)` | `_ctype[c+1]&2` (table `DS:5583`) → c−0x20. No bounds check | `1000:3fe4`, `66d2`, `6dbc` |
| def6 | `char *itoa(int v, char *buf, int radix)` | Signed only when radix==10; otherwise unsigned 16-bit. **Lower-case** digits. Returns buf | `1000:1692`, `1e64`, `204c`, `34b0`, `5a88`, `5df6`, `7f3c`, `8c10`, `9406`, `d5be` |
| df12 | `char *ultoa(unsigned long v, char *buf, int radix)` | **ultoa, not ltoa**: never writes '-' (core `fdbe`/`fdca`) | `1000:1e64` (winnings), `3760`, `f4c4` |
| fcaa | `long atol(char*)` = atoi | Skips spaces and tabs, optional sign, decimal digits, 32-bit wraparound. Returns DX:AX | only via the thunk `1000:def2` (`JMP fcaa`) from `1000:047c` (`n = atoi(*(char**)0xb4e)`; `[8eb8] = n>1 ? n : 1`) |
| e58e | abs | | unreferenced |

### Sorts

- **`1000:e5a4` is the MSC `qsort(base, num, width, cmp)`.** The comparator is a near function in seg 1000.
  - It first returns early when the array is already sorted (no adjacent pair with `cmp > 0`).
  - It stores width and cmp at `DS:5428`/`542a`, then calls the core `e614(hi, lo)` (`RET 4`); swaps use `e6cc`.
  - Every caller uses `qsort(DS:8eda, 10, 1, 1000:2208)`: `1000:22fe`, `3406`, `34b0`.
  - The comparator `1000:2208` is missing from `callgraph.json`. Translate the core literally, because the order of equal elements depends on it:

```
while (lo < hi) {                                   // unsigned
  DI = lo; SI = hi + w;
  for (;;) {
    do DI += w; while (DI < hi && cmp(DI, lo) <= 0);
    do SI -= w; while (SI > lo && cmp(SI, lo) >= 0);
    if (SI > DI) swap(DI, SI); else break;
  }
  swap(lo, SI);
  if (SI - lo < hi - SI) { e614(SI - w, lo); lo = SI + w; }
  else                   { e614(hi, SI + w); hi = SI - w; }
}
```

- **`1000:a410` / `a470` are game code, not runtime.**
  - `a410(idx)` checks 39 signed-byte indices for descending order of the key `word DS:8f48[idx]` (signed). When it finds an inversion, it calls `a470(idx+0x26, idx)`.
  - `a470` is the same quicksort with the comparison inlined: the DI scan continues while `key[*DI] > pivot` and the SI scan while `key[*SI] < pivot`. The pivot is `key[*lo]`, read once per outer pass.
  - Caller: `1000:a570` (inferred: per-frame depth sort).

### 2524 DOS helpers

All of these are real code with valid prologues, not gap-fill artefacts.

| addr | signature | semantics |
|---|---|---|
| 2524:3a7b | `int findFirst(char *spec, int attr)` | AH=4Eh. Returns AL zero-extended (0 = found; inferred that DOS leaves AL=0 on success). **Always** copies the DTA (`3a4c`): name (13 bytes from DTA+0x1e) → `DS:1198`, attribute (DTA+0x15) → `DS:11c4` |
| 2524:3a99 | `int findNext(char *spec, int attr)` | AH=4Fh (DX and CX are ignored by DOS); same return and DTA copy |
| 2524:3ab7 / 3abd | `dtaAttr()` / `dtaName()` | `[11c4]` / `0x1198` |
| 2524:3b41 / 3b86 | `selectDrive(d)` / `numDrives()` | INT 21h AH=36h/0Eh under a temporary INT 24h handler |
| 2524:3b96 | `forceRctExt()` | `strrchr(a8d8,'.')`; if found, cut there; **always** `strcat(a8d8, ".RCT")` (`2524:3bb1` jumps to the `strcat`) |

## Data

### DGROUP

| off | width | meaning |
|---|---|---|
| 8f0c | char[] | game directory: `argv[0]` cut at the last '\' before the extension (`1000:0010`). Its size is not established |
| 115a | char[2] | `"\\"` |
| 99ec | char[] | path built by `2be8`; also passed as "filename" to loaders |
| a8d8 | char[] | scratch name buffer (`city.MAP`, driver `.BMP`, `MYCAR<n>`, picker text, save name) |
| 5aa4 | char[] | `ac4c` result (`name.tbl`) |
| a902 | char[0x3b] | cwd at startup (`getcwd`); restored at exit (`1000:0344`) |
| 1fba | u16 | `fopen` retry flag for `c1a2`. 0 around `SLY.BMP` (`1000:00b5`) and the HI_SCORE load (`39ae`), 1 otherwise |
| a462 | u16 | incremented on each `fopen` retry; also used as a race flag (`2524:1cf0`, `4349`, `1000:054d`) |
| 8a98 | 4 × 0x44 | chunk slots |
| 8dd8 | 0x44 | chunkSeek snapshot |
| 980e | u16[100] | stream handle table |
| 8e9a | u16 | current stream struct pointer |
| 37c8 | 3 × 0x0e | codec method table |
| 37c4/37c6 | far | preset far work block for the codec (0 = allocate) |
| 37f2 | u8[12] | LZW code group buffer; `37fe` = mask table `00 01 03 … ff` |
| a25e/895c/a028/95d8 | s16 | LZW width / max code / next code / reset flag |
| 9ad4/9a3c | s16 | LZW bit position / bit limit in the group |
| 896e | u16 | encoder output count |
| 9638/963a | far | decode destination; 9bc4 = bytes still wanted |
| 99b8/99ba | far | memory-source pointer; 9b08 = `FILE*` source; 9aa4 = 0x20 file \| 0x40 deliver |
| 5af4 / 5b44 | u16[40] / u16[40] | bitmap registry: frame count / handle |
| 4186 | u8[10] | palette slots; [0] = current palette |
| 41a4 / 4424 / 46a4 | 10 × 0x40 | palette tables (A, B, cleared C) |
| 3874/3888/389c/38b0 | u8[20] | font width / height / first / count; [0] = current |
| 38c4 | u16[20] | font glyph segments; [0] = current |
| 4b86 | u16[9] | palette tag per adapter `[385d]` |
| 385d | s8 | adapter (2 = EGA); 385f = VGA flag |
| 4924 | far[35] | driver slots (13 bitmap size, 14 bitmap convert, 12 font load, 17 blit, 19 palette load, 20 palette set) |
| 05da / 05e4 | u16[5] | TTM buffers start / end |
| 2c2c | 10 × 0x16 | sound bank records; 9a40 = selected bank |
| 8f06/8f08, 8f02/8f04 | far | danger.mus, trax.mus |
| 9bf6, 9bc2, 965a, 9a80, 9aea, 9bbe, 8dc0 | u16 | bitmap handles (pointer, SLY probe, bitmaps.blk ×5) |
| a252/a254 | u16 | pals.blk palette slots |
| 8e72/8e98/8eb4 | u16 | font slots |
| 2a6a/2a6c, 2a6e/2a70, 98dc/98de | far | shape table, car/driver table, current table |
| 9642, 9bce | | `.MAP` heights / strip pointers |
| 5c00, 9dfe, aa46, 5c9e…, 9b0a, 8986, 8988 | | `.TRK` data |
| 1504, 1b58, 1b30 | | hi-score names / name pointers / scores |
| 1cb4, 17b6, 18b8, 17a2 | u16[] | name tables: cities, driver files, CAR1-3, driver display names |

### Code-segment data

- `1ff8:0006` etc. use `DS:2bce/2bd7/2be2` "BMP:INF:"/"BMP:BIN:"/"BMP:VGA:", `DS:49d6/49e1` "SCR:BIN:"/"SCR:VGA:", `DS:2d39` "SND:", `DS:0618` "TTM:", `DS:2d08/2d11/2d1a` "SND:INF:/IBM:/ITM:".
- The codec code at `1ff8:15e0-18c5` is hand-written asm with near register calling conventions, no frame, and fall-through fragments.

## Environment touch points

- **Files read:**
  - `PALS.BLK`, `danger.mus`, `fonts.blk`, `TITLE.TTM`, `ACTIVISIO`, `POSTWAR.SCR`, `bitmaps.blk`, `trax.mus`, `SLY.BMP`
  - `shape.tbl`, driver `.tbl`, `MYCAR<n>.tbl`
  - `<CITY>.MAP`, `<CITY>.TRK`
  - `DASH<n>.SCR`, `CAR<n>.SCR`, `WIN.BMP`, driver `.BMP`, `RESULTS.BMP` (DS:1145, not traced)
  - `HI_SCORE`, `*.RCT`
- **Files written:** `HI_SCORE`, `*.RCT`. Deleted: `*.RCT` (failed save).
- **INT 21h:**
  - 48h/49h (`3a88`/`3ae2`, `29f6:21ad`)
  - 3Fh/40h (`39c2`/`3a26`)
  - 3Bh, 47h, 0Eh, 36h, 4Eh, 4Fh, 2Fh, 41h, 25h/35h (picker, startup)
  - plus the runtime's own open/read/write/lseek/close
- **INT 10h** AX=1000h (palette).
- **BIOS data:** `0:043F`, `0:0440` (`1000:c00e` floppy-motor wait after loads), `0:0504`.
- **Video RAM** as scratch for bitmap conversion (`A600:0000`), and for EGA `.MAP` strips (`A734:0000`).

## Translation notes

- **Blocking stance used in the "blocking?" columns.** Two kinds of wait are classed as non-blocking, so their callers stay plain functions:
  - The endless `fopen` retry in `c1a2` (missing file while `DS:1fba≠0`). The port reports it with `unsupported()`.
  - The floppy-motor wait `1000:c00e` (via `045a`, after every load and every hi_score or save access). The port reports motor bits 0, so it returns at once.

  Real waits are `1000:c070` (delayTicks), `2524:4850` (logo loop) and the TTM interpreter `2524:0c66`.
- **`fopen` retry (`1000:c1a2`).** When `DS:1fba≠0` and `fopen` fails, the loop never ends and never yields. The INT 24h handler ignores errors. The port must turn this into an explicit diagnostic (`unsupported`) or a blocking "insert disk" wait. Today it is a hang.
- **`FILE*` identity.**
  - Chunk slots are keyed by the `FILE*` value, and loaders tell a `FILE*` from a filename only by `chunkIsOpen(ptr)`. Both are DS offsets: a name buffer at the same offset as an open `FILE` would be misread.
  - The port must place `FILE` structs in the emulated `_iob` at the original DS offsets, and keep `fp->_file` at +7, which `1000:1208` reads.
- **Exact `ftell`.** `chunkSeek(n=0)` compares `ftell` with the stored data offset. Stdio buffering must report the logical position.
- **Long returns in DX:AX** that the decompiler hides: `4ade`, `4d72` (`MOV DX,[BX+0x42]` at 4d9c), `1310` (`MOV DX,[BX+0x14]` at 133a, −1 at 132d), `3a88`, `4b34`.
- **Mapping to `src/engine/int.js`:** `e8a8` → `lmul`, `e80c` → `ldiv` (truncates toward zero), `e8dc` → `lmod` (sign of the dividend), `e9c0` → `uldiv`, `ea22` → `ulmod`. All of them throw `DivideError` on /0, as the hardware raises INT 0. `e97e`/`e9a0` are compound-assignment wrappers. `fe1e` = `lshr`. Helpers that are missing and needed: `itoa` (radix rule above), `ultoa` and `atol` (32-bit wrap); none of these is in `int.js`.
- **Register arguments and fragments:**
  - `1ff8:4636` takes DX:AX.
  - `17ff` returns AX and uses SI/BX/CX.
  - `08e3`, `0962`, `09da`, `0a27`, `1378`, `138b`, `13a1`, `13b4`, `190a` are tails reached by fall-through; they use the caller's BP frame.
  - Translate the codec at the level of the stream API, or as whole routines, not per Ghidra function.
- **Huge pointers.** Destination advances add 0x1000 to the segment on offset carry. `32e3:01f1` relocates with a 32-bit add on `seg:off` without normalising.
- **`malloc(0xffff)` after free.** `c280` and several loaders call it, discarding the result. It always fails (inferred: no near-heap block can reach 0xffff bytes), but the search can coalesce free blocks or grow the heap. Keep it if heap addresses must match.
- **Uninitialised flag in `loadBitmap`.** When no bitmap slot is free, `[BP-2]` is read before it is written.
- **The `loadPalette` failure path clears the current-palette byte.**
- **The `loadTtm` full-table path returns 0 and leaks.** `loadMusic` leaks its DOS block on a size mismatch.
- **`.TRK` writes have no bound.**
- **The font loader's 8-bit size arithmetic** and its 80-byte loop.
- **Directory state.** `main` scans backward from `strrchr(argv[0],'.')` for '\' with no lower bound. The picker changes the cwd and drive; only the cwd is restored at exit.
- **Floppy wait.** `1000:045a` → `c00e` polls BIOS `0:043F` after loads. Report the motor bits as 0 so it returns at once.

## Open questions

- **Resolved:** `ACTIVISIO` (9 characters, `DS:2ab2`) opens `activisi` through DOS 8.3 truncation. `FileSystem.key` in `src/engine/dos.js` implements this.
- **Resolved:** `29f6:2034/2137/216a` plane/mask packing is translated in `src/game/egadrv.js`; bit 7 is the leftmost pixel and the mask is `~(p0|p1|p2|p3)`. See [graphics](graphics.md).
- **Resolved:** `41c4`/`4444` hold logical-color dither pairs; `46a4` is the text color remap (identity). See [graphics](graphics.md).
- **Resolved:** `SND:IBM:` commands are translated in `src/game/sfx.js` and documented in [effect tick](input-timer-sound.md#effect-tick-334e0000-di-based-register-code).
- `1ff8:0edf`, `123f`, `1346`, `49a6`, `49ec`, `3a26` have no direct callers. I searched for them as `0x<off>` immediates in `disasm.asm` and found no hits, apart from unrelated `DS:49ec` data operands in `1ff8:320c-349d`. I also searched the EXE for far pointers `<off> f8 0f` (pre-relocation segment) and found none. Indirect use through computed addresses cannot be ruled out (static, negative).
- **Resolved:** `2524:0a7c` indexes a loaded `DS:05da[]` script into `DS:5790[]` parts at `/` boundaries; both indexer and runner are translated in `src/game/seg2524.js`.
- Whether music plays depends on `2524:01da` finding 128 KiB of free DOS memory. The port's `dos.js` must report enough free conventional memory, or `trax.mus` is dropped and music is switched off (`DS:1fb2=0`).
- The meaning of most `.RCT` fields, the `.tbl` group flag byte and model byte +2: unknown.
- `RESULTS.BMP` (`DS:1145`) and `.BMP` loading through `2c46` or `1000:33be` callers were not traced individually.
