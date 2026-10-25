# Game flow outside the race

Scope: `main`, the title/attract sequence, the dialog ("screen") framework, the menu dispatcher `1000:2766`, the in-race modal dispatcher `1000:2c9c`, copy protection, career state, and race entry/exit. Race internals (`1000:047c` body) are out of scope.

Evidence levels: **static** (decompile/disassembly/data bytes), **inferred** (consistent with static facts but not proven), **unknown**. Nothing here was observed in DOSBox.

## Overview

```
main 1000:0010
 ├─ init: cwd/argv, cmdline, video, RNG, input, disk-2 probe, PALS.BLK, danger.mus, fonts.blk
 ├─ attract (skipped if DEMO): TITLE.TTM player ⇄ credits scroller until key/button
 ├─ POSTWAR.SCR backdrop, bitmaps.blk, build 56 dialog pages (1000:070a), SHAPE, trax.mus
 ├─ start: sign-up page 0x15 (normal) | new game 2eb8 (DEMO) | disk-2 prompt 0x0d (DEMO, no disk 2)
 ├─ 2524:1de8 (fill two 9-word tables)
 └─ 1000:67e8 event loop (never returns)
        poll input → hit-test the current page → on activation:
        1000:2766(screen = [0x9018], choice = [0xa464])
           → handler draws the next page (1000:6d76 / 1000:1780+3c0a) and returns to the loop
```

The UI is a single global "current page" (a modal dialog box) plus a free-moving mouse pointer. Every menu, message box, shop and form is one of 56 pages built once at start-up by `1000:070a`. A page is selected by its 1-based index (`1000:3ab8`), drawn by `1000:3c0a`, hit-tested every poll by `1000:3fe4`/`44fc`, and when a choice button is activated the event loop calls `1000:2766(page, choice)`. Handlers never return a value. They draw the next page (or start a race, which runs to completion inside the handler) and fall back to the loop.

Note: the task hypothesis that `1000:69e6` takes a menu struct and `DS:9bf6` is the current menu is wrong. `[0x9bf6]` is the mouse-pointer bitmap set loaded from `PALS.BLK`, and `69e6` installs pointer shape N (static: `1000:0010` stores `1ff8:0006`'s result in `[0x9bf6]` and fails with "Unable to load pointer bitmap" `DS:00ad`; `69e6` allocates two save buffers for the sprite and fails with "No memory for sprite data" `DS:1f32`).

## 1. `main` (`1000:0010`) in order

| # | Address | What happens | Evidence |
|---|---|---|---|
| 1 | `1000:e740(0xa902,0x3b)` | Save the current directory into `DS:a902` (59 bytes). On failure, fatal `DS:0042` "Unable to find path to the game source". The fatal handler `1000:0344` calls `1000:e70b(0xa902)` to go back to it | static (behaviour of `e740`/`e70b` as getcwd/chdir is inferred from use) |
| 2 | `1000:003d–0071` | `strrchr(argv[0],'.')`, scan back to `'\\'` and cut there. `strcpy(DS:8f0c, argv[0])`, then `e70b(8f0c)` (chdir to the game directory). `DS:8f0c` is the game directory prefix for all paths (see `2524:2be8`) | static |
| 3 | `2524:043c(argc,argv)` | Command line: `DEMO`→`[0x1fa8]=1`, `G?`, `Jn`, `Mn`/`Tn`, `Sn`. Then `1ff8:20ff` detects the adapter and the result goes to `[0x95d6]` (initial `0x0f` = auto) | static, see identity.md |
| 4 | `[0x3842]=1` | Text drawing flag (also set by `1000:4d06`) | static, meaning unknown |
| 5 | `[0x95d6]` test | `0` → fatal `DS:0076` "Hardware not compatible". `1` (CGA) → `1000:a536` = `INT 10h AX=0006h` | static |
| 6 | `1000:045a` | If `[0x385d]!=3` call `1000:c00e` | static, purpose unknown |
| 7 | `1000:a403` | Reset RNG indices | static |
| 8 | `2524:0260` | Input/system init: `2f73:05d8`, keyboard handler `1ff8:40c7(1)`, `1ff8:3af2`, mouse detect → `[0xaa9a]` (or fixed pointer limits `[0x1fc2]=0x128`, `[0x1fc4]=0xc5` when `[0x385d]==4`), clip rect 0..319×0..199, page pointers, joystick `1ff8:3dd1` if `[0x1fc0]`. `[0x896c]=1` only for adapters `[0x385d]` 1 or 4 (CGA/Tandy, it then fills dither tables `DS:1cf0`, `1cdc`, `9252–`) | static |
| 9 | `[0x1fba]=0`; `1000:38e4("SLY.BMP")` | Disk-2 probe with retries off. Loaded → `1000:390a` frees it, `[0x9b84]=0`. Not found → `[0x9b84]=1` (two-disk mode, prompts "INSERT DISK #n" later). Then `[0x1fba]=1` | static |
| 10 | `PALS.BLK` | `1ff8:4a48` open. `32e3:009a` (sound bank) → `[0x8f9c]`, `32e3:05ba`. Two palettes via `1ff8:3b7a` → `DS:a252`, `a254`. `1ff8:3c64([a252])` applies the first. `1ff8:0006` → pointer bitmaps `[0x9bf6]` (fatal `DS:00ad` if absent). Close | static |
| 11 | `danger.mus` | `2524:4b34` → far ptr `[0x8f06]:[0x8f08]`. Fatal `DS:00e3` if null | static |
| 12 | `2524:009e` | Load `fonts.blk`: three fonts → `[0x8e72]`, `[0x8e98]`, `[0x8eb4]`. Select `[0x8eb4]` (8×8). Fatal `DS:0163`/`0142` | static |
| 13 | attract (only if `[0x1fa8]==0`) | `2524:03f2(danger.mus)` starts music if `[0x1fb2]`. Loop: `r=2524:0584()` (TITLE.TTM). If `r!=0` or `[0x8eba]!=0`, leave. Else `r=2524:0720()` (credits scroller). Repeat while `r==0`. When the credits are interrupted, `1000:02ea` resets the clip rect. Finally `2524:4cb6` stops the music | static |
| 14 | `1000:03f6` | Draw `POSTWAR.SCR` (`DS:01e0`) into page `[0x3850]` and copy it to the screen with `2524:1528(0,0,320,200,0x50)` (transition effect, unknown). Pointer to (0x9a,0xb4), pointer shape 1 | static |
| 15 | `2524:012e` | Load `bitmaps.blk`: five bitmap sets → `[0x965a]`, `[0x9a80]`, `[0x9aea]`, `[0x9bbe]`, `[0x8dc0]`. Fatal `DS:01b4`/`0190` | static |
| 16 | `2524:0008` | For sprites 0–12 of `[0x9a80]`, store anchor offsets. X = `-w/2` → `DS:990a+2i`. Y = `-h/2` (i<4) or `-h` (i≥4) → `DS:999e+2i` | static |
| 17 | `1000:070a` | Build all 56 dialog pages (see §2) | static |
| 18 | `1ff8:3692([0x8e98])` | Select the 6×6 font | static |
| 19 | `2524:18e0` | `[0x5c9e]=-100`, `[0x5ca0]=0`, `[0x5ca2]=0` | static, meaning unknown |
| 20 | `2524:2be8("SHAPE")`, `1000:a53c(DS:99ec)` | Load the shape table (`a53c` not analysed) | static |
| 21 | `2524:01da` | `1000:c272(-1)` (heap query), try `1ff8:3a88(0,2,1)`. Success → free it, load `trax.mus` → `[0x8f02]:[0x8f04]`. Failure → `2524:4c8a` frees danger.mus, clears both music pointers and `[0x1fb2]` (music off) | static |
| 22 | `2524:03f2(danger.mus)` | Restart the menu music | static |
| 23 | start | `[0x1fa8]==0`: `[0x1fba]=1`, `1000:1bea` sign-up page. Else `[0x9b84]==0`: `[0x1fa6]++` (autoplay on), `1000:2eb8` new game. Else `[0x9b22]=0x0b`, `1000:6d76(0x0d,0)` "INSERT DISK #2", which continues to `2eb8` | static |
| 24 | `2524:1de8` | `DS:aa20[i]=0x22+10i`, `DS:9abe[i]=0x29+10i`, i=0..8 (9 words each) | static, use unknown (likely y positions of 9 list rows) |
| 25 | `1000:67e8` | Event loop, never returns. Exit is via `1000:0344`-style termination from handlers | static |

### Title and credits

- `2524:0584` TTM player: `089c` resets the TTM state (`DS:5da`/`5e4` 5-slot tables, `[0x578c]=-1`). `08de("TITLE.TTM")` loads and decompresses a script into a free slot and returns the slot. `0a7c` prepares it. Then `0bb6(step)` runs steps until it returns 0 (end). Between steps `2524:0382` keeps the music looping and `2524:0534` polls for input. Returns AX=1 and sets `[0x8eba]=1` on input, AX=0 at script end after cleanup `120e`/`1292`/`14a2` and clip reset (static, `2524:05d8–0622`). The TTM opcodes are not analysed here.
- `2524:0534`: returns 1 if the BIOS key buffer has a key (`1ff8:4457`) or a mouse button (`1ff8:4068(0/1)`) or a joystick button (`1ff8:3fc2(0/1)`) is down.
- `2524:0720` credits: copies page `[0x3850]` to `[0x3852]`, then scrolls 0x55 lines from the string-pointer table `DS:0530` (starting with "@PROGRAM:", "Darek Lukaszuk", …) up by 2 px per frame inside the window (10,10,300,0x87). Lines starting with `'@'` are colour 0xb (headings), others colour 3. Lines starting with `'~'` use the 6×6 font. Ends when the scroll offset is below -599 (AX=0) or on input (AX=1, `[0x8eba]=1`). No explicit frame wait: speed depends on the music poll and blits (blocking only through `0534`/`0382`, inferred).

### Sign-up page ("DEATHTRACK WANTS YOU / SIGN HERE")

`1000:1bea`: `1780(0x15)`, `3c0a(2,0x80)` (full-screen frame), `TITLE.BMP` frame 0 at (10,10), `WANTSYOU.BMP` frames 0/1 at (0x4b,0x32)/(0x5f,0x5a), free the pictures, `[0x1f28]=1`, pointer shape 0.

Page 0x15 has 15 spacer lines, "SIGN HERE:", an editable line bound to `DS:1792` (max 14 chars, emptied by `070a` after the line is created), and the button "GO FOR IT!". Activation → `2766` case 0x15:

1. `strcmp(DS:1792,"Lukaszuk!")==0` → `[0xd26]=1` (cheat: `2eb8` then sets cash to 5,000,000).
2. Empty name → "NEW KID" (`DS:0d9d`).
3. `[0x9b84]==0`: if `[0x1fb6]==-1` (quiz not yet asked) → `1000:2230` copy-protection quiz. Else → `2eb8` new game.
4. `[0x9b84]!=0`: `[0x9b22]=0x34` (quiz) or `0x0b` (new game), then page 0x0d "INSERT DISK #2".

### Demo / attract autoplay (`[0x1fa8]`, `[0x1fa6]`)

- `[0x1fa8]` (DEMO argument) skips the attract loop and the sign-up page.
- `[0x1fa6]` (autoplay counter) makes `1000:6a90` skip all mouse/keyboard/joystick input and `1000:66d2` skip key handling. Every 200 calls of `66d2` (`[0x1f2e]`), `2524:0624` runs one character of the script `DS:18d2` (0x4e chars, index `[0x1faa]`, wraps):
  - `D` → next button (`2524:4584`).
  - `E` → press for 125 polls (`[0x8dae]=0x7d`; `66d2` holds `[0x9aee]=1` while it counts down).
  - `W` → `1000:a3aa(1)` ×300 (delay, blocking).
  - `X` → pointer to (0xa0,0x82).
  - `#` → 10× next. `$` → 19× next. `9` → `(rand+1) mod 9` × next (`1000:c0a8` long mod). Other characters (`*`) do nothing.
- Also read by `1000:2ff4`, `1000:6dbc`, `2524:18f4`, `2524:258c` (race-side demo behaviour, see §6).

## 2. Dialog framework

### Data structures (all near heap, allocated by `1000:de60`)

**Page list** `[0x9bcc]`: a singly linked list of 4-byte nodes, page *n* is the *n*th node (1-based).

| Off | Width | Meaning |
|---|---|---|
| +0 | w | → page record |
| +2 | w | → next node |

**Page record** (13 bytes, `1000:3a1e`). `[0x8a48]` points at the current one.

| Off | Width | Meaning |
|---|---|---|
| +0 | w | head of the line list |
| +2 | w | head of the button list. The record itself acts as a list node: walkers start at `rec` and follow `+2` |
| +4 | w | box x (computed by `3c0a`, also `[0x8a96]`) |
| +6 | w | box width (`[0x8a52]`) |
| +8 | b | init 99, unused here |
| +9 | b | init 0 |
| +0xa | b | box y (`[0x8db0]`) |
| +0xb | b | box height (`[0xa8a4]`) |
| +0xc | b | style: 0 normal, 1 "warning" style (copied to `[0x8984]` by `3ab8`; changes box colours in `4808` and text rendering in `4d06`) |

**Line record** (14 bytes, `1000:3b46(str, editable)`)

| Off | Width | Meaning |
|---|---|---|
| +0 | w | string pointer (DS) |
| +2 | w | next |
| +4 | w | x |
| +6 | w | width in px |
| +8 | b | focused (editable lines) |
| +9 | b | previous focus state |
| +0xa | b | y |
| +0xb | b | height |
| +0xc | b | capacity = `strlen` at creation (the max input length for editable lines) |
| +0xd | b | editable flag |

**Button record** (12 bytes, `1000:3bb6(str)`)

| Off | Width | Meaning |
|---|---|---|
| +0 | w | string pointer |
| +2 | w | next |
| +4 | w | x (absolute after `3c0a`) |
| +6 | w | width |
| +8 | b | hover state (0/1, 99 after drawing) |
| +9 | b | previous hover state |
| +0xa | b | y |
| +0xb | b | height |

`1000:45ea` special-cases some buttons by string pointer: `DS:2760` "BUY IT" at x=0xd w=100, `DS:2768` "DESCRIBE" at x=0xcf w=0x62 (y 0x9b, or 0x99 with flag 0x200), and strings starting `<`/`>` at x 10/0x104, y 10, 0x32×0xc.

### Page builders and loaders

| Function | Role |
|---|---|
| `1000:3a16` | `[0x9bcc]=0` |
| `1000:3a1e(style)` | Append a new page. Sets `[0x9018]=[0x8db8]=` its index and `[0x8a48]=` its record |
| `1000:3b46(str,editable)` | Append a line to `[0x8a48]` |
| `1000:3bb6(str)` | Append a button to `[0x8a48]` |
| `1000:11f2` | Two empty lines. `1000:11c2(n)`: n lines of 36 spaces (`DS:27e8`) |
| `1000:4778` / `1000:47be` | Free all lines / all buttons of the current page (used by pages filled at run time) |
| `1000:3ab8(n)` | Select page n: `[0x9018]=n`, `[0x8a48]=rec`, `[0x8984]=rec.style`. Focuses the first editable line (`+8=1`, cursor `[0x5a00]=0`, event `0xe`). Returns 0, or -1 if n is past the end |
| `1000:1780(n)` | Restore the screen (`02dc`), pointer shape 1, `3ab8(n)`, reset page selectors. The caller then adds lines/buttons and calls `3c0a` |
| `1000:3c0a(frame, flags)` | Lay out and draw the current page, see below. Clears `[0xa464]`, puts the pointer on the first button (`2524:4584`) |
| `1000:6d96(n, frame, flags)` | `3ab8(n)`, `0286`, `3c0a(frame,flags)`, redraw pointer, `[0x1f28]=1` |
| `1000:6d62(n,flags)` | `6d96(n,0,flags)` |
| `1000:6d76(n,flags)` | `6d96(n,2,flags)` then `1ff8:3cf1(0)` = driver slot 25, EGA border colour 0 (`29f6:0044`) |
| `1000:38e4(name)` | `390a`, then load bitmap file `name` → `[0x9bc2]` (0 if missing), `045a` |
| `1000:390a` | Free `[0x9bc2]`, `1000:c272(-1)` |
| `1000:3930(i,x,y)` | Draw frame i of `[0x9bc2]` at (x,y) with `1ff8:2541`, if loaded |
| `1000:4d06(str,x,y)` | Draw text with a 1-px shadow/outline. Normal style: colour 0 at x-1, colour 0xf at x+1, then the main colour at x. Main colour: `[0xa8a6]==1` → 0xc, `0` → 0xe (0xf on CGA/Tandy `[0x896c]`), otherwise `[0xa8a6]`. Warning style (`[0x8984]!=0`): colour 0 at x, then 7 (`[0xa8a6]==1`) or 0xf at x+1. Colour goes in `[0x3840]`, the glyph routine is `1ff8:23ba` |
| `1000:4808(x,y,w,h,mode)` | Box/frame drawing (not detailed; mode 2 = frame only, mode 5 = fill only, inferred from the branches at `1000:481a`/`4838`) |
| `1000:4bd4(x,y,w,h)` | Button/field background |
| `1000:21d6(x,y,w,h,mode)` | `[0xa8a6]=1`, `4808` + `4bd4` |

`3c0a` layout (`1000:3c0a`). Lines and buttons are 8 px high (`[0x5c82]`). Glyphs are 8 px wide (`[0x8eae]`).

- Box width = max(max line width, max button width + 30) + 4. Lines are `(len+2)*8`. Editable lines use capacity×8.
- Box height = (lines+2)·8 + buttons·10 + 4 + 20. Flag 2 drops the 20. Capped at 0xbe.
- The box is centred horizontally, vertically at `(-h-0x38)/2` as a byte.
- Lines are centred, one every 8 px. Buttons are full width, below the lines, 11 px apart.

`flags` (`[0x98d6]`):

| Bit | Effect |
|---|---|
| 0x01 | Clear the screen first (`031a`) |
| 0x02 | Box at y=0x92, no extra 20 px |
| 0x04 | On close, keep the picture `[0x9bc2]` |
| 0x10 | Lines drawn at x=0xb8 |
| 0x20 | No background restore before drawing |
| 0x40 | On close, clear the screen |
| 0x80 | Full-screen box (5,5,0x136,0xbe) |
| 0x100 | Parts-shop grid (6×3 cells, 'B' buy `5c7c`, 'D' describe `6090`). Also free pointer movement with cursor keys while a page is open |
| 0x200 | Weapons-shop grid (3×3 cells, scroll offset `[0x1e6c]`, 'B' buy `632e`) |
| 0x400 | On close, no restore |
| 0x800 | Save the screen under the box (`2524:2c22` → `[0x9af0]:[0x9af2]`) and restore it on close |

### Event loop and input

`1000:67e8` sets `[0x1f20]=0x66d2` (per-poll callback) and loops forever:

1. `[0x9b82]=0`. `1000:6a90` reads joystick/mouse/keyboard, moves the pointer, calls `[0x1f20]` (`66d2`), and redraws the pointer sprite via the save buffers `[0x8a4e]`/`[0xa8c0]`.
2. `6cea` (redraw pointer) if `[0x963c]`.
3. `6998`: pointer shape follows the event. `[0x9b82]==0` (outside the box) → shape 2 (`69bc`). Entering the box → shape 0 (`69d8`).
4. `[0x1f28]==0` (no page open): only the file dialog runs. With `[0x1f2a]==1` (load) or `2` (save), event `0x17` (cancel) → `[0x9b22]=5` or `0xc`, `39ae`. Event `0x15` (OK) → `525a` load or `52ec` save. If the result is not -1 → `[0x9b22]=0xc`, `39ae`.
5. Page open, event ≠ `0xd`: on page 0x2d → `1d74(0)`, on page 0x31 → `1d74(1)` (animated car / champion picture, one frame per poll).
6. Event `0xd`: `2766([0x9018],[0xa464])`, then `[0x1f28]<0` → 0.

`1000:66d2` per poll:

- `rand()` once (the RNG advances every poll even when idle), decrement the key-repeat timer `[0x1f1e]`.
- Not in autoplay: read the BIOS key buffer (`1ff8:4457`). Key `0x0f09` (Tab) → next button.
  - Enter (key-down table `DS:4cb4[0x1c]`, `1ff8:44a0`) or Space (`[0x39]`) → `[0x9aee]=1` (press).
  - Alt+C with joystick on → recalibrate (`1ff8:3dd1`).
  - `S`/`T` (not on page 0x15, no file dialog) → `2524:03dc`/`039c` (sound/music toggles), and `21ba` refreshes page 10 if it is open.
- `[0x8dae]` autoplay press countdown. Autoplay script tick.
- `[0x9b82] = 1000:3f92(x, y, pressed, &[0x963c], ascii, scancode)`.

`1000:6a90` input details:

- Cursor keys (`1ff8:4486` or joystick `1ff8:3f62`, bits 1=up 2=down 4=left 8=right). With a page open and flag 0x100 clear, up/down select the previous/next button (`2524:4612`/`4584`) with repeat delay `[0x1f1e]=0x3c`. Otherwise they move the pointer 1 px.
- Mouse buttons `1ff8:4068(0)` → `[0x9aee]`.
- Clamps the pointer to 200 lines.

`1000:3f92` → `3fe4` (hit test) + `44fc` (repaint changed buttons/fields). Event codes returned in `[0xa66c]` → `[0x9b82]`:

| Code | Meaning |
|---|---|
| 0x00 | Pointer outside the box (±margin: x−0x14..x+w+0x19, y−0x19..y+h+0x1f, `3fe4`) |
| 0x0b | Inside the box |
| 0x0c | Pressed over a button. `[0xaa9c]` = its 1-based index |
| 0x0d | Released after a press over a button: `[0xa464]=[0xaa9c]` (activation). `44fc` then runs `46da` (close the page: `[0x1f28]=-1`, free the picture unless flag 4, restore per flags) unless flag 0x100 |
| 0x0e | An editable line got focus |
| 0x15 / 0x17 | File dialog OK / cancel (from `2524:328e`/`3658` via `[0x9924]` when `[0x1f2a]!=0`) |

Choice numbers count buttons only, from 1, in creation order. Lines do not count.

Text entry (`1000:439e`, focused editable line). Scancode `[0x9658]`, ASCII `[0x8dbe]`, cursor `[0x5a00]`, insert-mode toggle `[0x1162]`.

- 0x4b left, 0x4d right, 0x47 Home, 0x4f End, 0x52 Ins toggles insert mode, 0x53 Del, 0x0e Backspace, 0x1c Enter ends the edit.
- Printable ASCII (≥0x20) is inserted or overwritten up to the capacity `+0xc`.
- `4302` redraws the field with the cursor.

Keyboard "click": cursor keys or Tab move the pointer to a button's centre (`2524:4584`/`4612` through `2524:3c2c`). Enter/Space held → press. Release → `0xd`.

`2524:3c2c(x,y,noMouse)`: clamp to `[0x1fc2]`/`[0x1fc4]` → `[0x5a10]`/`[0x5a12]`. If a mouse is present (`[0xaa9a]`), set it (`1ff8:404b`) and read it back (`1ff8:4025`). Sets `[0x99bc]` when moved.

### The 56 pages (built by `1000:070a`, in this order)

Strings are DS offsets. "(dyn)" = filled at run time by the handler.

| Id | Style | Content | Shown by |
|---|---|---|---|
| 0x01 | 1 | WARNING / NO TRACK FILE FOUND / `DS:a8d8` / OK | (track loader, not traced) |
| 0x02 | 1 | WARNING / THE TRACK / name / IS MESSED UP / OK | " |
| 0x03 | 1 | WARNING / CAN'T OPEN TRACK! / name / CHECK DISK… / OK | `1000:4fae` |
| 0x04 | 1 | WARNING / CAN'T WRITE! … / OK | " |
| 0x05 | 0 | main menu: FULL CIRCUIT RUN, RUN A TRACK, RUN OLD CIRCUIT, THE SHOPS, SCOPE THE STATS, SET YOUR LIMITS, SOUNDS, RESTART, BAIL OUT | `39ae`, `65bc` |
| 0x06 | 1 | empty | `2766` default of page 5 |
| 0x07 | 0 | stats: TOP SCORES, SCAN THE PROS, SCAN THE TRACKS, OUT'A HERE | page 5 choice 5, 0x10/0x13 exits |
| 0x08 | 0 | track list (10 cities `DS:1ca0` + OUT'A HERE) | page 5 choice 2 |
| 0x09 | 0 | OUT'A HERE (dyn) | `1000:34b0` |
| 0x0a | 0 | sound options (4 radio buttons `DS:2816`) | page 5 choice 7, `21ba` |
| 0x0b | 0 | car dealer: line (dyn), PASS, TAKE THIS ONE | `2eb8` with flags 0x22 |
| 0x0c | 0 | race hub (dyn: GO RACIN'/KEEP RACIN', SPEND SOME CASH, SAVE CIRCUIT, BAIL ON THIS CIRCUIT) | `1000:1798` |
| 0x0d | 0 | PLEASE INSERT DISK #2 / OK | `main`, `2766`, `39ae`, `51bc` |
| 0x0e | 0 | SIMULATION PAUSED / CONTINUE | `1000:75ea` (race) |
| 0x0f | 0 | limits: HOW MANY LAPS (editable `DS:065c`, 2 chars) / HOW TOUGH: PUNK, GAMBLER, WARRIOR, MEGA DESTROYER (`DS:280e`) | page 5 choice 6 |
| 0x10 | 0 | pros list (9 names `DS:17a4` + OUT'A HERE) | page 7 choice 2, 0x11, 0x2d |
| 0x11 | 0 | pro bio: OUT'A HERE, SHOW CAR (dyn lines) | `1000:1a66` |
| 0x12 | 0 | track info: OUT'A HERE (dyn) | `1000:1916` |
| 0x13 | 0 | track list for "scan the tracks" | page 7 choice 3, page 0x12 |
| 0x14 | 0 | TOP MONEY WINNERS, 15 lines, OUT'A HERE | `1000:3406` |
| 0x15 | 0 | sign-up (see §1) | `1000:1bea` |
| 0x16 | 1 | Exit to DOS? NO / YES | page 5 choice 9 |
| 0x17 | 0 | PARTS SHOP, 15 lines, DESCRIBE, BUY IT, WEAPONS SHOP, OUT'A HERE | `2714`, `57b6` |
| 0x18 | 0 | WEAPONS SHOP, 12 lines, `<<`, `>>`, DESCRIBE, BUY IT, PARTS SHOP, OUT'A HERE | `2714`, `57b6` |
| 0x19 | 0 | empty | — (`2766` → page 5) |
| 0x1a | 0 | FINE! (dyn: item description) | `1000:6090` |
| 0x1b | 0 | COOL (dyn) | `1000:2ff4` |
| 0x1c | 0 | SO WHAT (dyn) | `1000:318c` |
| 0x1d | 0 | COOL (dyn) | `1000:318c` |
| 0x1e | 0 | shop choice: line, PARTS SHOP, WEAPONS SHOP | `1000:2f72` (flags 0x22) |
| 0x1f | 0 | YOU DON'T HAVE ENOUGH MONEY… / FINE! | `5c7c`/`632e` (flags 0x424) |
| 0x20 | 0 | YOU ALREADY HAVE THIS ITEM! / OOPS... | " |
| 0x21–0x25 | 1 | file errors (can't find, not a race file, mangled, can't open, write error) / TOO BAD! | `525a`, `52ec` |
| 0x26 | 1 | ARE YOU SURE YOU WANT TO EXIT? YES / NO | `1000:6dbc` (race, flags 0x820) |
| 0x27 | 0 | pit-stop menu (dyn) | `1000:23e2` |
| 0x28 | 0 | JUST SAY WHEN, 18 lines, WHEN! (gas pump) | `1000:1c5e` |
| 0x29 | 0 | YOU CAN'T PURCHASE THIS ITEM AT THE PITSTOP! / TOO BAD! | shop buy |
| 0x2a | 0 | YOU NEED MORE BUCKS TO FIX THIS. / TOO BAD! | shop buy |
| 0x2b | 0 | THE CONDITION OF YOUR CAR IS TOO POOR… / TOO BAD! | page 0xc choice 1 |
| 0x2c | 0 | YOUR TANK IS FULL! / OUT'A HERE | `1000:24c4` (flags 0x420) |
| 0x2d | 0 | show car: OUT'A HERE | `1000:1cee` |
| 0x2e | 0 | circuit standings: MORE... (dyn table) | `1000:204c` |
| 0x2f | 0 | YOU REACHED A MAXIMUM LOAD FOR THIS ITEM / OOPS... | shop buy |
| 0x30 | 0 | NO ITEM ON SCREEN IS SELECTED / OOPS... | shop buy |
| 0x31 | 0 | champion page: OUT'A HERE (dyn) | `1000:1e64` |
| 0x32 | 0 | PLEASE INSERT DISK #1 / OK | `2766` case 0x2e |
| 0x33 | 1 | Exit Circuit? NO / YES | page 0xc choice 4 |
| 0x34 | 0 | copy-protection quiz (dyn, 5 answers) | `1000:2230` |
| 0x35 | 0 | YOU'RE THE CHAMP! Take your car through a tougher circuit. / OK | `2766` case 0x31 |
| 0x36 | 0 | YOU'RE OUT OF GAS / YOU FINISH LAST! / OK | `1000:7a9c` (race, flags 0x820) |
| 0x37 | 0 | PLEASE INSERT DISK #1 / OK | page 5 choice 8 |
| 0x38 | 0 | PLEASE INSERT DISK #1 / OK | `2766` case 0x31 |

## 3. Dispatcher `1000:2766(screen, choice)`

The jump table is at `CS:2c2e`: 0x34 words for screens 5..0x38. Screens below 5 or above 0x38 go to `2c24`: `[0x9b22]=5`, `39ae` (back to the main menu). Page 5 has its own 9-entry table at `CS:2848`. "→ page n" means `6d76(n,flags)`. Choices are 1-based.

`1000:39ae` is the "continue after a disk check" helper. It sets `[0x1fba]=0` and probes game disk 2 by reading `HI_SCORE` (`1000:5136`, which also loads the hi-score table), then sets `[0x1fba]=1`.

- Read failed → page 0x0d "INSERT DISK #2". Its OK comes back to `2766` case 0x0d → `39ae` again.
- Read succeeded → continue to `[0x9b22]`:
  - 5 → page 5
  - 0x0b → new game `2eb8` (and `[0x1fa6]++` in DEMO)
  - 0x0c → race hub `1798`
  - 0x34 → quiz `2230`
  - 99 → `397c`

| Screen | Choice | Action |
|---|---|---|
| 0x05 main | 1 FULL CIRCUIT RUN | `39a0`: `[0xd24]=1`, shuffle the city order (`238c`), hub `1798` |
| | 2 RUN A TRACK | `[0xd24]=0` → page 8 |
| | 3 RUN OLD CIRCUIT | `4f28(0,9,0,0xe,"LOAD","CANCEL","WHICH CIRCUIT TO LOAD?","*.RCT",0)`, `[0x1f2a]=1` (file dialog, loop step 4) |
| | 4 THE SHOPS | `2f72` → page 0x1e |
| | 5 SCOPE THE STATS | → page 7 |
| | 6 SET YOUR LIMITS | Put `*` in front of difficulty string `[0xd28]` (`DS:280e[i]`) → page 0x0f |
| | 7 SOUNDS | `2524:2396` (mark the current option) → page 0x0a |
| | 8 RESTART | `[0x9b84]==0` → `1bea` (sign-up). Else → page 0x37 |
| | 9 BAIL OUT | → page 0x16 |
| | other | `6d62(6,0)` |
| 0x06, 0x0e, 0x19, 0x26–0x29, 0x2c, 0x36 | any | `[0x9b22]=5`, `39ae` (main menu). In practice 0x0e/0x26/0x28/0x29/0x2c/0x36 are handled by `2c9c` while a race is running |
| 0x07 stats | 1 TOP SCORES | `3406` (page 0x14) |
| | 2 SCAN THE PROS | → page 0x10 |
| | 3 SCAN THE TRACKS | → page 0x13 |
| | 4 OUT'A HERE | → page 5 |
| 0x08 tracks | 1–10 | `[0x89c8]=1`, `2f88(choice-1)`: single race |
| | 11 | → page 5 |
| 0x09 results | any | `[0x9a84]!=0` → `318c` (mafioso payoff). Else `3958` |
| 0x0a sounds | n | `2524:23fe(n-1)` → page 5 |
| 0x0b car dealer | 1 PASS | `[0x9b0c]=([0x9b0c]+1) mod 3`, then `2eb8` (redraws the dealer with the next car) |
| | 2 TAKE THIS ONE | `2524:26c0` (recompute stats) → page 5 |
| 0x0c race hub | any | `47be` first (free the dynamic buttons) |
| | 1 GO/KEEP RACIN' | If `[0x9aa6]<[0x1c5c]` and `[0xa670]<1000`: `[0xd24]++`, `3396` (race). Else → page 0x2b |
| | 2 SPEND SOME CASH | `57ac` (parts shop) |
| | 3 SAVE CIRCUIT | `4f28(…,"SAVE","CANCEL","   NAME THIS RACE","*.RCT",0)`, `[0x1f2a]=2` |
| | 4 BAIL ON THIS CIRCUIT | → page 0x33 |
| | other | `6d62(6,0)` |
| 0x0d disk 2 | OK | `39ae` |
| 0x0f limits | any | Laps = `atoi(*[0xb4e])` clamped to 1..99 → `[0x8eb8]`. `[0xd28]=choice-1` → page 5 |
| 0x10 pros | 1–9 | `[0x8db4]=choice`, `1a66(choice)` (page 0x11) |
| | 10 | → page 7 |
| 0x11 pro bio | 1 OUT'A HERE | → page 0x10 |
| | 2 SHOW CAR | `1cee` (page 0x2d) |
| 0x12 track info | any | → page 0x13 |
| 0x13 tracks | 1–10 | `1916(choice-1)` (page 0x12) |
| | 11 | → page 7 |
| 0x14 top scores | any | → page 7 |
| 0x15 sign-up | GO FOR IT! | See §1 |
| 0x16 exit | 2 YES | `0344(DS:0d7f "SEE YOU LATER DUDE!")`: restore and exit to DOS |
| | other | → page 5 |
| 0x17 parts shop | n | `65ea(n,0)`: 1 describe, 2 buy, 3 weapons, 4 exit |
| 0x18 weapons shop | n | `6626(n,0)`: 1 `<<`, 2 `>>`, 3 describe, 4 buy, 5 parts, 6 exit |
| 0x1a description | any | `57b6` (redraw the shop) |
| 0x1b mafioso offer | COOL | `2fb0` (race) |
| 0x1c, 0x1d mafioso result | any | `3958` |
| 0x1e shop choice | 1 PARTS | `57ac` |
| | 2 WEAPONS | `57a2` |
| 0x1f, 0x20, 0x2a, 0x2f, 0x30 shop popups | any | `2714` (redraw the shop) |
| 0x21, 0x22 file errors | any | `[0x9b22]=5`, `39ae`. **Falls through** into the 0x23 code (`[0x9b22]=0x0b`, `39ae`): after the first `39ae` has already drawn page 5, the code runs `39ae` a second time with target 0x0b, which is a new game (static: no `JMP` after the call, see the decompile at case 0x21/0x22) |
| 0x23 file mangled | any | `[0x9b22]=0x0b`, `39ae` (new game) |
| 0x24, 0x25, 0x2b | any | `[0x9b22]=0x0c`, `39ae` (hub) |
| 0x2d show car | any | Free the 3D model (`2c46:005e`, `2c46:00fa`), `[0x2a70]=[0x2a6e]=0` → page 0x10 |
| 0x2e standings | MORE... | `38e4("CHAMP.BMP")`. If `[0x9a3e]!=0` or `[0x9b84]==0` → `1e64` (page 0x31). Else → page 0x32 (flags 4) |
| 0x31 champion | any | Player champion (`[0x9a3e]==0`): free the model → page 0x35. Rival champion: one disk → `69ca`, `03f6`, `2eb8` (game over, new game). Two disks → page 0x38 |
| 0x32, 0x37, 0x38 disk 1 | OK | Probe `DYNAMIX.BMP` with retries off. Missing → the same page again with flags 4. Present → 0x37: `1bea`. 0x32: `1e64`. 0x38: `03f6`, `[0x9b22]=0x0b`, `39ae` |
| 0x33 exit circuit | 2 YES | `[0xd24]=0`, `2eb8` (new game) |
| | other | `1798` (hub) |
| 0x34 quiz | n | `47be`. Original: `n!=[0x1fb6]` → `[0x1fb8]=1`. Patched (`1000:28fb` `EB 06`): never set. Then `2eb8` |
| 0x35 champ | OK | `69ca`, `03f6`. One disk → `397c` (hi-score, harder circuit). Two disks → `[0x9b22]=99`, page 0x0d. Then `69d8` |

### In-race modal dispatcher `1000:2c9c(screen, choice)` (from `1000:68dc`)

`1000:68dc` is a copy of the event loop. It returns when `2c9c` returns 1. While the pit menu is open (`[0x1fae]`), every activation first runs `7a9c(i)` for i=9..1, ten times (rivals keep driving). On page 0x28 any non-0xc event calls `24c4` (pump fuel).

| Screen | Action | Returns |
|---|---|---|
| 0x17 / 0x18 | `65ea(c,1)` / `6626(c,1)` (shop inside the pit, exit goes back to `23e2`) | 0 |
| 0x1a | `57b6` | 0 |
| 0x1f, 0x20, 0x29, 0x2a, 0x2f, 0x30 | `2714` | 0 |
| 0x26 exit? | choice 1 → `[0x924c]=-1` (quit race). `[0x9b8c]=-1`, `2524:43cc` | 1 |
| 0x27 pit menu | `47be`. Action `DS:9b62[c]`: 0 → `1c5e` gas pump (page 0x28), 1 → `57a2` weapons, 2 → `57ac` parts, 3 → leave (`1692`, `2524:426c(-1)`, `0708`, trax.mus) and fall into 0x0e | 0 / 1 |
| 0x0e paused | `2524:43cc`, `[0x9b8c]=-1` | 1 |
| 0x28, 0x2c | `23e2` (back to the pit menu) | 0 |
| 0x36 out of gas | `2524:1e8a(0)`, `[0x924c]=1` | 1 |

## 4. Persistent player and career state

Driver index k: 0 = player, 1..9 = SLY, MEGA(DEATH), (KILLER) ANGEL, LURKER, (PREYING) MENACE, CRIMSON (DEATH), (MOTOR)MANIAC, WRECKER, MELISSA.

- Name tables: `DS:17a2[k]` display names, where `[0]` = `DS:1792` (the player's name). `DS:17b6[k]` file bases (`<NAME>.BMP`/`.TBL`). `DS:17d4[k]` car names.
- Arrays of 10 are indexed by k.

| Offset | Width | Meaning | Writers / readers (static) |
|---|---|---|---|
| `a22a[10]` | u32 | Cash per driver. New game: all 10000 (`2eb8` fills from `a24e`/`a250` by backward MOVSW). Cheat: player 5,000,000 | `2eb8`, `34b0` prizes, `318c` bounty, `5c7c`/`632e`; read `1798`, `1e64`, `574c`, `25bc` |
| `1792` | char[14+1] | Player name ("NEW KID" default) | page 0x15, `2766`:0x15 |
| `9b0c` | s16 | Car model 0..2 = HELLCAT/CRUSHER/PITBULL (`CAR1..3.SCR` via `DS:18b8`, `MYCAR<n>`, `DASH<n>.SCR`) | `2766`:0x0b; `2dd0`, `2e4a`, `258c`, `1e64`, `1692` |
| `1fc8[6]` | s16 | Part levels 0..2: engine, brakes, transmission, tires, airfoil, armour | `2eb8` (0), `258c`, `5c7c` |
| `1fd4[9]` | s16 | Weapon model 0..2 per type: caltrops, lasers, guns, mines, missiles, beams, ram spikes, terminators, wheel spikes | `2eb8` (0), `258c`, `632e` |
| `96dc`, `8e5c`, `5c04`, `9a86`, `9238` [10] | s16 | Ammo: caltrops, gun rounds (×100), mines, missiles, terminators | `258c`, `632e`, race |
| `9b0e[10]`, `a8c4[10]` | s16 | In-race weapon state (unknown) | `258c`, race |
| `1c48[10]` / `9b6c[10]` | s16 | Engine max (player: level·30+90) / current (lowered by hits) | `2524:26d2`, `2524:44fc` |
| `1c5c[10]` / `9aa6[10]` | s16 | Armour max (player: level·200+200, ± difficulty in `2524:18f4`) / armour damage | `2524:2744`, `2524:44d6`; race allowed only if `9aa6[0]<1c5c[0]` |
| `aa9e`, `8eb6`, `a670`, `8dac` | s16 0..1000 | Damage to brakes, transmission, tires, airfoil (player). Race allowed only if `a670<1000` | `2524:456a`/`4528`/`4542`/`4556`; zeroed in `2eb8` |
| `96a0` | s16 | Fuel, full = 0x1000 | `24c4`, race |
| `d24` | s16 | Circuit counter: 0 single race, 1 new circuit, 2..11 = race 1..10 next/in progress, 11 = done | `39a0`, `2766`, `3958` |
| `18be[10]` | s16 | City order of the circuit (initial 2,4,6,9,0,1,3,5,7,8). Race r uses `18be[d24-2]` | `238c`, `3396` |
| `9808` | s16 | Current city 0..9 (order of `DS:1ca0` names / `DS:1cb4` file bases) | `2f88` |
| `d28` | s16 | Difficulty 0..3. +1 (max 3) after the player wins a circuit | `2766`:0x0f, `397c` |
| `8eb8` | s16 | Laps 1..99 (string at `*[0xb4e]`, default "05" at `DS:065c`) | `2766`:0x0f |
| `d26` | s16 | "Lukaszuk!" cheat | `2766`:0x15; `2eb8`, `632e` |
| `9926[10][10]` | u8 | Place+1 per driver per race (`[k*10+race]`), 0 = OUT | `34b0`; `204c`, `22fe` |
| `99be[10]` | s16 | Season points Σ(11−place)·100 | `22fe` |
| `8eda[10]` | s8 | Sorted driver order (results/standings). **Shared** with the quiz answer list | `34b0`, `22fe`, `2524:21d2` |
| `9a3e` | s16 | Season champion = `8eda[0]` (0 = player) | `204c` |
| `5c6e[10]`, `96b4[10]` | s16 | Kills this race / player kills per race | race, `34b0` |
| `9a84`, `8a4a`, `901a`, `9636` | s16 | Mafioso contract: target driver, bounty 2000+1000·(rand&3), fulfilled flag, race RNG word (offer if odd) | `2ff4`, `318c`, `9e90` |
| `1b30[10]`, `1b58[10]` | u32, ptr | Hi-score cash and name pointers (names at `DS:1504+15i`) | `5136`, `25bc`, `51bc` |

Prize table `DS:0d2e[10]` (s16): 13000, 9500, 7000, 4500, 3000, 2000, 1000, 500, 250, 0. Place labels `DS:0d42[]` "1ST".."10TH". Rivals are paid by place even when OUT. The player is paid only when not wrecked (`34b0`).

### Files

- **`HI_SCORE`** (190 bytes): 10 × {name[15], u32 cash}.
  - Read by `5136` (open mode 0x8000, read-only binary).
  - Written by `51bc` (0x8301) when `25bc` inserts the player after a circuit win.
  - Also used as the disk-2 presence probe (`39ae`).
- **`*.RCT` circuit save** (`525a` load / `52ec` save, both through `5368`; 428 bytes; filename + ".RCT" from `2524:3b96`):
  - 0: "RAC:". Load checks bytes 0 and 3 only.
  - 4: 10 × 36-byte records (k=0..9): `96dc,8e5c,9b0e,a8c4,9238,9a86,5c04` (w), `a22a` (dw), `1c5c,9aa6` (w), 10 bytes of `9926` (race k column), `9b6c,1c48` (w).
  - 364: `1fc8[6]`, `1fd4[9]`.
  - 394: `d24, 8eb8, 9b0c, 115e, 1160, d28, a670, 8dac, 8eb6, aa9e`.
  - 414: name `1792` (14 bytes).
  - Not saved: `18be` (city order), fuel, `1fb6`/`1fb8`, `d26`.
  - Error pages 0x21–0x25.

### Shops (segment `2524` and `1000:57xx–66xx`)

Entry points:

- From the main menu: `2f72` → page 0x1e.
- From the hub: `57ac` (parts) and `57a2` (weapons). These set the mode `[0x1e6a]` (0 parts / 1 weapons), load `PARTS.BMP`/`WEAPONS.BMP` into `[0x9bc2]` (`5804`), and draw page 0x17 (flags 0x180) or 0x18 (flags 0x380) with the grid (`583a`, cells `5a88`/`5df6`).

Selection:

- Clicking a grid cell sets `[0x115e]` (part 0..17 = type·3+level) or `[0x1160]` (weapon 0..26), see `3fe4`.
- The weapons page offset is `[0x1e6c]` (0..8, initial 2).

Buying:

- `5c7c` (parts) and `632e` (weapons).
- Repair price = price·damage%/100 (`598c` → `[0xa9a2]`).
- Trade-in of the old weapon model is credited.

Data tables (DS, s16):

- Part prices `1dda[18]`, weapon prices `1dfe[27]`, max load `1e34[27]` (9999 = unlimited).
- Pit-stop buyable `1daa[9]`.
- Names: `1dbc`, `1dce`, `1bc6`, `1bd2`, `1b6c`, `1b90`.

Descriptions:

- `6090` (page 0x1a) gets its text via `1000:a2de(idx, kind)`. That function copies from segment `33ae` using the offset tables `DS:21cc` (bios, 11 lines), `2292` (parts, 8), `23b2` (weapons, 8) and `2562` (tracks, 12).
- Offsets that pass 0xffff carry into the next segment (huge pointers).

## 5. Copy protection

`1000:2230`, reached once per session from the sign-up page while `[0x1fb6]==-1`:

1. Category `[0xaa6e]=rand()&3`.
2. Driver `d = (u16 rand) mod 9 + 1`.
   - Trap: `1000:2245` pushes `DX:AX` from `rand` as a long, but `a3ca` leaves DX alone. DX still holds 0 from the `CWD` of the constant 9 (`1000:2242`), so the high word is 0 and the mod is effectively unsigned 16-bit (`1000:e8dc`, signed long mod).
3. `1780(0x34)`.
4. `2524:21d2(d)`:
   - `8eda[0]=d`.
   - `8eda[1..4]` = four distinct values `(rand&0xf)+10` (10..25).
   - Then 100 swaps of `8eda[r1&3]` with `8eda[(r2+1)&3]` (`8eda[4]` is never moved).
   - Finally `[0x1fb6]` = 1-based position of `d` among `8eda[0..4]`.
5. Five buttons: `table[8eda[i]]` with table by category:
   - 0 → `DS:181c` "Where does this Tracker come from?" (places)
   - 1 → `DS:17e8` "favorite food?"
   - 2 → `DS:1884` "favorite weapon?" (weapon names)
   - 3 → `DS:1850` "Where is this Racers Best Track?" (cities)
   - Questions are drawn by `2524:2280` (strings `DS:0c5c–0cc5`).
6. `11c2(0xf)`, `3c0a(2,0x80)`, `1b00(1)` frame, `2524:2280` question text, `1b40(d)`: portrait `<NAME>.BMP` of driver d, `2524:203a(DS:17ca[d])`.
7. The answer is page 0x34 choice n, handled in `2766` at `1000:28f2–2906`: `47be`, `CMP [bp+6],[0x1fb6]`, then (original `JNZ`, patched `JMP`) `[0x1fb8]=1`, `2eb8`.

The answer is never shown or confirmed. A wrong answer is silent until a penalty site is reached.

`[0x1fb8]` readers (all call fatal exit `1000:0344` with "Incorrect answer for protection."):

| Site | Context | Effect when set |
|---|---|---|
| `1000:0561` | Race loop in `047c`, every 4th frame | Once the 32-bit frame counter `[0x924e]:[0x9250]` exceeds 0x74 (about 117 frames): `0344(DS:0620)` |
| `1000:5c82` | Start of `5c7c` (parts BUY, button or 'B' key) | `0344(DS:1e8b)` |
| `1000:6335` | Start of `632e` (weapons BUY, button or 'B' key) | `0344(DS:1efb)` |

The port follows `DTRACK.EXE`: `[0x1fb8]` is never set, so the three readers are inert but should still be translated.

`[0x8eda]` is shared. The quiz overwrites `8eda[0..4]` before the new game starts. The race code rebuilds it in `34b0` and `22fe`. `2524:18f4` uses the previous order for the grid unless `[0x89c8]`, so the first race after the quiz could see quiz values (inferred; the first circuit race sets `89c8=1` in `3396`).

## 6. Race entry and exit

Entry:

1. **Hub, choice 1.** Condition check, then `[0xd24]++` and `1000:3396`.
2. **`3396`.** `[0x89c8]=(d24==2)`, then `2f88(18be[d24-2])` (read as `word[0x18ba+2·d24]`).
3. **`2f88(city)`.** `[0x9a84]=0`, `[0x9808]=city`. Circuit (`d24!=0`) → `2ff4`. Single race → `2fb0`.
4. **`2ff4`** (`[0x901a]=0`). If the race word `[0x9636]` is odd (or in demo), it may show the mafioso offer, page 0x1b with `MAFIOZO1.BMP`, and return to the loop. "COOL" → `2fb0`.
5. **`2fb0`.** `32b8`. If `[0x924c]<0` (player quit): `2524:1e8a(0)` and `a678[1..9]=rand&0xfff`. Then `34b0` results.
6. **`32b8`.**
   - `[0x924e]:[0x9250]=0`.
   - `<base>.MAP` from `DS:1cb4[city]` (ORLANDO, BAY_AREA, PHOENIX, NYC, ST_LOUIS, LA, SEATTLE, HOUSTON, BOSTON, CHICAGO).
   - Stop music, `1208` (load map image per adapter).
   - `<base>.TRK` → `4fae`: header `'T'..':'`, word count → `[0x5c00]`, pairs → `9dfe[]`/`aa46[]`, triples → `5c9e/5ca0/5ca2` stride 6. Errors → pages 3/2/4.
   - Then `69d8`, `047c`, `031a`, palette `[0xa252]`.
   - Quirk: if the TRK load fails, `2fb0` still shows results with a stale `[0x924c]`.

`047c` reads `9808`, `8eb8`, `d24`, `89c8`, `d28`, `9b0c`, `1fa6`, `8f02`. Setup is `2524:18f4`. `[0x924c]` is the exit code:

- 1 = finished `8eb8` laps, or out of gas (page 0x36 → `2c9c`)
- −1 = quit (page 0x26)
- after the player is wrecked, `[0xa672]` counts down from 25 (`1000:a14c`)

`85f0` converts progress to `a678[k] = laps·segments + segment`.

Exit:

1. **`34b0` results, page 9 (`RESULTS.BMP`).**
   - Wrecked cars (`(s8)8a54[k]<=0`): `a678>>=10`.
   - `qsort(8eda,10,1,cmp 2678)` descending by u32 `a678`. MSC qsort tie order must be reproduced.
   - Places → `9926[k*10+d24-2]`, prizes `d2e[p]` → `a22a[k]`, kills.
   - Quirk: in a single race (`d24==0`) the index is −2, so it writes out of bounds (`96b0`, `9924`+…) and still pays the money.
2. **Page 9.** Mafioso target set → `318c` (`MAFIOZO2.BMP`, page 0x1d pays `8a4a` if `[0x901a]`, else page 0x1c) → `3958`.
3. **`3958`.**
   - `d24==0` → `2eb8` (single race ends in a new game: car dealer, cash reset).
   - `d24!=11` → hub `1798`.
   - `d24==11` → `d24=0`, `22fe` points, `204c` standings page 0x2e (`[0x9a3e]=8eda[0]`).
4. **Season end.**
   - "MORE..." → `CHAMP.BMP`, `1e64` page 0x31.
   - Player won: `WIN.BMP`, rotating `MYCAR<n>` model, "YOUR WINNINGS: $"; then page 0x35, then `397c`: `25bc` hi-score, `d28++` (max 3), `39a0` new circuit with the same car and cash.
   - Rival won: name and portrait, then `2eb8` (game over, new game).
5. **Car too damaged.** Page 0x2b, back to the hub via `39ae`.
6. **Bail.** Page 0x33 YES → `d24=0`, `2eb8`.

Pit stop (inside the race): page 0x27 from `23e2` (`PITSTOP.BMP`), driven by `68dc`/`2c9c`. Options are REFUEL (if fuel < 0x1000), REARM, REBUILD, OUT'A HERE.

## Screen graph

```
attract ─key─▶ [0x15 sign-up] ─GO─▶ (first time) [0x34 quiz] ─any─▶ new game
                                └──(two-disk) [0x0d disk2] ─▶ quiz | new game
new game = 2eb8 ─▶ [0x0b dealer] ─PASS─▶ 0x0b (next car) │ TAKE─▶ [0x05 main]
[0x05 main]
  1 ─▶ [0x0c hub]            2 ─▶ [0x08 tracks] ─city─▶ race ─▶ [0x09 results] ─▶ new game
  3 ─▶ file dialog(load) ─OK─▶ [0x0c hub] │ error 0x21/22 ─▶ 0x05 then new game, 0x23 ─▶ new game, 0x24/25 ─▶ hub │ cancel ─▶ 0x05
  4 ─▶ [0x1e] ─▶ [0x17 parts] ⇄ [0x18 weapons] ─exit─▶ 0x05 (or hub if d24≠0)
         popups 0x1a,0x1f,0x20,0x29,0x2a,0x2f,0x30 ─▶ back to shop
  5 ─▶ [0x07 stats] ─1─▶ [0x14 top] ─▶ 0x07
                    ─2─▶ [0x10 pros] ─n─▶ [0x11 bio] ─SHOW CAR─▶ [0x2d car] ─▶ 0x10;  bio OUT ─▶ 0x10; 0x10 OUT ─▶ 0x07
                    ─3─▶ [0x13 tracks] ─n─▶ [0x12 info] ─▶ 0x13; OUT ─▶ 0x07
                    ─4─▶ 0x05
  6 ─▶ [0x0f limits] ─▶ 0x05      7 ─▶ [0x0a sounds] ─▶ 0x05
  8 ─▶ 0x15 sign-up (or [0x37 disk1] ─▶ 0x15)
  9 ─▶ [0x16 exit] ─YES─▶ DOS │ NO─▶ 0x05
[0x0c hub]
  1 ─(damaged)─▶ [0x2b] ─▶ hub
    ─▶ (offer?) [0x1b] ─COOL─▶ race ─▶ [0x09 results] ─(contract)─▶ [0x1c|0x1d] ─▶ after
                                                    └───────────────────────────────▶ after
       after: d24<11 ─▶ hub │ d24=11 ─▶ [0x2e standings] ─▶ ([0x32 disk1]) ─▶ [0x31 champion]
              0x31: player ─▶ [0x35 CHAMP] ─▶ hi-score, d28++ ─▶ hub (new circuit)
                    rival  ─▶ ([0x38 disk1]) ─▶ new game
  2 ─▶ [0x17 parts] …         3 ─▶ file dialog(save) ─▶ hub │ error 0x24/0x25 ─▶ hub
  4 ─▶ [0x33] ─YES─▶ new game │ NO─▶ hub
race (047c, modal 68dc/2c9c): [0x0e paused], [0x26 exit?], [0x27 pit] ─▶ [0x28 gas]/[0x2c full], 0x17/0x18 shops, [0x36 out of gas]
```

## Function catalogue

Blocking = waits on input/time directly or through a callee. Handlers that only draw and return are "no". The waiting happens in the event loop.

| Addr | Proposed name | Purpose | Blocking? | Notes |
|---|---|---|---|---|
| 1000:0010 | main | Init, attract, start, event loop | yes | near; never returns |
| 1000:0344 | fatalExit(msg) | Restore cwd and hardware, print msg + credits, `exit(1)` | no | Also the normal quit and the protection penalty |
| 1000:03f6 | drawMenuBackdrop | POSTWAR.SCR, transition, pointer | no? | `2524:1528` not analysed |
| 1000:070a | buildPages | Create the 56 pages | no | ~1180 insns of straight-line calls; data-driven translation possible |
| 2524:043c | parseCmdline | | no | |
| 2524:0260 | initSystem | Keyboard, mouse, joystick, clip | no | Installs ISRs |
| 2524:009e | loadFonts | fonts.blk | no | |
| 2524:012e | loadBitmaps | bitmaps.blk | no | |
| 2524:0008 | computeSpriteAnchors | | no | |
| 2524:01da | loadTraxMusic | | no | |
| 2524:03f2 | playMusic(ptr) | Stop, then play if music on | no | |
| 2524:0382 | keepMusicLooping | Restart danger.mus when finished (`4cd4`) | no | |
| 2524:0534 | anyInput | | no (poll) | |
| 2524:0584 | playTitleTTM | | yes | TTM VM not analysed |
| 2524:0720 | creditsScroll | | yes | |
| 2524:0624 | demoScriptStep | | yes ('W') | |
| 2524:1de8 | initRowTables | | no | |
| 2524:2be8 | buildPath(name) | `DS:99ec` = `[8f0c]` + `\` + name | no | |
| 1000:67e8 | eventLoop | | yes | |
| 1000:68dc | modalLoop | In-race menu loop | yes | |
| 1000:66d2 | pollCallback | Keys, autoplay, hit test | no (polls) | Advances the RNG every poll |
| 1000:6a90 | pollInput | Input, pointer move and redraw | no (polls) | Indirect call `[0x1f20]` |
| 1000:6998 | updatePointerShape | | no | |
| 1000:69e6 | setPointerShape(bmp) | Allocate save buffers, redraw | no | `69d8`=0, `69ca`=1, `69bc`=2 |
| 1000:6cea | redrawPointer | | no | |
| 1000:3f92 | hitTest(x,y,pressed,&redraw,ascii,scan) | | no | |
| 1000:3fe4 | hitTestPage | Event code, grid selection, B/D keys | no | |
| 1000:44fc | repaintPage | Repaint changed hover/focus. Close on 0xd | no | |
| 1000:46da | closePage | | no | |
| 1000:42ce | pointInRect(x,w,y,h) | x inclusive both ends, y exclusive top | no | Note the asymmetric compare |
| 1000:439e / 4302 | editField / drawField | | no | |
| 1000:45ea | drawButton | | no | |
| 1000:3a16/3a1e/3b46/3bb6/11f2/11c2 | page builders | | no | |
| 1000:4778 / 47be | freeLines / freeButtons | | no | `de60(0xffff)` heap compaction call (inferred) |
| 1000:3ab8 | selectPage(n) | | no | |
| 1000:1780 | openPage(n) | | no | |
| 1000:3c0a | layoutAndDrawPage(frame,flags) | | no | |
| 1000:6d96/6d62/6d76 | showPage | | no | |
| 1000:38e4/390a/3930 | picture load/free/draw | | no | File I/O, retries if `[0x1fba]` |
| 1000:4d06 | drawShadowText | | no | |
| 1000:4808 / 4bd4 / 21d6 | box drawing | | no | `4808` uses rand (`1000:a3ca`) |
| 2524:3c2c | setPointer(x,y,noMouse) | | no | INT 33h via `1ff8:404b`/`4025` |
| 2524:4584 / 4612 | nextButton / prevButton | Moves the pointer onto the button, tracked in `[0x8964]` | no | |
| 2524:2c22 | saveUnderBox | | no | |
| 1000:2766 | menuDispatch(screen,choice) | | no* | *Starts races (blocking) through `3396`/`2f88` |
| 1000:39ae | continueAfterDiskCheck | | no | |
| 1000:39a0 | newCircuit | | no | |
| 1000:238c | shuffleCircuit | 100 swaps with `rand%10` | no | |
| 1000:1798 | drawRaceHub | Page 0x0c with "RACE: 1ST…" title, cash, location | no | |
| 1000:1bea | drawSignUp | | no | |
| 1000:2eb8 | newGame | Reset career, dealer page 0x0b | no | |
| 1000:2dd0 | drawCarPicture | `CAR<n>.SCR` | no | |
| 1000:2e4a | drawCarName | HELLCAT / CRUSHER / PITBULL | no | |
| 1000:2230 | protectionQuiz | | no | |
| 2524:21d2 | buildQuizAnswers(d) | | no | |
| 2524:2280 | drawQuizQuestion | | no | |
| 1000:1b00 / 1b40 | quiz frame / portrait | | no | |
| 1000:33be | driverBmpName(k) | `DS:a8d8` = `17b6[k]`+".BMP" | no | |
| 1000:1d74 | animateCarOrChamp(mode) | One frame per poll | no | 3D render `aae4` |
| 1000:1e64 | drawChampion | Page 0x31 | no | |
| 1000:204c | drawStandings | Page 0x2e | no | |
| 1000:21ba | refreshSoundsPage | | no | |
| 1000:2c9c | modalDispatch | | no | |
| 1000:23e2 | pitMenu | | no | |
| 1000:1c5e | gasPumpPage | | no | |
| 1000:24c4 | pumpFuel | +0xc per poll, page 0x2c when full | no | |
| 1000:3396, 2f88, 2ff4, 2fb0, 32b8, 1208, 4fae, 34b0, 2678, 318c, 3958, 22fe, 397c, 25bc, 51bc, 5136, 85f0, a14c | race entry/exit | See §6 | 2fb0/32b8 yes (race) | |
| 1000:2f72, 57a2, 57ac, 57b6, 583a, 5a88, 5df6, 598c, 5c7c, 632e, 65ea, 6626, 65bc, 2714, 6090, a2de, 574c | shops | See §4 | no | |
| 1000:1a66, 1cee, 1916, 3406 | stats pages | See §4 | no | `1916` calls rand 3× |
| 1000:4f28, 525a, 52ec, 5368 | file dialog, RCT load/save | | no | File dialog in `2524:328e`/`3658` |
| 2524:2396 / 23fe | markSound / setSound | `23fe` stores the inverse, then toggles both | no | Translate literally |
| 2524:258c / 26c0 | initLoadout / recalcStats | | no | |

## Data (other globals of this subsystem)

| Offset | Width | Meaning |
|---|---|---|
| `8f0c` | char[] | Game directory |
| `99ec` | char[] | Path build buffer (`2524:2be8`) |
| `a902` | char[59] | Startup cwd |
| `a8d8` | char[] | Scratch string, also shown as line 4 of the warning pages |
| `1fa6` | s16 | Autoplay active (counter) |
| `1fa8` | s16 | DEMO argument |
| `1faa` | s16 | Demo script index (0..0x4d) |
| `1f2e` | s16 | Poll counter for the script (200) |
| `8dae` | s16 | Autoplay press countdown |
| `1fba` | s16 | File-open retry enable (`1000:c1a2` loops on open failure while ≠0, counting `[0xa462]`) |
| `9b84` | s16 | Two-disk mode (SLY.BMP absent at start) |
| `9b22` | s16 | Continuation target for `39ae` (5, 0xb, 0xc, 0x34, 99) |
| `8eba` | s16 | Attract interrupted |
| `9bcc` | ptr | Page list |
| `8a48` | ptr | Current page record |
| `9018` | s16 | Current page id (`4770`) |
| `8db8` | s16 | Last built id |
| `a464` | s16 | Activated button, 1-based (`4774`) |
| `aa9c` | s16 | Pressed button |
| `8964` | ptr | Keyboard-selected button |
| `9b82` | s16 | Event code of this poll |
| `a66c` | s16 | Event code (internal) |
| `9bc6` | s16 | Repaint counter |
| `1f28` | s16 | Page state: 0 none, 1 open, −1 just closed |
| `1f2a` | s16 | File dialog mode: 0 / 1 load / 2 save |
| `9924` | s16 | File-dialog event |
| `98d6` | u16 | Page flags |
| `5c02` | s16 | Page frame arg (≠0 shrinks button hit height by 1) |
| `8984` | s16 | Page style |
| `a8a6` | s16 | Text colour selector |
| `5c82`, `8eae` | s16 | Line height 8, glyph width 8 |
| `8a96`, `8a52`, `8db0`, `a8a4` | s16/u8 | Current box x, w, y, h |
| `5a10`, `5a12` | s16 | Pointer x, y |
| `1f22`, `1f24` | s16 | Previous pointer x, y |
| `5a16`, `5a18` | s16 | Last set pointer position |
| `1fc2`, `1fc4` | s16 | Pointer limits |
| `9aee` | s16 | Button pressed this poll |
| `5a0c` | s16 | Previous pressed state |
| `aa9a` | s16 | Mouse present |
| `1fc0` | s16 | Joystick option |
| `1f1e` | s16 | Key-repeat delay |
| `963c`, `99bc` | s16 | Pointer redraw requests |
| `5a0e` | ptr | Current pointer bitmap |
| `8a4e:8a50`, `a8c0:a8c2` | far ptr | Pointer background save buffers |
| `9bf6` | ptr | Pointer bitmap set (3 shapes) |
| `1f30` | s16 | Previous event code, for the shape |
| `5a00` | s16 | Field cursor |
| `1162` | s16 | Insert mode |
| `115c` | s16 | Field focus count |
| `9658`, `8dbe` | s16 | Scancode / ASCII of this poll |
| `9bc2` | ptr | Current picture bitmaps |
| `9af0:9af2` | far ptr | Saved area under the box |
| `3850`, `3852`, `3854` | seg | Video pages |
| `3856` | seg | Blit destination |
| `3858` | seg | Blit source |
| `3840` | u8 | Text colour |
| `3843`, `3845`, `3847`, `3849` | s16 | Clip x0, x1, y0, y1 |
| `384d`, `384e` | u8 | Fill colours |
| `1fb6` | s16 | Correct quiz answer (−1 = not asked; initial data `0xffff`) |
| `1fb8` | s16 | Protection failed |
| `aa6e` | u8 | Quiz category |
| `1f20` | near fn ptr | Per-poll callback (`0x66d2`) |

Code-segment tables: `CS:2c2e` (52-entry screen jump table of `2766`) and `CS:2848` (9 entries, page 5).

## Environment touch points

- **BIOS keyboard buffer** at `0040:001a/001c/0080/0082`, read directly by `1ff8:4457` (bypasses INT 16h). Key-down table `DS:4cb4[scancode]` from the INT 9 handler.
- **INT 33h mouse** via `1ff8:3fee` (detect), `4068` (buttons), `404b` (set position), `4025` (get position).
- **Joystick** `1ff8:3fc2`, `3f62`, `3dd1`: unsupported in the port.
- **INT 10h:** `1000:a536` (mode 6, CGA only), `29f6:0044` (EGA border).
- **Files:**
  - Startup: SLY.BMP (probe), PALS.BLK, danger.mus, fonts.blk, TITLE.TTM, POSTWAR.SCR, bitmaps.blk, SHAPE, trax.mus.
  - Pages and screens: TITLE.BMP, WANTSYOU.BMP, CAR1-3.SCR, CHAMP.BMP, WIN.BMP, MYCAR*, DYNAMIX.BMP (disk-1 probe), HI_SCORE (read and write, disk-2 probe), *.RCT (read and write), <driver>.BMP/.TBL, <city>.BMP/.MAP/.TRK, RESULTS.BMP, PITSTOP.BMP, GAS.BMP (`DS:0bfc`, gas pump page), PARTS.BMP, WEAPONS.BMP, MAFIOZO1/2.BMP.
- **DOS:** getcwd/chdir (`e740`/`e70b`), open/read/write/close, `exit` (`d512`).

## Translation notes

- **Two dispatch jump tables** (`CS:2c2e`, `CS:2848`), and fall-through between cases (0x21/0x22 → 0x23, 0x09 → 0x1c, 0x10 choice 10 → 0x14, 0x27 → 0x0e in `2c9c`). Translate case by case from the disassembly. The decompile hides the patched branch at `28fb`.
- **Indirect call:** `[0x1f20]` in `6a90` (always `66d2` here).
- **Register-argument quirk** at `1000:2245` (rand as a long with DX from the earlier `CWD`).
- **The RNG advances on every poll** (`66d2`), and inside `4808` and `1916`. Exact replay requires an identical poll count, so input timing affects rand.
- **Heap:** pages are heap objects (`de60`/`de4e`). The port can model them with DS memory to keep pointer-identity comparisons (`45ea` compares string pointers against `0x2760`/`0x2768`, and `3c0a` text pointers point into DS strings that handlers rewrite in place, e.g. `280e[i][0]='*'`).
- **8-bit fields:** y and height are bytes (`+0xa`, `+0xb`), so `3c0a` arithmetic wraps at 256 (`(-h-0x38)>>1` as a byte).
- **Blocking:** only `67e8`/`68dc` poll loops, the attract functions and the races block. The handlers are plain functions, except those that start a race (`3396`→…→`047c`) and `2524:0624` 'W'.
- **`39ae` reads HI_SCORE on every return to the menu.** File I/O in the port must give the same success.
- **`1fb8` penalty sites** must be translated but stay inert (identity.md).
- **Out-of-bounds writes with `d24==0`** in `34b0` must be reproduced byte-exactly (DS memory model).

## Open questions

- **Unknown:** the TTM opcode set (`2524:0bb6` and friends) and the `2524:1528` transition effect.
- **Unknown:** `[0x3842]`, `2524:18e0`'s `5c9e..5ca2` (also the TRK triple area, per `4fae`), and `2524:1de8` tables `aa20`/`9abe`.
- **Unknown:** `1000:045a` → `c00e` purpose.
- **Unknown:** pages 0x06 and 0x19 are empty. They are reached only by defaults.
- **Inferred:** `e740`/`e70b` are getcwd/chdir (from use).
- **Inferred:** quiz values in `8eda` reaching the first grid.
- **Static, check:** the single-race out-of-bounds write hits `[0x9924]` (file-dialog event).
- **Unknown:** race-side `9636`, `a97a`, `9b0e`, `a8c4`.
- **Unknown:** the 0x22/0x23 fall-through means a "not a race file" error lands in a new game. Whether that matters visually depends on page drawing order.
