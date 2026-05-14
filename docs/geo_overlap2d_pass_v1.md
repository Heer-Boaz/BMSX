# GEO `overlap2d_pass` v1

BMSX is a fantasy console with real console discipline: this document treats
`GEO` as hardware behind MMIO registers, not as a helper API.

## Status

This document is the normative v1 hardware spec for `GEO overlap2d_pass`.
It freezes command semantics, memory formats, determinism rules, and result
ordering for both TypeScript and C++ implementations.

This command belongs to the command-table / task-processor family of hardware:
the CPU writes structured tables into memory, `GEO` consumes those tables, and
results are written back into output tables. It is not a helper-style math API.

## Scope

`overlap2d_pass` is the canonical `GEO` command for ECS overlap detection.

It owns:

- broadphase filtering in full-pass mode
- world-space bounds generation
- compound-piece pruning
- exact narrowphase
- final contact solve
- final `contact.point`
- result table emission

It does not own:

- ECS `begin/stay/end` diffing
- event emission
- gameplay resolution

Lower-level `GEO` commands such as `xform2_batch`, `sat2_batch`,
`xform3_batch`, and `project3_batch` remain valid alongside this pass.

## High-Level Rules

- Lua or BIOS code may submit colliders or candidate collider-pairs.
- Lua or BIOS code must never submit convex piece-pairs.
- `GEO` returns one terminal result record per collider-pair hit.
- `GEO` result records are final for overlap. Lua must not recompute SAT,
  normals, depth, or `contact.point` for overlap hot paths.
- In candidate mode, CPU broadphase must use transformed local bounds only.
  It must not materialize world polygon tables for overlap staging.
- The device datapath follows the same rule internally: it decodes descriptors
  into retained scratch views, reads vertices from RAM on demand, and clips
  contact polygons into a fixed Geometry-owned scratch arena.

## MMIO Contract

The command uses the existing `GEO` register block.

The cart-visible Geometry command/status/fault constants are owned by the
mirrored Geometry contract files:

- `src/bmsx/machine/devices/geometry/contracts.ts`
- `src/bmsx_cpp/machine/devices/geometry/contracts.h`

The bus I/O map owns the MMIO addresses; Geometry owns the command words,
status bits, fault codes, shape ids, and overlap policy bitfields.

- `src0`: instance table base
- `src1`: candidate pair table base, or `0` in full-pass mode
- `src2`: reserved for this command; write `0`
- `dst0`: result table base
- `dst1`: summary table base
- `count`: input record count
- `cmd`: `sys_geo_cmd_overlap2d_pass`
- `param0`: format / control word
- `param1`: result capacity in records
- `sys_geo_overlap_max_poly_vertices`: maximum vertices accepted for one
  convex-poly primitive by the OVERLAP2D scratch datapath
- `sys_geo_overlap_max_clip_vertices`: clipped-contact scratch vertex capacity
- `stride0`: instance record stride in bytes
- `stride1`: candidate pair record stride in bytes, or `0` in full-pass mode
- `stride2`: candidate-mode instance count; `0` in full-pass mode
- `processed`: mode-dependent processed work count
- `fault`: `hi16 = fault code`, `lo16 = mode-dependent fault index`, or
  `GEO_FAULT_RECORD_INDEX_NONE` / `sys_geo_fault_record_index_none` for
  submit-time reject
- `fault_ack`: write one to clear the cart-visible fault latch; the register
  self-clears to zero. It is an append-only I/O doorbell outside the original
  contiguous 16-word GEO registerfile, preserving existing downstream MMIO
  addresses.

`count` means:

- candidate mode: number of candidate pair records
- full-pass mode: number of instance records

`processed` means:

- candidate mode: number of fully processed candidate records
- full-pass mode: number of fully processed outer-loop `instance_a` records

`fault.lo16` means:

- candidate mode: faulting candidate record index
- full-pass mode: faulting outer-loop `instance_a` index

## `param0` Format Word

`param0` is a normative format/control word.

- bits `0..1`: mode
  - `1 = candidate-pair mode`
  - `2 = full-pass mode`
- bits `2..3`: broadphase policy
  - `0 = none`
  - `1 = local-bounds AABB`
- bits `4..5`: contact-point policy
  - `0 = clipped-feature point`
- bits `6..7`: output policy
  - `0 = stop-on-overflow fault`
- bits `8..15`: debug / profile flags
- bits `16..31`: reserved and must be zero in v1

Rejected submit if:

- mode is unsupported
- reserved bits are non-zero
- `stride0` / `stride1` are invalid for the selected mode
- broadphase policy is non-zero in candidate mode
- `dst0` or `dst1` is not in RAM
- aligned register or range requirements fail

Fault acknowledgement:

- execution faults leave `DONE | ERROR` set until `fault_ack` is written
- rejected submissions leave `REJECTED` set until `fault_ack` is written
- `start` and `abort` strobes are ignored while an unacknowledged fault latch is
  pending
- acknowledging an execution fault clears `ERROR` and `fault` while preserving
  `DONE`
- acknowledging a rejected submission clears `REJECTED` and `fault`

## Summary Record

`dst1` points to one 16-byte summary record:

```c
word0 result_count
word1 exact_pair_count
word2 broadphase_pair_count
word3 flags
```

Semantics:

- `result_count`: hits actually written to `dst0`
- `exact_pair_count`: collider pairs that reached exact narrowphase
- `broadphase_pair_count`: collider pairs considered after layer/mask
  filtering and before exact narrowphase
- `flags bit0`: output overflow occurred
- remaining bits: reserved

## Memory Format Ownership

The record sizes and byte offsets below are owned by the mirrored Geometry
contract files and surfaced to BIOS/cart code through `sys_geo_overlap_*`
globals. BIOS does not carry a private copy of the overlap table ABI.

## Shape Descriptors

Shape descriptors are addressed directly by the instance record. There is no
arena header and no version field in the live hardware contract.

Shape descriptor, 16 bytes:

```c
word0 primitive_kind
word1 data_count
word2 data_offset
word3 bounds_offset
```

Primitive kinds:

```c
1 = aabb
2 = circle
3 = convex_poly
4 = compound
```

Primitive payloads:

- `aabb`: `left, top, right, bottom` as IEEE-754 float32 words
- `circle`: reserved for a later command contract
- `convex_poly`: vertex array `x0, y0, x1, y1, ...` as IEEE-754 float32 words
- `compound`: `data_count` child descriptors at `data_offset`

All `bounds_offset` values point to a local-space 16-byte AABB:

```c
word0 left
word1 top
word2 right
word3 bottom
```

Bounds payload words are IEEE-754 float32 values. The BIOS AABB helper shape is
one descriptor followed by one 16-byte bounds payload; `data_offset` and
`bounds_offset` both point to that payload and `data_count` is
`sys_geo_overlap_aabb_data_count`.

### Convex Poly Validity

For every `convex_poly` piece:

- vertices are expected in CCW local-space order
- no repeated terminal vertex is needed
- minimum 3 vertices
- maximum `sys_geo_overlap_max_poly_vertices` vertices
- collinear adjacent edges and zero-length edges are tolerated by the datapath by
  skipping degenerate SAT axes
- if no usable SAT axis remains, the piece-pair is treated as non-hit rather
  than as a GEO fault
- local bounds must enclose the primitive exactly

Piece indices are descriptor order. Feature indices are edge order.

## Instance Table

`src0` points to instance records. `stride0` is the byte stride.

Instance record, 20 bytes:

```c
word0 shape_addr
word1 tx
word2 ty
word3 layer
word4 mask
```

`tx` and `ty` are world translation fields encoded as IEEE-754 float32 words.

Single-piece and compound colliders both resolve through `shape_addr`.

## Candidate Pair Table

Used only when `mode == candidate-pair`.

Pair record, 12 bytes:

```c
word0 instance_a_index
word1 instance_b_index
word2 pair_meta
```

### Candidate Pair Legality

- `instance_a_index == instance_b_index`: execution fault
- out-of-range instance index: execution fault
- reversed pairs are legal and are processed exactly as submitted
- duplicate candidate pairs are legal and may produce duplicate result records
- `GEO` performs no dedupe and no pair canonicalization

The canonical ECS overlap path is responsible for canonicalization and dedupe
before submission if it requires those properties.

## Result Table

`dst0` points to hit records. `param1` is the maximum number of result records
that may be written.

Result record, 36 bytes:

```c
word0 nx
word1 ny
word2 depth
word3 px
word4 py
word5 piece_a
word6 piece_b
word7 feature_meta
word8 pair_meta
```

Semantics:

- `nx, ny`: world-space normal as IEEE-754 float32 words, pointing from `b` toward `a`
- `depth`: penetration depth as an IEEE-754 float32 word
- `px, py`: final world-space representative contact point as IEEE-754 float32 words
- `piece_a`, `piece_b`: winning piece indices
- `feature_meta`: winning feature metadata
- `pair_meta`: echoed from candidate input in candidate mode. Full-pass mode
  emits `instance_a` in the high field and `instance_b` in the low field using
  the cart-visible `sys_geo_overlap_pair_meta_instance_*` constants.

`dst0` contains only hits. Non-hits do not write result records.

`px, py` is always a representative world-space contact point. v1 does not
guarantee that it lies on collider A or collider B specifically.

## Result Ordering

### Candidate-Pair Mode

Input order is the logical pair order.

- `GEO` processes candidate records in ascending input index
- skipped or non-hit inputs do not produce result records
- hits append to `dst0` in ascending input index order

### Full-Pass Mode

Full-pass result ordering is normative:

- iterate `instance_a = 0 .. count - 1`
- iterate `instance_b = instance_a + 1 .. count - 1`
- layer/mask filtering only skips logical pairs
- broadphase pruning only skips logical pairs
- surviving hits append to `dst0` in that surviving logical pair order

This ordering must not vary across implementations.

## Pair Filtering and Broadphase

The pass owns:

- layer/mask filtering
- compound local-bounds pruning

In full-pass mode, `broadphase policy = local-bounds AABB` means:

- transform each shape local bounds to world bounds
- use those world bounds as the pass broadphase primitive
- do not materialize full world polygon tables

In candidate mode, broadphase policy must be `0`. Any non-zero broadphase policy
in candidate mode is a submit-time reject.

## Compound Resolution

Shapes are compounds of one or more primitive pieces.

For a collider-pair:

- `GEO` evaluates candidate piece-pairs internally
- `GEO` returns at most one result record for the collider-pair
- winning piece-pair is the overlapping piece-pair with minimum penetration
  depth

Tie-break order:

1. smaller overlap depth
2. lower `piece_a`
3. lower `piece_b`
4. lower `feature_meta`

## Overflow Behavior

If a hit would exceed `param1` result capacity:

- set summary `flags bit0`
- fault with `FAULT_RESULT_CAPACITY`
- `fault.lo16 = mode-dependent fault index`
- stop immediately
- `processed = mode-dependent completed work count before the faulting unit`
- `result_count = number of hits actually written`
- `exact_pair_count` and `broadphase_pair_count` reflect completed work only

No clip-and-continue behavior is allowed in v1.

## Numeric Domain

The overlap table memory boundary uses raw 32-bit words:

- positions, translations, normals, depths, and contact points are IEEE-754
  float32 bit patterns
- layer, mask, piece index, feature metadata, and pair metadata are raw `u32`
- controllers widen float32 inputs to the runtime numeric type for SAT/contact
  work and write float32 result words back to RAM
- no fixed-point conversion helper or local rounding ABI belongs in BIOS/cart
  code for this command

### Clip Plane Convention

Convex clipping uses directed edge `(x0, y0) -> (x1, y1)` in CCW winding and
the raw edge cross product as its inside test:

```text
plane_distance(p) = (x1 - x0) * (p.y - y0) - (y1 - y0) * (p.x - x0)
```

Conventions:

- `plane_distance(p) >= 0` means inside
- `plane_distance(p) == 0` counts as inside

Clipping uses directed segment `(p0 -> p1)` and one edge plane.

```text
d0 = plane_distance(p0)
d1 = plane_distance(p1)

inside0 = (d0 >= 0)
inside1 = (d1 >= 0)

if inside0 and inside1:
    keep p1
elif inside0 and not inside1:
    emit intersection
elif not inside0 and inside1:
    emit intersection, then p1
else:
    emit nothing
```

Intersection parameter:

```text
t = d0 / (d0 - d1)
```

Implemented in the controller datapath and written back only through the
float32 result-table boundary.

### Poly/Poly Feature Selection

For `poly/poly` and `poly/aabb`:

1. Enumerate candidate SAT axes from both pieces in piece edge order.
2. Normalize each SAT axis for projection/depth calculation.
3. Compute overlap along every axis.
4. Reject as non-hit when any overlap is not positive.
5. Choose the minimum-overlap axis.
6. Tie-break by:
   - smaller overlap
   - shape A before shape B
   - lower edge index within that shape
7. Flip the chosen normal when needed so it points from `b` toward `a`.
8. Clip polygon A through every edge plane of polygon B with the clip convention
   above.
9. If the clipped intersection has vertices, `contact.point` is the average of
   those vertices. If clipping produces no vertices after SAT overlap succeeded,
   `contact.point` is the midpoint of the two piece centroids.
10. `feature_meta` is the winning edge index as a raw `u32`; it does not pack
    an incident edge or owner bit.

## Primitive Contact Policies

### `aabb/aabb`

AABB descriptors are expanded into the same CCW polygon vertex order used by the
controller datapath: left/top, right/top, right/bottom, left/bottom. Contact
selection then follows the generic poly/poly SAT rule above. Equal X/Y overlap
therefore uses the edge-order tie-break: the top-edge Y axis wins before the
right-edge X axis. For axis-aligned rectangle intersections, the clipped
intersection average is the center of the overlap rectangle.

`circle` remains a reserved primitive kind for a later GEO command contract.
The current OVERLAP2D pass rejects circle descriptors instead of applying a
partial contact policy.

## Fault Model

Submit-time reject is only for:

- bad command
- bad mode
- bad format bits
- bad register combination
- bad stride
- destination not in RAM
- misaligned pointer/register values

Execution faults include:

- bad instance index
- self-pair in candidate mode
- malformed shape or piece data
- polygon vertex count outside the device scratch capacity
- source or destination range fault
- result capacity overflow

## Migration Intent

The overlap hot path has migrated away from:

- CPU-side piece expansion
- CPU-side world polygon staging
- CPU-side post-SAT contact reconstruction

The active contract is:

- Geometry-owned shape descriptors and instance records
- instance table submission
- `GEO overlap2d_pass`
- retained Geometry scratch views plus fixed clipped-contact scratch
- result-table consumption only

This command is the long-term overlap path for ECS.
