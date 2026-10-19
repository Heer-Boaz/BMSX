# Source-blind overview reader check

## Scope and identity

- Reader stance: experienced programmer, new to BMSX; no implementation, test, architecture, private fact/review, memory, PDF or history knowledge used.
- Public chapter: `docs/book1/console.md`.
- SHA-256 at start and finish: `9d06e3726591f95b0c3feb3693845398e8edc6feab4f95f45171388e0509b772`.
- Read the overview and relevant public passages in `cpu.md`, `memory.md`, `irq.md`, `dma.md`, `system.md`, `input.md` and `imgdec.md` to follow its chapter references.
- Bounded processor/control and memory/DMA orientation check only. This is not whole-manual acceptance. Missing future graphics/audio sections are not findings. No repo edits, builds or tests.

## Outcome

The requested distinctions are generally recoverable without implementation knowledge. I found two concrete wording/visibility problems, neither of which prevents understanding the main memory map.

### 1. DMA “one active channel” conflates channel activity with the shared admitted block

`console.md:89` says there is “one active channel at a time.” An unfamiliar reader can reasonably take this as a restriction against starting the second channel while the first is BUSY.

The referenced DMA chapter instead defines one shared admitted block (`dma.md:18`, `320-328`), expressly refers to “another BUSY channel” (`dma.md:266`), and has channel 1 start before channel 0's first deadline in the round-robin example (`dma.md:450`). Both channels can thus have outstanding transfers, while only one block owns the transfer path. The overview's later round-robin sentence does not explicitly resolve which meaning of “active” was intended.

This matters when deciding whether two transfers may be programmed concurrently, rather than being a stylistic terminology preference.

### 2. Input capture appears to promise a recorded cycle with no public observation route

`console.md:37` says capture “records the cycle.” As a new reader I looked for the captured timestamp or its access protocol.

The referenced INPUT sampling procedure exposes sequence change as completion (`input.md:134-145`), and its complete register map (`input.md:147-201`) contains no captured-cycle word. The chapter otherwise carefully separates retained snapshot state from request and completion state. The overview does not say whether this recorded cycle is internal-only or a cartridge-visible observation.

No implementation truth is asserted here: the public prose leaves that visibility unresolved. If the cycle is intentionally internal, it should not appear to be another readable capture result; if public, the required observation route is missing from the referenced protocol.

## Requested distinctions checked

- **Installed RAM versus windows:** clear. 4 MiB backing, the 128 MiB routing window, no extra/mirrored RAM, and separate VRAM are explicit (`console.md:45-66`).
- **Actual versus reserved I/O/GEO:** clear for allocation decisions. The implemented I/O aperture is distinguished from its full reservation; GEO is explicitly a reservation, not a promise that all bytes are populated, and neither remainder becomes application storage (`console.md:56-68`). This does not provide an actual GEO working-buffer inventory, but no such inventory is needed to follow this section's prohibition.
- **Image-dependent storage:** clear. Firmware/card capacities are independent of windows; system/cartridge DATA/BSS ordering, variable cartridge base, and load/run-address distinction are explicit (`console.md:47-81`). The Memory chapter supplies startup and placement steps.
- **CPU versus device/register words:** clear with the referenced CPU chapter. The overview limits its CPU width claim to instruction words, separately defines four-byte mapped words and byte addresses, and the CPU introduction explicitly distinguishes language values from device payloads (`console.md:15,45,85`; `cpu.md:3-8,191-205`).
- **DMA accounting versus end-to-end bandwidth:** clear. Setup, block minimum, endpoint combination and formula scope are stated; the prose explicitly disclaims sustained throughput and CPU/device timing guarantees (`console.md:91-113`). IMGDEC's separate charge has matching limits (`console.md:41`).
- **IRQ consumer versus producer:** clear with the referenced IRQ chapter. Controller pending/mask/ACK and CPU-enable gates are distinct; synchronous faults are separate (`console.md:27-29`). Producer re-arming versus controller ACK is explicitly explained in `irq.md:192-232`; no need to duplicate the full source-specific protocol in this overview.
- **Input/request/reset visibility:** clear apart from finding 2. One-shot capture, separate supervisor request, coalescing reset request and delayed reboot are distinguished (`console.md:31-37`). INPUT supplies sequence-before-ARM/read-after-change, retained CTRL versus pending request, and pad-output request versus capability/completion/reset distinctions (`input.md:132-145,203-269`). SYSTEM supplies the absence of reset-pending/completion readback (`system.md:207-213`).

No other necessary-step omission or unsupported contradiction found within this bounded reading.


---

# Final merged chapter: public-only reader turn

## Literal revision and scope

- Re-read the complete current public `docs/book1/console.md`, including the added graphics, GTE/GEO, PCRTC and APU sections.
- Final SHA-256: `70e80c237a661aeb0c6e8d18d28064cf9886881e43437a027b2447fa6039b984`.
- The requested preceding literal revision was `a92024e58baec502c3a2b4d0019055a3db27a57152ba971adaeabaeceeb15eea`; the final reread above includes the later “optional stereo biquad stage” wording.
- Followed explicit public links as needed into `gpu.md`, `gte.md`, `geo.md`, `pcrtc.md`, `apu.md`, and the firmware-VRAM subsection of `memory.md`. Also read the two directly embedded public SVG route diagrams' labels and descriptions.
- Remained source-blind: no owners, implementation files, tests, architecture, private facts/reviews, memories, PDFs, git/history, or execution evidence. No repository edits, builds or tests.

## Original findings: both closed

1. **DMA concurrency:** current `console.md:89` now says that both channels may have outstanding transfers while one admitted block uses the transfer path. This resolves the earlier ambiguity between a BUSY channel and the shared transfer engine.
2. **Input captured-cycle visibility:** current `console.md:37` no longer claims that capture records a cycle. The stated public result is the captured latches and sequence/status, consistent with the referenced INPUT procedure.

## Added-section orientation result

**No new concrete necessary-fact omission, confusing ownership claim, or unsupported public-prose contradiction found in this bounded reading.**

A programmer new to BMSX can recover the requested distinctions:

- **Installed resources versus address/storage reservations:** the earlier map still distinguishes actual main-RAM backing, larger routing windows, I/O aperture versus reserved space, reserved GEO workspace, and image-dependent statics. Shared 2 MiB GPU local memory and private 512 KiB APU RAM are separately named capacities, not extra main-RAM windows.
- **GPU drawing versus PCRTC display:** `console.md:117-155` identifies command-fed drawing into shared storage separately from two-circuit source reading and output composition. The two circuits do not create two framebuffer RAM banks. The selected video diagram preserves that direction and makes no extra bank or completion claim.
- **GTE registers versus GEO jobs:** `console.md:137-145` distinguishes register-fed arithmetic/results from one captured, memory-addressed batch job and explicitly requires software to arrange drawing separately. The linked GTE and GEO introductions confirm that neither automatically emits GP0 drawing packets. Their detailed command-admission and result protocols remain properly in the unit chapters.
- **VRAM dimensions versus resolution:** `console.md:121,129,149-155` separates sixteen-bit storage words and 1024-word/1024-row address periods from displayed pixels, selectable scanout interpretations, signal-space windows and programmable timing. It expressly denies a universal 1024 × 1024 screen mode or fixed 50/60 Hz specification.
- **Firmware VRAM reservation:** `console.md:131` identifies the complete queried terminal-plus-system-texture bounding rectangle, says handoff does not release it, and warns that the query is not an allocator. Its precise public Memory link supplies the callable, packed return words, word-X/row-Y units, and the statement that this reservation is not hardware write protection.
- **APU source storage versus ordinary main RAM:** `console.md:176` distinguishes ROM/private-RAM source binding from a payload copy, states the selected-slot binding edge, and explicitly rules out both main RAM as a direct voice source and `0x40000000` as a CPU load/store aperture.
- **APU FIFO delivery versus RAM-batch completion versus playback:** `console.md:178-182` names all three boundaries and the all-at-once scheduled batch edge. The linked APU upload procedure provides the necessary concrete next step: after DMA DONE, wait for final private-RAM service before using the bytes or changing mode (`apu.md:622-638,703-723`). The overview need not duplicate that complete device tutorial.
- **Rate meanings:** GPU capabilities are not primitive throughput; GEO's outer-record budget is not a vertex/pair rate; PCRTC's timing reference is not a universal display mode; and APU output cadence, sample-memory service budget and source rate are kept distinct.

The original processor/control, memory, IRQ and DMA orientation conclusions remain valid after the reread. This result is **reader orientation only**, not source-level hardware truth verification, runtime/visual proof, or whole-manual acceptance.


## Cross-unit public-reader routes — 2026-10-19

Three independent readers used public manuscripts only; none inspected owners,
fact sheets, test internals or PDFs. No missing contract was found for these
finite routes:

- Interactive textured 2D: startup/RAM and queried VRAM ownership, image upload,
  drawing, alternating GPU/PCRTC publication and one-shot input sampling.
- 3D flat/clipped triangles: camera/matrix packing, projection, flags/area/depth,
  software near-plane clipping, GP0 packet construction and safe display reuse.
- PCM playback: ROM/RAM transport into private sample RAM, separate DMA/RAM
  commit, descriptor/loop staging, execution observation, end/stop and reuse.

The readers identified no need for another complete example or library API.
These routes connect the existing Memory, GPU/PCRTC, GTE, INPUT, DMA/APU, IRQ and
Cartridge contracts; this is not every operation, source-truth approval, new
execution evidence or whole-console completion. Known engineering and delivery
questions remain separate.
