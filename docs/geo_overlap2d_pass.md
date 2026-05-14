# GEO overlap2d_pass

This is the CPU-visible contract for GEO command `IO_CMD_GEO_OVERLAP2D_PASS`.
GEO is a geometry accelerator with a registerfile, command latch, status/fault
words, scheduler service, device-visible source/result memory, and deterministic
save-state state.

## Register ingress

The command uses the GEO register bank:

| Register | Role |
|---|---|
| `sys_geo_src0` | Shape descriptor table base. |
| `sys_geo_src1` | Instance table base. |
| `sys_geo_src2` | Candidate-pair table base for candidate-pair mode. |
| `sys_geo_dst0` | Result table base. |
| `sys_geo_dst1` | Summary record base. |
| `sys_geo_count` | Instance count or candidate-pair count, depending on mode. |
| `sys_geo_param0` | Mode, broadphase, contact policy, output policy. |
| `sys_geo_param1` | Result capacity. |
| `sys_geo_stride0` | Shape descriptor stride. |
| `sys_geo_stride1` | Instance stride. |
| `sys_geo_stride2` | Candidate-pair stride. |
| `sys_geo_cmd` | Command doorbell. |
| `sys_geo_status` | BUSY/DONE/ERROR/REJECTED bits. |
| `sys_geo_processed` | Processed candidate/instance count. |
| `sys_geo_fault` | Fault code and record index. |

All source/result records are little-endian u32 words in RAM. Fixed-point fields
use signed Q16.16 words.

## `param0` word

| Bits | Mask/constant | Meaning |
|---:|---|---|
| 0..1 | `GEO_OVERLAP2D_MODE_MASK` | Command mode. |
| 2..3 | `GEO_OVERLAP2D_BROADPHASE_MASK` | Broadphase mode. |
| 4..5 | `GEO_OVERLAP2D_CONTACT_POLICY_MASK` | Contact generation policy. |
| 6..7 | `GEO_OVERLAP2D_OUTPUT_POLICY_MASK` | Output overflow policy. |
| 16..31 | `GEO_OVERLAP2D_PARAM0_RESERVED_MASK` | Must be zero; non-zero rejects the command. |

Modes:

- `GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS`: read explicit candidate pairs from
  `src2`.
- `GEO_OVERLAP2D_MODE_FULL_PASS`: generate pairs from the instance table, with
  optional broadphase/filtering.

## Shape descriptor

`GEO_OVERLAP2D_SHAPE_DESC_BYTES = 16`:

| Offset | Field |
|---:|---|
| 0 | kind |
| 4 | data count |
| 8 | data offset |
| 12 | bounds offset |

Supported shape kinds:

- AABB: `GEO_PRIMITIVE_AABB`
- convex polygon: `GEO_PRIMITIVE_CONVEX_POLY`
- compound: `GEO_OVERLAP2D_SHAPE_KIND_COMPOUND`

AABB bounds records are four signed Q16.16 words: left, top, right, bottom.
Convex polygon data is an array of Q16.16 vertex pairs. Convex polygons are
limited to `GEO_OVERLAP2D_MAX_POLY_VERTICES` vertices.

## Instance record

`GEO_OVERLAP2D_INSTANCE_BYTES = 20`:

| Offset | Field |
|---:|---|
| 0 | shape index |
| 4 | tx Q16.16 |
| 8 | ty Q16.16 |
| 12 | layer bits |
| 16 | mask bits |

`layer & other.mask` and `other.layer & mask` control pair admission.

## Candidate-pair record

`GEO_OVERLAP2D_PAIR_BYTES = 12`:

| Offset | Field |
|---:|---|
| 0 | instance A index |
| 4 | instance B index |
| 8 | pair metadata |

Candidate pairs with out-of-range instance indexes fault with the candidate
record index encoded in `sys_geo_fault`.

## Result record

`GEO_OVERLAP2D_RESULT_BYTES = 36`:

| Offset | Field |
|---:|---|
| 0 | normal x Q16.16 |
| 4 | normal y Q16.16 |
| 8 | penetration depth Q16.16 |
| 12 | contact x Q16.16 |
| 16 | contact y Q16.16 |
| 20 | piece A index or `GEO_INDEX_NONE` |
| 24 | piece B index or `GEO_INDEX_NONE` |
| 28 | feature metadata |
| 32 | pair metadata |

## Summary record

`GEO_OVERLAP2D_SUMMARY_BYTES = 16`:

| Offset | Field |
|---:|---|
| 0 | result count |
| 4 | exact pair count |
| 8 | broadphase pair count |
| 12 | summary flags |

`GEO_OVERLAP2D_SUMMARY_FLAG_OVERFLOW` is set when accepted contacts exceed
result capacity.

## Timing and faults

Command write latches the register bank. GEO enters BUSY or REJECTED. Scheduler
service executes accepted work, writes result/summary records, updates
`sys_geo_processed`, and finishes with DONE or ERROR.

Fault behavior:

- bad command/register combination rejects before execution;
- malformed records fault with ERROR and record index;
- destination/source range faults are device-visible faults;
- overflow sets summary overflow and follows the output policy.

Fault codes live in `machine/devices/geometry/contracts.*`. The fault word packs
fault code in the high half and record index in the low half unless the fault has
no record, in which case the index is `GEO_FAULT_RECORD_INDEX_NONE`.

## Owners

- TS controller: `src/bmsx/machine/devices/geometry/controller.ts`
- TS command implementation: `src/bmsx/machine/devices/geometry/overlap2d.ts`
- TS constants/state: `src/bmsx/machine/devices/geometry/contracts.ts` and
  `state.ts`
- C++ controller: `src/bmsx_cpp/machine/devices/geometry/controller.cpp/.h`
- C++ command implementation: `src/bmsx_cpp/machine/devices/geometry/overlap2d.cpp/.h`
- C++ constants/state: `src/bmsx_cpp/machine/devices/geometry/contracts.h` and
  `state.h`
