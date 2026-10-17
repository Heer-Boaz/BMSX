# Geometry batch unit

GEO reads addressed records, performs a selected two-dimensional geometry
operation and writes results to main RAM. One command captures a job's
addresses, counts, parameters and strides; it does not copy the operands.
The three commands serve different data formats and tasks:

| Command word | Operation | Coordinate representation | One outer record |
|---|---|---|---|
| 00000020H | XFORM2_BATCH | Signed Q16.16 | Transform a vertex span; optionally write its bounds |
| 00000021H | SAT2_BATCH | Signed Q16.16 | Test one supplied convex-polygon pair |
| 00000022H | OVERLAP2D_PASS | Binary32 | Test one candidate pair, or one full-pass outer instance |

GEO is not the GTE register arithmetic path and is not a rasterizer. Its RAM
vertices and collision results are not GP0 packets or displayed pixels. Use the
[GTE chapter](gte.md) for that unit's arithmetic and projection interface and
the [GPU chapter](gpu.md) when submitting drawing commands. In particular,
OVERLAP2D's binary32 vertices cannot be substituted for the Q16.16 words read
by XFORM2 or SAT2 merely because both occupy one word per component.

## Installed resources

| Resource | Specification |
|---|---|
| Programmed bank | Sixteen 32-bit words, 64 bytes, at 08000024H…08000060H |
| Local fault acknowledgement | Separate word at 08010224H; not the next bank word |
| Active job capacity | One captured job; no command FIFO |
| COUNT / PROCESSED | Full unsigned 32-bit outer-record counts |
| XFORM2 span / SAT2 polygon | At most 64 vertices |
| OVERLAP2D polygon / clipping workspace | At most 64 input vertices / 128 clipping vertices |
| Installed main RAM | 4 MiB; addressed operand and result storage, not a private GEO payload buffer |
| Assigned GEO workspace | 512 KiB of main RAM at 08040000H…080bffffH; not an automatic operand destination |
| System-cycle timebase | 33,868,800 cycles/s |
| GEO work-credit rate | 16,384,000 outer-record units/s; not a vertex, pair or memory-byte bandwidth rating |

The job's addresses select the actual buffers. The assigned workspace is part
of main RAM; the controller does not replace a supplied address with its base.
The complete program below instead uses explicitly declared BSS buffers.
Operation-specific record sizes and limits follow in the command reference.

![GEO captured configuration and live operand paths](figures/geo-job.svg)

The upper path captures configuration. The lower path reads current operands
at record service and writes RAM results; capturing an address does not capture
its contents. This shows the normal nonzero-job path, not an electrical bus or
a cycle waveform. OVERLAP2D additionally clears its summary at command
acceptance, and zero-count completion does not pass through record service.

## Launching and observing a job

A write to `CMD` is the launch doorbell. Writing the source, destination, count, parameter, or stride registers only changes the programmed register words; it does not begin processing. Submit a job in this order:

1. Read `STATUS`. Do not write `CMD` while `BUSY` is set: that write terminates the running job rather than waiting for it.
2. If `ERROR` or `REJECTED` is set, inspect `FAULT` and `PROCESSED`, then acknowledge the local fault before submitting another job.
3. Prepare the command's records and payloads in memory. Program every register required by that command, including `COUNT`.
4. Write the complete command word to `CMD` once.
5. Observe `STATUS`, or use the central GEO interrupt sources. Read `PROCESSED` and `FAULT` to distinguish successful completion, execution failure, and rejection.

There is one active job and no command queue. `DONE` does not require a local acknowledgement before the next launch. An accepted launch clears the previous `STATUS`, `PROCESSED`, and `FAULT` before proceeding.

| State before the `CMD` write | Effect of the write |
|---|---|
| Idle or `DONE` | A supported complete command word starts a new job. Any other command word produces `REJECT_BAD_CMD`. |
| `BUSY` | The active job is discarded and `REJECT_BUSY` is reported. The new command is not launched. |
| `ERROR` or `REJECTED` | No new job is launched. The first fault, status, and progress remain unchanged until local fault acknowledgement. |

Every `CMD` write changes its raw readback, including a write ignored because a fault is still latched. Reading `CMD` therefore identifies the last word written, not necessarily the command that produced the current result. The supported complete words are `XFORM2_BATCH = 0x20`, `SAT2_BATCH = 0x21`, and `OVERLAP2D_PASS = 0x22`. These are whole-word encodings, not independent command bits. Extra set bits do not retain the meaning of a supported command.

### Captured operands and live memory

At launch, GEO captures `CMD`, all three source words, both destination words, `COUNT`, both parameter words, and all three stride words. Subsequent writes to these registers change their readback and the configuration available to a later launch. They do not redirect or resize the active job. In particular, reading `COUNT` during processing returns the programmed word, which may differ from the count captured by that job; use `PROCESSED` for published progress.

Launch does not capture the payload bytes. Records and their referenced data are read from memory as processing reaches them. Keep an active job's input memory stable when a consistent batch is required. Changing a register and changing the memory addressed by a captured register are different actions: only the latter can change data still to be read by that job.

Command acceptance checks the complete opcode, not the record pointers, strides, parameters, alignment, flags, or payload shape. Those checks belong to the selected operation when it processes a record. A supported command with `COUNT = 0` completes immediately without processing a record; it is not a way to validate a record layout or payload. An unsupported command is still rejected when `COUNT = 0`.

`OVERLAP2D_PASS` has a launch side effect: after command acceptance, GEO writes four zero summary words at `DST1 + 0`, `+4`, `+8`, and `+12`. This happens before testing `COUNT`, including for a zero-count job. No launch-time destination validation precedes those summary writes. Program `DST1` for this operation even when no outer records will run.

## Register reference

The bank begins at `0x08000024` and occupies 16 consecutive 32-bit words. The offsets below are relative to that address. All bank words and the separate `FAULT_ACK` word reset to zero. Use aligned, mapped 32-bit accesses: unaligned mapped word accesses and mapped byte or halfword writes fault. A mapped write to a read-only GEO word raises the memory `READ_ONLY` bus fault and does not change that word.

| Offset | Address | Register | Access | Reset | Word interpretation |
|---|---|---|---|---|---|
| `+0x00` | `0x08000024` | `SRC0` | RW | `0` | Full 32-bit captured source word; command-specific meaning. |
| `+0x04` | `0x08000028` | `SRC1` | RW | `0` | Full 32-bit captured source word; command-specific meaning. |
| `+0x08` | `0x0800002c` | `SRC2` | RW | `0` | Full 32-bit captured source word; command-specific meaning. |
| `+0x0c` | `0x08000030` | `DST0` | RW | `0` | Full 32-bit captured destination word; command-specific meaning. |
| `+0x10` | `0x08000034` | `DST1` | RW | `0` | Full 32-bit captured destination word; command-specific meaning. |
| `+0x14` | `0x08000038` | `COUNT` | RW | `0` | Unsigned 32-bit outer-record count, captured at launch. |
| `+0x18` | `0x0800003c` | `CMD` | RW | `0` | Whole-word launch doorbell: `0x20`, `0x21`, or `0x22`. Other complete words reject when launch is permitted. |
| `+0x1c` | `0x08000040` | `CTRL` | RW | `0` | Bit 0: self-clearing `ABORT` pulse. Bits 31:1 retain the written bits and define no further controller action. |
| `+0x20` | `0x08000044` | `STATUS` | RO | `0` | Bit 0 `BUSY`; bit 1 `DONE`; bit 2 `ERROR`; bit 3 `REJECTED`. No further status bits are defined. |
| `+0x24` | `0x08000048` | `PARAM0` | RW | `0` | Full 32-bit captured parameter word; command-specific meaning. |
| `+0x28` | `0x0800004c` | `PARAM1` | RW | `0` | Full 32-bit captured parameter word; command-specific meaning. |
| `+0x2c` | `0x08000050` | `STRIDE0` | RW | `0` | Full 32-bit captured stride word; command-specific meaning. |
| `+0x30` | `0x08000054` | `STRIDE1` | RW | `0` | Full 32-bit captured stride word; command-specific meaning. |
| `+0x34` | `0x08000058` | `STRIDE2` | RW | `0` | Full 32-bit captured stride word; command-specific meaning. |
| `+0x38` | `0x0800005c` | `PROCESSED` | RO | `0` | Full 32-bit number of completed outer records. |
| `+0x3c` | `0x08000060` | `FAULT` | RO | `0` | Bits 31:16: fault code. Bits 15:0: failing outer-record index, or rejection sentinel `0xffff`. |
| Separate | `0x08010224` | `FAULT_ACK` | RW | `0` | Zero write does nothing. Any nonzero write acknowledges the local fault and immediately returns readback to zero; no individual acknowledgement bit is assigned. |

Writable configuration words retain all written bits without controller-side masking or decoding. Do not assume that bits unused by a particular command read as zero. `CMD` also retains its complete written word. `CTRL` retains the written word except that bit 0 is cleared whenever written as one; it has no start, interrupt-enable, or reset bit.

The mapped register access rules are distinct from the command memory datapath. GEO's direct data reads and output writes access main-memory backing, not mapped register actions. Installed RAM includes backing at addresses in the IO aperture. A command output address in that aperture is not a mapped register write and does not invoke a register action. Apply the operation's memory-range rules; do not treat the aperture as an automatic exclusion from every accepted RAM range.

## Work budget and timing

The installed system-cycle rate is 33,868,800 cycles per second and GEO receives 16,384,000 work units per second while busy. These numbers define cycle-based work credit. They are not vertex, collision-pair, contact, or memory-bandwidth ratings.

One work unit funds one outer-record invocation, whether that invocation succeeds or returns a fault. The accounting is the same for all three commands. Vertex count, record byte size, broadphase and exact tests, clipping, and contact count do not add controller work units. A full-pass invocation can examine many pairs, so its work-unit rate must not be advertised as a pair-processing rate.

A fresh nonzero launch starts with no accumulated whole work units and no fractional carry. Idle time does not bank work. While busy, elapsed CPU cycles add credit at the ratio

`16,384,000 / 33,868,800 = 640 / 1323` work units per CPU cycle.

Whole credit can be spent on outer records; the fractional remainder carries forward. Credit is capped by the number of records still remaining. GEO requests service at the first cycle that can fund the next outer record, or immediately when sufficient whole credit is already available. Service can process several records when several units have accrued.

For a fresh, continuously accrued budget, the credit threshold for `N > 0` outer records is `ceiling(N × 1323 / 640)` CPU cycles:

| Outer-record invocations funded | CPU-cycle credit threshold |
|---|---|
| 1 | 3 |
| 2 | 5 |
| 4 | 9 |
| 16 | 34 |
| 64 | 133 |
| 640 | 1323 |

These are calculated credit thresholds, not whole-routine completion guarantees. They exclude delayed service, launch and CPU-instruction overhead, interrupt handling, and termination by fault, abort, or rejection. No separate setup-latency or per-vertex cost term is specified by this budget. There is no public GEO clock-control register.

`COUNT` is a full unsigned 32-bit word; the controller imposes no smaller batch-count limit. This does not remove operation limits: XFORM2 accepts at most 64 vertices, SAT2 polygons at most 64 vertices, and OVERLAP polygons at most 64 vertices with at most 128 clip vertices. The 16-word register bank does not provide 16 job slots.

## Completion, faults, and recovery

Each successful outer record increments `PROCESSED` by one. Successful completion publishes `STATUS = 0x2` (`DONE` only), the completed count, and `FAULT = 0`, then raises `GEO_DONE`.

An execution fault publishes `STATUS = 0x6` (`DONE | ERROR`) and raises `GEO_ERROR`. The failing record is not added to `PROCESSED`. `FAULT` contains its zero-based outer-record index in bits 15:0 and the fault code in bits 31:16. The index is truncated to 16 bits independently of the full-width count and progress words. Preserve `PROCESSED` when diagnosing a large batch; the fault word alone does not retain the index's high bits.

A rejected submission publishes `STATUS = 0x8` (`REJECTED` without `DONE`), resets `PROCESSED` to zero, and uses fault index `0xffff`. It raises `GEO_ERROR`. Rejection during `BUSY` discards the active job even if some records had already completed. Neither rejection nor execution failure rolls back output memory already written.

| Fault code | Name |
|---|---|
| `0x0001` | `ABORTED` |
| `0x0002` | `BAD_RECORD_ALIGNMENT` |
| `0x0003` | `BAD_VERTEX_COUNT` |
| `0x0004` | `SRC_RANGE` |
| `0x0005` | `DST_RANGE` |
| `0x0006` | `DESCRIPTOR_KIND` |
| `0x0007` | `NUMERIC_OVERFLOW_INTERNAL` |
| `0x0008` | `BAD_RECORD_FLAGS` |
| `0x0009` | `RESULT_CAPACITY` |
| `0x8001` | `REJECT_BUSY` |
| `0x8002` | `REJECT_BAD_CMD` |

The table defines the code space; it does not mean every operation emits every code. Consult the operation's record rules for its failure conditions.

To stop a busy job, write `CTRL` with bit 0 set. `ABORT` terminates it with `DONE | ERROR`, code `ABORTED`, and the current completed-record index. Earlier outputs remain. The pulse clears itself. In idle or `DONE`, it changes no job result. With `ERROR` or `REJECTED` already latched, it cannot replace the first fault.

After inspecting a fault, write any nonzero word to `FAULT_ACK`. This clears `ERROR`, `REJECTED`, and `FAULT`; it preserves `DONE`, `BUSY`, and `PROCESSED`. An execution-error result consequently becomes `DONE`; a rejection becomes idle. A zero write has no effect. Acknowledgement never resumes the discarded job.

Local fault acknowledgement and central interrupt acknowledgement are separate. `GEO_DONE` uses central bit 3 (`0x8`); `GEO_ERROR` uses bit 4 (`0x10`). Success raises only the done source; execution fault, abort, and rejection raise only the error source. Pending sources are recorded regardless of masking. The central IRQ registers are `FLAGS` at `0x08000000`, `ACK` at `0x08000004`, and `MASK` at `0x08000008`. Clear a pending source by writing its one bit to central `ACK`; that write leaves other pending sources untouched. Central `ACK` then reads zero. Masking a source does not clear it. `FAULT_ACK` does not clear central pending bits, and central acknowledgement does not release a sticky GEO fault. Use the interrupt-controller chapter for CPU interrupt entry.

GEO reset cancels service, discards the active job and its credit, returns to idle, and zeroes all 16 bank words and `FAULT_ACK`. It does not itself clear central IRQ pending state; full device reset resets the interrupt controller separately. No GEO register write provides a reset operation.

## XFORM2_BATCH: transform vertices and build bounds

Command word: **0x20**.

XFORM2_BATCH applies one affine matrix to each selected run of two-dimensional vertices. Each record selects its source run, matrix, destination run and, optionally, an axis-aligned bounding box (AABB).

### Registers and address selection

| Register | XFORM2_BATCH role |
|---|---|
| SRC0 | Transformation-record table base |
| STRIDE0 | Byte step between transformation records |
| SRC1 | Local-vertex data base |
| STRIDE1 | Byte step used to select a source run; not the step between its vertices |
| SRC2 | Matrix-table base |
| STRIDE2 | Byte step between selectable matrices |
| DST0 | Transformed-vertex output base; vertices occupy 8 bytes each |
| DST1 | AABB output base; boxes occupy 16 bytes each |
| COUNT | Number of transformation records |
| PARAM0, PARAM1 | Ignored |

For record ordinal `n`, beginning at zero, the selected addresses are:

| Object | Address | Size accessed |
|---|---|---|
| Record | `SRC0 + n × STRIDE0` | 24 bytes |
| Source run | `SRC1 + src_index × STRIDE1` | `vertex_count × 8` bytes |
| Matrix | `SRC2 + aux_index × STRIDE2` | 24 bytes |
| Output run | `DST0 + dst_index × 8` | `vertex_count × 8` bytes |
| AABB | `DST1 + dst1_index × 16` | 16 bytes, unless suppressed |

Thus `dst_index` counts vertices, while `dst1_index` counts boxes. The source vertices within a run are consecutive 8-byte records. Neither a field in the record nor a destination index changes the batch record ordinal.

### Record and data layouts

All offsets and strides below are in **bytes**. Each word occupies four little-endian bytes. Index, count and flags words are unsigned. Signed Q16 words represent the signed 32-bit word divided by 65536; the same representation is used for coordinates, matrix coefficients, translations and bounds.

<div class="keep-together">

**Transformation record — 24 bytes**

| Offset | Word | Meaning |
|---|---|---|
| +0 | flags | Must be zero |
| +4 | src_index | Source-run index, scaled by STRIDE1 |
| +8 | dst_index | Output-vertex index, scaled by 8 |
| +12 | aux_index | Matrix index, scaled by STRIDE2 |
| +16 | vertex_count | Number of consecutive vertices; 0–64 |
| +20 | dst1_index | AABB index, scaled by 16; `0xffffffff` suppresses the box |

</div>

The `0xffffffff` value is special only in `dst1_index`: it suppresses both AABB address checking and writing. No equivalent sentinel applies to the other indices. A zero vertex count succeeds after the record and flags checks, without checking or accessing the source run, matrix, vertex output or AABB.

| Data object | Size | Word offsets and contents |
|---|---|---|
| Vertex | 8 bytes | +0: x; +4: y, both signed Q16 |
| Matrix | 24 bytes | +0: m00; +4: m01; +8: tx; +12: m10; +16: m11; +20: ty, all signed Q16 |
| AABB | 16 bytes | +0: min_x; +4: min_y; +8: max_x; +12: max_y, all signed Q16 |

### Transformation arithmetic

For each input vertex, the two matrix rows produce the output x and y independently. Using the signed **raw words**, a row `(a, b, t)` is evaluated as follows:

1. Form the exact signed 64-bit products `a × x` and `b × y`.
2. Add those products, saturating the sum to the signed 64-bit range.
3. Add `t × 65536`, again saturating to signed 64-bit range.
4. Shift arithmetically right by 16 bits, then saturate to signed 32-bit range.

The first row is `(m00, m01, tx)` and the second is `(m10, m11, ty)`. Saturation does not wrap, and arithmetic overflow does not raise a numeric-overflow fault. The shift is not round-to-nearest: a negative fractional raw unit rounds downward. For example, raw `a = -1`, `x = 1`, with the other terms zero, produces raw `-1` (`0xffffffff`), not zero. An identity x coefficient with a +1 translation applied to raw `2147483647` remains `2147483647` through saturation.

The matrix is read before processing the vertices. Vertices are then read and written in ascending order, with each source vertex read immediately before its output x and y are written. Bounds are formed from the saturated output words, initialized from the first vertex, and written only after all vertices: min_x, min_y, max_x, max_y. Overlapping source and output storage is not prohibited or copied aside; an earlier output can change a later source read. The already-read matrix is unaffected.

### Address and memory rules

These rules also apply to SAT2_BATCH below. For a nonempty indexed span, the byte displacement, base-plus-displacement and span end must not overflow the 32-bit address space. A span end exactly `0x100000000` passes this arithmetic check. A zero stride is permitted and repeatedly selects the same address.

Every input span must lie wholly within one readable region: the system-ROM window `0x00000000–0x00ffffff`, installed main RAM beginning at `0x08000000`, or the cartridge-bus window `0x10000000–0x30ffffff`. The cartridge window is not a promise of ROM at every address; it includes cartridge RAM and device mappings. System-ROM reads beyond the populated contents, but within its window, return zero. Output spans must lie wholly in installed main RAM. The RAM checks do not exclude its I/O-address window, and these word transfers do not invoke mapped-I/O handling.

XFORM2_BATCH imposes no separate word-alignment check on these addresses or strides. In particular, the fault name BAD_RECORD_ALIGNMENT must not be read as an additional alignment requirement.

### Fault priority and output preservation

The first applicable entry below determines the current record's fault. All checks precede output writes; a failed record writes neither vertices nor its AABB.

| Priority | Condition | Fault word |
|---|---|---|
| 1 | Record address/span overflows | 2 — BAD_RECORD_ALIGNMENT |
| 2 | Record span is not readable | 4 — SRC_RANGE |
| 3 | flags is nonzero | 8 — BAD_RECORD_FLAGS |
| 4 | vertex_count is zero | Success; no further checks or writes |
| 5 | vertex_count exceeds 64 | 3 — BAD_VERTEX_COUNT |
| 6 | Source-run span overflows or is not readable | 4 — SRC_RANGE |
| 7 | Matrix span overflows or is not readable | 4 — SRC_RANGE |
| 8 | Vertex-output span overflows or is outside installed main RAM | 5 — DST_RANGE |
| 9 | Unsuppressed AABB span overflows or is outside installed main RAM | 5 — DST_RANGE |

### Worked transformation

Take four local vertices `(0,0), (4,0), (4,4), (0,4)`. Their raw words use `4 = 262144`. Matrix 0 is identity with zero translation; matrix 1 is identity with `tx = ty = 65536`, translating by `(1,1)`.

| Record | flags | src_index | dst_index | aux_index | vertex_count | dst1_index |
|---|---|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 0 | 4 | 0 |
| 1 | 0 | 0 | 4 | 1 | 4 | 1 |

The first output run is unchanged. The second starts 32 bytes after DST0 and contains `(1,1), (5,1), (5,5), (1,5)`. For example, its x coordinate for input `(4,0)` is raw `327680`, representing 5. The AABB words are `(0,0,262144,262144)` and `(65536,65536,327680,327680)` respectively. These eight consecutive output vertices can also supply the two SAT2 shapes below.

## SAT2_BATCH: test convex-polygon pairs

Command word: **0x21**.

SAT2_BATCH tests pairs of polygon descriptors using their edge normals as separating axes. It returns a hit flag, selected normal, interval-overlap depth and the edge that supplied that axis. Polygon coordinates are signed Q16 words in one common coordinate space; SAT2 does not transform them.

### Registers and layouts

| Register | SAT2_BATCH role |
|---|---|
| SRC0, STRIDE0 | Pair-table base and byte step between pair records |
| SRC1, STRIDE1 | Shared descriptor-table base and byte step for both shape indices |
| SRC2 | Shared vertex-pool base |
| DST0 | Result-table base; each result occupies 20 bytes |
| COUNT | Number of pair records |
| DST1, PARAM0, PARAM1, STRIDE2 | Ignored |

| Object | Address | Size |
|---|---|---|
| Pair n | `SRC0 + n × STRIDE0` | 20 bytes |
| Descriptor A/B | `SRC1 + shape_A/B_index × STRIDE1` | 16 bytes each |
| Vertex run A/B | `SRC2 + vertex_offset_bytes` | `vertex_count × 8` bytes each |
| Result | `DST0 + result_index × 20` | 20 bytes |

A descriptor's vertex offset counts **bytes**, not vertices. Vertices are consecutive x/y records in the same 8-byte format as XFORM2. All pair and descriptor fields are unsigned words, with no index sentinel.

**Pair record — 20 bytes**

| Offset | Word | Requirement or unit |
|---|---|---|
| +0 | flags | Must be zero |
| +4 | shape_A_index | Descriptor index, scaled by STRIDE1 |
| +8 | result_index | Result index, scaled by 20 |
| +12 | shape_B_index | Descriptor index, scaled by STRIDE1 |
| +16 | flags2 | Must be zero |

<div class="keep-together">

**Polygon descriptor — 16 bytes**

| Offset | Word | Requirement or unit |
|---|---|---|
| +0 | flags | Exactly 1: convex polygon |
| +4 | vertex_count | 3–64 |
| +8 | vertex_offset_bytes | Byte offset from SRC2; divisible by 4 |
| +12 | reserved | Must be zero, not ignored |

</div>

There is no separate alignment test for pair, descriptor or result addresses. The vertex-offset test checks the offset alone, not the final address or an 8-byte boundary. No winding, convexity, area, distinct-vertex or topology check is performed.

**Result — 20 bytes**

| Offset | Word | Interpretation |
|---|---|---|
| +0 | hit | Unsigned 0 or 1 |
| +4 | nx | Signed Q16 normal x component |
| +8 | ny | Signed Q16 normal y component |
| +12 | depth | Signed Q16 overlap depth |
| +16 | meta | Shape selector in high 16 bits; zero-based edge index in low 16 bits |

The selector is 0 for A and 1 for B; edge indices are 0–63. There are no hit or normal-sign bits in meta.

### Axis selection and arithmetic

Axes are visited in A edge order, then B edge order, including each closing edge back to vertex 0. An edge from `(x0,y0)` to `(x1,y1)` supplies the perpendicular `(-(y1-y0), x1-x0)`, normalized by its Euclidean length. Zero-length edges are skipped. Axes are not deduplicated; up to 128 candidate edges may be visited.

Edge differences, normalization and projections use double-precision floating-point arithmetic on signed coordinate raw words, without a Q16 product shift. Each projection is `x × axis_x + y × axis_y`; every vertex contributes to the interval minimum and maximum. An axis separates only when `A.min > B.max` or `B.min > A.max`. The first separating axis writes five zero words and finishes the pair successfully; no separating-edge metadata is returned.

Otherwise its overlap is `min(A.max,B.max) − max(A.min,B.min)`. This is interval intersection length, including containment, not a special containment escape distance. The smallest overlap wins; equal overlaps retain the earlier axis. Touching intervals therefore can return hit 1 with depth 0.

For a hit, the normal is flipped only if its dot product with `meanB − meanA` is negative. Each mean is the arithmetic mean of vertices, not an area centroid. A zero dot product preserves the edge-derived direction. Flipping does not change meta. Normal components are multiplied by 65536 before rounding to output words. Depth is already in Q16 raw coordinate units and is **not** multiplied by 65536 again. Both round to nearest, with exact halves toward positive infinity, then saturate to signed 32-bit range.

Duplicate vertices are allowed through the stated checks. If all edges of both shapes have zero length, the pair faults without a result write. One nonzero edge is sufficient for evaluation, even for collinear, zero-area or nonconvex lists. Identical collinear lists `(0,0), (1,0), (2,0)` consequently return a hit with normal `(0,1)` and zero depth.

### Fault priority and writes

| Priority | Condition | Fault word |
|---|---|---|
| 1 | Pair address/span overflows | 2 — BAD_RECORD_ALIGNMENT |
| 2 | Pair is not readable | 4 — SRC_RANGE |
| 3 | Either pair flags word is nonzero | 8 — BAD_RECORD_FLAGS |
| 4 | Result span overflows or is outside installed main RAM | 5 — DST_RANGE |
| 5 | Either descriptor span overflows or is not readable | 4 — SRC_RANGE |
| 6 | Either descriptor flags differs from 1, or reserved is nonzero | 6 — DESCRIPTOR_KIND |
| 7 | Either vertex count is below 3 | 3 — BAD_VERTEX_COUNT |
| 8 | Either vertex offset is not divisible by 4 | 2 — BAD_RECORD_ALIGNMENT |
| 9 | Either vertex count exceeds 64 | 3 — BAD_VERTEX_COUNT |
| 10 | Either vertex span overflows or is not readable | 4 — SRC_RANGE |
| 11 | No nonzero edge axis exists | 6 — DESCRIPTOR_KIND |

Thus a misaligned vertex offset takes priority over a count above 64, but not over a count below 3. Neither operation returns fault 7, NUMERIC_OVERFLOW_INTERNAL.

Failures leave the current result untouched. Successful hits and misses overwrite all five words in layout order. Source data for the pair is read before its result is written. No alias restriction or automatic result clearing is imposed: a later pair can observe an earlier result write if their buffers overlap.

### Worked pair and output interpretation

Use the two square runs from the worked transformation above. Descriptor 0 contains `(flags=1, count=4, offset=0, reserved=0)`; descriptor 1 uses offset 32. The pair words are `(0,0,0,1,0)`, selecting A=0, B=1 and result 0.

A edge 0 supplies axis `(0,+1)`. The projected intervals are raw `[0,262144]` and `[65536,327680]`, giving overlap `196608`, or 3 units. A edge 1 has the same overlap and loses the strict tie. The mean displacement is `(1,1)`, so the normal is not flipped. The five result words are **`(1,0,65536,196608,0)`**: hit, normal `(0,1)`, depth 3, A edge 0.

With B translated by `(4,0)` instead, the squares touch and return `(1,65536,0,0,1)`: depth zero, normal `(1,0)`, A edge 1. Translation by `(5,0)` returns five zero words. Identical squares retain A edge 0 and return `(1,0,65536,262144,0)`. For extreme coordinates, depth saturates: identical squares spanning raw `-2147483648` to `2147483647` on both axes return depth `2147483647`, not a wrapped value.

## OVERLAP2D_PASS: translated-shape contacts


`OVERLAP2D_PASS` (`0x22`) finds strict two-dimensional overlaps between translated shapes. It accepts AABBs, convex polygons, and compounds of those primitives. For each overlapping instance pair it emits at most one contact: a normal, penetration depth, contact point, and identifiers for the selected pieces and feature. Non-overlapping pairs occupy no output slots.

Use **candidate mode** when the cartridge already has a pair list, needs a particular pair order, or carries its own pair metadata. Use **full pass** to examine every distinct pair in an instance array. The two modes share the same mask, bounds, exact-overlap, and contact operations.

All addresses and offsets below are byte quantities unless explicitly identified as indices or counts. `U32` means an unsigned 32-bit register or memory word. `F32` means the IEEE 754 binary32 bit pattern stored in one word; geometry is not fixed-point. Source F32 values are decoded for double-precision calculation, and contact components are rounded back to F32 on output.

### Pass configuration

The pass uses the configuration captured at launch:

| Launch word | Candidate mode | Full pass |
|---|---|---|
| `SRC0` | Instance-array address | Instance-array address |
| `STRIDE0` | Instance stride in bytes | Instance stride in bytes |
| `SRC1` | Candidate-pair-array address | Unused |
| `STRIDE1` | Candidate-pair stride in bytes | Unused |
| `COUNT` | Number of candidate records | Number of instances |
| `STRIDE2` | Number of addressable instances | Unused |
| `SRC2` | Unused | Unused |
| `DST0` | Packed contact-result array | Packed contact-result array |
| `DST1` | 16-byte summary address | 16-byte summary address |
| `PARAM1` | Result capacity, in records | Result capacity, in records |

Only `PARAM0 & 3` selects the mode. Selector `1` is candidate mode; selectors `0`, `2`, and `3` are full pass. Thus `2` is the named full-pass encoding, but is not its only accepted encoding.

The remaining `PARAM0` bits have no effect on this pass. In particular, the named broadphase field (bits 2–3, mask `0x0000000C`, with NONE=`0` and LOCAL_BOUNDS=`4`), contact field (bits 4–5, mask `0x00000030`, with CLIPPED_FEATURE=`0`), output field (bits 6–7, mask `0x000000C0`, with STOP_ON_OVERFLOW=`0`), and reserved mask `0xFFFF0000` are not selectable policies or rejected encodings. Local-bounds filtering and stop-on-overflow operate regardless of these bits. For example, `PARAM0=6` selects full pass; it does not enable an additional broadphase operation.

A launch clears the processed, result, exact-pair, and broadphase-pair counts and writes a zero summary, including when `COUNT=0`. There is no separate OVERLAP2D configuration-validation stage.

### Input records

#### Instances and candidate pairs

An instance occupies five words, 20 bytes:

| Byte offset | Encoding | Meaning |
|---:|---|---|
| `+0` | U32 | Absolute shape-descriptor address |
| `+4` | F32 | Translation `tx` |
| `+8` | F32 | Translation `ty` |
| `+12` | U32 | Layer bitmask |
| `+16` | U32 | Collision mask |

Instance index `i` addresses `SRC0 + i × STRIDE0`. Several instances may reference the same descriptor with different translations. Translation is the only instance transform: there is no rotation or scale field.

A candidate record occupies three words, 12 bytes:

| Byte offset | Encoding | Meaning |
|---:|---|---|
| `+0` | U32 | Instance A index |
| `+4` | U32 | Instance B index |
| `+8` | U32 | Opaque pair metadata |

These are instance indices, not byte offsets. Records are visited in array order at `SRC1 + recordIndex × STRIDE1`. A self-pair faults before the instance-index bounds check. Otherwise both indices must be less than `STRIDE2`. A is read before B. Repeated and reversed records remain separate operations; neither ordering nor metadata is normalized.

Full pass visits `(0,1), (0,2), …, (1,2), …`, with A index increasing in the outer loop and B running from A+1 to `COUNT−1`. It generates no self-pairs or reversed pairs. Its pair metadata is `((A & 0xFFFF) << 16) | (B & 0xFFFF)`. Only metadata is truncated to 16-bit halves; instance addressing uses the complete indices, with no separate 65,535- or 65,536-instance limit.

#### Shape descriptors and bounds

Every shape descriptor is 16 bytes:

| Byte offset | Encoding | Meaning |
|---:|---|---|
| `+0` | U32 | Kind: AABB=`1`, convex polygon=`3`, compound=`4` |
| `+4` | U32 | Data count; interpretation depends on kind |
| `+8` | U32 | Data offset in bytes, relative to this descriptor |
| `+12` | U32 | Bounds offset in bytes, relative to this descriptor |

A bounds block is four consecutive F32 words: left at `+0`, top at `+4`, right at `+8`, bottom at `+12`. Its world bounds add `tx` to left/right and `ty` to top/bottom. Bounds are neither reordered nor recomputed from exact geometry, and their consistency with the shape is not checked. Supply bounds even if the named broadphase NONE encoding is present in `PARAM0`.

| Kind | Exact data at descriptor + data offset | Data count |
|---|---|---|
| AABB (`1`) | Four F32 words: left, top, right, bottom | Exactly `4` |
| Convex polygon (`3`) | Vertices, each 8 bytes: x F32 at `+0`, y F32 at `+4` | Vertex count, `3` through `64` |
| Compound (`4`) | Inline 16-byte child descriptors | Nonzero piece count |

An AABB uses four world vertices in this order: `(left,top)`, `(right,top)`, `(right,bottom)`, `(left,bottom)`, with the instance translation added. The exact-data block may also serve as its bounds block. Setting both offsets to `16` therefore gives a 32-byte AABB shape.

Polygon data spans `dataCount × 8` bytes. Translation is added to every vertex read. Convexity, winding, finite coordinates, duplicate vertices, and nonzero area are not validated or repaired.

Compound piece `i` is the descriptor at `parent + dataOffset + i × 16`: the array contains descriptors, not pointers or indices. Each child's offsets are relative to that child descriptor. All children inherit the instance translation; there is no per-piece transform. There is no explicit upper piece-count limit. The zero-count check occurs only after the outer instance bounds overlap. Child descriptors, bounds, and exact data are checked as they are reached. Narrowphase accepts only AABB or polygon children, so a nested compound faults if exact loading reaches it; a child whose bounds miss need not reach that check.

#### Address spans

Descriptor offsets are unsigned byte offsets, not signed displacements. Indexed address formation retains the low 32 bits, but an accepted input span must also pass the no-overflow checks: the index-times-stride product and base-plus-offset must fit in 32 bits, and the span end must not exceed `0x100000000`. There is no alignment predicate in this pass.

Guarded inputs must lie in the readable system-ROM, main-RAM, or cartridge-bus windows. System-ROM and RAM words are little-endian; cartridge reads use the cartridge bus. Results require installed main RAM. Summary writes use ordinary word writes without a preceding summary-span or RAM check; an invalid `DST1` can produce a bus fault rather than an OVERLAP2D destination-range fault. Summary publication is not atomic.

### Filtering, order, and counts

For each instance pair, the pass checks readability of both shape descriptors before applying masks. The pair proceeds only when both `(maskA & layerB) != 0` and `(maskB & layerA) != 0`. A rejected pair reads no bounds and changes none of the three summary counts.

A mask-passing pair increments `broadphasePairCount`, then reads A bounds followed by B bounds. Bounds reject only when A lies strictly beyond B on an axis: `leftA > rightB`, `rightA < leftB`, `topA > bottomB`, or `bottomA < topB`. Touching bounds therefore pass. Bounds are used exactly as supplied.

After overlapping outer bounds, the pass checks top-level kinds and compound piece counts, then increments `exactPairCount` once for the instance pair—not for each piece test or hit. Piece iteration visits A pieces in ascending order and, within each, B pieces in ascending order. Before the B-piece loop, the pass checks A's piece-descriptor span and reads A's bounds. It checks B's descriptor span and reads B's bounds for each piece pair. Disjoint piece bounds skip exact loading; overlapping piece bounds cause both descriptors to be read again for exact loading.

All overlapping piece pairs are tested. The selected contact has the smallest penetration depth; ties choose the smaller A piece index, then smaller B piece index, then smaller feature metadata. A later fault aborts the record even if an earlier piece pair had produced a provisional contact.

### Exact overlap and contact

AABB and polygon pieces use the same polygon operation; there is no separate AABB/AABB shortcut. Exact loading reads A before B. An AABB count other than four, or a polygon count outside 3–64, faults before its exact-data range check.

The separating-axis test visits A's edges first, then B's, in ascending edge order, with the closing edge last. For an edge from `(x0,y0)` to `(x1,y1)`, its axis is the left normal `(-(y1−y0), x1−x0)` divided by `sqrt((x1−x0)² + (y1−y0)²)`. An edge is skipped unless its length is positive. Every world vertex is projected onto each usable axis.

The overlap on an axis is `min(maxA,maxB) − max(minA,minB)`. Unless it is strictly positive, the pair has no contact. Touching is not overlap, and a pair with no usable axes has no contact. Depth is the smallest of these interval-intersection lengths, without a special containment-depth correction. Equal depths favor an A-owned edge, then the lower edge index. Feature metadata contains only that edge index; it does not identify which shape supplied the edge.

The normal is directed using the arithmetic means of the two shapes' vertices. If `(meanA−meanB) · axis` is negative, the chosen axis is flipped; if zero, its original left-normal direction is retained. The ordinary direction is therefore **from B toward A**, not A toward B. Changing the supplied A/B order changes this orientation rule.

The contact point is computed separately by clipping world polygon A successively against B's directed edges. A point is inside when `(x1−x0) × (py−y0) − (y1−y0) × (px−x0) >= 0`: the left half-plane, including its boundary. Winding is not normalized.

For each clipping plane, processing starts with the last input vertex as S and visits each E in ascending order:

| S → E classification | Output |
|---|---|
| Inside → inside | E |
| Inside → outside | Intersection |
| Outside → inside | Intersection, then E |
| Outside → outside | Nothing |

For signed distances `sd` and `ed`, the intersection uses `t = sd / (sd−ed)` and `S + (E−S) × t`. The two clipping buffers exchange roles after each plane; processing stops if the input becomes empty. Vertices are not deduplicated.

A nonempty clipped polygon produces the arithmetic mean of its output vertices—not an area-weighted centroid. Duplicate vertices retain their weight. An empty clipped polygon does not cancel a successful separating-axis test: its point is `(meanA + meanB) / 2`. Clipping does not change normal or depth.

The clipping workspace holds 128 vertices in each of two buffers; there is no explicit clipping-capacity fault. Zero-length edges are skipped, and zero projected overlap rejects contact. Non-finite values receive the stated arithmetic and comparisons, not a separate value-classification check.

### Output records and summary

Results are packed at `DST0 + resultCount × 36`, independent of input strides:

| Byte offset | Encoding | Meaning |
|---:|---|---|
| `+0`, `+4` | F32 | Normal x, y |
| `+8` | F32 | Penetration depth |
| `+12`, `+16` | F32 | Contact-point x, y |
| `+20`, `+24` | U32 | Winning A, B piece indices |
| `+28` | U32 | Winning edge index, without edge-owner bit |
| `+32` | U32 | Candidate metadata or generated full-pass metadata |

Primitive shapes report piece index zero. There is no hit flag: misses emit nothing.

The summary at `DST1` is:

| Byte offset | Encoding | Meaning |
|---:|---|---|
| `+0` | U32 | `resultCount` |
| `+4` | U32 | `exactPairCount` |
| `+8` | U32 | `broadphasePairCount` |
| `+12` | U32 | Flags: bit 0 overflow; ordinary value zero |

It contains neither capacity nor processed count. The processed count advances only after an entire input record succeeds: one candidate record in candidate mode, one outer instance in full pass. Full pass reads its final instance and publishes a summary even though that record has no later partner.

### Capacity, partial progress, and faults

Capacity is checked only after the complete piece search selects a hit. If `resultCount >= PARAM1`, the pass publishes current counters with overflow bit 0 set, then faults with `RESULT_CAPACITY`; it writes no new result and does not increment `resultCount`. Capacity zero can succeed when there are no hits. This check precedes destination validation.

Each actual result separately requires a non-wrapping 36-byte span in installed main RAM. The entire declared capacity is not preflighted. `resultCount` advances after all nine result words are written. Earlier results and writes remain after a later fault; there is no rollback.

The summary is written initially, after every successful input record, and on capacity overflow. Other faults do not refresh it. In particular, a failing full-pass outer record may already have advanced counters or written contacts that its last published summary does not include. The failing record does not advance the processed count.

| Code | OVERLAP2D fault |
|---:|---|
| `3` | `BAD_VERTEX_COUNT`: invalid AABB or polygon count |
| `4` | `SRC_RANGE`: invalid input span or candidate instance index |
| `5` | `DST_RANGE`: invalid result span or non-RAM result destination |
| `6` | `DESCRIPTOR_KIND`: unsupported shape kind or zero-piece compound |
| `8` | `BAD_RECORD_FLAGS`: candidate self-pair |
| `9` | `RESULT_CAPACITY`: selected hit exceeds result capacity |

The declared alignment fault (`2`) and numeric-overflow fault (`7`) are not emitted by this pass. Reserved parameter bits are not rejected.

In candidate mode, fault checks begin with candidate-record span/readability, then self-pair rejection, instance-index bounds, and the A and B instance-record spans/readability in that order. Full pass first reads/checks its outer A instance, then each B instance.

For each reached pair, the order is descriptor readability, mask filtering, A bounds, B bounds, outer-bounds rejection, top-level kind/count checks, exact-count increment, A-piece descriptor/bounds, B-piece descriptor/bounds, piece-bounds rejection, exact A kind/count/data, exact B kind/count/data, contact selection, capacity, and result destination. The first encountered fault stops the record.

### Small AABB example

Build one 32-byte shape from descriptor words `[1, 4, 16, 16]`, followed by F32 bounds/data `[0, 0, 4, 4]`. Two 20-byte instances share it: A has translation `(0,0)`, B `(1,1)`, and both have layer and mask `1`. Supply candidate `[0, 1, 0x12345678]`.

Set `SRC0` to the instances, `STRIDE0=20`, `SRC1` to the candidate, `STRIDE1=12`, `COUNT=1`, `STRIDE2=2`, `PARAM0=1`, and `PARAM1>=1`, with result and summary storage provided as described above. The result is normal `(0,−1)`, depth `3`, point `(2.5,2.5)`, pieces `0/0`, feature `0`, and unchanged metadata `0x12345678`. The normal's x component may carry signed zero; positive-zero bits are not promised. Summary is `[1,1,1,0]`, processed count `1`.

With full-pass `PARAM0=2` and `COUNT=2`, the contact is the same, metadata is `1`, and processed count is `2`. Moving B to `(4,0)` yields touching bounds but no exact overlap: summary `[0,1,1,0]`, even with capacity zero. At `(5,0)`, summary is `[0,0,1,0]`. Either mask set to zero gives `[0,0,0,0]`, provided both descriptor spans remain readable.

Repeating the original overlapping candidate twice with capacity one leaves the first result intact. The second hit publishes `[1,2,2,1]` and faults with code `9` at record index `1`; processed count remains `1`.

## Complete BLua program

The following program transforms two squares, passes those actual output
vertices to SAT2, repeats the contact query through both OVERLAP2D modes,
and exercises a record fault followed by acknowledgement and recovery.
It writes RAM results, not drawing commands.

Begin under ordinary cartridge startup with zero-initialized BSS, CPU interrupt
acceptance enabled, no outstanding GEO job and exclusive ownership of GEO.
The program enables only GEO_DONE and GEO_ERROR delivery. Its handler
acknowledges only those controller bits; unrelated masked pending bits are
preserved. Local FAULT_ACK is a separate transaction in the entry code.

Create a const module named `results` by concatenating its three parts in the
printed order. Likewise concatenate all **Entry module** parts into one entry
module. They are consecutive pieces of one program, not alternative examples.
The const module declares record layouts and the address of explicit BSS;
requiring it does not allocate a runtime register table. Named `rodata` holds
the fixed integer-word operands. Floating-point shapes and instances use typed
F32 fields in BSS, separately from the Q16.16 vertex buffer.

### Follow the six phases

| Phase | Operation | COUNT meaning | Observed result |
|---:|---|---|---|
| 1 | XFORM2 | Two transform records | Two four-vertex squares and two AABBs |
| 2 | SAT2 | One polygon pair | Hit, +Y unit normal, depth 3 in Q16.16 |
| 3 | OVERLAP2D candidate | One explicit pair | One contact, supplied pair metadata 12345678H |
| 4 | OVERLAP2D full pass | Two instances | Same contact, generated pair metadata 1 |
| 5 | Bad XFORM2 flags | One record | DONE+ERROR, BAD_RECORD_FLAGS at record 0 |
| 6 | XFORM2 after local ACK | Zero records | Immediate successful completion; bad record not read |

Phase 1 reads one source square twice, once with identity and once with a
translation of (+1,+1). Phase 2 consumes the two spans from that output buffer;
its descriptor offsets 0 and 32 are **bytes**, not vertex indices. No conversion
is needed between XFORM2 output and SAT2 input. OVERLAP2D is different: its
shape and translation fields explicitly describe binary32 values. The program
does not reinterpret the Q16.16 vertices as floating-point data.

The completion sequence is sampled before each CMD. A job can complete before
the caller first executes HALT, and an unrelated accepted interrupt is not a
GEO completion. The predicate handles both cases. The retained status, progress
and fault observations distinguish a successful job from the deliberate error;
one wake-up alone would not do so.

### Const module: layouts and BSS, part 1

```lua
module<const>

struct geo_manual_sources
	src0: word
	src1: word
	src2: word
	dst0: word
	dst1: word
	count: word
end

struct geo_manual_parameters
	param0: word
	param1: word
	stride0: word
	stride1: word
	stride2: word
end

struct geo_manual_vertex
	x: word
	y: word
end

struct geo_manual_transform
	m00: word
	m01: word
	tx: word
	m10: word
	m11: word
	ty: word
end

struct geo_manual_xform_record
	flags: word
	source_index: word
	destination_index: word
	matrix_index: word
	vertex_count: word
	bounds_index: word
end
```

### Const module: layouts and BSS, part 2

```lua
struct geo_manual_sat_pair
	flags: word
	shape_a: word
	result_index: word
	shape_b: word
	flags2: word
end

struct geo_manual_sat_shape
	flags: word
	vertex_count: word
	vertex_offset: word
	reserved: word
end

struct geo_manual_sat_result
	hit: word
	nx: word
	ny: word
	depth: word
	meta: word
end

struct geo_manual_shape
	kind: word
	data_count: word
	data_offset: word
	bounds_offset: word
	bounds: f32[4]
end

struct geo_manual_instance
	shape: word
	tx: f32
	ty: f32
	layer: word
	mask: word
end

struct geo_manual_candidate
	instance_a: word
	instance_b: word
	meta: word
end
```

### Const module: layouts and BSS, part 3

```lua
struct geo_manual_contact
	nx: f32
	ny: f32
	depth: f32
	px: f32
	py: f32
	piece_a: word
	piece_b: word
	feature_meta: word
	pair_meta: word
end

struct geo_manual_summary
	result_count: word
	exact_pairs: word
	broadphase_pairs: word
	flags: word
end

struct geo_manual_observation
	status: word
	processed: word
	fault: word
end

struct geo_manual_result
	completed_phase: word
	service_sequence: word
	done_count: word
	error_count: word
	vertices: geo_manual_vertex[8]
	bounds: word[8]
	sat: geo_manual_sat_result
	shape: geo_manual_shape
	instances: geo_manual_instance[2]
	contacts: geo_manual_contact[2]
	summaries: geo_manual_summary[2]
	observations: geo_manual_observation[6]
	acknowledged_status: word
	acknowledged_fault: word
	final_irq_flags: word
end

bss result: geo_manual_result

return { result = result }
```

### Entry module: Ports and readonly operands

```lua
module<entry>

local state<const> = require('results')
local result<const>: *geo_manual_result = state.result
local src<const>: *geo_manual_sources = 0x08000024
local param<const>: *geo_manual_parameters = 0x08000048
local command<const>: *word = 0x0800003c
local status<const>: *word = 0x08000044
local processed<const>: *word = 0x0800005c
local fault<const>: *word = 0x08000060
local fault_ack<const>: *word = 0x08010224
local irq_flags<const>: *word = 0x08000000
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008

-- XFORM2 and SAT2 use signed Q16.16 words, not floating-point coordinates.
rodata square: geo_manual_vertex[4] = {
	{ x = 0, y = 0 }, { x = 4 << 16, y = 0 },
	{ x = 4 << 16, y = 4 << 16 }, { x = 0, y = 4 << 16 },
}
rodata transforms: geo_manual_transform[2] = {
	{ m00 = 65536, m01 = 0, tx = 0, m10 = 0, m11 = 65536, ty = 0 },
	{ m00 = 65536, m01 = 0, tx = 65536, m10 = 0, m11 = 65536, ty = 65536 },
}
rodata transform_records: geo_manual_xform_record[2] = {
	{ flags = 0, source_index = 0, destination_index = 0,
		matrix_index = 0, vertex_count = 4, bounds_index = 0 },
	{ flags = 0, source_index = 0, destination_index = 4,
		matrix_index = 1, vertex_count = 4, bounds_index = 1 },
}
rodata sat_pair: geo_manual_sat_pair = {
	flags = 0, shape_a = 0, result_index = 0, shape_b = 1, flags2 = 0,
}
rodata sat_shapes: geo_manual_sat_shape[2] = {
	{ flags = 1, vertex_count = 4, vertex_offset = 0, reserved = 0 },
	{ flags = 1, vertex_count = 4, vertex_offset = 32, reserved = 0 },
}

rodata candidate: geo_manual_candidate = {
	instance_a = 0, instance_b = 1, meta = 0x12345678,
}
rodata bad_record: geo_manual_xform_record = {
	flags = 1, source_index = 0, destination_index = 0,
	matrix_index = 0, vertex_count = 4, bounds_index = 0xffffffff,
}
```

### Entry module: IRQ service and ownership

```lua
function irq(flags)
	if (flags & 0x00000008) ~= 0 then
		result.done_count = result.done_count + 1
	end
	if (flags & 0x00000010) ~= 0 then
		result.error_count = result.error_count + 1
	end
	if (flags & 0x00000018) ~= 0 then
		result.service_sequence = result.service_sequence + 1
	end
	*irq_ack = flags & 0x00000018
end

-- Own GEO and only its two completion sources; preserve unrelated pending.
*irq_mask = 0
*fault_ack = 1
*irq_ack = 0x00000018
*irq_mask = 0x00000018
```

### Entry module: Transform two spans

```lua
-- 1. One source square, two matrices, two output polygons and two AABBs.
src->src0 = transform_records
src->src1 = square
src->src2 = transforms
src->dst0 = &result.vertices[0]
src->dst1 = &result.bounds[0]
src->count = #transform_records
param->param0 = 0
param->param1 = 0
param->stride0 = sizeof(geo_manual_xform_record)
param->stride1 = sizeof(geo_manual_vertex)
param->stride2 = sizeof(geo_manual_transform)
local xform_sequence<const> = result.service_sequence
*command = 0x20
while result.service_sequence == xform_sequence do
	halt_until_irq
end
result.observations[0].status = *status
result.observations[0].processed = *processed
result.observations[0].fault = *fault
result.completed_phase = 1
```

### Entry module: Read the transformed polygons with SAT2

```lua
-- 2. SAT2 reads the transformed Q16.16 output directly.
src->src0 = sat_pair
src->src1 = sat_shapes
src->src2 = &result.vertices[0]
src->dst0 = &result.sat
src->dst1 = 0
src->count = 1
param->stride0 = sizeof(geo_manual_sat_pair)
param->stride1 = sizeof(geo_manual_sat_shape)
local sat_sequence<const> = result.service_sequence
*command = 0x21
while result.service_sequence == sat_sequence do
	halt_until_irq
end
result.observations[1].status = *status
result.observations[1].processed = *processed
result.observations[1].fault = *fault
result.completed_phase = 2
```

### Entry module: Stage binary32 shapes and submit a candidate

```lua
-- 3. Candidate-pair OVERLAP2D: explicit F32 operands, not the Q16 buffer.
result.shape.kind = 1
result.shape.data_count = 4
result.shape.data_offset = 16
result.shape.bounds_offset = 16
result.shape.bounds[0] = 0
result.shape.bounds[1] = 0
result.shape.bounds[2] = 4
result.shape.bounds[3] = 4
result.instances[0].shape = &result.shape
result.instances[0].tx = 0
result.instances[0].ty = 0
result.instances[0].layer = 1
result.instances[0].mask = 1
result.instances[1].shape = &result.shape
result.instances[1].tx = 1
result.instances[1].ty = 1
result.instances[1].layer = 1
result.instances[1].mask = 1
src->src0 = &result.instances[0]
src->src1 = candidate
src->src2 = 0
src->dst0 = &result.contacts[0]
src->dst1 = &result.summaries[0]
src->count = 1
param->param0 = 1
param->param1 = 1
param->stride0 = sizeof(geo_manual_instance)
param->stride1 = sizeof(geo_manual_candidate)
param->stride2 = 2
local candidate_sequence<const> = result.service_sequence
*command = 0x22
while result.service_sequence == candidate_sequence do
	halt_until_irq
end
result.observations[2].status = *status
result.observations[2].processed = *processed
result.observations[2].fault = *fault
result.completed_phase = 3
```

### Entry module: Run a full pass

```lua
-- 4. Full pass over the same instances; no candidate stream.
src->src1 = 0
src->dst0 = &result.contacts[1]
src->dst1 = &result.summaries[1]
src->count = 2
param->param0 = 2
param->stride1 = 0
param->stride2 = 0
local full_sequence<const> = result.service_sequence
*command = 0x22
while result.service_sequence == full_sequence do
	halt_until_irq
end
result.observations[3].status = *status
result.observations[3].processed = *processed
result.observations[3].fault = *fault
result.completed_phase = 4
```

### Entry module: Observe a record fault and acknowledge it

```lua
-- 5. A bad XFORM2 record produces ERROR, not an empty successful batch.
src->src0 = bad_record
src->count = 1
param->stride0 = sizeof(geo_manual_xform_record)
local error_sequence<const> = result.service_sequence
*command = 0x20
while result.service_sequence == error_sequence do
	halt_until_irq
end
result.observations[4].status = *status
result.observations[4].processed = *processed
result.observations[4].fault = *fault
*fault_ack = 1
result.acknowledged_status = *status
result.acknowledged_fault = *fault
result.completed_phase = 5
```

### Entry module: Recover with zero-count completion

```lua
-- 6. After local ACK, a zero-count command completes without reading records.
src->count = 0
local empty_sequence<const> = result.service_sequence
*command = 0x20
while result.service_sequence == empty_sequence do
	halt_until_irq
end
result.observations[5].status = *status
result.observations[5].processed = *processed
result.observations[5].fault = *fault
*irq_mask = 0
result.final_irq_flags = *irq_flags
result.completed_phase = 6
while true do
	halt_until_irq
end
```

### Interpret the retained results

The eight output vertices describe squares [0,4] × [0,4] and [1,5] × [1,5].
Both optional AABBs agree with those extents. SAT2 returns the five words
`1,0,00010000H,00030000H,0`: a hit, +Y unit normal, depth 3 and A's edge 0.
OVERLAP2D returns normal (0,-1), depth 3 and contact point (2.5,2.5), with piece 0
from each instance and feature 0. **Do not interchange the normal directions:**
SAT2 points A→B here, while OVERLAP2D points B→A.

Each overlap summary contains one result, one exact pair, one broadphase pair
and zero flags. The candidate preserves 12345678H; the full pass produces 1 for
instance pair (0,1). Full-pass PROCESSED is 2 although only one unordered pair
was tested: the final outer instance is still a record. The complete processed
sequence is 2,1,1,2,0,0.

The deliberate bad record yields STATUS 6 and FAULT 00080000H. Its flags are
rejected before any vertex or matrix is fetched. Central IRQ acknowledgement does not clear that local fault;
FAULT_ACK then clears it and leaves STATUS 2. The final zero-count XFORM2 job
succeeds without fetching the still-programmed bad record. The handler totals
are five DONE services and one ERROR service. Owned pending bits are clear,
MASK is zero, and unrelated pending sources need not be zero.

These retained observations are ordinary program data, not extra GEO
registers. Keep source and output buffers under the ownership rules above;
the later fault does not invalidate or erase the earlier successful results.
