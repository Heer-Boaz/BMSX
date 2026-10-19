# System overview

BMSX separates program execution, mapped word transfers, graphics drawing,
display reading, geometry processing and sound playback. This chapter identifies
the installed resources, their address boundaries and the routes between them.
The unit chapters give the register definitions, commands and complete
programming sequences; a capacity or service charge in this overview is not a
replacement for those protocols.

The CPU prepares operands and programs the units through mapped word ports.
GTE calculations and GEO memory jobs produce arithmetic and geometry results,
not drawing commands; the cartridge uses those results when constructing the GPU's GP0
stream. The GPU draws into local memory, and PCRTC reads that same storage for
display. DMA can supply or collect words through device ports without turning
transport completion into drawing or display completion. Sound follows a
separate path: APU voices read their bound sources and feed the stereo mixer;
sample-RAM uploads use the APU transfer path instead of the drawing engine.
The cartridge connects these operations and observes each unit's completion
condition. They do not form one automatically chained picture-and-sound job.

Book I describes the installed machine. Book II supplies the BLua32 and BIOS
software reference; cartridge and expansion-device protocols belong to Book III.

## Processor and system control

The BLua32 CPU uses 32-bit (4-byte) instruction words. This defines the instruction-word width; it does not mean that every decoded instruction occupies one word or executes in one cycle. System timing uses a cycle-accounting rate of **33,868,800 Hz**. This is the system timebase, not a guarantee of one instruction per cycle.

| Unit | Resources | Role |
|---|---|---|
| BLua32 CPU | 32-bit instruction words | Executes the instruction stream; accepts enabled maskable interrupts and handles synchronous exceptions separately. |
| IRQ | FLAGS, ACK and MASK words | Holds pending source bits and supplies the shared maskable interrupt line. |
| SYSTEM | Time, frame-timing, reset and supervisor-control words; captured fault words | Reports timing and coordinates reset requests, supervisor entry and fault capture. |
| INPUT | 8 keyboard words covering 256 USB HID usage bits; pointer buttons, X, Y and wheel; 4 pad records, each with a buttons word and 6 axes | Publishes raw captured input states, not application action mappings. |
| IMGDEC | 32-word input FIFO, 64-word output FIFO and 4096-word history; 16-word DMA request quantum | Decodes a compressed word-token stream into a GPU upload command stream. |

### Interrupts, faults and reset

DMA and device interrupt sources feed the shared IRQ controller; the CPU accepts its enabled interrupt line. Raising a source sets its pending bit regardless of MASK; repeated raises while the bit is pending coalesce. FLAGS reads do not clear pending bits. ACK clears the pending bits written as ones, while MASK replaces the enabled-source mask without clearing pending state. The maskable line is asserted when pending and enabled bits overlap; CPU acceptance also requires its current interrupt enable. Pending bits and the mask reset to zero.

Accepted maskable interrupts enter the image's IRQ function with an IRQ cause. Synchronous exceptions instead use the system-exception function: IRQ is not a collector for every fault. SYSTEM captures the CPU cause, EPC, bad-address, Lua-reason and domain words. Its supervisor controls are unavailable in user mode; supervisor entry waits for GPU quiescence before requesting NMI. See the [IRQ](irq.md) and [SYSTEM](system.md) chapters for the complete delivery and supervisor protocols.

A SYSTEM reset command latches a request and asks the CPU to yield. Reset is not completed by the register write itself: the request is consumed and a system reboot follows. Repeated requests can coalesce; there is no fixed request-to-reboot cycle count.

### Timing and input capture

SYSTEM TIME_MS derives milliseconds from system cycles, not wall time. Its frame-timing words report the programmed PCRTC frame duration and a whole VBlank-period cycle budget, not a countdown to the next edge. They do not define a fixed refresh rate.

INPUT ARM requests one capture at the next accepted VBlank edge. Capture samples the raw states, increments the sequence, consumes the pending capture request and publishes the input latches and status. The separate supervisor-request wire is checked for a rising edge at each VBlank-begin edge whether or not capture is armed; it is not a designated application key. See the [INPUT](input.md) chapter for the capture protocol.

### Image decoding

IMGDEC consumes its compressed **word-token stream** and emits GP0 CPU-to-VRAM upload headers followed by decoded texture and optional CLUT payload. An admitted DATA read removes one queued output word; CPU reads while DMA owns that read port, and reads of an empty FIFO, return the retained DATA word without removing output. A programmed DMA transfer can route fixed IMGDEC DATA reads to fixed GPU GP0 writes; IMGDEC does not write VRAM directly. FIFO capacities, history capacity and the 16-word DMA request quantum above count raw 32-bit words, not compressed-file bytes. IMGDEC charges **2 system cycles per emitted word**, including each three-word upload header. Payload batches contain at most 16 words and are constrained by output space, the remaining run or stage, and available literal input; a header requires three free output words. Decoder and GPU request readiness also constrain transfer progress. The charge is decoder work, not a compressed-input rate, end-to-end upload bandwidth or display-completion guarantee. See the [IMGDEC](imgdec.md) chapter for stream and pacing details.

## Storage and the address map

BMSX uses a 32-bit, byte-addressed space. A mapped register or DMA transfer word is 32 bits, or four bytes. Address windows describe where storage or devices can be reached; they do not, by themselves, specify how much storage is installed.

The installed console configuration provides **4 MiB of main RAM**. Its address window is much larger: 128 MiB. Similarly, the system-ROM and cartridge windows are routing limits, not promises of equally large firmware or cartridge images. System-ROM storage is the supplied firmware image. Cartridge ROM and optional cartridge RAM capacities are properties of the inserted card.

The table uses half-open intervals: the start is included and the end is excluded. Indented entries describe reservations within the main-RAM window, not additional storage.

| Window or reservation | Byte-address interval | Size and interpretation |
|---|---|---|
| System ROM | `[0x00000000, 0x01000000)` | 16 MiB window; firmware image size is independent of the window size. |
| Unmapped | `[0x01000000, 0x08000000)` | No mapped storage or device. |
| Main RAM | `[0x08000000, 0x10000000)` | 128 MiB window; installed backing is only `[0x08000000, 0x08400000)`, before I/O interception. |
| ↳ I/O reservation | `[0x08000000, 0x08040000)` | 256 KiB reserved. The implemented register aperture is `[0x08000000, 0x08010440)`. |
| ↳ GEO scratch reservation | `[0x08040000, 0x080c0000)` | 512 KiB reserved. |
| ↳ System and cartridge statics | Starting at `0x080c0000` | Image-dependent DATA and BSS within installed RAM. |
| Cartridge ROM | `[0x10000000, 0x30000000)` | 512 MiB window for the selected card; actual ROM capacity is card-dependent. |
| Cartridge RAM | `[0x30000000, 0x30f00000)` | 15 MiB window; actual optional RAM capacity is card-dependent. |
| Cartridge MMIO | `[0x30f00000, 0x31000000)` | 1 MiB window for the selected card's mapped devices. |
| Unmapped | At or above `0x31000000` | No mapped storage or device through the end of the 32-bit address space. |

There are two physical card slots. Ordinary CPU cartridge access selects one card using bit 0 of the selection word; the three cartridge windows then route to that selected card. The windows do not combine the capacities of both cards.

Main-window addresses beyond the installed RAM backing neither provide additional RAM nor mirror lower RAM. The console also has 2 MiB of VRAM separately from main RAM; that capacity is not an additional CPU-linear window in the map above.

**Keep the complete I/O and GEO scratch reservations out of application storage.** The implemented I/O aperture contains 16,656 word slots, occupying 66,624 bytes. Its smaller extent does not reduce the 256 KiB I/O reservation. Likewise, the named GEO reservation is not a guarantee that every reserved byte is an actively populated scratch buffer. Neither distinction makes reserved space available for general use.

The two reservations occupy 768 KiB before static storage begins. In the installed 4 MiB configuration, 3.25 MiB remains after that span, **before** subtracting system and cartridge statics. This is not a free-memory or usable-heap figure.

Static storage has an image-dependent layout, in this order:

- System DATA begins at `0x080c0000`.
- System BSS follows system DATA.
- Cartridge DATA begins at the end of system BSS.
- Cartridge BSS follows cartridge DATA.

Consequently, there is no fixed cartridge-static base or fixed remaining application-memory quantity. Static storage must fit within the actual installed RAM extent. Linked images carry read-only data and DATA initialization payloads; a DATA payload's load address and its RAM run address are distinct, while BSS has its own RAM address. These image descriptions do not create extra memory windows.

The [Memory chapter](memory.md) provides the detailed access rules and image-layout procedures. Capacity planning should use the actual firmware and cartridge image footprints, not the sizes of their address windows.

## Mapped access and DMA transfers

Byte addresses and hardware words must be kept distinct when programming mapped memory. A register word occupies four bytes, whereas addresses identify bytes. CPU load/store instructions apply the alignment of their access kind before mapped access; word operations use the mapped-word route.

Mapped word reads in the implemented I/O aperture reach a device register or its retained register slot rather than ordinary RAM. Other mapped reads route to the supplied system ROM, installed main RAM or selected cartridge. Within the system-ROM window, scalar reads beyond the supplied firmware image return zero bytes; writes do not change the firmware. That system-ROM behavior must not be mistaken for additional storage backing elsewhere.

BMSX provides **two DMA channels**, sharing one admitted transfer block at a time. Both channels may have outstanding transfers; block admission selects which channel uses the transfer path. DMA reads and writes mapped memory in four-byte words. A programmed block contains 1–16 words, limited by the remaining transfer count. When source or destination incrementing is enabled, the corresponding byte address advances by four for each word. Ready channels are selected round-robin at block boundaries.

DMA time depends on the regions touched by both endpoints. For one uninterrupted classified span of `n` words, starting at its beginning, the installed configuration assigns these region charges:

| Region | Charge at region start |
|---|---|
| Main RAM | `n + 1` cycles |
| System ROM | `n` cycles |
| Cartridge bus | `8n + 4` cycles |
| I/O or other classification | Zero region charge |

The cartridge charge applies to cartridge ROM, RAM and MMIO—not just ROM. The extra RAM cycle and four extra cartridge cycles are setup charges. Setup applies when an endpoint starts a new classified span, not again for each subdivision introduced solely by the other endpoint. Cartridge ROM, RAM and MMIO boundaries start new spans even though all three use the cartridge charge. Every admitted block starts its own span accounting.

Source and destination charges are not always simply added. If both endpoints are RAM, or both are on the cartridge bus, their charges are summed. Otherwise, the greater charge applies. The total charge for an admitted block is at least one cycle. For a block wholly within one uninterrupted classified span at each endpoint, with no RAM/I/O/backing or cartridge ROM/RAM/MMIO boundary crossing, this gives:

| Transfer | Charge for `n` words |
|---|---|
| RAM to RAM | `2n + 2` cycles |
| Cartridge to RAM | `8n + 4` cycles |
| RAM to I/O | `n + 1` cycles |
| System ROM to I/O | `n` cycles |

DMA schedules service at the block's anchor cycle plus its admitted charge. Service performs the mapped word transfers and advances the addresses and remaining count.

These are **DMA block charge calculations**, not sustained physical-throughput ratings. They do not establish CPU load/store latency, instruction-fetch cost, an independent bus clock or a sustained bytes-per-second figure. In particular, zero I/O region charge does not make every transfer involving I/O free: the other endpoint still contributes, and the block minimum still applies. Use the [DMA chapter](dma.md#transfer-rates-by-route) for complete programming and transfer rules, including transfers that cross region boundaries.

## Graphics storage and drawing

The GPU draws from commands into 2 MiB of GPU local memory. Raster destinations, texture and palette data, and PCRTC display reads share this storage; texture memory and display memory are not additional banks.

| Resource or function | Capability |
| --- | --- |
| Installed GPU local memory | 2 MiB: 1,048,576 sixteen-bit words |
| Primitive drawing | Triangles, quads split into triangles, lines, polylines and rectangles |
| Other drawing and movement | Fills and VRAM image transfers |
| Polygon color | Flat or Gouraud color, with optional texturing |
| Texture sources | 4-bit indexed, 8-bit indexed and direct16 |

Rectangles may also be textured. Indexed textures use palette data in the same local memory. Texture bit depth describes the texture source, not the framebuffer format or installed memory capacity.

The drawing address domain has raw-coordinate periods of 1024 words horizontally and 1024 rows vertically. These are storage-address periods, not a 1024 × 1024 screen mode. Drawing coordinates address sixteen-bit storage words; indexed texture coordinates select packed texels within those words. PCRTC has its own selectable storage interpretations. Sharing the bytes does not make these coordinate mappings interchangeable.

Firmware uses the shared GPU memory for its terminal surface and system texture. Reserve the complete bounding rectangle returned by the named BIOS function `gpu/system_vram_region`; cartridge entry does not release that reservation. The query is not an allocation operation and does not establish that every other VRAM location is free. See [Memory, “Firmware reservation in VRAM”](memory.md#firmware-reservation-in-vram), for the call and coordinate units.

These drawing capabilities describe supported commands, not a guaranteed primitive throughput. See the [GPU chapter](gpu.md) for command formats and drawing details.

## GTE and GEO: two different arithmetic routes

GTE provides register-fed transform and lighting arithmetic. Its registerfile contains 32 data words, 32 control words and 10 PLUS words, all stored as raw 32-bit words. In the CPU-fed programming route, software writes operands and controls, issues a command, and reads the resulting registers. The ordinary command invokes arithmetic directly. Operations include matrix/vector arithmetic, rotation and translation with perspective projection, and lighting/color calculations.

“CPU-fed” describes that programming route, not exclusive CPU ownership of every ordinary GTE register access. GTE does not fetch a vertex array and automatically turn its results into GPU packets. Its arithmetic results remain in its registers.

GEO is a separate, memory-addressed batch engine. It captures source and destination addresses, record count, parameters and strides for one active job. Its commands are `XFORM2_BATCH`, `SAT2_BATCH` and `OVERLAP2D_PASS`. For example, XFORM2 reads records, vertices and matrices from addressed memory and writes transformed vertices to RAM. A command submitted while GEO is busy does not enter a job queue.

GEO accrues a work budget of **16,384,000 outer-record service units per second**, consuming one unit per serviced outer record. This is not an independent core clock or a vertices-, triangles- or collision-pairs-per-second rating.

Neither unit is an automatic rendering stage: GTE exposes register arithmetic, while GEO services a programmed memory job. Software must arrange the drawing work separately. Consult the [GTE](gte.md) and [GEO](geo.md) chapters for their respective programming interfaces.

## Programmable PCRTC output

PCRTC reads GPU local memory through two programmable scanout circuits. Each circuit selects its framebuffer base, width, storage interpretation and source origin, together with a display window and magnification in signal space. The output can compose these circuits with background and blending controls. Two circuits do not add two framebuffer RAM banks.

Supported scanout interpretations are CT32, CT24, CT16, CT16S and GX16; GPU24 is available on circuit 1 only. These interpretations select how existing local-memory bytes are sampled. They do not establish that the primitive rasterizer writes every one of these layouts natively.

Beam timing is programmed through the SMODE, SYNCH and SYNCV words. PCRTC timing calculations use a **13,500,000 Hz reference** to derive half-line and field periods and refresh from those words. Output extent follows the enabled display windows and signal step. Consequently, the hardware overview has no single universal screen resolution or fixed 50/60 Hz refresh specification.

Scanout uses retained presentation configuration and timing. It does not simply reinterpret every subsequent live register-word change as a new presentation configuration. Keep the distinction between drawing storage, source sampling and signal-space output when configuring a display. The [PCRTC chapter](pcrtc.md) describes the programming details.

The following selected route separates drawing supply, shared storage and display reading. It is not a bus waveform or a transfer-completion guarantee.

![GPU command supply, shared local memory and two-circuit PCRTC reading](figures/console-video.svg)

## APU sound and sample-memory route

The APU provides 16 playback slots rather than a fixed set of PCM-only channels. Playback supports PCM8, PCM16, 4-bit BADP and the defined square generator, including stereo-source mixing. Slot controls include source rate, loop and gain parameters, with an optional stereo biquad stage.

| APU resource | Capacity or rate |
| --- | --- |
| Playback slots | 16, each with 21 raw parameter words |
| Command FIFO | 16 captured command entries |
| Sample-transfer FIFO | 16 thirty-two-bit words: 64 bytes |
| Private sample RAM | 512 KiB |
| Output cadence | 44,100 stereo frames per second |
| Sample-memory DMA service budget | 1,058,400 thirty-two-bit words per second |

Each output frame contains signed sixteen-bit left and right samples after mix saturation. Source sample rates and rate steps are separate programming parameters; changing them does not change this output cadence. Output cadence is not an APU core-frequency or electrical-output rating.

Non-generator playback binds its source to private sample RAM or to system ROM or selected cartridge ROM. PLAY resolves the selected cartridge slot when it executes and retains a view of the selected storage; it does not copy the payload into a voice. Ordinary main RAM is not a direct playback source. The private sample-RAM descriptor base is `0x40000000`, but this is not a normal CPU load/store aperture.

To upload data from main RAM, program system DMA to deliver it through APU DATA and the sample-transfer FIFO into private sample RAM. Downloads reverse the FIFO-to-sample-memory route. DMA delivery into the FIFO and completion of the private-RAM batch are distinct boundaries; delivery alone is not playback. A scheduled batch takes effect at its completion edge, not as individually committed words at each word-period.

The sample-memory service budget describes FIFO-to-sample-RAM pacing, not complete source-bus cost or sustained electrical bandwidth. In manual-write mode, a CPU DATA write instead stores one 32-bit word immediately and advances by four bytes. See the [APU chapter](apu.md) for command, transfer and playback programming.

The sound route below distinguishes a bound playback source from a private-RAM upload. A transfer-completion indication must not be substituted for sample-memory batch completion or playback.

![ROM and private sample-RAM playback sources, with separate CPU or DMA upload path](figures/console-audio.svg)
