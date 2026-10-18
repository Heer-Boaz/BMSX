# BLua source programs — bounded source and execution acceptance

Current public chapter SHA-256:
`e8f25c7b05be1f97da18694c9a73c4c8017af41cba6b3bc41a6c8c902066c289`.
Baseline `fce16b952`, 2026-10-18. **Finite source/claim pass, not a complete
language/SDK/BIOS or whole-manual publication decision.** The coverage record
keeps source-legality and `<init>` lifecycle work open; the chapter remains a
DRAFT. CPU7, common Table length and BZ01 are not closed or narrowed away.

## Independent extraction, authorship and owner review

Three read-only extractors supplied separate frozen source-form, module and
installed-environment sheets. Three fresh authors each consumed only their
assigned sheet. Root integrated them with the real six-file ordinary cartridge.
The owners/specs are the authority; no architecture manuscript or historical
reference PDF supplied a BMSX fact. A historical manual is not a source-language
specification. The actual cartridge source compiler has no invented C++ mirror;
paired runtime owners are used for emitted-value/global/truth behavior.

The production-reference prerequisite was met before editing by inspecting
CPython's [modules tutorial organization](https://github.com/python/cpython/blob/main/Doc/tutorial/modules.rst)
and [interpreter tutorial organization](https://github.com/python/cpython/blob/main/Doc/tutorial/interpreter.rst).
These informed teaching sequence only, not BMSX syntax, imports or execution;
no Python facts were sent to the section authors.

| Independent actual-owner pass | Result and correction |
| --- | --- |
| [Source forms](blua-programs-source-forms-source.md) | Full sentence/table/snippet comparison against actual lexer/parser/compiler/binder. Named `function name` was corrected so it does not imply that an existing lexical binding is bypassed. No remaining material finding in this finite scope. |
| [Modules and complete program](blua-programs-modules-source.md) | Header/path/import/export/static contracts and actual six-file behavior checked against live owners. Explicitly distinguish syntactic dependency discovery from lexical built-in recognition, and ordinary named global slots from a per-closure environment object. Both refinements rechecked. |
| [Installed environment](blua-programs-environment-source.md) | Paired banks, get/setglobal, EXEC versus reboot and actual BIOS installation/captures checked. Interface-wide failure tuple narrowed to the `load` wrapper; `_G`/`_ENV` wording remains installer-only. Changed claims rechecked. |
| [Canonical logical-expression addition](cpu-logical-source.md) | Fresh public reader found missing `and`/`or` selected-operand/short-circuit semantics in the linked CPU reference. A separate finite extraction and facts-only author supplied the missing definition, independently checked against actual compiler and paired truth/branch/NOT owners. Skipped faults are explicitly runtime faults, not compile-diagnostic immunity. |

Integration also corrected uppercase identifiers in the illustrative const
namespace, using the independently extracted lowercase-only source rule. It
keeps a distinct ordinary `lib/runtime_settings` path in generic snippets so
that the actual const `lib/settings` program module is not misclassified.
Canonical CPU/Memory definitions are linked, not duplicated as another ISA,
address map or Table-length claim. Source-review hashes are scoped to their
sections; later keep-together markup and destination links changed the assembled
file without changing those reviewed technical claims.

## Actual program evidence, separately from source review

[Executed evidence](../facts/blua-programs-program.md) records complete source
hashes, commands and actual results: 47 existing module fixtures; debug tooling
build; quality-checked real cartridge artifact; 19 retained assertions; and
five separately captured ordinary diagnostic lines. The assertions run a
fresh derived TS integration target, not byte-for-byte ordinary playback;
the ordinary run is separate. No native/cart-all-input or optimizer-wide claim.

All six final public listings reconstruct the actual executed source files
byte-for-byte (107 total Lua lines). The program owns typed BSS and only its
ordinary `modules_manual_step` global. No raw-address guess, BIOS replacement,
ABI encoder, getter wrapper, fallback, rollback or rule suppression was added.
Initial example-quality failures were fixed in the example, not in the rules.
No runtime, compiler, BIOS, publisher, stylesheet or shared harness changed.

The [source-blind reader](blua-programs-reader.md) reconstructed all six files,
tree, exact manifest, entry/module naming, fresh-boot assumption, build/check
and ordinary observation commands and all five output lines using public
material alone. It found the logical-definition gap rather than importing
Lua semantics; the canonical fix and final runtime-fault wording were rechecked.
There is no remaining actionable reader blocker for this supplied-checkout
route. This is not execution, owner verification, fresh-OS/whole-SDK/native,
whole-console or PDF acceptance.

## Figures and print

There are no generated figures, screenshots or register bit diagrams in this
source-language chapter. Its literal/operator/import/global/observation tables
and code are part of the source-review scope; no synthetic output image is
presented as captured hardware output. The independent [actual-PDF review](blua-programs-print.md)
covers all22 final DRAFT pages. Existing keep-together markup repairs observed
stranded leads; no renderer/stylesheet/new publication gate was introduced.
The new canonical CPU paragraph has its own bounded changed-page print check
in [the CPU print record](cpu-print.md).

## Final repository checks

`npm run test:manual` passes19 tests. The shared publisher preview passes
mechanical layout checks for the source chapter and changed CPU reference.
`manual:check` for the new chapter intentionally exits1 for the two recorded
coverage items, not pending source/print review: `<init>` lifecycle and the
remaining source-form legality/loop cases. No release is claimed by the DRAFT
PDF. Both working and staged diff checks pass for the committed slice.
