# GTE lighting reference and material extension

## Accepted finite scope — 2026-10-18

The existing `gte_cue_manual` cartridge is extended in place: 221 entry lines
and 29 const/BSS lines, one common typed ROM setup, depth stage A followed by
NCS reference/NCCS material stage B. No duplicated cartridge/setup, mutable
register-image table, local ABI helper, runtime/BIOS/compiler/renderer change,
publisher/CSS change or new framework is introduced. The historical cue review
identifies the earlier accepted baseline, not a second current program.

Fresh paired-owner facts are in [gte-material.md](../facts/gte-material.md).
Separate fresh facts-only GTE and display paragraph authors supplied the new
prose. No architecture document or historical reference PDF supplied facts.
Before implementation, the production PSn00bSDK GTE example was inspected for
operand storage and separate draw/display hand-off, not BMSX values or APIs.

## Actual execution and image evidence

The exact existing four-command development route passes: product build,
cartridge build, `depth_cue_and_display_words` integration case, then ordinary
ROM/timeline capture. Final logs are `/tmp/bmsx-gte-material-final-{product,
cart,guest,capture}.log`. All original four depth rows/flags/IR0/raw probes and
three new material RGB2/FLAG/GX16 rows pass. Retained original-surface probes,
queried firmware exclusion, both fresh VBlank sequences and final framebuffer
selection pass separately; these probes are not full-frame proof themselves.

The ordinary-ROM timeline captures A at frame1 and B at frame4. A remains
byte-identical to the accepted original depth plate; B is copied unmodified
from the actual256×192 capture. Root and an independent source reviewer each
check all49,152 decoded RGBA pixels against the three56×96 rectangles plus
black background: zero mismatches. Both actual PNGs were individually viewed.
Capture alphaFF is not evidence for PCRTC sample alpha80. Chosen callback/frame
points are not fixed presentation latency or a general surface-release rule.

| Final artifact | SHA-256 |
|---|---|
| Cartridge build artifact | ad4b2c2f9076688fc8615dcb2f583fb1c181840012bc9b93858ca2bdebce2c2e |
| Ordinary cartridge ROM | d65b446c87313e072b0dc9db2da4d74fe301817535129446e94d37e080f87e7d |
| Entry module | dae3eae899841ecac6bca8a0372650e3aa05eb3fe7fad0d3d412763d0d496900 |
| Const/BSS module | ba3537eb3c75c161d7aa1e2d53d7f9028ec31f4435de2440db4db93133b0daf7 |
| Depth PNG | 975a115d75f1bd4fe87684c5c48e8c6eee2cd015ae8acbb655ef7d7abd244b9c |
| Material PNG | c744a0241d8e51204c0cdb95122461284949915e58d19ee65f362766d824c645 |
| Installed BIOS ROM | 01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664 |
| Headless-tooling product | a38274f9eea37a4a4a759a3d0b11c72fe8170e525d2eaf0ffe1a41d069c43470 |

All43 existing TS GTE tests and19 manual tests pass. Print acceptance is
separate in [gte-print.md](gte-print.md), not inferred from those test results.
The first proof rejected overflowing expressions; explicit source line breaks
were followed by ordinary rebuild/assert/capture. Final image bytes are unchanged.

## Independent actual-source review

The nonauthor reviewed the cart/test/timeline delta and entire combined public
example against the actual paired GTE/GPU/PCRTC/IRQ owners and BIOS reservation
producers, without reading these fact sheets/reviews or a PDF. No behavioral
or representation blocker was found. Direct integer-stage recomputation gives
light MAC(3482,1228,-3277), limited IR(3482,1228,0), color MAC(4045,3481,1612)
and all three published RGB2/FLAG rows. Both owners agree on NCS/NCCS consumption,
raw clipping/offset versus C0 addressing, GX16 conversion, framebuffer base,
pending/masked IRQ and latch ordering. The strengthened firmware check covers
both chosen surfaces; no general allocation claim follows.

The reviewer independently byte-compared all nine literal fences to current
sources and viewed/decoded/checked every material pixel. Its only finding was
two trailing spaces, now removed. Source ranges and derived values are frozen
in the linked fact sheet; the finite report is
`/tmp/bmsx-gte-material-program-review.md`. Ordinary runtime/capture execution,
guide route, fresh reader and PDF checks remain separate root/reader evidence.

## Independent public-only reader

A fresh reader saw only the combined public section, its two PNGs and linked
getting-started subsection, never the companion producer/tests/owners. The
reader reconstructed results, eight ordered entry blocks and complete manifest.
Root byte-compared all three files with the executed originals: exact matches.
There are nine Lua fences totaling250 source lines, with no missing setup.

The reader distinguishes NCS RGB-ignore/CODE-retain from NCCS material use,
nonconsumption of retained IR0, per-command FLAG, GTE bytes versus GX16/display,
relative draw coordinates versus absolute C0 probes and framebuffer base,
exclusive ownership and non-reuse. Both pictures and the final two-image build
route pass this bounded reader check. Initially stale one-image guide prose
was corrected and independently reread; no execution or PDF navigation claim
is inferred from that reader PASS. Report:
`/tmp/bmsx-gte-material-public-reader.md`.

## Limits

This accepts the bounded extension, not the entire chapter/console/manual,
all commands, native/accelerated-backend parity, physical timing, all-address
allocation, a generic frame loop or fresh-OS SDK installation. Both surfaces
are disjoint and never reused after stage B; GPU idle and a fresh callback do
not establish a universal reader-release protocol. NAV01 portable PDF delivery
and the supplied near-plane contrast remain separate work.
