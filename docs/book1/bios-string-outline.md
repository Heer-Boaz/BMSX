# BIOS String operations: paragraph assignments

Reader target: a programmer new to BMSX can choose every base String operation,
distinguish codepoints from encoded bytes, reconstruct the printed modules and
decode a correctly prepared mapped byte span without inspecting firmware. This
covers nine actual base exports plus the separate formatting API; pattern and
binary-pack reference paragraphs remain separately assigned work.

1. Root: installed String interface, ordinary values versus mapped byte storage,
   exact nine-name inventory, shared String-index lookup and existing CPU,
   Memory, base/protected-call and table-library contract boundaries.
2. Facts-only author A: byte, char, len and from_utf8. Describe one-codepoint
   selection versus a byte/range API, numeric word conversion, accepted scalar
   values, exact result widths, address/count ownership, decoder read ordering,
   malformed/incomplete spans, chunking, faults and memory lifetime.
3. Facts-only author B: upper/lower, sub, reverse and rep. Describe actual ASCII
   scope, codepoint positions, every default/zero/relative/fractional bound,
   clamping, normal and unusual argument branches, returned value identity,
   conversion ordering, captured/live dependencies and work/resource limits.
4. Root: complete ordinary BLua program, real readonly encoded bytes and
   caller-owned typed BSS, numeric observations, source assembly and existing
   build/retained/ordinary-output procedure. No local codec or encoding wrapper.
5. Nonauthors: contract-source and complete-program source audits, bounded
   newcomer reconstruction, then individual-page review of the actual PDF.
   Fix quoted claims rather than patching the runtime to fit the manuscript.

Every section uses a frozen fact sheet with exact source paths, not another
manual, architecture prose or a historical PDF. Intended String use must not
invent an argument validator or conceal accepted non-String branches. Existing
runtime/compiler questions remain open; if a necessary common contract is
stopped, retain the affected coverage as open rather than claiming completion
from a passing ordinary program. Use the existing publisher only.

6. Formatting reference: facts-only author from its F/C sheets; complete grammar,
   flags, all conversion algorithms, default numeric-text dependency, actual
   captured/live bindings and uncapped-work/fault boundaries. Independent source
   audit corrected length rereads, positive zero and either signed infinity.
7. Root formatting example: separate complete27+69-line BLua cart with18 retained
   checks and8 ordinary output lines. Actual execution contradicted the initial
   one-codepoint `%c` assumption; trace grouping/call production and variadic char
   consumption, document the installed pair, do not repair compiler/BIOS.
8. Independent format contract/program audit and public-reader reconstruction,
   then actual full expanded-PDF page inspection. Existing Table/CPU/BZ01 stops
   remain open; passing String-only examples do not close helper-Table contracts.
