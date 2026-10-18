# BIOS base services: paragraph assignments

Completion target: an experienced programmer new to BMSX can use the installed
base functions without guessing stock-Lua behavior or inspecting firmware.
This chapter is not the complete library, loader/environment or cartridge/expansion reference.
No architecture document or historical reference PDF is source material.

1. Installation and boundary: existing firmware-surface installation facts,
   actual public aliases versus BIOS closures, language values versus byte/MMIO
   words, actual CPU/Memory/protected-call/SYSTEM cross-references.
2. Value services: separate facts-only author covers assert, rawequal, type,
   tostring and tonumber, including exact accepted numeral grammar, optional nil,
   counts, identities, intermediate arithmetic, error paths and timing limits.
3. Traversal/tuple/global/output services: separate facts-only author covers
   next, pairs, ipairs, select, getglobal, setglobal and print. Explain factory
   triples versus stepping, nil positions and result counts, actual mutable
   global binding, immediate side effects and diagnostic-versus-drawn output.
4. Complete ordinary program: a separate author supplies both full BLua modules,
   typed BSS, actual BIOS calls, retained observations, ordinary diagnostic
   output, full assembly/manifest instructions and existing reproducible commands.
5. Nonauthors check every factual claim and program against actual paired owners
   and BIOS/compiler producers. A public-only newcomer checks the complete
   printed route. Every page of the actual generated PDF is viewed individually.

Use the existing publisher and tests only. No new helper, validation, review,
capture or renderer framework. Numerical/parser/library disagreements stop the
affected common claim, not authorize runtime repair. Existing seven CPU owner
questions remain open; a passing base program does not resolve them or establish
whole-console newcomer acceptance.
