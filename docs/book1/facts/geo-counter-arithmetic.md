# GEO bounded fact packet — summary pair counters

Status: paired-owner representation contradiction, not an approved prose patch.
No execution, runtime mutation, harness or repository edits were performed.

Public contract: docs/book1/geo.md:259 retains full-U32 COUNT with no smaller batch limit;
geo.md:572 describes full-pass distinct pairs; :661-664 calls summary counters
U32; :666 distinguishes outer records from pairs. There is no stated wrap rule.

Paired direct evidence:
- C++ machine/cpp/machine/devices/geometry/job.h:22-23 stores exactPairCount/broadphasePairCount as uint32_t.
- C++ machine/cpp/machine/devices/geometry/overlap2d.cpp:116,143 increments those unsigned word counters;
  :29-33 publishes their words. Unsigned arithmetic wraps modulo 2^32.
- TS machine/ts/machine/devices/geometry/job.ts:16-17 stores them as number; overlap2d.ts:226,253 uses +=1
  without word narrowing. Only summary writes :139-140 apply >>>0.
- TS :173-190 / C++ :64-80 full pass can visit COUNT*(COUNT-1)/2 pairs;
  TS addressing:16-19 / C++ addressing.cpp:21-23 permit STRIDE0=0.

Consequence derived from those owners, not an observed runtime measurement:
a full pass may exceed 2^53 pair visits within the admitted U32 count domain.
At 2^53, JS number +=1 ceases advancing; C++ word counters keep advancing.
For N=134217729, N*(N-1)/2 = 2^53+2^26. With every pair counted and no contacts,
C++ final counters are 04000000H; TS counters publish zero. A repeated readable
instance with layer/mask 1 and coincident degenerate polygon vertices permits
no-contact exact visits without consuming contact capacity; zero stride avoids
requiring N distinct records. This is a representable, extremely long job.

Editorial boundary: an explicit modulo-2^32 summary-count paragraph is sensible
only after the owner discrepancy is resolved. Do not assert new physical rates,
add a count cap, alter implementation, or commission a huge replay in this audit.

Concrete source-admissible configuration (not executed):
SRC0=08100000H, STRIDE0=0, COUNT=08000001H, PARAM0=2, PARAM1=0,
DST1=08100100H. Other unused sources/strides may be zero. DST0 is never reached.
Instance at 08100000H: [08100020H, F32(0), F32(0), 1, 1].
Descriptor at 08100020H: [3,3,32,16]. Bounds at 08100030H: four F32 zeros.
Vertices at 08100040H: three (F32(0),F32(0)) records. All spans are RAM.
Full pass has no candidate self-pair check; only its distinct indices differ.
TS overlap2d.ts:219-253 / C++ :109-143 pass outer bounds and count each pair;
TS :334-358,362-401,404-454 / C++ :225-305,312-350 load valid spans and return
no contact when no nonzero edge exists. No result/capacity check is then reached
(TS :316-322 / C++ :208-214). Thus RAM extent and early faults do not cap visits.
The source-admitted consequence is derived; no practical completion time,
observed running cartridge divergence, or universal malformed-input claim follows.

Source paths abbreviated elsewhere above use the same owning geometry directory.
Root independently read the counter increments/export, native raw counter words,
full-pass loop and paired zero-stride admission. BigInt evaluation confirms the
pair total9007199321849856 and low word04000000H; directly evaluating number
2^53 plus1 retains2^53 and exports zero. This is arithmetic/source evidence,
not execution of the complete huge job. Existing finite program/plate results
and the U32 summary **layout** are not invalidated. Full-domain counter
arithmetic/parity remains unapproved; no new public count cap or runtime fix.
