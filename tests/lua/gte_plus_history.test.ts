import assert from 'node:assert/strict';
import test from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { IO_GX_GTE_COMMAND, IO_GX_GTE_PLUS_BASE } from '../../machine/ts/spec/bmsx/io';
import { IO_WORD_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { GX_GTE_PLUS_ADD_XY, GX_GTE_PLUS_COMMAND, GX_GTE_PLUS_CYCLES } from '../../machine/ts/machine/devices/gx/gte';
import { HistoryMode } from '../../machine/ts/machine/runtime/history/history';
import { RuntimeRestoreOrigin } from '../../machine/ts/machine/runtime/save_state';
import { RuntimeGteHistory } from '../../ide/runtime/gte_history';
import { encodeGteCommand } from '../../ide/workbench/services/assistant/gte_tool_protocol';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { eventHistoryRuntime } from '../helpers/event_history';

const COMMAND = IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE;
const CYCLES = IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_CYCLES * IO_WORD_SIZE;
const PROGRAM = `
local plus<const>: *word = 0x08010384
function accept()
	plus[0] = 0x20001000
	plus[1] = 0x3000
	plus[2] = 0x10002000
	plus[3] = 0xf000
	plus[4] = 0x800
	plus[8] = 1
end
function publish()
	while (plus[9] & 0x80000000) ~= 0 do end
	return plus[9]
end
return true`;
const BUDGET = 10_000_000;

test('PLUS history retains accepted operands separately from later writable inputs and actual publication', () => {
	const { images } = createCartlibProgramHarness(PROGRAM);
	const { runtime, sources, cpu } = eventHistoryRuntime(images);
	const history = new RuntimeGteHistory(runtime, sources), lease = history.observe();
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
	const invoke = (name: string) => {
		const start = runtime.machine.scheduler.nowCycles;
		cpu.beginCompletionCall(cpu.getGlobalByKey(cpu.stringPool.find(name)!) as Closure, []);
		assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
		runtime.machine.scheduler.advanceTo(start + BUDGET - cpu.instructionBudgetRemaining);
	};
	invoke('accept');
	assert.equal(history.count, 1);
	const accepted = history.snapshot(0);
	assert.equal(accepted.kind, 'plus-accepted');
	assert.equal(accepted.nominalCycles, 5);
	assert.equal(accepted.deadlineCycles, accepted.cycles + 5);
	assert.equal(accepted.beforePlus[9], 0x80000005);
	assert.equal(accepted.domain, 0);
	assert.ok(accepted.pc !== undefined);
	// A read of host evidence after the deadline must not materialize the device latch.
	runtime.machine.scheduler.advanceTo(accepted.deadlineCycles! + 17);
	history.snapshot(0);
	assert.equal(history.count, 1);
	// An actual input-port write materializes overdue work BEFORE changing that port.
	runtime.machine.memory.writeMappedWord(IO_GX_GTE_PLUS_BASE, 0);
	assert.equal(history.count, 2);
	const published = history.snapshot(1);
	assert.equal(published.kind, 'plus-published');
	assert.equal(published.acceptedSequence, 0);
	assert.equal(published.acceptedCycles, accepted.cycles);
	assert.equal(published.deadlineCycles, accepted.deadlineCycles);
	assert.equal(published.cycles, accepted.deadlineCycles! + 17);
	assert.equal(published.pc, accepted.pc, 'the publication trigger does not replace the accepted instruction identity');
	assert.equal(published.image, accepted.image);
	assert.deepEqual(Array.from(published.beforePlus.slice(0, 5)), [0x20001000, 0x3000, 0x10002000, 0xf000, 0x800]);
	assert.equal(published.afterPlus[5], 0x28002000);
	assert.equal(published.afterPlus[6], 0x2800);
	assert.equal(published.afterPlus[7], 0);
	assert.equal(published.afterPlus[9], 5);
	assert.equal(accepted.kind, 'plus-accepted');
	assert.equal(accepted.beforePlus[9], 0x80000005, 'a pinned accepted record never acquires later publication');
	assert.equal(runtime.machine.memory.readMappedWord(IO_GX_GTE_PLUS_BASE), 0);
	invoke('accept');
	const nextAccepted = history.snapshot(2);
	invoke('publish');
	const nextPublished = history.snapshot(3);
	assert.equal(nextPublished.pc, nextAccepted.pc, 'a different guest instruction publishes the result without becoming its origin');
	assert.equal(nextPublished.acceptedSequence, 2);
	lease.dispose();
});

test('PLUS pending provenance survives command-ring expiry and rewritten operands', () => {
	const { images } = createCartlibProgramHarness('return true');
	const { runtime, sources } = eventHistoryRuntime(images);
	const memory = runtime.machine.memory, scheduler = runtime.machine.scheduler;
	const history = new RuntimeGteHistory(runtime, sources, 1), lease = history.observe();
	scheduler.setNowCycles(0x100000000 + 13);
	for (const [index, word] of [0x20001000, 0x3000, 0x10002000, 0xf000, 0x800].entries()) memory.writeMappedWord(IO_GX_GTE_PLUS_BASE + index * IO_WORD_SIZE, word);
	memory.writeMappedWord(COMMAND, 1);
	const accepted = history.snapshot(0);
	memory.writeMappedWord(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE, 0x11112222);
	memory.writeMappedWord(IO_GX_GTE_COMMAND, 0);
	assert.equal(history.firstSequence, 1);
	scheduler.setNowCycles(accepted.deadlineCycles! + 8);
	assert.equal(memory.readMappedWord(CYCLES), 5);
	const published = history.snapshot(2);
	assert.equal(published.acceptedSequence, 0);
	assert.equal(published.beforePlus[0], 0x20001000);
	assert.equal(published.afterPlus[0], 0x11112222, 'publication bank current inputs may already describe the next job');
	assert.equal(published.afterPlus[5], 0x28002000);
	const encoded = encodeGteCommand(published, false);
	assert.ok(encoded.kind === 'plus-published');
	assert.equal(encoded.beforePlus![0], 0x20001000);
	assert.equal(encoded.afterPlus[0], 0x11112222);
	assert.ok(published.cycles > 0x100000000);
	lease.dispose();
});

for (const gap of ['reopen', 'clear', 'restore', 'branch'] as const) test(`PLUS publication after ${gap} does not invent acceptance or source`, () => {
	const { images } = createCartlibProgramHarness('return true');
	const { runtime, sources } = eventHistoryRuntime(images);
	const history = new RuntimeGteHistory(runtime, sources);
	let lease = history.observe();
	const memory = runtime.machine.memory;
	memory.writeMappedWord(COMMAND, 1);
	const accepted = history.snapshot(0), end = history.endSequence;
	if (gap === 'reopen') { lease.dispose(); lease = history.observe(); }
	else if (gap === 'clear') history.clear();
	else if (gap === 'restore') history.didRestore(RuntimeRestoreOrigin.HistorySeek);
	else history.beginTimeline();
	runtime.machine.scheduler.setNowCycles(accepted.deadlineCycles! + 1);
	memory.readMappedWord(CYCLES);
	const published = history.snapshot(end);
	assert.equal(published.kind, 'plus-published');
	assert.equal(published.acceptedSequence, undefined);
	assert.equal(published.acceptedCycles, undefined);
	assert.equal(published.domain, undefined);
	assert.equal(published.image, null);
	const encoded = encodeGteCommand(published, false);
	assert.ok(encoded.kind === 'plus-published');
	assert.equal(encoded.beforePlus, undefined);
	assert.equal(encoded.source, undefined);
	assert.equal(encoded.busSignals, undefined);
	lease.dispose();
});

test('PLUS replay acceptance and publication are not added to retained evidence', () => {
	const { images } = createCartlibProgramHarness('return true');
	const { runtime, sources } = eventHistoryRuntime(images);
	const history = new RuntimeGteHistory(runtime, sources), lease = history.observe();
	runtime.history.mode = HistoryMode.Replaying;
	runtime.machine.memory.writeMappedWord(COMMAND, 1);
	runtime.machine.scheduler.setNowCycles(20);
	runtime.machine.memory.readMappedWord(CYCLES);
	assert.equal(history.count, 0);
	lease.dispose();
});

test('PLUS observation leases release their admitted buffer after runtime owner shutdown', () => {
	const { images } = createCartlibProgramHarness('return true');
	const { runtime, sources } = eventHistoryRuntime(images);
	const history = new RuntimeGteHistory(runtime, sources), lease = history.observe();
	runtime.machine.memory.writeMappedWord(COMMAND, 1);
	history.dispose();
	assert.doesNotThrow(() => lease.dispose());
	assert.equal(history.observing, false);
	runtime.machine.scheduler.setNowCycles(20);
	assert.equal(runtime.machine.memory.readMappedWord(CYCLES), 5);
});
