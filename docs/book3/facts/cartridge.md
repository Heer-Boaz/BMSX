# Cartridge sockets and mapped card devices

Frozen 2026-10-18. Editorial evidence, not another cartridge-visible register bank. The current matching software behavior is authoritative for this edition. No architecture document or historical PDF supplied hardware facts.

# Cartridge composition and execution binding facts

Frozen 2026-10-18 from live owners. No architecture/PDF input. CPP/TS paired where applicable. Boot firmware is one shared producer, not two mirrors. Facts only.

- Two physical sockets numbered0,1. Controller presence means card object exists, not ROM/RAM/mailbox device presence/capacity/bootability. Devices independently optional. TS `machine/ts/spec/bmsx/cartridge.ts:1–6`, `machine/ts/machine/devices/cartridge/controller.ts:61–87`, `machine/ts/machine/devices/cartridge/card.ts:41–52`; CPP `machine/cpp/spec/bmsx/cartridge.h`, `machine/cpp/machine/devices/cartridge/controller.cpp:21–50`, `machine/cpp/machine/devices/cartridge/card.cpp:12–29`.
- Supported manifest hardware entries are `type: rom`, `type: ram` with `bytes`, `type: mailbox`. At most one of each. RAM bytes integer1..0x00f00000. ROM attachment exposes package bytes; a package without the ROM entry supplies no ROM device. These are media-definition inputs, not electrical runtime discovery registers. TS `machine/ts/rompack/manifest.ts:9–25,60–100`, `hosts/common/cartridge_media.ts:14–34`; CPP `machine/cpp/rompack/manifest.cpp:90–153`, `hosts/libretro/cartridge_media.cpp:8–23`.
- Active cartridge instruction-fetch bus signals carry the execution-domain socket, not ordinary SELECT. Page bindings and actual BE instruction reads use those signals. Changing SELECT alone therefore does not redirect currently active cartridge instruction fetching to the other socket. Do not infer that SELECT executes or initializes that socket. TS `machine/ts/machine/cpu/cpu.ts:1145–1156,1249–1290`; CPP `machine/cpp/machine/cpu/cpu.cpp:665–674,810–860`. Full EXEC/startup remains canonical Memory/CPU reference rather than redefined here.
- Installed BIOS scans present sockets0 then1 by writing SELECT. Ready test: ROM word0 magic58534d42H, word1 headerbytes>=60, word8 BLuaimage!=0,word10startup!=0. First ready card wins. On actual boot handoff BIOS sets IRQ_MASK0 then cop0.exec=startup. This is local firmware behavior, not an exported cartridge discovery BIOS API. Sole producer `machine/bios/main.lua:28–35,58–73,105–112`. Header/startup details already canonical in public `docs/book1/memory.md` startup/boot routes; author should reference rather than duplicate full format.
- No connector/pinout/voltage/hot insertion/removal/battery/persistence/independent oscillator/physical sustained throughput/remote mailbox processor guarantee in these bounded sources. Omit invented numeric or physical claims.


# Cartridge card: current paired facts

Scope: card-local ROM/RAM/MMIO owner only. No controller selection, IRQ/DREQ delivery, or mailbox protocol inference. Hardware extraction is complete; the separately flagged reusable save-storage disagreement below is not treated as a card MMIO defect. No implementation changes.

## Declared address windows (half-open)
- TS ROM is `[0x10000000, 0x30000000)`, a 512 MiB address window; magic offset is zero. Source: `machine/ts/spec/bmsx/memory_map.ts:6-13`.
- C++ declares the same ROM base/size/end and magic offset. Source: `machine/cpp/spec/bmsx/memory_map.h:12-19`.
- TS RAM is `[0x30000000, 0x30f00000)`, 15 MiB; MMIO is `[0x30f00000, 0x31000000)`, 1 MiB; MMIO end is cartridge bus end. Source: `machine/ts/spec/bmsx/memory_map.ts:15-21`.
- C++ declares the same RAM/MMIO windows and cartridge bus end. Source: `machine/cpp/spec/bmsx/memory_map.h:21-27`.

## Installed media versus windows
- TS media independently supplies nullable ROM bytes, nullable RAM byte count, and mailbox presence; the constructor keeps the ROM byte array, allocates exactly the supplied RAM byte count, and conditionally creates a mailbox. Source: `machine/ts/machine/devices/cartridge/card.ts:41-50`.
- C++ constructs the corresponding optional ROM span, RAM vector of the supplied count, and mailbox; these constructor branches impose no address-window capacity limit. Source: `machine/cpp/machine/devices/cartridge/card.cpp:11-25`.
- TS RAM backing is newly zero-initialized `Uint8Array(media.ramByteCount)`; reported RAM byte count is the backing byte length, or zero when absent. Source: `machine/ts/machine/devices/cartridge/card.ts:43-55`.
- C++ RAM backing is `std::vector<u8>(byteCount)` and reported count is its size, or zero when absent. Source: `machine/cpp/machine/devices/cartridge/card.h:17-19,42-48`.
- TS ROM replacement changes the existing region's byte array and invalidates the complete ROM mapped range, not a copied/truncated image. Source: `machine/ts/machine/devices/cartridge/card.ts:57-64`.
- C++ ROM replacement changes the existing region's span and invalidates the complete ROM mapped range. Source: `machine/cpp/machine/devices/cartridge/card.cpp:27-34`.

## Scalar reads within the declared cartridge bus window
- TS central 16/32-bit read/write helpers are little-endian and place the low byte at the supplied byte offset. Source: `machine/ts/common/endian.ts:1-3,10-29`.
- C++ central 16/32-bit read/write helpers use the corresponding little-endian byte ordering. Source: `machine/cpp/common/endian.h:10-12,18-23,44-54`.
- TS byte reads select ROM/RAM by the starting address, subtract the corresponding window base, and return backing byte `offset` when installed and in capacity, otherwise zero; no modulo/wrap is applied. Source: `machine/ts/machine/devices/cartridge/card.ts:147-157`.
- C++ byte reads use the same branch, base subtraction, and absent/out-of-capacity zero result. Source: `machine/cpp/machine/devices/cartridge/card.cpp:116-124`.
- TS 16/32-bit ROM/RAM reads choose backing storage by the starting address, return zero for absent storage, and pass the base-relative byte offset to the width helper. Source: `machine/ts/machine/devices/cartridge/card.ts:162-187`.
- C++ 16/32-bit reads use the corresponding starting-address selection and base-relative helpers. Source: `machine/cpp/machine/devices/cartridge/card.cpp:129-154`.
- TS ROM/RAM scalar reads do not align/round the supplied address: the exact base-relative byte offset reaches the backing helper. Source: `machine/ts/machine/devices/cartridge/card.ts:162-187`.
- C++ ROM/RAM scalar reads likewise use the exact base-relative byte offset. Source: `machine/cpp/machine/devices/cartridge/card.cpp:129-154`.
- TS 16-bit tail reads return the remaining byte as the low byte; wholly out-of-capacity reads return zero. Source: `machine/ts/machine/devices/cartridge/card.ts:284-287`.
- C++ 16-bit tail reads have the same remaining-low-byte/zero rule. Source: `machine/cpp/machine/devices/cartridge/card.cpp:259-262`.
- TS 32-bit tail reads assemble available bytes into bits 0..23 and leave missing high bytes zero; wholly out-of-capacity reads return zero. Source: `machine/ts/machine/devices/cartridge/card.ts:303-309`.
- C++ 32-bit tail reads use the same available-byte assembly and zero result. Source: `machine/cpp/machine/devices/cartridge/card.cpp:264-270`.
- TS bulk reads wholly within a ROM/RAM window copy available backing bytes then zero-fill the remainder; runs crossing windows call `readU8` for each byte. Source: `machine/ts/machine/devices/cartridge/card.ts:242-261,289-300`.
- C++ bulk reads implement the corresponding copy/zero-fill and crossing-window byte loop. Source: `machine/cpp/machine/devices/cartridge/card.cpp:206-235,273-287`.

## Writes and optional MMIO attachment
- TS 8/16-bit writes outside the RAM window do nothing, including ROM and MMIO; RAM writes occur only when the entire 1/2-byte width fits installed RAM capacity. Source: `machine/ts/machine/devices/cartridge/card.ts:191-218`.
- C++ 8/16-bit writes have the same RAM-window/full-width-fit rule. Source: `machine/cpp/machine/devices/cartridge/card.cpp:158-183`.
- TS 32-bit RAM writes require the starting address in the RAM window and all four bytes in installed RAM; ROM writes do nothing. Source: `machine/ts/machine/devices/cartridge/card.ts:221-239`.
- C++ 32-bit RAM/ROM writes use the same conditions. Source: `machine/cpp/machine/devices/cartridge/card.cpp:186-203`.
- TS MMIO reads forward `address - CART_MMIO_BASE` unchanged to the mailbox word reader, or obtain zero if absent; byte lanes select `address & 3`, halfword lanes select `address & 2`, and 32-bit reads return the word. Source: `machine/ts/machine/devices/cartridge/card.ts:158-159,173-174,188,280-281`.
- C++ MMIO reads use the corresponding offset forwarding and byte/halfword/word lane extraction. Source: `machine/cpp/machine/devices/cartridge/card.cpp:125-126,140-141,155,255-256`.
- TS 32-bit MMIO writes require an attached mailbox and forward the unchanged relative offset plus unsigned word; card-local code checks only `address >= CART_MMIO_BASE`, not MMIO end. Source: `machine/ts/machine/devices/cartridge/card.ts:236-239`.
- C++ 32-bit MMIO forwarding has the same mailbox/lower-bound condition and no card-local upper-bound test. Source: `machine/cpp/machine/devices/cartridge/card.cpp:200-203`.

## Reset and saved state
- TS card reset invokes only optional mailbox reset; it neither clears RAM nor changes ROM. Source: `machine/ts/machine/devices/cartridge/card.ts:107-109`.
- C++ card reset has the same retention behavior. Source: `machine/cpp/machine/devices/cartridge/card.cpp:77-79`.
- TS card save-state schema contains nullable RAM bytes and nullable mailbox state, no ROM; mailbox state fields are `dataWord`, `controlWord`, and `irqPending`. Source: `machine/ts/machine/devices/cartridge/contracts.ts:12-21`.
- C++ schema has corresponding optional RAM/mailbox state, with `u32 dataWord`, `u32 controlWord`, and boolean `irqPending`, no ROM. Source: `machine/cpp/machine/devices/cartridge/contracts.h:24-33`.
- TS restore requires matching RAM/mailbox presence and exact RAM byte count, then copies RAM and restores the attached mailbox. Source: `machine/ts/machine/devices/cartridge/card.ts:123-144`.
- C++ restore applies corresponding presence/size checks, RAM copy, and optional mailbox restore. Source: `machine/cpp/machine/devices/cartridge/card.cpp:92-113`.

## Direct mapped views (implementation detail, not another hardware window)
- TS ROM page binding is cacheable even when no bytes cover the page; direct backing is exposed only if the complete mapped page fits installed ROM. Source: `machine/ts/machine/devices/cartridge/card.ts:75-89`.
- C++ ROM page binding has the same cacheable/full-page-fit rule. Source: `machine/cpp/machine/devices/cartridge/card.cpp:51-61`.
- TS RAM page binding requires the page start inside installed RAM, exposes direct bytes only when the complete page fits, and otherwise leaves MMIO/unbacked RAM non-cacheable. Source: `machine/ts/machine/devices/cartridge/card.ts:91-104`.
- C++ RAM/MMIO page binding applies the corresponding conditions. Source: `machine/cpp/machine/devices/cartridge/card.cpp:63-74`.
- TS mapped page byte size is 1024, not an installed-media capacity or hardware wrapping granularity. Source: `machine/ts/machine/memory/mapped_page.ts:1-3`.
- C++ mapped page byte size is likewise 1024. Source: `machine/cpp/machine/memory/mapped_page.h:10-12`.

## Exact paired disagreement: reusable save-storage topology
- TS `captureState(storage)` starts saved RAM as null, copies present RAM into `storage.ram` when supplied (without creating a missing buffer), and returns a new object whose absent RAM/mailbox fields are null. Source: `machine/ts/machine/devices/cartridge/card.ts:111-120`.
- C++ `captureState(storage)` creates missing supplied RAM storage when RAM is installed, updates only present regions, and returns supplied storage unchanged for absent regions. Thus stale RAM/mailbox optionals survive when the current card lacks those regions, unlike TS. Source: `machine/cpp/machine/devices/cartridge/card.cpp:81-89`.
- Classification: reusable save-storage representation disagreement, not evidence of differing ROM/RAM/MMIO bus behavior. No controller or mailbox-protocol claim follows from it.


# Cartridge mailbox — current paired-owner facts
Read-only extraction; mailbox-relative offsets only. TS/C++ leaves and mailbox owners checked; no paired disagreement found for word-valued offsets/data. No card mapping or central IRQ delivery claims.

## Registers and decoding
- DATA offset = 0x00. Source: `machine/ts/spec/bmsx/cartridge.ts:8`.
- CONTROL offset = 0x04. Source: `machine/ts/spec/bmsx/cartridge.ts:9`.
- STATUS offset = 0x08. Source: `machine/ts/spec/bmsx/cartridge.ts:10`.
- IRQ_ACK offset = 0x0c. Source: `machine/ts/spec/bmsx/cartridge.ts:11`.
- Paired C++ offsets are identical. Source: `machine/cpp/spec/bmsx/cartridge.h:13-16`.
- Read decode clears the low two offset bits: +0x00..03 read DATA, +0x04..07 CONTROL, +0x08..0b STATUS; every other aligned group (including +0x0c..0f) reads zero. Source: `machine/ts/machine/devices/cartridge/mailbox.ts:45-55`.
- C++ uses the same masked read decode and default zero. Source: `machine/cpp/machine/devices/cartridge/mailbox.cpp:28-38`.
- Writes decode the exact offset, not the read-aligned offset: only +0x00, +0x04 and +0x0c have actions; STATUS, unaligned offsets and every other offset ignore the write and return zero effects. Source: `machine/ts/machine/devices/cartridge/mailbox.ts:58-80`.
- C++ uses the same exact-offset write decode. Source: `machine/cpp/machine/devices/cartridge/mailbox.cpp:41-63`.

## DATA / CONTROL / STATUS / IRQ_ACK
- DATA is a retained word, directly read and replaced by DATA writes; a DATA write reports no effects. Source: `machine/cpp/machine/devices/cartridge/mailbox.cpp:30-31,43-45`.
- CONTROL bit 0 is IRQ_TRIGGER; bits 1 and 2 are DREQ_READ and DREQ_WRITE. Source: `machine/ts/spec/bmsx/cartridge.ts:12-14`.
- Paired C++ CONTROL bit constants are identical. Source: `machine/cpp/spec/bmsx/cartridge.h:17-19`.
- A CONTROL write replaces the entire retained CONTROL word with value & ~IRQ_TRIGGER; bit 0 is an action, not latched by writes; bits 1..31, including unnamed bits, are retained. Source: `machine/cpp/machine/devices/cartridge/mailbox.cpp:46-48`.
- CONTROL reads return the retained word, not a synthesized mask. Source: `machine/ts/machine/devices/cartridge/mailbox.ts:49-50`.
- STATUS is synthesized as IRQ_PENDING bit 0 when the local pending latch is set, otherwise zero; no other status bits are emitted. Source: `machine/cpp/machine/devices/cartridge/mailbox.cpp:34-35`.
- IRQ_ACK is write-action only: any nonzero word clears the local pending latch; zero leaves it unchanged. It returns no effects and changes neither DATA nor CONTROL. Source: `machine/ts/machine/devices/cartridge/mailbox.ts:75-77`.

## Local IRQ and DREQ
- A CONTROL write containing IRQ_TRIGGER sets local pending and reports IRQ_EDGE only when pending was clear. A trigger while already pending reports no new IRQ edge. Source: `machine/ts/machine/devices/cartridge/mailbox.ts:69-72`.
- Writing CONTROL with trigger clear does not clear pending; after a nonzero local ACK a later trigger write can emit a new edge, without requiring a preceding trigger-clear write. Source: `machine/cpp/machine/devices/cartridge/mailbox.cpp:48-59`.
- CONTROL bit 1 directly asserts the returned DREQ_READ level; CONTROL bit 2 directly asserts DREQ_WRITE; both can be asserted together; no other CONTROL bits contribute. Source: `machine/ts/machine/devices/cartridge/mailbox.ts:83-91`.
- Paired C++ DREQ derivation is identical. Source: `machine/cpp/machine/devices/cartridge/mailbox.cpp:66-74`.
- DREQ_READ signal mask = bit 0; DREQ_WRITE signal mask = bit 1 (these signal masks differ from CONTROL bit positions). Source: `machine/ts/machine/devices/cartridge/signals.ts:4-5`.
- A CONTROL write reports DREQ_CHANGED iff the derived DREQ levels differ before/after; IRQ_EDGE can be ORed into the same effects word. Source: `machine/cpp/machine/devices/cartridge/mailbox.cpp:47-56`.
- Effect masks are IRQ_EDGE bit 0 and DREQ_CHANGED bit 1; C++ defines the same masks. Source: `machine/cpp/machine/devices/cartridge/signals.h:7-11`.

## Reset / state
- Construction initializes DATA=0, CONTROL=0 and local pending=false. Source: `machine/cpp/machine/devices/cartridge/mailbox.h:16-19`.
- Reset writes DATA=0, CONTROL=0 and local pending=false; reset returns no signal/effects word. Source: `machine/ts/machine/devices/cartridge/mailbox.ts:25-29`.
- Paired C++ reset is identical. Source: `machine/cpp/machine/devices/cartridge/mailbox.cpp:8-12`.
- Saved mailbox state is exactly two u32 words (dataWord, controlWord) plus one boolean (irqPending), not a separately saved STATUS/DREQ/effect word. Source: `machine/cpp/machine/devices/cartridge/contracts.h:24-28`.
- Capture returns all three retained fields. Source: `machine/ts/machine/devices/cartridge/mailbox.ts:31-37`.
- TS restore assigns both words via >>>0 and assigns the boolean directly; it does not run CONTROL write actions or mask out bit 0. Source: `machine/ts/machine/devices/cartridge/mailbox.ts:39-43`.
- C++ restore directly assigns the same two u32 words and boolean; it emits no effects and does not run CONTROL write actions. Source: `machine/cpp/machine/devices/cartridge/mailbox.cpp:22-26`.


# Cartridge capture-storage triage — read-only, bounded

## Proved difference and scope
- TS controller.ts131–138 emits null for absent physical cards; C++ controller.cpp100–107 retains supplied occupied slots for absent cards. TS card.ts111–120 emits null for absent optional regions and expects a supplied matching RAM buffer; C++ card.cpp81–89 retains stale absent-region storage and allocates missing RAM storage. Exact source paths are machine/{ts,cpp}/machine/devices/cartridge/{controller,card}.
- This is a reusable capture-storage API difference under mismatched supplied storage. It is not a cartridge word, MMIO write/read, IRQ edge or DREQ-selector disagreement; neither spec/bmsx/cartridge leaf defines buffer-allocation/reuse semantics. Fresh capture storage produces current null/optional presence in both owners. No ordinary cartridge-visible effect or normal failing runtime producer is established by the differing branches.

## Actual examined producer chain
- Paired machine save functions pass storage.cartridge to controller capture: machine/ts/machine/save_state.ts78–96 and machine/cpp/machine/save_state.cpp64–80. Fresh captureMachineState uses no supplied storage: TS46–65 / C++35–52.
- Runtime save wrappers carry the same runtime.machine and its supplied storage: machine/ts/machine/runtime/save_machine_state.ts13–21; machine/cpp/machine/runtime/save_machine_state.cpp8–14; public runtime wrappers in runtime/save_state.{ts,cpp} forward that storage.
- Examined production reuse owner is RuntimeHistory bound to one Runtime: TS runtime/history/history.ts47–48,107–115; C++ runtime/history/history.h24 and history.cpp51–58. It recycles the evicted/inactive checkpoint from its own ring. start allocates empty checkpoint slots (TS76–84/C++history.cpp21–32), stop clears that ring (TS91–104/C++34–49). No cross-runtime storage producer was found in this examined path.
- Physical socket/card regions are constructed from media once: TS controller.ts56–69/card.ts41–50; C++ controller.cpp constructor/card.cpp11–25. Exposed installRom replaces existing ROM bytes, not socket/card-region topology: TS controller.ts87–89/card.ts57–64; C++ controller.cpp installRom/card.cpp27–34. Reset does not replace topology. This is source ownership evidence, not a universal external-caller proof.

## Decision for manual work
- Retain the API asymmetry as a separate editorial follow-up; do not fix runtime or invent a compatibility/fallback/validation layer from documentation work. Actual general capture-storage preconditions/all external API uses are not comprehensively audited here.
- The broad extraction stop was conservative. Hardware-facing extraction may now resume for matching raw-register/bus/IRQ/DREQ behavior under the installed card topology. Record this known excluded API issue and do not claim universal reusable-buffer equivalence or native runtime conformance.
- Save-state fact statements may list the actual shared logical saved words/regions or fresh matching-topology contents; they must not assert interchangeable cross-topology allocation/reuse behavior. This resolves no physical/pin/timing gap by inference.
- No files in the repository were edited, no ownership code moved, no defensive checks/repair added. No architecture document or reference PDF was opened. This is a scoped source classification, not a newly measured runtime result.


# Shared IRQ bridge facts

- IRQ FLAGS/ACK/MASK are words08000000H/08000004H/08000008H. DMA0 done isbit0; cartridge socket0bit9 (200H),socket1bit10(400H). Spec TS `machine/ts/spec/bmsx/io.ts:3–17,213–224,361–372`; CPP `machine/cpp/spec/bmsx/io.h:15–29,226–237,374–385`; IO base/wordsize in mirrored memory_map leaves.
- Controller route raises matching socketbit only when card write returns IRQ_EDGE. DREQ_CHANGED republishes that socket's two levels. TS `machine/ts/machine/devices/cartridge/controller.ts:183–194,205–228`; CPP `machine/cpp/machine/devices/cartridge/controller.cpp:128–135,156–179`.
- IRQ raise ORs pending regardless MASK; ACK clears exactly writtenones, MASK replaces full mask, FLAGS reads don'tclear. (pending & mask)!=0 output indication. Maskzero permits polling pending without delivery. Paired TS `machine/ts/machine/devices/irq/controller.ts:72–81,91–115,118–125`; CPP `machine/cpp/machine/devices/irq/controller.cpp:29–34,62–93`; output predicate CPP controller.h. Reset pending/mask0 TS19–27/CPP14–22.
- Thus central ACK alone does not clear mailboxlocalpending or rearm localedge; mailboxACK doesn't clear centralpending, not even ifnootherlocaledge. Bothlatchesmustbehandledseparately. Derived directly from independent mailbox/control owners + central above; order isn't a universal remoteproducer rearm/transaction guarantee. Full CPU interrupt acceptance remains BookI IRQ reference.
# Cartridge controller hardware facts — bounded paired-source extraction

- Scope: current `e0c77de6d`; paired cartridge leaf/controller/header/contracts plus imported IO/memory-map/bus-signal/card-effect constants. No repository edits; no architecture/PDF/card/mailbox implementation read. The prior stop record remains `/tmp/bmsx-cartridge-controller-current-facts.md`; cross-topology capture-buffer reuse asymmetry is excluded per `/tmp/bmsx-cartridge-capture-storage-triage.md`, not claimed equivalent.

## Physical sockets and raw words
- There are two sockets, indices 0 and 1. Sources: `machine/ts/spec/bmsx/cartridge.ts:1-2`; `machine/cpp/spec/bmsx/cartridge.h:7`.
- Constructor media presence creates each socket's card or leaves that socket absent independently. Sources: `machine/ts/machine/devices/cartridge/controller.ts:61-69`; `machine/cpp/machine/devices/cartridge/controller.cpp:26-42`.
- `SELECT = IO_CART_SELECT = 0x08010420`; `STATUS = IO_CART_STATUS = 0x08010424` (derived from the checked constant chain: SELECT index 16648, STATUS index 16649, IO base 0x08000000, word size 4). Address expressions: `machine/ts/spec/bmsx/io.ts:149-152,193-195`; `machine/cpp/spec/bmsx/io.h:162-165,206-208`. Base/stride: `machine/ts/spec/bmsx/memory_map.ts:6,23,32`; `machine/cpp/spec/bmsx/memory_map.h:12,29,38`. Index dependencies: `machine/ts/spec/bmsx/io.ts:3-149`; `machine/cpp/spec/bmsx/io.h:15-162`.
- Controller registers SELECT read and write handlers and STATUS read only; it registers no STATUS write handler. Sources: `machine/ts/machine/devices/cartridge/controller.ts:72-78`; `machine/cpp/machine/devices/cartridge/controller.cpp:44-50`.
- SELECT is one retained raw selection word, initially zero; the native owner stores `u32`. Sources: `machine/ts/machine/devices/cartridge/controller.ts:56-57`; `machine/cpp/machine/devices/cartridge/controller.h:82-83`.
- SELECT write retains the supplied word without masking high bits; SELECT read returns the whole retained word. Sources: `machine/ts/machine/devices/cartridge/controller.ts:228-234`; `machine/cpp/machine/devices/cartridge/controller.cpp:179-190`.
- Without transaction override, only SELECT bit 0 chooses the card: 0 selects socket 0; 1 selects socket 1. Bits 31:1 remain readable but do not affect socket choice. Selection does not test presence. Sources: `machine/ts/machine/devices/cartridge/controller.ts:80-85`; `machine/cpp/machine/devices/cartridge/controller.h:29-34`.
- STATUS bit 0 = socket 0 present (0x00000001); bit 1 = socket 1 present (0x00000002); bit 16 = ordinary selected socket is 1 (0x00010000). Constants: `machine/ts/spec/bmsx/cartridge.ts:4-6`; `machine/cpp/spec/bmsx/cartridge.h:9-11`.
- STATUS is computed from physical card presence and the default selected slot; all other bits are zero. It is not a retained writable STATUS latch. Sources: `machine/ts/machine/devices/cartridge/controller.ts:236-240`; `machine/cpp/machine/devices/cartridge/controller.cpp:192-197`.
- A transaction-specific override is not reflected in STATUS: STATUS calls `selectedSlot()` with its default CPU signals instead of the initiating transaction's signals. Sources: `machine/ts/machine/devices/cartridge/controller.ts:80,236-240`; `machine/cpp/machine/devices/cartridge/controller.h:29` and `machine/cpp/machine/devices/cartridge/controller.cpp:192-197`.
- SELECT write changes only selectionWord: it does not route an IRQ, republish DREQ, or reset cards. Sources: `machine/ts/machine/devices/cartridge/controller.ts:232-234`; `machine/cpp/machine/devices/cartridge/controller.cpp:183-190`.

## CPU/DMA bus selection
- Bus signal constants: CPU master = 0, DMA master = 1, block-end = 2, cartridge override = 4, socket-1 select = 8. Sources: `machine/ts/machine/memory/bus_signals.ts:1-5`; `machine/cpp/machine/memory/bus_signals.h:9-16`.
- If override bit 4 is clear, both CPU and DMA use SELECT bit 0; the master and block-end bits do not participate in the controller's choice. If override bit 4 is set, bit 8 clear selects socket 0 and bit 8 set selects socket 1, independently of SELECT. Sources: `machine/ts/machine/devices/cartridge/controller.ts:80-85`; `machine/cpp/machine/devices/cartridge/controller.h:29-34`.
- The central slot-signal producer emits `4 | (slot * 8)`, thus slot-0 signal 4 and slot-1 signal 12. It does not change SELECT. Sources: `machine/ts/machine/memory/bus_signals.ts:12-14`; `machine/cpp/machine/memory/bus_signals.h:18-22`.
- Mapped-page binding and byte/halfword/word card reads/writes use `selectedSlot(busSignals)` on the access; they delegate only to that socket's card. Sources: `machine/ts/machine/devices/cartridge/controller.ts:101-106,153-188`; `machine/cpp/machine/devices/cartridge/controller.cpp:73-82` and `machine/cpp/machine/devices/cartridge/controller.h:44-69`.
- The controller's bulk `readBytes` uses ordinary default selection, not a supplied DMA override. Sources: `machine/ts/machine/devices/cartridge/controller.ts:191-197`; `machine/cpp/machine/devices/cartridge/controller.cpp:137-143`.

## IRQ and DREQ propagation (controller boundary only)
- Card write effects have IRQ-edge flag 0x1 and DREQ-changed flag 0x2; card DREQ lines have READ flag 0x1 and WRITE flag 0x2. Sources: `machine/ts/machine/devices/cartridge/signals.ts:1-5`; `machine/cpp/machine/devices/cartridge/signals.h:7-11`.
- On a selected present card's `writeU32`, an IRQ-edge effect causes `irq.raise` for that physical socket, and a DREQ-changed effect republishes that socket's request lines. Sources: `machine/ts/machine/devices/cartridge/controller.ts:178-188`; `machine/cpp/machine/devices/cartridge/controller.h:64-69` and `machine/cpp/machine/devices/cartridge/controller.cpp:128-134`.
- Socket IRQ masks are slot 0 = 1<<9 = 0x200 and slot 1 = 1<<10 = 0x400. Sources: `machine/ts/spec/bmsx/io.ts:371-372`; `machine/cpp/spec/bmsx/io.h:384-385`.
- The controller routes no card effect on reads or on its byte/halfword writes; those methods directly return/delegate. Sources: `machine/ts/machine/devices/cartridge/controller.ts:153-175`; `machine/cpp/machine/devices/cartridge/controller.h:44-62`.
- DMA request selector numbers are slot 0 WRITE=7, READ=8; slot 1 WRITE=9, READ=10. Sources: `machine/ts/spec/bmsx/io.ts:390-393`; `machine/cpp/spec/bmsx/io.h:403-406`.
- Per-socket publication translates card WRITE/READ flags into the corresponding DMA request bits, then calls `setRequestLines` with only that socket's mask: slot 0 mask 0x180, slot 1 mask 0x600. Sources: `machine/ts/machine/devices/cartridge/controller.ts:48-53,205-225`; `machine/cpp/machine/devices/cartridge/controller.cpp:15-20,156-176`.
- DREQ publication obtains each socket's card lines independently of SELECT; an absent card supplies zero asserted lines. Sources: `machine/ts/machine/devices/cartridge/controller.ts:205-225`; `machine/cpp/machine/devices/cartridge/controller.cpp:156-176`.
- Controller-origin DREQ publication occurs after reset, after restore, and after a word-write DREQ-changed effect. Sources: `machine/ts/machine/devices/cartridge/controller.ts:123-128,141-150,178-188`; `machine/cpp/machine/devices/cartridge/controller.cpp:92-97,110-125,128-134`.

## Reset, absence, and saved logical fields
- Reset writes SELECT=0, calls reset only on present cards, then republishes DREQ for both sockets. It does not replace physical socket presence. It makes no controller IRQ-raise/clear call; nested card reset effects are not inferred. Sources: `machine/ts/machine/devices/cartridge/controller.ts:123-129`; `machine/cpp/machine/devices/cartridge/controller.cpp:92-98`.
- Consequently STATUS immediately after controller reset has bit 16 clear and bits 0/1 reflecting the installed physical cards, not necessarily an all-zero word. Sources: `machine/ts/machine/devices/cartridge/controller.ts:123-128,236-240`; `machine/cpp/machine/devices/cartridge/controller.cpp:92-97,192-197`.
- A selected absent socket returns zero for 8/16/32-bit card reads; byte/halfword/word writes do nothing and route no effects. Sources: `machine/ts/machine/devices/cartridge/controller.ts:153-188`; `machine/cpp/machine/devices/cartridge/controller.h:44-69`.
- Bulk read from an absent selected socket fills the requested output bytes with zero; explicit-slot ROM byte-view binding reports false for absence. Sources: `machine/ts/machine/devices/cartridge/controller.ts:191-202`; `machine/cpp/machine/devices/cartridge/controller.cpp:137-153`.
- For absent mapped-page binding, the controller emits no read-byte backing or write watch, uses the address plus a socket-specific key offset (slot 0 0x100000000; slot 1 0x200000000), and marks addresses below CART_RAM_BASE cacheable. This states binding metadata, not a separately proved memory-consumer result. Sources: `machine/ts/machine/devices/cartridge/controller.ts:46-47,101-115`; `machine/cpp/machine/devices/cartridge/controller.cpp:21-22,73-89`.
- The controller snapshot's own saved raw word is `selectionWord`; it also carries two optional/null delegated `slots`. It has no separate saved STATUS/IRQ/DREQ field. Sources: `machine/ts/machine/devices/cartridge/contracts.ts:23-26`; `machine/cpp/machine/devices/cartridge/contracts.h:35-38`.
- Fresh capture copies the entire selection word and captures present cards, leaving absent slots null/empty; this statement excludes mismatched supplied capture-storage reuse. Sources: `machine/ts/machine/devices/cartridge/controller.ts:131-138`; `machine/cpp/machine/devices/cartridge/controller.h:41` and `machine/cpp/machine/devices/cartridge/controller.cpp:100-107`.
- Nested saved-state contracts contain optional RAM bytes and optional mailbox state; the latter declares `dataWord`, `controlWord`, and `irqPending`. This lists contract fields only, not nested device behavior or capture implementation. Sources: `machine/ts/machine/devices/cartridge/contracts.ts:12-21`; `machine/cpp/machine/devices/cartridge/contracts.h:24-33`.
- Restore requires saved socket occupancy to match physical sockets, restores selectionWord (TS unsigned-word coercion; native u32), delegates present-card restoration, then republishes both sockets' DREQ. It does not issue a controller IRQ raise. Sources: `machine/ts/machine/devices/cartridge/controller.ts:141-150`; `machine/cpp/machine/devices/cartridge/controller.cpp:110-125`.

## Explicit limits
- No new raw hardware/spec disagreement found in the checked scope. This is source evidence, not a measured native/runtime conformance claim.
- Not established here: narrow/misaligned SELECT/STATUS MMIO dispatch behavior; CPU/DMA bus timing; DMA selector-to-override production outside the central signal helper; IRQ-controller acknowledgement/latching; card/mailbox effects or reset contents; electrical hotplug; any universal reusable capture-buffer guarantee.
# Two-socket example actual observations, 2026-10-18

- New ordinary cart101 + results32 literal BLua lines; two manifests256byteRAM+mailbox each, ROM only programslot0. New supplied existing-route integration case `two_sockets_local_edges_and_cross_socket_dma` PASSED. Source `carts/cartridge_manual/{cart.lua,results.lua}`, `tests/carts/cartridge_manual/cartridge_manual_assert.lua`; log `/tmp/bmsx-cartridge-manual-guest.log`.
- Result observations asserted by that passedcase: boot_status3; selection_word80000001H; selected_status00010003H; data_card_rom0; ram_words10203040H,50607080H; mailbox DATA6d61696cH|slot and CONTROL80000000H; localpending1; firstcentraledge200H/400H; centralACK/retriggerwithoutlocalACK0; localACK/retrigger200H/400H; final localstatus0; requestcontrols2/4; DMAselection1,CONTROL E63H,STATUS2,count0,readendseed_address+16,writeend30000020H,pending1; received01234567H,89abcdefH,55aa33ccH,f00dcafeH; untouchedsocket0 destinationwordsall0; busfault0.
- These are retained snapshots from derived guest image, NOT an observed72cycle total, IRQentrylatency or native full-cartridgeexecution. Absolute linked seed address deliberately result-derived; no universal numericROMoffset or BSSaddress asserted.
- Freshcard allocation under ordinary CLI required for initialzero untouchedRAM; warmreset retainsRAM. Bothmanifests andexplicitpositional0/--slot1data needed. Independent source reviewer identified these publicrecipeconditions, no code/expectationmistake.
- Quality-enabled ordinary cart validation PASS log `/tmp/bmsx-cartridge-manual-validate.log`, dataonlyordinarybuildPASS `/tmp/bmsx-cartridge-manual-data-build.log`, currenttoolingproductPASS `/tmp/bmsx-cartridge-manual-product-build.log`.
- Separately ordinaryplayerproduct and two-mediaTTL2 playback PASS logs `/tmp/bmsx-cartridge-manual-player-build.log`, `/tmp/bmsx-cartridge-manual-player.log`. Loads actualordinaryROM, BIOSready, game-loop andTTL; DOES NOT assert resultvalues/renderedoutput.
- Existing pairedfocusedownersuites:10TS tests PASS (`cartridge_card`, `cartridge_controller`, `cartridge_manifest`);3native CTest suites PASS after currenttargetbuildninjano-work. Logs `/tmp/bmsx-cartridge-manual-ts-tests.log`, `/tmp/bmsx-cartridge-manual-cpp-{build,tests}.log`. Not native execution of completecart.
# Cartridge DMA and mapped-access facts
Scope: paired live specifications and bounded owners; no chapter prose, runtime edits, test timing overrides, physical pin/oscillator assumptions, or capture-storage allocation equivalence. No raw hardware disagreement found in this scope. Paths below are repository relative.

## Request fields and socket selection
- DMA CONTROL READ_INCREMENT bit0; WRITE_INCREMENT bit1; READ_REQUEST bits5:2; WRITE_REQUEST bits9:6; BLOCK_WORDS bits13:10, encoded words minus1. Each selected increment advances4 bytes per word. Sources: machine/ts/spec/bmsx/io.ts:374–382 and machine/ts/machine/devices/dma/controller.ts:220–225,416–419; machine/cpp/spec/bmsx/io.h:387–395 and machine/cpp/machine/devices/dma/controller.cpp:150–155,340–343.
- Request selector0=FORCE,7=slot0 WRITE,8=slot0 READ,9=slot1 WRITE,10=slot1 READ,15=DISABLED. Sources: machine/ts/spec/bmsx/io.ts:383–394; machine/cpp/spec/bmsx/io.h:396–407.
- Each endpoint's request selector independently supplies that endpoint's socket override:7 or8 forces slot0;9 or10 forces slot1. These are not global CART_SELECT writes. Sources: machine/ts/machine/devices/dma/controller.ts:222–232,504–515; machine/cpp/machine/devices/dma/controller.cpp:152–162,429–440.
- Other request selectors supply no cartridge socket override. An unoverridden cartridge bus access selects CART_SELECT bit0; override uses its supplied socket regardless of CART_SELECT. Sources: machine/ts/machine/devices/dma/controller.ts:504–515 and machine/ts/machine/devices/cartridge/controller.ts:80–85; machine/cpp/machine/devices/dma/controller.cpp:429–440 and machine/cpp/machine/devices/cartridge/controller.h:29–34.
- Socket override signals are OVERRIDE bit2 and SLOT1 bit3; the slot helper returns4|(slot*8); CPU master supplies0 and DMA master bit0. These are internal bus strobes, not cartridge-program register fields. Sources: machine/ts/machine/memory/bus_signals.ts:1–14; machine/cpp/machine/memory/bus_signals.h:9–21.
- Both programmed request conditions must be asserted for a block to be admitted. FORCE is unconditionally true; DISABLED unconditionally false; other selectors test their corresponding request-line bit. Sources: machine/ts/machine/devices/dma/controller.ts:487–502; machine/cpp/machine/devices/dma/controller.cpp:412–427.
- Card DREQ_READ drives selector8 for slot0 or10 for slot1; DREQ_WRITE drives7 or9 respectively. Card absence produces no asserted requests; a card with no mailbox produces no DREQ. Sources: machine/ts/machine/devices/cartridge/controller.ts:205–225 and machine/ts/machine/devices/cartridge/card.ts:276–278; machine/cpp/machine/devices/cartridge/controller.cpp:156–176 and machine/cpp/machine/devices/cartridge/card.cpp:251–253.
- Mailbox CONTROL bit1 sets DREQ_READ; bit2 sets DREQ_WRITE. Both levels may be asserted simultaneously. A CONTROL write changing either level republishes that socket's lines and reevaluates DMA arbitration at the current cycle. Sources: machine/ts/spec/bmsx/cartridge.ts:12–14, machine/ts/machine/devices/cartridge/mailbox.ts:63–73,83–91, machine/ts/machine/devices/cartridge/controller.ts:178–188,205–225 and machine/ts/machine/devices/dma/controller.ts:171–178; machine/cpp/spec/bmsx/cartridge.h:17–19, machine/cpp/machine/devices/cartridge/mailbox.cpp:46–56,66–74, machine/cpp/machine/devices/cartridge/controller.cpp:128–134,156–176 and machine/cpp/machine/devices/dma/controller.cpp:101–108.
- Request selectors affect admission and socket routing, not the address range: a cartridge request can gate an endpoint addressed to cartridge ROM, card RAM, or mailbox MMIO. Address access remains governed by Memory/Card. Sources: machine/ts/machine/devices/dma/controller.ts:224–232,487–515 and machine/ts/machine/memory/memory.ts:544–570,627–656; machine/cpp/machine/devices/dma/controller.cpp:154–162,412–440 and machine/cpp/machine/memory/memory.cpp:434–460,522–550.

## Installed coefficients and exact admitted-block calculation
- Installed model CPU clock33,868,800Hz; main-RAM coefficient1 cycle/word plus1 setup cycle; system-ROM1 cycle/word; cartridge8 cycles/word plus4 setup cycles. Sources: machine/ts/spec/bmsx/model.ts:7–12,46–52; machine/cpp/spec/bmsx/model.h:12–17,51–57.
- Machine construction passes all five DMA coefficients from its model to DMA setTiming; Runtime forwards machineModel to Machine. Sources: machine/ts/machine/machine.ts:98–105 and machine/ts/machine/runtime/runtime.ts:126–136; machine/cpp/machine/machine.cpp:41–48 and machine/cpp/machine/runtime/runtime.cpp:12–18.
- Actual ordinary TS Node launcher supplies PSX_MACHINE_SPEC; native libretro content constructor supplies the same mirrored model. Sources: scripts/bootrom/platforms/node_entry.ts:107–112; hosts/libretro/content.cpp:43–49.
- A word wholly inside any cartridge aperture is classified Cartridge, including cartridge RAM and mailbox MMIO; it does not become main RAM or installed I/O for DMA pricing. Sources: machine/ts/machine/memory/memory.ts:725–735; machine/cpp/machine/memory/memory.cpp:642–652. Aperture definitions: machine/ts/spec/bmsx/memory_map.ts:9–21; machine/cpp/spec/bmsx/memory_map.h:15–27.
- Per endpoint contiguous N-word span cost is mainRAM=N+1 at span start, systemROM=N, cartridge=8N+4 at span start, installedIO/other=0. A later span in the same region continuation does not repeat setup; a new mapped region starts setup again. Sources: machine/ts/machine/devices/dma/controller.ts:430–457,473–484; machine/cpp/machine/devices/dma/controller.cpp:354–381,397–407, plus model coefficients above.
- For each paired span, add read+write costs if both endpoints are main RAM or both are Cartridge; otherwise take their maximum. Sum span contributions; zero total is charged1 cycle. Thus two cartridge sockets are additive, not overlapping costs. Sources: machine/ts/machine/devices/dma/controller.ts:434–461; machine/cpp/machine/devices/dma/controller.cpp:358–385.
- Incrementing cartridge spans stop at ROM_END, RAM_END, then MMIO_END; all remain Cartridge but each boundary causes a new span and setup for that endpoint. Fixed endpoints span the entire admitted block. Sources: machine/ts/machine/memory/memory.ts:738–750 and machine/ts/machine/devices/dma/controller.ts:424–457; machine/cpp/machine/memory/memory.cpp:655–667 and machine/cpp/machine/devices/dma/controller.cpp:348–381.
- Derived for a single N-word block staying within both endpoint regions: card↔mainRAM=8N+4 cycles; card↔card=16N+8; card↔installedIO=8N+4. At N=4 these are36/72/36 cycles; at N=16 these are132/264/132. These are admitted service costs, excluding waiting for request admission, competition with another channel and software programming/polling. Calculation sources: machine/ts/machine/devices/dma/controller.ts:386–470,473–484; machine/cpp/machine/devices/dma/controller.cpp:310–407; mirrored model coefficients above. Arithmetic derived, not measured CPU-launch timing.
- Four-word slot0-read→slot1-write, increment both, has CONTROL=00000E63H:3|(8<<2)|(9<<6)|(3<<10). It requires slot0 DREQ_READ and slot1 DREQ_WRITE; current CPU SELECT does not reroute these endpoints. Source fields/selectors: machine/ts/spec/bmsx/io.ts:374–393 and machine/ts/machine/devices/dma/controller.ts:222–232,487–515; machine/cpp/spec/bmsx/io.h:387–406 and machine/cpp/machine/devices/dma/controller.cpp:152–162,412–440. A four-word ROM(slot0)→RAM(slot1) block wholly inside both cartridge windows therefore costs72 cycles from admission.

## Visibility and completion
- Block admission snapshots READ_ADDR,WRITE_ADDR,TRANSFER_COUNT,CONTROL, and min(remaining,programmed block words). Deadline=admission anchor+calculated block cost. Sources: machine/ts/machine/devices/dma/controller.ts:412–470; machine/cpp/machine/devices/dma/controller.cpp:336–394.
- Transfers execute on block service: each word reads then writes, addresses/count update after all words, then count0 finishes the channel. No partial endpoint transfer occurs in admitBlock. Sources: machine/ts/machine/devices/dma/controller.ts:211–253,412–470; machine/cpp/machine/devices/dma/controller.cpp:141–183,336–394.
- CART_SELECT is not in the admitted snapshot. An endpoint without an override resolves current SELECT when its mapped transfers are serviced; changing SELECT after admission can redirect pending unoverridden cartridge accesses. Sources: machine/ts/machine/devices/dma/controller.ts:224–232,463–469 and machine/ts/machine/devices/cartridge/controller.ts:80–85,163–165,178–182; machine/cpp/machine/devices/dma/controller.cpp:154–162,387–393 and machine/cpp/machine/devices/cartridge/controller.h:29–34,52–69.
- Request deassertion invokes arbitration but an active block is retained; service does not recheck request levels inside its transfer loop. Deassertion can block a later admission, not cancel the already admitted block. Sources: machine/ts/machine/devices/dma/controller.ts:171–178,211–253,386–408; machine/cpp/machine/devices/dma/controller.cpp:101–108,141–183,310–331.
- Completion sets STATUS=DONE(2), replacing BUSY(1), and raises central IRQ_DMA0_DONE bit0 for DMA0 or IRQ_DMA1_DONE bit8 for DMA1. Sources: machine/ts/machine/devices/dma/controller.ts:365–370 and machine/ts/spec/bmsx/io.ts:362,370,395–396; machine/cpp/machine/devices/dma/controller.cpp:289–294 and machine/cpp/spec/bmsx/io.h:375,383,408–409.

## Program register constants
- IRQ_FLAGS=08000000H, IRQ_ACK=08000004H, IRQ_MASK=08000008H; DMA0 READ_ADDR=0800000CH,WRITE_ADDR=08000010H,TRANSFER_COUNT=08000014H,CONTROL=08000018H,STATUS=0800001CH,TRIGGER=08000020H. Sources: machine/ts/spec/bmsx/io.ts:3–18,213–224 with machine/ts/spec/bmsx/memory_map.ts:6,23,32; machine/cpp/spec/bmsx/io.h:15–30,226–237 with machine/cpp/spec/bmsx/memory_map.h:12,29,38.
- DMA0 READ_ADDR/WRITE_ADDR/TRANSFER_COUNT/CONTROL are raw R/W words; reset0. STATUS is R/O reset0; TRIGGER read0/reset0 and write bit0 START. Sources: machine/ts/machine/devices/dma/controller.ts:92–98,106–143,340–347 and machine/ts/machine/devices/dma/registers.ts:23–36,58–66 plus machine/ts/machine/memory/memory.ts:865–866; machine/cpp/machine/devices/dma/controller.cpp:16–22,30–73,133–138,264–271, machine/cpp/machine/devices/dma/registers.h:12–17 and machine/cpp/machine/devices/dma/registers.cpp:7–19 plus machine/cpp/machine/memory/memory.cpp:742–743.
- START while already BUSY or with bit0clear does not restart a channel. Accepted START sets STATUS=1; zero transfer count immediately completes; TRIGGER is returned to0 on every write. Sources: machine/ts/machine/devices/dma/controller.ts:131–143; machine/cpp/machine/devices/dma/controller.cpp:62–73.
- IRQ_FLAGS reads pending bits regardless of MASK; MASK raw R/W reset0; an asserted maskable line requires pending&MASK nonzero. ACK is write-one-to-clear selected pending bits and returns read0; ACK0 clears none. Sources: machine/ts/machine/devices/irq/controller.ts:19–27,72–80,102–125; machine/cpp/machine/devices/irq/controller.cpp:14–22,29–34,72–92 and machine/cpp/machine/devices/irq/controller.h:19.

## Mapped admission and bus faults relevant to cartridge programs
- Installed I/O registers are word-aligned slots; mapped U32 unaligned installed-I/O access raises UNALIGNED_IO(2), read result0/store suppressed. Sources: machine/ts/machine/memory/memory.ts:549–555,628–646,840–845 and machine/ts/spec/bmsx/io.ts:401; machine/cpp/machine/memory/memory.cpp:439–445,523–540, machine/cpp/machine/memory/memory.h:134–139 and machine/cpp/spec/bmsx/io.h:414.
- Installed-I/O U8 reads at aligned register address read low8bits; other byte lanes fault2/read0. All mapped U16 reads and all mapped U8/U16 stores to installed I/O fault2. This is NOT the cartridge-MMIO aperture rule. Sources: machine/ts/machine/memory/memory.ts:442–451,466–469,503–506,603–606; machine/cpp/machine/memory/memory.cpp:332–341,356–359,393–396,498–501.
- CART_STATUS is explicitly read-only; mapped word/U32 store raises READ_ONLY(3), leaving it unchanged. IRQ_FLAGS and DMA0/1_STATUS are also read-only. Sources: machine/ts/machine/memory/memory.ts:627–633,852–891 with machine/ts/spec/bmsx/io.ts:402; machine/cpp/machine/memory/memory.cpp:522–528,729–768 with machine/cpp/spec/bmsx/io.h:415.
- Cartridge U32 mapped routing admits addresses10000000H..30FFFFFCH inclusive; U16 through30FFFFFEH; U8 through30FFFFFFH. Memory imposes no cartridge-aperture word-alignment gate; Card owns decode/lanes. Crossing final cartridge bus end falls out of routing and raises UNMAPPED(1), read0/store suppressed. Sources: machine/ts/machine/memory/memory.ts:442–451,466–479,503–520,544–570,603–616,627–656 and machine/ts/spec/bmsx/memory_map.ts:9–21; machine/cpp/machine/memory/memory.cpp:332–341,356–369,393–410,434–460,498–550 and machine/cpp/spec/bmsx/memory_map.h:15–27. UNMAPPED code: machine/ts/spec/bmsx/io.ts:400; machine/cpp/spec/bmsx/io.h:413.
- Absent selected card returns0 on reads/ignores stores without creating a bus fault. Card-backed ROM writes likewise ignore; mailbox U8/U16 stores ignore; mailbox U32 stores use exact relative offset (unaligned offsets ignored by mailbox). Sources: machine/ts/machine/devices/cartridge/controller.ts:153–182, machine/ts/machine/devices/cartridge/card.ts:191–239 and machine/ts/machine/devices/cartridge/mailbox.ts:58–80; machine/cpp/machine/devices/cartridge/controller.h:44–69, machine/cpp/machine/devices/cartridge/card.cpp:158–203 and machine/cpp/machine/devices/cartridge/mailbox.cpp:41–63.
- DMA mapped faults use the same Memory fault path; the transfer loop still performs its programmed read/write/count decrement and has no fault-abort branch. A completed DMA status alone is not proof of valid endpoint addresses. Sources: machine/ts/machine/devices/dma/controller.ts:229–252 and machine/ts/machine/memory/memory.ts:540–570,623–656; machine/cpp/machine/devices/dma/controller.cpp:159–181 and machine/cpp/machine/memory/memory.cpp:430–460,518–550.
- First outstanding bus fault retains code/address/access; later faults do not replace it. A nonzero bus-fault ACK clears it; zero leaves it. Sources: machine/ts/machine/memory/memory.ts:419–423,811–833; machine/cpp/machine/memory/memory.cpp:309–313,700–722.

## CPU admission bridge (ordinary operations are not raw DMA bus access)

- Access kind Word/U32 alignment mask3 (4bytes), U16 mask1 (2bytes), U8 mask0. Source TS `machine/ts/spec/blua32/memory_access_kind.ts:1–10`; CPP `machine/cpp/spec/blua32/memory_access_kind.h:8–24`.
- Ordinary LOAD_MEM/STORE_MEM check alignment before mapped read/write (and store readiness); misalignment enters corresponding synchronous address-error load/store. New mapped fault during ordinary LOAD enters synchronous data-bus error before assignment; STORE checks new fault after buswrite and enters data-bus error. Source TS `machine/ts/machine/cpu/cpu.ts:3080–3153`; CPP `machine/cpp/machine/cpu/cpu_dispatch.inl:621–669`. Thus mapped-bus read0 is not successful CPUload0, and cartridge mapped routing's lack of alignment test is not ordinary CPUpermission for unaligned scalar access. Matches existing canonical public Memory reference; no CPU runtime change.

## Final evidence index

- Public chapter: `docs/book3/cartridge.md`, source SHA25695d027012ba873ab15c3f5b00c849a8267106d33fa9f3713c1b48c3088837e27. Separate source/figure/program, public-only reader and final print decisions are retained under `reviews/`.
- Both full modules and both manifests reconstructed from public listings compare byte-for-byte to authored files. Quality-enabled ordinary validation and actual existing-route guest execution pass; separate ordinary two-media player launch reaches finiteTTL without being claimed as payload proof.
- Focused10TSowner tests,3native CTest suites and19publishing tests pass. Canonical check/publish pass; all12published pages exact full decodedRGBA+dimensions equal the individually inspected finalproof. No runtime/compiler/BIOS/renderer/publisher/CSS/helper change or new common harness was made.
- Existing software-authority and physical-spec exclusions above remain. Shared whole-console, SDK, portablePDF navigation and other publication stops in older chapters are not closed by this bounded chapter.
