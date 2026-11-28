import { nativeHeapReference } from '../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import * as Upvalue from '../../machine/ts/machine/cpu/upvalue';
import { valueInteger } from '../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { CPU_CAUSE_CODE_REGISTER_WINDOW } from '../../machine/ts/spec/blua32/cop0';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { IO_SYS_SUPERVISOR_FAULT_CAUSE, IO_SYS_SUPERVISOR_FAULT_EPC, IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../machine/ts/spec/bmsx/io';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS } from '../../machine/ts/spec/bmsx/memory_map';
import { returnWindowFixture } from '../helpers/return_window';

for (const level of [0, 3] as const) {
	function prepare() {
		const f = returnWindowFixture(level), { cpu, memory, thread, callee, caller, issue } = f;
		const prior = { depth: thread.frameDepth, receiver: caller.stackCapacity, sourceOffset: callee.controlOffset,
			receiverOffset: caller.controlOffset, destination: callee.returnBase, top: caller.top, value: caller.registers.get(0),
			pc: caller.pc, backing: memory.readRamRecordWord(thread.address + ThreadField.StackBlock),
			frames: memory.readRamRecordWord(thread.address + ThreadField.FrameBlock) };
		const cell = callee.openUpvalueHead;
		assert.notEqual(cell, 0);
		assert.equal(memory.readRamRecordWord(cell + Upvalue.UPVALUE_VALUE_WORD), callee.stackBase);
		function issueReturn() {
			assert.deepEqual(f.grant(1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.RET] });
			assert.equal(cpu.fixedInterruptActive(), true);
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_REGISTER_WINDOW);
			assert.equal(cpu.readEpcWord(), issue);
			assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), thread.address);
			assert.equal(callee.pc, issue);
			assert.equal(callee.openUpvalueHead, cell, 'the failed attempt has not closed the issuing frame');
			assert.equal(thread.currentFrame, callee);
			assert.equal(caller.stackCapacity, prior.receiver);
			assert.equal(caller.top, prior.top);
			assert.equal(caller.registers.get(0), prior.value);
			assert.equal(cpu.activeThread.currentFrame!.registers.get(0), valueInteger(caller.stackBase + 128));
			assert.equal(cpu.activeThread.currentFrame!.registers.get(1), valueInteger(0));
		}
		return { ...f, prior, cell, issueReturn };
	}

	test(`ordinary RET keeps its source live through firmware backing growth and rewind at O${level}`, () => {
		const f = prepare(), { cpu, memory, thread, prior, cell } = f;
		f.issueReturn();
		assert.equal(Upvalue.isOpen(memory, cell), true);
		assert.equal(memory.readRamRecordWord(thread.address + ThreadField.StackBlock), prior.backing);
		assert.equal(f.grant(23).result, RunResult.Yielded);
		assert.equal(cpu.fixedInterruptActive(), true);
		cpu.requestNonMaskableInterrupt();
		assert.equal(cpu.enterPendingInterrupt(), false, 'the detached vector excludes another executor');
		cpu.cancelNonMaskableInterrupt();
		const history = new RamHistory();
		history.start(memory);
		const partial = history.capture(memory, null), state = cpu.captureRuntimeState();
		function finish() {
			const trace: number[] = [];
			for (let n = 0; n < 65_536 && cpu.fixedInterruptActive(); ++n) {
				const { result, used } = f.grant(1);
				assert.equal(result, RunResult.Yielded);
				assert.ok(used > 0);
				trace.push(used);
			}
			assert.equal(cpu.activeThread, thread);
			assert.equal(thread.frameDepth, prior.depth);
			assert.equal(thread.currentFrame!.pc, f.issue, 'RFE has not executed the RET again');
			assert.equal(Upvalue.isOpen(memory, cell), false, 'firmware closes captures before allocating the backing');
			assert.equal(Upvalue.load(memory, cell), valueInteger(183));
			assert.deepEqual(f.grant(1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.RET] + f.expected.length });
			const receiver = thread.currentFrame!;
			assert.equal(receiver.controlOffset, prior.receiverOffset);
			assert.equal(thread.frameDepth, prior.depth - 1);
			assert.equal(receiver.pc, prior.pc, 'the receiver successor has not executed');
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

	test(`ordinary RET terminal physical refusal leaves its source and receiver intact at O${level}`, () => {
		const f = prepare(), { cpu, memory, thread, prior, cell } = f;
		while (f.arena.allocate(4088, true)) { /* exhaust pages */ }
		while (f.arena.allocate(24, true)) { /* exhaust the tail */ }
		f.issueReturn();
		for (let n = 0; n < 4096 && memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) === 0; ++n) f.grant(243);
		assert.equal(memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE), 1);
		assert.equal(memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_CAUSE), CPU_CAUSE_CODE_REGISTER_WINDOW);
		assert.equal(memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_EPC), f.issue);
		assert.equal(cpu.readLuaFaultReasonWord(), 0, 'the BIOS reported the machine window exception');
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), thread.address);
		const source = thread.frameAtDepth(prior.depth - 1), receiver = source.previous!;
		assert.equal(source.controlOffset, prior.sourceOffset);
		assert.equal(source.pc, f.issue);
		assert.equal(receiver.controlOffset, prior.receiverOffset);
		assert.equal(receiver.pc, prior.pc);
		assert.equal(receiver.stackCapacity, prior.receiver);
		assert.equal(receiver.top, prior.top);
		assert.equal(receiver.registers.get(0), prior.value);
		assert.equal(memory.readRamRecordWord(thread.address + ThreadField.StackBlock), prior.backing);
		assert.equal(nativeHeapReference(cpu).gc.closureRecordAddress(f.closure), f.closure);
		assert.equal(Upvalue.isOpen(memory, cell), false);
		assert.equal(Upvalue.load(memory, cell), valueInteger(183));
	});
}
