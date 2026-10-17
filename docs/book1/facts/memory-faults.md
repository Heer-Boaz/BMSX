# Bounded bus-fault programming-interface facts

Internal authoring input, not a public chapter, complete CPU exception contract, or publication approval. Extracted 2026-10-17. The existing `docs/book1/facts/memory-map.md` and `memory-boot.md` were read to set scope only; every accepted fact below comes from the named primary source lines. `docs/architecture.md`, reference PDFs, device implementations, instruction fetch, DMA execution and exception-handler implementations were not opened. No repository/runtime/compiler/firmware changes or tests were made.

Scope: guest u32 byte addresses; the four Memory-owned bus-fault registers, their latch and clear edges, and the already named ordinary scalar `LOAD_MEM`/`STORE_MEM` consumers. Statements about an owner's helper are not automatically statements about every guest instruction. No clock, cycle count, IRQ-delivery latency, handler vector or BIOS recovery ABI is inferred.

Source acceptance: [memory foundations review](../reviews/memory-foundations-source.md).

## Representation and mirror disposition

| Item | TypeScript representation | C++ representation | Bounded disposition / sources |
|---|---|---|---|
| CODE / ADDR / ACCESS state | Numeric fields initialized to NONE/0/0; fault capture coerces each to u32; slot storage is `Uint32Array`. | `uint32_t` fields initialized to NONE/0/0; slot storage is vector of u32. | Both retain raw 32-bit register words. `machine/ts/machine/memory/memory.ts:139,152-155,811-819`; `machine/cpp/machine/memory/memory.h:125,128-131`; `machine/cpp/machine/memory/memory.cpp:707-715`. |
| Fault sequence | Numeric field initialized 0; increment `(sequence+1) >>> 0`; internal accessor. | `uint32_t` initialized 0; increment `+=1u`; internal accessor. | Same modulo-2^32 increment. It is not one of the four mapped registers. `machine/ts/machine/memory/memory.ts:155,285-287,811-812`; `machine/cpp/machine/memory/memory.h:63,131`; `machine/cpp/machine/memory/memory.cpp:707-708`. |
| Register address production | `IO_BASE + index*IO_WORD_SIZE`, using index dependency constants. | Same expression, u32 address constants. | All four numerical addresses and dependency counts below agree. `machine/ts/spec/bmsx/io.ts:99-105,209-212`; `machine/cpp/spec/bmsx/io.h:111-118,222-225`. |
| Ordinary scalar consumers | Address reduced to u32, alignment check, selected mapped accessor, sequence comparison. | u32 address, same alignment masks, selected mapped accessor, sequence comparison. | Same control-flow edges claimed below; numeric-value conversion, compiler selection, vector/D-form opcodes and exception-handler behavior are not equivalence claims here. `machine/ts/machine/cpu/cpu.ts:3080-3153`; `machine/cpp/machine/cpu/cpu_dispatch.inl:621-669`. |

No spec/owner or paired-owner disagreement was found in these bounded claims. This is not a whole-machine parity assertion.

## Address calculation, not a guessed register map

| ID | Fact | Primary source lines |
|---|---|---|
| BF01 | I/O words occupy four bytes; `IO_BASE = RAM_BASE = 0x08000000`. All register addresses below are byte addresses. | `machine/ts/spec/bmsx/memory_map.ts:6,23,32`; `machine/cpp/spec/bmsx/memory_map.h:12,29,38`. |
| BF02 | Evaluated dependency chain: IRQ base index 0 and size 3; DMA0 base index 3 and register count 6; GEO base index 9 and size 16; input base index 25 and size 47; APU base index 72 and size 57; payload write-pointer index 129; payload-buffer base index 130 and capacity 16384 words. This chain gives bus-fault CODE index `130+16384 = 16514 = 0x4082`, then ADDR/ACCESS/ACK indices 16515/16516/16517. Only these index/count dependencies were used; unrelated device semantics are not derived from them. | `machine/ts/spec/bmsx/io.ts:3-12,20,37,39-58,88-105`; `machine/cpp/spec/bmsx/io.h:15-24,32,49,51-70,100-118`. |
| BF03 | CODE = `0x08010208`, ADDR = `0x0801020c`, ACCESS = `0x08010210`, ACK = `0x08010214`, each `0x08000000 + index*4`. | `machine/ts/spec/bmsx/io.ts:102-105,209-212`, with BF01-BF02 dependencies; `machine/cpp/spec/bmsx/io.h:115-118,222-225`, with the same dependencies. |

## Register table: mapped aligned word/U32 interface

Access labels below concern the named mapped CPU word/U32 accessors. They do not grant byte or halfword writes. “Construction/clear value” is the value after constructing this Memory owner or calling its clear methods; complete machine reset ordering is not established here.

| ID | Byte address | Name | Access and retained bits | Construction/clear value | Primary source lines |
|---|---|---|---|---|---|
| BF04 | `0x08010208` | `IO_SYS_BUS_FAULT_CODE` | Read-only word: first pending numerical code. An aligned mapped word/U32 write raises READ_ONLY before writing this slot. Codes are enumerated below; no bitmask decomposition is specified. | `0x00000000` (NONE) | Address `machine/ts/spec/bmsx/io.ts:102,209`; state/clear/read/classification/write `machine/ts/machine/memory/memory.ts:152,366-369,419-423,544-552,627-632,857-859`; mirror `machine/cpp/spec/bmsx/io.h:115,222`; `machine/cpp/machine/memory/memory.h:128`; `machine/cpp/machine/memory/memory.cpp:245-251,309-313,434-442,522-527,734-736`. |
| BF05 | `0x0801020c` | `IO_SYS_BUS_FAULT_ADDR` | Read-only word: byte address supplied by the first pending fault producer. Rejected aligned mapped word/U32 writes raise READ_ONLY. | `0x00000000` | Address `machine/ts/spec/bmsx/io.ts:103,210`; state/clear/capture/classification/write `machine/ts/machine/memory/memory.ts:153,419-423,627-632,817,857-859`; mirror `machine/cpp/spec/bmsx/io.h:116,223`; `machine/cpp/machine/memory/memory.h:129`; `machine/cpp/machine/memory/memory.cpp:309-313,522-527,713,734-736`. Read path as BF04. |
| BF06 | `0x08010210` | `IO_SYS_BUS_FAULT_ACCESS` | Read-only word: access flags supplied by the first pending fault producer. Rejected aligned mapped word/U32 writes raise READ_ONLY. | `0x00000000` | Address `machine/ts/spec/bmsx/io.ts:104,211`; state/clear/capture/classification/write `machine/ts/machine/memory/memory.ts:154,419-423,627-632,818,857-859`; mirror `machine/cpp/spec/bmsx/io.h:117,224`; `machine/cpp/machine/memory/memory.h:130`; `machine/cpp/machine/memory/memory.cpp:309-313,522-527,714,734-736`. Read path as BF04. |
| BF07 | `0x08010214` | `IO_SYS_BUS_FAULT_ACK` | Read-zero/write-command word. A zero word write does not clear pending fields. **Any nonzero word**, not merely bit 0, invokes clear. ACK is set back to zero by that clear; zero writes also retain zero. | `0x00000000` | Address `machine/ts/spec/bmsx/io.ts:105,212`; ACK binding `machine/ts/machine/memory/memory.ts:175-177`; slot write and clear `371-375,419-423,822-833`; absent ACK in read-only classifier `852-895`; mirror `machine/cpp/spec/bmsx/io.h:118,225`; `machine/cpp/machine/memory/memory.cpp:98-99,253-259,309-313,695-723,729-772`. Read path as BF04. |

## Code and ACCESS word values

| ID | CODE name | Word value | Primary source lines |
|---|---|---:|---|
| BF08 | `BUS_FAULT_NONE` | `0x00000000` | `machine/ts/spec/bmsx/io.ts:399`; `machine/cpp/spec/bmsx/io.h:412`. |
| BF09 | `BUS_FAULT_UNMAPPED` | `0x00000001` | `machine/ts/spec/bmsx/io.ts:400`; `machine/cpp/spec/bmsx/io.h:413`. |
| BF10 | `BUS_FAULT_UNALIGNED_IO` | `0x00000002` | `machine/ts/spec/bmsx/io.ts:401`; `machine/cpp/spec/bmsx/io.h:414`. |
| BF11 | `BUS_FAULT_READ_ONLY` | `0x00000003` | `machine/ts/spec/bmsx/io.ts:402`; `machine/cpp/spec/bmsx/io.h:415`. |

ACCESS constants are flags, not the same enumeration as `MemoryAccessKind`. Bits not named here have no meaning established by this extract; do not add a reserved-bit access policy.

| ID | ACCESS flag | Bit | Mask | Primary source lines |
|---|---|---:|---:|---|
| BF12 | `BUS_FAULT_ACCESS_READ` | 0 | `0x00000001` | `machine/ts/spec/bmsx/io.ts:403`; `machine/cpp/spec/bmsx/io.h:416`. |
| BF13 | `BUS_FAULT_ACCESS_WRITE` | 1 | `0x00000002` | `machine/ts/spec/bmsx/io.ts:404`; `machine/cpp/spec/bmsx/io.h:417`. |
| BF14 | `BUS_FAULT_ACCESS_U8` | 8 | `0x00000100` | `machine/ts/spec/bmsx/io.ts:405`; `machine/cpp/spec/bmsx/io.h:418`. |
| BF15 | `BUS_FAULT_ACCESS_U16` | 9 | `0x00000200` | `machine/ts/spec/bmsx/io.ts:406`; `machine/cpp/spec/bmsx/io.h:419`. |
| BF16 | `BUS_FAULT_ACCESS_U32` | 10 | `0x00000400` | `machine/ts/spec/bmsx/io.ts:407`; `machine/cpp/spec/bmsx/io.h:420`. |
| BF17 | `BUS_FAULT_ACCESS_WORD` | 11 | `0x00000800` | `machine/ts/spec/bmsx/io.ts:408`; `machine/cpp/spec/bmsx/io.h:421`. |
| BF18 | `BUS_FAULT_ACCESS_F32` | 12 | `0x00001000` | `machine/ts/spec/bmsx/io.ts:409`; `machine/cpp/spec/bmsx/io.h:422`. |
| BF19 | `BUS_FAULT_ACCESS_F64` | 13 | `0x00002000` | `machine/ts/spec/bmsx/io.ts:410`; `machine/cpp/spec/bmsx/io.h:423`. |

| ID | Fact | Primary source lines |
|---|---|---|
| BF20 | Named Memory scalar access masks OR the direction flag with that scalar kind: reads Word/U8/U16/U32/F32/F64 = `0x801/0x101/0x201/0x401/0x1001/0x2001`; writes = `0x802/0x102/0x202/0x402/0x1002/0x2002`. Word and U32 are distinct ACCESS flags even though each uses a four-byte access. | `machine/ts/machine/memory/memory.ts:85-96`; `machine/cpp/machine/memory/memory.cpp:16-27`. |

## Latch, visibility and clear edges

| ID | Fact | Primary source lines |
|---|---|---|
| BF21 | Every call to `raiseBusFault` increments the internal sequence modulo 2^32 **before** testing pending CODE. If CODE is not NONE, that call leaves the retained CODE/ADDR/ACCESS untouched. Thus the first pending fault wins, but a later fault is still detected by a sequence consumer. | `machine/ts/machine/memory/memory.ts:811-819`; `machine/cpp/machine/memory/memory.cpp:707-715`. |
| BF22 | With no pending code, `raiseBusFault` retains the supplied code, byte address and ACCESS word, then writes all three mapped slots and ACK=0 before returning. There is no deferred frame/vblank/DMA trigger in this method. No number of cycles is specified by these lines. | `machine/ts/machine/memory/memory.ts:811-819,829-833`; `machine/cpp/machine/memory/memory.cpp:707-723`. |
| BF23 | `clearBusFault` sets CODE=NONE and ADDR=ACCESS=0 and refreshes those slots plus ACK=0. It does **not** reset or increment the internal sequence. The ACK handler calls it synchronously for any nonzero write; there is no wait edge in this handler. | `machine/ts/machine/memory/memory.ts:419-423,822-833`; `machine/cpp/machine/memory/memory.cpp:309-313,695-723`. |
| BF24 | Owner construction starts sequence at 0, initializes slot storage to zero, installs only the ACK write callback for this block, then clears the bus-fault latch. `clearIoSlots` zeros the I/O slots and calls `clearBusFault`; it does not reset the internal sequence. This proves these named owner edges, not which complete machine resets call them. | `machine/ts/machine/memory/memory.ts:152-177,414-423`; `machine/cpp/machine/memory/memory.h:128-131`; `machine/cpp/machine/memory/memory.cpp:90-100,302-313`. |
| BF25 | These registers use retained-slot reads, not read-to-clear callbacks in this constructor. Aligned mapped reads do not themselves acknowledge the fault; ACK is the write-driven clear path described above. | Initial read callback table `machine/ts/machine/memory/memory.ts:168-177`; retained read `366-369,544-552`; ACK `822-827`; mirror `machine/cpp/machine/memory/memory.cpp:95-99,245-251,434-442,695-705`. |
| BF26 | An aligned mapped word/U32 write to CODE/ADDR/ACCESS raises READ_ONLY before changing the destination slot. If no earlier fault is pending, that rejected write itself supplies the new pending fault address and the access-kind/direction word. If an earlier fault is pending, BF21 retains it. | `machine/ts/machine/memory/memory.ts:627-632,811-819,857-859`; `machine/cpp/machine/memory/memory.cpp:522-527,707-715,734-736`. |
| BF27 | No IRQ request or CPU-exception entry is performed by the latch/ACK/clear routines themselves. The ordinary CPU opcode's independent sequence comparison below is the proved trap edge. This is **not** a claim about every other possible fault producer or subscriber. | Complete local latch/clear/ACK bodies `machine/ts/machine/memory/memory.ts:419-423,811-833`; `machine/cpp/machine/memory/memory.cpp:309-313,695-723`; CPU consumer `machine/ts/machine/cpu/cpu.ts:3088-3114,3129-3152`; `machine/cpp/machine/cpu/cpu_dispatch.inl:627-642,657-668`. |

## Access dispatch: distinguish lower Memory from CPU instructions

| ID | Fact | Primary source lines |
|---|---|---|
| BF28 | Lower `readMappedU8` at an aligned I/O slot calls the complete slot read, then keeps its low eight bits. At a non-slot-aligned byte wholly within the I/O aperture it raises UNALIGNED_IO, returns zero, and does not call that slot. Lower `writeMappedU8` anywhere wholly inside the I/O aperture raises UNALIGNED_IO and does not reach a slot write, even at an aligned address. | `machine/ts/machine/memory/memory.ts:442-451,466-469`; `machine/cpp/machine/memory/memory.cpp:332-342,356-360`. |
| BF29 | Lower mapped U16 reads/writes wholly contained in the I/O aperture raise UNALIGNED_IO; reads return zero and writes do not reach a slot. Lower mapped U32 first admits an aligned slot; a nonaligned four-byte access wholly contained in the aperture raises UNALIGNED_IO. The latter lower-method behavior must not be described as an ordinary CPU unaligned U32 instruction result, because BF36's CPU alignment check runs first. | `machine/ts/machine/memory/memory.ts:503-507,549-555,603-607,628-646`; `machine/cpp/machine/memory/memory.cpp:393-397,439-445,498-502,523-540`. |
| BF30 | I/O rejection uses **whole-range containment**, not simply whether the first byte touches the aperture. TS compares `addr>=IO_BASE && addr+length<=IO_BASE+ioByteLength`; native computes the equivalent bounded range via `addressRangeWithin`. This extract adds no rule for an access crossing the aperture end. The previously extracted memory-map boundary cases remain separate. | `machine/ts/machine/memory/memory.ts:836-845`; `machine/cpp/machine/memory/memory.cpp:29-44,725-727`; `machine/cpp/machine/memory/memory.h:134-140`. |
| BF31 | Lower mapped scalar accesses that miss the owned ROM/RAM/cartridge paths raise UNMAPPED. U8/U16/U32 read misses return zero; scalar write misses perform no target write in these branches. No absent-cartridge or controller-specific fault rule is established: those paths delegate to the unopened cartridge controller. | `machine/ts/machine/memory/memory.ts:349-363,466-479,503-521,549-570,603-616,628-656`; `machine/cpp/machine/memory/memory.cpp:228-242,356-369,393-411,439-460,498-511,523-550`. |
| BF32 | Lower mapped F32 accesses use the U32 mapped path with F32 ACCESS flag; they reinterpret one word. This is not an independent device floating-point register protocol. | `machine/ts/machine/memory/memory.ts:573-576,659-662`; `machine/cpp/machine/memory/memory.cpp:463-468,553-557`. |
| BF33 | Lower mapped F64 accesses perform the low four-byte word at the starting address, then the high word at address+4, using F64 ACCESS flags for both. After a fault-sequence change on the first word, the second word is not attempted. A read returns zero after either word faults. A write does not undo a successful low-word write if the high-word write faults. A second-word fault supplies that second address to the latch; BF21 still decides whether an earlier pending fault owns the fields. No transaction/atomic-eight-byte guarantee is present. | `machine/ts/machine/memory/memory.ts:578-589,664-672`; `machine/cpp/machine/memory/memory.cpp:470-484,559-567`, with latch `707-715` / TS `811-819`. |
| BF34 | Raw/main-memory `readU8`/`readU32`/`writeU8`/`writeU32` do not perform mapped I/O interception; the ordinary scalar handlers named below instead call the **mapped** methods. Do not infer instruction fetch from the raw helper names. | Raw `machine/ts/machine/memory/memory.ts:438-440,454-464,486-500,591-600`; `machine/cpp/machine/memory/memory.cpp:328-330,344-354,376-390,486-495`; ordinary callsites `machine/ts/machine/cpu/cpu.ts:3090-3108,3130-3148`; `machine/cpp/machine/cpu/cpu_dispatch.inl:629-635,658-664`. |

## Ordinary scalar LOAD_MEM / STORE_MEM: CPU-visible entry edge only

| ID | Fact | Primary source lines |
|---|---|---|
| BF35 | `MemoryAccessKind` IDs Word/U8/U16LE/U32LE/F32LE/F64LE are 0/1/2/3/4/5. Their respective CPU alignment masks are 3/0/1/3/3/3; the F64 mask is **3, not 7**. | `machine/ts/spec/blua32/memory_access_kind.ts:1-10`; `machine/cpp/spec/blua32/memory_access_kind.h:8-24`. |
| BF36 | Ordinary LOAD_MEM obtains a u32 byte address and checks the access-kind alignment mask **before calling mapped memory**. On failure it invokes the synchronous address-error-load entry with that byte address. STORE_MEM does the analogous address-error-store check before readiness testing or the store. This is CPU alignment, not lower Memory's MMIO-containment test. No assertion about the helper's complete saved-state/handler behavior is made. | `machine/ts/machine/cpu/cpu.ts:3080-3088,3117-3129`; `machine/cpp/machine/cpu/cpu_dispatch.inl:621-627,646-657`. |
| BF37 | After LOAD_MEM's alignment check, it samples the internal bus-fault sequence, calls the selected mapped scalar reader, then compares the sequence. If it changed, it invokes synchronous data-bus-error entry **before assigning the read value to the destination register**. The branch does not test whether CODE was already pending; therefore a later fault while an older fault remains pending still takes this edge (BF21). | `machine/ts/machine/cpu/cpu.ts:3088-3114`; `machine/cpp/machine/cpu/cpu_dispatch.inl:627-642`; sequence producer as BF21. |
| BF38 | STORE_MEM tests `mappedWriteReady(addr)` after alignment and before sampling sequence/performing a write. Not-ready calls `blockMappedWrite` and leaves that store unperformed on this pass. Otherwise it samples sequence, performs the selected mapped scalar write and enters synchronous data-bus-error if the sequence changed. This extract does not specify unblock timing or a transactional/rollback effect. | `machine/ts/machine/cpu/cpu.ts:3120-3152`; `machine/cpp/machine/cpu/cpu_dispatch.inl:647-668`; readiness owner `machine/ts/machine/memory/memory.ts:261-265`; `machine/cpp/machine/memory/memory.cpp:181-185`. |
| BF39 | Existing pending CODE alone does not force the ordinary scalar handlers to enter data-bus-error; they compare sequence **around this access**, not CODE against NONE. A successful access with no sequence change reaches the normal load assignment/store completion path even if an earlier fault remains latched. | `machine/ts/machine/cpu/cpu.ts:3088-3115,3129-3153`; `machine/cpp/machine/cpu/cpu_dispatch.inl:627-643,657-669`. |
| BF40 | The invoked exception constants encode address-error-load as `4<<2 = 0x10`, address-error-store as `5<<2 = 0x14`, and data-bus-error as `7<<2 = 0x1c`; `CPU_CAUSE_CODE_MASK = 0x7c`. The cause-code field is therefore bits 6:2 of that mask. IRQ and NMI constants are independently bit 10 and bit 16. Do not describe data-bus-error as an IRQ bit or CODE=1/2/3 as this CPU cause field. | `machine/ts/spec/blua32/cop0.ts:16-22`; `machine/cpp/spec/blua32/cop0.h:22-28`. |

## Save-state scope: Memory-owned words, not CPU handler ABI

| ID | Fact | Primary source lines |
|---|---|---|
| BF41 | Memory save state carries RAM bytes plus exactly three bus-fault fields: CODE, ADDR, ACCESS. The internal sequence and ACK are not fields in this state type/capture. Restore writes those three fields and refreshes mapped slots/ACK=0; these methods do not restore/reset the internal sequence. This is the named Memory state, not every machine save-state component. | `machine/ts/machine/memory/memory.ts:113-118,289-310`; `machine/cpp/machine/memory/memory.h:19-24`; `machine/cpp/machine/memory/memory.cpp:204-225`. |

## Explicit gaps / claims withheld

1. **Exception state and cartridge recovery ABI:** the bodies of synchronous exception/address-exception entry, saved EPC semantics, BAD_ADDRESS updates for each exception class, mode-stack effects, exception-vector dispatch, firmware handler policy, return/retry semantics, and whether/how a user-mode cartridge can acknowledge/recover have not been inspected. The invoked entry edge/constants above do not establish them.
2. **Full IRQ/fault routing and latency:** no IRQ-controller owner, CPU IRQ arbitration loop, masking/NMI timing, cycle costs, asynchronous fault routing or device-fault-to-bus-fault mapping was audited. No automatic IRQ or cycle-latency claim is supplied.
3. **Other guest access forms:** LOAD_MEM_D/STORE_MEM_D, word-vector stores, copy/fill operations, instruction fetch, instruction-page binding, function-record reads and compiler lowering/typed declaration syntax were not audited. Their width, address, trap, partial-completion and restart rules must not be generalized from ordinary LOAD_MEM/STORE_MEM. All six scalar kinds named in BF35 were inspected only for the named ordinary handlers and Memory accessors.
4. **DMA and device access:** although shared bus methods were inspected to understand the four registers, DMA execution/admission/retry/rate, non-CPU bus masters and callbacks installed by other devices are outside scope. No claim that every external producer uses the same CPU trap edge.
5. **Cartridge-specific access permissions/aliases/media:** delegated controller implementation was not opened. The fact that Memory sends a request there proves no absent-media result, bank behavior, ROM write code or persistent-RAM guarantee.
6. **Complete cold/warm/reset lifecycle:** constructor, `clearIoSlots`, `clearBusFault`, capture and restore are proved; actual supported-product memory construction, reset call ordering and which guest action triggers each are not.
7. **Reserved-bit and invalid-code policy:** the leaf names codes and ACCESS flags; no extra code-mask, write-ignore, reserved-bit storage or decoder policy is invented. ACK explicitly acts on any nonzero word.
8. **Runnable BLua fault example:** no real typed-BLua example/firmware handler or execution fixture was read or run in this extraction. No fake safe-recovery example should be generated from these facts alone.

This sheet closes the four-register address/code/flag/latch and bounded ordinary scalar trap-entry facts. It does not close the foundations publication's whole exception/recovery or memory-programming gaps.
