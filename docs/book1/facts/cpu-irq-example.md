# CP0 reads in a cartridge IRQ — frozen facts

Scope: the complete `cpu_irq_manual` example, normal IRQ return and the
distinction between CPU privilege and SYSTEM device context. No new cartridge
synchronous-fault hook, privilege-elevation service or security policy follows.
No architecture document or historical PDF was used. Paired owners agree for
these bounded claims at the `a2712c651` baseline.

| ID | Fact | Source |
|---|---|---|
| CI01 | CP0 STATUS field 12 has current IE bit 0 and current user bit 1. Cartridge EXEC entry is STATUS 3; system entry is 1. | `machine/ts/spec/blua32/cop0.ts:3-14`; `machine/cpp/spec/blua32/cop0.h:9-20`; paired CPU `cpu.ts:1523-1546`, `cpu.cpp:1095-1118`; BIOS `machine/bios/main.lua:105-113` |
| CI02 | Maskable IRQ admission requires current IE and pending flags intersecting MASK. From current user mode it selects the cartridge image's IRQ vector, before exception entry changes the mode. | `machine/ts/machine/cpu/cpu.ts:1680-1682,1718-1727`; `machine/cpp/machine/cpu/cpu.cpp:2242-2244,2280-2287` |
| CI03 | IRQ entry stores the interrupted PC in EPC, writes CAUSE 0x400 and shifts the low six STATUS bits left two. Fresh STATUS 3 becomes 0x0c, clearing current IE/user. EPC is not a fixed program constant or function-record address. | `machine/ts/machine/cpu/cpu.ts:1764-1778`; `machine/cpp/machine/cpu/cpu.cpp:2312-2333`; paired COP0 IRQ constant `cop0.ts:16`, `cop0.h:22` |
| CI04 | Reserved `cop0.status/cause/epc` reads emit MFC0. Current user-mode MFC0 raises coprocessor-unusable; current non-user mode reads the selected word. Source syntax alone grants no privilege. | `toolchain/ts/lua/compiler.ts:4768-4774,4797-4812`; TS `cpu.ts:2738-2754`; C++ `cpu_dispatch.inl:386-403` |
| CI05 | The generated IRQ vector reads complete FLAGS, calls the bound irq(flags) if nonzero, then executes RFE. Callback return is an ordinary call return; raw RFE requires the actual exception frame. Valid RFE restores low STATUS bits from the shifted mode stack and resumes at EPC. | `toolchain/ts/lua/compiler.ts:1633-1654`; TS `cpu.ts:2773-2800`; C++ `cpu_dispatch.inl:688-715` |
| CI06 | ACK is 0x08000004, MASK 0x08000008, VBlank mask 4 (bit index 2). ACK clears only written pending bits; MASK replaces delivery selection, not pending state or CPU IE. FLAGS can contain masked pending sources. Future VBlanks may become pending after this program masks delivery. | paired `spec/bmsx/io.ts:3-7,215-216,364`, `io.h:228-229,377`; TS IRQ `controller.ts:72-74,102-125`; C++ IRQ `controller.h:19`, `controller.cpp:72-93` |
| CI07 | SYSTEM STATUS at 0x08010350 reports context-phase/exit/resumable flags, not CPU user mode. Reset USER with no exit/resumable state reads zero. Ordinary CPU IRQ entry itself makes no SYSTEM context-enter operation. This example's zero is conditional on fresh entry and no external context request/competing writer. | paired `spec/bmsx/io.ts:123-124,179,420-422`, `io.h:192,433-435`; TS SYSTEM `controller.ts:93-104,115-117,139-158,351-362`; C++ `controller.cpp:55-66,73-75,91-110,293-304`; CI02/03 |
| CI08 | Synchronous cartridge memory exceptions select the latched system exception vector. That generated vector calls the BIOS exception binding, which enters the monitor. Declaring a cartridge exception function does not change this route; no universal namespace-mutation prohibition is inferred. | TS CPU `cpu.ts:870-899,1732-1739`; C++ `cpu.cpp:431-468,2290-2297`; `toolchain/ts/lua/compiler.ts:1657-1665`; `machine/bios/main.lua:54-56` |

## Exact program and observations

The 15-line `carts/cpu_irq_manual/results.lua` declares seven word fields in
BSS, size 28 bytes (word size/alignment 4 in
`toolchain/ts/lua/compiler/struct_types.ts:54`). Its SHA256 is
`9bdbbaf1da464c433187226ffc23d1c3c01f50c9b7175e702128f3883a0d5a07`.
The 40-line `cart.lua` SHA256 is
`b92ffbc9d7f8e9d102e69807e8134ce34688b4ee280e79a485c3d7383a5e2788`.
The public listings reproduce those complete files literally.

The program owns its callback/MASK and keeps the inherited running beam. It
reads CP0 only in the callback, masks delivery and ACKs VBlank, then returns
normally. Main records `resumed=1`; there are no STATUS/EPC writes or SYSTEM
context commands. Expected STATUS 0x0c, CAUSE 0x400, SYSTEM STATUS 0, one service
and main resumption follow CI01–07 under its stated fresh-entry assumptions.
FLAGS includes 4 but is not promised equal to 4. EPC varies with interruption.

Actual default-O3 validation and the maintained derived integration case pass.
A separate ordinary debug-ROM player run prints both exact diagnostics:
`IRQ CP0 STATUS=0000000C CAUSE=00000400` and
`SYSTEM CONTEXT=00000000 SERVICES=1 RESUMED=1`. These are diagnostic output, not
new framebuffer pixels. The current artifact is
`e1f27dd96f400607fa7fea15d77d1b1732106535ef5f6be1bd4bcb3fc115ea84`.
Evidence: `/tmp/bmsx-cpu-irq-final-{build,integration,ordinary}.log` and
`tests/carts/cpu_irq_manual/cpu_irq_manual_assert.lua`.

TTL 2 is 2000 ms of virtual headless host time, not wall time or hardware
latency: `scripts/bootrom/platforms/node_launch.ts:68-72`,
`node_entry.ts:83-90,161-166`, `hosts/node/headless/clock.ts:43-90`.
No native, all-input, arbitrary takeover or general recovery proof is claimed.
