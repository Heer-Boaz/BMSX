# SYSTEM whole-chapter source audit

**Current verdict: accepted; no unresolved unsupported or incorrect factual
claim found in the current bounded chapter.** Read-only, nonauthor review of
`docs/book1/system.md`, its three SYSTEM fact sheets, exact live TS/C++ owners
and spec leaves, actual cartridge sources, and existing execution artifacts.
No architecture document, PDF, runtime/tooling implementation, or repository
file was edited. Source acceptance is separate from reader and print acceptance.

## Finding resolved during this review

Original claim: “Unaligned word accesses, all halfword reads, and all byte or
halfword writes raise UNALIGNED_IO (2); the failed reads return zero.”

This described direct Memory methods without identifying the earlier guest CPU
alignment and exception boundary. Ordinary guest Word/halfword access checks
alignment first: `machine/ts/spec/blua32/memory_access_kind.ts:1-10`;
`machine/ts/machine/cpu/cpu.ts:3083-3088,3120-3129`; mirrored
`machine/cpp/spec/blua32/memory_access_kind.h:8-23` and
`machine/cpp/machine/cpu/cpu_dispatch.inl:622-627,647-657`. Displacement forms
agree: TS `cpu.ts:2998-3008`; C++ `cpu_dispatch.inl:555-559,580-584`.

The revised chapter at `system.md:191-201` now distinguishes CPU address-error,
port bus faults, aligned byte low-eight-bit reads, and the CPU data-bus-error
result instead of successful guest zero-load. Rechecked against Memory TS
`memory.ts:442-449,503-506,627-646,852-891` and C++
`memory.cpp:332-339,393-396,522-540,729-768`, plus CPU TS
`cpu.ts:3110-3114,3150-3152` / C++ `cpu_dispatch.inl:638-642,666-668`.
The current wording is supported.

## Required checks

- Printed Lua result block is literally byte-equal to
  `carts/system_manual/results.lua`: **31 lines**. Concatenating all subsequent
  Lua blocks, without inserted or removed bytes, is literally byte-equal to
  `carts/system_manual/cart.lua`: **73 lines**. Comments are included.
- Persisted SI04 now cites TS `imgdec/controller.ts:525-547` / C++
  `imgdec/controller.cpp:430-452`, including cancellation. Persisted SX03 now
  includes TS `gx/gpu.ts:577-625`, the actual ingress-copy helpers. Both earlier
  citation gaps are fixed.
- ST08 independently derived from mirrored reset words (TS spec
  `gx/pcrtc.ts:75-98`, C++ `gx/pcrtc.h:69-92`) and timing arithmetic (TS
  `gpu_pcrtc.ts:247-295,829-874`; C++ `gpu_pcrtc.cpp:66-114,552-596`):
  horizontal total 3456, half-line numerator 27648, denominator 864000000,
  total half-lines 628, active half-lines 576, refresh 49761146 millionths Hz.
  Installed 33868800 Hz gives FRAME **1317011 = 00141893H** and first whole-period
  CYCLES **680628 = 000A62B4H**. Scheduler reset gives TIME **0**.
- This is the hardware-reset-before-firmware boundary, not cartridge entry:
  TS runtime `runtime.ts:48-55`, scheduler `device.ts:42-56`, timing model
  `model.ts:7,46-47`, timing state/config `state.ts:23-29,config.ts:3-7`, machine
  `machine.ts:122-126`, PCRTC reset `gpu_pcrtc.ts:560-571`; mirrored C++
  `runtime.cpp:109-116`, `device.cpp:23-37`, `model.h:12,51-52`, timing
  `state.cpp:10-22,config.cpp:7-12`, `machine.cpp:65-69`,
  `gpu_pcrtc.cpp:305-316`. The ordinary startup runs firmware afterward.
- Existing native/TS scratch replay logs are byte-identical, **33 rows** each,
  including `time0 0` and `reset-timing 1317011 680628`. Their sources explicitly
  install model timing before those reads. I inspected, but did not rerun, them.
- The actual program's storage/172-byte layout agrees with compiler
  `struct_types.ts:44-55,154-164`; generated BSS zeroing precedes entry via
  `compiler.ts:1534-1558,1561-1584`. Existing final validation artifact is
  `7a50b010044ceb2a649008457c486aa0e8613cc088e468075f762250da90c169`; existing guest
  test log reports the matching case passed. Neither is claimed as native cart
  parity.
- Caption checked against the actual image and producing source: publication PNG
  is byte-identical to ordinary timeline `screenshots/frame_00090.png`; it shows
  both BIOS print lines and not the raw Unicode line. `console.lua:19-64` and
  `base.lua:265-275` support the separate history/output routes. Ordinary output
  log contains all three diagnostic lines; timeline requests supervisor at
  frame 82 and releases at 84. This supports the caption, not physical output,
  universal backend parity, or continuation/reset proof.

No universal CPU/runtime behavior, complete-device preservation, or electrical
output claim was inferred from this review. No further factual or mirrored-source
conflict was found in the chapter's stated scope.

## Editorial integration and executed evidence

Separate read-only extractors froze the controller/spec, CPU boundary and BIOS
route; root extracted each called device boundary separately. Different authors
wrote control/fault, time/output and complete-example sections from those sheets
only. Root merged them with the quiescence/bank explanation. This nonauthor
source pass, the [public-only reader](system-reader.md) and the
[actual-page review](system-print.md) are separate acceptances.

Structural reference before implementation: the production MAME
[watchdog reset request](https://github.com/mamedev/mame/blob/master/src/devices/machine/watchdog.cpp)
and [machine soft-reset boundary](https://github.com/mamedev/mame/blob/master/src/emu/machine.cpp)
were inspected to distinguish a reset request from its later execution. No
MAME address, timing, API or behavior supplied a BMSX fact. The architecture
prose and historical reference PDF were not authoring inputs. No runtime,
compiler, BIOS, cartlib, capture or publication-framework code was changed.

The preliminary dependency audit caught and resolved two overclaims before
integration: IMGDEC quiescence can also be idle/completed, and IO classification
requires whole-access containment rather than any overlap. Two citation gaps
were corrected: IMGDEC stop cancellation and TS GPU ingress-bank helpers. The
whole-chapter access finding above was then corrected and independently
rechecked at both guest and mapped-memory boundaries. No accepted prose depends
on direct unaligned Memory calls being equivalent to guest typed accesses.

Final bounded execution bundle, 2026-10-17:

| Evidence | Actual result and scope |
|---|---|
| New ordinary cart validation | `npm run validate:toolchain:cart -- system_manual --debug` passes; artifact `7a50b010044ceb2a649008457c486aa0e8613cc088e468075f762250da90c169` |
| New retained-result integration | `npm run headless:test -- system_manual tests/carts/system_manual/system_manual_assert.lua` passes its named case; all four observations, privilege/readback/time brackets checked |
| Ordinary output and actual image | Exact companion `headless:tooling` command passes; program emits three expected lines, real supervisor-request reaches monitor; image byte-identical to the chapter PNG |
| Normal supervisor round-trip | `npm run ide:test -- system_manual tests/ide/system_manual.idetest.js` passes 11 assertions; real input and read-only physical observations, STATUS0→5→0→5, MASK4 restored, TIME advances, fault sequence0 |
| Current direct mirrored owners | Scratch replay 33 exact rows agrees, including wrapping TIME, installed reset FRAME/CYCLES, every RO word, access widths, raw diagnostic bytes and overflow; not guest execution |
| Existing TS owner/CPU cases | System controller, CPU interrupt-state and mapped-execution suites: 66 tests, 66 pass |
| Existing native owners | Fresh build of `bmsx_system_controller_tests` and `bmsx_cpu_supervisor_tests`; both executables exit0 |
| Shared manual pipeline | Existing 17 tests pass; no new publisher branch/helper/guard |

Logs: `/tmp/bmsx-system-cart-validation.log`,
`/tmp/bmsx-system-cart-test.log`,
`/tmp/bmsx-system-public-ordinary-command.log`,
`/tmp/bmsx-system-monitor-execution.log`,
`/tmp/bmsx-system-final-paired-replay.log`,
`/tmp/bmsx-system-final-ts-tests.log`,
`/tmp/bmsx-system-final-native-{build,system,cpu}.log`,
`/tmp/bmsx-system-final-manual-tests.log`.

**Bounded SYSTEM source and newcomer-route acceptance PASS.** This is not native
execution of the new cartridge, electrical/physical receiver proof, arbitrary
fault repair, every banked field or whole-console completeness. The separate
direct-CPU yield/HALT source disagreement is recorded in the technical follow-up;
its unproved common precedence is not taught or silently repaired here. CPU,
complete on-console development and Book II remain whole-manual work.

## RDB01: synchronous-fault/readback coverage reopened, 2026-10-18

The previous bounded positive entry/round-trip evidence does not cover unread
CPU-owned C0 data at synchronous-fault entry. Fresh paired-source inspection
and an ordinary-ROM consumed/unread comparison identify a liveness defect;
[the separate record](../facts/system-readback-entry.md) preserves source
lines, exact observations, source extraction and execution methods.

No public stall contract, cancellation/draining policy or runtime workaround
is added. The existing phase predicates remain source-checked, but affected
fault coverage is reopened until the owning completion policy is resolved.
The old successful publication decision is historical, not current approval
of that path. Native execution of the reproduction was not performed.

2026-10-19: The hardware-first opening and independent raw-timer program pass
the bounded paired-source check. One real finding corrected the signed
`& 0xffffffff` distance to `% 0x100000000`; [ST09](../facts/system.md) retains
the CPU/modulo sources. The rebuilt ordinary cartridge passes
`time_words_privilege_and_transmit`, including four observations of at least100ms
and runtime-operand modulo cases32/7fffffff/80000000/ffffffff. These arithmetic
cases do not advance the hardware counter through a complete wrap or prove
native execution. Printed source matches the retained program apart from blank
separators. RDB01 fault coverage and final print acceptance remain open.

The 2026-10-19 INPUT preservation-table row has a bounded independent source
PASS recorded in [input-source.md](input-source.md#bios-handoff-and-supervisor-ownership--2026-10-19).
RDB01 and final print remain open; no runtime or supervisor policy was changed.

## RDB01 owner resolution and bounded manuscript update — 2026-10-19

The implementing slice replaces the old IDLE/empty-FIFO requirement with stable
READY/IDLE ownership banking, including unread USER pixels/cursor, GPUREAD and
queued ingress. SYSTEM's GPU-boundary/preservation rows and LEAVE paragraph now
state that distinction and explicitly transient supervisor teardown. The
[existing RDB01 fact record](../facts/system-readback-entry.md#retained-user-readback-ownership--resolved-2026-10-19)
contains exact owner ranges and the passing 39-assertion ordinary unread-fault
reproduction. The former readback-entry liveness hold is resolved. This implementation
note is not independent approval of the changed sentences or final print;
those existing decisions remain false until integration checks them.
