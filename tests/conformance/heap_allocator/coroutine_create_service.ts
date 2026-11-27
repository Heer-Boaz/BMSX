import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { ThreadField, ThreadStatus, THREAD_HEAP_BYTES, THREAD_INITIAL_FRAMES, THREAD_INITIAL_VALUES, THREAD_STACK_SLOT_BYTES } from '../../../machine/ts/machine/cpu/thread_record';
import { valueBool, valueBuiltinFunction, valueInteger, valueNil, valuePayload, valueTable, valueTag, valueThread, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { BuiltinFunctionId } from '../../../machine/ts/spec/blua32/builtin';
import { LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, instructionOpcode } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import {
	HEAP_SERVICE_BIOS_CALL_OFFSET, HEAP_SERVICE_FRAME_OFFSET, HEAP_SERVICE_VALUE_OFFSET, HeapServiceBiosCallField,
	HeapServiceBiosCallKind, HeapServiceGcStage,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const source = `
local function fixed(create, entry, spare)
 local thread = create(entry)
 return thread, 183
end
local function open(create, entry) return create(entry) end
local function guarded(create, entry, xpcall, handler) return xpcall(create, handler, entry) end
local function handler(err) return 431 end
local kept = 81
local function entry() return kept end
return fixed,open,guarded,handler,entry
`;
const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-coroutine-create-service-'));
const deadText = 'reclaimable backing for a timed Thread create; '.repeat(112);
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
		buildDirectory: 'tmp/build-native-bioscall', parallel: '4',
		configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
	});
	for (const optLevel of [0, 3] as const) {
		const system = linkTestSystemBlua32(compileHeapServiceSystem(source, optLevel));
		const configuration = { systemRomBytes: system.romBytes, cartridgeSlots: [null, null] as [null, null], machineModel: PSX_MACHINE_SPEC };
		const rom = join(directory, `O${optLevel}.rom`);
		writeFileSync(rom, system.romBytes);
		for (const name of ['fixed', 'recovery', 'protected-oom'] as const) {
			const runtime = new Runtime(configuration, input);
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine, { gc, heapAllocator: arena, luaHeap: heap } = cpu;
			let boot = cpu.runUntilDepth(0, 65536);
			for (let i = 0; i < 32 && boot === RunResult.Yielded; ++i) boot = cpu.runUntilDepth(0, 65536);
			assert.equal(boot, RunResult.Halted);
			const entries = runtime.readCompletionValues().slice();
			const fixed = name === 'fixed', recover = name === 'recovery', failure = name === 'protected-oom';
			const create = valueBuiltinFunction(BuiltinFunctionId.CoroutineCreate), closure = entries[4];
			heap.setCollectionTarget(heap.capacity());
			// This fixture owns its pre-existing references. Do not let recovery
			// accidentally make room by reclaiming one of its test function values.
			const anchor = cpu.createTable(entries.length, 0);
			for (let i = 0; i < entries.length; ++i) gc.tables.set(anchor, valueInteger(i + 1), entries[i]);
			cpu.setGlobalByKey(cpu.stringPool.intern('coroutine-create-test-anchor'), valueTable(anchor));
			if (failure) {
				gc.collect(closure, valueTable(anchor));
				heap.setCollectionTarget(heap.capacity());
				// Allocate the normal pcall control slot without allocating a Thread.
				cpu.beginCompletionCall(valuePayload(entries[2]), [valueBuiltinFunction(BuiltinFunctionId.GetMetatable),
					valueTable(anchor), valueBuiltinFunction(BuiltinFunctionId.XPCall), entries[3]]);
				assert.equal(cpu.runUntilDepth(0, 65536), RunResult.Halted);
				assert.equal(runtime.readCompletionValues()[0], valueBool(true));
			}
			const raw = recover ? cpu.stringPool.intern(deadText) : 0;
			const fn = valuePayload(entries[fixed ? 0 : recover ? 1 : 2]);
			cpu.beginCompletionCall(fn, failure ? [create, closure, valueBuiltinFunction(BuiltinFunctionId.XPCall), entries[3]]
				: [create, closure, valueTable(anchor)]);
			if (recover) {
				for (let i = 0; i < 4096 && gc.phase() !== GcPhase.Strings; ++i)
					gc.step(closure, valueTable(anchor), valueNil(), 0, false, 1);
				assert.equal(gc.phase(), GcPhase.Strings);
				assert.equal(cpu.stringPool.find(deadText), raw);
			}
			if (failure) assert.equal(gc.phase(), GcPhase.Pause);
			if (!fixed) {
				while (arena.allocate(4088, true)) { /* occupy pages */ }
				while (arena.allocate(24, true)) { /* no Thread component still fits */ }
			}
			const before = arena.occupiedBytes(), logical = heap.usedBytes(), management = arena.managementOffset();
			const mailbox = management + HEAP_SERVICE_BIOS_CALL_OFFSET;
			const read = (field: HeapServiceBiosCallField) => memory.readRamRecordWord(mailbox + field);
			const caller = cpu.getFrameDepth() - 1, pc = () => cpu.readFramePc(caller);
			const file = join(directory, `O${optLevel}-${name}`), nativePartial = `${file}.native`;
			writeFileSync(`${file}.seed`, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			const trace: string[] = [], expected: string[] = [];
			function observe(command: string, value: string | number) { trace.push(command); expected.push(String(value)); }
			function checksum(first: number, last: number) { observe(`H ${first} ${last}`, hashBytes(memory.ramData(), first, last - first)); }
			function grant(cycles: number) {
				const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
				assert.equal(cpu.allocationParked(), false);
				assert.equal(gc.serviceStage(), HeapServiceGcStage.Idle);
				observe(`J ${cycles} 1`, `${result} ${cycles - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} 0 ${arena.occupiedBytes()} ${heap.usedBytes()}`);
				return result;
			}
			const history = new RamHistory();
			history.start(memory);
			const baseline = history.capture(memory, null);
			for (let i = 0; i < 64 && !cpu.heapServiceActive(); ++i) assert.equal(grant(1), RunResult.Yielded);
			assert.equal(cpu.heapServiceActive(), true);
			assert.equal(read(HeapServiceBiosCallField.Kind), failure ? HeapServiceBiosCallKind.Protected : HeapServiceBiosCallKind.Call);
			assert.equal(read(HeapServiceBiosCallField.ResultWord), fixed ? 2 : 0);
			assert.equal(memory.readRamRecordWord(management + HEAP_SERVICE_VALUE_OFFSET + 4), valuePayload(closure));
			assert.equal(memory.readRamRecordWord(management + HEAP_SERVICE_FRAME_OFFSET + FrameField.Closure), 0);
			assert.equal(arena.occupiedBytes(), before);
			assert.equal(heap.usedBytes(), logical);
			const next = read(HeapServiceBiosCallField.LastPc) + INSTRUCTION_BYTES;
			assert.equal(instructionOpcode(memory.readMappedU32LE(next - INSTRUCTION_BYTES)), OpCode.CALL);
			assert.equal(pc(), next);
			assert.equal(cpu.rootThread.protectedDepth, failure ? 1 : 0);
			if (fixed) {
				// First physical reservation is written before the inventory,
				// logical charge and caller result. Checkpoint between them.
				for (let i = 0; i < 4096 && arena.occupiedBytes() === before; ++i) assert.equal(grant(29), RunResult.Yielded);
				assert.ok(arena.occupiedBytes() > before);
			} else if (recover) {
				for (let i = 0; i < 8192 && gc.phase() === GcPhase.Strings; ++i) assert.equal(grant(57), RunResult.Yielded);
				assert.notEqual(gc.phase(), GcPhase.Strings, 'ran a real recovery quantum before the checkpoint');
			} else {
				for (let i = 0; i < 8192 && !gc.active(); ++i) assert.equal(grant(57), RunResult.Yielded);
				assert.ok(gc.active(), 'exhausted reservation started a fresh recovery epoch');
			}
			assert.equal(cpu.heapServiceActive(), true);
			if (fixed) assert.equal(heap.usedBytes(), logical);
			assert.equal(pc(), next);
			const partial = captureRuntimeSaveState(runtime), partialRam = history.capture(memory, baseline), prefix = trace.length;
			writeFileSync(`${file}.partial`, encodeRuntimeSaveState(partial));
			function finish() {
				for (let i = 0; i < 8192 && cpu.heapServiceActive(); ++i) assert.equal(grant(113), RunResult.Yielded);
				assert.equal(cpu.heapServiceActive(), false);
				assert.equal(read(HeapServiceBiosCallField.Kind), HeapServiceBiosCallKind.Idle);
				assert.equal(read(HeapServiceBiosCallField.Status), failure ? LUA_FAULT_REASON_OUT_OF_MEMORY + 1 : 0);
				assert.equal(cpu.readLuaFaultReasonWord(), 0, 'protected OOM is a language error, not a trap');
				const word = read(HeapServiceBiosCallField.Word);
				if (!failure) {
					assert.equal(pc(), next);
					assert.equal(read(HeapServiceBiosCallField.Tag), ValueTag.Thread);
					assert.equal(gc.threadRecordAddress(word), word);
					assert.equal(memory.readRamRecordWord(word + ThreadField.Entry), valuePayload(closure));
					assert.equal(memory.readRamRecordWord(word + ThreadField.Status), ThreadStatus.New);
					assert.equal(memory.readRamRecordWord(word + ThreadField.StackTop), 0);
					assert.equal(memory.readRamRecordWord(word + ThreadField.FrameDepth), 0);
					assert.equal(memory.readRamRecordWord(word + ThreadField.StackCapacity), THREAD_INITIAL_VALUES);
					assert.equal(memory.readRamRecordWord(word + ThreadField.FrameCapacity), THREAD_INITIAL_FRAMES);
					if (fixed) assert.equal(heap.usedBytes() - logical, THREAD_HEAP_BYTES + THREAD_INITIAL_VALUES * THREAD_STACK_SLOT_BYTES + THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES);
					if (recover) assert.equal(cpu.stringPool.find(deadText), undefined);
				}
				let result = grant(65536);
				for (let i = 0; i < 8 && result === RunResult.Yielded; ++i) result = grant(65536);
				assert.equal(result, RunResult.Halted);
				assert.equal(cpu.rootThread.protectedDepth, 0);
				const values = runtime.readCompletionValues();
				const thread = valueThread(word);
				assert.deepEqual(values, failure ? [valueBool(false), valueInteger(431)] : fixed ? [thread, valueInteger(183)] : [thread]);
				observe('c', [values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
				checksum(memory.ramBusEnd() - RAM_BASE, memory.ramData().length);
			}
			finish();
			const allTrace = trace.slice(), allExpected = expected.slice();
			function check(state: string, commands: readonly string[], want: readonly string[]) {
				writeFileSync(`${file}.trace`, commands.join('\n'));
				const actual = execFileSync(native, [rom, `${file}.trace`, state], { encoding: 'utf8' }).trimEnd().split('\n');
				const mismatch = actual.findIndex((row, index) => row !== want[index]);
				assert.equal(mismatch, -1, `${name} row ${mismatch}: TS=${want[mismatch]} Native=${actual[mismatch]}`);
				assert.equal(actual.length, want.length);
			}
			check(`${file}.seed`, ['X', ...allTrace.slice(0, prefix), `x ${nativePartial}`, ...allTrace.slice(prefix)], allExpected);
			check(`${file}.partial`, ['X', ...allTrace.slice(prefix)], allExpected.slice(prefix));
			if (fixed) check(`${file}.seed`, ['X', 'K Y'], [`1 ${HeapServiceBiosCallKind.Call} ${before} ${logical}`]);
			const endRam = history.capture(memory, partialRam);
			history.restore(memory, endRam, partialRam);
			applyRuntimeCheckpointState(runtime, partial, RuntimeRestoreOrigin.HistorySeek);
			trace.length = expected.length = 0;
			finish();
			assert.deepEqual(expected, allExpected.slice(prefix));
			applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePartial), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			trace.length = expected.length = 0;
			finish();
			assert.deepEqual(expected, allExpected.slice(prefix));
			console.log(`BIOS-COROUTINE-CREATE:PASS O${optLevel} ${name} (${allTrace.length} exact grant/RAM observations)`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
