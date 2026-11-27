import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_RESIDENT_ACTIVATION, FRAME_RESIDENT_PREPARED_ENTRY, FrameField, PreparedFrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { THREAD_HEAP_BYTES, THREAD_INITIAL_VALUES, ThreadField, ThreadStatus } from '../../../machine/ts/machine/cpu/thread_record';
import { ValueTag, valueBool, valueBuiltinFunction, valueInteger, valueNil, valuePayload, valueString, valueTable, valueTag, valueThread } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { BuiltinFunctionId } from '../../../machine/ts/spec/blua32/builtin';
import { LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_FRAME_OFFSET, HEAP_SERVICE_PREPARED_FRAME_OFFSET, HEAP_SERVICE_RESIDENT_OFFSET, HEAP_SERVICE_RESULT_FAULT, HeapServiceResidentField } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

// Reference at 1e4283127: TS cpu.ts:4621-4677 and C++ cpu.cpp:1357-1411
// select the new target before admitting its first frame, retain Entry at
// refusal, and deliver OOM through the resumer. The frame and stack policy
// remain the linked kernel/thread_frame_storage.reserve_frame_space leaf.
const source = `
local function start(resume, parent, child, box)
	return resume(parent, resume, child, box)
end
local function outer(resume, child, box)
	local ok, result, x, y = resume(child, 41, box, 5, 6, 7, 8, 9, 10, 11, 12, 17, 23)
	return ok, result, x, y
end
local function body(a, box, c, d, e, f, g, h, i, j, ...)
	local x, y = ...
	return a + box.marker + c + j + x + y, x, y
end
return start, outer, body
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
	buildDirectory: 'tmp/build-native-coroutine-first-resume',
	configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
});
const deadText = 'unreachable cross-Thread frame reservation blocker '.repeat(180);

for (const opt of [0, 3] as const) test(`first coroutine resume keeps the physical resumer window live at O${opt}`, async t => {
	const dir = mkdtempSync(join('tmp', 'coroutine-first-resume-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const linked = linkTestSystemBlua32(compileHeapServiceSystem(source, opt)), rom = join(dir, 'system.rom');
	writeFileSync(rom, linked.romBytes);
	for (const refuse of [false, true]) await t.test(refuse ? 'terminal physical refusal' : 'reclaim and resume', () => {
		const runtime = new Runtime({ systemRomBytes: linked.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, input);
		const { cpu, memory, scheduler } = runtime.machine, { gc, heapAllocator: arena, luaHeap: heap } = cpu;
		runtime.boot();
		runGuestToHalt(cpu, 65_536);
		const [start, outer, body] = runtime.readCompletionValues().slice().map(valuePayload);
		heap.setCollectionTarget(heap.capacity());
		// Test setup only: start two issued Thread records, with no admitted
		// frames. The nested CALLs below are the real coroutine.resume builtin.
		const parent = cpu.createThread(outer), child = cpu.createThread(body), box = cpu.createTable(0, 1);
		gc.tables.setStringKey(box, cpu.stringPool.intern('marker'), valueInteger(67));
		const resume = valueBuiltinFunction(BuiltinFunctionId.CoroutineResume);
		cpu.beginCompletionCall(start, [resume, valueThread(parent), valueThread(child), valueTable(box)]);
		const management = arena.managementOffset(), prepared = management + HEAP_SERVICE_PREPARED_FRAME_OFFSET;
		const resident = management + HEAP_SERVICE_RESIDENT_OFFSET;
		const read = (field: ThreadField) => memory.readRamRecordWord(child + field);
		const readParent = (field: ThreadField) => memory.readRamRecordWord(parent + field);
		const commands: string[] = [], expected: string[] = [];
		function observe(command: string, value?: number | string) {
			commands.push(command);
			if (value !== undefined) expected.push(String(value));
		}
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const paid = cycles - cpu.instructionBudgetRemaining;
			assert.equal(cpu.allocationParked(), false);
			observe(`g ${cycles} 0`, `${result} ${paid} ${+cpu.heapServiceActive()} ${arena.occupiedBytes()} ${heap.usedBytes()}`);
			return { result, paid };
		}
		const filename = (label: string) => join(dir, refuse ? 'refused-' + label : 'reclaimed-' + label);
		function save(label: string) {
			const path = filename(label);
			writeFileSync(path, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			return path;
		}
		function replay(seed: string, sequence: readonly string[], predictions: readonly string[]) {
			const path = filename('trace');
			writeFileSync(path, ['X', ...sequence].join('\n'));
			const actual = execFileSync(native, [rom, path, seed], { encoding: 'utf8' }).trimEnd().split('\n');
			assert.equal(actual.length, predictions.length);
			const mismatch = predictions.findIndex((word, i) => word !== actual[i]);
			assert.equal(mismatch, -1, `C++ trace line ${mismatch}: TS=${predictions[mismatch]}, C++=${actual[mismatch]}`);
		}
		function hash(address: number, length: number) {
			const from = address - RAM_BASE;
			observe(`H ${from} ${from + length}`, hashBytes(memory.ramData(), from, length));
		}
		const instruction = () => decodeBlua32InstructionAtPc(linked.image.textBytes, linked.image.header.textAddress, cpu.activeThread.currentFrame!.pc);
		for (let step = 0; step < 8192; ++step) {
			if (cpu.activeThread.address === parent && !cpu.heapServiceActive() && instruction().op === OpCode.CALL) break;
			grant(13);
		}
		assert.equal(cpu.activeThread.address, parent);
		assert.notEqual(cpu.rootThread.address, parent, 'the physical caller is not the root Thread');
		assert.equal(instruction().op, OpCode.CALL);
		assert.equal(read(ThreadField.Status), ThreadStatus.New);
		assert.equal(read(ThreadField.StackCapacity), THREAD_INITIAL_VALUES);
		gc.collect();
		heap.setCollectionTarget(heap.capacity());
		const dead = refuse ? 0 : cpu.stringPool.intern(deadText);
		if (!refuse) assert.ok(dead >= RAM_BASE);
		while (arena.allocate(4088, true)) { /* exclude remaining large extents */ }
		while (arena.allocate(24, true)) { /* force a physical stack-growth refusal */ }
		assert.equal(gc.phase(), GcPhase.Pause);
		const caller = cpu.activeThread.currentFrame!;
		const issue = caller.pc, decoded = instruction(), next = decoded.pc + INSTRUCTION_BYTES;
		const first = caller.stackBase + decoded.a + 2;
		assert.equal(caller.thread.stackRegisters.get(first), valueInteger(41));
		assert.equal(caller.thread.stackRegisters.get(first + 1), valueTable(box));
		const before = arena.occupiedBytes(), logical = heap.usedBytes(), stack = read(ThreadField.StackBlock);
		commands.length = expected.length = 0;
		const seed = save('seed');
		const issued = grant(1);
		assert.equal(issued.result, RunResult.Yielded);
		assert.ok(issued.paid >= BASE_CYCLES[OpCode.CALL]);
		assert.equal(cpu.heapServiceActive(), true);
		assert.equal(cpu.activeThread.address, child);
		assert.equal(cpu.getFrameDepth(), 0, 'still no entry frame');
		assert.equal(caller.pc, next);
		assert.equal(readParent(ThreadField.Status), ThreadStatus.Normal);
		assert.equal(read(ThreadField.Resumer), parent);
		assert.equal(read(ThreadField.Entry), body);
		assert.equal(read(ThreadField.Status), ThreadStatus.Running);
		assert.equal(memory.readRamRecordWord(prepared + PreparedFrameField.SourceSlot), first);
		assert.equal(memory.readRamRecordWord(prepared + PreparedFrameField.Supplied), 12);
		assert.equal(memory.readRamRecordWord(resident + HeapServiceResidentField.IssuePc), issue);
		assert.equal(memory.readRamRecordWord(management + HEAP_SERVICE_FRAME_OFFSET + FrameField.Flags),
			FRAME_RESIDENT_ACTIVATION | FRAME_RESIDENT_PREPARED_ENTRY);
		assert.equal(arena.occupiedBytes(), before);
		assert.equal(heap.usedBytes(), logical);
		for (let step = 0; step < 4096 && gc.phase() === GcPhase.Pause; ++step) grant(29);
		assert.equal(gc.phase(), GcPhase.Mark);
		assert.equal(read(ThreadField.StackBlock), stack);
		assert.equal(read(ThreadField.FrameDepth), 0);
		assert.equal(read(ThreadField.Entry), body);
		observe('l');
		observe('s');
		const mid = save('mid'), nativeMid = filename('native-mid');
		observe(`x ${nativeMid}`);
		const split = commands.length, resultSplit = expected.length;
		function finish() {
			for (let step = 0; step < 4096 && cpu.heapServiceActive(); ++step) {
				const outcome = grant(251);
				assert.ok(outcome.paid > 0, 'the guest reservation/collector spends ordinary cycles');
			}
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(gc.phase(), GcPhase.Pause);
			if (refuse) {
				assert.equal(cpu.activeThread.address, parent);
				assert.equal(read(ThreadField.Status), ThreadStatus.Failed);
				assert.equal(read(ThreadField.Resumer), 0);
				assert.equal(read(ThreadField.Entry), body, 'no admitted frame consumed the entry');
				assert.equal(read(ThreadField.FrameDepth), 0);
				assert.equal(read(ThreadField.StackBlock), stack);
				assert.equal(memory.readRamRecordWord(resident + HeapServiceResidentField.SourceCount), HEAP_SERVICE_RESULT_FAULT);
				assert.equal(memory.readRamRecordWord(resident + HeapServiceResidentField.SourceBase), LUA_FAULT_REASON_OUT_OF_MEMORY);
				assert.equal(cpu.readLuaFaultReasonWord(), 0, 'failure travels to the resumer, not a hardware trap');
			} else {
				assert.equal(cpu.activeThread.address, child);
				assert.equal(read(ThreadField.Entry), 0);
				assert.equal(read(ThreadField.FrameDepth), 1);
				assert.ok(read(ThreadField.StackCapacity) > THREAD_INITIAL_VALUES);
				const childFrame = cpu.activeThread.currentFrame!;
				assert.equal(childFrame.callSitePc, 0);
				assert.equal(childFrame.registers.get(0), valueInteger(41));
				assert.equal(childFrame.registers.get(1), valueTable(box));
				assert.equal(cpu.activeThread.stackRegisters.get(childFrame.varargBase), valueInteger(17));
				assert.equal(cpu.activeThread.stackRegisters.get(childFrame.varargBase + 1), valueInteger(23));
				assert.equal(cpu.stringPool.find(deadText), undefined);
			}
			hash(child, THREAD_HEAP_BYTES); hash(parent, THREAD_HEAP_BYTES);
			for (let step = 0; step < 128 && cpu.rootThread.frameDepth !== 0; ++step) grant(113);
			assert.equal(cpu.rootThread.frameDepth, 0);
			const result = runtime.readCompletionValues();
			if (refuse) {
				assert.deepEqual(result, [valueBool(true), valueBool(false), valueString(read(ThreadField.ErrorWord)), valueNil(), valueNil()]);
				assert.equal(cpu.stringPool.toString(valuePayload(result[2])), 'Out of memory.');
			} else assert.deepEqual(result, [valueBool(true), valueBool(true), valueInteger(165), valueInteger(17), valueInteger(23)]);
			observe('c', [result.length, ...result.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
			const first = memory.ramBusEnd() - RAM_BASE, end = memory.ramData().length;
			observe(`H ${first} ${end}`, hashBytes(memory.ramData(), first, end - first));
		}
		finish();
		const tail = commands.slice(split), results = expected.slice(resultSplit);
		replay(seed, [...commands, 'u', ...tail], [...expected, ...results]);
		replay(mid, tail, results);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeMid), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		assert.equal(cpu.activeThread.address, child);
		assert.equal(cpu.getFrameDepth(), 0);
		commands.length = expected.length = 0;
		finish();
		assert.deepEqual(expected, results);
	});
});
