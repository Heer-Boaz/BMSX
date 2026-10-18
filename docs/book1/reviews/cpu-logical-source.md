# Finite source review: CPU logical expressions

## Scope and result

Independently audited `/tmp/bmsx-logical-expressions-prose.md` and the new `### Logical expressions` subsection in `docs/book1/cpu.md` against the actual cartridge compiler and paired TS/C++ value, truth, jump, Not and fixed-result owners. `/tmp/bmsx-logical-expressions-facts.md` was only a source index. No stock-Lua specification, architecture document, historical PDF, implementation, build, new test or runtime execution was used.

**Result:** the substantive claims match the inspected owners: operand-returning single-result `and`/`or`, Boolean `not`, truth of Number zero/NaN, left-first short circuit in value and conditional contexts, and the numeric-flag/failed-general-ternary explanation. One small fault-scope clarification is recommended below. All CPU7, Table and BZ01 stops remain open. Existing module-review scope is unchanged.

## Claim audit

### Truth domain, including numeric zero and NaN

Draft quote: “Only `nil` and `false` are false-valued. Every other value is true-valued, including all numbers (zero and NaN included), the empty string, and object references.”

Direct owners:

- TS `machine/ts/machine/cpu/value_slots.ts:157–160` tests only whether the stored guest tag differs from Nil and False; it does not test the Number payload, string length or host-object truth.
- C++ `machine/cpp/machine/cpu/value.h:193–197` tests the encoded guest tag against Nil and False only. This is not a host Boolean conversion.
- C++ Number/NaN representation was also checked: `value.h:95–110,132–138` reserves encoded-tag zero for Number and canonicalizes numeric NaN to `VALUE_QNAN_MASK`, which has encoded-tag zero. Zero likewise has encoded-tag zero. Neither is mistaken for False or Nil.
- Compiler constant-condition handling agrees: `toolchain/ts/lua/compiler.ts:3294–3296` classifies only the represented compile-time nil/false values as false; relocatable values are not false. Compile-time `and`/`or` selects the short-circuit operand at `compiler.ts:3514–3521`.

Conclusion: supported. No numeric or host-language truth rule has been imported into the prose.

### Selected value, one result, no Boolean conversion for and/or

Draft quote: “`and` and `or` select an operand value without converting it to a Boolean. Each operand is adjusted to one result, so the expression produces one selected value, not multiple results.”

Direct owners:

- Dispatch to logical lowering is `compiler.ts:5351–5356`.
- `compiler.ts:5528–5533` compiles the left of `and` into the target with result count one, emits `JMPIFNOT` over the right, then compiles the right into that same target with result count one. The false-valued left remains unchanged when selected; otherwise the right replaces it. There is no Boolean load/conversion in this lowering.
- `compiler.ts:5535–5540` uses the matching `JMPIF` path for `or`, likewise retaining a true-valued left or selecting the right as one value.
- `compiler.ts:5754–5764` classifies varargs/calls, not a logical BinaryExpression, as open-result expressions. Thus a logical expression is not a way to forward all values returned by its selected operand.
- The actual call lowering emits its requested result count at `compiler.ts:5690–5696`. Fixed-one adjustment is implemented in TS `machine/ts/machine/cpu/cpu.ts:3406–3418` and C++ `machine/cpp/machine/cpu/cpu.cpp:3127–3139`: at most the requested first value is copied and a missing value becomes nil. Builtin-result adjustment agrees in TS `cpu.ts:3421–3438`.

Conclusion: supported. “Each operand” describes its adjustment when evaluated, not eager evaluation of both operands; the following sentence and table explicitly state short circuit. No multiple-result logical expression is claimed.

### Not produces a Boolean

Draft quote: “Boolean `true` if `a` is false-valued; otherwise Boolean `false`.”

Direct owners:

- `compiler.ts:5324–5332` adjusts the unary operand to one result and emits NOT.
- TS `cpu.ts:2664–2671` stores a Boolean produced by negating `ValueSlots.isTruthy`.
- C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:314–317` stores `valueBool(!isTruthy(...))`; `value.h:155–157` constructs the actual guest True/False tag.

Conclusion: supported, and correctly distinguished from selected-operand `and`/`or`.

### Left-first short circuit, side effects and faults

Draft quote: “An unneeded right operand is not evaluated, including its side effects or faults; short-circuit evaluation also applies when the expression is used as a condition.”

Direct owners:

- Value lowering `compiler.ts:5528–5540` emits a branch before the right operand's instruction sequence and patches it to the end of that sequence.
- TS `cpu.ts:2853–2863` and C++ `cpu_dispatch.inl:429–441` conditionally assign PC only; neither rewrites the tested operand. A selected left retains its guest value.
- Conditional lowering `compiler.ts:5455–5491` handles Not by reversing the requested branch sense and handles And/Or with left-first conditional jumps that skip an unneeded right. Generic operands are compiled with one result at `compiler.ts:5510–5523`.
- Constant condition handling at `compiler.ts:5448–5453,3514–3521` also follows the selected truth/operand without requiring an eager runtime right-side evaluation.

Conclusion: runtime side effects and runtime faults originating only in the skipped right evaluation do not occur on these lowering paths. This is a control-flow conclusion from the actual owners, not a new execution result or an unrestricted theorem about every optimizer transformation.

**Small wording recommendation:** replace “including its side effects or faults” with “including its side effects or runtime faults.” The source is still parsed/compiled: for example, the normal value lowering calls `compileExpressionInto` on the right while generating the instruction sequence (`compiler.ts:5531,5538`). Short-circuit runtime evaluation is not a promise that syntax or compilation diagnostics in a right operand are ignored. This is a clarity/scope refinement, not a runtime defect.

### Numeric flag and non-general ternary

Draft quote: “Thus `condition and 1 or 0` yields numeric `1` for a true-valued condition and numeric `0` otherwise: the intermediate `1` is true-valued. However, `condition and a or b` is not a general ternary expression: even when `condition` is true-valued, a selected `a` of `nil` or `false` causes `or` to select `b`.”

Direct owners:

- Actual parser groups `or` below `and`: `toolchain/ts/lua/syntax/parser.ts:1013–1018` calls the And parser for each Or operand. And in turn consumes comparison expressions at `parser.ts:1021–1022`.
- Numeric literals are emitted as their Number constants at `compiler.ts:4708–4710`; they are not Boolean literals (`compiler.ts:4714–4716`).
- Apply `compiler.ts:5528–5540` and the paired guest-truth owners above: a true condition selects Number 1 from And; Or retains it because Number 1 is true. A false condition leaves false/nil from And, so Or selects Number 0. In the general form, selecting false/nil `a` makes the enclosing Or evaluate/select `b`.

Conclusion: supported derivation. No actual ternary operator, Boolean-number conversion, multiple-result forwarding or new runtime observation is asserted.

## Snapshot hashes

Initial reviewed prose/public-file SHA-256:

```text
7f344cb198dae53b4371b87dfbf0a35a59143b4ba040b160cca99d936f788b9c  /tmp/bmsx-logical-expressions-prose.md
b85b5d5b5f1bf756e8e7f8322cf9da47a7cf337bd9436ca0a35d826dff3b1183  docs/book1/cpu.md
```

These identify the reviewed snapshot, not an unchanged whole chapter or closure of unrelated CPU/BIOS questions.

## Bounded final changed-claim recheck

The parent applied the runtime-fault qualifier. Re-read the current draft line 11 and canonical CPU line 401; both now state:

> An unneeded right operand is not evaluated, including its side effects or runtime faults; short-circuit evaluation also applies when the expression is used as a condition.

This matches the runtime/source-generation distinction established above. No further unsupported claim was found in this small subsection. No additional execution, PDF/raster verification, implementation or new test was performed by this source reviewer; any separately reported rendering evidence remains the parent's evidence. CPU7, Table and BZ01 remain open, and this recheck does not expand the prior module review.

Directly recomputed final SHA-256:

```text
70b11f8530a03da3b273eb2e93dd678b23d63edf47875162e00c52249880c490  /tmp/bmsx-logical-expressions-prose.md
3b83050c8a28398079f8ffa6fc5d3439a6e8ded2cf1cd96aed6af1540b9c16e3  docs/book1/cpu.md
```
