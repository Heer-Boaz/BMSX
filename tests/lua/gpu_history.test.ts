import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeGpuHistory } from '../../ide/runtime/gpu_history';
import { GX_GPU_COMMAND_MAX_UPLOAD_WORD_COUNT, GX_GPU_COMMAND_WORD_CAPACITY } from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import { HistoryMode } from '../../machine/ts/machine/runtime/history/history';
import { RuntimeRestoreOrigin } from '../../machine/ts/machine/runtime/save_state';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { eventHistoryRuntime } from '../helpers/event_history';

function fixture(capacity = 2048, wordCapacity = GX_GPU_COMMAND_WORD_CAPACITY) {
	const { images } = createCartlibProgramHarness('return true');
	const { runtime } = eventHistoryRuntime(images);
	const history = new RuntimeGpuHistory(runtime, capacity, wordCapacity), gpu = runtime.machine.gxGpu, scheduler = runtime.machine.scheduler;
	const triangle = (color: number) => {
		scheduler.setNowCycles(scheduler.nowCycles + 10000);
		for (const word of [0x20000000 | color, 0x00100010, 0x00100020, 0x00200010]) gpu.writeGp0(word);
	};
	return { runtime, history, gpu, scheduler, triangle };
}

test('GPU history retains actual operation words and latched state independently of buffer retirement', () => {
	const f = fixture(), lease = f.history.observe();
	f.gpu.writeGp0(0xe5000000 | 3 | (5 << 11));
	f.triangle(0x123456);
	assert.equal(f.history.count, 1);
	const pinned = f.history.snapshot(0);
	assert.deepEqual(Array.from(pinned.words), [0x20123456, 0x00100010, 0x00100020, 0x00200010]);
	assert.equal(pinned.drawingOffsetWord, 3 | (5 << 11));
	assert.equal(pinned.opcode, 0x20);
	assert.ok(pinned.startCycles <= pinned.cycles);
	f.scheduler.setNowCycles(f.scheduler.nowCycles + 10000);
	f.gpu.readStatus(); f.gpu.retireExecutedCommands();
	f.gpu.writeGp0(0xe5000000);
	f.triangle(0xabcdef);
	assert.equal(f.history.snapshot(1).drawingOffsetWord, 0);
	assert.deepEqual(f.history.snapshot(0).words, pinned.words);
	assert.equal(pinned.drawingOffsetWord, 3 | (5 << 11));
	lease.dispose();
});

test('GPU word arena wraps and evicts whole events, retaining detached selection', () => {
	const f = fixture(3, 10), lease = f.history.observe();
	f.triangle(1); const pinned = f.history.snapshot(0);
	f.triangle(2); f.triangle(3);
	assert.equal(f.history.firstSequence, 1); assert.equal(f.history.endSequence, 3);
	assert.equal(f.history.wordCount, 8); assert.equal(f.history.expired, 1);
	assert.deepEqual(Array.from(f.history.snapshot(2).words), [0x20000003, 0x00100010, 0x00100020, 0x00200010]);
	const page = new Uint32Array(3); f.history.copyWords(2, 1, page);
	assert.deepEqual(Array.from(page), [0x00100010, 0x00100020, 0x00200010]);
	f.triangle(4); f.triangle(5);
	assert.equal(f.history.firstSequence, 3); assert.equal(pinned.words[0], 0x20000001);
	const generation = f.history.generation; f.history.clear();
	assert.equal(f.history.wordCount, 0); assert.equal(f.history.count, 0); assert.ok(f.history.generation > generation);
	f.triangle(6); assert.equal(f.history.wordCount, 4); assert.equal(f.history.snapshot(5).words[0], 0x20000006);
	lease.dispose();
});

test('GPU retention preserves the complete maximum upload without short-slot truncation', () => {
	const f = fixture(), lease = f.history.observe(), count = GX_GPU_COMMAND_MAX_UPLOAD_WORD_COUNT - 3;
	f.gpu.writeGp0(0xa0000000); f.gpu.writeGp0(0); f.gpu.writeGp0(0);
	for (let index = 0; index < count; index++) f.gpu.writeGp0(index);
	assert.equal(f.history.count, 1);
	const upload = f.history.snapshot(0);
	assert.equal(upload.wordCount, GX_GPU_COMMAND_MAX_UPLOAD_WORD_COUNT);
	assert.equal(upload.words.length, upload.wordCount);
	assert.equal(upload.words[3], 0); assert.equal(upload.words[upload.wordCount - 1], count - 1);
	const tail = new Uint32Array(2); f.history.copyWords(0, upload.wordCount - 2, tail);
	assert.deepEqual(Array.from(tail), [count - 2, count - 1]);
	lease.dispose();
});

test('GPU capture sessions, replay, restore, branch and shutdown keep evidence lifetimes explicit', () => {
	const f = fixture(2), first = f.history.observe(), second = f.history.observe();
	f.scheduler.setNowCycles(0x100000000 + 9); f.triangle(1);
	const pinned = f.history.snapshot(0), generation = f.history.generation;
	assert.ok(pinned.cycles > 0x100000000);
	first.dispose(); assert.equal(f.history.observing, true);
	for (const mode of [HistoryMode.Replaying, HistoryMode.Reviewing]) { f.runtime.history.mode = mode; f.triangle(2); }
	assert.equal(f.history.count, 1);
	f.runtime.history.mode = HistoryMode.Disabled;
	f.history.didRestore(RuntimeRestoreOrigin.HistorySeek); assert.equal(f.history.count, 1);
	f.history.beginTimeline(); f.triangle(3); assert.notEqual(f.history.at(1).timeline, pinned.timeline);
	second.dispose(); assert.equal(f.history.observing, false);
	const reopened = f.history.observe(); assert.equal(f.history.count, 0); assert.ok(f.history.generation > generation);
	f.triangle(4); f.history.didInstall(); assert.equal(f.history.count, 0);
	f.history.dispose(); assert.doesNotThrow(() => reopened.dispose()); assert.equal(f.history.observing, false);
	assert.equal(pinned.words[0], 0x20000001);
});
