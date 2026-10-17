# Current CPU newcomer acceptance status

The bounded programming routes pass the public-only reconstruction check, but
this is **not a complete CPU-reference pass**: the new explicit cross-capacity
Table-length STOP remains a necessary contract gap. The fresh expansion review
below identifies no additional hidden programming step. Historical review of
the first draft is retained afterward, not silently reused as a fresh review.

# Independent public-only CPU reader review

## Scope

Reviewed `docs/book1/cpu.md` and the relevant public storage/startup, IRQ-wait and diagnostic-output explanations in `docs/book1/memory.md`, `irq.md` and `system.md`. The `cpu_manual` and `cpu_values_manual` companion READMEs were used only for their build/launch commands. No runtime/compiler/BIOS/cart implementation, tests, facts, architecture document or PDF was used.

## Blocking finding: Table length is still an incomplete reference

Exact chapter text, `docs/book1/cpu.md:862`:

> Cross-capacity length transitions remain incomplete in this reference. With array capacity four and keys 1 through 5 populated, deleting key 2 and then restoring it has conflicting recorded length results: 4 and 5, while key 5 remains present in both cases. No common result is specified here.

The public contract therefore still cannot tell a programmer the result of this representable mutation sequence. This known cross-capacity length STOP remains blocking a **complete** Table-length reference. The bounded eight-observation example does not resolve it; the chapter correctly says it is not a general cross-capacity rule.

## No additional necessary source-programming gaps found

Both independent programs print their result-storage module and all consecutive entry-module parts. Their initialization, typed storage, numeric-versus-word behavior and final wait can be understood from the permitted public chapters. The second program includes actual `setmetatable`, `getmetatable`, `rawget` and `rawset` calls, including explicit-nil clearing, own-entry override/deletion and a noncalled function-valued `__index`; no implementation inspection is necessary to reconstruct those calls or understand the documented outcomes.

No additional internal contradiction or misleading behavioral claim was found in the reviewed programming path. This is a reader reconstruction review, not proof of source execution, retained-result accuracy, production-owner parity or PDF layout.


---

# Independent newcomer review — CPU manuscript

## Verdict: bounded pass

The ordinary CPU-programming route is executable from the printed material, allowing the companion to supply only build and launch commands. I found no blocking hidden programming step, internal contradiction, or instruction to discover an address/API by reading implementation, BIOS or example-cart code.

Scope: I read `docs/book1/cpu.md` and the relevant public portions of `memory.md`, `irq.md` and `system.md`. I did not inspect implementation, compiler, BIOS, carts, facts, outlines, review records, architecture material or PDFs. This is a reader-usability assessment, not a factual source audit, executable validation, physical timing specification or whole-book approval.

## Route checked

- **Start and required source:** Name the separate result module `results`; use the printed `module<entry>` module; append its continuation in order; boot through the installed BIOS. No omitted user helper is needed. `print` is identified as an installed global rather than a missing import.
- **Storage:** BSS owns the result record, RODATA supplies the four bytes, and local typed views access existing addresses. Memory's startup, declaration, indexing and layout descriptions resolve zero initialization, zero-based indices, pointer-view syntax and the distinction between address and stored scalar. Its multi-module worked example also explicitly establishes the unqualified top-level struct-name convention used here.
- **Numbers and words:** The example and reference distinguish Number arithmetic, raw unsigned stored words, signed bitwise results, arithmetic right shift, masked shift counts, floating storage and truthy zero. The retained values make those distinctions observable without inventing a register-word representation for arbitrary language values.
- **Calls and captures:** The ordinary call returns a numeric result; the factory returns an actual callable closure; the captured variable survives its parent frame and is updated twice. The reference explains shared open/closed captures rather than implying a stable byte address for locals.
- **Code and data representation:** Instruction bytes, scalar byte order, byte PCs, WIDE widths, RK selection, direct/raw operands and displacement units are separately stated. The field tables suffice to derive operand/count limits without treating those limits as allocated scratch registers.
- **Counts and branches:** The different CALL/RET/VARARG count conventions and exact-top result behavior are explicit. Branch displacement is signed, word-scaled and relative to the complete instruction's end; skip behavior includes a whole prefixed instruction.
- **CP0 and privilege:** Ordinary entry is user mode; intrinsic CP0 syntax does not grant privilege. The distinction between a function-record address, instruction PC and callable value is explicit. Callback return is normal source return; the generated vector owns RFE. Memory and SYSTEM explain the installed fault/monitor route rather than promising a cartridge exception handler.
- **HALT:** The final loop is an intentional post-computation wait, not a rendering or time-delay operation. IRQ explains accepted-event retention, mask/IE gates and predicate-based service waiting. BIOS handoff's zero mask explains why a completed program need not resume merely because devices continue running.
- **Faults and timing:** Alignment, fetch failure, saved faulting PC, first-unacknowledged bus metadata, partial F64/count-store effects, blocked-store retries, base charges, surcharges and instruction-budget overshoot are usable as stated. The prose correctly bounds these as instruction accounting rather than whole-job completion or universal interrupt latency.

## Recheck and remaining findings

The initial reading raised one nonblocking question about numeric NaN/infinity in the integer-store/address conversion paragraph. I re-read the revised **Memory transfers → Scalar formats** paragraph, which now explicitly says that numeric NaN and infinities become zero on that integer path. The reader ambiguity is resolved.

No remaining missing-step finding. I did not require raw function-record construction, a new assembler workflow, unspecified malformed-encoding behavior, electrical transfer rates or completeness by chapter length.
