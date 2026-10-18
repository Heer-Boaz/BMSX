# Mutable word-load recovery — frozen facts, 2026-10-18

Scope: the separate 32-line `carts/memory_recovery_manual/cart.lua`, installed
BIOS monitor commands and one successful retained-operand retry. No general
transaction, rollback, handler replacement, arbitrary optimized-local repair,
cartridge chooser or physical timing contract is inferred. No architecture
file or historical reference PDF was opened. Owners were checked at the
docs-only `f224daa38` baseline; earlier `aa6dc037e` has the same runtime owners.

## Command and state edges

| ID | Fact | Owning source lines |
|---|---|---|
| MR01 | FRAMES lists retained physical indices, function-record addresses and PCs in hexadecimal, high index first, with depth0 in its header. LUA --FRAME parses index and inline depth independently: decimal by default, hexadecimal with 0x/0X. Use the prefix when copying its displayed index; no universal frame number follows. | `machine/bios/shell/commands.lua:260-279,525-549,597-604,670-690` |
| MR02 | Frame evaluation resolves installed source names for the selected frame/PC/depth, then reads or writes real register/upvalue locations; a static DATA/BSS/RODATA name reads as its linked address. Const targets and unavailable live names cannot be assigned. Runtime source accepts assignments to existing names, not typed colon declarations. | `machine/bios/debug/frame.lua:18-64`; `machine/bios/debug/scopes.lua:35-96`; `machine/bios/compiler/semantic.lua:168-179,267-285`; `machine/bios/compiler/parser.lua:374-406` |
| MR03 | The compiler resolves this mutable typed local directly to its local base register, retains it through dereference and emits LOAD_MEM_D with zero displacement. Diagnostic bindings retain const/address flags and final live intervals. Debug cartridge builds emit that cartridge's scope directory; debug BIOS does not supply a release cartridge's missing directory. | `toolchain/ts/lua/compiler.ts:2124-2166,5065-5075,5110-5119,5222-5232`; `toolchain/ts/rompack/blua32_diagnostic_scopes.ts:77-101`; `scripts/rompacker/compile.ts:87,140`; `machine/bios/debug/scopes.lua:49-80` |
| MR04 | Selected register writes change actual retained slots, not a detached namespace. | `machine/ts/machine/cpu/cpu.ts:3657-3664`; `machine/cpp/machine/cpu/cpu.cpp:1705-1711`; `machine/bios/debug/frame.lua:55-64` |
| MR05 | Displaced scalar read recomputes its address from the current register on every dispatch. A new mapped bus fault prevents destination commit. Synchronous exception retains parent registers; RFE retries at EPC without restoring an older parent-register copy. | `machine/ts/machine/cpu/cpu.ts:1732-1739,1764-1778,2773-2801,2992-3008,3051-3078`; `machine/cpp/machine/cpu/cpu.cpp:2290-2297,2312-2333`; `machine/cpp/machine/cpu/cpu_dispatch.inl:554-576,688-716` |
| MR06 | CONT restores saved EPC/status/selection and performs the separate context-leave path when owned; it does not advance EPC or repair the operand. Frame assignment alone does not request CONT or acknowledge the Memory report. Successful evaluation need not print a success banner. | `machine/bios/shell/monitor.lua:159-183,406-432,494-505`; `machine/bios/shell/repl.lua:33-64`; `machine/bios/shell/commands.lua:557-562`; exception-vector `toolchain/ts/lua/compiler.ts:1657-1665` |
| MR07 | FAULT CLEAR clears only the saved monitor report. Nonzero Memory ACK clears CODE/ADDR/ACCESS; an old pending record alone does not cause a later otherwise successful load to fail. | `machine/bios/shell/commands.lua:570-595`; `machine/ts/machine/memory/memory.ts:419-424,811-826`; `machine/cpp/machine/memory/memory.cpp:309-314,700-716`; new-fault-before-commit check MR05 |
| MR08 | REBOOT takes no argument and writes RESET1 to SYSTEM CONTROL, requesting a later system/BIOS restart, not continuation or ROM/source repair. Fresh startup rescans and initializes the chosen cartridge's own DATA/BSS. The unchanged single-cart example therefore encounters its bad initializer again; no universal RAM clear is implied. | `machine/bios/shell/commands.lua:9-16,563-568`; TS SYSTEM `machine/ts/machine/devices/system/controller.ts:139-158,300-303`, frame `machine/ts/machine/runtime/frame/loop.ts:81-85,120-124,152-158,220-223`; C++ SYSTEM `machine/cpp/machine/devices/system/controller.cpp:91-110,242-245`, frame `machine/cpp/machine/runtime/frame/loop.cpp:47-52,107-110,147-151,185-189`; BIOS `machine/bios/main.lua:58-74,105-114`; startup `toolchain/ts/lua/compiler.ts:1505-1584` |
| MR09 | print writes diagnostic characters/flush and keeps console history; it does not itself draw those lines into the displayed monitor. | `machine/bios/base.lua:265-276`; `machine/bios/tty/console.lua:18-53` |

## Exact program and finite observations

- The full literal 32-line source is the cartridge above; its source SHA256 is
  `80d7a47d4099955b2002d995defe5b49855b5521dbb27656668d8f5b1926ec9e`.
  Its five word fields occupy 20 bytes. DATA initializes `source_address` to
  `0x01000000` and supplies two backed words `12345678`, `9ABCDEF0`. Linked
  DATA/BSS addresses are not new fixed RAM addresses.
- Only the local `source` is repaired. Changing `source_address` after its
  value has already been loaded would not change the faulting base register.
  After retry, the program advances by sizeof(word)=4 bytes and reads the second
  word, saves CODE1, ACKs with1, reads CODE0 and records completed1.
- Existing central compiler/disassembler cross-check at O0/O3 emits
  `LOAD_MEM_D r4,r0,0,0` at source19:16 with mutable source in live register0.
  This is compiler artifact evidence, not a native cartridge execution.
- Normal debug ROM physical-keyboard runs passed at O0 and defaultO3. Current
  maintained scenario `tests/ide/memory_recovery_manual.idetest.js` passes
  10 assertions; only guest changes are BIOS-keyboard `FRAMES`, selected-frame
  `source = safe_words`, then `CONT`. Read-only observations check unchanged
  fault sequence and CODE1 before retry, then CODE0 and all diagnostic values.
- Current observed source-frame index is `00000001`, depth 0; its PC matches
  displayed fault EPC. Those observations do not promise another build's index.
  Output: `RECOVERED`; `WORDS 12345678 9ABCDEF0`;
  `FAULT 00000001 -> 00000000`.
- The unedited 320×240 figure `memory-fault-repair.png` is copied from the normal
  debug-ROM keyboard capture after assignment and before CONT. SHA256
  `dd9e5992cdba2b8d9eb0ec5ee3d03750d049668cdef422382a0acbbff12a59a5`.
  It is not the successful-retry display or a drawn diagnostic-output claim.
- A separate Chromium/Linux ordinary browser-player run followed the documented
  exact project/URL, clicked focus, used the actual host menu to choose FIT and
  entered the three commands with real keyboard events. Actual screenshots
  show FRAMES/assignment before CONT and retained terminal pixels afterward;
  browser console separately reports all three diagnostic result lines. No
  guest/runtime evaluation or model read/write was used in that browser run.

Evidence: `/tmp/bmsx-memory-{frame-repair,fault-restart}-facts-current.md`;
`/tmp/bmsx-memory-frame-artifact-check.{ts,log}`;
`/tmp/bmsx-memory-recovery-final-{build,guest}.log`;
`/tmp/bmsx-memory-recovery-browser-{console.log,menu.png,fit.png,repair.png,cont.png}`.
Scope excludes native/all-input/other-browser/fresh-installation proof, arbitrary
scope availability and cross-device recovery. Named helper API BH01 is unrelated.
