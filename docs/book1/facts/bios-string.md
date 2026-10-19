# BIOS String operations: source index

2026-10-18; base extraction baseline ea4ba90ab, later formatting and current
pattern/packing slice at b515e804e plus this documentation/example worktree.
Current software is the authority; no architecture document or historical PDF
supplies BMSX facts. All seventeen installed String exports now have authored
coverage and complete ordinary examples below. The inherited Table-length
hold was subsequently resolved as recorded below; this does not certify
all-input/native behavior or finish the BIOS/manual.
Book II contains this software chapter.

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
  or establish a separate String-specific Table-length rule.
- [Pattern source facts](bios-string-pattern.md): all four interfaces, full
  grammar, reached errors, exact iterator/substitution advancement, current
  Table-only metatable lookup and caller/result boundaries. The separate
  [plain-argument card](bios-string-pattern-plain.md) records the descriptor
  omission without inventing a three-argument runtime limit.
- [Pattern example evidence](bios-string-pattern-example.md):47+122 actual
  source lines,40 retained assertions,13 separate ordinary diagnostic lines.
- [Packing source facts](bios-string-pack.md): all three interfaces and complete
  token/control/alignment/X/int/text/float procedures, category branches,
  explicit errors and actual compiled-call boundaries.
- [Packing example evidence](bios-string-pack-example.md):42+117 actual source
  lines,33 retained assertions,8 separate ordinary diagnostics; codepoint
  packets are not silently recast as mapped-byte buffers.
- [Earlier text/byte boundary](memory-strings.md) and the public Memory chapter
  own typed storage, mapped addresses, String reference versus bytes, literal
  encoding, initialization and reservations. CPU owns Number/word conversion,
  instructions, indexing, error delivery and the maintained Table-length
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

## Current length-producer disposition and remaining scope

Native owner fix `f13fad92f` closes the inherited generic SETT/rawset
boundary-refill difference. [CPU Table semantics](cpu-table-semantics.md),
section 4, records the shared scanner; [current actual instruction evidence](cpu-values-execution.md#table-boundary-refill-historical-and-current-instruction-execution)
returns `5,1,5` in 33 cycles in both runtimes. This disposition supersedes only
the linked historical supplements' Table-length STOP wording, including
ordinary helper Tables in formatting, patterns and packet operations.
Accepted Table operands and helper Tables use that CPU-owned maintained-length
rule; they are not silently restricted to String inputs. No other CPU/compiler
question, all-input execution claim or final print acceptance is closed here.


## Current independent review records

- [Contract source audit](../reviews/bios-string-source.md): bounded actual
  pattern/packing owner review, separate from earlier format/base evidence.
- [Complete-program audit](../reviews/bios-string-program.md): final literal
  modules, retained observations and separate ordinary output.
- [Reader route](../reviews/bios-string-reader.md): later fresh public-only
  understanding/reconstruction/build/observation audit, distinct from the earlier
  source-aware comparisons; no whole SDK/fresh-OS acceptance.
- [Actual draft PDF](../reviews/bios-string-print.md): current artifact identity
  and individually inspected/delta-retained pages. Old 12/19-page hashes are
  historical evidence, not acceptance of the current expanded manuscript.

The [organization review](../../manual/booklet-structure.md) and central
volume/catalog data now apply Book II — BLua32 and BIOS Reference. Title
classification is not whole-manual completion or factual publication approval.
