# BLua extension-first reference — finite source and example acceptance

2026-10-18; baseline866396a64. This delta adds a recognizable BLua-specific route before the existing source-form reference, not another general Lua tutorial or a hardware-only subset. Three separate read-only extractors supplied storage, modules and machine/instrumentation facts; fresh facts-only writers authored nonoverlapping prose. Root supplied finite operator and existing-example facts, with a fourth facts-only author. Historical PDFs and architecture.md were not inputs.

## Source review

- Storage/layout/views: independent actual parser/compiler/type owner and paired spec/CPU/memory audit, docs/book1/reviews/blua-extensions-storage-source.md. Sole finding resolved: generic LOADKR does not force String; the RODATA initializer supplies the String reference. Corrected table and paragraph independently rechecked.
- Maps/CP0/three intrinsics/HALT: independent actual compiler and paired spec/CPU/memory audit, docs/book1/reviews/blua-extensions-intrinsics-source.md. Broad read-only claim narrowed to directly resolved RODATA; aliases do not retain provenance. Reviewer accepted integrated narrowing. No other failure in bounded scope.
- Modules/static/init: root actual-owner check of separately authored prose, docs/book1/reviews/blua-extensions-modules-source.md. Ordinary no-export modules and constant-address-only implication narrowed. Checked static-call rejection, capture contract, initialization/export order and attributed-function startup distinction against actual owners.
- Operator subsection: root rechecked actual parser977-1007/927-952 and compiler4025-4039/4237-4288 for augmented spelling/order; parser1136-1196 + compiler4768-4794/5089-5095 for arrow; compiler5248-5277/3355-3356 for String/address &, lexer263-284/612-629 and parser1107-1117 for identifiers/newline-star. No generic Lua behavior imported.
- General Lua pointer and shared local<const>: primary official lua.org/docs.html and Lua5.4manual3.3.7; actual production lua/lua v5.4.8 lparser.c1599-1660 inspected only as a reference. No fixed futureBLua/Luacompatibility promise.

## Actual selected-program evidence

Existing memory_manual reused, no new duplicate cart or helper. Quality validation and retained guest case both exit0:

npm run validate:toolchain:cart -- memory_manual --debug
npm run headless:test -- memory_manual tests/carts/memory_manual/memory_manual_assert.lua

Artifact2b7326ddef694d5a4958e44823690d6e2f675fef052a114749d7adf51dc2bbc1;
ordinaryROM408f7b2295c8e60ee1e131cabab903532d0d3b15b4c5220c7acaf796660abfe9;
BIOS01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664.
Public storage32lines SHA06b3e37736f0d01984045f5d5de99ba94e1f8ff885696df6744f8a0e2290c163;
entry30lines SHA687b849e71697a83d8a73815089f36922c91dbdcbe672dcccc627995ddd61daa.
Both public listings compare literally equal to unchanged executed live cartfiles. Case startup_storage_and_scalar_copy passes, checks initial DATA/BSS, layout, counts/addresses, all six source/output words and padding. Log /tmp/bmsx-blua-extensions-memory-guest.log includes the exact retained-value summary. This is a derived TS integration image, not byte-identical ordinary playback or native/visible-output proof.

Existing focused trace_statement.test.ts:10PASS,0FAIL using actual compiler+CPU test path; /tmp/bmsx-blua-extensions-trace-tests.log. Establishes finite erase/emit/channel, sink/sideeffect cases, not ordinaryROM trace enablement. Compiler erasure/selected behavior remains source-owned. Ordinary/debugCLI defaults erase and exposes no trace switch; derivedintegration producer emits. BE01 separately records tool-interface limitation, with no fake flag or wrapper.

npm run test:manual:19PASS,0FAIL. This is publication-tool regression evidence, not semantic/runtime acceptance. No runtime/compiler/BIOS/publisher/CSS/schema/framework/helper changed. Existing general source-reference body retains all nonblank technical source lines after removing existing keep markup, except introductory program-count wording; three additional layout groups do not expand general Lua explanation; no BIOS/library chapter removed.

## Public reader

Fresh source-blind public reader reconstructs both62line modules byte-for-byte; root independently cmp-checked against live files. Full manifest/build/test/ordinary playback route recovered from existing public companion. Review is docs/book1/reviews/blua-extensions-reader.md. Initial missing lowlevelclosure producer/capture-context navigation and participant trigger are addressed in subsequent bounded source-derived bridge (record separately after recheck). BE01 is explicitly disclosed, not claimed solved. Not a freshOS/wholeSDK/ordinarytracing/wholeconsole approval.

## Limits

Source acceptance of this delta does not close LS01 repeat-local disagreement, common maintainedTablelength, CPU7, BZ01, RL01, fullSDK or wholemanual. No allinputs/native/performance/reset/media/HotResume guarantee. Still DRAFT; source and readable PDF passes do not waive actual open source questions.

## Reader-gap bridge source and final scope

Two short additions and a development-companion paragraph were separately authored
from blua-extensions-development.md facts only. Root rechecked the actual BIOS
compiler/load.lua7,21-37 and compiler/api.lua4-21 for the supplied function-record
and constant-pool capture context; source function expressions use CLOSURE directly
at compiler.ts4752-4759. No raw record extraction API is invented. Public load
and lua_compiler.compile_syntax return the callable closure, not a bare address.

The participant trigger lives in the separate development companion, not the
installed-machine narrative: actual ide/runtime/hot_resume.ts279-293,342-363,452-476
stages selected nonzero vectors and explicitly begins completion calls after
revision installation when rebuilt. It is not a normal startup hook or every-edit
guarantee. Existing init_function.test.ts:8PASS,0FAIL; this is bounded compiler/CPU
evidence, not a live IDE-interaction or native HotResume claim.

The fresh public reader independently accepts both navigation/boundary corrections.
Its accepted technical source89b901a3c6d5d313cb7f1839de72136f54a0b7d881bd37552ce63eefca27d76a
differs from final412a344a966d7a9a0687c1d4a8b7dcb03a8f0421d3c03295438a4783f178a8fb
only by one existing keep-together wrapper around the trace fragment lead/listing.
Removing that exact wrapper reproduces the accepted SHA, checked directly.
No semantic changes followed reader acceptance. LS01 remains open; BE01 is a
disclosed ordinary-ROM tooling limitation, not an implemented feature.
