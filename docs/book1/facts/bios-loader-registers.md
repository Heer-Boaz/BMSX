# Runtime compiler register-count limit: finite source supplement

2026-10-18, baseline5b264d38a. Root directly read paired central definitions,
generated BIOS constant producer and actual compiler check; no execution proof.
Both define MAX_OPERAND_BITS=6, EXT_A_BITS=2, MAX_WIDE=(1<<6)-1=63,
BASE_OPERAND_A_BITS=8, MAX_BASE_OPERAND_A=255, and
MAX_EXT_REGISTER_A=(63<<8)|255=16383. Sources:
machine/ts/spec/blua32/instruction_format.ts:3-30;
machine/cpp/spec/blua32/instruction_format.h:10-37.
The generated firmware module exports that central value as max_ext_register_a.
Source toolchain/ts/rompack/blua32_firmware_module.ts:41.
Runtime compiler sets max_stack=isa.max_ext_register_a+1 (=16384 slots), compiles
each function, and raises if proto.max_stack exceeds that value. Exact reason:
[load:<chunk_name>] function or expression needs too many registers
(no appended source position). Source machine/bios/compiler/compiler.lua:1925-1946.
This is a generated-function total register-slot ceiling, not a guarantee of
16384 user locals/parameters, a physical register bank size, or all lower-size
program acceptance. Compiler state reserves slots for required constants and,
where present, the allocation owner before temporary space. Source
machine/bios/compiler/compiler.lua:1649-1680.
