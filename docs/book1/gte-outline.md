# GTE manuscript: paragraph assignments

This is an editorial work list, not a chapter-local contents page or a publication
manifest. The assignments below are integrated and reviewed; evidence is recorded
in `reviews/gte-source.md` and `reviews/gte-print.md`. Paragraphs live in `gte.md`; this list
does not add a document assembler or another test gate.

Each assignment must deliver readable English prose, the applicable raw-word
representations, worked values where useful, and narrow source/derivation evidence.
Hardware behavior comes from BMSX spec leaves and live mirrored owners. Mathematical
conventions are explained as software choices, not attributed to the machine.

## Programming explanations

| Paragraph | Reader must be able to do this | Current state / assignment |
|---|---|---|
| P01 — Unit boundaries and a complete picture | Distinguish geometry, color, primitive submission, drawing and scanout; identify every software hand-off. | Integrated; source, numeric, reader and print checks complete. |
| P02 — Installed resources and timing | Locate capacities, word widths, clocks and real versus nominal cycle guarantees; identify unspecified physical guarantees. | Software-contract specifications reviewed; undefined physical guarantees are explicitly deferred, not invented. |
| P03 — Raw quantities and numerical range | Encode signed halves, coefficients, coordinates, offsets, gains and colors; choose SF/LM and predict truncation/overflow. | Integrated; source, numeric, reader and print checks complete. |
| P04 — Coordinate spaces | Choose model, world and view coordinates and a screen convention without assuming the unit supplies a camera or handedness. | Integrated; source, numeric, reader and print checks complete. |
| P05 — Constructing a transform | Build and pack a non-identity rotation/scale plus translation, and explain which row produces which result. | Integrated; source, numeric, reader and print checks complete. |
| P06 — Composing transforms | Compute a parent/local or view/model combination with explicit intermediate precision and clobber management. | Integrated; source, numeric, reader and print checks complete. |
| P07 — Perspective and usable geometry | Choose H and offsets, explain the visible range and near-plane hazards, and separate arithmetic saturation from clipping. | Integrated; source, numeric, reader and print checks complete. |
| P08 — Triangle state lifetime | Associate vertices with screen/depth histories; preserve flags, area and depth before subsequent commands overwrite them. | Integrated; source, numeric, reader and print checks complete. |
| P09 — Normals and lighting inputs | Construct a meaningful light/color setup and explain the supplied normal, dot products, gains and ambient contribution. | Integrated; source, numeric, reader and print checks complete. |
| P10 — Material/color choices | Choose unmodulated, base-color-modulated and depth-cued commands; program a non-identity lighting example. | Integrated; source, numeric, reader and print checks complete. |
| P11 — Depth-cue coefficients | Select near/far color behavior and IR0/DQA/DQB values, with quantization and endpoint qualifications made explicit. | Integrated; source, numeric, reader and print checks complete. |
| P12 — Interpolation and general arithmetic | Use GPF/GPL/INTPL/OP/SQR in actual calculations while managing color pushes, sign and intermediate precision. | Integrated; source, numeric, reader and print checks complete. |
| P13 — Timed independent multiply-add | Run multiple PLUS commands, preserve results and budget operand/issue/readout cycles without treating an arithmetic ceiling as sustained throughput. | Integrated; source, numeric, reader and print checks complete. |
| P14 — From results to drawing | Select constant-color versus vertex-color packets; submit the retained coordinates/colors without implicit GTE/GPU coupling. | Integrated; source, numeric, reader and print checks complete. |
| P15 — Framebuffer and display ownership | Keep drawing coordinates, local-memory stride, storage format and the display window consistent; publish at the correct edge. | Integrated; source, numeric, reader and print checks complete. |
| P16 — Complete cartridge example | Follow actual executable guest code through initialization, geometry, drawing, synchronization and another frame, not only isolated owner callbacks. | Integrated; source, numeric, reader and print checks complete. |
| P17 — Numeric failure diagnosis | Work through divide overflow, screen saturation, IR/MAC overflow, signed rounding and flag preservation with observable values. | Integrated; source, numeric, reader and print checks complete. |
| P18 — Cycle budgeting | Count actual preparation, transfer, issue, wait and readout work for a complete sequence; state the limits of the timing contract. | Integrated; source, numeric, reader and print checks complete. |

## Command-reference paragraphs

Each command is a separate assignment. A usable entry must state purpose and
selection, full encoding/options, input representations, explicit ordered
calculation, overwritten/preserved state, flags, timing, and a worked case that
exercises its distinction from related commands. Shared definitions may be cited,
but must not substitute for the command's actual calculation.

| Paragraph | Command | Current state / assignment |
|---|---|---|
| C01 | RTPS | Integrated; source, numeric, reader and print checks complete. |
| C02 | RTPT | Integrated; source, numeric, reader and print checks complete. |
| C03 | MVMVA | Integrated; source, numeric, reader and print checks complete. |
| C04 | NCLIP | Integrated; source, numeric, reader and print checks complete. |
| C05 | OP | Integrated; source, numeric, reader and print checks complete. |
| C06 | AVSZ3 | Integrated; source, numeric, reader and print checks complete. |
| C07 | AVSZ4 | Integrated; source, numeric, reader and print checks complete. |
| C08 | NCS | Integrated; source, numeric, reader and print checks complete. |
| C09 | NCT | Integrated; source, numeric, reader and print checks complete. |
| C10 | NCCS | Integrated; source, numeric, reader and print checks complete. |
| C11 | NCCT | Integrated; source, numeric, reader and print checks complete. |
| C12 | NCDS | Integrated; source, numeric, reader and print checks complete. |
| C13 | NCDT | Integrated; source, numeric, reader and print checks complete. |
| C14 | CC | Integrated; source, numeric, reader and print checks complete. |
| C15 | CDP | Integrated; source, numeric, reader and print checks complete. |
| C16 | DPCS | Integrated; source, numeric, reader and print checks complete. |
| C17 | INTPL | Integrated; source, numeric, reader and print checks complete. |
| C18 | DCPL | Integrated; source, numeric, reader and print checks complete. |
| C19 | DPCT | Integrated; source, numeric, reader and print checks complete. |
| C20 | SQR | Integrated; source, numeric, reader and print checks complete. |
| C21 | GPF | Integrated; source, numeric, reader and print checks complete. |
| C22 | GPL | Integrated; source, numeric, reader and print checks complete. |
| C23 | VMAD3 | Integrated; source, numeric, reader and print checks complete. |

## Register and exact-arithmetic reference

| Paragraph | Required reference content | Current state |
|---|---|---|
| R01 | Vector, RGBC and OTZ words: formats, accesses, consumer commands and useful ranges. | Integrated; source, numeric, reader and print checks complete. |
| R02 | IR, screen/depth/color histories and aliases: reads, writes, pushes and lifetime diagrams. | Integrated; source, numeric, reader and print checks complete. |
| R03 | MAC, packed-color and leading-sign ports: visible versus retained arithmetic and side effects. | Integrated; source, numeric, reader and print checks complete. |
| R04 | Three matrices/control vectors: packing, function-dependent meaning and scale. | Integrated; source, numeric, reader and print checks complete. |
| R05 | Projection and depth coefficients: interpretation, readback quirks, units and consuming stages. | Integrated; source, numeric, reader and print checks complete. |
| R06 | FLAG, COMMAND and CYCLES: complete words, fields, reset and every access/visibility rule. | Integrated; source, numeric, reader and print checks complete. |
| R07 | PLUS words, pending/published sets and flags. | Integrated; source, numeric, reader and print checks complete. |
| A01 | Ordered MAC44/word wrap, shift/clamp and cumulative overflow. | Integrated; source, numeric, reader and print checks complete. |
| A02 | Every projection stage including special IR3 test and the reciprocal calculation. | Integrated; source, numeric, reader and print checks complete. |
| A03 | Color stages and every intermediate shift/clamp; synthetic matrix and cv=2 behavior. | Integrated; source, numeric, reader and print checks complete. |

Completion is assessed against these reader tasks, not manuscript page count.
Source checks, numeric execution, reader review and PDF inspection are distinct
evidence. Undefined physical clock/bus guarantees remain a separate specification
decision, as recorded in the source review; no Sony values were substituted.
