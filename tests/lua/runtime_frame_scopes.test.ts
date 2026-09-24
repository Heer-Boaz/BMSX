import assert from 'node:assert/strict';
import test from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Thread } from '../../machine/ts/machine/cpu/thread';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { retireRuntimeFrameScopes } from '../../ide/runtime/frame_scopes';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { compileFrameEvaluationTest } from '../helpers/frame_evaluation';
import { createTestRuntime } from '../helpers/runtime_sources';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';
import { materializeCpuCompletionValues } from './cpu_test_harness';

for (const mode of ['source-install', 'completion-unwind'] as const) test(`IDE retires real firmware borrows before ${mode}`, () => {
	const image = compileFrameEvaluationTest(`
reader = false
keeper = coroutine.create(function(value, ...)
 local index<const> = frame_count(running_thread()) - 1
 local ok, message = repl.evaluate_frame('reader = function() return value end; coroutine.yield(42); return value', '=retirement', index, 0)
 assert(ok, message)
 return value, message
end)
assert(coroutine.resume(keeper, 17))
verify = function() return pcall(reader) end
return true`, 0);
	const runtime = createTestRuntime(image.romBytes), cpu = runtime.machine.cpu;
	const sources = createScenarioTestSourceState([]);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports), cartridgeSlots: [null, null] };
	const guest = new SuspendedGuestSession(runtime);
	cpu.reset(); cpu.installBootPrimitives();
	// A pre-initialization source installation has no scope registry yet.
	retireRuntimeFrameScopes(runtime, sources, guest);
	assert.equal(cpu.runUntilDepth(0, 30_000_000), RunResult.Halted);
	const initialized = materializeCpuCompletionValues(cpu);
	assert.deepEqual(initialized, [true, true], initialized.map(value => guest.formatValue(value)).join('\t'));
	const keeper = guest.global('keeper') as Thread;
	const pcs = keeper.frames.map(frame => frame.pc);
	const reader = guest.global('reader') as Closure;
	assert.deepEqual(guest.callClosure(reader), [17]);
	if (mode === 'completion-unwind') {
		retireRuntimeFrameScopes(runtime, sources, guest, cpu.activeThread, 0);
		retireRuntimeFrameScopes(runtime, sources, guest, keeper, keeper.frames.length);
		assert.deepEqual(guest.callClosure(reader), [17], 'other threads and lower scopes retain their borrow');
	}
	retireRuntimeFrameScopes(runtime, sources, guest, mode === 'completion-unwind' ? keeper : undefined);
	assert.deepEqual(keeper.frames.map(frame => frame.pc), pcs, 'retirement neither runs Lua nor unwinds/rewrites the physical stack');
	assert.deepEqual(guest.callClosure(guest.global('verify') as Closure).map(value => guest.formatValue(value)),
		['false', 'Selected frame evaluation has ended.']);
});
