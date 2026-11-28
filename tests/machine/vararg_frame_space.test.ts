import { nativeHeapReference } from '../helpers/native_heap/reference';
import { resizeThreadStackReference } from '../helpers/thread_allocation_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { valueInteger } from '../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { CPU_CAUSE_CODE_REGISTER_WINDOW } from '../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { IO_SYS_SUPERVISOR_FAULT_CAUSE, IO_SYS_SUPERVISOR_FAULT_EPC, IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../machine/ts/spec/bmsx/io';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS } from '../../machine/ts/spec/bmsx/memory_map';
import { varargArguments as args, varargWindowFixture } from '../helpers/vararg_window';

for (const level of [0, 3] as const) {
	function fixture() {
		const f = varargWindowFixture(level), { cpu, memory } = f;
		const frame = f.begin(args), thread = frame.thread;
		const readThread = (field: ThreadField) => memory.readRamRecordWord(thread.address + field);
		const issue = frame.pc, priorTop = frame.top, priorWindow = frame.stackCapacity;
		const priorValues = thread.stackRegisters.capacity(), priorBlock = readThread(ThreadField.StackBlock);
		const priorFrames = readThread(ThreadField.FrameBlock);
		function launch() {
			assert.deepEqual(f.grant(1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.VARARG] });
			assert.equal(cpu.fixedInterruptActive(), true);
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_REGISTER_WINDOW);
			assert.equal(cpu.readEpcWord(), issue);
			assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), thread.address);
			assert.equal(frame.pc, issue);
			assert.equal(frame.top, priorTop);
			assert.equal(frame.stackCapacity, priorWindow);
			assert.equal(readThread(ThreadField.StackBlock), priorBlock);
			assert.equal(thread.stackRegisters.capacity(), priorValues);
			assert.equal(cpu.activeThread.currentFrame!.registers.get(0), valueInteger(frame.stackBase + 64));
			assert.equal(cpu.activeThread.currentFrame!.registers.get(1), valueInteger(0));
			assert.deepEqual(args.map((_, i) => thread.stackRegisters.get(frame.varargBase + i)), args);
		}
		return { ...f, frame, thread, issue, priorTop, priorWindow, priorValues, priorBlock, priorFrames, readThread, launch };
	}

	test(`ordinary VARARG copies only after firmware backing growth and RFE at O${level}`, () => {
		const f = fixture(), { cpu, memory, thread } = f;
		const controlOffset = f.frame.controlOffset;
		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null);
		f.launch();
		assert.equal(f.grant(17).result, RunResult.Yielded);
		assert.equal(cpu.fixedInterruptActive(), true);
		const state = cpu.captureRuntimeState(), partial = history.capture(memory, baseline);
		function finish() {
			const trace: number[] = [];
			for (let n = 0; n < 65_536 && cpu.fixedInterruptActive(); ++n) {
				const { result, used } = f.grant(1);
				assert.equal(result, RunResult.Yielded);
				assert.ok(used > 0);
				trace.push(used);
			}
			assert.equal(cpu.activeThread, thread);
			const frame = thread.currentFrame!;
			assert.equal(frame.controlOffset, controlOffset);
			assert.equal(frame.pc, f.issue, 'RFE has not placed any of the arguments');
			assert.equal(frame.top, f.priorTop);
			assert.equal(frame.stackCapacity, f.priorWindow);
			assert.ok(thread.stackRegisters.capacity() > f.priorValues);
			assert.equal(f.readThread(ThreadField.FrameBlock), f.priorFrames);
			assert.deepEqual(f.grant(1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.VARARG] + args.length });
			assert.equal(frame.stackCapacity, 64);
			assert.equal(frame.top, args.length + 1);
			assert.equal(frame.pc, f.issue + INSTRUCTION_BYTES);
			assert.deepEqual(args.map((_, i) => frame.registers.get(i + 1)), args);
			assert.equal(f.grant(65_536).result, RunResult.Halted);
			assert.deepEqual(f.runtime.readCompletionValues(), f.completion);
			return trace;
		}
		const trace = finish(), end = history.capture(memory, partial);
		history.restore(memory, end, partial);
		cpu.restoreRuntimeState(state);
		assert.deepEqual(finish(), trace);
	});

	test(`VARARG only widens the window inline when its backing already fits at O${level}`, () => {
		const f = fixture();
		resizeThreadStackReference(f.cpu, f.thread, 128);
		const block = f.readThread(ThreadField.StackBlock), occupied = f.arena.occupiedBytes();
		assert.deepEqual(f.grant(1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.VARARG] + args.length });
		assert.equal(f.cpu.fixedInterruptActive(), false);
		assert.equal(f.frame.stackCapacity, 64);
		assert.equal(f.frame.top, args.length + 1);
		assert.equal(f.frame.pc, f.issue + INSTRUCTION_BYTES);
		assert.equal(f.readThread(ThreadField.StackBlock), block);
		assert.equal(f.arena.occupiedBytes(), occupied);
		assert.equal(f.grant(65_536).result, RunResult.Halted);
		assert.deepEqual(f.runtime.readCompletionValues(), f.completion);
	});

	test(`ordinary VARARG terminal refusal keeps arguments and the issuing window untouched at O${level}`, () => {
		const f = fixture(), { memory } = f;
		while (f.arena.allocate(4088, true)) { /* exhaust pages */ }
		while (f.arena.allocate(24, true)) { /* exhaust the tail */ }
		f.launch();
		for (let n = 0; n < 4096 && memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) === 0; ++n) f.grant(243);
		assert.equal(memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE), 1);
		assert.equal(memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_CAUSE), CPU_CAUSE_CODE_REGISTER_WINDOW);
		assert.equal(memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_EPC), f.issue);
		assert.equal(f.cpu.readLuaFaultReasonWord(), 0, 'the BIOS reported the machine window exception');
		assert.equal(f.frame.top, f.priorTop);
		assert.equal(f.frame.stackCapacity, f.priorWindow);
		assert.equal(f.readThread(ThreadField.StackBlock), f.priorBlock);
		assert.equal(nativeHeapReference(f.cpu).gc.closureRecordAddress(f.closure), f.closure);
		assert.deepEqual(args.map((_, i) => f.thread.stackRegisters.get(f.frame.varargBase + i)), args);
	});
}
