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

## MMIO Contract

The command uses the existing `GEO` register block.

- `src0`: instance table base
- `src1`: candidate pair table base, or `0` in full-pass mode
- `src2`: geometry arena base
- `dst0`: result table base
- `dst1`: summary table base
- `count`: input record count
- `cmd`: `sys_geo_cmd_overlap2d_pass`
- `param0`: format / control word
- `param1`: result capacity in records
- `stride0`: instance record stride in bytes
- `stride1`: candidate pair record stride in bytes, or `0` in full-pass mode
- `stride2`: `0` in v1
- `processed`: mode-dependent processed work count
- `fault`: `hi16 = fault code`, `lo16 = mode-dependent fault index`, or
  `0xffff` for submit-time reject

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
- `broadphase_pair_count`: collider pairs considered after layer/mask/space
  filtering and before exact narrowphase
- `flags bit0`: output overflow occurred
- remaining bits: reserved

## Geometry Arena

`src2` points to a persistent geometry arena in ROM or RAM.
Raw geometry is not rebuilt every frame for this pass.

Arena header:

```c
word0 version
word1 shape_count
word2 shape_table_offset
word3 reserved
```

Shape descriptor, 16 bytes:

```c
word0 flags
word1 piece_count
word2 piece_desc_offset
word3 bounds_offset
```

Piece descriptor, 16 bytes:

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
```

Primitive payloads:

- `aabb`: `left, top, right, bottom` in `s16.16`
- `circle`: `x, y, r, reserved` in `s16.16`
- `convex_poly`: vertex array `x0, y0, x1, y1, ...` in `s16.16`

All `bounds_offset` values point to a local-space 16-byte AABB:

```c
word0 left
word1 top
word2 right
word3 bottom
```

### Convex Poly Validity

For every `convex_poly` piece:

- vertices are CCW in local space
- no repeated terminal vertex
- minimum 3 vertices
- collinear adjacent edges are allowed
- zero-length edges are forbidden
- local bounds must enclose the primitive exactly

Piece indices are descriptor order. Feature indices are edge order.

## Instance Table

`src0` points to instance records. `stride0` is the byte stride.

Instance record, 48 bytes:

```c
word0 flags
word1 collider_id
word2 shape_id
word3 layer
word4 mask
word5 space_id
word6 m00
word7 m01
word8 m02
word9 m10
word10 m11
word11 m12
```

The matrix is a local-to-world affine `2x3` matrix in `s16.16`.

Single-piece and compound colliders both resolve through `shape_id`.

## Candidate Pair Table

Used only when `mode == candidate-pair`.

Pair record, 16 bytes:

```c
word0 flags
word1 instance_a_index
word2 instance_b_index
word3 pair_meta
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

Result record, 48 bytes:

```c
word0 flags
word1 collider_id_a
word2 collider_id_b
word3 nx
word4 ny
word5 depth
word6 px
word7 py
word8 piece_a
word9 piece_b
word10 feature_meta
word11 pair_meta
```

Semantics:

- `flags bit0`: hit
- `nx, ny`: world-space normal in `s16.16`, pointing from `b` toward `a`
- `depth`: penetration depth in `s16.16`
- `px, py`: final world-space representative contact point in `s16.16`
- `piece_a`, `piece_b`: winning piece indices
- `feature_meta`: winning feature metadata
- `pair_meta`: echoed from candidate input in candidate mode, otherwise `0`

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
- layer/mask/space filtering only skips logical pairs
- broadphase pruning only skips logical pairs
- surviving hits append to `dst0` in that surviving logical pair order

This ordering must not vary across implementations.

## Pair Filtering and Broadphase

The pass owns:

- layer/mask filtering
- space filtering
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

All geometry values are `s16.16`.

- multiply: signed 64-bit intermediate
- accumulate: signed 64-bit intermediate
- divide / normalize: exact helper below
- final writeback: saturate to signed 32-bit `s16.16`

Quantized negative zero must be normalized to zero.

## Normative Helpers

The following helper behavior is normative and must be mirrored bit-for-bit in
TypeScript and C++.

### `fix16_mul(a, b)`

```text
tmp = int64(a) * int64(b)
sign = -1 if tmp < 0 else 1
mag = abs(tmp)
mag = mag + 0x8000
out = mag >> 16
out = out * sign
saturate out to signed 32-bit
if out == -0 then out = 0
return out
```

### `fix16_midpoint(a, b)`

```text
sum = int64(a) + int64(b)
sign = -1 if sum < 0 else 1
mag = abs(sum)
mag = mag + 1
out = mag >> 1
out = out * sign
saturate out to signed 32-bit
if out == -0 then out = 0
return out
```

This is round-half-away-from-zero.

### `normalize_vec(x, y)`

```text
if x == 0 and y == 0:
    fault if a normal is required by the calling path

len2 = int64(x) * int64(x) + int64(y) * int64(y)
len = isqrt64(len2)

if len == 0:
    fault if a normal is required by the calling path

nx_num = int64(x) << 16
ny_num = int64(y) << 16

nx = div_round_half_away_from_zero(nx_num, len)
ny = div_round_half_away_from_zero(ny_num, len)

saturate nx, ny to signed 32-bit
if nx == -0 then nx = 0
if ny == -0 then ny = 0
return nx, ny
```

`isqrt64` and `div_round_half_away_from_zero` must be implemented with exact
integer arithmetic, not floating-point.

### `div_round_half_away_from_zero(num, den)`

```text
require den > 0

sign = -1 if num < 0 else 1
mag = abs(num)
q = mag / den
r = mag % den

if (r << 1) >= den:
    q = q + 1

out = q * sign
saturate out to signed 32-bit
if out == -0 then out = 0
return out
```

### `isqrt64(v)`

```text
require v >= 0
return floor(sqrt(v))
```

### Plane Conventions

For a directed edge `(x0, y0) -> (x1, y1)` in CCW winding:

```text
edge = (x1 - x0, y1 - y0)
normal = normalize_vec(-(y1 - y0), x1 - x0)
plane_distance(p) = dot(normal, p - edge_start)
```

Conventions:

- `plane_distance(p) >= 0` means inside
- `plane_distance(p) == 0` counts as inside
- any quantized `-0` becomes `0`

### Segment Clip Against Plane

Clipping uses directed segment `(p0 -> p1)` and one plane.

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

Implemented as exact fixed-point rational evaluation with
round-half-away-from-zero at each coordinate writeback.

Side-plane ordering for reference-face clipping is normative:

- lower side plane first
- upper side plane second

Given reference edge `(r0 -> r1)`:

```text
tangent = normalize_vec(r1.x - r0.x, r1.y - r0.y)
lower_side_plane.normal = tangent
lower_side_plane.origin = r0
upper_side_plane.normal = -tangent
upper_side_plane.origin = r1
```

### Poly/Poly Feature Selection

For `poly/poly` and `poly/aabb`:

1. Enumerate candidate axes from both pieces in piece edge order.
2. Normalize every axis with `normalize_vec`.
3. Compute overlap along every axis.
4. Choose the minimum-overlap axis.
5. Tie-break by:
   - smaller overlap
   - lower owner piece index
   - lower edge index
   - shape A before shape B
6. Winning axis owner defines the reference face.
7. Other piece chooses the incident face with minimum dot against the reference
   normal.
8. Clip incident segment against the two side planes of the reference face:
   - lower side plane first
   - upper side plane second
9. Clamp remaining points to the reference plane.
10. If one clipped point survives, `contact.point` is that point.
11. If two clipped points survive, `contact.point` is their midpoint.
12. More than two surviving points is invalid for v1 clipping.
13. `feature_meta` packs:
   - low16 = reference edge index
   - high16 = incident edge index

## Primitive Contact Policies

### `aabb/aabb`

- choose the smaller overlap axis
- tie-break X before Y
- `contact.point = center of overlap rectangle`

### `circle/circle`

- normal points from B toward A
- `contact.point = center(B) + normal * radius(B)`
- this is a representative point and does not imply a global “point on B”
  guarantee for all primitive pairs

### `circle/poly`

- evaluate all poly face normals
- evaluate one vertex axis from closest vertex to circle center
- choose the minimum-overlap axis
- tie-break face axes before the vertex axis
- if a face axis wins, project the circle center onto the winning face span and
  clamp to the face segment
- if the vertex axis wins, `contact.point = closest vertex`

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
- invalid poly topology
- required normal degenerates to zero
- source or destination range fault
- result capacity overflow

## Migration Intent

The overlap hot path is expected to migrate from:

- CPU-side piece expansion
- CPU-side world polygon staging
- CPU-side post-SAT contact reconstruction

to:

- persistent geometry arena
- instance table submission
- `GEO overlap2d_pass`
- result-table consumption only

This command is the long-term overlap path for ECS.
