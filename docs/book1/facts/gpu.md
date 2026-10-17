# GPU fact sheet

Editorial input for the GPU chapter. Pixel, packet/protocol and command/control
extraction are separate scoped assignments integrated below. This is not
publication approval: independent audits, programmer explanations and actual
execution/print evidence remain distinct work. No architecture document or
hardware-reference PDF supplied facts.

# Pixel and raw-local-memory datapath — scoped facts

## Scope and disposition

Read-only audit of the current mirrored software rasterizer, its command-to-raster boundary, raw VRAM access/color helpers, central render rules and the matching GP0/VRAM specification leaves. Installed VRAM size and the narrowly needed draw-field parity producer were checked at their owners. No architecture document, hardware reference PDF or external-hardware assumptions were used. **No TS/C++ or specification disagreement was found in these scoped facts.** This is not proof of every accelerated backend.

Packet lengths/opcode catalog, GP0 ingress/command completion, DMA/GPUREAD handshakes and GP1/status programming are assigned elsewhere. Their interfaces are mentioned only where needed to identify the actual pixel input or memory effect. PCRTC storage-format sampling, signal coordinates, output composition and scanout clocks belong to its separate chapter: the raster/texture address below is not a PCRTC CT16/CT32 address.

Notation: `trunc(a/b)` is signed integer division toward zero; `q >> n` is the owning integer shift; `clamp(v,a,b)` limits to the closed interval. `S11(w)` means decode low eleven bits as signed two's complement, range −1024…1023. All quantities below are the actual finite words, decoded coordinates and integer attributes, not physical light/color units.

## 1. Raw VRAM representation and the display boundary

| ID | Exact fact / reader consequence | Mirrored source anchors |
|---|---|---|
| M01 | Installed GPU local memory is `00200000H` bytes = 2 MiB = 1,048,576 sixteen-bit words. This is storage shared with display sampling, not a second private texture RAM. The VRAM specification's coordinate address periods are 1024 by 1024 words. | TS `machine/ts/spec/bmsx/model.ts:46–56`, `machine/ts/spec/gx/vram.ts:1–5`, `machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts:34–35`; C++ `machine/cpp/spec/bmsx/model.h:51–61`, `machine/cpp/spec/gx/vram.h:9–14`, `machine/cpp/render/backend/software/gx_gpu_scanout.cpp:35–38`. |
| M02 | Raw GPU coordinate access uses `index = (1024*y + (x & 1023)) & (wordCount−1)`. For the installed memory the final mask is `000FFFFFH`. X wraps **within its row**, rather than carrying an X overrun into the next row; the full word-index mask wraps the installed memory. | TS `machine/ts/render/backend/software/gx_gpu_vram.ts:11–13`, `machine/ts/render/backend/software/gx_gpu_state.ts:104–108`; C++ `machine/cpp/render/backend/software/gx_gpu_vram.h:16–25`, `machine/cpp/render/backend/software/gx_gpu_state.h:90–99`. |
| M03 | The Y-address gate is a separate logical address limit: zero selects mask `1FFH` (512 rows), nonzero selects `3FFH` (1024 rows). Transfer Y, drawing-area Y, texture-page Y and CLUT Y use that decode. A closed gate aliases or masks those addresses; it does not reduce installed VRAM. Texture-page-plus-V remains within the selected 256-row page. | TS `machine/ts/spec/gx/vram.ts:7–13`, `machine/ts/spec/gx/gp0.ts:76–92`, `machine/ts/render/backend/gx_gpu_render_rules.ts:222–224,252–254,303–305`; C++ `machine/cpp/spec/gx/vram.h:16–22`, `machine/cpp/spec/gx/gp0.h:78–94`, `machine/cpp/render/backend/gx_gpu_render_rules.h:226–228,256–258,307–309`. |
| M04 | A rendered color word has R in bits 4:0, G in 9:5, B in 14:10 and a separate stored bit 15. Untextured RGB bytes reduce by dropping the low three bits; pixel rendering is not a 24-bit framebuffer write. Raw image transfers can store any sixteen-bit word. Snapshot/load/readback byte order is low byte first. | TS `machine/ts/render/backend/software/gx_gpu_vram.ts:4–18,38–45,115–140`, `machine/ts/render/backend/software/gx_gpu.ts:35–42`; C++ `machine/cpp/render/backend/software/gx_gpu_vram.cpp:5–12`, `machine/cpp/render/backend/software/gx_gpu_vram.h:27–31,50–62,100–123,162–197`, `machine/cpp/render/backend/software/gx_gpu.cpp:52–61`. |
| M05 | Raster/texture access reads raw linear words. PCRTC's separate storage selectors invoke CT32/CT24/CT16/CT16S/GPU24/GX16 address functions at scanout. In particular, selecting CT16 for display does **not** make a primitive write through CT16 page/block/column mapping. A cartridge must arrange the same bytes for the display interpretation it selects. | TS `machine/ts/render/backend/software/gx_gpu_vram.ts:11–18`, `machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts:47–98`; C++ `machine/cpp/render/backend/software/gx_gpu_vram.h:16–31`, `machine/cpp/render/backend/software/gx_gpu_scanout.cpp:48–89`. |

### GP0 programming-word width supplement

M06. GP0 ordinary mapped word writes supply a complete32-bit command/input word,
not one sixteen-bit local-memory pixel. GP0's registered write callback is on the
normal mapped IO word path. This establishes the word-unit distinction only; it
does not claim every byte/halfword access is admitted or define packet lengths.
[TS GPU map](../../../machine/ts/machine/devices/gx/gpu.ts#L462-L466),
[C++ GPU map](../../../machine/cpp/machine/devices/gx/gpu.cpp#L53-L57),
[TS mapped word](../../../machine/ts/machine/memory/memory.ts#L627-L644),
[C++ mapped word](../../../machine/cpp/machine/memory/memory.cpp#L522-L539).

## 2. Primitive and attribute capabilities — not the packet catalog

| ID | Exact fact / reader consequence | Mirrored source anchors |
|---|---|---|
| P01 | Polygon work is a triangle or a four-vertex primitive decomposed into triangles **(0,1,2)** then **(2,1,3)**. Either has a single supplied RGB color or supplied per-vertex RGB, and may be untextured, texture-modulated or raw-textured. A quad is two triangle coverage/interpolation operations, not a bilinear four-corner surface. | TS `machine/ts/render/backend/software/gx_gpu_commands.ts:140–210`; C++ `machine/cpp/render/backend/software/gx_gpu_commands.cpp:139–212`. |
| P02 | Line and polyline work supplies flat or endpoint RGB; a polyline is a sequence of the same line-segment calculation. These line paths have no texture lookup. Rectangles have one supplied RGB and may be untextured or textured; there is no rectangle Gouraud plane. | TS `machine/ts/render/backend/software/gx_gpu_commands.ts:212–274`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:592–671,673–750`; C++ `machine/cpp/render/backend/software/gx_gpu_commands.cpp:214–285`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:632–713,823–909`. |
| P03 | Fixed rectangle extents are 1×1, 8×8 or 16×16. Variable extents are low ten width bits and low nine height bits: 0…1023 by 0…511. A zero extent produces no covered samples; it is not the image-transfer zero-means-maximum convention. | TS `machine/ts/render/backend/gx_gpu_render_rules.ts:99–123`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:182–205`; C++ `machine/cpp/render/backend/gx_gpu_render_rules.h:91–115`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:181–204`. |
| P04 | Triangle color and UV planes depend on supplied screen XY only. There is no Z, W, reciprocal depth, perspective correction or depth comparison in these plane/coverage inputs. The command executor applies commands in order to the same raw VRAM; it does not sort supplied polygons. Any requested 3D projection, lighting, near-plane clipping and depth-order selection must therefore be supplied before this datapath. | TS `machine/ts/render/backend/gx_gpu_render_rules.ts:37–69`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:209–365,367–590`, `machine/ts/render/backend/software/gx_gpu_commands.ts:276–303`; C++ `machine/cpp/render/backend/gx_gpu_render_rules.h:32–61`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:211–357,422–629`, `machine/cpp/render/backend/software/gx_gpu_commands.cpp:289–319`. |
| P05 | Each raster command consumes the draw mode, texture window, drawing area, offset, mask mode, Y gate and skipped-line parity retained with that command. Those are raw command-state words, not a fresh lookup of later drawing state for each pixel. | TS `machine/ts/machine/devices/gx/gpu_command_buffer.ts:418–445`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:238–278,435–455`; C++ `machine/cpp/machine/devices/gx/gpu_command_buffer.h:401–427`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:240–270,483–497`. |

## 3. Coordinate decode, drawing offset and rejection

| ID | Exact fact / reader consequence | Mirrored source anchors |
|---|---|---|
| X01 | Each supplied X and Y coordinate decodes as signed eleven bits; the other bits in its sixteen-bit component do not extend that range. Drawing offset X is signed low eleven bits and offset Y is signed bits 21:11. RGB input components are independent unsigned bytes, not signed or Q12 values. | TS `machine/ts/spec/gx/gp0.ts:66–69`, `machine/ts/render/backend/gx_gpu_render_rules.ts:71–77`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:57–67`; C++ `machine/cpp/spec/gx/gp0.h:68–71`, `machine/cpp/render/backend/gx_gpu_render_rules.h:63–69`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:49–59`. |
| X02 | Polygon vertices receive the decoded offset as ordinary integer sums. Before any triangle raster-bucket shift, the triangle is rejected if `maxX−minX+1 > 1024` or `maxY−minY+1 > 512`. Thus the largest accepted coordinate differences are 1023 and 511. This is **per triangle**, including each quad half; it is not a screen-resolution specification. | TS `machine/ts/render/backend/software/gx_gpu_commands.ts:144–165,201–208`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:223–237,387–401`, `machine/ts/render/backend/gx_gpu_render_rules.ts:276–286`; C++ `machine/cpp/render/backend/software/gx_gpu_commands.cpp:146–167,203–210`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:225–239,442–456`, `machine/cpp/render/backend/gx_gpu_render_rules.h:280–290`. |
| X03 | For an accepted triangle, separately for each axis, if the minimum offset coordinate is below −1024, add 2048 to **all three** coordinates on that axis; otherwise add zero. This is a common triangle shift, not independent S11 wrapping of each vertex. Positive sums above 1023 are not independently wrapped. The shifted triangle is then area-tested and clipped against the drawing area. | TS `machine/ts/render/backend/gx_gpu_render_rules.ts:32–35`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:226–256,390–420`; C++ `machine/cpp/render/backend/gx_gpu_render_rules.h:27–30`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:228–258,445–475`. |
| X04 | Rectangle origins use `S11(offsetX + S11(vertexX))` and `S11(offsetY + S11(vertexY))` before extending right/down by their width/height. A rectangle therefore does not use the triangle common-shift rule. Its end coordinate is not repeatedly S11-wrapped as pixels are traversed. | TS `machine/ts/render/backend/software/gx_gpu_commands.ts:212–227`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:182–205,600–605`; C++ `machine/cpp/render/backend/software/gx_gpu_commands.cpp:214–232`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:181–204,650–655`. |
| X05 | Lines receive the ordinary offset endpoint sums. Before sample generation they use the same inclusive-span rejection thresholds as triangles. Individual generated sample X/Y values are then S11-wrapped before drawing-area checks. This is distinct from both rectangle-origin wrapping and triangle-bucket shifting. | TS `machine/ts/render/backend/software/gx_gpu_commands.ts:230–274`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:674–676,727–730`, `machine/ts/render/backend/gx_gpu_render_rules.ts:268–274`; C++ `machine/cpp/render/backend/software/gx_gpu_commands.cpp:235–285`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:833–835,886–889`, `machine/cpp/render/backend/gx_gpu_render_rules.h:272–278`. |
| X06 | Drawing-area X uses ten bits and drawing-area Y uses the current Y gate. Programmed bottom/right coordinates are **inclusive**; consumers use `[left,right+1)` and `[top,bottom+1)`. Reversed decoded X or Y endpoints produce an empty dimension (both decoded endpoints for that dimension become zero), not automatic exchange. Offset moves primitives, not the drawing area. | TS `machine/ts/spec/gx/gp0.ts:71–93`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:175–187,238–256`; C++ `machine/cpp/spec/gx/gp0.h:73–95`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:174–186,240–258`. |
| X07 | Polygon, rectangle and line paths can skip one retained row parity. The parity producer selects the active-line LSB only when vertical-resolution and interlace status bits are both set and draw-to-displayed-field is clear; otherwise sentinel 2 means no row parity matches. This is a draw suppression rule, not a general mask of the displayed rectangle. Full GP1/status programming remains the other audit's responsibility. | TS `machine/ts/machine/devices/gx/gpu.ts:194–195,2002–2006`, `machine/ts/machine/devices/gx/gpu_command_buffer.ts:15`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:199–204,331–332,727–730`; C++ `machine/cpp/machine/devices/gx/gpu.cpp:26–27,1476–1480`, `machine/cpp/machine/devices/gx/gpu_command_buffer.h:23`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:198–203,323–324,886–889`. |

## 4. Coverage and triangle interpolation

| ID | Exact fact / reader consequence | Mirrored source anchors |
|---|---|---|
| C01 | A zero-area triangle emits no pixels. Both nonzero orientations are accepted: the area sign normalizes the edge tests instead of culling one winding. The candidate bounds are minimum coordinates inclusive and maximum coordinates exclusive, intersected with the drawing area. | TS `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:234–260,331–347,398–424`; C++ `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:236–262,323–339,453–479`. |
| C02 | Coverage evaluates integer pixel coordinates, not `(x+½,y+½)`. For each orientation-normalized edge, let `A=(x2−x0)*(y1−y0)−(y2−y0)*(x1−x0)`, `s` be +1 for positive A and −1 for negative A, and `E=s*((x−ax)*(by−ay)−(y−ay)*(bx−ax))`, with correspondingly normalized `stepX` and `stepY`. The minimum is 0 if `stepX>0` or (`stepX=0` and `stepY>0`); otherwise it is 1. A pixel must meet all three minima. This explicit tie rule determines shared edges; it is not “all boundary pixels included.” | TS `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:53–55,279–288,325–347`, `machine/ts/render/backend/gx_gpu_render_rules.ts:288–290`; C++ `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:45–47,271–280,313–339`, `machine/cpp/render/backend/gx_gpu_render_rules.h:292–294`. |
| C03 | A rectangle covers integer samples from its clipped left/top inclusive to right/bottom exclusive. Triangle shared-edge ownership does not apply to rectangle edges. Lines instead generate `max(abs(dx),abs(dy))+1` samples, including both ends for an unclipped accepted segment; a zero-length accepted segment generates one sample. | TS `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:182–205,684–686,715–730`; C++ `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:181–204,843–845,874–889`. |
| C04 | Since a polyline calls the inclusive line calculation for every consecutive pair, a shared endpoint may be written by both adjacent segments. For blending/mask effects it is not equivalent to a polygon seam guaranteed once-only. Quad triangles likewise remain independent: the edge rule avoids double-writing a normal shared diagonal, but overlapping quad halves can cover the same pixel twice. | TS `machine/ts/render/backend/software/gx_gpu_commands.ts:161–165,248–274`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:727–742`; C++ `machine/cpp/render/backend/software/gx_gpu_commands.cpp:163–167,256–285`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:886–901`. |
| I01 | Triangle RGB and UV attributes use the same affine integer-plane calculation with 12 fractional bits and a `FFFFFH` twenty-bit attribute field. Each derivative is the signed determinant quotient **truncated toward zero**, then reduced to twenty raw bits. The derivative's signed twenty-bit decode is used when forming the intercept. Readout takes bits 19:12 (`>>12 & FFH`), so representable attribute overflow wraps, not clamps to a byte. | TS `machine/ts/render/backend/gx_gpu_render_rules.ts:17–22,37–69`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:313–323,344–346,481–515,537–541`; C++ `machine/cpp/render/backend/gx_gpu_render_rules.h:12–17,32–61`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:301–311,336–338,518–553,579–583`. |
| I02 | For each attribute `a`, using shifted XY and signed determinant `D=(x1−x0)*(y2−y0)−(x2−x0)*(y1−y0)`, the unmasked derivatives are `trunc(4096*((a1−a0)*(y2−y1)−(a2−a1)*(y1−y0))/D)` and `trunc(4096*((x1−x0)*(a2−a1)−(x2−x1)*(a1−a0))/D)`. These are separate X/Y quotients, not a fresh floating-point barycentric calculation per pixel. | TS `machine/ts/render/backend/gx_gpu_render_rules.ts:37–67`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:313–314,481–492`; C++ `machine/cpp/render/backend/gx_gpu_render_rules.h:32–59`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:301–302,518–529`. |
| I03 | Anchor selection is exactly `x1<=x0 ? (x2<=x1 ? 2 : 1) : (x2<x0 ? 2 : 0)`. With decoded signed derivatives `sx,sy`, intercept is `(aAnchor*4096 + 2048 − xAnchor*sx − yAnchor*sy) & FFFFFH`. Evaluation is intercept plus X/Y derivative steps; extraction above discards the 12 fractional bits. The +2048 is a half **attribute-unit** bias (color or texel coordinate), not a geometric half-pixel shift of coverage. | TS `machine/ts/render/backend/gx_gpu_render_rules.ts:49–67`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:321–346,514–541`; C++ `machine/cpp/render/backend/gx_gpu_render_rules.h:43–59`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:309–338,552–583`. |
| I04 | Flat supplied color is used unchanged as bytes. Gouraud RGB uses its three planes before color quantization or texture modulation. Textured triangles always interpolate U/V; raw-textured triangles ignore supplied RGB and do not interpolate it for output. There is one point sample per covered pixel; no texture filtering or mip selection participates in this sample path. | TS `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:303–347,448–449,481–555,157–168`; C++ `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:291–339,519–607,767–779,106–117`. |

## 5. Exact line sampling and color steps

| ID | Exact fact / reader consequence | Mirrored source anchors |
|---|---|---|
| L01 | Before DDA setup, if start X exceeds end X, the endpoints **and their colors** exchange places. Equal-X vertical lines retain their supplied endpoint order. Let `N=max(abs(dx),abs(dy))`; for `N>0`, XY steps use scale `2^32` and quotient `trunc((delta*2^32 + sign(delta)*(N−1))/N)` (zero delta gives zero). This is directed outward rounding of the step magnitude, not ordinary nearest rounding. | TS `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:77–99,684–697,715–717`; C++ `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:14–30,843–856,874–876`. |
| L02 | XY starts are `x0*2^32 + 2^31 − 1024` and `y0*2^32 + 2^31 − (yStep<0 ? 1024 : 0)`. Each sample converts by the mathematical integer floor of fixed/`2^32`, then S11-wraps and clips. The fixed bias 1024 is `2^−22` of one pixel; replacing it with an ordinary integer-endpoint interpolation changes tie cases. | TS `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:77–99,722–730`; C++ `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:14–30,881–889`. |
| L03 | RGB line start is `byte0*4096+2048`; RGB step is `trunc((byte1−byte0)*4096/N)` or zero for `N=0`. Each generated sample takes integer quotient by 4096 and then the ordinary pixel color path. The field-skip/drawing-area checks suppress stores, not the progression of XY/RGB along the original segment. | TS `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:101–111,715–749`; C++ `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:33–43,874–907`. |

## 6. Texture page, window, packing and CLUT

| ID | Exact fact / reader consequence | Mirrored source anchors |
|---|---|---|
| T01 | U/V command components are unsigned bytes. A triangle's plane readout also extracts an eight-bit U and V. Texture-window application is `(coord & andMask) \| orMask`, which restricts rectangle/flipped coordinates to the eight-bit window domain as well. It is a bit replacement, not a geometric clipping rectangle. | TS `machine/ts/render/backend/gx_gpu_render_rules.ts:240–246,321–335`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:69–71,127–139,540–541`; C++ `machine/cpp/render/backend/gx_gpu_render_rules.h:244–250,325–339`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:61–90,582–583`. |
| T02 | For X, `andMask=(~(maskX*8)) & FFH` and `orMask=(offsetX & maskX)*8`; Y is identical. The two masks and two offsets are five-bit values. Thus an all-zero texture-window word is identity on an eight-bit coordinate; only masked offset bits participate, and the low three coordinate bits are never replaced by this window. | TS `machine/ts/render/backend/gx_gpu_render_rules.ts:321–335`; C++ `machine/cpp/render/backend/gx_gpu_render_rules.h:325–339`. |
| T03 | Texture-page base X is draw-mode low four bits ×64 **raw words** (0…960). Base Y is draw-mode bit 4 ×256 plus bit 11 ×512, passed through the Y gate. Texture-depth selection uses draw-mode bits 8:7. A 256×256 texel domain occupies 64, 128 or 256 raw words per row for four-bit, eight-bit or direct-sixteen-bit samples respectively. Crossing raw X=1023 wraps X within the row. | TS `machine/ts/render/backend/gx_gpu_render_rules.ts:299–309`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:127–139`, `machine/ts/render/backend/software/gx_gpu_vram.ts:11–13`; C++ `machine/cpp/render/backend/gx_gpu_render_rules.h:303–313`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:78–90`, `machine/cpp/render/backend/software/gx_gpu_vram.h:16–25`. |
| T04 | Depth 0: fetch raw word at `(pageX + (U>>2), pageY+V)`, select nibble `(word >> (4*(U&3))) & FH`, then fetch its CLUT word. Depth 1: fetch at `(pageX + (U>>1), pageY+V)`, select byte `(word >> (8*(U&1))) & FFH`, then CLUT. Depth 2 **and representable depth 3** directly fetch the sixteen-bit word at `(pageX+U,pageY+V)`; 3 is not rejected or mapped to a palette. U/V here are after the texture window. | TS `machine/ts/spec/gx/gp0.ts:50–52`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:127–139`; C++ `machine/cpp/spec/gx/gp0.h:52–54`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:78–90,147–159`. |
| T05 | The CLUT attribute chooses base X `(attribute & 3FH)*16` and base Y `(attribute>>6)` through the Y gate. The index is added to X and uses the same raw VRAM index/wrap as other reads; an eight-bit palette crossing X=1023 does not spill to another row. There are 16 possible lookup indices for palette4 and 256 for palette8. A palette **index zero is not by itself transparent**; transparency tests the fetched sixteen-bit CLUT color word. | TS `machine/ts/render/backend/gx_gpu_render_rules.ts:248–254`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:129–139,157–159`; C++ `machine/cpp/render/backend/gx_gpu_render_rules.h:252–258`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:80–90,106–108`. |
| T06 | Textured rectangle U and V each advance by +1 or −1 per destination pixel/row according to the independent draw-mode X/Y flip bits. The initial UV is adjusted by the amount clipped off left/top, so clipping does not restart the texture at its original UV. Skipped rows still advance V. The flip bits are not used by triangle interpolation. | TS `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:607–610,632–641,367–590`; C++ `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:656–659,677–686,422–629`. |
| T07 | Each fetched sixteen-bit sample is tested for **exact zero** before modulation, blending, destination-mask testing or a store. `0000H` leaves destination untouched even when force-mask is enabled. `8000H` is a nonzero black sample and is processed. Raw texture preserves sample RGB555; modulated texture uses the supplied/interpolated RGB bytes by the stages below. | TS `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:142–171`; C++ `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:93–120`. |
| T08 | Texture reads and drawing writes use the same current raw VRAM array. The software path traverses triangle/rectangle rows top-to-bottom and spans left-to-right, reading a sample before writing that destination. No private texture-memory copy or PCRTC color decoding participates in that operation. This is the scoped software access order, not an unsourced physical texture-cache specification or an accelerated-backend guarantee. | TS `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:127–139,522–568,636–668`; C++ `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:78–90,564–607,681–710`. |

## 7. Color quantization, modulation and dithering

| ID | Exact fact / reader consequence | Mirrored source anchors |
|---|---|---|
| Q01 | Without texturing, the color path is RGB bytes → optional common dither offset added separately to each byte and clamped to 0…255 → each component shifted right three → RGB555. Blending uses that quantized five-bit source, not an eight-bit intermediate. | TS `machine/ts/render/backend/software/gx_gpu_vram.ts:104–140`; C++ `machine/cpp/render/backend/software/gx_gpu_vram.h:162–197`. |
| Q02 | For a modulated texture component `t` (0…31) and supplied/interpolated byte `c` (0…255), first compute `p=(t*c)>>4` (0…494), then `p+ditherOffset`; return 0 if negative, otherwise `min((p+ditherOffset)>>3,31)`. This is two specified truncation stages, with saturation after the dither addition. Do not first expand RGB555 by bit replication or treat color 255 as unity. **With dithering off, c=128 is exact unit gain.** Raw texturing bypasses this entire modulation/dither calculation. | TS `machine/ts/render/backend/software/gx_gpu_vram.ts:25–36`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:157–171`; C++ `machine/cpp/render/backend/software/gx_gpu_vram.h:37–48`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:106–120`. |
| Q03 | The common 4×4 dither matrix is selected by final destination `(x&3,y&3)`: rows `[-4,0,-3,1]`, `[2,-2,3,-1]`, `[-3,1,-4,0]`, `[3,-1,2,-2]`. It operates before reducing color to RGB555, not after blending and not as a PCRTC scanout effect. | TS `machine/ts/render/backend/software/gx_gpu_vram.ts:83–102,129–139`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:163–171`; C++ `machine/cpp/render/backend/software/gx_gpu_vram.h:125–160,177–197`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:112–120`. |
| Q04 | A set draw-mode dither bit enables polygon dithering only for **untextured Gouraud polygons** or **modulated textured polygons**. Flat untextured polygons and raw-textured polygons do not dither. Lines use the bit whether flat or Gouraud. Untextured and textured rectangles always pass dithering false; a global dither setting therefore does not imply every primitive changes. | TS `machine/ts/render/backend/gx_gpu_render_rules.ts:292–297`, `machine/ts/render/backend/software/gx_gpu_commands.ts:147`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:204,655–663,698–702,731–737`; C++ `machine/cpp/render/backend/gx_gpu_render_rules.h:296–301`, `machine/cpp/render/backend/software/gx_gpu_commands.cpp:149`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:203,699–707,857–861,890–897`. |

## 8. Per-pixel blend and stored bit 15

| ID | Exact fact / reader consequence | Mirrored source anchors |
|---|---|---|
| B01 | For untextured primitives, the command's semitransparency flag enables blending of every eligible covered pixel. For textured primitives, blending requires **both** that flag **and** fetched sample bit 15=1. A nonzero fetched texel with bit 15=0 remains opaque even under a semitransparent command. | TS `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:169–171,188–204,271–277,698–705`; C++ `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:118–120,187–203,375–415,857–864`. |
| B02 | Let `F` be one quantized five-bit foreground/source channel and `B` the current destination channel. Draw-mode blend selections 0…3 compute respectively `(B+F)>>1`, `min(B+F,31)`, `max(B−F,0)`, `min(B+(F>>2),31)`. They operate independently on R/G/B; destination/source bit 15 is not an alpha coefficient. The half mode is the truncated **sum** divided by two, not the sum of separately truncated halves. | TS `machine/ts/spec/gx/gp0.ts:53–56`, `machine/ts/render/backend/gx_gpu_render_rules.ts:311–313`, `machine/ts/render/backend/software/gx_gpu_vram.ts:47–81`; C++ `machine/cpp/spec/gx/gp0.h:55–58`, `machine/cpp/render/backend/gx_gpu_render_rules.h:315–317`, `machine/cpp/render/backend/software/gx_gpu_vram.h:64–98`. |
| B03 | In drawing and raw upload/copy masked writers, mask-mode bit 1 tests the destination's **old** bit 15 and suppresses the complete write when it is one. This test occurs before blend/store. Mask-mode bit 0 forces output bit 15 to one; otherwise textured draws copy sample bit 15, untextured draws write zero, and raw transfer/copy writes preserve source bit 15. Force-mask does not enable texture blending; only the fetched sample bit controls that eligibility. | TS `machine/ts/render/backend/gx_gpu_render_rules.ts:337–343`, `machine/ts/render/backend/software/gx_gpu_vram.ts:38–45,115–127`, `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:169–171`; C++ `machine/cpp/render/backend/gx_gpu_render_rules.h:341–347`, `machine/cpp/render/backend/software/gx_gpu_vram.h:50–62,100–123`, `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:118–120`. |
| B04 | A textured zero-word skip precedes destination-mask or force-mask effects. For a nonzero sample that blends, the blend affects RGB only; the eventual stored bit 15 still follows force-mask/sample-bit selection, not the old destination bit or the blended RGB value. This separates three often-confused meanings: transparent zero word, per-texel semitransparency eligibility and destination write protection. | TS `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:157–171`, `machine/ts/render/backend/software/gx_gpu_vram.ts:115–127`; C++ `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:106–120`, `machine/cpp/render/backend/software/gx_gpu_vram.h:100–123`. |

## 9. Fill and transfer memory effects — packet details belong elsewhere

| ID | Exact fact / reader consequence | Mirrored source anchors |
|---|---|---|
| V01 | Fill aligns X down to a multiple of 16 (`xy&3F0H`), rounds the low-ten-bit width upward to a multiple of 16 and takes low-nine-bit height. Thus width 1…16 fills 16 words, width 1009…1023 fills 1024, and width 0 stays 0. Y and each generated row use the Y gate; raw X wraps within the row. RGB888 is truncated to RGB555 and **bit 15 is zero**. | TS `machine/ts/render/backend/gx_gpu_render_rules.ts:125–135`, `machine/ts/render/backend/software/gx_gpu_commands.ts:53–73`, `machine/ts/render/backend/software/gx_gpu_vram.ts:15–18`; C++ `machine/cpp/render/backend/gx_gpu_render_rules.h:117–127`, `machine/cpp/render/backend/software/gx_gpu_commands.cpp:11–38`, `machine/cpp/render/backend/software/gx_gpu_vram.h:27–31`. |
| V02 | Fill directly assigns raw VRAM: it bypasses drawing offset, drawing-area clipping, dithering, semitransparency, destination-mask checking and force-mask. It **does** honor retained skipped-line parity. A fill is therefore not a large untextured drawing rectangle with identical side effects. | TS `machine/ts/render/backend/software/gx_gpu_commands.ts:53–73`; C++ `machine/cpp/render/backend/software/gx_gpu_commands.cpp:11–38`. |
| V03 | CPU-image upload and VRAM copy are raw sixteen-bit word writes through the masked-word writer; they apply check-mask/force-mask but not drawing area, offset, blend, dither or skipped-field suppression. Image dimensions decode as `((raw−1)&(limit−1))+1` with limits width 1024, height 512; raw zero means that maximum, unlike variable drawing rectangles/fill. X and generated Y wrap by their address rules. | TS `machine/ts/spec/gx/gp0.ts:57–60,95–101`, `machine/ts/render/backend/software/gx_gpu_commands.ts:75–138`, `machine/ts/render/backend/software/gx_gpu_vram.ts:38–45`; C++ `machine/cpp/spec/gx/gp0.h:59–62,97–103`, `machine/cpp/render/backend/software/gx_gpu_commands.cpp:40–137`, `machine/cpp/render/backend/software/gx_gpu_vram.h:50–62`. |
| V04 | A retained partial upload processes at most `min(width*height,2*payloadWordCount)` pixels in row-major order; it does not synthesize missing rectangle pixels. The source word's bit 15 passes through unless force-mask overrides it. Exactly where an upload is retained/aborted/completed is the command-control audit's responsibility. | TS `machine/ts/render/backend/gx_gpu_render_rules.ts:226–238`, `machine/ts/render/backend/software/gx_gpu_commands.ts:84–99`; C++ `machine/cpp/render/backend/gx_gpu_render_rules.h:230–242`, `machine/cpp/render/backend/software/gx_gpu_commands.cpp:52–75`. |
| V05 | Raw VRAM copy traverses rows in increasing logical row order. Within every row it traverses columns backward if `((targetX−sourceX)&1023)` is nonzero and less than width, otherwise forward. It reads each source word immediately before the destination masked write; it is not a whole-rectangle snapshot/transaction. In particular, downward vertically overlapping copies can read values written by a preceding row. | TS `machine/ts/render/backend/software/gx_gpu_commands.ts:102–119`; C++ `machine/cpp/render/backend/software/gx_gpu_commands.cpp:78–116`. |
| V06 | Readback uses the same raw linear index, X/Y wrap and low-byte-first sixteen-bit word order. It does not return PCRTC-composed, magnified, dithered-at-scanout or storage-format-converted output. Readback activation/fence/payload packing remains the other GP0 audit's contract. | TS `machine/ts/render/backend/software/gx_gpu.ts:32–45`; C++ `machine/cpp/render/backend/software/gx_gpu.cpp:48–64`. |

## 10. Numerical stage order suitable for the later manual

These are derived orderings of the cited facts, not an added abstraction or implementation proposal.

1. **Untextured triangle/line/rectangle:** coordinate decode and primitive-specific offset/wrap → size rejection where applicable → coverage/drawing-area/retained-field suppression → flat RGB or fixed-point interpolated RGB → eligible dither and byte saturation → RGB555 quantization → destination-mask rejection → optional five-bit blend against current destination → output-mask selection → raw-word store. Sources: X01–X07, C01–C04, I01–I04/L01–L03, Q01–Q04, B01–B04. The destination-mask test is in the shared writer; implementation may have already calculated source channels before it rejects the write.
2. **Textured triangle/rectangle:** coordinate/coverage steps as above → fixed U/V plane or ±1 rectangle UV stepping → eight-bit texture-window replacement → packed/direct raw texel fetch and optional raw CLUT fetch → exact-zero skip → raw RGB555 or fixed-point modulation with eligible dither/saturation → destination-mask rejection → optional five-bit blend only when command flag and sample bit 15 both permit it → forced/sample output bit 15 → raw-word store. Sources: T01–T08, Q02–Q04, B01–B04.
3. **Fill:** aligned/rounded fill dimensions and address wrap → retained-field suppression → unconditional RGB555 word assignment, bypassing the drawing-pixel path. Sources: V01–V02.
4. **Image/copy:** transfer-size and raw-coordinate decode → source word → destination-mask rejection → source/forced bit 15 and raw RGB bits store, with the explicit copy traversal if applicable. Sources: V03–V05.

## 11. Clock/cycle boundary

**Do not derive a rated pixels/clock, polygons/second, texture bandwidth, raster core clock, VRAM bus width/frequency or physical texture-cache capacity from this audit.** The scoped raster/color/VRAM owners calculate pixels and store words; they do not define a cycle period for those numerical stages. The command timing model is a separate owner (`machine/ts/machine/devices/gx/gpu_command_timing.ts` and `machine/cpp/machine/devices/gx/gpu_command_timing.cpp`) and belongs to the other technical/command audit. No display timing reference or installed CPU frequency is being relabeled as a raster clock. This is a scope/absence statement, not a new electrical guarantee.

## 12. Executed checks and independent arithmetic

The facts above come from the paired owners, not test titles or another machine's behavior. Current existing tests were used only to execute those owners; their historical hardware labels are not evidence of external compatibility.

Executed from the repository root:

```sh
node --import tsx --import ./tests/lua/test_setup.ts --test \
  --test-name-pattern='software backend owns texture modulation|packed RGB555 blend|software backend owns PSX line DDA|software backend blends untextured|software backend owns PSX triangle edges|software Gouraud triangles|software polygons wrap the raster bucket|software textured polygons|software texture sampling owns|software backend applies drawing offsets|software fill bypasses|software commands preserve texture mask|software commands sample palette8' \
  tests/lua/gx_gpu.test.ts
```

Result: **13 tests passed, 0 failed**. Covered existing actual-owner paths for modulation/blending, line samples and joints, triangle coverage/quad seams, fixed-12 RGB/UV, offset/bucket behavior, texture window/page/CLUT wrapping, fill exceptions and texture mask/flip/dither stores. This is not a CPU timing measurement or full-backend conformance claim.

A separate inline `node --import tsx --input-type=module` run imported the actual `gx_gpu_vram.ts` and `gx_gpu_render_rules.ts` owners and checked independent integer expressions:

- For **all 32×32 foreground/destination channel pairs and all four blend modes** (4096 combinations), independently computed B02's per-channel formulas and compared each of the three packed RGB555 lanes. All passed. This particularly verifies half-mode rounding, saturated add/subtract and quarter-source truncation; it is not a guessed translation of a mode name.
- Modulation live results: `(t,c,d)=(31,128,0)` → pre-dither 248 → 31; `(31,255,0)` → 494 → saturated 31; `(7,96,0)` → 42 → 5; `(1,1,−4)` → 0−4 → 0. The formula source is TS `machine/ts/render/backend/software/gx_gpu_vram.ts:25–36`; C++ `machine/cpp/render/backend/software/gx_gpu_vram.h:37–48`.
- Independent triangle attribute example: `(x,y,a)` = `(0,0,10)`, `(4,0,250)`, `(0,4,50)`, determinant 16. Derivatives are `60*4096=3C000H` and `10*4096=0A000H`. The exact anchor branch chooses vertex 0; its intercept is `10*4096+2048=0A800H`. Vertex 2 happens to yield the same intercept with these exact derivatives, so matching the intercept alone would not verify the anchor branch. Live plane output was `[0A800H,3C000H,0A000H]`. At row Y=1, extracted values for X=0…3 were `[20,80,140,200]`. These are attribute calculations; the list is **not** a claim that every listed sample passes triangle coverage. Source: TS `machine/ts/render/backend/gx_gpu_render_rules.ts:37–69`; C++ `machine/cpp/render/backend/gx_gpu_render_rules.h:32–61`.
- Texture-window raw word `00010C62H` produced live X/Y AND masks `EFH/E7H` and OR masks `10H/10H`, matching the independent five-bit replacement expressions. For example U=`27H` maps to `37H`; V=`3FH` maps to `37H`. Source: TS `machine/ts/render/backend/gx_gpu_render_rules.ts:321–335`; C++ `machine/cpp/render/backend/gx_gpu_render_rules.h:325–339`.
- The live 4×4 dither values matched Q03 exactly. Source: TS `machine/ts/render/backend/software/gx_gpu_vram.ts:83–102`; C++ `machine/cpp/render/backend/software/gx_gpu_vram.h:125–160`.

No native harness, new helper, framework, runtime edit, cartridge edit or publisher edit was introduced. Paired C++ calculations were read at the listed sources; the selected tests and inline calculations execute TypeScript.

## 13. Proposed paragraph-sized reader tasks (no chapter draft yet)

Each item is a concrete task to teach; these are editorial proposals, not additional hardware facts.

1. **Choose the storage contract before drawing.** Distinguish one raw sixteen-bit VRAM word, one 32-bit GP0 word and a PCRTC output sample; place a small raster tile in linear raw VRAM and select the matching display interpretation without borrowing CT16 swizzle rules. Use M01–M05; link to PCRTC rather than reproduce it.
2. **Choose a primitive for the required coverage.** Compare a small flat rectangle, Gouraud triangle, textured rectangle and two-triangle quad; identify which supplies RGB/UV and which has fixed/variable dimensions. Demonstrate the quad diagonal rather than promising four-corner bilinear interpolation. Use P01–P04 and C01–C04; packet layouts remain individual command entries elsewhere.
3. **Place a primitive without losing it at a coordinate boundary.** Decode signed-eleven-bit XY/offsets; show one rectangle-origin wrap, one whole-triangle bucket shift, one rejected span and one line-sample wrap. Then intersect with an explicitly inclusive drawing area, including a reversed-area empty case. Use X01–X06; do not flatten the three coordinate rules into one generic wrapping sentence.
4. **Predict shared-edge and joint writes.** Render two triangle halves with an additive blend to prove the diagonal is covered once; contrast an inclusive polyline joint and an overlapping quad half that can write twice. Give the actual edge inequality, not a borrowed name for a fill convention. Use C01–C04 and B02–B03.
5. **Choose interpolation precision deliberately.** Work one nonconstant RGB/UV triangle through the signed quotient, twenty-bit derivative/intercept, +½-attribute bias and byte extraction. Separate the geometric edge sample from the attribute seed, and contrast affine UV with software's responsibility for perspective approximation. Use I01–I04.
6. **Predict a line's endpoints and color ramp.** Work a short steep or vertical Gouraud segment through N+1 samples, Q32 XY bias, Q12 RGB progression and clipping without restarting the ramp. Contrast supplied equal-X endpoint order with the X-based swap. Use L01–L03.
7. **Locate a texture and its palette in words, not pixels.** Use one page near an X wrap, packed palette4 or palette8 indices and a CLUT crossing X=1023. Derive windowed UV and palette lookup, and include depth value 3's direct behavior. Show that index zero may select a visible palette word. Use T01–T05 and M02–M03.
8. **Clip and flip a textured rectangle without shifting its image.** Specify the original UV, destination clipping and X/Y flip independently; show first visible UV and continued V after a skipped row. Compare to triangle UV planes. Use T06 and X07.
9. **Choose raw or modulated color with a meaningful gain.** Use an unsaturated texel and nonidentity RGB bytes, not white-only arithmetic; demonstrate byte 128 as nondithered unity, 255 saturation and the exact two truncation stages. Include an eligible polygon versus a rectangle so the dither control is not taught as universal. Use Q01–Q04 and T07.
10. **Choose opacity, blend and protection separately.** Start with known destination RGB555; compare texels `0000H`, a nonzero bit-15-clear color and `8000H` under a semitransparent command. Then apply destination-mask test and force-mask, predicting both RGB and stored bit 15. Use T07 and B01–B04; keep PCRTC alpha/composition terminology separate.
11. **Clear or copy an image with the intended side effects.** Contrast fill's 16-word rounding and bypassed mask/area state with a drawing rectangle and a masked raw upload/copy. Include zero-size semantic differences and a vertically overlapping copy whose row order matters. Use V01–V06; do not reproduce transfer packet lengths or command-control lifetime rules.
12. **Budget work at the right owner.** Count actual candidate/covered samples to understand overdraw, then hand off to the command-timing section for modeled completion costs. Explicitly avoid claiming a physical raster clock or sustained fill rate from loops, PCRTC timing or CPU frequency. Use the scope in section 11; obtain any positive cycle formula from its actual timing owner before authoring it.


# GPU GP0 packet and protocol facts

Editorial facts, not a chapter draft. Scope: mirrored `spec/gx/gp0` leaves; live GP0 parser/execution, command-buffer/readback and command-timing owners; the mirrored software packet decoder and central render-rule leaves only where needed to identify consumed fields and transfer ordering. The GP1/status/ingress/access owner supplies port addresses, access-width/alignment faults, DMA admission/arbitration, reset/abort details and full interrupt acknowledgement. The pixel owner supplies raster/storage/texture arithmetic: the pixel-datapath facts above (especially V01–V06 for fill/transfer effects). No architecture document, reference PDF or external-console behavior was used. No runtime/repository/publisher edits.

**Scoped spec/mirror result:** no TS/C++ disagreement found. An initial audit message incorrectly suspected C0 header-length omission; the upper limit is `VRAM_TO_CPU_LAST`, so the shared A0–DF condition correctly returns three words. That warning is withdrawn and is not an unresolved finding.

## 1. Words, framing and the complete opcode partition

`C_i` below is a low 24 RGB888 color, R bits 7:0, G bits 15:8, B bits 23:16; `P_i` is a packed vertex position; `T_i` is U/V plus attribute; `S` is packed size. The high byte of the **first** word is the opcode. A table's word count includes that first word. These symbols are editorial packet notation, not a proposed BLua interface.

| ID | Fact | TS owner/spec | C++ owner/spec |
|---|---|---|---|
| F01 | GP0 input and GPUREAD values are **32-bit words**. GP0 accepts/stores raw word bits; packet scratch and retained words are `Uint32Array` / `u32`, not one 16-bit VRAM pixel per GP0 word. Opcode is `word>>24`; low 24 is command-specific payload. | [write path](../../../machine/ts/machine/devices/gx/gpu.ts#L1034-L1047), [spec](../../../machine/ts/spec/gx/gp0.ts#L8-L9), [word storage](../../../machine/ts/machine/devices/gx/gpu_command_buffer.ts#L232-L236) | [write path](../../../machine/cpp/machine/devices/gx/gpu.cpp#L551-L566), [spec](../../../machine/cpp/spec/gx/gp0.h#L15-L16), [word storage](../../../machine/cpp/machine/devices/gx/gpu_command_buffer.h#L213-L225) |
| F02 | Only the current parser phase determines whether a word is a command. Fixed packets wait for their exact total count. A0 headers select counted image payload; polyline headers select continuation payload. Opcode-looking/NOP/terminator-looking words **inside another packet's required fields or image payload** do not start commands. | [framing](../../../machine/ts/machine/devices/gx/gpu.ts#L1062-L1133), [execution parser](../../../machine/ts/machine/devices/gx/gpu.ts#L1153-L1191) | [framing](../../../machine/cpp/machine/devices/gx/gpu.cpp#L579-L650), [execution parser](../../../machine/cpp/machine/devices/gx/gpu.cpp#L721-L759) |
| F03 | At a command boundary, opcodes `00`, `04–1e`, `e0`, `e7–ef` are discarded before FIFO insertion and without starting command timing. This recognition does not apply in payload phases. | [NOP set](../../../machine/ts/machine/devices/gx/gpu.ts#L154-L159), [boundary test](../../../machine/ts/machine/devices/gx/gpu.ts#L1062-L1073) | [NOP set](../../../machine/cpp/machine/devices/gx/gpu.cpp#L19-L24), [boundary test](../../../machine/cpp/machine/devices/gx/gpu.cpp#L579-L591) |
| F04 | Other unhandled opcodes (`01`, `03`, `f0–ff`) are one-word commands with no draw/transfer/environment action and one command tick. No packet-decoder fault or invalid-opcode IRQ is generated by these cases. Do not assign an imported “texture-cache clear” operation to `01`. | [length default](../../../machine/ts/machine/devices/gx/gpu.ts#L1723-L1743), [execution default](../../../machine/ts/machine/devices/gx/gpu.ts#L1236-L1259) | [length default](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1206-L1226), [execution default](../../../machine/cpp/machine/devices/gx/gpu.cpp#L815-L838) |
| F05 | The remaining complete partition is `02` fill; `1f` IRQ; `20–3f` polygons; `40–5f` finite lines/polylines; `60–7f` rectangles; `80–9f` VRAM copy; `a0–bf` upload; `c0–df` readback; `e1–e6` drawing environment. All values in each range select that family, not only its first opcode. | [spec ranges](../../../machine/ts/spec/gx/gp0.ts#L1-L26), [dispatch](../../../machine/ts/machine/devices/gx/gpu.ts#L1194-L1262) | [spec ranges](../../../machine/cpp/spec/gx/gp0.h#L8-L33), [dispatch](../../../machine/cpp/machine/devices/gx/gpu.cpp#L774-L841) |
| F06 | RGB colors consume low 24 only. Primitive X is signed bits 10:0 of the low half and Y signed bits 26:16; each has range −1024…1023. Remaining five bits of each half do not extend this coordinate. E5 supplies an additional signed 11-bit offset. This is not a signed 16-bit vertex-coordinate contract. | [signed 11-bit](../../../machine/ts/spec/gx/gp0.ts#L66-L69), [vertex/offset Y](../../../machine/ts/render/backend/gx_gpu_render_rules.ts#L71-L77), [color bytes](../../../machine/ts/render/backend/software/gx_gpu_rasterizer.ts#L57-L66) | [signed 11-bit](../../../machine/cpp/spec/gx/gp0.h#L68-L71), [vertex/offset Y](../../../machine/cpp/render/backend/gx_gpu_render_rules.h#L63-L69), [color bytes](../../../machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp#L49-L59) |

### Fixed render packets

Opcode-field semantics are family-specific. **Polygons:** bit 4 Gouraud colors; bit 3 quad instead of triangle; bit 2 textured; bit 1 semi-transparency request; bit 0 raw texture instead of color modulation when textured. **Lines:** bit 4 Gouraud, bit 3 continuation/polyline, bit 1 semi-transparency; bits 2/0 do not add texture/fields. **Rectangles:** bits 4:3 select size, bit 2 texture, bit 1 semi-transparency, bit 0 raw texture. A rectangle's bit 4 is **not** Gouraud. Bit 0 does not create a raw-color mode for untextured primitives. Sources: [TS opcode predicates](../../../machine/ts/render/backend/gx_gpu_render_rules.ts#L79-L123), [TS line decoder](../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L230-L245), [C++ predicates](../../../machine/cpp/render/backend/gx_gpu_render_rules.h#L71-L115), [C++ line decoder](../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L235-L254). These are fact F07.

| ID | Packet variant and exact word order | Triangle / quad count | Paired source |
|---|---|---|---|
| F08 | Flat untextured polygon: `(opcode<<24)\|C0, P0,P1,P2[,P3]` | 4 / 5 | [TS lengths](../../../machine/ts/machine/devices/gx/gpu.ts#L1745-L1752), [TS decoder](../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L201-L209); [C++ lengths](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1228-L1236), [C++ decoder](../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L203-L211) |
| F09 | Gouraud untextured polygon: `(opcode<<24)\|C0,P0, C1,P1, C2,P2[,C3,P3]` | 6 / 8 | [TS lengths](../../../machine/ts/machine/devices/gx/gpu.ts#L1745-L1752), [TS decoder](../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L185-L197); [C++ lengths](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1228-L1236), [C++ decoder](../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L187-L199) |
| F10 | Flat textured polygon: `(opcode<<24)\|C0, P0,T0, P1,T1, P2,T2[,P3,T3]` | 7 / 9 | [TS lengths](../../../machine/ts/machine/devices/gx/gpu.ts#L1745-L1752), [TS decoder](../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L170-L182); [C++ lengths](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1228-L1236), [C++ decoder](../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L172-L184) |
| F11 | Gouraud textured polygon: `(opcode<<24)\|C0,P0,T0, C1,P1,T1, C2,P2,T2[,C3,P3,T3]` | 9 / 12 | [TS lengths](../../../machine/ts/machine/devices/gx/gpu.ts#L1745-L1752), [TS decoder](../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L149-L166); [C++ lengths](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1228-L1236), [C++ decoder](../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L151-L168) |
| F12 | A quad is decoded as triangles `(0,1,2)` then `(2,1,3)`, retaining the corresponding color/UV attributes; it is not an independent arbitrary four-point tessellator. | Applies to all four quad variants | [TS splits](../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L161-L208); [C++ splits](../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L163-L210) |
| F13 | Finite flat line: `(opcode<<24)\|C0,P0,P1`; finite Gouraud line: `(opcode<<24)\|C0,P0,C1,P1`. Bit 3 clear selects these finite packets. No terminating word follows. | 3 / 4 words | [TS lengths](../../../machine/ts/machine/devices/gx/gpu.ts#L1754-L1757), [TS decoder](../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L230-L245); [C++ lengths](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1238-L1241), [C++ decoder](../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L235-L254) |
| F14 | Rectangle: `(opcode<<24)\|C0,P0[,T0][,S]`. T0 exists only with bit 2 set. S exists only when bits 4:3=`00`; then width=`S&3ff`, height=`(S>>16)&1ff` (zero stays zero). Bits 4:3=`01`,`10`,`11` select fixed 1×1,8×8,16×16 with **no** S word. Thus variable untextured/textured lengths are 3/4, fixed lengths 2/3. | 2–4 words | [TS lengths](../../../machine/ts/machine/devices/gx/gpu.ts#L1759-L1763), [TS dimensions](../../../machine/ts/render/backend/gx_gpu_render_rules.ts#L99-L123), [TS decoder](../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L212-L227); [C++ lengths](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1243-L1247), [C++ dimensions](../../../machine/cpp/render/backend/gx_gpu_render_rules.h#L91-L115), [C++ decoder](../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L214-L232) |

F15 — Every texture word has U bits 7:0 and V bits 15:8. T0's upper 16 supplies CLUT coordinates: CLUT X=`(attribute&3f)*16`; CLUT Y=`attribute>>6` passed through the selected VRAM Y-address mask. For textured polygons only, T1's upper 16 also updates persistent draw mode with `(old&~09ff)|(attribute&09ff)` before that polygon is retained. T1 occurs at packet index 4 flat or5 Gouraud. That updates page/mode/blend plus page-Y-high, preserving E1 bits 9,10,12,13. T2/T3 upper halves do not supply additional page changes. Textured rectangles use current draw mode; their single T0 supplies CLUT, not a page overwrite. [TS U/V/CLUT](../../../machine/ts/render/backend/gx_gpu_render_rules.ts#L240-L254), [TS page extraction/merge](../../../machine/ts/spec/gx/gp0.ts#L103-L113), [TS persistent update](../../../machine/ts/machine/devices/gx/gpu.ts#L1237-L1242), [TS rectangle decoder](../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L212-L225); [C++ U/V/CLUT](../../../machine/cpp/render/backend/gx_gpu_render_rules.h#L244-L258), [C++ page extraction/merge](../../../machine/cpp/spec/gx/gp0.h#L105-L115), [C++ update](../../../machine/cpp/machine/devices/gx/gpu.cpp#L816-L821), [C++ rectangle decoder](../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L214-L230).

### Streamed polylines

| ID | Fact | TS owner | C++ owner |
|---|---|---|---|
| F16 | Bit 3 set in `40–5f` starts a polyline with the same two-endpoint header as F13: flat 3 words or Gouraud 4. This initial segment is emitted before the terminator arrives. Flat continuation adds P2,P3,… with retained C0; Gouraud continuation adds C2,P2,C3,P3,…, retaining the previous endpoint/color as each next segment's first endpoint. | [start/continuation](../../../machine/ts/machine/devices/gx/gpu.ts#L1684-L1721) | [start/continuation](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1161-L1198) |
| F17 | Terminator matches **all** words satisfying `(word&f000f000)==50005000`, not only literal `50005000`. It is recognized only after the header and only at continuation phase 0: the next P slot for flat, the next C slot for Gouraud. A matching Gouraud **position** word at phase 1 is consumed as position, not terminator. The terminator itself emits no segment. | [phase recognition](../../../machine/ts/machine/devices/gx/gpu.ts#L1112-L1131), [execution check](../../../machine/ts/machine/devices/gx/gpu.ts#L1161-L1175) | [phase recognition](../../../machine/cpp/machine/devices/gx/gpu.cpp#L627-L648), [execution check](../../../machine/cpp/machine/devices/gx/gpu.cpp#L729-L743) |
| F18 | There is no fixed total polyline word count. Parser scratch stores only the finite header/current segment; every completed continuation segment becomes a finite retained line. Missing terminator keeps the stream in polyline phase; missing Gouraud position keeps the partial C/P pair. Buffer drain can pause the stream without discarding retained endpoint state. | [continuation storage](../../../machine/ts/machine/devices/gx/gpu.ts#L1684-L1721), [drain boundary](../../../machine/ts/machine/devices/gx/gpu.ts#L1161-L1175) | [continuation storage](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1161-L1198), [drain boundary](../../../machine/cpp/machine/devices/gx/gpu.cpp#L729-L743) |

## 2. Fill and data transfers

The following families use **VRAM address coordinates**, not signed primitive positions. X is low 10; Y comes from the high half and is masked to the selected 512- or 1024-row addressing period. The Y-address extension is an independently supplied GP1 state, not a larger transfer-height field. Sources: fact F19, [TS transfer coordinates](../../../machine/ts/render/backend/gx_gpu_render_rules.ts#L218-L224), [TS Y mask](../../../machine/ts/spec/gx/vram.ts#L1-L13); [C++ transfer coordinates](../../../machine/cpp/render/backend/gx_gpu_render_rules.h#L222-L228), [C++ Y mask](../../../machine/cpp/spec/gx/vram.h#L8-L21).

| ID | Family and complete packet/protocol | Paired source |
|---|---|---|
| F20 | `02` fill is exactly `(02<<24)\|RGB888, destinationXY, S` (3 words). X is rounded down by `XY&3f0`; width is `((S&3ff)+15)&~15`; height=`(S>>16)&1ff`. Width/height zero are empty, **not** maximal transfer dimensions. Fill converts byte colors to RGB555 and does not consume payload pixels. Pixel facts V01–V02 cover area/offset/mask bypass and retained field parity. | [TS length](../../../machine/ts/machine/devices/gx/gpu.ts#L1723-L1726), [TS fill decoder](../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L53-L73), [TS size rules](../../../machine/ts/render/backend/gx_gpu_render_rules.ts#L125-L135); [C++ length](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1206-L1209), [C++ decoder](../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L11-L38), [C++ rules](../../../machine/cpp/render/backend/gx_gpu_render_rules.h#L117-L127) |
| F21 | Transfers `80–df` normalize dimensions with `W=(((S&ffff)−1)&3ff)+1`, `H=((((S>>16)&ffff)−1)&1ff)+1`, so W 1…1024 / H 1…512. Zero size word selects 1024×512; raw halfwords 1025/513 select 1×1. They do not share rectangle/fill zero-size rules. Max transfer area 524288 pixels,1048576 bytes. | [TS normalizers/constants](../../../machine/ts/spec/gx/gp0.ts#L57-L60), [TS formulas](../../../machine/ts/spec/gx/gp0.ts#L95-L101); [C++ constants](../../../machine/cpp/spec/gx/gp0.h#L59-L62), [C++ formulas](../../../machine/cpp/spec/gx/gp0.h#L97-L103) |
| F22 | `80–9f` copy is `opcode<<24, sourceXY,destinationXY,S` (4 words). Header low 24 and opcode low 5 do not choose alternate formats. It copies raw 16-bit VRAM words with the retained mask mode, no GP0 payload or CPU readback. Source/destination addressing wraps. The ordered overlap behavior is **not a full-rectangle snapshot**: rows forward, columns reversed only for overlapping forward X distance; see pixel fact V05 rather than assuming memmove in two dimensions. | [TS dispatch/length](../../../machine/ts/machine/devices/gx/gpu.ts#L1251-L1252), [TS length](../../../machine/ts/machine/devices/gx/gpu.ts#L1736-L1738), [TS decoder/order](../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L102-L138); [C++ dispatch](../../../machine/cpp/machine/devices/gx/gpu.cpp#L830-L831), [C++ length](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1219-L1221), [C++ decoder/order](../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L80-L137) |
| F23 | `a0–bf` upload header is `opcode<<24,destinationXY,S` (3 words), followed by exactly `(W*H+1)>>1` payload words. Header low 24/opcode low 5 do not select variants. Pixel sequence is row-major: payload low 16 first, then high 16, continuing across row boundaries. For an odd pixel count the last high 16 is ignored; the **next whole word** begins the next command. Data bits are raw 16-bit storage words, not RGB888 or floating point. | [TS header/remaining](../../../machine/ts/machine/devices/gx/gpu.ts#L1805-L1813), [TS emission](../../../machine/ts/machine/devices/gx/gpu.ts#L1652-L1681), [TS payload decode](../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L75-L100); [C++ header](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1285-L1293), [C++ emission](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1130-L1158), [C++ decode](../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L40-L78) |
| F24 | A normal upload is retained as one backend command only after the counted payload finishes. Before that, its header/payload words are stored but commandCount does not yet include a complete upload. No “end image” opcode replaces its count. An interrupted/GP1-cleared upload can retain the emitted prefix if any payload word arrived; header-only work is removed. Full abort/accepted-work semantics belong to the GP1 facts, not a blanket rollback promise. | [TS start/finish/flush](../../../machine/ts/machine/devices/gx/gpu.ts#L1652-L1681), [TS start](../../../machine/ts/machine/devices/gx/gpu.ts#L1805-L1813); [C++ start](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1285-L1293), [C++ finish/flush](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1130-L1158) |
| F25 | `c0–df` readback is `opcode<<24,sourceXY,S` (3 words) with no GP0 pixel payload. Header low 24/opcode low 5 do not select formats. Its own execution deadline activates one pending readback with a command-count fence, copied coordinates/dimensions/Y state and cursor 0. A later packet cannot execute past a non-idle readback. | [TS length](../../../machine/ts/machine/devices/gx/gpu.ts#L1739-L1741), [TS dispatch](../../../machine/ts/machine/devices/gx/gpu.ts#L1255-L1256), [TS activation](../../../machine/ts/machine/devices/gx/gpu_command_buffer.ts#L120-L130), [TS fence/activation](../../../machine/ts/machine/devices/gx/gpu_command_buffer.ts#L205-L208), [TS barrier](../../../machine/ts/machine/devices/gx/gpu.ts#L1153-L1156); [C++ length](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1222-L1224), [C++ dispatch](../../../machine/cpp/machine/devices/gx/gpu.cpp#L834-L835), [C++ activation](../../../machine/cpp/machine/devices/gx/gpu_command_buffer.h#L131-L141), [C++ fence](../../../machine/cpp/machine/devices/gx/gpu_command_buffer.h#L185-L188), [C++ barrier](../../../machine/cpp/machine/devices/gx/gpu.cpp#L721-L724) |
| F26 | Readback transitions pending→submitted only when the backend claims the **exact fence command count**, then submitted→ready on the matching completion token. Backend work through that fence is performed before pixel extraction. Thus C0's one scheduled command tick is not data-ready latency or transfer bandwidth. This is an implementation completion protocol, not another guest packet. | [TS claim/complete](../../../machine/ts/machine/devices/gx/gpu_command_buffer.ts#L147-L160), [TS backend ordering](../../../machine/ts/render/backend/software/gx_gpu.ts#L18-L50); [C++ claim/complete](../../../machine/cpp/machine/devices/gx/gpu_command_buffer.h#L88-L101), [C++ backend ordering](../../../machine/cpp/render/backend/software/gx_gpu.cpp#L26-L65) |
| F27 | Ready readback is consumed in row-major raw 16 order, first pixel low 16/next high 16 of each GPUREAD. Odd final pixel has **zero high 16**. Reading the last word returns readback to idle and resumes the queued parser. A read before ready does not consume a pixel: it returns the existing GPUREAD latch. CPU-versus-DMA ownership qualification belongs to the ingress/GP1 facts. | [TS packing/end](../../../machine/ts/machine/devices/gx/gpu_command_buffer.ts#L163-L185), [TS latch/consume/resume](../../../machine/ts/machine/devices/gx/gpu.ts#L1019-L1032), [TS row-major extract](../../../machine/ts/render/backend/software/gx_gpu.ts#L33-L48); [C++ packing/end](../../../machine/cpp/machine/devices/gx/gpu_command_buffer.h#L107-L129), [C++ latch/consume/resume](../../../machine/cpp/machine/devices/gx/gpu.cpp#L536-L548), [C++ extraction](../../../machine/cpp/render/backend/software/gx_gpu.cpp#L48-L63) |

## 3. Drawing-environment commands and write visibility

Each E1–E6 command is one word `(opcode<<24)|parameter`; it updates state **when the ordered GP0 parser executes it**, not merely when software supplies its word into ingress. It starts one command tick, but is not itself a retained draw command. Packets already retained keep the raw environment snapshot they received. Facts F28–F35 below specify this, not a claim that a GP0 write has physically rendered pixels.

| ID | Fact | Paired source |
|---|---|---|
| F28 | E1 retains parameter bits 13:0 only (`3fff`): page X bits 3:0×64; page Y bit 4×256 and bit 11×512 (subject to selected Y address mask); blend selector bits 6:5; texture format bits 8:7; dither bit 9; draw-to-displayed-field bit 10; rectangle X/Y flip bits 12/13. Texture format 0/1/2 means 4-bit paletted / 8-bit paletted / direct 16-bit; representable 3 reaches the same direct 16-bit sampling branch, not an input fault. Pixel/blend/filter effects are in the pixel facts. | [TS mask/write](../../../machine/ts/machine/devices/gx/gpu.ts#L161-L166), [TS write](../../../machine/ts/machine/devices/gx/gpu.ts#L1815-L1829), [TS fields](../../../machine/ts/spec/gx/gp0.ts#L44-L56), [TS page/modes](../../../machine/ts/render/backend/gx_gpu_render_rules.ts#L299-L313), [TS format branch](../../../machine/ts/render/backend/software/gx_gpu_rasterizer.ts#L127-L139); [C++ mask](../../../machine/cpp/machine/devices/gx/gpu.h#L36-L41), [C++ write](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1295-L1308), [C++ fields](../../../machine/cpp/spec/gx/gp0.h#L46-L58), [C++ page/modes](../../../machine/cpp/render/backend/gx_gpu_render_rules.h#L303-L317), [C++ format default](../../../machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp#L147-L161) |
| F29 | E2 retains 20 bits: X mask bits 4:0, Y mask bits 9:5, X offset bits 14:10, Y offset bits 19:15. A coordinate is transformed as `(coord & (~(mask<<3)&ff)) \| ((offset&mask)<<3)` independently for U/V; it is not an arbitrary pixel rectangle or dimensions. | [TS write](../../../machine/ts/machine/devices/gx/gpu.ts#L1216-L1219), [TS masks](../../../machine/ts/render/backend/gx_gpu_render_rules.ts#L321-L335), [TS combination](../../../machine/ts/render/backend/software/gx_gpu_rasterizer.ts#L69-L71); [C++ write](../../../machine/cpp/machine/devices/gx/gpu.cpp#L795-L798), [C++ masks](../../../machine/cpp/render/backend/gx_gpu_render_rules.h#L325-L339), [C++ combination](../../../machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp#L61-L63) |
| F30 | E3/E4 each retain 20 bits: X bits 9:0, Y bits 19:10. They are inclusive top-left/bottom-right drawing limits, converted to half-open bounds by +1 on right/bottom. Y is masked by the selected address extension. Reversed X or Y endpoints produce an empty axis rather than a wrapped drawing interval or error. They do not change transfer width/height formulas. | [TS writes](../../../machine/ts/machine/devices/gx/gpu.ts#L1220-L1227), [TS bounds](../../../machine/ts/spec/gx/gp0.ts#L71-L93); [C++ writes](../../../machine/cpp/machine/devices/gx/gpu.cpp#L799-L806), [C++ bounds](../../../machine/cpp/spec/gx/gp0.h#L73-L95) |
| F31 | E5 retains 22 bits: signed 11-bit X bits 10:0 and signed 11-bit Y bits 21:11; each −1024…1023. It is a primitive drawing offset, not a VRAM-copy/upload/readback origin. | [TS write](../../../machine/ts/machine/devices/gx/gpu.ts#L1228-L1231), [TS signed 11-bit](../../../machine/ts/spec/gx/gp0.ts#L66-L69), [TS offset](../../../machine/ts/render/backend/gx_gpu_render_rules.ts#L75-L77); [C++ write](../../../machine/cpp/machine/devices/gx/gpu.cpp#L807-L810), [C++ signed 11-bit](../../../machine/cpp/spec/gx/gp0.h#L68-L71), [C++ offset](../../../machine/cpp/render/backend/gx_gpu_render_rules.h#L67-L69) |
| F32 | E6 retains only bits 1:0. Bit 0 requests destination bit 15 set; bit 1 requests no write over destination bit 15 already set. This is snapshotted state, not an upload header flag. Raw upload/copy honor it; fill bypasses it (pixel V02/V03/V05). | [TS write](../../../machine/ts/machine/devices/gx/gpu.ts#L1831-L1835), [TS predicates](../../../machine/ts/render/backend/gx_gpu_render_rules.ts#L337-L343), [TS raw writer](../../../machine/ts/render/backend/software/gx_gpu_vram.ts#L38-L45); [C++ write](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1310-L1313), [C++ predicates](../../../machine/cpp/render/backend/gx_gpu_render_rules.h#L341-L347), [C++ writer](../../../machine/cpp/render/backend/software/gx_gpu_vram.h#L50-L62) |
| F33 | Retained commands snapshot draw mode, Y-address extension, texture window, area top-left/bottom-right, drawing offset, mask mode and skipped-field parity at emission. Changing E1–E6 later does not reinterpret earlier retained words. Textured polygon T1 updates E1 before taking its own snapshot (F15). Upload state is snapshotted at complete/flush emission; its payload cannot execute E commands. | [TS emission](../../../machine/ts/machine/devices/gx/gpu.ts#L1765-L1803), [TS storage](../../../machine/ts/machine/devices/gx/gpu_command_buffer.ts#L418-L445), [TS upload emission](../../../machine/ts/machine/devices/gx/gpu.ts#L1652-L1681); [C++ emission](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1248-L1283), [C++ storage](../../../machine/cpp/machine/devices/gx/gpu_command_buffer.h#L401-L427), [C++ upload emission](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1130-L1158) |
| F34 | The parser serializes execution behind a nonzero command-completion deadline and any non-idle readback. A complete drawing packet can be appended before its deadline; `executedCommandCount` advances at that deadline. Rendering/presentation/readback backend work is a separate frontier, not every accepted GP0 word becoming an immediate VRAM write. | [TS parser gate](../../../machine/ts/machine/devices/gx/gpu.ts#L1153-L1191), [TS completion](../../../machine/ts/machine/devices/gx/gpu.ts#L1264-L1295), [TS backend ordering](../../../machine/ts/render/backend/software/gx_gpu.ts#L18-L50); [C++ parser gate](../../../machine/cpp/machine/devices/gx/gpu.cpp#L721-L759), [C++ completion](../../../machine/cpp/machine/devices/gx/gpu.cpp#L684-L703), [C++ backend ordering](../../../machine/cpp/render/backend/software/gx_gpu.cpp#L26-L65) |
| F35 | `1f` is a one-word request, ignoring low 24: at parser execution it latches GPU interrupt request and raises `IRQ_GPU` only when that latch was previously clear, then starts one command tick. It does not rasterize, push a rendering command, drain readback, or itself acknowledge either interrupt latch. It is not proof of scanout/presentation/backend completion. See GP1/IRQ facts for acknowledgement and interrupt-controller state. | [TS request](../../../machine/ts/machine/devices/gx/gpu.ts#L1204-L1211), [TS parser ordering](../../../machine/ts/machine/devices/gx/gpu.ts#L1153-L1156); [C++ request](../../../machine/cpp/machine/devices/gx/gpu.cpp#L784-L790), [C++ parser ordering](../../../machine/cpp/machine/devices/gx/gpu.cpp#L721-L724) |

## 4. Positive timing equations and limits of the timing claim

These are the current **command-tick model**, not physical/electrical bandwidth specifications. CPU preparation, word loads/stores, DMA admission and backend data readiness are separate. Parent ingress facts own the CPU/store cost and full scheduling interface.

| ID | Timing fact | Paired source |
|---|---|---|
| T01 | Two command ticks map to one system/CPU scheduling cycle: positive deadline=`start+((ticks+1)>>1)`; zero-tick work advances the command frontier immediately. On a late service, the next queued command begins from the previous completion cycle, not the late observation time. | [TS constant](../../../machine/ts/machine/devices/gx/gpu_command_timing.ts#L23-L23), [TS schedule/chain](../../../machine/ts/machine/devices/gx/gpu.ts#L1264-L1295); [C++ schedule](../../../machine/cpp/machine/devices/gx/gpu.cpp#L762-L772), [C++ chain](../../../machine/cpp/machine/devices/gx/gpu.cpp#L684-L703) |
| T02 | E1–E6,1F and unhandled one-word commands take 1 tick; boundary-discarded NOPs take no queued timing interval. Upload emission and readback command take 1 tick independent of area. The latter is **not** the subsequent readback transfer's completion time. | [TS fixed](../../../machine/ts/machine/devices/gx/gpu.ts#L1204-L1234), [TS default](../../../machine/ts/machine/devices/gx/gpu.ts#L1255-L1259), [TS transfer timing](../../../machine/ts/machine/devices/gx/gpu_command_timing.ts#L302-L306); [C++ fixed](../../../machine/cpp/machine/devices/gx/gpu.cpp#L784-L813), [C++ default](../../../machine/cpp/machine/devices/gx/gpu.cpp#L834-L837), [C++ transfer timing](../../../machine/cpp/machine/devices/gx/gpu_command_timing.cpp#L261-L264) |
| T03 | Fill ticks=`46+((roundedWidth>>3)+9)*height`, using F20 dimensions, even if the area is empty or some rows are skipped by retained parity. Copy ticks=`2*W*H`, using F21 normalized dimensions. | [TS fill/copy](../../../machine/ts/machine/devices/gx/gpu_command_timing.ts#L290-L301); [C++ fill/copy](../../../machine/cpp/machine/devices/gx/gpu_command_timing.cpp#L249-L260) |
| T04 | Polygon setup ticks=`(quad?82:46)+(Gouraud?288:0)+(textured?(Gouraud?162:180):0)`, plus the T05 work estimate for triangle 012 and, for quad, triangle 213. Raw-texture bit 0 does not remove the textured setup/work surcharge. | [TS polygon](../../../machine/ts/machine/devices/gx/gpu_command_timing.ts#L104-L141); [C++ polygon](../../../machine/cpp/machine/devices/gx/gpu_command_timing.cpp#L76-L112) |
| T05 | Per-triangle work estimate: if source bounding span exceeds 1024×512, or drawing area is empty, return 0. Clamp each vertex to inclusive drawing-area endpoints, then `p=abs(signed double area)>>1`. If textured, `p*=2`; if semi-transparent **or** mask-check enabled, `p+=(p+1)>>1`; if a field parity is skipped, `p>>=1`. This is a timing estimator from integer vertices, **not** a claim of exact covered/stored/visible pixel count. | [TS triangle work](../../../machine/ts/machine/devices/gx/gpu_command_timing.ts#L58-L102); [C++ triangle work](../../../machine/cpp/machine/devices/gx/gpu_command_timing.cpp#L30-L74) |
| T06 | Line work: reject source bounding spans exceeding 1024×512, intersect the inclusive source bounding rectangle with drawing bounds, return 0 for empty intersection; otherwise max(clipped width,clipped height). If skipping a field, halve clipped height with integer shift and make its minimum 1. Finite lines and continuation segments use this work alone. Initial polyline header uses `16+sum(segment work)` (the live parser emits its initial two-point segment, so one such work term), with no repeated 16 setup on later emitted finite-line segments. | [TS line work](../../../machine/ts/machine/devices/gx/gpu_command_timing.ts#L25-L56), [TS polyline](../../../machine/ts/machine/devices/gx/gpu_command_timing.ts#L230-L260), [TS dispatch](../../../machine/ts/machine/devices/gx/gpu_command_timing.ts#L279-L287); [C++ line work](../../../machine/cpp/machine/devices/gx/gpu_command_timing.cpp#L6-L28), [C++ polyline](../../../machine/cpp/machine/devices/gx/gpu_command_timing.cpp#L189-L218), [C++ dispatch](../../../machine/cpp/machine/devices/gx/gpu_command_timing.cpp#L238-L246) |
| T07 | Rectangle timing first selects F14 dimensions and clips offset position/extent against drawing bounds; empty result takes 16 ticks. Otherwise, let W/H be clipped width/height **before** field halving. Start row cost q=W, add texture overhead T08 if textured, then add `(W+1)>>1` if semi-transparent **or** mask-check enabled. For field skip, replace H by max(1,H>>1). Ticks=`16+q*H`. | [TS rectangle](../../../machine/ts/machine/devices/gx/gpu_command_timing.ts#L143-L228); [C++ rectangle](../../../machine/cpp/machine/devices/gx/gpu_command_timing.cpp#L114-L187) |
| T08 | Rectangle texture overhead added to row cost: 4-bit paletted →W. 8-bit paletted →`(W>>2)*8` when W>128; otherwise `(W>>2)*4*Q` when W*H>2048; otherwise W. Direct 16-bit / format 3 →`(W>>1)*8` when W>128; otherwise `(W>>2)*8*Q` when W*H>1024; otherwise W. Here `Q=(128−(128%W))/W` is the integral quotient. H in these branch tests is before field halving. Do not interpret these model branches as a documented physical cache-size guarantee. | [TS texture timing](../../../machine/ts/machine/devices/gx/gpu_command_timing.ts#L190-L220); [C++ texture timing](../../../machine/cpp/machine/devices/gx/gpu_command_timing.cpp#L151-L179) |
| T10 | Polygon, finite-line/polyline and rectangle timing coordinates decode each supplied X/Y and offset as signed eleven-bit values, then add them as ordinary integers. The cost calculation does not re-encode that sum to signed eleven bits or apply the raster triangle's common 2048-coordinate bucket shift. Drawing-area decode still uses the retained Y gate. Apply the timing-coordinate rules before T05–T08, not the later raster placement rules; the resulting work estimates are not exact coverage. | [TS polygon coordinates](../../../machine/ts/machine/devices/gx/gpu_command_timing.ts#L120-L138), [TS rectangle coordinates](../../../machine/ts/machine/devices/gx/gpu_command_timing.ts#L178-L188), [TS polyline coordinates](../../../machine/ts/machine/devices/gx/gpu_command_timing.ts#L241-L255), [TS finite line](../../../machine/ts/machine/devices/gx/gpu_command_timing.ts#L279-L285); [C++ polygon](../../../machine/cpp/machine/devices/gx/gpu_command_timing.cpp#L91-L109), [C++ rectangle](../../../machine/cpp/machine/devices/gx/gpu_command_timing.cpp#L137-L147), [C++ polyline](../../../machine/cpp/machine/devices/gx/gpu_command_timing.cpp#L200-L213), [C++ finite line](../../../machine/cpp/machine/devices/gx/gpu_command_timing.cpp#L238-L244) |
| T11 | For the specified scalar ISA budget, LOADK/BAND/EQ/JMP each cost1 base cycle; displaced Word LOAD_MEM_D/STORE_MEM_D and RET cost2. The dispatch charges base cycles before the selected operation, so the ordinary mapped access observes that instruction's charged endpoint. Word displacement is scaled by4. EQ with A=1 skips the following instruction when operands are unequal; the skipped instruction is not issued/charged. These are instruction costs, not physical bus signals or an assertion about every BLua compiler lowering. | [TS costs](../../../machine/ts/spec/blua32/opcode.ts#L75-L84), [TS dispatch](../../../machine/ts/machine/cpu/cpu.ts#L1838-L1853), [TS Word displacement](../../../machine/ts/machine/cpu/cpu.ts#L2992-L3010), [TS EQ](../../../machine/ts/machine/cpu/cpu.ts#L2692-L2700), [TS JMP](../../../machine/ts/machine/cpu/cpu.ts#L2849-L2852); [C++ costs](../../../machine/cpp/spec/blua32/opcode.cpp#L5-L69), [C++ dispatch](../../../machine/cpp/machine/cpu/cpu.cpp#L2464-L2484), [C++ Word displacement](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L554-L568), [C++ EQ](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L341-L353), [C++ JMP](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L424-L427) |
| T12 | IRQ-controller reset clears pending and mask words. A GPU request sets pending independently of the mask; the asserted maskable line is pending AND mask. Controller acknowledgement clears only selected pending bits, separately from GP1(02)'s GPU latch. The scalar budget keeps delivery masked, polls GPUSTAT, and acknowledges both latches; it does not include an interrupt handler. | [TS reset/line/raise](../../../machine/ts/machine/devices/irq/controller.ts#L19-L27), [TS line/raise](../../../machine/ts/machine/devices/irq/controller.ts#L74-L85), [TS acknowledge](../../../machine/ts/machine/devices/irq/controller.ts#L96-L104); [C++ reset/raise](../../../machine/cpp/machine/devices/irq/controller.cpp#L14-L35), [C++ acknowledge](../../../machine/cpp/machine/devices/irq/controller.cpp#L62-L70), [C++ line](../../../machine/cpp/machine/devices/irq/controller.h#L17-L28); GPU marker/GP1 latch is control A09. |

T09 — Backend retained-command capacity 4096, retained-word capacity `80000` words and a reserve for one maximal A0 payload are not packet word counts or a second electrical bandwidth specification. Parser work pauses for drain at command boundaries/segment completion; an already-started counted upload has reserved space to finish. In particular, the 16-word packet scratch does not cap a whole polyline or image payload at 16 words. [TS capacities](../../../machine/ts/machine/devices/gx/gpu_command_buffer.ts#L11-L14), [TS drain condition](../../../machine/ts/machine/devices/gx/gpu.ts#L1147-L1151), [TS parser drain](../../../machine/ts/machine/devices/gx/gpu.ts#L1165-L1182); [C++ capacities](../../../machine/cpp/machine/devices/gx/gpu_command_buffer.h#L19-L22), [C++ condition](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1200-L1204), [C++ parser drain](../../../machine/cpp/machine/devices/gx/gpu.cpp#L736-L750). Physical ingress FIFO/DMA staging capacities and write admission are deliberately delegated to the ingress facts.

## 5. Hazards to teach, without invented recovery rules

- **H01 Wrong field count changes stream interpretation.** A missing fixed field is not zero-filled or rejected; parser remains incomplete. An extra rectangle size word after fixed-size mode is the next command. A0 uses normalized dimensions, so zero does not request an empty upload. Sources F02,F14,F21,F23 (each has paired owners).
- **H02 Opcode-shaped data is still data.** An E1-looking pixel word in A0 is not state, and a terminator-looking word in a fixed polygon or image is not a stream terminator. Polyline recognition is phase-sensitive, not a universal escape. Sources F02,F17,F23.
- **H03 GP0 supplies signed 11-bit positions, not signed 16-bit screen numbers.** Do not confuse GTE packed screen words/CPU integer containers with GPU's consumed low 11 fields. Sources F06,F31.
- **H04 Texture page is persistent state.** A textured polygon changes the page/mode/blend subset for itself and future packets; a textured rectangle does not select a new page from T0. Restore the intended E1 state explicitly when the next material differs. Sources F15,F28,F33.
- **H05 Transfer stream lengths are pixel-count based, not row-padding based.** Odd W does not require a pad halfword after each row; only an odd **total** pixel count leaves one unused high 16 at the end. Readback returns zero in its odd final high 16. Sources F23,F27.
- **H06 Readback is a queue barrier with backend readiness.** A queued later C0 cannot supersede the active readback; early GPUREAD does not advance a pending transfer; completing only its one-tick command deadline does not manufacture pixel data. Sources F25–F27,T02.
- **H07 GP1 abort is not transaction rollback.** It may flush a received upload prefix and preserve accepted earlier work; consult the separately owned GP1 phase-dependent abort facts before describing cancellation. Sources F24 and GP1 owner facts; no new recovery contract is proposed here.
- **H08 No GP0 “bad packet” fault category is established by these owners.** Unknown one-word opcodes are timed ignored operations, malformed stream framing has deterministic continuation effects, and primitive/texture-field limits are datapaths. Actual CPU/mapped-port alignment/width/admission faults belong to the ingress facts, not an invented GP0 error/status bit. Sources F02,F04,F07,F21 plus separately owned access facts.

## 6. Proposed paragraph-level reader tasks (not a chapter rewrite)

Each is a future **single-family** programming paragraph, with owned representation, one meaningful construction, ordered effects, result/visibility check and family-specific boundary. These tasks do not authorize implementation changes or guessed cartridge syntax.

| Unit | One family | Reader outcome / distinguishing calculation |
|---|---|---|
| Q01 | `02` fill | Construct a fill, derive X-down/width-up alignment, contrast width 0 with normalized transfers, and know which draw state does not clip it. Use V01/V02, not raster speculation. |
| Q02 | Flat untextured polygons | Pack triangle and quad words, keep vertex order 012/213, prove count 4/5, and separate RGB888 input from 16-bit storage. |
| Q03 | Gouraud untextured polygons | Interleave per-vertex C/P correctly and preserve vertex/color association; demonstrate why reusing a flat packet's stride consumes the next command. |
| Q04 | Flat textured polygons | Construct U/V+CLUT/T1-page fields, derive count 7/9, and visibly account for persistent T1→E1 update before a later textured rectangle. |
| Q05 | Gouraud textured polygons | Build three/four C/P/T groups, distinguish raw-texture flag from omitted color words, and preserve page index 5 and vertex attributes. |
| Q06 | Finite lines | Compare flat 3 versus Gouraud 4 words and signed 11-bit endpoints; show that no terminator follows and texture-like opcode bits do not insert T words. |
| Q07 | Polylines | Supply the two-point header, append two more segments, terminate only at legal continuation phase, and verify retained endpoint/color progression and incremental timing. |
| Q08 | Untextured rectangles | Select variable versus fixed 1/8/16 sizes, derive exact packet counts and zero-size behavior; avoid an extra S word in fixed modes. |
| Q09 | Textured rectangles | Pack P/T/[S], use current E1 page plus T0 CLUT, and apply flip state without inventing per-rectangle page selection or Gouraud fields. |
| Q10 | `80–9f` copy | Derive normalized dimensions and source/destination coordinates; use one overlap case from V05 to learn actual row/column order rather than full-rectangle snapshot semantics. |
| Q11 | `a0–bf` upload | Upload an odd total number of raw pixels, derive exact word count/halfword order, ignore only the final upper half and correctly resume the next command. Include a payload word whose high byte resembles E1. |
| Q12 | `c0–df` readback | Issue one complete header, distinguish deadline/pending/backend-ready, consume an odd final word, and observe that queued later work resumes only at exhaustion. Cross-reference ingress status/ownership polling, do not reinvent it. |
| Q13 | E1 draw mode | Program the 14 retained bits and predict which T1 page fields a textured polygon overwrites; preserve dither/field/flip bits in the derivation. |
| Q14 | E2 texture window | Construct one mask/offset word and compute a changed U and unchanged V using the actual bit-replacement formula. |
| Q15 | E3/E4 drawing area | Pack inclusive endpoints, derive half-open bounds and an empty reversed axis, and explain that this state does not change transfer dimensions. |
| Q16 | E5 drawing offset | Encode a negative signed 11-bit offset and trace one primitive position without treating a VRAM transfer address as the same representation. |
| Q17 | E6 mask mode | Set/check destination bit 15 using one raw transfer example and retained state; contrast fill through V02, without duplicating all raster store math. |
| Q18 | `1f` request | Place a request behind drawing work, identify the parser-time latch/raise and one-tick deadline, and separately acknowledge GPU versus controller state via GP1 facts. |
| Q19 | Ignored/NOP words | Distinguish boundary-discarded NOPs from timed ignored one-word opcodes and from identical bits inside payload. Teach deterministic stream framing, not a fictional invalid-command handler. |

## 7. Verification performed and reproducibility

Source comparison is the primary evidence. Supplementary verification used existing live TS owners/tests only; **no native GPU execution, compiled guest-cycle budget, browser render acceptance, physical bandwidth or final manual acceptance is claimed**.

1. Existing `tests/lua/gx_gpu.test.ts` selection:9 passing tests covering retained-word reserve/drain, polyline drain continuity, command timing/frontier, IRQ, environment, fixed render/blit packets, counted upload, incremental polylines. Command:

```sh
node --import tsx --test --test-name-pattern='emits PSX GP0 fixed-length|emits PSX CPU-to-VRAM|executes PSX polylines|handles PSX GP0 draw mode|handles PSX GP0 environment|handles PSX GP0 IRQ|command timing gates|reserves one maximal CPU upload|retains active polyline state' tests/lua/gx_gpu.test.ts
```

2. Existing readback/partial-upload selection:5 passing tests covering fenced odd wrapped readback, row-major X/Y wrap, queued later C0, exact published fence and partial upload flush. Command:

```sh
node --import tsx --test --test-name-pattern='GPUREAD fences prior|GPUREAD preserves row-major|queues a later C0|does not claim a C0 appended|GP1 clear FIFO clears partial GP0' tests/lua/gx_gpu.test.ts
```

These test names contain historical labels; those labels are not external evidence or imported hardware premises.

3. Independently derived packet-size formulas for all 256 opcode bytes were compared with the live owner's pure length method. Live spec helpers checked signed 11-bit endpoints, normalized transfer dimensions and page merge. Eight independently calculated tick cases checked the timing function (not CPU execution). Re-run from repository root:

```sh
node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {GxGpu} from './machine/ts/machine/devices/gx/gpu.ts';
import {gxGpuTransferWidth as w,gxGpuTransferHeight as h,gxGpuSigned11,gxGpuPolygonDrawModeWord} from './machine/ts/spec/gx/gp0.ts';
import {gxGpuCommandTicks} from './machine/ts/machine/devices/gx/gpu_command_timing.ts';
const g=Object.create(GxGpu.prototype); // pure length methods; no device/CPU execution claim
for(let op=0;op<256;op++){
 let n=1;
 if(op===2)n=3;
 else if(op>=0x20&&op<=0x3f)n=(op&8?4:3)*(1+(op&4?1:0)+(op&16?1:0))+(op&16?0:1);
 else if(op>=0x40&&op<=0x5f)n=op&16?4:3;
 else if(op>=0x60&&op<=0x7f)n=2+(op&4?1:0)+(op&24?0:1);
 else if(op>=0x80&&op<=0x9f)n=4;
 else if(op>=0xa0&&op<=0xdf)n=3;
 assert.equal(g.gp0CommandWordCountForOpcode(op),n,'opcode '+op.toString(16));
}
assert.deepEqual([0,0x00010001,0x02000400,0xffffffff,0x02010401].map(s=>[w(s),h(s)]),[[1024,512],[1,1],[1024,512],[1023,511],[1,1]]);
assert.deepEqual([0x3ff,0x400,0x7ff,0xffff].map(gxGpuSigned11),[1023,-1024,-1,-1]);
assert.equal(gxGpuPolygonDrawModeWord(0x3600,0x0985),0x3f85);
const area=(511<<10)|1023; // full normal drawing area; no offset or skipped parity
const ticks=(kind,op,words,draw=0,mask=0)=>gxGpuCommandTicks(kind,op,words,0,words.length,draw,0,0,area,0,mask,2);
assert.equal(ticks(5,2,[0x020000ff,0,(3<<16)|17]),85); // roundedW32:46+(4+9)*3
assert.equal(ticks(6,0x80,[0x80000000,0,0,(3<<16)|17]),102);
assert.equal(ticks(7,0xa0,[0xa0000000,0,0]),1);
assert.equal(ticks(8,0xc0,[0xc0000000,0,0]),1);
assert.equal(ticks(1,0x20,[0x20000000,0,4,(4<<16)]),54); // setup46+area8
assert.equal(ticks(2,0x40,[0x40000000,0,(2<<16)|3]),4);
assert.equal(ticks(3,0x48,[0x48000000,0,(2<<16)|3]),20);
assert.equal(ticks(4,0x60,[0x60000000,0,(2<<16)|3]),22);
console.log('PASS: all256 header lengths, dimension/coordinate/page boundaries,8 family timing cases.');
JS
```

Final source/working-tree hygiene: `git diff --check` passed. All changes from this assignment are this temporary facts artifact only.


# GPU programming/control/ingress fact sheet

Read-only extraction from scoped mirrored spec/device/CPU owners. No chapter,
repo/framework/runtime edits, architecture document, reference PDF, or external
console specification. **No TS/C++ or spec/owner disagreement found in this
scope.** Spec-defined raw fields are not assigned undocumented behavior.
GP0 packet/raster details belong to the companion GP0/pixel facts; PCRTC has its
own chapter and registerfile. Absolute source links are temporary-workspace
links, to be rebased when approved facts enter the book.

### Executed scalar issue/readout budget

The specified29-word scalar function loads12 constants, supplies a3-word32×4
fill and one IRQ marker, polls IRQ24 and idle26, retains two GPUSTAT words in
reserved RAM, acknowledges both GPU/controller latches, then returns. No DMA,
other pending work, active readback, delivered IRQ, fault or row suppression is
present; beam parity remains zero. Constants/schedule and independent audit are
recorded with W02 in the source review.

Actual ordinary and instruction-observed CPU dispatch both execute63 instructions
and charge83 cycles. Complete fill header accepted at18; fill completes and IRQ
starts at67; marker completes68. IRQ reads complete at22,27,...62 (clear), then67
(set, idle clear); final idle read completes77. RAM retains11922000 and14922000.
This is one complete specified function interval, not a universal compiled-BLua
cost, full-frame rate, image-readback bound or physical bus guarantee. Reproducer:
`/tmp/bmsx-gpu-depth/W02-issue-poll-budget.mjs`; it uses the existing raw-image
builder and actual CPU/Memory/GPU/IRQ/Scheduler owners, not a modeled timeline.
Sources for the operations/edges are GP0 T01/T03/T11/T12 and control A09/T04/T05.


## 1. Technical resources, addresses and access

| ID | Fact and qualification | TS / C++ evidence |
|---|---|---|
| R01 | Installed main RAM4MiB and separate GPU local memory2MiB. Installed CPU/system-cycle basis33868800Hz, about29.525699ns/cycle. This is not proof of an independent GPU raster clock. | [TS model][control-model-ts], [C++ model][control-model-cpp], [TS frequency][control-freq-ts], [C++ frequency][control-freq-cpp] |
| R02 | GP0 is0801023c; writes supply command/payload words, reads return GPUREAD. GP1 is08010240; writes supply control words, reads return GPUSTAT, **not the last control word**. Each is a32-bit IO word with callbacks/readiness, not an ordinary RAM variable. | [TS addresses][control-io-ts], [C++ addresses][control-io-cpp], [TS mapping][control-map-ts], [C++ mapping][control-map-cpp], [TS callbacks][control-callbacks-ts], [C++ callbacks][control-callbacks-cpp] |
| R03 | Physical GP0 command FIFO16 words; separate DMA ingress16 words; fixed packet assembly storage16 words. The two16-word FIFOs serve different admission stages, not a universally interchangeable32-word CPU FIFO. | [TS capacities][control-cap-ts], [C++ capacities][control-cap-cpp], [TS storage][control-storage-ts], [C++ storage][control-storage-cpp], [TS ingress][control-ingress-ts], [C++ ingress][control-ingress-cpp] |
| R04 | Retained command store has4096 command records and0x80000=52428832-bit payload words; drain is required at4096 records or, outside an image payload, payload count above0x80000−(3+1024×512/2)=262141. This is modeled retained command storage/backpressure, **not an extra addressable VRAM bank or a4096-entry GP0 input FIFO**. | [TS retention constants][control-retain-ts], [C++ constants][control-retain-cpp], [TS drain][control-drain-ts], [C++ drain][control-drain-cpp] |
| R05 | Word/U32 programming accesses require4-byte alignment and reach one callback. Scalar load/store and displacement variants have base2system cycles, before address/value setup/control flow and any readiness wait. Sequence stores separately charge2+up(n/4) per actual n-word instruction. These do not specify electrical transfer time or sustained bandwidth. | [TS CPU access][control-cpu-ts], [C++ CPU access][control-cpu-cpp], [TS base costs][control-cost-ts], [C++ base costs][control-cost-cpp], [TS absolute bulk][control-bulk-ts], [C++ absolute bulk][control-bulk-cpp] |
| R06 | Word-aligned U8 **loads** run the full word callback then return low8; a GP0 byte load can therefore consume a whole ready readback word, not merely peek one byte. U8 stores and even-aligned U16 reads/writes fault on mapped IO. Misaligned Word/U32/F32/F64 and odd U16 are rejected by CPU alignment before device callbacks. | [TS byte/halfword boundaries][control-width-ts], [C++ boundaries][control-width-cpp], [TS halfword store][control-half-ts], [C++ halfword store][control-half-cpp], [TS CPU alignment][control-cpu-ts], [C++ CPU alignment][control-cpu-cpp] |
| R07 | F32 uses one word callback via bit reinterpretation. F64 uses low word atA then high word atA+4; first fault prevents the second. Thus F64 atGP0 addresses **GP0 then GP1**, not two GP0 stream words. It is not an atomic GPU register transaction; the CPU only performs its readiness check for the instruction's first address. Prefer explicit word commands rather than inventing a64-bit GPU port. | [TS float reads][control-float-r-ts], [C++ float reads][control-float-r-cpp], [TS float writes][control-float-w-ts], [C++ float writes][control-float-w-cpp], [TS CPU][control-cpu-ts], [C++ CPU][control-cpu-cpp] |

R08. A CPU word-sequence store increments its destination by4 after each word,
not repeated writes to one streaming port. Starting atGP0 therefore sends its
second word toGP1. The sequence-cost formula inR05 is not a GP0 streaming
throughput formula. [TS sequence progression](../../../machine/ts/machine/cpu/cpu.ts#L3533-L3543),
[C++ sequence progression](../../../machine/cpp/machine/cpu/cpu.cpp#L3194-L3204).

R04 is useful source evidence for eventual backpressure explanation, but should
not be marketed as independently installed silicon RAM. No independent GPU
core/PLL, electrical IO/VRAM bus clock/pin width, arbitration schedule,
per-pixel physical fetch cost, rated sustained pixel/byte rate or monitor-mode
acceptance guarantee follows from these leaves. R01/R03/R04 establish installed
resources and modeled buffers; T01–T05 below establish cost units/deadlines.

### Executable-cartridge cross-unit bindings

- The IRQ-controller acknowledge/mask words used by the example are
  `08000004H` and `08000008H`; VBlank is bit2 (`00000004H`) and GPU IRQ bit6
  (`00000040H`). The address formula uses IO base `08000000H` and four-byte words.
  Sources: [TS IRQ indices](../../../machine/ts/spec/bmsx/io.ts#L3-L8),
  [TS addresses](../../../machine/ts/spec/bmsx/io.ts#L214-L216),
  [TS IRQ bits](../../../machine/ts/spec/bmsx/io.ts#L362-L368),
  [C++ indices](../../../machine/cpp/spec/bmsx/io.h#L15-L20),
  [C++ addresses](../../../machine/cpp/spec/bmsx/io.h#L227-L229),
  [C++ IRQ bits](../../../machine/cpp/spec/bmsx/io.h#L375-L381),
  [TS base/word size](../../../machine/ts/spec/bmsx/memory_map.ts#L1-L33),
  [C++ base/word size](../../../machine/cpp/spec/bmsx/memory_map.h#L1-L40).
- PCRTC CSR RESET, GX16 framebuffer/stride/source/extent, PMODE and VBlank
  publication retain their adjacent-unit ownership. Their complete formats,
  reset values and visibility are the existing [PCRTC fact sheet](pcrtc.md),
  not re-derived from GP1 display-mode fields.
- Source-language precedents, not GPU datapath facts: BIOS typed readonly
  records [shell](../../../machine/bios/shell/commands.lua#L61-L78), readonly
  words and BSS buffers [terminal](../../../machine/bios/tty/terminal.lua#L41-L73),
  typed whole-word MMIO [GPU](../../../machine/bios/gpu/gpu.lua#L5-L11),
  IRQ marker/acknowledgement [command list](../../../machine/bios/gpu/commandlist.lua#L9-L16),
  fixed destination versus incrementing source [DMA](../../../machine/bios/kernel/dma.lua#L30-L36).
  The actual example is [gpu_manual](../../../carts/gpu_manual/cart.lua);
  guest execution evidence is separate in the source review.
- Derived palette4 cartridge construction, using pixel T01–T05/T07 and GP0
  F10/F15/F23/F33:16 readonly `u16` colors occupy32bytes, four readonly packed
  `u16` index words occupy8bytes. Upload palette16×1 to raw(768,256), indices4×1
  to(704,16). CLUT attribute4030 selects(768,256); T1attribute000b selects
  palette4 page(704,0). Packed3210/7654/ba98/fedc supplies indices0…15.
  A raw quad at(16,176)/(240,176)/(16,192)/(240,192), U0/15/0/15 and V16,
  displays the strip without RGB gain. AtY180, X16/31/46/61/76/91 yield fetched
  indices0/1/2/3/4/5 and stored001f/03e0/7c00/background0c41/8000/7fff.
  Whole example:72readonly image/palette/index bytes,55drawing packet words,
  8BSS bytes. These are chosen operands/derived results, not added GPU fields.
  The same [actual cartridge](../../../carts/gpu_manual/cart.lua) is the source
  for those authored constants; the owning packet/lookup sources remain the
  frozen facts above. Actual guest execution checks all20 probes; final scope
  and independent source/math review are recorded separately.

## 2. GP1 encoding, controls and stored words

GP1 decodes the **complete high8-bit opcode**; payload is low24. The owning
command constructor is `(opcode<<24)|(payload&00ffffff)`. It is not low6 decode,
and there are no GTE SF/LM fields here. Writes synchronize already-due GPU work
first, retain the raw GP1 word internally, then perform the selected control.
GP1(00) subsequently clears that private raw-command latch to zero. It is not
readable as a COMMAND register. [TS spec][control-gp1-ts], [C++ spec][control-gp1-cpp],
[TS switch][control-gp1-switch-ts], [C++ switch][control-gp1-switch-cpp],
[TS reset registers][control-reset-reg-ts], [C++ reset registers][control-reset-reg-cpp].

| ID/opcode | Payload consumption and direct result | TS / C++ evidence |
|---|---|---|
| C00 /00 | Clear GP0 stream state as C01, then restore GPU register defaults. Does **not** perform full device/power reset, initialize VRAM, reset PCRTC, clear GPUREAD latch or clear VRAM-Y-extension latch. | [TS switch][control-gp1-switch-ts], [C++ switch][control-gp1-switch-cpp], [TS register reset][control-reset-reg-ts], [C++ register reset][control-reset-reg-cpp], compare [TS device reset][control-reset-ts]/[C++ device reset][control-reset-cpp] |
| C01 /01 | Payload ignored. Clear both input FIFOs and packet/ingress/polyline assembly; cancel pending command deadline. Flush a partially accepted A0 payload if at least one payload word was already consumed; a header-only upload is discarded. Complete accepted pending raster/upload target where retained, but abort C0/readback with phase-dependent command retention below. This is **not simply discard every earlier accepted operation**. | [TS clear][control-clear-ts], [C++ clear][control-clear-cpp], [TS partial upload][control-flush-ts], [C++ partial upload][control-flush-cpp], [TS abort][control-abort-ts], [C++ abort][control-abort-cpp] |
| C02 /02 | Payload ignored; clear GPUSTAT24 only. It does not acknowledge the system IRQ-controller pending latch. | [TS switch][control-gp1-switch-ts], [C++ switch][control-gp1-switch-cpp], [TS IRQ latch/ack][control-irq-ts], [C++ IRQ latch/ack][control-irq-cpp] |
| C03 /03 | Lowbit1 means display disabled;0 enables. Other payload bits ignored. Update GPUSTAT23 immediately in programmed state. | [TS disable][control-disable-ts], [C++ disable][control-disable-cpp] |
| C04 /04 | Low2 bits select DMA direction0off,1FIFO,2CPU→GP0,3GPUREAD→CPU. Update GPUSTAT30:29 and DREQ computation; entering/leaving3 enables/disables readback DMA request generation. Other payload bits ignored. | [TS directions][control-cap-ts], [C++ directions][control-cap-cpp], [TS direction/update][control-dma-ts], [C++ direction/update][control-dma-cpp] |
| C05 /05 | Retain payload&000ffffe as display-start word. Bit0 is discarded; sourceX decodes low10, sourceY fromword>>10 through the current VRAM-Y gate. This does not program PCRTC DISPFB/DISPLAY words or restart its beam. | [TS spec][control-gp1-ts], [C++ spec][control-gp1-cpp], [TS switch][control-gp1-switch-ts], [C++ switch][control-gp1-switch-cpp], [TS start decode][control-display-ts], [C++ decode][control-display-cpp], [TS Y gate][control-vram-ts], [C++ Y gate][control-vram-cpp] |
| C06 /06 | Retain low24 horizontal-display-range bits. This is GPU register state, not a write to PCRTC timing/window registerfiles. | [TS spec][control-gp1-ts], [C++ spec][control-gp1-cpp], [TS switch][control-gp1-switch-ts], [C++ switch][control-gp1-switch-cpp] |
| C07 /07 | Retain low20 vertical-display-range bits: start9:0, end19:10. Range ordering is not validated at this boundary. | [TS spec][control-gp1-ts], [C++ spec][control-gp1-cpp], [TS switch][control-gp1-switch-ts], [C++ switch][control-gp1-switch-cpp], [TS decode][control-display-ts], [C++ decode][control-display-cpp] |
| C08 /08 | Retain low8 mode bits. GPUSTAT18:17←mode1:0;19←2;20←3;21←4;22←5;16←6. Raw modebit7 is retained but **neither mirror maps it to GPUSTAT14 or gives it a reverse-image action**. The status update clears the reverse-mask bit14. Do not import a foreign-console bit7 meaning. | [TS mask/spec][control-gp1-ts], [C++ mask/spec][control-gp1-cpp], [TS status mapping][control-mode-ts], [C++ mapping][control-mode-cpp] |
| C09 /09 | Retain lowbit only as VRAM-Y-address-extension word;0 selects nine Y address bits,1ten. It is separate from the GP0 texture-page-Y-high field. GP1(00) preserves this latch; full device reset clears it. | [TS switch][control-gp1-switch-ts], [C++ switch][control-gp1-switch-cpp], [TS Y gate][control-vram-ts], [C++ Y gate][control-vram-cpp], [TS reset][control-reset-ts], [C++ reset][control-reset-cpp] |
| CQ /10–1f | All sixteen opcodes select the same info-query operation; **payload low4**, not opcode low4, selects the result. Queries update GPUREAD latch immediately and preserve the readback stream. Unsupported indices preserve its old latch, not zero or exception. | [TS query][control-query-ts], [C++ query][control-query-cpp], [TS dispatch][control-gp1-switch-ts], [C++ dispatch][control-gp1-switch-cpp] |
| CX /all other high8 | No unknown-opcode fault; retain private raw GP1 word and refresh status, otherwise no selected control action. Values with low6 matching a command do not alias it. | [TS default][control-gp1-switch-ts], [C++ default][control-gp1-switch-cpp] |

Info-query low4 result map (each result is the stored raw representation):
02 texture-window20-bit word;03 drawing-area-top-left20-bit word;04 bottom-right
20-bit word;05 drawing-offset22-bit word;07 constant00000002;08 zero.
00,01,06,09–0f retain previous GPUREAD. Source pairs:
[TS query][control-query-ts]/[C++ query][control-query-cpp],
[TS state masks][control-status-ts]/[C++ masks][control-status-cpp]. Do not call02–05 a new
snapshot FIFO; a subsequent ready C0 word read overwrites the GPUREAD latch.

**C01 readback retention detail:** before C0 activation, remove an unexecuted
C0 at the executed-prefix boundary; while readback is pending, remove C0 and
following retained commands but preserve the prior prefix; when submitted/ready,
clear retained command state and reset the readback. The full mirror code is
[TS abort][control-abort-ts]/[C++ abort][control-abort-cpp]. This phase distinction is required
before writing any programmer claim that CLEAR_FIFO preserves or destroys work.

## 3. Reset inventory and programmed versus displayed visibility

| ID | Exact scope | TS / C++ evidence |
|---|---|---|
| Z01 | Register reset clears GP0/private GP1 word latches; mode09; base GPUSTAT mask14802000; draw mode, texture window, drawing bounds/offset/mask mode, display start all0; horizontal rangec60260; vertical range44c23; DMA direction0; GPU IRQ request flag0. Mode09 is then mapped into status, so at installed reset beam epoch0 a normal status read is**14922000**, not the pre-update mask14802000. | [TS register reset][control-reset-reg-ts], [C++ register reset][control-reset-reg-cpp], [TS status constants][control-status-ts], [C++ constants][control-status-cpp], [TS mode map][control-mode-ts], [C++ map][control-mode-cpp], [TS defaults][control-gp1-ts], [C++ defaults][control-gp1-cpp] |
| Z02 | GP1(00) preserves current GPUREAD and VRAM-Y-extension, and does not reset PCRTC register/timing state or initialize local memory. Device reset separately resets PCRTC, clears GPUREAD/Y extension, initializes VRAM via its power-on producer, clears command storage and latches presentation state. Do not merge these reset domains. | [TS switch][control-gp1-switch-ts], [C++ switch][control-gp1-switch-cpp], [TS register reset][control-reset-reg-ts], [C++ register reset][control-reset-reg-cpp], [TS full reset][control-reset-ts], [C++ full reset][control-reset-cpp] |
| Z03 | GP1 programmed fields/status changes are visible synchronously during accepted write; preceding due GPU completions synchronize first. The corresponding presented display/status/start/range/Y-extension words are copied at VBlank presentation, not by every GP1 write. GPUSTAT readback is not a displayed-picture acknowledgement. PCRTC has a separate programmed/displayed latch and chapter. | [TS GP1][control-gp1-switch-ts], [C++ GP1][control-gp1-switch-cpp], [TS display latch][control-present-ts], [C++ latch][control-present-cpp], [TS latch copy][control-latch-ts], [C++ latch copy][control-latch-cpp] |
| Z04 | Draw commands retain draw mode, Y extension, texture window, bounds/offset/mask and skipped-line parity when emitted. Later GP1(09)/GP0 state updates do not retroactively rewrite those operands. Stream parser execution, not mere acceptance of its first word, determines that emission point. | [TS snapshot][control-snapshot-ts], [C++ snapshot][control-snapshot-cpp], [TS parser][control-parser-ts], [C++ parser][control-parser-cpp] |
| Z05 | PCRTC CSR RESET also calls the GP0 stream clear and GPU-register-reset paths before restoring PCRTC, latching presentation registers and marking presentation pending. It therefore supplies the GPU stream/register defaults for the executable example; a following GP1 RESET with no intervening work repeats that GPU reset. CSR RESET does not initialize raw local-memory pixels and is not the full power-on VRAM producer. | [TS dispatch](../../../machine/ts/machine/devices/gx/gpu.ts#L1409-L1417), [C++ dispatch](../../../machine/cpp/machine/devices/gx/gpu.cpp#L918-L926); adjacent [PCRTC reset fact sheet](pcrtc.md) |

## 4. GPUSTAT word: exact observed fields

Readback synchronizes due command deadlines, updates beam-derived fields, then
recomputes command/DREQ fields: [TS read][control-readstat-ts], [C++ read][control-readstat-cpp].
All bit positions below are sourced in [TS masks][control-status-ts]/[C++ masks][control-status-cpp]
and the stated producers. There is no unsupported “ready to receive **CPU**”
interpretation for bit28 in this model.

| Bits | Meaning / producer | TS / C++ evidence |
|---|---|---|
| 10:0 | Raw draw-mode10:0 | [TS][control-draw-ts], [C++][control-draw-cpp] |
| 11,12 | Mask-mode low2 shifted11 | [TS][control-draw-ts], [C++][control-draw-cpp] |
| 13 | Set if GPU vertical-interlace mode is clear or PCRTC field is0; otherwise clear. A stopped beam preserves existing scanout bits. | [TS][control-scan-ts], [C++][control-scan-cpp] |
| 14 | Defined reverse mask; cleared by display-mode update, no modebit7-to14 mapping in either mirror. No reversed-image guarantee. | [TS][control-mode-ts], [C++][control-mode-cpp] |
| 15 | GP0 draw-modebit11, texture-page-Y-high, mapped to15 | [TS][control-draw-ts], [C++][control-draw-cpp] |
| 16,18:17,19–22 | GP1(08) mapping C08 above, not PCRTC beam-clock selectors | [TS][control-mode-ts], [C++][control-mode-cpp] |
| 23 | GP1 display-disabled latch | [TS][control-disable-ts], [C++][control-disable-cpp] |
| 24 | GPU interrupt request latch: GP0(1f) sets once, GP1(02) clears | [TS GP0][control-execute-ts], [C++ GP0][control-execute-cpp], [TS GP1][control-gp1-switch-ts], [C++ GP1][control-gp1-switch-cpp] |
| 25 | Direction-selected DMA request:0→0;1→DMA ingress empty and command FIFO has room;2→bit28;3→bit27. Supervisor stopped ingress suppresses write-side1/2. | [TS][control-dma-ts], [C++][control-dma-cpp] |
| 26 | Idle iff readback idle, no pending deadline, both FIFOs empty, no partial fixed packet/upload/polyline. Retained executed/present commands are not part of this condition. Not a VBlank or displayed-update acknowledgement. | [TS][control-dma-ts], [C++][control-dma-cpp] |
| 27 | Set exactly when readback READY; not merely because a C0 header was accepted or its one-tick command cost completed. | [TS status][control-dma-ts], [C++ status][control-dma-cpp], [TS readback][control-readback-ts], [C++ readback][control-readback-cpp] |
| 28 | DMA packet-acceptance line; detailed conditions A03 below. May be0 while a CPU word store is admissible. | [TS][control-dma-ts], [C++][control-dma-cpp] |
| 30:29 | GP1(04) low2 direction | [TS][control-dma-ts], [C++][control-dma-cpp] |
| 31 | Beam-derived displayed-line parity, not command readiness. In vertical-resolution+interlace mode uses displayStartY plus active field, but displayed field0 during VBlank; otherwise displayStartY+integer-quotient(currentHalfLine,2). A stopped beam preserves it. | [TS][control-scan-ts], [C++][control-scan-cpp], [TS displayY][control-display-ts], [C++ displayY][control-display-cpp] |

## 5. Admission, ingress, read ownership and IRQ

| ID | Fact | TS / C++ evidence |
|---|---|---|
| A01 | An ordinary direct CPU GP0 word store is admitted iff ingress is not system-stopped, DMA ingress is empty, physical GP0 FIFO count<16, and no active DMA owns GP0 as its write port. The readiness check synchronizes due work and can release a blocked CPU store when this condition becomes true. This is independent of bit28. | [TS ready][control-ready-ts], [C++ ready][control-ready-cpp], [TS status/resume][control-dma-ts], [C++ status/resume][control-dma-cpp], [TS DMA ownership][control-ownership-ts], [C++ ownership][control-ownership-cpp] |
| A02 | GP1 readiness is only the supervisor-quiesce gate; ordinary GP0 execution, a full GP0 FIFO or readback does not by itself block a GP1 store. Direct scalar CPU stores check ready before device access; a failed check rewinds/stalls the instruction for retry, not a lost accepted command. | [TS GP1 ready][control-callbacks-ts], [C++ ready][control-callbacks-cpp], [TS CPU store][control-cpu-ts], [C++ CPU store][control-cpu-cpp], [TS retry][control-retry-ts], [C++ retry][control-retry-cpp] |
| A03 | Bit28 requires readback idle, ingress not stopped, DMA ingress empty. During CPU image payload it is true when command FIFO has room; during polyline payload false. With no partially assembling packet/FIFO words it is true. Otherwise it is true only for a nonpolygon/nonline packet with fewer accumulated words than its target. A polygon/line prefix can therefore clear28 while A01 remains true. | [TS][control-dma-ts], [C++][control-dma-cpp] |
| A04 | DMA GP0 writes enter the separate ingress FIFO; writes before the admitted block's BLOCK_END do not run the normal pipeline. At block end synchronize and drain ingress into command FIFO. The ready callback for DMA only tests stopped ingress; admitted-block sizing/ownership belongs to DMA, not a promise of arbitrarily large GPU blocks. | [TS ingress][control-ingress-ts], [C++ ingress][control-ingress-cpp], [TS ready][control-ready-ts], [C++ ready][control-ready-cpp], [TS bus strobes][control-bus-ts], [C++ strobes][control-bus-cpp] |
| A05 | At command boundary only, GP0 opcodes00,04–1e,e0,e7–ef are discarded NOP words without filling FIFO/creating a timing job. Identical bit patterns within fixed packet/image/polyline payload remain payload. Other unmatched opcodes assemble one word and run the one-tick default, not an invalid-opcode exception. | [TS NOP][control-nop-ts], [C++ NOP][control-nop-cpp], [TS ingress][control-ingress-ts], [C++ ingress][control-ingress-cpp], [TS default execution][control-execute-ts], [C++ execution][control-execute-cpp] |
| A06 | GP0 framing retains separate COMMAND/FIXED/IMAGE_HEADER/IMAGE_PAYLOAD/POLYLINE_HEADER/POLYLINE_PAYLOAD phases. Image payload count=up(width×height/2); polyline sentinel test(word&f000f000)==50005000 is recognized only at a vertex-boundary payload phase. GP1 controls are independent words at GP1, not an escape opcode inside that GP0 stream. | [TS ingress][control-ingress-ts], [C++ ingress][control-ingress-cpp], [TS GP1 dispatch][control-gp1-switch-ts], [C++ dispatch][control-gp1-switch-cpp] |
| A07 | GP0 reads synchronize pending completion, then consume a ready readback word only if the initiating master is DMA or no DMA owns GP0's read port. CPU reads while that port is DMA-owned return the existing GPUREAD latch without consuming. With no ready stream, reads return that latch, not forced0. | [TS read][control-gpuread-ts], [C++ read][control-gpuread-cpp], [TS DMA ownership][control-ownership-ts], [C++ ownership][control-ownership-cpp] |
| A08 | READY readback packs first16-bit pixel in low half, next in high; odd final pixel has zero high half. Last word resets readback toIDLE and allows queued processing to resume. Info query updates the same latch, but the next permitted ready-stream read replaces it. U8 reads inherit this full callback side effect (R06). | [TS readback][control-readback-ts], [C++ readback][control-readback-cpp], [TS read][control-gpuread-ts], [C++ read][control-gpuread-cpp], [TS query][control-query-ts], [C++ query][control-query-cpp] |
| A09 | GP0(1f) is an in-order command marker. At parser execution, ifGPUSTAT24 was0 set it and raiseIRQ_GPU(bit6=00000040). Repeated markers while24 remains1 do not re-raise. GP1(02) clears24 but not IRQ_FLAGS; IO_IRQ_ACK clears the controller pending bit but not24. Both latches need their appropriate acknowledgement for subsequent independent requests. No automatic IRQ is raised merely because bit26 becomes1. | [TS GP0 IRQ][control-execute-ts], [C++ GP0 IRQ][control-execute-cpp], [TS GP1 ack][control-gp1-switch-ts], [C++ ack][control-gp1-switch-cpp], [TS IRQ mask][control-irqmask-ts], [C++ mask][control-irqmask-cpp], [TS IRQ latch/ack][control-irq-ts], [C++ latch/ack][control-irq-cpp] |

## 6. Positive command timing and visibility facts

| ID | Equation / scope | TS / C++ evidence |
|---|---|---|
| T01 | GPU command costs use2command ticks per system cycle. For positive ticksN accepted for execution atC, deadline=C+up(N/2). N=0 completes its retained execution target immediately. This is real scheduled command completion, unlike normal GTE's reported nominal count; it is not a specified physical raster-clock waveform. | [TS tick basis][control-tick-ts], [C++ basis][control-tick-cpp], [TS schedule][control-schedule-ts], [C++ schedule][control-schedule-cpp] |
| T02 | At/after a deadline, service or GP0/GP1/status access can synchronize completion, mark the retained execution prefix, then process queued words from the **old deadline**, not late access time, until another pending operation/readback stops it. CPU instruction charges and waits remain separate. There is no GPU CYCLES register in this two-port interface. | [TS synchronize][control-schedule-ts], [C++ synchronize][control-sync-cpp], [TS service][control-service-ts], [C++ service][control-service-cpp], [TS ports][control-map-ts], [C++ ports][control-map-cpp] |
| T03 | E1–E6, IRQ1f and non-NOP unmatched GP0 commands use1tick→1scheduled system cycle. Their register/IRQ effect occurs when the parser executes them, before that one-tick completion. CPU scalar issue costs2base cycles per word in addition to setup, but don't blindly add every command delay: CPU/GPU overlap and FIFO state determine waits. GP1 control has no separate queued raster-cost interval. | [TS execute][control-execute-ts], [C++ execute][control-execute-cpp], [TS GP1][control-gp1-switch-ts], [C++ GP1][control-gp1-switch-cpp], [TS CPU costs][control-cost-ts], [C++ CPU costs][control-cost-cpp] |
| T04 | Fill: w=((size.low10+15)&~15),h=size.high9; ticks=46+(w/8+9)×h. Thus32×4 has98ticks→49cycles. Copy: w=(((size.low16−1)&1023)+1),h=(((size.high16−1)&511)+1),ticks=2wh;3×5 has30ticks→15cycles. A0-upload/C0-read command cost1tick, but that does **not** promise a complete stream transfer or ready readback in one cycle. Full drawing-family clipping/area equations are in companion GP0 facts. | [TS fill/copy/transfer][control-cost-family-ts], [C++ fill/copy/transfer][control-cost-family-cpp], [TS readback activation][control-activate-ts], [C++ activation][control-activate-cpp], [TS readback READY][control-readback-ts], [C++ READY][control-readback-cpp] |
| T05 | C0 scheduled execution activates pending readback; the published readback protocol separately transitions pending→submitted→ready. Until ready, bit27 is0 and GP0 returns the old latch. Parsing stops while readback is nonidle. IRQ1f behind a fill does not raise at its GP0 acceptance: for a32×4 fill started0 it starts/raises at49, has own completion50. Idle can be0 between49and50 although IRQ is already set. | [TS prefix/activation][control-activate-ts], [C++ prefix/activation][control-activate-cpp], [TS readback][control-readback-ts], [C++ readback][control-readback-cpp], [TS parser gate][control-parser-ts], [C++ gate][control-parser-cpp], [TS IRQ][control-execute-ts], [C++ IRQ][control-execute-cpp] |

No physical Hz, raster-fill rate or sustained command throughput is inferred from
2ticks/cycle or the field rate. No claim that GPU idle, IRQ marker or GPUREAD query
acknowledges a displayed VBlank latch. The timing examples above ran through the
live TS mapped device and scheduler-boundary arithmetic; not a CPU workload,
renderer/readback completion, native build or physical-output test.

## 7. Proposed paragraph-by-paragraph reader tasks for this surface

1. **Identify the interfaces and capacities.** Distinguish GP0 write/GPUREAD read,
   GP1 write/GPUSTAT read, two32-bit ports, installed memory,16-word FIFO versus
   separate DMA ingress, word width/alignment, and undefined electrical rates.
2. **Issue a packet without losing framing.** Explain acceptance versus execution,
   word/packet boundaries, FIFO backpressure, NOP-only-at-boundary, and why a
   GP1 control word belongs at the other address. Delegate packet layouts to GP0.
3. **Use readiness for the actual master.** CPU store admission versusGPUSTAT28
   DMA packet line; demonstrate a polygon prefix with28=0 and CPUstore admissible.
4. **Read and interpret one GPUSTAT word.** Full bit table, immediate/dynamic
   producers, mode-to-status mapping including retained-but-unmapped bit7, and
   why an idle/IRQ bit is not a display-latch acknowledgement.
5. **Program a GP1 control.** Full encoding/control catalog00–09, meaningful
   payload masks and ignored bits, no command-readback register, no GP1 raster job.
6. **Recover at a deliberate boundary.** Distinguish machine reset,GP1(00),
   CLEAR_FIFO and readback phases; preserve prior accepted work as actually modeled.
7. **Choose DMA direction and port ownership.** Direction/DREQ/readback enables,
   physical FIFO capacity, admitted DMA-block staging; delegate DMA-channel setup.
8. **Ask for current drawing state.** Complete info-query index map, alias
   opcodes, unsupported-index retained latch and collision with active C0 reads.
9. **Consume readback safely.** READY versus one-tick activation, low pixel first,
   odd tail, last-word release, CPU/DMA ownership; no byte-read-as-peek mistake.
10. **Fence a workload and acknowledge both IRQ latches.** In-order1f example,
    IRQ24/controller bit6 distinction, repeat suppression and proper00/02 scopes.
11. **Budget issue, queued execution and visibility separately.** Scalar2cycle
    issue versus2ticks/cycle completion, fill/copy positive calculations, IRQ49/50
    worked timeline; no invented CYCLES/status-throughput formula.
12. **Hand display state to PCRTC deliberately.** Programmed versus VBlank-latched
    presentation state; identify which registers are GP1 versus PCRTC and link
    existing beam/window chapter rather than duplicate it or invent GP1 mode clocks.

## 8. Validation and unresolved scope

Reproduce direct mapped-owner checks:

```sh
cd /home/boaz/BMSX
node --import tsx /tmp/bmsx-gpu-gp1-check.mjs
```

The scratch script uses real Memory/CPU/IRQ/Scheduler/DMA/GPU owners, but no CPU
program. It checks addresses, resetstatus14922000, all GP1 masks,16 info opcode
aliases, unsupported indices/opcodes, GP1-reset-preserved GPUREAD/Y/PCRTC state,
16-word FIFO and CPU-ready/bit28 difference, independent IRQ acknowledgements,
IO faults and fill/copy/IRQ timing. It does not emulate missing electrical facts.
C++ reviewed in source, not executed. `git diff --check` passes. No discovered
source disagreement needs a runtime correction. Companion GP0/pixel facts remain
necessary for raster commands, samples/CLUT/blend/dither/mask/coordinate rules.

## Source anchors
[control-model-ts]: ../../../machine/ts/spec/bmsx/model.ts#L46-L57
[control-model-cpp]: ../../../machine/cpp/spec/bmsx/model.h#L51-L62
[control-freq-ts]: ../../../machine/ts/spec/bmsx/model.ts#L7-L7
[control-freq-cpp]: ../../../machine/cpp/spec/bmsx/model.h#L12-L12
[control-io-ts]: ../../../machine/ts/spec/bmsx/io.ts#L172-L173
[control-io-cpp]: ../../../machine/cpp/spec/bmsx/io.h#L185-L186
[control-map-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L462-L467
[control-map-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L53-L58
[control-callbacks-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L2044-L2069
[control-callbacks-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L1517-L1548
[control-cap-ts]: ../../../machine/ts/spec/gx/gp0.ts#L27-L42
[control-cap-cpp]: ../../../machine/cpp/spec/gx/gp0.h#L34-L44
[control-storage-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L329-L355
[control-storage-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.h#L276-L300
[control-ingress-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1034-L1132
[control-ingress-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L551-L650
[control-retain-ts]: ../../../machine/ts/machine/devices/gx/gpu_command_buffer.ts#L11-L14
[control-retain-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_command_buffer.h#L19-L22
[control-drain-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1147-L1151
[control-drain-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L1200-L1204
[control-cpu-ts]: ../../../machine/ts/machine/cpu/cpu.ts#L2992-L3170
[control-cpu-cpp]: ../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L554-L685
[control-cost-ts]: ../../../machine/ts/spec/blua32/opcode.ts#L75-L84
[control-cost-cpp]: ../../../machine/cpp/spec/blua32/opcode.cpp#L5-L69
[control-bulk-ts]: ../../../machine/ts/machine/cpu/cpu.ts#L3155-L3170
[control-bulk-cpp]: ../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L672-L685
[control-width-ts]: ../../../machine/ts/machine/memory/memory.ts#L442-L506
[control-width-cpp]: ../../../machine/cpp/machine/memory/memory.cpp#L332-L396
[control-half-ts]: ../../../machine/ts/machine/memory/memory.ts#L603-L606
[control-half-cpp]: ../../../machine/cpp/machine/memory/memory.cpp#L498-L501
[control-float-r-ts]: ../../../machine/ts/machine/memory/memory.ts#L573-L588
[control-float-r-cpp]: ../../../machine/cpp/machine/memory/memory.cpp#L463-L482
[control-float-w-ts]: ../../../machine/ts/machine/memory/memory.ts#L659-L671
[control-float-w-cpp]: ../../../machine/cpp/machine/memory/memory.cpp#L553-L567
[control-gp1-ts]: ../../../machine/ts/spec/gx/gp1.ts#L1-L40
[control-gp1-cpp]: ../../../machine/cpp/spec/gx/gp1.h#L7-L43
[control-gp1-switch-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1340-L1404
[control-gp1-switch-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L850-L914
[control-reset-reg-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L755-L775
[control-reset-reg-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L285-L305
[control-reset-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L475-L500
[control-reset-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L66-L91
[control-clear-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1609-L1628
[control-clear-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L1087-L1108
[control-flush-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1662-L1673
[control-flush-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L1140-L1150
[control-abort-ts]: ../../../machine/ts/machine/devices/gx/gpu_command_buffer.ts#L248-L278
[control-abort-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_command_buffer.h#L228-L256
[control-irq-ts]: ../../../machine/ts/machine/devices/irq/controller.ts#L77-L100
[control-irq-cpp]: ../../../machine/cpp/machine/devices/irq/controller.cpp#L29-L69
[control-disable-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1586-L1593
[control-disable-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L1064-L1071
[control-dma-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1863-L1962
[control-dma-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L1340-L1437
[control-display-ts]: ../../../machine/ts/machine/devices/gx/gpu_display.ts#L14-L60
[control-display-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_display.h#L11-L60
[control-vram-ts]: ../../../machine/ts/spec/gx/vram.ts#L1-L12
[control-vram-cpp]: ../../../machine/cpp/spec/gx/vram.h#L9-L21
[control-mode-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L2008-L2018
[control-mode-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L1482-L1492
[control-query-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1838-L1861
[control-query-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L1315-L1338
[control-status-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L161-L202
[control-status-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.h#L36-L75
[control-present-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1493-L1515
[control-present-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L975-L996
[control-latch-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L746-L753
[control-latch-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L276-L283
[control-snapshot-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1766-L1803
[control-snapshot-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L1253-L1282
[control-parser-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1153-L1192
[control-parser-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L725-L760
[control-readstat-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1333-L1338
[control-readstat-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L843-L848
[control-draw-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1821-L1836
[control-draw-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L1300-L1313
[control-scan-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1965-L2001
[control-scan-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L1440-L1474
[control-execute-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1194-L1261
[control-execute-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L774-L841
[control-readback-ts]: ../../../machine/ts/machine/devices/gx/gpu_command_buffer.ts#L99-L195
[control-readback-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_command_buffer.h#L67-L190
[control-ready-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L2025-L2035
[control-ready-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L1499-L1509
[control-ownership-ts]: ../../../machine/ts/machine/devices/dma/controller.ts#L180-L202
[control-ownership-cpp]: ../../../machine/cpp/machine/devices/dma/controller.cpp#L110-L131
[control-retry-ts]: ../../../machine/ts/machine/cpu/cpu.ts#L1647-L1663
[control-retry-cpp]: ../../../machine/cpp/machine/cpu/cpu.cpp#L2342-L2354
[control-bus-ts]: ../../../machine/ts/machine/memory/bus_signals.ts#L1-L10
[control-bus-cpp]: ../../../machine/cpp/machine/memory/bus_signals.h#L9-L18
[control-nop-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L154-L159
[control-nop-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L19-L24
[control-gpuread-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1019-L1032
[control-gpuread-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L536-L549
[control-irqmask-ts]: ../../../machine/ts/spec/bmsx/io.ts#L363-L368
[control-irqmask-cpp]: ../../../machine/cpp/spec/bmsx/io.h#L376-L381
[control-schedule-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1264-L1299
[control-schedule-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L762-L772
[control-service-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1312-L1331
[control-service-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L666-L680
[control-cost-family-ts]: ../../../machine/ts/machine/devices/gx/gpu_command_timing.ts#L262-L308
[control-cost-family-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_command_timing.cpp#L222-L266
[control-activate-ts]: ../../../machine/ts/machine/devices/gx/gpu_command_buffer.ts#L410-L415
[control-activate-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_command_buffer.h#L393-L399
[control-tick-ts]: ../../../machine/ts/machine/devices/gx/gpu_command_timing.ts#L23-L23
[control-tick-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_command_timing.h#L7-L7
[control-sync-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L684-L703
