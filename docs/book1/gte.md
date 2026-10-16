# Geometry Engine (GTE)

## Function and data flow

The Geometry Engine is a register-programmed integer arithmetic unit. It transforms and projects vectors, performs lighting and color calculations, computes doubled oriented screen area, and forms depth averages. Its normal command path operates on 32 data words, `D[0]`–`D[31]`, and 32 control words, `C[0]`–`C[31]`. GTE_PLUS provides a separate three-lane multiply-add path with ten words of its own.

Program vectors, matrices, coefficients, and colors, then write a command word. Normal results appear in the data registers and in the screen, depth, and color FIFOs. These FIFOs are register histories: arithmetic commands push results into them; they are not command queues. Software may also write their entries directly.

GTE is separate from GEO and GPU. A GTE command does not draw, write VRAM or a framebuffer, transfer GEO scratch memory, or submit a graphics packet. Software passes the arithmetic results onward as required.

![GTE register and arithmetic paths](figures/gte-overview.svg)

## Technical specifications

GTE is a register-to-register integer arithmetic unit. Its storage holds the
operands, coefficients, intermediate values and recent results of geometry and
lighting calculations. It has no local vertex RAM, texture RAM or framebuffer.
The installed machine's 4 MiB main RAM and 2 MiB video RAM are separate resources;
they are not GTE memory. Software loads GTE operands and reads its results through
the register interface.

### Capacity and arithmetic

| Item | Specification |
|---|---|
| Installed CPU/system-cycle frequency | 33,868,800 Hz (33.8688 MHz) |
| Independent GTE core clock | No separate frequency is specified; PLUS completion uses system cycles. |
| Programming transfer width | One 32-bit register word at a four-byte-aligned address |
| Physical GTE/IO bus clock and pin width | Not specified. The programming word width is not an electrical bus specification. |
| GTE/IO arbitration and sustained bandwidth | No contended-transfer schedule or guaranteed transfer rate is specified. |
| Normal data register window | 32 words, D[0]–D[31]; 128 bytes of register address space |
| Normal control register window | 32 words, C[0]–C[31]; 128 bytes of register address space |
| Normal command/status | Separate 32-bit COMMAND and CYCLES words |
| PLUS register window | Ten 32-bit words; 40 bytes of register address space |

These window sizes describe register slots, not general-purpose memory capacity.
Some slots are aliases or derived read ports; others transform written words or
ignore writes. Their individual rules are specified in the register reference.

| Arithmetic resource | Capacity and representation |
|---|---|
| Input vectors | Three XYZ vectors, each with signed 16-bit components |
| Stored matrices | Three 3 × 3 matrices with signed 16-bit coefficients |
| Control vectors | Three XYZ vectors with signed 32-bit components |
| Main multiply-accumulate path | Three signed 44-bit accumulators, with shifted 32-bit visible MAC words and 16-bit clamped IR results |
| Screen history | Three packed SX/SY pairs; each component occupies a signed 16-bit halfword; projected coordinates clamp to −1024…1023 |
| Depth history | Four unsigned 16-bit depths |
| Color history | Three words, each containing 8-bit red, green, blue and CODE fields |
| PLUS multiply-add path | Three signed 16-bit lanes, a signed 16-bit scalar, a fixed 12-bit product shift, and saturated signed 16-bit results |

Normal commands provide vector transformation and projection, matrix/vector
arithmetic, lighting and color calculations, doubled oriented screen area, and depth
averages. There are 22 recognized normal functions. Multiplication, accumulation,
shift and saturation are integer operations; there is no floating-point arithmetic
mode. The normal path's 44-bit wrap and its IR/output clamps are distinct stages.
PLUS uses its own multiply-add rule and does not use the normal MAC accumulators,
SF/LM settings or result FIFOs.

### Completion and throughput

The two command interfaces have different completion guarantees:

| Path | Result visibility | Admission of subsequent work |
|---|---|---|
| Normal COMMAND | The command's results are visible when the command write completes | No GTE busy wait or command queue; the next normal command may use those results |
| PLUS VMAD3 | One result set becomes available five system cycles after acceptance | One pending command; another direct CPU command store waits for completion |
| Invalid PLUS command | Previous result values are preserved; ERROR and INVALID publish after one system cycle | Occupies the same single pending-command position |

The PLUS arithmetic admission ceiling is one VMAD3 command per five system
cycles: 6,773,760 commands per second at the installed frequency, with three lane
results per command. This is an arithmetic upper bound, not a sustained
application rate. Operand writes, command issue, result reads and other CPU work
must also fit in the program's cycle budget. The 32-bit register interface does
not by itself specify a bytes-per-second transfer guarantee.

Normal CYCLES values are not a throughput formula. They report nominal command
costs from 5 through 44, but do not impose an equivalent elapsed-time delay or
charge those counts to the CPU. Use the following timing rules when budgeting a
program rather than deriving a normal-command rate from CYCLES.

## Programming geometry

A useful geometry sequence starts with three questions: what coordinate units does the cartridge use, which transform converts those coordinates into projection coordinates, and where should the projected origin appear on the screen? Program those choices before submitting vertices. GTE retains them across commands, so a group of vertices can share one transform and projection setup.

A **vector** is an ordered triple `(X,Y,Z)`. For projection it describes a position. V0, V1, and V2 are three independent input vectors, not the three components of one vector. Their X and Y components share a word; Z occupies the low half of the next word. Every component is a signed 16-bit integer. The cartridge assigns its meaning: one coordinate unit might represent one unit of a model, or a chosen fraction of that unit. GTE does not convert physical units.

A **matrix** supplies three rows of weights. The first row produces transformed X, the second transformed Y, and the third transformed Z. For projection, the rotation matrix and translation form these three sums:

```text
A_X = 4096*TRX + m00*X + m01*Y + m02*Z
A_Y = 4096*TRY + m10*X + m11*Y + m12*Z
A_Z = 4096*TRZ + m20*X + m21*Y + m22*Z
```

The matrix need not be a pure rotation: its programmed coefficients determine the result. Diagonal coefficients can scale the axes; off-diagonal coefficients mix them. Translation adds a displacement after that matrix operation and before perspective. GTE does not build a matrix from angles or combine a sequence of transforms on the cartridge's behalf.

### Choose scales for an operation, not for the registerfile

The words do not all have twelve fractional bits. The factors in the selected operation determine their scales. A convenient projection convention is to store positions and translations in the same integer coordinate units, store matrix coefficients multiplied by 4096, and select `SF=1`. The command then removes twelve low bits from each accumulated matrix result. Without overflow or saturation, the resulting IR coordinates are the transformed positions rounded toward negative infinity.

| Quantity under this convention | Programmed representation | Representable range | Consumer |
|---|---|---|---|
| Input position X, Y, Z | Signed halfword; one raw count per coordinate unit | −32768–32767 coordinate units | RTPS, RTPT, or a selected MVMVA vector |
| Matrix coefficient | Signed halfword; coefficient × 4096 | −8 to `8−1/4096` | Matrix dot product; use `SF=1` to remove this factor |
| Translation X, Y, Z | Signed complete word; one raw count per coordinate unit | −2147483648–2147483647 coordinate units | Translation is multiplied by 4096 before the dot-product additions |
| H | Unsigned low halfword; unscaled projection numerator whose value sets screen magnification | 0–65535 | Projection numerator, compared with the new unsigned depth |
| OFX, OFY | Signed complete word; screen-coordinate offset × 65536 | −32768 to `32768−1/65536` screen units | Added before the final sixteen-bit screen shift |

These are representation ranges, not a promise that every combination produces an unsaturated result. The dot products wrap at 44 bits, visible MAC words wrap at 32 bits, and IR coordinates are limited to signed 16-bit results. Large representable translations can therefore overflow or saturate subsequent stages.

The identity matrix has `m00=m11=m22=4096` and all other coefficients zero. With `SF=1`, it leaves an input coordinate unchanged before translation. The coefficient 1 is `0x1000`, ½ is `0x0800`, −½ is the halfword `0xf800`, and −1 is `0xf000`.

Matrix coefficients are packed in row order, **two successive coefficients per word**; word boundaries do not coincide with row boundaries. The following examples show all five words for two transforms. Translation is separate.

| Control word | Identity | Mapping `(X,Y,Z)` to `(−Y,X,Z)` |
|---|---|---|
| C[0]: m00 low, m01 high | `0x00001000` | `0xf0000000` |
| C[1]: m02 low, m10 high | `0x00000000` | `0x10000000` |
| C[2]: m11 low, m12 high | `0x00001000` | `0x00000000` |
| C[3]: m20 low, m21 high | `0x00000000` | `0x00000000` |
| C[4]: m22 low | `0x00001000` | `0x00001000` |

For the second matrix, `SF=1`, zero translation, and `(X,Y,Z)=(64,32,512)` give `(−32,64,512)`. The negative coefficient is a signed halfword inside a packed word; it is not a negative floating-point value.

`SF=0` leaves the dot-product result unshifted. It does not change the input words into a different universal numeric format. In particular, projection depth always comes from `A_Z ASR 12`, independently of SF. Switching the Q12 identity above to `SF=0` multiplies its visible X/Y/Z results by 4096 before the IR limits, but does not multiply the depth FIFO result by 4096. It is not an integer-coordinate projection shortcut.

Select `LM=0` for the signed projection convention used here. It permits negative transformed X and Y. `LM=1` instead limits negative IR results to zero; projection would then use those zeroes in its screen calculation. The command's LM selection is a lower-limit choice, not a clipping enable.

### From transformed coordinates to screen coordinates

RTPS processes V0. RTPT processes V0, V1, and V2 in that order. Each vertex produces a transformed IR vector, a new unsigned depth, and a packed screen pair. The screen calculation uses the **limited IR1 and IR2**, not an unlimited copy of the matrix results.

The new depth is `A_Z ASR 12`, limited to 0–65535. Projection obtains a quotient `q` from H and this depth. Its scale is 65536 per unit ratio, so a quotient of `0x00008000` represents a factor of ½. The reciprocal-table divide is specified later in this chapter; it must not be replaced by an assumption of exact mathematical division. For the depths used below, H=256 gives exactly `q=32768` at depth 512 and `q=16384` at depth 1024.

```text
SX = clamp((OFX + IR1*q) ASR 16, -1024, 1023)
SY = clamp((OFY + IR2*q) ASR 16, -1024, 1023)
```

H therefore controls how much transformed X and Y contribute at a given depth. OFX and OFY place the projected origin. For origin `(128,96)`, program OFX=`128×65536 = 0x00800000` and OFY=`96×65536 = 0x00600000`. At depth 512 with H=256, transformed `(64,32)` contributes `(32,16)` screen units, giving `(160,112)` after these offsets.

The offsets can contain fractional screen units: `0x00808000` represents 128½. The final arithmetic shift discards the fraction after the projected contribution is added. It rounds toward negative infinity, not toward zero: an offset of −½ (`0xffff8000`) with a zero projected contribution produces screen coordinate −1.

| Result | Scale and range | Where to read it |
|---|---|---|
| Transformed coordinates | Signed integer IR1–IR3, −32768–32767 with LM=0 | D[9]–D[11]; RTPT leaves the third vertex's values |
| Screen coordinates | Integer SX/SY, each limited to −1024–1023 | D[12]–D[14], oldest to newest; X low, Y high |
| Projection depth | Unsigned integer, 0–65535 | D[16]–D[19], oldest to newest |
| Depth-cue amount | Integer 0–4096, with 4096 representing a full cue in the `SF=1` color convention | IR0, D[8] |
| Scaled depth sum | Unsigned integer, 0–65535 | D[7], after AVSZ3 or AVSZ4 |

The screen FIFO holds three pairs. After RTPT, D[12], D[13], and D[14] correspond to V0, V1, and V2. The depth FIFO holds four depths; after RTPT, its newest three entries D[17]–D[19] correspond to those same vertices. D[16] retains the depth that preceded them. Reading the FIFOs does not consume entries. Another projection shifts their histories.

### Area, depth, and the next decision

NCLIP evaluates the oriented screen area of the three screen FIFO entries:

```text
MAC0 = (SX1-SX0)*(SY2-SY0) - (SX2-SX0)*(SY1-SY0)
```

Without signed MAC0 overflow, the magnitude is twice the triangle's area in square screen-coordinate units. Swapping two vertices reverses the determinant's sign. An unoverflowed zero result means that these integer screen positions are collinear, including coincident positions. Choose which sign is front-facing according to the cartridge's vertex order and screen-coordinate convention. NCLIP itself neither removes a vertex nor clips or rejects a primitive.

AVSZ3 multiplies the sum of the newest three depths by signed ZSF3, then shifts right twelve bits and limits the result to 0–65535. It is a **scaled sum**, not a hardwired division by three. ZSF3=`0x0555` represents `1365/4096`, slightly less than ⅓; ZSF4=`0x0400` represents ¼ for AVSZ4. These operations produce a depth value for the cartridge's use; they do not submit, sort, or draw primitives.

Read results before another command overwrites them. NCLIP and AVSZ3 both write MAC0. Every recognized command also starts a new FLAG result, so inspect the projection flags before issuing NCLIP, then inspect the area before issuing AVSZ3. RTPT combines the flags from all three vertices; its final FLAG does not identify which vertex caused an event.

A flag is not a primitive-rejection signal. For example, `H >= 2×SZ3`, including zero depth, produces DIV and quotient `0x1ffff`; a screen overflow produces the limiting coordinate −1024 or 1023. Both still produce FIFO results. The cartridge decides how to handle such geometry. Saturated coordinates need not preserve the original triangle's area or orientation. ERROR is a summary, not a substitute for the individual flag fields; some saturation fields do not contribute to ERROR.

### Positions, normals, and colors are different inputs

A position locates a vertex. A **normal** describes a direction used for lighting; the cartridge supplies its three components to a vector register just as it supplies a position. The normal-lighting commands do not calculate a surface normal from triangle positions. Their light matrix takes three dot products with that supplied vector. The color matrix then mixes those three results and adds control vector 1. The programmed numbers, scales, and limits determine the lighting; the registerfile does not require a particular physical lighting model.

A base **color** is three unsigned bytes in RGBC, independent of the coordinate units. Some commands apply it to the lighting result; others emit the matrix result without that multiplication. A color FIFO push divides each visible MAC lane by sixteen, limits it to 0–255, and packs the three bytes with the current RGBC CODE byte. A matrix coefficient of `0x1000`, a coordinate of 4096, a color byte of 255, and a color-stage result of 4080 consequently have different meanings. Choose the command sequence and scales together; the lighting and color examples give both forms.

**Depth cueing** changes a color toward a programmed far color using IR0. It is a separate color calculation, not part of the screen FIFO push. For the last projected vertex, projection sets:

```text
IR0 = clamp((DQB + DQA*q) ASR 12, 0, 4096)
```

RTPS uses V0 for this calculation; RTPT uses only V2. DQA multiplies the reciprocal-depth quotient, not the depth word itself. DQB is added before the twelve-bit shift. The cartridge chooses these constants, or writes IR0 directly, before issuing a depth-cue color command. For DPCS with `SF=1`, far-color words contain target color bytes multiplied by sixteen; IR0=0 retains the RGBC input and IR0=4096 selects the far endpoint when the difference and result remain unsaturated. Other depth-cue commands can also lose fractional terms in intermediate shifts; the same endpoint guarantee must not be inferred for them. The color command descriptions specify the intermediate limits and the input scaling that must be preserved.

## Worked geometry sequences

### Project a triangle, test its orientation, and form a depth value

This sequence prepares the screen triangle `(96,64)`, `(160,64)`, `(128,128)`. It uses an identity transform, integer model coordinates, H=256, and projected origin `(128,96)`. All three depths are 512. The coordinates fit a 256×192 drawing area, but GTE itself has no drawing-area setting and does not draw the triangle.

![The worked triangle and its projected origin](figures/gte-projection.svg)

The outline in the figure is the example coordinate area, not a GTE clipping window. Its arrows establish the screen-coordinate convention used in this drawing.

Start with reset-zero GTE state. Use the aligned 32-bit word writes below in the listed order. The complete transform setup includes explicit zero translation and zero depth-cue constants. For subsequent triangles sharing these settings, retain the controls and replace only the input vertices before the command.

| Step | Address / register | Raw word | Meaning |
|---|---|---|---|
| 1 | `0x080102c4` — C[0] | `0x00001000` | m00=4096, m01=0 |
| 2 | `0x080102c8` — C[1] | `0x00000000` | m02=0, m10=0 |
| 3 | `0x080102cc` — C[2] | `0x00001000` | m11=4096, m12=0 |
| 4 | `0x080102d0` — C[3] | `0x00000000` | m20=0, m21=0 |
| 5 | `0x080102d4` — C[4] | `0x00001000` | m22=4096 |
| 6 | `0x080102d8` — C[5] | `0x00000000` | TRX=0 |
| 7 | `0x080102dc` — C[6] | `0x00000000` | TRY=0 |
| 8 | `0x080102e0` — C[7] | `0x00000000` | TRZ=0 |
| 9 | `0x08010324` — C[24] | `0x00800000` | OFX=128 screen units |
| 10 | `0x08010328` — C[25] | `0x00600000` | OFY=96 screen units |
| 11 | `0x0801032c` — C[26] | `0x00000100` | H=256 |
| 12 | `0x08010330` — C[27] | `0x00000000` | DQA=0 |
| 13 | `0x08010334` — C[28] | `0x00000000` | DQB=0 |
| 14 | `0x08010338` — C[29] | `0x00000555` | ZSF3=1365 |

Pack the signed vertex coordinates next. The halfword for −64 is `0xffc0`.

| Step | Address / register | Raw word | Meaning |
|---|---|---|---|
| 15 | `0x08010244` — D[0] | `0xffc0ffc0` | V0.X=−64, V0.Y=−64 |
| 16 | `0x08010248` — D[1] | `0x00000200` | V0.Z=512 |
| 17 | `0x0801024c` — D[2] | `0xffc00040` | V1.X=64, V1.Y=−64 |
| 18 | `0x08010250` — D[3] | `0x00000200` | V1.Z=512 |
| 19 | `0x08010254` — D[4] | `0x00400000` | V2.X=0, V2.Y=64 |
| 20 | `0x08010258` — D[5] | `0x00000200` | V2.Z=512 |
| 21 | `0x08010344` — COMMAND | `0x00080030` | RTPT, SF=1, LM=0 |

The RTPT write completes the arithmetic. No CYCLES polling is required. Read FLAG at `0x08010340` now, before the next command. For this sequence it is zero. Each vertex has `q=32768`, so its screen displacement is half its transformed X/Y. The first result is therefore `(128−32,96−32)=(96,64)`, followed by `(160,64)` and `(128,128)`.

| Read immediately after RTPT | Address(es) | Raw result(s) |
|---|---|---|
| Screen FIFO, V0 then V1 then V2 | `0x08010274`, `0x08010278`, `0x0801027c` | `0x00400060`, `0x004000a0`, `0x00800080` |
| Depth FIFO, oldest to newest | `0x08010284`–`0x08010290` | `0x00000000`, `0x00000200`, `0x00000200`, `0x00000200` |
| IR1, IR2, IR3, from V2 | `0x08010268`–`0x08010270` | `0x00000000`, `0x00000040`, `0x00000200` |
| MAC1, MAC2, MAC3, from V2 | `0x080102a8`–`0x080102b0` | `0x00000000`, `0x00000040`, `0x00000200` |
| IR0; MAC0 | `0x08010264`; `0x080102a4` | `0x00000000`; `0x00000000` |
| Depth-average word; FLAG | `0x08010260`; `0x08010340` | `0x00000000`; `0x00000000` |
| CYCLES | `0x08010348` | `0x00000017` — nominal 23 |

RTPT preserves the input vertex words, RGBC, the color FIFO, the depth-average word, and C[0]–C[30]. It replaces IR0–IR3 and MAC0–MAC3 and pushes the screen and depth histories. D[15] reads the new D[14]; the packed IR aliases D[28]/D[29] reflect the new IR values. The three vertices have not been consumed from their input registers.

Continue with these commands and reads in order:

| Step | Operation | Raw word or result |
|---|---|---|
| 22 | Write `0x08010344` — COMMAND | `0x00000006` — NCLIP |
| 23 | Read `0x08010340` — FLAG | `0x00000000` |
| 24 | Read `0x080102a4` — MAC0 | `0x00001000` — doubled oriented area 4096 |
| 25 | Read `0x08010348` — CYCLES | `0x00000008` — nominal 8 |
| 26 | Write `0x08010344` — COMMAND | `0x0000002d` — AVSZ3 |
| 27 | Read `0x08010340` — FLAG | `0x00000000` |
| 28 | Read `0x08010260` — depth average | `0x000001ff` — 511 |
| 29 | Read `0x080102a4` — MAC0 | `0x001ffe00` — 2096640 |
| 30 | Read `0x08010348` — CYCLES | `0x00000005` — nominal 5 |

Neither NCLIP nor AVSZ3 uses SF or LM. NCLIP gives `(160−96)×(128−64) − (128−96)×(64−64) = 4096`, a positive doubled area. AVSZ3 gives `1365×(512+512+512) = 2096640`; the twelve-bit shift yields 511, not 512. This is the deliberate consequence of representing ⅓ by `1365/4096`, not an extra rounding stage.

NCLIP changes MAC0 and FLAG but preserves the screen and depth FIFOs, IR0–IR3, MAC1–MAC3, and D[7]. AVSZ3 then replaces MAC0 and D[7], again preserving those FIFOs and IR/MAC1–MAC3 results. Both preserve the programmed controls and input vertices. At the end, the screen words still contain the triangle, while MAC0 no longer contains its area. Retain the area decision before continuing.

## From projected vertices to a visible image

A projected vertex is still only a pair of numbers. Reading SXY2 does not place a pixel in graphics memory. The cartridge must pass the projected coordinates to a GPU drawing command, and PCRTC must read the part of graphics memory into which that command draws.

| Stage | Data supplied by the cartridge | Result | What does not happen automatically |
|---|---|---|---|
| GTE geometry | Three-dimensional vectors, transformation matrix, translation, projection numerator and screen offsets | Screen pairs, depth history, arithmetic flags | No polygon or pixel is drawn. |
| GTE color arithmetic, when used | Direction vectors, light/color matrices, input color and optional depth-cue parameters | Color FIFO entries | Colors are not attached to a GPU packet automatically. |
| GPU drawing | A drawing command containing screen coordinates and colors | Pixel values in graphics memory | GTE results are not fetched by the GPU. |
| PCRTC display | Framebuffer base, stride, storage format, source window and circuit enable | Display samples from that framebuffer | It does not execute geometry or create the image being read. |

The cartridge connects these stages with register reads and writes. Geometry, shading and drawing are separate choices: projecting a triangle does not select its color; producing a color does not select a texture or submit a triangle. The example below deliberately chooses a solid, untextured red triangle so that no texture state is needed.

### Continue the worked triangle

Continue immediately after **Project a triangle, test its orientation, and form a depth value**, before changing its transform or issuing another projection. Its retained screen words are:

| GTE word | Coordinate | Packed word |
|---|---|---|
| D[12] | (96, 64) | `0x00400060` |
| D[13] | (160, 64) | `0x004000a0` |
| D[14] | (128, 128) | `0x00800080` |

The following continuation starts from GPU and PCRTC reset state, with reset beam timing still running. No other producer writes the GPU command port. It uses graphics-memory base zero, a 1024-word row stride and the GX16 storage format. The displayed window is 256 × 192 pixels. These are example choices, not a claim that every framebuffer must have that size or stride.

All GPU command words in the following GP0 tables are aligned 32-bit CPU stores to **GP0 at `0x0801023c`**. Each table gives words in transmission order. Use ordinary CPU word stores; do not replace a complete command packet with a single floating-point store. Direct CPU stores wait for a free command FIFO slot when necessary. Preserve packet order and keep other writers off this port for the sequence.

### Set drawing state and clear the destination

The drawing area bounds include their final coordinate. Here they cover X=0–255 and Y=0–191. The GPU drawing offset is zero: GTE has already placed the triangle using its screen offsets of (128, 96).

| Order | GP0 word | Meaning |
|---:|---|---|
| 1 | `0xe1000400` | Draw mode: allow drawing to the displayed field; dithering off. No texture is used by this example. |
| 2 | `0xe3000000` | Drawing-area top-left = (0, 0). |
| 3 | `0xe402fcff` | Drawing-area bottom-right = (255, 191). |
| 4 | `0xe5000000` | Drawing offset = (0, 0). |
| 5 | `0xe6000000` | Do not test destination mask bits and do not force the mask bit on new pixels. |

Next send the complete three-word fill packet. This initializes the actual displayed storage; it does not rely on graphics-memory power-on contents.

| Order | GP0 word | Meaning |
|---:|---|---|
| 6 | `0x02000000` | Fill rectangle with black RGB. |
| 7 | `0x00000000` | Destination (0, 0). |
| 8 | `0x00c00100` | Width 256; height 192. |

### Submit the triangle

Opcode `0x20` selects a three-vertex polygon with one constant color, no texture and no semitransparency. The low 24 bits of its first word contain red, green and blue in successive low-to-high bytes. Therefore `0x200000ff` selects red (255, 0, 0).

| Order | GP0 word | Meaning |
|---:|---|---|
| 9 | `0x200000ff` | Solid red triangle command and color. |
| 10 | Read D[12]: `0x00400060` | First screen coordinate. |
| 11 | Read D[13]: `0x004000a0` | Second screen coordinate. |
| 12 | Read D[14]: `0x00800080` | Third screen coordinate. |

Here the GTE screen format already supplies the coordinate word required by this GPU packet. Copy the words, not their byte addresses. The color FIFO is not required for this constant-color example. A cartridge using GTE-produced colors would explicitly place those result bytes into its chosen drawing packet.

The earlier geometry sequence reported positive doubled area 4096 before AVSZ3, then finished with OTZ=511. Those values do not themselves accept, reject or sort this GPU polygon. The example submits it explicitly. In particular, NCLIP is an orientation calculation, not a clipping engine.

Read **GP1/status at `0x08010240`** until bit 26 is one to wait for the complete drawing command stream to become idle. Do this after the full triangle packet, not between its coordinate words: an incomplete packet is not idle. A status read is not an additional GP0 packet word.

### Select the framebuffer for display

Now perform these PCRTC word writes. The unchanged reset base/stride/format word is included to make the destination-to-display connection explicit. The source window begins at the same (0, 0) that was cleared and drawn above.

| Order | Address | Register | Word | Effect |
|---:|---|---|---|---|
| 1 | `0x0801035c` | DISPFB1_LOW | `0x000fa000` | Base zero; width 16 × 64 = 1024 words; GX16. |
| 2 | `0x08010360` | DISPFB1_HIGH | `0x00000000` | Source origin (0, 0). |
| 3 | `0x08010368` | DISPLAY1_HIGH | `0x000bf3ff` | Horizontal extent 1023 and vertical extent 191. With reset horizontal signal step 4, this selects 256 × 192 output pixels. |
| 4 | `0x08010354` | PMODE_LOW | `0x0000ff21` | Enable circuit 1 only and select its RGB directly. |

Retain the reset signal position, magnification and timing words. The source origin is a framebuffer coordinate, while DISPLAY's position is a signal coordinate; do not copy the GTE screen offset into DISPLAY. PCRTC converts its selected signal window to output coordinates, so the example image begins at output (0, 0).

At **VBlank entry**, the display latch takes the currently programmed settings together. Complete all four writes before that edge: separate stores are not an atomic configuration update, and an intervening VBlank entry can take an intermediate configuration. Reading back `0x0000ff21` immediately confirms the programmed word, not that the display has taken it. Let the next VBlank entry latch the configuration before expecting the new window. No PCRTC interrupt mask change is required for the latch itself. For the complete latch and beam contract, see **PCRTC Display Controller, Section 2.6**.

The observable result is a red triangle on a black 256 × 192 image, with vertices at (96, 64), (160, 64) and (128, 128). At the interior point (128, 96), the graphics-memory word is `0x001f`, which GX16 supplies as RGB (255, 0, 0). At (0, 0), the cleared word is `0x0000`, supplying black. With the selected direct-RGB composition, the samples' zero mask/alpha bit does not blend the red away.

The framebuffer stride is 1024 words even though the visible width is 256 pixels. Thus row y begins at local word address `1024 × y`, not `256 × y`; the center sample above is at word address 98432. The clearing command, GPU drawing coordinates and PCRTC source must agree on this organization. Changing only the displayed window width does not repack graphics memory.

## A further geometry sequence

### Translate before projection

Continue from the completed triangle sequence without resetting. Keep its identity matrix, H=256, screen origin `(128,96)`, and zero DQA/DQB. Change the translation to `(32,−16,512)` and project the new V0 `(64,32,512)`:

| Step | Address / register | Raw word | Meaning |
|---|---|---|---|
| 1 | `0x080102d8` — C[5] | `0x00000020` | TRX=32 |
| 2 | `0x080102dc` — C[6] | `0xfffffff0` | TRY=−16, signed complete word |
| 3 | `0x080102e0` — C[7] | `0x00000200` | TRZ=512 |
| 4 | `0x08010244` — D[0] | `0x00200040` | V0.X=64, V0.Y=32 |
| 5 | `0x08010248` — D[1] | `0x00000200` | V0.Z=512 |
| 6 | `0x08010344` — COMMAND | `0x00080001` | RTPS, SF=1, LM=0 |

The transformed position is `(64+32,32−16,512+512)=(96,16,1024)`. The new quotient is `16384`, a factor of ¼. Thus the screen result is `(128+96/4,96+16/4)=(152,100)`. Translation does not add a fixed number of screen units: its X/Y displacement is subject to perspective, while its Z displacement changes the denominator.

| Read immediately after RTPS | Raw result(s) |
|---|---|
| D[9], D[10], D[11] — IR1–IR3 | `0x00000060`, `0x00000010`, `0x00000400` |
| D[25], D[26], D[27] — MAC1–MAC3 | `0x00000060`, `0x00000010`, `0x00000400` |
| D[12], D[13], D[14] — screen history | `0x004000a0`, `0x00800080`, `0x00640098` |
| D[16], D[17], D[18], D[19] — depth history | `0x00000200`, `0x00000200`, `0x00000200`, `0x00000400` |
| D[8] — IR0; D[24] — MAC0 | `0x00000000`; `0x00000000` |
| D[7] — previous depth average | `0x000001ff`, unchanged |
| FLAG; CYCLES | `0x00000000`; `0x0000000f` — nominal 15 |

Only one new screen pair and one new depth were pushed. V1 and V2 remain programmed but were not processed by RTPS. The changed translation remains active for the next projection until the cartridge writes another translation.

## Command reference

Choose a command by the result required, not by its nominal cycle count. Normal commands publish their results during the `COMMAND` write at `0x08010344`; the listed count is then readable from `CYCLES` at `0x08010348`. It does not specify a separate completion delay or busy period. VMAD3 uses the separate PLUS command window and delayed-publication protocol described in its entry.

For normal commands, the function is in bits 5:0. Add `0x00080000` for SF=1 and `0x00000400` for LM=1 to the function word shown in each entry. SF=0 performs no main-result shift; SF=1 shifts that result right by 12. LM=0 permits negative IR results down to −32768; LM=1 clamps them at zero. Both modes have an upper IR limit of 32767. Exceptions and forced intermediate clamps are stated below. Only MVMVA consumes the matrix, vector, and control-vector selectors; those fields do not redirect the operands of another command.

Every recognized normal command replaces normal FLAG, clearing it before calculation. Intermediate stages contribute flags even when a later stage overwrites their results. Triple commands collect flags across all three vectors or colors. See [MAC, shift, and IR stages](#mac-shift-and-ir-stages) for the exact wrap, shift, clamp, and overflow tests, and [normal FLAG](#c31--normal-flag) for the summary mask. A color saturation flag, IR3 saturation flag, or IR0 saturation flag alone does not set ERROR.

The result lists below name stored registers. Other stored data and control words remain unchanged, apart from `COMMAND`, `CYCLES`, and FLAG. Derived register reads continue to follow their source registers. A color push shifts RGB0←old RGB1 and RGB1←old RGB2, then writes the new color to RGB2, occupying D[20]–D[22]. The new CODE byte always comes from RGBC, D[6]. A screen or depth push similarly updates the register history, not a queue of work awaiting execution.

### Geometry commands

#### RTPS — transform and project one vector

**Encoding and count:** function `0x01`; raw `0x00080001` selects SF=1, LM=0. Nominal count: **15**. SF and LM apply to the transformed intermediate results; matrix/vector selectors are ignored.

Use RTPS for one position when its projected coordinates, depth, and depth-cue coefficient are needed together. It always reads V0 from signed halfwords in D[0]/D[1], matrix 0 from signed coefficients in C[0]–C[4], and signed translation words C[5]–C[7]. With coefficients scaled by 4096 and SF=1, an integer vector and integer translation produce integer transformed coordinates. Projection also reads unsigned H from C[26], signed OFX/OFY from C[24]/C[25], signed DQA from C[27], and signed DQB from C[28]. Offsets enter before the screen result's fixed 16-bit shift; depth-cue offset DQB enters before its fixed 12-bit shift.

The command overwrites MAC1–MAC3, IR1–IR3, MAC0, and IR0; pushes one screen pair into D[12]–D[14] and one depth into D[16]–D[19]; and replaces FLAG. The newest results are SXY2 and SZ3. MAC0 ends with the depth-cue calculation, not the screen-Y calculation. Rotation overflow, the projection-specific IR3 test, IR clamps, depth clamp, reciprocal overflow, screen clamps, and the depth-cue clamp contribute their respective flags.

Choose RTPT instead when all three vector slots form one batch. RTPS does not reject a vertex whose depth or screen coordinate saturates: the clamped output is still pushed. SF does not change the fixed-12 depth calculation. The complete operation, including IR3's exceptional flag test and the reciprocal calculation, is specified in [Projection stage RT(v, last)](#projection-stage-rtv-last).

#### RTPT — transform and project three vectors

**Encoding and count:** function `0x30`; raw `0x00080030` selects SF=1, LM=0. Nominal count: **23**. SF and LM have the same applicability as RTPS; selectors are ignored.

Use RTPT to project V0, V1, and V2 without three separate command writes. The signed vectors occupy D[0]–D[5]. All three share matrix 0 and translation, C[0]–C[7], projection offsets C[24]/C[25], H at C[26], and depth-cue constants C[27]/C[28]. The integer/Q12 scaling described for RTPS applies independently to each vector.

RTPT performs the [projection stage](#projection-stage-rtv-last) in V0, V1, V2 order. Afterward SXY0, SXY1, and SXY2 contain those three projected pairs; SZ1, SZ2, and SZ3 contain their depths, while SZ0 retains the pre-command newest depth. It overwrites MAC1–MAC3 and IR1–IR3 with the third vector's transformed results. It also overwrites MAC0 and IR0, calculating the depth-cue coefficient only for V2. FLAG retains conditions from all three projections, not merely V2.

Use NCLIP next when the three projected points are to be tested for orientation, or AVSZ3 when their scaled depth sum is needed. Do not use RTPT's one final IR0 as though the command had retained a separate coefficient for every vertex. For individually depth-cued colors, arrange the required coefficients and color calculations separately. Like RTPS, RTPT pushes saturated results rather than clipping a primitive.

#### NCLIP — calculate doubled oriented screen area

**Encoding and count:** function `0x06`; raw `0x00000006`. Nominal count: **8**. SF, LM, and all selectors are ignored.

NCLIP reads the signed X/Y halves of SXY0, SXY1, and SXY2 in D[12]–D[14]. It evaluates the six-product determinant in [Direct arithmetic functions](#direct-arithmetic-functions) and writes its low 32 bits to MAC0, D[24]. FLAG reports signed MAC0 overflow if the full determinant exceeds that word's range. No IR register or FIFO is modified.

The determinant is **twice the triangle's oriented Euclidean area**, measured in squared units of the programmed screen coordinates. Without signed MAC0 overflow, its sign can be used for a cartridge's winding test and zero identifies a degenerate triangle in those coordinates. For example, points `(0,0)`, `(1,0)`, `(0,1)` give `+1`; exchanging the final two points gives `−1`. Whether a positive result is front-facing depends on the cartridge's coordinate and winding conventions.

Choose NCLIP after RTPT rather than reconstructing the determinant from three separate screen reads. Read or use the result before replacing MAC0 with another command, and preserve the three screen entries until NCLIP has consumed them. Despite its name, NCLIP does not clip, reject, or draw anything. Directly programmed signed 16-bit coordinates can overflow MAC0; its wrapped sign alone then does not describe the full determinant.

#### MVMVA — selected matrix-vector calculation

**Encoding and count:** function `0x12`. Form the raw word as `0x00000012 | (SF<<19) | (mx<<17) | (v<<15) | (cv<<13) | (LM<<10)`. Nominal count: **8**. All five fields are used.

Use MVMVA for a matrix calculation without projection or a color push. It selects one signed 16-bit coefficient matrix, a signed three-component vector, and a signed 32-bit control vector. The full selector table is in [Operand selection](#operand-selection): mx=0/1/2 selects C[0]–C[4], C[8]–C[12], or C[16]–C[20]; v=0/1/2 selects D[0]/D[1], D[2]/D[3], or D[4]/D[5], and v=3 selects current IR1–IR3, D[9]–D[11]. Control-vector selections 0/1/2 use C[5]–C[7], C[13]–C[15], or C[21]–C[23]; selection 3 supplies zero.

For cv=0, 1, or 3, each result is the ordered sum `4096×control + matrix-row dot vector`, followed by the selected SF shift and LM clamp. Thus Q12 coefficients with SF=1 preserve the vector's scale and add the control vector in that same scale. MAC1–MAC3 receive the shifted, word-wrapped results; IR1–IR3 receive their clamped versions. FLAG records the ordered accumulation and clamp conditions. MAC0, IR0, and all FIFOs are unchanged.

Two representable selections require particular care. mx=3 selects the defined synthetic matrix, whose inputs include RGBC red, IR0, and portions of C[1]/C[2]; it is not an invalid encoding. cv=2 performs two passes: its far-color/control and X contribution can set flags but is then overwritten, leaving only the Y/Z contribution in the final MAC/IR result. It is not an ordinary full matrix-plus-far-color sum. See [Shared matrix and color stages](#shared-matrix-and-color-stages) for the exact two-pass sequence. Use RTPS/RTPT instead when projection is required.

#### OP — cross-product components from the rotation diagonal

**Encoding and count:** function `0x0c`; raw `0x0008000c` selects SF=1, LM=0. Nominal count: **6**. SF and LM apply; selectors are ignored.

OP takes one three-component operand from the signed diagonal coefficients of matrix 0: `d1=s16lo(C[0])`, `d2=s16lo(C[2])`, and `d3=s16lo(C[4])`. The other operand is current signed IR1–IR3, D[9]–D[11]. It calculates `(d2×IR3−d3×IR2, d3×IR1−d1×IR3, d1×IR2−d2×IR1)`. With a Q12 diagonal operand and SF=1, the result has the IR operand's scale; with SF=0, products remain unshifted.

The command overwrites MAC1–MAC3 and IR1–IR3 and replaces FLAG. There is no FIFO push and no MAC0 or IR0 result. Its signed MAC values receive the selected shift and word wrap; IR receives the selected clamp. OP does not generate the 44-bit MAC-overflow flags, although IR saturation can still be reported. The exact equations are in [Direct arithmetic functions](#direct-arithmetic-functions).

Choose OP for these cross-product components, not for multiplying a vector by the complete rotation matrix. Off-diagonal rotation coefficients are not consumed. Choose MVMVA for a full matrix-vector product. LM=1 discards negative IR components, so use LM=0 when their signs are needed in a following vector calculation.

#### AVSZ3 — scale the newest three depths

**Encoding and count:** function `0x2d`; raw `0x0000002d`. Nominal count: **5**. SF, LM, and selectors are ignored.

AVSZ3 reads unsigned SZ1, SZ2, and SZ3 from D[17]–D[19] and signed ZSF3 from the low halfword of C[29]. It multiplies their sum by ZSF3. The full product supplies MAC0's overflow test and, after a fixed arithmetic right shift by 12, the unsigned 0–65535 clamp that produces OTZ in D[7]. MAC0, OTZ, and FLAG are the only arithmetic output words; no FIFO is shifted.

Use AVSZ3 after three projected depths when the cartridge requires a depth quantity for a triangle. The scale coefficient determines normalization: this command does not divide by three automatically. ZSF3 is interpreted as a signed coefficient with a fixed denominator of 4096 in the OTZ calculation. A negative scaled result clamps to zero; an oversized result clamps to 65535. Either clamp sets SZ and ERROR, and signed MAC0 overflow has its own flags.

Choose AVSZ4 for four depths rather than attempting to select a fourth operand with command bits. The OTZ calculation uses the full product even when MAC0 wraps, so deriving OTZ from a later read of MAC0 is not generally equivalent. See [Direct arithmetic functions](#direct-arithmetic-functions).

#### AVSZ4 — scale all four depth entries

**Encoding and count:** function `0x2e`; raw `0x0000002e`. Nominal count: **6**. SF, LM, and selectors are ignored.

AVSZ4 uses unsigned SZ0–SZ3, D[16]–D[19], and signed ZSF4 from the low halfword of C[30]. It writes MAC0 from `ZSF4×(SZ0+SZ1+SZ2+SZ3)` and writes OTZ, D[7], from the full product shifted right by 12 and clamped to 0–65535. FLAG reports MAC0 overflow and depth-result saturation. Other arithmetic registers and all FIFO entries retain their values.

Choose AVSZ4 when all four depth entries belong to the intended batch. In particular, RTPT creates only three new depths: immediately afterward SZ0 is retained history, not a fourth vertex from that command. Program or produce the desired fourth depth before including it. A coefficient of 1024 gives an exact one-quarter scale before the final integer truncation; other signed values intentionally produce other scaled sums.

Like AVSZ3, this is not an automatic primitive sorter and does not submit a rendering operation. Its depth output follows the full-product rule in [Direct arithmetic functions](#direct-arithmetic-functions), independently of SF and independently of a wrapped MAC0 readback.

### Lighting and color commands

The lighting/color family selects stages by command, not by the MVMVA selector bits. The light stage takes three dot products of a signed vector with matrix 1, C[8]–C[12]. The color stage combines those three intermediate values through matrix 2, C[16]–C[20], adding signed control vector 1, C[13]–C[15]. These are the actual programmable operations: there is no separate command field for a number of lights. A triple command processes three input vectors, not three successive lights.

For SF=1, Q12 matrix coefficients preserve the scale of their input vector at each matrix stage. In a modulated-color calculation, an intermediate value of 4096 is a unit gain: multiplying `RGB byte×16×4096` and shifting by 12 produces `RGB byte×16`, which the color FIFO's final four-bit shift converts back to a byte. By contrast, a command without color modulation sends its final matrix MAC results directly to that four-bit color conversion; program that result scale accordingly. The equations and intermediate clamps are in [Shared matrix and color stages](#shared-matrix-and-color-stages).

#### NCS — light and color one vector without base-color modulation

**Encoding and count:** function `0x1e`; raw `0x0008041e` selects SF=1, LM=1. Nominal count: **14**. SF and LM apply to both matrix stages; selectors are ignored.

NCS reads signed V0, D[0]/D[1], the light matrix C[8]–C[12], the color matrix C[16]–C[20], and signed color-stage offsets C[13]–C[15]. It first converts V0 to three light-stage intermediates, then combines those intermediates into red, green, and blue matrix results. RGBC supplies CODE only; its RGB bytes do not multiply the result. No far-color word or IR0 is used.

MAC1–MAC3 and IR1–IR3 finish with the color-matrix results. One color is pushed into D[20]–D[22], and FLAG includes both matrix stages' overflow and IR-clamp conditions plus output-color saturation. The pushed bytes come from signed MAC1–MAC3 divided by 16 and clamped to 0–255, not from a second conversion of the clamped IR words.

Choose NCS when the matrices already produce the desired color intensity in byte×16 units. Choose NCCS when the same matrix pipeline is to produce gains applied to RGBC, and NCDS when that modulated result must also be depth-cued. A Q12 value of 4096 sent directly to the color FIFO represents byte value 256 and saturates; it is a unit modulation gain, not a unit output byte. See the matrix and color-push definitions in [Shared matrix and color stages](#shared-matrix-and-color-stages).

#### NCT — light and color three vectors without modulation

**Encoding and count:** function `0x20`; raw `0x00080420` selects SF=1, LM=1. Nominal count: **30**. SF and LM apply at every matrix stage; selectors are ignored.

NCT performs the NCS calculation for signed V0, V1, and V2 in D[0]–D[5], in that order. All three use the same light matrix C[8]–C[12], color matrix C[16]–C[20], and signed control vector C[13]–C[15]. The RGB bytes in RGBC are not modulation operands; its one CODE byte is attached to every output. IR0 and far color are not consumed.

The three resulting colors replace RGB0, RGB1, and RGB2, D[20]–D[22], in vector order. MAC1–MAC3 and IR1–IR3 retain only V2's final color-matrix result. FLAG accumulates overflow, intermediate IR saturation, and output-color saturation from all three calculations. There is no screen or depth push.

Choose NCT instead of three NCS commands when the matrices and offsets are shared and all three vectors are available. As with NCS, the final matrix values are converted directly from byte×16 units to output bytes; the command does not apply a base RGBC color. Choose NCCT for shared base-color modulation or NCDT for modulation plus depth cue. Three output colors do not imply three lights; see the shared matrix stages above.

<a id="nccs--light-one-vector-and-modulate-the-base-color"></a>

#### NCCS — light one vector and modulate the base color

**Encoding and count:** function `0x1b`; raw `0x0008041b` selects SF=1, LM=1. Nominal count: **17**. SF and LM apply to the light matrix, color matrix, and color-application stages; selectors are ignored.

NCCS reads signed V0, D[0]/D[1], light matrix C[8]–C[12], color matrix C[16]–C[20], signed offsets C[13]–C[15], and all four bytes of RGBC, D[6]. After the two matrix stages, it multiplies each RGB byte by 16 and by the corresponding signed intermediate IR value. That product passes through the selected SF shift and LM clamp, then the color FIFO receives the MAC-based color conversion. With SF=1, a matrix-produced gain of 4096 preserves the corresponding base-color byte.

The final modulated values overwrite MAC1–MAC3 and IR1–IR3. One color is pushed into D[20]–D[22] with RGBC's CODE, and FLAG collects every stage's lane overflow, IR saturation, and color saturation. IR0 and far color are unused; MAC0 and the geometric FIFOs are unchanged.

Choose NCCS over NCS when the matrix result is an intensity gain rather than the final byte×16 color. Choose NCDS to add depth cue after modulation, or CC when the light-stage result is already in IR1–IR3. The [color-application stage](#shared-matrix-and-color-stages) uses the selected SF again: SF is not applied only once to the entire compound command.

##### Example: separate red, green, and blue gains

Begin with reset-zero GTE. The following ordered word writes program identity light and color matrices, V0 `(4096,2048,1024)`, and base color `(160,128,64)` with CODE `0x34`. Matrix coefficients and vector components are scaled by 4096; the color-stage offsets remain zero.

| Order | Address | Destination | Raw word |
|---:|---|---|---|
| 1 | `0x080102e4` | C[8], light diagonal 0 | `0x00001000` |
| 2 | `0x080102ec` | C[10], light diagonal 1 | `0x00001000` |
| 3 | `0x080102f4` | C[12], light diagonal 2 | `0x00001000` |
| 4 | `0x08010304` | C[16], color diagonal 0 | `0x00001000` |
| 5 | `0x0801030c` | C[18], color diagonal 1 | `0x00001000` |
| 6 | `0x08010314` | C[20], color diagonal 2 | `0x00001000` |
| 7 | `0x08010244` | D[0], V0.X/V0.Y | `0x08001000` |
| 8 | `0x08010248` | D[1], V0.Z | `0x00000400` |
| 9 | `0x0801025c` | D[6], RGBC | `0x344080a0` |
| 10 | `0x08010344` | COMMAND, NCCS with SF=1, LM=1 | `0x0008041b` |

Both matrix stages preserve `(4096,2048,1024)`. Color application produces MAC/IR values `(2560,1024,256)`, or raw words `0x00000a00`, `0x00000400`, and `0x00000100`. The final four-bit shift gives RGB `(160,64,16)`: full red, half green, and quarter blue. Read RGB2 at `0x0801029c` as `0x341040a0`; RGB0/RGB1 remain zero. FLAG is zero, and normal CYCLES reads `0x00000011`. The values are visible as soon as the command write completes.

#### NCCT — light and modulate three vectors

**Encoding and count:** function `0x3f`; raw `0x0008043f` selects SF=1, LM=1. Nominal count: **39**. SF and LM apply throughout each iteration; selectors are ignored.

NCCT repeats NCCS for signed V0, V1, and V2 in D[0]–D[5]. The shared inputs are light matrix C[8]–C[12], color matrix C[16]–C[20], signed offsets C[13]–C[15], and RGBC, D[6]. Each vector passes through both matrices; its result then supplies three channel gains for the same RGBC bytes. Under SF=1, gain 4096 preserves a base byte, as in the NCCS example.

RGB0, RGB1, and RGB2 finish with the three newly calculated colors in V0/V1/V2 order. Every CODE comes from the shared RGBC word. MAC1–MAC3 and IR1–IR3 retain V2's final modulated values; FLAG accumulates conditions from all stages and all vectors. No depth or screen register is pushed, and no depth-cue coefficient is consumed.

Choose NCCT for a three-vector batch sharing base color and matrices, NCT when no base-color modulation is wanted, or NCDT when modulation must be followed by depth cue. A single command has only the one programmed RGBC input; use separate commands if each vector requires a different base color. The intermediate limits and final MAC-based color conversion are the same as [NCCS](#nccs--light-one-vector-and-modulate-the-base-color).

#### NCDS — light, modulate, and depth-cue one vector

**Encoding and count:** function `0x13`; raw `0x00080413` selects SF=1, LM=1. Nominal count: **19**. SF and LM apply throughout; the depth-cue temporary difference forces LM=0. Selectors are ignored.

NCDS reads signed V0, D[0]/D[1], light matrix C[8]–C[12], color matrix C[16]–C[20], signed offsets C[13]–C[15], RGBC at D[6], signed IR0 at D[8], and signed far-color words C[21]–C[23]. The two matrices produce an intermediate intensity vector. Instead of first committing a separately shifted color application, depth cue receives the unshifted products `RGB byte×16×IR lane`. It forms and limits the far-color differences, combines them with those products using IR0, and only then produces the final color.

The final depth-cued values overwrite MAC1–MAC3 and IR1–IR3. One color is pushed into D[20]–D[22], and FLAG collects matrix, cue-difference, final IR, and color-output conditions. IR0 is an input and is not rewritten; no position is projected and no depth FIFO is changed.

Choose NCDS when one normal/vector needs the complete matrix, base-color, and cue calculation. Choose NCCS to omit cue, CDP to begin with current light-stage IR values, or DCPL to begin with current channel gains after the color matrix. With SF=1, IR0=0 leaves only the starting product in the final cue sum; IR0=4096 applies the full limited difference. Intermediate shifts can discard fractional bits even without a clamp, so do not replace this with an ideal blend formula. The exact two-pass operation is [Depth cue, DC(in)](#shared-matrix-and-color-stages).

#### NCDT — light, modulate, and depth-cue three vectors

**Encoding and count:** function `0x16`; raw `0x00080416` selects SF=1, LM=1. Nominal count: **44**. SF and LM apply to each stage; every cue-difference clamp forces LM=0. Selectors are ignored.

NCDT performs the NCDS sequence for signed V0/V1/V2, D[0]–D[5], in order. All iterations use the same light matrix C[8]–C[12], color matrix C[16]–C[20], signed offsets C[13]–C[15], base RGBC at D[6], signed IR0 at D[8], and signed far-color vector C[21]–C[23]. Each iteration supplies `RGB byte×16×its color-stage IR lane` to the shared depth-cue calculation.

The resulting colors occupy RGB0–RGB2 in vector order, with RGBC's CODE on all three. MAC1–MAC3 and IR1–IR3 retain only the last vector's final cued values. FLAG accumulates all matrix-overflow, intermediate-clamp, final-clamp, and output-color conditions across the batch. IR0 and all geometry outputs are unchanged.

Choose NCDT over three NCDS commands when the entire programmed lighting/color state, including the cue coefficient, is shared. It does **not** select a different IR0 from each vertex's depth: there is only the one signed input word. In particular, RTPT followed by NCDT uses RTPT's final, V2-derived IR0 for all three colors. Use individually programmed coefficients and separate operations when that is not the required shading. See [Shared matrix and color stages](#shared-matrix-and-color-stages) for intermediate scaling and saturation.

#### CC — color-matrix and base-color calculation from current IR

**Encoding and count:** function `0x1c`; raw `0x0008041c` selects SF=1, LM=1. Nominal count: **11**. SF and LM apply to the color matrix and color-application stages; selectors are ignored.

CC begins with signed IR1–IR3, D[9]–D[11], rather than a V slot. It reads color matrix C[16]–C[20], signed offsets C[13]–C[15], and RGBC, D[6]. The color matrix combines the input IR values and adds the offsets. The resulting clamped IR lanes then modulate `RGB byte×16`, followed by the selected SF shift. Under SF=1, a color-stage result of 4096 is unit gain.

CC overwrites MAC1–MAC3 and IR1–IR3 with the final modulated results, pushes one RGB color, and replaces FLAG with conditions from both stages and the output conversion. IR0, far color, light matrix, and vector slots are not consumed. There is no MAC0, depth, or screen result.

Choose CC when the three light-stage intermediates have already been produced or directly programmed. Choose NCCS to include the light matrix and V0 in the same command. Choose CDP for the same starting point with depth cue, or DCPL if the current IR lanes are already the final color-stage gains and must not pass through the color matrix again. The exact matrix, application, and push arithmetic is in [Shared matrix and color stages](#shared-matrix-and-color-stages).

#### CDP — color-matrix, base-color, and depth-cue calculation

**Encoding and count:** function `0x14`; raw `0x00080414` selects SF=1, LM=1. Nominal count: **13**. SF and LM apply; the cue-difference clamp forces LM=0. Selectors are ignored.

CDP reads current signed IR1–IR3, D[9]–D[11], color matrix C[16]–C[20], signed offsets C[13]–C[15], RGBC at D[6], signed IR0 at D[8], and signed far-color words C[21]–C[23]. The color matrix first produces three channel gains. Their unshifted products `RGB byte×16×IR lane` enter depth cue directly. The cue stage uses far color multiplied by 4096, the selected SF at both passes, and IR0 as the signed blend coefficient.

MAC1–MAC3 and IR1–IR3 finish with the cued values. One color is pushed into D[20]–D[22], using RGBC's CODE; FLAG records conditions from the matrix, both cue passes, and the color conversion. IR0 remains the input value, and no geometric FIFO is changed.

Choose CDP over NCDS when light-stage intermediates are already in IR, over CC when cue is required, or over DCPL when the color matrix still needs to be applied. Do not first run CC and assume CDP merely adds cue to its result: CDP applies the color matrix again, and its cue input uses the unshifted base-color products specified in [Shared matrix and color stages](#shared-matrix-and-color-stages).

### Interpolation and general arithmetic commands

The commands in this group can operate without a vector transform or light matrix. For the depth-cue commands, IR0 is consumed as a signed low-halfword value. A coefficient of 2048 represents one half only in the SF=1, correctly scaled, unclamped calculation; directly programmed negative or larger coefficients remain representable inputs. For SF=1, far-color components are signed 32-bit words in the same scale as the final IR/MAC color values, normally byte×16 for a color FIFO result. Intermediate shift truncation, the temporary difference clamp, and arithmetic wrap remain part of the result even at nominal endpoint coefficients.

#### DPCS — depth-cue a programmed RGB color

**Encoding and count:** function `0x10`; raw `0x00080410` selects SF=1, LM=1. Nominal count: **8**. SF applies to both cue passes; the temporary difference uses LM=0, and the final IR clamp uses selected LM. Selectors are ignored.

DPCS reads the unsigned RGB bytes and CODE of RGBC, D[6], signed IR0 at D[8], and signed far-color words C[21]–C[23]. It supplies each RGB byte multiplied by 65536 to [Depth cue, DC(in)](#shared-matrix-and-color-stages), then pushes the resulting color. For SF=1, source bytes consequently enter the final MAC result at byte×16 scale; program a target output byte b as far color `16×b`.

The command overwrites MAC1–MAC3 and IR1–IR3, pushes one color into D[20]–D[22], and replaces FLAG. Both cue passes can contribute lane-overflow and IR-clamp flags; the push can add RGB saturation flags. It leaves IR0, MAC0, vector slots, and geometric FIFOs unchanged.

Choose DPCS for a source color held in RGBC, INTPL for a source vector already held in IR, or DPCT for the three existing FIFO colors. DPCS does not read the previous RGB2 as its source. SF=0 does not mean the same blend with greater precision: it changes both passes' scaling and hence their limited differences. The negative temporary difference remains allowed even with LM=1, as the following blue-channel example demonstrates.

##### Example: halfway from one color to another

Begin with reset-zero GTE. Cue RGB `(32,64,96)` toward `(160,128,64)` with coefficient one half and CODE `0x56`:

| Order | Address | Destination | Raw word |
|---:|---|---|---|
| 1 | `0x0801025c` | D[6], RGBC | `0x56604020` |
| 2 | `0x08010264` | D[8], IR0 = 2048 | `0x00000800` |
| 3 | `0x08010318` | C[21], far red = 160×16 | `0x00000a00` |
| 4 | `0x0801031c` | C[22], far green = 128×16 | `0x00000800` |
| 5 | `0x08010320` | C[23], far blue = 64×16 | `0x00000400` |
| 6 | `0x08010344` | COMMAND, DPCS with SF=1, LM=1 | `0x00080410` |

The first cue pass produces signed differences `(2048,1024,−512)`. The second produces MAC/IR `(1536,1536,1280)`, raw words `0x00000600`, `0x00000600`, and `0x00000500`. Their final division by 16 gives RGB `(96,96,80)`. Read RGB2 at `0x0801029c` as `0x56506060`; RGB0/RGB1 remain zero. FLAG is zero, IR0 remains `0x00000800`, and CYCLES reads `0x00000008`. No completion polling is needed for this normal command.

#### INTPL — depth-cue a signed vector already in IR

**Encoding and count:** function `0x11`; raw `0x00080411` selects SF=1, LM=1. Nominal count: **8**. SF applies at both cue passes; the difference clamp forces LM=0, while final IR uses selected LM. Selectors are ignored.

INTPL reads signed IR1–IR3, D[9]–D[11], signed IR0 at D[8], signed far-color words C[21]–C[23], and RGBC's CODE byte at D[6]. Its starting terms are `IR lane×4096`, not RGB bytes. With SF=1 and no limiting, final MAC values interpolate from the original signed IR vector toward the far-color vector using IR0/4096. Source IR and far color therefore use the same scale; for a color output, byte×16 is the useful scale.

INTPL overwrites the three MAC and IR lanes, pushes one RGB color into D[20]–D[22], and replaces FLAG with both cue passes' arithmetic/clamp conditions and the final color-conversion conditions. The original IR input is consumed before these outputs are written. IR0 and MAC0 are unchanged.

Choose INTPL instead of DPCS when a previous arithmetic operation or direct IR writes already supply the desired starting values. RGBC's RGB bytes are ignored. It is not a generic interpolation that bypasses clamps: the signed temporary difference is limited to −32768…32767 before the coefficient product, and the output color still comes from shifted MAC values even if the final IR clamp changed the corresponding lane. See [Shared matrix and color stages](#shared-matrix-and-color-stages).

#### DCPL — modulate current channel gains and depth-cue the color

**Encoding and count:** function `0x29`; raw `0x00080429` selects SF=1, LM=1. Nominal count: **8**. SF applies at both cue passes; the temporary difference forces LM=0, and final IR uses selected LM. Selectors are ignored.

DCPL takes signed channel gains from IR1–IR3, D[9]–D[11], unsigned RGB bytes and CODE from RGBC, D[6], signed coefficient IR0 from D[8], and signed far-color words C[21]–C[23]. For each channel, `RGB byte×16×IR lane` is the starting term supplied directly to depth cue. No light matrix or color matrix is evaluated. With SF=1, an input gain of 4096 and coefficient zero preserve the base-color byte, provided the cue calculations remain in range.

The final cued values overwrite MAC1–MAC3 and IR1–IR3. One RGB color is pushed, and FLAG includes the cue-difference, final-result, and color-output conditions. IR0, MAC0, matrices, and geometric FIFOs are not changed.

Choose DCPL when the current IR lanes already are the desired color gains. Choose CDP if a color-matrix transformation remains necessary, or NCDS if the light transform is also required. Choose DPCS to cue RGBC directly without gain modulation. DCPL is not simply INTPL with the same numeric IR inputs: its starting terms include both the base byte and a factor of 16, rather than `IR×4096`. See the command-specific scaling in [Shared matrix and color stages](#shared-matrix-and-color-stages).

#### DPCT — depth-cue the three FIFO colors

**Encoding and count:** function `0x2a`; raw `0x0008042a` selects SF=1, LM=1. Nominal count: **17**. Both cue passes use SF; temporary differences force LM=0 and final IR uses selected LM. Selectors are ignored.

DPCT reads the RGB bytes of the three existing FIFO entries D[20]–D[22], signed IR0 at D[8], signed far color C[21]–C[23], and the CODE byte of RGBC, D[6]. Each consumed channel enters depth cue as `FIFO byte×65536`, exactly the source-byte scaling used by DPCS. It reads the then-current RGB0 and pushes a result three times, thereby consuming the three original colors in order.

Afterward RGB0, RGB1, and RGB2 contain the three cued colors in original order. MAC1–MAC3 and IR1–IR3 retain only the third cue result. FLAG collects arithmetic, temporary/final IR, and output-color conditions across all iterations. IR0, MAC0, and geometric FIFOs are unchanged.

Choose DPCT when colors are already in the FIFO, rather than reloading each into RGBC for DPCS. All three use the one programmed IR0 and far-color vector. The original FIFO CODE bytes are not preserved: every new CODE is copied from current RGBC. Thus DPCT is not an in-place per-word operation on all 32 bits. Its consumption and publication sequence is specified in [Shared matrix and color stages](#shared-matrix-and-color-stages).

#### SQR — square each current IR component

**Encoding and count:** function `0x28`; raw `0x00080028` selects SF=1, LM=0. Nominal count: **5**. SF and LM apply; selectors are ignored.

SQR reads the signed low halfwords of IR1–IR3, D[9]–D[11], and squares each independently. SF=0 retains the integer squares; SF=1 shifts each square right by 12. For Q12 inputs, SF=1 therefore returns Q12 squares. The command does not add the components, take a square root, or normalize a vector.

The three shifted results overwrite MAC1–MAC3, D[25]–D[27], and their clamped versions overwrite IR1–IR3. FLAG is replaced. SQR does not generate 44-bit MAC-overflow flags; out-of-range visible results still generate IR saturation. There is no color conversion, FIFO push, MAC0 result, or IR0 modification. The full squares remain available in the MAC words even when IR saturates, subject to the selected shift.

Choose SQR for componentwise products with the same operand on both sides, OP for cross-product components, or GPF when a common scalar must multiply three different components. Reading only the saturated IR output can lose large squares; select the output and scale needed by the following calculation. See [Direct arithmetic functions](#direct-arithmetic-functions) for the exact write path.

#### GPF — multiply three IR lanes by one scalar

**Encoding and count:** function `0x3d`; raw `0x0008043d` selects SF=1, LM=1. Nominal count: **5**. SF and LM apply; selectors are ignored.

GPF reads signed IR0 from D[8] and signed IR1–IR3 from D[9]–D[11]. It multiplies each lane by the same IR0, passes that product through the 44-bit MAC stage, and applies the selected shift and IR clamp. RGBC, D[6], supplies CODE only. With SF=1 and IR0 scaled by 4096, the final MAC has the original vector's scale; IR0=2048 gives a one-half product before integer truncation.

The command overwrites MAC1–MAC3 and IR1–IR3, pushes one color into D[20]–D[22], and replaces FLAG. Lane arithmetic, IR clamps, and the final MAC-based RGB conversion contribute their respective conditions. IR0 itself is unchanged, as are MAC0 and the geometric FIFOs.

Choose GPF for a fresh three-lane scalar product. Choose GPL to add that product to existing MAC words. GPF always performs the color push even if the cartridge intends to use only its numeric MAC/IR results, so do not rely on the prior RGB FIFO remaining intact. For color results the vector's output scale must be byte×16; other numeric scales still produce deterministic, possibly saturated RGB bytes. See [Direct arithmetic functions](#direct-arithmetic-functions).

#### GPL — add a scalar product to the visible MAC words

**Encoding and count:** function `0x3e`; raw `0x0008043e` selects SF=1, LM=1. Nominal count: **5**. SF and LM apply; selectors are ignored.

GPL reads signed IR0 at D[8], signed IR1–IR3 at D[9]–D[11], and the signed visible MAC1–MAC3 words at D[25]–D[27]. For each lane its unshifted sum is `IR0×IR lane + old MAC×4096` when SF=1, or `IR0×IR lane + old MAC` when SF=0. This sum passes through the 44-bit MAC stage, selected shift, visible-word wrap, and selected IR clamp. RGBC, D[6], supplies CODE only.

MAC1–MAC3 receive the resulting shifted sums, IR1–IR3 their clamped versions, and one resulting color is pushed. FLAG records lane overflow, IR saturation, and RGB-output saturation; IR0, MAC0, and the geometric FIFOs are unchanged. At SF=1, the old visible MAC is thus already in output scale, while the new scalar product is divided by 4096 before addition, subject to the specified integer arithmetic.

Choose GPL for accumulation and GPF when the previous MAC contribution must be discarded. GPL deliberately reads the visible 32-bit words, including words directly programmed by software; it does not recover an earlier full, unshifted accumulator. This distinction matters after a shifted or wrapped command. As with GPF, its color push occurs even when only numeric results are wanted. See [Direct arithmetic functions](#direct-arithmetic-functions).

#### VMAD3 — independent three-lane multiply-add

**Encoding and duration:** write `0x00000001` to PLUS COMMAND at `0x080103a4`. Bits 7:0 select VMAD3; bits 31:8 are retained but ignored. Normal SF, LM, and selectors have no meaning here. The duration is **five system cycles**, with pending publication indicated by PLUS CYCLES bit 31.

VMAD3 reads signed 16-bit addend X/Y from PLUS ADD_XY, Z from ADD_Z, multiplicand X/Y from MUL_XY, Z from MUL_Z, and the common signed low-halfword SCALAR. These are PLUS[0]–PLUS[4], at `0x08010384`–`0x08010394`. The upper halves of ADD_Z, MUL_Z, and SCALAR are not arithmetic inputs. Each lane computes `ASR(4096×addend + multiplicand×scalar,12)` and then clamps to −32768…32767. With a scalar scaled by 4096, addend, multiplicand, and result may all share the same chosen scale. There is no normal 44-bit MAC stage or selectable shift.

An accepted command samples the operands for one pending result set. Until the five-cycle deadline, RESULT_XY, RESULT_Z, and PLUS FLAG remain their previous published values. At publication the two result words and flag change together, and CYCLES changes from `0x80000005` to `0x00000005`; it is not a countdown. RESULT_XY packs signed X/Y halfwords. RESULT_Z stores signed Z in its low halfword with a zero upper halfword. Strict positive/negative lane saturation sets the corresponding PLUS flag and PLUS ERROR. No normal GTE register, normal FLAG, or FIFO is changed.

Choose VMAD3 for an independent `addend + scalar×multiplicand` vector calculation, especially when no RGB push is wanted. PLUS input writes while busy program the next command, not the pending calculation. Use a direct 32-bit CPU command store; it waits if PLUS is busy. A DMA command write is denied. No completion interrupt is generated. See [GTE_PLUS multiply-add](#gte_plus-multiply-add) for the exact arithmetic and the [publication timing](#plus-timed-publication-and-store-interlock) for admission rules.

Any other low-byte function is invalid: it schedules one cycle, retains the previous result words, and publishes PLUS FLAG `0x81000000`. It neither runs VMAD3 nor clears the old results. This is distinct from an unrecognized normal function, which performs no arithmetic, preserves normal FLAG and data/control state, and records a nominal count of zero.

## Timing and bus programming

### Normal commands: nominal cost and CPU cost

A normal COMMAND write performs the complete arithmetic operation during that
write. A following data/control read sees its results without polling. Normal
CYCLES records the last nominal command count; it has no busy bit and does not
count down. For example, RTPS reports 15, MVMVA reports 8, and RTPT reports 23.
These values do not cause waits of 15, 8 or 23 system cycles.

An admitted direct CPU word-store instruction has a two-system-cycle base cost,
whether it writes an ordinary operand word or normal COMMAND. Normal execution
does not add the reported GTE CYCLES count to that cost. Address and operand
preparation, subsequent result loads, and other CPU instructions have their own
costs. Thus a nominal command count must not be added as an automatic CPU stall
or converted into a guaranteed command execution time.

An unrecognized normal function performs no arithmetic, leaves normal FLAG
unchanged and reports zero CYCLES. The raw command word is still retained for
COMMAND readback. Zero CYCLES does not mean that the issuing CPU instruction
itself was free.

<a id="plus-timed-publication-and-store-interlock"></a>

### PLUS: timed publication and store interlock

PLUS measures its completion interval in system cycles. At the installed
33,868,800 Hz frequency:

| Interval | Time |
|---|---:|
| One system cycle | Approximately 29.526 ns |
| VMAD3 completion interval: five cycles | Approximately 147.628 ns |
| Invalid-command completion interval: one cycle | Approximately 29.526 ns |

An accepted command takes all operands from the current PLUS input words and
forms one pending result set. Before its completion deadline, RESULT_XY,
RESULT_Z and PLUS FLAG retain the previously published values. PLUS CYCLES reads
`0x80000005` for pending VMAD3 or `0x80000001` for a pending invalid command. The
low 31 bits retain the nominal interval; they are not the remaining time.

At or after the deadline, a PLUS read, accepted input/command write, or CPU
command-store readiness check observes completion: both results and PLUS FLAG
publish together, and busy clears. CYCLES then reads `0x00000005` or
`0x00000001`. A CPU store already waiting on PLUS COMMAND is released at the
completion deadline. Normal GTE accesses do not wait for or synchronize PLUS.

PLUS inputs may be rewritten while busy. Such writes prepare later work; they
do not modify the operands already taken by the pending command. There is no
input queue. Write the intended inputs before issuing each command. A direct
32-bit CPU store to PLUS COMMAND waits if busy, then issues the new command;
this interlock governs command acceptance, not the readout of an old result.
Read any result that must be retained before the next completion replaces it.

DMA cannot issue PLUS commands. A DMA write to PLUS COMMAND is denied even when
the unit is idle and changes neither the command nor its operands or results.
This restriction does not specify the DMA channel's completion or fault policy.

![PLUS command admission and result publication](figures/gte-plus-timing.svg)

### Register access and bus faults

Use aligned 32-bit word accesses to program the register windows. CPU word, U32,
F32 and F64 accesses require four-byte alignment; U16 requires two-byte
alignment. A CPU alignment rejection raises an address-error load or store
condition, records the bad address, and does not reach GTE.

At the mapped IO interface, halfword reads and writes, byte writes, and accesses
between word slots report `BUS_FAULT_UNALIGNED_IO`. Only a byte read at a
word-aligned address is supported; it returns the low eight bits of that
register's read value. A new mapped-memory bus fault raises the CPU
data-bus-error condition; a failed CPU load leaves its destination unchanged.
This is distinct from rejection by the CPU's initial alignment check.

F32 accesses interpret one raw word as floating-point bits; they do not select
floating-point GTE arithmetic. F64 accesses interpret two words, low word at A
followed by high word at A+4. They require four-byte, not eight-byte, alignment
and perform two ordered register-word accesses. A later fault does not undo an
earlier word's effects. Scalar-store readiness checks only A: an F64 store
starting at PLUS FLAG (`0x080103a0`) can reach PLUS COMMAND as its second word
without that address's store interlock. If PLUS is still busy and not due, that
command word is ignored, rather than waiting; if idle after synchronization, it
is accepted. Use a direct word store for the command protocol.

CPU word-sequence stores instead check every addressed IO word's readiness
before writing any sequence word. Once admitted, they write in increasing
four-byte addresses and stop at the first bus fault; earlier writes remain
effective. There is no GTE-specific user/supervisor or enable-bit prerequisite
in this mapped access protocol.

Saturation, arithmetic overflow and invalid commands use the flag behavior
described in the arithmetic and register sections; they are not alignment
faults. Writes documented as having no GTE effect do not become read-only bus
faults.

### Interrupts and reset

Neither normal completion nor PLUS completion signals a GTE interrupt. There
are no GTE interrupt-enable, pending or acknowledgement registers. PLUS
completion makes results visible and releases a waiting command store; it is
not an IRQ acknowledgement protocol.

Device reset clears all register words, accumulators and cycle counts to zero
and discards pending PLUS work. It also releases a CPU store waiting on PLUS
COMMAND. This release is not publication of the discarded result. There is no
separate mapped GTE reset register.

## Register reference

All addresses below are byte addresses. Each word occupies four bytes:

- `D[n] = 0x08010244 + 4n`, for `n=0`–`31`.
- `C[n] = 0x080102c4 + 4n`, for `n=0`–`31`.
- `PLUS[n] = 0x08010384 + 4n`, for `n=0`–`9`.

A register word is a raw 32-bit pattern. Signed interpretation occurs at the arithmetic input, not by changing the word's representation. In the tables, **low** means bits 15:0 and **high** means bits 31:16. Matrix rows and columns are numbered 0–2.

| Access notation | Read and mapped-write operation |
|---|---|
| RW | Read and write the complete word. |
| S16 | Writes sign-extend the low halfword; reads return that 32-bit word. |
| U16 | Writes keep only bits 15:0; reads return those bits with a zero upper halfword. |
| Push | Read the newest screen pair; write pushes a screen pair. |
| Derived | Read a computed word; see the entry for its write behavior. |
| Output | Read the result; a write has no GTE effect and does not fault as a read-only write. |

### Data words

<section class="register-entry">

#### D[0]–D[7] — vectors, input color, and depth average

<table class="bit-fields">
<thead><tr><th>Vector</th><th>31:16</th><th>15:0</th></tr></thead>
<tbody><tr><th>Field</th><td>Y, signed 16-bit</td><td>X, signed 16-bit</td></tr></tbody>
</table>

<table class="bit-fields">
<thead><tr><th>D[6]</th><th>31:24</th><th>23:16</th><th>15:8</th><th>7:0</th></tr></thead>
<tbody><tr><th>Field</th><td>CODE</td><td>Blue</td><td>Green</td><td>Red</td></tr></tbody>
</table>

| Word | Address | Function and fields | Access | Reset |
|---|---|---|---|---|
| D[0] | `0x08010244` | V0.X low / V0.Y high | RW | `0x00000000` |
| D[1] | `0x08010248` | V0.Z low; high is sign extension | S16 | `0x00000000` |
| D[2] | `0x0801024c` | V1.X low / V1.Y high | RW | `0x00000000` |
| D[3] | `0x08010250` | V1.Z low; high is sign extension | S16 | `0x00000000` |
| D[4] | `0x08010254` | V2.X low / V2.Y high | RW | `0x00000000` |
| D[5] | `0x08010258` | V2.Z low; high is sign extension | S16 | `0x00000000` |
| D[6] | `0x0801025c` | RGBC input: unsigned RGB bytes and CODE | RW | `0x00000000` |
| D[7] | `0x08010260` | Depth-average output, low unsigned 16-bit; high zero | U16 | `0x00000000` |

</section>

<section class="register-entry">

#### D[8]–D[15] — intermediate results and screen FIFO

<table class="bit-fields">
<thead><tr><th>IR</th><th>31:16</th><th>15:0</th></tr></thead>
<tbody><tr><th>Field</th><td>Sign extension</td><td>Signed intermediate result</td></tr></tbody>
</table>

<table class="bit-fields">
<thead><tr><th>Screen</th><th>31:16</th><th>15:0</th></tr></thead>
<tbody><tr><th>Field</th><td>SY, signed 16-bit</td><td>SX, signed 16-bit</td></tr></tbody>
</table>

| Word | Address | Function | Access | Reset |
|---|---|---|---|---|
| D[8] | `0x08010264` | IR0 | S16 | `0x00000000` |
| D[9] | `0x08010268` | IR1 | S16 | `0x00000000` |
| D[10] | `0x0801026c` | IR2 | S16 | `0x00000000` |
| D[11] | `0x08010270` | IR3 | S16 | `0x00000000` |
| D[12] | `0x08010274` | Screen FIFO pair SX0/SY0, oldest | RW | `0x00000000` |
| D[13] | `0x08010278` | Screen FIFO pair SX1/SY1 | RW | `0x00000000` |
| D[14] | `0x0801027c` | Screen FIFO pair SX2/SY2, newest | RW | `0x00000000` |
| D[15] | `0x08010280` | Screen read alias / push port | Push | `0x00000000` |

Reading D[15] returns D[14]. Writing a word `w` to D[15] performs `D[12]←old D[13]`, `D[13]←old D[14]`, `D[14]←w`. Writing D[12], D[13], or D[14] changes only that entry.

</section>

<section class="register-entry">

#### D[16]–D[23] — depth and color FIFOs

<table class="bit-fields">
<thead><tr><th>Depth</th><th>31:16</th><th>15:0</th></tr></thead>
<tbody><tr><th>Field</th><td>Zero</td><td>Unsigned depth</td></tr></tbody>
</table>

<table class="bit-fields">
<thead><tr><th>RGB</th><th>31:24</th><th>23:16</th><th>15:8</th><th>7:0</th></tr></thead>
<tbody><tr><th>Field</th><td>CODE</td><td>Blue</td><td>Green</td><td>Red</td></tr></tbody>
</table>

| Word | Address | Function | Access | Reset |
|---|---|---|---|---|
| D[16] | `0x08010284` | SZ0, oldest depth | U16 | `0x00000000` |
| D[17] | `0x08010288` | SZ1 | U16 | `0x00000000` |
| D[18] | `0x0801028c` | SZ2 | U16 | `0x00000000` |
| D[19] | `0x08010290` | SZ3, newest depth | U16 | `0x00000000` |
| D[20] | `0x08010294` | RGB0, oldest color | RW | `0x00000000` |
| D[21] | `0x08010298` | RGB1 | RW | `0x00000000` |
| D[22] | `0x0801029c` | RGB2, newest color | RW | `0x00000000` |
| D[23] | `0x080102a0` | Unassigned storage, bits 31:0 retained | RW | `0x00000000` |

Depth and color pushes are defined with the arithmetic stages below. Direct writes to these FIFO entries do not push the other entries.

</section>

<section class="register-entry">

#### D[24]–D[31] — MAC words, RGB5 conversion, and leading-sign count

<table class="bit-fields">
<thead><tr><th>RGB5</th><th>31:15</th><th>14:10</th><th>9:5</th><th>4:0</th></tr></thead>
<tbody><tr><th>Field</th><td>Zero</td><td>Blue</td><td>Green</td><td>Red</td></tr></tbody>
</table>

| Word | Address | Function and fields | Access | Reset |
|---|---|---|---|---|
| D[24] | `0x080102a4` | MAC0 visible word, bits 31:0 | RW | `0x00000000` |
| D[25] | `0x080102a8` | MAC1 visible word, bits 31:0 | RW | `0x00000000` |
| D[26] | `0x080102ac` | MAC2 visible word, bits 31:0 | RW | `0x00000000` |
| D[27] | `0x080102b0` | MAC3 visible word, bits 31:0 | RW | `0x00000000` |
| D[28] | `0x080102b4` | RGB5 input / packed IR output | Derived | `0x00000000` |
| D[29] | `0x080102b8` | Packed IR output alias | Derived | `0x00000000` |
| D[30] | `0x080102bc` | Leading-sign-bit source, bits 31:0 | RW | `0x00000000` |
| D[31] | `0x080102c0` | Leading-sign-bit count, bits 31:0 | Output | `0x00000000` |

Both D[28] and D[29] read `R | (G<<5) | (B<<10)`, where each channel is the corresponding signed IR1–IR3 value arithmetic-shifted right seven and clamped to 0–31. This read does not set flags. Writing D[28] takes bits 4:0, 9:5, and 14:10, multiplies each by 128, and writes IR1, IR2, and IR3 respectively; bits 31:15 do not contribute. Writing D[29] or D[31] has no GTE effect.

Writing D[30] also updates D[31] to the number of leading bits equal to bit 31: leading zeroes for a nonnegative source, or leading ones for a negative source. The result is 32 for both `0x00000000` and `0xffffffff`.

Direct MAC-word writes alter the visible words, not the full arithmetic accumulators. GPL explicitly uses these visible words as its old-MAC operands.

</section>

### Control words

For matrix selectors 0–2, nine signed 16-bit coefficients occupy five words in row-major order. The last coefficient is sign-extended on write. Each following three-word control vector contains signed 32-bit elements.

<div class="keep-together">

<table class="bit-fields">
<thead><tr><th>Matrix</th><th>31:16</th><th>15:0</th></tr></thead>
<tbody>
<tr><th>Base+0</th><td>m[0,1]</td><td>m[0,0]</td></tr>
<tr><th>Base+1</th><td>m[1,0]</td><td>m[0,2]</td></tr>
<tr><th>Base+2</th><td>m[1,2]</td><td>m[1,1]</td></tr>
<tr><th>Base+3</th><td>m[2,1]</td><td>m[2,0]</td></tr>
<tr><th>Base+4</th><td>Sign extension</td><td>m[2,2]</td></tr>
</tbody>
</table>

“Base +” in this layout counts control words, not bytes. The bases are C[0], C[8], and C[16].

</div>

<section class="register-entry">

#### C[0]–C[7] — rotation matrix and translation

| Word | Address | Function and fields | Access | Reset |
|---|---|---|---|---|
| C[0] | `0x080102c4` | Matrix 0: m[0,0] low / m[0,1] high | RW | `0x00000000` |
| C[1] | `0x080102c8` | Matrix 0: m[0,2] low / m[1,0] high | RW | `0x00000000` |
| C[2] | `0x080102cc` | Matrix 0: m[1,1] low / m[1,2] high | RW | `0x00000000` |
| C[3] | `0x080102d0` | Matrix 0: m[2,0] low / m[2,1] high | RW | `0x00000000` |
| C[4] | `0x080102d4` | Matrix 0: m[2,2] low | S16 | `0x00000000` |
| C[5] | `0x080102d8` | Control vector 0, X; signed bits 31:0 | RW | `0x00000000` |
| C[6] | `0x080102dc` | Control vector 0, Y; signed bits 31:0 | RW | `0x00000000` |
| C[7] | `0x080102e0` | Control vector 0, Z; signed bits 31:0 | RW | `0x00000000` |

Projection uses matrix 0 for rotation and control vector 0 for translation.

</section>

<section class="register-entry">

#### C[8]–C[15] — light matrix and control vector 1

| Word | Address | Function and fields | Access | Reset |
|---|---|---|---|---|
| C[8] | `0x080102e4` | Matrix 1: m[0,0] low / m[0,1] high | RW | `0x00000000` |
| C[9] | `0x080102e8` | Matrix 1: m[0,2] low / m[1,0] high | RW | `0x00000000` |
| C[10] | `0x080102ec` | Matrix 1: m[1,1] low / m[1,2] high | RW | `0x00000000` |
| C[11] | `0x080102f0` | Matrix 1: m[2,0] low / m[2,1] high | RW | `0x00000000` |
| C[12] | `0x080102f4` | Matrix 1: m[2,2] low | S16 | `0x00000000` |
| C[13] | `0x080102f8` | Control vector 1, X; signed bits 31:0 | RW | `0x00000000` |
| C[14] | `0x080102fc` | Control vector 1, Y; signed bits 31:0 | RW | `0x00000000` |
| C[15] | `0x08010300` | Control vector 1, Z; signed bits 31:0 | RW | `0x00000000` |

The lighting stage uses matrix 1. The color-matrix stage adds control vector 1.

</section>

<section class="register-entry">

#### C[16]–C[23] — color matrix and far-color vector

| Word | Address | Function and fields | Access | Reset |
|---|---|---|---|---|
| C[16] | `0x08010304` | Matrix 2: m[0,0] low / m[0,1] high | RW | `0x00000000` |
| C[17] | `0x08010308` | Matrix 2: m[0,2] low / m[1,0] high | RW | `0x00000000` |
| C[18] | `0x0801030c` | Matrix 2: m[1,1] low / m[1,2] high | RW | `0x00000000` |
| C[19] | `0x08010310` | Matrix 2: m[2,0] low / m[2,1] high | RW | `0x00000000` |
| C[20] | `0x08010314` | Matrix 2: m[2,2] low | S16 | `0x00000000` |
| C[21] | `0x08010318` | Control vector 2 / far red; signed bits 31:0 | RW | `0x00000000` |
| C[22] | `0x0801031c` | Control vector 2 / far green; signed bits 31:0 | RW | `0x00000000` |
| C[23] | `0x08010320` | Control vector 2 / far blue; signed bits 31:0 | RW | `0x00000000` |

</section>

<section class="register-entry">

#### C[24]–C[30] — projection and depth coefficients

<table class="bit-fields">
<thead><tr><th>Coeff.</th><th>31:16</th><th>15:0</th></tr></thead>
<tbody><tr><th>Field</th><td>Sign extension</td><td>Coefficient</td></tr></tbody>
</table>

| Word | Address | Function and fields | Access | Reset |
|---|---|---|---|---|
| C[24] | `0x08010324` | OFX, signed 32-bit screen X offset | RW | `0x00000000` |
| C[25] | `0x08010328` | OFY, signed 32-bit screen Y offset | RW | `0x00000000` |
| C[26] | `0x0801032c` | H, unsigned low 16-bit projection numerator | S16 | `0x00000000` |
| C[27] | `0x08010330` | DQA, signed low 16-bit depth-cue coefficient | S16 | `0x00000000` |
| C[28] | `0x08010334` | DQB, signed 32-bit depth-cue offset | RW | `0x00000000` |
| C[29] | `0x08010338` | ZSF3, signed low 16-bit depth scale | S16 | `0x00000000` |
| C[30] | `0x0801033c` | ZSF4, signed low 16-bit depth scale | S16 | `0x00000000` |

H has a deliberate read/datapath distinction: a write of `0x00008000` reads back as `0xffff8000`, but projection consumes the unsigned numerator 32768. OFX/OFY are added before the screen calculation's 16-bit right shift; DQB is added before the depth-cue calculation's 12-bit right shift.

</section>

<section class="register-entry">

<a id="c31--normal-flag"></a>

#### C[31] — normal FLAG

| Word | Address | Access | Reset |
|---|---|---|---|
| C[31] — FLAG | `0x08010340` | Read / masked write | `0x00000000` |

<table class="bit-fields">
<thead><tr><th>FLAG</th><th>31</th><th>30</th><th>29</th><th>28</th><th>27</th><th>26</th><th>25</th><th>24</th><th>23</th><th>22</th></tr></thead>
<tbody><tr><th>Field</th><td>ERROR</td><td>M1+</td><td>M2+</td><td>M3+</td><td>M1−</td><td>M2−</td><td>M3−</td><td>I1</td><td>I2</td><td>I3</td></tr></tbody>
</table>

<table class="bit-fields">
<thead><tr><th>FLAG</th><th>21</th><th>20</th><th>19</th><th>18</th><th>17</th><th>16</th><th>15</th><th>14</th><th>13</th><th>12</th><th>11:0</th></tr></thead>
<tbody><tr><th>Field</th><td>R</td><td>G</td><td>B</td><td>SZ</td><td>DIV</td><td>M0+</td><td>M0−</td><td>SX</td><td>SY</td><td>I0</td><td>Zero</td></tr></tbody>
</table>

M1–M3 indicate positive/negative 44-bit MAC overflow; I1–I3 indicate IR saturation. R/G/B indicate color-output saturation; SZ indicates depth or depth-average saturation; DIV indicates the projection divide overflow condition. M0+/M0− indicate signed 32-bit MAC0 overflow; SX/SY indicate screen-coordinate saturation; I0 indicates IR0 saturation. Exact arithmetic conditions are given with the stages below.

A write keeps `word & 0x7ffff000`, then sets ERROR if any bit selected by `0x7f87e000` is set. Bit 31 is therefore recomputed, not directly writable. Bits 11:0 read zero. This is not write-one-to-clear behavior.

Every recognized normal command clears FLAG before arithmetic and forms ERROR afterward. Triple operations accumulate flags across all three iterations. ERROR summarizes bits 30:23 and 18:13; IR3, color-channel, and IR0 saturation alone do not set ERROR. An unrecognized normal function leaves FLAG unchanged.

</section>

<section class="register-entry">

### Normal COMMAND and CYCLES

| Register | Address | Access | Reset |
|---|---|---|---|
| COMMAND | `0x08010344` | Write executes; read last raw command write | `0x00000000` |
| CYCLES | `0x08010348` | Read last nominal duration; write has no GTE effect | `0x00000000` |

<table class="bit-fields">
<thead><tr><th>COMMAND</th><th>31:20</th><th>19</th><th>18:17</th><th>16:15</th><th>14:13</th><th>12:11</th><th>10</th><th>9:6</th><th>5:0</th></tr></thead>
<tbody><tr><th>Field</th><td>Ignored</td><td>SF</td><td>mx</td><td>v</td><td>cv</td><td>Ignored</td><td>LM</td><td>Ignored</td><td>Function</td></tr></tbody>
</table>

<table class="bit-fields">
<thead><tr><th>CYCLES</th><th>31:0</th></tr></thead>
<tbody><tr><th>Field</th><td>Last normal-command nominal cycle count</td></tr></tbody>
</table>

Only MVMVA uses mx, v, and cv. SF selects a 12-bit result shift when one, or no shift when zero. LM selects the lower IR1–IR3 clamp bound: zero when one, −32768 when zero; the upper bound is always 32767. NCLIP, AVSZ3, and AVSZ4 use neither SF nor LM. Other bits are ignored for execution but remain in the COMMAND readback word.

An unknown function executes no arithmetic, leaves data/control and accumulator values unchanged, and sets normal CYCLES to zero. It still becomes the last COMMAND readback word.

</section>

### GTE_PLUS words

<section class="register-entry">

#### PLUS[0]–PLUS[4] — multiply-add operands

<table class="bit-fields">
<thead><tr><th>XY</th><th>31:16</th><th>15:0</th></tr></thead>
<tbody><tr><th>Field</th><td>Y, signed 16-bit</td><td>X, signed 16-bit</td></tr></tbody>
</table>

<table class="bit-fields">
<thead><tr><th>Z/scalar</th><th>31:16</th><th>15:0</th></tr></thead>
<tbody><tr><th>Field</th><td>Retained, ignored by VMAD3</td><td>Signed 16-bit operand</td></tr></tbody>
</table>

| Word / name | Address | Function | Access | Reset |
|---|---|---|---|---|
| PLUS[0] — ADD_XY | `0x08010384` | Addend X/Y | RW | `0x00000000` |
| PLUS[1] — ADD_Z | `0x08010388` | Addend Z | RW | `0x00000000` |
| PLUS[2] — MUL_XY | `0x0801038c` | Multiplicand X/Y | RW | `0x00000000` |
| PLUS[3] — MUL_Z | `0x08010390` | Multiplicand Z | RW | `0x00000000` |
| PLUS[4] — SCALAR | `0x08010394` | Shared scalar | RW | `0x00000000` |

</section>

<section class="register-entry">

#### PLUS[5]–PLUS[9] — published results and command status

| Word / name | Address | Access | Reset |
|---|---|---|---|
| PLUS[5] — RESULT_XY | `0x08010398` | Output | `0x00000000` |
| PLUS[6] — RESULT_Z | `0x0801039c` | Output | `0x00000000` |
| PLUS[7] — FLAG | `0x080103a0` | Output | `0x00000000` |
| PLUS[8] — COMMAND | `0x080103a4` | Read last accepted raw word; direct CPU word write starts when idle | `0x00000000` |
| PLUS[9] — CYCLES | `0x080103a8` | Output | `0x00000000` |

<table class="bit-fields">
<thead><tr><th>RESULT_XY</th><th>31:16</th><th>15:0</th></tr></thead>
<tbody><tr><th>Field</th><td>Result Y, signed 16-bit</td><td>Result X, signed 16-bit</td></tr></tbody>
</table>

<table class="bit-fields">
<thead><tr><th>RESULT_Z</th><th>31:16</th><th>15:0</th></tr></thead>
<tbody><tr><th>VMAD3</th><td>Zero</td><td>Result Z, signed 16-bit</td></tr></tbody>
</table>

<table class="bit-fields">
<thead><tr><th>COMMAND</th><th>31:8</th><th>7:0</th></tr></thead>
<tbody><tr><th>Field</th><td>Retained, ignored for selection</td><td>Function: 0x01 = VMAD3; all others invalid</td></tr></tbody>
</table>

<table class="bit-fields">
<thead><tr><th>CYCLES</th><th>31</th><th>30:0</th></tr></thead>
<tbody><tr><th>Field</th><td>Busy</td><td>Nominal duration: 5 for VMAD3; 1 for invalid command</td></tr></tbody>
</table>

Busy clears when the pending results and flag are published together. The nominal duration remains. RESULT_Z has a zero upper halfword even when its signed low-halfword result is negative.

</section>

<section class="register-entry">

#### PLUS FLAG fields

<table class="bit-fields">
<thead><tr><th>PLUS FLAG</th><th>31</th><th>30</th><th>29</th><th>28</th><th>27</th><th>26</th><th>25</th><th>24</th><th>23:0</th></tr></thead>
<tbody><tr><th>Field</th><td>ERROR</td><td>X+</td><td>Y+</td><td>Z+</td><td>X−</td><td>Y−</td><td>Z−</td><td>INVALID</td><td>Zero</td></tr></tbody>
</table>

These flags are independent of C[31]. A valid command starts with a pending flag word of zero; strict lane overflow or underflow sets the corresponding direction bit and ERROR. An invalid command publishes `0x81000000` (ERROR and INVALID) and preserves both previously published result words. It does not execute VMAD3 or raise an exception.

</section>

## Normal-command arithmetic

The following definitions specify the integer datapath. Multiplication and addition use mathematical integers except where a word wrap or explicit shift is specified. `s16lo` and `s16hi` interpret the low and high halfwords as signed; `u16lo` is the unsigned low halfword; `s32` interprets a complete word as signed. `U32(x)` keeps its low 32 bits as unsigned, while `W32(x)` keeps them as signed. `ASR(x,n)` divides by `2^n`, rounding toward negative infinity. `clamp(x,a,b)` limits x to the inclusive interval a–b.

Matrix rows r and columns c run from 0 to 2; MAC/IR lanes i run from 1 to 3. Row r produces lane `i=r+1`, writing MAC at D[25+r] and IR at D[9+r]. Control-vector and translation components `CV_r` and `TR_r` use X/Y/Z order. Lane-indexed color components use lane 1 for red, 2 for green, and 3 for blue.

<a id="mac-shift-and-ir-stages"></a>

### MAC, shift, and IR stages

The three main accumulators have the signed 44-bit range −2^43 to 2^43−1. Wrapping is not saturation:

```text
MIN44 = -0x80000000000       MAX44 = 0x7ffffffffff
W44(x) = x - 2^44  if x > MAX44
         x + 2^44  if x < MIN44
         x         otherwise
S(x)   = ASR(x,12) if SF=1; x if SF=0
```

`M_i(a,p,n)`, for lane i=1–3, retains the unshifted accumulator a and writes `D[24+i]=W32(S(a))`. It sets the lane's positive/negative MAC flags when p/n are true. Those flags also set ERROR. The return value is the signed visible MAC word, not a.

`M44_i(x)` first wraps x with W44 and then performs M_i, using `x>MAX44` and `x<MIN44` as its overflow conditions. Dot products instead use the following ordered accumulation; its flags cannot be replaced by checking only the final sum:

```text
A44(initial; b0,b1,b2):
  a = W44(initial)
  positive = (initial > MAX44); negative = (initial < MIN44)
  for b in b0,b1,b2, in that order:
    t = W44(a+b)
    positive |= (t<0 and a>=0 and b>=0)
    negative |= (t>=0 and a<0 and b<0)
    a = t
  deliver a and the accumulated positive/negative conditions to M_i
```

Thus cancellation after overflow does not erase its flag. The ordered wrap applies after the initial term and after each addend.

`I_i(q,LM)` clamps the signed visible MAC result q to −32768…32767 for LM=0 or 0…32767 for LM=1. A strictly out-of-range q sets that IR lane's saturation flag. Unless a stage explicitly says otherwise, this clamped value is written to D[9]–D[11]. The clamp consumes the shifted, 32-bit-wrapped word, not the full 44-bit value.

`M0(x)` retains full x and writes its low 32 bits to D[24]. It sets M0+ and ERROR for `x>2147483647`, or M0− and ERROR for `x<−2147483648`. Projection and depth-average calculations that follow M0 use full x, not the wrapped word.

<a id="operand-selection"></a>

### Operand selection

MVMVA's selectors have these complete encodings:

| Selector | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| mx | Matrix 0, C[0]–C[4] | Matrix 1, C[8]–C[12] | Matrix 2, C[16]–C[20] | Synthetic matrix below |
| v | V0, D[0]/D[1] | V1, D[2]/D[3] | V2, D[4]/D[5] | Current signed IR1–IR3 |
| cv | Signed C[5]–C[7] | Signed C[13]–C[15] | Signed C[21]–C[23] | (0,0,0) |

<div class="keep-together">

The synthetic matrix for mx=3 is defined, not rejected. With `r` the unsigned red byte of D[6], `a=s16lo(C[1])`, and `b=s16lo(C[2])`, it is:

```text
[ -16r   +16r   s16lo(D[8]) ]
[   a      a         a      ]
[   b      b         b      ]
```

</div>

For V0–V2, X and Y are the signed low/high halves of D[2v], and Z is the signed low half of D[2v+1]. IR0 is also signed at arithmetic inputs. RGBC color components are unsigned bytes.

<a id="shared-matrix-and-color-stages"></a>

### Shared matrix and color stages

The exact command calculations use these shared stages. Each stage uses the selected SF and LM, except for explicitly forced LM=0 clamps.

**Matrix stage.** Snapshot all three input components `(x,y,z)`. For each row r=0–2 of matrix m, let `i=r+1` and form `A44(4096×CV_r; m[r,0]×x, m[r,1]×y, m[r,2]×z)`. Write that lane's MAC through M_i and IR through I_i. All three row accumulations finish before any output IR is written. `L(v)` selects matrix 1, vector v, and a zero control vector. `K` selects matrix 2, the current IR vector, and control vector 1.

**MVMVA with cv=2.** This selection has a two-pass result. Snapshot x, y, and z. For each row r=0–2, let `i=r+1`. First compute `A44(4096×CV_r; m[r,0]×x,0,0)`, write MAC_i through M_i, and clamp IR_i with LM=0. Then compute `A44(0; m[r,1]×y,m[r,2]×z,0)`, overwriting that lane's MAC and IR using the selected LM. Flags from the first pass remain, but its control-vector and X contributions are absent from the final result. Other cv selections use the full matrix stage.

**Color application, CA.** For each lane, multiply the corresponding RGBC byte by 16 and by the current signed IR value. Pass that product through M44_i and I_i.

**Depth cue, DC(in).** Snapshot signed IR0 and use the signed far-color words C[21]–C[23]. First compute all three temporary differences, then all three final results:

```text
d_i  = I_i(M44_i(4096*far_i - in_i), LM=0)
IR_i = I_i(M44_i(in_i + IR0*d_i), selected LM)
```

The temporary differences update MAC and flags but not the IR register words. Both passes use the selected SF, including the first pass. The command's specified input scaling is part of the operation; do not substitute an unscaled color.

**Color FIFO push, P.** For each lane, take `ASR(s32(D[24+i]),4)` and clamp it to 0–255, setting the corresponding R/G/B saturation bit if outside that range. Shift D[20]←old D[21], D[21]←old D[22], then pack the new RGB bytes into D[22]. Its CODE byte always comes from current D[6], including DPCT; it never comes from the consumed FIFO color.

<a id="direct-arithmetic-functions"></a>

### Direct arithmetic functions

OP snapshots signed IR values `(u1,u2,u3)` and the signed rotation diagonal `(d1,d2,d3)=(m[0,0],m[1,1],m[2,2])` from matrix 0. Its three inputs to M_i are:

```text
lane 1: d2*u3 - d3*u2
lane 2: d3*u1 - d1*u3
lane 3: d1*u2 - d2*u1
```

SQR snapshots signed IR1–IR3 and supplies each square to M_i. OP and SQR do not supply MAC-overflow conditions; they still apply the selected shift, visible-word wrap, and IR clamp.

GPF supplies `IR0×IR_i` to M44_i. GPL instead supplies `IR0×IR_i + s32(D[24+i])×2^(12×SF)`. Both use signed IR operands, clamp the resulting IR values with LM, then perform P. GPL's old-MAC operand is the visible word, including a directly programmed MAC word.

<div class="keep-together">

NCLIP uses signed halves of the three screen FIFO words and performs:

```text
M0(sx0*sy1 + sx1*sy2 + sx2*sy0
 - sx0*sy2 - sx1*sy0 - sx2*sy1)
```

</div>

It does not push a FIFO. AVSZ3 and AVSZ4 multiply their unsigned depth sum by signed ZSF3 or ZSF4 respectively. For the full product x, they perform M0(x) and write `D[7]=clamp(ASR(x,12),0,65535)`. A depth clamp sets SZ and ERROR. This output uses full x, not the wrapped MAC0 word.

<a id="projection-stage-rtv-last"></a>

## Projection stage RT(v, last)

RTPS projects V0 with `last=true`. RTPT projects V0, V1, and V2 in order, setting last only for V2. The following sequence applies to each vector.

### Rotation, intermediate results, and depth

For each rotation row r=0–2, let `i=r+1` and accumulate `A44(4096×TR_r; m[r,0]×vx,m[r,1]×vy,m[r,2]×vz)` with matrix 0 and translation C[5]–C[7], then write lane i through M_i. IR1 and IR2 use the normal selected-LM clamp of the visible MAC result.

IR3 has a different flag test. Its output is the visible signed MAC3 clamped according to LM, but its saturation flag tests `ASR(full MAC3,12)` against −32768…32767, independently of SF and LM. Consequently an LM=1 clamp of a negative value need not set I3; with SF=0, IR3 can clamp while its fixed-12 flag test remains in range.

Push depth `clamp(ASR(full MAC3,12),0,65535)`: D[16]←old D[17], D[17]←old D[18], D[18]←old D[19], D[19]←new depth. An out-of-range depth sets SZ and ERROR. The depth shift is always 12, regardless of SF.

### Reciprocal divide

The projection factor q is produced by the seed-ROM calculation below, not by substituting a general H/SZ division. Let `n=u16lo(C[26])` and `d=u16lo(D[19])`. If `n>=2d`, including d=0, set DIV and ERROR and use `q=0x1ffff`.

<div class="keep-together">

Otherwise d is nonzero. `CLZ16(d)` counts leading zeroes in its 16-bit representation, and T is the exact byte table in the appendix:

```text
s          = CLZ16(d)
r1         = (d << s) & 0x7fff
r2         = T[(r1 + 0x40) >> 7] + 0x101
r3         = (U32(0x80 - r2*(r1 + 0x8000)) >> 8) & 0x1ffff
reciprocal = (r2*r3 + 0x80) >> 8
rawq       = (reciprocal*(n << s) + 0x8000) >> 16
q          = min(rawq,0x1ffff)
```

</div>

The shift after U32 is unsigned; the other divide shifts act on nonnegative integers. The final multiply uses the full integer product before shifting. A rawq clamp in this valid branch does not set DIV.

<div class="keep-together">

### Screen coordinates and last-vertex depth cue

Shift the screen FIFO's older entries, then calculate X and Y in this order:

```text
D[12] = old D[13]; D[13] = old D[14]
M0(OFX + signed IR1*q)
sx = clamp(ASR(full MAC0,16),-1024,1023)
M0(OFY + signed IR2*q)
sy = clamp(ASR(full MAC0,16),-1024,1023)
D[14] = (sx & 0xffff) | ((sy & 0xffff) << 16)
```

</div>

An out-of-range coordinate sets SX or SY and ERROR. Saturated coordinates are still pushed; projection does not reject or clip the vertex.

Only for the last vertex, calculate `M0(DQB+DQA×q)` and then `IR0=clamp(ASR(full MAC0,12),0,4096)`. A strict IR0 clamp sets I0. DQA is signed low 16-bit; DQB is signed 32-bit. Thus RTPT computes IR0 only for its third vertex, and its final visible MAC0 word is that last depth-cue result, not a screen-coordinate product.

<a id="gte_plus-multiply-add"></a>

## GTE_PLUS multiply-add

VMAD3 selects three signed addends, three signed multiplicands, and one signed scalar from PLUS[0]–PLUS[4]. For each lane i:

```text
t_i      = ASR(4096*addend_i + multiplicand_i*scalar,12)
result_i = clamp(t_i,-32768,32767)
```

There is no rounding bias, intermediate saturation, or 44-bit MAC stage. The pre-shift expression fits the signed 32-bit range for these operands. A strict `t_i>32767` sets the lane's positive flag; a strict `t_i<−32768` sets its negative flag. Either also sets PLUS ERROR.

The accepted command retains its full raw word, but selection uses only bits 7:0. VMAD3 is `0x01`; all other values are invalid. PLUS does not decode the normal SF, LM, or matrix/vector selectors. Its result, flag, and cycle words are independent of every normal GTE result and FIFO.

## PLUS programming example

<div class="keep-together">

### Three-lane multiply-add with delayed publication

Start from device reset. Use signed integers scaled by 4096: addend (1,2,3), multiplicand (2,1,−1), and scalar 1/2. Perform the following aligned 32-bit writes in order:

| Order | Address | Register | Raw word |
|---:|---|---|---|
| 1 | `0x08010384` | PLUS ADD_XY | `0x20001000` |
| 2 | `0x08010388` | PLUS ADD_Z | `0x00003000` |
| 3 | `0x0801038c` | PLUS MUL_XY | `0x10002000` |
| 4 | `0x08010390` | PLUS MUL_Z | `0x0000f000` |
| 5 | `0x08010394` | PLUS SCALAR | `0x00000800` |
| 6 | `0x080103a4` | PLUS COMMAND — VMAD3 | `0x00000001` |

</div>

<div class="keep-together">

The lane integers are (8192,10240,10240), representing (2,2.5,2.5). Before the five-cycle completion deadline, PLUS CYCLES at `0x080103a8` is `0x80000005`; the result and flag words still read their reset values. At publication:

| Address | Register | Raw result |
|---|---|---|
| `0x08010398` | RESULT_XY | `0x28002000` |
| `0x0801039c` | RESULT_Z | `0x00002800` |
| `0x080103a0` | FLAG | `0x00000000` |
| `0x080103a8` | CYCLES | `0x00000005` |

</div>

Software can poll busy until it clears, or issue the next direct CPU word store to PLUS COMMAND and let the store interlock wait. No GTE interrupt is generated. The normal GTE words and flags remain unchanged.

<section class="keep-together">

## Appendix: reciprocal seed ROM

T contains 257 unsigned bytes. These are hexadecimal table indices, not mapped addresses. Each row gives sixteen consecutive values; the singleton index 100 follows the 00–FF range.

| Index | +0 | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 | +a | +b | +c | +d | +e | +f |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `00` | `ff` | `fd` | `fb` | `f9` | `f7` | `f5` | `f3` | `f1` | `ef` | `ee` | `ec` | `ea` | `e8` | `e6` | `e4` | `e3` |
| `10` | `e1` | `df` | `dd` | `dc` | `da` | `d8` | `d6` | `d5` | `d3` | `d1` | `d0` | `ce` | `cd` | `cb` | `c9` | `c8` |
| `20` | `c6` | `c5` | `c3` | `c1` | `c0` | `be` | `bd` | `bb` | `ba` | `b8` | `b7` | `b5` | `b4` | `b2` | `b1` | `b0` |
| `30` | `ae` | `ad` | `ab` | `aa` | `a9` | `a7` | `a6` | `a4` | `a3` | `a2` | `a0` | `9f` | `9e` | `9c` | `9b` | `9a` |
| `40` | `99` | `97` | `96` | `95` | `94` | `92` | `91` | `90` | `8f` | `8d` | `8c` | `8b` | `8a` | `89` | `87` | `86` |
| `50` | `85` | `84` | `83` | `82` | `81` | `7f` | `7e` | `7d` | `7c` | `7b` | `7a` | `79` | `78` | `77` | `75` | `74` |
| `60` | `73` | `72` | `71` | `70` | `6f` | `6e` | `6d` | `6c` | `6b` | `6a` | `69` | `68` | `67` | `66` | `65` | `64` |
| `70` | `63` | `62` | `61` | `60` | `5f` | `5e` | `5d` | `5d` | `5c` | `5b` | `5a` | `59` | `58` | `57` | `56` | `55` |
| `80` | `54` | `53` | `53` | `52` | `51` | `50` | `4f` | `4e` | `4d` | `4d` | `4c` | `4b` | `4a` | `49` | `48` | `48` |
| `90` | `47` | `46` | `45` | `44` | `43` | `43` | `42` | `41` | `40` | `3f` | `3f` | `3e` | `3d` | `3c` | `3c` | `3b` |
| `a0` | `3a` | `39` | `39` | `38` | `37` | `36` | `36` | `35` | `34` | `33` | `33` | `32` | `31` | `31` | `30` | `2f` |
| `b0` | `2e` | `2e` | `2d` | `2c` | `2c` | `2b` | `2a` | `2a` | `29` | `28` | `28` | `27` | `26` | `26` | `25` | `24` |
| `c0` | `24` | `23` | `22` | `22` | `21` | `20` | `20` | `1f` | `1e` | `1e` | `1d` | `1d` | `1c` | `1b` | `1b` | `1a` |
| `d0` | `19` | `19` | `18` | `18` | `17` | `16` | `16` | `15` | `15` | `14` | `14` | `13` | `12` | `12` | `11` | `11` |
| `e0` | `10` | `0f` | `0f` | `0e` | `0e` | `0d` | `0d` | `0c` | `0c` | `0b` | `0a` | `0a` | `09` | `09` | `08` | `08` |
| `f0` | `07` | `07` | `06` | `06` | `05` | `05` | `04` | `04` | `03` | `03` | `02` | `02` | `01` | `01` | `00` | `00` |

| Index | Value |
|---|---|
| `100` | `00` |

</section>
