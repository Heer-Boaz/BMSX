# CPU chapter assignment and acceptance

## Teaching route

1. Installed CPU boundary, byte memory versus logical values, system-cycle basis.
2. Complete ordinary BLua program: arithmetic/word distinction, actual typed
   storage views and rounding, truth, a call and a surviving mutable capture.
   Give all source, starting assumptions, exact retained results and actual
   diagnostic output; no fabricated Lua register array or raw private ABI.
3. Instruction words: big-endian code, one WIDE prefix, ABC/Bx/displacement,
   signed RK selection and branch basis. Encoding range is not storage capacity.
4. Full64-opcode reference, in coherent numeric, call/object and memory/control
   families, with operands, effects and costs. Prefix is not a standalone body.
5. Charge/admission, memory readiness/retry, ordered partial faults, IRQ/HALT,
   CP0/EXEC/RFE and reset/startup boundaries. Refer to accepted Memory, IRQ and
   SYSTEM owner chapters rather than promising unwritten contracts.

## Independent section work

- Numeric extractor -> numeric author, facts only. Includes constant/copy,
  arithmetic, words/shifts, truth, length, concat, equality/order predicates.
- Call/object extractor -> call/object author, facts only. Includes frame counts,
  top, upvalues, two global namespaces and key-source instruction differences.
- Memory/control extractor -> memory/control author, facts only. Includes six
  scalar formats, addressing, readiness/preflight, partial effects, branches and
  CP0/EXEC/RFE/HALT. A later separate extraction supplies decode/reset/scheduler.
- Root integrates only frozen facts, creates/executes ordinary BLua cartridge
  and paired bounded raw CPU replays. Different section authors source-audit
  sections they did not write; a public-only reader checks the whole route.
- Actual generated PDF pages are inspected separately. No runtime/publisher
  changes, page-count target or whole-console completion inference.

## Stopped claims

Keep all paired-source disagreements in the fact index and technical follow-up,
not hidden as prose improvements or patched runtime. Positive-count LOADNIL,
existing integral LOADKR indices and six supported scalar kinds have bounded
references; that does not finish their stopped exceptional encodings. Top-of-
address-space sequential/skip PC and maxStack0 startup clearing are separately
scoped by the boundary extraction. Existing simultaneous yield/HALT precedence
is not republished as a common guarantee. Publication remains blocked where the
required common hardware contract is still open.
