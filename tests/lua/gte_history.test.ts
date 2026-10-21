import assert from 'node:assert/strict';
import test from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { IO_GX_GTE_COMMAND, IO_GX_GTE_DATA0 } from '../../machine/ts/spec/bmsx/io';
import { MAPPED_BUS_MASTER_DMA } from '../../machine/ts/machine/memory/bus_signals';
import { HistoryMode } from '../../machine/ts/machine/runtime/history/history';
import { RuntimeRestoreOrigin } from '../../machine/ts/machine/runtime/save_state';
import { RuntimeGteHistory, GteCommandSnapshot } from '../../ide/runtime/gte_history';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { eventHistoryRuntime } from '../helpers/event_history';

const BUDGET = 10_000_000;
const PROGRAM = `
local data<const>: *word = 0x08010244
local control<const>: *word = 0x080102c4
local command<const>: *word = 0x08010344
control[0] = 0x1000
control[2] = 0x1000
control[4] = 0x1000
control[24] = 128 << 16
control[25] = 96 << 16
control[26] = 256
function issue(count)
 for index = 1, count do
  data[0] = 0xffc0ffc0
  data[1] = 512
  data[2] = 0xffc00040
  data[3] = 512
  data[4] = 0x00400000
  data[5] = 512
  *command = 0x00080030
  data[0] = 4096
  data[1] = 0
  *command = 0x0008003f
 end
end
issue(1)
return true`;

test('GTE evidence pairs actual invocations, not later lighting operands, and retains full cycle/source identity', () => {
	const { images } = createCartlibProgramHarness(PROGRAM);
	const { runtime, sources } = eventHistoryRuntime(images);
	const history = new RuntimeGteHistory(runtime, sources), lease = history.observe();
	runtime.machine.scheduler.setNowCycles(0x100000000 + 43);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
	assert.equal(history.count, 2);
	const projection = history.snapshot(0), lighting = history.snapshot(1);
	assert.equal(projection.commandWord, 0x00080030);
	assert.equal(projection.nominalCycles, 23);
	assert.equal(projection.beforeData[0], 0xffc0ffc0);
	assert.deepEqual(Array.from(projection.afterData.slice(12, 15)), [0x00400060, 0x004000a0, 0x00800080]);
	assert.equal(lighting.beforeData[0], 4096);
	assert.equal(projection.afterData[15], 0, 'trace stores raw backing words, not alias-port readbacks');
	assert.ok(projection.cycles > 0x100000000);
	assert.equal(projection.domain, 0);
	assert.equal(projection.image, sources.currentBlua32Media.cartridgeSlots[0]);
	assert.ok(projection.pc !== undefined);
	assert.notEqual(projection.pc, lighting.pc);
	lease.dispose();
});

test('retained observation leases, ring reuse, replay and install have separate lifetimes', () => {
	const { images } = createCartlibProgramHarness(PROGRAM);
	const { runtime, sources, cpu } = eventHistoryRuntime(images);
	const history = new RuntimeGteHistory(runtime, sources, 2);
	const first = history.observe(), second = history.observe();
	const generation = history.generation;
	first.dispose();
	assert.equal(history.observing, true);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
	const pinned = history.snapshot(0), reused = new GteCommandSnapshot();
	const fn = cpu.getGlobalByKey(cpu.stringPool.find('issue')!) as Closure;
	cpu.beginCompletionCall(fn, [2]);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
	assert.equal(history.count, 2);
	assert.equal(history.firstSequence, 4);
	assert.equal(history.expired, 4);
	assert.equal(pinned.sequence, 0);
	assert.equal(pinned.beforeData[0], 0xffc0ffc0);
	history.copy(5, reused);
	assert.equal(reused.sequence, 5);
	assert.equal(reused.beforeData[0], 4096);
	const end = history.endSequence;
	for (const mode of [HistoryMode.Replaying, HistoryMode.Reviewing]) {
		runtime.history.mode = mode;
		cpu.beginCompletionCall(fn, [1]);
		assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
		assert.equal(history.endSequence, end);
	}
	runtime.history.mode = HistoryMode.Disabled;
	history.didRestore(RuntimeRestoreOrigin.HistorySeek);
	assert.equal(history.count, 2);
	history.didInstall();
	assert.equal(history.count, 0);
	assert.equal(history.generation, generation + 1);
	assert.equal(pinned.beforeData[0], 0xffc0ffc0);
	cpu.beginCompletionCall(fn, [1]);
	runtime.machine.scheduler.runCpuSlice(0, BUDGET);
	assert.ok(history.at(end).timeline > pinned.timeline);
	second.dispose();
	assert.equal(history.observing, false);
	const stopped = history.endSequence;
	cpu.beginCompletionCall(fn, [1]); runtime.machine.scheduler.runCpuSlice(0, BUDGET);
	assert.equal(history.endSequence, stopped);
	const reopened = history.observe();
	assert.equal(history.count, 0, 'a new observation session does not follow evidence from before an unobserved gap');
	assert.equal(history.generation, generation + 2);
	assert.equal(pinned.beforeData[0], 0xffc0ffc0, 'session replacement does not mutate detached evidence');
	cpu.beginCompletionCall(fn, [1]); runtime.machine.scheduler.runCpuSlice(0, BUDGET);
	assert.equal(history.count, 2);
	assert.equal(history.at(stopped).sequence, stopped);
	reopened.dispose();
});

test('detached GTE evidence uses physical checkpoint provenance after ring reuse, branch and install', () => {
	const { images } = createCartlibProgramHarness(PROGRAM);
	const { runtime, sources, cpu } = eventHistoryRuntime(images);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
	runtime.machine.scheduler.advanceTo(BUDGET - cpu.instructionBudgetRemaining);
	const history = new RuntimeGteHistory(runtime, sources, 2), lease = history.observe();
	const physical = runtime.history;
	physical.onWillResumeRecording = branched => { if (branched) history.beginTimeline(); };
	runtime.onStateRestored = origin => history.didRestore(origin);
	physical.start({ checkpointCapacity: 2, inputCapacity: 16, checkpointIntervalCycles: 0x100000000 });
	physical.captureCheckpoint();
	const start = runtime.machine.scheduler.nowCycles;
	let issue = cpu.getGlobalByKey(cpu.stringPool.find('issue')!) as Closure;
	cpu.beginCompletionCall(issue, [1]);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
	const pinned = history.snapshot(0), installedImage = pinned.image;
	assert.equal(history.canSeek(pinned), false, 'an unfinished live interval has no retained navigation endpoint');
	runtime.machine.scheduler.advanceTo(start + BUDGET - cpu.instructionBudgetRemaining);
	physical.recordInputBoundary(true);
	assert.equal(history.canSeek(pinned), true);

	const firstBoundary = runtime.machine.scheduler.nowCycles;
	cpu.beginCompletionCall(issue, [2]);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
	runtime.machine.scheduler.advanceTo(firstBoundary + BUDGET - cpu.instructionBudgetRemaining);
	physical.recordInputBoundary(true);
	assert.ok(pinned.sequence < history.firstSequence);
	assert.equal(history.canSeek(pinned), true, 'ring expiry does not discard the detached checkpoint provenance');
	assert.equal(pinned.image, installedImage);
	const endSequence = history.endSequence;
	physical.beginSeek(start);
	assert.equal(physical.mode, HistoryMode.Reviewing);
	assert.equal(history.endSequence, endSequence, 'checkpoint restoration does not record another invocation');
	physical.resumeRecording();
	physical.captureCheckpoint();
	assert.equal(history.canSeek(pinned), false, 'the discarded continuation is no longer physically reachable');

	issue = cpu.getGlobalByKey(cpu.stringPool.find('issue')!) as Closure;
	cpu.beginCompletionCall(issue, [1]);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
	const replacement = history.snapshot(endSequence);
	runtime.machine.scheduler.advanceTo(start + BUDGET - cpu.instructionBudgetRemaining);
	physical.recordInputBoundary(true);
	assert.equal(replacement.cycles, pinned.cycles, 'the new branch can reuse the exact machine-cycle position');
	assert.ok(replacement.timeline > pinned.timeline);
	assert.notEqual(replacement.checkpoint, pinned.checkpoint);
	assert.equal(history.canSeek(pinned), false, 'overlapping new cycles cannot revive discarded evidence');
	assert.equal(history.canSeek(replacement), true);
	physical.captureCheckpoint();
	assert.equal(history.canSeek(replacement), true);
	physical.captureCheckpoint();
	assert.equal(history.canSeek(replacement), false, 'checkpoint slot reuse expires provenance even at a retained cycle');

	history.didInstall();
	assert.equal(history.count, 0);
	assert.equal(pinned.image, installedImage, 'install releases ring source identities, not a detached installed-source image');
	assert.equal(pinned.beforeData[0], 0xffc0ffc0);
	assert.equal(replacement.beforeData[0], 0xffc0ffc0);
	lease.dispose();
});

test('DMA/host writes never acquire the previous CPU command source', () => {
	const { images } = createCartlibProgramHarness(PROGRAM);
	const { runtime, sources } = eventHistoryRuntime(images);
	const history = new RuntimeGteHistory(runtime, sources), lease = history.observe();
	runtime.machine.scheduler.runCpuSlice(0, BUDGET);
	const memory = runtime.machine.memory;
	memory.writeMappedWord(IO_GX_GTE_DATA0, 17);
	memory.writeMappedWord(IO_GX_GTE_COMMAND, 0);
	const host = history.snapshot(2);
	assert.equal(host.domain, undefined); assert.equal(host.pc, undefined); assert.equal(host.image, null);
	assert.equal(host.nominalCycles, 0);
	memory.writeMappedDmaU32LE(IO_GX_GTE_COMMAND, 0, MAPPED_BUS_MASTER_DMA);
	const dma = history.snapshot(3);
	assert.equal(dma.busSignals, MAPPED_BUS_MASTER_DMA);
	assert.equal(dma.domain, undefined); assert.equal(dma.pc, undefined); assert.equal(dma.image, null);
	lease.dispose();
});
