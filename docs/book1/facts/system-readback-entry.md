# RDB01 — unread GPU readback blocks synchronous-fault entry

**Engineering defect record, not a cartridge contract.** Observed 2026-10-18
with the owners at `1dd0239bd`. Keep the affected supervisor-entry coverage
open; do not prescribe avoiding faults, guessed draining, cancellation or a
register-reset workaround as the intended hardware interface. No runtime fix
or completion policy is selected here.

## Paired owner evidence

| Fact | Actual source lines |
|---|---|
| Backend completion makes a C0 readback READY. Explicit GP0 reads advance its pixel cursor; consuming its last pixel makes it IDLE. Command retirement alone does not consume pixels. | `machine/ts/machine/devices/gx/gpu_command_buffer.ts:147-184,344-381`; `machine/cpp/machine/devices/gx/gpu_command_buffer.h:88-129,327-365`; GP0 consumers `machine/ts/machine/devices/gx/gpu.ts:1019-1032`, `machine/cpp/machine/devices/gx/gpu.cpp:536-548` |
| GPU supervisor quiescence requires idle readback. Starting quiescence neither consumes nor cancels it; the context reset is after that fence. | `machine/ts/machine/devices/gx/gpu.ts:904-949`; `machine/cpp/machine/devices/gx/gpu.cpp:434-479` |
| Firmware's synchronous-fault path writes SYSTEM FAULT before preparing its display or publishing the report; it does not read GPUREAD first. | `machine/bios/shell/monitor.lua:423-445,455-459,490-492` |
| FAULT targets device quiescence with the CPU held. The ordinary supervisor-request target instead leaves CPU execution available while waiting. The executor honors that hold. | `machine/ts/machine/devices/system/controller.ts:161-173,181-213,243-267,290-294`; `machine/cpp/machine/devices/system/controller.cpp:113-165,195-219`; `machine/cpp/machine/devices/system/controller.h:62-66`; `machine/ts/machine/runtime/cpu_executor.ts:39-88,253-256,327-339`; `machine/cpp/machine/runtime/cpu_executor.cpp:12-61,237-240,313-325` |

These matching owners admit a liveness gap: unread CPU-owned READY pixels,
with no DMA consumer, prevent the GPU fence while FAULT holds the only CPU
that could read them. Later backend completion, command retirement and clock
progress do not supply that missing consumer. No TypeScript/C++ disagreement
was found in this path; native execution was not performed.

## Actual ordinary-ROM comparison

Two normal typed BLua cartridge builds differ only in the DATA initializer
that selects whether to read the single GPUREAD word before the same unmapped
word load at `0x01000000`. No observer writes, evaluator, handler replacement,
readback cancellation or machine restore was used. Both cases first observe
a CPU-owned READY 1×1 readback, pixel cursor zero and no BUSY DMA channel.

| Observation | Leave the word unread | Consume the word first |
|---|---|---|
| Memory fault | CODE1, ADDR `01000000`, ACCESS `00000801` | Same |
| Retained SYSTEM cause/EPC/domain | `0000001C` / `1001AEFC` / 0 | Same |
| After fault, through 120 runner-frame waits | GPU_QUIESCE; CPU held; readback READY; publication sequence 0 | ACTIVE; CPU unheld; readback IDLE; sequence 1 by the first subsequent wait |

The unread run and its repeat each pass 40 observation assertions; the
consumed control passes 18. In the unread run, queued-command and readback
fence counts are already zero, backend pending/blocking are false, and cycles
advance from 49,005,173 to 130,680,463. This distinguishes the observed stall
from pending backend latency. The measured bound is 120 runner-frame waits,
not a new hardware timeout or proof by execution of infinite duration.

Source/config, scenarios, exact ROMs, identities, structured observations and
logs: `/tmp/bmsx-gpu-readback-fault-reproduction/`. Artifact IDs are unread
`14df9549890c387455db78ae72383e08f5320abd43140fc2f0b3f100a76465af`
and consumed `35118d0b3d7544ca344f3a7cbd4366590a6fd0f9b7ee501118c6370853795ae9`.
The temporary cart was removed; no runtime or maintained test changed.

Detailed source extraction: `/tmp/bmsx-system-gpu-readback-entry-facts-current.md`.
Commands and execution limits: `/tmp/bmsx-gpu-readback-fault-reproduction-current.md`.
