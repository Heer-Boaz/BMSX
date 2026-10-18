# Runtime-compiled code lifetime: bounded actual-source pass

2026-10-18; baseline5b264d38a. Root checked the independently facts-only authored
resource/lifetime fragment against live owning bodies and paired consumers.
No repository/runtime edit, collection/exhaustion experiment or performance
measurement is part of this review.

## Actual source inspected

- Full `machine/bios/compiler/arena.lua:1-104`: declared0x40000 BSS bytes,
  aligned interior,16-byte header/alignment from paired ISA,32-byte minimum
  residual, one allocation owner, candidate/scan/coalescing/one-GC-retry order,
  exact final error and no explicit free operation.
- Full `machine/bios/compiler/linker.lua:1-75` and load.lua21-38: all functions,
  descriptors and code share one allocation; separate guest constant pool is
  passed as owner and captured by returned root.
- `machine/bios/compiler/compiler.lua:61-97,1670-1679,1699-1735,1844-1878,
  1904-1935`: root/descendant owner captures, actual consumed environment and
  external location/accessor values; unused supplied environment is not always
  captured. No individual-function free protocol.
- Paired ISA `machine/ts/spec/blua32/image_format.ts:30-46` and
  `machine/cpp/spec/blua32/image_format.h:36-52`: alignment16, record32,
  descriptor4; prose does not teach hand encoding or guessed absolute address.
- Paired closing captures: TS cpu.ts3362-3374; C++cpu.cpp2967-2977. Paired
  collectors: TScpu.ts4938-4958,5025-5043,5056-5089,5101-5110;
  C++cpu.cpp139-202,223-231. Live closures retain captures; weak ownership
  does not independently root the owner. No reclamation deadline promised.
- Object-heap reserve: TS machine/cpu/lua_heap.ts9-58 and C++lua_heap.cpp11-33;
  independent exhaustion, not a second raw executable arena.
- `machine/bios/debug/frame.lua:37-70`, frame_scopes.lua1-25,
  shell/repl.lua33-55 and coroutine.lua21-26: retained accessors versus borrowed
  activation, exact expiration error, close before evaluator returns tuple and
  retirement after ordinary coroutine close. Prose does not claim these are
  all retirement surfaces or expose a new public frame-creation API.

Result: no unsupported sentence or mismatching capacity, alignment, lifetime,
error or work-order claim found in this bounded fragment. PASS for source
accuracy only. Accepted fragment SHA-256: `e94335b18009289a328a0b22fbaff8101df78b75f29cf24000339de7f6ac2e5d`.
Complete boot/reset ordering, code-cache reuse, exact linked arena address,
full snapshot roundtrip and every fault/interrupt interleaving remain unverified;
this pass does not close those exclusions or publication dependencies. No
all-input, native execution, collector correctness or whole-console claim.

## Separately authored resource-accounting addition

The original prose is unchanged except the inserted Resource accounting
subsection. It used the frozen lifetime packet and the separately source-frozen
[register-limit supplement](../facts/bios-loader-registers.md), not new owners.
Root checked the addition against actual linker.lua7-29 and arena.lua32-50,
80-83 plus paired ISA sizes. The record and descriptor sums are multiples of
four, so the linker's instruction-alignment step adds no further payload byte
with these current sizes. F counts all generated function records, D all actual
emitted descriptors (including owner/constants), and W actual emitted words,
not user locals or source statements. The16-byte allocation header/rounding and
minimum32-byte residual rule remain explicit. Reference arithmetic is labelled
not BLua source; no cart encoder or rounding helper was introduced.

The register ceiling follows paired instruction_format constants:
TS3-30/C++10-37, generated firmware export at
toolchain/ts/rompack/blua32_firmware_module.ts41 and actual compiler.lua1925-1946.
It is16,384 total slots per generated function, not promised locals/parameters
or all-smaller-program acceptance. Constant/owner/temp reservation is sourced
at compiler.lua1649-1680. Exact existing error has no appended source location.

Addition source PASS. Final resource fragment SHA-256: `736a67c2d0a67da66dc3b4868d02624edddd7b454f77c6bb95de871b98393259`.
No register-limit stress, allocation exhaustion or cache reuse was executed.

## Separately sourced startup/reset reference

A fresh extractor established the bounded [startup/reset order](../facts/bios-loader-reset.md);
a new facts-only author wrote the compact System startup and compiled-code
storage subsection. Root then read the actual paired Runtime resetForSystemBoot/
rebootSystem and CPU clearExecutionEnvironment/reset bodies, SYSTEM request
latches and frame-loop consumption, plus actual compiler section init/module
latches/dependency order and BIOS-to-cartridge/linker placement. This is an
actual-source check, not approval from a packet alone.

Direct inspected anchors: runtime.ts48-90/runtime.cpp76-116;
CPU TS923-927/C++716-729; paired SYSTEM controller TS139-143/C++91-95;
frame-loop TS152-158/C++47-52; toolchain/ts/lua/compiler.ts1505-1584,1613-1629,
2375-2395; BIOS arena.lua10-25 and main.lua58-70,105-113;
blua32_linker.ts1072-1074,1107-1120,1136-1149. Paired Memory ROM-install and CPU
image-replacement bodies were also read: Memory TS188-193/C++102-110;
CPU TS1169-1181/C++676-692. No whole-host/UI lifecycle audit is inferred.

All paragraph claims match. Consumption is distinguished from the control
write; initialization is conditional on startup execution progressing. BSS
zeroing precedes module bodies; module-latch clearing is separate from a bare
CPU reset. Cartridge startup initializes its own sections after BIOS BSS, not
the BIOS arena. No all-RAM-clear, immediate-delay, all-reset preservation or
invalidation, interrupted-startup or replacement choreography is promised.
The bare reference to the hardware request now links the canonical SYSTEM
chapter; it introduces no new address/bit or public reset API.

Source PASS for final reset subsection SHA-256 `fdcdd5992e7757c51fd62c915bd7fdf90c44d046c32f90de5eb0cf1b8e2e85ed`.
This closes the bounded programmer-facing startup/reset-reference gap, not
uninspected all-caller, cache, snapshot or media-replacement guarantees.
