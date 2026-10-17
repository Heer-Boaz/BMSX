# GPU Drawing Engine

<a id="gpu-function"></a>
## Function and data flow

The GPU draws supplied screen-space polygons, lines and rectangles into GPU local
memory. It also fills, uploads, reads and copies raw local-memory images. Supplied
colors and texture coordinates determine the source pixels; drawing state controls
the drawing area, offsets, texturing, blending and stored mask bit.

Three-dimensional projection, lighting, near-plane clipping and depth-order
selection precede primitive submission. Triangle interpolation has no depth or
reciprocal-depth input. A quad is
two triangle operations, not a four-corner bilinear surface. The cartridge supplies
the intended draw order and retains any geometry results needed to construct it.

Stored pixels are not display output. PCRTC reads local memory using its selected
source layout, display windows and output settings. The choice of display storage
format does not change how GPU primitives address their raw destination words.

<a id="gpu-specifications"></a>
## Technical specifications

GPU programming words, local-memory words and command-cost ticks are different
units. A GP0 input word carries **32 bits**; a local-memory word stores **16 bits**.
Neither is a count of displayed pixels. Drawing, texture lookup and display
sampling share the same local memory.

| Resource or interface | Specification |
|---|---|
| Installed main RAM | 4 MiB, separate from GPU local memory |
| GPU local memory | 2 MiB: 1,048,576 sixteen-bit words; low byte first |
| GP0 — `0x0801023c` | Write command/input words; read GPUREAD |
| GP1 — `0x08010240` | Write control words; read GPUSTAT, not the last control word |
| GP0 input FIFO | 16 thirty-two-bit words |
| Separate DMA ingress | 16 thirty-two-bit words; not another 16 CPU FIFO slots |
| Ordinary programming access | Thirty-two-bit words, four-byte alignment |
| Input coordinates | Each supplied X and Y is signed eleven-bit: −1024…1023 |
| Drawing offset | Separate signed eleven-bit X and Y values |
| Input color | Independent unsigned eight-bit R, G and B components: 0–255 |
| Rendered color storage | R in bits 4:0, G in 9:5, B in 14:10; bit 15 stored separately |
| Installed CPU/system-cycle frequency | 33,868,800 Hz; approximately 29.526 ns per cycle |
| Command-cost conversion | Two command ticks per system cycle |

The input coordinate range is not a maximum display mode. Polygon vertices
receive the drawing offset as integer sums. Before triangle raster shifting,
a triangle is rejected if its inclusive span exceeds **1024 in X or 512 in Y**:
`maxX−minX+1 > 1024` or `maxY−minY+1 > 512`. The test applies separately to
each triangle, including each half of a quad.

Triangle color and texture-coordinate planes use supplied screen X/Y only.
Their inputs contain no Z, W, reciprocal depth, perspective correction or depth
comparison. Commands affect local memory in their supplied order; the GPU does
not sort polygons. Projection, lighting, near-plane clipping and depth ordering,
when required, must precede this drawing path.

**Issue cost and command completion.** An ordinary scalar word load or store,
including its displacement form, has a **two-system-cycle base cost**. Address
and value preparation, control flow and readiness waits are additional. A
word-sequence store instead charges two base cycles plus its word count divided
by four, rounded upward. These are charges for the actual issuing instruction,
not a transfer-bandwidth rating. The sequence advances the destination by four
bytes per word: starting at GP0 reaches GP1 next, not another GP0 stream word.

Accepting a GP0 word and completing an assembled command are separate events.
For a command with positive cost N ticks starting execution at cycle C:

```text
Completion deadline = C + (N/2 rounded upward)
```

Zero-cost work completes immediately. Queued execution continues from the prior
command's deadline, not from a later status-read time. CPU work can overlap
these intervals; summing every issue charge and every command interval does not
by itself give a complete workload budget. GP1 controls have no separate queued
raster-cost interval, and there is no GPU CYCLES register.

For a fill with rounded width 32 and height 4, the command cost is
`46 + (32/8 + 9)×4 = 98` ticks, or **49 system cycles**. A normalized
3×5 local-memory copy costs `2×3×5 = 30` ticks, or **15 cycles**. These
intervals begin at execution, not at preparation of the first packet word.
With the GPU IRQ request initially clear, an IRQ marker queued behind a fill
starting at cycle zero executes and raises its request at cycle 49; its own one-tick
interval completes at cycle 50. The IRQ request can therefore be set while the
GPU is not yet idle.

An image-upload or readback command's one-tick cost does **not** mean its whole
payload transfers in one cycle. Readback becomes pending at command execution
completion and becomes consumable only when ready; GPUSTAT bit 27 reports that
ready condition. Until then, GP0 reads return the retained GPUREAD value.
Neither command completion, idle status nor an IRQ marker acknowledges that a
new picture has reached the display latch.

**Access-width cautions.** Use complete word transfers for commands. An aligned
byte load runs the full GP0 read operation before returning its low byte; it is
not a byte-wise peek into a ready readback word. Byte stores and halfword IO
accesses fault. F32 uses one word's bit pattern; F64 accesses the word at A and
then A+4, stopping if the first faults. Thus an F64 access at GP0 reaches
**GP0 then GP1**, not two words of the GP0 stream, and is not an atomic GPU
transaction. Misaligned accesses fault before the corresponding device operation.

**Unspecified electrical ratings.** The system frequency and two-tick conversion
do not specify an independent GPU core/PLL clock, electrical IO or local-memory
bus clock or pin width, arbitration schedule, physical per-pixel fetch cost, or
guaranteed sustained command, pixel or byte rate. Coordinate and storage limits
are representable capacities, not rated maximum-resolution video modes.

<a id="gpu-programming-example"></a>
## Program a complete picture in BLua

This cartridge stores a sixteen-pixel texture and its fixed command stream in
ROM. Two BSS words retain the raw image-readback result. Typed whole-word views
supply scalar port accesses: each stream store addresses the same GP0 word,
while indexing advances through the source data.

The picture contains two enlarged copies of one 4×4 texture, a Gouraud triangle,
additive rectangles and protected overlapping rectangles. A small unscaled
textured rectangle demonstrates persistent page selection. A separate three-pixel
strip receives the actual readback result. The bottom strip displays sixteen
uploaded palette4 texels. No GTE command is needed: all positions
are already screen coordinates.

### Declare ports and authored data

The following listings are consecutive parts of one cartridge. GP0/GP1 are the
GPU ports listed in the specification table. PCRTC's CSR, framebuffer, source, extent and PMODE
formats are specified in the PCRTC chapter; they are not alternative GP1 controls.

```lua
module<entry>

local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240
local pmode<const>: *word = 0x08010354
local framebuffer<const>: *word = 0x0801035c
local source<const>: *word = 0x08010360
local display_extent<const>: *word = 0x08010368
local pcrtc_csr<const>: *word = 0x080103d4

-- Sixteen raw RGB555/mask words, packed by the compiler into cartridge ROM.
rodata texels: u16[4][4] = {
	{ 0x001f, 0x001f, 0x03e0, 0x03e0 },
	{ 0x001f, 0x001f, 0x03e0, 0x03e0 },
	{ 0x7c00, 0x7c00, 0x7fff, 0x7fff },
	{ 0x7c00, 0x7c00, 0x8000, 0x0000 },
}
```

### Author complete packets, not register-setting tables

The halfword array is a sixteen-pixel image. Its last row deliberately includes
both `8000H` and `0000H`: the former draws black; the latter leaves the background.
The compiler packs each adjacent pair into one word for the upload loop.

The packet array below contains **55 words**. Its first two packets are nine-word
textured quads. T0 supplies U/V with CLUT zero; direct16 ignores that palette.
T1 supplies page/depth fields `010AH`: X=10×64=640, Y=0, direct16. The persistent
update preserves the separately programmed draw-to-displayed-field bit. The
four-word textured rectangle after them supplies no new page.

Each quad maps byte U/V from 0 to 3 across its vertices. It demonstrates affine
magnification, not a new texture size, perspective correction or filtered sampling.
Raw RGB gain is ignored. The modulated quad halves red and preserves green;
its supplied blue gain saturates already-full-blue texels. The later six-word
triangle instead interleaves three colors with three positions and has no UV words.

```lua
-- Palette entry zero is red; entry three is transparent; entry four is black.
rodata palette_colors: u16[16] = {
	0x001f, 0x03e0, 0x7c00, 0x0000, 0x8000, 0x7fff, 0x03ff, 0x7fe0,
	0x7c1f, 0x4210, 0x0010, 0x0200, 0x4000, 0x0210, 0x4200, 0x4010,
}
rodata palette_indices: u16[4] = { 0x3210, 0x7654, 0xba98, 0xfedc }

-- These are complete GP0 packets, not an array of register values.
rodata drawing_commands: word[] = {
	-- Raw textured quad. T1 selects direct16, page X=640, page Y=0.
	0x2d808080,
	16 | (24 << 16), 0,
	80 | (24 << 16), 3 | (0x010a << 16),
	16 | (88 << 16), 3 << 8,
	80 | (88 << 16), 3 | (3 << 8),
	-- Modulated quad: halve red, preserve green; blue gain 1.5 saturates.
	0x2cc08040,
	96 | (24 << 16), 0,
	160 | (24 << 16), 3 | (0x010a << 16),
	96 | (88 << 16), 3 << 8,
	160 | (88 << 16), 3 | (3 << 8),
	-- No E1 here: this rectangle inherits the preceding polygon's T1 page.
	0x65000000, 24 | (112 << 16), 0, 4 | (4 << 16),
	-- A separate RGB-interpolated triangle; no texture words.
	0x300000ff, 176 | (24 << 16),
	0x0000ff00, 240 | (24 << 16),
	0x00ff0000, 208 | (88 << 16),
	-- Two opaque rectangles, then an additive rectangle crossing both.
	0x60402020, 16 | (128 << 16), 64 | (40 << 16),
	0x60204020, 80 | (128 << 16), 64 | (40 << 16),
	0xe1000420,
	0x62202080, 48 | (144 << 16), 64 | (24 << 16),
	-- Set+check: the first rectangle marks its pixels; the second protects them.
	0xe6000003,
	0x600080c0, 176 | (128 << 16), 32 | (32 << 16),
	0x60c08000, 192 | (144 << 16), 32 | (32 << 16),
	0xe6000000,
	-- Sixteen palette4 texels across the bottom strip. CLUT is (768,256).
	0x2d000000,
	16 | (176 << 16), (16 << 8) | (0x4030 << 16),
	240 | (176 << 16), 15 | (16 << 8) | (0x000b << 16),
	16 | (192 << 16), 16 << 8,
	240 | (192 << 16), 15 | (16 << 8),
}
```

The final quad uses palette4 page X=704,Y=0 and constant V=16. Its four
source halfwords hold sixteen four-bit indices, lowest nibble first: `3210H`
selects entries 0,1,2,3. The CLUT attribute `4030H` selects raw (768,256);
entry 0 is red, entry 3 is zero, and entry 4 is nonzero black. The palette and
indices are separate raw uploads, not a special palette-port operation.
Raw texturing ignores the quad's zero color field. The sixteen colors are
magnified across the bottom strip by interpolating U=0…15; this does not enlarge
the packed source or allocate sixteen-bit pixels for its indices.

### Keep returned words in mutable storage

The two BSS words hold results, not another copy of the ROM image. The interrupt
entry acknowledges delivered requests. GPU IRQ delivery is masked during drawing;
its request latch is observed explicitly later.

```lua
bss readback_words: word[2]

function irq(flags)
	*irq_ack = flags
end
```

### Establish the drawing and display domains

PCRTC CSR RESET establishes both PCRTC configuration and GPU stream/register
defaults; it does not initialize local-memory pixels. The Y-address gate is
explicitly closed, and E1–E6 establish
the drawing environment. The background fill covers only the 256×192 picture;
the texture's later upload initializes its separate source words.

The drawing area includes (0,0)…(255,191), with zero offset. E1=`0400H` sets
draw-to-displayed-field and disables dither. E6 clears destination check/force.
The picture's background RGB bytes `(8,16,24)` reduce to raw word `0C41H`.
PCRTC reading circuit 1 selects GX16 storage with a 1,024-word stride; PMODE
remains disabled while the GPU prepares this single, never-reused picture.

```lua
*irq_mask = 0
*pcrtc_csr = 0x00000200
*pmode = 0
*framebuffer = 0x000fa000
*source = 0
*display_extent = 0x000bf3ff
*gp1 = 0x09000000

-- Explicit drawing state; RESET does not clear local memory.
*gp0 = 0xe1000400
*gp0 = 0xe2000000
*gp0 = 0xe3000000
*gp0 = 0xe40000ff | (191 << 10)
*gp0 = 0xe5000000
*gp0 = 0xe6000000
*gp0 = 0x02181008
*gp0 = 0
*gp0 = 256 | (192 << 16)
```

### Upload and issue the stream through one port

A0 selects 4×4 raw pixels at `(640,0)`: exactly eight payload words follow its
three-word header. The readonly word view exposes the compiler's packed image.
Both loops write to `*gp0` every iteration; indexing applies to the source only.
The scalar-store admission mechanism supplies any necessary wait; DMA-ready
bit 28 is not its admission test. A CPU word-sequence store advances the
destination and must not replace these fixed-port stores.

```lua
-- A0 header followed by eight whole-word payload stores to the SAME port.
*gp0 = 0xa0000000
*gp0 = 640
*gp0 = 4 | (4 << 16)
local texture_words<const>: *word = texels
for index = 0, sizeof(u16[4][4]) // 4 - 1 do
	*gp0 = texture_words[index]
end
-- A palette is raw local-memory data, uploaded exactly like the direct image.
*gp0 = 0xa0000000
*gp0 = 768 | (256 << 16)
*gp0 = 16 | (1 << 16)
local palette_words<const>: *word = palette_colors
for index = 0, sizeof(u16[16]) // 4 - 1 do
	*gp0 = palette_words[index]
end
*gp0 = 0xa0000000
*gp0 = 704 | (16 << 16)
*gp0 = 4 | (1 << 16)
local index_words<const>: *word = palette_indices
for index = 0, sizeof(u16[4]) // 4 - 1 do
	*gp0 = index_words[index]
end
for index = 0, #drawing_commands - 1 do
	*gp0 = drawing_commands[index]
end
```

The direct image occupies eight payload words. The sixteen-entry palette
occupies another eight, and its four packed index halfwords occupy two. All
three uploads finish before their drawing packets. The final quad's T1 selects
palette4 rather than the preceding direct16 page; its T0 locates the uploaded
palette. A zero index therefore draws red, while index 3 leaves the background
because the **fetched palette word** is zero. Index 4 draws black from `8000H`.
No direct CPU local-memory aperture or palette upload helper is needed.

### Wait for readback readiness and consume its full count

The C0 request selects the first three texture pixels: red, red, green.
GPUSTAT bit 27—not bit 26—qualifies consumption. Once ready and without a DMA
reader owning the port, the two reads return `001F001FH` and `000003E0H`.
The final word's high half is zero and consuming it releases readback. The
preceding draw commands must reach this readback's ordered fence before its
result is supplied; readiness is not a fixed one-cycle transfer promise.

```lua
-- Three pixels produce two reads. The final read has a zero high half.
*gp0 = 0xc0000000
*gp0 = 640
*gp0 = 3 | (1 << 16)
while (*gp1 & 0x08000000) == 0 do
end
readback_words[0] = *gp0
readback_words[1] = *gp0
```

### Use the returned raw representation directly

Upload those two words into the three-pixel strip at `(16,112)`. There is no
conversion to RGB bytes or display pixels. The final high half is unused because
the destination area contains three pixels, not four. The following marker is a
new **whole** GP0 word, never a value hidden in that unused halfword.

```lua
-- Re-upload those exact words as a three-pixel witness at (16,112).
*gp0 = 0xa0000000
*gp0 = 16 | (112 << 16)
*gp0 = 3 | (1 << 16)
for index = 0, #readback_words - 1 do
	*gp0 = readback_words[index]
end
```

### Separate the marker, idle and display hand-off

The marker sets GPUSTAT bit 24 after earlier queued commands. GP1(02h) clears
that GPU latch; the controller acknowledgement clears pending GPU IRQ bit 6.
Waiting for bit 26 is separate because the marker can be set before its own
one-tick command interval completes. Only then does PMODE enable reading circuit 1. The later VBlank publication, not either GPU status bit, accepts the picture.
The cartridge subsequently acknowledges VBlank requests and sleeps without
modifying the displayed pixels.

```lua
-- IRQ is an in-order marker, not an idle or display acknowledgement.
*gp0 = 0x1f000000
while (*gp1 & 0x01000000) == 0 do
end
*gp1 = 0x02000000
*irq_ack = 0x00000040
while (*gp1 & 0x04000000) == 0 do
end
*pmode = 0x0000ff21
*irq_ack = 0xffffffff
*irq_mask = 0x00000004
while true do
	halt_until_irq
end
```

<div class="keep-together">

### Check the result in raw words

These expected samples distinguish the controls without relying on display-color
expansion. Mask bits remain part of each stored word.

| Raw position | Expected word | What it distinguishes |
|---|---|---|
| (16,24) | `001FH` | Raw full red |
| (96,24) | `000FH` | Red reduced by gain 64 |
| (138,68) | `7FEFH` | Modulated white: red reduced, green unchanged, blue saturated |
| (24,112) | `001FH` | Following rectangle inherits polygon T1 page |
| (26,115) | `8000H` | Nonzero black texel writes its bit 15 |
| (27,115) | `0C41H` | Exact-zero texel leaves the initialized background |
| (50,150) | `3114H` | Additive rectangle over first destination color |
| (90,150) | `2194H` | Same source over a different destination color |
| (200,150) | `8218H` | A later checked draw preserves the first rectangle's marked pixel |
| (220,165) | `E200H` | Second rectangle writes and marks an unprotected pixel |
| (16,180) | `001FH` | Palette index 0 fetches a nonzero red word |
| (31,180) | `03E0H` | Next packed nibble selects palette entry 1 |
| (46,180) | `7C00H` | Palette entry 2 is blue |
| (61,180) | `0C41H` | Index 3 fetches zero and preserves the background |
| (76,180) | `8000H` | Index 4 fetches nonzero black |
| (91,180) | `7FFFH` | Index 5 fetches white |

</div>

This is a static picture, not a frame-loop template. The PCRTC chapter specifies
the VBlank edge that makes programmed display settings visible; GPU idle and the
IRQ marker do not acknowledge that publication. Packet preparation and issue
costs also remain separate from queued command deadlines; the command-cost
reference does not establish a sustained frame rate for arbitrary cartridge code.

<div class="keep-together">

### GPU output plate

This plate brings several packet types into one 256 × 192 image. The two large upper quads sample the same 4 × 4 direct-colour texture: the left uses raw texture colour, while the middle applies the packet's RGB colour. Their red and white areas show the contrast. The bottom strip instead reads four-bit indices and looks up their colours in a CLUT; index zero is red here, not transparent.

![Full 256 by 192 GPU output plate](figures/gpu-output-materials.png)

**GPU output plate.** Direct and indexed textures, an untextured RGB-gradient triangle, a blending overlay, and a mask-protected overlap share a dark background. The tiny marks near the left edge are the readback/upload witness and the unscaled 4 × 4 texture, not missing image detail. The complete image is shown without a crop or added region labels.

</div>

The black texture areas and the background-coloured gaps are deliberately different. The source word `0x8000` supplies black and retains bit 15 in VRAM; a sampled `0x0000` leaves the background unchanged. This distinction appears in both the direct-colour texture and the indexed strip, whose entries 4 and 3 contain those words respectively.

The lower-left overlay selects semi-transparency with background-plus-foreground blending. At the lower right, set-mask and check-mask are enabled together: the first rectangle sets destination bit 15, so the second cannot replace it in their overlap. These are different effects; the protected overlap is not a blend.

<div class="keep-together">

**Nine-region legend.** Positions and sizes below are packet coordinates, not a definition of raster edge coverage. The picture column describes the visible regions. The final column records selected raw VRAM readback words, separately from the image's displayed colour components.

| Packet location | Picture and packet interpretation | Selected VRAM readback |
|---|---|---|
| Background: fill at `(0,0)`, `256 × 192` | Dark field and margins; fill header `0x02181008`. | Background visible through the upper-left texture at `(78,84)` is `0x0c41`. |
| Quad: `(16,24)`, `(80,24)`, `(16,88)`, `(80,88)` | Raw red/green/blue/white texture, plus black and unchanged-background areas. Header `0x2d808080`; UV `(0,0)` to `(3,3)`; T1 `0x010a` selects direct16 at `(640,0)`. | `(16,24)` = `0x001f`; black at `(59,84)` = `0x8000`. |
| Quad: `(96,24)`, `(160,24)`, `(96,88)`, `(160,88)` | Modulated counterpart: darker red and tinted white. Header `0x2cc08040`; same UVs and T1 as the raw quad. | `(96,24)` = `0x000f`; `(140,24)` = `0x03e0`; `(138,68)` = `0x7fef`. |
| Rectangle: `(24,112)`, `4 × 4` | Small raw view of the same direct-colour image; header `0x65000000`, UV `(0,0)`. | `(26,114)` = `0x7fff`; `(26,115)` = `0x8000`; `(27,115)` = `0x0c41`. |

</div>

<div class="keep-together">

**Nine-region legend, continued.** Packet positions, visible results and selected raw words remain separate.

| Packet location | Picture and packet interpretation | Selected VRAM readback |
|---|---|---|
| Triangle: `(176,24)`, `(240,24)`, `(208,88)` | Separate untextured triangle with red, green and blue vertex colours. | No triangle pixel word is listed. |
| Bases: `(16,128)` and `(80,128)`, each `64 × 40`; overlay: `(48,144)`, `64 × 24` | The overlay crosses both bases. Header `0x62202080` with E1 `0xe1000420` selects background-plus-foreground blending. | Intersections: `(50,150)` = `0x3114`; `(90,150)` = `0x2194`. |
| Rectangles: `(176,128)` and `(192,144)`, each `32 × 32` | Mustard/cyan pair with E6 `0xe6000003`: the first rectangle remains in the protected overlap. E6 then returns to `0xe6000000`. | Overlap `(200,150)` = `0x8218`; second-only `(220,165)` = `0xe200`. Both retain bit 15. |
| Strip: `(16,176)`, `(240,176)`, `(16,192)`, `(240,192)` | Raw indexed texture, U `0..15`, V `16`; T1 `0x000b` selects palette4 at page `(704,0)`. CLUT `0x4030` selects `(768,256)`. Indices come from `0x3210`, `0x7654`, `0xba98`, `0xfedc`, low nibble first. | Red `(16,180)` = `0x001f`; unchanged background `(61,180)` = `0x0c41`; black `(76,180)` = `0x8000`; white `(91,180)` = `0x7fff`. |
| Witness: `(16,112)`, `3 × 1` | Three pixels read from `(640,0)` and uploaded at this destination. | The three-pixel row reads as two GPUREAD words: `0x001f001f`, then `0x000003e0`. |

</div>

<a id="gpu-ports-status"></a>
## GP0, GPUREAD, GP1 and GPUSTAT

The GPU has two thirty-two-bit programming ports. Their read and write meanings
are different; neither address is an ordinary read/write register variable.

| Address | Write operation | Read operation | Full-reset read at beam epoch zero |
|---|---|---|---|
| `0x0801023c` | GP0 command or payload word | GPUREAD latch or next permitted ready readback word | `0x00000000` |
| `0x08010240` | GP1 control word | GPUSTAT | `0x14922000` |

Writing GP0 does not make a following read return that command word. Writing at
the GPUSTAT address sends a GP1 control; it does not assign a status-bit mask.
The reset status above includes the reset display-mode fields. It is the value
read at the stated epoch, not a promise that beam-derived bits remain constant.

### Access and ordering

Use aligned word operations for normal programming. Ordinary scalar word loads
and stores, including their displacement forms, have a two-system-cycle base
cost; preparation, control flow and a blocked store's wait/retry are separate.

| Access | Port effect |
|---|---|
| Word or U32 | Four-byte aligned; one complete thirty-two-bit port operation |
| U8 load | Only at a word-aligned IO address; perform the full word read, then return its low byte |
| U8 store; U16 load/store | Fault rather than partially access the port |
| F32 | Four-byte aligned; one word's bit pattern |
| F64 | Four-byte aligned; low word at A, then high word at A+4; a first-word fault prevents the second operation |

A byte read is not a peek into one byte of GPUREAD: it can consume the same
complete readback word as a word load. Misaligned word/F32/F64 accesses and odd
halfword accesses are rejected before a GPU operation occurs.

An F64 instruction is still **one CPU instruction**, but its two ordered word
operations are not a paired GPU register transaction. At GP0 they address
**GP0 then GP1**, not two GP0 stream words. An F64 store checks admission for its
first address only; it does not reserve both ports. Do not infer a sixty-four-bit
GPU command or atomic GP0/GP1 update from the CPU instruction boundary.

A CPU word-sequence store also advances the destination by four bytes for each
word. Starting it at GP0 therefore reaches GP1 next; it is not a burst of
repeated writes to the GP0 stream port.

### GPUSTAT fields

A GPUSTAT read first synchronizes already-due GPU command completions, then
updates beam-derived fields and recomputes command/DMA conditions. Stored
configuration readback, a retained request latch and current readiness are thus
parts of the same returned word, not interchangeable kinds of completion.

<table>
<thead><tr><th>Bits</th><th>Field</th><th>Value and producer</th></tr></thead>
<tbody>
<tr><td>31</td><td>Displayed-line parity</td><td>Beam-derived; calculation below. Not command readiness.</td></tr>
<tr><td>30:29</td><td>DMA direction</td><td>GP1 direction low two bits: 0 off, 1 FIFO, 2 CPU→GP0, 3 GPUREAD→CPU.</td></tr>
<tr><td>28</td><td>DMA packet acceptance</td><td>The packet-state test below; not a general CPU-store-ready bit.</td></tr>
<tr><td>27</td><td>Readback ready</td><td>One exactly when a readback stream is READY, not merely when its header has been accepted.</td></tr>
<tr><td>26</td><td>Idle</td><td>One only under all idle conditions below.</td></tr>
<tr><td>25</td><td>DMA request</td><td>Direction 0: zero. Direction 1: DMA ingress empty and GP0 FIFO has room. Direction 2: bit 28. Direction 3: bit 27. A system ingress stop suppresses the write-side requests for directions 1 and 2.</td></tr>
<tr><td>24</td><td>GPU interrupt request</td><td>Latched by GP0(1Fh); GP1(02h) clears this GPU request latch.</td></tr>
<tr><td>23</td><td>Display disabled</td><td>GP1 display-disable low bit; one means disabled.</td></tr>
<tr><td>22</td><td>Vertical-interlace mode</td><td>GP1 display-mode bit 5.</td></tr>
<tr><td>21</td><td>24-bit display-color mode</td><td>GP1 display-mode bit 4.</td></tr>
<tr><td>20</td><td>PAL-mode flag</td><td>GP1 display-mode bit 3.</td></tr>
<tr><td>19</td><td>Vertical-resolution mode</td><td>GP1 display-mode bit 2.</td></tr>
<tr><td>18:17</td><td>Horizontal-resolution mode 1</td><td>GP1 display-mode bits 1:0.</td></tr>
<tr><td>16</td><td>Horizontal-resolution mode 2</td><td>GP1 display-mode bit 6.</td></tr>
<tr><td>15</td><td>Texture-page Y high</td><td>GP0 draw-mode bit 11, moved here rather than copied to bit 11.</td></tr>
<tr><td>14</td><td>Reverse mask</td><td>Cleared by a display-mode update. Retained display-mode bit 7 is not mapped here and specifies no reverse-image action.</td></tr>
<tr><td>13</td><td>Interlaced-field flag</td><td>One if GPU vertical-interlace mode is clear or the PCRTC field is zero; otherwise zero.</td></tr>
<tr><td>12</td><td>Destination-mask check</td><td>Stored mask-mode bit 1.</td></tr>
<tr><td>11</td><td>Set output mask</td><td>Stored mask-mode bit 0.</td></tr>
<tr><td>10:0</td><td>Draw-mode readback</td><td>Stored GP0 draw-mode bits 10:0, without re-encoding.</td></tr>
</tbody>
</table>

The GP1 mode fields are GPU register readback, not PCRTC beam-clock selectors.
For bit 31, use the decoded display-start Y and the current PCRTC field. When
both GPU vertical-resolution and vertical-interlace bits are set, its parity is
`(displayStartY + displayedField) AND 1`, where displayedField is zero during
VBlank and otherwise the current field. In other modes it is
`(displayStartY + integer-quotient(currentHalfLine,2)) AND 1`.
If the beam is stopped, bits 13 and 31 retain their existing values.

### Idle, DMA acceptance and CPU admission are different tests

**Bit 26** is one only when readback is idle, no command-completion deadline is
pending, both input FIFOs are empty, and no fixed-packet assembly, image-upload
payload or open polyline remains. Retained completed commands awaiting
presentation do not prevent this idle indication. It does not acknowledge a
new displayed picture.

**Bit 28** first requires idle readback, no system ingress stop and empty DMA
ingress. After those requirements:

- During an image-upload payload, it is one when the GP0 FIFO has room.
- During a polyline payload, it is zero.
- With no partial packet and no FIFO words, it is one.
- Otherwise it is one only for a nonpolygon, nonline packet with fewer
  accumulated words than its target length.

**A direct CPU GP0 word store** instead requires no system ingress stop, empty
DMA ingress, a physical GP0 FIFO count below sixteen, and no DMA ownership of
the GP0 write port. It need not wait for GPU idle or readback completion if a
word can still be admitted. A polygon or line prefix can therefore clear bit 28
while a CPU word store remains admissible. Do not substitute bit 28 for this
store-admission protocol.

The scalar CPU store checks admission before writing. If blocked, it waits and
retries; no command word has yet been accepted. GP1's store-admission gate is
the system supervisor-quiesce condition, not GP0 busy status. A full GP0 FIFO,
ordinary command execution or an active readback does not by itself block GP1.

### GPUREAD and status do not return the same result

GPUREAD retains the most recent info-query result or consumed readback word.
An info query that produces a result updates this same latch; it does not make
the query result appear at the GP1 read address.

| State at a CPU read | GP0 result and side effect | GP1 result |
|---|---|---|
| No READY readback | Existing GPUREAD value, including a retained query result; no stream advance | GPUSTAT with bit 27 clear |
| READY, and DMA does not own GP0's read port | Consume the next complete readback word and replace GPUREAD | GPUSTAT; bit 27 indicates readiness, not the data word |
| READY, but DMA owns GP0's read port | Return the existing GPUREAD latch without consuming the stream | GPUSTAT may still have bit 27 set |

A permitted read packs the first sixteen-bit pixel in the low half and the next
in the high half. An odd final pixel has a zero high half. Consuming the final
word returns readback to idle and allows queued command processing to resume;
that is not a guarantee that the whole GPU immediately becomes idle. The next
permitted READY read replaces any intervening query result with image data.

<div class="keep-together">

### Reset and display visibility

The other programmed defaults associated with full GPU reset are:

| State | Raw default |
|---|---|
| Draw mode, texture window, drawing bounds, drawing offset, mask mode | Zero |
| Display start | Zero |
| Display mode | `0x00000009` |
| Horizontal display range | `0x00c60260` |
| Vertical display range | `0x00044c23` |
| VRAM Y-address extension | Zero |
| DMA direction; GPU interrupt-request latch | Zero |

</div>

These are stored control values, not additional directly addressed ports.
**GP1(00h) is not a full device reset:** it restores the GPU control defaults
above except that it preserves GPUREAD and the VRAM Y-extension latch. It does
not initialize local memory or reset PCRTC. Writing a zero GP1 word is therefore
not a promise to erase every retained result.

Accepted GP1 changes appear immediately in programmed GPU state after due
command completions have synchronized. Presented display/status/start/range
and Y-extension values are copied at VBlank presentation instead of on every
control write. Immediate GPUSTAT readback proves programmed state, not
presentation-latch completion. PCRTC's separately programmed reading circuits,
windows, timing and displayed latch remain a distinct interface.

<a id="gpu-gp1-controls"></a>
## GP1 control commands

Write each control as one aligned word to **GP1, `0x08010240`**. A read from
that address returns GPUSTAT, not the control word. GP1 is separate from the GP0
packet stream: a control is not inserted between a GP0 packet's operands.

<table>
<thead><tr><th>Bits</th><th>Encoding</th></tr></thead>
<tbody>
<tr><td>31:24</td><td>Complete eight-bit opcode</td></tr>
<tr><td>23:0</td><td>Payload; each command below states which bits it consumes</td></tr>
</tbody>
</table>

The word is `(opcode << 24) OR (payload AND 0x00ffffff)`. Decode uses all eight
opcode bits, not the low six. A payload bit outside a command's mask is ignored
unless explicitly described as retained. An accepted GP1 write first synchronizes
already-due GPU work, then applies its control to programmed state. It does not
join the GP0 FIFO or acquire a separate queued raster-completion interval.

An ordinary scalar word store has a two-system-cycle base cost, separate from
instruction preparation and any admission wait. GP0 busy status does not by
itself prevent a GP1 store: GP1 admission is the system supervisor-quiesce gate.
The reset and clear controls can therefore be issued while GP0 has an incomplete
stream; they do not wait for idle.

<div class="keep-together">

### GP1(00h) — reset GPU command and register state

**Word:** `0x00000000`; all payload bits are ignored.

Perform the GP0 stream clear described under GP1(01h), then restore these GPU
register defaults:

| Programmed state | Reset value |
|---|---|
| Draw mode, texture window, drawing-area corners, drawing offset, mask mode | Zero |
| Display start | Zero |
| Display mode | `0x09` |
| Horizontal display range | `0x00c60260` |
| Vertical display range | `0x00044c23` |
| Display-disabled latch | One |
| DMA direction; GPU interrupt-request latch | Zero |

</div>

This is **not a full machine or display reset**. It preserves GPUREAD and the
VRAM Y-address-extension latch, does not initialize local memory, and does not
reset PCRTC registers or its beam timing. It does not acknowledge the system
IRQ controller's pending GPU bit. A later GPUSTAT read is recomputed from these
control values and current beam/command conditions; do not substitute a fixed
status constant for that read.

<div class="keep-together">

### GP1(01h) — clear the GP0 stream

**Word:** `0x01000000`; all payload bits are ignored.

Clear the GP0 FIFO, separate DMA ingress FIFO, incomplete fixed-packet/image
header and polyline assembly, and cancel the pending command deadline. Drawing,
display and DMA-direction registers are not reset. Neither GPUSTAT's interrupt
request latch nor the system IRQ pending latch is acknowledged.

</div>

A clear is **not a rollback of every previously accepted operation**. An accepted
pending raster/upload target is completed where present. If an A0 upload has
already consumed at least one payload word, its accepted partial payload is
flushed; a header-only upload is discarded. The unaccepted remainder is not
manufactured. Do not resume that abandoned image payload as though its header
were still active: subsequent GP0 words begin a new stream.

Readback cancellation depends on its phase:

| Readback boundary | Clear effect |
|---|---|
| C0 has not activated | Remove an unexecuted C0 at the executed-command prefix boundary |
| Readback pending | Remove C0 and following retained commands; preserve the prior command prefix |
| Readback submitted or READY | Clear retained command state and reset the readback stream |

Thus GP1(01h) can abandon a readback barrier; it is not equivalent to reading
and consuming its remaining image words. Choose GP1(00h) instead only when the
GPU register defaults are also wanted.

<div class="keep-together">

### GP1(02h) — acknowledge the GPU request latch

**Word:** `0x02000000`; all payload bits are ignored.

Clear **GPUSTAT bit 24**. This does not clear the independent GPU pending bit
in the system interrupt controller. The in-order GP0(1Fh) marker sets bit 24 and
raises `IRQ_GPU`, bit 6 (`0x00000040`), only when the GPU request latch was clear;
markers received while it remains set do not raise a fresh request. A complete
acknowledgement therefore services the GPU latch with this command and the
controller latch through its own acknowledgement register. This command is not
an idle, VBlank or displayed-picture acknowledgement. Becoming idle does not itself
raise `IRQ_GPU`.

</div>

<div class="keep-together">

### GP1(03h) — set display-disable state

**Word:** `0x03000000 OR d`; **payload mask:** `0x000001`.

| d | Programmed GPU display state | GPUSTAT bit 23 |
|---|---|---|
| 0 | Enabled | 0 |
| 1 | Disabled | 1 |

</div>

All other payload bits are ignored. This controls the GPU display-disabled
latch, not PCRTC's circuit enables or timing registerfiles. Its immediate status
readback does not prove that a new displayed presentation has latched.

<div class="keep-together">

### GP1(04h) — select DMA direction and request source

**Word:** `0x04000000 OR direction`; **payload mask:** `0x000003`.

| Direction | Selection | GPUSTAT bit 25, DMA request |
|---|---|---|
| 0 | Off | Zero |
| 1 | FIFO | DMA ingress empty and GP0 FIFO has room |
| 2 | CPU→GP0 | GPUSTAT bit 28, DMA packet acceptance |
| 3 | GPUREAD→CPU | GPUSTAT bit 27, readback READY |

</div>

GPUSTAT bits 30:29 return the selected direction. A system ingress stop
suppresses the write-side requests for directions 1 and 2. Entering direction 3
enables readback DMA request generation; leaving it disables that generation.
The command selects GPU-side direction/request behavior only: it does not
program a DMA channel's addresses or count, start a channel transfer, or grant
a CPU read ownership of a DMA-owned GP0 read port. In particular, direction 2's
request source is not a general CPU-store-ready predicate.

<div class="keep-together">

### GP1(05h) — set the GPU display-start word

**Word:** `0x05000000 OR start`; **payload mask:** `0x0ffffe`.

The retained word is `start AND 0x000ffffe`: bit 0 is discarded. Decode it as

- source X = `retained AND 0x3ff`, an even raw-word X address;
- source Y = `(retained >> 10) AND Ymask`, where GP1(09h) selects `Ymask` as
  `0x1ff` or `0x3ff`.

</div>

This is GPU display-start state. It neither writes PCRTC's DISPFB/DISPLAY
registers nor restarts the beam. The stored high Y bit remains available when
the Y gate is closed; changing the gate changes its decoded address rather than
requiring that the stored start word be rewritten.

For example, `0x05ffffff` retains `0x000ffffe`: X is 1022, and Y is 511 with the
nine-bit gate or 1023 with the ten-bit gate. This is address decoding, not a
promise that the selected start and a particular display window form a useful
picture.

<div class="keep-together">

### GP1(06h) — retain horizontal-display-range state

**Word:** `0x06000000 OR range`; **payload mask:** `0xffffff`.

Retain all twenty-four payload bits as the GPU horizontal-display-range word.
For example, `0x06ffffff` retains `0x00ffffff`. These are GPU control values,
not writes to PCRTC's horizontal synchronization or reading-window registers;
this command does not establish a physical pixel clock or beam interval.

</div>

<div class="keep-together">

### GP1(07h) — set vertical-display-range state

**Word:** `0x07000000 OR range`; **payload mask:** `0x0fffff`.

| Retained bits | Field |
|---|---|
| 9:0 | Range start |
| 19:10 | Range end |

</div>

The retained word is `range AND 0x000fffff`; payload bits 23:20 are ignored.
Start and end are stored without ordering validation: equal or reversed values
are not silently replaced by a preferred range. This is not a write to PCRTC's
vertical timing or DISPLAY window. `0x07ffffff` therefore stores `0x000fffff`,
with both ten-bit fields equal to 1023, rather than selecting a maximum valid
monitor mode.

<div class="keep-together">

### GP1(08h) — set GPU display-mode fields

**Word:** `0x08000000 OR mode`; **payload mask:** `0x0000ff`.

All eight mode bits are retained. Their GPUSTAT mapping is:

<table>
<thead><tr><th>Mode bits</th><th>Field</th><th>GPUSTAT destination</th></tr></thead>
<tbody>
<tr><td>1:0</td><td>Horizontal-resolution mode 1</td><td>18:17</td></tr>
<tr><td>2</td><td>Vertical-resolution mode</td><td>19</td></tr>
<tr><td>3</td><td>PAL-mode flag</td><td>20</td></tr>
<tr><td>4</td><td>24-bit display-color mode</td><td>21</td></tr>
<tr><td>5</td><td>Vertical-interlace mode</td><td>22</td></tr>
<tr><td>6</td><td>Horizontal-resolution mode 2</td><td>16</td></tr>
<tr><td>7</td><td>Retained raw bit</td><td>None; no reverse-image action</td></tr>
</tbody>
</table>

</div>

A mode update clears GPUSTAT's bit-14 reverse mask; retained mode bit 7 is not
copied there. For example, `0x08ffffff` retains mode `0xff`, sets GPUSTAT bits
22:16 to `0x7f`, and leaves bit 14 clear. Do not reinterpret that raw high bit as
a horizontal-reversal command.

These GPU mode/status fields do not program PCRTC's clock, synchronization,
reading-circuit layout or display window. The vertical-resolution/interlace
flags also participate in the beam-derived GPUSTAT fields described in the
status reference; they are not command-completion flags.

<div class="keep-together">

### GP1(09h) — select the VRAM Y-address gate

**Word:** `0x09000000 OR extension`; **payload mask:** `0x000001`.

| Extension | Decoded Y bits | Ymask |
|---|---|---|
| 0 | Nine | `0x1ff` |
| 1 | Ten | `0x3ff` |

</div>

This selects address interpretation; it does not resize the installed local
memory. It is a different latch from GP0 draw-mode's texture-page-Y-high bit.
GP1(00h) preserves it; a full device reset clears it. Draw commands retain the
Y-extension value when emitted, so a later gate change does not retroactively
reinterpret already emitted drawing operands.

### Opcode boundaries and display visibility

Opcodes `0x10`–`0x1f` are info-query aliases, not additional controls in this
catalog; the payload's low four bits select the query. Other eight-bit opcodes
have no selected control action and do not raise an unknown-opcode exception.
An opcode whose low six bits resemble a listed command does not alias it.

GP1 control changes are visible immediately in programmed GPU state after due
work synchronizes. Corresponding presented display/status/start/range and
Y-extension values are copied at VBlank presentation, not by each GP1 write.
GPUSTAT readback, an IRQ marker and GPU idle therefore do not acknowledge a
newly displayed picture. PCRTC remains the separate interface for the actual
reading circuits, windows and beam timing.

<a id="gpu-info-queries"></a>
## Query drawing state through GPUREAD

Write an information query to **GP1**, then obtain its result through **GP0/GPUREAD**. Reading GP1 instead returns GPUSTAT, not the query answer. All sixteen GP1 opcodes `10H–1FH` select the same query operation. The **payload's low four bits**, not the opcode's low four bits, select the requested result; payload bits 23:4 are ignored.

For example, `10000002H` and `1F000002H` both request selector `02H`. So does `1F345672H`: its opcode is `1FH`, but its selector is `2`. Changing the query opcode within that range does not change which register is requested.

| Payload selector | Value placed in GPUREAD |
|---|---|
| `02H` | Stored texture-window word, low 20 bits; mask `000FFFFFH` |
| `03H` | Stored drawing-area top-left word, low 20 bits; mask `000FFFFFH` |
| `04H` | Stored drawing-area bottom-right word, low 20 bits; mask `000FFFFFH` |
| `05H` | Stored drawing-offset word, low 22 bits; mask `003FFFFFH` |
| `07H` | Constant `00000002H` |
| `08H` | Constant `00000000H` |
| `00H`,`01H`,`06H`,`09H–0FH` | Preserve the previous GPUREAD latch |

The register answers are **raw stored words**, not expanded texture-window masks, separately sign-extended offset components or a displayed-picture snapshot. A supported query updates the shared GPUREAD latch immediately after already-due work synchronizes; it does not build a queue of answers. In particular, selector `00H` does not reset the GPU, and selector `01H` does not clear its stream: within a query they are unsupported selectors and leave the latch unchanged. An unsupported selector does not force zero or raise a query exception. Conversely, selector `08H` deliberately writes zero.

GPUREAD also carries image-readback data. With no READY readback, a GP0 read returns the current latch. With a READY stream, a permitted read instead consumes the next packed image word and **replaces** that latch. Issuing a query does not consume, cancel or reserve the readback stream, and does not make its answer take priority over image data.

Consider this sequence. Initially no readback is READY, and the stored texture-window word is `00010C62H`. Later, an already-requested readback becomes READY with three raw pixel words `001FH,03E0H,7C00H`. Throughout this example no DMA owns the GP0 read port, and no subsequent readback is queued:

| Action before the CPU's GP0 word read | Latch just after query | GP0 read returns | READY after read |
|---|---|---|---|
| Write GP1 `1F345672H` | `00010C62H` | `00010C62H` | 0 |
| Write GP1 `10000006H` | Unchanged | `00010C62H` | 0 |
| Readback becomes READY; write GP1 `10000007H` | `00000002H` | `03E0001FH` | 1 |
| No further query; read next word | — | `00007C00H` | 0 |
| No new query or readback; read again | — | `00007C00H` | 0 |

The third read returns two pixels, low halfword first, rather than the freshly queried constant. The next word has zero in its unused high half because only one pixel remains. Consuming that last word returns readback to idle and allows queued GP0 processing to resume. The final read then repeats the last GPUREAD value; it does not manufacture another pixel.

Ownership is independent of READY. If DMA owns GP0's read port, a CPU read returns the current latch **without consuming** a ready image word; DMA reads can consume that stream. A query neither grants CPU ownership nor protects its answer from a later permitted read. GPUSTAT bit 27 reports READY, not a guarantee that an arbitrary CPU read will return a query answer. Use word reads: a byte read still invokes the full callback and can consume an entire packed image word.

These queries report programmed drawing state. They do not acknowledge VBlank presentation or prove that a newly displayed picture has latched. Keep state inspection, image-data consumption and display acknowledgement separate.

<a id="gpu-ingress-ownership"></a>
## Hand a GP0 stream between CPU and DMA

The [GP0, GPUREAD, GP1 and GPUSTAT reference](#gpu-ports-status) gives the complete
CPU admission tests, status fields and access-width rules. The additional DMA
boundary matters even when both producers supply the same sequence of GP0 words.

### A stalled CPU store is not an admitted DMA block

A direct scalar CPU store checks admission before writing. If blocked, that
instruction waits and retries; its word has not entered the stream. A DMA
transfer owning GP0's write port excludes direct CPU writes even if the physical
GP0 FIFO has room. Do not use the FIFO's free space or GPUSTAT bit 28 as permission
to interleave CPU words into that DMA-owned stream.

DMA writes first enter a **separate sixteen-word ingress FIFO**, not sixteen
extra CPU FIFO slots. For an admitted DMA block:

1. Words before its `BLOCK_END` indication are staged without running the normal
   GP0 pipeline for those writes.
2. At block end, the GPU synchronizes already-due work and drains the staged
   words toward the GP0 command FIFO.
3. The GP0 parser interprets those words under its current packet phase, subject
   to command-completion and readback barriers.

The DMA write-ready check at this boundary tests whether ingress is stopped.
The DMA controller owns block sizing and admission; that limited check is not
permission to submit an arbitrarily large block to sixteen-word storage. Channel
addresses, counts and transfer controls belong to the DMA interface, not an
additional GPU register map.

### A DMA block boundary is not a GP0 packet boundary

`BLOCK_END` is a transfer indication, not a GP0 opcode or polyline terminator.
It does not supply missing packet fields, end an image payload or close an open
polyline. The next supplied word still has the role required by the current
[GP0 command-stream phase](#gpu-command-stream). Conversely, a DMA hand-off is
not an execution or pixel-completion fence: queued command intervals and a
non-idle readback can still prevent the parser from progressing. Acceptance,
packet completion and execution completion remain different events.

### Keep ownership separate from READY and access width

The same distinction applies in the other direction: GPUSTAT bit 27 can be set
while DMA owns GP0's read port. A CPU read then returns the existing GPUREAD latch
without consuming image data; READY does not transfer ownership to the CPU.
The [query/readback reference](#gpu-info-queries) describes that latch interaction.

A system ingress stop gates both direct CPU and DMA GP0 writes; GP1 also has its
supervisor-quiesce gate. This is not another name for ordinary GPU busy status.
Use the word operations specified under **Access and ordering** in the
[two-port reference](#gpu-ports-status): a byte read can consume a whole readback
word, narrow writes are not partial command writes, and a contiguous CPU word
sequence does not repeatedly address fixed GP0. DMA ownership does not redefine
those CPU access side effects or turn either port into ordinary RAM.

<a id="gpu-storage"></a>
## Choose the storage contract before drawing

Keep three units distinct: a **VRAM word** stores sixteen bits, a **GP0 command/input word** carries thirty-two bits, and a **PCRTC source sample** is a color decoded according to the selected display storage format. They are not interchangeable pixel counts or addresses. GPU local memory contains **2 MiB: 1,048,576 sixteen-bit words**, shared by drawing, texture reads and display reads. Selecting a display format changes how PCRTC interprets these words; it does not add storage or change the drawing address calculation.

Raw GPU coordinates address rows of **1,024 words**. For an already decoded raw coordinate, the word index and byte offset within local memory are:

```text
Word index  = (1024 × Y + (X AND 03FFH)) AND 000FFFFFH
Byte offset = 2 × word index
```

X wraps within its row. Thus `(1024,16)` addresses word `00004000H`, the same as `(0,16)`, not word `00004400H` at `(0,17)`. The final word-index mask wraps the installed memory. Distinguish that physical storage period from the **Y-address gate**: transfer Y, drawing-area Y, texture-page Y and palette-row Y decode with a nine-bit mask when the gate is closed, or a ten-bit mask when it is open. For a raw image transfer, logical `(32,512)` therefore selects word `00000020H` with the gate closed and `00080020H` with it open. Closing the gate does not remove the upper half of local memory.

Rendered RGB555 words place red in bits 4:0, green in 9:5 and blue in 14:10; bit 15 is stored separately. Eight-bit color components reduce to five bits by discarding their low three bits at storage conversion. Raw image data can instead supply complete sixteen-bit words. Within each stored word, the low byte comes first.

For a small placement example, arrange a two-by-two RGB555 tile at raw origin `(32,16)`:

| Raw coordinate | Word index | Byte offset | Stored word |
|---|---|---|---|
| (32,16) | `00004020H` | `00008040H` | `001FH` |
| (33,16) | `00004021H` | `00008042H` | `03E0H` |
| (32,17) | `00004420H` | `00008840H` | `7C00H` |
| (33,17) | `00004421H` | `00008842H` | `FFFFH` |

The first row is red then green; the second is blue then white. The white word has bit 15 set; that bit is not an extra blue-color bit. The second row starts **1,024 words**, or **2,048 bytes**, after the first—not immediately after its two pixels. These indices and offsets describe local-memory placement, not a GP0 packet or a display-window position.

Before using this image as a framebuffer, choose its PCRTC storage interpretation and source layout together. The PCRTC chapter's **Local-memory address layout** gives the GX16 linear layout and the other supported mappings. In particular, selecting CT16 for display does **not** make a primitive write through CT16 page, block and column addressing. Arrange the bytes for the display format you actually select; then use PCRTC's source origin and display window to choose which samples become visible.

<a id="gpu-primitive-choice"></a>
## Choose a primitive for the required image

Choose the primitive's coverage and attributes before constructing its packet.
The GPU consumes screen positions, not a three-dimensional surface. It does not
sort overlapping primitives or compare their depths. Projection and draw ordering
must already have supplied the positions and sequence that the image requires.

| Required operation | Primitive | Supplied attributes |
|---|---|---|
| Solid axis-aligned area | Untextured rectangle | One RGB color and an origin; fixed or variable dimensions |
| Axis-aligned texture image | Textured rectangle | One RGB color, initial U/V and dimensions; raw or modulated texture |
| Straight segment or connected segments | Line or polyline | One RGB color, or endpoint RGB colors for a color ramp; no texture lookup |
| Three-corner shape | Triangle | One RGB color or three vertex colors; optional U/V at each vertex |
| Four-corner shape | Quad | Four positions, with the corresponding flat/vertex-color and texture choices; executed as two triangles |

A rectangle has no four-corner color interpolation. Its variable width uses ten
bits and its variable height uses nine bits: 0–1023 by 0–511. Either zero extent
covers no samples. Fixed rectangles are 1×1, 8×8 or 16×16. These are drawing
rectangle rules, not the raw image-transfer size encoding or fill operation.

### A small area with explicit sample limits

Suppose the drawing area contains the entire region, the drawing offset is zero,
no row is suppressed, and no texture, blending or destination protection removes
or changes a write. A rectangle at `(40,24)` with width 4 and height 3 covers:

```text
Y = 24:  X = 40, 41, 42, 43
Y = 25:  X = 40, 41, 42, 43
Y = 26:  X = 40, 41, 42, 43
```

Its right boundary is 44 and bottom boundary is 27; those boundaries are excluded.
The result is twelve destination samples, not a five-by-four inclusive rectangle.
A quad with vertices `(40,24)`, `(44,24)`, `(40,27)`, `(44,27)` describes the same
rectangular coverage under these conditions, but takes a different arithmetic path:

| Triangle | Vertex indices | Positions |
|---|---|---|
| First | 0, 1, 2 | `(40,24)`, `(44,24)`, `(40,27)` |
| Second | 2, 1, 3 | `(40,27)`, `(44,24)`, `(44,27)` |

The common diagonal joins vertices 1 and 2. Each triangle applies its own coverage
and attribute calculations. The edge rule assigns a normal shared diagonal to
one half, but it does not prevent twice-written pixels when the two halves
overlap. A crossed or overlapping four-corner input is not repaired into a
nonoverlapping rectangle.

### Color and texture choices are independent of the corner count

Flat color supplies one RGB value for the primitive. Vertex coloring supplies
RGB at triangle or quad vertices, or at line endpoints. Triangle color and U/V
attributes are affine functions of screen X/Y, evaluated with the specified
integer precision. A quad therefore has two attribute planes, meeting at its
chosen diagonal; it is not a bilinear blend of four corners. A shape with the
same outline can have different interior colors when its diagonal or vertex
attributes change.

Textured triangles and rectangles fetch their source words from GPU local memory.
Raw texturing keeps the sampled RGB555 color; modulated texturing combines it
with the supplied or interpolated RGB components. Lines have no texture lookup.
The later texture and color sections give the actual window, palette, transparency,
modulation and dither rules; choosing a textured primitive does not bypass them.

A line uses a different coverage rule from an area. An accepted unclipped segment
with endpoint difference `(dx,dy)` generates `max(abs(dx),abs(dy))+1` samples,
including its two endpoints; a zero-length segment generates one sample. Adjacent
polyline segments can therefore write their common endpoint twice. That matters
when blending or destination-mask protection makes a second write observable.

<a id="gpu-coordinate-placement"></a>
## Place primitives across coordinate boundaries

A drawing coordinate uses **signed eleven-bit** X and Y values, each ranging from −1024 through 1023. Only the low eleven bits of each sixteen-bit coordinate component participate: `03FFH` means 1023, `0400H` means −1024, and both `07E0H` and `FFE0H` mean −32. Drawing-offset X uses bits 10:0 of its word; drawing-offset Y uses bits 21:11, with the same signed interpretation. The offset moves primitives, not the drawing area. Use each primitive's coordinate rule—not the raw VRAM X-address mask—to determine where it reaches that area.

Suppose the already-programmed drawing-offset word is `00008400H`: X field `0400H` supplies −1024 and Y field `0010H` supplies +16. Select a drawing area from `(0,0)` through `(1023,511)`, inclusive. Consider this triangle:

| Raw X / Y components | Supplied coordinate | Ordinary offset sum | Triangle coordinate after common shift |
|---|---|---|---|
| `07E0H / 0000H` | (−32,0) | (−1056,16) | (992,16) |
| `0020H / 0000H` | (32,0) | (−992,16) | (1056,16) |
| `0000H / 0020H` | (0,32) | (−1024,48) | (1024,48) |

Triangles first form the **ordinary integer sums**. Their inclusive span is tested before shifting or drawing-area clipping: `maxX−minX+1` must not exceed 1024, and `maxY−minY+1` must not exceed 512. This example spans 65 by 33 and passes. Separately on each axis, a minimum sum **below −1024** adds 2048 to all three coordinates on that axis; otherwise no shift is added. Here the X minimum is −1056, so every X receives 2048; Y receives no shift. The threshold is strict: a minimum of exactly −1024 does not trigger it. Positive results such as 1056 are not individually wrapped back into the signed range. The drawing area limits which part can produce pixels.

The span limit is not a clipping limit or a display-resolution rating. For example, X extremes −512 and 511 have inclusive span 1024 and pass the X test. Change the second extreme to 512 and the span becomes 1025: that triangle is rejected before clipping could hide the excess. The corresponding raw X components are `0600H`, `01FFH` and `0200H`. The size check applies to each triangle, including each half of a quad.

**Rectangles wrap their origin instead.** Decode the supplied origin, add the offset, then decode each sum again as signed eleven bits. With the same state, a rectangle anchored at `(−32,0)` starts at `(992,16)`, while one anchored at `(32,0)` starts at `(−992,16)`—not at the triangle's `(1056,16)`. A width of 16 extends the first X interval to `[992,1008)` and the second to `[−992,−976)`. The endpoint is not repeatedly wrapped as the rectangle extends. Variable rectangle widths are 0…1023 and heights 0…511; a zero extent covers nothing, rather than selecting a maximum extent.

**Lines wrap generated samples.** Their offset endpoint sums undergo the same span limits as triangles, but each generated sample is decoded as signed eleven bits before the drawing-area test. Do not wrap the endpoints first and generate a different line between them. For the two sums −1056 and −992 above, the ordinary X span is only 65. At the sample-conversion boundary, −1056 becomes 992, −1025 becomes 1023, −1024 stays −1024 and −992 stays −992. This is neither the triangle's common shift nor a rectangle's origin-only wrap; the line calculation determines which samples occur between its endpoints.

Drawing-area right and bottom fields are **inclusive**: `(0,0)` through `(1023,511)` permits coordinate tests `0≤X<1024` and `0≤Y<512`. X area fields use ten bits. Y area fields use nine bits with the Y-address gate closed and ten with it open. Thus raw top/bottom Y fields `0200H/03FFH` decode to `0/511` when closed but `512/1023` when open; this does not apply a blanket nine-bit wrap to supplied vertex Y. Reversed **decoded** area endpoints make that dimension empty: left 900 and right 100 do not exchange places or select a wrapped interval.

Row suppression is separate from this area. When the vertical-resolution and interlace status bits are both set and draw-to-displayed-field is clear, samples on the retained active-line parity are skipped; otherwise this parity rule skips no rows. It does not protect an entire displayed rectangle. The GP0 drawing-environment and GPU control references define how to program the named state used here.

<a id="gpu-shared-edges"></a>
## Predict shared-edge and joint writes

Triangle coverage tests **integer pixel coordinates**, not half-pixel centers. After placement, its candidate bounds include the minimum X/Y and exclude the maximum X/Y, intersected with the drawing area. Both nonzero windings are accepted; reversing the winding does not by itself reject a triangle. A zero-area triangle produces no pixels.

For vertices `(x0,y0)`, `(x1,y1)`, `(x2,y2)`, calculate:

```text
A = (x2−x0)×(y1−y0) − (y2−y0)×(x1−x0)
s = +1 when A > 0; −1 when A < 0
```

For each directed edge `v1→v2`, `v2→v0`, `v0→v1`, with endpoints `(ax,ay)` and `(bx,by)`, use:

```text
E(X,Y) = s × ((X−ax)×(by−ay) − (Y−ay)×(bx−ax))
stepX  = s × (by−ay)
stepY  = −s × (bx−ax)
minimum = 0 if stepX > 0, or if stepX = 0 and stepY > 0
          1 otherwise
```

A candidate sample must satisfy `E≥minimum` for **all three edges**. An exact edge value of zero therefore belongs to some directed boundaries but not their opposites. Do not replace this rule with “include every boundary pixel.” A rectangle instead covers its clipped left/top inclusive and right/bottom exclusive; it does not run these triangle edge tests.

To make write counts visible, use flat untextured RGB bytes `(32,0,0)`, dithering off, and **enabled additive blending, selection 1**. The source quantizes to RGB555 word `0004H`. Start each case with the shown destination words at `0000H`; disable destination-mask rejection and force-mask, skip no row parity, and include X=0…63 and Y=0…31 in the drawing area. Each write then adds four to the five-bit red channel: one write gives `0004H`, two give `0008H`. Neither result saturates, and stored bit 15 remains zero.

Choose quad vertices `v0=(40,24)`, `v1=(46,24)`, `v2=(40,26)`, `v3=(46,26)`. The two triangles execute as `(0,1,2)` then `(2,1,3)`. Put `i=X−40`, `j=Y−24`; candidate samples have `0≤i<6`, `0≤j<2`. Both triangles have A=−12. Their three tests reduce to:

| Triangle (0,1,2) | Triangle (2,1,3) |
|---|---|
| `12−2i−6j ≥ 1` | `12−2i ≥ 1` |
| `2i ≥ 0` | `12−6j ≥ 1` |
| `6j ≥ 0` | `2i+6j−12 ≥ 0` |

The complete sample sets are:

| Y | First triangle: covered X | Second triangle: covered X |
|---|---|---|
| 24 | 40, 41, 42, 43, 44, 45 | None |
| 25 | 40, 41, 42 | 43, 44, 45 |

![Integer sample ownership on a quad shared diagonal](figures/gpu-shared-edge.svg)

All **twelve** pixels receive exactly one write and finish at `0004H`. Sample `(43,25)` is exactly on the diagonal: `2i+6j=12`. The first triangle requires its opposite edge value to be at least one, so excludes it; the second accepts zero, so owns it. It does not become `0008H`. Swapping the first triangle's second and third vertices changes its area sign, but normalization preserves its nine covered samples. By contrast, collinear vertices `(40,24)`, `(43,25)`, `(46,26)` give A=0 and no triangle writes.

There is no once-only coverage operation over an arbitrary four-vertex outline. Move only `v3` to `(41,25)`: the first triangle is unchanged, while the second now has A=+4 and overlapping coverage. Its tests are `i+5j−6≥0`, `i+j−2≥0`, `12−2i−6j≥1`; only `(41,25)` and `(42,25)` pass within its bounds. Both already belong to the first triangle, so each finishes at **`0008H`**. The first triangle's other seven samples finish at `0004H`; `(43,25)` is now untouched at `0000H`. Overlapping halves can blend twice even though an ordinary shared diagonal is owned once.

A polyline joint is different again. Two accepted, unclipped segments `(40,30)→(43,30)→(46,30)` each include **both endpoints** and generate four samples. The shared endpoint `(43,30)` is consequently written by both segments and finishes at `0008H` under the same state; either outer endpoint finishes at `0004H`. A zero-length accepted line generates one sample, rather than following the triangle's zero-area rule. Plan additive or other repeated-write effects around the primitive's actual coverage, not around its apparent outline.

<a id="gpu-interpolation"></a>
## Predict interpolated colors and texture coordinates

Triangle interpolation supplies a byte value for each covered pixel. Gouraud
color uses three separate planes, one for each RGB component. Textured triangles
use two planes for U and V. Flat color uses its supplied RGB bytes without a
color plane; raw texturing ignores supplied RGB for the output. Coverage is a
separate calculation: the attribute's rounding bias does not move a triangle's
edges.

Each plane is affine in the final screen X/Y coordinates. There is no Z or
reciprocal-depth term, texture filtering or mip-level selection in this sample
path. Supplying projected vertices therefore does not make the U/V calculation
perspective-correct. Software must choose geometry and texture coordinates that
produce the required approximation.

### Form a finite plane, not an ideal interpolator

Let the triangle's shifted coordinates be `(x0,y0)`, `(x1,y1)`, `(x2,y2)` and
let one supplied byte attribute be `a0`, `a1`, `a2`. Use the nonzero determinant:

```text
D = (x1−x0)×(y2−y0) − (x2−x0)×(y1−y0)
Nx = (a1−a0)×(y2−y1) − (a2−a1)×(y1−y0)
Ny = (x1−x0)×(a2−a1) − (x2−x1)×(a1−a0)
```

The X/Y step quotients are `trunc(4096×Nx/D)` and `trunc(4096×Ny/D)`.
Here `trunc` discards a fractional part **toward zero**, including for a negative
quotient. Retain only the low twenty bits of each quotient. Decode each retained
step as signed twenty-bit two's complement when forming the intercept:

```text
raw step range       = 00000H…FFFFFH
signed interpretation = raw, if bit 19 is clear
                      = raw − 100000H, if bit 19 is set
```

Thus the raw twenty-bit plane retains twelve fractional bits. A large derivative
wraps in that field; it is not saturated to a plausible color slope. For example,
a quotient of 983040 has raw value `F0000H` and signed interpretation −65536,
not a saturated positive step.

The intercept is anchored at one supplied vertex. The selection depends on X
and its exact tie rules:

| Condition | Anchor |
|---|---|
| `x1≤x0` and `x2≤x1` | 2 |
| `x1≤x0` and `x2>x1` | 1 |
| `x1>x0` and `x2<x0` | 2 |
| `x1>x0` and `x2≥x0` | 0 |

Using the signed retained steps `sx`, `sy`, calculate:

```text
intercept = (4096×aAnchor + 2048 − xAnchor×sx − yAnchor×sy)
            AND FFFFFH
value(X,Y) = ((intercept + X×sx + Y×sy) >> 12) AND FFH
```

Only bits 19:12 supply the final byte. Attribute overflow therefore wraps rather
than clamping to 0 or 255. Adding 2048 biases the **attribute** by one half unit:
one half of a color count or texel-coordinate count, not one half screen pixel.
The quantized steps and anchor still matter; this is not a promise to round an
ideal mathematical plane to the nearest byte at every pixel.

### A half-count that the quantized slope does not reach

Use zero drawing offset and these positions and attributes:

| Vertex | X | Y | Attribute a |
|---|---:|---:|---:|
| 0 | 0 | 0 | 10 |
| 1 | 7 | 0 | 250 |
| 2 | 0 | 6 | 11 |

The determinant is 42. X1 exceeds X0 while X2 equals X0, so the anchor is
**vertex 0**, not vertex 2. The arithmetic is:

| Quantity | Exact expression | Retained value |
|---|---|---|
| X step | `983040/7 = 140434 + 2/7` | 140434, raw `22492H` |
| Y step | `4096/6 = 682 + 2/3` | 682, raw `002AAH` |
| Intercept | `10×4096+2048` | 43008, raw `0A800H` |

At `(0,3)`, the ideal unquantized attribute is 10.5. The actual retained plane
instead evaluates `43008+3×682=45054`, two raw counts below `11×4096=45056`.
Its byte is therefore **10**, not 11. Moving along that row gives:

| Sample (X,3) | Raw plane expression | Extracted byte |
|---|---:|---:|
| (0,3) | 45054 | 10 |
| (1,3) | 185488 | 45 |
| (2,3) | 325922 | 79 |
| (3,3) | 466356 | 113 |

These four integer positions pass this triangle's edge tests when the drawing
area contains them and no row suppression is active. Other pixel-write controls
still apply after attribute evaluation. If a is a Gouraud color component, its
byte proceeds to the color/texture calculation and eventual RGB555 conversion;
if it is U or V, the byte proceeds to texture-window replacement and lookup.
It is not itself a stored framebuffer word.

Using vertex 2 as an arbitrary substitute anchor would give intercept 43012 and
byte 11 at `(0,3)`: the difference is observable. The exact anchor rule is part
of the arithmetic, not a choice left to software.

For the signed contrast, retain the same positions but use attributes
`(250,10,249)`. The quotients become −140434 and −682, not −140435 and −683;
raw steps are `DDB6EH` and `FFD56H`. Anchor 0 gives intercept `FA800H`. At
`(0,3)` its expression is 1024002 and its byte is 250. Do not replace the
specified toward-zero derivative quotients with downward-rounded division.

A quad evaluates these rules separately for triangles `(0,1,2)` and `(2,1,3)`.
The common diagonal's coverage ownership does not turn their attribute planes
into one bilinear four-vertex interpolator.

<a id="gpu-line-sampling"></a>
## Predict line samples and color ramps

Start with the ordinary offset endpoint sums after the line's span check. If the first X exceeds the second, exchange **both endpoint coordinates and their RGB colors**. Do not exchange colors independently of their positions. Equal-X vertical lines retain the supplied order; there is no corresponding Y-order swap.

After this ordering, let `ΔX=x1−x0`, `ΔY=y1−y0`, and `N=max(abs(ΔX),abs(ΔY))`. The line generates samples numbered 0 through N, including both endpoints of an accepted unclipped segment. For N=0, all steps are zero and one sample uses the first supplied color. Consecutive polyline segments perform this calculation separately, so their common endpoint can be processed twice.

**Position equations—mathematical notation.** Q32 denotes thirty-two fractional bits, not a thirty-two-bit total word width. Let `S=2^32`, and let `trunc0` mean signed division rounded toward zero. For N>0:

```text
dX = trunc0((ΔX×S + sign(ΔX)×(N−1)) / N)
dY = trunc0((ΔY×S + sign(ΔY)×(N−1)) / N)
```

Here `sign` is −1, 0 or +1. These steps round a nonintegral step magnitude **outward**, not to nearest. The initial Q32 positions are:

```text
PX(0) = x0×S + S/2 − 1024
PY(0) = y0×S + S/2 − bY
bY    = 1024 when dY < 0; otherwise 0
PX(k) = PX(0) + k×dX
PY(k) = PY(0) + k×dY
```

The bias 1024 is measured in Q32 units: it is `2^−22` of a pixel, not 1,024 pixels. Convert each position by the mathematical floor of `P/S`, including downward rounding for negative values. Then decode the resulting X/Y as signed eleven-bit coordinates and apply drawing-area and row-parity tests. This floor conversion differs from the `trunc0` used to obtain steps.

Color uses a separate **twelve-fractional-bit** calculation. For each RGB byte C, N>0 gives:

```text
dC      = trunc0((C1−C0)×4096 / N)
Cfixed(k) = C0×4096 + 2048 + k×dC
Cbyte(k)  = trunc0(Cfixed(k) / 4096)
```

For N=0, dC is zero. The half-unit color bias and truncated color step are distinct operations; replacing them with an ideal color interpolation rounded once at the end can change a tie. The resulting RGB bytes then undergo eligible dithering and RGB555 reduction. Lines use the draw-mode dither bit for **both flat and Gouraud color**, unlike the more restricted polygon rule. The following source-color calculations have dithering disabled; they do not include later blending or destination protection.

For a Gouraud line, supply `(14,5)` with RGB `(20,200,40)`, followed by `(10,12)` with RGB `(220,20,180)`. The X-order swap makes the calculation start at `(10,12)` with its associated color. Now `ΔX=4`, `ΔY=−7`, N=7:

```text
dX = 2454267027 = 92492493H Q32 units
dY = −4294967296 = −100000000H Q32 units
(dR,dG,dB) = (−117028,105325,−81920) Q12 units
```

The steep, negative-Y line produces:

| k | Sample (X,Y) | Interpolated RGB bytes | RGB555 source word |
|---|---|---|---|
| 0 | (10,12) | (220,20,180) | `585BH` |
| 1 | (11,11) | (191,46,160) | `50B7H` |
| 2 | (11,10) | (163,71,140) | `4514H` |
| 3 | (12,9) | (134,97,120) | `3D90H` |
| 4 | (12,8) | (106,123,100) | `31EDH` |
| 5 | (13,7) | (77,149,80) | `2A49H` |
| 6 | (13,6) | (49,174,60) | `1EA6H` |
| 7 | (14,5) | (20,200,40) | `1722H` |

If the drawing area admits only rows 7 through 10 and odd rows are suppressed, only k=2 and k=4 pass those tests. They retain source words `4514H` and `31EDH`. Clipping and row suppression do **not** restart position or color progression: the first admitted sample is not assigned the original starting color, and N is not recomputed for the surviving portion.

Equal-X order can be observable at a color tie. Supply `(20,20)` with RGB `(7,64,128)` and `(20,26)` with `(8,64,128)`. N=6 and the red step is `trunc0(4096/6)=682`. At the middle sample `(20,23)`, red fixed value is `7×4096+2048+3×682=32766`, giving byte 7. Reverse the two complete endpoint/color pairs: equal X prevents a swap, the red step becomes −682, and the same middle coordinate has `8×4096+2048−3×682=32770`, giving byte 8. With dithering off, the RGB555 source words are respectively **`4100H` and `4101H`**. Keep this specified order and precision when reproducing a vertical ramp; geometric reversal is not a promise of identical quantized interior colors.

<a id="gpu-texture-lookup"></a>
## Locate texture texels and palette colors

Texture U and V are **unsigned eight-bit coordinates**. Apply the texture window first; the resulting U/V select a texel within its page. Page X is measured in **raw sixteen-bit words**, not texels: draw-mode bits 3:0 select X in units of 64 words. Page Y combines bit 4 in units of 256 rows and bit 11 in units of 512 rows, then passes through the Y-address gate. Depth bits 8:7 determine how many texels occupy each raw word:

| Depth field | Texels per raw word | Source-word X | Selection from that word |
|---|---|---|---|
| 0: palette4 | 4 | `pageX + (U>>2)` | Nibble `(word>>(4×(U AND 3))) AND 0FH` |
| 1: palette8 | 2 | `pageX + (U>>1)` | Byte `(word>>(8×(U AND 1))) AND FFH` |
| 2: direct16 | 1 | `pageX + U` | Complete sixteen-bit color word |
| 3: direct16 | 1 | `pageX + U` | Same direct lookup as depth 2 |

Source-word Y is `pageY+V`. A 256-texel row therefore occupies 64, 128 or 256 raw words; a 64-word page-base unit does not mean every depth occupies only 64 words. All lookups use raw 1,024-word rows: X wraps within its row, and the installed word-index mask is `000FFFFFH`.

Palette depths use the extracted index for a second local-memory read. The CLUT attribute supplies base X `(attribute AND 003FH)×16` and base Y `attribute>>6`, with Y passed through the address gate. Palette4 has sixteen possible indices; palette8 has 256. The CLUT base is sixteen-word-aligned in either case, so a palette8 lookup can cross X=1023 and wrap to X=0 **on the same palette row**.

### A packed palette8 lookup across both row ends

Use already-selected page/depth fields `0000089FH`, an **open Y-address gate**, texture-window fields `00000000H`, and CLUT attribute `E13FH`. These are field values, not complete command packets. They decode to page `(960,768)`, depth 1, an identity window, and CLUT base `(1008,900)`. Suppose local memory contains:

| Purpose | Raw coordinate | Word index | Stored word |
|---|---|---|---|
| Packed indices | (1023,791) | `000C5FFFH` | `100FH` |
| Packed indices | (0,791) | `000C5C00H` | `1100H` |
| Palette entry | (1023,900) | `000E13FFH` | `001FH` |
| Palette entry | (0,900) | `000E1000H` | `03E0H` |
| Palette entry | (1008,900) | `000E13F0H` | `7C00H` |
| Palette entry | (1,900) | `000E1001H` | `0000H` |

For V=23, source Y is `768+23=791`. Four lookups produce:

| U | Source-word index | Selected byte/index | CLUT word index | Fetched color word |
|---|---|---|---|---|
| 126 | `000C5FFFH` | `0FH` | `000E13FFH` | `001FH` |
| 127 | `000C5FFFH` | `10H` | `000E1000H` | `03E0H` |
| 128 | `000C5C00H` | `00H` | `000E13F0H` | `7C00H` |
| 129 | `000C5C00H` | `11H` | `000E1001H` | `0000H` |

U=126 selects the low byte of `100FH`; U=127 selects its high byte. U=128 advances the raw source X from 1023 to 0, not to the next row. Independently, palette index 16 advances CLUT X from base 1008 to wrapped X=0. Index zero returns the nonzero color word `7C00H`: **palette index zero is not automatically transparent**. Index 17 returns the zero color word, which is transparent. These are fetched source colors, before later color and destination-write controls.

With the Y gate closed, the same page fields select page Y=256 and the same CLUT attribute selects row 388. The reads use different words; the depth and palette-index range are unchanged. Depth 3 is also deterministic: with page/depth fields `0000099FH`, the same page base and U=63,V=23 directly return `100FH` from `(1023,791)`. That word is a color, not two palette indices. Depth 2 performs the same direct lookup.

[Program a complete picture in BLua](#gpu-programming-example) supplies the
complete palette4 route: typed readonly colors and packed indices, separate raw
uploads, T0 CLUT selection and T1 palette-depth/page selection. Its result
includes a nonzero entry 0, a transparent entry and a nonzero black entry, so
palette-index interpretation can be distinguished from fetched-color rules.

### Replace coordinate bits with a texture window

The E2 window fields are X mask bits 4:0, Y mask bits 9:5, X offset bits 14:10 and Y offset bits 19:15. Independently for U and V, the mathematical transformation is:

```text
A = NOT(mask×8) AND FFH
O = (offset AND mask)×8
windowed coordinate = (coordinate AND A) OR O
```

Only masked offset bits participate; the low three coordinate bits are preserved. This is bit replacement, not clipping to a pixel rectangle or adding an ordinary offset. For raw window value `00010C62H`, the four fields are `(2,3,3,2)`: U uses AND/OR masks `EFH/10H`, and V uses `E7H/10H`. Input `(U,V)=(6FH,1FH)` becomes `(7FH,17H)`, or `(127,23)`. Reusing the example's page and CLUT, it selects the high byte `10H` from `100FH` and fetches color word `03E0H`. Both the texture window and the palette placement must therefore be included when predicting a texture read.

<a id="gpu-texture-rectangles"></a>
## Keep a clipped or flipped rectangle on its texture

A textured rectangle anchors its initial U/V at its **unclipped destination origin**. X-flip independently selects a U step of −1 instead of +1; Y-flip selects a V step of −1 instead of +1. Neither bit changes the destination rectangle. It also does not move the texture anchor automatically to the opposite edge: choose the initial U/V for the traversal you intend.

For already-placed destination origin `(X0,Y0)` and supplied byte coordinates `(U0,V0)`, the mathematical texture-coordinate calculation is:

```text
U = U0 + (X−X0)×stepU
V = V0 + (Y−Y0)×stepV
stepU = −1 with X-flip set; otherwise +1
stepV = −1 with Y-flip set; otherwise +1
```

Use the original destination coordinates in these differences, not the number of pixels which survive clipping. The texture window then transforms the stepped U/V; clipping does not restart them at U0/V0.

Consider a rectangle covering X=10…17 and Y=20…25 before clipping. Let the drawing area remove its first three columns and first two rows, leaving X=13…17 and Y=22…25. Use initial U0=2,V0=1. The first surviving coordinate is therefore three U steps and two V steps from the anchor—not a new texture origin.

Select these texture-window fields: X mask=1, Y mask=3, X offset=0, Y offset=1. They give U AND/OR masks `F7H/00H` and V masks `E7H/08H`. The first surviving pixel `(13,22)` demonstrates independent flip choices:

| X-flip | Y-flip | Stepped U/V before window | Windowed U/V |
|---|---|---|---|
| 0 | 0 | (5,3) | (`05H`,`0BH`) |
| 1 | 0 | (−1,3) | (`F7H`,`0BH`) |
| 0 | 1 | (5,−1) | (`05H`,`EFH`) |
| 1 | 1 | (−1,−1) | (`F7H`,`EFH`) |

The negative values are traversal intermediates, not negative command U/V bytes. The window consumes the eight-bit coordinate domain through its bit replacement. For example, an identity window would map −1 to `FFH`; the selected U window instead gives `(−1 AND F7H) OR 00H = F7H`. Do not substitute raw VRAM's 1,024-word X-row wrap for this eight-bit UV transformation. The texture placement rules determine the later raw-word address.

Keep **both flip bits set**. Across X=13,14,15,16,17, stepped U is −1,−2,−3,−4,−5 and windowed U is `F7H,F6H,F5H,F4H,F3H`. Each row starts with this same first U; it does not continue from the end of the preceding row.

For row suppression, assume the GPU vertical-resolution and interlace status bits are both set, draw-to-displayed-field is clear, and the retained active-line parity is odd. Odd destination rows are then skipped:

| Destination Y | Stepped V | Windowed V | Row qualification |
|---|---|---|---|
| 22 | −1 | `EFH` | Admitted |
| 23 | −2 | `EEH` | Skipped |
| 24 | −3 | `EDH` | Admitted |
| 25 | −4 | `ECH` | Skipped |

The next admitted row after Y=22 uses `EDH`, **not `EEH`**: skipped Y=23 still advances V. Its first lookup coordinate is `(F7H,EDH)`, while Y=22 starts at `(F7H,EFH)`. These are texture-lookup inputs; later source-color and destination-write rules determine the stored result. Neither drawing-area clipping nor row suppression compresses the texture into fewer rows. The rectangle flip bits do not reverse a triangle's interpolated U/V.

<a id="gpu-color-dither"></a>
## Choose texture gain and dither deliberately

Choose **raw texturing** when the fetched texture color itself is the desired source RGB555. The supplied RGB color does not tint that result, and raw texturing bypasses dithering. Choose **modulated texturing** to multiply the texture's five-bit channels by supplied RGB bytes; a Gouraud polygon uses its interpolated RGB bytes at each pixel. These bytes are gain controls, not replacement texture colors. In particular, `80H` (128), not `FFH` (255), is exact neutral gain with dithering off.

A fetched texture word of `0000H` is skipped before either calculation. A nonzero word, including black `8000H`, proceeds. The words calculated below specify the **source RGB555**, before later blending, destination protection and stored-bit-15 selection; they are not unconditional final-memory results.

<div class="keep-together">

For each modulated channel, let T be the texture component (0…31), C the supplied or interpolated byte (0…255), and d the eligible dither offset, or zero with dithering off. The mathematical calculation is:

```text
P = (T × C) >> 4             P is in 0…494
S = P + d
F = 0                       if S < 0
F = min(S >> 3, 31)          otherwise
```

</div>

Both right shifts discard low bits. Keep the two stages and their order: do not expand the five-bit texture channel by bit replication, clamp P to a byte before adding d, or add d after producing F. Saturation belongs after the dither addition.

For texture word `6208H`, RGB5=(8,16,24), the following choices give different material behavior. Dithering is off:

| Supplied RGB bytes | Intermediate P for R/G/B | Source RGB5 | Source word |
|---|---|---|---|
| (128,128,128) | (64,128,192) | (8,16,24) | `6208H` |
| (64,128,192) | (32,128,288) | (4,16,31) | `7E04H` |
| (255,255,255) | (127,255,382) | (15,31,31) | `7FEFH` |

The second choice halves red, preserves green and saturates blue: blue reaches 36 before the limit of 31. The third is not neutral white modulation. Selecting raw texturing instead preserves source `6208H` for all three supplied colors.

Dither uses the **final destination coordinate**, with the following offset at row `Y AND 3`, column `X AND 3`:

| Y phase \ X phase | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| 0 | −4 | 0 | −3 | +1 |
| 1 | +2 | −2 | +3 | −1 |
| 2 | −3 | +1 | −4 | 0 |
| 3 | +3 | −1 | +2 | −2 |

The same offset is added separately to all three components. It is not indexed by U/V or restarted at a primitive's origin. Moving an otherwise identical sample to a different destination phase can therefore change its source RGB555. Dither acts before five-bit reduction and blending; it is not a PCRTC display effect.

Take an eligible modulated textured polygon with dithering enabled. Suppose its samples fetch texture word `3527H`, RGB5=(7,9,13), with RGB bytes=(124,100,160). The first products reduce to P=(54,56,130):

| Destination / setting | d | S for R/G/B | Source RGB5 | Source word |
|---|---|---|---|---|
| Dithering off | 0 | (54,56,130) | (6,7,16) | `40E6H` |
| (18,21), phase (2,1) | +3 | (57,59,133) | (7,7,16) | `40E7H` |
| (16,20), phase (0,0) | −4 | (50,52,126) | (6,6,15) | `3CC6H` |

Neutral gain 128 does not cancel these offsets. At the lower limit, a nonzero fetched word `0001H` with RGB bytes=(1,0,0) gives P=(0,0,0); offset −4 clamps every source channel to zero. That resulting black source does **not** trigger the earlier fetched-zero skip.

Finally, the draw-mode dither setting is not universal. It applies to modulated textured polygons, untextured Gouraud polygons, and both flat and Gouraud lines. Flat untextured polygons, raw-textured polygons, and all rectangles do not dither. Without texturing, eligible dithering adds d to each RGB byte, clamps to 0…255, then discards three bits to obtain RGB555. Thus a modulated textured rectangle can use the same gain calculation, but not the polygon's dither variation.

<a id="gpu-blending-mask"></a>
## Separate texture transparency, blending and destination protection

Four decisions act at different stages. A fetched texture word of **exactly `0000H`** skips the pixel. The command's semitransparency selection enables a possible blend. For textured drawing, fetched **source bit 15** must also be one for that blend to occur. Finally, mask-mode controls can reject a write using the **old destination bit 15**, or force the **new output bit 15**. These are not interchangeable meanings of transparency.

For an untextured primitive, its semitransparency selection enables blending of eligible covered pixels without a texture-bit condition. For a textured primitive, a nonzero fetched word with bit 15 clear remains opaque even under a semitransparent command. Setting source bit 15 alone is insufficient: an opaque command still replaces the destination RGB. Neither source nor destination bit 15 supplies a fractional alpha coefficient.

When blending is enabled, let F be one already-quantized five-bit source channel and B the current five-bit destination channel. The draw-mode selection chooses the following calculation independently for red, green and blue:

| Blend selection | Result channel |
|---|---|
| 0: half sum | `(B + F) >> 1` |
| 1: saturated addition | `min(B + F, 31)` |
| 2: saturated subtraction | `max(B − F, 0)` |
| 3: quarter-source addition | `min(B + (F >> 2), 31)` |

The right shifts discard low bits. In selection 0, add **before** halving: B=5,F=3 gives 4, not `(5>>1)+(3>>1)=3`. An odd sum such as 2+7 gives 4. In selection 3, reduce the source **before** adding it; F=3 contributes zero, while F=7 contributes one.

For destination RGB5=(5,2,29), RGB word `7445H`, and source RGB5=(3,7,7), RGB word `1CE3H`, all four choices are distinguishable:

| Selection | Result RGB5 | Result RGB word, excluding bit 15 |
|---|---|---|
| 0 | (4,4,18) | `4884H` |
| 1 | (8,9,31) | `7D28H` |
| 2 | (2,0,22) | `5802H` |
| 3 | (5,3,30) | `7865H` |

Addition clips blue's 29+7 to 31. Subtraction clips green's 2−7 to zero; it does not wrap. Quarter-source addition instead adds (0,1,1), preserving those integer truncations.

The following independent raw-texture samples all start with destination `7445H` and use blend selection 0. Check-mask is off. “Force” means mask-mode bit 0, which sets the output bit 15 without changing blend eligibility:

| Fetched word | Semitransparent command | Force | Effect and resulting stored word |
|---|---|---|---|
| `0000H` | Yes | 1 | Skipped; destination stays `7445H` |
| `8000H` | Yes | 0 | Black source blends; stores `B822H` |
| `8000H` | No | 0 | Opaque black; stores `8000H` |
| `1CE3H` | Yes | 0 | Source bit 15 clear: opaque; stores `1CE3H` |
| `9CE3H` | No | 0 | Command does not blend; stores `9CE3H` |
| `9CE3H` | Yes | 0 | Both blend conditions met; stores `C884H` |
| `1CE3H` | Yes | 1 | Still opaque; forced output stores `9CE3H` |

`8000H` is therefore not the transparent word: it is nonzero black. In the blended row its RGB becomes (2,1,14), while the output bit 15 comes from the fetched sample. Conversely, force-mask cannot turn `0000H` into a write or turn a bit-15-clear texel into a blended source.

**Check-mask**, mask-mode bit 1, tests the destination's old bit 15 before blending or storing. If that bit is one, the complete write is suppressed, including any forced output-bit change. Starting instead with destination `F445H`, check-mask leaves `F445H` unchanged, whether force-mask is zero or one. With both controls clear, an opaque write of `1CE3H` replaces it and clears its old bit 15.

To mark newly drawn pixels and protect them on later checked draws, enable both controls: mask-mode low bits=`3`. Starting at `7445H`, a raw `1CE3H` sample passes the check and stores `9CE3H`. A second checked draw then fails against that newly set bit. Clearing check-mask permits overwriting it again; force-mask does not override protection.

On an admitted write, output bit 15 is one if forced. Otherwise textured drawing copies the fetched bit, untextured drawing writes zero, and raw upload/copy preserves its source bit. Blended RGB never determines that output bit, and the old destination bit is not implicitly retained. Raw upload/copy also uses these check/set controls, but not the drawing blend calculation.

<a id="gpu-memory-operations"></a>
## Choose fill, drawing or a raw transfer

A fill, a drawing rectangle and an image transfer can touch a rectangular region, but they do not have the same dimensions, address rules or write controls. Choose **fill** for an aligned solid-color memory operation; choose a **drawing rectangle** for the drawing-area, offset and pixel-write rules; choose **upload or VRAM copy** to move raw sixteen-bit storage words.

For a variable drawing rectangle, width is the low ten size bits and height the low nine: zero is empty. Fill uses those same low-bit fields but rounds width upward to a multiple of 16 and aligns destination X downward to a multiple of 16. Upload, copy and readback instead normalize each dimension with:

```text
W = ((rawWidth  − 1) AND 3FFH) + 1
H = ((rawHeight − 1) AND 1FFH) + 1
```

Thus these raw width fields have different meanings, before clipping or write suppression:

| Raw width | Variable drawing rectangle | Fill | Upload/copy/readback |
|---|---|---|---|
| 0 | Empty | Empty | 1024 |
| 1 | 1 | 16 | 1 |
| 16 | 16 | 16 | 16 |
| 1023 | 1023 | 1024 | 1023 |

Zero height likewise means empty for fill/drawing, but 512 rows for an image transfer. A zero image-size word requests **1024×512**, not no work. Fixed 1×1, 8×8 and 16×16 drawing rectangles have no variable size word.

The write controls are also different:

| Operation | Drawing offset/area | Check-mask and force-mask | Retained skipped-row parity |
|---|---|---|---|
| Fill | Bypassed | Bypassed | Applied |
| Drawing rectangle | Applied | Applied | Applied |
| Raw upload/copy | Bypassed | Applied | Bypassed |

Fill truncates its RGB bytes to RGB555 and writes bit 15 clear; it does not blend or dither. Raw upload/copy preserves the supplied RGB bits and source bit 15 unless mask controls reject the write or force bit 15. It does not blend or dither. Drawing rectangles follow their color/texture path, but neither kind dithers. Their origin follows the drawing-coordinate rule; transfer X wraps within a 1,024-word row and transfer Y follows the selected address gate. Do not substitute transfer wrapping for drawing placement.

For a small control contrast, start both `(31,20)` and `(31,21)` at `8010H`, use zero drawing offset, an including drawing area, and retained suppression of odd rows. Each following operation starts from those same contents:

| Operation and controls | Word at (31,20) | Word at (31,21) |
|---|---|---|
| Red fill, raw width=1,height=2; check and force set | `001FH` | `8010H` |
| Untextured red drawing rectangle, width=1,height=2; check and force set | `8010H` | `8010H` |
| Upload `001FH,0000H`, width=1,height=2; check and force set | `8010H` | `8010H` |
| Same upload; check clear, force set | `801FH` | `8000H` |

Red here is supplied RGB=(255,0,0). The fill also writes X=16…30 on admitted row 20: its requested X=31 aligns to 16. It ignores both mask controls, but skips row 21. Drawing cannot replace the protected row-20 destination, while upload ignores row suppression but still obeys destination protection. With checking disabled, upload writes even its zero source word and forces the stored high bit.

**Horizontal overlap is handled per row.** A copy traverses columns backward when `((targetX−sourceX) AND 3FFH)` is nonzero and less than W; otherwise it traverses forward. With both mask controls clear, copy width=3 from X=1022 to X=1023 on one row. In column order X=(1022,1023,0,1), let the before-words be `(0011H,0022H,0033H,0044H)`. The reads run X=0,1023,1022 and write X=1,0,1023, producing `(0011H,0011H,0022H,0033H)`. The X wrap stays in that row.

**Vertical overlap is not a rectangle snapshot.** Rows always advance in logical order, reading each source word immediately before its write. Select the 512-row Y gate and clear both mask controls. Copy 3×3 from `(1023,510)` to `(1023,511)`; the three columns wrap to X=(1023,0,1):

| Physical Y | Before words at X=(1023,0,1) | After words |
|---|---|---|
| 510 | `0011H,0022H,0033H` | `0011H,0022H,0033H` |
| 511 | `0044H,0055H,0066H` | `0011H,0022H,0033H` |
| 0 | `0077H,0088H,0099H` | `0011H,0022H,0033H` |
| 1 | `00AAH,00BBH,00CCH` | `0011H,0022H,0033H` |

The first row writes 510→511. The second reads that newly written row 511 and writes it to row 0; the third reads the newly written row 0 and writes row 1. Retained row suppression does not prevent these raw-copy writes. To preserve the original rows in this shift, copy logical rows 2,1,0 as separate one-row commands, or use a nonoverlapping intermediate region; do not expect a hidden snapshot.

Upload data is row-major raw words, packed low halfword first in each GP0 payload word. A 3×3 upload needs five payload words: only the last high halfword is unused, with no padding after each odd-width row. Supply the counted payload, not an end-image marker. Readback reports raw storage words, not PCRTC-converted or composed display pixels.

<a id="gpu-command-stream"></a>
## Frame the GP0 command stream

Supply GP0 input as complete **32-bit words**. A command's first word selects
its operation with bits 31:24; bits 23:0 have the meaning assigned by that
command. Later words belong to the selected packet until its required fields
or payload have been consumed. Their high bytes are not independently decoded
as new opcodes.

### Select the family before interpreting option bits

The complete opcode-byte map is:

| Opcode byte | Operation family |
|---|---|
| `02H` | Local-memory fill |
| `1FH` | GPU interrupt request |
| `20H–3FH` | Polygons |
| `40H–5FH` | Finite lines or streamed polylines |
| `60H–7FH` | Rectangles |
| `80H–9FH` | Local-memory copy |
| `A0H–BFH` | Image upload to local memory |
| `C0H–DFH` | Local-memory readback |
| `E1H–E6H` | Drawing environment |

Every opcode within a listed range selects that family. The option bits do not
have one universal meaning:

| Family | Opcode bits within that family |
|---|---|
| Polygon | Bit 4 selects Gouraud colors; bit 3 selects a quad rather than a triangle; bit 2 enables texture; bit 1 requests semi-transparency; bit 0 selects raw rather than modulated texture when textured |
| Line | Bit 4 selects Gouraud colors; bit 3 selects a streamed polyline; bit 1 requests semi-transparency. Bits 2 and 0 do not insert texture fields |
| Rectangle | Bits 4:3 select the size form; bit 2 enables texture; bit 1 requests semi-transparency; bit 0 selects raw rather than modulated texture when textured |

In particular, rectangle bit 4 does not request Gouraud colors. Bit 0 does not
create a raw-color mode for an untextured primitive. Use the selected family's
word list to determine the exact packet length; do not infer it from an option
bit borrowed from another family.

At a **command boundary**, opcode bytes `00H`, `04H–1EH`, `E0H` and `E7H–EFH`
are discarded NOPs without a command-cost interval. The remaining unlisted
values—`01H`, `03H` and `F0H–FFH`—are one-word ignored operations with a
one-command-tick cost, not rejected opcodes. `01H` does not perform a texture-cache
operation. These rules do not turn matching high bytes inside a packet into NOPs
or new commands.

A packed word's role also determines its numerical interpretation. RGB consumes
three unsigned bytes in bits 7:0, 15:8 and 23:16. Primitive positions consume
signed eleven-bit X/Y fields within their two halfwords. Image addresses instead
use raw local-memory coordinates, including the selected Y-address mask. The
common 32-bit container does not make these representations interchangeable.

### Finish the current packet before starting another

A fixed packet waits for its exact field count. An image-upload header selects
a counted pixel payload: words in that payload remain image data even when they
look like opcodes or polyline terminators. If a field is omitted, the next word is consumed in its place—even when
that word looks like the start of another command.

A polyline has a different boundary. Its initial two-endpoint header contains
three words for flat color or four for Gouraud color. Subsequent flat vertices
supply one position each; Gouraud vertices supply a color followed by a position.
Each complete new vertex defines another segment from the retained previous
endpoint. The initial segment and later complete segments need not wait for the
terminator before executing.

After that header, the polyline terminator is any word satisfying:

```text
(word AND F000F000H) = 50005000H
```

Test this only where a new continuation vertex begins: the next position for a
flat polyline, or the next **color** for a Gouraud polyline. A matching word in
a Gouraud continuation's position slot is position data, not a terminator. The
terminator adds no segment. Without it, the stream remains a polyline; an
unfinished Gouraud color/position pair remains unfinished.

<div class="keep-together">

For example, supply this Gouraud polyline followed by a drawing-environment
command. The high byte `58H` selects the line family with both Gouraud and
polyline bits set:

| Word | Raw input | Role in the stream |
|---|---|---|
| 1 | `58000020H` | Command and first RGB `(32,0,0)` |
| 2 | `00180028H` | First position `(40,24)` |
| 3 | `E10000FFH` | Second RGB `(255,0,0)`; **not** an E1 command |
| 4 | `0018002EH` | Second position `(46,24)`; completes the initial header |
| 5 | `0000FF00H` | Continuation RGB `(0,255,0)` |
| 6 | `001A002EH` | Continuation position `(46,26)`; completes the next segment |
| 7 | `5ABC5DEFH` | Terminator at the next continuation-color boundary |
| 8 | `E1000000H` | A new E1 drawing-environment command |

</div>

Word 3 belongs to the header, so its `E1H` high byte cannot change drawing state.
Word 7 qualifies because masking it gives `50005000H`; the other bits need not
be zero. If that same word occupied word 6's position slot, it would not end the
polyline. Only after a legal termination can word 8 be interpreted as a new
command.

Finally, **word framing is not execution timing**. A positive-cost command of
N ticks starting at system cycle C has an execution-completion deadline of
`C + (N/2 rounded upward)`; zero-cost work completes immediately. Queued execution continues from the prior
completion deadline, not from a later observation. These intervals do not tell
how many words a packet contains or the cost of preparing and supplying them.

<a id="gpu-flat-polygons"></a>
## Flat untextured polygons — GP0(20H–23H,28H–2BH)

Use a flat untextured polygon to cover a triangle or quad with **one supplied
RGB color**. There is no texture lookup or per-vertex color interpolation.
“Flat” describes the color input, not an axis-aligned shape.

### Opcode and packet

| Opcode byte | Shape | Color operation | Total words |
|---|---|---|---|
| `20H`, `21H` | Triangle | Opaque | 4 |
| `22H`, `23H` | Triangle | Semi-transparent | 4 |
| `28H`, `29H` | Quad | Opaque | 5 |
| `2AH`, `2BH` | Quad | Semi-transparent | 5 |

Bit 3 selects four rather than three vertices; bit 1 requests semi-transparency.
Bit 0 is ignored for these untextured polygons: it neither changes the color
calculation nor adds a field. Bits 4 and 2 are clear in this entry's variants;
setting them selects Gouraud or textured polygon formats instead.

<div class="keep-together">

Supply these thirty-two-bit words to GP0 in order:

| Word | Triangle | Quad |
|---|---|---|
| 1 | `(opcode << 24) OR C` | `(opcode << 24) OR C` |
| 2 | `P0` | `P0` |
| 3 | `P1` | `P1` |
| 4 | `P2` | `P2` |
| 5 | — | `P3` |

</div>

`C` contains red in bits 7:0, green in 15:8 and blue in 23:16. Each is an
unsigned byte. Every `Pi` contains X in bits 10:0 and Y in bits 26:16, decoded
as signed eleven-bit coordinates, −1024…1023. The remaining five bits of each
halfword do not extend that range. One direct packing equation is:

```text
C = R OR (G << 8) OR (B << 16)
P = (X AND 07FFH) OR ((Y AND 07FFH) << 16)
```

For example, X=−32 has low field `07E0H`; a sign-extended component `FFE0H`
decodes to the same X, not a different sixteen-bit position. See [Place primitives across coordinate boundaries](#gpu-coordinate-placement) for drawing-offset and placement
rules.

There is no second color, U/V word, size word or terminator. The last required
position completes the packet; the following word begins the next command.
Omitting a position does not shorten the packet: the next word is consumed as
that missing position even if its high byte resembles another opcode.

### Drawing state and geometry

The quad executes triangles **(0,1,2), then (2,1,3)**, both using C. Supply the
corners for that split, not an arbitrary perimeter order. Each triangle has its
own size, area and coverage tests. Overlapping halves can write the same pixel
twice; the GPU does not repair the four positions into a nonoverlapping outline.

The packet uses the current drawing environment without replacing its values.
At draw emission it retains the draw mode, texture window, drawing bounds,
drawing offset, mask mode, Y-address gate and row-suppression parity. Later
changes do not reinterpret that emitted draw. No texture-page field is present
in this packet. The GP0 packet also has no Z, W or GTE operation: projection,
lighting, any three-dimensional clipping and draw ordering must already have
provided the desired positions, color and sequence.

Apply the named **coordinate placement** and **shared-edge** rules, rather than
assuming a bounding rectangle is filled. In particular:

- Each triangle's inclusive source span must fit 1024 by 512; larger triangles
  are rejected before drawing-area clipping can hide the excess.
- Accepted triangles receive the common coordinate shift described under
  [Place primitives across coordinate boundaries](#gpu-coordinate-placement), then drawing-area clipping.
  The drawing area's programmed right and bottom limits are inclusive.
- A zero-area triangle writes nothing. Both nonzero windings are accepted;
  reversing winding is not a backface-culling request.
- Coverage tests integer samples with the shared-edge tie rule. Mask protection
  or retained row suppression can subsequently remove otherwise covered writes.

For this family, a set dither-enable bit does **not** dither the color. Drop
three low bits from each RGB byte to obtain the five-bit source channels.
Opaque variants replace the eligible destination RGB. Semi-transparent variants
blend that quantized source using the draw-mode blend selection; no texture
bit is needed to enable their blend. Destination-mask checking can suppress
an entire write, and force-mask controls stored bit 15 separately from RGB.

### Complete packet and exact result

Assume the drawing area is `(0,0)` through `(63,31)`, the drawing offset is zero,
no row parity is suppressed, and destination protection and force-mask are off.
Select additive blend mode 1; leave dither enabled to demonstrate that it does
not affect this flat family. Before each trial below, initialize the affected
destination words to `1882H`, RGB5=(2,4,6). These are programmed-state and memory
preconditions, not extra fields in the polygon packet.

This opaque quad supplies RGB bytes (124,100,160):

| Word | Raw input | Meaning |
|---|---|---|
| 1 | `28A0647CH` | Opaque flat untextured quad; C=`A0647CH` |
| 2 | `00180028H` | P0=(40,24) |
| 3 | `0018002EH` | P1=(46,24) |
| 4 | `001A0028H` | P2=(40,26) |
| 5 | `001A002EH` | P3=(46,26) |

The source channels are `(124>>3,100>>3,160>>3)`=(15,12,20), so the stored RGB
word is `15 OR (12<<5) OR (20<<10)` = **`518FH`**. Bit 15 is zero. The opaque
opcode ignores the selected additive blend operation, and enabled dithering
does not vary this result between destination phases.

Using the sample ownership derived in [Predict shared-edge and joint writes](#gpu-shared-edges):

| Y | Triangle (0,1,2) writes X | Triangle (2,1,3) writes X |
|---|---|---|
| 24 | 40,41,42,43,44,45 | None |
| 25 | 40,41,42 | 43,44,45 |

All twelve samples finish at `518FH`; other samples remain unchanged. The
on-diagonal sample (43,25) belongs only to the second triangle. For a triangle
instead, change word 1 to `20A0647CH` and omit word 5: only the first triangle's
nine samples are written.

In a separate trial from the same `1882H` background, change only word 1 to
`2AA0647CH`. Additive blending gives RGB5=(17,16,26), hence **`6A11H`** at each
of the twelve samples. The shared diagonal does not receive a second addition.
`29H` is equivalent to `28H`, and `2BH` to `2AH`, because bit 0 is ignored.
For an opaque trial with force-mask enabled the result is `D18FH`; if instead
destination protection is enabled and an old destination is `9882H`, that
entire old word remains unchanged.

### Command cost

Flat untextured setup is **46 command ticks for a triangle, 82 for a quad**,
plus one geometric work estimate for each triangle in its split. For timing,
use ordinary decoded vertex-plus-offset sums, not the later raster common
coordinate shift. An oversized source span or empty drawing area contributes
zero work. Otherwise clamp each vertex to the inclusive drawing bounds and
start with `p = absolute-double-area >> 1`. If semi-transparency **or**
destination-mask checking is enabled, add `(p+1)>>1`; if a row parity is
suppressed, halve the resulting estimate by a right shift. This is an estimate,
not a count of covered or successfully stored pixels.

Neither clipping nor those modifiers apply in the opaque packet's example.
Each triangle has absolute double area 12 and contributes p=6:

| Variant under the example's state | Tick calculation | Command interval |
|---|---|---|
| Opaque triangle | `46+6=52` | 26 system cycles |
| Opaque quad | `82+6+6=94` | 47 system cycles |
| Semi-transparent quad | `82+9+9=100` | 50 system cycles |

The first triangle actually covers nine samples and the second three, although
their work estimates are both six. An in-area collinear triangle contributes
zero work but still has its 46-tick setup. Convert ticks to the execution
completion deadline using [Frame the GP0 command stream](#gpu-command-stream). These intervals do
not include CPU packet preparation or input-store waits, and do not acknowledge
local-memory presentation or display completion.

<a id="gpu-gouraud-polygons"></a>
## Gouraud untextured polygons — GP0(30H–33H,38H–3BH)

Use this family when each vertex supplies its own RGB color and no texture lookup is required. The GPU interpolates three color planes across each triangle, quantizes the resulting RGB bytes to RGB555, then applies the selected pixel-write rules.

| Opcode bytes | Primitive | Blend request | Packet words |
|---|---|---|---|
| `30H`,`31H` | Triangle | Off | 6 |
| `32H`,`33H` | Triangle | On | 6 |
| `38H`,`39H` | Quad | Off | 8 |
| `3AH`,`3BH` | Quad | On | 8 |

Within each pair, bit 0 has no color-mode effect because texturing is absent. Bit 4 selects Gouraud color, bit 3 selects the quad, bit 2 is clear, and bit 1 requests semitransparency. Do not insert texture or CLUT words.

The complete word order is:

```text
Triangle: (opcode<<24) OR C0, P0, C1, P1, C2, P2
Quad:     (opcode<<24) OR C0, P0, C1, P1, C2, P2, C3, P3
```

This is packet notation, not cartridge-language code. Each C contains R in bits 7:0, G in 15:8 and B in 23:16, as unsigned bytes. Only the first word's high byte selects an opcode; bits 31:24 of C1–C3 are ignored as color data, even when they resemble a drawing-environment command. The next word after the sixth/eighth starts a new command; there is no terminator.

Each P consumes signed eleven-bit X in bits 10:0 and Y in 26:16, range −1024…1023. The remaining five bits in each halfword do not extend its coordinate. Drawing offsets, per-triangle span rejection, triangle coordinate shifting, drawing-area clipping and retained row suppression follow [Place primitives across coordinate boundaries](#gpu-coordinate-placement). A quad uses triangles (0,1,2) then (2,1,3), with each half constructing its own color planes; it is not four-corner bilinear shading.

The calculation follows [Predict interpolated colors and texture coordinates](#gpu-interpolation): derivatives are determinant quotients truncated toward zero, retained as twenty-bit words with twelve fractional bits. Signed twenty-bit derivatives form the biased intercept; readout extracts bits 19:12 as the RGB byte. Attribute overflow wraps in that finite field rather than clamping to a byte. Do not replace it with a fresh floating-point interpolation. Gouraud untextured polygons are eligible for draw-mode dithering; after any eligible dither, byte saturation and the three-bit reduction produce the five-bit blend source.

### Worked six-word triangle

Use zero drawing offset, inclusive drawing area X=40…44,Y=24…28, no skipped-row parity, dithering off and mask-mode low bits zero. Supply these GP0 words in order:

| Word | Raw word | Operand |
|---|---|---|
| 1 | `30C8280AH` | Triangle, opaque; C0 RGB=(10,40,200) |
| 2 | `00180028H` | P0=(40,24) |
| 3 | `E12878FAH` | C1 RGB=(250,120,40) |
| 4 | `0018002CH` | P1=(44,24) |
| 5 | `E250C832H` | C2 RGB=(50,200,80) |
| 6 | `001C0028H` | P2=(40,28) |

Words 3 and 5 do **not** execute E1/E2 commands. For this triangle, determinant D=16 and the plane anchor is vertex 0. The plane construction gives these raw twenty-bit quantities:

| Channel | X-step word | Y-step word | Intercept |
|---|---|---|---|
| R | `3C000H` | `0A000H` | `BA800H` |
| G | `14000H` | `28000H` | `48800H` |
| B | `D8000H` | `E2000H` | `D8800H` |

The blue steps represent −40×4096 and −30×4096. These intercepts include the half-color-unit bias, not a half-pixel coverage shift. At covered pixel `(41,25)`, plane evaluation gives `50800H,64800H,82800H`; extracting bits 19:12 yields RGB=(80,100,130). With dithering off, reduction gives RGB5=(10,12,16), packed `418AH`. The opaque, unchecked, unforced write replaces an existing `FFFFH` there with **`418AH`**, clearing its old bit 15.

The command-work setup is `46+288=334` ticks. Its unclipped determinant gives estimated work `16>>1=8`, so total cost is **342 command ticks**, or 171 scheduled system cycles. Selecting `32H` or `33H` instead requests blending and makes the work estimate `8+((8+1)>>1)=12`, for 346 ticks/173 cycles with the other state unchanged. Its stored RGB then follows the configured blend calculation, not the opaque result above. These intervals exclude CPU packet preparation/issue and do not count exact stored pixels.

### State and result boundary

The command retains draw mode, the Y-address-extension value, texture window, drawing bounds/offset, mask mode and skipped-row parity when emitted. Later state changes do not reinterpret that retained command. This untextured packet contains no environment update or texture-page selection. Semitransparent variants blend the five-bit source; mask checking can reject the write, and force-mask determines whether untextured output bit 15 is set instead of zero.

For general costs, the Gouraud setup is 334 ticks per triangle command or 370 per quad command, plus the separate triangle work estimates described in [Budget command work separately from issuing words](#gpu-command-costs). Timing uses ordinary signed-eleven-bit position-plus-offset sums, not the raster triangle shift.

A GTE result is not an extra packet field: supply the resulting screen XY and RGB in the listed words. The first color word still needs the selected GP0 opcode in its high byte; a packed color result is not already a GPU command. Projection, lighting, near-plane clipping and depth-order selection precede this primitive; it has no Z/W input, perspective correction or depth comparison.

<a id="gpu-flat-textured-polygons"></a>
## Flat textured polygons — GP0(24H–27H,2CH–2FH)

These commands supply one RGB color and a U/V pair at each vertex. “Flat” means
one supplied color, **not** one texture coordinate or one fetched texel. U/V
still use the finite affine planes described in [Predict interpolated colors and texture coordinates](#gpu-interpolation). Each covered sample performs one point lookup.

### Opcode and complete packet

| Triangle opcode | Quad opcode | Texture color | Semi-transparency request |
|---|---|---|---|
| `24H` | `2CH` | Modulated by supplied RGB | Off |
| `25H` | `2DH` | Raw fetched RGB555 | Off |
| `26H` | `2EH` | Modulated by supplied RGB | On |
| `27H` | `2FH` | Raw fetched RGB555 | On |

Bit 3 selects a quad, bit 2 is set for texture, bit 1 requests semi-transparency,
and bit 0 selects raw rather than modulated texture. Unlike untextured polygon
bit 0, it is meaningful here. Bit 4 is clear: no per-vertex colors are supplied.

| Word | Triangle: seven words | Quad: nine words |
|---|---|---|
| 1 | `(opcode << 24) OR C` | `(opcode << 24) OR C` |
| 2 | P0 | P0 |
| 3 | T0 | T0 |
| 4 | P1 | P1 |
| 5 | T1 | T1 |
| 6 | P2 | P2 |
| 7 | T2 | T2 |
| 8 | — | P3 |
| 9 | — | T3 |

C contains unsigned R/G/B bytes in bits 7:0/15:8/23:16. Each P contains signed
eleven-bit X in bits 10:0 and Y in 26:16; the other five bits of each halfword
do not extend the coordinate. Each T contains unsigned U in bits 7:0, V in
15:8, and an attribute in 31:16. Raw texture still requires the complete packet,
including C and every T; ignoring C for color does not remove its word.

There is no terminator. T2, or T3 for a quad, finishes the packet. A quad uses
triangles (0,1,2), then (2,1,3), carrying each vertex's own UV. The coordinate,
size-rejection and shared-edge rules are the same as in [Flat untextured polygons](#gpu-flat-polygons); an arbitrary four-corner outline is not repaired into a different
split.

### T0 selects the palette; T1 changes persistent drawing state

T0's upper half is the CLUT attribute:

```text
CLUT base X = (attribute AND 003FH) × 16 raw words
CLUT base Y = (attribute >> 6), decoded through the Y-address gate
```

T1's upper half supplies these drawing-mode fields:

| Attribute bits | Meaning |
|---|---|
| 3:0 | Texture-page base X in units of 64 raw words |
| 4 | Add 256 to texture-page base Y |
| 6:5 | Blend selection |
| 8:7 | Texture depth: 0 palette4, 1 palette8, 2 or 3 direct sixteen-bit |
| 11 | Add 512 to texture-page base Y |

The page Y result is decoded through the Y-address gate. Other T1 attribute
bits do not participate in the update:

```text
new draw mode = (old draw mode AND NOT 09FFH)
                OR (T1 attribute AND 09FFH)
```

This changes the **persistent** draw mode before taking this polygon's own
state snapshot. Bits 9,10,12,13 survive: dither enable, draw-to-displayed-field
and rectangle X/Y flips are not supplied anew by T1. T2/T3 upper halves are
ignored; their low U/V bytes remain required. None of these words starts an
independent GP0 command, even if its high byte resembles E1.

The emitted polygon retains its resulting draw mode and the current texture
window, area, offset, mask mode, Y gate and skipped-row parity. Later state
changes do not reinterpret it. Conversely, its T1 page update remains current
for later commands. A textured rectangle's T0 selects its CLUT, **not** a new
page: it inherits the current page, depth, blend selection and flip settings.

After U/V plane extraction, apply texture-window replacement and the lookup
rules in [Locate texture texels and palette colors](#gpu-texture-lookup). Palette4 selects a nibble
from a packed word, palette8 selects a byte, and depths 2/3 fetch a direct word.
Both packed-source X and CLUT X wrap within their respective raw rows. A palette
index of zero is not intrinsically transparent; the fetched color word decides.

### Worked seven-word triangle

Use zero drawing offset, identity texture window, an open Y-address gate,
drawing area `(0,0)` through `(63,31)`, no row suppression and mask mode zero.
Initially program draw mode **`3742H`**. Its dither, draw-to-displayed-field and
both rectangle-flip bits are set; its old page/depth/blend fields will change.
Initialize the destination region used below to **`0C41H`**, RGB5=(1,2,3).

Declare these existing raw local-memory contents before drawing. They are source
words, not an upload packet or a suggested loading API:

| Raw coordinate | Sixteen-bit source word |
|---|---|
| (61,Y), for every Y=773…776 | `1514H` |
| (62,Y), for every Y=773…776 | `1716H` |
| (61,772) | `1415H` |
| (4,500) | `6208H` |
| (5,500) | `E208H` |
| (6,500) | `0000H` |
| (7,500) | `8000H` |

No sampled source coordinate is left unspecified, and these source regions do
not overlap the destination. Supply this complete polygon packet:

| Word | Raw input | Meaning |
|---|---|---|
| 1 | `26C08040H` | Modulated, semi-transparent triangle; RGB=(64,128,192) |
| 2 | `00180028H` | P0=(40,24) |
| 3 | `7D3F05FAH` | T0: U0=250,V0=5; CLUT attribute=`7D3FH` |
| 4 | `0018002CH` | P1=(44,24) |
| 5 | `08BF05FEH` | T1: U1=254,V1=5; page attribute=`08BFH` |
| 6 | `001C0028H` | P2=(40,28) |
| 7 | `E10009FAH` | T2: U2=250,V2=9; ignored upper half=`E100H` |

The CLUT attribute gives base (1008,500). T1 selects page (960,768), palette8
and additive blend selection 1. The merge is
`(3742H AND NOT 09FFH) OR 08BFH = 3EBFH`; preserved bits are `3600H`.
Word 7 does **not** overwrite this state with an E1 command.

The UV planes have exact steps of one texel per destination pixel: at covered
integer samples, U=`250+(X−40)` and V=`5+(Y−24)`. The inherited rectangle flips
do not reverse polygon planes. On row Y=24 the lookups are:

| Destination X | U,V | Packed raw coordinate | Selected index | CLUT coordinate | Fetched word |
|---|---|---|---|---|---|
| 40 | 250,5 | (61,773) | 20 | (4,500) | `6208H` |
| 41 | 251,5 | (61,773) | 21 | (5,500) | `E208H` |
| 42 | 252,5 | (62,773) | 22 | (6,500) | `0000H` |
| 43 | 253,5 | (62,773) | 23 | (7,500) | `8000H` |

For X=40, `960+(250>>1)=1085`, which wraps to raw X=61 without changing row
773. Its low byte selects index 20. Then `1008+20=1028` wraps to CLUT X=4
without changing row 500. The packed `1514H` holds indices 20 and 21, not two
RGB555 colors.

Sample `6208H` has RGB5=(8,16,24). Modulation by (64,128,192) first gives
products `(32,128,288)`. At (40,24), dither −4 gives source RGB5=(3,15,31),
word **`7DE3H`**. This fetched sample has bit 15 clear, so it stays opaque even
though the command requests semi-transparency. At (41,24), fetched `E208H` has
the same RGB but bit 15 set: dither zero gives source (4,16,31), additive
blending over (1,2,3) gives (5,18,31), and retained sample bit 15 makes the final
word **`FE45H`**.

`0000H` skips the write entirely. `8000H` is nonzero black: at (43,24) its
modulated source remains black, additive blending preserves background RGB,
but stored sample bit 15 changes the result to **`8C41H`**. The exact completed
triangle is:

| Y | X=40 | X=41 | X=42 | X=43 |
|---|---|---|---|---|
| 24 | `7DE3H` | `FE45H` | `0C41H` (zero sample) | `8C41H` |
| 25 | `7E04H` | `FE24H` | `0C41H` (zero sample) | — |
| 26 | `7DE3H` | `FE45H` | — | — |
| 27 | `7E04H` | — | — | — |

Dashes are outside coverage and remain unchanged. There are ten covered samples,
two fetched-zero skips and eight writes. For the full gain/dither arithmetic
and write-protection rules, use **Choose texture gain and dither deliberately**
and **Separate texture transparency, blending and destination protection**.
In particular, force-mask does not make a bit-15-clear texture sample blend,
and even force-mask cannot turn fetched `0000H` into a write.

In a separate trial from the original background, change only word 1 to
`27C08040H`. Raw texture ignores the supplied gain and bypasses dithering:
(40,24) becomes `6208H`; (41,24) blends raw RGB5=(8,16,24) over the background
and becomes **`EE49H`**. Semi-transparency and stored-bit selection still apply.
Use modulation color (128,128,128) for exact unit gain **with dithering off**;
(255,255,255) is not neutral.

### A later rectangle inherits the changed page and preserved flips

With no intervening drawing-mode change, send:

```text
66C08040H  00180030H  7D3F05FBH  00020002H
```

This is a two-by-two semi-transparent modulated textured rectangle at (48,24),
starting U/V=(251,5), using the same CLUT and RGB. Its sole texture word contains
no page replacement. Current `3EBFH` therefore supplies palette8, page(960,768),
additive blending and both flips. U advances 251→250; V advances 5→4. Row V=4
uses declared raw word `1415H`, reversing the two palette indices. Rectangles
do not dither, despite retained dither enable:

| Destination row | X=48 | X=49 |
|---|---|---|
| 24 | `FE45H` | `7E04H` |
| 25 | `7E04H` | `FE45H` |

Thus T1 was not a temporary material choice, and the polygon did not clear flip
state merely because it did not use it. Program the intended drawing mode before
a later material that requires different state.

### Command cost

Flat textured setup is 226 ticks for a triangle or 262 for a quad, followed by
the per-triangle work estimates in **Budget command work separately from issuing
words**. Raw texture receives no setup/work discount. This triangle has absolute
double area 16, giving p=8, then 16 for texture and 24 for semi-transparency:
`226+24=250` ticks, a 125-system-cycle command interval. The opaque `24H`/`25H`
variants instead take `226+16=242` ticks, or 121 cycles, under the same state.
Neither fetched-zero skips nor the actual eight stores reduce that estimate.
CPU issue work, readback readiness and presentation completion remain separate.

<a id="gpu-gouraud-textured-polygons"></a>
## Gouraud textured polygons — GP0(34H–37H,3CH–3FH)

Use this family when each vertex supplies RGB material gains as well as texture
coordinates. Modulated commands interpolate RGB and U/V across each triangle;
raw commands retain the same packet layout but take the unmodulated source
color from the texture.

### Opcode and complete packet

| Opcode | Primitive | Texture color | Blend request | Words |
|---|---|---|---|---:|
| `34H` | Triangle | Modulated | Off | 9 |
| `35H` | Triangle | Raw | Off | 9 |
| `36H` | Triangle | Modulated | On | 9 |
| `37H` | Triangle | Raw | On | 9 |
| `3CH` | Quad | Modulated | Off | 12 |
| `3DH` | Quad | Raw | Off | 12 |
| `3EH` | Quad | Modulated | On | 12 |
| `3FH` | Quad | Raw | On | 12 |

The opcode has Gouraud bit 4 and texture bit 2 set. Bit 3 selects a quad, bit 1
requests semitransparency, and bit 0 selects raw texture. Supply complete GP0
words in this order:

```text
Triangle: (opcode<<24) OR C0, P0,T0, C1,P1,T1, C2,P2,T2
Quad:     (opcode<<24) OR C0, P0,T0, C1,P1,T1, C2,P2,T2, C3,P3,T3
```

Each C contains unsigned R/G/B bytes in bits 7:0, 15:8 and 23:16. Only the first
word's high byte selects a command; the high byte of C1–C3 is ignored. Each P
contains signed eleven-bit X in bits 10:0 and Y in 26:16; the other five bits in
each halfword do not extend the coordinate. Each T contains unsigned U in bits
7:0 and V in 15:8, with the upper half interpreted below.

**Raw mode does not remove the color words.** C1 and C2 remain words 4 and 7;
in a quad C3 remains word 10. Omitting them makes subsequent positions and
texture words occupy the wrong fields. There is no terminator after word 9 or
12. These are packet fields, not a BLua data-loading API.

A quad draws triangles `(0,1,2)` then `(2,1,3)`, preserving each vertex's C/P/T
association. Each half has its own affine planes; this is not bilinear shading
of four corners. Geometry, inclusive drawing-area clipping and row suppression
follow [Place primitives across coordinate boundaries](#gpu-coordinate-placement)
and [Predict shared-edge and joint writes](#gpu-shared-edges).

### CLUT, persistent T1 state and retained operands

T0's upper half is the CLUT attribute: base X is `(attribute AND 3fH)×16` raw
words, and base Y is `attribute>>6` through the retained Y-address gate. Palette
lookup uses that base; direct16 depth does not use the CLUT.

T1's upper half is the texture-page attribute. It is word **6** here, not word 5
as in a flat-textured packet. Its selected fields are:

| Attribute bits | Selection |
|---|---|
| 3:0 | Page X in units of 64 raw words |
| 4 | Page Y contribution of 256 |
| 6:5 | RGB blend mode 0–3 |
| 8:7 | Texture depth: 0 palette4; 1 palette8; 2 or 3 direct16 |
| 11 | Page Y contribution of 512, subject to the Y-address gate |

The update is persistent:

```text
new draw mode = (old draw mode AND NOT 09ffH) OR (T1 attribute AND 09ffH)
```

It preserves draw-mode bits 9, 10, 12 and 13. Other T1 attribute bits do not
change them; T2/T3 upper halves do not select further pages. The update happens
**before this polygon's own environment snapshot**, so it affects both this
polygon and later commands that use current draw mode, including textured
rectangles. Restore the desired page/blend/depth state explicitly when the next
material differs.

At emission, the polygon retains the resulting draw mode, Y extension, texture
window, drawing-area corners, drawing offset, mask mode and skipped-row parity.
Later state writes do not reinterpret those operands. The command changes no
other drawing-environment register; eligible covered pixels change local memory
through the retained mask/blend rules.

### Attribute and pixel calculation

The finite planes are those in
[Predict interpolated colors and texture coordinates](#gpu-interpolation):
determinant quotients truncate toward zero, steps/intercepts occupy twenty bits
with twelve fractional bits, and readout takes bits 19:12. The half-attribute
bias does not move coverage. Modulated mode evaluates all five R/G/B/U/V planes;
raw mode ignores RGB for output but still evaluates U/V. There is no Z/W term,
perspective correction, filtering or mip-level selection in this point sample.

U/V then undergo texture-window replacement and the page/CLUT lookup in
[Locate texture texels and palette colors](#gpu-texture-lookup). A fetched
`0000H` skips the pixel; `8000H` is nonzero black, not transparent. Modulation
uses each five-bit texel component t and interpolated byte c:

```text
p = (t×c) >> 4
source component = 0,                         if p+d < 0
                 = min((p+d)>>3, 31),         otherwise
```

Here d is the eligible destination-position dither offset, or zero with dithering
off. Byte 128 is exact unit gain **with dithering off**, not byte 255. Modulated
Gouraud-textured polygons are eligible for draw-mode dithering; raw texturing
bypasses both modulation and dithering. See
[Choose texture gain and dither deliberately](#gpu-color-dither).

A semitransparent opcode blends only when the fetched nonzero texel also has
bit 15 set. Otherwise that pixel is opaque. Blending uses the quantized RGB5
source, not interpolated RGB bytes. Destination check-mask can suppress the
write; force-mask sets output bit 15 but does not make an unmarked texel blend.
Without force-mask, output bit 15 copies the fetched texel. The independent zero,
blend and destination-protection rules are in
[Separate texture transparency, blending and destination protection](#gpu-blending-mask).

### Worked nonconstant nine-word triangle

Declare the following initial state and memory; no upload packet is implied:

- Drawing offset zero; inclusive drawing area X=0…255,Y=0…191; no skipped rows;
  Y-address extension zero; texture-window word zero; mask mode zero.
- Current draw mode `3709H`. Its dither/draw-to-displayed-field/flip bits are set;
  the flip bits are preserved but do not flip triangle U/V planes.
- Every raw texture word at X=192…200,Y=5…23 is `2525H`.
  Raw CLUT word `(229,100)` is `F194H`, RGB5=(20,12,28), bit 15 set.
- All destination words covered by this triangle initially contain `A505H`,
  RGB5=(5,8,9), bit 15 set. Check-mask is off, so that old bit does not protect them.

Supply these nine words:

| Word | Raw word | Operand |
|---|---|---|
| 1 | `36C08040H` | Triangle, modulated, semitransparent; C0=(64,128,192) |
| 2 | `00180028H` | P0=(40,24) |
| 3 | `190C0503H` | T0: U/V=(3,5), CLUT attribute 190cH |
| 4 | `E18040C0H` | C1=(192,64,128); high E1H is not a command |
| 5 | `0018002FH` | P1=(47,24) |
| 6 | `00A30711H` | T1: U/V=(17,7), page attribute 00a3H |
| 7 | `E240C080H` | C2=(128,192,64); high E2H is not a command |
| 8 | `001E0028H` | P2=(40,30) |
| 9 | `BEEF1709H` | T2: U/V=(9,23); upper half ignored |

T1 changes draw mode to `(3709H AND NOT 09ffH) OR 00a3H = 36a3H`: page X=192,
Y=0, palette8, additive blend mode 1. CLUT attribute 190cH gives base `(192,100)`.
The triangle determinant is 42 and its plane anchor is vertex 0. The retained
plane quantities are:

| Attribute | X-step word | Y-step word | Intercept |
|---|---|---|---|
| R | `12492H` | `0AAAAH` | `65140H` |
| G | `F6DB7H` | `0AAAAH` | `EE378H` |
| B | `F6DB7H` | `EAAABH` | `2E360H` |
| U | `02000H` | `01000H` | `9B800H` |
| V | `00492H` | `03000H` | `B2130H` |

For example, the R steps are `trunc(4096×128/7)=74898` and
`trunc(4096×64/6)=43690`; the negative G/B steps use the same toward-zero rule.
Evaluating covered pixel `(42,26)` gives **RGB=(122,131,131), U/V=(9,12)**.
The identity texture window leaves U/V unchanged. Palette8 fetches raw word
`(192+(9>>1),12)=(196,12)`, takes its high byte `25H`, then reads CLUT
`(192+37,100)=(229,100)`: sample `F194H`.

The destination's dither phase is `(2,2)`, giving d=−4. The three first-stage
products are `(20×122)>>4=152`, `(12×131)>>4=98` and `(28×131)>>4=229`.
After adding −4 and shifting right three, the source is RGB5=(18,11,28).
Both the opcode request and sample bit 15 permit blending. Additive mode gives
`min((5,8,9)+(18,11,28),31)=(23,19,31)`, and the copied sample bit 15 produces
**`FE77H`**.

A neighboring covered pixel proves the gains are not constant: `(43,26)` has
RGB=(140,122,122), U/V=(11,12), d=0 and foreground RGB5=(21,11,26).
It fetches the same CLUT color through packed word `(197,12)` but stores
**`FE7AH`** over the declared destination.

Starting each contrast from the same initial destination:

| Change at (42,26) | Stored result | Reason |
|---|---|---|
| Opcode `34H` instead | `F172H` | Modulated/dithered source replaces RGB; no blend request |
| Opcode `37H` instead | `FE99H` | RGB fields still present but ignored; raw source (20,12,28) blends |
| CLUT color `7194H` instead, opcode 36H | `7172H` | Same modulated RGB, but fetched bit 15 clear prevents blending |

### Command cost

This Gouraud-textured family has setup `46+288+162=496` ticks for a triangle or
`82+288+162=532` for a quad, followed by the separate triangle work estimates in
[Budget command work separately from issuing words](#gpu-command-costs).
Raw mode does not remove the textured or Gouraud setup charges.

For the worked triangle there is no clipping or row skipping. Estimated work is
`abs(42)>>1=21`, doubled for texturing to 42, then increased for the blend request
to `42+((42+1)>>1)=63`. Total cost is **559 command ticks**, or **280 scheduled
system cycles** from execution start. The raw 37H contrast has that same cost.
The opaque 34H contrast instead costs `496+42=538` ticks, or 269 cycles. Clearing
the fetched sample bit 15 does not remove the semitransparent opcode's work
surcharge. These estimates are not counts of stored pixels and exclude CPU
packet preparation/issue; timing coordinates use ordinary signed-eleven-bit
position-plus-offset sums, not the raster triangle's common coordinate shift.

<a id="gpu-finite-lines"></a>
## Finite flat and Gouraud lines — GP0(40H–47H,50H–57H)

A finite line supplies exactly two endpoints. Flat color uses one RGB value for both; Gouraud color supplies a separate RGB value with each endpoint. Neither form has texture operands.

| Opcode bytes | Color form | Blend request | Packet words |
|---|---|---|---|
| `40H`,`41H`,`44H`,`45H` | Flat | Off | 3 |
| `42H`,`43H`,`46H`,`47H` | Flat | On | 3 |
| `50H`,`51H`,`54H`,`55H` | Gouraud | Off | 4 |
| `52H`,`53H`,`56H`,`57H` | Gouraud | On | 4 |

Bit 4 selects Gouraud color, bit 3 is clear for these finite forms, and bit 1 requests semitransparency. Bits 2 and 0 do not add texture fields or select raw color: all four opcodes in each row have the same operand layout and color behavior.

```text
Flat:    (opcode<<24) OR C0, P0, P1
Gouraud: (opcode<<24) OR C0, P0, C1, P1
```

This is packet notation, not cartridge-language code. C uses unsigned R/G/B bytes in bits 7:0/15:8/23:16. C1's high byte is ignored, not decoded as another command. P consumes signed eleven-bit X in bits 10:0 and Y in 26:16; the other bits in each halfword do not extend its range. There is **no terminator**. After the third/fourth word, the next whole word starts a new command.

### Endpoint order, samples and color lifetime

The calculation is the one in [Predict line samples and color ramps](#gpu-line-sampling). If the first endpoint has greater X, the GPU exchanges **both endpoints and their associated colors**. Equal-X vertical lines retain their supplied order: there is no corresponding normalization to upward or downward traversal. Reversing such a line can change a quantized color tie, as the vertical reversal example in that lesson demonstrates.

After ordinary drawing-offset sums, reject source spans exceeding 1024×512 inclusive. The accepted segment generates `max(abs(dx),abs(dy))+1` samples, including both endpoints; an accepted zero-length segment generates one. Positions use the specified outward-rounded Q32 steps/biases, while Gouraud bytes use biased Q12 accumulators and truncated color steps. Generated positions wrap to signed eleven bits before drawing-area and row-suppression tests. Neither clipping nor skipped rows restarts the original color ramp.

For a concrete clipped, descending-Y Gouraud line, use zero offset, inclusive area X=10…14,Y=7…10, retained suppression of odd rows, dithering off and mask-mode low bits zero:

| Word | Raw word | Operand |
|---|---|---|
| 1 | `5528C814H` | Opaque Gouraud; first RGB=(20,200,40) |
| 2 | `0005000EH` | First endpoint (14,5) |
| 3 | `E1B414DCH` | Second RGB=(220,20,180), not an E1 command |
| 4 | `000C000AH` | Second endpoint (10,12) |

Opcode `55H` deliberately has both ignored bits set. X ordering makes the working start `(10,12)` with RGB=(220,20,180), and the end `(14,5)` with RGB=(20,200,40). N=7 gives eight generated samples. The Q12 RGB steps are −117028,+105325,−81920. Of the samples at original indices 0…7, the area admits indices 2…5; odd-row suppression removes indices 3 and 5:

| Original sample index | Destination | RGB byte readout | Stored RGB555 word |
|---|---|---|---|
| 2 | (11,10) | (163,71,140) | `4514H` |
| 4 | (12,8) | (106,123,100) | `31EDH` |

The intervening rejected samples still advance every accumulator. These two opaque, unchecked, unforced writes replace their old words and write bit 15 clear.

### Flat lines also dither

The draw-mode dither setting applies to **flat as well as Gouraud lines**. As a separate example, enable dithering, disable row suppression and use area X=16…19,Y=20, zero offset and mask-mode low bits zero. The complete flat packet is:

```text
450F0807H, 00140010H, 00140013H
```

Its RGB=(7,8,15) is constant, but absolute destination phases produce different words:

| Destination | Dither offset | RGB555 word |
|---|---|---|
| (16,20) | −4 | `0400H` |
| (17,20) | 0 | `0420H` |
| (18,20) | −3 | `0400H` |
| (19,20) | +1 | `0821H` |

The common offset is added to each byte, saturated to 0…255, then reduced by three bits. It is not a per-line phase restarted at the first endpoint, and blending uses the resulting five-bit source.

### State and command cost

Draw state is retained when the complete command is emitted; later environment changes do not reinterpret it. Semitransparent forms blend admitted source pixels against their current destination. Mask checking can suppress the write; force-mask sets output bit 15, otherwise these untextured lines write zero there. The packet itself contains no drawing-environment update.

Finite-line command work is the clipped **source bounding-box** estimate, not the generated or stored-sample count. Use ordinary signed-eleven-bit position-plus-offset sums, reject excessive source spans, and intersect the inclusive source bounding rectangle with the drawing area. Empty work costs zero ticks. Otherwise, with clipped dimensions W/H, active row suppression changes H to `max(1,H>>1)` and work is `max(W,H)`. Flat/Gouraud choice does not add a separate setup term.

For the first packet, the source box is 5×8, clipped to 5×4. Skipping changes the timing height to 2, but `max(5,2)=5`: **five ticks/three scheduled system cycles**, despite only two stored samples. Without skipping it still costs five ticks, although four samples survive clipping. The flat dither example costs four ticks/two cycles. A nonempty zero-length finite line costs one tick, even if row suppression prevents its one store. These are queued command intervals, not CPU packet-supply time or physical raster bandwidth; finite lines do not acquire a polyline's initial 16-tick setup.

<a id="gpu-polylines"></a>
## Flat and Gouraud polylines — GP0(48H–4FH,58H–5FH)

A polyline starts with two endpoints, then adds one segment for each complete continuation vertex. Flat color retains one RGB value throughout; Gouraud color supplies a new RGB value with each new endpoint.

| Opcode bytes | Color form | Blend request | Initial words | Words per added vertex |
|---|---|---|---|---|
| `48H`,`49H`,`4CH`,`4DH` | Flat | Off | 3 | 1 |
| `4AH`,`4BH`,`4EH`,`4FH` | Flat | On | 3 | 1 |
| `58H`,`59H`,`5CH`,`5DH` | Gouraud | Off | 4 | 2 |
| `5AH`,`5BH`,`5EH`,`5FH` | Gouraud | On | 4 | 2 |

Bit 4 selects Gouraud color, bit 3 selects continuation, and bit 1 requests semitransparency. Bits 2 and 0 neither add texture operands nor select raw color. The word order is:

```text
Flat:    (opcode<<24) OR C0, P0, P1, P2, P3, ... , terminator
Gouraud: (opcode<<24) OR C0, P0, C1, P1, C2, P2, C3, P3, ... , terminator
```

This is packet notation. Colors consume unsigned RGB bytes in bits 7:0/15:8/23:16; positions consume signed eleven-bit X/Y fields in bits 10:0/26:16. The complete initial header emits segment P0–P1 **without waiting for termination**. Flat P2 emits P1–P2 using C0 again; Gouraud C2/P2 emits the same segment using C1/C2. The previous endpoint and its color remain available for the following segment.

### Terminate at the right field boundary

After the initial header, any word satisfying this predicate is a terminator:

```text
(word AND F000F000H) = 50005000H
```

Test it only at the start of a continuation vertex: the next **position** for flat color, or the next **color** for Gouraud color. `5ABC5DEFH` qualifies. The identical word in a Gouraud continuation's position slot is position data, not a terminator. Initial-header fields are not termination boundaries either.

The complete eight-word example in [Frame the GP0 command stream](#gpu-command-stream) makes the distinction concrete:

| Word in that example | Input | Boundary meaning |
|---|---|---|
| 3 | `E10000FFH` | Initial second color; high byte ignored, not an E1 command |
| 6 | `001A002EH` | Continuation position, completing the second segment |
| 7 | `5ABC5DEFH` | Next continuation-color slot: terminates without adding a segment |
| 8 | `E1000000H` | Now a new drawing-environment command |

Moving the marker into word 6 would make it position data. Conversely, a matching full word in a continuation-color slot terminates **before** its low 24 bits can become a color. An opcode-looking or NOP-looking continuation word is not an escape to a command boundary.

There is no fixed total polyline word count. Omitting termination leaves the continuation phase open; supplying a Gouraud color without its position leaves that pair unfinished. A pause while buffered words drain does not discard the retained endpoint. Termination does not undo segments already emitted. Each complete segment retains the drawing state present at its own emission; it does not wait for a final whole-polyline state snapshot.

### Count the joint twice when blending

Every segment uses the finite-line calculation in [Predict line samples and color ramps](#gpu-line-sampling): X ordering exchanges endpoints and their associated colors, equal-X order is retained, and an accepted segment generates `max(abs(dx),abs(dy))+1` samples. Generated positions wrap to signed eleven bits before area/row tests. Clipping or row suppression does not restart a color ramp. Dithering, if enabled, applies to flat as well as Gouraud segments at each absolute destination phase.

For a complete flat example, use zero offset, inclusive area X=40…46/Y=30, no row suppression, dithering off, mask checking/forcing off and saturated additive blend selection 1. Initialize all seven destination words to `0000H` and supply:

| Word | Raw input | Meaning |
|---|---|---|
| 1 | `4A000020H` | Flat semitransparent polyline; RGB=(32,0,0) |
| 2 | `001E0028H` | P0=(40,30) |
| 3 | `001E002BH` | P1=(43,30); completes the initial segment |
| 4 | `001E002EH` | P2=(46,30); completes the next segment |
| 5 | `5ABC5DEFH` | Terminates at the next flat position boundary |

Each segment generates four samples, including both ends. RGB=(32,0,0) becomes RGB5=(4,0,0), word `0004H`, before blending. The first segment writes X=40…43; the second writes X=43…46. Their common endpoint receives **two additions**, not polygon-style once-only seam ownership:

| Destination X at Y=30 | 40 | 41 | 42 | 43 | 44 | 45 | 46 |
|---|---|---|---|---|---|---|---|
| Write count | 1 | 1 | 1 | 2 | 1 | 1 | 1 |
| Final word | `0004H` | `0004H` | `0004H` | `0008H` | `0004H` | `0004H` | `0004H` |

These are the results after both segments' pixel writes. The stated mask settings matter: destination protection could reject an old protected word, while forcing would set output bit 15. No sample bit 15 is needed to enable blending for these untextured lines.

### Command cost

Use the finite-line source-bounding-box estimate for each segment: ordinary decoded position-plus-offset sums, reject inclusive spans over 1024×512, then intersect with drawing bounds. Empty intersection gives zero work. Otherwise, with clipped dimensions W/H, row suppression changes H to `max(1,H>>1)` and work is `max(W,H)`.

The **initial polyline segment adds 16 setup ticks**; later continuation segments use work alone. Each example box is 4×1, giving **20 ticks/10 scheduled system cycles** for the initial segment and **4 ticks/2 cycles** for the continuation. The terminator adds no segment. An initial segment with zero work still has its 16-tick setup; a zero-work continuation does not repeat it. Gouraud color, blending and dithering add no separate line-cost term. These are queued command intervals, not CPU word-supply costs, physical raster bandwidth or presentation acknowledgement.

<a id="gpu-rectangle-packets"></a>
## Drawing rectangles — GP0(60H–7FH)

A drawing rectangle supplies one RGB color, one destination origin and either a fixed size or an explicit width/height. Textured forms add one U/V and CLUT word. There is no Gouraud rectangle: opcode bits 4:3 select size, not color interpolation.

| Size | Color source | Opaque opcode bytes | Semitransparent opcode bytes | Words |
|---|---|---|---|---|
| Variable | Untextured | `60H`,`61H` | `62H`,`63H` | 3 |
| Variable | Modulated texture | `64H` | `66H` | 4 |
| Variable | Raw texture | `65H` | `67H` | 4 |
| 1×1 | Untextured | `68H`,`69H` | `6AH`,`6BH` | 2 |
| 1×1 | Modulated texture | `6CH` | `6EH` | 3 |
| 1×1 | Raw texture | `6DH` | `6FH` | 3 |
| 8×8 | Untextured | `70H`,`71H` | `72H`,`73H` | 2 |
| 8×8 | Modulated texture | `74H` | `76H` | 3 |
| 8×8 | Raw texture | `75H` | `77H` | 3 |
| 16×16 | Untextured | `78H`,`79H` | `7AH`,`7BH` | 2 |
| 16×16 | Modulated texture | `7CH` | `7EH` | 3 |
| 16×16 | Raw texture | `7DH` | `7FH` | 3 |

Bit 2 enables texture, bit 1 requests semitransparency, and bit 0 selects raw rather than modulated texture **only when textured**. The paired untextured opcodes ignore bit 0. Raw texture ignores the supplied RGB color; modulation uses it as channel gain.

```text
Variable untextured: (opcode<<24) OR C0, P0, S
Variable textured:   (opcode<<24) OR C0, P0, T0, S
Fixed untextured:    (opcode<<24) OR C0, P0
Fixed textured:      (opcode<<24) OR C0, P0, T0
```

This is packet notation. C0 consumes unsigned RGB bytes in bits 7:0/15:8/23:16; P0 consumes signed eleven-bit X/Y in bits 10:0/26:16. S supplies width in bits 9:0 and height in bits 24:16: **0…1023 by 0…511**, with either zero extent empty. This is not an image transfer's zero-means-maximum convention. Fixed forms have **no S word**: an extra size word would instead occupy the next command boundary.

T0 has U in bits 7:0, V in 15:8 and a CLUT attribute in 31:16. CLUT X is `(attribute AND 3FH)×16`; CLUT Y is `attribute>>6` through the Y-address gate. The rectangle uses the **current E1 texture page and depth**. It has no polygon T1 word and does not overwrite E1 with its CLUT attribute.

### Placement and texture lifetime

Add the signed drawing offset to the decoded origin, then wrap that origin to signed eleven bits. Extend right/down by the selected size; do not repeatedly wrap the destination extent. Clip against the inclusive drawing area. Textured rectangles anchor U/V at the original, unclipped origin. Independent X/Y flip settings change their steps to −1 instead of +1; they neither reverse destination coverage nor move the anchor automatically to the opposite texture edge. Left/top clipping advances U/V, and suppressed rows still advance V. See [Keep a clipped or flipped rectangle on its texture](#gpu-texture-rectangles) for the four independent flip choices.

Every complete rectangle retains its drawing-state snapshot. Later environment changes do not reinterpret it. Neither untextured nor textured rectangles dither, even with the draw-mode dither setting enabled. The normal transparent-sample, blending and destination-mask rules still apply: fetched `0000H` skips the write, while `8000H` is processed black; textured semitransparency needs both the opcode request and sample bit 15. Mask checking tests the old destination; forcing sets output bit 15.

### Complete untextured and textured packets

For both trials below, use zero offset, inclusive drawing area X=13…17/Y=22…25, retained suppression of odd rows, mask checking/forcing off and the dither setting on. Initialize the twenty destination words in that area to `6B5AH` before **each** trial.

The complete opaque fixed-8×8 packet is only two words:

```text
70A0647CH, 0014000AH
```

It supplies RGB=(124,100,160) and origin (10,20). Clipping leaves five columns and four rows; odd-row suppression leaves ten writes on Y=22 and 24. With no rectangle dither, every write is RGB5=(15,12,20), **`518FH`**. Rows 23 and 25 retain `6B5AH`. There is no trailing size word.

For the textured trial, let current E1 select page (64,256), eight-bit palette sampling and both rectangle flips. Use texture-window fields X-mask=1/Y-mask=3/X-offset=0/Y-offset=1, giving U AND/OR masks `F7H/00H` and V masks `E7H/08H`. Declare these raw source words; all other texture words and palette entries used by this example are `0000H`:

| Role | Raw VRAM coordinate | Word |
|---|---|---|
| Packed texture | (187,495) | `A512H` |
| Packed texture | (187,493) | `3612H` |
| Palette color | (133,300) | `25ABH` |
| Palette color | (22,300) | `8000H` |

Supply the complete variable, modulated, opaque packet:

| Word | Raw input | Meaning |
|---|---|---|
| 1 | `64808080H` | RGB=(128,128,128), exact unit modulation gain |
| 2 | `0014000AH` | Origin (10,20) |
| 3 | `4B3E0102H` | U0=2,V0=1; CLUT base (992,300) |
| 4 | `00060008H` | Width 8, height 6 |

The first admitted pixel (13,22) has stepped U/V=(−1,−1), transformed to `F7H/EFH`. Palette8 reads raw (64+123,256+239)=(187,495); odd U selects `A5H`. CLUT X wraps within its row: `(992+165) AND 3FFH=133`, yielding `25ABH`. Neutral gain preserves its RGB5=(11,13,9).

| Destination | Windowed U/V | Selected index | Fetched color | Final destination |
|---|---|---|---|---|
| (13,22) | `F7H/EFH` | `A5H` | `25ABH` | `25ABH` |
| (14,22) | `F6H/EFH` | `12H` | `0000H` | Unchanged `6B5AH` |
| (13,24) | `F7H/EDH` | `36H` | `8000H` | `8000H` |

Y=23 still consumes V=`EEH` despite being suppressed, so Y=24 uses `EDH`, not `EEH`. Its index `36H` selects CLUT X=(992+54) AND 3FFH=22. Only the two nonzero-color destinations shown change; every other destination retains `6B5AH`. The `8000H` write is opaque processed black, not a transparent skip. Changing opcode `64H` to raw `65H` keeps the packet layout and lookup; this particular neutral-gain case then has the same output without using C0.

### Command cost

Use ordinary signed-eleven-bit position-plus-offset sums for timing, **not** the raster origin's rewrapped sum. Both examples have clipped W=5,H=4 before row suppression and H′=2 after it. The untextured row cost is q=5: **16+5×2=26 ticks, 13 scheduled system cycles**. Palette8 is below both texture thresholds, adding W=5 row ticks: q=10 and **16+10×2=36 ticks, 18 cycles**. Raw texture does not remove that overhead. The cost remains 36 ticks despite only two successful texture writes.

In general add `(W+1)>>1` to row cost when semitransparency **or** mask checking is enabled, once even when both are enabled. The wider/greater-area texture branches are listed in [Budget command work separately from issuing words](#gpu-command-costs); use clipped H **before** row halving to select them. An empty rectangle still costs 16 ticks/eight cycles. For example, replacing the textured packet's S with `00060000H` gives width zero and no samples, not a 1024-column image. These intervals exclude CPU word preparation/supply and do not acknowledge presentation.

<a id="gpu-fill-packet"></a>
## Fill raw local memory — GP0(02H)

Use fill for a solid RGB color written in sixteen-word horizontal units, not as
a drawing rectangle with the usual pixel-write controls. **Only opcode `02H`**
selects this operation. Its complete packet is three GP0 words:

| Word | Contents |
|---|---|
| 1 | `02000000H OR RGB888`: R in bits 7:0, G in 15:8, B in 23:16 |
| 2 | Destination XY: raw X in the low halfword, raw Y in the high halfword |
| 3 | Size S: width in the low halfword, height in the high halfword |

There is no pixel payload or terminator. The next word starts a new command;
its bits are not additional fill pixels. The low twenty-four header bits are
color, not raw/modulated or semitransparency options.

### Decode alignment, dimensions and color

With `Ymask=1ffH` for the nine-bit gate or `3ffH` for the ten-bit gate:

```text
X0 = XY AND 3f0H
Y0 = (XY >> 16) AND Ymask
W  = ((S AND 3ffH) + 15) AND NOT 0fH
H  = (S >> 16) AND 1ffH
```

X is aligned **down** to a multiple of 16; the selected width is rounded **up**
to a multiple of 16. Width 1…16 therefore writes 16 columns, while width 1009…1023
writes 1024. Width zero remains empty, and height zero remains empty: neither
selects the maximum transfer dimension. Height uses only nine bits even when
the Y-address gate is open. Unselected position/size bits do not extend these
fields.

For each admitted row j and column i, raw coordinates are
`X=(X0+i) AND 3ffH`, `Y=(Y0+j) AND Ymask`. X wraps within its row; an overrun
past 1023 does not carry into the next row. The Y gate also applies to each
generated row. These are raw-word addresses, not signed drawing coordinates or
PCRTC storage-format addresses; see [Choose the storage contract before drawing](#gpu-storage).

Each byte loses its low three bits. The stored word is
`(R>>3) OR ((G>>3)<<5) OR ((B>>3)<<10)`, with **bit 15 clear**. Fill bypasses
drawing offset, drawing-area clipping, dithering, blending, destination-mask
checking and force-mask. It can therefore overwrite an old marked word and
clear its bit 15 even while both mask controls are set. It does not change those
configured controls.

The exception is **retained skipped-row parity**. A row whose parity matches
the retained suppression value is not written. Such suppression can be selected
when vertical-resolution and interlace mode are both set and draw-to-displayed-
field is clear; otherwise no row parity is suppressed. Do not assume fill always
writes every row merely because it bypasses the drawing area. The differences
from drawing, upload and copy are collected in
[Choose fill, drawing or a raw transfer](#gpu-memory-operations).

### Complete nonaligned fill with both address wraps

Declare nine-bit Y addressing and retained suppression of odd rows. Drawing
area X=100…103,Y=200…202 excludes the target; drawing offset is `(13,−7)`;
dithering and subtractive blend mode are selected; mask mode has check and force
both set. The locations named below initially contain `FFFFH`. These are declared
example contents, not a reset-memory guarantee.

Supply:

| Word | Raw word | Requested operand |
|---|---|---|
| 1 | `024964F1H` | RGB=(241,100,73) |
| 2 | `03FF03FFH` | X=1023,Y=1023 |
| 3 | `00040011H` | Width 17,height 4 |

X aligns to 1008, width rounds to 32, and the nine-bit Y gate selects 511. The four
row addresses are 511,0,1,2; each row's columns are 1008…1023 followed by 0…15.
The output color is RGB5=(30,12,9), packed **`259EH`**:

| Raw Y | Retained parity test | After-fill words at X=1008…1023 and X=0…15 |
|---|---|---|
| 511 | Odd: suppressed | `FFFFH`, unchanged |
| 0 | Even: admitted | `259EH` |
| 1 | Odd: suppressed | `FFFFH`, unchanged |
| 2 | Even: admitted | `259EH` |

Exactly 64 distinct words change here. Neighbors such as `(16,0)` and `(1007,2)`
remain unchanged. The excluding drawing area and nonzero offset do not relocate
or clip these writes; old bit 15 does not protect them, and force-mask does not
mark the result. The selected dither/blend state likewise does not alter `259EH`.

### Command cost, not stored-pixel count

For decoded W/H, the cost is:

```text
ticks = 46 + ((W >> 3) + 9)×H
```

The worked packet costs `46+(4+9)×4=98` command ticks, or **49 scheduled system
cycles** from execution start. Disabling row suppression would write 128 words
instead of 64 but would not change that cost. Likewise, changing only S to
`00040000H` makes width zero and writes nothing, yet still costs 82 ticks/41
cycles; S=`00000011H` makes height zero and costs 46 ticks/23 cycles.

These intervals exclude preparation and issue of the three words and are not a
physical fill-rate specification. Use the execution-deadline conversion in
[Budget command work separately from issuing words](#gpu-command-costs). Do not
apply the signed-position-plus-offset or clipped-area work rules of drawing
primitives to this fill calculation.

<a id="gpu-upload-packet"></a>
## Raw image upload — GP0(A0H–BFH)

Upload supplies raw **sixteen-bit local-memory words**, two per GP0 payload word. Every opcode byte from `A0H` through `BFH` selects the same operation; the opcode's low five bits and the header's low 24 bits do not select formats or colors.

```text
(opcode<<24) OR ignored24, destinationXY, S, payload0, payload1, ...
W = (((S AND FFFFH) − 1) AND 3FFH) + 1
H = ((((S >> 16) AND FFFFH) − 1) AND 1FFH) + 1
payload words = (W×H + 1) >> 1
```

This is packet notation and integer mathematics. The header is exactly three 32-bit words. Destination X uses its low ten bits; destination Y comes from the upper half through the selected Y-address gate. These are raw addresses, not signed primitive positions. W is 1…1024 and H is 1…512: **zero does not request an empty upload**.

| Raw S | Normalized W×H | Payload words | Total GP0 words |
|---|---|---|---|
| `00030003H` | 3×3 | 5 | 8 |
| `00000000H` | 1024×512 | 262144 | 262147 |
| `02010401H` | 1×1 | 1 | 4 |

Consume each payload word's **low sixteen bits first, then high sixteen bits**, advancing a row-major pixel cursor. Packing does not restart at each row. With an odd width, one payload word can supply the last pixel of one row and the first pixel of the next. For an odd total pixel count, ignore the final payload word's upper half; the **next whole GP0 word** begins the next command. There is no end-image opcode in place of the count. Opcode-looking or polyline-marker-looking data remains image data throughout that payload.

### Raw addressing and mask state

For each pixel, X wraps within its 1024-word row, without carrying into Y. Generated rows wrap through the selected 512- or 1024-row Y-address period. This is raw local-memory addressing, not drawing-area clipping.

Upload applies the retained destination-mask mode but ignores drawing offset, drawing area, row suppression, blending and dithering. Check-mask tests the destination's **old** bit 15 and rejects the entire write when set. Otherwise force-mask sets output bit 15; without force-mask, all sixteen source bits pass through. In particular, source `0000H` is an ordinary raw write, not texture transparency, and `8000H` is ordinary raw data rather than a blend request.

A normal upload becomes one retained command after the counted payload has been assembled. Its mask mode and Y-address state are snapshotted when the complete upload—or a flushed partial upload—is emitted, not supplied by an extra payload flag. Apparent E commands inside the image cannot change that state.

### A 3×3 upload across both address boundaries

Select the 512-row Y-address period and mask mode `3`: checking and forcing both enabled. The following table declares the old destination words. Other draw-state settings do not affect this raw upload. Supply all eight words:

| GP0 word | Raw input | Role |
|---|---|---|
| 1 | `BF123456H` | Upload alias BF; low 24 bits ignored |
| 2 | `01FF03FEH` | Destination X=1022,Y=511 |
| 3 | `00030003H` | Width 3,height 3 |
| 4 | `E1800000H` | Pixels 0/1: `0000H`,`E180H` |
| 5 | `5ABC5DEFH` | Pixels 2/3: `5DEFH`,`5ABCH`; not a polyline terminator |
| 6 | `00008000H` | Pixels 4/5: `8000H`,`0000H` |
| 7 | `A0007C00H` | Pixels 6/7: `7C00H`,`A000H`; not a new upload |
| 8 | `E1001234H` | Pixel 8: `1234H`; upper `E100H` ignored |

The complete masked result is:

| Pixel index | Destination | Source | Before | After |
|---|---|---|---|---|
| 0 | (1022,511) | `0000H` | `001FH` | `8000H` |
| 1 | (1023,511) | `E180H` | `03E0H` | `E180H` |
| 2 | (0,511) | `5DEFH` | `8001H` | Unchanged `8001H` |
| 3 | (1022,0) | `5ABCH` | `1111H` | `DABCH` |
| 4 | (1023,0) | `8000H` | `2222H` | `8000H` |
| 5 | (0,0) | `0000H` | `8333H` | Unchanged `8333H` |
| 6 | (1022,1) | `7C00H` | `4444H` | `FC00H` |
| 7 | (1023,1) | `A000H` | `8555H` | Unchanged `8555H` |
| 8 | (0,1) | `1234H` | `6666H` | `9234H` |

Payload word 5 crosses the logical row boundary: its low half targets (0,511), while its high half targets (1022,0). X overflow alone did **not** move pixel 2 to Y=0; the completed three-pixel row advances Y and the selected gate wraps 512 to zero. Pixel 0 proves that raw zero really writes: force-mask turns it into `8000H`. Pixels 2,5,7 retain their protected old words regardless of their source bits. The ignored upper half of word 8 cannot supply another pixel or start an E1 command.

### An interrupted upload retains only its consumed prefix

GP1(01h) clears the stream, not every earlier accepted pixel operation. If upload assembly has consumed at least one payload word, the clear flushes that partial payload; a header-only upload is discarded. Only up to `min(W×H,2×consumedPayloadWords)` pixels are represented. It does not manufacture the missing rectangle pixels, and words still merely queued in the cleared FIFOs are not promised as part of that prefix.

As a separate trial from the same old-memory table, suppose only payload words 4 and 5 have been consumed before the GP1 clear. The retained prefix represents **four pixels**, not one complete row or two rows. After its masked writes, indices 0,1,3 have the table's new values; index 2 remains protected; indices 4…8 retain their **Before** values. Subsequent GP0 words start a new stream: do not send the abandoned remainder as though its old header were active. GP1(00h) performs the same stream-clear operation before restoring register defaults; it is not a local-memory rollback. See [GP1 control commands](#gpu-gp1-controls) for the complete clear/reset and readback distinctions.

### Supply cost is separate from command cost

A normal upload has **one command tick** of scheduled command cost, giving one system cycle, independently of image area. That is not a bound on preparing, admitting or supplying its header/payload, nor on making the resulting pixels available for presentation.

Supply CPU words to the **same fixed GP0 port** with the word-access/admission contract, or hand the stream to its DMA owner as described in [Hand a GP0 stream between CPU and DMA](#gpu-ingress-ownership). A contiguous CPU word sequence does not repeatedly address GP0. DMA block boundaries do not finish an incomplete image payload, and DMA ownership excludes interleaved direct CPU writes. Packet completion, command completion and display completion remain separate events.

<a id="gpu-readback-packet"></a>
## Read raw local memory — GP0(C0H–DFH)

Use this command to return raw sixteen-bit local-memory words through GPUREAD.
It does not return a PCRTC-composed, magnified or storage-format-converted
picture, and it does not expose a CPU-addressable local-memory aperture.

### Three-word request and normalized dimensions

Every opcode from `C0H` through `DFH` selects the same operation. The opcode's
low five bits and the header's low twenty-four bits do not select another format.
Supply:

| Word | Contents |
|---|---|
| 1 | `opcode << 24`; low twenty-four bits ignored |
| 2 | Source XY: raw X in the low halfword, raw Y in the high halfword |
| 3 | Size S: raw width in the low halfword, raw height in the high halfword |

There is **no GP0 pixel payload or terminator**. Image data comes back on reads;
a following GP0 write belongs to the next command, subject to the readback
barrier below.

```text
W = (((S AND ffffH) − 1) AND 3ffH) + 1
H = ((((S >> 16) AND ffffH) − 1) AND 1ffH) + 1
GPUREAD word count = (W×H + 1) >> 1
```

W is 1…1024 and H is 1…512, including with the ten-bit Y-address gate. A zero size
word requests 1024×512 pixels and 262144 reads, not an empty operation. Raw size
halfwords 1025/513 instead select 1×1. These are image-transfer dimensions, not
fill or drawing-rectangle zero-size rules.

Source X uses ten bits. Source Y and every generated row use the request's
nine-bit or ten-bit Y mask. X wraps within its 1024-word row, without carrying
into the next row. The source coordinates, normalized dimensions and Y-extension
value belong to the retained request; a later gate write does not retarget an
already emitted request. The raw word representation and address distinction
are described in [Choose the storage contract before drawing](#gpu-storage).

### Execution, submission and READY are separate

The command has a **one-command-tick** execution interval. At its scheduled
completion, it activates a pending readback with cursor zero and a command-count
fence identifying the required command prefix through this request. That scheduled interval
is not the time to return all W×H pixels.

The request progresses through three distinct states:

| State | Meaning for the request |
|---|---|
| Pending | Waiting for read work to be submitted at its exact completed-command fence |
| Submitted | The ordered read work has been claimed; its matching completion is still required |
| READY | Data is available for permitted GPUREAD consumption; GPUSTAT bit 27 is set |

The fence ensures the required earlier work is performed before pixel extraction.
The count and these phases are ordering state, not extra request words or
additional directly addressed registers. Later packets cannot execute past a
non-idle readback. Do not replace READY with the command's one-tick deadline,
GPU idle, or acceptance of the third header word. No fixed C0-to-READY latency
or sustained readout rate is specified by that command cost.

### Read ownership, latch and counted release

Use complete word reads and the port rules in
[GP0, GPUREAD, GP1 and GPUSTAT](#gpu-ports-status). A GP0 read first synchronizes
already-due command work. If no readback is READY, it returns the retained
GPUREAD latch without consuming a pixel; it does not necessarily return zero.
If READY and DMA does not own GP0's read port, a CPU read consumes the next
packed word and replaces the latch. A DMA read may consume its stream; a CPU
read while DMA owns that port instead returns the latch without advancing.
READY alone does not grant CPU ownership.

Packing is one continuous row-major pixel sequence: first pixel low halfword,
next pixel high halfword, continuing across row boundaries. There is no padding
after an odd-width row. Only the final odd pixel has an unused **zero high
halfword**. Count `(W×H+1)>>1` permitted word reads; neither a zero word nor a
particular pixel value is an end marker.

Consuming the final word returns readback to idle and resumes queued command
processing. GPUREAD keeps that final word until another query or permitted data
read replaces it. The next no-READY read repeats the latch, not a new pixel.
A byte read is not a nonconsuming peek: it invokes the full read callback and
can consume an entire packed word. Query/latch interactions are detailed in
[Query drawing state through GPUREAD](#gpu-info-queries); a query does not reserve
its answer against a ready image read.

### Complete odd 3×3 readback across both address wraps

Declare nine-bit Y addressing, GPUREAD=`DEADBEEFH`, no DMA read ownership and no
intervening info query. The source words are already present as follows; no
upload or reset-memory contents are implied:

| Raw Y | X=1023 | X=0 | X=1 |
|---|---|---|---|
| 511 | `0011H` | `8022H` | `0033H` |
| 0 | `0044H` | `8055H` | `0066H` |
| 1 | `0077H` | `8088H` | `0099H` |

Issue:

| Word | Raw word | Meaning |
|---|---|---|
| 1 | `D9ABCDEFH` | Readback alias D9H; ABCDEFH ignored |
| 2 | `03FF03FFH` | X=1023; supplied Y=1023 masks to 511 |
| 3 | `00030003H` | W=3,H=3 |

Each row addresses X=1023,0,1; generated rows address 511,0,1. While bit 27 remains
clear, a GP0 read returns `DEADBEEFH` and does not advance this image. Once READY,
the five permitted word reads are:

| Read | GPUREAD result | Low pixel | High pixel | READY after read |
|---|---|---|---|---|
| 1 | `80220011H` | (1023,511) | (0,511) | 1 |
| 2 | `00440033H` | (1,511) | (1023,0) | 1 |
| 3 | `00668055H` | (0,0) | (1,0) | 1 |
| 4 | `80880077H` | (1023,1) | (0,1) | 1 |
| 5 | `00000099H` | (1,1) | Unused zero | 0 |

Read 2 crosses a logical row boundary without padding. Source bit 15 passes
through unchanged; these are storage words, not newly quantized RGB values.
With no next readback or query, another GP0 read returns `00000099H` again.
An intervening CPU read under DMA read ownership would instead repeat the
current latch without consuming one of these five words.

### A queued marker waits for the final read

For the same request, start with the GPU request latch clear and place the whole
GP0 marker word `1F000000H` immediately after the three-word header. It is the
next command, not data for this readback. It cannot execute while the readback
is pending, submitted or READY, including after only four of the five reads.

Let R be the cycle when the permitted final read resumes processing, with this
marker the only queued follow-up. The marker executes in that resumed processing,
sets its request, and has its own one-tick interval ending at R+1 system cycle.
This is a relative command timeline, **not** a promised READY deadline or a CPU
five-read benchmark. The final read releases the image barrier; the marker's
request and GPU idle are still different conditions. Acknowledgement of GPU and
controller latches follows [GP1 control commands](#gpu-gp1-controls).

### Clearing is an abort, not counted consumption

GP1(01h) can abandon readback; retained-command effects depend on whether the
request is unactivated, pending, submitted or READY. It is not equivalent to
consuming the remaining words and is not a rollback of all earlier accepted
work. Use the phase-dependent clear description in
[GP1 control commands](#gpu-gp1-controls). GP1(00h) also clears the stream but
preserves the GPUREAD latch and Y-extension value; neither resetting that GPU
register state nor reading an old latch proves local memory was erased.

<a id="gpu-copy-packet"></a>
## Raw local-memory copy — GP0(80H–9FH)

Copy moves sixteen-bit words directly between two local-memory regions. Every opcode byte from `80H` through `9FH` has the same four-word layout; the low five opcode bits and low 24 header bits are ignored. There is no GP0 pixel payload or CPU readback:

```text
(opcode<<24) OR ignored24, sourceXY, destinationXY, S
W = (((S AND FFFFH) − 1) AND 3FFH) + 1
H = ((((S >> 16) AND FFFFH) − 1) AND 1FFH) + 1
```

This is packet notation and integer mathematics. Each XY has raw X in its low ten bits and raw Y in its upper half through the selected Y-address gate. They are not signed primitive positions. W is 1…1024 and H is 1…512: S=`00000000H` requests **1024×512**, not an empty copy. The 1024-row Y-address setting does not enlarge that 512-row maximum transfer height. After the fourth packet word, the next word is another command, not image data.

The complete packet retains its mask mode and Y-address state when emitted; later environment changes do not reinterpret it. Source/destination X wrap within their respective 1024-word rows, and generated Y values wrap through the selected 512- or 1024-row period. Drawing offset, drawing area, row suppression, blending and dithering do not affect this raw operation.

Check-mask rejects a write when the destination's **old** bit 15 is set. Otherwise force-mask sets output bit 15; with forcing clear, all sixteen source bits are copied. Source `0000H` is writable raw data, not texture transparency. A set source bit 15 is also data: it does not prevent reading or request blending.

### Determine traversal before relying on overlap

Rows always advance in increasing **logical** row order, even when Y wraps to a smaller physical coordinate. For every row calculate:

```text
D = (destinationX − sourceX) AND 3FFH
```

If `0 < D < W`, visit columns W−1…0; otherwise visit 0…W−1. Read each source word immediately before its destination mask test/write. The operation does **not** first capture a whole source rectangle. Horizontal reverse traversal therefore does not promise source preservation for vertical overlap.

For a complete wrapped horizontal example, clear both mask controls and initialize row 20 as follows. Supply:

```text
9F123456H, 001403FEH, 001403FFH, 00010003H
```

This copies 3×1 from (1022,20) to (1023,20); the first word deliberately uses alias `9FH` and ignored payload bits. D=1, so columns execute 2,1,0:

| Column | Source X/read word | Destination X |
|---|---|---|
| 2 | 0 / `0033H` | 1 |
| 1 | 1023 / `0022H` | 0 |
| 0 | 1022 / `0011H` | 1023 |

| X at Y=20 | 1022 | 1023 | 0 | 1 |
|---|---|---|---|---|
| Before | `0011H` | `0022H` | `0033H` | `0044H` |
| After | `0011H` | `0011H` | `0022H` | `0033H` |

X wrapping stays on row 20; it does not carry into row 21.

### A downward copy reads the rows it just wrote

Select the 512-row Y-address period, clear both mask controls and supply this complete packet:

| Word | Raw input | Meaning |
|---|---|---|
| 1 | `80000000H` | Raw local-memory copy |
| 2 | `01FE03FFH` | Source (1023,510) |
| 3 | `01FF03FFH` | Destination (1023,511) |
| 4 | `00030003H` | Width 3,height 3 |

Use the following before-words at the three columns X=(1023,0,1):

| Physical Y | Before | After |
|---|---|---|
| 510 | `0011H,0022H,0033H` | `0011H,0022H,0033H` |
| 511 | `0044H,0055H,0066H` | `0011H,0022H,0033H` |
| 0 | `0077H,0088H,0099H` | `0011H,0022H,0033H` |
| 1 | `00AAH,00BBH,00CCH` | `0011H,0022H,0033H` |

D=0 selects forward columns. Logical row 0 copies 510→511. Logical row 1 then reads the **new** row 511 into physical row 0, and logical row 2 reads the new row 0 into row 1. The result repeats the original first source row; it does not shift three independently preserved original rows. [Choose fill, drawing or a raw transfer](#gpu-memory-operations) describes software ordering when those originals must be preserved.

Destination protection can change which source values cascade. As a separate trial, restore the Before values, change only (0,511) from `0055H` to **`8055H`**, and enable check-mask with forcing clear: mask mode `2`. The first copied row cannot replace that protected middle word, leaving row 511 as `0011H,8055H,0033H`. The next row reads those actual contents, so row 0 also becomes `0011H,8055H,0033H`; the third repeats them into row 1. Source bit 15 does not block these reads or writes to still-unprotected destinations. There are eight successful stores rather than nine, but no preserved-source snapshot appears.

### Command cost

Copy costs **2×W×H command ticks**, using normalized dimensions, without drawing-area clipping or a mask-hit reduction. Thus the horizontal packet costs six ticks/three scheduled system cycles. The 3×3 packet costs **18 ticks/nine cycles**, both with and without the protected-word contrast. S=zero costs 1,048,576 ticks/524,288 cycles, although the packet still contains only four words.

The signed-eleven-bit geometry estimates for drawing primitives do not apply to copy. These command intervals do not include CPU preparation/issue or establish physical memory bandwidth, pixel-presentation time or a general two-dimensional source-preserving move guarantee.

<a id="gpu-draw-mode"></a>
## Drawing mode — GP0(E1H)

E1 is one GP0 word: `E1000000H OR parameter`. It retains parameter bits **13:0**, mask `00003FFFH`; bits 23:14 are ignored. The draw-mode word's reset value is zero, not a zero value for the whole GPUSTAT register.

| Draw-mode bits | Meaning |
|---|---|
| 3:0 | Texture-page X: field×64 **raw sixteen-bit words** |
| 4 | Texture-page Y low selector: bit×256 rows |
| 6:5 | Blend selection: 0=half-sum, 1=saturated addition, 2=clamped subtraction, 3=quarter-foreground addition |
| 8:7 | Texture depth: 0=four-bit palette, 1=eight-bit palette, 2=direct sixteen-bit, **3=the same direct-sixteen-bit sampling path** |
| 9 | Enable dithering for eligible primitive/color paths |
| 10 | Draw-to-displayed-field control: a set bit disables the conditional row-parity suppression described below |
| 11 | Texture-page Y high selector: bit×512 rows |
| 12 | Textured-rectangle X flip: U step −1 when set, +1 when clear |
| 13 | Textured-rectangle Y flip: V step −1 when set, +1 when clear |

Page Y is the sum of the two selectors through the current Y-address gate. Bit 11 is a page-address bit, **not a texture-disable bit**. Depth 3 is representable and reads direct words; do not reject it or interpret it as another palette format.

The blend selector chooses the calculation, not whether a pixel blends. An untextured primitive still needs its semitransparency opcode request; a textured pixel needs both that request and fetched sample bit 15. Dithering applies to untextured Gouraud polygons, modulated textured polygons and lines, but not flat untextured polygons, raw texture or rectangles. The numerical color paths are described in [Choose texture gain and dither deliberately](#gpu-color-dither) and [Separate texture transparency, blending and destination protection](#gpu-blending-mask).

Bit 10 does **not** describe an arbitrary protected display rectangle. One retained row parity is suppressed only when the GPU vertical-resolution and interlace flags are both set **and bit 10 is clear**; the retained active-line parity selects the skipped rows. Otherwise no row parity is suppressed. Rectangle flip bits independently change UV traversal, not destination geometry or the initial UV anchor, and do not reverse triangle interpolation.

### State changes at parser execution, not admission

E1 changes current draw mode when the ordered GP0 parser executes its word, not merely when a FIFO accepts it. The register change occurs at the start of its **one-command-tick interval**, whose completion deadline is one system cycle later. E1 is not itself a retained drawing primitive. Every emitted draw retains its own mode and other drawing-state snapshot; later E1 words cannot reinterpret it. This queued interval is not CPU issue cost or a physical raster-clock guarantee.

Textured polygons have another persistent mode producer. T1's upper attribute half updates current mode **before that polygon takes its snapshot**:

```text
new mode = (old mode AND NOT 09FFH) OR (T1 attribute AND 09FFH)
```

This replaces bits 8:0 and 11: page, depth and blend. It preserves bits **9,10,12,13**, regardless of those bits in the attribute. T1 is word 5 of a flat textured polygon or word 6 of a Gouraud textured polygon, counting the command word as 1. It is an operand, not a standalone E1 command. T0 supplies the CLUT, while T2/T3 upper halves do not make further page changes. Textured rectangles have no T1 and use the current mode.

### A complete E1 word and a later T1 overwrite

Select the 1024-row Y-address period and issue the complete word:

```text
E1ABDBDFH
```

Only `1BDFH` is retained; the result is identical to `E1001BDFH`. It selects page (960,768), direct depth 3, subtractive blend selection 2, dithering on, bit 10 clear, X flip on and Y flip off. With the 512-row gate instead, the same page selectors yield Y=256, not 768.

In a later textured polygon, use **`E4A2078CH` in its T1 slot**. Its U/V bytes are (140,7); its attribute is `E4A2H`. The persistent merge is:

```text
old preserved bits = 1BDFH AND NOT 09FFH = 1200H
new selected bits  = E4A2H AND 09FFH     = 00A2H
new current mode   = 1200H OR 00A2H      = 12A2H
```

All four preserved flags deliberately disagree with the attribute:

| Bit | Old mode | Attribute | Result |
|---|---|---|---|
| 9, dither | 1 | 0 | 1 |
| 10, draw-to-displayed-field | 0 | 1 | 0 |
| 12, rectangle X flip | 1 | 0 | 1 |
| 13, rectangle Y flip | 0 | 1 | 0 |

The new mode selects page (128,0), palette8 and additive blend selection 1; the old dither/field/flip flags survive. For an illustrative lookup whose **post-window** U/V are (140,7):

| Mode | First raw texture read |
|---|---|
| `1BDFH`, direct depth 3 | X=(960+140) AND 3FFH=76, Y=768+7=775 |
| `12A2H`, palette8 | X=128+(140>>1)=198, Y=7; even U selects the low index byte, then the T0-selected CLUT |

These are lookup inputs, not a claim that a particular polygon vertex is covered. A draw emitted before the merge retains `1BDFH`; the polygon carrying T1 retains `12A2H`; a following textured rectangle also uses `12A2H` until another mode producer changes it.

### Check only the status bits which echo draw mode

GPUSTAT bits 10:0 echo mode bits 10:0, while mode bit 11 appears at **GPUSTAT bit 15**. GPUSTAT bits 11/12 belong to destination mask mode, not the rectangle flips. Do not read GPUSTAT as a complete fourteen-bit E1 echo.

After the respective mode update executes, the example therefore gives:

| Current mode | `GPUSTAT AND 000087FFH` |
|---|---|
| `1BDFH` | `000083DFH` |
| `12A2H` | `000002A2H` |

Other status fields still reflect their own controls, beam and command state. These masked observations do not establish drawing completion or expose a separate draw-mode query port.

<a id="gpu-environment"></a>
## Texture window, drawing bounds, offset and masks — GP0(E2H–E6H)

Each command below is **one GP0 word**, formed by ORing its opcode word with the parameter. All five retained parameter words reset to zero. Bits outside the listed mask are ignored; they do not add packet fields.

| Command word | Retained mask | Parameter fields |
|---|---|---|
| `E2000000H OR parameter` | `000FFFFFH` | Texture window: X mask 4:0, Y mask 9:5, X offset 14:10, Y offset 19:15 |
| `E3000000H OR parameter` | `000FFFFFH` | Drawing-area top-left: X 9:0, Y 19:10 |
| `E4000000H OR parameter` | `000FFFFFH` | Drawing-area bottom-right: X 9:0, Y 19:10 |
| `E5000000H OR parameter` | `003FFFFFH` | Drawing offset: signed X 10:0, signed Y 21:11 |
| `E6000000H OR parameter` | `00000003H` | Bit 0 force output bit 15; bit 1 reject writes over old destination bit 15 |

These update programmed drawing state when the ordered GP0 parser **executes** the command, not merely when its word is accepted at the port. The effect occurs at the start of a one-command-tick interval; its completion deadline is one system cycle later. An environment command is not itself a retained drawing primitive. CPU preparation/admission waits and display completion are separate costs/events.

### E2 replaces texture-coordinate bits

Each texture-window mask/offset field is five bits. For either axis, derive the byte-sized operands:

```text
AND byte = (NOT (mask×8)) AND FFH
OR byte  = (offset AND mask)×8
result   = (coordinate AND AND-byte) OR OR-byte
```

Apply X fields to U and Y fields to V. This is bit replacement, not an arbitrary clipping rectangle or texture width/height. Offset bits outside the mask do not participate; the low three coordinate bits are unchanged. Reset E2=zero gives AND bytes `FFH` and OR bytes `00H`: identity on byte coordinates, not a forced lookup at zero. For page/CLUT placement after this transformation, see [Locate texture texels and palette colors](#gpu-texture-lookup).

### E3/E4 are inclusive limits; E5 is a signed displacement

Drawing-area X is unsigned ten-bit. The retained corner words keep ten Y bits, but a draw decodes them through **its retained Y-address gate**. Right and bottom are inclusive: a decoded area `(left,top)…(right,bottom)` admits the half-open ranges `[left,right+1)` and `[top,bottom+1)`. A reversed decoded X or Y axis is empty, not automatically exchanged or wrapped. Both reset corner words zero describe the single-sample area (0,0), not a full-screen drawing area.

E5 decodes each eleven-bit offset as signed two's complement, −1024…1023. It moves primitive coordinates, not the drawing-area limits or raw image-transfer addresses. The primitive families' different boundary rules remain those in [Place primitives across coordinate boundaries](#gpu-coordinate-placement); E5 does not replace them with one universal wrapping rule.

### E6 controls a destination write, not a source color

With bit 1 set, test the destination's **old** bit 15 before blend/store and reject the entire write if that bit is one. A permitted write has output bit 15 forced to one when bit 0 is set. Otherwise untextured drawing writes zero there, textured drawing copies the sample bit, and raw upload/copy preserves the source bit. Force-mask does not enable texture blending. Fill bypasses both controls; raw upload/copy honors them.

GPUSTAT bits **11/12** echo E6 bits **0/1**, respectively. Thus mask mode 3 gives `GPUSTAT AND 00001800H = 00001800H`; mode zero gives zero under that mask. This says nothing about the other status fields or drawing completion. The distinct transparency/blend cases are described in [Separate texture transparency, blending and destination protection](#gpu-blending-mask).

### Program concrete state, then preserve its lifetime

Select the 512-row Y-address period and supply these five complete GP0 commands. Their deliberately nonzero ignored bits do not change the retained values:

| Input word | Retained parameter | Effective state |
|---|---|---|
| `E2F08061H` | `00008061H` | Window masks X=1/Y=3, offsets X=0/Y=1 |
| `E3F8580DH` | `0008580DH` | Top-left raw X=13/Y=534, decoded (13,22) |
| `E4F86411H` | `00086411H` | Bottom-right raw X=17/Y=537, decoded (17,25) |
| `E5FFEFFEH` | `003FEFFEH` | Offset X=−2,Y=−3 |
| `E6FFFF03H` | `00000003H` | Check old destination and force permitted output bit 15 |

E2's derived byte operands are:

| Axis | Mask field | Offset field | AND byte | OR byte |
|---|---|---|---|---|
| U | 1 | 0 | `F7H` | `00H` |
| V | 3 | 1 | `E7H` | `08H` |

For example, U=`ADH`,V=`09H` becomes **`A5H,09H`**: U changes while V already has the selected replacement bits. No packed byte mask is substituted for the original five-bit command fields.

The drawing area is five columns by four rows, half-open X=[13,18)/Y=[22,26). Raw Y values 534/537 are retained, not destroyed by the 512-row decode. With the 1024-row gate, those same corner words instead select Y=534…537. The offset's raw fields are `7FEH/7FDH`, decoding to −2/−3; a supplied coordinate (16,27) has ordinary offset sum (14,24), inside the selected 512-period area.

After a drawing packet has actually been **emitted** under this state, execute:

```text
E2000000H, E400640CH, E5000000H, E6000000H
```

Current state now has an identity window, zero offset and no destination-mask controls. The unchanged left limit is 13, but the new right limit is 12, so its X drawing interval is empty. A later drawing primitive that uses the area sees that empty interval.

The already-emitted draw still retains window `8061H`, the earlier two corner words, offset `3FEFFEH`, mask mode 3 and its 512-row Y gate. Later environment writes do not retroactively change those operands. For a pending draw, use its actual command or segment emission as the snapshot boundary, not merely acceptance of its first word. This distinction is why a current-state status observation is not a readout of every queued draw's retained state.

<a id="gpu-command-costs"></a>
## Budget command work separately from issuing words

A command's work cost is measured in **command ticks**, not packet words or stored pixels. For N positive ticks starting execution at system cycle C, its completion deadline is:

```text
deadline = C + ((N + 1) >> 1)
```

Zero-tick work completes its execution target immediately. Round each command's interval separately: two one-tick commands occupy two scheduling cycles, not one. Queued work continues from the preceding deadline even when completion is observed late. These are scheduled command intervals, not a specified physical GPU clock or sustained fill rate.

The following equations use integer arithmetic. `>>1` and `>>2` discard low bits; drawing-area right/bottom limits are inclusive. A retained skipped-row parity is either active or inactive. The cost equations do not count the exact rows, transparent texels, destination-mask hits or stored pixels.

For polygon, line/polyline and rectangle costs, decode each supplied position component and offset as signed eleven-bit values, then add them as ordinary integers. Do **not** wrap the sum back to signed eleven bits or apply the triangle's common 2048-coordinate shift. Drawing-area Y still uses the retained Y-address gate. These are timing inputs; they do not replace the primitive-specific raster placement rules.

**Polygons.** Add a setup cost and one work estimate for triangle (0,1,2), plus triangle (2,1,3) for a quad:

| Setup term | Ticks |
|---|---|
| Triangle / quad base | 46 / 82 |
| Additional Gouraud cost | 288 |
| Additional texture cost, flat / Gouraud | 180 / 162 |

For each triangle, return zero work if its source bounding span exceeds 1024 columns or 512 rows, or the drawing area is empty. The spans include both endpoints: `max−min+1`. Otherwise clamp each vertex's X/Y separately to the inclusive drawing-area limits and calculate:

```text
D = (x1−x0)×(y2−y0) − (x2−x0)×(y1−y0)
p = abs(D) >> 1
if textured:                       p = 2×p
if semitransparent OR mask-check:   p = p + ((p+1) >> 1)
if skipped-row parity is active:    p = p >> 1
```

Apply these steps in order. Semitransparency and mask checking together add the surcharge **once**, not twice. Raw texturing still pays the textured setup and work terms. Zero work does not remove polygon setup.

For an untextured flat quad at `(38,22),(46,22),(38,29),(46,29)`, use zero offset and drawing area X=40…43,Y=24…26, with no skipping or mask checking. Its two clamped triangles are `(40,24),(43,24),(40,26)` and `(40,26),(43,24),(43,26)`. Each has |D|=6 and p=3: total cost is `82+3+3=88` ticks, or 44 cycles. Yet the original quad covers **12 integer samples** inside that drawing area, not six. Clamping vertices for this estimator is not geometric polygon clipping or a raster sample count.

For the same geometry with Gouraud texturing and both semitransparency and mask checking, setup is `82+288+162=532`. Each work term becomes `3→6→9`, giving 550 ticks/275 cycles. Active row skipping makes each term `9>>1=4`, giving 540 ticks/270 cycles. Do not halve setup.

**Lines and polylines.** Reject an excessive source span using the same 1024×512 inclusive limits. Intersect the source bounding rectangle with the drawing area; an empty intersection has zero work. Otherwise let W/H be that intersection's inclusive width/height. With active row skipping replace H by `max(1,H>>1)`, then work is `max(W,H)`. This bounding-box calculation is not a count of line samples surviving clipping.

A finite line costs just that work, whether flat or Gouraud. A polyline's initial two-point header costs `16+work`; later continuation segments cost their individual work without another 16-tick setup. For a vertical line `(40,20)→(40,28)` clipped to Y=22…27, W=1,H=6 gives six ticks/three cycles. Active skipping makes it three ticks/two cycles. The same first segment as a polyline costs 22 ticks/11 cycles, or 19 ticks/10 cycles with skipping. A horizontal line's width can dominate the maximum, so skipping does not generally halve line cost. A zero-work finite line completes immediately; a zero-work initial polyline still costs 16 ticks.

**Drawing rectangles.** Select the fixed or variable dimensions first, then clip the offset rectangle against the drawing area. An empty result costs 16 ticks. For a nonempty result, let W/H be the clipped dimensions **before** row halving. Set row cost `q=W`, add the texture overhead below when textured, then add `(W+1)>>1` when semitransparency **or** mask checking is enabled. Finally use H′=H without skipping, or `max(1,H>>1)` with skipping:

```text
N = 16 + q×H′
Q = (128 − (128 remainder W)) / W
```

Q is an exact integral quotient used only in the narrow-width branches. The texture overhead added to q is:

| Texture format | First matching condition | Additional row ticks |
|---|---|---|
| 4-bit palette | Always | W |
| 8-bit palette | W>128 | `(W>>2)×8` |
| 8-bit palette | Otherwise W×H>2048 | `(W>>2)×4×Q` |
| 8-bit palette | Otherwise | W |
| Direct 16-bit, including format 3 | W>128 | `(W>>1)×8` |
| Direct 16-bit, including format 3 | Otherwise W×H>1024 | `(W>>2)×8×Q` |
| Direct 16-bit, including format 3 | Otherwise | W |

The comparisons are strict, and the wide-row test comes first. Use the **original clipped H**, not H′, when choosing a texture branch. For a palette4 rectangle at `(6,6)`, size 11×6, drawing area X=8…15,Y=7…10 clips it to W=8,H=4. With both semitransparency and mask checking, q=`8+8+4=20`; active skipping gives H′=2 and N=`16+20×2=56` ticks/28 cycles. The two flags still add only one four-tick row surcharge.

<div class="keep-together">

With no semitransparency, mask check or skipping, these nonempty examples expose the texture boundaries:

| Format | Clipped W×H | Texture overhead | Total ticks | Cycles |
|---|---|---|---|---|
| 8-bit palette | 64×32 | 64 | 4112 | 2056 |
| 8-bit palette | 64×33 | 128 | 6352 | 3176 |
| Direct 16-bit | 64×16 | 64 | 2064 | 1032 |
| Direct 16-bit | 64×17 | 256 | 5456 | 2728 |
| 8-bit palette | 128×1 | 128 | 272 | 136 |
| 8-bit palette | 129×1 | 256 | 401 | 201 |
| Direct 16-bit | 129×1 | 512 | 657 | 329 |
| 4-bit palette | 129×1 | 129 | 274 | 137 |

</div>

At W=64, Q=2. Enabling skipping on the 64×33 palette8 case keeps its overhead 128 and q=192, but uses H′=16: `16+192×16=3088` ticks/1544 cycles. It must not switch to the lower-area branch. These thresholds specify command cost, not a physical texture-cache capacity. Even H=1 remains H′=1 when skipping is active; do not infer one stored row from that minimum cost.

**Fill and raw transfers.** For fill, decode rounded width `w=((rawWidth AND 3FFH)+15) AND NOT 15` and height `h=rawHeight AND 1FFH`:

```text
fill ticks = 46 + ((w >> 3) + 9)×h
copy ticks = 2×W×H
```

Copy W/H use image normalization: `W=((rawWidth−1) AND 3FFH)+1`, `H=((rawHeight−1) AND 1FFH)+1`. A 32×4 fill costs 98 ticks/49 cycles; a 3×5 copy costs 30 ticks/15 cycles. Fill cost is unchanged by suppressed rows. Even raw fill width=0,height=4 costs 82 ticks/41 cycles although it writes no pixels. Conversely, zero image dimensions select a 1024×512 copy, costing 1,048,576 ticks/524,288 cycles—not an empty operation.

Upload emission and the readback command each cost one tick, independently of area. That is not the time to supply an upload payload, move the data or make readback ready. Readback has separate pending/submitted/ready phases and stops queued parsing while nonidle.

E1–E6, IRQ request and non-NOP unmatched GP0 operations also cost one tick; their selected register/IRQ effect occurs at parser execution, before that completion deadline. Boundary-discarded NOPs have no queued cost interval. GP1 controls have no separate queued raster-cost interval. For example, an IRQ behind a 32×4 fill starting at cycle 0 executes and raises at 49, then completes at 50; the IRQ does not prove presentation has finished.

Finally, budget the **CPU work** separately. A scalar word issue has two base CPU cycles before address/value preparation, control flow and admission waits. CPU and GPU work can overlap; do not blindly add every modeled command interval to every word-store cost. A complete cartridge budget must include its actual issue schedule and synchronization, not convert these equations into a pixels-per-second or transfer-bandwidth guarantee.

<a id="gpu-complete-budget"></a>
## Count a complete issue-and-fence interval

Command ticks do not include preparing words, polling status, acknowledging an
IRQ or retaining a result. The following complete scalar ISA function supplies a
32×4 red fill, queues an IRQ marker, waits for it, saves the observed status,
acknowledges both IRQ latches, checks idle separately, saves that status and
returns. **Its cost is 83 system cycles**, not 83 plus the fill's command interval.
CPU issue/polling and GPU work overlap.

This budget specifies an instruction schedule. It is not a claim that every BLua
spelling of the same procedure emits these instructions. The preceding executable
cartridge shows BLua programming; the schedule here makes its own address setup,
loads/stores, tests, taken branches and return explicit.

### Define the interval and initial state

Start counting at the first instruction of an already-entered function. The GPU
is idle, with empty input, no partial packet or readback, its IRQ request clear,
and no pending competing work. The reset drawing/display state supplies no row
suppression. DMA does not own either port, ingress is not stopped, the controller
pending and mask words are zero, and no IRQ, fault or other bus master interrupts
the interval. The beam remains on reset line parity zero throughout these 83
cycles. Startup, the caller and initialization that establishes these preconditions
are outside this stated interval.

Reserve eight writable bytes at illustrative RAM address `0x080c1000` for the two
status snapshots. This is cartridge-owned result storage, not GPU scratch RAM.
The function loads every address/value it uses; none of its CPU registers is
assumed preloaded:

| Register | Constant loaded by LOADK |
|---|---|
| r0 | GP0 address `0x0801023c` |
| r1 | GP1/GPUSTAT address `0x08010240` |
| r2 | Red fill word `0x020000ff` |
| r3 | Zero: destination `(0,0)` and the comparison operand |
| r4 | Fill size word `0x00040020`:32×4 |
| r5 | IRQ marker word `0x1f000000` |
| r6 | GPU IRQ status mask `0x01000000`, bit 24 |
| r7 | GP1 acknowledge word `0x02000000` |
| r8 | Controller acknowledge address `0x08000004` |
| r9 | Controller GPU IRQ bit `0x00000040` |
| r10 | Result-storage address `0x080c1000` |
| r11 | GPU idle status mask `0x04000000`, bit 26 |

r12 holds a GPUSTAT read; r13 holds its masked test. The twelve LOADK instructions
cost twelve cycles. All memory operations below are scalar displaced **Word**
loads/stores with two-cycle base cost. An address `base+4` uses displacement 1;
no extra address ADD is hidden in this schedule. Every GP0 store uses the same
r0 address, not an incrementing destination.

### Specify every stored instruction

The operation column describes ISA effects, not BLua source syntax. EQ uses
A=1: if the masked value differs from zero, skip the following JMP. Thus a clear
status bit executes the backward branch; a set bit exits the polling loop.
BAND, EQ and an executed JMP each cost one cycle. A skipped JMP is not issued.

| Instruction index | Operation |
|---|---|
| 0…11 | LOADK: load the twelve constants above into r0…r11 |
| 12 | STORE_MEM_D: r2 → Word[r0], fill header |
| 13 | STORE_MEM_D: r3 → Word[r0], destination |
| 14 | STORE_MEM_D: r4 → Word[r0], size; complete the fill packet |
| 15 | STORE_MEM_D: r5 → Word[r0], IRQ marker |
| 16 | LOAD_MEM_D: Word[r1] → r12 |
| 17 | BAND: r12 AND r6 → r13 |
| 18 | EQ: compare r13 with r3; skip instruction 19 when unequal |
| 19 | JMP: jump to instruction 16 |
| 20 | STORE_MEM_D: r12 → Word[r10], retain IRQ observation |
| 21 | STORE_MEM_D: r7 → Word[r1], acknowledge GPU request |
| 22 | STORE_MEM_D: r9 → Word[r8], acknowledge controller pending bit |
| 23 | LOAD_MEM_D: Word[r1] → r12 |
| 24 | BAND: r12 AND r11 → r13 |
| 25 | EQ: compare r13 with r3; skip instruction 26 when unequal |
| 26 | JMP: jump to instruction 23 |
| 27 | STORE_MEM_D: r12 → Word[r10+4], retain idle observation |
| 28 | RET: return, two cycles |

There are 29 stored instruction words, but loops change the executed count. In
this case instructions 16…19 execute nine unsuccessful passes, followed by
one successful pass 16…18. Instructions 23…25 succeed at the first idle check;
JMP at instruction 26 is not issued.

This is an execution fence and status readout, not image readback or a displayed
frame. A C0 image read requires its separate READY/ownership/count protocol and
has no fixed whole-transfer latency established by the one-tick command cost.
Neither the 83-cycle function nor a sum of drawing costs establishes physical bus
bandwidth, sustained fill rate or the CPU cost of a complete game frame.

<div class="keep-together">

### Follow issue, command completion and readout

Count cycles relative to function entry. Each mapped access occurs at its
instruction's charged endpoint:

| Cycle | Event |
|---|---|
| 12 | All constants are loaded |
| 14,16,18 | The three fill words are accepted; the complete fill starts at 18 |
| 20 | IRQ marker accepted behind the active fill, without waiting for idle |
| 22,27,…,62 | Nine completed status reads find GPU IRQ bit 24 clear |
| 67 | Fill reaches `18+49`; marker executes and sets IRQ. The tenth read sees IRQ set but idle clear |
| 68 | The marker's own one-tick interval completes |
| 69 | BAND/EQ finish selecting the successful IRQ path; JMP at instruction 19 is skipped |
| 71 | First retained status is written to result word 0 |
| 73,75 | GPU request and controller pending latches are acknowledged separately |
| 77 | First separate idle read completes with bit 26 set |
| 79 | Idle BAND/EQ complete; JMP at instruction 26 is skipped |
| 81,83 | Second status is retained, then RET completes |

</div>

The fill costs 98 command ticks, 49 cycles. The marker adds its own one-cycle
interval: completion of the queued work is at 68, not at the first IRQ observation
at 67. Under the stated reset/parity conditions, the saved words are `11922000H`
(IRQ set, idle clear) and `14922000H` (IRQ clear, idle set). In general, beam and
configuration fields must be interpreted rather than compared with these whole
example constants.

| Executed work | Instructions | CPU cycles |
|---|---:|---:|
| Address/value setup | 12 LOADK | 12 |
| Supply fill and marker | 4 stores | 8 |
| Nine unsuccessful IRQ passes | 9×(load, BAND, EQ, JMP) | 45 |
| Successful IRQ pass | load, BAND, EQ | 4 |
| Retain IRQ status; acknowledge GPU and controller | 3 stores | 6 |
| Successful idle check | load, BAND, EQ | 4 |
| Retain idle status | 1 store | 2 |
| Return | 1 RET | 2 |
| **Complete entered-function interval** | **63** | **83** |

No direct CPU store stalls in this sequence; the marker fits in the input while
the fill executes. The 49 IRQ-poll cycles are still charged CPU work, not free
waiting. Replacing polling with an interrupt handler changes setup, entry,
acknowledgement and resumption costs and needs its own budget.
