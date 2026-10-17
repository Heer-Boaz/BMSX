# CPU value and Table ordinary cartridge: frozen evidence

2026-10-17 baseline5a5a26e15; only documentation and ordinary example additions.
No runtime, BIOS, compiler, cartlib, publisher or shared harness change.

- VX01. Complete modules are `carts/cpu_values_manual/results.lua` (17 lines)
  and `cart.lua` (119 lines). The chapter copies the result module and four
  consecutive entry chunks literally; concatenating those chunks reproduces
  the entry module without hidden helper source. Results use BSS and a typed
  pointer supplied by the results module, not a guessed free address or raw
  language-value ABI. Typed-storage semantics and constructor key one versus typed index zero are
  the accepted Memory facts MD07–MD08/BS15. Root rechecked the ordinary
  constructor producer at toolchain/ts/lua/compiler.ts:4849–4875; no Table
  runtime owner was used to guess source literal indexing.
- VX02. `cart.lua:3-8` reads zero from BSS and derives negative zero, infinity
  and NaN using actual numeric operations. The two ordinary list Tables and
  runtime indexing supply twelve POW operands, not just constant folding.
  The retained array results match the twelve-row chapter table. Four stored
  reciprocals distinguish negative versus positive zero. Sources: cart lines
  10-26, assertions13-28; actual retained integration execution below.
- VX03. The eighteen input/expected pairs and actual empty-String concatenation
  are cart lines29-44. All18 comparison flags are1. Ordinary playback prints
  CPU format lines indexed1..18 with exactly those expected Strings, including
  nan/inf/-inf/-0 and the computed-intermediate rounding result123457.
- VX04. The own-mapping mutation trace (cart46-60) retains lengths
  3,1,1,4,0,4,4. The later mixed-key mutations retain the last length4 and values
  91,12,15,16,17,18,22,23,24. Seven flags establish missing admissible key,
  preserved numeric1, false presence, ordinary NaN inequality, same/distinct
  Table identity and nil deletion of NaN. Sources cart61-92 and retained case.
  This is bounded TS ordinary-cartridge execution, not a universal refill
  contract or native execution of this cartridge. The separate actual raw CPU
  mismatch in cpu-values-execution remains open.
- VX05. The ten BIOS/metatable flags (cart94-112) are all1: setmetatable return
  identity; actual getmetatable; inherited42; raw missing own answer; own7 and
  unchanged inherited42; rawset return identity; explicit-nil deletion exposes
  inherited42 while rawget is nil; explicit-nil clear; absent answer after
  clear; function-valued __index ignored. The real BIOS signatures/faults are
  separately frozen in cpu-table-bios, not inferred solely from this example.
- VX06. Closing cart lines114-119 print reciprocal signs -inf/inf and length4,
  set completed1, then wait using the actual halt_until_irq statement. No
  render claim or promised IRQ wakeup follows from this computation.
- VX07. `npm run validate:toolchain:cart -- cpu_values_manual --debug` passes;
  ordinary artifact1242990b48df6932921df121eb4bc4bee7a54311b65d49c06e387cb25be08add.
  Retained `headless:test` case power_text_and_table_contracts passes68 data
  assertions (12+4+18+8+9+7+10), not counting completion wait. The integration
  image is derived, not byte-identical ordinary playback. Companion's exact
  ordinary headless:tooling/timeline command separately passes and emits all20
  documented diagnostic lines, ending its presentation-frame4 timeline normally.

Logs /tmp/bmsx-cpu-values-cart-build.log, -cart-test.log and -ordinary.log retain
these observations. Initial source build correctly rejected omitted rawset
value/setmetatable argument; source now passes explicit nil. No compiler shim
or runtime fallback was introduced. Long source expressions were wrapped for
print and the rebuilt final source was rerun. No native ordinary-cart parity,
full chain-limit fault execution, every nil-key fault route, numerical error
bound, String ABI, physical throughput, iteration or GC claim is inferred.
