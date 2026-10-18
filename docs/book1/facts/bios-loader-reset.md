# BIOS runtime compiler boot/reset initialization facts

Read-only source extraction at repository HEAD `5b264d38a`, 2026-10-18. Existing worktree changes were present and left untouched. This packet is source evidence, not a runtime test, generated-ROM inspection, prose approval, or a universal reset/preservation contract. No repository edits, builds, or tests were performed. `docs/architecture.md` and historical PDFs were not opened.

## Finite inspected scope

- Firmware: `machine/bios/main.lua`, `compiler/{api,load,linker,arena}.lua`.
- Producer: relevant section/startup/module-generation and BSS-binding ranges in `toolchain/ts/lua/compiler.ts`; module dependency context in `toolchain/ts/lua/compiler/passes/module_contract.ts`; relevant image-builder/linker/ROM header ranges.
- Paired owners: TS/C++ Runtime, CPU reset/global registration/execution transfer/image replacement, Memory construction/ROM install/I/O clearing, frame-loop reset consumption, Machine reset-device list, cartridge controller/card ROM install and reset; relevant system-control reset request.
- No host/Studio implementation, save-state, cache-correctness, or fault audit. No complete enumeration of module initialization side effects. No claim about already-built media matching these producers.

## Bounded representation and ordering table

| Surface | Representation / producer | Ordered operation established in inspected source | Bound |
| --- | --- | --- | --- |
| Arena backing and cursor | BIOS `bss runtime_code_arena: u8[...]`, `bss runtime_code_arena_next_block: word` (`machine/bios/compiler/arena.lua:13-14`) | Section initialization zeroes the executable's BSS before module initializer calls (`toolchain/ts/lua/compiler.ts:1534-1554`, `1568-1571`) | Does not say all RAM is cleared or every kind of reset runs startup. |
| Arena initial block | Aligned guest RAM address; header is `*u32`; cursor is BSS word (`machine/bios/compiler/arena.lua:16-25`) | Arena module top-level writes free-span length into first header, then `arena_start` into cursor (`24-25`) | A successful arena module initialization, not `CPU.reset()` itself. |
| Module-initialized latch | Compiler-generated system/global slot keyed by `buildModuleInitializedSlotName(path)` (`toolchain/ts/lua/compiler.ts:1615-1628`) | Test latch; skip if true; otherwise call module; publish true only after successful return | BSS initialization does not itself reset these guest global slots. |
| Generated startup | `compiled.startupProtoIndex` becomes reset vector (`toolchain/ts/lua/compiler.ts:196-202`) | section init call -> static module initializers -> system boot primitive clearing when requested -> entry call (`1568-1584`) | CPU reset pushes this function frame; it does not synchronously execute entire startup. |
| Fresh machine RAM | TS `new Uint8Array(ramByteCount)`; C++ `m_ram(ramByteCount)` (`machine/ts/machine/memory/memory.ts:157-162`; `machine/cpp/machine/memory/memory.cpp:90-95`) | RAM backing constructed before Runtime constructor clears I/O and resets devices (`runtime.ts:129-141`; `runtime.cpp:14-24`) | Fresh construction differs from reboot of existing Memory. |
| CPU-only reset | System ROM boot header -> startup function address (`machine/ts/machine/cpu/cpu.ts:869-871`; `machine/cpp/machine/cpu/cpu.cpp:431-435`) | CPU execution state/image reset -> activate system image -> push startup frame (`cpu.ts:872-909`; `cpu.cpp:436-472`) | No call to `clearGlobalSlots` or bulk RAM clear in either reset body. Not an arena reinitialization guarantee. |
| Runtime system reboot | Existing Runtime/Memory; `rebootSystem` | reset-for-boot -> CPU reset -> install boot primitives -> mark pending entry (`runtime.ts:75-90`; `runtime.cpp:82-91`) | Clears execution environment separately before CPU reset; does not construct a new Memory. |
| Media/image replacement | ROM bytes/view or execution image, not a generated startup call | System-ROM install assigns ROM and invalidates mappings; image replacement activates/replaces image (`memory.ts:188-193`; `memory.cpp:102-110`; `cpu.ts:1169-1181`; `cpu.cpp:676-692`) | These operation bodies do not call section init or arena initializer. No claim about orchestration by uninspected callers. |
| BIOS -> cartridge startup | BIOS reads cartridge startup word, writes `cop0.exec` (`machine/bios/main.lua:58-70`, `105-113`) | CP0 transfer clears call stack/latches target image/pushes target static frame (`cpu.ts:1523-1546`; `cpu.cpp:1095-1118`) | Separate from CPU reset and Runtime reboot. Target executable's generated startup initializes that executable's sections. |

## Direct facts with source anchors

### 1. Arena header initialization belongs to module top level

1. `machine/bios/compiler/arena.lua:10-14`: module captures `__bmsx_collect_garbage`, constructs the weak-value `allocation_owners` table, and declares arena/cursor BSS.
2. `machine/bios/compiler/arena.lua:16-25`: it derives aligned start/end from the BSS address, writes `arena_end - arena_start` to `first_block`, then writes `arena_start` to the cursor. These are top-level statements before `arena.allocate` is defined (`80-102`) and before module return (`104`).
3. `machine/bios/compiler/arena.lua:27-29`: allocator free-block interpretation combines the raw allocated bit and the weak owner table. This packet does not extract broader allocator lifetime behavior; the point here is that header bytes and module-owned table/latches are distinct state.
4. `machine/bios/main.lua:1,8-9`: firmware is the entry module and imports `compiler/api`, then exposes `lua_compiler.load` as `load`.
5. Dependency source chain: `machine/bios/compiler/api.lua:1` -> `compiler/load`; `machine/bios/compiler/load.lua:1-3` -> compiler/linker/parser; `machine/bios/compiler/linker.lua:1` -> compiler/arena.

### 2. Generated section initialization precedes module bodies and BIOS entry

6. `toolchain/ts/lua/compiler.ts:609-626`: `recordBss` puts BSS declarations into a shared ordered binding map, assigns aligned offsets, and rounds accumulated BSS length to words. `715-727` exports those offsets/count; `731-735` selects the first binding for section-start addressing.
7. `toolchain/ts/lua/compiler.ts:1505-1533`: section init emits `.data` copying in words from load address to data RAM.
8. `toolchain/ts/lua/compiler.ts:1534-1554`: the same section-init function then emits a word zeroing loop for the complete program BSS span, starting from the first BSS binding minus its offset. It is generated guest `STORE_MEM`, not a host Memory reset primitive.
9. `toolchain/ts/lua/compiler.ts:1561-1584`: startup first CALLs section init, then emits static module initialization, then (system domain) clears boot-primitive system globals, then CALLs entry.
10. `toolchain/ts/lua/compiler.ts:6331-6365`: each non-const source module body is compiled with `compileChunk(module.chunk)` into its module proto and recorded by path. Const modules have no runtime proto (`6333-6337`).
11. `toolchain/ts/lua/compiler/passes/module_contract.ts:154-179`: module context constructs dependency lists using `collectLuaModuleDependencies`. `toolchain/ts/lua/compiler.ts:2375-2395` recursively marks dependencies before recording the module itself; `888-893` deduplicates and appends paths. This establishes dependency-before-dependent ordering, not a complete manually enumerated BIOS module order.
12. `toolchain/ts/lua/compiler.ts:6377-6380`: the system-domain producer marks every canonical module path; `6393-6402` builds startup from the generated section initializer and entry and passes `programDomain === 'system'` for boot-primitive clearing.
13. `toolchain/ts/lua/compiler.ts:1613-1629`: static initialization reads the initialized slot, skips true slots, CALLs the module proto (or linked initializer), then publishes true only after return. Hence header writes happen when the arena initializer is actually called, not simply because its code is present in ROM.
14. `toolchain/ts/lua/compiler.ts:5576-5588,5592-5616`: source `require` lowering marks paths; the expression subsequently loads the module export slot. It is not a runtime `require` call at the textual `main.lua:8` position. The generated startup runs initializers before entry.
15. `machine/bios/main.lua:126-143`: authored main's own `init()` and boot wait loop execute in entry; the compiler-generated section/module initialization is earlier.

### 3. Startup pointer producer -> CPU reset consumer

16. `toolchain/ts/rompack/blua32_image_builder.ts:239-255`: system image construction compiles with `programDomain: 'system'`, then links the encoded object through `linkSystemBlua32Image`.
17. `toolchain/ts/lua/compiler.ts:196-202`: object `resetProtoIndex` is `compiled.startupProtoIndex`. `toolchain/ts/rompack/blua32_linker.ts:1065-1083` resolves that proto to `startupFunctionAddress`.
18. `scripts/rompacker/rombuilder.ts:1067-1080,1123-1132`: system ROM tail construction takes that linked startup address into boot metadata. `1353-1365` places it in `blua32StartupFunctionAddress` of the ROM header structure.
19. Paired header readers: `machine/ts/machine/execution_address_space.ts:69-108` and `machine/cpp/machine/execution_address_space.cpp:49-85` return image address, execution domain, and startup/IRQ/exception addresses from the ROM header; system resolution delegates to the system domain (`execution_address_space.ts:61-66`; C++ counterpart `38-46`).
20. Paired CPU resets: `machine/ts/machine/cpu/cpu.ts:869-909`; `machine/cpp/machine/cpu/cpu.cpp:431-472`. Both resolve system boot, clear execution stack/completion/reset latches and image residency, activate/latch system image, then push its static startup frame. Neither reset body calls `clearGlobalSlots` or performs a bulk RAM clear. No claim is made that direct CPU reset alone completes, or correctly re-runs, every BIOS initializer.
21. Global registration is separate from BSS: `machine/ts/machine/cpu/cpu.ts:1009-1047,1106-1117` and `machine/cpp/machine/cpu/cpu.cpp:555-591,631-642` register names, reusing existing name slots and setting nil only for newly registered slots. This explains why a direct CPU reset is not interchangeable with Runtime's execution-environment clearing.

### 4. Fresh construction, CPU reset, and Runtime reboot are different operations

22. Paired Memory constructors allocate fresh RAM (`machine/ts/machine/memory/memory.ts:157-162`; `machine/cpp/machine/memory/memory.cpp:90-95`). Fresh Runtime constructs Memory before I/O clearing/device reset (`machine/ts/machine/runtime/runtime.ts:118-142`; `machine/cpp/machine/runtime/runtime.cpp:8-24`). This is a fresh-object path, not proof for later resets of that object.
23. `Runtime.boot`: TS `machine/ts/machine/runtime/runtime.ts:68-73`, C++ `machine/cpp/machine/runtime/runtime.cpp:76-80`: CPU reset -> boot primitive installation -> finish boot. Finish boot sets pending entry (`runtime.ts:88-90`; `runtime.cpp:82-84`). The startup frame has been scheduled; these functions do not synchronously run all its instructions.
24. `Runtime.rebootSystem`: TS `runtime.ts:75-79`, C++ `runtime.cpp:87-91`: reset-for-boot first, then the same CPU reset/primitive/finish sequence.
25. `resetForSystemBoot`: TS `runtime.ts:58-66`, C++ `runtime.cpp:100-107`: frame/pending reset -> I/O slot clear -> hardware-state reset -> `cpu.clearExecutionEnvironment()`.
26. Paired execution-environment clearing includes `clearGlobalSlots`: TS `machine/ts/machine/cpu/cpu.ts:923-927,2188-2195`; C++ `machine/cpp/machine/cpu/cpu.cpp:716-729`. Both system and cart global-name/value registries are cleared. New registration supplies nil latches before guest startup.
27. `clearIoSlots` is an I/O operation: TS `machine/ts/machine/memory/memory.ts:414-417`, C++ `machine/cpp/machine/memory/memory.cpp:302-307`; it clears I/O slots and bus-fault publication, not `ram`/`m_ram`.
28. `resetHardwareState`: TS `runtime.ts:48-55`, C++ `runtime.cpp:109-116`: stop history -> reset scheduler/devices/vblank -> refresh/service/publish GPU timing. Machine's explicit device list is TS `machine/ts/machine/machine.ts:108-120`, C++ `machine/cpp/machine/machine.cpp:51-63`; it contains no Memory bulk-clear operation. This is not an exhaustive analysis of every device reset's possible memory side effects.
29. Hardware system-reset request path: TS `machine/ts/machine/devices/system/controller.ts:139-143`; C++ `machine/cpp/machine/devices/system/controller.cpp:91-95` latch reset requested and request CPU yield. Frame-loop reset consumption calls `runtime.rebootSystem()`: TS `machine/ts/machine/runtime/frame/loop.ts:152-158`; C++ `machine/cpp/machine/runtime/frame/loop.cpp:47-52`.
30. Therefore, the inspected ordinary fresh-system-startup sequence and the inspected `rebootSystem` sequence both reach generated section initialization before module bodies. Reboot's execution-environment clear removes initialized latches, so startup can call arena's initializer anew. This is a source-order deduction from the cited statements, conditional on CPU execution progressing through startup, not an all-reset guarantee or a test result.

### 5. Media/image replacement and cartridge execution are not system reboot

31. System ROM install body: TS `machine/ts/machine/memory/memory.ts:188-193`; C++ `machine/cpp/machine/memory/memory.cpp:102-110`: replace ROM reference/view and invalidate mapped range. It does not invoke Runtime boot, section init, or arena initializer.
32. Cartridge ROM install chain: TS `machine/ts/machine/devices/cartridge/controller.ts:87-89` -> `card.ts:57-64`; C++ `machine/cpp/machine/devices/cartridge/controller.cpp:52-54` -> `card.cpp:27-35`: replace ROM bytes/view and invalidate mappings. Those bodies do not invoke BIOS startup. Cartridge controller reset is TS `controller.ts:123-129`, C++ `controller.cpp:92-98`; card reset only resets optional mailbox (TS `card.ts:107-109`, C++ `card.cpp:77-79`). Do not generalize that observation into a full cartridge-RAM lifetime contract.
33. CPU execution-image replacement is TS `machine/ts/machine/cpu/cpu.ts:1169-1181`, C++ `machine/cpp/machine/cpu/cpu.cpp:676-692`: activate and install image, update system image/exception pointer if relevant, relatch if replacing the active image. It does not itself call a startup function.
34. BIOS cartridge transfer is explicit: `machine/bios/main.lua:58-70` reads selected cartridge startup from ROM; `105-113` writes it to `cop0.exec` after the boot countdown. TS dispatch `machine/ts/machine/cpu/cpu.ts:2765`; C++ dispatch `machine/cpp/machine/cpu/cpu_dispatch.inl:414` call `executeFunctionAddress`.
35. Paired execution transfer: TS `machine/ts/machine/cpu/cpu.ts:1523-1546`, C++ `machine/cpp/machine/cpu/cpu.cpp:1095-1118`: read static function record, clear call stack, latch target execution image/status, clear execution wait/yield latches, push target function. This is not `CPU.reset` or Runtime reboot and does not itself zero all RAM.
36. Producer segregates system/cart static spans: `toolchain/ts/rompack/blua32_linker.ts:1107-1120` gives system data/BSS addresses; `1072-1074` exports cartridge static RAM base after system BSS; `1136-1149` places cart data/BSS starting there. For producer-built media, cart-generated section initialization targets cart static sections, not the BIOS arena simply by virtue of entering cartridge startup. This is layout/source evidence, not a promise for arbitrary images or every replacement sequence.

## Explicit unresolved boundary / allowed conclusion

- Established: source-level ordering for generated system startup and the paired core Runtime boot/reboot/CPU-reset paths; arena BSS zeroing is generated section-init work, while arena first-header/cursor initialization is module-body work after that zeroing and before BIOS entry.
- Established distinction: a direct CPU reset, ROM-byte replacement, execution-image replacement, BIOS cartridge `cop0.exec`, and `Runtime.rebootSystem` are different operations. They cannot be silently grouped as "reset".
- Not established: all host/tooling callers and their replacement/reboot choreography; every possible reset invocation; behavior after interrupted startup, retained module latches under direct CPU-reset-only use, or foreign/stale generated artifacts; complete device-reset memory side effects; complete cartridge/media hot-replacement lifetime.
- Do not publish an unconditional statement that runtime-compiled closures or arena contents survive reset, are invalidated by every reset, are always preserved between cartridges, or that every reset clears all RAM. The inspected ordering only supports the bounded fresh-system-startup / Runtime-system-reboot statement above.
- No actual TS/C++ disagreement in the scoped boot/reset/module-order contract was found. Different host-side data structures and heap collection calls were not treated as proof of identical broader semantics; they are outside this packet's claim.
