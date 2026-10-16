# Geometry Engine (GTE)

## Function and data flow

The Geometry Engine is a register-programmed integer arithmetic unit. It transforms and projects vectors, performs lighting and color calculations, computes a signed screen-space area, and forms depth averages. Its normal command path operates on 32 data words, `D[0]`–`D[31]`, and 32 control words, `C[0]`–`C[31]`. GTE_PLUS provides a separate three-lane multiply-add path with ten words of its own.

Program vectors, matrices, coefficients, and colors, then write a command word. Normal results appear in the data registers and in the screen, depth, and color FIFOs. These FIFOs are register histories: arithmetic commands push results into them; they are not command queues. Software may also write their entries directly.

GTE is separate from GEO and GPU. A GTE command does not draw, write VRAM or a framebuffer, transfer GEO scratch memory, or submit a graphics packet. Software passes the arithmetic results onward as required.

![GTE register and arithmetic paths](figures/gte-overview.svg)

### Result visibility and timing

A normal `COMMAND` write completes its arithmetic during that write. The next data/control read sees the results. Normal `CYCLES` records the command's nominal cycle count; it is neither a busy indicator nor a countdown. There is no normal-command completion wait represented by this word.

GTE_PLUS has a different protocol. An accepted command takes its operands from the current PLUS input words and computes one pending result set. VMAD3 publishes that set after five system cycles; an invalid command publishes after one. Until publication, the result words and PLUS `FLAG` retain their previously published values. PLUS `CYCLES` bit 31 indicates pending work, while bits 30:0 retain the nominal duration rather than counting down.

PLUS input writes are allowed while busy. They affect a subsequent command, not the result already pending. There is no input queue. A direct 32-bit CPU store to PLUS `COMMAND` while busy waits until completion and is then allowed to proceed. This store interlock is distinct from result publication. PLUS reads and accepted input/command writes observe any completion whose deadline has been reached; a waiting CPU command store is released at that deadline. Normal GTE accesses neither wait for nor synchronize PLUS.

DMA writes cannot start PLUS commands: a DMA write to PLUS `COMMAND` is denied, even when idle, and changes neither the command nor its operands or results. This restriction does not describe a DMA channel's completion policy.

![PLUS command admission and result publication](figures/gte-plus-timing.svg)

### Register access and bus faults

Use aligned 32-bit word accesses to program the register windows. CPU word, U32, F32, and F64 accesses require four-byte alignment; U16 requires two-byte alignment. A CPU alignment rejection raises an address-error load or store condition, records the bad address, and does not reach GTE.

At the mapped IO interface, halfword reads and writes, byte writes, and accesses between word slots report `BUS_FAULT_UNALIGNED_IO`. Only a byte read at a word-aligned address is supported; it returns the low eight bits of that register's read value. A new mapped-memory bus fault raises the CPU data-bus-error condition; a failed CPU load leaves its destination unchanged. This is distinct from rejection by the CPU's initial alignment check.

F32 accesses interpret one raw word as floating-point bits; they do not select floating-point GTE arithmetic. F64 accesses interpret two words, low word at A followed by high word at A+4. They require four-byte, not eight-byte, alignment and perform two ordered register-word accesses. A later fault does not undo an earlier word's effects. Scalar-store readiness checks only A: an F64 store starting at PLUS FLAG (`0x080103a0`) can reach PLUS COMMAND as its second word without that address's store interlock. If PLUS is still busy and not due, that command word is ignored, rather than waiting; if idle after synchronization, it is accepted. Use a direct word store for the command protocol.

CPU word-sequence stores instead check every addressed IO word's readiness before writing any sequence word. Once admitted, they write in increasing four-byte addresses and stop at the first bus fault; earlier writes remain effective. There is no GTE-specific user/supervisor or enable-bit prerequisite in this mapped access protocol.

Saturation, arithmetic overflow, and invalid commands use the flag behavior described below; they are not alignment faults. Writes documented as having no GTE effect do not become read-only bus faults.

### Interrupts

Neither normal completion nor PLUS completion signals a GTE interrupt. There are no GTE interrupt-enable, pending, or acknowledgement registers. PLUS completion makes results visible and releases a waiting command store; it is not an IRQ acknowledgement protocol.

### Reset

Device reset clears every register word in this chapter to `0x00000000`, clears the arithmetic accumulators and cycle counts, and discards pending PLUS work. It also releases a CPU store waiting on PLUS `COMMAND`. There is no separate mapped GTE reset register.

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

### Shared matrix and color stages

The command tables use these stage names. Each stage uses the selected SF and LM, except for explicitly forced LM=0 clamps.

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

<section class="keep-together">

### Function selection and nominal cycles

Every row below also writes normal FLAG. **MI** means MAC1–MAC3 and IR1–IR3. **Screen push** means a new packed SX/SY pair enters D[12]–D[14]; **depth push** means a new SZ enters D[16]–D[19]. Each triple command leaves MI from its third iteration and accumulates flags across all iterations. “rgb” without a FIFO qualifier means the unsigned RGB bytes of D[6].

| Function | Code | Cycles | Inputs and stage order | Outputs besides FLAG |
|---|---|---:|---|---|
| RTPS | `0x01` | 15 | RT(V0, last) | MI, MAC0, IR0; one depth and screen push |
| NCLIP | `0x06` | 8 | Signed area of the three screen FIFO pairs | MAC0 |
| OP | `0x0c` | 6 | Rotation diagonal crossed with current IR | MI |
| DPCS | `0x10` | 8 | DC(rgb × 65536); P | MI; one color push |
| INTPL | `0x11` | 8 | DC(IR × 4096); P | MI; one color push |
| MVMVA | `0x12` | 8 | Selected matrix, vector, control vector | MI |

</section>

| Function | Code | Cycles | Inputs and stage order | Outputs besides FLAG |
|---|---|---:|---|---|
| NCDS | `0x13` | 19 | L(V0); K; DC(rgb × 16 × IR); P | MI; one color push |
| CDP | `0x14` | 13 | K; DC(rgb × 16 × IR); P | MI; one color push |
| NCDT | `0x16` | 44 | NCDS stages for V0, V1, V2, in order | MI; three color pushes |
| NCCS | `0x1b` | 17 | L(V0); K; CA; P | MI; one color push |
| CC | `0x1c` | 11 | K; CA; P | MI; one color push |
| NCS | `0x1e` | 14 | L(V0); K; P | MI; one color push |
| NCT | `0x20` | 30 | NCS stages for V0, V1, V2, in order | MI; three color pushes |

| Function | Code | Cycles | Inputs and stage order | Outputs besides FLAG |
|---|---|---:|---|---|
| SQR | `0x28` | 5 | Square each current signed IR lane | MI |
| DCPL | `0x29` | 8 | DC(rgb × 16 × IR); P | MI; one color push |
| DPCT | `0x2a` | 17 | Three times: DC(current RGB0.rgb × 65536); P | MI; three color pushes |
| AVSZ3 | `0x2d` | 5 | ZSF3 × (SZ1+SZ2+SZ3) | MAC0, D[7] |
| AVSZ4 | `0x2e` | 6 | ZSF4 × (SZ0+SZ1+SZ2+SZ3) | MAC0, D[7] |
| RTPT | `0x30` | 23 | RT(V0); RT(V1); RT(V2, last) | MI, MAC0, IR0; three depth and screen pushes |
| GPF | `0x3d` | 5 | Current IR0 × IR; P | MI; one color push |
| GPL | `0x3e` | 5 | Current IR0 × IR + scaled visible MAC; P | MI; one color push |
| NCCT | `0x3f` | 39 | NCCS stages for V0, V1, V2, in order | MI; three color pushes |

DPCT reads the then-current RGB0 on each iteration. Since P shifts the FIFO, the three original color entries are consumed in order. All three produced CODE bytes come from RGBC.

### Direct arithmetic functions

OP snapshots signed IR values `(u1,u2,u3)` and the signed rotation diagonal `(d1,d2,d3)=(m[0,0],m[1,1],m[2,2])` from matrix 0. Its three inputs to M_i are:

```text
lane 1: d2*u3 - d3*u2
lane 2: d3*u1 - d1*u3
lane 3: d1*u2 - d2*u1
```

SQR snapshots signed IR1–IR3 and supplies each square to M_i. OP and SQR do not supply MAC-overflow conditions; they still apply the selected shift, visible-word wrap, and IR clamp.

GPF supplies `IR0×IR_i` to M44_i. GPL instead supplies `IR0×IR_i + s32(D[24+i])×2^(12×SF)`. Both use signed IR operands, clamp the resulting IR values with LM, then perform P. GPL's old-MAC operand is the visible word, including a directly programmed MAC word.

NCLIP uses signed halves of the three screen FIFO words and performs:

```text
M0(sx0*sy1 + sx1*sy2 + sx2*sy0
 - sx0*sy2 - sx1*sy0 - sx2*sy1)
```

It does not push a FIFO. AVSZ3 and AVSZ4 multiply their unsigned depth sum by signed ZSF3 or ZSF4 respectively. For the full product x, they perform M0(x) and write `D[7]=clamp(ASR(x,12),0,65535)`. A depth clamp sets SZ and ERROR. This output uses full x, not the wrapped MAC0 word.

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

An out-of-range coordinate sets SX or SY and ERROR. Saturated coordinates are still pushed; projection does not reject or clip the vertex.

Only for the last vertex, calculate `M0(DQB+DQA×q)` and then `IR0=clamp(ASR(full MAC0,12),0,4096)`. A strict IR0 clamp sets I0. DQA is signed low 16-bit; DQB is signed 32-bit. Thus RTPT computes IR0 only for its third vertex, and its final visible MAC0 word is that last depth-cue result, not a screen-coordinate product.

## GTE_PLUS multiply-add

VMAD3 selects three signed addends, three signed multiplicands, and one signed scalar from PLUS[0]–PLUS[4]. For each lane i:

```text
t_i      = ASR(4096*addend_i + multiplicand_i*scalar,12)
result_i = clamp(t_i,-32768,32767)
```

There is no rounding bias, intermediate saturation, or 44-bit MAC stage. The pre-shift expression fits the signed 32-bit range for these operands. A strict `t_i>32767` sets the lane's positive flag; a strict `t_i<−32768` sets its negative flag. Either also sets PLUS ERROR.

The accepted command retains its full raw word, but selection uses only bits 7:0. VMAD3 is `0x01`; all other values are invalid. PLUS does not decode the normal SF, LM, or matrix/vector selectors. Its result, flag, and cycle words are independent of every normal GTE result and FIFO.

## Programming examples

<div class="keep-together">

### Project an integer vector

Start from device reset. Translation, offsets, depth-cue constants, all FIFOs, and FLAG are therefore zero. Program a rotation diagonal of 4096, H=256, and V0=(64,32,512). Perform these aligned 32-bit writes in order:

| Order | Address | Register | Raw word |
|---:|---|---|---|
| 1 | `0x080102c4` | C[0] | `0x00001000` |
| 2 | `0x080102cc` | C[2] | `0x00001000` |
| 3 | `0x080102d4` | C[4] | `0x00001000` |
| 4 | `0x0801032c` | C[26] — H | `0x00000100` |
| 5 | `0x08010244` | D[0] — V0.X/Y | `0x00200040` |
| 6 | `0x08010248` | D[1] — V0.Z | `0x00000200` |
| 7 | `0x08010344` | COMMAND — RTPS, SF=1, LM=0 | `0x00080001` |

</div>

The rotation sums are (262144,131072,2097152). SF=1 yields MAC and IR (64,32,512), and the fixed-12 depth is 512. The divide has `s=6`, `r1=0`, `T[0]=255`, `r2=512`, `r3=65536`, `reciprocal=131072`, and q=32768. The screen pair is therefore (32,16).

Immediately after the command write, reads give:

| Address(es) | Register(s) | Raw result(s) |
|---|---|---|
| `0x08010268`, `0x0801026c`, `0x08010270` | IR1–IR3 | `0x00000040`, `0x00000020`, `0x00000200` |
| `0x080102a8`, `0x080102ac`, `0x080102b0` | MAC1–MAC3 | `0x00000040`, `0x00000020`, `0x00000200` |
| `0x08010284`–`0x0801028c` | SZ0–SZ2 | All zero |
| `0x08010290` | SZ3 | `0x00000200` |
| `0x08010274`, `0x08010278` | Screen pairs 0–1 | Both zero |
| `0x0801027c` | Screen pair 2 | `0x00100020` |
| `0x080102a4`, `0x08010264`, `0x08010340` | MAC0, IR0, FLAG | All zero |
| `0x08010348` | CYCLES | `0x0000000f` |

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

The lane integers are (8192,10240,10240), representing (2,2.5,2.5). Before the five-cycle completion deadline, PLUS CYCLES at `0x080103a8` is `0x80000005`; the result and flag words still read their reset values. At publication:

| Address | Register | Raw result |
|---|---|---|
| `0x08010398` | RESULT_XY | `0x28002000` |
| `0x0801039c` | RESULT_Z | `0x00002800` |
| `0x080103a0` | FLAG | `0x00000000` |
| `0x080103a8` | CYCLES | `0x00000005` |

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
