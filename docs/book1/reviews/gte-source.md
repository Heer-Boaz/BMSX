# GTE source and reader review

## Scope and result

The expanded chapter's facts, figures and programming explanations have been
reviewed against the scoped mirrored BMSX leaves/owners and the derivations in
[facts/gte.md](../facts/gte.md). No unresolved hardware-fact, arithmetic or
reader-blocking failure remains in that scope. Print acceptance is recorded
separately in [gte-print.md](gte-print.md). This is not approval of unfinished
chapters or a claim that the software contract defines physical electronics.

No architecture document or reference-style PDF supplied hardware facts.
PSn00bSDK was consulted only for the structure of a data-driven cartridge
example, not addresses, timing, arithmetic or API behavior. No chapter assembler,
manifest, publisher branch, validation framework or runtime feature was added.

## Programming and reference coverage

The paragraph work list is [gte-outline.md](../gte-outline.md). Its reader tasks,
not page count, determined the work:

- Installed register resources, separate main/video memory, numerical widths,
  system clock, normal nominal counts and actual PLUS deadlines are explicit.
  Undefined electrical guarantees are identified rather than borrowed from
  another console.
- Coordinate spaces, a nonidentity transform and transform composition explain
  origins, basis columns, coefficient packing, scale selection and intermediate
  precision. Independent origin/basis probes and matrix arithmetic agree with
  live GTE execution. The example explicitly compares sequential and composed
  finite-precision results rather than promising equality.
- Perspective and software near-plane clipping retain the distinction between
  geometric policy and arithmetic saturation. Independently calculated clipped
  points project to the stated screens and give NCLIP areas4416/3015.
- Supplied normals, unequal-scale inverse-transpose mathematics, light/color
  matrices, material-path selection and depth-cue fitting are explained without
  inventing normal generation, normalization or automatic per-vertex cue state.
  The calibrated coefficients, limited intermediate values and one-byte
  fused-versus-reloaded difference reproduce.
- GPF/GPL/INTPL and OP/SQR are used in signed numerical calculations with their
  actual MAC/IR/color-history side effects. Numerical diagnosis separates
  signed44 events, visible32 wrap, IR/screen/depth clamps, signed rounding and
  overwritten results. Packed-IR and leading-sign examples also reproduce;
  their accesses preserve the preloaded FLAG sentinel.
- Screen/depth/color histories, aliases, flags and result lifetimes are connected
  to the complete drawing/display sequence. All76 mapped words remain in the
  register inventory; the257-byte reciprocal seed ROM matches the live owner.
  Internal links resolve to explicit authored anchors.

### Independently reviewed instruction paragraphs

All22 normal functions and PLUS VMAD3 have individual purpose/selection,
encoding/options, input representation, ordered arithmetic, modified/preserved
state, flags, timing and meaningful ordinary/boundary cases. Shared exact-stage
rules do not replace their actual command calculations.

A writer did not serve as the sole final reviewer of their command entries:

| Independent review group | Entries checked |
|---|---|
| Integrated programming/command review | RTPS, RTPT, MVMVA, NCLIP, OP, AVSZ4, NCS, NCCS, NCCT |
| Independent arbitrary-integer/owner audit | AVSZ3, NCT, NCDS, NCDT, CDP, DPCS, DCPL, DPCT, GPF, GPL |
| Independent mapped-register/CPU audit | CC, INTPL, SQR, VMAD3 |

The second group independently recomputed47 operand setups and performed94
live arithmetic runs, also setting every execution-ignored command bit. Seeded
registers and old FLAG checked results, histories and preserved state. The other
groups independently reran the displayed arithmetic and mapped-word cases,
including exceptional projection IR3 flags and real CPU PLUS interlock behavior.
Mirrored C++ was source-inspected; native execution is not claimed.

Direct arithmetic execution establishes numerical behavior and nominal return
counts, not CPU workload timing or MMIO COMMAND storage. Mapped-register tests
and actual CPU sequences supply those separate forms of evidence.

### Complete cycle intervals

The cold scalar geometry-to-RAM-packet interval independently executes120 of122
stored instructions in221 charged system cycles. It includes all38 cartridge
ROM loads,42 GTE stores,10 result loads,10 RAM stores, address/constant setup,
selection, masks and return. Operands are in real cartridge ROM10001000;
output080c1000 is caller-reserved ordinary RAM, not an IO or GTE scratch area.
The packet, three zero flags and area4096 match. The nominal23+8+39 counts
are not another70 elapsed CPU cycles.

The repeated PLUS sequence independently executes in100 cycles, retaining all
nine result/flag words at ordinary RAM080c1000. Acceptance31/55/79 and completion
36/60/84 remain distinct from input preparation, polling and RAM readout.
A separate actual CPU sequence confirms acceptance4, blocked attempt6,
completion9, retried acceptance11 and return13, with next completion still due16.
Neither sequence is advertised as the compiler lowering of every BLua loop,
a full-frame cost, or a physical/sustained throughput measurement.

## BIOS-backed executable example

The earlier named-register rewrite did not address the requested programming
model. The corrected example follows existing BIOS `struct`/`rodata` records
and explicit `bss` state. Four reusable fixed layouts live in the existing GTE
utility owner; the cart defines operand data, not another ABI or setter facade.

The actual cartridge/debug-ROM/BIOS/CPU/GTE/GPU/PCRTC path executes. Both isolated
guest cases pass: fixed operand layout and complete geometry/color/buffer
lifetime. Actual captures show the interpolated triangle and its later
translation. Reversed winding reads raw MAC0=fffff000; selection tests its sign
bit rather than incorrectly using unsigned `>0`.

All eight consecutive printed code fragments concatenate to the cartridge source
apart from print whitespace. There is no hidden setup function or separately
rendered illustration substituted for execution. Current optimized compilation
has152 operand ROM bytes,12 BSS bytes, no NEWT/GETT/SETT and only Word memory
instructions. No claim is made that the whole BIOS/machine allocates nothing.

Reproduction:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- gte_manual --debug
npm run headless:test -- gte_manual tests/carts/gte_manual/gte_manual_assert.lua
npm exec -- tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts tests/lua/struct_addressing.test.ts tests/lua/struct_scope_identity.test.ts tests/lua/section_bss.test.ts
node --import tsx --import ./tests/lua/test_setup.ts --test tests/lua/gx_gte.test.ts tests/lua/gx_gpu.test.ts
```

Focused results:2 guest cases,93 compiler/storage tests and121 GTE/GPU tests.
The guest suite was rerun after manuscript assembly. These checks do not replace
source review, independent arithmetic, reader review or actual PDF inspection.

## Corrections resolved during review

- H is an unscaled unsigned projection numerator, not a scene-depth unit.
- The nearest-Q12 error bound applies only when the rounded coefficient fits.
- Fused cue endpoints retain intermediate shifts/clamps; full weight need not
  reproduce ideal far bytes.
- Inverse-transpose normal handling is software mathematics, not a GTE feature.
- Raw MAC0 is not already a signed BLua number; winding uses explicit raw bits
  and needs the overflow qualification for general geometry.
- Display configuration latches before the system VBlank request. The repeated
  program samples its sequence after display stores and observes a later event
  before reusing the prior front buffer. GPU idle is separate.
- An early repeated-PLUS fixture used an IO destination while claiming RAM.
  Correcting it to080c1000 and rerunning the complete CPU sequence confirmed
  the stated100-cycle budget and all nine actual RAM words.
- Internal paragraph assignment labels were removed from public prose; the
  affected NCCT/CC worked setups now repeat their actual matrix inputs.

## Deferred physical specification decisions

The installed33,868,800Hz system model and logical word/cycle rules are sourced.
The inspected software does not specify an independent GTE core clock,
electrical IO bus clock or pin width, arbitration/contention schedule, or
sustained guaranteed bandwidth. The public specification table says so.

Per the user's direction to document the software contract and record remaining
specification decisions separately, these undefined physical guarantees are not
filled with estimates and do not block this chapter's publication. Defining them
would be a separate hardware-contract task, not editorial completion or a
reason to invent Sony values.

## Actual output plates — 2026-10-17

The complete cartridge's initial and translated frames now have committed,
unmodified 256×192 PNG assets. They are the NCCT per-vertex-colour program,
not the separate solid-red register continuation. Both ordinary guest cases
were freshly executed with current product/BIOS builds; each original image
was individually viewed. The eight printed program parts still match the
actual cartridge apart from indentation and blank lines.

A bounded source/image extractor froze settings, capture predicates, geometry,
colours and observed output. A fresh author used only that sheet. A nonauthor
then checked every caption claim against the actual cartridge, existing test
assertions and named GTE exports, viewed both images and independently compared
all decoded RGBA samples. The translated image equals the first shifted exactly
16 pixels right, including the unchanged gradient. No interpolation, coverage,
photometric, backend-parity, atomic-capture or physical-timing rule was inferred.
GOP01–06 in the fact sheet record the source and evidence boundaries.

The final merged placement, captions, copied bytes and fact additions were
independently rechecked: no failures. The subsequent translation example now
explicitly continues the earlier finite RTPT→NCLIP→AVSZ3 register sequence,
not the infinite cartridge above it. Its retained D[7]=1FFH and screen/depth
histories agree with the existing facts and paired live GTE write sets. This
clarification changes no address, arithmetic, result or hardware behavior.

The existing publisher now reads figure bytes and emits ordinary embedded PNG
images alongside its unchanged SVG path. An independent owner review found
one real issue: literal Markdown/entity text reached PNG alternative text.
The existing Marked text renderer and entities utilities now supply the
correct attribute representation. A second independent check and the focused
browser/PDF fixture pass, including emphasis, code, entities and quotes. Both
actual GTE images decode at native size, fit the two-column table and appear
as 256×192 PDF image objects with complete tagged alternative text. All 17
manual tests pass; no review gate was weakened.

All eight print reviews were reopened for the shared change. Before the plate
insertion, fresh SVG-only publication proofs had all 323 page rasters identical
to the old publisher's baseline. After the final alternative-text correction,
the seven unchanged chapters' 203 rasters were compared again and remain
identical. GTE's own complete actual-page review and pagination corrections
are recorded separately in gte-print.md.

No runtime, compiler, BIOS, cartlib, cartridge, test runner or capture framework
was modified. Other graphical contrasts, the GPU material plate, PCRTC
before/after output and GEO dummy-game/sprite/hull overlays remain open work;
this pair does not complete the broader visual or technical audit.
