# Race: simulation and 3D rendering

Evidence levels: **static** (read from the Ghidra export, disassembly or EXE bytes), **inferred** (deduced from how the code uses a value), **unknown**. No DOSBox observation was used. Every DS offset is in DGROUP `36fa`. Negative displacements in the decompiler output are DS offsets mod 0x10000 (for example `-0x75ac` is `0x8a54`).

## Overview

`1000:047c` runs one race from start to finish. It calls the setup code first and then loops one iteration per rendered frame until the race ends. **All motion is per frame.** Nothing in the loop's call tree reads the PIT counter (`1000:c523`, `CS:c328`) or the BIOS tick. Timer-driven code was checked as well:

- The ISR callbacks installed through `1000:c4cc` are the music sequencer `1000:c731` (writes DS:2d40–2d5a) and the sound-driver ticks (`cd72`/`cdac`, called through the driver table at DS:30d2).
- The INT 1Ch handler `1ff8:43a9` updates input-device state (DS:4bb8, 4d0d–4d15).
- None of these write race state. Every writer of DS:8926, 96f2, 924e, 9250, a97a and 9b90 is a race or setup function (static). Positions advance by fixed increments per loop iteration, so game speed depends on how fast frames are produced (static). The page flip (`1ff8:2555(0)` → EGA slot 8 `29f6:1d9c`) is called with argument 0, so **it does not wait for vertical retrace** (the 3DAh poll at `29f6:1dca` runs only for a nonzero argument). The race loop therefore has **no frame limiter at all**: it runs as fast as the CPU draws. The only blocking points are the menus it can enter (`68dc`, `23e2`, `75ea`) and the music/sound driver calls. A port must choose a frame rate (`APPROX:`); the original's rate depended on CPU speed. See [Frame loop](#frame-loop-1000047c).

Data flow inside one frame:

1. Player input, written to the player's speed and lateral offset (`6dbc`).
2. Projectiles move (`9542`).
3. Cars move: AI speed and steering, laps, collisions, AI weapon use. Each car's 3D pose is built from the track (`7982` → `7a9c`, `8008`, `7a6a` → `8148`/`81ec`).
4. Relative distances to the player are computed (`8b94`, `7ca4`).
5. Forward view: road spans (`b234`), object transforms (`863c(1)`), sky (`b17e`), ground and road scanline fill (`2f73:02a4`).
6. Projectile timers and homing (`996c`). Objects are drawn back to front, and direct-fire weapons are hit-tested from screen pixels (`a570`). The gun is drawn (`9bcc`).
7. Rear-view mirror: `b6dc`, `863c(0)`, `ba72`, `bc30`.
8. Dashboard and HUD (`02ea`, `2524:4152`, `afc4`, `8c10`, `77c8`, `2524:426c`).
9. End-of-race and pit checks.

### Entity model (static)

The simulation keeps up to 40 entities in parallel word or byte arrays indexed by entity number `e`:

| e | kind |
| --- | --- |
| 0 | player car |
| 1–9 | AI cars. The slot fixes the driver: 1 Sly, 2 Megadeath, 3 Killer Angel, 4 **Lurker**, 5 Preying Menace, 6 Crimson Death, 7 Motormaniac, 8 **Wrecker**, 9 Melissa. Name tables are at DS:17a2 (long names; entry 0 is "COMPUTER DEMO ") and DS:17b6 (short names, matching the `.tbl` file names). |
| 10–19 | projectile slots `j = e-10` |
| 20–39 | roadside objects `k = e-20` |

## Race setup and track (static unless marked)

### Call chain

- `1000:2f88(city)` sets DS:9a84 = 0 (no bounty) and DS:9808 = city. If DS:0d24 ≠ 0 it goes through `2ff4` (bounty/MAFIOZO encounter) first; otherwise straight to `2fb0`.
- `1000:2fb0` calls `32b8`. Afterwards, if DS:924c < 0 (inferred: race quit), it zeroes the player's progress and gives cars 1..9 `a67c[i] = rand()&0xfff`. Then `34b0` (results).
- `1000:3396` (circuit) picks the city from DS:18ba[d24] (d24 = 2..11 → 2,4,6,9,0,1,3,5,7,8) and sets DS:89c8 = (d24 == 2), which shuffles the grid.
- `1000:32b8`:
  1. Zero the frame counter 924e:9250.
  2. `a8d8 = cityName[9808] + ".MAP"` (name table DS:1cb4, suffix DS:1112).
  3. Path `99ec = [8f0c] + "\" + name` (`2524:2be8`).
  4. `1208` loads the skyline.
  5. Replace the extension with `".TRK"` (DS:1117) and call `4fae`.
  6. If `4fae` returns ≠ -1: `047c` (race), `031a`, `1ff8:3c64([a252])`.

### Setup functions

| addr | name | purpose |
| --- | --- | --- |
| `1000:1208` | loadSkylineMap | `.MAP` = LZW stream (method 2) of 24026 bytes: `N=6`, 6 widths in bytes (160), 6 heights (25), then 6 strips of 160×25 bytes of 4bpp packed pixels. The 6 skyline strips are converted for the adapter DS:95d6. For EGA (2) they go into video RAM at `A734:0000`, with strip far pointers DS:9bce[i] stepping by `h*0x28`. Consumer: `2f73:000f` (3D renderer). **The `.map` holds no track data.** |
| `1000:4fae` | loadTrack | `.TRK` parser (format below). Errors call `6d62(3)` (open), `6d62(2)` (bad signature) or `6d62(4)` (short read). Returns 0 or 0xffff. |
| `2c46:004e` | selectShapeTbl | DS:98dc:98de = DS:2a6a:2a6c, making `shape.tbl` the active 3D table. `shape.tbl` was already loaded at start-up by main → `1000:a53c` → `2c46:006e` → `ad0a`, and relocated by `2c46:000a`. No car or driver `.tbl` is opened during the race: those are loaded only by the garage (`1e64`, `MYCARn.tbl`) and profile (`1cee`) screens into DS:2a6e. |
| `2524:18f4` | raceInit | grid, per-car state, track objects, colour records, difficulty (below) |
| `2524:1e30` | shuffleGrid | 50 swaps of `8a7c[rand()%10]`, only when DS:89c8 ≠ 0 |
| `1000:156c` | aiBuyAmmo(i) | i ≠ 0: spends money DS:a22a+4i (dword) round-robin: `9238[i]++` (-300), `5c04[i]++` (-200), `9a86[i]++` (-300), `8e5c[i] += 100` (-200), each step clamped at 0. So AI ammo comes from money. |
| `1000:1692` | cockpitSetup | 0278, 02ea. Loads `"DASH"+itoa([9b0c])+".SCR"` via `1ff8:2fca` (compressed, 320-wide). Then `2524:3cd6` (minimap), `2524:4152`, `afc4`, `2524:43cc`, `914a` (reticle (0xa1,0x41), `8afa`), DS:5c98 = DS:9908 = -1 (force redraw), `406e`, `89d6`, `8a48`, lap total `7f3c([8eb8])` at (0x112,0xac), `2524:4482`, then a full-screen blit. Also called from `1000:2c9c` after menus. |
| `2524:3cd6` | drawMinimap | Per-axis scale: `px = ldiv((x+|minX|)<<6, |minX|+maxX)` and `py = ldiv((y+|minY|)<<5, |minY|+maxY)`, using 32-bit shifts. Bounds are seeded with minX = minY = 0xc80 and maxX = maxY = 0xf380 (signed) before the loop over points. Dots via `1ff8:3d2b(px+0x7f, 0xbe-py, 15)`. Start marker bitmap `[965a]+0x12`, pit marker `+0x22`, city label DS:1ca0[city] at (0x7d,0xbf). The bounds DS:980c/98da/8e96/8a32 are reused by `77c8` for the car dots. |
| `1000:34b0` | raceResults | sorts DS:8eda[10] by `a678` with `qsort(…, cmp 1000:2678)`. Cars with state ≤ 0 get `e9a0(&a678[i],10)` (unknown long op). The order feeds the next grid. |

`weapons.bmp` and `parts.bmp` are loaded only by the shop (`1000:5804`), not by the race. The race bitmaps come from **`bitmaps.blk`** (DS:0184): `2524:012e` opens it and reads five consecutive BMP containers with `1000:ff86` into DS:965a (dash/HUD pieces), DS:9a80 (explosion and spark sprites), DS:9aea (mirror skylines, two per city), DS:9bbe (unknown) and DS:8dc0 (target-box portraits).

### `.TRK` format (static: `4fae`; checked on all 10 files)

| offset | content | destination |
| --- | --- | --- |
| 0 | `"TRK:"`. Only byte 0 = 'T' and byte 3 = ':' are checked. | – |
| 4 | int16 K = object count | DS:5c00 |
| 6 | K × {int16 trackIndex, int16 v} | DS:9dfe+2k, DS:aa46+2k |
| 6+4K | int16 {x, y, z} triples until EOF | DS:5c9e+6i (x), 5ca0 (y), 5ca2 (z) |

- x and y are horizontal; z is elevation (-1..200 in the shipped files).
- Points are spaced about 30 units apart (bay_area 1..60).
- (0,0,0) triples are dropped once at least 2 points are stored. Only bay_area has them (22 trailing).
- After load: DS:9b0a = DS:8986 = N-1. `18f4` sets **len = DS:8988 = N-2**.
- The last two points duplicate the first two (the loop overlaps), so `pt[pos+1]` is always valid for `pos ≤ len`.
- **No bounds check**: the table at 5c9e runs into DS:8926, so at most 1900 points fit. The largest file, orlando, has N = 1892.
- There are **no width, banking, pickup or minimap fields**. Road width is implicit in the renderer (`b234`: `0xdac/dist`).

| city (DS:9808 index) | N | pit DS:1d04 | barrier DS:1d18 |
| --- | --- | --- | --- |
| 0 orlando | 1892 | 957 | 817 |
| 1 bay_area | 1726 | 917 | 976 |
| 2 phoenix | 1488 | 839 | -1 |
| 3 nyc | 1400 | 865 | 1005 |
| 4 st_louis | 1132 | 742 | -1 |
| 5 la | 1766 | 350 | -1 |
| 6 seattle | 1750 | 1138 | 797 |
| 7 houston | 877 | 571 | -1 |
| 8 boston | 1361 | 568 | 666 |
| 9 chicago | 1444 | 502 | -1 |

**Roadside objects** (`18f4`, k < K, e = 20+k):

- `state[e] = 1`, `pos(e) = 9dfe[k]`, shape `aa1e[e] = |v|` (`c148` = abs).
- Offset from the centreline about 240 units, perpendicular to the segment:
  - v > 0: `(8*(y0-y1), 8*(x1-x0))`
  - v ≤ 0: the opposite side
- Pose: DS:8f9e+6k = {x0+ox, y0+oy, z0}. Angles DS:a9a4+6k = {atan2(30, z1-z0), –, atan2(x1-x0, y1-y0) - 0x4000}.
- Every track has a \|v\| = 13 object near index 1..22 (inferred: start gantry).
- The disassembly at `2524:1b84–1bb3` is authoritative; the decompiler muddles the sign branches there.

**City tables** (initialised DGROUP, 10 entries):

| table | contents |
| --- | --- |
| DS:1cb4 | file names |
| DS:1ca0 | display names |
| DS:1cc8 | sky colour: 11,11,11,8,9,3,9,11,7,0 |
| DS:1cdc / 1cf0 | ground/road colour patterns, copied into 100 records of 8 bytes at DS:9252+8n (`9252 = 1cf0[c]`, `9258 = 1cdc[c]`) when DS:896c == 0 |
| DS:1d04 | pit index |
| DS:1d18 | barrier index |

### Initial state (`2524:18f4`)

**Grid**

- If DS:89c8 == 0: `8a7c[8eda[j]] = 9-j`, so last race's winner starts in slot 9. Otherwise `8a7c[i] = i`, then shuffle.
- Grid slot s = 8a7c[i]:
  - `pos = (s/3)*5`
  - `lat = s == 9 ? 0 : (s%3)*32-32`
  - `9ad6 = 5c84 = lat`
  - `a678 = pos`

**Per car**

- Speed, sub, laps and pose zero.
- `state = 1`, fuel DS:96a0 = 0x0a00, DS:9b0e (laser battery) = 100.
- AI `vmax = 1c48[i] + d24`, or `1c48[i]` if DS:89c8.
- AI `1c5c += |d24-2|*8`, or `1c5c = 1c70[i] + d28*25` if DS:89c8.
- AI `9aa6` start damage = money ≤ 500 ? 1c5c/2 : 0.
- `156c(i)` at the end of each iteration.

**Globals**

- DS:a8be = 9 (cars remaining).
- DS:a672 = -1 (end countdown idle).
- DS:924c = 0, DS:a462 = 0, DS:9bca = 0, DS:8a4c = 0, DS:8e70 = 0.
- `9bc8 = 1`, `9a82 = 0`. Demo race (DS:1fa6): weapon 5 and autopilot on.
- `895a = (8a7c[0] > 5)`. Only a player on the back rows (slot > 5) has the accelerator locked until frame 20.
- Bytes 8a5f..8a7c cleared with a downward `REP STOSW` (15 words). That clears state[11..40] **and the low byte of 8a7c[0]**: an off-by-one to preserve. Projectile slot 10 (8a5e) is not cleared.
- `961e = 1fce*3 + {0x21, 0x1e, 0x1c, 0x1a}[d28]`.
- `8f0a = |d24-2|*50 + {0, 200, 500, 1000}[d28]`.
- `8954 = |d24-2|*30 + {0, 200, 500, 1000}[d28]`.
- d28 (difficulty, at most 3): player `1c5c` +30 / ±0 / -15 / -30, and AI money +0 / 1000 / 3000 / 5000.


## Frame loop `1000:047c`

### Preamble (static, `047c`–`04d4`)

- Sets the flags DS:8956, 9252, 5c9a, 9656 and a8ec to 1.
- Laps DS:8eb8 = `atoi(*(char**)0xb4e)` via `thunk fcaa`. Values below 2 become 1, then the result is clamped to at most 99.
- Calls `2c46:004e` (renderer init) and sets DS:59f6 = -1 (forces a pit-sign redraw on the first frame).
- Calls `2524:18f4` (race setup) and `1000:1692`.
- If the music far pointer DS:8f02:8f04 is non-null, starts it with `2524:03f2`.

### Loop body, in order

| # | call | purpose | kind |
| --- | --- | --- | --- |
| – | `59f4 = 8926` | saves the player's speed from the start of the frame (used by the pit check) | compute |
| 1 | `1000:06dc` | sky colour DS:9aec = DS:1cc8[city]. If the damage-flash colour DS:89ca differs from the last value DS:59f8, calls driver slot 25 (`1ff8:3cf1` → `[DS:4988]`, EGA `29f6:0044` = INT 10h AX=1001h, set overscan/border colour; no retrace poll) with it. Otherwise clears DS:89ca, so a flash lasts one frame | draw (palette/border) |
| 2 | `1000:6dbc` | player input: weapon keys, menus, accelerator, brake and steering. Ends by sampling the frame random number DS:9636 = `rand()` | **reads input**; can block (ESC → `68dc`, P → `75ea`) |
| – | `byte 384b = 1` | graphics library flag (draw to the back page; inferred) | |
| 3 | `1000:9542` | projectile motion and hits. AI missile-attack timer DS:1fbc. Warning code DS:9232 | compute (calls damage) |
| 4 | `1000:7982` | per-car update for cars 9..0: speed, position, laps, collisions, AI weapons, AI steering. Then `7a6a` (3D pose of every car). Every 16 frames, `85f0` (race order) and `8a48` (draws the place). If autopilot is off, `84be` (centrifugal drift) | compute + small dash draws |
| 5 | `1000:8b94` | relative distance DS:89cc[e] for the roadside objects e = 20..39 | compute |
| 6 | `1000:b234` | forward camera matrix. Projects the track ahead into the row table DS:9252+8·row (road edges). Horizon DS:8f98, top road row DS:8db2 | compute |
| 7 | `1000:863c(1)` | per-object octagonal distance (the depth key DS:8f48[e]) and crest clip row DS:5c1c[e], front view (default 99) | compute |
| 8 | `1000:b17e` | clip rectangle, sky band and skyline strip | draw |
| – | `8db2 += 1` | | |
| 9 | `2f73:02a4` | ground/verge/road scanline fill: `JMP [CS:2afc + 2·DS:95d6]`, EGA → `2f73:02ae` (see 3D renderer). **Not** the page flip | draw |
| 10 | `1000:996c` | beam charge DS:a8c4. Projectile lifetimes, explosion splash, homing-missile steering | compute |
| 11 | `1000:a570` | sorts entities back to front and draws the visible ones ahead. Pixel-based hit test for the gun, laser and beam. Target lock / aim | draw + reads framebuffer |
| 12 | `1000:9bcc` (only if trigger DS:1f82 ≠ 0) | fires the selected direct weapon: ammo, muzzle and beam polygons, sound | draw |
| 13 | `1000:b6dc` | mirror camera (negates pitch DS:898c, `byte DS:8991 += 0x80`) and the mirror road rows DS:95da/965c via `b8f6` | compute |
| 14 | `1000:863c(0)` | the same for the mirror (default clip row 0x21) | compute |
| 15 | `1000:ba72` | mirror background: skyline, sky, road spans | draw |
| 16 | `1000:bc30` | objects behind the player (rel ∈ [-99, 1]) drawn into the mirror. Then negates DS:898c and clears DS:2a68 | draw |
| 17 | `1000:02ea` | resets the clip rectangle to the full screen (0,0)–(319,199) and colour byte 384f = 15 | state |
| 18 | `2524:4152` | cockpit overlay bitmaps for the car model DS:9b0c, from the bitmap table DS:965a | draw |
| 19 | `1000:afc4` | speed bar (x 0x77.., y 0x7d–0x80, length (\|speed\|>>1)&~1, at most 0x52) and fuel bar (x 0x89.., y 3–6, length (\|fuel\|>>6)&~1, at most 0x40). Redrawn only on change, or every 4th frame | draw |
| 20 | `1000:8c10` (only if DS:a462 ≠ 0) | HUD: reticle, weapon name and ammo, the warnings "MISSILE/TERMINATOR/MINE/CALTROP WARNING !" (DS:9232 = 5/4/6/7, blinking with frame bit 1) | draw |
| 21 | `1000:77c8` (every 4th frame) | radar/minimap dots of every car on the dashboard. Then the copy-protection penalty check | draw |
| 22 | frame counter | 32-bit DS:924e (low) / DS:9250 (high) += 1 | |
| 23 | `2524:426c(0)` at frame 10, `426c(1)` at frame 20 (DS:895a = 0 is set at frame 20) | start-light bitmaps and sound 10. Frame 20 also releases the accelerator lock | draw |
| 24 | `1ff8:2555(0)` (slot 8 `[4944]`), `1ff8:2559(0,0,0x140,100)` (slot 9 `[4948]`) | **page flip**: swaps DS:3852/3854 and writes CRTC 0Ch through the port at BIOS `0040:0063`, with no retrace wait. Then slot 9, a bare `RETF` on EGA (`29f6:13b4`) | draw, not blocking |
| 25 | end tests (below), `2524:4cd4` music restart, pit-window test → `23e2`, `68dc`, `2524:43cc` | | can block |

- `85f0` runs from `7982` (every 16 frames) and once when the race ends. `23e2` and `68dc` run from the pit check.
- `2524:42f0` (countdown lights; colour by frame/4: <13 red 4, <23 12, <29 yellow 14, otherwise green 10, which also sets DS:a462 = 1) runs from `7982`, once per AI car while frame < 0x75.

### Race clock (static)

- DS:924e:9250 counts frames from 0.
- Before frame 0x75 (117), `731a` refuses to spawn projectiles, so nothing can be fired. The test is `9250 != 0 || 924e > 0x74`.
- Frames 1–20: AI cars do not move. `85b4` jitters their height by `(rand()&3)-1`. The player cannot accelerate while DS:895a ≠ 0, and the loop clears it at frame 20.
- After frame 100, AI cars may change lanes (`8008`). AI weapon decisions run every 8th frame (`(924e & 7) == 0`).

### End of race (static)

| condition | effect |
| --- | --- |
| DS:a672 == 0 | Return: restarts music 8f06:8f08 and calls slot 25 with 0. DS:a672 is a countdown. `a14c` sets it to 25 (and the player's speed to 0) when the player is destroyed. While > 0 it is decremented once per frame. A negative value means "not running" (the initial value comes from setup, see Race setup). |
| DS:924c != 0 | Player finished. Slot 25 with 0, music 8f06:8f08, `85f0` (final order), return. Set in `7a9c` when the player's lap count DS:8ec4 reaches DS:8eb8. |
| DS:1fb8 != 0 (copy-protection failure) | Every 4th frame after frame 116, `0344(0x620)` prints messages and exits (`1000:d512(1)`). Never taken in the reference build. |

### Laps (static, `7a9c`)

- After a position update, if `pos[i] > len` (DS:8988), then `pos[i] = max(pos[i]-len, 0)` and `lap[i]` (DS:8ec4+2i) += 1. The compare is signed and strictly greater, so index `len` itself is a valid position.
- For the player, `89d6` redraws the lap number at (0x112, 0xa4). The race ends when `lap[0] == laps` (equality test).
- An AI car reaching `lap == laps` gets target lateral DS:5c84[i] = -300 and target speed DS:9b6c[i] = 50. It steers off the road. When its lateral passes below -0x122, `8008` sets DS:8e9c[i] = 1, and from then on `7982` only updates its relative distance.

### Race order (static)

- `85f0` (every 16 frames and at the end): for each live car, `prog[i] = (s16)(lap[i]*len + pos[i])`, sign-extended into the dword DS:a678+4i. Cars whose state is 0 keep their stale value.
- `8a48` computes place = 1 + the number of cars 1..9 whose `prog` is greater than the player's. The 32-bit compare is unsigned. It prints the place at (0x112, 0xbc).
- `9406` uses the same count for a locked target and prints it at (0x2a, 0x95).

### Pit window (static)

- `in = (1d04[city] < pos[0] < 1d04[city]+60)`, giving DS:1fb4 = in.
- When the player is in the window, the speed was non-zero at frame start (DS:59f4) and is now 0, lateral > 0x37 and the car is alive, the loop calls `23e2` (pit menu: lists items 0xccd/0xcd4/0xcda/0xce2, refuel offered only when fuel DS:96a0 < 0x1000) and then `68dc` (blocking menu loop).
- `68dc`: while DS:1fae is set (it is set by `23e2`), runs 10 × `7a9c(1..9)` per menu iteration, so the AI cars keep advancing while the player is in the pits.
- When DS:1fb4 changes, `2524:43cc` redraws the pit sign at (0x11b, 0xd).

## Car physics (static unless marked)

### State per car (word arrays, index i = 0..9, signed unless noted)

| DS | name | format / range | meaning |
| --- | --- | --- | --- |
| 96f2+2i | `pos` | integer track-point index, 0..len | Position along the track. `len` = DS:8988. Can go negative if speed is negative (no lower wrap). |
| 9b90+2i | `sub` | 0..29 (`IDIV` remainder; negative if speed < 0) | Fraction of a segment in units of 1/30. Interpolation uses `sub>>5` (1/32). |
| 8926+2i | `speed` | units of 1/30 track point per frame | Shared with projectiles at e = 10..19 (DS:893a+2j). |
| 9b6c+2i | `vmax` | same units | Player: accelerator cap. AI: target speed. Player value = DS:1c48 = 1fc8*30+90 (`2524:26d2`). Set to 50 for AI finishers. |
| 1c20+2i | `accel` | initialised data, default {2,2,2,3,3,2,1,1,2,2} | Speed gained per frame. |
| 1c34 | `brake` | player only, default 2 | Speed lost per frame while braking. |
| a97a+2i | `lat` | player clamped to [-0xa0, 0xa0] (drift clamps to [-0xa0, 0x9c]); AI unclamped | Lateral offset from the centreline. \|lat\| > 0x3e is off-road. Also used for projectiles at e = 10..19 (DS:a98e). |
| 5c84+2i | `latTarget` | AI only | Lane the AI steers to (`8008`). |
| 96c8+2i | `vz` | | Vertical velocity while airborne (`81ec`). |
| a93e+6i | car pose `{x, y, z}` | world units. x, y horizontal; z (+4, DS:a942) is height | Built every frame by `81ec`. |
| 898c+6i | car angles `{pitch, ?, yaw}` | 16-bit binary angle (0x10000 = full turn, inferred from `-0x4000` offsets and `+0x8000`-style use) | Player: pitch DS:898c, yaw DS:8990. +2 not written in the code read here (unknown). |
| 8ec4+2i | `lap` | | Laps completed. |
| 9aa6+2i | `damage` | | Accumulated damage. Destroyed when ≥ DS:1c5c+2i (max damage, default {122,100,300,90,88,80,80,108,200,120}). |
| byte 8a54+i | `state` | signed byte | 1 alive (set by `2524:18f4`), 0 gone, negative dying (0xdd = -35 frames or 0xfb = -5 frames, incremented each frame by `7fbe`). |
| byte 8e9c+i | `out` | | 1 = left the road after finishing. Car is then skipped. |
| byte 98e0+i | `air` | | 1 = airborne. Disables player input and AI speed control. |
| 9af4+2i | `ahead` | -1 = none | Nearest car ahead in the same lane (`a210`). |
| 89cc+2e | `rel` | `pos[e]-pos[0]` wrapped to [-len/2, len/2) | Relative distance to the player, for all 40 entities (`7ca4`, `8b94`, `9542`). |

Player-only:

- DS:96a0 fuel, 0..0x1000.
- DS:9ad2: 1 while braking.
- DS:9a82: autopilot flag (byte toggled by 'A').
- DS:8954 and DS:8f0a: AI fire-chance bonuses (set in setup, see Race setup).

### Per-frame update

There is no time scaling: each call advances one tick.

- **Position** (`7a9c`, all cars):
  - `t = speed + sub; pos += t / 30; sub = t % 30`. Both use 8086 `IDIV` with `CWD`, truncating toward zero.
  - Lap wrap as described above.
- **Player throttle** (`6dbc` tail at `1000:7216`):
  - The input byte comes from `1ff8:4486(0)`, which returns `DS:4d23[DS:4bb8]`, a direction bitmask kept by the keyboard ISR.
  - Bit 1 brake: `speed -= 1c34`, floor 0, DS:9ad2 = 1.
  - Otherwise bit 0 accelerate: if DS:895a == 0, `speed += 1c20`, capped at `vmax`.
  - There is no rolling resistance. Speed holds when no pedal is pressed.
  - Skipped when autopilot is on, the car is airborne or the car is dead.
- **Player steering**:
  - Bit 3 right: `lat += speed>>4` (SAR), clamped at 0xa0. Bit 2 left: `lat -= speed>>4`, clamped at -0xa0.
  - If lat ≠ DS:9ad6 (set once by setup) and `a1ac()` reports a car alongside, lat reverts to its old value. "Alongside" means another live car with \|lat difference\| < 30 and \|rel\| < speed>>5.
  - Steering at speed 0 does nothing.
- **Autopilot speed** (`7a9c(0)`, autopilot and frame > 20 and not airborne):
  - `target = min(vmax, DS:98fa)`, written as `(a-b & -(a<b)) + b` with an unsigned `<`.
  - If below target and fuel > 0, `speed += accel`. If above target, `speed = max(speed-2, 0)`.
- **Fuel** (`7a9c(0)`):
  - Every 16th frame, `fuel -= max(speed>>3, 5)`, floor 0.
  - At fuel 0: `speed = max(speed-2, 0)` each frame. When speed reaches 0, shows message 0x36 (`6d76`) and enters `68dc`.
- **Off-road** (`7ecc`, player):
  - `x = |lat| - 0x3e`. If x > 0 and speed > DS:961e (off-road floor), `speed -= (x>>3)+1`, floored at DS:961e.
  - If speed is then > 50 and the player crossed the city's barrier point DS:1d18[city] this frame (prev pos DS:a026 < p ≤ pos, p ≠ -1), applies damage type 11 (`9e90(0,-11)`) and sets `pos = prev`.
- **AI speed** (`7a9c(i)`, not airborne): `speed += accel[i]` if below `vmax[i]`, else `speed = max(speed-2, 0)` if above.
- **Running into the car ahead** (`7a9c`, all cars):
  - `ahead = a210(i)`: the live car with the smallest `pos` that is strictly greater than `pos[i]`, with \|lat diff\| < 30. There is no wrap-around at the start line.
  - Contact when `pos[ahead]-3 ≤ pos[i] + (speed[i]>>5)` and \|z[ahead]-z[i]\| < 30 (DS:a942 heights).
  - On contact, `speed[i] = max(speed[ahead]-5, 0)`. If i is the player, also `9e90(ahead,-8)` (ram damage) and sound 7.
- **Centrifugal drift** (`84be`, player when not on autopilot):
  - `h = be7e(dx,dy)` of the current segment. Only acts when h differs from the last value DS:9bca.
  - `d = (s32)(2c46:311a(9bca-h, speed) * speed) >> 15`, low word. `311a` takes a 32-bit second argument (see 3D renderer).
  - If DS:0d28 ≠ 0, `d += d>>1`.
  - `thr = DS:8dac < 501 ? 0 : 1fd0*2`. If `|d| > thr` (unsigned `JBE` at `1000:8578`), `lat -= d`, clamped to [-0xa0, 0x9c].
- **Height and airborne** (`81ec`):
  - Ground height `g = z0 + ((z1-z0)*sub >> 5)`, plus 0x12 for the player (eye height).
  - If g < current z: `vz -= 1`, `nz = z + vz` (dying cars use `nz = z0`). If g ≤ nz, the car is airborne: z = nz, pitch -= 0x80, air = 1. Otherwise it lands: `vz = (-vz)>>2` (SAR), pitch = `atan2(30, z1-z0)`, z = g.
  - Else: z = g, vz = 0, air = 0. Pitch = slope for AI. The player's pitch is eased toward the slope by `b6a2(hi(DS:a674), hi(DS:898c), 1)*0x100`.
  - DS:a674 = player slope, interpolated between consecutive segments by `sub/30` (`8148`).

**Gears and turbo**: no gear, turbo or RPM state is read or written anywhere in the race loop (static, every callee listed above). Engine, transmission and tyre upgrades act only through setup values: vmax (`2524:26d2`: 1fc8*30+90), accel, DS:961e, DS:1fd0 (drift threshold) and max damage. The mapping from parts to these variables belongs to setup (Race setup).

### Damage side-effects on the player (static, `2524:44d6`…)

- `44d6(n)`: `damage[0] += n`. If damage > maxDamage/2, calls `26d2` (vmax reset from the engine level) and then `44fc(0)`.
- `44fc(i)`: `vmax[i] -= 1fd4*10+30`, floor 20. This one is also applied to AI victims of type 7.
- Part wear counters, all clamped to 1000 except one:
  - `4528`: DS:8eb6 += 100.
  - `4542`: DS:a670 += 120, but **if > 1000 it adds another 1000** instead of clamping. Preserve this.
  - `4556`: DS:8dac += 110. This is the counter the drift threshold uses.
  - `456a`: DS:aa9e += 130, then redraw `26e4`.
- `406e`: damage bar at (0x16,0xd), width `damage*40/1c5c`. Sets the flash colour DS:89ca = 12 (EGA) when the value changes.

## AI cars (static)

Per-car driver parameters (initialised DGROUP words, index = slot):

| DS | use | values for slots 0..9 |
| --- | --- | --- |
| 1be4 | AI missile-attack chance, compared with DS:9636 | 150,600,300,600,**300**,600,900,450,**600**,600 |
| 1bf8 | Terminator rocket chance | 1200,900,750,360,**1500**,1500,600,600,**840**,6000 |
| 1c0c | mine/caltrop chance | 60,1200,60,1200,**4800**,60,60,2400,**3000**,600 |
| 1c20 | accel | 2,2,2,3,**3**,2,1,1,**2**,2 |
| 1c48 | top speed (slot 0 overwritten by `26d2`; inferred for the AI) | 116,83,115,93,105,97,114,107,122,123 |
| 1c5c | max damage | 122,100,300,90,**88**,80,80,108,**200**,120 |

No dedicated code for Lurker (slot 4) or Wrecker (slot 8) was found. The search was limited: a pattern search over `1000:45ea–bfff` for `CMP SI|DI|[BP+4],4|8`, plus reading every per-car function listed here, none of which branches on the slot number (static). Segment 2524 and register-to-register compares were not searched exhaustively. As far as the code read shows, their behaviour comes from the table values above:

- Lurker: the highest mine chance (4800) and accel 3. This agrees with the profile text in seg 33ae ("Favorite Weapon: MX-35 Mines").
- Wrecker: max damage 200 and mine chance 3000. Its profile names the "S&B Auto-Cannon", but AI cars never use direct-fire weapons in the race code (only types 4, 6 and 7 from `7daa`).

The setup may overwrite these tables (Race setup).

**Per-car order** in `7982`, for i = 9 down to 0, with state ≠ 0 and out = 0. It sets DS:a026 = pos[i] (the previous position) first.

1. Player: `7a9c(0)`, then `7ecc`.
2. AI, frames 1..20: `85b4` (height jitter only).
3. AI otherwise: `7a9c(i)`, then `7ca4(i)`.
4. `7cf0(i)`: collision with projectiles and obstacles.
5. AI every 8th frame: `7daa(i)` (weapon decision).
6. `state < 0` → `7fbe(i)` (dying countdown). At 0 it decrements the car count DS:a8be, zeroes speed and sub, and runs `81ec`.
7. `8008(i)` (AI steering; for the player only on autopilot).

Cars with state = 0 only get `7ca4`.

**AI steering and avoidance** (`8008`):

- If `ahead ≥ 0` and `speed[i] ≥ speed[ahead]`, let `gap = pos[ahead]-pos[i]`:
  - gap < 3: `speed = max(speed[ahead]-3, 0)` and `9e90(ahead,-8)`.
  - gap < 20: `speed -= 2`. If the result is not negative, `speed -= 2` again. So the result can be **-1 or -2** when speed was 2 or 3, which makes the car roll backwards. Preserve this.
  - gap < 40: `speed = speed<0 ? 0 : speed-1`.
- After frame 100, if `lat == latTarget`: `latTarget = |lat| ≤ 16 ? (DS:9636 bit0 ? -0x20 : +0x20) : 0`.
- Each frame, lat moves 2 units toward latTarget. Below -0x122 it sets out = 1.

**AI weapon decision** (`7daa`, every 8 frames). r = DS:9636 (unsigned). `rel` is negative when the AI is behind the player.

- `-0x2ee < rel ≤ -0x15`, missiles[i] (DS:9a86+2i) ≠ 0, `r < 1be4[i]+DS:8954`, frame ≥ 117 and no pending missile (DS:1fbc = 0):
  - Arms an AI missile attack (any AI car, not only Lurker): DS:1fbc = (rand()&0x1f)+10, DS:1fbe = i, sound 4.
  - The missile count is **not** decremented.
- `-199 ≤ rel ≤ -0x15`, 1bf8[i] ≠ 0, same lane as the player (\|Δlat\| < 30) and `r < 1bf8[i]+DS:8f0a`: Terminator `731a(pos[i], lat[i], 4, i)`.
- `51 ≤ rel ≤ 199`, mines[i] (DS:5c04+2i) ≠ 0 and `r < 1c0c[i]+DS:8954`:
  - In the same lane: mine (type 6).
  - Otherwise, if `2*1c0c[i] > r`: caltrop (type 7).
- The ammo counts DS:9238[i] and DS:96dc[i] are decremented without being checked, so they can go negative.

### RNG (static)

`rand()` = `1000:a3ca` (callers outside the far thunk `c144`). In the race it is called:

1. Once per frame at the end of player input: DS:9636 = rand() (`1000:730f`). This value drives every AI decision, crosshair jitter (`9bcc`, `a570`) and lane choice in that frame.
2. In `7daa` for the missile timer.
3. In `85b4` (start jitter, once per AI car per frame for frames 1..20).
4. In `71ec`, only when DS:1fa6 ≠ 0. That flag is set at `1000:0248` when the `DEMO` argument (DS:1fa8) is given, so this is the demo race. It gives a 1/128 chance per frame to auto-launch a missile.
5. In setup: `2524:1e30` shuffles the grid order DS:8a7c[10] with 50 swaps of `rand()%10` (via `c144`), and the bounty draw is `2ff4`.

The call order must be kept exactly for replay fidelity.

## Weapons, damage, collisions (static)

### Player weapons

Selected weapon is the byte DS:9bc8: keys 1–7, or 'W' and the right mouse button to cycle. Firing uses Space (key held: `1ff8:44a0(0x39)`), the left mouse button or the letter keys. The trigger/cool-down counter is DS:1f82.

| # | name (HUD string) | ammo | fire | effect |
| --- | --- | --- | --- | --- |
| 1 | gun ("AMMO:") | DS:8e5c | 1f82=1 | hit-scan through the reticle with ±8 px jitter. Damage `1fd8*4+3` |
| 2 | LASER | DS:9b0e (battery) | 1f82+=2 | hit-scan through the reticle. Two beam polygons (`1ff8:256d`). Damage `1fd6*5+7` |
| 3 | BEAM | charge DS:a8c4, must equal 10 | 1f82+=3 | hit-scan. Damage `1fde*12+20` |
| 4 | TERMINATORS | DS:9238 | `731a(..,4,0)`, 1f82+=4 | forward rocket |
| 5 | missile ("LOCKED/LAUNCHED") | DS:9a86, needs a lock DS:9b8c | type 5, 1f82+=4 | homing |
| 6 | mines ('M') | DS:5c04 | type 6 | dropped behind |
| 7 | caltrops ('C') | DS:96dc | type 7 | dropped behind |

**Beam charge** (`996c`, while weapon 3 is selected):

```
old = a8c4; a8c4++
if old > 10: a8c4 = 10
else:        a8c4 = old + 1   // second increment is overwritten
```

The value goes 0 … 10, 11, 10, 11 …. It is "ready" only on frames where it equals 10. Preserve this.

**Direct-fire hit test** (`a570`, `7610`, `767c`, `76e2`, `775e`). It **reads the framebuffer**.

1. If the previous frame's `9bcc` set DS:8a4c, `a570` picks an aim point DS:8e8c/8e92:
   - Reticle DS:898a/8a1c (default 0xa1, 0x41).
   - Weapon 1 adds `(r&15)-8` and `((r>>8)&15)-8`.
2. It saves the pixel(s) there with `1ff8:3cf9`:
   - EGA: one pixel.
   - When DS:896c ≠ 0: four pixels (centre, +x, -x, +y).
3. It plants marker colours (5, or 0/1/2/3).
4. After each object is drawn back to front, `76e2` re-reads the pixel. If the marker is gone, that object becomes the candidate and the marker is re-planted. The last object to cover the point (the nearest) wins.
5. The original pixels are restored (`775e`).
6. If the winner is a car: `9e90(car, -weapon)`.
7. If the winner is a projectile: timer = 5 and type = 1 (shot down).
8. DS:2a64/5aa0/5aa2 queue a spark bitmap for the next frame.

The test therefore depends on the exact pixels drawn. The shot flag is one frame late, because `a570` runs before `9bcc`.

**Target selection**:

- `9370(range)`: nearest AI car with 0 < rel < range in the player's lane. Range is 60 for the gun, 1000 for Terminators, 30 otherwise.
- Missile lock (`925e`, `915e`, `9214`): the reticle snaps to the locked car's screen position DS:998a/99d6[e] while it is inside x 0x46..0xfa, y 0x2c..0x58 and above the clip line DS:5c1c[e].
- Enter (DS:8a94) cycles the lock.
- Unlocked, the reticle drifts back to (0xa1,0x41) by 1 px per frame.

### Projectiles

Spawned by `731a(pos, lat, type, owner)`, which returns e or 0. A projectile uses the first free slot j (type byte DS:8a5e+j = 0). Fields:

- type DS:8a5e+j
- lat DS:a98e+2j
- pos DS:8970+2j
- timer DS:8dc4+2j
- owner DS:95c2+2j
- shape DS:aa32+2j (DS:aa1e+2e)
- speed DS:893a+2j
- target DS:aa82+2j
- pose DS:9a42+6j `{x,y,z}`
- angles DS:8e20+6j

| type | spawn pos | timer | shape | speed | notes |
| --- | --- | --- | --- | --- | --- |
| 4 Terminator | pos+1 | 1000 if \|lat\| < 60, else 10 | 1 | **player's** speed DS:8926 + 30, sub = **player's** DS:9b90 (even when an AI fires) | `ammo[owner]--` (DS:9238). Sound 5 if owner ≠ 0 |
| 5 missile | pos | 1000 | 2 | 0x100 | lat = -1, target = DS:9b8c, DS:5c6c = 10 ("LAUNCHED" frames), `missiles[owner]--` |
| 6 mine | pos-1 (0 → len-1) | 200 | 0 | 0 | `mines[owner]--`. Sound 6 if owner ≠ 0 |
| 7 caltrop | pos-1 | 500 | 12 | 0 | `caltrops[owner]--` |
| 10 AI-missile blast | pos-1 | set to 4 by the caller | 0 | 0 | no ammo |
| 1 | – | – | – | – | a shot-down projectile (set by `a570`) |

The 3D pose comes from the track points of `pos` and `pos+1`, the same as for cars (`7390`). The spawn uses `sub` = 0 for the pose, except Terminators, which interpolate with their sub in `9542`.

**Motion** (`9542`, type 4 only):

1. `speed += 3` while below 300. Position updates as for cars, with wrap.
2. A car c with state ≠ 0, \|lat diff\| < 30, `prev ≤ pos[c] ≤ newpos` and `ztab[pos[c]] ≤ zproj+15` (zproj = DS:9a46+6j) is hit: `9e90(c,e)`.
3. **Quirk**: `ztab` is DS:a942 (car z) indexed by `6*pos[c]`, the track position, rather than by the car index. That reads the car pose table far outside its 60 bytes. `7cf0` has the same bug. Preserve both. Once pos ≥ 1545, `a942+6·pos` passes the end of DGROUP BSS (DS:cd5f; the largest track reaches DS:d2c6). On orlando, bay_area, la and seattle the read then lands in memory after the program (DOS/heap, possibly the `shape.tbl` block), so those hits depend on the memory layout.

**Homing** (`996c`, type 5):

- `d1 = dist(player, m)`, `d2 = dist(target, m)`. `dist` = `af74`: `max + (3*min >> 3)` of \|dx\|, \|dy\|, unsigned.
- If d2 < 0x41: hit `9e90(target, e)`, and every other missile on the same target is cleared.
- Otherwise:
  - `z = d1 < d2 ? (d1>>2) + z(player) : (d2>>2) + z(target)`.
  - `mx += ((s32)(tx-mx)*256) / d2`, likewise my. The divide is the 32-bit `1000:e80c`.
  - Angles via `2c46:3220`.
- **Quirk** (`9542` at `1000:9778`): a type-5 missile's `rel` is copied from `rel[[BP-4]]`. That stack word is only written by an earlier type-4 slot in the same call; otherwise it holds whatever the previous call at the same depth left. In practice that is `6dbc`'s saved lateral `[BP-4]` (inferred). An exact port needs that stack word emulated, or an `APPROX:`.

**Expiry** (`996c`): when the timer reaches 0 the slot is freed. A splash loop then runs over cars i:

- It tests `state[j]` (the **car** whose index equals the slot number) for 4 or 6, instead of the projectile type, which has already been cleared.
- Car states are only 1, 0 or negative, so the splash never fires (inferred). Keep it as written.

**Warnings** (`9542`): DS:9232 =

- 7: caltrop 0 < rel < 200
- 6: mine 0 < rel < 200
- 4: Terminator -200 < rel < 0
- 5: AI missile attack pending ("MISSILE WARNING !")

**AI missile attack** (`9542` tail). The name is not tied to the Lurker driver: any AI car can arm it (`7daa`):

- While DS:1fbc > 0 it is decremented each frame and DS:9232 = 5.
- Not braking (DS:9ad2 = 0): when it reaches 0, `9e90(0,-5)`, which does 70 damage.
- Braking: an offset is chosen — 10 if the timer just hit 0, 5 if speed = 0, 20 if speed < 50, otherwise none.
- With an offset: the timer is cleared and a type-10 blast is spawned at pos[0]+offset, with timer 4.
- Braking at the right moment therefore dodges it.

### Collision of cars with ground objects (`7cf0`)

- For car i, scan slots e = 10..19 with type ∉ {0, 5}: same lane, `prev(DS:a026) ≤ pos[e] ≤ pos[i]`, and the buggy height test.
- The first match calls `9e90(i,e)`, provided state[i] > 0.
- This covers mines, caltrops, Terminators that are overtaken, shot-down debris (type 1) and blasts.

### Damage `9e90(victim, src)`

`src > 0` is a projectile entity. `src < 0` is a direct cause: -1/-2/-3 for the player's gun, laser and beam, -5 for the AI missile attack, -8 for ramming, -11 for the barrier. The type is `t = src<0 ? -src : (char)state[src]`.

- Returns at once if `lap[victim] ≥ laps`.
- **Player victim** (`9fe0`, a tail of `9e90` that uses its frame; not a real function):

  | t | effect |
  | --- | --- |
  | 4 | +100, `4528`, `4556` |
  | 5 | +70 |
  | 6 | +60, `4542`, `456a`, `4528`, `44fc(0)` |
  | 7 | `44fc(0)` only |
  | 11 | +maxDamage (DS:1c5c), `44fc(0)`, `4542`, `4556`, then the type-6 path as well |
  | 1, 2, 3, 8, 9, 10 | no damage |

- **AI victim**:
  - t = 7: `44fc(victim)` and `4528`, then the death check.
  - Otherwise: if `src > 0` and its owner ≠ 0, +1000 (an AI weapon destroys any AI car).
  - Then by type:

    | t | damage |
    | --- | --- |
    | 1 | `1fd8*4+3` |
    | 2 | `1fd6*5+7` |
    | 3 | `1fde*12+20` |
    | 4 | {45, 92, 180}[DS:1fe2]; other values leave the local **uninitialised** |
    | 5 | `1fdc*80+60` |
    | 6 | `1fda*13+20` |
    | 8 | `1fe0+1` |
    | 9 | `1fe4+1` |

    These are the **player's** upgrade levels, whoever fired.
- **Death check** (`1000:a010`), when `damage ≥ max`:
  1. damage = max.
  2. If state > 0:
     - Kill credit: `kills[owner(src)]++` (DS:5c6e+2·owner). For src = -5 it goes to DS:1fbe. For other negatives it goes to kills[0], but only if the victim's state == 1.
     - Bounty: if victim == DS:9a84 and the killer is the player, DS:901a = 1.
     - state = types 1/3 ? 0xdd : 0xfb.
  3. If the victim is the player: `a14c` (speed 0, sound, DS:a672 = 25).
  4. In all cases, a player victim redraws the damage bar (`406e`).
  5. If `src > 0`, the projectile slot is freed.
- **Jump table**: `9e90` dispatches through `CS:9fcc` (9 entries for t = 1..9). Translate it as a switch.
- **Dead code**: `7fbe` tests `(state<1 ? -1 : 0) == -5`, which is never true, so sound 0 is never played.

### Pickups

None found. No code read in the frame loop's call tree adds ammo, fuel or money (static, not an exhaustive search). Refuelling and repairs happen in the pit menu (`23e2`/`68dc`, not analysed in depth here). Roadside objects 20–39 are scenery only: they are drawn (`a570`, `bc30`) but never collide.

## 3D renderer (static unless marked)

Segments `2c46` (3D maths and polygons) and `2f73` (sky and ground fills), plus the seg-1000 callers. On EGA nothing in this scope blocks.

### Screen layout

| view | rows | columns | centre (DS:9b8e, DS:9bb8) |
| --- | --- | --- | --- |
| front 3D | 0x20..0x63 | 0..319 | (0xa1, 0x41) |
| mirror | 0x0b..0x21 | 0x78..0xc7 | (0xa0, 0x18). x is mirrored while DS:2a68 = 1 |
| dashboard / HUD | rows ≥ 100, plus overlays | | `dash<n>.scr` loaded by `1692` |

### Camera and projection

- **Camera = car 0.** Position DS:a93e/a940/a942 (eye height +0x12 is included in z by `81ec`). Angles DS:898c (pitch a0), 898e (a1, roll; never written in the race, unknown), 8990 (heading a2 = `atan2_16(x1-x0, y1-y0) - 0x4000` of the current segment, from `8148`; lateral offset is ignored).
- **Angles** are 16-bit binary (0x4000 = 90°).
- **Matrix**: `2c46:06a0 mat_from_angles` builds a 19-byte matrix: 9 s16 values in Q14, row-major, plus a type byte at +0x12 (0 identity, 1 yaw only, 2 a0 = 0, 3 general). The general formula is under Translation notes.
- **Camera matrix**: `9622 = transpose(mat(898c))` (`b234`: `06a0`, `0a63`). The view translation is `-campos·9622` (`0fa5`).
- **View axes**: x right, y depth, z up.
- **Projection**: `sx = cx + (x << [9640]) / y`, `sy = cy - (z << [9640]) / y`, with DS:9640 = 7 (focal length 128). Near plane DS:8ec0 = 1.
  - `1000:aa2a` uses the software divide `e80c` (truncates, never traps except on /0).
  - The `2c46` polygon path uses hardware `IDIV` and traps when \|result\| > 32767.
- **Trig tables** live in code segment 2c46 (signed words; file offset `0x15d0 + 0x1c460 + off`):

  | offset | words | content |
  | --- | --- | --- |
  | 2c46:1514 | 0x801 | `cos_tab[i] ≈ 16384·cos(i·π/2048)`, 0..180° |
  | 2c46:2516 | 0x201 | asin, 12-bit angle units |
  | 2c46:2918 | 0x201 | acos, 12-bit angle units |
  | 2c46:2d1a | 0x200 | `atan_tab[i] ≈ atan(i/512)`, 12-bit angle units |

  - `cos16(a)`: `idx = u16(a)>>4; if (idx & 0x800) idx = 0x1000-idx; cos_tab[idx]`. `sin16(a) = cos16(a+0xc000)` (`311a`).
  - Ghidra functions from 2c46:1515 to 2c46:2447 (including the 1350-instruction "244b") are table bytes, not code. The call-graph edges into them are bogus.
- **atan2_16(a,b)** `2c46:3220`:
  - Uses \|a\|, \|b\| (NEG, so 0x8000 counts as 32768).
  - a > b → `atan_tab[(b<<9)/a]`; a < b → `0x400 - atan_tab[(a<<9)/b]`; a = b → 0x200; a = 0 → 0x400; both 0 → 0.
  - Fold: a < 0 → `0x800-v`; b < 0 → `0x1000-v`. Return `v<<4`.
  - `1000:be7e` is a C variant (signed compares, `ldiv`, returns `(ang12-0x400)*16`) and differs at the 0x8000 edge.

### Road and ground

1. **Horizon** (`b234`): DS:8f98 = DS:5c18 = `(tan16(pitch)>>7) + 0x41`, at least 0x20. `tan16` (`2c46:3163`) is an `IDIV` that traps when \|tan\| ≥ 2.
2. **Track walk** (`b234`): from DS:96f2 forward, 40 iterations (DS:a666). The point cursor DS:8e8e advances by +0 for the first 6 iterations (the same point repeats, faithfully), then +1, +2 (30..21), +4 (20..11), +8 (10..1), wrapping by `len`.
3. **Each point**:
   - Rotate and translate. Skip unless depth > 1.
   - `sx = ldiv(x<<7, depth + (x<0)) + 0xa1`. The +1 for negative x is a quirk.
   - `sy = 0x41 - ldiv(z<<7, depth)`.
   - Half-width `w = 0xdac DIV ((octdist(pt, DS:9b86)>>2)+1)` (unsigned). The octagonal distance `af74` is `max + (3·min>>3)`.
4. **Raster** (`b522`): fills row r of the row table DS:9252+8r (rows 0x21..0x63) with a 16.16 DDA (`aeba`). It keeps the min left edge (+4) and max right edge (+2). Crest rows are recorded in DS:921e/a8ac with count DS:aa96. It stops when the distance shrinks. The top row is DS:8db2.
   - Row layout: +0 road colour, +2 right x, +4 left x, +6 left-verge colour, +7 right-verge colour. The colours come from DS:1cf0/1cdc[city], set by setup.
5. **Fill** (`2f73:02ae`, EGA write mode 2): rows `8db2-1`..98.
   - Full bytes left of the road get the left-verge colour; bytes from `right>>3` to the end get the right-verge colour; the span [left, right] gets the road colour via `2f73:0469`.
   - Exits at once if `8db2-1 ≥ 0x63`.
   - A row with left > right paints entirely in the right-verge colour.
6. **Sky** (`b17e`):
   - Clip rectangle top 0x20, bottom `min(8db2, 99)`, then 99.
   - Unless detail DS:1fa4 ≥ 5: `2f73:000f` blits the city panorama (6 panels × 320 px loaded from `.MAP`, EGA VRAM latch copy) scrolled by heading. With `t = 0xff - byte[8991]`, `X = ((t - (t SAR 4)) << 3) mod 0x780`.
   - Then `1ff8:3810` fills the sky band with DS:9aec.
7. **Mirror** (`b6dc`, `b8f6`, `ba72`): track indices `pos+3` stepping -3 then -6. `sx = 0xa0 - …` (no +1 quirk). Rows go to DS:95da/965c, top row DS:9706, horizon DS:980a/9ad0. `ba72` paints the skyline bitmaps (DS:9aea table per city), sky, ground (colour DS:1cdc[city]&15) and road lines (`2454`).

### Objects and shapes

- **Draw order**:
  - `a570` resets DS:8eda[1..39] = 1..39 and runs the presorted check `a410`; only if it finds a disorder does it call `a470` (Hoare quicksort, descending by DS:8f48).
  - It draws entities with `0 ≤ rel < DS:8e70` (the lookahead reached by `b234`), clipped at the bottom by DS:5c1c[e] (hill crests).
  - `bc30` draws `-99 ≤ rel ≤ 1` into the mirror.
- **Shape choice**:

  | entity | shape |
  | --- | --- |
  | car | `aa1e[e]` + LOD `min(rel>>3, 4)`. Near cars (LOD < 2) get +5 if damaged at detail 0, or +detail otherwise |
  | dying car | `0x1c - state` |
  | wreck | 0x21 (only at detail < 4) |
  | projectile | its shape |
  | roadside object | its type (shown only at detail < 2; types < 12 beyond rel 50 draw as 3) |

  Explosion and spark sprites come from the bitmap table DS:9a80, indexed via DS:1f83/1f84/1f88/1f98.
- **`aae4 draw_object(shape, pos*, ang*)`**:
  1. `rel = pos - cam` (16-bit wraps).
  2. Rotate by 9622.
  3. Bounding-sphere cull: draw iff `near ≤ r + v.y`.
  4. Projected radius `pr = (v.y-r > 0x7f) ? ldiv(r<<7, v.y-r) : r`; skip if 0.
  5. Corner frustum test via `aa2a`.
  6. Object matrix `06a0(ang)`, combined by `mat_mul 0a8a` (quirk below).
  7. `2c46:11ea draw_shape`.
  8. Writes the projected centre to **DS:8dc2/8e88**, which `a570` uses for sprites, the target screen position (DS:998a/99d6[e]) and the hit test. The renderer feeds gameplay, so it cannot be skipped.
- **`11ea`**:
  - LOD select by DS:98fc (shipped shapes have one LOD).
  - Clears the vertex cache DS:9708[n].
  - Selection-sorts at most 32 groups descending by the 32-bit `face_dot(N_group, P_ref)` (signed high word, unsigned low; ties keep order).
  - For each polygon: backface test (visible iff the high word of `face_dot(poly[0], poly[3]) < 0`), cached transform (`1317`, `13ad` share one cache), near clip (`0468`/`01a4`, Sutherland-Hodgman), project, fill through `1ff8:256d(n, xs, ys)`, which ends at the EGA span filler (slot 27 `[4990]`).
  - Colour A → byte 384e, B → byte 384d, through the identity map at DS:2a44.
  - If 384e ≠ 384d, the outline is drawn after the fill.

**Shape table format** (`shape.tbl`, 124 shapes; the car `.tbl` files have one each and are not used in the race):

- **File**: dword list `(off, para)` ended by 0:0. Each is relocated by `2c46:000a` to a far pointer.
- **Shape**:
  - +0 s16 radius
  - +2 u8 (unread)
  - +3 u8 vertex count n
  - +4 u16 vertex array offset: n × {s16 x, y, z}. Normals are stored as extra vertices.
  - +6 LOD list {s16 minRadius, u16 subOff} ended by 0xffff
- **Sub-shape**:
  - +0 u8 flags (bit 7 = empty)
  - +1 u8 reference vertex
  - +2 u16 group offsets ended by 0xffff
- **Group**:
  - +0 u8 (unread: 0x00/0x80/0xc0)
  - +1 u8 normal vertex
  - +2 u16 polygon offsets ended by 0xffff
- **Polygon**:
  - +0 u8 normal vertex (0xff = no backface test)
  - +1 colour A (0xff with +0 ≠ 0xff = skip)
  - +2 colour B
  - +3… vertex indices ended by 0xff

### Dashboard and HUD

| function | what it draws |
| --- | --- |
| `1692` | `DASH<n>.SCR` (n = DS:9b0c, the car model) |
| `2524:4152` | cockpit overlay bitmaps from DS:965a by car model |
| `afc4` | speed and fuel bars |
| `406e` | damage bar |
| `89d6` / `8a48` / `7f3c` | lap, place and lap total |
| `2524:3cd6` / `77c8` | minimap track and car dots (car dots every 4th frame) |
| `9406` / `8afa` | target box |
| `8c10` | HUD overlay (toggle H) |
| `2524:426c` | start lights |
| `2524:42f0` | countdown bar |
| `2524:43cc` | pit sign |

- Most of these draw to the hidden page (DS:3852) and then copy their rectangle to the displayed page with slot 4 (`1ff8:2545`, source DS:3856 → destination DS:3858, set by `026a`/`0278`/`0286`). They are only redrawn when the value changes.
- The graphics state block:
  - DS:3843/3845/3847/3849: clip x0, x1, y0, y1
  - byte DS:384b: clip enable
  - byte DS:384c: outline only (inferred)
  - bytes DS:384d/384e: colours
  - bytes DS:3840..3842: text colour, background, font flags

## Function catalogue

"Blocking" means the function waits on time, input or retrace, directly or through a callee. Kind: C = pure computation, D = draws, I = reads input, F = reads the framebuffer.

| addr | proposed name | purpose | blocking? | notes |
| --- | --- | --- | --- | --- |
| 1000:047c | raceMain | race loop | yes (menus) | |
| 1000:32b8 | loadCityAndRace | `.MAP` + `.TRK` load, then 047c | yes | |
| 1000:1208 | loadSkylineMap | `.MAP` panorama to VRAM | no | file |
| 1000:4fae | loadTrack | `.TRK` parser | no | file; no bounds check |
| 2524:18f4 | raceInit | grid, cars, objects, difficulty | no | C; uses rand via 1e30 |
| 2524:1e30 | shuffleGrid | 50 random swaps | no | C |
| 1000:156c | aiBuyAmmo | AI money → ammo | no | C |
| 1000:1692 | cockpitSetup | dash screen and gauges | no | D, file |
| 2c46:004e | selectShapeTbl | activate `shape.tbl` | no | C |
| 1000:06dc | skyAndFlash | sky colour, damage flash | no | D (slot 25) |
| 1000:6dbc | playerInput | keys, mouse, weapons, throttle, steering, frame rand | yes (ESC/P menus) | I; jump tables at CS:716a and CS:705a; `71ec`/`7216` are tails, not functions |
| 1000:731a | spawnProjectile(pos,lat,type,owner) | allocate projectile slot | no | C; returns entity or 0 |
| 1000:9542 | updateProjectiles | Terminator flight, hits, warnings, AI missile attack | no | C; stale `[BP-4]` quirk |
| 1000:7982 | updateCars | per-car loop | no | C + D (`8a48`, `42f0`) |
| 1000:7a9c | advanceCar(i) | speed, fuel, ahead-contact, position, laps | yes (player out of fuel → `68dc`) | C |
| 1000:7ca4 | relPos(i) | wrapped distance to the player | no | C |
| 1000:7cf0 | groundHit(i) | car vs projectile/obstacle | no | C; height-index bug |
| 1000:7daa | aiWeapons(i) | AI fire decisions | no | C |
| 1000:7ecc | offRoad | off-road drag, barrier | no | C |
| 1000:7fbe | dyingTick(i) | death countdown | no | C |
| 1000:8008 | aiSteer(i) | avoidance, lane change | no | C; negative-speed quirk |
| 1000:85b4 | startJitter(i) | rand height jitter | no | C |
| 1000:85f0 | raceProgress | dword progress for ranking | no | C; 16-bit overflow |
| 1000:8a48 | drawPlace | place number | no | D |
| 1000:89d6 | drawLap | lap number | no | D |
| 1000:7a6a | placeCars | `8148` + `81ec` for cars | no | C |
| 1000:8148 | playerHeading | heading and slope | no | C |
| 1000:81ec | carPose(i) | world pose, airborne | no | C |
| 1000:84be | cornerDrift | centrifugal lateral push | no | C |
| 1000:8b94 | relObjects | rel for e = 20..39 | no | C |
| 1000:a166/a210 | carAhead(i) | nearest car ahead in lane | no | C; no wrap |
| 1000:a1ac | sideBlocked | side collision for player steering | no | C |
| 1000:a2ac | sameLane(a,b) | \|a-b\| < 30 | no | C |
| 1000:a294 | gap(a,b) | `pos[b]-pos[a]` | no | C |
| 1000:9e90 | damage(victim,src) | damage, death, kill credit | no | C (+ dash redraw); jump table CS:9fcc; `9fe0`/`a010` are tails |
| 1000:a14c | playerDestroyed | speed 0, sound, end countdown 25 | no | |
| 2524:44d6/44fc/4528/4542/4556/456a/26d2 | player damage effects | see Physics | no | C |
| 2524:406e | drawDamageBar | | no | D |
| 1000:996c | updateTimers | beam charge, lifetimes, homing | no | C |
| 1000:a570 | drawObjectsFront | sort, draw, sprites, pixel hit test | no | D + F |
| 1000:a410/a470 | sortCheck / qsortDesc | draw order | no | C; a410 reads out of range |
| 1000:7610/767c/76e2/775e | hit-test pixel save/mark/check/restore | | no | F/D |
| 1000:9370/9406/915e/9214/925e/8afa/914a | target selection and target box | | no | C + D |
| 1000:9bcc | fireDirect | gun/laser/beam effect and ammo | no | D |
| 1000:b234 | roadFront | camera, road rows | no | C |
| 1000:b522/aeba | roadRaster / ddaSetup | | no | C |
| 1000:863c | objDistClip(front) | depth keys, crest rows | no | C |
| 1000:b17e | skyFront | | no | D |
| 2f73:000f | skyPanorama | adapter dispatch (EGA 0022) | no | D, EGA ports |
| 2f73:02a4/02ae/0469 | groundFill / EGA / span | | no | D, EGA ports |
| 1000:b6dc/b8f6 | roadMirror | | no | C; mutates pitch and heading |
| 1000:ba72 | mirrorBackground | | no | D |
| 1000:bc30 | drawObjectsMirror | | no | D |
| 1000:aae4 | drawObject | cull, matrix, draw | no | D; writes 8dc2/8e88 |
| 1000:aa2a | projectPoint | | no | C |
| 1000:af74 | octDist | | no | C |
| 1000:be7e | atan2C | | no | C |
| 2c46:06a0/0a63/0a8a/0fa5/10d2 | matrix and vector maths | | no | C; Q14; 0a8a quirk |
| 2c46:11ea/0534/026c/0468/01a4/03d8/0114/1317/13ad/14b3/1504 | shape draw pipeline | | no | D (via 1ff8:256d) |
| 2c46:311a/3140/3163/31b6/31eb/3220/32c6 | sin/cos/tan/asin/acos/atan2/atan_tab | | no | C; tan traps |
| 1000:02ea | clipReset | | no | |
| 2524:4152 | cockpitOverlay | | no | D |
| 1000:afc4 | gauges | | no | D |
| 1000:8c10 | hudOverlay | | no | D |
| 1000:77c8 | radarDots | | no | D; uses `c148` and the `e80c` divide |
| 2524:426c/42f0/43cc | startLights / countdown / pitSign | | no | D |
| 1000:23e2 | pitMenu | | yes | not analysed |
| 1000:68dc | menuLoop | | yes | runs AI while DS:1fae |
| 1000:75ea | pause | | yes | |
| 1000:0344 | protectionExit | | – | exits |
| 1ff8:4457 | keyGet | BIOS keyboard buffer at 0040:001a/1c/80/82 | no (polls) | I |
| 1ff8:44a0 | keyDown(scan) | `DS:4cb4[scan] & 1` | no | I |
| 1ff8:4486 | dirBits | `DS:4d23[DS:4bb8]` | no | I |
| 1ff8:4068 | mouseButton | INT 33h | no | I |

## Data (summary)

The per-entity arrays are listed under Car physics, Projectiles and Setup; the renderer globals under 3D renderer. Additional globals:

- **Race globals**

  | DS | meaning |
  | --- | --- |
  | 924e/9250 | u32 frame counter |
  | a672 | end countdown (s16; -1 idle) |
  | 924c | player finished |
  | 8eb8 | laps |
  | 8988 | len = N-2 |
  | 8986 | N-1 |
  | 9808 | city |
  | 1fb4 | in pit window |
  | 59f4 | speed at frame start |
  | 59f6 | last pit-sign state |
  | 9636 | frame rand (u16) |
  | a026 | previous pos scratch |
  | 9232 | warning code |
  | 1fbc/1fbe | AI missile-attack timer / shooter |
  | 9bc8 | selected weapon (byte) |
  | 1f82 | trigger/cool-down |
  | 1fe6 | right-button repeat |
  | 8a4c | shot pending |
  | 898a/8a1c | reticle x/y |
  | 9b8c | locked target |
  | 8a94 | lock-cycle request |
  | 5c6c | "LAUNCHED" timer |
  | a8c4 | beam charge |
  | 2a64, 5aa0/5aa2 | spark queue |
  | 9a84 | bounty target |
  | 901a | bounty earned |
  | 5c6e+2i | kills |
  | a8be | cars remaining |
  | a462 | HUD on |
  | 9a82 | autopilot |
  | 1fa4 | detail level 0..5 (+/-) |
  | 1fa6 | demo race |
  | 89ca/59f8 | flash colour |
  | 1fb8 | copy-protection failure |
  | 0d24 | circuit stage |
  | 0d28 | difficulty |

- **Player upgrade levels**, read in the race: DS:1fc8 (engine → vmax), 1fce (off-road floor), 1fd0 (drift threshold), 1fd4 (speed loss on damage), 1fd6 laser, 1fd8 gun, 1fda mine, 1fdc missile, 1fde beam, 1fe0 ram, 1fe2 Terminator, 1fe4 caltrop. Inferred from use; which purchased part sets each one is not traced here.

## Environment touch points

- **Files**: `bitmaps.blk` (`2524:012e`, before the race), `<dir>\<CITY>.MAP` (`1208`), `<dir>\<CITY>.TRK` (`4fae`), `<dir>\DASH<n>.SCR` (`1692` → `1ff8:2fca`). `SHAPE.tbl` is loaded once at start-up (main → `a53c`). The race opens no `.tbl` and no `weapons.bmp`.
- **Keyboard**: `1ff8:4457` reads the BIOS ring buffer at `0040:001a`/`001c` with bounds at `0040:0080`/`0082`. `1ff8:44a0` reads the key-down table DS:4cb4 kept by the INT 9 handler. `1ff8:4486` reads the direction bitmask DS:4bb8 through the map DS:4d23.
- **Mouse**: INT 33h via `1ff8:4068` (DS:4bb2 = mouse present).
- **Joystick** (`1ff8:3fc2`, `3f62`, when DS:4b9a and DS:1fc0 are set): unsupported in the port.
- **Video**:
  - Driver slots: 3 blit, 4 page copy, 8 flip (CRTC 0Ch via `0040:0063`, no retrace wait), 9 no-op, 10/11 rect fill, 22 pixel, 25 (`[4988]`, INT 10h AX=1001h border colour), 27 span fill.
  - `1ff8:3cf9` **reads pixels** for the hit test.
  - Direct EGA GC/SC port writes in `2f73:0022`, `02ae`, `0469`. VRAM panorama panels at segment `A734`.
- **Sound and music**: `2524:041a(n)` sound effects (when DS:1fb0 and DS:8f9c), `2524:03f2(far)` music, `2524:4cd4` → `1000:c552` returns DS:2d4e (music playing).
- **Time**: none. No PIT or BIOS tick is read by the race code.

## Translation notes

1. **Per-frame simulation, no time base.** Everything advances once per loop iteration, and the original has no limiter (the flip does not wait for retrace). The port must pick a frame rate as an `APPROX:`. A rate measured from a reference machine in DOSBox would be the best choice (unknown).
2. **Rendering is part of the simulation.**
   - The direct-fire hit test reads framebuffer pixels after each object is drawn (`a570`, `76e2`).
   - Target lock uses projected screen positions (DS:998a/99d6, from `aae4`).
   - The pixel-exact polygon and road fills therefore have to be reproduced, including clip rectangles and draw order.
3. **Gap functions** that are really tails or jump targets of a larger function: `71ec`, `7216` (inside `6dbc`) and `9fe0`, `a010` (inside `9e90`; they use the caller's `BP` frame). Jump tables: `CS:716a` and `CS:705a` (keys), `CS:9fcc` (damage types).
4. **Stack-garbage reads**:
   - `9542`'s `[BP-4]` for type-5 missiles.
   - `9e90`'s damage local for type 4 when DS:1fe2 ∉ {0,1,2}.
   - `mat_mul`'s entry `CX` (below).
   - An exact port needs these modelled.
5. **Out-of-range table reads**:
   - The height test `DS:a942 + 6*pos[c]` in `9542` and `7cf0`.
   - `a410` reading DS:8edb+75 and beyond.
   - `9542` `rel[[BP-4]]`.
   - The `a942+6·pos` reads go past DGROUP's end on orlando, bay_area, la and seattle.
   - Use the memory image (`rw()`), not JS arrays.
6. **Integer behaviour**:
   - Position and sub use `IDIV` by 30 (truncation toward zero).
   - Interpolation uses `>>5` (1/32), not 1/30: the pose never reaches the next point and jumps by about 1/10 of a segment.
   - Shifts are `SAR`.
   - `85f0` progress is a 16-bit `IMUL` sign-extended to 32 bits, then compared unsigned. It overflows when `lap*len + pos > 32767` (from about lap 18 on the longest track).
   - `a2ac` and `af74` take absolute values with `CWD/XOR/SUB` (0x8000 stays negative).
   - `84be` combines a 32-bit `lmul` with 15 single-bit `SAR/RCR` steps, an unsigned threshold compare, and the asymmetric clamp [-0xa0, 0x9c].
7. **Off-by-ones and logic slips to keep**:
   - Beam charge alternates 10/11.
   - `8008` can produce speeds -1/-2.
   - `2524:4542` adds 1000 above 1000.
   - `18f4` clears the low byte of DS:8a7c[0].
   - The splash test in `996c` reads the car state.
   - Rockets fired by an AI use the player's speed and sub.
   - The AI missile count is not decremented; ammo can go negative.
   - The dead sound in `7fbe`.
   - `a210` has no start-line wrap.
8. **Q14 maths** (`2c46`): `IMUL`, sum, then `SHL/RCL ×2` and take `DX`. The result is `s16(sum32 >> 14)` with floor semantics on the wrapped 32-bit sum, not truncation.
9. **`mat_mul 2c46:0a8a` stale-CX bug**:
   - In every 2-term dot product of the type (1,1), (1,≥2) and (≥2,1) branches, the code does `MOV AX,CX` where `MOV CX,AX` was intended. The first product's low word is replaced by the entry `CX`: `t = (p1 & 0xffff0000) + (CX & 0xffff) + p2; r = s16(t >> 14)`. Bytes `8b c1` at 0ae8, 0d95, 0ea0, 0f4c and others.
   - Entry CX from the only caller (`1000:ac0d`):
     - object type 1: `(sy & 0xff00) | 1`, where sy is the projected corner from `aa2a`
     - types 2/3: `sar16(sin16(a2-a0), 1)` (last written at `2c46:0a2f`)
   - Pass it explicitly.
10. **`mat_from_angles 2c46:06a0`**. Notation: c/s = table cos/sin, h = SAR 1, mh(a,b) = s16(a·b>>14).
    - Type 1: m00 = m11 = c(a2), m01 = s(a2), m10 = -s(a2), m22 = 0x4000.
    - General:

      | term | formula |
      | --- | --- |
      | s0 | s(a0) → m12 |
      | P | h(c(a1-a2)) + h(c(a1+a2)) |
      | Q | h(c(a1-a2)) - h(c(a1+a2)) |
      | m00 | P - mh(s0,Q) |
      | m21 | Q - mh(s0,P) |
      | R | h(s(a2+a1)) + h(s(a2-a1)) |
      | S | h(s(a1+a2)) + h(s(a1-a2)) |
      | m01 | mh(s0,S) + R |
      | m20 | mh(s0,R) + S |
      | m11 | h(c(a0+a2)) + h(c(a0-a2)) |
      | m22 | h(c(a0+a1)) + h(c(a0-a1)) |
      | m02 | -(h(s(a1-a0)) + h(s(a1+a0))) |
      | m10 | -(h(s(a2-a0)) + h(s(a2+a0))) |
11. **Hardware IDIV traps**: `tan16` (\|tan\| ≥ 2), `2c46` projection and clip intersections. A trap is a runtime-error exit (R6003, inferred). The `e80c` software divide traps only on /0. `int.js idiv16` must throw on these.
12. **Register-argument helpers**:

    | helper | registers |
    | --- | --- |
    | 2c46:10d2 | in BX, SI, DI |
    | 2c46:1317 / 13ad | in AL, ES:BP; out CX, DX, DI, BX, SI |
    | 2c46:14b3 | in AX; out DX:AX |
    | 2c46:0114 / 03d8 | in SI, BX |
    | 2c46:026c / 0534 | in ES:DI, BP |
    | 2f73:0469 | in AX, BX, DI; colour pushed |
13. **Polygon buffers**: the clip output at DS:38ec/3914 holds 20 entries with no bound check.
14. **EGA panorama**: a negative row count in the `2f73:0022` path loops about 256 rows (`JZ`, not `JLE`).
15. **Ground fill**: `2f73:0469` adds one byte when x0 is byte-aligned (`DEC CX` / `INC CX` imbalance). Row 99 is never painted by `02ae`.
16. **RNG order**: one `rand()` per frame at the end of `6dbc`, plus the calls listed in the RNG section. Keep the exact call order.

## Open questions

| question | evidence |
| --- | --- |
| Effective frame rate of the original (it has no limiter) | unknown, needs a DOSBox measurement |
| The pit menu `23e2`/`68dc` contents (refuel and repair costs) | not analysed |
| Which purchased parts set DS:1fc8/1fce/1fd0/1fd4/1fe0/1fe4 | inferred from use only |
| DS:8954 / DS:8f0a are AI fire-chance bonuses | static use in `7daa`; set by `18f4` from difficulty |
| Whether DS:898e (roll) is ever non-zero | unknown; not written in the race code read |
| `[BP-4]` contents at `9542:9778` | inferred: `6dbc`'s saved lateral; needs runtime confirmation |
| Splash damage in `996c` never fires | inferred: car states are only 1/0/negative |
| The `a410` out-of-range bytes DS:8ede..8f26 and their effect on draw order | static; needs a regression check |
| The `tan16` / `IDIV` trap reachable in play | unknown |
| `b8f6` (mirror raster) | presumed analogous to `b522`; not decoded |
| `e9a0` long op in `34b0` | unknown |
| Meaning of DS:9b0e | static use: laser battery (`9bcc`). Init 100 per car |
| DS:8e9c is "left road after finishing" | static (`8008` writer) |
| Order and frame assignment of the five `bitmaps.blk` containers (DS:965a, 9a80, 9aea, 9bbe, 8dc0) | static for the loader (`2524:012e`); frame meanings inferred from use |
| The `a942+6·pos` out-of-DGROUP reads on long tracks: what lies there at runtime | unknown; depends on the DOS memory layout |
| Shape group byte 0 and shape byte +2 | unknown, unread by `2c46` |
| Writer of DS:a678 during the race | resolved: `85f0` writes it indirectly through DI = 0xa69c, every 16 frames |


