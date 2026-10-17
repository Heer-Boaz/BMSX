# GTE fact sheet

Editorial input for one hardware-manual chapter; not chapter prose. Source scope:
the mirrored IO/memory-map/numeric leaves and live GTE owners, plus the specific
mapped-memory, CPU access/alignment/store-interlock, scheduler-clock, and machine reset/service
callsites needed to establish access and timing. No architecture document,
reference PDF or external console specification was used. The adjacent GPU
packet decoder and PCRTC/VBlank owners are cited only for the explicit drawing
and display hand-offs in the complete cartridge example.

No TS/C++/spec disagreement was found in the source facts below. Absolute
addresses were independently evaluated from both mirrored constant expressions.
Names are owner identifiers or explicit functional descriptions, not imported
historical register aliases. `D[n]` / `C[n]` mean data/control register word indices.
The capture/restore observations are editorial emulator-state facts only.

## Address and representation facts

1. Machine addresses are 32-bit; RAM/IO base is `0x08000000`; IO words are **4 bytes**. GTE stores 32 data words, 32 control words, 10 PLUS words as raw unsigned 32-bit register words. TS: [TS memory_map.ts:1-7](../../../machine/ts/spec/bmsx/memory_map.ts#L1-L7), [TS memory_map.ts:23-33](../../../machine/ts/spec/bmsx/memory_map.ts#L23-L33); [TS gte.ts:18-20](../../../machine/ts/machine/devices/gx/gte.ts#L18-L20), [TS gte.ts:183-185](../../../machine/ts/machine/devices/gx/gte.ts#L183-L185). C++: [C++ memory_map.h:7-13](../../../machine/cpp/spec/bmsx/memory_map.h#L7-L13), [C++ memory_map.h:29-39](../../../machine/cpp/spec/bmsx/memory_map.h#L29-L39); [C++ gte.h:14-16](../../../machine/cpp/machine/devices/gx/gte.h#L14-L16), [C++ gte.h:143-145](../../../machine/cpp/machine/devices/gx/gte.h#L143-L145).
2. `DATA[n] = 0x08010244 + 4*n` (0..31); `CONTROL[n] = 0x080102c4 + 4*n` (0..31); COMMAND=`0x08010344`; CYCLES=`0x08010348`; `PLUS[n] = 0x08010384 + 4*n` (0..9). These are derived addresses, not literals in the owner. Exact defining IO-index chain: TS [TS io.ts:3-128](../../../machine/ts/spec/bmsx/io.ts#L3-L128) with address definitions [TS io.ts:174-181](../../../machine/ts/spec/bmsx/io.ts#L174-L181); C++ [C++ io.h:15-141](../../../machine/cpp/spec/bmsx/io.h#L15-L141) with address definitions [C++ io.h:187-194](../../../machine/cpp/spec/bmsx/io.h#L187-L194). Count and mapping loops: TS [TS gte.ts:205-222](../../../machine/ts/machine/devices/gx/gte.ts#L205-L222); C++ [C++ gte.cpp:68-85](../../../machine/cpp/machine/devices/gx/gte.cpp#L68-L85).
3. Numeric notation below: `s16lo(w)` means sign-extend bits 15:0 to signed 32-bit; `s16hi(w)` means sign-extend bits 31:16. TS [TS numeric.ts:18-26](../../../machine/ts/machine/common/numeric.ts#L18-L26); C++ [C++ numeric.h:20-28](../../../machine/cpp/machine/common/numeric.h#L20-L28). `u16lo(w)=w&0xffff`. The returned negative register word is still a raw 32-bit word (e.g. -32768 reads `0xffff8000`), not a floating-point encoding.

## IO dispatch facts (important distinctions from a simple R/W/RO/WO table)

| ID | Fact | TS anchor | C++ anchor |
|---|---|---|---|
| M1 | Every admitted aligned 32-bit mapped IO write stores the raw word into the Memory IO backing slot before invoking a write handler. A read uses its registered handler, otherwise returns that backing slot. | [TS memory.ts:366-376](../../../machine/ts/machine/memory/memory.ts#L366-L376), [TS memory.ts:627-641](../../../machine/ts/machine/memory/memory.ts#L627-L641) | [C++ memory.cpp:245-259](../../../machine/cpp/machine/memory/memory.cpp#L245-L259), [C++ memory.cpp:522-535](../../../machine/cpp/machine/memory/memory.cpp#L522-L535) |
| M2 | Normal COMMAND has a write handler but **no GTE read handler**. Therefore its read returns the last raw mapped write through M1, initially/reset zero. Its GTE handler calls `execute(value)` synchronously, sets `lastCycles`, and copies that duration into Memory's CYCLES backing slot. | [TS gte.ts:213-214](../../../machine/ts/machine/devices/gx/gte.ts#L213-L214), [TS gte.ts:244-245](../../../machine/ts/machine/devices/gx/gte.ts#L244-L245), [TS gte.ts:344-350](../../../machine/ts/machine/devices/gx/gte.ts#L344-L350) | [C++ gte.cpp:76-77](../../../machine/cpp/machine/devices/gx/gte.cpp#L76-L77), [C++ gte.cpp:107-108](../../../machine/cpp/machine/devices/gx/gte.cpp#L107-L108), [C++ gte.cpp:206-216](../../../machine/cpp/machine/devices/gx/gte.cpp#L206-L216) |
| M3 | CYCLES reads `lastCycles` through its read handler, not Memory's backing slot. There is no GTE write handler for CYCLES. | [TS gte.ts:213-214](../../../machine/ts/machine/devices/gx/gte.ts#L213-L214), [TS gte.ts:349-351](../../../machine/ts/machine/devices/gx/gte.ts#L349-L351) | [C++ gte.cpp:76-77](../../../machine/cpp/machine/devices/gx/gte.cpp#L76-L77), [C++ gte.cpp:213-217](../../../machine/cpp/machine/devices/gx/gte.cpp#L213-L217) |
| M4 | All PLUS words have read handlers. Only PLUS0..4 and PLUS8 have GTE write handlers. PLUS5..7 and PLUS9 writes do not update authoritative PLUS state. | [TS gte.ts:215-222](../../../machine/ts/machine/devices/gx/gte.ts#L215-L222), [TS gte.ts:353-369](../../../machine/ts/machine/devices/gx/gte.ts#L353-L369) | [C++ gte.cpp:78-85](../../../machine/cpp/machine/devices/gx/gte.cpp#L78-L85), [C++ gte.cpp:219-237](../../../machine/cpp/machine/devices/gx/gte.cpp#L219-L237) |
| M5 | Neither GTE CYCLES nor PLUS result/flag/cycles addresses are in Memory's read-only-address filter. Thus a mapped write there is **not a read-only bus fault**: it only updates the hidden Memory backing slot (M1), while reads continue to return owner state (M3/M4). Do not document these as faulting writes. | [TS memory.ts:627-642](../../../machine/ts/machine/memory/memory.ts#L627-L642), [TS memory.ts:852-894](../../../machine/ts/machine/memory/memory.ts#L852-L894); GTE handlers above | [C++ memory.cpp:522-536](../../../machine/cpp/machine/memory/memory.cpp#L522-L536), [C++ memory.cpp:729-771](../../../machine/cpp/machine/memory/memory.cpp#L729-L771); GTE handlers above |
| M6 | Ordinary GTE data/control reads/writes have no write-readiness handler. PLUS COMMAND alone has one. | [TS gte.ts:205-222](../../../machine/ts/machine/devices/gx/gte.ts#L205-L222) | [C++ gte.cpp:68-85](../../../machine/cpp/machine/devices/gx/gte.cpp#L68-L85) |
| M7 | The mapped 32-bit access path accepts only 4-byte-aligned IO slots. Misaligned IO access in that region reports `BUS_FAULT_UNALIGNED_IO`; mapped halfword reads/writes and byte writes in IO also report this fault. Mapped byte reads at an aligned slot are supported and return low 8 bits of the read-handler result. These are Memory-layer boundary facts, not CPU exception precedence or per-register features; B1–B7 below distinguish the CPU paths. | [TS memory.ts:442-449](../../../machine/ts/machine/memory/memory.ts#L442-L449), [TS memory.ts:466-469](../../../machine/ts/machine/memory/memory.ts#L466-L469), [TS memory.ts:503-506](../../../machine/ts/machine/memory/memory.ts#L503-L506), [TS memory.ts:549-555](../../../machine/ts/machine/memory/memory.ts#L549-L555), [TS memory.ts:603-606](../../../machine/ts/machine/memory/memory.ts#L603-L606), [TS memory.ts:628-645](../../../machine/ts/machine/memory/memory.ts#L628-L645), [TS memory.ts:840-845](../../../machine/ts/machine/memory/memory.ts#L840-L845) | [C++ memory.cpp:332-339](../../../machine/cpp/machine/memory/memory.cpp#L332-L339), [C++ memory.cpp:356-359](../../../machine/cpp/machine/memory/memory.cpp#L356-L359), [C++ memory.cpp:393-396](../../../machine/cpp/machine/memory/memory.cpp#L393-L396), [C++ memory.cpp:439-445](../../../machine/cpp/machine/memory/memory.cpp#L439-L445), [C++ memory.cpp:498-501](../../../machine/cpp/machine/memory/memory.cpp#L498-L501), [C++ memory.cpp:523-539](../../../machine/cpp/machine/memory/memory.cpp#L523-L539); [C++ memory.h:134-139](../../../machine/cpp/machine/memory/memory.h#L134-L139) |

## CPU versus mapped-memory access boundary

This supplement distinguishes CPU instruction admission from the Memory-layer
rules in M7. Additional source scope is limited to the mirrored CPU memory-access
kind/alignment and cause-code leaves, the existing memory dispatchers, and their
F32/F64/word-sequence callsites; it is not a whole-ISA or exception-handler guide.

- **B1 — CPU alignment precedes Memory/GTE.** Access-kind alignment masks are Word=3, U8=0, U16LE=1, U32LE=3, F32LE=3, F64LE=3. Thus F64 requires **four-byte**, not eight-byte, alignment. Both direct-address and displacement CPU loads/stores check this first; word-sequence stores use Word's mask. Rejection raises `CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD` (`4<<2`) or `CPU_CAUSE_CODE_ADDRESS_ERROR_STORE` (`5<<2`), sets the CPU bad-address word, and does not invoke the mapped-memory access or GTE handler for that rejected instruction. It does **not** generate Memory's `UNALIGNED_IO` fault on that path. Sources: [TS memory_access_kind.ts:1-10](../../../machine/ts/spec/blua32/memory_access_kind.ts#L1-L10); [C++ memory_access_kind.h:8-24](../../../machine/cpp/spec/blua32/memory_access_kind.h#L8-L24); [TS cop0.ts:19-22](../../../machine/ts/spec/blua32/cop0.ts#L19-L22); [C++ cop0.h:25-28](../../../machine/cpp/spec/blua32/cop0.h#L25-L28); [TS cpu.ts:1732-1739](../../../machine/ts/machine/cpu/cpu.ts#L1732-L1739), [TS cpu.ts:2998-3009](../../../machine/ts/machine/cpu/cpu.ts#L2998-L3009), [TS cpu.ts:3080-3087](../../../machine/ts/machine/cpu/cpu.ts#L3080-L3087), [TS cpu.ts:3117-3124](../../../machine/ts/machine/cpu/cpu.ts#L3117-L3124), [TS cpu.ts:3155-3162](../../../machine/ts/machine/cpu/cpu.ts#L3155-L3162); [C++ cpu.cpp:2290-2297](../../../machine/cpp/machine/cpu/cpu.cpp#L2290-L2297); [C++ cpu_dispatch.inl:554-559](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L554-L559), [C++ cpu_dispatch.inl:579-584](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L579-L584), [C++ cpu_dispatch.inl:605-610](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L605-L610), [C++ cpu_dispatch.inl:621-626](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L621-L626), [C++ cpu_dispatch.inl:646-651](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L646-L651), [C++ cpu_dispatch.inl:672-677](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L672-L677).
- **B2 — Width/offset rejection after CPU admission.** A CPU U16 access at an odd address is rejected by B1; an even-address U16 in this IO region reaches Memory and raises `UNALIGNED_IO` regardless of word-slot alignment. U8 reads at a word-aligned register call its read handler and mask to low8; U8 reads at the other three byte offsets fault. U8 writes in IO fault even at word-aligned addresses. If such a Memory call reports a new bus fault, the CPU raises `CPU_CAUSE_CODE_DATA_BUS_ERROR` (`7<<2`); a failed CPU load does not replace its destination register. Do not equate the CPU address-error and Memory bus-fault paths. Sources: [TS memory.ts:442-449](../../../machine/ts/machine/memory/memory.ts#L442-L449), [TS memory.ts:466-469](../../../machine/ts/machine/memory/memory.ts#L466-L469), [TS memory.ts:503-506](../../../machine/ts/machine/memory/memory.ts#L503-L506), [TS memory.ts:603-606](../../../machine/ts/machine/memory/memory.ts#L603-L606); [C++ memory.cpp:332-339](../../../machine/cpp/machine/memory/memory.cpp#L332-L339), [C++ memory.cpp:356-359](../../../machine/cpp/machine/memory/memory.cpp#L356-L359), [C++ memory.cpp:393-396](../../../machine/cpp/machine/memory/memory.cpp#L393-L396), [C++ memory.cpp:498-501](../../../machine/cpp/machine/memory/memory.cpp#L498-L501); [TS cpu.ts:3025-3077](../../../machine/ts/machine/cpu/cpu.ts#L3025-L3077), [TS cpu.ts:3088-3114](../../../machine/ts/machine/cpu/cpu.ts#L3088-L3114), [TS cpu.ts:3129-3152](../../../machine/ts/machine/cpu/cpu.ts#L3129-L3152); [C++ cpu_dispatch.inl:560-575](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L560-L575), [C++ cpu_dispatch.inl:589-601](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L589-L601), [C++ cpu_dispatch.inl:627-642](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L627-L642), [C++ cpu_dispatch.inl:656-668](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L656-L668); cause constants as in B1.
- **B3 — Scalar-store readiness is checked before width dispatch.** After initial alignment, a scalar CPU store calls `mappedWriteReady(startAddress)` once, then selects Word/U8/U16/U32/F32/F64 Memory access. Thus even an eventual width-invalid U8/U16 store at PLUS COMMAND can first stall while it is busy. Only the starting address is checked by this CPU scalar-store admission; it is not an F64 two-address readiness check. Ordinary GTE targets have no ready handler; only PLUS COMMAND does. Sources: [TS cpu.ts:3020-3044](../../../machine/ts/machine/cpu/cpu.ts#L3020-L3044), [TS cpu.ts:3121-3148](../../../machine/ts/machine/cpu/cpu.ts#L3121-L3148); [C++ cpu_dispatch.inl:579-598](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L579-L598), [C++ cpu_dispatch.inl:646-665](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L646-L665); [TS memory.ts:261-265](../../../machine/ts/machine/memory/memory.ts#L261-L265); [C++ memory.cpp:181-185](../../../machine/cpp/machine/memory/memory.cpp#L181-L185); [TS gte.ts:205-222](../../../machine/ts/machine/devices/gx/gte.ts#L205-L222); [C++ gte.cpp:68-85](../../../machine/cpp/machine/devices/gx/gte.cpp#L68-L85).
- **B4 — F32 is a shared-memory bit interpretation, not a floating-point GTE command.** F32 load obtains one mapped32 word and interprets its bits as float32; F32 store encodes the numeric value as float32 bits and writes one mapped32 word. Consequently a float store to a GTE register reaches the same register write transformation/command decode as any other raw word with those bits. Sources: [TS memory.ts:573-575](../../../machine/ts/machine/memory/memory.ts#L573-L575), [TS memory.ts:659-661](../../../machine/ts/machine/memory/memory.ts#L659-L661); [C++ memory.cpp:463-467](../../../machine/cpp/machine/memory/memory.cpp#L463-L467), [C++ memory.cpp:553-556](../../../machine/cpp/machine/memory/memory.cpp#L553-L556); CPU dispatch in B2/B3; GTE mapping in B3.
- **B5 — F64 performs two ordered word accesses with partial effects.** F64 load reads the low word at A, checks the bus-fault sequence, then reads the high word at A+4 and checks again; it combines the two as float64 only after both succeed. F64 store writes the low float64 word at A, stops if that reports a fault, then writes the high word at A+4. There is no undo of a first access if the second faults, and a low-word read can already invoke a device read handler (including PLUS completion synchronization). CPU scalar admission checks only A (B3); Memory's CPU mapped32-write path does not recheck the per-address ready line, whereas its DMA path does. Sources: [TS memory.ts:578-588](../../../machine/ts/machine/memory/memory.ts#L578-L588), [TS memory.ts:627-642](../../../machine/ts/machine/memory/memory.ts#L627-L642), [TS memory.ts:664-671](../../../machine/ts/machine/memory/memory.ts#L664-L671); [C++ memory.cpp:470-483](../../../machine/cpp/machine/memory/memory.cpp#L470-L483), [C++ memory.cpp:522-536](../../../machine/cpp/machine/memory/memory.cpp#L522-L536), [C++ memory.cpp:559-567](../../../machine/cpp/machine/memory/memory.cpp#L559-L567); CPU admission in B3; PLUS read synchronization [TS gte.ts:353-355](../../../machine/ts/machine/devices/gx/gte.ts#L353-L355) / [C++ gte.cpp:219-222](../../../machine/cpp/machine/devices/gx/gte.cpp#L219-L222).
- **B6 — Concrete PLUS consequences of B3/B5.** An F64 store starting at SCALAR=`0x08010394` is CPU-aligned despite not being eight-byte-aligned. Its low word updates authoritative SCALAR; its high word targets RESULT_XY=`0x08010398` and changes only that hidden Memory backing slot, not the published result; neither part is rejected for alignment/width. An F64 store starting at PLUS FLAG=`0x080103a0` checks readiness only there (no ready handler), then its high word reaches PLUS COMMAND=`0x080103a4`. If that command is still pending and not due, the command handler ignores this second-word command rather than blocking the CPU instruction; Memory has already stored that high word in its backing slot. If idle after synchronization, the handler accepts it normally. No range-wide PLUS interlock is supplied by F64. This is a structural derivation from the cited paths, not an independently executed test. Sources: address/registration constants [TS gte.ts:22-31](../../../machine/ts/machine/devices/gx/gte.ts#L22-L31), [TS gte.ts:205-222](../../../machine/ts/machine/devices/gx/gte.ts#L205-L222) / [C++ gte.h:18-27](../../../machine/cpp/machine/devices/gx/gte.h#L18-L27) and [C++ gte.cpp:68-85](../../../machine/cpp/machine/devices/gx/gte.cpp#L68-L85); raw backing dispatch [TS memory.ts:366-376](../../../machine/ts/machine/memory/memory.ts#L366-L376), [TS memory.ts:627-642](../../../machine/ts/machine/memory/memory.ts#L627-L642) / [C++ memory.cpp:245-259](../../../machine/cpp/machine/memory/memory.cpp#L245-L259), [C++ memory.cpp:522-536](../../../machine/cpp/machine/memory/memory.cpp#L522-L536); GTE write guard [TS gte.ts:358-369](../../../machine/ts/machine/devices/gx/gte.ts#L358-L369) / [C++ gte.cpp:225-237](../../../machine/cpp/machine/devices/gx/gte.cpp#L225-L237); F64 split and initial readiness as in B3/B5. The non-faulting result-word policy is M5, not a new exception to it.
- **B7 — Word-sequence stores have a different preflight.** `STORE_MEM_WORDS` and its displacement form first require Word alignment, then scan all addressed IO words for a blocked ready line before beginning sequence writes. A busy PLUS COMMAND anywhere in that range blocks the instruction before any sequence word is written (the readiness call itself can synchronize a due PLUS completion, P3). If admitted, the CPU writes words in increasing four-byte addresses and checks the bus-fault sequence after each; it stops on the first reported fault and raises a data-bus-error, without undoing prior writes. This is readiness preflight, not an all-or-nothing transaction and not F64 behavior. Sources: [TS cpu.ts:2998-3017](../../../machine/ts/machine/cpu/cpu.ts#L2998-L3017), [TS cpu.ts:3155-3169](../../../machine/ts/machine/cpu/cpu.ts#L3155-L3169), [TS cpu.ts:3533-3543](../../../machine/ts/machine/cpu/cpu.ts#L3533-L3543); [C++ cpu_dispatch.inl:605-617](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L605-L617), [C++ cpu_dispatch.inl:672-684](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L672-L684); [C++ cpu.cpp:3194-3204](../../../machine/cpp/machine/cpu/cpu.cpp#L3194-L3204); [TS memory.ts:268-282](../../../machine/ts/machine/memory/memory.ts#L268-L282); [C++ memory.cpp:188-201](../../../machine/cpp/machine/memory/memory.cpp#L188-L201); due-completion readiness [TS gte.ts:372-388](../../../machine/ts/machine/devices/gx/gte.ts#L372-L388) / [C++ gte.cpp:240-253](../../../machine/cpp/machine/devices/gx/gte.cpp#L240-L253).
- **B8 — No per-GTE user/supervisor gate in these access paths.** The cited load/store dispatch, mapped-memory IO dispatch, and GTE registration/read/write/ready handlers do not test CPU user/supervisor mode or a GTE enable/privilege bit. GTE's ready callback distinguishes DMA from CPU by bus-master bit and idle/pending state, not CPU mode. Thus do not document a GTE-specific supervisor-only or coprocessor-enable prerequisite for these mapped accesses. This is a scoped device-access conclusion, not a claim about exception-handler policy or every CPU instruction. Sources: [TS cpu.ts:2992-3170](../../../machine/ts/machine/cpu/cpu.ts#L2992-L3170); [C++ cpu_dispatch.inl:554-684](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L554-L684); [TS memory.ts:366-376](../../../machine/ts/machine/memory/memory.ts#L366-L376), [TS memory.ts:544-555](../../../machine/ts/machine/memory/memory.ts#L544-L555), [TS memory.ts:627-645](../../../machine/ts/machine/memory/memory.ts#L627-L645); [C++ memory.cpp:245-259](../../../machine/cpp/machine/memory/memory.cpp#L245-L259), [C++ memory.cpp:434-445](../../../machine/cpp/machine/memory/memory.cpp#L434-L445), [C++ memory.cpp:522-540](../../../machine/cpp/machine/memory/memory.cpp#L522-L540); [TS gte.ts:200-222](../../../machine/ts/machine/devices/gx/gte.ts#L200-L222), [TS gte.ts:328-389](../../../machine/ts/machine/devices/gx/gte.ts#L328-L389); [C++ gte.cpp:64-85](../../../machine/cpp/machine/devices/gx/gte.cpp#L64-L85), [C++ gte.cpp:186-254](../../../machine/cpp/machine/devices/gx/gte.cpp#L186-L254).

## Data register read/write transformation rules

| ID | Slots | Read | Mapped write effect in GTE | TS anchor | C++ anchor |
|---|---|---|---|---|---|
| D-S | 1,3,5,8,9,10,11 | `u32(s16lo(stored))` | Store `u32(s16lo(w))` | [TS gte.ts:433-442](../../../machine/ts/machine/devices/gx/gte.ts#L433-L442), [TS gte.ts:459-470](../../../machine/ts/machine/devices/gx/gte.ts#L459-L470) | [C++ gte.cpp:298-307](../../../machine/cpp/machine/devices/gx/gte.cpp#L298-L307), [C++ gte.cpp:324-334](../../../machine/cpp/machine/devices/gx/gte.cpp#L324-L334) |
| D-U | 7,16,17,18,19 | `stored&0xffff` | Store `w&0xffff` | [TS gte.ts:443-448](../../../machine/ts/machine/devices/gx/gte.ts#L443-L448), [TS gte.ts:471-477](../../../machine/ts/machine/devices/gx/gte.ts#L471-L477) | [C++ gte.cpp:308-313](../../../machine/cpp/machine/devices/gx/gte.cpp#L308-L313), [C++ gte.cpp:335-341](../../../machine/cpp/machine/devices/gx/gte.cpp#L335-L341) |
| D-P | 15 | DATA14 | `DATA12←DATA13; DATA13←DATA14; DATA14←w`; no DATA15 store in GTE array | [TS gte.ts:449-450](../../../machine/ts/machine/devices/gx/gte.ts#L449-L450), [TS gte.ts:478-482](../../../machine/ts/machine/devices/gx/gte.ts#L478-L482) | [C++ gte.cpp:314-315](../../../machine/cpp/machine/devices/gx/gte.cpp#L314-L315), [C++ gte.cpp:342-346](../../../machine/cpp/machine/devices/gx/gte.cpp#L342-L346) |
| D-C | 28 | Pack RGB5 from current IR1..3 (same as DATA29 read) | `IR1←(w&0x1f)<<7; IR2←(w&0x3e0)<<2; IR3←(w&0x7c00)>>3; DATA28←w&0x7fff` | [TS gte.ts:451-453](../../../machine/ts/machine/devices/gx/gte.ts#L451-L453), [TS gte.ts:483-488](../../../machine/ts/machine/devices/gx/gte.ts#L483-L488), [TS gte.ts:1143-1158](../../../machine/ts/machine/devices/gx/gte.ts#L1143-L1158) | [C++ gte.cpp:316-318](../../../machine/cpp/machine/devices/gx/gte.cpp#L316-L318), [C++ gte.cpp:347-352](../../../machine/cpp/machine/devices/gx/gte.cpp#L347-L352), [C++ gte.cpp:1016-1030](../../../machine/cpp/machine/devices/gx/gte.cpp#L1016-L1030) |
| D-CO | 29 | Pack RGB5 from current IR1..3 | Ignore GTE-state write | [TS gte.ts:451-453](../../../machine/ts/machine/devices/gx/gte.ts#L451-L453), [TS gte.ts:489-491](../../../machine/ts/machine/devices/gx/gte.ts#L489-L491), [TS gte.ts:1143-1158](../../../machine/ts/machine/devices/gx/gte.ts#L1143-L1158) | [C++ gte.cpp:316-318](../../../machine/cpp/machine/devices/gx/gte.cpp#L316-L318), [C++ gte.cpp:353-355](../../../machine/cpp/machine/devices/gx/gte.cpp#L353-L355), [C++ gte.cpp:1016-1030](../../../machine/cpp/machine/devices/gx/gte.cpp#L1016-L1030) |
| D-LS | 30 | Raw stored word | Store source word; DATA31←count leading bits equal to sign bit: CLZ(w) if bit31=0, CLZ(~w) if bit31=1 | [TS gte.ts:157-163](../../../machine/ts/machine/devices/gx/gte.ts#L157-L163), [TS gte.ts:492-497](../../../machine/ts/machine/devices/gx/gte.ts#L492-L497) | [C++ gte.cpp:55-60](../../../machine/cpp/machine/devices/gx/gte.cpp#L55-L60), [C++ gte.cpp:356-361](../../../machine/cpp/machine/devices/gx/gte.cpp#L356-L361) |
| D-LC | 31 | Raw stored count word | Ignore GTE-state write | [TS gte.ts:454-455](../../../machine/ts/machine/devices/gx/gte.ts#L454-L455), [TS gte.ts:489-491](../../../machine/ts/machine/devices/gx/gte.ts#L489-L491) | [C++ gte.cpp:319-320](../../../machine/cpp/machine/devices/gx/gte.cpp#L319-L320), [C++ gte.cpp:353-355](../../../machine/cpp/machine/devices/gx/gte.cpp#L353-L355) |
| D-R | All remaining data slots | Raw stored word | Store raw `w` | [TS gte.ts:454-455](../../../machine/ts/machine/devices/gx/gte.ts#L454-L455), [TS gte.ts:496-498](../../../machine/ts/machine/devices/gx/gte.ts#L496-L498) | [C++ gte.cpp:319-320](../../../machine/cpp/machine/devices/gx/gte.cpp#L319-L320), [C++ gte.cpp:360-362](../../../machine/cpp/machine/devices/gx/gte.cpp#L360-L362) |

- The RGB5 packed read above computes each channel as `clamp(s16lo(IRn)>>7,0,31)` and returns `R | G<<5 | B<<10`; this read does not call flag setters. TS [TS gte.ts:1143-1158](../../../machine/ts/machine/devices/gx/gte.ts#L1143-L1158); C++ [C++ gte.cpp:1016-1030](../../../machine/cpp/machine/devices/gx/gte.cpp#L1016-L1030).
- Direct writes to data MAC slots use D-R and do not update the separate hidden `mac0..3` members. They remain guest-visible register words. TS [TS gte.ts:459-498](../../../machine/ts/machine/devices/gx/gte.ts#L459-L498), [TS gte.ts:680-713](../../../machine/ts/machine/devices/gx/gte.ts#L680-L713), [TS gte.ts:1021-1029](../../../machine/ts/machine/devices/gx/gte.ts#L1021-L1029); C++ [C++ gte.cpp:324-364](../../../machine/cpp/machine/devices/gx/gte.cpp#L324-L364), [C++ gte.cpp:545-577](../../../machine/cpp/machine/devices/gx/gte.cpp#L545-L577), [C++ gte.cpp:895-903](../../../machine/cpp/machine/devices/gx/gte.cpp#L895-L903). Operation-specific use is established in the arithmetic facts below.

## Exact data register inventory

Every row's address uses address fact 2; read/write rule IDs above include exact mirrored access anchors. Component names mean owner-observed role, not an imported standard register alias. Each row resets to zero via reset fact R1 below.

| DATA index | Address | Owner-established role/name and packing | Rule | Role TS anchor | Role C++ anchor |
|---|---|---|---|---|---|
| 0 | `0x08010244` | V0.X low s16 / V0.Y high s16 | D-R | [TS gte.ts:1161-1170](../../../machine/ts/machine/devices/gx/gte.ts#L1161-L1170) | [C++ gte.cpp:1033-1043](../../../machine/cpp/machine/devices/gx/gte.cpp#L1033-L1043) |
| 1 | `0x08010248` | V0.Z low s16 | D-S | [TS gte.ts:1161-1170](../../../machine/ts/machine/devices/gx/gte.ts#L1161-L1170) | [C++ gte.cpp:1033-1043](../../../machine/cpp/machine/devices/gx/gte.cpp#L1033-L1043) |
| 2 | `0x0801024c` | V1.X low s16 / V1.Y high s16 | D-R | [TS gte.ts:1161-1170](../../../machine/ts/machine/devices/gx/gte.ts#L1161-L1170) | [C++ gte.cpp:1033-1043](../../../machine/cpp/machine/devices/gx/gte.cpp#L1033-L1043) |
| 3 | `0x08010250` | V1.Z low s16 | D-S | [TS gte.ts:1161-1170](../../../machine/ts/machine/devices/gx/gte.ts#L1161-L1170) | [C++ gte.cpp:1033-1043](../../../machine/cpp/machine/devices/gx/gte.cpp#L1033-L1043) |
| 4 | `0x08010254` | V2.X low s16 / V2.Y high s16 | D-R | [TS gte.ts:1161-1170](../../../machine/ts/machine/devices/gx/gte.ts#L1161-L1170) | [C++ gte.cpp:1033-1043](../../../machine/cpp/machine/devices/gx/gte.cpp#L1033-L1043) |
| 5 | `0x08010258` | V2.Z low s16 | D-S | [TS gte.ts:1161-1170](../../../machine/ts/machine/devices/gx/gte.ts#L1161-L1170) | [C++ gte.cpp:1033-1043](../../../machine/cpp/machine/devices/gx/gte.cpp#L1033-L1043) |
| 6 | `0x0801025c` | RGBC: R bits7:0, G15:8, B23:16, code31:24 | D-R | [TS gte.ts:1263-1284](../../../machine/ts/machine/devices/gx/gte.ts#L1263-L1284) | [C++ gte.cpp:1135-1156](../../../machine/cpp/machine/devices/gx/gte.cpp#L1135-L1156) |
| 7 | `0x08010260` | Depth-average output (AVSZ3/4) | D-U | [TS gte.ts:1009-1018](../../../machine/ts/machine/devices/gx/gte.ts#L1009-L1018) | [C++ gte.cpp:883-892](../../../machine/cpp/machine/devices/gx/gte.cpp#L883-L892) |
| 8 | `0x08010264` | IR0 | D-S | [TS gte.ts:993-994](../../../machine/ts/machine/devices/gx/gte.ts#L993-L994), [TS gte.ts:1108-1118](../../../machine/ts/machine/devices/gx/gte.ts#L1108-L1118) | [C++ gte.cpp:867-868](../../../machine/cpp/machine/devices/gx/gte.cpp#L867-L868), [C++ gte.cpp:981-991](../../../machine/cpp/machine/devices/gx/gte.cpp#L981-L991) |
| 9 | `0x08010268` | IR1 | D-S | [TS gte.ts:759-767](../../../machine/ts/machine/devices/gx/gte.ts#L759-L767) | [C++ gte.cpp:622-630](../../../machine/cpp/machine/devices/gx/gte.cpp#L622-L630) |
| 10 | `0x0801026c` | IR2 | D-S | [TS gte.ts:759-767](../../../machine/ts/machine/devices/gx/gte.ts#L759-L767) | [C++ gte.cpp:622-630](../../../machine/cpp/machine/devices/gx/gte.cpp#L622-L630) |
| 11 | `0x08010270` | IR3 | D-S | [TS gte.ts:759-767](../../../machine/ts/machine/devices/gx/gte.ts#L759-L767) | [C++ gte.cpp:622-630](../../../machine/cpp/machine/devices/gx/gte.cpp#L622-L630) |
| 12 | `0x08010274` | SX0 low s16 / SY0 high s16 | D-R | [TS gte.ts:1299-1304](../../../machine/ts/machine/devices/gx/gte.ts#L1299-L1304) | [C++ gte.cpp:1171-1176](../../../machine/cpp/machine/devices/gx/gte.cpp#L1171-L1176) |
| 13 | `0x08010278` | SX1 low s16 / SY1 high s16 | D-R | [TS gte.ts:1299-1304](../../../machine/ts/machine/devices/gx/gte.ts#L1299-L1304) | [C++ gte.cpp:1171-1176](../../../machine/cpp/machine/devices/gx/gte.cpp#L1171-L1176) |
| 14 | `0x0801027c` | SX2 low s16 / SY2 high s16 | D-R | [TS gte.ts:1299-1304](../../../machine/ts/machine/devices/gx/gte.ts#L1299-L1304) | [C++ gte.cpp:1171-1176](../../../machine/cpp/machine/devices/gx/gte.cpp#L1171-L1176) |
| 15 | `0x08010280` | Read SX2/SY2 alias; write screen FIFO push | D-P | [TS gte.ts:449-450](../../../machine/ts/machine/devices/gx/gte.ts#L449-L450), [TS gte.ts:478-481](../../../machine/ts/machine/devices/gx/gte.ts#L478-L481) | [C++ gte.cpp:314-315](../../../machine/cpp/machine/devices/gx/gte.cpp#L314-L315), [C++ gte.cpp:342-345](../../../machine/cpp/machine/devices/gx/gte.cpp#L342-L345) |
| 16 | `0x08010284` | SZ0 low u16 | D-U | [TS gte.ts:1307-1308](../../../machine/ts/machine/devices/gx/gte.ts#L1307-L1308) | [C++ gte.cpp:1179-1180](../../../machine/cpp/machine/devices/gx/gte.cpp#L1179-L1180) |
| 17 | `0x08010288` | SZ1 low u16 | D-U | [TS gte.ts:1307-1308](../../../machine/ts/machine/devices/gx/gte.ts#L1307-L1308) | [C++ gte.cpp:1179-1180](../../../machine/cpp/machine/devices/gx/gte.cpp#L1179-L1180) |
| 18 | `0x0801028c` | SZ2 low u16 | D-U | [TS gte.ts:1307-1308](../../../machine/ts/machine/devices/gx/gte.ts#L1307-L1308) | [C++ gte.cpp:1179-1180](../../../machine/cpp/machine/devices/gx/gte.cpp#L1179-L1180) |
| 19 | `0x08010290` | SZ3 low u16 | D-U | [TS gte.ts:1307-1308](../../../machine/ts/machine/devices/gx/gte.ts#L1307-L1308) | [C++ gte.cpp:1179-1180](../../../machine/cpp/machine/devices/gx/gte.cpp#L1179-L1180) |
| 20 | `0x08010294` | RGB0 FIFO: R7:0 / G15:8 / B23:16 / code31:24 | D-R | [TS gte.ts:1133-1140](../../../machine/ts/machine/devices/gx/gte.ts#L1133-L1140), [TS gte.ts:1267-1268](../../../machine/ts/machine/devices/gx/gte.ts#L1267-L1268) | [C++ gte.cpp:1006-1013](../../../machine/cpp/machine/devices/gx/gte.cpp#L1006-L1013), [C++ gte.cpp:1139-1140](../../../machine/cpp/machine/devices/gx/gte.cpp#L1139-L1140) |
| 21 | `0x08010298` | RGB1 FIFO: R7:0 / G15:8 / B23:16 / code31:24 | D-R | [TS gte.ts:1133-1140](../../../machine/ts/machine/devices/gx/gte.ts#L1133-L1140), [TS gte.ts:1267-1268](../../../machine/ts/machine/devices/gx/gte.ts#L1267-L1268) | [C++ gte.cpp:1006-1013](../../../machine/cpp/machine/devices/gx/gte.cpp#L1006-L1013), [C++ gte.cpp:1139-1140](../../../machine/cpp/machine/devices/gx/gte.cpp#L1139-L1140) |
| 22 | `0x0801029c` | RGB2 FIFO: R7:0 / G15:8 / B23:16 / code31:24 | D-R | [TS gte.ts:1133-1140](../../../machine/ts/machine/devices/gx/gte.ts#L1133-L1140), [TS gte.ts:1267-1268](../../../machine/ts/machine/devices/gx/gte.ts#L1267-L1268) | [C++ gte.cpp:1006-1013](../../../machine/cpp/machine/devices/gx/gte.cpp#L1006-L1013), [C++ gte.cpp:1139-1140](../../../machine/cpp/machine/devices/gx/gte.cpp#L1139-L1140) |
| 23 | `0x080102a0` | Raw DATA23 storage; no semantic consumer/name in scoped owner | D-R | [TS gte.ts:433-498](../../../machine/ts/machine/devices/gx/gte.ts#L433-L498) | [C++ gte.cpp:298-364](../../../machine/cpp/machine/devices/gx/gte.cpp#L298-L364) |
| 24 | `0x080102a4` | MAC0 visible word | D-R | [TS gte.ts:1021-1029](../../../machine/ts/machine/devices/gx/gte.ts#L1021-L1029) | [C++ gte.cpp:895-903](../../../machine/cpp/machine/devices/gx/gte.cpp#L895-L903) |
| 25 | `0x080102a8` | MAC1 visible word | D-R | [TS gte.ts:680-713](../../../machine/ts/machine/devices/gx/gte.ts#L680-L713) | [C++ gte.cpp:545-577](../../../machine/cpp/machine/devices/gx/gte.cpp#L545-L577) |
| 26 | `0x080102ac` | MAC2 visible word | D-R | [TS gte.ts:680-713](../../../machine/ts/machine/devices/gx/gte.ts#L680-L713) | [C++ gte.cpp:545-577](../../../machine/cpp/machine/devices/gx/gte.cpp#L545-L577) |
| 27 | `0x080102b0` | MAC3 visible word | D-R | [TS gte.ts:680-713](../../../machine/ts/machine/devices/gx/gte.ts#L680-L713) | [C++ gte.cpp:545-577](../../../machine/cpp/machine/devices/gx/gte.cpp#L545-L577) |
| 28 | `0x080102b4` | RGB5 input / derived packed output | D-C | [TS gte.ts:483-487](../../../machine/ts/machine/devices/gx/gte.ts#L483-L487), [TS gte.ts:1143-1158](../../../machine/ts/machine/devices/gx/gte.ts#L1143-L1158) | [C++ gte.cpp:347-351](../../../machine/cpp/machine/devices/gx/gte.cpp#L347-L351), [C++ gte.cpp:1016-1030](../../../machine/cpp/machine/devices/gx/gte.cpp#L1016-L1030) |
| 29 | `0x080102b8` | Derived RGB5 output alias | D-CO | [TS gte.ts:451-453](../../../machine/ts/machine/devices/gx/gte.ts#L451-L453), [TS gte.ts:1143-1158](../../../machine/ts/machine/devices/gx/gte.ts#L1143-L1158) | [C++ gte.cpp:316-318](../../../machine/cpp/machine/devices/gx/gte.cpp#L316-L318), [C++ gte.cpp:1016-1030](../../../machine/cpp/machine/devices/gx/gte.cpp#L1016-L1030) |
| 30 | `0x080102bc` | Leading-sign-bit source | D-LS | [TS gte.ts:157-163](../../../machine/ts/machine/devices/gx/gte.ts#L157-L163), [TS gte.ts:492-494](../../../machine/ts/machine/devices/gx/gte.ts#L492-L494) | [C++ gte.cpp:55-60](../../../machine/cpp/machine/devices/gx/gte.cpp#L55-L60), [C++ gte.cpp:356-358](../../../machine/cpp/machine/devices/gx/gte.cpp#L356-L358) |
| 31 | `0x080102c0` | Leading-sign-bit count | D-LC | [TS gte.ts:157-163](../../../machine/ts/machine/devices/gx/gte.ts#L157-L163), [TS gte.ts:492-494](../../../machine/ts/machine/devices/gx/gte.ts#L492-L494) | [C++ gte.cpp:55-60](../../../machine/cpp/machine/devices/gx/gte.cpp#L55-L60), [C++ gte.cpp:356-358](../../../machine/cpp/machine/devices/gx/gte.cpp#L356-L358) |

## Control register access and inventory

- All control reads return the stored 32-bit word. Writes to 4,12,20,26,27,29,30 sign-extend the low 16 bits and store that raw 32-bit pattern (rule C-S). All other control slots store raw words (C-R), except FLAG at31 (C-F). TS [TS gte.ts:501-522](../../../machine/ts/machine/devices/gx/gte.ts#L501-L522); C++ [C++ gte.cpp:366-387](../../../machine/cpp/machine/devices/gx/gte.cpp#L366-L387).
- In particular H (CONTROL26) **reads as a sign-extended word after write**, but the projection datapath obtains `stored&0xffff`, not signed H. TS [TS gte.ts:508-515](../../../machine/ts/machine/devices/gx/gte.ts#L508-L515), [TS gte.ts:1235-1236](../../../machine/ts/machine/devices/gx/gte.ts#L1235-L1236); C++ [C++ gte.cpp:372-379](../../../machine/cpp/machine/devices/gx/gte.cpp#L372-L379), [C++ gte.cpp:1107-1108](../../../machine/cpp/machine/devices/gx/gte.cpp#L1107-L1108).
- Matrices use nine signed16 coefficients in row-major order, two coefficients per full word, last coefficient in the low halfword. Matrix selector0 uses control0..4 (also `rt`); selector1 uses8..12 (`lightTransform`); selector2 uses16..20 (`colorMatrix`). Control-vector selector0 reads5..7 (`tr`), selector1 reads13..15, selector2 reads21..23 (`rfc/gfc/bfc`); each control-vector element is a signed32 word. Selector3 is synthetic, not a stored fourth matrix/vector. TS [TS gte.ts:820-825](../../../machine/ts/machine/devices/gx/gte.ts#L820-L825), [TS gte.ts:1184-1232](../../../machine/ts/machine/devices/gx/gte.ts#L1184-L1232), [TS gte.ts:1287-1296](../../../machine/ts/machine/devices/gx/gte.ts#L1287-L1296); C++ [C++ gte.cpp:683-688](../../../machine/cpp/machine/devices/gx/gte.cpp#L683-L688), [C++ gte.cpp:1056-1104](../../../machine/cpp/machine/devices/gx/gte.cpp#L1056-L1104), [C++ gte.cpp:1159-1168](../../../machine/cpp/machine/devices/gx/gte.cpp#L1159-L1168). Synthetic selector arithmetic is established in the operation facts below.
- Every row resets to zero via R1. In the table below `mxN[r,c]` uses **zero-based** indices to follow source; `/` separates low/high halfwords. `cvN[r]` means signed32 control-vector element (not an invented acronym).

| CONTROL index | Address | Owner role / packing | Write rule | Role TS anchor | Role C++ anchor |
|---|---|---|---|---|---|
| 0 | `0x080102c4` | mx0[0,0] low s16 / mx0[0,1] high s16 (rt) | C-R | [TS gte.ts:1196-1206](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1206) | [C++ gte.cpp:1068-1078](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1078) |
| 1 | `0x080102c8` | mx0[0,2] low s16 / mx0[1,0] high s16 (rt) | C-R | [TS gte.ts:1196-1206](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1206) | [C++ gte.cpp:1068-1078](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1078) |
| 2 | `0x080102cc` | mx0[1,1] low s16 / mx0[1,2] high s16 (rt) | C-R | [TS gte.ts:1196-1206](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1206) | [C++ gte.cpp:1068-1078](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1078) |
| 3 | `0x080102d0` | mx0[2,0] low s16 / mx0[2,1] high s16 (rt) | C-R | [TS gte.ts:1196-1206](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1206) | [C++ gte.cpp:1068-1078](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1078) |
| 4 | `0x080102d4` | mx0[2,2] low s16 (rt) | C-S | [TS gte.ts:1196-1206](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1206) | [C++ gte.cpp:1068-1078](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1078) |
| 5 | `0x080102d8` | cv0[0] signed32 (tr) | C-R | [TS gte.ts:1210-1214](../../../machine/ts/machine/devices/gx/gte.ts#L1210-L1214) | [C++ gte.cpp:1082-1086](../../../machine/cpp/machine/devices/gx/gte.cpp#L1082-L1086) |
| 6 | `0x080102dc` | cv0[1] signed32 (tr) | C-R | [TS gte.ts:1210-1214](../../../machine/ts/machine/devices/gx/gte.ts#L1210-L1214) | [C++ gte.cpp:1082-1086](../../../machine/cpp/machine/devices/gx/gte.cpp#L1082-L1086) |
| 7 | `0x080102e0` | cv0[2] signed32 (tr) | C-R | [TS gte.ts:1210-1214](../../../machine/ts/machine/devices/gx/gte.ts#L1210-L1214) | [C++ gte.cpp:1082-1086](../../../machine/cpp/machine/devices/gx/gte.cpp#L1082-L1086) |
| 8 | `0x080102e4` | mx1[0,0] low s16 / mx1[0,1] high s16 (light matrix) | C-R | [TS gte.ts:1196-1206](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1206) | [C++ gte.cpp:1068-1078](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1078) |
| 9 | `0x080102e8` | mx1[0,2] low s16 / mx1[1,0] high s16 (light matrix) | C-R | [TS gte.ts:1196-1206](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1206) | [C++ gte.cpp:1068-1078](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1078) |
| 10 | `0x080102ec` | mx1[1,1] low s16 / mx1[1,2] high s16 (light matrix) | C-R | [TS gte.ts:1196-1206](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1206) | [C++ gte.cpp:1068-1078](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1078) |
| 11 | `0x080102f0` | mx1[2,0] low s16 / mx1[2,1] high s16 (light matrix) | C-R | [TS gte.ts:1196-1206](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1206) | [C++ gte.cpp:1068-1078](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1078) |
| 12 | `0x080102f4` | mx1[2,2] low s16 (light matrix) | C-S | [TS gte.ts:1196-1206](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1206) | [C++ gte.cpp:1068-1078](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1078) |
| 13 | `0x080102f8` | cv1[0] signed32 | C-R | [TS gte.ts:1210-1214](../../../machine/ts/machine/devices/gx/gte.ts#L1210-L1214) | [C++ gte.cpp:1082-1086](../../../machine/cpp/machine/devices/gx/gte.cpp#L1082-L1086) |
| 14 | `0x080102fc` | cv1[1] signed32 | C-R | [TS gte.ts:1210-1214](../../../machine/ts/machine/devices/gx/gte.ts#L1210-L1214) | [C++ gte.cpp:1082-1086](../../../machine/cpp/machine/devices/gx/gte.cpp#L1082-L1086) |
| 15 | `0x08010300` | cv1[2] signed32 | C-R | [TS gte.ts:1210-1214](../../../machine/ts/machine/devices/gx/gte.ts#L1210-L1214) | [C++ gte.cpp:1082-1086](../../../machine/cpp/machine/devices/gx/gte.cpp#L1082-L1086) |
| 16 | `0x08010304` | mx2[0,0] low s16 / mx2[0,1] high s16 (color matrix) | C-R | [TS gte.ts:1196-1206](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1206) | [C++ gte.cpp:1068-1078](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1078) |
| 17 | `0x08010308` | mx2[0,2] low s16 / mx2[1,0] high s16 (color matrix) | C-R | [TS gte.ts:1196-1206](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1206) | [C++ gte.cpp:1068-1078](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1078) |
| 18 | `0x0801030c` | mx2[1,1] low s16 / mx2[1,2] high s16 (color matrix) | C-R | [TS gte.ts:1196-1206](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1206) | [C++ gte.cpp:1068-1078](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1078) |
| 19 | `0x08010310` | mx2[2,0] low s16 / mx2[2,1] high s16 (color matrix) | C-R | [TS gte.ts:1196-1206](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1206) | [C++ gte.cpp:1068-1078](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1078) |
| 20 | `0x08010314` | mx2[2,2] low s16 (color matrix) | C-S | [TS gte.ts:1196-1206](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1206) | [C++ gte.cpp:1068-1078](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1078) |
| 21 | `0x08010318` | cv2[0] signed32 (rfc) | C-R | [TS gte.ts:1287-1296](../../../machine/ts/machine/devices/gx/gte.ts#L1287-L1296) | [C++ gte.cpp:1159-1168](../../../machine/cpp/machine/devices/gx/gte.cpp#L1159-L1168) |
| 22 | `0x0801031c` | cv2[1] signed32 (gfc) | C-R | [TS gte.ts:1287-1296](../../../machine/ts/machine/devices/gx/gte.ts#L1287-L1296) | [C++ gte.cpp:1159-1168](../../../machine/cpp/machine/devices/gx/gte.cpp#L1159-L1168) |
| 23 | `0x08010320` | cv2[2] signed32 (bfc) | C-R | [TS gte.ts:1287-1296](../../../machine/ts/machine/devices/gx/gte.ts#L1287-L1296) | [C++ gte.cpp:1159-1168](../../../machine/cpp/machine/devices/gx/gte.cpp#L1159-L1168) |
| 24 | `0x08010324` | ofx signed32 | C-R | [TS gte.ts:1247-1248](../../../machine/ts/machine/devices/gx/gte.ts#L1247-L1248) | [C++ gte.cpp:1119-1120](../../../machine/cpp/machine/devices/gx/gte.cpp#L1119-L1120) |
| 25 | `0x08010328` | ofy signed32 | C-R | [TS gte.ts:1251-1252](../../../machine/ts/machine/devices/gx/gte.ts#L1251-L1252) | [C++ gte.cpp:1123-1124](../../../machine/cpp/machine/devices/gx/gte.cpp#L1123-L1124) |
| 26 | `0x0801032c` | h low u16 datapath | C-S | [TS gte.ts:1235-1236](../../../machine/ts/machine/devices/gx/gte.ts#L1235-L1236) | [C++ gte.cpp:1107-1108](../../../machine/cpp/machine/devices/gx/gte.cpp#L1107-L1108) |
| 27 | `0x08010330` | dqa low s16 datapath | C-S | [TS gte.ts:1239-1240](../../../machine/ts/machine/devices/gx/gte.ts#L1239-L1240) | [C++ gte.cpp:1111-1112](../../../machine/cpp/machine/devices/gx/gte.cpp#L1111-L1112) |
| 28 | `0x08010334` | dqb signed32 | C-R | [TS gte.ts:1243-1244](../../../machine/ts/machine/devices/gx/gte.ts#L1243-L1244) | [C++ gte.cpp:1115-1116](../../../machine/cpp/machine/devices/gx/gte.cpp#L1115-L1116) |
| 29 | `0x08010338` | zsf3 low s16 datapath | C-S | [TS gte.ts:1255-1256](../../../machine/ts/machine/devices/gx/gte.ts#L1255-L1256) | [C++ gte.cpp:1127-1128](../../../machine/cpp/machine/devices/gx/gte.cpp#L1127-L1128) |
| 30 | `0x0801033c` | zsf4 low s16 datapath | C-S | [TS gte.ts:1259-1260](../../../machine/ts/machine/devices/gx/gte.ts#L1259-L1260) | [C++ gte.cpp:1131-1132](../../../machine/cpp/machine/devices/gx/gte.cpp#L1131-L1132) |
| 31 | `0x08010340` | FLAG | C-F | [TS gte.ts:517-518](../../../machine/ts/machine/devices/gx/gte.ts#L517-L518), [TS gte.ts:652-665](../../../machine/ts/machine/devices/gx/gte.ts#L652-L665) | [C++ gte.cpp:381-382](../../../machine/cpp/machine/devices/gx/gte.cpp#L381-L382), [C++ gte.cpp:517-530](../../../machine/cpp/machine/devices/gx/gte.cpp#L517-L530) |

## FLAG register

- FLAG is CONTROL31, `0x08010340`. Write rule C-F: keep only `w & 0x7ffff000`, then set bit31 if any retained bits in `0x7f87e000` are set. Thus direct bit31 writes and bits11:0 do not survive; ERROR is recomputed from its mask. Reading FLAG is an ordinary stored control-word read. TS [TS gte.ts:93-114](../../../machine/ts/machine/devices/gx/gte.ts#L93-L114), [TS gte.ts:501-518](../../../machine/ts/machine/devices/gx/gte.ts#L501-L518), [TS gte.ts:656-665](../../../machine/ts/machine/devices/gx/gte.ts#L656-L665); C++ [C++ gte.h:89-110](../../../machine/cpp/machine/devices/gx/gte.h#L89-L110); [C++ gte.cpp:366-382](../../../machine/cpp/machine/devices/gx/gte.cpp#L366-L382), [C++ gte.cpp:521-530](../../../machine/cpp/machine/devices/gx/gte.cpp#L521-L530).
- Bit identifiers below are source constants; their arithmetic trigger conditions are established in the arithmetic facts below. All values match TS/C++.

| Bit | Mask | Owner constant suffix | TS anchor | C++ anchor |
|---|---|---|---|---|
| 31 | `0x80000000` | `GX_GTE_FLAG_ERROR` | [TS gte.ts:93](../../../machine/ts/machine/devices/gx/gte.ts#L93) | [C++ gte.h:89](../../../machine/cpp/machine/devices/gx/gte.h#L89) |
| 30 | `0x40000000` | `GX_GTE_FLAG_MAC1_POS` | [TS gte.ts:94](../../../machine/ts/machine/devices/gx/gte.ts#L94) | [C++ gte.h:90](../../../machine/cpp/machine/devices/gx/gte.h#L90) |
| 29 | `0x20000000` | `GX_GTE_FLAG_MAC2_POS` | [TS gte.ts:95](../../../machine/ts/machine/devices/gx/gte.ts#L95) | [C++ gte.h:91](../../../machine/cpp/machine/devices/gx/gte.h#L91) |
| 28 | `0x10000000` | `GX_GTE_FLAG_MAC3_POS` | [TS gte.ts:96](../../../machine/ts/machine/devices/gx/gte.ts#L96) | [C++ gte.h:92](../../../machine/cpp/machine/devices/gx/gte.h#L92) |
| 27 | `0x08000000` | `GX_GTE_FLAG_MAC1_NEG` | [TS gte.ts:97](../../../machine/ts/machine/devices/gx/gte.ts#L97) | [C++ gte.h:93](../../../machine/cpp/machine/devices/gx/gte.h#L93) |
| 26 | `0x04000000` | `GX_GTE_FLAG_MAC2_NEG` | [TS gte.ts:98](../../../machine/ts/machine/devices/gx/gte.ts#L98) | [C++ gte.h:94](../../../machine/cpp/machine/devices/gx/gte.h#L94) |
| 25 | `0x02000000` | `GX_GTE_FLAG_MAC3_NEG` | [TS gte.ts:99](../../../machine/ts/machine/devices/gx/gte.ts#L99) | [C++ gte.h:95](../../../machine/cpp/machine/devices/gx/gte.h#L95) |
| 24 | `0x01000000` | `GX_GTE_FLAG_IR1_SAT` | [TS gte.ts:100](../../../machine/ts/machine/devices/gx/gte.ts#L100) | [C++ gte.h:96](../../../machine/cpp/machine/devices/gx/gte.h#L96) |
| 23 | `0x00800000` | `GX_GTE_FLAG_IR2_SAT` | [TS gte.ts:101](../../../machine/ts/machine/devices/gx/gte.ts#L101) | [C++ gte.h:97](../../../machine/cpp/machine/devices/gx/gte.h#L97) |
| 22 | `0x00400000` | `GX_GTE_FLAG_IR3_SAT` | [TS gte.ts:102](../../../machine/ts/machine/devices/gx/gte.ts#L102) | [C++ gte.h:98](../../../machine/cpp/machine/devices/gx/gte.h#L98) |
| 21 | `0x00200000` | `GX_GTE_FLAG_COLOR_R_SAT` | [TS gte.ts:103](../../../machine/ts/machine/devices/gx/gte.ts#L103) | [C++ gte.h:99](../../../machine/cpp/machine/devices/gx/gte.h#L99) |
| 20 | `0x00100000` | `GX_GTE_FLAG_COLOR_G_SAT` | [TS gte.ts:104](../../../machine/ts/machine/devices/gx/gte.ts#L104) | [C++ gte.h:100](../../../machine/cpp/machine/devices/gx/gte.h#L100) |
| 19 | `0x00080000` | `GX_GTE_FLAG_COLOR_B_SAT` | [TS gte.ts:105](../../../machine/ts/machine/devices/gx/gte.ts#L105) | [C++ gte.h:101](../../../machine/cpp/machine/devices/gx/gte.h#L101) |
| 18 | `0x00040000` | `GX_GTE_FLAG_SZ_OTZ_SAT` | [TS gte.ts:106](../../../machine/ts/machine/devices/gx/gte.ts#L106) | [C++ gte.h:102](../../../machine/cpp/machine/devices/gx/gte.h#L102) |
| 17 | `0x00020000` | `GX_GTE_FLAG_DIV_OVERFLOW` | [TS gte.ts:107](../../../machine/ts/machine/devices/gx/gte.ts#L107) | [C++ gte.h:103](../../../machine/cpp/machine/devices/gx/gte.h#L103) |
| 16 | `0x00010000` | `GX_GTE_FLAG_MAC0_POS` | [TS gte.ts:108](../../../machine/ts/machine/devices/gx/gte.ts#L108) | [C++ gte.h:104](../../../machine/cpp/machine/devices/gx/gte.h#L104) |
| 15 | `0x00008000` | `GX_GTE_FLAG_MAC0_NEG` | [TS gte.ts:109](../../../machine/ts/machine/devices/gx/gte.ts#L109) | [C++ gte.h:105](../../../machine/cpp/machine/devices/gx/gte.h#L105) |
| 14 | `0x00004000` | `GX_GTE_FLAG_SX2_SAT` | [TS gte.ts:110](../../../machine/ts/machine/devices/gx/gte.ts#L110) | [C++ gte.h:106](../../../machine/cpp/machine/devices/gx/gte.h#L106) |
| 13 | `0x00002000` | `GX_GTE_FLAG_SY2_SAT` | [TS gte.ts:111](../../../machine/ts/machine/devices/gx/gte.ts#L111) | [C++ gte.h:107](../../../machine/cpp/machine/devices/gx/gte.h#L107) |
| 12 | `0x00001000` | `GX_GTE_FLAG_IR0_SAT` | [TS gte.ts:112](../../../machine/ts/machine/devices/gx/gte.ts#L112) | [C++ gte.h:108](../../../machine/cpp/machine/devices/gx/gte.h#L108) |

## Normal COMMAND / CYCLES interface

- COMMAND=`0x08010344`; the normal write handler computes all operation results synchronously during that mapped write, then sets `lastCycles`; the next mapped read of a data/control result sees those writes. The handler does not schedule a GTE service, assign a normal completion deadline, or install a busy/readiness latch. TS [TS gte.ts:200-222](../../../machine/ts/machine/devices/gx/gte.ts#L200-L222), [TS gte.ts:344-350](../../../machine/ts/machine/devices/gx/gte.ts#L344-L350), [TS gte.ts:525-649](../../../machine/ts/machine/devices/gx/gte.ts#L525-L649); C++ [C++ gte.cpp:64-85](../../../machine/cpp/machine/devices/gx/gte.cpp#L64-L85), [C++ gte.cpp:206-216](../../../machine/cpp/machine/devices/gx/gte.cpp#L206-L216), [C++ gte.cpp:390-514](../../../machine/cpp/machine/devices/gx/gte.cpp#L390-L514).
- CYCLES=`0x08010348` returns the duration returned by the **last normal command**, initially/reset0; this is a stored duration, not a countdown or PLUS status. Invalid normal function updates it to0. The complete opcode/latency table follows in the operation facts. TS [TS gte.ts:193-198](../../../machine/ts/machine/devices/gx/gte.ts#L193-L198), [TS gte.ts:236-247](../../../machine/ts/machine/devices/gx/gte.ts#L236-L247), [TS gte.ts:344-350](../../../machine/ts/machine/devices/gx/gte.ts#L344-L350), [TS gte.ts:647-648](../../../machine/ts/machine/devices/gx/gte.ts#L647-L648); C++ [C++ gte.h:156-162](../../../machine/cpp/machine/devices/gx/gte.h#L156-L162); [C++ gte.cpp:99-110](../../../machine/cpp/machine/devices/gx/gte.cpp#L99-L110), [C++ gte.cpp:206-216](../../../machine/cpp/machine/devices/gx/gte.cpp#L206-L216), [C++ gte.cpp:512-513](../../../machine/cpp/machine/devices/gx/gte.cpp#L512-L513).

## GTE_PLUS register inventory

- Mapping/read/write rules M1/M4/M5 apply. PLUS0..4 hold complete raw words, including upper bits that arithmetic may ignore. PLUS8 holds the last **accepted** complete raw command word. All PLUS reads first synchronize due completion and then return authoritative PLUS-array state. Every invoked PLUS0..4/8 write handler first synchronizes due completion (DMA PLUS COMMAND denial occurs before invoking it, P9). TS [TS gte.ts:353-369](../../../machine/ts/machine/devices/gx/gte.ts#L353-L369); C++ [C++ gte.cpp:219-237](../../../machine/cpp/machine/devices/gx/gte.cpp#L219-L237).
- Every PLUS row resets to0 via R1 below. Names and indices: TS [TS gte.ts:22-31](../../../machine/ts/machine/devices/gx/gte.ts#L22-L31); C++ [C++ gte.h:18-27](../../../machine/cpp/machine/devices/gx/gte.h#L18-L27). Operand decode/result packing: TS [TS gte.ts:391-417](../../../machine/ts/machine/devices/gx/gte.ts#L391-L417); C++ [C++ gte.cpp:256-282](../../../machine/cpp/machine/devices/gx/gte.cpp#L256-L282).

| PLUS index | Address | Constant suffix | Read / mapped-write effect | Datapath representation |
|---|---|---|---|---|
| 0 | `0x08010384` | `ADD_XY` | Raw read / raw store | add X=s16 low; add Y=s16 high |
| 1 | `0x08010388` | `ADD_Z` | Raw read / raw store | add Z=s16 low; upper16 retained but ignored by VMAD3 |
| 2 | `0x0801038c` | `MUL_XY` | Raw read / raw store | multiplicand X=s16 low; Y=s16 high |
| 3 | `0x08010390` | `MUL_Z` | Raw read / raw store | multiplicand Z=s16 low; upper16 retained but ignored by VMAD3 |
| 4 | `0x08010394` | `SCALAR` | Raw read / raw store | scalar=s16 low; upper16 retained but ignored by VMAD3 |
| 5 | `0x08010398` | `RESULT_XY` | Published result / write only changes hidden Memory slot | result X low16; Y high16 |
| 6 | `0x0801039c` | `RESULT_Z` | Published result / write only changes hidden Memory slot | result Z low16; high16 zero for VMAD3, including negative results |
| 7 | `0x080103a0` | `FLAG` | Published flag / write only changes hidden Memory slot | Separate from normal CONTROL31 FLAG |
| 8 | `0x080103a4` | `COMMAND` | Last accepted raw command / accepted only when idle | VMAD3 when low8=`0x01`; upper24 ignored for selection |
| 9 | `0x080103a8` | `CYCLES` | Duration plus busy / write only changes hidden Memory slot | bit31 busy; low bits last command duration, not countdown |

### PLUS admission, visibility, deadline, and CPU readiness

| ID | Fact | TS anchor | C++ anchor |
|---|---|---|---|
| P1 | VMAD3 low8=`0x01` has duration5; every other low8 has duration1. Command start computes pending results/flag from current operands, then sets PLUS CYCLES=`0x80000000\|duration` and deadline=`currentNowCycles()+duration`. It does not publish those pending values at command start. | [TS gte.ts:33-36](../../../machine/ts/machine/devices/gx/gte.ts#L33-L36), [TS gte.ts:391-417](../../../machine/ts/machine/devices/gx/gte.ts#L391-L417) | [C++ gte.h:29-32](../../../machine/cpp/machine/devices/gx/gte.h#L29-L32); [C++ gte.cpp:256-282](../../../machine/cpp/machine/devices/gx/gte.cpp#L256-L282) |
| P2 | Existing visible RESULT_XY/RESULT_Z/FLAG remain unchanged until due completion is published. Valid command initializes pending flag0; invalid command copies old visible result words into pending results and sets pending flag=`0x81000000`. Therefore invalid completion preserves visible result values, but publishes invalid-command/error flags. | [TS gte.ts:318-324](../../../machine/ts/machine/devices/gx/gte.ts#L318-L324), [TS gte.ts:391-417](../../../machine/ts/machine/devices/gx/gte.ts#L391-L417) | [C++ gte.cpp:176-182](../../../machine/cpp/machine/devices/gx/gte.cpp#L176-L182), [C++ gte.cpp:256-282](../../../machine/cpp/machine/devices/gx/gte.cpp#L256-L282) |
| P3 | PLUS reads, accepted-register writes, and CPU readiness checks synchronize if a nonzero deadline has been reached (`now>=deadline`). Synchronization cancels a scheduled interlock service if present, then publishes. Before deadline they do not publish. Capture also synchronizes first. | [TS gte.ts:251-253](../../../machine/ts/machine/devices/gx/gte.ts#L251-L253), [TS gte.ts:307-324](../../../machine/ts/machine/devices/gx/gte.ts#L307-L324), [TS gte.ts:353-380](../../../machine/ts/machine/devices/gx/gte.ts#L353-L380) | [C++ gte.cpp:114-115](../../../machine/cpp/machine/devices/gx/gte.cpp#L114-L115), [C++ gte.cpp:165-182](../../../machine/cpp/machine/devices/gx/gte.cpp#L165-L182), [C++ gte.cpp:219-245](../../../machine/cpp/machine/devices/gx/gte.cpp#L219-L245) |
| P4 | Publication writes all three visible result/flag words, clears only bit31 in PLUS CYCLES (duration remains), clears completion deadline, then resumes CPU writes blocked on the exact PLUS COMMAND address. | [TS gte.ts:318-324](../../../machine/ts/machine/devices/gx/gte.ts#L318-L324) | [C++ gte.cpp:176-182](../../../machine/cpp/machine/devices/gx/gte.cpp#L176-L182) |
| P5 | Writes to PLUS input registers while busy are allowed and change input words; already computed pending results are unchanged. The owner guard ignores a direct PLUS command handler invocation if another command is pending. A normal CPU guest store is instead held by readiness before it writes, see P6. There is one pending result set, not an input queue. | [TS gte.ts:358-369](../../../machine/ts/machine/devices/gx/gte.ts#L358-L369), [TS gte.ts:391-417](../../../machine/ts/machine/devices/gx/gte.ts#L391-L417) | [C++ gte.cpp:225-237](../../../machine/cpp/machine/devices/gx/gte.cpp#L225-L237), [C++ gte.cpp:256-282](../../../machine/cpp/machine/devices/gx/gte.cpp#L256-L282) |
| P6 | Readiness for PLUS COMMAND returns true when idle. While pending, it schedules DEVICE_SERVICE_GTE at the completion deadline (once per armed interlock), then returns false. A CPU store resets its PC to that instruction and marks itself blocked; publication clears the blocked flag only when raw target address matches. | [TS gte.ts:372-388](../../../machine/ts/machine/devices/gx/gte.ts#L372-L388); [TS cpu.ts:1647-1662](../../../machine/ts/machine/cpu/cpu.ts#L1647-L1662), [TS cpu.ts:3011-3023](../../../machine/ts/machine/cpu/cpu.ts#L3011-L3023), [TS cpu.ts:3125-3127](../../../machine/ts/machine/cpu/cpu.ts#L3125-L3127), [TS cpu.ts:3163-3166](../../../machine/ts/machine/cpu/cpu.ts#L3163-L3166) | [C++ gte.cpp:240-253](../../../machine/cpp/machine/devices/gx/gte.cpp#L240-L253); [C++ cpu.cpp:2342-2353](../../../machine/cpp/machine/cpu/cpu.cpp#L2342-L2353); [C++ cpu_dispatch.inl:585-587](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L585-L587), [C++ cpu_dispatch.inl:611-614](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L611-L614), [C++ cpu_dispatch.inl:652-654](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L652-L654), [C++ cpu_dispatch.inl:678-681](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L678-L681) |
| P7 | DEVICE_SERVICE_GTE callback clears its scheduled-interlock boolean and publishes completion. Machine dispatch calls that method and returns0. Command start itself does **not** schedule this service; readiness does. | [TS gte.ts:302-305](../../../machine/ts/machine/devices/gx/gte.ts#L302-L305), [TS gte.ts:384-387](../../../machine/ts/machine/devices/gx/gte.ts#L384-L387), [TS gte.ts:391-417](../../../machine/ts/machine/devices/gx/gte.ts#L391-L417); [TS machine.ts:152-154](../../../machine/ts/machine/machine.ts#L152-L154) | [C++ gte.cpp:160-163](../../../machine/cpp/machine/devices/gx/gte.cpp#L160-L163), [C++ gte.cpp:249-252](../../../machine/cpp/machine/devices/gx/gte.cpp#L249-L252), [C++ gte.cpp:256-282](../../../machine/cpp/machine/devices/gx/gte.cpp#L256-L282); [C++ machine.cpp:95-97](../../../machine/cpp/machine/machine.cpp#L95-L97) |
| P8 | Clock domain is scheduler cycles: outside an active CPU slice, currentNowCycles is schedulerNowCycles; in a slice it is sliceBase+(sliceBudget-CPU remaining instruction budget). No frame duration or Hz conversion occurs in GTE. | [TS device.ts:52-57](../../../machine/ts/machine/scheduler/device.ts#L52-L57); [TS gte.ts:416-417](../../../machine/ts/machine/devices/gx/gte.ts#L416-L417) | [C++ device.cpp:33-38](../../../machine/cpp/machine/scheduler/device.cpp#L33-L38); [C++ gte.cpp:281-282](../../../machine/cpp/machine/devices/gx/gte.cpp#L281-L282) |
| P9 | DMA-master readiness for PLUS COMMAND always returns false **before synchronization**. The Memory DMA mapped-write path consults readiness and drops the write when false, so DMA cannot start a PLUS command through that path, even idle, and the denied write changes neither GTE state nor the Memory backing slot. CPU and DMA master signals are0 and1. Do not extrapolate a whole DMA-channel completion/fault policy from this fact. | [TS gte.ts:372-380](../../../machine/ts/machine/devices/gx/gte.ts#L372-L380); [TS memory.ts:623-641](../../../machine/ts/machine/memory/memory.ts#L623-L641); [TS bus_signals.ts:1-2](../../../machine/ts/machine/memory/bus_signals.ts#L1-L2) | [C++ gte.cpp:240-245](../../../machine/cpp/machine/devices/gx/gte.cpp#L240-L245); [C++ memory.cpp:518-535](../../../machine/cpp/machine/memory/memory.cpp#L518-L535); [C++ bus_signals.h:9-10](../../../machine/cpp/machine/memory/bus_signals.h#L9-L10) |
| P10 | Normal GTE and PLUS have separate arrays, result paths, flag words, and cycle words. Normal-command handler does not synchronize PLUS; PLUS handler does not update normal `lastCycles`. | [TS gte.ts:183-198](../../../machine/ts/machine/devices/gx/gte.ts#L183-L198), [TS gte.ts:344-369](../../../machine/ts/machine/devices/gx/gte.ts#L344-L369), [TS gte.ts:391-417](../../../machine/ts/machine/devices/gx/gte.ts#L391-L417) | [C++ gte.h:143-162](../../../machine/cpp/machine/devices/gx/gte.h#L143-L162); [C++ gte.cpp:206-237](../../../machine/cpp/machine/devices/gx/gte.cpp#L206-L237), [C++ gte.cpp:256-282](../../../machine/cpp/machine/devices/gx/gte.cpp#L256-L282) |

### PLUS FLAG bit constants

These are separate from normal FLAG. Valid VMAD3 starts pending flag0 and lane saturation sets ERROR plus the lane-direction bit; invalid command sets ERROR|INVALID_COMMAND. Arithmetic thresholds/formula are established below. TS [TS gte.ts:38-45](../../../machine/ts/machine/devices/gx/gte.ts#L38-L45), [TS gte.ts:394](../../../machine/ts/machine/devices/gx/gte.ts#L394), [TS gte.ts:413](../../../machine/ts/machine/devices/gx/gte.ts#L413), [TS gte.ts:420-428](../../../machine/ts/machine/devices/gx/gte.ts#L420-L428); C++ [C++ gte.h:34-41](../../../machine/cpp/machine/devices/gx/gte.h#L34-L41); [C++ gte.cpp:259](../../../machine/cpp/machine/devices/gx/gte.cpp#L259), [C++ gte.cpp:278](../../../machine/cpp/machine/devices/gx/gte.cpp#L278), [C++ gte.cpp:285-294](../../../machine/cpp/machine/devices/gx/gte.cpp#L285-L294).

| Bit | Mask | `GX_GTE_PLUS_FLAG_` suffix | TS anchor | C++ anchor |
|---|---|---|---|---|
| 31 | `0x80000000` | ERROR | [TS gte.ts:38](../../../machine/ts/machine/devices/gx/gte.ts#L38) | [C++ gte.h:34](../../../machine/cpp/machine/devices/gx/gte.h#L34) |
| 30 | `0x40000000` | X_POS | [TS gte.ts:39](../../../machine/ts/machine/devices/gx/gte.ts#L39) | [C++ gte.h:35](../../../machine/cpp/machine/devices/gx/gte.h#L35) |
| 29 | `0x20000000` | Y_POS | [TS gte.ts:40](../../../machine/ts/machine/devices/gx/gte.ts#L40) | [C++ gte.h:36](../../../machine/cpp/machine/devices/gx/gte.h#L36) |
| 28 | `0x10000000` | Z_POS | [TS gte.ts:41](../../../machine/ts/machine/devices/gx/gte.ts#L41) | [C++ gte.h:37](../../../machine/cpp/machine/devices/gx/gte.h#L37) |
| 27 | `0x08000000` | X_NEG | [TS gte.ts:42](../../../machine/ts/machine/devices/gx/gte.ts#L42) | [C++ gte.h:38](../../../machine/cpp/machine/devices/gx/gte.h#L38) |
| 26 | `0x04000000` | Y_NEG | [TS gte.ts:43](../../../machine/ts/machine/devices/gx/gte.ts#L43) | [C++ gte.h:39](../../../machine/cpp/machine/devices/gx/gte.h#L39) |
| 25 | `0x02000000` | Z_NEG | [TS gte.ts:44](../../../machine/ts/machine/devices/gx/gte.ts#L44) | [C++ gte.h:40](../../../machine/cpp/machine/devices/gx/gte.h#L40) |
| 24 | `0x01000000` | INVALID_COMMAND | [TS gte.ts:45](../../../machine/ts/machine/devices/gx/gte.ts#L45) | [C++ gte.h:41](../../../machine/cpp/machine/devices/gx/gte.h#L41) |

## Reset and editorial emulator-state observations

The capture/restore entries S1–S3 describe emulator persistence, not additional
guest-visible registers or a public programming interface.

| ID | Fact | TS anchor | C++ anchor |
|---|---|---|---|
| R1 | GTE reset zeroes all data/control/PLUS words; hidden MAC0..3; accumulator scratch/overflow booleans; normal lastCycles; PLUS completion deadline/interlock armed/pending result/pending flag; currentSf. No GTE-owned value is retained by this reset. | [TS gte.ts:225-248](../../../machine/ts/machine/devices/gx/gte.ts#L225-L248) | [C++ gte.cpp:88-111](../../../machine/cpp/machine/devices/gx/gte.cpp#L88-L111) |
| R2 | Reset cancels the GTE scheduled service, resumes a blocked store at PLUS COMMAND, and explicitly writes0 to Memory backing slots for normal COMMAND, normal CYCLES, PLUS COMMAND, PLUS CYCLES. It does not invoke command handlers for those zero writes; `writeIoU32` is backing-only. | [TS gte.ts:242-247](../../../machine/ts/machine/devices/gx/gte.ts#L242-L247); [TS memory.ts:430-431](../../../machine/ts/machine/memory/memory.ts#L430-L431) | [C++ gte.cpp:105-110](../../../machine/cpp/machine/devices/gx/gte.cpp#L105-L110); [C++ memory.cpp:320-321](../../../machine/cpp/machine/memory/memory.cpp#L320-L321) |
| R3 | Machine.resetDevices invokes GTE.reset as a device reset. No separate guest GTE reset register is installed by the GTE constructor. | [TS machine.ts:108-116](../../../machine/ts/machine/machine.ts#L108-L116); [TS gte.ts:200-222](../../../machine/ts/machine/devices/gx/gte.ts#L200-L222) | [C++ machine.cpp:51-59](../../../machine/cpp/machine/machine.cpp#L51-L59); [C++ gte.cpp:64-85](../../../machine/cpp/machine/devices/gx/gte.cpp#L64-L85) |
| S1 | Capture synchronizes due completion before saving register arrays, hidden MAC0..3, currentSf, lastCycles, pending results/flag, remaining pending cycles (deadline-now, or0), and interlock-armed state. It does not save accumulator scratch/temporary overflow booleans. These are emulator state fields, not extra guest-visible registers. | [TS gte.ts:165-180](../../../machine/ts/machine/devices/gx/gte.ts#L165-L180), [TS gte.ts:251-268](../../../machine/ts/machine/devices/gx/gte.ts#L251-L268) | [C++ gte.h:112-126](../../../machine/cpp/machine/devices/gx/gte.h#L112-L126); [C++ gte.cpp:114-132](../../../machine/cpp/machine/devices/gx/gte.cpp#L114-L132) |
| S2 | Restore cancels old GTE service, restores saved arrays/hidden values, reconstructs deadline as now+remaining (or0), and schedules service only if saved interlock-armed. It does not rerun the operation or republish pending results early. | [TS gte.ts:272-299](../../../machine/ts/machine/devices/gx/gte.ts#L272-L299) | [C++ gte.cpp:136-157](../../../machine/cpp/machine/devices/gx/gte.cpp#L136-L157) |
| S3 | The GTE-specific captured state does not include the normal COMMAND Memory backing slot (there is no corresponding GTE field), and the GTE restore does not rewrite it. This is a capture-scope observation only; whole-machine save/restore policy is outside scope. | [TS gte.ts:165-180](../../../machine/ts/machine/devices/gx/gte.ts#L165-L180), [TS gte.ts:251-299](../../../machine/ts/machine/devices/gx/gte.ts#L251-L299) | [C++ gte.h:112-126](../../../machine/cpp/machine/devices/gx/gte.h#L112-L126); [C++ gte.cpp:114-157](../../../machine/cpp/machine/devices/gx/gte.cpp#L114-L157) |

## IRQ / adjacent-unit boundary facts

- The complete GTE owner has Memory, CPU, and scheduler dependencies but no interrupt-controller dependency, IRQ enable/status/ack register, or IRQ-raising call. Its PLUS completion notification is `resumeMemoryWrite(PLUS_COMMAND)`; the machine GTE service dispatch returns0. The shared IO IRQ list contains no GTE-specific IRQ bit. **Scoped conclusion:** normal GTE and PLUS completion do not signal a GTE IRQ in these inspected owners; do not substitute GEO_DONE/GEO_ERROR or GPU IRQ behavior. TS [TS gte.ts:200-222](../../../machine/ts/machine/devices/gx/gte.ts#L200-L222), [TS gte.ts:302-324](../../../machine/ts/machine/devices/gx/gte.ts#L302-L324), [TS gte.ts:344-350](../../../machine/ts/machine/devices/gx/gte.ts#L344-L350), [TS gte.ts:525-649](../../../machine/ts/machine/devices/gx/gte.ts#L525-L649); [TS machine.ts:152-154](../../../machine/ts/machine/machine.ts#L152-L154); [TS io.ts:362-372](../../../machine/ts/spec/bmsx/io.ts#L362-L372). C++ [C++ gte.h:129-162](../../../machine/cpp/machine/devices/gx/gte.h#L129-L162); [C++ gte.cpp:64-85](../../../machine/cpp/machine/devices/gx/gte.cpp#L64-L85), [C++ gte.cpp:160-182](../../../machine/cpp/machine/devices/gx/gte.cpp#L160-L182), [C++ gte.cpp:206-216](../../../machine/cpp/machine/devices/gx/gte.cpp#L206-L216), [C++ gte.cpp:390-514](../../../machine/cpp/machine/devices/gx/gte.cpp#L390-L514); [C++ machine.cpp:95-97](../../../machine/cpp/machine/machine.cpp#L95-L97); [C++ io.h:375-385](../../../machine/cpp/spec/bmsx/io.h#L375-L385).
- GTE is a separate register-window device from GEO and GPU. The allowed GTE owner maps only its data/control/normal-command/cycles/PLUS words; no packet FIFO, VRAM write, GPU draw, GEO scratch-memory transfer, or framebuffer action is part of these handlers. This is a source-scope boundary, not a claim that software cannot pass results onward. TS [TS gte.ts:200-222](../../../machine/ts/machine/devices/gx/gte.ts#L200-L222), [TS gte.ts:328-430](../../../machine/ts/machine/devices/gx/gte.ts#L328-L430); C++ [C++ gte.cpp:64-85](../../../machine/cpp/machine/devices/gx/gte.cpp#L64-L85), [C++ gte.cpp:186-295](../../../machine/cpp/machine/devices/gx/gte.cpp#L186-L295).

## Source-derived raw programming example (not an executed runtime test)

A register-transformation example requires no assumed cart API or command formula. Start after GTE.reset; perform aligned raw32 mapped writes and reads:

| Operation | Address | Written word / observed read word | Source rule |
|---|---|---|---|
| write then read DATA1 | `0x08010248` | write `0x12348000`; read `0xffff8000` | D-S |
| write then read DATA7 | `0x08010260` | write `0x12345678`; read `0x00005678` | D-U |
| write then read H=CONTROL26 | `0x0801032c` | write `0x00008000`; read `0xffff8000` (projection accessor consumes `0x8000`) | C-S, H fact |
| write then read FLAG | `0x08010340` | write `0xffffffff`; read `0xfffff000` | C-F |
| write then read leading-sign source/count | DATA30=`0x080102bc`, DATA31=`0x080102c0` | write source `0xffffffff`; read DATA30=`0xffffffff`, DATA31=`0x00000020` | D-LS/D-LC |

Anchors for all calculated outputs: TS [TS gte.ts:157-163](../../../machine/ts/machine/devices/gx/gte.ts#L157-L163), [TS gte.ts:459-518](../../../machine/ts/machine/devices/gx/gte.ts#L459-L518), [TS gte.ts:656-661](../../../machine/ts/machine/devices/gx/gte.ts#L656-L661), [TS gte.ts:1235-1236](../../../machine/ts/machine/devices/gx/gte.ts#L1235-L1236); C++ [C++ gte.cpp:55-60](../../../machine/cpp/machine/devices/gx/gte.cpp#L55-L60), [C++ gte.cpp:324-382](../../../machine/cpp/machine/devices/gx/gte.cpp#L324-L382), [C++ gte.cpp:521-526](../../../machine/cpp/machine/devices/gx/gte.cpp#L521-L526), [C++ gte.cpp:1107-1108](../../../machine/cpp/machine/devices/gx/gte.cpp#L1107-L1108); central signed16 semantics TS [TS numeric.ts:18-21](../../../machine/ts/machine/common/numeric.ts#L18-L21), C++ [C++ numeric.h:20-23](../../../machine/cpp/machine/common/numeric.h#L20-L23). Absolute address provenance is address fact2.

## Decode, execution and arithmetic primitives

- **Base decode:** function `word & 0x3f`; `sf=(word>>19)&1`; `lm=(word>>10)&1`. MVMVA additionally decodes `mx=(word>>17)&3`, `v=(word>>15)&3`, `cv=(word>>13)&3`. No other command-word bits affect execution. NCLIP/AVSZ3/AVSZ4 do not use `sf` or `lm`. Sources: [TS gte.ts:525-528](../../../machine/ts/machine/devices/gx/gte.ts#L525-L528), [TS gte.ts:913-937](../../../machine/ts/machine/devices/gx/gte.ts#L913-L937); [C++ gte.cpp:390-393](../../../machine/cpp/machine/devices/gx/gte.cpp#L390-L393), [C++ gte.cpp:777-811](../../../machine/cpp/machine/devices/gx/gte.cpp#L777-L811).
- **Base FLAG lifetime:** every supported function clears `C[31]` before any operation; triple functions accumulate flags across their three iterations; final `updateFlagError()` sets bit 31 if `FLAG & 0x7f87e000` is nonzero. It does not clear preexisting bit 31. IR3 saturation, RGB saturation and IR0 saturation alone do not set summary ERROR; their bits are outside the summary mask. Sources: [TS gte.ts:93-114](../../../machine/ts/machine/devices/gx/gte.ts#L93-L114), [TS gte.ts:525-665](../../../machine/ts/machine/devices/gx/gte.ts#L525-L665); [C++ gte.h:89-110](../../../machine/cpp/machine/devices/gx/gte.h#L89-L110); [C++ gte.cpp:390-530](../../../machine/cpp/machine/devices/gx/gte.cpp#L390-L530).
- **Unknown base function:** returns zero cycles without clearing FLAG, invoking arithmetic, or changing GTE register/accumulator state. Through MMIO the returned zero becomes the last-cycle result. Sources: [TS gte.ts:344-350](../../../machine/ts/machine/devices/gx/gte.ts#L344-L350), [TS gte.ts:647-649](../../../machine/ts/machine/devices/gx/gte.ts#L647-L649); [C++ gte.cpp:206-216](../../../machine/cpp/machine/devices/gx/gte.cpp#L206-L216), [C++ gte.cpp:512-514](../../../machine/cpp/machine/devices/gx/gte.cpp#L512-L514).
- **Matrix/lane indexing:** matrix rows `r=0,1,2` and columns `c=0,1,2` are zero-based; MAC/IR lane indices `i=1,2,3` are one-based, with `i=r+1`. A row-r result therefore writes `MAC_(r+1)` at `D[25+r]` and `IR_(r+1)` at `D[9+r]`. `CV_r` and `TR_r` use zero-based X/Y/Z component order; lane-indexed color components `rgb_i`, `far_i`, and `in_i` use lane1=red, lane2=green, lane3=blue. Sources: [TS gte.ts:783-817](../../../machine/ts/machine/devices/gx/gte.ts#L783-L817), [TS gte.ts:913-935](../../../machine/ts/machine/devices/gx/gte.ts#L913-L935), [TS gte.ts:939-982](../../../machine/ts/machine/devices/gx/gte.ts#L939-L982); [C++ gte.cpp:646-680](../../../machine/cpp/machine/devices/gx/gte.cpp#L646-L680), [C++ gte.cpp:777-808](../../../machine/cpp/machine/devices/gx/gte.cpp#L777-L808), [C++ gte.cpp:813-856](../../../machine/cpp/machine/devices/gx/gte.cpp#L813-L856).
- **Additional arithmetic notation:** `s32(w)` interprets the 32-bit word as signed; `W32(x)` keeps low 32 bits interpreted signed; `ASR(x,n)` divides by `2^n` rounding toward negative infinity. Sources: [TS numeric.ts:14-37](../../../machine/ts/machine/common/numeric.ts#L14-L37); [C++ numeric.h:14-40](../../../machine/cpp/machine/common/numeric.h#L14-L40).
- **44-bit range/wrap:** `MIN44=-0x80000000000=-2^43`, `MAX44=0x7ffffffffff=2^43-1`, range `0x100000000000=2^44`. `W44(x)` subtracts the range if above MAX44, adds it if below MIN44, else keeps x; it is not saturation. `S(x)=ASR(x,12)` for `sf=1`, otherwise x. Sources: [TS gte.ts:116-118](../../../machine/ts/machine/devices/gx/gte.ts#L116-L118), [TS gte.ts:140-155](../../../machine/ts/machine/devices/gx/gte.ts#L140-L155); [C++ gte.cpp:14-16](../../../machine/cpp/machine/devices/gx/gte.cpp#L14-L16), [C++ gte.cpp:38-53](../../../machine/cpp/machine/devices/gx/gte.cpp#L38-L53).
- **MAC1..3 write (`M_i` below):** keeps the passed unshifted value in the private accumulator; writes `D[24+i]=W32(S(value))`; returns that signed 32-bit result. Positive/negative overflow inputs set the corresponding MAC lane flag and ERROR. `M44_i(x)` first applies W44, and supplies positive/negative overflow from `x>MAX44` / `x<MIN44`. A public register MAC word is therefore shifted/wrapped, not the private unshifted accumulator. Sources: [TS gte.ts:680-719](../../../machine/ts/machine/devices/gx/gte.ts#L680-L719); [C++ gte.cpp:545-584](../../../machine/cpp/machine/devices/gx/gte.cpp#L545-L584).
- **Ordered accumulation (`A44` below):** initialize `a=W44(initial)` and overflow booleans from the initial value against 44-bit bounds. In order, for each of three addends `b`, compute `t=W44(a+b)`, OR positive overflow with `(t<0 && a>=0 && b>=0)`, OR negative overflow with `(t>=0 && a<0 && b<0)`, then `a=t`. Pass final a and those accumulated booleans to `M_i`. No full-dot-product-then-wrap substitution: cancellation after an overflow does not clear its flag. Sources: [TS gte.ts:723-744](../../../machine/ts/machine/devices/gx/gte.ts#L723-L744), [TS gte.ts:950-973](../../../machine/ts/machine/devices/gx/gte.ts#L950-L973); [C++ gte.cpp:586-607](../../../machine/cpp/machine/devices/gx/gte.cpp#L586-L607), [C++ gte.cpp:824-847](../../../machine/cpp/machine/devices/gx/gte.cpp#L824-L847).
- **IR1..3 clamp (`I_i(q,lm)`):** clamp signed 32-bit q to `[-32768,32767]` when lm=0 or `[0,32767]` when lm=1; strictly out-of-range sets the lane's IR saturation flag. Standard IR writes put that clamped integer into `D[8+i]`. The clamp consumes the shifted/wrapped MAC word, not the 44-bit accumulator. Sources: [TS gte.ts:668-678](../../../machine/ts/machine/devices/gx/gte.ts#L668-L678), [TS gte.ts:747-761](../../../machine/ts/machine/devices/gx/gte.ts#L747-L761); [C++ gte.cpp:533-543](../../../machine/cpp/machine/devices/gx/gte.cpp#L533-L543), [C++ gte.cpp:610-624](../../../machine/cpp/machine/devices/gx/gte.cpp#L610-L624).
- **MAC0 write (`M0(x)`):** keeps full x privately and writes low 32 bits to `D[24]`; sets MAC0-positive+ERROR if `x>0x7fffffff`, MAC0-negative+ERROR if `x<-0x80000000`. Later projection calculations use the private full x, not the wrapped public MAC0 word. Sources: [TS gte.ts:987-994](../../../machine/ts/machine/devices/gx/gte.ts#L987-L994), [TS gte.ts:1021-1030](../../../machine/ts/machine/devices/gx/gte.ts#L1021-L1030); [C++ gte.cpp:861-868](../../../machine/cpp/machine/devices/gx/gte.cpp#L861-L868), [C++ gte.cpp:895-904](../../../machine/cpp/machine/devices/gx/gte.cpp#L895-L904).
- **RGB push (`P` below):** for each lane use `s32(D[25..27]) ASR 4`, clamp to `[0,255]` with R/G/B saturation flag; shift `D[20]=old D[21]`, `D[21]=old D[22]`, write `D[22]=r | g<<8 | b<<16 | RGBC.code<<24`. CODE always comes from the current `D[6]` high byte (including DPCT), not the source RGB FIFO word. Sources: [TS gte.ts:1121-1141](../../../machine/ts/machine/devices/gx/gte.ts#L1121-L1141), [TS gte.ts:1283-1285](../../../machine/ts/machine/devices/gx/gte.ts#L1283-L1285); [C++ gte.cpp:994-1014](../../../machine/cpp/machine/devices/gx/gte.cpp#L994-L1014), [C++ gte.cpp:1155-1157](../../../machine/cpp/machine/devices/gx/gte.cpp#L1155-L1157).

## Complete base command table

For equations below, **SXY** abbreviates the packed signed SX/SY pair D12..14 and **SZ** the unsigned depth FIFO D16..19; these are descriptive notation for owner getters/packing, not an extra alias contract.

All rows also write FLAG as above. `MI` means MAC1..3 (`D[25..27]`) and IR1..3 (`D[9..11]`); `P` means one RGB FIFO push; stage abbreviations are defined below. Triple color commands finish with the final iteration's MI and three newly produced FIFO colors; RTPT FIFO effects are listed in its own row. Cycles are command results/constants; timing/publication are established above in the register facts.

| low 6 bits | Function | Cycles | Exact stage sequence / input expression | Outputs besides FLAG | Evidence |
|---|---|---:|---|---|---|
| `0x01` | RTPS | 15 | RT(0,last=true) | MI; MAC0; IR0; one SZ and one SXY push | [TS gte.ts:47](../../../machine/ts/machine/devices/gx/gte.ts#L47), [TS gte.ts:70](../../../machine/ts/machine/devices/gx/gte.ts#L70), [TS gte.ts:529-533](../../../machine/ts/machine/devices/gx/gte.ts#L529-L533); [C++ gte.h:43](../../../machine/cpp/machine/devices/gx/gte.h#L43), [C++ gte.h:66](../../../machine/cpp/machine/devices/gx/gte.h#L66); [C++ gte.cpp:394-398](../../../machine/cpp/machine/devices/gx/gte.cpp#L394-L398). |
| `0x06` | NCLIP | 8 | signed area from SXY0..2 | MAC0 | [TS gte.ts:48](../../../machine/ts/machine/devices/gx/gte.ts#L48), [TS gte.ts:71](../../../machine/ts/machine/devices/gx/gte.ts#L71), [TS gte.ts:534-538](../../../machine/ts/machine/devices/gx/gte.ts#L534-L538); [C++ gte.h:44](../../../machine/cpp/machine/devices/gx/gte.h#L44), [C++ gte.h:67](../../../machine/cpp/machine/devices/gx/gte.h#L67); [C++ gte.cpp:399-403](../../../machine/cpp/machine/devices/gx/gte.cpp#L399-L403). |
| `0x0c` | OP | 6 | rotation diagonal cross IR | MI | [TS gte.ts:49](../../../machine/ts/machine/devices/gx/gte.ts#L49), [TS gte.ts:72](../../../machine/ts/machine/devices/gx/gte.ts#L72), [TS gte.ts:539-543](../../../machine/ts/machine/devices/gx/gte.ts#L539-L543); [C++ gte.h:45](../../../machine/cpp/machine/devices/gx/gte.h#L45), [C++ gte.h:68](../../../machine/cpp/machine/devices/gx/gte.h#L68); [C++ gte.cpp:404-408](../../../machine/cpp/machine/devices/gx/gte.cpp#L404-L408). |
| `0x10` | DPCS | 8 | DC(RGBC.rgb × 65536); P | MI; P | [TS gte.ts:50](../../../machine/ts/machine/devices/gx/gte.ts#L50), [TS gte.ts:73](../../../machine/ts/machine/devices/gx/gte.ts#L73), [TS gte.ts:544-548](../../../machine/ts/machine/devices/gx/gte.ts#L544-L548); [C++ gte.h:46](../../../machine/cpp/machine/devices/gx/gte.h#L46), [C++ gte.h:69](../../../machine/cpp/machine/devices/gx/gte.h#L69); [C++ gte.cpp:409-413](../../../machine/cpp/machine/devices/gx/gte.cpp#L409-L413). |
| `0x11` | INTPL | 8 | DC(IR × 4096); P | MI; P | [TS gte.ts:51](../../../machine/ts/machine/devices/gx/gte.ts#L51), [TS gte.ts:74](../../../machine/ts/machine/devices/gx/gte.ts#L74), [TS gte.ts:549-553](../../../machine/ts/machine/devices/gx/gte.ts#L549-L553); [C++ gte.h:47](../../../machine/cpp/machine/devices/gx/gte.h#L47), [C++ gte.h:70](../../../machine/cpp/machine/devices/gx/gte.h#L70); [C++ gte.cpp:414-418](../../../machine/cpp/machine/devices/gx/gte.cpp#L414-L418). |
| `0x12` | MVMVA | 8 | selected matrix/vector/control-vector; see CV=2 rule | MI | [TS gte.ts:52](../../../machine/ts/machine/devices/gx/gte.ts#L52), [TS gte.ts:75](../../../machine/ts/machine/devices/gx/gte.ts#L75), [TS gte.ts:554-558](../../../machine/ts/machine/devices/gx/gte.ts#L554-L558); [C++ gte.h:48](../../../machine/cpp/machine/devices/gx/gte.h#L48), [C++ gte.h:71](../../../machine/cpp/machine/devices/gx/gte.h#L71); [C++ gte.cpp:419-423](../../../machine/cpp/machine/devices/gx/gte.cpp#L419-L423). |
| `0x13` | NCDS | 19 | L(0); K; DC(rgb × 16 × IR); P | MI; P | [TS gte.ts:53](../../../machine/ts/machine/devices/gx/gte.ts#L53), [TS gte.ts:76](../../../machine/ts/machine/devices/gx/gte.ts#L76), [TS gte.ts:559-563](../../../machine/ts/machine/devices/gx/gte.ts#L559-L563); [C++ gte.h:49](../../../machine/cpp/machine/devices/gx/gte.h#L49), [C++ gte.h:72](../../../machine/cpp/machine/devices/gx/gte.h#L72); [C++ gte.cpp:424-428](../../../machine/cpp/machine/devices/gx/gte.cpp#L424-L428). |
| `0x14` | CDP | 13 | K; DC(rgb × 16 × IR); P | MI; P | [TS gte.ts:54](../../../machine/ts/machine/devices/gx/gte.ts#L54), [TS gte.ts:77](../../../machine/ts/machine/devices/gx/gte.ts#L77), [TS gte.ts:564-568](../../../machine/ts/machine/devices/gx/gte.ts#L564-L568); [C++ gte.h:50](../../../machine/cpp/machine/devices/gx/gte.h#L50), [C++ gte.h:73](../../../machine/cpp/machine/devices/gx/gte.h#L73); [C++ gte.cpp:429-433](../../../machine/cpp/machine/devices/gx/gte.cpp#L429-L433). |
| `0x16` | NCDT | 44 | NCDS stages for vectors 0,1,2 in order | MI; P × 3 | [TS gte.ts:55](../../../machine/ts/machine/devices/gx/gte.ts#L55), [TS gte.ts:78](../../../machine/ts/machine/devices/gx/gte.ts#L78), [TS gte.ts:569-575](../../../machine/ts/machine/devices/gx/gte.ts#L569-L575); [C++ gte.h:51](../../../machine/cpp/machine/devices/gx/gte.h#L51), [C++ gte.h:74](../../../machine/cpp/machine/devices/gx/gte.h#L74); [C++ gte.cpp:434-440](../../../machine/cpp/machine/devices/gx/gte.cpp#L434-L440). |
| `0x1b` | NCCS | 17 | L(0); K; CA; P | MI; P | [TS gte.ts:56](../../../machine/ts/machine/devices/gx/gte.ts#L56), [TS gte.ts:79](../../../machine/ts/machine/devices/gx/gte.ts#L79), [TS gte.ts:576-580](../../../machine/ts/machine/devices/gx/gte.ts#L576-L580); [C++ gte.h:52](../../../machine/cpp/machine/devices/gx/gte.h#L52), [C++ gte.h:75](../../../machine/cpp/machine/devices/gx/gte.h#L75); [C++ gte.cpp:441-445](../../../machine/cpp/machine/devices/gx/gte.cpp#L441-L445). |
| `0x1c` | CC | 11 | K; CA; P | MI; P | [TS gte.ts:57](../../../machine/ts/machine/devices/gx/gte.ts#L57), [TS gte.ts:80](../../../machine/ts/machine/devices/gx/gte.ts#L80), [TS gte.ts:581-585](../../../machine/ts/machine/devices/gx/gte.ts#L581-L585); [C++ gte.h:53](../../../machine/cpp/machine/devices/gx/gte.h#L53), [C++ gte.h:76](../../../machine/cpp/machine/devices/gx/gte.h#L76); [C++ gte.cpp:446-450](../../../machine/cpp/machine/devices/gx/gte.cpp#L446-L450). |
| `0x1e` | NCS | 14 | L(0); K; P | MI; P | [TS gte.ts:58](../../../machine/ts/machine/devices/gx/gte.ts#L58), [TS gte.ts:81](../../../machine/ts/machine/devices/gx/gte.ts#L81), [TS gte.ts:586-590](../../../machine/ts/machine/devices/gx/gte.ts#L586-L590); [C++ gte.h:54](../../../machine/cpp/machine/devices/gx/gte.h#L54), [C++ gte.h:77](../../../machine/cpp/machine/devices/gx/gte.h#L77); [C++ gte.cpp:451-455](../../../machine/cpp/machine/devices/gx/gte.cpp#L451-L455). |
| `0x20` | NCT | 30 | NCS stages for vectors 0,1,2 in order | MI; P × 3 | [TS gte.ts:59](../../../machine/ts/machine/devices/gx/gte.ts#L59), [TS gte.ts:82](../../../machine/ts/machine/devices/gx/gte.ts#L82), [TS gte.ts:591-597](../../../machine/ts/machine/devices/gx/gte.ts#L591-L597); [C++ gte.h:55](../../../machine/cpp/machine/devices/gx/gte.h#L55), [C++ gte.h:78](../../../machine/cpp/machine/devices/gx/gte.h#L78); [C++ gte.cpp:456-462](../../../machine/cpp/machine/devices/gx/gte.cpp#L456-L462). |
| `0x28` | SQR | 5 | square each signed IR lane | MI | [TS gte.ts:60](../../../machine/ts/machine/devices/gx/gte.ts#L60), [TS gte.ts:83](../../../machine/ts/machine/devices/gx/gte.ts#L83), [TS gte.ts:598-602](../../../machine/ts/machine/devices/gx/gte.ts#L598-L602); [C++ gte.h:56](../../../machine/cpp/machine/devices/gx/gte.h#L56), [C++ gte.h:79](../../../machine/cpp/machine/devices/gx/gte.h#L79); [C++ gte.cpp:463-467](../../../machine/cpp/machine/devices/gx/gte.cpp#L463-L467). |
| `0x29` | DCPL | 8 | DC(rgb × 16 × IR); P | MI; P | [TS gte.ts:61](../../../machine/ts/machine/devices/gx/gte.ts#L61), [TS gte.ts:84](../../../machine/ts/machine/devices/gx/gte.ts#L84), [TS gte.ts:603-607](../../../machine/ts/machine/devices/gx/gte.ts#L603-L607); [C++ gte.h:57](../../../machine/cpp/machine/devices/gx/gte.h#L57), [C++ gte.h:80](../../../machine/cpp/machine/devices/gx/gte.h#L80); [C++ gte.cpp:468-472](../../../machine/cpp/machine/devices/gx/gte.cpp#L468-L472). |
| `0x2a` | DPCT | 17 | 3 iterations: read current RGB0.rgb; DC(rgb × 65536); P | MI; P × 3 | [TS gte.ts:62](../../../machine/ts/machine/devices/gx/gte.ts#L62), [TS gte.ts:85](../../../machine/ts/machine/devices/gx/gte.ts#L85), [TS gte.ts:608-612](../../../machine/ts/machine/devices/gx/gte.ts#L608-L612); [C++ gte.h:58](../../../machine/cpp/machine/devices/gx/gte.h#L58), [C++ gte.h:81](../../../machine/cpp/machine/devices/gx/gte.h#L81); [C++ gte.cpp:473-477](../../../machine/cpp/machine/devices/gx/gte.cpp#L473-L477). |
| `0x2d` | AVSZ3 | 5 | ZSF3 × (SZ1+SZ2+SZ3) | MAC0; depth-average D[7] | [TS gte.ts:63](../../../machine/ts/machine/devices/gx/gte.ts#L63), [TS gte.ts:86](../../../machine/ts/machine/devices/gx/gte.ts#L86), [TS gte.ts:613-617](../../../machine/ts/machine/devices/gx/gte.ts#L613-L617); [C++ gte.h:59](../../../machine/cpp/machine/devices/gx/gte.h#L59), [C++ gte.h:82](../../../machine/cpp/machine/devices/gx/gte.h#L82); [C++ gte.cpp:478-482](../../../machine/cpp/machine/devices/gx/gte.cpp#L478-L482). |
| `0x2e` | AVSZ4 | 6 | ZSF4 × (SZ0+SZ1+SZ2+SZ3) | MAC0; depth-average D[7] | [TS gte.ts:64](../../../machine/ts/machine/devices/gx/gte.ts#L64), [TS gte.ts:87](../../../machine/ts/machine/devices/gx/gte.ts#L87), [TS gte.ts:618-622](../../../machine/ts/machine/devices/gx/gte.ts#L618-L622); [C++ gte.h:60](../../../machine/cpp/machine/devices/gx/gte.h#L60), [C++ gte.h:83](../../../machine/cpp/machine/devices/gx/gte.h#L83); [C++ gte.cpp:483-487](../../../machine/cpp/machine/devices/gx/gte.cpp#L483-L487). |
| `0x30` | RTPT | 23 | RT(0,false); RT(1,false); RT(2,true) | MI; MAC0; IR0; SZ and SXY pushes × 3 | [TS gte.ts:65](../../../machine/ts/machine/devices/gx/gte.ts#L65), [TS gte.ts:88](../../../machine/ts/machine/devices/gx/gte.ts#L88), [TS gte.ts:623-629](../../../machine/ts/machine/devices/gx/gte.ts#L623-L629); [C++ gte.h:61](../../../machine/cpp/machine/devices/gx/gte.h#L61), [C++ gte.h:84](../../../machine/cpp/machine/devices/gx/gte.h#L84); [C++ gte.cpp:488-494](../../../machine/cpp/machine/devices/gx/gte.cpp#L488-L494). |
| `0x3d` | GPF | 5 | M44_i(IR0 × IR_i); clamp IR; P | MI; P | [TS gte.ts:66](../../../machine/ts/machine/devices/gx/gte.ts#L66), [TS gte.ts:89](../../../machine/ts/machine/devices/gx/gte.ts#L89), [TS gte.ts:630-634](../../../machine/ts/machine/devices/gx/gte.ts#L630-L634); [C++ gte.h:62](../../../machine/cpp/machine/devices/gx/gte.h#L62), [C++ gte.h:85](../../../machine/cpp/machine/devices/gx/gte.h#L85); [C++ gte.cpp:495-499](../../../machine/cpp/machine/devices/gx/gte.cpp#L495-L499). |
| `0x3e` | GPL | 5 | M44_i(IR0 × IR_i + s32(MAC_i) × 2^(12sf)); clamp IR; P | MI; P | [TS gte.ts:67](../../../machine/ts/machine/devices/gx/gte.ts#L67), [TS gte.ts:90](../../../machine/ts/machine/devices/gx/gte.ts#L90), [TS gte.ts:635-639](../../../machine/ts/machine/devices/gx/gte.ts#L635-L639); [C++ gte.h:63](../../../machine/cpp/machine/devices/gx/gte.h#L63), [C++ gte.h:86](../../../machine/cpp/machine/devices/gx/gte.h#L86); [C++ gte.cpp:500-504](../../../machine/cpp/machine/devices/gx/gte.cpp#L500-L504). |
| `0x3f` | NCCT | 39 | NCCS stages for vectors 0,1,2 in order | MI; P × 3 | [TS gte.ts:68](../../../machine/ts/machine/devices/gx/gte.ts#L68), [TS gte.ts:91](../../../machine/ts/machine/devices/gx/gte.ts#L91), [TS gte.ts:640-646](../../../machine/ts/machine/devices/gx/gte.ts#L640-L646); [C++ gte.h:64](../../../machine/cpp/machine/devices/gx/gte.h#L64), [C++ gte.h:87](../../../machine/cpp/machine/devices/gx/gte.h#L87); [C++ gte.cpp:505-511](../../../machine/cpp/machine/devices/gx/gte.cpp#L505-L511). |

## Operand selection and shared color/lighting stages

- **Signed operands:** vector `v=0,1,2` reads `(s16lo(D[2v]),s16hi(D[2v]),s16lo(D[2v+1]))`; v=3 reads `(s16lo(D[9]),s16lo(D[10]),s16lo(D[11]))`. IR0 reads `s16lo(D[8])`, not an intrinsically unsigned coefficient. RGBC R/G/B are unsigned bytes of `D[6]`, CODE its high byte. Sources: [TS gte.ts:1161-1182](../../../machine/ts/machine/devices/gx/gte.ts#L1161-L1182), [TS gte.ts:1263-1285](../../../machine/ts/machine/devices/gx/gte.ts#L1263-L1285); [C++ gte.cpp:1033-1054](../../../machine/cpp/machine/devices/gx/gte.cpp#L1033-L1054), [C++ gte.cpp:1135-1157](../../../machine/cpp/machine/devices/gx/gte.cpp#L1135-L1157).
- **Matrix selections 0/1/2:** control base `b=8mx`; row-major matrix is `[[lo(C[b]),hi(C[b]),lo(C[b+1])],[hi(C[b+1]),lo(C[b+2]),hi(C[b+2])],[lo(C[b+3]),hi(C[b+3]),lo(C[b+4])]]`, all halves signed. Thus mx0 uses C0..4, mx1 C8..12, mx2 C16..20. Sources: [TS gte.ts:1196-1208](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1208); [C++ gte.cpp:1068-1080](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1080).
- **Matrix selection 3 is representable and implemented:** `r=unsigned RGBC.R`, `a=s16lo(C[1])`, `b=s16lo(C[2])`; matrix is `[[-16r,+16r,s16lo(D[8])],[a,a,a],[b,b,b]]`. It does not reject the command or select an unspecified replacement. Sources: [TS gte.ts:1184-1195](../../../machine/ts/machine/devices/gx/gte.ts#L1184-L1195); [C++ gte.cpp:1056-1067](../../../machine/cpp/machine/devices/gx/gte.cpp#L1056-L1067).
- **Control-vector selection:** cv0 reads signed words C5..7, cv1 C13..15, cv2 C21..23, cv3 zero. These are signed 32-bit words, unlike signed matrix halfwords. Sources: [TS gte.ts:1210-1215](../../../machine/ts/machine/devices/gx/gte.ts#L1210-L1215); [C++ gte.cpp:1082-1087](../../../machine/cpp/machine/devices/gx/gte.cpp#L1082-L1087).
- **Generic matrix stage:** snapshot all three signed input vector components, then for each zero-based row r, `a_r=A44(4096*CV_r, m_r0*x, m_r1*y, m_r2*z)`; `IR_(r+1)=I_(r+1)(M_(r+1)(a_r,overflow_r),lm)`. All three generic row accumulations are complete before any output IR is written. `L(v)` is this stage with matrix1, vector v, cv3=zero. `K` is this stage with matrix2, vector3=current IR, cv1=C13..15. Sources: [TS gte.ts:783-827](../../../machine/ts/machine/devices/gx/gte.ts#L783-L827); [C++ gte.cpp:646-689](../../../machine/cpp/machine/devices/gx/gte.cpp#L646-L689).
- **MVMVA differs from generic stage when cv2:** snapshot x,y,z. For each zero-based row r, first `a=A44(4096*CV_r,m_r0*x,0,0)` and write `IR_(r+1)=I_(r+1)(M_(r+1)(a,overflow),0)`; then `b=A44(0,m_r1*y,m_r2*z,0)` and overwrite `IR_(r+1)=I_(r+1)(M_(r+1)(b,overflow),lm)`. The first pass's arithmetic/clamp flags persist, but its control-vector/x contribution is absent from the final MAC and IR result. For cv0/1/3 it uses the full generic sum per row. Sources: [TS gte.ts:913-937](../../../machine/ts/machine/devices/gx/gte.ts#L913-L937); [C++ gte.cpp:777-811](../../../machine/cpp/machine/devices/gx/gte.cpp#L777-L811).
- **Color application `CA`:** per lane `IR_i=I_i(M44_i((RGBC.rgb_i*16)*IR_i),lm)` using signed current IR input. Sources: [TS gte.ts:828-837](../../../machine/ts/machine/devices/gx/gte.ts#L828-L837); [C++ gte.cpp:691-700](../../../machine/cpp/machine/devices/gx/gte.cpp#L691-L700).
- **Depth cue `DC(in)`:** far components are signed words C21,C22,C23. Snapshot `IR0=s16lo(D[8])`. First compute all three `d_i=I_i(M44_i(4096*far_i-in_i),0)`; those temporary differences update MAC but not the IR register words. Then each final `IR_i=I_i(M44_i(in_i+IR0*d_i),lm)`. Both stages use the selected sf, including the first stage; both contribute flags. Input scaling is exactly as listed in the command table: byte*65536 for DPCS/DPCT, signed IR*4096 for INTPL, or byte*16*signed IR for NCDS/CDP/DCPL. Sources: [TS gte.ts:773-781](../../../machine/ts/machine/devices/gx/gte.ts#L773-L781), [TS gte.ts:835-837](../../../machine/ts/machine/devices/gx/gte.ts#L835-L837), [TS gte.ts:886-892](../../../machine/ts/machine/devices/gx/gte.ts#L886-L892), [TS gte.ts:939-948](../../../machine/ts/machine/devices/gx/gte.ts#L939-L948), [TS gte.ts:1287-1297](../../../machine/ts/machine/devices/gx/gte.ts#L1287-L1297); [C++ gte.cpp:636-644](../../../machine/cpp/machine/devices/gx/gte.cpp#L636-L644), [C++ gte.cpp:698-700](../../../machine/cpp/machine/devices/gx/gte.cpp#L698-L700), [C++ gte.cpp:749-755](../../../machine/cpp/machine/devices/gx/gte.cpp#L749-L755), [C++ gte.cpp:813-822](../../../machine/cpp/machine/devices/gx/gte.cpp#L813-L822), [C++ gte.cpp:1159-1169](../../../machine/cpp/machine/devices/gx/gte.cpp#L1159-L1169).
- **Named color sequences:** NCS=`L;K;P`; NCCS=`L;K;CA;P`; NCDS=`L;K;DC(rgb*16*IR);P`; CC=`K;CA;P`; CDP=`K;DC(rgb*16*IR);P`; DCPL=`DC(rgb*16*IR);P`. Every selected sf/lm is forwarded to each stage; only explicit temporary clamps above force lm=0. Sources: [TS gte.ts:839-869](../../../machine/ts/machine/devices/gx/gte.ts#L839-L869), [TS gte.ts:881-884](../../../machine/ts/machine/devices/gx/gte.ts#L881-L884); [C++ gte.cpp:702-732](../../../machine/cpp/machine/devices/gx/gte.cpp#L702-L732), [C++ gte.cpp:744-747](../../../machine/cpp/machine/devices/gx/gte.cpp#L744-L747).
- **DPCT FIFO consumption:** each of three iterations reads the then-current D20, depth-cues its RGB bytes, and pushes the new result; hence the three initial FIFO entries are consumed in order. Each output CODE comes from RGBC, irrespective of the consumed entry's CODE. Sources: [TS gte.ts:886-892](../../../machine/ts/machine/devices/gx/gte.ts#L886-L892), [TS gte.ts:1133-1141](../../../machine/ts/machine/devices/gx/gte.ts#L1133-L1141), [TS gte.ts:1267-1269](../../../machine/ts/machine/devices/gx/gte.ts#L1267-L1269), [TS gte.ts:1283-1285](../../../machine/ts/machine/devices/gx/gte.ts#L1283-L1285); [C++ gte.cpp:749-755](../../../machine/cpp/machine/devices/gx/gte.cpp#L749-L755), [C++ gte.cpp:1006-1014](../../../machine/cpp/machine/devices/gx/gte.cpp#L1006-L1014), [C++ gte.cpp:1139-1141](../../../machine/cpp/machine/devices/gx/gte.cpp#L1139-L1141), [C++ gte.cpp:1155-1157](../../../machine/cpp/machine/devices/gx/gte.cpp#L1155-L1157).

## Direct arithmetic commands

- **OP:** snapshot `(u1,u2,u3)=signed IR1..3`; `(d1,d2,d3)` are the signed diagonal of rotation matrix C0..4. Write/limit `M_1(d2*u3-d3*u2)`, `M_2(d3*u1-d1*u3)`, `M_3(d1*u2-d2*u1)` with selected sf/lm. These calls explicitly pass false/false MAC overflow booleans. Sources: [TS gte.ts:763-771](../../../machine/ts/machine/devices/gx/gte.ts#L763-L771), [TS gte.ts:1217-1229](../../../machine/ts/machine/devices/gx/gte.ts#L1217-L1229); [C++ gte.cpp:626-634](../../../machine/cpp/machine/devices/gx/gte.cpp#L626-L634), [C++ gte.cpp:1089-1101](../../../machine/cpp/machine/devices/gx/gte.cpp#L1089-L1101).
- **SQR:** snapshot signed IR1..3; for each i write/limit `M_i(IR_i*IR_i)` with selected sf/lm; MAC overflow booleans explicitly false/false. Sources: [TS gte.ts:871-879](../../../machine/ts/machine/devices/gx/gte.ts#L871-L879); [C++ gte.cpp:734-742](../../../machine/cpp/machine/devices/gx/gte.cpp#L734-L742).
- **GPF:** signed IR0 times signed IR_i, through `M44_i` and the selected IR clamp; one P. **GPL:** same but adds the signed public MAC word `s32(D[24+i]) * (sf?4096:1)` before M44; one P. GPL does not use the private unshifted accumulator as its old-MAC operand. Sources: [TS gte.ts:894-911](../../../machine/ts/machine/devices/gx/gte.ts#L894-L911); [C++ gte.cpp:757-775](../../../machine/cpp/machine/devices/gx/gte.cpp#L757-L775).
- **NCLIP:** signed halves of D12,D13,D14 give `(sx0,sy0)..(sx2,sy2)`; `M0(sx0*sy1+sx1*sy2+sx2*sy0-sx0*sy2-sx1*sy0-sx2*sy1)`. No output FIFO push. Sources: [TS gte.ts:998-1007](../../../machine/ts/machine/devices/gx/gte.ts#L998-L1007), [TS gte.ts:1299-1305](../../../machine/ts/machine/devices/gx/gte.ts#L1299-L1305); [C++ gte.cpp:872-881](../../../machine/cpp/machine/devices/gx/gte.cpp#L872-L881), [C++ gte.cpp:1171-1177](../../../machine/cpp/machine/devices/gx/gte.cpp#L1171-L1177).
- **AVSZ3:** `x=s16lo(C[29])*(u16lo(D[17])+u16lo(D[18])+u16lo(D[19]))`; `M0(x)` then `D[7]=clamp(ASR(x,12),0,65535)`. **AVSZ4:** same with s16lo(C30) and D16..19. Both use the full product for depth output, not wrapped MAC0. Out-of-range depth sets SZ_OTZ+ERROR. Sources: [TS gte.ts:1009-1019](../../../machine/ts/machine/devices/gx/gte.ts#L1009-L1019), [TS gte.ts:1059-1069](../../../machine/ts/machine/devices/gx/gte.ts#L1059-L1069), [TS gte.ts:1255-1261](../../../machine/ts/machine/devices/gx/gte.ts#L1255-L1261), [TS gte.ts:1307-1309](../../../machine/ts/machine/devices/gx/gte.ts#L1307-L1309); [C++ gte.cpp:883-893](../../../machine/cpp/machine/devices/gx/gte.cpp#L883-L893), [C++ gte.cpp:933-943](../../../machine/cpp/machine/devices/gx/gte.cpp#L933-L943), [C++ gte.cpp:1127-1133](../../../machine/cpp/machine/devices/gx/gte.cpp#L1127-L1133), [C++ gte.cpp:1179-1181](../../../machine/cpp/machine/devices/gx/gte.cpp#L1179-L1181).

## Projection `RT(v,last)` and its exact divide

- **Rotation/translation:** for each zero-based row r, signed 16-bit rotation row times signed vector v and signed32 C5..7 translation: ordered `A44(4096*TR_r,RT_r0*vx,RT_r1*vy,RT_r2*vz)` feeds `M_(r+1)`. IR1/2 clamp the returned signed32 shifted MAC with lm. Sources: [TS gte.ts:950-982](../../../machine/ts/machine/devices/gx/gte.ts#L950-L982), [TS gte.ts:1217-1233](../../../machine/ts/machine/devices/gx/gte.ts#L1217-L1233); [C++ gte.cpp:824-856](../../../machine/cpp/machine/devices/gx/gte.cpp#L824-L856), [C++ gte.cpp:1089-1105](../../../machine/cpp/machine/devices/gx/gte.cpp#L1089-L1105).
- **Projection IR3 special rule:** output IR3 clamps the signed public MAC3 word according to lm, but the IR3-saturation flag tests `ASR(privateMAC3,12)` against `[-32768,32767]` irrespective of sf or lm. Thus an lm=1 clamp of a negative value does not, by that fact alone, set IR3_SAT, and sf=0 may clamp its output without the flag if the fixed-12 value is in range. Sources: [TS gte.ts:1036-1050](../../../machine/ts/machine/devices/gx/gte.ts#L1036-L1050); [C++ gte.cpp:910-924](../../../machine/cpp/machine/devices/gx/gte.cpp#L910-L924).
- **Depth FIFO:** push `ASR(privateMAC3,12)` clamped to `[0,65535]`: D16←oldD17, D17←oldD18, D18←oldD19, D19←clamped depth. Clamp sets SZ_OTZ+ERROR. This shift is always 12, independent of sf. Sources: [TS gte.ts:983-984](../../../machine/ts/machine/devices/gx/gte.ts#L983-L984), [TS gte.ts:1052-1069](../../../machine/ts/machine/devices/gx/gte.ts#L1052-L1069); [C++ gte.cpp:857-858](../../../machine/cpp/machine/devices/gx/gte.cpp#L857-L858), [C++ gte.cpp:926-943](../../../machine/cpp/machine/devices/gx/gte.cpp#L926-L943).
- **Projection input interpretation:** H is unsigned low16 C26; OFX/OFY are signed32 C24/C25; DQA is signed low16 C27, DQB signed32 C28; SZ3 unsigned low16 D19. Sources: [TS gte.ts:1235-1253](../../../machine/ts/machine/devices/gx/gte.ts#L1235-L1253), [TS gte.ts:1307-1309](../../../machine/ts/machine/devices/gx/gte.ts#L1307-L1309); [C++ gte.cpp:1107-1125](../../../machine/cpp/machine/devices/gx/gte.cpp#L1107-L1125), [C++ gte.cpp:1179-1181](../../../machine/cpp/machine/devices/gx/gte.cpp#L1179-L1181).
- **Exact reciprocal-table divide:** let unsigned16 `n=H`, `d=SZ3`. If `n>=2*d` (including d=0), raise DIV_OVERFLOW+ERROR and return `q=0x1ffff`. Otherwise d>0, and compute `s=CLZ16(d)`, `r1=(d<<s)&0x7fff`, `r2=T[(r1+0x40)>>7]+0x101`, `r3=((U32(0x80-r2*(r1+0x8000)))>>8)&0x1ffff`, `reciprocal=(r2*r3+0x80)>>8`, `rawq=(reciprocal*(n<<s)+0x8000)>>16`. The last product is widened (u64 in C++, exact integer Number in TS). Return `min(rawq,0x1ffff)`; clamping an oversized rawq from this valid branch does not set DIV_OVERFLOW. This is not generic mathematical H/SZ division. Full literal table T is below. Sources: [TS gte.ts:120-138](../../../machine/ts/machine/devices/gx/gte.ts#L120-L138), [TS gte.ts:1071-1094](../../../machine/ts/machine/devices/gx/gte.ts#L1071-L1094); [C++ gte.cpp:18-36](../../../machine/cpp/machine/devices/gx/gte.cpp#L18-L36), [C++ gte.cpp:945-967](../../../machine/cpp/machine/devices/gx/gte.cpp#L945-L967).
- **Screen FIFO/output:** shift D12←oldD13, D13←oldD14. `M0(OFX+signedIR1*q)`, `sx=clamp(ASR(privateMAC0,16),-1024,1023)`; `M0(OFY+signedIR2*q)`, `sy=clamp(ASR(privateMAC0,16),-1024,1023)`; write D14 packed low16 sx/high16 sy. Each screen clamp sets SX2/SY2+ERROR. No clipping/rejection: a saturated coordinate is still pushed. Sources: [TS gte.ts:985-991](../../../machine/ts/machine/devices/gx/gte.ts#L985-L991), [TS gte.ts:1096-1106](../../../machine/ts/machine/devices/gx/gte.ts#L1096-L1106); [C++ gte.cpp:859-865](../../../machine/cpp/machine/devices/gx/gte.cpp#L859-L865), [C++ gte.cpp:969-979](../../../machine/cpp/machine/devices/gx/gte.cpp#L969-L979).
- **Last-vertex depth cue:** only when last=true, `M0(DQB+DQA*q)`, then `D[8]=clamp(ASR(privateMAC0,12),0,4096)`; strictly outside range sets IR0_SAT. RTPS sets last for vector0. RTPT invokes vectors0,1 with last=false then vector2 with last=true, so only the third projection computes IR0 and the final public MAC0 is that last cue result. Sources: [TS gte.ts:529-533](../../../machine/ts/machine/devices/gx/gte.ts#L529-L533), [TS gte.ts:623-629](../../../machine/ts/machine/devices/gx/gte.ts#L623-L629), [TS gte.ts:992-995](../../../machine/ts/machine/devices/gx/gte.ts#L992-L995), [TS gte.ts:1108-1119](../../../machine/ts/machine/devices/gx/gte.ts#L1108-L1119); [C++ gte.cpp:394-398](../../../machine/cpp/machine/devices/gx/gte.cpp#L394-L398), [C++ gte.cpp:488-494](../../../machine/cpp/machine/devices/gx/gte.cpp#L488-L494), [C++ gte.cpp:866-869](../../../machine/cpp/machine/devices/gx/gte.cpp#L866-L869), [C++ gte.cpp:981-992](../../../machine/cpp/machine/devices/gx/gte.cpp#L981-L992).

### Literal divide seed ROM T (257 unsigned bytes)

These bytes are identical in both owner initializers. Offset is the hexadecimal array index, not an MMIO address. Sources: [TS gte.ts:120-138](../../../machine/ts/machine/devices/gx/gte.ts#L120-L138); [C++ gte.cpp:18-36](../../../machine/cpp/machine/devices/gx/gte.cpp#L18-L36).

| Offset | +0 | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 | +a | +b | +c | +d | +e | +f |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `000` | `0xff` | `0xfd` | `0xfb` | `0xf9` | `0xf7` | `0xf5` | `0xf3` | `0xf1` | `0xef` | `0xee` | `0xec` | `0xea` | `0xe8` | `0xe6` | `0xe4` | `0xe3` |
| `010` | `0xe1` | `0xdf` | `0xdd` | `0xdc` | `0xda` | `0xd8` | `0xd6` | `0xd5` | `0xd3` | `0xd1` | `0xd0` | `0xce` | `0xcd` | `0xcb` | `0xc9` | `0xc8` |
| `020` | `0xc6` | `0xc5` | `0xc3` | `0xc1` | `0xc0` | `0xbe` | `0xbd` | `0xbb` | `0xba` | `0xb8` | `0xb7` | `0xb5` | `0xb4` | `0xb2` | `0xb1` | `0xb0` |
| `030` | `0xae` | `0xad` | `0xab` | `0xaa` | `0xa9` | `0xa7` | `0xa6` | `0xa4` | `0xa3` | `0xa2` | `0xa0` | `0x9f` | `0x9e` | `0x9c` | `0x9b` | `0x9a` |
| `040` | `0x99` | `0x97` | `0x96` | `0x95` | `0x94` | `0x92` | `0x91` | `0x90` | `0x8f` | `0x8d` | `0x8c` | `0x8b` | `0x8a` | `0x89` | `0x87` | `0x86` |
| `050` | `0x85` | `0x84` | `0x83` | `0x82` | `0x81` | `0x7f` | `0x7e` | `0x7d` | `0x7c` | `0x7b` | `0x7a` | `0x79` | `0x78` | `0x77` | `0x75` | `0x74` |
| `060` | `0x73` | `0x72` | `0x71` | `0x70` | `0x6f` | `0x6e` | `0x6d` | `0x6c` | `0x6b` | `0x6a` | `0x69` | `0x68` | `0x67` | `0x66` | `0x65` | `0x64` |
| `070` | `0x63` | `0x62` | `0x61` | `0x60` | `0x5f` | `0x5e` | `0x5d` | `0x5d` | `0x5c` | `0x5b` | `0x5a` | `0x59` | `0x58` | `0x57` | `0x56` | `0x55` |
| `080` | `0x54` | `0x53` | `0x53` | `0x52` | `0x51` | `0x50` | `0x4f` | `0x4e` | `0x4d` | `0x4d` | `0x4c` | `0x4b` | `0x4a` | `0x49` | `0x48` | `0x48` |
| `090` | `0x47` | `0x46` | `0x45` | `0x44` | `0x43` | `0x43` | `0x42` | `0x41` | `0x40` | `0x3f` | `0x3f` | `0x3e` | `0x3d` | `0x3c` | `0x3c` | `0x3b` |
| `0a0` | `0x3a` | `0x39` | `0x39` | `0x38` | `0x37` | `0x36` | `0x36` | `0x35` | `0x34` | `0x33` | `0x33` | `0x32` | `0x31` | `0x31` | `0x30` | `0x2f` |
| `0b0` | `0x2e` | `0x2e` | `0x2d` | `0x2c` | `0x2c` | `0x2b` | `0x2a` | `0x2a` | `0x29` | `0x28` | `0x28` | `0x27` | `0x26` | `0x26` | `0x25` | `0x24` |
| `0c0` | `0x24` | `0x23` | `0x22` | `0x22` | `0x21` | `0x20` | `0x20` | `0x1f` | `0x1e` | `0x1e` | `0x1d` | `0x1d` | `0x1c` | `0x1b` | `0x1b` | `0x1a` |
| `0d0` | `0x19` | `0x19` | `0x18` | `0x18` | `0x17` | `0x16` | `0x16` | `0x15` | `0x15` | `0x14` | `0x14` | `0x13` | `0x12` | `0x12` | `0x11` | `0x11` |
| `0e0` | `0x10` | `0x0f` | `0x0f` | `0x0e` | `0x0e` | `0x0d` | `0x0d` | `0x0c` | `0x0c` | `0x0b` | `0x0a` | `0x0a` | `0x09` | `0x09` | `0x08` | `0x08` |
| `0f0` | `0x07` | `0x07` | `0x06` | `0x06` | `0x05` | `0x05` | `0x04` | `0x04` | `0x03` | `0x03` | `0x02` | `0x02` | `0x01` | `0x01` | `0x00` | `0x00` |
| `100` | `0x00` | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |

## GTE_PLUS VMAD3

- **Command field/cycles:** low8 `commandWord & 0xff == 0x01` selects VMAD3; all upper command bits are ignored. VMAD3 is 5 scheduler cycles; every other low8 value is an invalid command taking 1 scheduler cycle. PLUS does not decode the base `sf`, `lm`, mx/v/cv fields. Sources: [TS gte.ts:33-36](../../../machine/ts/machine/devices/gx/gte.ts#L33-L36), [TS gte.ts:391-418](../../../machine/ts/machine/devices/gx/gte.ts#L391-L418); [C++ gte.h:29-32](../../../machine/cpp/machine/devices/gx/gte.h#L29-L32); [C++ gte.cpp:256-283](../../../machine/cpp/machine/devices/gx/gte.cpp#L256-L283).
- **Lane operands:** signed16 x/y come from low/high halves of ADD_XY and MUL_XY; signed16 z from the low halves of ADD_Z/MUL_Z; scalar is signed low16 SCALAR. The upper halves of Z and scalar input words are not consumed by the arithmetic. Sources: [TS gte.ts:395-406](../../../machine/ts/machine/devices/gx/gte.ts#L395-L406); [C++ gte.cpp:260-271](../../../machine/cpp/machine/devices/gx/gte.cpp#L260-L271).
- **Lane arithmetic:** `t_i=ASR(4096*addend_i + multiplicand_i*scalar,12)`; the pre-shift expression fits signed32 for all three signed16 inputs and is evaluated as such in C++ (JS `>>12` applies the same signed32 arithmetic shift). No intermediate saturation, rounding bias, or 44-bit MAC is involved. `result_i=clamp(t_i,-32768,32767)`. Only strict `t_i>32767` or `t_i<-32768` sets positive/negative lane flags respectively, together with ERROR. Flags start at zero for each accepted VMAD3. Sources: [TS gte.ts:394](../../../machine/ts/machine/devices/gx/gte.ts#L394), [TS gte.ts:420-431](../../../machine/ts/machine/devices/gx/gte.ts#L420-L431); [C++ gte.cpp:259](../../../machine/cpp/machine/devices/gx/gte.cpp#L259), [C++ gte.cpp:285-296](../../../machine/cpp/machine/devices/gx/gte.cpp#L285-L296).
- **Lane flags:** ERROR=`0x80000000`; X+/Y+/Z+=`0x40000000/0x20000000/0x10000000`; X−/Y−/Z−=`0x08000000/0x04000000/0x02000000`; INVALID=`0x01000000`. These are PLUS flags, separate from C31 base-GTE FLAG. Sources: [TS gte.ts:38-45](../../../machine/ts/machine/devices/gx/gte.ts#L38-L45), [TS gte.ts:394-413](../../../machine/ts/machine/devices/gx/gte.ts#L394-L413), [TS gte.ts:420-428](../../../machine/ts/machine/devices/gx/gte.ts#L420-L428); [C++ gte.h:34-41](../../../machine/cpp/machine/devices/gx/gte.h#L34-L41); [C++ gte.cpp:259-278](../../../machine/cpp/machine/devices/gx/gte.cpp#L259-L278), [C++ gte.cpp:285-293](../../../machine/cpp/machine/devices/gx/gte.cpp#L285-L293).
- **Result words:** pending RESULT_XY=`(x&0xffff)|((y&0xffff)<<16)`; pending RESULT_Z=`z&0xffff`, with zero upper16 even for negative z. VMAD3 writes no base-GTE data/control registers or MAC/IR/RGB/depth/screen FIFOs. Sources: [TS gte.ts:391-418](../../../machine/ts/machine/devices/gx/gte.ts#L391-L418); [C++ gte.cpp:256-283](../../../machine/cpp/machine/devices/gx/gte.cpp#L256-L283).
- **Invalid PLUS command:** copy the previously published RESULT_XY/RESULT_Z into pending results; pending FLAG=`0x81000000` (ERROR|INVALID); schedule 1 cycle. It neither zeroes the outputs nor raises an exception nor runs a valid arithmetic command. Sources: [TS gte.ts:410-418](../../../machine/ts/machine/devices/gx/gte.ts#L410-L418); [C++ gte.cpp:275-283](../../../machine/cpp/machine/devices/gx/gte.cpp#L275-L283).
- **Publication distinction:** base command MMIO executes arithmetic immediately and stores the returned nominal count; there is no base busy timer in that path. PLUS computes pending results/flags at command admission, stores CYCLES=`0x80000000|5` (or `|1` invalid) and a completion deadline, and only at completion publishes RESULT_XY/RESULT_Z/FLAG and clears the busy bit. Published outputs and FLAG therefore remain the prior command's values while busy. PLUS CYCLES lower bits remain the nominal cost, not a countdown. Sources: [TS gte.ts:318-325](../../../machine/ts/machine/devices/gx/gte.ts#L318-L325), [TS gte.ts:344-350](../../../machine/ts/machine/devices/gx/gte.ts#L344-L350), [TS gte.ts:391-418](../../../machine/ts/machine/devices/gx/gte.ts#L391-L418); [C++ gte.cpp:176-183](../../../machine/cpp/machine/devices/gx/gte.cpp#L176-L183), [C++ gte.cpp:206-216](../../../machine/cpp/machine/devices/gx/gte.cpp#L206-L216), [C++ gte.cpp:256-283](../../../machine/cpp/machine/devices/gx/gte.cpp#L256-L283).

## Derived programmer raw-word sequences/results

These are arithmetic derivations from the cited owners, not independent runtime-test evidence. Addresses/access timing are established in the register facts above. A write to indexed D/C means the word at its base plus `4*index`.

### 1. Integer projection with a Q12 identity rotation

Precondition: reset-zero GTE (so translation, screen offsets, depth cue constants, FIFO entries and FLAG are zero). Program only these raw words:

| Destination | Raw word | Datapath meaning |
|---|---|---|
| C0 | `0x00001000` | RT row0 begins (4096,0) |
| C2 | `0x00001000` | RT row1 diagonal 4096 |
| C4 | `0x00001000` | RT row2 diagonal 4096 |
| C26 | `0x00000100` | H=256 |
| D0 | `0x00200040` | vector0 x=64, y=32 |
| D1 | `0x00000200` | vector0 z=512 |
| COMMAND | `0x00080001` | low6 RTPS, sf=1, lm=0 |

Derivation: private rotation sums `(262144,131072,2097152)`, selected shift gives MAC/IR `(64,32,512)`. Fixed-12 depth gives 512. Divide has `s=6`, `r1=0`, `T[0]=255`, `r2=512`, `r3=65536`, `reciprocal=131072`, `rawq=32768`. Screen coordinates are `(ASR(64*32768,16),ASR(32*32768,16))=(32,16)`. DQA/DQB zero yield MAC0=IR0=0.

| Observable after base command write | Expected raw word(s) |
|---|---|
| D9,D10,D11 (IR1..3) | `0x00000040`, `0x00000020`, `0x00000200` |
| D25,D26,D27 (MAC1..3) | `0x00000040`, `0x00000020`, `0x00000200` |
| D16,D17,D18,D19 (depth FIFO) | `0x00000000`, `0x00000000`, `0x00000000`, `0x00000200` |
| D12,D13,D14 (packed screen FIFO) | `0x00000000`, `0x00000000`, `0x00100020` |
| D24 (MAC0), D8 (IR0), C31 (FLAG) | all `0x00000000` |
| CYCLES | `0x0000000f` |

Sources of derivation: reset [TS gte.ts:225-249](../../../machine/ts/machine/devices/gx/gte.ts#L225-L249) / [C++ gte.cpp:88-112](../../../machine/cpp/machine/devices/gx/gte.cpp#L88-L112); matrix/vector decode [TS gte.ts:1161-1171](../../../machine/ts/machine/devices/gx/gte.ts#L1161-L1171), [TS gte.ts:1217-1253](../../../machine/ts/machine/devices/gx/gte.ts#L1217-L1253) / [C++ gte.cpp:1033-1043](../../../machine/cpp/machine/devices/gx/gte.cpp#L1033-L1043), [C++ gte.cpp:1089-1125](../../../machine/cpp/machine/devices/gx/gte.cpp#L1089-L1125); command/arithmetic/divide [TS gte.ts:47](../../../machine/ts/machine/devices/gx/gte.ts#L47), [TS gte.ts:70](../../../machine/ts/machine/devices/gx/gte.ts#L70), [TS gte.ts:525-533](../../../machine/ts/machine/devices/gx/gte.ts#L525-L533), [TS gte.ts:950-995](../../../machine/ts/machine/devices/gx/gte.ts#L950-L995), [TS gte.ts:1036-1094](../../../machine/ts/machine/devices/gx/gte.ts#L1036-L1094) / [C++ gte.h:43](../../../machine/cpp/machine/devices/gx/gte.h#L43), [C++ gte.h:66](../../../machine/cpp/machine/devices/gx/gte.h#L66) / [C++ gte.cpp:390-398](../../../machine/cpp/machine/devices/gx/gte.cpp#L390-L398), [C++ gte.cpp:824-870](../../../machine/cpp/machine/devices/gx/gte.cpp#L824-L870), [C++ gte.cpp:910-967](../../../machine/cpp/machine/devices/gx/gte.cpp#L910-L967).

### 2. Q12 three-lane multiply-add (independent PLUS registerfile)

Represent addend `(1,2,3)`, multiplicand `(2,1,-1)` and scalar `1/2` as signed integers scaled by 4096. Program the raw words below (any upper16 in Z/scalar would be ignored by VMAD3):

| PLUS destination | Raw word | Signed decoded value(s) |
|---|---|---|
| ADD_XY | `0x20001000` | (4096,8192) |
| ADD_Z | `0x00003000` | 12288 |
| MUL_XY | `0x10002000` | (8192,4096) |
| MUL_Z | `0x0000f000` | -4096 |
| SCALAR | `0x00000800` | 2048 |
| COMMAND | `0x00000001` | VMAD3 |

Derived lane result `(8192,10240,10240)` encodes `(2,2.5,2.5)` in Q12. While busy CYCLES=`0x80000005` and result/flag reads remain previous published values. At publication after five scheduler cycles: RESULT_XY=`0x28002000`, RESULT_Z=`0x00002800`, FLAG=`0x00000000`, CYCLES=`0x00000005`. The base GTE words/flags are unchanged.

Sources of derivation: [TS gte.ts:22-45](../../../machine/ts/machine/devices/gx/gte.ts#L22-L45), [TS gte.ts:318-325](../../../machine/ts/machine/devices/gx/gte.ts#L318-L325), [TS gte.ts:391-431](../../../machine/ts/machine/devices/gx/gte.ts#L391-L431); [C++ gte.h:18-41](../../../machine/cpp/machine/devices/gx/gte.h#L18-L41); [C++ gte.cpp:176-183](../../../machine/cpp/machine/devices/gx/gte.cpp#L176-L183), [C++ gte.cpp:256-296](../../../machine/cpp/machine/devices/gx/gte.cpp#L256-L296).

## Scope gaps and limits
- The mirrored BMSX IO specs define placement/counts, not an independent arithmetic opcode specification; operation semantics above are owner-derived, not claimed to be prescribed by an absent separate spec. Sources: [TS io.ts:117-129](../../../machine/ts/spec/bmsx/io.ts#L117-L129), [TS io.ts:174-181](../../../machine/ts/spec/bmsx/io.ts#L174-L181); [C++ io.h:130-142](../../../machine/cpp/spec/bmsx/io.h#L130-L142), [C++ io.h:187-194](../../../machine/cpp/spec/bmsx/io.h#L187-L194).
- The owners return nominal base command cycle counts and publish PLUS against scheduler cycles. Do not infer from these files alone a separate physical clock frequency, a CPU instruction stall equal to a base command's nominal cost, floating-point geometry arithmetic, an external GTE revision, or undocumented PSX compatibility.

- No legacy-console names, silicon behavior, undocumented opcodes, or external/manual conformance assertion.
- No independently executed TS/native parity test accompanies these source facts; source mirrors were compared at the listed boundaries. No performance claim.
- No canonical scoped-source semantic label for DATA23, nor canonical historical acronyms for DATA28/29 or DATA30/31. Keep the explicit functional labels unless another authorized source defines aliases.
- No whole-machine save-state policy claim, exception-handler policy, DMA-channel completion/fault result for a denied PLUS destination, or MMIO alias outside the inspected Memory paths. The expanded timing scope below establishes the installed system-cycle frequency; it does not establish an independent physical GTE/IO bus clock or bandwidth.


## Technical specifications and timing supplement

Editorial extraction for the added specification/performance overview. Scope was
expanded to the mirrored installed model, runtime timing initialization, CPU
instruction costs/dispatch, scheduler time, machine advancement, and mapped IO
admission. No architecture document, reference PDF, external-console specification,
tests, or runtime implementation changes were used. The existing sheet remains the
source for the complete arithmetic/register/fault contract. No disagreement was
found between the mirrored facts below.

### Installed model and storage

- **SPE1 — Installed frequency and adjacent memory capacities.** The installed model
  specifies `cpuFreqHz=33_868_800`, `ramBytes=0x00400000` and
  `gxGpuVramBytes=0x00200000`. These are respectively 33.8688 MHz, 4 MiB and 2 MiB
  (`1 MiB=2^20 bytes`). They are not three GTE-local resources. Sources:
  [TS model.ts:7-12](../../../machine/ts/spec/bmsx/model.ts#L7-L12),
  [TS model.ts:46-56](../../../machine/ts/spec/bmsx/model.ts#L46-L56);
  [C++ model.h:12-17](../../../machine/cpp/spec/bmsx/model.h#L12-L17),
  [C++ model.h:51-61](../../../machine/cpp/spec/bmsx/model.h#L51-L61).
- **SPE2 — Capacities are installed at their owners.** Runtime initialization gives
  RAM capacity to Memory; machine construction gives VRAM capacity to GPU. GTE
  receives Memory, CPU and scheduler, not a local-memory size. Its command handlers
  obtain operands/results from its register words; they do not fetch a vertex
  array from RAM, access VRAM or perform a memory transfer. Thus the GTE register
  windows are not an attached local RAM/VRAM capacity. Sources:
  [TS runtime.ts:126-139](../../../machine/ts/machine/runtime/runtime.ts#L126-L139),
  [TS machine.ts:68-84](../../../machine/ts/machine/machine.ts#L68-L84),
  [TS gte.ts:182-222](../../../machine/ts/machine/devices/gx/gte.ts#L182-L222),
  [TS gte.ts:433-649](../../../machine/ts/machine/devices/gx/gte.ts#L433-L649);
  [C++ runtime.cpp:8-22](../../../machine/cpp/machine/runtime/runtime.cpp#L8-L22),
  [C++ machine.cpp:7-24](../../../machine/cpp/machine/machine.cpp#L7-L24),
  [C++ gte.h:143-162](../../../machine/cpp/machine/devices/gx/gte.h#L143-L162),
  [C++ gte.cpp:298-514](../../../machine/cpp/machine/devices/gx/gte.cpp#L298-L514).
- **SPE3 — Register-window sizes, not independent memory bytes.** Data and control
  each have 32 four-byte slots: 128 bytes of address space each. Normal COMMAND and
  CYCLES are two further four-byte slots. PLUS has ten slots: 40 bytes of address
  space. Aliases, derived reads and output/write rules prevent treating those slots
  as ordinary RAM. Sources:
  [TS io.ts:117-128](../../../machine/ts/spec/bmsx/io.ts#L117-L128),
  [TS memory_map.ts:23-33](../../../machine/ts/spec/bmsx/memory_map.ts#L23-L33),
  [TS gte.ts:433-523](../../../machine/ts/machine/devices/gx/gte.ts#L433-L523);
  [C++ io.h:130-141](../../../machine/cpp/spec/bmsx/io.h#L130-L141),
  [C++ memory_map.h:29-39](../../../machine/cpp/spec/bmsx/memory_map.h#L29-L39),
  [C++ gte.cpp:298-388](../../../machine/cpp/machine/devices/gx/gte.cpp#L298-L388).
- **SPE4 — Normal operand/output capacities.** Three XYZ input vectors have signed
  16-bit components; three stored 3x3 matrices have signed 16-bit coefficients;
  their three associated XYZ control vectors have signed 32-bit components. The
  screen history contains three packed signed-16 coordinate pairs; command-produced
  coordinates clamp to -1024..1023. The depth history contains four unsigned-16
  entries. The color history contains three words, each RGB8 plus CODE8. Main
  MAC1..3 accumulation uses signed 44-bit wrap and exposes shifted low32 words;
  IR1..3 clamp to signed16 or nonnegative signed16 according to LM. These are the
  existing arithmetic facts summarized, not new datapath rules. Sources:
  [TS gte.ts:116-155](../../../machine/ts/machine/devices/gx/gte.ts#L116-L155),
  [TS gte.ts:680-761](../../../machine/ts/machine/devices/gx/gte.ts#L680-L761),
  [TS gte.ts:983-991](../../../machine/ts/machine/devices/gx/gte.ts#L983-L991),
  [TS gte.ts:1096-1106](../../../machine/ts/machine/devices/gx/gte.ts#L1096-L1106),
  [TS gte.ts:1133-1140](../../../machine/ts/machine/devices/gx/gte.ts#L1133-L1140),
  [TS gte.ts:1161-1214](../../../machine/ts/machine/devices/gx/gte.ts#L1161-L1214);
  [C++ gte.cpp:14-53](../../../machine/cpp/machine/devices/gx/gte.cpp#L14-L53),
  [C++ gte.cpp:545-624](../../../machine/cpp/machine/devices/gx/gte.cpp#L545-L624),
  [C++ gte.cpp:857-865](../../../machine/cpp/machine/devices/gx/gte.cpp#L857-L865),
  [C++ gte.cpp:969-979](../../../machine/cpp/machine/devices/gx/gte.cpp#L969-L979),
  [C++ gte.cpp:1006-1013](../../../machine/cpp/machine/devices/gx/gte.cpp#L1006-L1013),
  [C++ gte.cpp:1033-1086](../../../machine/cpp/machine/devices/gx/gte.cpp#L1033-L1086).

### Timebase and charged cycles

- **TIM1 — Installed CPU/system-cycle mapping is actually used.** TimingState
  initializes `cpuHz=model.cpuFreqHz` and cycles-per-millisecond from that same
  frequency. Scheduler time within a CPU slice is `sliceBase + sliceBudget -
  instructionBudgetRemaining`; outside a slice it is committed scheduler time.
  CPU execution advances machine/scheduler time by the consumed instruction budget.
  The PLUS deadline is in those same cycles, not an unrelated frame counter.
  Sources:
  [TS state.ts:23-32](../../../machine/ts/machine/runtime/timing/state.ts#L23-L32),
  [TS device.ts:52-67](../../../machine/ts/machine/scheduler/device.ts#L52-L67),
  [TS cpu_executor.ts:183-190](../../../machine/ts/machine/runtime/cpu_executor.ts#L183-L190),
  [TS machine.ts:129-132](../../../machine/ts/machine/machine.ts#L129-L132);
  [C++ state.cpp:10-22](../../../machine/cpp/machine/runtime/timing/state.cpp#L10-L22),
  [C++ device.cpp:33-38](../../../machine/cpp/machine/scheduler/device.cpp#L33-L38),
  [C++ cpu_executor.cpp:164-171](../../../machine/cpp/machine/runtime/cpu_executor.cpp#L164-L171),
  [C++ machine.cpp:72-75](../../../machine/cpp/machine/machine.cpp#L72-L75).
- **TIM2 — Normal command cost is not charged to the CPU by GTE.** The normal
  command handler calls execute synchronously, stores its returned nominal duration,
  and does not debit CPU budget, set busy, arrange a deadline or synchronize PLUS.
  The scalar CPU store dispatch checks target readiness then writes through Memory;
  ordinary normal-GTE slots have no ready handler. The instruction loop charges
  the CPU instruction's base cost independently. Source cost tables assign two
  cycles to LOAD_MEM/LOAD_MEM_D and STORE_MEM/STORE_MEM_D; decoded-dispatch tables
  copy those costs. Therefore an admitted direct word-store instruction to normal
  COMMAND has a two-cycle instruction base cost, not that cost plus the operation's
  nominal CYCLES. This is a source derivation, not a measured cartridge loop or a
  bus-rate measurement. Sources:
  [TS gte.ts:205-222](../../../machine/ts/machine/devices/gx/gte.ts#L205-L222),
  [TS gte.ts:344-350](../../../machine/ts/machine/devices/gx/gte.ts#L344-L350),
  [TS opcode.ts:1-15](../../../machine/ts/spec/blua32/opcode.ts#L1-L15),
  [TS opcode.ts:51-53](../../../machine/ts/spec/blua32/opcode.ts#L51-L53),
  [TS opcode.ts:75-84](../../../machine/ts/spec/blua32/opcode.ts#L75-L84),
  [TS execution_image.ts:20-24](../../../machine/ts/machine/cpu/execution_image.ts#L20-L24),
  [TS cpu.ts:1844-1849](../../../machine/ts/machine/cpu/cpu.ts#L1844-L1849),
  [TS cpu.ts:3117-3153](../../../machine/ts/machine/cpu/cpu.ts#L3117-L3153);
  [C++ gte.cpp:68-85](../../../machine/cpp/machine/devices/gx/gte.cpp#L68-L85),
  [C++ gte.cpp:206-216](../../../machine/cpp/machine/devices/gx/gte.cpp#L206-L216),
  [C++ opcode.cpp:5-19](../../../machine/cpp/spec/blua32/opcode.cpp#L5-L19),
  [C++ opcode.cpp:55-57](../../../machine/cpp/spec/blua32/opcode.cpp#L55-L57),
  [C++ execution_image.cpp:7-14](../../../machine/cpp/machine/cpu/execution_image.cpp#L7-L14),
  [C++ cpu.cpp:2470-2479](../../../machine/cpp/machine/cpu/cpu.cpp#L2470-L2479),
  [C++ cpu_dispatch.inl:646-668](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L646-L668).
- **TIM3 — Nominal normal cost range.** The 22 recognized functions return counts
  from 5 through 44; RTPS returns 15, RTPT 23, MVMVA 8. An unknown low6 function
  returns zero without arithmetic/FLAG changes; its mapped write still becomes the
  last raw COMMAND and sets last CYCLES to zero. These counts do not establish an
  elapsed-time or throughput formula. Sources:
  [TS gte.ts:47-91](../../../machine/ts/machine/devices/gx/gte.ts#L47-L91),
  [TS gte.ts:525-649](../../../machine/ts/machine/devices/gx/gte.ts#L525-L649);
  [C++ gte.h:43-87](../../../machine/cpp/machine/devices/gx/gte.h#L43-L87),
  [C++ gte.cpp:390-514](../../../machine/cpp/machine/devices/gx/gte.cpp#L390-L514).
- **TIM4 — PLUS latency and one-deep admission.** VMAD3 low8=1 consumes signed16
  operands and computes three pending saturated signed16 lanes using fixed
  arithmetic `(4096*addend + multiplicand*scalar) ASR 12`; it starts with a five-cycle
  deadline. Other low8 values retain old results, set pending FLAG=0x81000000 and
  use one cycle. PLUS has one pending result set, no command queue; current input
  words may be changed while pending without changing that pending set. At/after
  the deadline a PLUS read, accepted-register write or CPU command readiness check
  publishes results/FLAG together and clears CYCLES busy, retaining nominal low31.
  A direct CPU command store while busy waits; readiness schedules deadline service
  which publishes and releases the store. Normal accesses do not synchronize PLUS.
  These are existing P1-P10/VMAD3 facts. Sources:
  [TS gte.ts:307-324](../../../machine/ts/machine/devices/gx/gte.ts#L307-L324),
  [TS gte.ts:344-431](../../../machine/ts/machine/devices/gx/gte.ts#L344-L431);
  [C++ gte.cpp:165-182](../../../machine/cpp/machine/devices/gx/gte.cpp#L165-L182),
  [C++ gte.cpp:206-296](../../../machine/cpp/machine/devices/gx/gte.cpp#L206-L296).
- **TIM5 — Derived elapsed times and arithmetic ceiling.** From SPE1/TIM1/TIM4,
  one installed system cycle is `10^9/33_868_800 = 29.5256991686 ns`; five are
  `147.628495843 ns` (chapter rounds to 29.526 and 147.628 ns). One VMAD3 command per
  five cycles is the arithmetic admission upper bound, `33_868_800/5 = 6_773_760`
  commands/second, each producing three lanes. This excludes all operand writes,
  command issue, result readout and software work; it is not a sustained bus rate,
  a CPU-fed throughput guarantee, or permission to reuse operands/results early.

### Interface and preserved cautions

- **BUS1 — Logical transfer width is not a physical bandwidth contract.** The
  GTE interface accepts mapped 32-bit words at four-byte register slots; the
  existing B1-B8/M7 facts establish CPU alignment, byte/halfword rejection, F32/F64
  interpretation, partial effects and word-sequence readiness. Only PLUS COMMAND
  supplies write readiness; its DMA readiness is always false. Sources:
  [TS gte.ts:205-222](../../../machine/ts/machine/devices/gx/gte.ts#L205-L222),
  [TS gte.ts:372-388](../../../machine/ts/machine/devices/gx/gte.ts#L372-L388),
  [TS memory.ts:261-282](../../../machine/ts/machine/memory/memory.ts#L261-L282),
  [TS memory.ts:627-645](../../../machine/ts/machine/memory/memory.ts#L627-L645);
  [C++ gte.cpp:68-85](../../../machine/cpp/machine/devices/gx/gte.cpp#L68-L85),
  [C++ gte.cpp:240-253](../../../machine/cpp/machine/devices/gx/gte.cpp#L240-L253),
  [C++ memory.cpp:181-201](../../../machine/cpp/machine/memory/memory.cpp#L181-L201),
  [C++ memory.cpp:522-539](../../../machine/cpp/machine/memory/memory.cpp#L522-L539).
- **BUS2 — Reset/IRQ conclusions unchanged.** Reset clears all GTE state, discards
  pending PLUS, cancels its scheduled service and releases the blocked command
  store. Neither completion path signals a GTE IRQ. Existing R1-R3 and IRQ facts
  retain their complete scope; the new prose does not add a reset register or
  reinterpret PLUS busy as an IRQ handshake. Sources:
  [TS gte.ts:200-248](../../../machine/ts/machine/devices/gx/gte.ts#L200-L248),
  [TS gte.ts:302-324](../../../machine/ts/machine/devices/gx/gte.ts#L302-L324),
  [TS io.ts:362-372](../../../machine/ts/spec/bmsx/io.ts#L362-L372);
  [C++ gte.cpp:64-112](../../../machine/cpp/machine/devices/gx/gte.cpp#L64-L112),
  [C++ gte.cpp:160-182](../../../machine/cpp/machine/devices/gx/gte.cpp#L160-L182),
  [C++ io.h:375-385](../../../machine/cpp/spec/bmsx/io.h#L375-L385).

### Open clock/bandwidth contract — publication scope gap

The expanded scope **does resolve** the installed CPU/system-cycle frequency,
its actual scheduler hookup, PLUS cycle-to-time conversion, logical 32-bit GTE
word transfers, and normal nominal versus charged CPU cycles. It **does not
resolve** an independent GTE core clock, a physical GTE/IO bus clock or pin width,
a GTE/IO bus arbitration/contended-transfer schedule, or sustained guaranteed
bandwidth in bytes per second. The complete mirrored model has frequency and
DMA-region cost fields but no GTE/IO clock or bandwidth field (SPE1); the inspected
Memory/GTE paths dispatch words and PLUS readiness without a physical-bus transfer
schedule (TIM2/BUS1). CPU instruction costs are not evidence of an electrical
bus clock or a bandwidth guarantee; DMA RAM/ROM costs must not be relabeled as
GTE-register bandwidth. A 32-bit *programming interface* is therefore all the
public prose claims for width. This open hardware contract must remain in the
editorial completeness record; omission of unsupported numbers does not close it.
The old scope-limit statements that no CPU-Hz mapping was inspected should be
replaced by this narrower, expanded-scope finding, not left as a contradictory
blanket limit. No runtime parity or sustained-performance measurement was run.


# Geometry programming additions: evidence and review

Scope: `02-programming.md` and `gte-projection.svg`. Read the current manual standard, GTE chapter, GTE fact sheet, and the relevant mirrored owners. Neither `docs/architecture.md` nor the reference PDF was opened. No repository code was edited. The existing unrelated `docs/book1/reviews/gte.json` edit was not touched.

Editorial reference: [QEMU's EDU device specification](https://github.com/qemu/qemu/blob/master/docs/specs/edu.rst), consulted for address-to-value ordered programming sequences, explicit completion visibility, and readback contracts only. No external device's arithmetic, registers, coordinates, or timing facts were imported.

## Representation and source audit

The following narrative conventions are derived from existing operations, not claims that all GTE words share one fixed-point encoding.

| Authored subject | Existing fact-sheet basis | Audited owners |
|---|---|---|
| Signed vector triples; V0/V1/V2; packed row-major coefficients | Address/representation; operand selection | [TS vector inputs](../../../machine/ts/machine/devices/gx/gte.ts#L1161-L1182), [TS matrix/control decode](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1233); [C++ vector inputs](../../../machine/cpp/machine/devices/gx/gte.cpp#L1033-L1054), [C++ matrix/control decode](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1105) |
| Matrix factor 4096, translation scaling, SF/LM and wrap/clamp warnings | Arithmetic primitives; projection RT | [TS dot rotation and projection](../../../machine/ts/machine/devices/gx/gte.ts#L950-L995), [TS MAC/IR stages](../../../machine/ts/machine/devices/gx/gte.ts#L680-L761), [TS projection IR3](../../../machine/ts/machine/devices/gx/gte.ts#L1036-L1050); [C++ dot rotation/projection](../../../machine/cpp/machine/devices/gx/gte.cpp#L824-L869), [C++ MAC/IR stages](../../../machine/cpp/machine/devices/gx/gte.cpp#L543-L624), [C++ projection IR3](../../../machine/cpp/machine/devices/gx/gte.cpp#L910-L924) |
| H unsigned; signed screen offset ×65536; depth fixed-12 regardless SF; screen clamp | Projection RT and its exact divide | [TS projection](../../../machine/ts/machine/devices/gx/gte.ts#L977-L995), [TS depth/divide/screen limits](../../../machine/ts/machine/devices/gx/gte.ts#L1052-L1106), [TS projection operand getters](../../../machine/ts/machine/devices/gx/gte.ts#L1235-L1253); [C++ projection](../../../machine/cpp/machine/devices/gx/gte.cpp#L851-L869), [C++ limits/divide](../../../machine/cpp/machine/devices/gx/gte.cpp#L926-L979), [C++ getters](../../../machine/cpp/machine/devices/gx/gte.cpp#L1107-L1125) |
| RTPT ordering and final IR0, flag accumulation, command-scoped status | Command table; projection last-vertex rule | [TS RTPT dispatch](../../../machine/ts/machine/devices/gx/gte.ts#L623-L629), [TS cue output](../../../machine/ts/machine/devices/gx/gte.ts#L992-L995), [TS IR0 limit](../../../machine/ts/machine/devices/gx/gte.ts#L1108-L1119); [C++ RTPT dispatch](../../../machine/cpp/machine/devices/gx/gte.cpp#L488-L494), [C++ cue output](../../../machine/cpp/machine/devices/gx/gte.cpp#L866-L869), [C++ IR0 limit](../../../machine/cpp/machine/devices/gx/gte.cpp#L981-L992) |
| Doubled oriented area; AVSZ scaled sum; preserved histories | Direct arithmetic commands | [TS NCLIP/AVSZ](../../../machine/ts/machine/devices/gx/gte.ts#L998-L1007); [C++ NCLIP/AVSZ](../../../machine/cpp/machine/devices/gx/gte.cpp#L872-L881) |
| Normal/light/color roles; distinct color-byte and output ×16 scales; cue endpoints | Shared color/lighting stages; command stage table | [TS stages](../../../machine/ts/machine/devices/gx/gte.ts#L783-L869), [TS depth cue](../../../machine/ts/machine/devices/gx/gte.ts#L939-L948), [TS RGB push](../../../machine/ts/machine/devices/gx/gte.ts#L1133-L1141); [C++ stages](../../../machine/cpp/machine/devices/gx/gte.cpp#L646-L732), [C++ cue](../../../machine/cpp/machine/devices/gx/gte.cpp#L813-L822), [C++ RGB push](../../../machine/cpp/machine/devices/gx/gte.cpp#L1006-L1014) |

No TS/C++ disagreement was found in this audited scope. Read/write addresses and their exact access semantics remain those already extracted in the fact sheet. The prose does not replace the exact arithmetic appendix or full register inventory.

### Derived ranges and encodings

- Signed halfword coordinate range: −32768…32767. Choosing coefficients / 4096 makes the coefficient range −8…`8−1/4096`; choosing signed full-word screen offset / 65536 makes the offset range −32768…`32768−1/65536`. Translation is a signed full word and is multiplied by 4096 in the operation, not stored as a Q12 word.
- Identity writes C0/C2/C4=`0x00001000`, C1/C3=0. Mapping `(X,Y,Z)` to `(−Y,X,Z)` writes C0=`0xf0000000`, C1=`0x10000000`, C2/C3=0, C4=`0x00001000`. With SF1, zero TR, input (64,32,512), direct row equations yield (−32,64,512).
- `128×65536=0x00800000`; `96×65536=0x00600000`; `(128+1/2)×65536=0x00808000`; `−65536/2` as a raw word is`0xffff8000`. ASR16 of −32768 is−1. These interpretations are equations derived from the sourced pre-shift addition, not extra offset register formats.
- Positive-divide examples select only seed ROM entry T[0]=255, identical in [TS seed ROM](../../../machine/ts/machine/devices/gx/gte.ts#L120-L138) and [C++ seed ROM](../../../machine/cpp/machine/devices/gx/gte.cpp#L18-L36).

## Independently derived and executed examples

Validation performed in this turn:

1. Independent integer-only Python derivation of quotient, transform, screen positions, area, and AVSZ product; assertions passed. It implements the sourced divide steps for these power-of-two depths, rather than substituting mathematical H/Z.
2. Actual current TS `GxGte` + current `Memory` MMIO writes/reads, via `node --import tsx --input-type=module`. A fresh zeroed Memory and `gte.reset()` established the starting state. CPU/scheduler stubs supplied the reset callbacks only; no CPU execution, scheduler timing, or complete-machine claim is made. All normal commands were written to mapped COMMAND and observed through mapped register reads, so COMMAND and CYCLES readback were exercised too.
3. Corresponding C++ operations were inspected, not executed for these new vectors.
4. Additional actual mapped-MMIO assertions passed for the negative-coefficient mapping IR=(−32,64,512), OFX=−½ producing SX=−1 at zero X, and OFX=128½ producing SX=128 at zero X.

### Triangle derivation

Program the raw words listed in the prose. The identity rows give private sums for each vertex of 4096 times its component. For H=256 / depth=512: `s=6`, `r1=0`, `T[0]=255`, `r2=512`, `r3=65536`, `reciprocal=131072`, `q=32768`. The resulting screen pairs are (96,64),(160,64),(128,128), exactly packed as`0x00400060`,`0x004000a0`,`0x00800080`.

NCLIP: `(160−96)×(128−64)−(128−96)×(64−64)=4096=0x00001000`.

AVSZ3: `ZSF3=0x555=1365`; sum 512+512+512=1536; product 2096640=`0x001ffe00`; ASR12 yields 511=`0x000001ff`. This specifically documents the deliberate sub-⅓ scale and does not mislabel the output 512.

Actual mapped-read snapshots (word groups in ascending index order):

| Read group | After RTPT 0x00080030 | After NCLIP 0x00000006 | After AVSZ3 0x0000002d |
|---|---|---|---|
| D12,D13,D14 | `00400060 004000a0 00800080` | unchanged | unchanged |
| D16,D17,D18,D19 | `00000000 00000200 00000200 00000200` | unchanged | unchanged |
| D9,D10,D11 | `00000000 00000040 00000200` | unchanged | unchanged |
| D25,D26,D27 | `00000000 00000040 00000200` | unchanged | unchanged |
| D8 | `00000000` | unchanged | unchanged |
| D24 | `00000000` | `00001000` | `001ffe00` |
| D7 | `00000000` | `00000000` | `000001ff` |
| C31 FLAG | `00000000` | `00000000` | `00000000` |
| COMMAND | `00080030` | `00000006` | `0000002d` |
| CYCLES | `00000017` | `00000008` | `00000005` |

The full mapped snapshots also confirmed D0–D6, C0–C30, and RGB FIFO retention; D15 was the D14 alias. D28/D29 derived packed-IR reads were `0x00001000`; the prose correctly does not describe these as retained outputs.

### Nonzero translation derivation

Continue from AVSZ3. Set TR=(32,−16,512); V0=(64,32,512). Private sums are4096×(96,16,1024); with SF1 MAC/IR=(96,16,1024). H=256 / depth=1024 selects`s=5` and the same `r1/r2/r3/reciprocal` as above, yielding`q=16384`. Offset plus projection yields (152,100), packed `0x00640098`.

Actual mapped reads after RTPS 0x00080001:

| Read group | Words |
|---|---|
| D9,D10,D11 and D25,D26,D27 | `00000060 00000010 00000400` in both groups |
| D12,D13,D14 | `004000a0 00800080 00640098` |
| D16,D17,D18,D19 | `00000200 00000200 00000200 00000400` |
| D8,D24 | `00000000 00000000` |
| D7 | `000001ff` retained |
| FLAG; CYCLES | `00000000`; `0000000f` |

C6 read `0xfffffff0`; its signed32 consumption is separately sourced above. V1/V2 remained unchanged. This example demonstrates one push and the shared control lifetime, not a hidden FIFO clear.

## Figure audit

`gte-projection.svg` plots the above derived positions at two drawing units per screen-coordinate count: the example 256×192 coordinate area is 512×384; its top-left is(110,105). V0 is (302,233), V1 (430,233), V2 (366,361), and projected zero (366,297). The OFX dimension runs from screen X=0 to 128; OFY from screen Y=0 to 96. Arrows specify increasing SX right and SY down **for this drawing**, not a prescribed physical coordinate system. The caption explicitly denies a GTE clipping-window interpretation.

Inspected a readable Chromium raster preview of the SVG. Labels are legible, triangle/dimension endpoints are correct, and no label crosses a triangle edge. Replaced the combined axis path with separate paths so both axes receive arrowheads. Final chapter PDF inspection remains the root editor's responsibility.


## Command and representation comparison

No TS/C++ mismatch was found at the inspected boundaries. Register words and packed halves are the consumed representation in both. All 22 normal function codes and nominal counts agree: [TS constants](../../../machine/ts/machine/devices/gx/gte.ts#L47-L91), [C++ constants](../../../machine/cpp/machine/devices/gx/gte.h#L43-L87). Normal dispatch clears FLAG for recognized functions, forwards SF/LM to all relevant stages, performs triple iterations in order, and returns each count: [TS dispatch](../../../machine/ts/machine/devices/gx/gte.ts#L525-L649), [C++ dispatch](../../../machine/cpp/machine/devices/gx/gte.cpp#L390-L515). Unknown functions return zero without clearing FLAG. MMIO runs that dispatch and records the returned count during the write: [TS](../../../machine/ts/machine/devices/gx/gte.ts#L344-L350), [C++](../../../machine/cpp/machine/devices/gx/gte.cpp#L206-L216). Thus each normal entry calls its cost nominal and does not promise a physical command latency or busy countdown.

| Operation family / entries | TS arithmetic owner | C++ arithmetic owner | Authored conclusion |
|---|---|---|---|
| RTPS, RTPT | [rotation/projection](../../../machine/ts/machine/devices/gx/gte.ts#L950-L995), [IR3/depth](../../../machine/ts/machine/devices/gx/gte.ts#L1036-L1069), [divide](../../../machine/ts/machine/devices/gx/gte.ts#L1071-L1094), [screen/cue](../../../machine/ts/machine/devices/gx/gte.ts#L1096-L1119) | [rotation/projection](../../../machine/cpp/machine/devices/gx/gte.cpp#L824-L870), [IR3/depth](../../../machine/cpp/machine/devices/gx/gte.cpp#L910-L943), [divide](../../../machine/cpp/machine/devices/gx/gte.cpp#L945-L967), [screen/cue](../../../machine/cpp/machine/devices/gx/gte.cpp#L969-L992) | SF-selected MAC/IR versus fixed-12 depth distinguished; IR3 exceptional flag test retained; saturated vertices still pushed; third RTPT vertex alone produces IR0. |
| NCLIP, AVSZ3, AVSZ4 | [direct calculations and MAC0](../../../machine/ts/machine/devices/gx/gte.ts#L998-L1030), [depth clamp](../../../machine/ts/machine/devices/gx/gte.ts#L1059-L1069) | [direct calculations and MAC0](../../../machine/cpp/machine/devices/gx/gte.cpp#L872-L904), [depth clamp](../../../machine/cpp/machine/devices/gx/gte.cpp#L933-L943) | No SF/LM use, no FIFO push; full product drives depth clamp even when MAC0 wraps; NCLIP is a determinant, not clipping. |
| OP, SQR | [OP](../../../machine/ts/machine/devices/gx/gte.ts#L763-L771), [SQR](../../../machine/ts/machine/devices/gx/gte.ts#L871-L879) | [OP](../../../machine/cpp/machine/devices/gx/gte.cpp#L626-L634), [SQR](../../../machine/cpp/machine/devices/gx/gte.cpp#L734-L742) | Signed low-halfword IR; OP only uses rotation diagonal; both explicitly supply false MAC-overflow inputs; standard SF/write-wrap/LM still apply. |
| MVMVA | [selected product/two-pass case](../../../machine/ts/machine/devices/gx/gte.ts#L913-L937), [vector/matrix/control selection](../../../machine/ts/machine/devices/gx/gte.ts#L1161-L1215) | [selected product/two-pass case](../../../machine/cpp/machine/devices/gx/gte.cpp#L777-L811), [vector/matrix/control selection](../../../machine/cpp/machine/devices/gx/gte.cpp#L1033-L1087) | Complete mx/v/cv choices, signed32 control versus signed16 matrix distinction, defined synthetic mx=3 and overwriting cv=2 retained; no invalid-state fallback asserted. |
| NCS/NCT, NCCS/NCCT, NCDS/NCDT | [generic matrix and application](../../../machine/ts/machine/devices/gx/gte.ts#L783-L837), [named sequences](../../../machine/ts/machine/devices/gx/gte.ts#L839-L857) | [generic matrix and application](../../../machine/cpp/machine/devices/gx/gte.cpp#L646-L700), [named sequences](../../../machine/cpp/machine/devices/gx/gte.cpp#L702-L720) | Purpose/choice described in words, stages not merely listed. Triple commands mean three input vectors; no unsourced physical light-count model. NCS uses CODE only; NCCS modulates RGB; NCDS supplies unshifted modulated terms to cue. |
| CC, CDP, DCPL | [CC/CDP](../../../machine/ts/machine/devices/gx/gte.ts#L859-L869), [DCPL](../../../machine/ts/machine/devices/gx/gte.ts#L881-L884), [modulated cue input](../../../machine/ts/machine/devices/gx/gte.ts#L835-L837) | [CC/CDP](../../../machine/cpp/machine/devices/gx/gte.cpp#L722-L732), [DCPL](../../../machine/cpp/machine/devices/gx/gte.cpp#L744-L747), [modulated cue input](../../../machine/cpp/machine/devices/gx/gte.cpp#L698-L700) | Starting boundary of each command explicit: before color matrix, or after color matrix; CC then CDP is not CDP alone. |
| DPCS, INTPL, DPCT | [DPCS/INTPL](../../../machine/ts/machine/devices/gx/gte.ts#L773-L781), [DPCT](../../../machine/ts/machine/devices/gx/gte.ts#L886-L892), [cue](../../../machine/ts/machine/devices/gx/gte.ts#L939-L948) | [DPCS/INTPL](../../../machine/cpp/machine/devices/gx/gte.cpp#L636-L644), [DPCT](../../../machine/cpp/machine/devices/gx/gte.cpp#L749-L755), [cue](../../../machine/cpp/machine/devices/gx/gte.cpp#L813-L822) | Byte×65536 versus signedIR×4096 input scale explicit; every cue temporary permits negative values even when final LM=1; DPCT consumes current oldest entry then pushes, three times. |
| GPF, GPL | [scalar operations](../../../machine/ts/machine/devices/gx/gte.ts#L894-L911) | [scalar operations](../../../machine/cpp/machine/devices/gx/gte.cpp#L757-L775) | GPL reads visible signed32 MAC words, scaled by SF, not a private unshifted accumulator; both commands always push RGB. |
| Every color push | [limit and push](../../../machine/ts/machine/devices/gx/gte.ts#L1121-L1141), [CODE input](../../../machine/ts/machine/devices/gx/gte.ts#L1283-L1285) | [limit and push](../../../machine/cpp/machine/devices/gx/gte.cpp#L994-L1014), [CODE input](../../../machine/cpp/machine/devices/gx/gte.cpp#L1155-L1157) | Signed visible MAC right-shift four, then byte clamp, not IR conversion. CODE always current RGBC including DPCT. |
| VMAD3 | [PLUS compute/schedule/clamp](../../../machine/ts/machine/devices/gx/gte.ts#L391-L431), [publication](../../../machine/ts/machine/devices/gx/gte.ts#L318-L325) | [PLUS compute/schedule/clamp](../../../machine/cpp/machine/devices/gx/gte.cpp#L256-L296), [publication](../../../machine/cpp/machine/devices/gx/gte.cpp#L176-L183) | Independent fixed-12 add/multiply path; signed16 operands; five-system-cycle pending publication versus nominal normal-command costs; invalid one-cycle command preserves results, publishes `0x81000000`. |

Shared result and flag semantics were checked against [TS MAC/write/ordered-accumulation/IR stages](../../../machine/ts/machine/devices/gx/gte.ts#L652-L761) and [C++ equivalents](../../../machine/cpp/machine/devices/gx/gte.cpp#L517-L624). The normal summary mask excludes IR3, RGB, and IR0 saturation: [TS flags/mask](../../../machine/ts/machine/devices/gx/gte.ts#L93-L114), [C++ flags/mask](../../../machine/cpp/machine/devices/gx/gte.h#L89-L110). Command outputs are enumerated using actual assignments; no input registers are relabeled outputs merely because their words are retained.

PLUS command-store admission, no input queue, busy input writes, DMA denial, and no GTE completion interrupt are already sourced in the fact sheet's PLUS admission/IRQ sections. They are not broadened here into a DMA-channel policy or global machine timing claim. Relevant PLUS input writes, command admission and DMA rejection: [TS](../../../machine/ts/machine/devices/gx/gte.ts#L353-L389), [C++](../../../machine/cpp/machine/devices/gx/gte.cpp#L219-L254); completion synchronization: [TS](../../../machine/ts/machine/devices/gx/gte.ts#L302-L325), [C++](../../../machine/cpp/machine/devices/gx/gte.cpp#L160-L183).

## Added arithmetic derivations

### Doubled oriented area, not Euclidean area

The NCLIP expression is

`D = x0*y1 + x1*y2 + x2*y0 - x0*y2 - x1*y0 - x2*y1`.

Expansion of `(x1-x0)*(y2-y0) - (y1-y0)*(x2-x0)` gives exactly D. Euclidean oriented triangle area is D/2. Thus the public reference calls D the doubled oriented area, not the area itself. `(0,0),(1,0),(0,1)` gives D=1 and area=1/2; exchange points 1/2 to get D=−1. No screen-Y handedness or front-face sign is inferred. Both owner expressions agree: [TS](../../../machine/ts/machine/devices/gx/gte.ts#L998-L1007), [C++](../../../machine/cpp/machine/devices/gx/gte.cpp#L872-L881).

### Color-output scale and gain scale

These are derived units, not runtime type tags. With SF=1, a generic matrix stage gives `ASR(4096*CV + sum(m*v),12)`, before word wrap/clamp. Therefore Q12 matrix coefficients preserve v's scale and add CV in that scale. A later color application gives `ASR(byte*16*gain,12)`, and P gives another `ASR(result,4)`. Hence gain4096 preserves the byte, while NCS's unmodulated final result4096 feeds P directly and gives256, which clamps to255. This supports the explicit choice distinction between NCS (already-color-scaled matrix output) and NCCS (gain-scaled matrix output), without asserting an external lighting model. Sources: [TS matrix/application/push](../../../machine/ts/machine/devices/gx/gte.ts#L783-L849), [TS push](../../../machine/ts/machine/devices/gx/gte.ts#L1133-L1141); [C++ matrix/application](../../../machine/cpp/machine/devices/gx/gte.cpp#L646-L713), [C++ push](../../../machine/cpp/machine/devices/gx/gte.cpp#L1006-L1014).

### NCCS identity-matrix example

Precondition: reset-zero GTE, so off-diagonal coefficients, color offsets C13/C14/C15, and FIFO entries are zero. Reset facts: [TS](../../../machine/ts/machine/devices/gx/gte.ts#L225-L249), [C++](../../../machine/cpp/machine/devices/gx/gte.cpp#L88-L112).

Program C8/C10/C12 and C16/C18/C20 to `0x00001000`. Their packed layouts give two identity matrices scaled4096. Program D0=`0x08001000` → `(x,y)=(4096,2048)`, D1=`0x00000400` → z1024. Program RGBC=`0x344080a0` → CODE0x34, RGB(160,128,64). Command `0x0008041b` decodes SF1, LM1, NCCS; nominal cycles17. Address derivation uses data base `0x08010244+4n`, control base `0x080102c4+4n`, and command `0x08010344` from the existing inventory.

1. Each light sum is coefficient4096 times its matching vector component; shift12 yields `(4096,2048,1024)`.
2. Identity color matrix and zero offsets preserve exactly that triple.
3. Color products before shift are `(160*16*4096,128*16*2048,64*16*1024)=(10485760,4194304,1048576)`.
4. Shift12 gives MAC/IR `(2560,1024,256)` = `(0x00000a00,0x00000400,0x00000100)`.
5. P's shift4 gives `(160,64,16)`; CODE0x34 gives new RGB2=`0x341040a0`. D22 address is `0x08010244+88=0x0801029c`. RGB0/RGB1 remain zero after one push from a zero FIFO.
6. All sums, intermediate IR, and output bytes are in range. FLAG=`0`; normal CYCLES=`0x00000011`. Normal write visibility applies, not PLUS delay.

Decoded operands: [TS](../../../machine/ts/machine/devices/gx/gte.ts#L1161-L1182), [TS matrices](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1208), [TS RGB/CODE](../../../machine/ts/machine/devices/gx/gte.ts#L1263-L1285); [C++](../../../machine/cpp/machine/devices/gx/gte.cpp#L1033-L1054), [C++ matrices](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1080), [C++ RGB/CODE](../../../machine/cpp/machine/devices/gx/gte.cpp#L1135-L1157). Execution and stage sources are in the family comparison table above.

### DPCS halfway-cue example

Precondition: separately reset-zero GTE. Program RGBC D6=`0x56604020`, yielding CODE0x56 and RGB(32,64,96). Program IR0 D8=`0x00000800` (2048), and far-color C21/C22/C23=`0x00000a00/0x00000800/0x00000400`, corresponding to target bytes(160,128,64) multiplied16. Command `0x00080410` selects DPCS, SF1, LM1 and nominal8 cycles.

1. Starting terms `in=byte*65536` are `(2097152,4194304,6291456)`.
2. Far terms `4096*far` are `(10485760,8388608,4194304)`.
3. Difference terms before shift are `(8388608,4194304,−2097152)`; shift12 gives `(2048,1024,−512)`. Forced temporary LM0 preserves the negative blue difference despite selected LM1.
4. Final pre-shift terms `in +2048*d` are `(6291456,6291456,5242880)`.
5. Shift12 gives MAC/IR `(1536,1536,1280)` = `(0x00000600,0x00000600,0x00000500)`.
6. P's shift4 gives bytes `(96,96,80)`. CODE0x56 packs RGB2=`0x56506060`; RGB0/RGB1 remain zero. All intermediates and outputs are in range, so FLAG=`0`; IR0 remains `0x00000800`; CYCLES=`0x00000008`.

The cue implementation first computes all three differences, then final writes. Thus the described temporary values do not imply temporary difference words in IR: [TS](../../../machine/ts/machine/devices/gx/gte.ts#L939-L948), [C++](../../../machine/cpp/machine/devices/gx/gte.cpp#L813-L822). DPCS scales inputs as byte×65536: [TS](../../../machine/ts/machine/devices/gx/gte.ts#L773-L776), [C++](../../../machine/cpp/machine/devices/gx/gte.cpp#L636-L639). Final push is sourced above.

### Do not idealize the modulated cue endpoints

The NCDS/CDP/DCPL source term `byte*16*IR` need not be divisible by4096. Even without saturation, its first cue shift truncates the difference. For example a lane with source byte1, gain1, far16 and SF1 has `in=16`, temporary difference `ASR(65536−16,12)=15`; with IR0=4096 the final MAC is `ASR(16+4096*15,12)=15`, not far16. Accordingly the command-reference entry does not promise an exact far endpoint merely from IR0=4096. It describes the full limited difference and points back to exact arithmetic. This follows directly from [TS modulated input and cue](../../../machine/ts/machine/devices/gx/gte.ts#L835-L837), [TS cue](../../../machine/ts/machine/devices/gx/gte.ts#L939-L948); [C++ modulated input](../../../machine/cpp/machine/devices/gx/gte.cpp#L698-L700), [C++ cue](../../../machine/cpp/machine/devices/gx/gte.cpp#L813-L822). Both authored numeric examples use integral shifts and avoid this discrepancy.

## Editorial checks and integration notes

- Exactly22 normal function headings plus one VMAD3 heading; no invented mnemonic expansions.
- Every entry states function encoding, SF/LM/selector applicability, nominal count or actual PLUS duration, input register sets and scaling, stored-result/FIFO/FLAG effects, purpose, choice against related commands, and a sourced caution.
- No runtime/source-path/host-language details are included in the public command prose.
- Cross-references target existing exact arithmetic sections. Their headings/anchors must remain or be updated during assembly; the register FLAG anchor in particular should be checked against the publisher's slug generation.
- The current baseline NCLIP summary/table also uses “signed area” loosely. Root should make the same doubled-oriented-area correction there if it retains that summary; this draft does not re-author the arithmetic appendix.
- No repository files, runtime code, tooling, framework, or commits were changed by this author.


## Graphics hand-off and visible-triangle example

This expands source scope only for the concrete GTE -> GP0 -> graphics memory -> PCRTC recipe; it is not a general GPU chapter or Sony compatibility claim.

- GP0 and GP1 are the two IO words immediately before GTE DATA0, deriving byte addresses 0801023CH and 08010240H from the mirrored IO/memory-map leaves. Both are mapped as CPU read/write registers; GP0 has a write-ready callback. Sources: [TS IO](../../../machine/ts/spec/bmsx/io.ts#L114-L122), [TS address expressions](../../../machine/ts/spec/bmsx/io.ts#L171-L179), [C++ IO/address expressions](../../../machine/cpp/spec/bmsx/io.h#L127-L135), [C++ addresses](../../../machine/cpp/spec/bmsx/io.h#L184-L192), [TS mappings](../../../machine/ts/machine/devices/gx/gpu.ts#L462-L472), [C++ mappings](../../../machine/cpp/machine/devices/gx/gpu.cpp#L52-L64). CPU direct-store admission is covered by B1/B3 above.
- GP0 state command opcodes E1/E3/E4/E5/E6, fill02, polygon20, texture/gouraud/quad selectors and draw-to-displayed-field bit10 are from the matching spec leaves. Inclusive bottom/right and drawing coordinates are decoded by the shared spec owner. Sources: [TS GP0](../../../machine/ts/spec/gx/gp0.ts#L1-L49), [TS area/offset decoding](../../../machine/ts/spec/gx/gp0.ts#L69-L98), [C++ GP0](../../../machine/cpp/spec/gx/gp0.h#L1-L105), [TS state command effects](../../../machine/ts/machine/devices/gx/gpu.ts#L1200-L1247), [C++ effects](../../../machine/cpp/machine/devices/gx/gpu.cpp#L780-L823).
- Fill packet takes three words; flat untextured triangle takes four. For opcode20, texture/gouraud/quad bits are all zero. Sources: [TS packet counts](../../../machine/ts/machine/devices/gx/gpu.ts#L1723-L1753), [C++ packet counts](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1206-L1235). Command-color word then three coordinates are consumed in order: [TS flat triangle](../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L200-L210), [C++ flat triangle](../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L202-L213). Red is low byte, green next, blue next, five-bit storage conversion by truncating three low bits: [TS pixel packing](../../../machine/ts/render/backend/software/gx_gpu_vram.ts#L15-L23), [C++ pixel packing](../../../machine/cpp/render/backend/software/gx_gpu_vram.h#L27-L36).
- GPU status bit26 is idle only with no pending completion, no ingress/FIFO or incomplete packet/image/polyline, and idle readback. Thus polling after a whole packet waits for command idle, not while halfway through it. Sources: [TS idle bit](../../../machine/ts/machine/devices/gx/gpu.ts#L180), [TS idle logic](../../../machine/ts/machine/devices/gx/gpu.ts#L1875-L1925), [C++ idle bit](../../../machine/cpp/machine/devices/gx/gpu.h#L55), [C++ idle logic](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1353-L1401).
- The 32-bit drawing-area state word is E402FCFFH = E4000000H | (191<<10) | 255. Fill size 00C00100H = (192<<16)|256. Polygon word 200000FFH = (20H<<24) | 255. These are explicit integer derivations, no SDK alias assumptions.
- GX16 address is base + y*framebufferWidth + x with installed-memory wrap. The example uses base0/width1024 and source0,0; word 98432 = 96*1024+128 contains001FH. Sources: [TS local memory](../../../machine/ts/machine/devices/gx/gpu_local_memory.ts#L83-L91), [C++ local memory](../../../machine/cpp/machine/devices/gx/gpu_local_memory.h#L77-L80); framebuffer/format/PMODE conversion and display geometry are in the PCRTC fact sheet. Reset words and fields: [TS PCRTC spec](../../../machine/ts/spec/gx/pcrtc.ts#L12-L51), [TS reset words](../../../machine/ts/spec/gx/pcrtc.ts#L75-L98), [C++ spec/reset](../../../machine/cpp/spec/gx/pcrtc.h#L10-L100).
- VBlank presentation latches PCRTC words before frame delivery. Cartridge-visible recipe relies on that edge, not immediate readback. Sources: [TS GPU presentation](../../../machine/ts/machine/devices/gx/gpu.ts#L1493-L1516), [C++ GPU presentation](../../../machine/cpp/machine/devices/gx/gpu.cpp#L975-L999), [TS runtime edge ordering](../../../machine/ts/machine/runtime/vblank.ts#L45-L62), [C++ runtime edge](../../../machine/cpp/machine/runtime/vblank.cpp#L31-L45). Exact PMODE/sample/geometry semantics retain previously reviewed PCRTC facts; only the explicit example combines them here.

Execution evidence (not a new fact source): the ordered raw GTE, GP0 and PCRTC sequences ran through live mapped TS owners plus software raster/scanout. Screen words00400060/004000A0/00800080, NCLIP4096, OTZ511; after first real VBlank edge at system cycle624270, output256x192; VRAM(128,96)=001F and RGB255,0,0; VRAM(0,0)=0000 and RGB0,0,0. Raw alpha is zero in both; no claim of native or cartridge instruction execution. Ephemeral run /tmp/bmsx-gte-revision/render-example.ts and log, not new publisher/harness code.

### Independent source audit supplement

The following fills in direct source anchors for the example's combined claims;
it does not expand the chapter into a general GPU contract.

- **CPU GP0 admission, not DMA packet readiness:** The CPU-ready callback first
  synchronizes completed command work, then requires ingress not stopped, empty
  DMA ingress, an available slot in the 16-word command FIFO, and no DMA owner of
  GP0. A resumed CPU store is released under the same conditions. With the
  example's reset/no-other-producer assumptions, this is the stated free-slot
  interlock. Twelve transmitted words comprise five one-word state commands,
  three fill words and four triangle words; the example does not require a
  full-FIFO test to establish its resulting image. Sources:
  [TS CPU ready](../../../machine/ts/machine/devices/gx/gpu.ts#L2025-L2034),
  [C++ CPU ready](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1499-L1508),
  [TS release](../../../machine/ts/machine/devices/gx/gpu.ts#L1915-L1922),
  [C++ release](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1392-L1398),
  [TS FIFO capacity](../../../machine/ts/spec/gx/gp0.ts#L33-L34),
  [C++ FIFO capacity](../../../machine/cpp/spec/gx/gp0.h#L35-L36).
- **Draw mode, mask policy, fill dimensions and polygon selectors:**
  E1000400H has bit10=1 and bit9=0; E6000000H leaves both mask-mode bits clear.
  Opcode20H has semitransparency, texture, quad and Gouraud bits clear. The fill
  width decode keeps X aligned to16 and rounds width up to16, but the example's
  X0/width256 are already aligned; height192 is direct. Sources:
  [TS draw bits](../../../machine/ts/spec/gx/gp0.ts#L44-L49),
  [C++ draw bits](../../../machine/cpp/spec/gx/gp0.h#L46-L51),
  [TS render selectors](../../../machine/ts/render/backend/gx_gpu_render_rules.ts#L83-L96),
  [C++ render selectors](../../../machine/cpp/render/backend/gx_gpu_render_rules.h#L75-L88),
  [TS fill decode](../../../machine/ts/render/backend/gx_gpu_render_rules.ts#L125-L135),
  [C++ fill decode](../../../machine/cpp/render/backend/gx_gpu_render_rules.h#L117-L127),
  [TS mask decode](../../../machine/ts/render/backend/gx_gpu_render_rules.ts#L337-L343),
  [C++ mask decode](../../../machine/cpp/render/backend/gx_gpu_render_rules.h#L341-L347).
- **Framebuffer and output-window derivation:** DISPFB1_LOW=000FA000H gives
  base0, width-field16 hence1024 words, storage-selector31 henceGX16;
  DISPFB1_HIGH=0 gives source0,0. DISPLAY1_LOW reset018252A8H decodes signal
  position680,37 and magnification4,1. Reset SMODE1 signalStepX=4. New
  DISPLAY1_HIGH=000BF3FFH contains horizontal extent1023 and vertical extent191.
  Therefore output starts at0,0 after the single enabled circuit's crop, has
  width ceil((680+1024)/4)-ceil(680/4)=256 and height191+1=192; magnification4,1
  makes source pixels advance one per output pixel in each direction. Sources:
  [TS framebuffer/window decode](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L361-L389),
  [C++ decode](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L120-L150),
  [TS crop/extents](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L391-L446),
  [C++ crop/extents](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L152-L202),
  [TS output extent](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L461-L468),
  [C++ output extent](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L215-L222),
  [TS signal step](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L270-L278),
  [C++ signal step](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L89-L97),
  [TS GX16 selector](../../../machine/ts/machine/devices/gx/gpu_local_memory.ts#L3-L8),
  [C++ selector](../../../machine/cpp/machine/devices/gx/gpu_local_memory.h#L7-L12),
  [TS selector use](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L163-L171),
  [C++ selector use](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L26-L34).
- **PMODE and alpha:** 0000FF21H means EN1=1, EN2=0, MMOD=1,
  AMOD=0, ALP=255. The selected circuit1 operation is raw RGBA, not source-alpha
  blending. It copies RGB directly and keeps the sample alpha, including zero.
  GX16 word001FH expands to255,0,0,0 because 5-bit channel31 expands to255 and
  mask bit15 is zero; word0000H expands to0,0,0,0. Thus zero alpha does not erase
  the red RGB in the chapter's selected composition. Sources:
  [TS composition](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L479-L501),
  [C++ composition](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L233-L255),
  [TS GX16 raw-RGBA operation](../../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts#L125-L146),
  [C++ raw-RGBA operation](../../../machine/cpp/render/backend/software/gx_gpu_scanout.cpp#L130-L155),
  [TS sample palette](../../../machine/ts/render/backend/software/gx_gpu_scanout_palette.ts#L5-L11),
  [C++ sample palette](../../../machine/cpp/render/backend/software/gx_gpu_scanout_palette.cpp#L7-L16),
  [TS channel expansion](../../../machine/ts/render/backend/software/gx_gpu_vram.ts#L21-L23),
  [C++ channel expansion](../../../machine/cpp/render/backend/software/gx_gpu_vram.h#L33-L35).
- **Stored red and black:** The fill consumes the three words and writes black
  into every selected destination word. The triangle consumes the constant color
  and three screen words, uses constant RGB at covered interior pixels, and writes
  with dithering/semistransparency/mask forcing disabled. Consequently red255
  stores as31 (001FH), not8000H or801FH. GPU raster addressing uses1024 words per
  row, matching the selected PCRTC GX16 width. Sources:
  [TS fill](../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L53-L72),
  [C++ fill](../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L10-L37),
  [TS constant triangle](../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L201-L205),
  [C++ constant triangle](../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L203-L207),
  [TS covered pixel color](../../../machine/ts/render/backend/software/gx_gpu_rasterizer.ts#L331-L347),
  [C++ covered pixel color](../../../machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp#L323-L339),
  [TS render word](../../../machine/ts/render/backend/software/gx_gpu_vram.ts#L115-L139),
  [C++ render word](../../../machine/cpp/render/backend/software/gx_gpu_vram.h#L100-L132),
  [C++ 8-to-5-bit conversion](../../../machine/cpp/render/backend/software/gx_gpu_vram.h#L162-L197),
  [TS raster address](../../../machine/ts/render/backend/software/gx_gpu_vram.ts#L11-L13),
  [C++ raster address](../../../machine/cpp/render/backend/software/gx_gpu_vram.h#L18-L24),
  [TS row size](../../../machine/ts/spec/gx/vram.ts#L1-L5),
  [C++ row size](../../../machine/cpp/spec/gx/vram.h#L9-L14).
- **Latch scope, not atomic stores:** At VBlank begin, presentation copies all
  currently programmed configuration words together. Separate writes are not an
  atomic multiword transaction; an intervening edge can latch an intermediate
  configuration. The example retains running reset timing and must finish its
  four display writes before the VBlank edge for that whole new configuration to
  appear at that edge. No interrupt mask is tested in the presentation call.
  Sources:
  [TS configuration latch](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L723-L730),
  [C++ configuration latch](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L446-L453),
  [TS VBlank order](../../../machine/ts/machine/runtime/vblank.ts#L44-L61),
  [C++ VBlank order](../../../machine/cpp/machine/runtime/vblank.cpp#L31-L45).

Audit result: the example's address/word/size/color calculations and the listed
mirrored interfaces agree. The original TS GP0 bit-range and red-byte packing
links were widened to cover their actual definitions; the C++ VBlank link was
narrowed from an out-of-bounds line100 to31-45. Public prose was not edited by the
auditor. Minor author action: "next two tables" precedes three GP0 tables; say
"following GP0 tables". For local clarity, the latch paragraph can repeat the
already cross-referenced rule to finish all four writes before the same VBlank
entry, rather than allowing "visible together" to suggest atomic store admission.

## Further programming derivations: spaces, transform construction and color selection

These are chosen mathematical examples, not additional hardware modes or a source
of new machine constants. The architectural inputs and exact arithmetic are the
ones already enumerated above. Coordinate names, handedness, model placement,
viewing origin, normal scale and material choices are explicitly software policy.

| Used hardware fact | Narrow mirrored owner evidence |
|---|---|
| Input vector components are signed low/high halfwords; matrix coefficients are signed halves; projection selects matrix0 and translation0 | [TS vector](../../../machine/ts/machine/devices/gx/gte.ts#L1161-L1171), [C++ vector](../../../machine/cpp/machine/devices/gx/gte.cpp#L1033-L1043); [TS matrix](../../../machine/ts/machine/devices/gx/gte.ts#L1196-L1233), [C++ matrix](../../../machine/cpp/machine/devices/gx/gte.cpp#L1068-L1105) |
| Rows consume XYZ with ordered signed44 accumulation; SF shift precedes signed visible-word IR limiting | [TS rows](../../../machine/ts/machine/devices/gx/gte.ts#L783-L818), [C++ rows](../../../machine/cpp/machine/devices/gx/gte.cpp#L646-L681); [TS MAC](../../../machine/ts/machine/devices/gx/gte.ts#L680-L719), [C++ MAC](../../../machine/cpp/machine/devices/gx/gte.cpp#L545-L584) |
| Projection uses limited IR1/IR2, fixed12 retained-Z depth, integer reciprocal and fixed16 screen output; no screen clipping-volume input | [TS projection](../../../machine/ts/machine/devices/gx/gte.ts#L950-L995), [C++ projection](../../../machine/cpp/machine/devices/gx/gte.cpp#L824-L869); [TS limits/divide](../../../machine/ts/machine/devices/gx/gte.ts#L1036-L1106), [C++ limits/divide](../../../machine/cpp/machine/devices/gx/gte.cpp#L910-L979) |
| Light stage consumes matrix1/vector/zero control; color stage consumes matrix2/current IR/control1 | [TS stage selection](../../../machine/ts/machine/devices/gx/gte.ts#L820-L826), [C++ stage selection](../../../machine/cpp/machine/devices/gx/gte.cpp#L683-L689) |
| NCCS applies RGBC after both matrices; NCS omits base multiplication; NCDS cues the unshifted modulation products | [TS stages](../../../machine/ts/machine/devices/gx/gte.ts#L828-L858), [C++ stages](../../../machine/cpp/machine/devices/gx/gte.cpp#L691-L721) |
| Color pushes consume signed visible MAC>>4, byte-limit and current RGBC CODE, not old FIFO CODE | [TS color push](../../../machine/ts/machine/devices/gx/gte.ts#L1133-L1141), [C++ color push](../../../machine/cpp/machine/devices/gx/gte.cpp#L1006-L1014) |
| Cue difference and result have separate SF shifts/clamps; compound modulation inputs need not equal a reloaded byte color | [TS depth cue](../../../machine/ts/machine/devices/gx/gte.ts#L939-L948), [C++ depth cue](../../../machine/cpp/machine/devices/gx/gte.cpp#L813-L822) |

### Coordinate-space example

Chosen software mapping: model `(X,Y,Z)` becomes world `(-Y,X,Z)+(200,40,768)`.
Viewing origin is `(120,56,256)`, with unchanged axes. Therefore the directly
supplied transform has raw rows `(0,-4096,0)`, `(4096,0,0)`, `(0,0,4096)` and
translation `(80,-16,512)`. Model `(64,32,0)` gives world `(168,104,768)` and view
`(48,48,512)`. Raw row accumulations are `(196608,196608,2097152)`; SF=1 produces
those view coordinates. H256, OFX128<<16 and OFY96<<16 produce q32768, screen
`(152,120)`. With unchanged axes, viewing-origin movement +32 in world X changes
that point's view X from48 to16. This is derived coordinate algebra, not a GTE
camera state.

The spatial/screen movement contrast uses unsaturated X64 at depths512/1024,
H256 and OFX128<<16. The exact quotients32768/16384 give original SX160/144.
Adding spatial TRX32 gives176/152; adding OFX16<<16 instead gives176/160.
The figure labels follow this chosen example and do not add an intermediate
world register or clipping window.

### Nonidentity transform construction

Chosen local scales5/4,5/2,1 followed by an XY turn with cos3/5,sin4/5 give
interpreted rows `(3/4,-2,0)`, `(1,3/2,0)`, `(0,0,1)`. Raw Q12 rows are
`(3072,-8192,0)`, `(4096,6144,0)`, `(0,0,4096)`. Matrix words are
`e0000c00 10000000 00001800 00000000 00001000`; translation `(40,-24,512)` is
`00000028 ffffffe8 00000200`. Model origin and +64 axis probes produce
`(40,-24,512)`, `(88,40,512)`, `(-88,72,512)`, `(40,-24,576)`. The first two
probe displacements have lengths80/160 and dot product0.

Model `(64,16,0)` produces raw accumulations `(229376,262144,2097152)`, then
MAC/IR `(56,64,512)` at SF1/LM0. H256, offsets128/96 and zero DQA/DQB yield
screen `(156,128)`, SXY2=`0080009c`, FLAG0. The chosen flat input box
X/Y=-64..64,Z0 gives view X=-136..216,Y=-184..136,Z512 and screen X60..236,
Y4..164. These finite bounds justify this example's absence of clamps only.

### Nonidentity lighting and material choice

Chosen approximate Q12 normal `(2458,0,3277)`; raw light rows
`(3072,0,2048)`, `(-2048,0,3072)`, `(0,0,-4096)`; raw color rows
`(4096,1024,0)`, `(2048,4096,0)`, `(1024,2048,4096)`; ambient `(256,512,128)`.
SF1/LM1 light accumulations `(14262272,5032960,-13422592)` yield shifted MAC
`(3482,1228,-3277)` and limited IR `(3482,1228,0)`. Color accumulations are
`(16568320,14258176,6604800)` and produce gains `(4045,3481,1612)`.

RGBC=`34c060a0` (material A, RGB160/96/192) produces unshifted modulation
`(10355200,5346816,4952064)`, visible MAC/IR `(2528,1305,1209)`, RGB2=`344b519e`.
FLAG=`00400000` retains only the earlier IR3 saturation; ERROR is clear.
Zero supplied normal instead produces ambient-only RGB2=`34060c0a`. NCS under
the original normal/matrices gives direct unmodulated RGB252/217/100.

RGBC=`34a0c040` (material B, RGB64/192/160) produces modulation
`(4142080,10693632,4126720)`, shifted MAC/IR `(1011,2610,1007)`, RGB2=`343ea33f`.
Both examples retain the same supplied normal and matrix setup.

For material A, far vector `(1280,1536,2560)` and direct IR0=2048 give fused
NCDS RGB2=`34755876`. Reloading the earlier NCCS byte result as RGBC and using
DPCS gives `34755877` instead: the red cue differences are -1249 versus -1248.
Preloading light responses `(3482,1228,0)` followed by CC/CDP reproduces the
corresponding material/cued result; preloading gains `(4045,3481,1612)` followed
by DCPL reproduces the cued result. Those continuations do not recreate earlier
light-stage flags. All examples were independently derived with integer products
and shifts, then checked through live TS arithmetic; C++ agreement was checked
in source, not by executing the native runtime.

### Expanded RTPS/RTPT reference examples

The full command entries use the existing source contract, not new instruction
encodings. Dispatch and last-vertex cue selection: [TS RTPS](../../../machine/ts/machine/devices/gx/gte.ts#L525-L533),
[C++ RTPS](../../../machine/cpp/machine/devices/gx/gte.cpp#L390-L398),
[TS RTPT](../../../machine/ts/machine/devices/gx/gte.ts#L623-L629),
[C++ RTPT](../../../machine/cpp/machine/devices/gx/gte.cpp#L488-L494).
Their projection/arithmetic stages and flags are sourced above. Numeric execution
here was through those TS owners, not a guest or native timing measurement.

RTPS chosen quarter-turn rows `(0,-4096,0)`, `(4096,0,0)`, `(0,0,4096)`,
translation `(12,-8,300)`, V0`(30,-45,700)`, OFX=`00804000`, OFY=`00608000`,
H333,DQA=-256,DQB=`00800000`: transformed `(57,22,1000)`, q21824, screen
`(147,103)`, IR0=684, MAC0=`002ac000`, FLAG0. The exact reciprocal derivation
has shift6,r1=31232,table index244,T=5,r2=262,r3=65572,reciprocal67109.

RTPT uses that same transform/projection with inputs `(30,-45,100)`,
`(-140,-120,300)`, `(150,80,1200)`: transformed depths400/600/1500 and exact
quotients54559/36372/14549 produce screens `(175,114)`, `(201,14)`, `(113,128)`.
Final IR0=1138, MAC0=`00472b00`, FLAG0. The negative cue expressions that the
first two quotients would produce are not evaluated by RTPT. Changing only
V0.Z to -200 gives its depth100, q131071, screen`(242,140)`, FLAG=`80020000`,
while final V2 MAC/IR/IR0 remain unchanged. Old SZ3=444 ends as final SZ0;
the new depths occupy SZ1/SZ2/SZ3. These examples also checked the derived
packed-color reads and the four SF/LM option contrasts printed in the entries.

### Composing transforms and choosing cue coefficients

The composition lesson uses the previous parent matrix A and translation
`a=(40,-24,512)`. A local Q12 YZ turn B has rows `(4096,0,0)`,
`(0,2458,-3277)`, `(0,3277,2458)`, with local origin `b=(5,-3,7)`.
Column-vector composition is `C=A*B`, `t=A*b+a`. Chosen policy: accumulate the
whole row product, arithmetic-shift12 once, and retain representable signed16
coefficients/integer translation. Four MVMVA words `00086012 0008e012 00096012
00080012` produce C columns and t. Raw result rows are `(3072,-4916,6554)`,
`(4096,3687,-4916)`, `(0,3277,2458)`; translation `(49,-24,519)`. Sequential
integer-IR evaluation gives `(91,45,536)` where the precomposed result gives
`(90,44,536)` for the lesson's same vertex(64,16,8): these are different explicitly
chosen truncation policies, not claimed hardware equivalence. Matrix rows and
control consumption: [TS MVMVA](../../../machine/ts/machine/devices/gx/gte.ts#L913-L937),
[C++ MVMVA](../../../machine/cpp/machine/devices/gx/gte.cpp#L777-L811),
[TS operand snapshot](../../../machine/ts/machine/devices/gx/gte.ts#L918-L920),
[C++ operand snapshot](../../../machine/cpp/machine/devices/gx/gte.cpp#L785-L787).

P04's nearest-coefficient error bound is qualified: rounding to the nearest Q12
integer must leave that integer in signed16 range. It does not bound saturation
of out-of-range ideal coefficients. P05's exact representable mapping and box
corners were independently re-executed during reader review.

Cue fitting uses H128, near256, far768 and the actual q endpoints32768/10923.
DQA=-768 is raw `fffffd00`. Ideal-division DQB=`01800000` gives far IR0=4095;
calibrated DQB=`01800100` gives near0/far4096 without either endpoint clamping.
At Z128/256/384/512/768/1024, q is65536/32768/21845/16384/10923/8192; shifted
cue is-6144/0/2048/3072/4096/4608, then IR0 clamps to0/0/2048/3072/4096/4096.
Only Z128/Z1024 set projection IR0 saturation here. Material A's NCDS RGB words
are `344b519e 344b519e 34755876 348a5c63 34a05f4f 34a05f4f`; its full coefficient
still loses fractional red/green terms. This is not generalized as an exact
far-byte endpoint for NCDS. Reciprocal, full cue and limits:
[TS projection](../../../machine/ts/machine/devices/gx/gte.ts#L975-L995),
[C++ projection](../../../machine/cpp/machine/devices/gx/gte.cpp#L849-L869),
[TS reciprocal](../../../machine/ts/machine/devices/gx/gte.ts#L1071-L1094),
[C++ reciprocal](../../../machine/cpp/machine/devices/gx/gte.cpp#L945-L967),
[TS cue](../../../machine/ts/machine/devices/gx/gte.ts#L939-L948),
[C++ cue](../../../machine/cpp/machine/devices/gx/gte.cpp#L813-L822).

### Practical vector arithmetic and numerical diagnosis

GPF then GPL under SF1/LM0 combines a=(96,-48,32), weight3072 and
b=(-32,80,64), weight1024. First MAC=(72,-36,24), final MAC=(64,-16,40).
With CODE5a, pushes are `5a010004`, `5a020004`; both FLAG=`00100000`, not ERROR.
GPF/GPL consume signed IR0 and IR lanes; GPL adds the signed *visible* MAC
scaled by4096 under SF1, not an unrounded hidden product:
[TS GPF/GPL](../../../machine/ts/machine/devices/gx/gte.ts#L894-L911),
[C++ GPF/GPL](../../../machine/cpp/machine/devices/gx/gte.cpp#L757-L775).

OP on u=(12,-8,4) in matrix0 diagonal and v=(-4,20,8) in IR gives
n=(-144,-112,208), SF0/LM0, FLAG0. SQR SF0 produces MAC=(20736,12544,43264),
IR3=32767, FLAG=`00400000`; sum MACs76544, not limited IRs66047. Exact functions:
[TS OP](../../../machine/ts/machine/devices/gx/gte.ts#L763-L771),
[C++ OP](../../../machine/cpp/machine/devices/gx/gte.cpp#L626-L634),
[TS SQR](../../../machine/ts/machine/devices/gx/gte.ts#L871-L879),
[C++ SQR](../../../machine/cpp/machine/devices/gx/gte.cpp#L734-L742).

Mapped-owner diagnostic cases, independently derived with integer arithmetic:

| Independent case | Input/change and command | Exact observation |
|---|---|---|
| Fractional shift | C0=0800, V0.X=+3/-3, command00086012 | MAC1=1/-2, FLAG0 |
| Visible32 wrap, not signed44 overflow | Matrix0zero, TRX=00080000, command00000012 | MAC1=80000000, IR1=ffff8000, FLAG81000000 |
| Ordered44 cancellation | C0=f0001000,TRX=7fffffff,V0=(1,1,0),command00080012 | MAC1=7fffffff,IR1=7fff,FLAGc9000000 |
| IR clamp with no screen clamp | Matrix diag8192/4096/4096,V0=(20000,0,512),H16,command00080001 | MAC1=40000,IR1=32767,SXY2=000003ff,FLAG81000000 |
| Earlier MAC0 event retained after cue | Identity,V0=(32767,0,512),H256,OFX7fffffff,zero cue,command00080001 | Final MAC0=0,SXY2=000003ff,FLAG80014000 |
| Reciprocal edge/negative depth | Identity,X1,Y0,H256,Z129/128/-1,command00080001 | SXY2=1 each; depths129/128/0,FLAG0/80020000/80060000 |

The normal arithmetic/flags and projection owner ranges linked above define each
stage. Signed44 ordered wrap plus shifted visible-word interpretation:
[TS MAC/accumulation](../../../machine/ts/machine/devices/gx/gte.ts#L680-L746),
[C++ MAC/accumulation](../../../machine/cpp/machine/devices/gx/gte.cpp#L545-L609).
These are execution and derivation checks, not a CPU-cycle measurement.

### Executable BLua operands and repeated-frame display

The public listing follows the existing BIOS static-data patterns:
[monitor typed records](../../../machine/bios/shell/commands.lua#L61-L78),
[terminal ROM/BSS](../../../machine/bios/tty/terminal.lua#L41-L73),
[VBlank counter](../../../machine/bios/kernel/vblank.lua#L6-L23).
The four reusable GTE operand types are owned by
[cartlib/gx/gte.lua](../../../cartlib/gx/gte.lua#L3-L28), not a cart-local ABI.
Compiler source for the fixed-record representation:
[primitive sizes](../../../toolchain/ts/lua/compiler/struct_types.ts#L44-L69),
[static initialization](../../../toolchain/ts/lua/compiler.ts#L3720-L3815),
[typed strides](../../../toolchain/ts/lua/compiler.ts#L4982-L5022),
[word stores](../../../toolchain/ts/lua/compiler.ts#L5235-L5245).
Current compile has152 ROM operand bytes and12 BSS bytes, no NEWT/GETT/SETT,
and only Word memory instructions. Guest assertions independently check sizes,
offsets, negative coordinate serialization and row-major matrix word contents.

The Gouraud triangle's GP0 first word is300000a0, followed by SXY0,
00008000,SXY1,00400000,SXY2. Its six-word color/coordinate order and raster
interpolation are defined by
[TS Gouraud decode](../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L185-L192),
[C++ Gouraud decode](../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L187-L194).
GPU-idle status is not inferred from GTE completion. PCRTC RESET's drawing/display
action is defined by
[TS CSR action](../../../machine/ts/machine/devices/gx/gpu.ts#L1409-L1421),
[C++ CSR action](../../../machine/cpp/machine/devices/gx/gpu.cpp#L918-L930).
The display buffers use the earlier established GX16 stride1024 mapping at rows0
and256; the low words are000fa000/000fa040. The source window remains256x192.
The actual scheduled VBlank path latches presentation before raising the system
VBlank interrupt:
[TS VBlank](../../../machine/ts/machine/runtime/vblank.ts#L54-L64),
[C++ VBlank](../../../machine/cpp/machine/runtime/vblank.cpp#L39-L48),
[TS latch](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L723-L730),
[C++ latch](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L446-L453).
The sequence is sampled after display stores; another observed increment precedes
reuse of the previous front buffer. Interrupt masking is not a latch inhibit.

Both isolated real guest cases pass: static_operand_layout and
geometry_color_and_buffer_lifetime. Captures show the actual interpolated
triangle and its translated later frame, not a separately drawn illustration.
Execution is headless TS CPU/device/BIOS/scanout; no native or physical-hardware
run is claimed. The complete cartridge and test remain ordinary source files,
without a chapter assembler, new protocol or publisher branch.

### Expanded MVMVA cases and repeated PLUS timing

MVMVA dispatch/selector/row ownership is linked above. Synthetic mx3 is built
from RGBC red, signed IR0 and selected matrix0 halves:
[TS synthetic coefficients](../../../machine/ts/machine/devices/gx/gte.ts#L1182-L1194),
[C++ synthetic coefficients](../../../machine/cpp/machine/devices/gx/gte.cpp#L1054-L1066).
The ordinary C03 example uses matrix words08001000/f800fc00/04001000/fc000400/
00001000, control(3,-2,10), V1(12,-7,5), command00088012. Raw accumulations
41984/-56320/80896 yield SF1 MAC/IR(10,-14,19), FLAG0. LM1 instead sets IR2 and
ERROR (`80800000`); SF0 saturates every IR lane (`81c00000`). Synthetic mx3 with
red5,IR0=-256,C1lo128,C2lo-64,oldIR(3,-4,5),SF0/cv3 gives(-1840,512,-256),FLAG0.
cv2's separate test finishes(2,8,3),FLAG00400000 from discarded first-pass
IR3=40003. Its preliminary negative row2 is not limited to zero because that
pass forces LM0 despite final LM1. Snapshot and both passes are verified against
the full MVMVA owner, not modeled as an ordinary full far-vector addition.

Three PLUS work items use A/M/s respectively(120,-48,256)/(24,16,-32)/2048,
(-96,80,512)/(-20,12,8)/-1024 and(32760,-32760,1024)/(32,-32,-2048)/2048.
Results are(132,-40,240),(-91,77,510),(32767,-32768,0), with last flagc4000000.
Accepted current inputs, pending results/deadline and joint publication:
[TS PLUS](../../../machine/ts/machine/devices/gx/gte.ts#L302-L431),
[C++ PLUS](../../../machine/cpp/machine/devices/gx/gte.cpp#L160-L296).
Actual CPU reads-before-next-issue sequence retained all nine result/flag words
at ordinary RAM address080c1000. It consumed100 system cycles:19 value/address-load cycles,30 input-store,
6 command-store,18 result-load,18 retention-store,7 polling/test/branch and2 RET.
Commands accepted31/55/79, due36/60/84. Next-input stores at33/35 and57/59 occur
while preceding work is pending without changing that work. Final reads see
busy81, ready85; final retention ends98, return100. This is one scalar ISA
sequence, not a measured lowering of every BLua program.

A separate actual CPU direct-store test accepted first command4, charged blocked
attempt6, serviced completion9, accepted retried store11 and returned13 with
second completion still due16. CPU cost/readiness/scheduler owners:
[TS scalar stores](../../../machine/ts/machine/cpu/cpu.ts#L3020-L3029),
[C++ scalar stores](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L579-L598),
[TS blocking](../../../machine/ts/machine/cpu/cpu.ts#L1647-L1663),
[C++ blocking](../../../machine/cpp/machine/cpu/cpu.cpp#L2342-L2355),
[TS cost charge](../../../machine/ts/machine/cpu/cpu.ts#L1837-L1854),
[C++ cost charge](../../../machine/cpp/machine/cpu/cpu.cpp#L2465-L2482),
[TS costs](../../../machine/ts/spec/blua32/opcode.ts#L75-L84),
[C++ costs](../../../machine/cpp/spec/blua32/opcode.cpp#L5-L54),
[TS active time](../../../machine/ts/machine/scheduler/device.ts#L52-L81),
[C++ active time](../../../machine/cpp/machine/scheduler/device.cpp#L33-L44).
This is CPU/scheduler execution, unlike the isolated arithmetic checks. Its
source was an inline verification program; no permanent timing framework was
added. Publication itself does not make several separate result loads a snapshot.

NCLIP's expanded entry follows the signed-halfword determinant and full MAC0
path: [TS NCLIP](../../../machine/ts/machine/devices/gx/gte.ts#L998-L1007),
[C++ NCLIP](../../../machine/cpp/machine/devices/gx/gte.cpp#L872-L881).
Points(10,20),(100,30),(40,80) give5100; swapping the final two gives-5100;
collinear replacement gives0. Direct signed16 extreme corners give full
+4294836225/rawfffe0001/FLAG80010000; reverse gives-4294836225/raw0001ffff/
FLAG80008000. Their wrapped signs reverse the intended full-area sign. The
projection-clamped coordinate square instead bounds magnitude to2047^2=4190209;
this is a derived bound, not an input clamp performed by NCLIP.

AVSZ3's expanded entry follows the full signed product, visible MAC0 low word
and separate full-product depth clamp:
[TS AVSZ3](../../../machine/ts/machine/devices/gx/gte.ts#L1009-L1013),
[C++ AVSZ3](../../../machine/cpp/machine/devices/gx/gte.cpp#L883-L887).
Depths1000/2000/3000 and ZSF3=1365 give P8190000,MAC0007cf830,OTZ1999,FLAG0;
SZ0=60000 is not consumed. Depths65535/4/0 and scale32767 give full P2147516413,
MAC080007ffd,OTZ65535,FLAG80050000. Depths1/0/0 and scale-1 give P=-1,
shifted-1,OTZ0,FLAG80040000. Neither example derives OTZ from wrapped MAC0.

Normal-direction qualification is explicit software mathematics: under
R=diag(2,1,1), perpendicular e=(1,1,0),n=(1,-1,0) become Re=(2,1,0),Rn=(2,-1,0),
with dot3. R inverse-transpose instead gives n'=(1/2,-1,0), whose dot with Re is0.
The identity `(R^-T*n) dot(R*e)=n dot e` justifies this convention for invertible
R; no GTE inverse/normalization behavior is added. The light-stage owner consumes
the supplied vector and light matrix exactly as linked above.

The cold packet-preparation cycle interval was independently rerun from the
P18 reproduction fixture after correcting its data boundary: operands reside
in real slot0 cartridge media at offset1000, address10001000; they are not
appended to the BIOS. The scalar instruction schedule includes all38 operand
ROM loads, all42 GTE control/input/command stores,10 GTE result loads,10 RAM
output stores,12 LOADK,seven bitwise/comparison operations andRET. Two rejection
JMPs are present but skipped on the accepted positive-area path. Issued count120,
charged cycles221; all six packet words, three zero flags and area4096 agree.
The40-byte RAM output at080c1000 is caller-reserved for this example, not new
hardware scratch storage. BIOS/startup/caller entry, GP0 submission/drawing and
VBlank waits are outside the interval. Opcode charges are the costs linked above;
normal23/8/39 counts are not another70 cycles to add. Execution provenance and
fixture mechanics stay out of the public hardware chapter.

The near-plane construction is software geometry, not inferred GTE clipping.
Chosen H256,nearZ256; view pointsA(-64,-64,128),B(64,-64,512),C(0,64,512).
Intersections at t1/3 are(-64/3,-64,256),(-128/3,-64/3,256), chosen nearest-
integer vertices(-21,-64,256),(-43,-21,256). Identity RTPT projection under the
stated setup produces screens(107,32),(160,64),(128,128),(85,75). Two retained
triples(I_AB,B,C)/(I_AB,C,I_AC) give NCLIP4416/3015. Both RTPT flags are0.
Independent rational geometry and mapped GTE/NCLIP execution agree; the existing
projection/NCLIP owners above define hardware behavior. No source-language
encoding helper or GTE clipping feature is introduced.

The packed-IR/leading-sign worked register examples follow the existing port
rules, not an extra arithmetic command:
[TS reads/writes](../../../machine/ts/machine/devices/gx/gte.ts#L433-L498),
[C++ reads/writes](../../../machine/cpp/machine/devices/gx/gte.cpp#L298-L364),
[TS packed conversion](../../../machine/ts/machine/devices/gx/gte.ts#L1143-L1159),
[C++ packed conversion](../../../machine/cpp/machine/devices/gx/gte.cpp#L1016-L1031).
Independent calculations and live register execution agree: D28 writefffffc1f
setsIR(3968,0,3968), both packed reads7c1f. Direct IR(-128,2176,4096) changes both
reads to7e20 without another packed-input write. D30 inputs0/ffffffff/f00/
fff00000/80000000/7fffffff give counts32/32/20/12/1/1. A preloaded FLAG00400000
remains unchanged through all these accesses. Count-minus-one headroom for a
nonzero signed32 value is a software arithmetic consequence of counting its
leading sign bits, not automatic normalization. C++ was source-inspected only.
