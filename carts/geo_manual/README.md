# GEO manual example

Normal BIOS-started BLua cartridge for the GEO chapter. It owns GEO, enables
only GEO_DONE/GEO_ERROR delivery and retains all operands/results needed for
inspection. No renderer, cartlib collision orchestrator or host test hook runs
the geometry work. The integration suite observes the ordinary cartridge.

`results.lua` declares typed layouts and explicit BSS. `cart.lua` uses named
readonly Q16.16 operands, typed scalar/register-run views and sequence-predicate
HALT waits. The floating-point shape and instances are explicitly staged in
BSS with typed F32 stores. No local encoding helpers or runtime register tables
are used. The two adjacent register runs deliberately exclude CMD/CTRL/STATUS.

## Operations and observed results

1. **XFORM2, two records.** Transform a four-vertex square spanning 0…4 with
   identity and translated-identity matrices. The eight output vertices describe
   squares 0…4 and 1…5; two AABBs have the same extents. Matrix/vertex words are
   signed Q16.16; the second translation is `(00010000H,00010000H)`.
2. **SAT2, one pair.** Read those actual transformed vertices, not a duplicate
   expected buffer. Hit 1, normal `(0,00010000H)`, depth `00030000H`, metadata 0.
3. **OVERLAP2D candidate.** Independently stage the same geometry in binary32:
   one AABB shape and instances at `(0,0)`/`(1,1)`, both layer/mask 1. It produces
   normal `(0,-1)`, depth 3, contact-point `(2.5,2.5)`, piece 0/0, feature 0 and the
   supplied pair metadata `12345678H`. The normal direction differs from SAT2.
4. **OVERLAP2D full pass.** Process those two instances without a candidate
   stream. It produces the same contact with generated pair metadata 1. Each
   summary records one result, one exact pair, one broadphase pair, flags 0.
5. **Fault.** An XFORM2 record with flags 1 yields STATUS 6, PROCESSED 0 and
   FAULT `00080000H` (BAD_RECORD_FLAGS, record 0). The handler acknowledges the
   central source, then the entry code separately acknowledges local FAULT.
   STATUS becomes 2 and FAULT 0; acknowledgement does not undo the earlier work.
6. **Recovery.** Submit XFORM2 with count 0. It completes immediately without
   consuming the still-programmed bad record. Final totals are five DONE
   interrupts and one ERROR interrupt; all six retained observations agree.

The suite checks every output vertex/bounds word, all five SAT words, both
floating-point contact records and summaries, all six status/progress/fault
observations and owned IRQ cleanup. This is normal TypeScript guest-path
evidence, not native guest execution, an electrical rate rating or an observed
display picture. GEO writes RAM; this example does not submit raster packets.

## Run

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- geo_manual --debug
npm run headless:test -- geo_manual tests/carts/geo_manual/geo_manual_assert.lua
```

The existing separate raw RAM/MMIO conformance suite covers mirrored SAT2 and
OVERLAP2D result bits, including difficult binary32 words:

```sh
npm run test:geometry-parity
```

Those vectors are not a substitute for the complete cartridge or source review.
The public chapter's printed code must reproduce these two actual modules;
its mathematical examples do not introduce another cartridge API.
