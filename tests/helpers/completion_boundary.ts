import assert from 'node:assert/strict';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ThreadStatus } from '../../machine/ts/machine/cpu/thread';
import type { Closure } from '../../machine/ts/machine/cpu/closure';

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
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	const thread = cpu.activeThread, depth = cpu.getFrameDepth(), protectedDepth = thread.protectedCallDepth;
	cpu.beginCompletionCall(cpu.getGlobalByKey(cpu.stringPool.intern('probe')) as Closure);
	for (let grant = 0; grant < 10000 && cpu.completionCallPending() && cpu.readExceptionReturnFrameDepth() === -1; grant++) {
		cpu.runUntilDepth(depth, 1, thread);
	}
	assert.ok(cpu.activeThread === thread, 'completion cannot fail/yield the interrupted coroutine');
	assert.equal(thread.status, ThreadStatus.Running);
	assert.equal(thread.protectedCallDepth, protectedDepth, 'interrupted protected call remains untouched');
	if (name.startsWith('completion_fault')) {
		assert.notEqual(cpu.readExceptionReturnFrameDepth(), -1, 'unhandled completion error enters the physical fault path');
		assert.equal(cpu.completionCallPending(), true, 'fault retains the actual completion root');
	} else {
		assert.equal(cpu.readExceptionReturnFrameDepth(), -1);
		assert.equal(cpu.completionCallPending(), false);
		assert.equal(cpu.getFrameDepth(), depth);
		const values = []; cpu.readCompletionValues(values);
		assert.deepEqual(values, [true], 'protected calls and child coroutines within a completion root still work');
	}
}
