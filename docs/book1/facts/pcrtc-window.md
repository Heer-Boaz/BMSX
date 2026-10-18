# Frozen PCRTC source/window example facts

## Hardware facts (paired owner lines)

1. DISPFB_LOW decodes FBP[8:0]*4096 sixteen-bit words; FBW[14:9]*64pixels; storage[19:15]. DISPFB_HIGH sourceX[10:0], sourceY[21:11]. DISPLAY_LOW signalX[11:0], signalY[22:12], encoded Xmag[26:23]+1 and Ymag[28:27]+1. DISPLAY_HIGH horizontal span[11:0]+1 signal units and vertical extent[22:12]+1 rows. TS machine/ts/machine/devices/gx/gpu_pcrtc.ts:371–389,426–437; C++ machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:131–150,184–193. Register/bit leaves machine/{ts,cpp}/spec/gx/pcrtc.{ts,h}.
2. With both circuits enabled, minimum enabled signal X/Y determines cropped output origin. Convert each horizontal boundary upward separately to signalStep boundary; default step4. Magnification4/step4 and Ymag1 here mean one source pixel per output pixel. TS same owner396–465; C++157–223. One enabled circuit moved alone also moves crop origin, so it would not demonstrate a fixed-canvas destination movement.
3. PMODE0000FF23 enables both, MMOD1,ALP255,AMOD0,SLBG0: circuit2 supplies raw RGB, then circuit1 supplies direct raw RGB plus its sample alpha within its window, no RGB blending. ALP255 is not forced output alpha255. TS same owner479–509; C++233–263.
4. Programmed word reads are immediate; normal display geometry uses VBlank-entry latched configuration. The proposed changes below do not change timing words or restart the beam. TS same owner560–598,723–730; C++305–343,446–453. VBlank scanout publication precedes IRQ delivery in actual GPU service owners (independent source reviewer checked). Program masks delivery, writes final display word, acknowledges stale controller VBlank bit2, records callback sequence, unmasks bit2, waits for new sequence; this is not an atomic multiword transaction or general release interrupt.

## Finite program settings and decoded stages

All raw words derived from those fields. Addresses: the paired PCRTC address function maps these composition words from08010354; low/high words are4bytes apart. This is not a contiguous26wordmapped-bank claim.

| Register | Address | Raw word |
|---|---|---|
| PMODE_LOW | 08010354 | 0000FF23 |
| DISPFB1_LOW | 0801035C | 000FA000 |
| DISPFB1_HIGH, stageA | 08010360 | 00000000 |
| DISPLAY1_LOW, stagesA/B | 08010364 | 018553A8 |
| DISPLAY1_HIGH | 08010368 | 0005F1FF |
| DISPFB2_LOW | 0801036C | 000FA000 |
| DISPFB2_HIGH | 08010370 | 00000000 |
| DISPLAY2_LOW | 08010374 | 018252A8 |
| DISPLAY2_HIGH | 08010378 | 000BF3FF |

- Both circuits read GX16, base0, width16*64=1024 raw words/pixels per row from the same local-memory image. Normal reset timing, noninterlaced, Xmag4,Ymag1. Circuit2 signal(680,37), interval[680,1704), canvas256x192 atoutput(0,0), fixed through allstages.
- Circuit1 signal(936,85), interval[936,1448), gives cutout128x96 atoutput(64,48); source(0,0) inA. B changes ONLY DISPFB1_HIGH to00008020, source(32,16), same display window. C keeps B source and changes ONLY DISPLAY1_LOW to01855428, signal(1064,85), destination(96,48). Extents and output canvas remain unchanged. Output rectangles are halfopen: A/B[64,192)x[48,144), C[96,224)x[48,144).
- No GPU draw/upload or image-memory writes occur afterinitialscene completion, so B/C are reading/composition changes, not moved/rebuilt pixels. Rootprogram carts/pcrtc_window_manual/cart.lua literalproducer137lines, results.lua constBSS17lines; all raw commands scalarstores tofixedGP0, no helper/encoder/array-as-registerfile.

## Scene producer and actual observed RGB images

Root authored readonly48wordscene=16opaqueuntexturedrectangles: twelve64x64colouredcells cover256x192; whiteL is vertical(8,8)4x40 andhorizontal(8,8)40x4; black16x16square atsource(96,64); red8x8square atsource(144,96). E6 forcebit15 enabled, no checking; raw probeswhiteFFFF,black8000,red801F actuallyverified via C0. ThreepostwritefreshVBlanksequencechanges and all retained source/window words verified in ordinary guest case source_and_window_are_independent. GPUidle/readback barriers complete beforedisplayenable; readbackaloneisnotdisplaypublication.

Actual ordinary ROM playback captures (not derived integration target) all256x192 pixels unmodified. Every49152RGBpixels perimage independentlycomputed by root from literal painted scene plus fixedcanvas/cutout mapping and matched. No native/accelerated parity or actual sample alpha claim from PNG (capturePNGalpha255).

| Plate | Native capture | Source origin | Cutout output origin | Visible copied feature |
|---|---|---|---|---|
| A | frame_00001.png | (0,0) | (64,48) | WhiteL corner(72,56); black square(160,112) |
| B | frame_00004.png | (32,16) | (64,48) | Black square(128,96); red square(176,128) |
| C | frame_00007.png | (32,16) | (96,48) | Same B cutout shifted32pixelsright: black(160,96),red(208,128) |

WhiteL fixedcanvas remainsat(8,8) allstages. CutoutL is excluded by source origin(32,16) in B/C. These are picturefeaturepositions, not extra hardwareoverlayborders. Captures are figure assets pcrtc-window-a.png, pcrtc-window-b.png, pcrtc-window-c.png. No label or arrow edited into the images.

## Ownership and BLua/BIOS prerequisites

- Isolatedprogram ownsGP0,bothcircuits,directVBlankhandler,raw(0,0)..(255,191), assumes nootherreader/writer or supervisor takeover. It is not anallocator/generalframeloop. CurrentBIOSgpu/system_vram_region query returns raworigin02D002C0 andsize00FC0140; this fixed chosenrectangle excludes thatfirmwareboundingregion. Do not claim everyoutsideaddressisfree. Actual source machine/bios/gpu/system_vram_region.lua andprogramretainedquery/test; no futurefirmwarereservationconstantpromise.
- ExplicitBSS retainsphase/sequence/threeprobes/sourceandwindowwords andquery. TypedMMIOpointers andreadonlycommandarrays follow actualBIOSsourcepattern; privateBIOSmodules are not advertisedcartridgeexports. Completeactualsource willbeinsertedbyroot; do notinventfunctionsorAPIcalls.

## Source-probe interpretation

Actual one-pixel C0 probes at(8,8),(96,64),(144,96) return FFFF,8000,801F
respectively, with high half zero. The program's stored bit15 is forced by
E6=1. These are raw local-memory words, not composed output pixels or proof of
the entire displayed image. The ordinary guest assertion checks the three
full returned words. Packing/release: machine/ts/machine/devices/gx/gpu_command_buffer.ts:163–183;
C++ machine/cpp/machine/devices/gx/gpu_command_buffer.h:107–128. Rawsource
probe coordinates and results are the literal program/test producers already
identified above. Programmed-source/window snapshots retain immediate readback,
not display acceptance by themselves; visibility source is the paired register/
latch facts above and the fresh VBlank sequence plus separate captures.
