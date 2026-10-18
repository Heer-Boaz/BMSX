# BIOS string.find fourth-argument boundary — finite SF1 addendum

Read-only source reconciliation at supplied HEAD `f3a86b01c`. Additive to `/tmp/bmsx-bios-string-pattern-next-facts.md` and `/tmp/bmsx-bios-string-pattern-gap-closure.md`; not a revalidation of their other facts. No runtime execution, repository edits, fixes, architecture/PDF/chapter inspection, or whole-system audit was performed in this pass. Root-side ordinary-BLua execution is separate evidence.

## Atomic source facts

| ID | Fact | Single source location |
| --- | --- | --- |
| P01 | The BIOS pattern implementation declares four fixed parameters, `find(source, pattern, start_arg, plain)`. After the initial start-bound check, truthy `plain` returns `plain_find(source, pattern, start_index)`; otherwise matching follows the pattern path. | `machine/bios/string/pattern.lua:420-428` |
| P02 | The String export assigns `pattern.find` directly to `string.find`, without an intervening argument-filtering wrapper. | `machine/bios/string.lua:4-8` |
| P03 | BIOS main publishes the required String module as global `string`. | `machine/bios/main.lua:4-6` |
| P04 | The builtin descriptor lists only `['s', 'pattern', 'init?']` and `string.find(s, pattern [, init])`; neither field includes `plain`. | `toolchain/ts/lua/builtin_descriptors.ts:95-95` |
| P05 | The descriptor contract contains names, parameter labels, signature, optional parameter metadata and descriptions. It is a tooling metadata record, not a function record or bytecode-call record. | `toolchain/ts/lua/semantic_contracts.ts:30-37` |
| P06 | The builtin minimum-argument helper counts nonoptional, nonvararg parameter labels. Thus the descriptor's optional third label does not establish a maximum argument count. | `toolchain/ts/lua/semantic/call_signature.ts:35-56` |
| P07 | The builtin diagnostic resolver uses the descriptor to produce only a required minimum and a diagnostic label. | `toolchain/ts/lua/semantic/diagnostics.ts:357-375` |
| P08 | The call-arity diagnostic immediately accepts `actualCount >= required`; the examined diagnostic has no maximum-three rejection for a four-argument find call. | `toolchain/ts/lua/semantic/diagnostics.ts:395-415` |
| P09 | Builtin hover fallback displays the descriptor's `signature` text, with its optional description. | `toolchain/ts/lua/semantic/hover.ts:75-82` |
| P10 | A builtin signature-help candidate is built from the descriptor's `params`, parameter descriptions and description; its required count comes from the minimum-argument helper. Consequently this candidate cannot describe a fourth `plain` parameter absent from `params`. | `toolchain/ts/lua/semantic/signature_help.ts:225-237` |
| P11 | Signature help selects a candidate using argument/parameter counts, but still returns a signature when no candidate matches; the active parameter index is capped to its last described parameter. These operations return help metadata, not rewritten call arguments. | `toolchain/ts/lua/semantic/signature_help.ts:103-128` |
| P12 | The host ordinary-call lowerer derives the call argument count from `expression.arguments.length` and handles final multireturn expansion independently of any descriptor parameter list. | `toolchain/ts/lua/compiler.ts:5647-5652` |
| P13 | That host lowerer emits every fixed argument and emits CALL with the resulting fixed count, or the open-argument operand for an expanding final expression. There is no three-argument find cap in this lowering leaf. | `toolchain/ts/lua/compiler.ts:5673-5690` |
| P14 | Host function-prototype construction derives `numParams` from the source function expression's parameter count (plus implicit method self), and `isVararg` from that expression. | `toolchain/ts/lua/compiler.ts:5992-6000` |
| P15 | The firmware ordinary-call emitter likewise derives argument count from the expression arguments, visits all those arguments, and emits that count or the expanding-final-call operand. It does not consult the find descriptor. | `machine/bios/compiler/compiler.lua:648-684` |
| P16 | TS closure-frame delivery copies `min(functionRecord.numParams, argCount)` fixed arguments, nil-fills missing parameters, and retains surplus arguments only for vararg function records. A descriptor is not consulted. | `machine/ts/machine/cpu/cpu.ts:3272-3297` |
| P17 | Native closure-frame delivery copies each supplied fixed parameter up to the function record's actual `numParams`, nil-fills missing parameters, and retains surplus arguments only for vararg records. A descriptor is not consulted. | `machine/cpp/machine/cpu/cpu.cpp:3017-3043` |

## Exact disposition of SF1

**SF1 is an observed tooling-signature omission relative to the implemented BIOS function, not an observed TS/native source-owner parity disagreement.** P01–P04 name the two unequal surfaces precisely: the BIOS owns a fixed fourth `plain` parameter; the descriptor omits it from both its parameter labels and signature text.

It would be inaccurate to call the descriptor *only* signature/help: P06–P08 show its additional minimum-arity diagnostic role. It would also be inaccurate to call its three labels a three-argument compiler/runtime limit: P08 accepts counts at or above the required minimum, P12–P15 lower authored arguments, and P16–P17 deliver fixed arguments according to the function record. The examined source leaves therefore provide no mechanism by which the descriptor omission removes this fourth argument.

The two examined runtime delivery owners agree on the relevant rule. No runtime/compiler fix is requested or proposed. Recording the descriptor omission for separate tooling work does not require suppressing the implementation fact that `plain` exists. This is not a declaration that every editor binding, every source pipeline, or a normative supported-API specification has been exhaustively reconciled.

## Unchanged boundaries

- This addendum establishes source ownership and the bounded descriptor/call-delivery relationship, not an execution result. Root's named ordinary-BLua calls must be cited separately for their actual tested pipeline.
- The common Table-length STOP, seven CPU-owner questions, and BZ01 compiler question remain OPEN and were not inspected or cleared.
- No malformed-pattern, resource-exhaustion, universal tuple-width, timing, or whole-String-library guarantee is added.

## Separately executed current ordinary-BLua calls

Root validated the current debug cartridge and ran:

```sh
npm run validate:toolchain:cart -- bios_string_manual --debug
npm run headless:test -- bios_string_manual tests/carts/bios_string_manual/string_find_plain_assert.lua
```

`/tmp/bmsx-find-plain-build.log` records the current validated build;
`/tmp/bmsx-find-plain-execution.log` contains
`[test] find_plain_fourth_argument: passed`. The case has five assertions:
true selects the literal dot at2 rather than the pattern dot at1; false selects
pattern mode; String-method and captured-function calls also retain the fourth
argument; literal success returns exactly two values. This is O3 TS guest
execution in a fresh derived integration image, not native/ordinary-image
playback, every editor/source pipeline, a universal capture-result contract,
or closure of the common Table length producer.

The existing base case was also rerun against the current build:
`/tmp/bmsx-format-existing-string-regression.log` reports
`[test] string_operations: passed`. No source/BIOS/compiler/descriptor repair
was made. An initial attempt to run the un-packaged /tmp fixture was rejected;
it is not successful-execution evidence. The admitted debug-only fixture is
now packaged through the ordinary existing test source path.

Fixture SHA-256: `f26e4bc50009a2a467a4d09ac8658d1564a9cb5a6fbdb4ac3595998a9a26b831`.
