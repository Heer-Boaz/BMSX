# GTE source and semantic-figure review

## Scope and editorial method

The original register/datapath audit remains the basis for the unchanged 76-word
reference and exact arithmetic. The programmer-facing revision expands the source
scope to the mirrored installed model, timing initialization, CPU costs, and the
specific GPU/PCRTC paths required for a visible triangle. All source anchors and
numeric derivations are retained in [the fact sheet](../facts/gte.md).

Four nonoverlapping text assignments were written in parallel and merged into the
existing chapter. No chapter assembler, manifest, publisher branch or runtime
feature was added:

| Assignment | Finished text and evidence |
|---|---|
| Specifications writer | Capacities, clocks, CPU versus nominal cost, PLUS deadlines, bus/fault/reset programming |
| Geometry writer | Numerical conventions, matrices/projection, triangle chain, translated projection and coordinate diagram |
| Command writer | Purposes, choices, inputs, options, clobbers and hazards for all22 normal commands and VMAD3; NCCS/DPCS examples |
| Integrating editor | Complete GP0 drawing and PCRTC display continuation, merge order, cross-references and publication scope |

Each writer used the existing sheet plus explicitly recorded owner/spec expansion.
This revision is not claimed to be a fresh author's isolated facts-only pass.
Independent cross-reviews followed: geometry reviewed specifications and commands;
specifications reviewed the GPU/PCRTC continuation; command review checked the
merged scale/endpoint claims. A separate reader reviewed the complete programming
route for usability. Neither architecture.md nor the reference style PDF supplied
hardware facts. Sony reference structure was not treated as a BMSX specification.

## Findings and resolutions

The original audit corrected row-to-lane indexing (r=0–2, i=r+1) and removed an
unsupported claim of F64 non-atomicity. The exact arithmetic/access sections retain
those corrections.

The parallel rewrite found and corrected:

- H was initially described in depth units. It is now an unscaled unsigned
  projection numerator controlling screen magnification, not the scene scale.
- Generic depth-cue endpoint claims ignored intermediate shift truncation in
  modulated-color inputs. Exact endpoint teaching is restricted to the sourced
  DPCS/SF=1 case; other commands explicitly retain intermediate shifts/clamps.
- Far-color scale teaching now qualifies the SF=1 convention rather than assigning
  it universally to raw register words.
- NCLIP terminology now says doubled oriented area; winding/degeneracy claims are
  qualified by the absence of signed MAC0 overflow.
- The rendering continuation occurs before the translated projection can replace
  the triangle's screen FIFO. Its PCRTC stores explicitly warn about an intervening
  VBlank latch. The complete packet precedes the GPU-idle poll.
- Nine authored anchor targets resolve the command-reference links without changing
  the Markdown publisher.

No remaining printed-claim/source conflict was found in the reviewed additions.
That is not the same as a complete physical hardware specification.

## Open specification, not an omitted number

The model and owners establish the installed system frequency and logical
word/cycle rules. They do not establish an independent GTE core clock, physical
GTE/IO bus clock or pin width, arbitration/contended-transfer schedule, or sustained
guaranteed bus bandwidth. The specification table states these limits explicitly;
[gte.json](gte.json) retains the question as open and blocks final publication.
No nominal-cycle table or DMA RAM/ROM cost is relabeled as GTE bus bandwidth.

## Semantic figures

The two original figures retain their reviewed independent normal/PLUS data paths
and not-to-scale PLUS publication landmarks. The added projection figure plots the
worked triangle exactly at twice its coordinate scale: (96,64), (160,64), (128,128),
with projected origin(128,96), horizontal128 and vertical96 dimensions. Its axis
convention is local to the drawing, and it is explicitly not a GTE clipping window.

## Execution evidence and limits

- All22 normal command words/counts and the NCCS/DPCS example readbacks were
  independently checked through live mapped TS GTE owners, with independent integer
  calculations and mirrored C++ source checks.
- The triangle chain returns screen00400060/004000A0/00800080, doubled area4096
  and OTZ511. The translated RTPS gives transformed(96,16,1024), screen(152,100).
- The exact triangle continuation executes GP0 drawing, reaches a real scheduled
  VBlank entry, and scans out256x192. Its interior(128,96) is VRAM001F/RGB255,0,0;
  cleared(0,0) is VRAM0000/RGB0,0,0. Zero sample alpha does not suppress selected
  direct RGB. This checks the complete derived word sequence, not merely a drawing
  produced independently of the chapter.
- The original PLUS example retains its mapped-owner timing evidence: old outputs
  at cycle4 and publication at cycle5, normal GTE state unchanged.

These are owner-path/software-output results, not guest cartridge execution,
native execution, physical-bus measurements or a new TS/C++ runtime-parity claim.
A readable 37-page draft does not close the open physical timing specification.
