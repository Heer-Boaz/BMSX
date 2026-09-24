# Named global-register access

## Implementation gate

Reference implementations studied before editing: Lua's
[`lua_getglobal` / `lua_setglobal`](https://github.com/lua/lua/blob/master/lapi.c)
operate on the authoritative namespace, and its
[`lparser.c`](https://github.com/lua/lua/blob/master/lparser.c) separates lexical
binding from global access. The
[DAP evaluate contract](https://github.com/microsoft/debug-adapter-protocol/blob/main/debugAdapterProtocol.json)
distinguishes frame evaluation from global evaluation. BMSX uses registerfiles,
not Lua's global table; copying Lua's storage shape would be the wrong boundary.

| Representation | TypeScript | C++ | Change |
| --- | --- | --- | --- |
| Name | `StringId` | `StringId` | No host string conversion during access |
| Ordinary global value | `globalSlots: ValueSlots`, indexed by `globalSlotByKey` | `m_globalValues: vector<Value>`, indexed by `m_globalSlotByKey` | Sole owner, including dynamically introduced names |
| System global value | Separate `systemGlobalSlots` | Separate `m_systemGlobalValues` | Unchanged; named guest access cannot reach this bank |
| ROM global operand | Image-local ordinal decoded to register index | Same | Unchanged |
| Named guest operation | Builtin ID, tagged arguments/results | Same ID, native tagged `Value` | Two boot primitives published by BIOS base library |
| Saved globals | Name/value roots in CPU snapshot | Same | Remove duplicate table root; increment file schema version |
| Terminal namespace | Firmware-owned ordinary environment table | Same firmware | Still isolated; explicit global access is not implicit cart/frame evaluation |

Affected execution paths: `CPU.callBuiltinFunction` / `CPU::callBuiltinFunction` dispatch
two additional builtin IDs. Existing-name reads/writes do one name lookup and
copy the encoded value, with no guest allocation or materialized TS value.
First definition reserves a stable register; TS grows capacity geometrically.
`registerGlobalNames` reuses that same register on image admission. CPU
`setGlobalByKey` / `getGlobalByKey` use only the registerfile. Collection visits
registered names and values; capture/restore serializes that owner once.

Unchanged hot paths: decoded `GETGL`, `SETGL`, `GETSYS`, `SETSYS` in
`executeInstruction` (TS) / `runLoop` with `cpu_dispatch.inl` (C++), normal and
instrumented bulk loops, numeric fusion, scheduler and presentation. There is
no per-instruction namespace synchronization, terminal branch, new execution
loop, table proxy, global writeback, or source/debugger state in the CPU.

## Public firmware API

`getglobal(name)` reads the ordinary global register with that string name;
an undefined name reads as nil without registering it. `setglobal(name, value)`
writes the same register and returns no values. A missing value is nil. Names
and registers remain stable when their value becomes nil. New definitions
reserve a register at this owning boundary. Both use the normal guest invalid
argument fault for a non-string name. System registers are a different bank,
even when a name occurs in both.

Both functions are BIOS base-library exports and are available in the existing
Lua Terminal and its conversation tool. For example,
`local player = getglobal("player"); player.hp = 100` mutates the real guest
object. `setglobal("score", 100)` changes the register read by compiled cart
code. Installed global names can be inspected through the existing runtime
inspection tool. Module-local variables and selected-frame locals are not
globals; this API does not pretend to expose them. Session assignments still
belong to the Terminal environment.

Save/rewind owns the registerfile and referenced objects as normal machine
state. File schema 3 removes the duplicate global-table root; old files are not
silently migrated. Rebuild BIOS and linked carts together for the added boot
primitives. Gameplay does no named-access work unless guest code explicitly
calls these functions.

## Validation (2026-09-24)

- Ordinary Terminal UI and actual browser -> authorized server -> Codex
  app-server -> deterministic Responses fixture pass on software, WebGL2 and
  WebGPU. Lua modifies a field of the installed Nemesis world object and an
  ordinary global register; host inspection verifies the real owners. Source
  stays dirty/uninstalled, existing pause is retained, and the same manual
  Terminal observes the results. There is no extra model request or polling.
  Full assistant suite: 24 pass. This tests tool execution, not live-model
  reasoning or personal-account authentication. Screenshots were inspected.
- The physical BIOS monitor runs the same HID commands on TS and native C++
  with byte-identical output. It reads an existing cart counter, writes 40,
  invokes the cart's actual `new_game`, and reads 41. Shared table identity,
  newly defined names, nil/false, retained pre-error mutation and guest argument
  errors are covered without host injection of values or source evaluation.
- Five new O0/O3 and ownership tests cover compiled/named access coherence,
  separate banks, growth, GC roots, exact checkpoint restore and no guest heap
  allocation during repeated registered writes. Native snapshot tests also
  cover dynamically named registers. Full Lua suite: 2434 pass, one skip.
- Real Nemesis and preload-fixture state/history conformance matches TS/C++;
  native and TS host rewind and the libretro rewind ABI pass. Manual Terminal
  save/restore retains both the dynamic register and actual cart object.
- BIOS, linked test carts, browser Studio and Node tooling builds pass;
  IDE/common/browser/Node typechecks pass. Tests typechecking retains the same
  96 baseline diagnostics after normalizing line positions. Architecture audit
  reports zero issues and core parity passes. Changed-file indentation and
  `git diff --check` pass; the full indentation check still reports five
  untouched pre-existing paths.

Normal-interpreter A/B probe against `1f4e735c3` (Node 22.23.1): one million
compiled global increments per call, eight warmups and nine timed calls in each
of three fresh processes per checkout, ordered before/after/after/before/before/
after. No debugger hook was installed. Median of process medians:

| Compilation | Before | After | Emulated cycles per call, both |
| --- | ---: | ---: | ---: |
| O0 | 2419.75 ms | 2385.58 ms | 9,000,012 |
| O3 | 1635.68 ms | 1610.98 ms | 7,000,010 |

No regression observed in this probe; the small timing difference is not a
general speedup claim or a native/cart workload benchmark. Native dispatch
source is unchanged; native conformance above establishes correctness, not a
native throughput comparison.

Automatic cart-name binding, frame locals, Scenario Lab execution/debugging,
semantic builder tools and the complete fix/rerun workflow remain open.
