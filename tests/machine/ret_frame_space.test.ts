import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRAME_RESIDENT_ACTIVATION, FRAME_RESIDENT_PLACE_WINDOW, FRAME_RESIDENT_RETIRE_WINDOW_SOURCE } from '../../machine/ts/machine/cpu/call_state';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import * as Upvalue from '../../machine/ts/machine/cpu/upvalue';
import { valueInteger } from '../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_RESIDENT_OFFSET, HeapServiceResidentField, PreparedWindowField } from '../../machine/ts/spec/bmsx/heap_service';
import { returnWindowFixture } from '../helpers/return_window';

for (const level of [0, 3] as const) {
	function prepare() {
		const f = returnWindowFixture(level), { cpu, memory, management, thread, callee, caller, issue } = f;
		const prior = { depth: thread.frameDepth, receiver: caller.stackCapacity, sourceOffset: callee.controlOffset,
			receiverOffset: caller.controlOffset, destination: callee.returnBase, top: caller.top, value: caller.registers.get(0),
			pc: caller.pc, backing: memory.readRamRecordWord(thread.address + ThreadField.StackBlock),
			frames: memory.readRamRecordWord(thread.address + ThreadField.FrameBlock) };
		const cell = memory.readRamRecordWord(callee.openUpvalueHead + Upvalue.UPVALUE_VALUE_WORD);
		assert.notEqual(callee.openUpvalueHead, 0);
		assert.equal(cell, callee.stackBase, 'the source frame still owns its open marker before RET');
		function issueReturn() {
			assert.deepEqual(f.grant(1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.RET] + 1 });
			assert.ok(cpu.heapServiceActive());
			assert.equal(f.flags(), FRAME_RESIDENT_ACTIVATION | FRAME_RESIDENT_PLACE_WINDOW | FRAME_RESIDENT_RETIRE_WINDOW_SOURCE);
			assert.equal(memory.readRamRecordWord(management + HEAP_SERVICE_RESIDENT_OFFSET + HeapServiceResidentField.IssuePc), issue);
			assert.equal(callee.pc, issue + INSTRUCTION_BYTES);
			assert.equal(callee.openUpvalueHead, 0);
			assert.equal(thread.currentFrame!.controlOffset, prior.sourceOffset, 'the source is still live until placement');
			assert.equal(caller.stackCapacity, prior.receiver);
			assert.equal(caller.top, prior.top);
			assert.equal(caller.registers.get(0), prior.value);
			assert.equal(f.prepared(PreparedWindowField.SourceSlot), callee.stackBase + f.first);
			assert.equal(f.prepared(PreparedWindowField.Copied), f.expected.length);
			assert.equal(f.prepared(PreparedWindowField.Padded), 0);
			assert.equal(f.prepared(PreparedWindowField.Capacity), 128);
		}
		function settle() {
			const trace: number[] = [];
			for (let n = 0; n < 65_536 && cpu.heapServiceActive(); ++n) {
				const { result, used } = f.grant(139);
				assert.ok(result === RunResult.Yielded || (!cpu.heapServiceActive() && result === RunResult.Halted));
				assert.ok(used > 0);
				trace.push(used);
			}
			assert.equal(cpu.heapServiceActive(), false);
			return trace;
		}
		return { ...f, prior, issueReturn, settle };
	}

	test(`ordinary RET keeps the source live across BIOS backing growth and rewind at O${level}`, () => {
		const f = prepare(), { cpu, memory, callee, thread, prior } = f;
		const originalCell = callee.openUpvalueHead;
		f.issueReturn();
		assert.equal(Upvalue.isOpen(memory, originalCell), false);
		assert.equal(Upvalue.load(memory, originalCell), valueInteger(183));
		assert.equal(memory.readRamRecordWord(thread.address + ThreadField.StackBlock), prior.backing);
		assert.equal(f.grant(23).result, RunResult.Yielded);
		assert.ok(cpu.heapServiceActive());
		cpu.requestNonMaskableInterrupt();
		assert.equal(cpu.enterPendingInterrupt(), false, 'the pinned return excludes a second executor');
		cpu.cancelNonMaskableInterrupt();
		const history = new RamHistory();
		history.start(memory);
		const partial = history.capture(memory, null), state = cpu.captureRuntimeState();
		function finish() {
			const trace = f.settle();
			const receiver = thread.currentFrame!;
			assert.equal(receiver.controlOffset, prior.receiverOffset);
			assert.equal(thread.frameDepth, prior.depth - 1);
			assert.equal(receiver.pc, prior.pc, 'the ordinary successor has not executed');
			assert.equal(receiver.stackCapacity, 128);
			assert.equal(thread.stackTop, receiver.stackBase + receiver.stackCapacity);
			assert.equal(memory.readRamRecordWord(thread.address + ThreadField.FrameBlock), prior.frames);
			assert.deepEqual(f.expected.map((_, i) => receiver.registers.get(prior.destination + i)), f.expected);
			assert.equal(f.grant(65_536).result, RunResult.Halted);
			assert.deepEqual(f.runtime.readCompletionValues(), f.completion);
			return trace;
		}
		const trace = finish(), end = history.capture(memory, partial);
		history.restore(memory, end, partial);
		cpu.restoreRuntimeState(state);
		assert.deepEqual(finish(), trace);
	});

	test(`ordinary RET terminal physical OOM does not retire the source or write the caller at O${level}`, () => {
		const f = prepare(), { cpu, memory, thread, callee, prior } = f;
		const originalCell = callee.openUpvalueHead;
		while (f.arena.allocate(4088, true)) { /* exhaust pages */ }
		while (f.arena.allocate(24, true)) { /* exhaust the tail */ }
		f.issueReturn();
		f.settle();
		assert.equal(cpu.readEpcWord(), f.issue);
		assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
		// Exception entry may introduce its own handler frame above them.
		const source = thread.frameAtDepth(prior.depth - 1), receiver = source.previous!;
		assert.equal(source.controlOffset, prior.sourceOffset);
		assert.equal(source.pc, f.issue);
		assert.equal(receiver.controlOffset, prior.receiverOffset);
		assert.equal(receiver.pc, prior.pc);
		assert.equal(receiver.stackCapacity, prior.receiver);
		assert.equal(receiver.top, prior.top);
		assert.equal(receiver.registers.get(0), prior.value);
		assert.equal(memory.readRamRecordWord(thread.address + ThreadField.StackBlock), prior.backing);
		assert.equal(cpu.gc.closureRecordAddress(f.closure), f.closure, 'a returned Closure remains rooted by the retiring frame');
		assert.equal(Upvalue.load(memory, originalCell), valueInteger(183));
	});
}
