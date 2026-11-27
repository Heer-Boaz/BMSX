import assert from 'node:assert/strict';
import { type CPU } from '../../machine/ts/machine/cpu/cpu';
import { ThreadStatus } from '../../machine/ts/machine/cpu/thread';
import { asClosure, valueBool } from '../../machine/ts/machine/cpu/value';
import { CPU_CAUSE_CODE_TRAP } from '../../machine/ts/spec/blua32/cop0';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS } from '../../machine/ts/spec/bmsx/memory_map';
import { runGuestToHalt } from './cpu_execution';

/** Host completion roots interrupt retained Lua execution but do not become its callee. */
export const completionBoundaryVectors = {
	completion_fault_protected: `
function probe() error('completion failure') end
pcall(function() halt_until_irq end)
return true`,
	completion_fault_coroutine: `
function probe() error('completion failure') end
local co = coroutine.create(function() halt_until_irq end)
coroutine.resume(co)
return true`,
	completion_fault_yield: `
function probe() coroutine.yield('not a guest resume result') end
local co = coroutine.create(function() halt_until_irq end)
coroutine.resume(co)
return true`,
	completion_return_nested: `
function probe()
	assert(not coroutine.isyieldable())
	local ok = pcall(function() error('caught inside completion') end)
	assert(not ok)
	local yielded = pcall(coroutine.yield)
	assert(not yielded)
	local child = coroutine.create(function() coroutine.yield(4); return 5 end)
	local ok, value = coroutine.resume(child)
	assert(ok and value == 4)
	ok, value = coroutine.resume(child)
	assert(ok and value == 5)
	return true
end
local co = coroutine.create(function() pcall(function() halt_until_irq end) end)
coroutine.resume(co)
return true`,
};

export function exerciseCompletionBoundary(cpu: CPU, name: string): void {
	runGuestToHalt(cpu, 500_000);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	const thread = cpu.activeThread.address, depth = cpu.getFrameDepth(), protectedDepth = cpu.activeThread.protectedDepth;
	cpu.beginCompletionCall(asClosure(cpu.getGlobalByKey(cpu.stringPool.intern('probe')), cpu.gc));
	const fault = name.startsWith('completion_fault');
	for (let grant = 0; grant < 10000 && cpu.completionCallPending(); grant++) {
		cpu.runUntilDepth(depth, 1, thread);
		if (fault && cpu.fixedInterruptActive() && cpu.readCauseWord() === CPU_CAUSE_CODE_TRAP) break;
	}
	assert.equal(cpu.readThreadStatus(thread), ThreadStatus.Running);
	assert.equal(cpu.bindThread(thread).protectedDepth, protectedDepth, 'interrupted protected call remains untouched');
	if (fault) {
		assert.ok(cpu.fixedInterruptActive(), 'unhandled completion error enters the fixed System vector');
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_TRAP);
		assert.equal(cpu.memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), thread);
		assert.equal(cpu.completionCallPending(), true, 'fault retains the actual completion root');
	} else {
		assert.equal(cpu.activeThread.address, thread);
		assert.equal(cpu.readExceptionReturnFrameDepth(), -1);
		assert.equal(cpu.completionCallPending(), false);
		assert.equal(cpu.getFrameDepth(), depth);
		const values = []; cpu.readCompletionValues(values);
		assert.deepEqual(values, [valueBool(true)], 'protected calls and child coroutines within a completion root still work');
	}
}
