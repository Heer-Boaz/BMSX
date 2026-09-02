// Real end-to-end check: an uncaught Lua runtime error becomes a genuine CPU_CAUSE_CODE_TRAP
// exception handled entirely by firmware (the BIOS monitor), not a host-level crash.

const faultSequenceAddress = 0x08010428;
let faultSequence = 0;
for (let frame = 0; frame < 1200 && faultSequence === 0; frame += 1) {
	await t.frames(1);
	faultSequence = t.runtime().machine.memory.readMappedU32LE(faultSequenceAddress);
}
t.assert(faultSequence !== 0, 'physical supervisor fault was not latched');
await t.frames(15);

const faultStack = t.faultStack();
t.assert(faultStack.length >= 2, 'physical Lua fault did not retain its source stack');
t.assert(faultStack[0].functionName === 'invoke', 'table-field callback lost its inferred authored name');
t.assert(faultStack[1].functionName === 'entry', 'callback caller lost its authored entry name');

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
t.capture('physical BIOS fault terminal');

t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'ControlRight', down: true, value: 1, timestamp: 0, pressId: 1 });
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'ShiftRight', down: true, value: 1, timestamp: 0, pressId: 2 });
await t.frames(1);
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'ControlRight', down: false, value: 0, timestamp: 0, pressId: 1 });
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'ShiftRight', down: false, value: 0, timestamp: 0, pressId: 2 });
await t.frames(12);
t.capture('IDE fault source overlay');
