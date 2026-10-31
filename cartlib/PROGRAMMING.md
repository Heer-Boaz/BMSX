# cartlib — Integration notebook

**GAME PROGRAMMING GROUP · INTERNAL SOFTWARE NOTES**

**Audience:** cartridge-programming and content-build teams

**Status:** retained integration material, not a released library reference

This is documentation for the independently linked `cartlib` product. None of
its modules, operand types, dispatchers, allocators or resource-directory APIs
is installed BIOS or console firmware. A cartridge team may use other code and
other asset-packaging conventions without implementing this library.

Our integration rules below describe the library and its associated build
pipeline, not BMSX hardware acceptance requirements. This notebook has no BMSX
book number, is outside the console-reference catalog, and does not use the
console manual's publication template. Hardware addresses, device formats and
installed BIOS services remain defined by the separate machine reference.

The preserved listings retain their original dependencies and observations.
They have not been rewritten as independent hardware examples. Their existing
executions do not validate a future replacement listing or close the open
library issues at the end of this notebook.

## Integration ownership

- Link the needed modules into the cartridge; do not expect firmware to supply
  them. `require('cartlib/…')` names cartridge source, not a BIOS import.
- Coordinate DMA and IRQ ownership through one selected software route. The
  library dispatcher is our policy, not hardware priority or a firmware hook.
- Resource IDs, decoded metadata, atlas allocation and prebuilt collision
  variants are our content pipeline. A device sees the final source bytes,
  register words and addresses, not those higher-level records.
- Keep changes to these conventions local to the library and its producers.
  Do not turn a library defect into a machine limitation.

<a id="package-convention"></a>

## Resource-package convention

Our current packaging tools emit the full header below. Only its consumed boot
prefix belongs to the machine/BIOS contract; directory, metadata and diagnostic
extensions are tooling conventions. They are not prerequisites for a cartridge
that uses a different content pipeline.

#### ROM header fields

The current ROM package header is **72 bytes**, containing 18 unsigned 32-bit little-endian words. The table gives hexadecimal byte offsets from the beginning of the ROM, not word indices. Field values described as ROM-relative offsets are likewise measured in bytes from the beginning of the ROM.

| Byte offset | Field | Meaning |
| --- | --- | --- |
| `0x00` | Magic | `0x58534d42`; bytes `42 4d 53 58` spell `BMSX`. |
| `0x04` | Header size | Current header size: 72 bytes. |
| `0x08` | Manifest offset | ROM-relative manifest offset. |
| `0x0c` | Manifest length | Manifest byte count; zero when absent. |
| `0x10` | TOC offset | ROM-relative table-of-contents offset. |
| `0x14` | TOC length | Table-of-contents byte count. |
| `0x18` | DATA offset | ROM-relative physical-payload offset. |
| `0x1c` | DATA length | Physical-payload byte count. |
| `0x20` | BLua32 image offset | ROM-relative executable-image offset; zero means no image. |
| `0x24` | BLua32 image length | Linked executable-image byte count. |
| `0x28` | Startup function | Absolute function-record address. |
| `0x2c` | IRQ function | Absolute function-record address. |
| `0x30` | Exception function | Absolute function-record address. |
| `0x34` | Static-layout token, low | Opaque low token word; neither address nor byte count. |
| `0x38` | Static-layout token, high | Opaque high token word; neither address nor byte count. |
| `0x3c` | Diagnostic directory offset | ROM-relative offset; initialized to zero without emitted diagnostics. |
| `0x40` | Metadata offset | ROM-relative metadata offset. |
| `0x44` | Metadata length | Metadata byte count; zero when absent. |

The **60-byte boot prefix** occupies `0x00` through `0x3b`. It is distinct from the full current header: boot resolution requires this prefix to be backed by installed ROM bytes, not the entire 72-byte header. BIOS selection is described below.

Function-record addresses are absolute machine addresses, not image offsets or instruction PCs. The exception-address field alone does not specify cartridge fault routing. Package DATA is the physical payload, not writable program DATA; its length is not the program DATA section size.

The ROM builder and linker emit the header and token words. An embedded BLua32 image has a separate 96-byte header; that header is not part of these 72 bytes. See the separate [machine EXEC handoff](../docs/book1/program-images.md#sec-memory-exec-and-cartridge-entry) for the startup sequence.

<a id="resource-integration"></a>

## Resource lookup, atlas uploads and collision data

### ROM resources

The ROM address window exposes package bytes. A resource directory describes
where particular data and metadata reside within those bytes; it does not
create another device, allocate a destination or configure a hardware unit.
Keep the package base distinct from the embedded executable-image base and
from the destination of a transfer.

#### Package offsets and source spans

The [ROM package header](#rom-header-fields) gives the
table-of-contents offset at byte `10H` and its byte count at `14H`.
For cartridge ROM, let `B = 10000000H` and `T = B + toc_offset`.
Directory words are unsigned, 32-bit and little-endian. All offsets below
are **byte offsets**, not word indices.

| Base | Byte offset | Field and unit |
|---|---|---|
| `T` | `00H` | Magic: `434F5442H` |
| `T` | `04H` | Header size: 48 bytes |
| `T` | `08H` | Entry size: 84 bytes |
| `T` | `0CH` | Entry count |
| `T` | `10H` | Entry-table offset from `T`; emitted as 48 |
| `T` | `14H` | String-table offset from `T`; emitted as `48 + entry_count × 84` |
| `T` | `18H` | String-table byte count |

Entry `i`, counting from zero, begins at `E = T + 48 + i × 84`.
The following fields locate its identity and source spans.

| Base | Byte offset | Field and unit |
|---|---|---|
| `E` | `00H`, `04H` | Resource token, low and high words |
| `E` | `08H` | Resource kind |
| `E` | `10H`, `14H` | Resource-ID offset from the **string table**, and UTF-8 byte count |
| `E` | `28H`, `2CH` | Main-data start and exclusive end, both from `B` |
| `E` | `34H`, `38H` | Metadata start and exclusive end, both from `B` |
| `E` | `44H`, `48H` | Collision-data start and exclusive end, both from `B` |

For a present span, its source address is `B + start` and its byte count is
`end − start`. Do not add the package DATA offset, TOC offset,
metadata-section offset or executable-image offset again. An absent span has
both endpoint words set to `FFFFFFFFH`; a present empty span instead has equal
start and end offsets. Finding an entry does not establish that it has a
nonempty main-data span.

Primary and collision-data starts are four-byte aligned. Metadata records are
packed without a separate alignment requirement for each record; do not assume
that a metadata address is suitable for an ordinary word load.

#### Data format determines the next operation

The resource kind does not make every payload a directly usable hardware
source. The ordinary packed resource routes are:

| Kind | Stored representation | Next hardware-related operation |
|---|---|---|
| Image, 1 | Image metadata and optional collision data; no primary pixel blob | The image entry is not a raw-pixel source or a GP0 upload packet. |
| Texture, 11 | An IMGDEC stream and texture metadata | Decode the stream through [IMGDEC](../docs/book1/imgdec.md); its output supplies the GPU upload words. |
| Audio, 2 | A BADP container and audio metadata | Program the [APU source descriptor](#library-playback-routes) from the container header and byte extent. |

Metadata is serialized descriptive data, not a device command packet.
Resolving a ROM source, decoding or transporting its bytes, committing them to
device storage, and using that storage are separate operations. The adjacent
unit's completion and source-lifetime rules still apply.

#### Software resource records

The `cartlib/rom_dir` library returns a table describing a located entry.
Its source fields have these meanings:

| Field | Meaning |
|---|---|
| `resid` | The ID used when this cached record was constructed |
| `type` | The recognized resource-kind name; `image`, `texture` or `audio` for the routes above |
| `addr` | Source ROM base plus `data_start` for a present main-data span; zero when absent |
| `len` | Main-data byte count; zero when absent |
| `meta` | Optional decoded metadata |
| `imgmeta`, `texturemeta`, `audiometa` | Aliases for `meta` on image, texture and audio records, respectively |
| `collision_addr` | Image collision-data source address, or zero when absent; no corresponding length field is returned |

Metadata is decoded when the record is first constructed. Ordinary lookup does
not decode the main payload. The table is neither a GPU destination nor an APU
source binding, and obtaining it performs no upload.

Repeated lookup returns the same cached record and metadata tables, not private
copies. The directory indexes system ROM at `00000000H` and the currently
mapped cartridge at `10000000H` when initialized. Each record uses its source
ROM's base; not every record is a cartridge-ROM address.
After changing that mapping, `reload_cartridge_directory()` rebuilds its
cartridge indexes and decoded-record cache; it leaves the system directory
unchanged and does not update previously returned tables. It neither reads nor
writes SELECT and does not detect mapping changes automatically.

A retained cartridge address is still a mapped address, not a socket-encoded
handle. Ordinary CPU data accesses follow SELECT, not the active instruction
socket. Rebuilding a directory does not pin a source or complete an outstanding
hardware operation. Preserve the selection and source lifetime required by the
[DMA](../docs/book1/dma.md) or [APU](../docs/book1/apu.md) operation that uses the bytes.

#### Image metadata and atlas coordinates

Image metadata separates the original image's dimensions from its location
within a packed texture atlas. Atlas coordinates locate source pixels; they do
not specify where the atlas resides in VRAM.

| `imgmeta` fields | Meaning |
|---|---|
| `width`, `height` | Original image dimensions in pixels, not atlas dimensions. |
| `texture_u`, `texture_v` | Image top-left in atlas pixels, not normalized UVs or page-local eight-bit coordinates. |
| `gx_atlas_id` | Resource ID of the cartridge texture atlas. Its texture record supplies the compressed stream; the ID is neither a VRAM address nor a texture-page index. |
| `gx_source_x`, `gx_source_y` | Fixed system-image source position in Direct16 VRAM, supplied instead of `gx_atlas_id`. |
| `gx_page_tiles` | Optional source rectangles for an image split at 256 × 256-pixel atlas-page boundaries. |

For system images, the supplied source position already combines the system
atlas origin with `texture_u` and `texture_v`. Its horizontal coordinate counts
16-bit VRAM words, with one Direct16 pixel per word; its vertical coordinate
counts rows. Use those supplied fields rather than hardcoding the system atlas
origin. These fields describe the system-image route, not a substitute for
missing cartridge-atlas metadata.

Each `gx_page_tiles` entry describes a source rectangle and its position within
the original image:

| Tile fields | Units and meaning |
|---|---|
| `u`, `v` | Source top-left in atlas pixels. |
| `x`, `y` | Pixel offset within the original image. |
| `w`, `h` | Rectangle dimensions in pixels. |

Tiles are ordered row-then-column. Each rectangle ends at the next page edge
or original-image edge. For an untransformed image, place its output at the
image position plus the tile's
`x` and `y`. Source coordinates can exceed 255: the packet uses their low eight
bits together with separate texture-page selection. Do not confuse the complete
atlas coordinate with a page-local UV byte. See [GPU: Locate texture texels and
palette colors](../docs/book1/gpu.md#sec-gpu-locate-texture-texels-and-palette-colors).

#### Texture metadata and transfer counts

The packed-atlas route supplies Palette4 (`mode = 0`) or Direct16 (`mode = 2`).
These are format codes, not literal bits-per-pixel values. The GPU's Palette8
mode (`1`) remains available through its raw texture interface; it is not an
additional packed-atlas format supplied by this route.

| `texturemeta` field | Representation and unit |
|---|---|
| `mode` | Palette4 or Direct16 format code. |
| `word_width` | Horizontal upload extent in **16-bit VRAM words**. Direct16 stores one pixel per word; Palette4 stores four indices per word. |
| `height` | Atlas upload rows, not the original image's height within that atlas. |
| `texture_word_count` | Decoded texture payload in **32-bit words**, excluding GP0 headers and CLUT payload. |
| `clut_word_count` | Decoded CLUT payload in **32-bit words**: zero for Direct16; eight for Palette4, supplying sixteen 16-bit colors. |

For atlas pixel dimensions `W × H`, Direct16 uses `word_width = W`; Palette4
uses `(W + 3) >> 2`. Palette4 rounds each row to a complete 16-bit word and leaves
its unused final nibbles zero. The texture payload then pairs consecutive
16-bit words into 32-bit words, low half first. Pairing continues across row
boundaries: an odd-width row does not acquire a separate 32-bit padding word.

Consequently, `texture_word_count = (word_width × H + 1) >> 1`. If the complete
texture has an odd number of 16-bit words, the final payload word has zero in
its unused high half. The CLUT begins after that complete 32-bit texture
payload, not in its spare half. GP0 writes only the declared texture extent;
the unused high half does not add another VRAM word.

Keep the three stream lengths separate:

| Quantity | Count in 32-bit words |
|---|---|
| Compressed input | `record.len >> 2`, including the IMGDEC stream header and compressed data. The emitted stream's byte length is a multiple of four. |
| Decoded payload | `texture_word_count + clut_word_count`; excludes generated packet headers. |
| Generated GP0 output | Texture payload plus three header words; if CLUT count is nonzero, add its payload and another three header words. |

The stream header also contains the decoded texture and CLUT counts. A
compressed-input count is not a replacement for either count. The separate
texture size word is `word_width | (height << 16)`, not the original image's
pixel width or a 32-bit payload count. IMGDEC generates a 16 × 1-word CLUT
upload when the CLUT payload is present. See [IMGDEC: Generated GP0
output](../docs/book1/imgdec.md#sec-imgdec-generated-gp0-output) for the complete packet and
count rules.

VRAM placement is another operation. Reserve the texture rectangle and any
CLUT without overlapping the [firmware reservation](../docs/book1/memory.md#sec-memory-firmware-reservation-in-vram)
or other live readers. The atlas helper reserves at least sixteen VRAM words
of width and one additional row for Palette4, placing the CLUT just below the
texture. Its horizontal alignment is 64 VRAM words for Palette4 and 256 for
Direct16; both use 256-row vertical alignment. These choices preserve the atlas
page grid. With another placement, account for the actual source positions
when selecting pages and splitting rectangles. The helper's alignments are not
extra GPU alignment rules or image dimensions. The upload still uses
`word_width × height`.

#### Library upload boundary

The `cartlib/gx/imgdec` operation is
`upload(source, source_word_count, texture_word_count, clut_word_count, destination, size, clut_destination_word)`.

| Arguments | Meaning |
|---|---|
| `source`, `source_word_count` | Compressed stream's mapped byte address and 32-bit input-word count. |
| `texture_word_count`, `clut_word_count` | Decoded payload counts from texture metadata. |
| `destination` | Texture origin: horizontal 16-bit VRAM-word coordinate in the low half, row in the high half. |
| `size` | `word_width \| (height << 16)`. |
| `clut_destination_word` | CLUT origin in the same word/row coordinate representation. |

The helper first waits for earlier DMA0 and DMA1 work, then programs IMGDEC,
arms DMA1 from fixed IMGDEC DATA to fixed GPU GP0, arms DMA0 from the
incrementing source to fixed IMGDEC DATA, and issues START. It returns without
waiting for the new upload. Its idle waits depend on the DMA library's
completion callbacks; retain that dispatch route.

Published atlas placement and prepared draw words do not establish that new
texels have arrived. Keep source lifetime, both DMA completions, IMGDEC's
terminal status and downstream GPU completion distinct. A decoder fault can
leave an armed DMA channel waiting, while an upload's delivery does not itself
acknowledge display publication. Follow the [IMGDEC completion and recovery
rules](../docs/book1/imgdec.md#sec-imgdec-interrupts-and-fault-recovery) and the [GPU stream
handoff](../docs/book1/gpu.md#sec-gpu-hand-a-gp0-stream-between-cpu-and-dma) before reusing
their resources or depending on the uploaded contents.

#### Packed collision data

An image's `collision_addr` points to a `G2D2` collision blob, not to its image
metadata or pixel data. The blob begins with a 32-byte variant directory.
Let `C` be the blob's mapped byte address. Integer fields are unsigned
32-bit little-endian words; `F32` denotes a little-endian IEEE 754 binary32
geometry scalar, not a fixed-point word.

| Byte offset from `C` | Field |
|---|---|
| `00H` | Magic `32443247H`; bytes spell `G2D2`. |
| `04H` | Format version: 2. |
| `08H` | Original descriptor offset. |
| `0CH` | Horizontal-flip variant descriptor offset. |
| `10H` | Vertical-flip variant descriptor offset. |
| `14H` | Both-flips variant descriptor offset. |
| `18H`, `1CH` | Reserved words, emitted as zero. |

Each header offset is relative to **`C`**. A selected descriptor therefore
begins at `S = C + variant_offset`. GEO does not consume this header as a shape
descriptor. The blob has no length word: its complete extent comes from the
directory's collision-data start and end. The image record's `len` describes
its main-data span, not this collision extent.

Each variant uses the 16-byte
[OVERLAP2D shape descriptor](../docs/book1/geo.md#sec-geo-shape-descriptors-and-bounds).
Its data and bounds offsets are relative to **that descriptor**, not `C`.
The packed forms are:

| Kind | Emitted data count | Data and bounds |
|---|---|---|
| AABB, 1 | 4 | Four F32 values: left, top, right, bottom. Data and bounds point to the same 16-byte block. |
| Convex polygon, 3 | Number of vertices | Consecutive F32 `(x,y)` pairs, eight bytes per vertex. A separate 16-byte bounds block contains coordinate minima and maxima. |
| Compound, 4 | Number of pieces | Consecutive 16-byte child descriptors, each an AABB or polygon, plus a separate parent bounds block. Each child's offsets are relative to that child. |

The header, descriptors and geometry blocks start on four-byte boundaries.
There is no stored normal array, center, transform matrix or vertex-stride
field. The image's `centerpoint` belongs to metadata, not an
implicit subtraction from these coordinates.

Image-derived geometry uses pixel sample coordinates: zero through width minus
one and zero through height minus one. Reflection maps an X coordinate to
`width - 1 - x`, and a Y coordinate to `height - 1 - y`, for both polygon
vertices and bounding-box endpoints. These endpoints are geometry coordinates,
not the exclusive right/bottom edges of a bitmap storage rectangle.

#### Using packed geometry with GEO

The `cartlib/collision/collision_shape` function `variant_addresses(C)` returns
four absolute descriptor addresses in original, horizontal, vertical and
both-flips order. It adds the header offsets to `C`; it does not copy geometry
or turn the coordinates into ordinary tables.

Write the selected address `S` to the shape-address word of an
`OVERLAP2D_PASS` instance. Its F32 translations `tx` and `ty` position the
image-local geometry; layer and mask are separate words. This instance format
has no pivot, rotation or scale field. A GPU drawing flip does not modify the
collision data: select the prebuilt geometry variant separately.

`XFORM2_BATCH` and `SAT2_BATCH` instead use signed Q16.16 vertices and different
records. SAT flag `1` means convex polygon, whereas OVERLAP kind `1` means
AABB; SAT's vertex offset is relative to `SRC2`, not its descriptor. Casting an
address does not convert either the coordinate representation or the record
layout. A polygon supplied to OVERLAP must have 3–64 vertices; the packed
representation does not change that hardware limit.

Launch captures register words, not the source geometry or cartridge identity.
GEO reads descriptors, bounds and vertices during execution. Cartridge-window
reads follow the current SELECT, not a pinned socket. Preserve source bytes
and the relevant mapping until the job completes. Rebuilding a ROM directory
neither completes GEO nor retargets previously retained descriptor addresses.

An IRQ wakeup alone does not establish success. Inspect the terminal status
and fault words as specified in [GEO: OVERLAP2D_PASS](../docs/book1/geo.md#sec-geo-overlap2d_pass-translated-shape-contacts),
which also defines the complete instance, pair, result and register contracts.

<a id="apu-playback"></a>

## APU playback integration

### Library playback routes

The following software routes use `cartlib/apu`; ROM directory lookup uses
`cartlib/rom_dir`. The library owns DMA0 for its transfer operations, unlike the
hardware interface, which admits either DMA channel.

A [ROM resource record](#software-resource-records)
supplies `addr` and `len`: the mapped source address and its byte extent.
`apu.source(record)` reads the BADP header at that address, not `audiometa`,
to construct the source descriptor. It selects four-bit BADP, takes the data
offset from the header and sets the data byte count to `len − data_offset`.
This step neither copies samples nor programs the APU. `apu.play` and
`apu.play_plain` subsequently write the command staging bank and submit PLAY.

| Starting material | Route to playback |
|---|---|
| Normally packed ROM audio | Obtain its record with `rom_dir.audio(audio_id)`, prepare the BADP source with `apu.source(record)`, then call `apu.play_plain(source, slot)`. `apu.play` accepts explicit rate, gain, start and filter words. |
| Authored ROM PCM | Retain typed `rodata` samples and program their address, byte extent and PCM metadata. The APU does not parse a PCM container header. |
| Samples produced in main RAM | Upload through the transfer port, then PLAY from `apu.sample_ram_base + byte_offset`, not from the main-RAM buffer. |
| Square generator | Program generator kind one, rate, loop and duty. No sample upload or source-buffer binding is needed. |

1. **Own the required resources.** Reserve a playback slot. Uploads and downloads
   also need the shared transfer ports and, with the library, DMA0.
   Finish earlier owned transfers before reprogramming the channel.
   Requiring `cartlib/apu` installs the DMA/IRQ library route; retain its DMA
   callbacks rather than defining a competing global `irq`. Library DMA waits
   require CPU interrupt acceptance and the enabled DMA completion sources.
2. **Prepare the source bytes.** `apu.upload` starts transport without waiting.
   Keep its source unchanged until `dma.wait0_idle()` returns, then separately
   wait for STATUS.TRANSFER_BUSY to clear before playback or a mode change.
   DMA DONE is not the final sample-RAM commit. For download, DMA completion
   instead marks receipt of the requested words; select transfer STOP afterward
   to discard unwanted prefetch. See [Sample RAM transfer](../docs/book1/apu.md#sec-apu-sample-ram-transfer).
3. **Submit coherent configuration.** Write staging parameters first and CMD
   last, or use the library playback functions. Serialize staging-bank users
   and check CMD_FREE before a burst: a full FIFO replaces its oldest command.
   Source extents and offsets are bytes; start positions and loop bounds are
   source frames. Unity rate is `00010000H`, unity gain `00001000H`.
4. **Separate staging from live control.** PLAY binds at execution, not capture;
   keep the intended cartridge socket selected until then. Capture resets the
   visible slot selector to zero, so reselect through staging SLOT before using
   the live bank. A live gain store changes that voice; a staging gain store
   only prepares a command. Do not use a live edit as an ordered follow-up to a
   still-queued PLAY. Use PLAY for a coherent source replacement rather
   than consecutive live source-field stores.
5. **Retain storage until the voice is finished.** Pause retains the voice and
   its source requirement. Natural ends and completed nonzero fades publish
   SLOT_ENDED; `apu.stop_slot(slot, 0)` does not. Register end service through
   `cartlib/irq` when needed. For one controlled outstanding end, snapshot a
   retained service sequence before issuing PLAY or the faded stop, then wait
   on that predicate: another IRQ can wake the CPU, and the hardware retains
   only the latest end event. See [End events and interrupts](../docs/book1/apu.md#sec-apu-end-events-and-interrupts).

The [worked program](#worked-blua-program) below supplies the complete imports,
typed operands and interrupt setup for the library transfer and playback route.

### Worked BLua program

This complete program uses four slots in succession: looping ROM PCM, the same
PCM copied into private sample RAM, a square, and a one-shot BADP source. Run it
from ordinary cartridge startup with zeroed BSS and CPU interrupt acceptance
enabled. It owns slots 2–5, DMA channel 0, the first 64 sample-RAM bytes and the
APU transfer port. Other slots are idle, neither DMA channel has outstanding
work, no other IRQ sources are enabled, and no earlier APU fault, command
or DMA/APU interrupt request is pending.

Create a const module named `results`. Concatenate the following **Entry
module** parts in order into one entry module. The program requires the existing
`cartlib/apu`, `cartlib/dma` and `cartlib/irq` modules; do not add another global
`irq` function. The library's DMA callbacks remain installed. The program
registers only its APU callback, retaining one controlled end at a time in BSS.
The fixed `rodata` records and PCM array are typed ROM operands. Retained
observations and callback state live in explicit BSS.

Supply the mono 44,100 Hz, 4,410-frame tone resource distributed with this
example. Include it as an audio resource named `tone`. Its ordinary audio
packing produces the BADP source exported as
`audio_tone_addr` and `audio_tone_len` by `bmsx/assets`. The last part reads its
existing `badp_header` record and explicitly programs the source fields.
The APU does not parse that record to fill the staging bank for the cartridge.

#### Follow the four sources

1. **ROM PCM16.** The 32 authored halfwords contain two copies of a 16-frame
   waveform. The loop uses only frames [0,16); a source rate of 7,040 frames/s
   and unity rate step therefore repeats it 440 times/s. Gain starts at one-half,
   then a selected-window write changes it to minus one-half. Pause retains the
   bank and active bit while the output sample clock continues. Resume retains
   its source phase; a 441-output-frame fade then ends it.
2. **Private-RAM PCM16.** Upload all 64 source bytes as sixteen words. Wait for
   DMA separately from TRANSFER_BUSY. Download sixteen words into BSS, then
   stop unwanted read prefetch. PLAY uses source address `40000000H`, not a CPU
   pointer to the downloaded BSS copy. Source and loop settings otherwise match
   the ROM voice; slot 3 is a different bank.
3. **Square.** Slot 4 uses GENERATOR_KIND=1, source rate 440, unity rate step,
   one-half duty and loop [0,1). The fractional cursor provides its period;
   FRAME_COUNT=1 is not a one-output-frame sound while that loop is enabled.
   The programmed quarter gain yields +8191 or −8192 per channel before the
   subsequent fade, in the absence of other contributions.
4. **BADP.** Slot 5 reads the packed tone directly from ROM at unity rate,
   one-half gain and no loop. Its 4,410 source frames play at the 44,100 Hz output
   cadence, then end naturally. The generated resource symbols supply its source
   address and byte length; the header supplies its data offset. No compressed
   bytes are expanded into BSS.

Each 2,205-frame interval is a **minimum observed sample-clock distance**; the
polling loop may observe a later frame. The 441-frame fades describe rendered
output duration, not CPU issue-to-return latency. Neither count includes an
invented fixed interrupt-delivery charge.

Requiring the DMA library enables its two completion sources. Registering the
APU callback adds bit 5, so the example's owned interrupt mask is `00000121H`.
VBlank remains masked and is deliberately allowed to become pending. The
shared dispatcher acknowledges only enabled serviced sources; a pending masked
VBlank must survive the sound and DMA work. Final FLAGS need not be zero.

#### Const module: retained observations

The callback and foreground code share this fixed BSS record.

```lua
module<const>

struct apu_manual_event
  kind: word
  slot: word
  source_address: word
  hardware_sequence: word
end

struct apu_manual_result
  completed_phase: word
  service_sequence: word
  initial_event_sequence: word
  events: apu_manual_event[4]
  pcm_address: word
  pcm_selected_source: word
  pcm_active_mask: word
  pcm_status: word
  pcm_gain: word
  paused_sample_start: word
  paused_sample_end: word
  paused_active_mask: word
  paused_source: word
  paused_gain: word
  upload_dma_status: word
  upload_apu_status: word
  upload_committed_status: word
  transfer_address: word
  download_dma_status: word
  download_apu_status: word
  download_stopped_status: word
  transferred: word[16]
  ram_selected_source: word
  ram_active_mask: word
  square_selected_source: word
  square_active_mask: word
  square_rate_hz: word
  square_duty: word
  badp_address: word
  badp_bytes: word
  badp_version: word
  badp_channels: word
  badp_sample_rate_hz: word
  badp_frames: word
  badp_data_offset: word
  badp_seek_count: word
  badp_seek_offset: word
  badp_selected_source: word
  badp_active_mask: word
  final_active_mask: word
  final_status: word
  final_fault_code: word
  final_fault_detail: word
  initial_unrelated_pending: word
  final_irq_flags: word
end

bss result: apu_manual_result

return { result = result }
```

#### Entry module: imports and word ports

The imported APU module supplies the existing register-record and BADP header types. Only the first 21 parameter fields of `selected` are used; its address is the live slot window, not the staging bank.

```lua
module<entry>

local apu<const> = require('cartlib/apu')
local dma<const> = require('cartlib/dma')
local irq<const> = require('cartlib/irq')
local assets<const> = require('bmsx/assets')
local state<const> = require('results')
local result<const>: *apu_manual_result = state.result
local commands<const>: *apu_command_registers = 0x08000120
local command_words<const>: *word = commands
local selected<const>: *apu_command_registers = 0x08000194
local status<const>: *word = 0x08000178
local selected_source<const>: *word = 0x0800018c
local active_mask<const>: *word = 0x08000190
local queued<const>: *word = 0x080001f4
local transfer_address<const>: *word = 0x080001e8
local transfer_control<const>: *word = 0x080001f0
local sample_sequence<const>: *word = 0x08000200
local event_kind<const>: *word = 0x0800017c
local event_slot<const>: *word = 0x08000180
local event_source<const>: *word = 0x08000184
local event_sequence<const>: *word = 0x08000188
local fault_code<const>: *word = 0x08010218
local fault_detail<const>: *word = 0x0801021c
local dma_status<const>: *word = 0x0800001c
local irq_flags<const>: *word = 0x08000000
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
```

#### Entry module: fixed source and presets

The source address is supplied by a real word write when PLAY is staged. The preset contains the other literal operands. The copies below deliberately leave CMD until after all parameter writes.

```lua
-- Two authored sine periods. Loop [0,16) at 7040 source frames/s gives 440 Hz.
rodata pcm: i16[32] = {
  0, 3135, 5793, 7568, 8192, 7568, 5793, 3135,
  0, -3135, -5793, -7568, -8192, -7568, -5793, -3135,
  0, 3135, 5793, 7568, 8192, 7568, 5793, 3135,
  0, -3135, -5793, -7568, -8192, -7568, -5793, -3135,
}

-- The existing APU register record names every operand; CMD is written last.
rodata pcm_note: apu_command_registers = {
  source_addr = 0, source_bytes = sizeof(i16[32]), sample_rate_hz = 7040,
  channels = 1, bits_per_sample = 16, frame_count = 32,
  data_offset = 0, data_bytes = sizeof(i16[32]),
  loop_start_sample = 0, loop_end_sample = 16,
  slot = 2, rate_step_q16 = 0x00010000, gain_q12 = 0x00000800,
  start_sample = 0, filter_control = 0, filter_b0_b1 = 0x00004000,
  filter_b2_a1 = 0, filter_a2 = 0, fade_samples = 0,
  generator_kind = 0, generator_duty_q12 = 0x00000800, cmd = 1,
}
rodata square_note: apu_command_registers = {
  source_addr = 0, source_bytes = 0, sample_rate_hz = 440,
  channels = 1, bits_per_sample = 16, frame_count = 1,
  data_offset = 0, data_bytes = 0, loop_start_sample = 0, loop_end_sample = 1,
  slot = 4, rate_step_q16 = 0x00010000, gain_q12 = 0x00000400,
  start_sample = 0, filter_control = 0, filter_b0_b1 = 0x00004000,
  filter_b2_a1 = 0, filter_a2 = 0, fade_samples = 0,
  generator_kind = 1, generator_duty_q12 = 0x00000800, cmd = 1,
}
local pcm_note_words<const>: *word = pcm_note
local square_note_words<const>: *word = square_note
```

#### Entry module: end service and masked pending

The callback records the latest hardware event before advancing the BSS service sequence. No second slot can end during a controlled wait in this program. This does not turn the hardware event latch into a queue.

```lua
-- cartlib/dma keeps its own DMA callbacks. Retain the single APU event latch.
irq.register(0x00000020, function()
  local index<const> = result.service_sequence
  result.events[index].kind = *event_kind
  result.events[index].slot = *event_slot
  result.events[index].source_address = *event_source
  result.events[index].hardware_sequence = *event_sequence
  result.service_sequence = index + 1
end)
*irq_ack = 0x00000121
result.initial_event_sequence = *event_sequence
-- Disabled VBlank is allowed to remain pending throughout every APU/DMA IRQ.
while (*irq_flags & 0x00000004) == 0 do
end
result.initial_unrelated_pending = *irq_flags & 0x00000004
```

#### Entry module: ROM voice, live gain and pause

The end predicate is sampled before STOP. `halt_until_irq` may wake for a DMA source too; only the changed APU service sequence ends this wait.

```lua
-- 1. ROM PCM16: capture parameters on CMD, then select the committed slot.
result.pcm_address = pcm
commands->source_addr = pcm
for index = 1, 20 do
  command_words[index] = pcm_note_words[index]
end
commands->cmd = 1
while (*active_mask & 0x00000004) == 0 do
end
commands->slot = 2
result.pcm_selected_source = *selected_source
result.pcm_active_mask = *active_mask
result.pcm_status = *status
local playing_start<const> = *sample_sequence
while ((*sample_sequence - playing_start) & 0xffffffff) < 2205 do
end

-- A selected-window gain write is live, not a staged command. Negative is Q12.
selected->gain_q12 = 0xfffff800
result.pcm_gain = selected->gain_q12
apu.pause_slot(2)
while *queued ~= 0 do
end
commands->slot = 2
result.paused_sample_start = *sample_sequence
while ((*sample_sequence - result.paused_sample_start) & 0xffffffff) < 2205 do
end
result.paused_sample_end = *sample_sequence
result.paused_active_mask = *active_mask
result.paused_source = *selected_source
result.paused_gain = selected->gain_q12
apu.resume_slot(2)
while *queued ~= 0 do
end
local resumed_start<const> = *sample_sequence
while ((*sample_sequence - resumed_start) & 0xffffffff) < 2205 do
end
local pcm_end_sequence<const> = result.service_sequence
apu.stop_slot(2, 441)
while result.service_sequence == pcm_end_sequence do
  halt_until_irq
end
result.completed_phase = 1
```

#### Entry module: private-RAM round trip and voice

The upload waits are deliberately separate. After download, STOP cancels extra prefetch; it does not erase the uploaded PCM. The returned BSS words retain the readback.

```lua
-- 2. Upload goes through FIFO to private RAM: DMA DONE is not final commit.
apu.upload(pcm, 0, sizeof(i16[32]) // 4)
dma.wait0_idle()
result.upload_dma_status = *dma_status
result.upload_apu_status = *status
while (*status & 0x00000400) ~= 0 do
end
result.upload_committed_status = *status
result.transfer_address = *transfer_address
apu.download(&result.transferred[0], 0, 16)
dma.wait0_idle()
result.download_dma_status = *dma_status
result.download_apu_status = *status
*transfer_control = 0
result.download_stopped_status = *status

-- 40000000H is a source descriptor address, not a CPU sample-memory pointer.
commands->source_addr = 0x40000000
for index = 1, 20 do
  command_words[index] = pcm_note_words[index]
end
commands->slot = 3
commands->cmd = 1
while (*active_mask & 0x00000008) == 0 do
end
commands->slot = 3
result.ram_selected_source = *selected_source
result.ram_active_mask = *active_mask
local ram_start<const> = *sample_sequence
while ((*sample_sequence - ram_start) & 0xffffffff) < 2205 do
end
local ram_end_sequence<const> = result.service_sequence
apu.stop_slot(3, 441)
while result.service_sequence == ram_end_sequence do
  halt_until_irq
end
result.completed_phase = 2
```

#### Entry module: square voice

The square does not bind source bytes. Its active bit, rather than a nonzero selected source address, identifies the active slot.

```lua
-- 3. A square uses fractional cursor phase: one-frame loop, source rate 440 Hz.
for index = 0, 20 do
  command_words[index] = square_note_words[index]
end
commands->cmd = 1
while (*active_mask & 0x00000010) == 0 do
end
commands->slot = 4
result.square_selected_source = *selected_source
result.square_active_mask = *active_mask
result.square_rate_hz = selected->sample_rate_hz
result.square_duty = selected->generator_duty_q12
local square_start<const> = *sample_sequence
while ((*sample_sequence - square_start) & 0xffffffff) < 2205 do
end
local square_end_sequence<const> = result.service_sequence
apu.stop_slot(4, 441)
while result.service_sequence == square_end_sequence do
  halt_until_irq
end
result.completed_phase = 3
```

#### Entry module: BADP source fields

The packed resource supplies the descriptor metadata. This authored source is a one-shot, so both loop words are explicitly zero.

```lua
-- 4. tone.wav is normally packed as BADP. Read its central header type in ROM.
local header<const>: *badp_header = assets.audio_tone_addr
result.badp_address = assets.audio_tone_addr
result.badp_bytes = assets.audio_tone_len
result.badp_version = header->version
result.badp_channels = header->channels
result.badp_sample_rate_hz = header->sample_rate_hz
result.badp_frames = header->frame_count
result.badp_data_offset = header->data_offset
result.badp_seek_count = header->seek_entry_count
result.badp_seek_offset = header->seek_table_offset
commands->source_addr = assets.audio_tone_addr
commands->source_bytes = assets.audio_tone_len
commands->sample_rate_hz = header->sample_rate_hz
commands->channels = header->channels
commands->bits_per_sample = 4
commands->frame_count = header->frame_count
commands->data_offset = header->data_offset
commands->data_bytes = assets.audio_tone_len - header->data_offset
-- This authored one-shot has no loop; neither field is inferred by the APU.
commands->loop_start_sample = 0
commands->loop_end_sample = 0
commands->slot = 5
commands->rate_step_q16 = 0x00010000
commands->gain_q12 = 0x00000800
commands->start_sample = 0
commands->filter_control = 0
commands->filter_b0_b1 = 0x00004000
commands->filter_b2_a1 = 0
commands->filter_a2 = 0
commands->fade_samples = 0
commands->generator_kind = 0
commands->generator_duty_q12 = 0x00000800
```

#### Entry module: BADP command and final state

The sequence is sampled before PLAY because this source can end naturally. The final state is retained before the program enters its permanent wait.

```lua
local badp_end_sequence<const> = result.service_sequence
commands->cmd = 1
while (*active_mask & 0x00000020) == 0 do
end
commands->slot = 5
result.badp_selected_source = *selected_source
result.badp_active_mask = *active_mask
while result.service_sequence == badp_end_sequence do
  halt_until_irq
end
result.final_active_mask = *active_mask
result.final_status = *status
result.final_fault_code = *fault_code
result.final_fault_detail = *fault_detail
*irq_mask = 0
result.final_irq_flags = *irq_flags
result.completed_phase = 4
while true do
  halt_until_irq
end
```

#### Interpret the retained observations

The controlled program distinguishes the following states. Its transfer-status
observations assume the inputs and exclusive ownership above, not arbitrary
concurrent DMA or voice work.

| Retained observation | Meaning |
|---|---|
| PCM ACTIVE_MASK=`00000004H`, source=`pcm` | Slot 2 is active and bound to the authored ROM data |
| Live gain=`fffff800H` | Signed Q12 minus one-half; the selected bank changed without another PLAY |
| Paused ACTIVE_MASK=`00000004H`; sample distance at least 2,205 | Pausing the slot does not pause the output clock or clear the bank |
| Upload DMA STATUS=`00000002H`, APU STATUS=`00000420H` | Submission is DONE; the final RAM batch is still pending |
| Upload committed STATUS=`000002a0H` | Empty command FIFO and empty-FIFO DMA_WRITE request; no pending RAM batch |
| Download DMA STATUS=`00000002H`, APU STATUS=`00000420H` | Desired words were dequeued; extra RAM prefetch is pending |
| Download stopped STATUS=`00000020H` | STOP canceled prefetch and cleared transfer requests |
| `transferred[0..15]` | Exact sixteen-word copy of the authored PCM data |
| RAM source=`40000000H`, ACTIVE_MASK=`00000008H` | Slot 3 binds private sample RAM, independently of the BSS readback |
| Square source=0, ACTIVE_MASK=`00000010H` | A zero source address does not mean a generator is inactive |
| BADP ACTIVE_MASK=`00000020H` | Slot 5 is the one-shot compressed source |
| Four retained events | Slots 2, 3, 4, 5, in that order; successive hardware sequences and the corresponding programmed source addresses |
| Final ACTIVE_MASK=0, STATUS=`00000020H` | No slots or commands remain active, and the transfer mode is STOP |
| Final FAULT_CODE=0, FAULT_DETAIL=0 | No APU command/source fault was raised by these inputs |
| Final MASK=0, FLAGS=`00000004H` | Delivery is disabled; unrelated masked VBlank remains pending |

The event source for the square is zero; the other three are the actual ROM,
private-RAM and packed-ROM source addresses. Natural and faded ends clear their
banks. The four BSS records are observations from these controlled operations,
not additional hardware event storage.

<a id="gte-integration"></a>

## GTE integration listings

### Complete cartridge program

The following BLua program joins the geometry, vertex-color, drawing and display
steps into a repeated frame loop. It draws the triangle first at `(96,64)`,
`(160,64)`, `(128,128)`, then alternates its X translation between 0 and 32 every
32 completed loop iterations. At depth 512 and H=256, that translation moves its
screen positions sixteen units horizontally. The display is 256×192.

#### Author operands as fixed data

Require the GTE utility module before using its operand types. Their layouts
are chosen for direct whole-word transfer to the unit, not for allocation of
objects when a frame begins:

| Operand type | Bytes | Contents |
|---|---:|---|
| `gte_matrix` | 20 | Nine signed halfword coefficients in three rows, followed by one halfword of padding |
| `gte_vector` | 8 | Signed halfword X, Y, Z, then a padding halfword |
| `gte_transform` | 32 | One matrix, then three complete translation words |
| `gte_projection` | 20 | Complete words for OFX, OFY, H, DQA and DQB, in register order |

A `rodata` declaration places its initialized operands in cartridge ROM.
Nested braces initialize that fixed data; they are not an instruction to build
new tables inside the frame loop. The signed halfword initializers pack two
coefficients or coordinates into each transferred word. For example, the first
vertex `(-64,-64,512)` occupies `0xffc0ffc0` and `0x00000200`.
The padding halfword is not another coordinate or coefficient.

The program obtains a word view of each record and copies its words into the
applicable register span. These are actual scalar word transfers, not an atomic
matrix load or a new GTE command. No halfword write is sent to an IO register.
Program the complete transform before issuing projection; the GTE neither
fetches the ROM records itself nor remembers the address from which they came.
Only the changing TRX word is rewritten independently in the frame loop.

The three matrices are Q12 identities. Position and translation words use
integer spatial counts. The three vertex-lighting directions are deliberately
supplied orthogonal directions, not normals computed from this planar triangle.
They expose independent red, green and blue contributions so the GPU's color
interpolation is visible. This is a data-flow example, not a physically smooth
lighting model for a flat face.

`bss` supplies static writable words for the VBlank sequence, back-buffer index
and iteration count. In particular, the interrupt handler and display loop
address the same sequence word. After initialization only the system VBlank
source is unmasked; the handler acknowledges the delivered source before
advancing that sequence.

#### Program listing

Read the following parts in order as one cartridge program. The last three
parts continue the same frame loop; they are not separate entry functions.

##### Register ports

```lua
module<entry>

local gte<const> = require('cartlib/gx/gte')

local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240
local data<const>: *word[32] = gte.data
local control<const>: *word[32] = gte.control
local command<const>: *word = gte.command
local pmode<const>: *word = 0x08010354
local framebuffer<const>: *word = 0x0801035c
local source<const>: *word = 0x08010360
local display_extent<const>: *word = 0x08010368
local pcrtc_csr<const>: *word = 0x080103d4
```

##### Transform and projection operands

```lua
-- Fixed ROM operands. Matrix coefficients use the Q12 convention.
rodata model_to_view: gte_transform = {
  rotation = {
    rows = { { 4096, 0, 0 }, { 0, 4096, 0 }, { 0, 0, 4096 } },
    pad = 0,
  },
  translation = { 0, 0, 0 },
}

rodata projection: gte_projection = {
  offset_x = 128 << 16,
  offset_y = 96 << 16,
  h = 256,
  cue_gain = 0,
  cue_offset = 0,
}
```

##### Lighting operands

```lua
rodata light_directions: gte_matrix = {
  rows = { { 4096, 0, 0 }, { 0, 4096, 0 }, { 0, 0, 4096 } },
  pad = 0,
}
rodata light_colors: gte_matrix = {
  rows = { { 4096, 0, 0 }, { 0, 4096, 0 }, { 0, 0, 4096 } },
  pad = 0,
}
rodata ambient: word[3] = { 0, 0, 0 }
```

##### Vertices and interrupt-visible state

```lua
rodata triangle: gte_vector[3] = {
  { x = -64, y = -64, z = 512, pad = 0 },
  { x = 64, y = -64, z = 512, pad = 0 },
  { x = 0, y = 64, z = 512, pad = 0 },
}
-- Deliberately supplied vertex-lighting directions, not positions.
rodata normals: gte_vector[3] = {
  { x = 4096, y = 0, z = 0, pad = 0 },
  { x = 0, y = 4096, z = 0, pad = 0 },
  { x = 0, y = 0, z = 4096, pad = 0 },
}

bss vblank_sequence: word
bss back_buffer: word
bss frame_number: word

function irq(flags)
  *irq_ack = flags
  *vblank_sequence = *vblank_sequence + 1
end

*irq_mask = 0
*pcrtc_csr = 0x00000200
*source = 0x00000000
*display_extent = 0x000bf3ff
```

##### Initialize the operand registers

```lua
-- Copy raw words from the authored operands; MMIO never uses halfword stores.
local transform_words<const>: *word = model_to_view
for index = 0, sizeof(gte_transform) // 4 - 1 do
  control[gte.control_r11r12 + index] = transform_words[index]
end
local projection_words<const>: *word = projection
for index = 0, sizeof(gte_projection) // 4 - 1 do
  control[gte.control_ofx + index] = projection_words[index]
end
local direction_words<const>: *word = light_directions
local color_words<const>: *word = light_colors
for index = 0, sizeof(gte_matrix) // 4 - 1 do
  control[gte.control_l11l12 + index] = direction_words[index]
  control[gte.control_lr1lr2 + index] = color_words[index]
end
for channel = 0, #ambient - 1 do
  control[gte.control_rbk + channel] = ambient[channel]
end
local position_words<const>: *word = triangle
local normal_words<const>: *word = normals

*gp0 = 0xe1000400
*gp0 = 0xe6000000
*irq_ack = 0xffffffff
*irq_mask = 0x00000004
```

##### Begin a frame and project its triangle

```lua
while true do
  local base_y<const> = *back_buffer << 8
  *gp0 = 0xe3000000 | (base_y << 10)
  *gp0 = 0xe40000ff | ((base_y + 191) << 10)
  *gp0 = 0xe5000000 | (base_y << 11)
  *gp0 = 0x02000000
  *gp0 = base_y << 16
  *gp0 = 0x00c00100

  control[gte.control_trx] = ((*frame_number >> 5) & 1) << 5
  for index = 0, sizeof(gte_vector[3]) // 4 - 1 do
    data[gte.data_vxy0 + index] = position_words[index]
  end
  *command = gte.opcode_rtpt | gte.command_sf_shift_12
  local xy0<const> = data[gte.data_sxy0]
  local xy1<const> = data[gte.data_sxy1]
  local xy2<const> = data[gte.data_sxy2]
  *command = gte.opcode_nclip
  local doubled_area<const> = data[gte.data_mac0]
```

##### Calculate vertex colors and submit the primitive

```lua
  -- MAC0 is read as a raw word; select positive signed area, excluding zero.
  if doubled_area ~= 0 and (doubled_area & 0x80000000) == 0 then
    for index = 0, sizeof(gte_vector[3]) // 4 - 1 do
      data[gte.data_vxy0 + index] = normal_words[index]
    end
    data[gte.data_rgb] = 0x004080a0
    *command = gte.opcode_ncct | gte.command_sf_shift_12 | gte.command_lm_positive
    *gp0 = 0x30000000 | (data[gte.data_rgb0] & 0x00ffffff)
    *gp0 = xy0
    *gp0 = data[gte.data_rgb1] & 0x00ffffff
    *gp0 = xy1
    *gp0 = data[gte.data_rgb2] & 0x00ffffff
    *gp0 = xy2
  end
```

##### Publish the completed buffer and wait

```lua
  while (*gp1 & 0x04000000) == 0 do
  end
  *framebuffer = 0x000fa000 | (*back_buffer << 6)
  *pmode = 0x0000ff21
  local before<const> = *vblank_sequence
  while *vblank_sequence == before do
    halt_until_irq
  end
  *back_buffer = 1 - *back_buffer
  *frame_number = *frame_number + 1
end
```

#### Complete BLua cartridge

For project layout, building and checking this cartridge, use the
[Build and inspect example cartridges — “Build and inspect GTE depth cue”](#build-and-inspect-gte-depth-cue).

Use the existing `cartlib/gx/gte` operand layouts. These typed ROM records hold
fixed matrices, vectors and projection settings; whole-word views transfer them
to the named GTE register windows. The position and normal deliberately reuse
V0, but the projection result and flags are retained before that reuse.

Create `results.lua` as this complete const module. Its explicit BSS keeps the
calculation results separate from raw display probes and callback observations.

```lua
module<const>

struct gte_cue_result
	completed: word
	vblank_sequence: word
	before_vblank: word
	after_vblank: word
	system_origin: word
	system_size: word
	projected_xy: word[4]
	projected_z: word[4]
	ir0: word[4]
	ir0_after_color: word[4]
	rgb2: word[4]
	projection_flags: word[4]
	color_flags: word[4]
	swatch_words: word[4]
	material_rgb2: word[3]
	material_flags: word[3]
	material_words: word[3]
	preserved_depth_words: word[4]
	material_before_vblank: word
	material_after_vblank: word
	material_ir0: word
end

bss result: gte_cue_result

return { result = result }
```

#### Declare the mapped ports

Create `cart.lua` by concatenating the following eight blocks in order, including the final material-comparison blocks.

```lua
module<entry>

local gte<const> = require('cartlib/gx/gte')
local state<const> = require('results')
local system_vram_region<const> = require('gpu/system_vram_region')
local result<const>: *gte_cue_result = state.result
local data<const>: *word[32] = gte.data
local control<const>: *word[32] = gte.control
local command<const>: *word = gte.command
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240
local pmode<const>: *word = 0x08010354
local framebuffer<const>: *word = 0x0801035c
local source<const>: *word = 0x08010360
local window<const>: *word = 0x08010364
local extent<const>: *word = 0x08010368
local pcrtc_csr<const>: *word = 0x080103d4
```

#### Author the fixed operands

Continue the entry module with typed ROM data, not runtime table construction.

```lua

-- Fixed ROM operands, not heap tables or a mutable register image.
rodata model_to_view: gte_transform = {
	rotation = {
		rows = { { 4096, 0, 0 }, { 0, 4096, 0 }, { 0, 0, 4096 } },
		pad = 0,
	},
	translation = { 0, 0, 0 },
}
rodata projection: gte_projection = {
	offset_x = 0,
	offset_y = 0,
	h = 128,
	cue_gain = -768,
	cue_offset = 0x01800100,
}
rodata light_directions: gte_matrix = {
	rows = { { 3072, 0, 2048 }, { -2048, 0, 3072 }, { 0, 0, -4096 } },
	pad = 0,
}
rodata light_colors: gte_matrix = {
	rows = { { 4096, 1024, 0 }, { 2048, 4096, 0 }, { 1024, 2048, 4096 } },
	pad = 0,
}
rodata ambient: word[3] = { 256, 512, 128 }
rodata far_color: word[3] = { 80 << 4, 96 << 4, 160 << 4 }
rodata normal: gte_vector = { x = 2458, y = 0, z = 3277, pad = 0 }
rodata positions: gte_vector[4] = {
	{ x = 0, y = 0, z = 256, pad = 0 },
	{ x = 0, y = 0, z = 384, pad = 0 },
	{ x = 0, y = 0, z = 512, pad = 0 },
	{ x = 0, y = 0, z = 768, pad = 0 },
}
rodata swatch_x: word[4] = { 16, 76, 136, 196 }
rodata material_x: word[3] = { 20, 100, 180 }
rodata materials: word[3] = { 0x34c060a0, 0x34c060a0, 0x34a0c040 }
```

#### Take ownership and configure the display

The BIOS query reports the firmware reservation; the chosen image is not a general allocation policy.

```lua

function irq(flags)
	if (flags & 0x00000004) ~= 0 then
		result.vblank_sequence = result.vblank_sequence + 1
	end
	*irq_ack = flags & 0x00000004
end

-- Own GTE, ports, display, handler and both raw 256x192 surfaces.
result.system_origin, result.system_size = system_vram_region()
*irq_mask = 0
*pcrtc_csr = 0x00000200
*pmode = 0
*framebuffer = 0x000fa000
*source = 0
*window = 0x018252a8
*extent = 0x000bf3ff
*gp1 = 0x09000000

```

#### Transfer the fixed GTE controls

Copy complete words from the fixed layouts. The loops do not issue halfword MMIO stores.

```lua
local transform_words<const>: *word = model_to_view
for index = 0, sizeof(gte_transform) // 4 - 1 do
	control[gte.control_r11r12 + index] = transform_words[index]
end
local projection_words<const>: *word = projection
for index = 0, sizeof(gte_projection) // 4 - 1 do
	control[gte.control_ofx + index] = projection_words[index]
end
local direction_words<const>: *word = light_directions
local color_words<const>: *word = light_colors
for index = 0, sizeof(gte_matrix) // 4 - 1 do
	control[gte.control_l11l12 + index] = direction_words[index]
	control[gte.control_lr1lr2 + index] = color_words[index]
end
for channel = 0, 2 do
	control[gte.control_rbk + channel] = ambient[channel]
	control[gte.control_rfc + channel] = far_color[channel]
end
data[gte.data_rgb] = 0x34c060a0
local position_words<const>: *word = positions
local normal_words<const>: *word = normal

```

#### Compute each coefficient and draw its swatch

Keep each coefficient with its own position, then restore the normal before the color command.

```lua
-- Opaque, untextured rectangles, no dither, stored mask bit set.
*gp0 = 0xe1000400
*gp0 = 0xe2000000
*gp0 = 0xe3000000
*gp0 = 0xe40000ff | (191 << 10)
*gp0 = 0xe5000000
*gp0 = 0xe6000001
*gp0 = 0x60000000
*gp0 = 0
*gp0 = 256 | (192 << 16)

for index = 0, 3 do
	-- A position chooses this sample's cue; save it before reusing V0.
	data[gte.data_vxy0] = position_words[index * 2]
	data[gte.data_vz0] = position_words[index * 2 + 1]
	*command = gte.opcode_rtps | gte.command_sf_shift_12
	result.projected_xy[index] = data[gte.data_sxy2]
	result.projected_z[index] = data[gte.data_sz3]
	result.ir0[index] = data[gte.data_ir0]
	result.projection_flags[index] = control[gte.control_flag]

	-- Restore the same supplied normal, not the position; retain IR0.
	data[gte.data_vxy0] = normal_words[0]
	data[gte.data_vz0] = normal_words[1]
	*command = gte.opcode_ncds | gte.command_sf_shift_12 | gte.command_lm_positive
	local rgb<const> = data[gte.data_rgb2]
	result.ir0_after_color[index] = data[gte.data_ir0]
	result.rgb2[index] = rgb
	result.color_flags[index] = control[gte.control_flag]

	-- CODE is not a GP0 opcode. Draw equal 44x96 screen-space swatches.
	*gp0 = 0x60000000 | (rgb & 0x00ffffff)
	*gp0 = swatch_x[index] | (48 << 16)
	*gp0 = 44 | (96 << 16)
end
```

#### Read the stored pixels and publish the first image

Raw GPUREAD probes and immediate register reads are separate from the fresh VBlank observation. The following two callback increments hold this first image for viewing; they are not a minimum display-latency guarantee.

```lua
for index = 0, 3 do
	*gp0 = 0xc0000000
	*gp0 = (swatch_x[index] + 22) | (96 << 16)
	*gp0 = 0x00010001
	while (*gp1 & 0x08000000) == 0 do
	end
	result.swatch_words[index] = *gp0
end
while (*gp1 & 0x04000000) == 0 do
end

*pmode = 0x0000ff21
*irq_ack = 0x00000004
local before<const> = result.vblank_sequence
result.before_vblank = before
*irq_mask = 0x00000004
while result.vblank_sequence == before do
	halt_until_irq
end
result.after_vblank = result.vblank_sequence
result.completed = 1
local hold<const> = result.vblank_sequence
while result.vblank_sequence - hold < 2 do
	halt_until_irq
end

```

#### Prepare the lighting reference and materials in the second surface

Continue the same entry module. The existing light, color and ambient controls remain unchanged; the first framebuffer stays selected while this block draws the second.

```lua
-- Keep the first surface selected while drawing only into rows 256..447.
*irq_mask = 0
*gp0 = 0xe3000000 | (256 << 10)
*gp0 = 0xe40000ff | (447 << 10)
*gp0 = 0xe5000000 | (256 << 11)
*gp0 = 0x60000000
*gp0 = 0
*gp0 = 256 | (192 << 16)

-- NCS and NCCS do not use the IR0 left by the depth-cue comparison.
data[gte.data_vxy0] = normal_words[0]
data[gte.data_vz0] = normal_words[1]
for index = 0, 2 do
	data[gte.data_rgb] = materials[index]
	if index == 0 then
		*command = (gte.opcode_ncs
			| gte.command_sf_shift_12 | gte.command_lm_positive)
	else
		*command = (gte.opcode_nccs
			| gte.command_sf_shift_12 | gte.command_lm_positive)
	end
	local rgb<const> = data[gte.data_rgb2]
	result.material_rgb2[index] = rgb
	result.material_flags[index] = control[gte.control_flag]
	*gp0 = 0x60000000 | (rgb & 0x00ffffff)
	*gp0 = material_x[index] | (48 << 16)
	*gp0 = 56 | (96 << 16)
end
result.material_ir0 = data[gte.data_ir0]

```

#### Check both surfaces and select the second image

Continue with absolute raw probes, a separate GPU-idle wait and the final framebuffer publication. Neither surface is overwritten afterwards.

```lua
-- Drawing offset affects rectangles, not C0 transfer coordinates.
for index = 0, 2 do
	*gp0 = 0xc0000000
	*gp0 = (material_x[index] + 28) | (352 << 16)
	*gp0 = 0x00010001
	while (*gp1 & 0x08000000) == 0 do
	end
	result.material_words[index] = *gp0
end
for index = 0, 3 do
	*gp0 = 0xc0000000
	*gp0 = (swatch_x[index] + 22) | (96 << 16)
	*gp0 = 0x00010001
	while (*gp1 & 0x08000000) == 0 do
	end
	result.preserved_depth_words[index] = *gp0
end
while (*gp1 & 0x04000000) == 0 do
end

-- Only change the framebuffer after the second image is complete.
*framebuffer = 0x000fa040
*irq_ack = 0x00000004
local material_before<const> = result.vblank_sequence
result.material_before_vblank = material_before
*irq_mask = 0x00000004
while result.vblank_sequence == material_before do
	halt_until_irq
end
result.material_after_vblank = result.vblank_sequence
result.completed = 2
while true do
	halt_until_irq
end
```

Create `res/manifest/manifest.rommanifest` with these complete contents:

```yaml
title: GTE Depth Cue Manual Example
hardware:
    - type: rom
```

#### Complete BLua near-plane cartridge

For project layout, building and checking this cartridge, use the [Build and inspect example cartridges](#build-and-inspect-gte-near-plane-clipping) development guide — “Build and inspect GTE near-plane clipping”. No earlier example cartridge is required.

Create `results.lua` as this complete const module. It keeps raw transfer records and retained command/display observations in explicit BSS.

```lua
module<const>

local gte<const> = require('cartlib/gx/gte')

struct gte_clip_result
	completed: word
	vblank_sequence: word
	before_vblank: word[2]
	after_vblank: word[2]
	system_origin: word
	system_size: word
	original: gte_vector[3]
	quad: gte_vector[4]
	screen: word[3][3]
	depth: word[3][4]
	projection_flags: word[3]
	projection_cycles: word[3]
	ir0: word[3]
	area: word[3]
	area_flags: word[3]
	probe_words: word[2][2]
end

bss result: gte_clip_result

return { result = result }
```

#### Declare the mapped ports

Create `cart.lua` by concatenating the following seven blocks in order. Later blocks continue the open stage loop; they are not separate modules.

```lua
module<entry>

local gte<const> = require('cartlib/gx/gte')
local state<const> = require('results')
local system_vram_region<const> = require('gpu/system_vram_region')
local result<const>: *gte_clip_result = state.result
local data<const>: *word[32] = gte.data
local control<const>: *word[32] = gte.control
local command<const>: *word = gte.command
local cycles<const>: *word = gte.cycles
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240
local pmode<const>: *word = 0x08010354
local framebuffer<const>: *word = 0x0801035c
local source<const>: *word = 0x08010360
local window<const>: *word = 0x08010364
local extent<const>: *word = 0x08010368
local pcrtc_csr<const>: *word = 0x080103d4

```

#### Supply the shared transform and projection

The input geometry is already in view space. Identity rotation and zero translation avoid transforming the constructed intersections a second time.

```lua
-- These positions are already in view space.
rodata transform: gte_transform = {
	rotation = {
		rows = { { 4096, 0, 0 }, { 0, 4096, 0 }, { 0, 0, 4096 } },
		pad = 0,
	},
	translation = { 0, 0, 0 },
}
rodata projection: gte_projection = {
	offset_x = 128 << 16,
	offset_y = 96 << 16,
	h = 256,
	cue_gain = 0,
	cue_offset = 0,
}
rodata quad_indices: u8[6] = { 0, 1, 2, 0, 2, 3 }
rodata probe_xy: word[2] = { 128 | (64 << 16), 128 | (112 << 16) }
local near_z<const> = 256

```

#### Configure the owned resources

The existing BIOS query reports the firmware reservation. This chosen two-surface footprint is not a general allocation policy.

```lua
function irq(flags)
	if (flags & 0x00000004) ~= 0 then
		result.vblank_sequence = result.vblank_sequence + 1
	end
	*irq_ack = flags & 0x00000004
end

-- Own GTE, ports, display, handler and both raw 256x192 surfaces.
result.system_origin, result.system_size = system_vram_region()
*irq_mask = 0
*pcrtc_csr = 0x00000200
*pmode = 0
*framebuffer = 0x000fa000
*source = 0
*window = 0x018252a8
*extent = 0x000bf3ff
*gp1 = 0x09000000
local transform_words<const>: *word = transform
for index = 0, sizeof(gte_transform) // 4 - 1 do
	control[gte.control_r11r12 + index] = transform_words[index]
end
local projection_words<const>: *word = projection
for index = 0, sizeof(gte_projection) // 4 - 1 do
	control[gte.control_ofx + index] = projection_words[index]
end
-- Seed only the old depth that will become SZ0 after the first RTPT.
data[gte.data_sz3] = 0
*gp0 = 0xe1000400
*gp0 = 0xe2000000
*gp0 = 0xe6000001

```

#### Construct the transfer records from numeric coordinates

The signed working values are numeric locals. Emit both the original triangle and D,B,C,E into typed transfer records; do not perform this interpolation by rereading their raw `i16` halves.

```lua
-- Compute in numeric locals; i16 storage reads are raw unsigned halves.
local ax<const> = 0
local ay<const> = -32
local az<const> = 128
local by<const> = 64
local bz<const> = 512
result.original[0].x = ax
result.original[0].y = ay
result.original[0].z = az
result.original[0].pad = 0
-- One known outside vertex, two inside: construct D,B,C,E in BSS.
for edge = 1, 2 do
	local bx = 96
	local slot = 0
	if edge == 2 then
		bx = -96
		slot = 3
	end
	result.original[edge].x = bx
	result.original[edge].y = by
	result.original[edge].z = bz
	result.original[edge].pad = 0
	local cut<const>: *gte_vector = &result.quad[slot]
	local numerator<const> = near_z - az
	local denominator<const> = bz - az
	cut.x = ax + (bx - ax) * numerator // denominator
	cut.y = ay + (by - ay) * numerator // denominator
	cut.z = near_z
	cut.pad = 0
	result.quad[edge].x = bx
	result.quad[edge].y = by
	result.quad[edge].z = bz
	result.quad[edge].pad = 0
end

```

#### Begin the two drawing stages

A single outer loop draws into raw rows 0–191, then 256–447. Keep the first framebuffer selected while preparing the second.

```lua
for stage = 0, 1 do
	local base_y<const> = stage << 8
	*irq_mask = 0
	*gp0 = 0xe3000000 | (base_y << 10)
	*gp0 = 0xe40000ff | ((base_y + 191) << 10)
	*gp0 = 0xe5000000 | (base_y << 11)
	*gp0 = 0x60000000
	*gp0 = 0
	*gp0 = 256 | (192 << 16)

	-- Stage 0 projects ABC; stage 1 projects DBC followed by DCE.
```

#### Project each triple and explicitly submit its triangle

Continue inside the same stage loop. Retain projection FLAG before NCLIP replaces it; neither the flag nor the area automatically rejects the submitted primitive.

```lua
	for face = 0, stage do
		local sample<const> = stage + face
		for vertex = 0, 2 do
			local input: *word = &result.original[vertex]
			if stage == 1 then
				input = &result.quad[quad_indices[face * 3 + vertex]]
			end
			data[vertex * 2] = input[0]
			data[vertex * 2 + 1] = input[1]
		end
		*command = gte.opcode_rtpt | gte.command_sf_shift_12
		result.projection_flags[sample] = control[gte.control_flag]
		result.projection_cycles[sample] = *cycles
		result.ir0[sample] = data[gte.data_ir0]
		for vertex = 0, 2 do
			result.screen[sample][vertex] = data[gte.data_sxy0 + vertex]
		end
		for index = 0, 3 do
			result.depth[sample][index] = data[gte.data_sz0 + index]
		end
		-- NCLIP replaces FLAG; it does not clip or reject anything.
		*command = gte.opcode_nclip
		result.area[sample] = data[gte.data_mac0]
		result.area_flags[sample] = control[gte.control_flag]
		*gp0 = 0x20e0a040
		for vertex = 0, 2 do
			*gp0 = result.screen[sample][vertex]
		end
	end

```

#### Read the raw probes and publish each image

Continue and close the same stage loop. Readback readiness, GPU idle and the fresh VBlank sequence are separate observations; neither surface is later reused.

```lua
	-- Absolute C0 positions do not inherit the drawing offset.
	for probe = 0, 1 do
		*gp0 = 0xc0000000
		*gp0 = probe_xy[probe] + (base_y << 16)
		*gp0 = 0x00010001
		while (*gp1 & 0x08000000) == 0 do
		end
		result.probe_words[stage][probe] = *gp0
	end
	while (*gp1 & 0x04000000) == 0 do
	end
	*framebuffer = 0x000fa000 | (stage << 6)
	*pmode = 0x0000ff21
	*irq_ack = 0x00000004
	local before<const> = result.vblank_sequence
	result.before_vblank[stage] = before
	*irq_mask = 0x00000004
	while result.vblank_sequence == before do
		halt_until_irq
	end
	result.after_vblank[stage] = result.vblank_sequence
	result.completed = stage + 1
	if stage == 0 then
		local hold<const> = result.vblank_sequence
		while result.vblank_sequence - hold < 2 do
			halt_until_irq
		end
	end
end
-- Neither displayed surface is ever reused by this finite example.
while true do
	halt_until_irq
end
```

Create `res/manifest/manifest.rommanifest` with the complete contents below:

```yaml
title: GTE Near Plane Manual Example
hardware:
    - type: rom
```

<a id="input-integration"></a>

## Input sampling ownership

The existing cartridge-library input tick system is a separate sampling owner: its construction arms a sample, and each frame update advances its input state and arms again. Do not run an independent raw sampling owner alongside it. Its player numbering is also separate: library player 1 selects raw pad 0. Library action mappings and edge state do not change the raw keyboard or pad bit layouts above.

<a id="apu-build"></a>

## APU build and listening procedure

#### APU

Use the [complete APU program](#worked-blua-program):

```sh
npm run build:toolchain:cart -- apu_manual --debug
npm run headless:test -- apu_manual tests/carts/apu_manual/apu_manual_assert.lua
```

Expect:

```text
[test] pcm_transfer_generator_and_badp: passed
```

This checks 16 transfer words and private-RAM roundtrip, separate DMA/APU completion, paused voice state with advancing sample clock, four end events, ended-bank clearing and no faults. It does not establish audible output. These commands were checked in an existing checkout, not fresh-platform certification.

##### Listen to the ordinary APU cartridge

The numeric headless check above runs assertions in a derived test cartridge; it does not demonstrate audible output. For ordinary ROM playback, build the existing `apu_manual` cart and non-debug browser player from the repository root:

```sh
npm run build:product:browser-player
npm run build:toolchain:cart -- apu_manual
```

Reuse the already-running `dist` server on port 8080; do not start a duplicate. Only when starting from scratch, run:

```sh
npm run serve:dist
```

Open **http://127.0.0.1:8080/index.html?rom=apu_manual.rom**. Keep `index.html` in the URL: the server's root redirect drops the query. Wait for “Press any key, button or touch screen to start...”, then **press and release a keyboard key**, or **finish a screen touch**. This non-debug startup awaits audio resume before creating the guest runtime.

Expect this short sequence:

| Phase | Expected sound |
| --- | --- |
| ROM PCM sine | Brief 440 Hz sine, brief silent pause, resumed sine, then fade-out. |
| Private-RAM PCM | The same PCM waveform, briefly played and faded after its RAM transfer exercise. |
| Square generator | Brief 440 Hz square-wave timbre, brighter than the sine, then fade-out. |
| Packed asset | The authored `tone.wav` one-shot, then silence as the cart halts. |

These are very short, once-per-boot events, not multi-second stages: the authored waits are 50 ms and fades 10 ms at the 44,100-frame/s machine output clock, not guaranteed wall-clock durations. Transfers and command processing can add gaps. Negative gain reverses polarity; it does not change pitch or promise an audible distinction.

Debug playback can produce sound, but debug startup runs the guest automatically without waiting for the audio-unlock interaction. A late click, key release, or touch end can therefore miss the initial short sequence. Use the non-debug gate above when checking all four phases. This route is not proof of playback on every browser, device, or speaker.

<a id="gte-build"></a>

## GTE build and result procedures

### Build and inspect GTE depth cue

Use the complete [two-stage GTE color program](#complete-blua-cartridge).
Put its two modules in `carts/gte_cue_manual/cart.lua` and
`carts/gte_cue_manual/results.lua`, and its manifest in
`carts/gte_cue_manual/res/manifest/manifest.rommanifest`. The supplied assertion
suite and capture timeline are in `tests/carts/gte_cue_manual/`; keep those files
present before building the debug cartridge. No earlier example cartridge is a
prerequisite. With the [checkout prerequisites](../docs/programming/getting-started.md#prerequisites), run from the
repository root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- gte_cue_manual --debug
npm run headless:test -- gte_cue_manual tests/carts/gte_cue_manual/gte_cue_manual_assert.lua
npm run headless:tooling -- --debug --ttl 5 --input-timeline tests/carts/gte_cue_manual/gte_cue_manual_demo.json gte_cue_manual
```

The cartridge build exports `dist/gte_cue_manual.debug.rom` and its matching
`dist/system/bmsx-bios.debug.rom`. The supplied integration case reports:

```text
[test] depth_cue_and_display_words: passed
```

That case checks all four depth IR0/RGB2/FLAG rows, all three NCS/NCCS
lighting/material rows, raw probes of both surfaces, retained first-image
probes, firmware exclusion and both fresh VBlank observations. The final command
separately runs the ordinary ROM and captures two native 256×192 images in
`tests/carts/gte_cue_manual/screenshots/`: `frame_00001.png` is the four-depth
comparison; `frame_00004.png` is unmodulated lighting, material A and material B.
Those selected frames are not fixed hardware-latency guarantees. One shared
setup produces both images, with the first still selected while drawing the
second elsewhere in local memory. Displayed GX16 RGB differs from retained GTE
eight-bit results; compare the calculation and display tables rather than
replacing one with the other. This route was checked in the working checkout,
not on every OS or a fresh SDK installation.

### Build and inspect GTE near-plane clipping

Use the complete [near-plane image program](#complete-blua-near-plane-cartridge).
Put its two modules in `carts/gte_clip_manual/cart.lua` and
`carts/gte_clip_manual/results.lua`, and its manifest in
`carts/gte_clip_manual/res/manifest/manifest.rommanifest`. Keep the supplied
assertion and timeline in `tests/carts/gte_clip_manual/` before the debug build.
No earlier example cartridge is needed. With the [checkout prerequisites](../docs/programming/getting-started.md#prerequisites),
run from the repository root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- gte_clip_manual --debug
npm run headless:test -- gte_clip_manual tests/carts/gte_clip_manual/gte_clip_manual_assert.lua
npm run headless:tooling -- --debug --ttl 5 --input-timeline tests/carts/gte_clip_manual/gte_clip_manual_demo.json gte_clip_manual
```

The build exports `dist/gte_clip_manual.debug.rom` and its matching
`dist/system/bmsx-bios.debug.rom`. The supplied case reports:

```text
[test] near_plane_geometry_and_display: passed
```

It checks the constructed raw D/B/C/E records, every retained SXY/SZ/FLAG/IR0
row, nominal RTPT CYCLES, separately saved NCLIP areas/flags, raw image probes,
firmware exclusion and both fresh VBlank observations. The last command
separately runs the ordinary ROM and saves two native 256×192 captures under
`tests/carts/gte_clip_manual/screenshots/`: `frame_00001.png` shows the unchanged
ABC triangle; `frame_00004.png` shows the constructed DBC/DCE trapezoid.

One setup supplies both pictures. The first remains selected while the second
is drawn into a separate raw surface, and neither is subsequently reused.
Projection FLAG does not automatically remove geometry; the example deliberately
submits ABC as well as the clipped triangles. The selected frame numbers are
observation checkpoints, not fixed hardware latency. Source numeric coordinates,
raw typed transfer records and displayed GX16 color are distinct. This route
was checked in the working checkout, not on every OS or a fresh SDK installation.

<a id="dispatch-and-clock"></a>

## Static model scenes

`component/static_model_component` declares a model asset and its scene as
placement data. `component/model_renderer_component` is the World visual that
owns a camera and draws the active Space's model instances together. A model
component is not a separate draw callback. Asset nodes retain their own
immutable node-to-model transforms; they do not become WorldObjects.

```lua
local model<const> = require('cartlib/component/static_model_component')
local camera<const> = require('cartlib/component/model_renderer_component')

prefab.define({def_id='ship',class={},spatial={family='3d',authority='affine'},
 components={model.factory({model_id='ship'})}})
prefab.define({def_id='camera',class={},spatial={family='3d',authority='affine'},
 components={camera.new}})
world:spawn('ship',{})
local view<const> = world:spawn('camera',{})
view.spatial:set_local_origin(0,0,8)
```

The chosen asset scene must be explicit as `scene_index` when the asset has no
default scene. An empty scene is valid; a mesh-only resource library is not
silently substituted for a scene. The renderer uses the authored static pose,
not animation playback. Placement is owner-world × attachment × presentation
× asset-node, retaining full affine coefficients, including reflection and
shear. Models expose `set_attachment_affine`, `set_attachment_origin`,
`set_presentation_affine`, `set_presentation_origin` and `set_model`.

This is an **opaque base-color unlit shader**, not glTF PBR shading. Metallic,
roughness, normals and emissive lighting are not evaluated. A chosen scene
requiring base-color textures, non-opaque alpha, vertex colors, morphing or skinning is
rejected at static-resource admission; other scenes and rich asset data remain
available. Missing material means opaque white.

Camera local −Z is forward and +Y is up. Projection defaults to the configured
World page dimensions, a focal length of half its width, a centered principal
point and a near distance of 0.1 model units. `set_projection(width,height,
focal_length,near,center_x,center_y)` changes that view. The infinite frustum
clips against the near plane and four sides before perspective division.
GP0 encoding rounds only the resulting screen positions. One stable,
far-to-near triangle order spans all instances; ties use retained component
identity and source order. This is painter ordering, not a depth buffer, and
does not resolve intersecting or cyclically overlapping polygons.

ROM geometry is shared, and projection, clipping and ordering use retained
numeric lanes rather than per-vertex or per-face Lua tables. Clean passes
reuse their packed triangles. New high-water working sets grow once; warm
frames reuse them. The command-list owner streams complete triangle packets
through its declared allocation before the GPU completion fence.

## Dispatcher and clock integration

These are library policies. A hardware-owning program can instead implement
its own vector and sample the raw system counter directly.

### IRQ dispatcher policy

The alternative `cartlib/irq` module installs that global IRQ function itself.
`register(source, handler)` records the callback and enables its MASK bit;
`unregister(source)` removes the callback and disables its MASK bit. Its
installed handler filters the delivered word with the current MASK, selects
one least-significant pending source at a time, acknowledges that controller
bit **before** calling `handler(source)`, and repeats for its local selection.
The callback still owns any source-local re-arming.

This traversal order is a software-dispatch policy, not controller source
priority. Because registration enables delivery, prepare the source's state
before registering it. Do not also install a different global `irq` handler
while using this module. The complete example below uses the direct route
and does not require that dispatcher.

### Clock sampling and schedule policy

For elapsed intervals, the existing `cartlib/clock` library provides `milliseconds()` and `elapsed_milliseconds(start, current)`. The former returns the raw `TIME_MS` word; the latter computes unsigned wrapping sample distance. That distance is meaningful only when the actual interval is shorter than one complete 2^32-millisecond period. A zero result is valid when both samples fall in the same millisecond. `os.difftime` is ordinary integer subtraction, not wrapping hardware-time arithmetic.

The existing clock library already performs the Q16 conversion when configuring tick intervals; its retained gameplay and frame deltas are schedule quanta, not live elapsed clocks.

### Clock-dependent program fragment

```lua
module<entry>

local state<const> = require('results')
local clock<const> = require('cartlib/clock')
local result<const>: *system_manual_result = state.result
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local time_ms<const>: *word = 0x08010228
local frame_ms_q16<const>: *word = 0x0801022c
local print_char<const>: *word = 0x08010230
local print_flush<const>: *word = 0x08010234
local cycles_per_frame<const>: *word = 0x08010238
local control<const>: *word = 0x0801034c
local status<const>: *word = 0x08010350
local fault_words<const>: *word = 0x08010428
```

### Clock-dependent program fragment

```lua

for index = 0, 3 do
	local sample<const>: *system_manual_sample = &result.samples[index]
	sample.before_ms = *time_ms
	while clock.elapsed_milliseconds(sample.before_ms, *time_ms) < 100 do
		halt_until_irq
	end
	sample.after_ms = *time_ms
	sample.elapsed_ms = clock.elapsed_milliseconds(sample.before_ms, sample.after_ms)
	sample.frame_ms_q16 = *frame_ms_q16
	sample.cycles_per_frame = *cycles_per_frame
	sample.status = *status
	result.completed_samples = index + 1
end
```

<a id="engineering-holds"></a>

## Open library and asset-pipeline issues

### RID01: resource-ID token boundary

- [ ] Resolve UTF-8 producer hashing versus codepoint hashing in
  `cartlib/rom_dir.lua`. The filename producer does not restrict IDs to ASCII.
  Exact paired-source locations are in the existing
  [cartridge facts](../docs/book3/facts/cartridge.md#rid01-withhold-unrestricted-id-lookup-acceptance).
  Hold our unrestricted lookup-API acceptance; do not turn this into a permanent
  hardware name restriction. Raw TOC spans and the existing ASCII examples are
  unaffected. No runtime fix is part of this documentation change.
