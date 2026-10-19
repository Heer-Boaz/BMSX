# Frozen memory-map and scalar-access facts

Internal authoring input only. Source acceptance and withheld claims are recorded in
[the foundations source review](../reviews/memory-foundations-source.md).
These bounded extracts do not constitute a published chapter or a complete
cartridge-memory/boot contract.

The separate [ROM-header packet](memory-rom-header.md) supplies the consumer-owned
boot/image layouts and boot-prefix distinction; it does not extend the scalar
memory-access facts below into a malformed-image contract.


Scope: guest **u32 byte addresses**, not arbitrary host numbers. This is an internal source extract, not public prose or a CPU/BIOS ABI. Read only mirrored `spec/bmsx/memory_map`, the memory-capacity portions of `spec/bmsx/model`, the `machine/memory/memory` owners, and—after narrow permission—the `IO_SLOT_COUNT` producer/dependency constants in mirrored `spec/bmsx/io`. No architecture/reference material, CPU, BIOS, DMA, cartridge-controller or device callback implementation was consulted. No repo/runtime edits or tests were added.

All numeric sizes below are **bytes**. `KiB = 1024 bytes`, `MiB = 1048576 bytes`. An exclusive end is the first byte outside a range; the inclusive end is exclusive end minus one. `0x100000000` is only the exclusive bound of the u32 address space, not a guest address. Derived endpoints are arithmetic on the cited constants, not inferred conventions.

## Declared windows and model capacity

| Fact | TS and C++ source pair |
|---|---|
| Address width is 32 bits: guest address interval `[0x00000000, 0x100000000)`, inclusive `0x00000000..0xffffffff`. | `machine/ts/spec/bmsx/memory_map.ts:1`; `machine/cpp/spec/bmsx/memory_map.h:7` |
| System-ROM window: start `0x00000000`, exclusive end `0x01000000`, inclusive end `0x00ffffff`; capacity `0x01000000 = 16777216` bytes (16 MiB). This constant is a window, not the loaded image's byte length. | `machine/ts/spec/bmsx/memory_map.ts:3-4`; `machine/cpp/spec/bmsx/memory_map.h:9-10` |
| Main-RAM address window: start `0x08000000`, exclusive end `0x10000000`, inclusive end `0x0fffffff`; capacity `0x08000000 = 134217728` bytes (128 MiB). | `machine/ts/spec/bmsx/memory_map.ts:6-9`; `machine/cpp/spec/bmsx/memory_map.h:12-15` |
| Cartridge-ROM window: start `0x10000000`, exclusive end `0x30000000`, inclusive end `0x2fffffff`; capacity `0x20000000 = 536870912` bytes (512 MiB). This is not proof of installed media capacity or permissions. | `machine/ts/spec/bmsx/memory_map.ts:9-11`; `machine/cpp/spec/bmsx/memory_map.h:15-17` |
| Cartridge-RAM window: start `0x30000000`, exclusive end `0x30f00000`, inclusive end `0x30efffff`; capacity `0x00f00000 = 15728640` bytes (15 MiB). This is not proof that all its bytes are physically present. | `machine/ts/spec/bmsx/memory_map.ts:15-17`; `machine/cpp/spec/bmsx/memory_map.h:21-23` |
| Cartridge-MMIO window: start `0x30f00000`, exclusive end `0x31000000`, inclusive end `0x30ffffff`; capacity `0x00100000 = 1048576` bytes (1 MiB). The aggregate cartridge-bus exclusive end is `0x31000000`. | `machine/ts/spec/bmsx/memory_map.ts:18-21`; `machine/cpp/spec/bmsx/memory_map.h:24-27` |
| The declared I/O reservation is `[0x08000000,0x08040000)`, inclusive `0x08000000..0x0803ffff`, size `0x00040000 = 262144` bytes (256 KiB). This is **not** the implemented I/O-slot interception length; see below. | `machine/ts/spec/bmsx/memory_map.ts:23-25,32`; `machine/cpp/spec/bmsx/memory_map.h:29-31,38` |
| The declared GEO scratch region is `[0x08040000,0x080c0000)`, inclusive `0x08040000..0x080bffff`, size `0x00080000 = 524288` bytes (512 KiB). `MIN_RAM_SIZE = 0x000c0000 = 786432` bytes, `BASE_RAM_USED_SIZE = 0x00080000`, and `DYNAMIC_RAM_BASE = 0x080c0000`. These names/constants do not establish BIOS allocation or program placement policy. | `machine/ts/spec/bmsx/memory_map.ts:27-33`; `machine/cpp/spec/bmsx/memory_map.h:33-39` |
| The installed machine-model declaration has `ramBytes = 0x00400000 = 4194304` bytes (4 MiB) and `gxGpuVramBytes = 0x00200000 = 2097152` bytes (2 MiB). VRAM is a distinct capacity field, **not a CPU-mapped window proved by these files**. | `machine/ts/spec/bmsx/model.ts:35-36,46-55`; `machine/cpp/spec/bmsx/model.h:40-41,51-60` |
| `Memory` allocates exactly its supplied RAM byte count and retains its supplied system-ROM byte view; it does not allocate the whole 128 MiB RAM window or 16 MiB ROM window. Its constructor does not itself choose the model's capacity. Thus a Memory instance supplied the declared 4 MiB RAM has backing byte span `[0x08000000,0x08400000)`, inclusive end `0x083fffff`, before mapped-I/O interception. The machine-construction call site is outside this extraction. | `machine/ts/machine/memory/memory.ts:126-129,157-162,180-190`; `machine/cpp/machine/memory/memory.h:26-29,39-45` and `machine/cpp/machine/memory/memory.cpp:90-104` |

## Implemented I/O aperture, distinct from reservation

| Fact | TS and C++ source pair |
|---|---|
| Evaluating the mirrored index/count producer chain gives `IO_SLOT_COUNT = 16656 = 0x4110` words. With `IO_WORD_SIZE = 4`, the implemented slot aperture is `0x10440 = 66624` bytes: `[0x08000000,0x08010440)`, inclusive end `0x0801043f`; last aligned slot begins at `0x0801043c`. Both mirrors agree. | `machine/ts/spec/bmsx/io.ts:3-160` + `machine/ts/spec/bmsx/memory_map.ts:23,32`; `machine/cpp/spec/bmsx/io.h:15-173` + `machine/cpp/spec/bmsx/memory_map.h:29,38` |
| Memory uses `IO_SLOT_COUNT × 4`, **not `IO_REGION_SIZE`**, for I/O slot storage, interception, and contained-range checks. | `machine/ts/machine/memory/memory.ts:145,162,836-845`; `machine/cpp/machine/memory/memory.cpp:95-97,725-727` and `machine/cpp/machine/memory/memory.h:134-140` |
| The remainder of the declared reservation, `[0x08010440,0x08040000)`, is not intercepted as I/O by this Memory owner; in an instance with backing RAM covering it, these methods reach its RAM bytes. This does **not** mean a cartridge owns that storage or may allocate it. | `machine/ts/machine/memory/memory.ts:549-565,627-651,836-845`; `machine/cpp/machine/memory/memory.cpp:439-455,522-545,725-727` |

## Mapped scalar access contract in these owners

`R = [0x08000000,0x08010440)` below. “Contained” means **the entire access width lies inside R**, not merely that its first byte is in R. These facts describe the named Memory methods; they do not establish which CPU instructions/compiler operations call them.

| Fact | TS and C++ source pair |
|---|---|
| Mapped 32-bit reads first test for an aligned I/O slot. Such a read calls the slot handler if installed, otherwise returns the retained 32-bit slot value. | `machine/ts/machine/memory/memory.ts:366-369,544-552`; `machine/cpp/machine/memory/memory.cpp:245-251,434-442` |
| Mapped U8 reads at an aligned slot address perform the full slot read/handler call and return its low eight bits. Other U8 reads wholly in R raise `BUS_FAULT_UNALIGNED_IO` and return zero. Therefore “all byte reads of MMIO fault” is false. | `machine/ts/machine/memory/memory.ts:442-451`; `machine/cpp/machine/memory/memory.cpp:332-342` |
| Mapped U8 writes wholly in R always raise `BUS_FAULT_UNALIGNED_IO` and perform no slot write—even at an aligned slot address. | `machine/ts/machine/memory/memory.ts:466-479`; `machine/cpp/machine/memory/memory.cpp:356-369` |
| Mapped U16 reads/writes wholly in R always raise `BUS_FAULT_UNALIGNED_IO`; reads return zero and writes do not reach the slot. | `machine/ts/machine/memory/memory.ts:503-507,603-607`; `machine/cpp/machine/memory/memory.cpp:393-397,498-502` |
| Mapped U32 access at a nonaligned address wholly in R raises `BUS_FAULT_UNALIGNED_IO`; reads return zero and writes do nothing. The alignment test is `(addr - IO_BASE) & 3`, not a general alignment check on main memory. | `machine/ts/machine/memory/memory.ts:549-555,628-646,840-845`; `machine/cpp/machine/memory/memory.cpp:439-445,523-540` and `machine/cpp/machine/memory/memory.h:134-140` |
| Containment matters at the aperture boundary: a U16 access starting at `0x0801043f`, or an unaligned U32 access starting at `0x0801043d`, `0x0801043e`, or `0x0801043f`, is not wholly in R and does not raise this I/O-containment fault; it falls through to backing-RAM access if the full width fits RAM. Do not replace this with “any access touching MMIO must be aligned.” | `machine/ts/machine/memory/memory.ts:503-516,549-565,603-610,628-651,836-845`; `machine/cpp/machine/memory/memory.cpp:393-406,439-455,498-506,523-545,725-727` |
| CPU mapped-word/U32 writes to an aligned I/O slot test the owner’s read-only-I/O address classification first; a classified address raises `BUS_FAULT_READ_ONLY` without writing the slot/handler. If that classification passes, the value is stored in the slot and the installed write handler is invoked. These CPU entry points select `MAPPED_BUS_MASTER_CPU`; this row does not describe DMA write admission. Exact per-device effects remain callback-owned. | `machine/ts/machine/memory/memory.ts:371-377,434-435,619-620,627-642,852-895`; `machine/cpp/machine/memory/memory.cpp:253-260,324-325,514-515,522-536,729-772` |
| For mapped U8/U16/U32 accesses resolved to main RAM after I/O interception, the address is in `[RAM_BASE,CART_ROM_BASE)` and the byte offset is `addr - RAM_BASE`. The whole access must fit the supplied RAM backing, not merely the declared 128 MiB RAM window; U16/U32 use little-endian helpers. These methods contain no general RAM word-alignment rejection. | `machine/ts/machine/memory/memory.ts:349-358,379-412,442-451,466-479,503-516,557-565,603-610,627-651`; `machine/cpp/machine/memory/memory.cpp:228-237,262-300,332-342,356-369,393-406,447-455,498-506,522-545` |
| System-ROM reads require the whole requested scalar width to fit its declared 16 MiB window. Within that window, bytes beyond the supplied ROM image are zero; a U16/U32 straddling the image’s actual end is zero-filled for missing bytes rather than faulting. | `machine/ts/machine/memory/memory.ts:313-339,349-353,503-510,557-559`; `machine/cpp/machine/memory/memory.cpp:46-72,228-232,393-400,447-449` |
| Scalar writes to the system-ROM window do not write ROM and reach `BUS_FAULT_UNMAPPED`, **not** `BUS_FAULT_READ_ONLY`, in these methods. | `machine/ts/machine/memory/memory.ts:379-398,466-479,603-616,627-656`; `machine/cpp/machine/memory/memory.cpp:262-287,356-369,498-511,522-550` |
| U8/U16/U32 access to cartridge addresses delegates to the cartridge controller when the full scalar width fits the aggregate cartridge bus. This extraction proves routing only—not ROM write protection, installed cartridge RAM, bank selection, aliases or absent-media values. | `machine/ts/machine/memory/memory.ts:359-360,475-477,517-518,566-567,612-614,652-654`; `machine/cpp/machine/memory/memory.cpp:238-239,365-367,407-408,456-457,507-509,546-548` |
| Other unmapped scalar reads raise `BUS_FAULT_UNMAPPED` and return zero; writes raise it and make no target-memory write. This includes the gap `[0x01000000,0x08000000)`, main-window bytes beyond the supplied RAM backing, and `[0x31000000,0x100000000)` for these methods. | `machine/ts/machine/memory/memory.ts:349-363,466-479,503-521,544-570,603-616,627-656`; `machine/cpp/machine/memory/memory.cpp:228-242,356-369,393-411,434-460,498-511,522-550` |
| These main-memory paths use direct byte offsets/range comparisons, not a segment mask or an installed-RAM-size mirroring mask. No high-address RAM alias is established here; cartridge-internal aliases remain unresolved. | `machine/ts/machine/memory/memory.ts:349-363,549-570,627-656`; `machine/cpp/machine/memory/memory.cpp:228-242,439-460,522-550` |
| The separate raw/main-memory `readU8`/`readU32` and `writeU8`/`writeU32` helpers bypass I/O interception and can reach backing RAM under the I/O addresses. They must not be described as equivalent to the mapped methods. Their existence is **not** proof of the guest instruction-fetch path. | `machine/ts/machine/memory/memory.ts:438-440,454-464,486-500,591-600`; `machine/cpp/machine/memory/memory.cpp:328-330,344-354,376-390,486-495` |

## Fault latch (symbolic fields; no guessed register addresses/codes)

| Fact | TS and C++ source pair |
|---|---|
| Every raised bus fault advances an internal u32 sequence, but if a fault code is already pending, its code/address/access fields are retained: the first pending fault wins. | `machine/ts/machine/memory/memory.ts:811-820`; `machine/cpp/machine/memory/memory.cpp:707-716` |
| Clearing the bus fault sets code to `BUS_FAULT_NONE`, address/access to zero, and refreshes the corresponding I/O slots. ACK readback is zero; a nonzero ACK write clears the fault, while zero does not. Numeric fault-code values/field addresses require their own narrowly scoped spec extraction. | `machine/ts/machine/memory/memory.ts:419-424,822-834`; `machine/cpp/machine/memory/memory.cpp:309-314,695-723` |

## Explicit gaps / do not infer

- **BIOS/system-reserved RAM, program/stack/BSS/readonly placement, heap ownership, and boot ABI:** not proved by these constants or the Memory backing array. `DYNAMIC_RAM_BASE` and GEO-scratch labels do not settle allocation/lifetime policy. Need later named BIOS/linker/startup owners.
- **CPU instruction fetch and typed guest operations:** which methods are called, instruction alignment, execution permissions, CPU fault/trap delivery and address calculation/wrapping require later named CPU/compiler owners. No claim here that an internal memory fault automatically traps the CPU.
- **DMA restrictions and transfers:** request gating, access-width rules, channel ownership, readiness/drop semantics, timing and address advancement require later DMA/bus owners; no general DMA permission claim is made from the methods named here.
- **Cartridge ownership:** all media, slot, controller-window aliases, ROM-write semantics, cartridge-RAM presence/persistence and cartridge MMIO effects remain controller-owned and unexamined. Window capacities are not installed-media declarations.
- **Device callback side effects:** retained-slot behavior does not define a specific register’s read side effects or write admission. Numeric bus-fault register fields/codes were not extracted.
- **VRAM CPU accessibility and GPU/PCRTC memory layout:** the model's 2 MiB capacity alone supplies neither a CPU address nor a framebuffer format.
- **Save state:** internal RAM/fault save-state routines exist in these named files, but no persistence, battery-backed cartridge RAM or guest save ABI is inferred; save-state internals are omitted from this small map/access extract.

## Mirror disposition

The paired constants, model capacities and bounded scalar behaviors above agree for guest u32 addresses. No host-number fuzzing was used. The **256 KiB declared I/O reservation versus 66624-byte implemented slot aperture** is an explicit distinction present in both mirrors, not an approved equivalence or a reason to label the whole reservation as live MMIO. No claim of whole-machine runtime parity is made. This artifact is frozen to the live source read during this extraction; there were no repo edits.

## Installed I/O bank directory and reserved-word addendum

Scope: directory positions and actual owners, not another per-register review.
All32 spans derive from `machine/ts/spec/bmsx/io.ts:3–160` and
`machine/cpp/spec/bmsx/io.h:15–173`, with byte conversion from the mirrored
`memory_map` IO_BASE/IO_WORD_SIZE definitions. The spans partition
[08000000H,08010440H), total16656 positions. Counts include source-latched
status/snapshot/result words, not only callback registrations.

Owner paths in the following table are relative to `machine/ts/machine/` and
`machine/cpp/machine/`, respectively; `.ts` and `.cpp` denote the two mirrors.

| Directory bank(s) | Actual footprint source pair |
|---|---|
| IRQ | `devices/irq/controller.ts:12–16`; `.cpp:6–11` |
| DMA0/DMA1 | `devices/dma/controller.ts:92–98`, `registers.ts:58–67`; `.cpp:16–22`, `registers.cpp:11–20` |
| GEO main/ACK | `devices/geometry/controller.ts:104–113,443–450`; `.cpp:49–58,352–359` |
| INPUT | `devices/input/controller.ts:43–58`, `registers.ts:121–140`; `.cpp:13–28`, `registers.cpp:59–78` |
| APU core/live/queue/fault | `devices/audio/controller.ts:39–51,106–115`; `.cpp:12–18,55–64` |
| APU staging | `devices/audio/command_latch.ts:32–38,64–69`; `.cpp:13–15,42–47` |
| APU events | `devices/audio/event_latch.ts:65–69`; `.cpp:47–51` |
| APU selected source/active mask | `devices/audio/selected_slot_latch.ts:17–20`, `active_slots.ts:30–34`; `.cpp:16–19`, `active_slots.cpp:25–27` |
| APU transfer/sequence | `devices/audio/service_clock.ts:42–48`; `.cpp:29–36` |
| GPU ports/PCRTC split banks | `devices/gx/gpu.ts:462–471`; `.cpp:53–62`; paired `spec/gx/pcrtc.ts:100–103` / `.h:94–97` beneath the TS/C++ roots |
| GTE data/control/command/PLUS | `devices/gx/gte.ts:205–222`; `.cpp:68–85` |
| SYSTEM timing/control/fault | `devices/system/controller.ts:86–90,369–375`; `.cpp:48–52,311–317` |
| SYSTEM diagnostic ports | `devices/system/debug_transmit.ts:26–28`; `.cpp:8–11` |
| IMGDEC | `devices/imgdec/controller.ts:139–148,644–651`; `.cpp:45–53,547–554` |
| Cartridge controller | `devices/cartridge/controller.ts:72–77`; `.cpp:44–49` |
| Memory bus-fault words | `memory/memory.ts:175–177,829–833`; `.cpp:98–99,718–722` |

The legacy spec names IO_PAYLOAD_WRITE_PTR_INDEX and IO_PAYLOAD_BUFFER_BASE_INDEX
identify1+16384 positions at08000204H and[08000208H,08010208H), respectively:
TS spec/bmsx/io.ts:99–105,163–164 / C++ spec/bmsx/io.h:111–118,176–177.
No live protocol owner binds them. They are disjoint from every readonly range
and case in Memory TS:852–894 / C++:729–771. An admitted aligned word write
stores its value with no extra device action; read returns the raw word:
TS:366–376,627–642 / C++:245–259,522–536. Public terminology is reserved
retained words, not a pointer/FIFO/transfer ABI.

Raw slots clear to0 at hardware reset before device reset publication:
Memory TS:414–423 / C++:302–313; runtime TS:48–63,137–141 /
C++:20–24,100–116. Named unit reset values are not all0. No save-state ABI
or cartridge allocation permission is inferred.

The earlier contained-range and RAM-fallthrough facts above establish the new
boundary examples. U32 at0801043CH is the last complete slot, supervisor DOMAIN
(spec io TS:153–160 / C++:166–173). U32 at0801043EH and U16 at0801043FH cross
and select whole backing-RAM transfers, not a mixed slot/RAM read. Ordinary CPU
alignment precedes mapped access (existing Memory execution/access facts);
F64 instead has two ordered word transfers (existing Memory scalar facts).

## INPUT state at handoff and resumption

Normal BIOS handoff does not reset INPUT; supervisor return does not restore an
earlier cartridge sample. [INPUT timing facts, IT08–IT09](input-timing.md#bios-and-supervisor-ownership--2026-10-19)
retain the exact BIOS and paired owner sources. A fresh sample uses current
STATUS as its baseline, not an assumed reset sequence.
