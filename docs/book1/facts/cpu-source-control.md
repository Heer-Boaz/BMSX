# Ordinary BLua CPU-control syntax facts

2026-10-17,baseline375de6170. Bounded owning-producer/actual-BIOS extraction;
no runtime, firmware or compiler changes. This is source syntax, not new raw
opcode behavior. No architecture/reference-PDF input.

- SC01. `halt_until_irq` is a reserved statement token and its statement lowers
  directly to HALT A0B0C0. Sources: `toolchain/ts/lua/syntax/token.ts:121–122`;
  `toolchain/ts/lua/compiler.ts:3665–3667`. Complete actual cart uses it at
  `carts/cpu_manual/cart.lua:62–64`; normal playback reaches its final loop.
- SC02. Reserved intrinsic base `cop0` recognizes member spellings bad_address,
  lua_fault_reason,status,cause,epc,exec and maps to the owning CP0 constants.
  These are intrinsic member expressions, not an ordinary dynamically indexed
  table interface. Source: `toolchain/ts/lua/compiler.ts:4797–4813`.
- SC03. Reads lower to MFC0; source read of exec is rejected as write-only.
  Assignment targets permit only status/epc/exec, rejecting other CP0 member
  writes as read-only; accepted assignment emits MTC0. Sources:
  `toolchain/ts/lua/compiler.ts:4768–4775,4043–4055,4226–4228`. These producer
  restrictions are separate from raw privileged MFC0 EXEC returning0 and raw
  MTC0 ignored-write behavior established by the CPU memory/control sheet.
- SC04. Generated ordinary IRQ entry loads FLAGS, conditionally calls bound irq
  with one argument, and then emits RFE. Generated exception entry calls bound
  exception with its argument and then emits RFE. Both are generated vector
  bodies; ordinary callback CALL creates a normal nested call frame, so its
  ordinary return is not itself raw RFE. Sources:
  `toolchain/ts/lua/compiler.ts:1633–1669`; frame/call semantics in cpu-calls
  and current-exception-frame gate in cpu-memory-control P06. This does not
  invent a source RFE keyword or grant user mode privileged CP0 access.
- SC05. Actual installed monitor saves CP0 Status,Cause,EPC,BadAddress and
  LuaFaultReason using these intrinsic reads and later writes saved EPC/Status.
  Sources: `machine/bios/shell/monitor.lua:406–409,423–429`. These are actual
  firmware source patterns, not a proposed cartridge's ready-to-run supervisor
  recovery program or a universal repair/return guarantee.
- SC06. Actual installed BIOS boot handoff takes startup from scan_cartridges,
  clears IRQ mask and writes `cop0.exec = startup`. Sources:
  `machine/bios/main.lua:105–113`. Startup discovery/selected socket/static
  function-record contract is separately established by the Memory chapter's
  BIOS/reset facts. This does not make a generic language function value a
  numeric EXEC operand or establish a new function-address syntax.
