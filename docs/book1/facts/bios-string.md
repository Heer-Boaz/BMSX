# BIOS String operations: source index

2026-10-18, baseline ea4ba90ab. Current software is the authority. No
architecture document or historical PDF supplies facts. This slice is exactly
the nine base exports plus the separately indexed formatting interface, not a
complete reference for patterns, binary packing, all BIOS libraries or cartridge/
expansion devices. Book II now contains this software chapter.

- [Base-operation facts](bios-string-reference.md): actual byte/char/len,
  ASCII case, substring/reversal/repetition and mapped-byte decoder contracts,
  with paired runtime leaves, producers and exact direct-source distinctions.
- [Complete ordinary program](bios-string-example.md):37+95 actual source
  lines,32 retained assertions,9 separately observed ordinary diagnostic lines
  and final source/artifact identity. The program uses real BIOS functions,
  not a local codec or a raw String-address fiction.
- [Formatting source facts](bios-string-format.md): conversion grammar,
  complete flags/specifiers, actual numeric-text construction, argument/error/
  resource boundaries and the corrected installed `%c` two-result call chain.
- [Formatting example evidence](bios-string-format-example.md): complete27+69-line
  ordinary BLua program,18 retained assertions, separate call-result unit case
  and8 observed ordinary diagnostic lines. It does not supply native execution
  or resolve the common Table-length stop.
- [Earlier text/byte boundary](memory-strings.md) and the public Memory chapter
  own typed storage, mapped addresses, String reference versus bytes, literal
  encoding, initialization and reservations. CPU owns Number/word conversion,
  instructions, indexing, error delivery and the unresolved Table-length
  producer. Base/protected-call chapters own select/tostring/print/error/pcall;
  the table-library draft owns its actual captured helper procedures.

## Supplemental paired execution, not ordinary playback

Seven scratch bodies at O0/O3 execute the actual installed String compositor
and its real base, table, String, math/sin and coroutine dependencies through
the existing test linker, runtime and native runner. All14 programs return one
true and have equal decoded final snapshots between TS and native. Every
17-cycle grant uses the existing CPU capture/restore route. Console is the
existing empty fixture shape; these probes are not diagnostic-output evidence,
complete BIOS boot, native ordinary-cartridge execution, raw encoded-byte
equality or exhaustive runtime/optimizer/Unicode/resource validation.

The bodies cover scalar validity/result counts; signed/U32 wrapping and
nonfinite numeric inputs; wrapper ranges/case/repetition; unusual accepted
value branches; captured function versus live global dependencies; transitive
select/tostring behavior; complete, short, overlong, stray-lead and surrogate
mapped decodes. A bounded scalar-text result does not certify arbitrary corrupt
image encodings or a general validating UTF-8 parser.

Actual source/log: `/tmp/bmsx-bios-string-probe.ts` and
`/tmp/bmsx-bios-string-probe.log`. The final probe uses the actual production
String compositor, not an invented partial installation. An initial fixture
instead called the private String-index setup name directly from the test
entry and reached a nonfunction machine fault; the native runner also rejected
that image. The initial log/diagnostic is retained separately, and the owned
fixture was corrected to consume the real compositor. No runtime fix, new
public API or universal private-entry access rule was inferred from that error.

## Existing questions are not cleared

The seven earlier runtime-owner questions, generic SETT/rawset common-length
STOP and separate bios-base BZ01 compiler/source-zero question remain open.
This chapter must not claim that passing String recipes closes accepted
non-String branches that depend on the stopped common Table-length producer.
Any such required claim retains open coverage. Pattern, formatted-text and
binary-pack interfaces remain separate authoring/execution assignments.


## Independent review records

- [Nine-API contract audit](../reviews/bios-string-source.md): actual paired
  owners and source forms, not factsheet agreement alone.
- [Complete-program source audit](../reviews/bios-string-program.md): literal
  modules, retained results, separate ordinary output and exact artifact identity.
- [Public-only newcomer reconstruction](../reviews/bios-string-reader.md): no
  additional local API/assembly/observation gap; shared Table contract stays open.
- [Actual draft PDF inspection](../reviews/bios-string-print.md): all12 pages
  individually inspected, final PDF SHA256
  `75e2d3e8d8625c94bc242c26b971312639d7befa08c25137adc8bc9b4f1401a7`.
  This is rendering acceptance, not publication or final book classification.

The later user-requested reference-booklet structure/title comparison is a
separate scheduled editorial task. Current Book I / hardware-reference labels
are provisional, including for the software chapters; this slice does not
renumber books or certify their eventual title assignments.
