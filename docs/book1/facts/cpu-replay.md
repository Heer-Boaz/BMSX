# Bounded paired CPU decode and charge observations

2026-10-17, live baseline375de6170. Scratch programs only; no runtime, helpers or publisher changes. Central instruction writer and existing test-ROM linker construct both actual execution images. Each starts from a proper system image/reset vector, not an empty-ROM fixture. Native fixture uses existing Blua32 test-ROM support and current built CPU library. Current TypeScript and native scratch logs match exactly,13rows for12cases. No unsupported scalar kind, corrupt metadata, top-of-address-space PC wrap, LOADKR exceptional index or LOADNIL zero-top observation is asserted here.

Producers and actual logs: /tmp/bmsx-cpu-probe.ts; /tmp/bmsx-cpu-probe.cpp; /tmp/bmsx-cpu-probe-cases.json; /tmp/bmsx-cpu-probe-{ts,native}.log. Cases use DYNAMIC_RAM_BASE from owning spec, not a foreign-console address. The common case description names DYNAMIC_RAM_BASE symbolically; both constructors consume the central constant.

| ID | Actual executed body | Common exact observation |
|---|---|---|
| RP01 | K1 with ABC EXT_A=1 writes R64; MOV with EXT_B=1 copies R64 to R0; RET0,1 | Number1, total4cycles |
| RP02 | WIDE A=1, ignored prefixEXT=ABH; K1 body A0; MOV with EXT_B=4 reads R256; RET0,1 | Number1,total4cycles |
| RP03 | Narrow KSMI all20 signed immediate bits1; RET0,1 | Number-1,total3cycles |
| RP04 | WIDE B=63 plus same KSMI all26 signed immediate bits1; RET0,1 | Number-1,total3cycles |
| RP05 | K0 R0; EQ expectedfalse comparing R0/R0; WIDE+K1 R0; RET0,1 | Number0,total4cycles; full prefixed instruction skipped without its body's base charge |
| RP06 | WIDE+JMP sBx1; skipped K0; K1R0; RET0,1 | Number1,total4cycles; target relative to end of full8byte branch |
| RP07 | LOADK R0,RAMbase; LOAD_MEM_D R1,R0,Word with dispFFH; RET1,1; RAMbase+1020 initialized11223344H | Number287454020,total5cycles; unsigned disp255*4 |
| RP08 | LOADK R0,RAMbase; LOAD_MEM R1,R0,Word; RET1,1; RAM value99 | Grant2 admits load after LOADK1cycle, ends remaining-1/consumed3 before RET; later RET completes with Number99,total5cycles |
| RP09 | LOADK RAMbase toR0; five K1 destinationsR1..R5; STORE_MEM_WORDS A1,B0,C0; RET0,1 | total10cycles; no writes |
| RP10 | Same, C1 | total11cycles; word0=1,word4=0 |
| RP11 | Same, C4 | total11cycles; word0=1,word4=0 |
| RP12 | Same, C5 | total12cycles; word0=1,word4=1 |

The counted-store prefix setup costs6cycles, RET2. Thus the counted instruction itself is2,3,3,4cycles for0,1,4,5words. Compare against instruction-spec BASE_CYCLES and owning charge path in memory/control sheet; this replay does not add an electrical bus rating or a port readiness guarantee. Scratch calls have ample positive budget except the explicit2cyclegrant; no interrupt/per-device work is scheduled. Native execution is of these raw tests, not the new ordinary CPU cartridge. Current ordinary cartridge has separate execution observations.
