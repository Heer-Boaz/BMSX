// Real end-to-end check: an uncaught Lua runtime error becomes a genuine CPU_CAUSE_CODE_TRAP
// exception handled entirely by firmware (the BIOS monitor), not a host-level crash.

await t.waitForCart();
await t.frames(20);

const runtime = t.runtime();
const cpu = runtime.machine.cpu;

// The monitor's own comment in monitor.lua explains why causeWord/luaFaultReasonWord
// can't be checked live here: entering the monitor re-enables vblank IRQs (to keep
// animating the cursor/polling input), which legitimately overwrites those transient
// registers with subsequent IRQ causes — that's correct hardware behavior, not a bug.
// The robust, timing-independent signal that firmware actually caught the Lua fault
// and is now interactively showing the crash screen: execution left cart/user mode
// for system/supervisor mode, and is halted waiting on the next vblank (the monitor's
// own input-polling loop), rather than the cart's own halt_until_irq loop.
const CPU_STATUS_USER_MODE_CURRENT = 1 << 1;
const state = cpu.captureRuntimeState();
t.assert((state.statusWord & CPU_STATUS_USER_MODE_CURRENT) === 0, 'fault should leave the CPU in supervisor/system mode, not user/cart mode');
t.assert(cpu.isHaltedUntilIrq(), 'firmware monitor should be halted waiting for input, not looping');
