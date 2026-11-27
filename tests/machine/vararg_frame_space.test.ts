import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRAME_RESIDENT_ACTIVATION, FRAME_RESIDENT_PLACE_WINDOW, FrameField } from '../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { valueInteger, valuePayload } from '../../machine/ts/machine/cpu/value';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, instructionOpcode } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import {
	HEAP_SERVICE_BIOS_CALL_OFFSET, HEAP_SERVICE_FRAME_OFFSET, HEAP_SERVICE_PREPARED_FRAME_OFFSET, HEAP_SERVICE_RESIDENT_OFFSET,
	HEAP_SERVICE_RESULT_FAULT, HeapServiceBiosCallField, HeapServiceBiosCallKind, HeapServiceResidentField, PreparedWindowField,
} from '../../machine/ts/spec/bmsx/heap_service';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { runGuestToHalt } from '../helpers/cpu_execution';
import { compileHeapServiceSystem } from '../helpers/heap_service_system';

const source = `
local function capture(n)
	return function(...) return n, ... end
end
return capture(183)
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const args = Array.from({ length: 33 }, (_, i) => valueInteger(i + 74));

for (const level of [0, 3] as const) {
	function fixture() {
		const linked = linkTestSystemBlua32(compileHeapServiceSystem(source, level));
		const runtime = new Runtime({ systemRomBytes: linked.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine, arena = cpu.heapAllocator;
		runGuestToHalt(cpu, 65_536);
		cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
		const [value] = runtime.readCompletionValues(), closure = valuePayload(value);
		cpu.beginCompletionCall(closure, args);
		assert.deepEqual(runtime.readCompletionValues(), [], 'boot’s completion latch is no longer a root');
		const thread = cpu.activeThread, frame = thread.currentFrame!;
		const management = arena.managementOffset();
		const readThread = (field: ThreadField) => memory.readRamRecordWord(thread.address + field);
		const prepared = (field: PreparedWindowField) => memory.readRamRecordWord(management + HEAP_SERVICE_PREPARED_FRAME_OFFSET + field);
		const resident = (field: HeapServiceResidentField) => memory.readRamRecordWord(management + HEAP_SERVICE_RESIDENT_OFFSET + field);
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			return { result, used: cycles - cpu.instructionBudgetRemaining };
		}
		for (let n = 0; n < 64 && instructionOpcode(memory.readMappedU32LE(frame.pc)) !== OpCode.VARARG; ++n)
			assert.equal(grant(1).result, RunResult.Yielded);
		const issue = frame.pc;
		assert.equal(instructionOpcode(memory.readMappedU32LE(issue)), OpCode.VARARG);
		const priorTop = frame.top, priorWindow = frame.stackCapacity, priorValues = thread.stackRegisters.capacity();
		const priorValueBlock = readThread(ThreadField.StackBlock), priorFrames = readThread(ThreadField.FrameBlock);
		function launch() {
			assert.deepEqual(grant(1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.VARARG] });
			assert.ok(cpu.heapServiceActive());
			assert.equal(memory.readRamRecordWord(management + HEAP_SERVICE_FRAME_OFFSET + FrameField.Flags),
				FRAME_RESIDENT_ACTIVATION | FRAME_RESIDENT_PLACE_WINDOW);
			assert.equal(memory.readRamRecordWord(management + HEAP_SERVICE_BIOS_CALL_OFFSET + HeapServiceBiosCallField.Kind), HeapServiceBiosCallKind.Idle);
			assert.equal(resident(HeapServiceResidentField.IssuePc), issue);
			assert.equal(frame.pc, issue + INSTRUCTION_BYTES);
			assert.equal(frame.top, priorTop);
			assert.equal(frame.stackCapacity, priorWindow);
			assert.equal(prepared(PreparedWindowField.Destination), 1);
			assert.equal(prepared(PreparedWindowField.SourceSlot), frame.varargBase);
			assert.equal(prepared(PreparedWindowField.Copied), args.length);
			assert.equal(prepared(PreparedWindowField.Padded), 0);
			assert.equal(prepared(PreparedWindowField.Capacity), 64);
			assert.equal(prepared(PreparedWindowField.Top), args.length + 1);
			assert.equal(readThread(ThreadField.StackBlock), priorValueBlock);
			assert.equal(thread.stackRegisters.capacity(), priorValues);
		}
		function finish() {
			const trace: number[] = [];
			for (let n = 0; n < 65_536 && cpu.heapServiceActive(); ++n) {
				const { result, used } = grant(139);
				assert.equal(result, RunResult.Yielded);
				assert.ok(used > 0);
				trace.push(used);
			}
			assert.equal(cpu.heapServiceActive(), false);
			return trace;
		}
		return { cpu, runtime, memory, arena, thread, frame, closure, issue, priorFrames, priorValues, priorTop, priorWindow, priorValueBlock, readThread, resident, grant, launch, finish };
	}

	test(`VARARG backing grows in one private activation without early copy and resumes exactly at O${level}`, () => {
		const f = fixture(), { cpu, memory, thread } = f;
		const controlOffset = f.frame.controlOffset;
		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null);
		f.launch();
		assert.equal(f.grant(17).result, RunResult.Yielded);
		assert.ok(cpu.heapServiceActive());
		const state = cpu.captureRuntimeState(), partial = history.capture(memory, baseline);
		function settle() {
			const trace = f.finish();
			assert.equal(f.resident(HeapServiceResidentField.SourceCount), 0);
			const frame = thread.currentFrame!;
			assert.equal(frame.controlOffset, controlOffset);
			assert.equal(frame.pc, f.issue + INSTRUCTION_BYTES, 'no ordinary successor executes at fixed retirement');
			assert.equal(frame.stackCapacity, 64);
			assert.ok(thread.stackRegisters.capacity() > f.priorValues);
			assert.equal(f.readThread(ThreadField.FrameBlock), f.priorFrames, 'Values-only backing request leaves controls in place');
			assert.equal(frame.top, args.length + 1);
			for (let i = 0; i < args.length; ++i) assert.equal(frame.registers.get(i + 1), args[i]);
			assert.equal(f.grant(65_536).result, RunResult.Halted);
			assert.deepEqual(f.runtime.readCompletionValues(), [valueInteger(183), ...args]);
			return trace;
		}
		const trace = settle(), end = history.capture(memory, partial);
		history.restore(memory, end, partial);
		cpu.restoreRuntimeState(state);
		assert.deepEqual(settle(), trace);
	});

	test(`VARARG only widens the window inline when its backing already fits at O${level}`, () => {
		const f = fixture();
		f.thread.resizeStack(128);
		const block = f.readThread(ThreadField.StackBlock), occupied = f.arena.occupiedBytes();
		assert.deepEqual(f.grant(1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.VARARG] + args.length });
		assert.equal(f.cpu.heapServiceActive(), false);
		assert.equal(f.frame.stackCapacity, 64);
		assert.equal(f.frame.top, args.length + 1);
		assert.equal(f.frame.pc, f.issue + INSTRUCTION_BYTES);
		assert.equal(f.readThread(ThreadField.StackBlock), block);
		assert.equal(f.arena.occupiedBytes(), occupied);
		assert.equal(f.grant(65_536).result, RunResult.Halted);
		assert.deepEqual(f.runtime.readCompletionValues(), [valueInteger(183), ...args]);
	});

	test(`VARARG OOM leaves the live window untouched and reports the issuer at O${level}`, () => {
		const f = fixture();
		while (f.arena.allocate(4088, true)) { /* exhaust pages */ }
		while (f.arena.allocate(24, true)) { /* exhaust the tail */ }
		f.launch();
		f.finish();
		assert.equal(f.cpu.readEpcWord(), f.issue);
		assert.equal(f.cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
		assert.equal(f.resident(HeapServiceResidentField.SourceCount), HEAP_SERVICE_RESULT_FAULT);
		assert.equal(f.resident(HeapServiceResidentField.SourceBase), LUA_FAULT_REASON_OUT_OF_MEMORY);
		assert.equal(f.frame.top, f.priorTop);
		assert.equal(f.frame.stackCapacity, f.priorWindow);
		assert.equal(f.readThread(ThreadField.StackBlock), f.priorValueBlock);
		assert.equal(f.cpu.gc.closureRecordAddress(f.closure), f.closure, 'unchanged active frame is a GC root without an extra scope');
	});
}
