# GTE manuscript: paragraph assignments

This is an editorial work list, not a chapter-local contents page or a publication
manifest. The current draft is incomplete. Existing source and print checks do not
certify the learning outcomes below. Paragraphs are merged into `gte.md`; this list
does not add a document assembler or another test gate.

Each assignment must deliver readable English prose, the applicable raw-word
representations, worked values where useful, and narrow source/derivation evidence.
Hardware behavior comes from BMSX spec leaves and live mirrored owners. Mathematical
conventions are explained as software choices, not attributed to the machine.

## Programming explanations

| Paragraph | Reader must be able to do this | Current state / assignment |
|---|---|---|
| P01 — Unit boundaries and a complete picture | Distinguish geometry, color, primitive submission, drawing and scanout; identify every software hand-off. | Draft exists; final reader acceptance pending. |
| P02 — Installed resources and timing | Locate capacities, word widths, clocks and real versus nominal cycle guarantees; identify unspecified physical guarantees. | Partial; physical bus/core specifications remain open. |
| P03 — Raw quantities and numerical range | Encode signed halves, coefficients, coordinates, offsets, gains and colors; choose SF/LM and predict truncation/overflow. | Draft exists; operation-specific boundary examples still needed. |
| P04 — Coordinate spaces | Choose model, world and view coordinates and a screen convention without assuming the unit supplies a camera or handedness. | Separate paragraph draft written; merge and independent reader review pending. |
| P05 — Constructing a transform | Build and pack a non-identity rotation/scale plus translation, and explain which row produces which result. | Separate paragraph draft written; merge and independent reader review pending. |
| P06 — Composing transforms | Compute a parent/local or view/model combination with explicit intermediate precision and clobber management. | Matrix writer. |
| P07 — Perspective and usable geometry | Choose H and offsets, explain the visible range and near-plane hazards, and separate arithmetic saturation from clipping. | Partial draft; fuller worked boundary treatment needed. |
| P08 — Triangle state lifetime | Associate vertices with screen/depth histories; preserve flags, area and depth before subsequent commands overwrite them. | Worked draft exists. |
| P09 — Normals and lighting inputs | Construct a meaningful light/color setup and explain the supplied normal, dot products, gains and ambient contribution. | Separate paragraph draft written; merge and independent reader review pending. |
| P10 — Material/color choices | Choose unmodulated, base-color-modulated and depth-cued commands; program a non-identity lighting example. | Separate paragraph draft written; merge and independent reader review pending. |
| P11 — Depth-cue coefficients | Select near/far color behavior and IR0/DQA/DQB values, with quantization and endpoint qualifications made explicit. | Lighting writer. |
| P12 — Interpolation and general arithmetic | Use GPF/GPL/INTPL/OP/SQR in actual calculations while managing color pushes, sign and intermediate precision. | Not yet developed as programming lessons. |
| P13 — Timed independent multiply-add | Run multiple PLUS commands, preserve results and budget operand/issue/readout cycles without treating an arithmetic ceiling as sustained throughput. | Single-command draft; repeated-work example needed. |
| P14 — From results to drawing | Select constant-color versus vertex-color packets; submit the retained coordinates/colors without implicit GTE/GPU coupling. | Constant-color route exists; vertex-color route needed. |
| P15 — Framebuffer and display ownership | Keep drawing coordinates, local-memory stride, storage format and the display window consistent; publish at the correct edge. | Single-frame route exists; repeated-frame explanation needed. |
| P16 — Complete cartridge example | Follow actual executable guest code through initialization, geometry, drawing, synchronization and another frame, not only isolated owner callbacks. | Executable guest cartridge and headless captures exist; BLua pointer/word representation independently audited. Manuscript lesson and merge review pending. |
| P17 — Numeric failure diagnosis | Work through divide overflow, screen saturation, IR/MAC overflow, signed rounding and flag preservation with observable values. | Rules exist; diagnostic worked cases incomplete. |
| P18 — Cycle budgeting | Count actual preparation, transfer, issue, wait and readout work for a complete sequence; state the limits of the timing contract. | Local costs exist; full sequence budget incomplete. |

## Command-reference paragraphs

Each command is a separate assignment. A usable entry must state purpose and
selection, full encoding/options, input representations, explicit ordered
calculation, overwritten/preserved state, flags, timing, and a worked case that
exercises its distinction from related commands. Shared definitions may be cited,
but must not substitute for the command's actual calculation.

| Paragraph | Command | Current state / assignment |
|---|---|---|
| C01 | RTPS | Separate full entry written; merge and independent reader review pending. |
| C02 | RTPT | Instruction writer: full triple-vector/FIFO entry. |
| C03 | MVMVA | Instruction writer: selector/precision/two-pass entry. |
| C04 | NCLIP | Short entry exists; full overflow/winding worked treatment needed. |
| C05 | OP | Short entry exists; actual cross-product calculation/packing example needed. |
| C06 | AVSZ3 | Short entry exists; full-product, scale and saturation examples needed. |
| C07 | AVSZ4 | Short entry exists; four-entry history and normalization examples needed. |
| C08 | NCS | Short entry exists; unmodulated scale/calculation example needed. |
| C09 | NCT | Short entry exists; explicit three-normal state/output example needed. |
| C10 | NCCS | Numerical example exists; formal calculation and option cases incomplete. |
| C11 | NCCT | Short entry exists; explicit batch/modulation example needed. |
| C12 | NCDS | Short entry exists; complete cue calculation and truncation example needed. |
| C13 | NCDT | Short entry exists; per-vertex coefficient/state explanation needed. |
| C14 | CC | Short entry exists; preloaded IR/color-matrix example needed. |
| C15 | CDP | Short entry exists; starting-state distinction and cue example needed. |
| C16 | DPCS | Numerical example exists; formal two-pass and option/boundary cases incomplete. |
| C17 | INTPL | Short entry exists; signed IR interpolation example needed. |
| C18 | DCPL | Short entry exists; modulated input/truncation worked treatment needed. |
| C19 | DPCT | Short entry exists; consuming/pushing the same FIFO requires an explicit trace. |
| C20 | SQR | Short entry exists; scale/wrap/clamp worked treatment needed. |
| C21 | GPF | Short entry exists; signed scalar and unavoidable color push example needed. |
| C22 | GPL | Short entry exists; visible MAC accumulation and SF-dependent input scaling example needed. |
| C23 | VMAD3 | Numerical example exists; repeat/saturation/invalid-command cases incomplete. |

## Register and exact-arithmetic reference

| Paragraph | Required reference content | Current state |
|---|---|---|
| R01 | Vector, RGBC and OTZ words: formats, accesses, consumer commands and useful ranges. | Raw inventory exists; usage ties must match final command entries. |
| R02 | IR, screen/depth/color histories and aliases: reads, writes, pushes and lifetime diagrams. | Contract exists; history/alias traces need reader review. |
| R03 | MAC, packed-color and leading-sign ports: visible versus retained arithmetic and side effects. | Contract exists; worked port use incomplete. |
| R04 | Three matrices/control vectors: packing, function-dependent meaning and scale. | Inventory exists; integrate P04–P11 conventions. |
| R05 | Projection and depth coefficients: interpretation, readback quirks, units and consuming stages. | Inventory exists; integrate P07/P11. |
| R06 | FLAG, COMMAND and CYCLES: complete words, fields, reset and every access/visibility rule. | Contract exists; retain exact arithmetic distinctions. |
| R07 | PLUS words, pending/published sets and flags. | Contract exists; integrate repeated-work treatment. |
| A01 | Ordered MAC44/word wrap, shift/clamp and cumulative overflow. | Exact definitions exist; connect diagnostic examples. |
| A02 | Every projection stage including special IR3 test and the reciprocal calculation. | Exact definitions/257-byte ROM exist; self-contained command entries incomplete. |
| A03 | Color stages and every intermediate shift/clamp; synthetic matrix and cv=2 behavior. | Exact definitions exist; do not idealize interpolation. |

Completion is assessed against these reader tasks, not manuscript page count.
Source checks, numeric execution, reader review and PDF inspection remain distinct
evidence. No single successful check closes the other work.
