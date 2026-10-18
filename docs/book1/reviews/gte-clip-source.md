# Cartridge-defined near-plane output review

## Finite scope — 2026-10-18

One complete206-line BLua program (entry180, const/results26) uses one shared
transform/projection setup for uncut ABC and constructed DBC/DCE images.
This is one known outside vertex with two inside vertices, not a general
clipper, rounding policy or attribute-interpolation implementation. The earlier
fractional-intersection lesson remains unchanged. Source facts and exact raw
rows are frozen in [gte-clip.md](../facts/gte-clip.md).

Fresh paired-owner extraction and real mapped-MMIO replay verify all three
RTPT/NCLIP rows. RTPT outputs are synchronously visible; CYCLES=23 and NCLIP8
are nominal counts, not wait protocols or complete CPU/GPU/display intervals.
A nonauthor separately reviews the actual program/test/timeline against the
paired GTE/GPU/PCRTC/IRQ owners and BIOS reservation producers. Independent
integer math gives exact D/E, all SXY/SZ/FLAG/IR0 rows and doubled areas.
No examined spec/owner contradiction remains. Separate facts-only GTE-theory
and display authors wrote the public paragraphs, without a chapter/PDF input.

## Real failures and producer correction

The first authored assertion incorrectly expected F508 rather than F288 for
RGB64,160,224. After that arithmetic correction, real guest execution exposed
the first draft's signed-coordinate mistake: BLua `i16` reads are U16LE, so
A.y read65504 and C.x65440. Interpolating those raw halves produced wrong D/E
and failed the second SXY row. Independent source inspection reproduces the
failure from `struct_types.ts:44–54`; this is not a runtime defect.

The final producer keeps signed geometry in ordinary numeric locals and emits
both original/quad typed records once. Whole-word MMIO consumes those records;
only the GTE datapath decodes signed lanes. No local sign unpacker, wrapper,
fallback, compiler/runtime/BIOS repair or copied mutable register image was
added. Diagnostic logs are retained at `/tmp/bmsx-gte-clip-guest-diagnostic.log`;
only the corrected source/actual output is published.

## Ordinary execution and actual pictures

The four-command public route completes product build, cartridge build,
`near_plane_geometry_and_display` integration case and separate ordinary-ROM
playback. Logs `/tmp/bmsx-gte-clip-product.log` and
`/tmp/bmsx-gte-clip-{cart,guest,capture}-final.log` record success. All retained
command rows, raw constructed halfwords/probes, queried firmware exclusion and
both fresh callback sequences pass. All43 existing TS GTE tests and19 manual
tests also pass; they do not substitute for the separate acceptance evidence.

Both actual native256×192 PNGs are copied unmodified from ordinary frames1/4.
Root individually viewed both and checked all49,152 RGBA pixels in each against
independent projected-edge inequalities: 288−y≤2x<224+y, original32≤y<128 and
clipped96≤y<128. Both match RGB66,165,231 on opaque black exactly;4560/2544 lit
pixels are observed raster counts, not continuous geometric areas. There is no
uncovered shared diagonal. Evidence `/tmp/bmsx-gte-clip-image-check.json`.
Frames1/4 and the two-callback hold are authored observation points, not fixed
hardware latencies. PNG alphaFF does not establish PCRTC sample alpha80.

| Final artifact | SHA-256 |
|---|---|
| Build artifact | efa013c8de05713bb9c831641d5acebf7623b880cc14ae95f5a3e3443934dff7 |
| Ordinary cartridge ROM | 2928f82f4782cb6471bf01725d48bbfd095ac1aed6b1474cddc9ccd71bf44bd3 |
| Entry module | a6686b6f72d62acfa56d68a92cd9a17529ee8500e56b14f5683cbb3d85a327db |
| Results module | 21a2fd80056e12b58832fcd7b62e874e7ab0bec0713d87c4904aee5ef48d9b96 |
| Original PNG | 433405aa2bba32253cc8086f6ff935a11090759c3627931a44a491783373d8fd |
| Clipped PNG | 752c1a8636c0b45dd6d0ef2a82c6f5032c9ea331587227849c05594dc3f264f0 |
| BIOS ROM | 01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664 |
| Headless-tooling product | a38274f9eea37a4a4a759a3d0b11c72fe8170e525d2eaf0ffe1a41d069c43470 |

## Final independent public/image and reader acceptance

The nonauthor's failures-only check of the entire new manuscript section and
linked guide reports none. It independently reconstructs all206 literal BLua
lines and the full manifest byte-exact, views both actual PNGs and compares
all49,152 pixels in each against its own geometry-derived inequalities:
zero mismatches, including the shared diagonal. Its finite record is
`/tmp/bmsx-gte-clip-program-review.md`; its independent pixel summary is
`/tmp/bmsx-gte-clip-independent-pixels.json`.

A fresh public-only reader, never given companion sources, owners, facts or
reviews, reconstructs the26-line results module, seven ordered180-line entry
blocks and full manifest. Root byte-compares all three with executed originals:
exact matches. The reader individually views both PNGs and finds no bounded
conceptual/source/geometry/caption or four-command guide gap. Ownership, raw
versus signed values, FLAG lifetime, disjoint surfaces and limits are explicit.
Report `/tmp/bmsx-gte-clip-public-reader.md`. This is not independent execution,
fresh-SDK installation or PDF-navigation acceptance.

## Evidence boundaries

The production PSn00bSDK GTE example was inspected before implementation for
typed operand storage, explicit projection/submission and separate draw/display
handoff. It supplied no BMSX address, timing, clipping behavior or API. No
architecture document or historical PDF supplied facts. No runtime, compiler,
BIOS, renderer, publisher/CSS/schema/framework/helper change was made. Only the
existing figure fixture's expected actual GTE count changes8→10.

This finite program never reuses either raw surface. GPU idle and a later
callback are not a general surface-release, atomic update or physical-latency
contract. Source/guest/image evidence does not certify native/backend parity,
fresh-OS SDK installation, portable PDF navigation, full chapter/console/series
completeness, all clipping cases or interpolation policy. Print acceptance is
separate in [gte-print.md](gte-print.md); NAV01 remains open.
