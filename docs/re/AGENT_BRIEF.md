# Brief for reverse-engineering agents

Goal: a faithful browser port of Deathtrack (1989, DOS). The game logic is translated function by function into JS. Your job is analysis that makes translation safe.

## Material

- `docs/re/identity.md` covers the target build, the address mapping and the hardware boundary. `docs/porting-conventions.md` is the translation contract. Read both first.
- Ghidra export of the unpacked game (program `/DTRACK_U.EXE`, load base 0x1000, DGROUP `36fa`):
  - `.local/re/export/decomp.c`: every function, separated by `//==== <addr> <name>` lines
  - `.local/re/export/disasm.asm`: separated by `;==== <addr> <name>` lines
  - `.local/re/export/functions.tsv`
  - `.local/re/export/callgraph.json`: `{addr:{name,insns,indirect,calls[]}}`, direct calls only
- To print one function: `awk -v a="1000:047c" '/^\/\/==== /{p=($2==a)} p' .local/re/export/decomp.c`. The same pattern with `^;==== ` works on `disasm.asm`.
- Initialised DGROUP bytes: `.local/re/DTRACK_U.EXE` file offset = `0x15d0 + 0x26fa0 + dsOffset`. Code segment S, offset O: file offset `0x15d0 + (S-0x1000)*16 + O`. Values stored in the file are **pre-relocation**: segment words read 0x1000 lower than in Ghidra.
- Ghidra MCP read-only tools are allowed (`get_functions`, `read_memory`, `disassemble_function`, `force_decompile`) with `program="/DTRACK_U.EXE"`. **Never** rename, retype, create or delete anything in Ghidra, and never run scripts that modify the program. Other agents share it.
- **Do not use any DOSBox tool.** The main session owns the emulator.
- Original asset files are in `game/`. They are read-only. Never copy, commit or modify them.

## Caveats

- A gap-filling pass created about 540 functions automatically. Some may start mid-function or cover data that was disassembled as code. Treat odd decompilations (strange INT numbers, nonsense opcodes) as data, and say so.
- Ghidra prints `MOV DS,AX` as `MOV AX,DS` in this listing (likewise for ES). Jump targets print as normalised `seg:off`: `0x2000:2094` is linear `0x22094`, which is `1ff8:2114`.
- Decompiled C is not source. Check widths, signedness, register arguments, flags and indirect calls in the disassembly whenever they matter.
- The far-call thunks in `1000:c000–c34x` wrap MSC runtime functions: `c058` strlen, `c2ce` strcpy, `c298` strcat, `c2f6` strrchr, `c144` rand → `1000:a3ca`, `c132` stricmp → `e504`, `c10c` strcmp.

## Output

- Write one markdown file in `docs/re/` named in your task. Its sections:
  - **Overview**: the subsystem's purpose, entry points and data flow.
  - **Function catalogue**: `addr | proposed name | purpose | blocking? | notes`. Mark "blocking" when the function waits on time, input or retrace, directly or through a callee.
  - **Data**: DGROUP globals and structures with offsets, widths, signedness and meaning, plus any data tables in code segments.
  - **Environment touch points**: ports, interrupts, BIOS data, files.
  - **Translation notes**: traps such as register arguments, self-modifying code, jump tables, 32-bit maths, fixed point, quirks to preserve.
  - **Open questions**, with evidence levels: static, inferred or unknown.
- Be precise and terse. Cite addresses for every claim. Do not invent behaviour. Write "unknown" instead.
- Do not edit any other repository file. Do not commit.
