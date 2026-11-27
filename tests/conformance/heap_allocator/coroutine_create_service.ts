import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FRAME_RESIDENT_ACTIVATION, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { ThreadField, ThreadStatus, THREAD_HEAP_BYTES, THREAD_INITIAL_FRAMES, THREAD_INITIAL_VALUES, THREAD_STACK_SLOT_BYTES } from '../../../machine/ts/machine/cpu/thread_record';
import { valueBool, valueInteger, valueNil, valuePayload, valueString, valueTable, valueTag, valueThread, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { LUA_FAULT_REASON_INVALID_ARGUMENT, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, instructionOpcode } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import {
	HEAP_SERVICE_FRAME_OFFSET, HEAP_SERVICE_VALUE_COUNT, HEAP_SERVICE_VALUE_OFFSET,
	HEAP_SERVICE_RESIDENT_OFFSET, HEAP_SERVICE_RESULT_FAULT, HeapServiceResidentField,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { residentFunctionAddress } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const source = `
local creation<const> = require('kernel/thread_create')
local vectors<const> = require('bmsx/startup')
local function fixed(create, entry, spare)
 local thread = create(entry)
 return thread, 183
end
local function open(create, entry) return create(entry) end
local function guarded(create, entry, xpcall, handler) return xpcall(create, handler, entry) end
local function handler(err) return err end
local kept = 81
local function entry() return kept end
return fixed,open,guarded,handler,entry,creation.create_coroutine,blua32.closure(vectors.protected_xcall)
`;
const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-coroutine-create-service-'));
const deadText = 'reclaimable backing for a timed Thread create; '.repeat(112);
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
		buildDirectory: 'tmp/build-native-bioscall', parallel: '4',
		configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
	});
	for (const optLevel of [0, 3] as const) {
		const system = linkManagedTestSystem(source, optLevel);
		const romBytes = writeTestBlua32Rom(system);
		const configuration = { systemRomBytes: romBytes, cartridgeSlots: [null, null] as [null, null], machineModel: PSX_MACHINE_SPEC };
		const rom = join(directory, `O${optLevel}.rom`);
		writeFileSync(rom, romBytes);
		for (const name of ['fixed', 'recovery', 'protected-oom', 'protected-invalid'] as const) {
			const runtime = new Runtime(configuration, input);
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine, { gc, heapAllocator: arena, luaHeap: heap } = cpu;
			runGuestToHalt(cpu, 4_194_304);
			const entries = runtime.readCompletionValues().slice();
			const fixed = name === 'fixed', recover = name === 'recovery', oom = name === 'protected-oom';
			const invalid = name === 'protected-invalid', failure = oom || invalid;
			const create = entries[5], closure = invalid ? create : entries[4];
			assert.equal(valueTag(create), ValueTag.ResidentFunction);
			heap.setCollectionTarget(heap.capacity());
			// This fixture owns its pre-existing references. Do not let recovery
			// accidentally make room by reclaiming one of its test function values.
			const anchor = cpu.createTable(entries.length, 0);
			for (let i = 0; i < entries.length; ++i) gc.tables.set(anchor, valueInteger(i + 1), entries[i]);
			cpu.setGlobalByKey(cpu.stringPool.intern('coroutine-create-test-anchor'), valueTable(anchor));
			if (failure) {
				gc.collect(closure, valueTable(anchor));
				heap.setCollectionTarget(heap.capacity());
				// Warm both the ordinary wrapper and its error handler before
				// concentrating the OOM fixture on the Thread reservation.
				cpu.beginCompletionCall(valuePayload(entries[2]), [create, create, entries[6], entries[3]]);
				runGuestToHalt(cpu, 65_536);
				assert.deepEqual(runtime.readCompletionValues(), [valueBool(false), valueString(cpu.stringPool.find('Invalid argument.')!)]);
			}
			const raw = recover ? cpu.stringPool.intern(deadText) : 0;
			const fn = valuePayload(entries[fixed ? 0 : recover ? 1 : 2]);
			cpu.beginCompletionCall(fn, failure ? [create, closure, entries[6], entries[3]]
				: [create, closure, valueTable(anchor)]);
			if (recover) {
				for (let i = 0; i < 4096 && gc.phase() !== GcPhase.Strings; ++i)
					gc.step(closure, valueTable(anchor), valueNil(), 0, false, 1);
				assert.equal(gc.phase(), GcPhase.Strings);
				assert.equal(cpu.stringPool.find(deadText), raw);
			}
			if (failure) assert.equal(gc.phase(), GcPhase.Pause);
			if (recover || oom) {
				while (arena.allocate(4088, true)) { /* occupy pages */ }
				while (arena.allocate(24, true)) { /* no Thread component still fits */ }
			}
			const before = arena.occupiedBytes(), logical = heap.usedBytes(), management = arena.managementOffset();
			const originalWhite = gc.white();
			const raised = invalid ? LUA_FAULT_REASON_INVALID_ARGUMENT : LUA_FAULT_REASON_OUT_OF_MEMORY;
			const faultId = failure ? cpu.stringPool.find(invalid ? 'Invalid argument.' : 'Out of memory.')! : 0;
			const context = management + HEAP_SERVICE_RESIDENT_OFFSET;
			const pinned = management + HEAP_SERVICE_FRAME_OFFSET, pinnedValues = management + HEAP_SERVICE_VALUE_OFFSET;
			const read = (field: HeapServiceResidentField) => memory.readRamRecordWord(context + field);
			const pc = () => cpu.readFramePc(cpu.getFrameDepth() - 1);
			const file = join(directory, `O${optLevel}-${name}`), nativePartial = `${file}.native`;
			writeFileSync(`${file}.seed`, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			const trace: string[] = [], expected: string[] = [];
			function observe(command: string, value: string | number) { trace.push(command); expected.push(String(value)); }
			function checksum(first: number, last: number) { observe(`H ${first} ${last}`, hashBytes(memory.ramData(), first, last - first)); }
			function grant(cycles: number) {
				const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
				observe(`J ${cycles} 1`, `${result} ${cycles - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} ${+cpu.fixedInterruptActive()} ${arena.occupiedBytes()} ${heap.usedBytes()}`);
				return result;
			}
			const history = new RamHistory();
			history.start(memory);
			const baseline = history.capture(memory, null);
			for (let i = 0; i < 64 && !cpu.heapServiceActive(); ++i) assert.equal(grant(1), RunResult.Yielded);
			assert.equal(cpu.heapServiceActive(), true);
			assert.equal(memory.readRamRecordWord(pinned + FrameField.Function), residentFunctionAddress({ image: system.layout, symbols: system.symbols }, 'kernel/thread_create', 'create_coroutine'));
			assert.notEqual(memory.readRamRecordWord(pinned + FrameField.Flags) & FRAME_RESIDENT_ACTIVATION, 0);
			assert.equal(memory.readRamRecordWord(pinned + FrameField.ReturnCount), fixed ? 2 : 0);
			assert.equal(memory.readRamRecordWord(pinned + FrameField.Protected), 0xffffffff);
			assert.equal(memory.readRamRecordWord(pinnedValues), valuePayload(closure));
			assert.equal(memory.readRamRecordByte(pinnedValues + 4 * HEAP_SERVICE_VALUE_COUNT), valueTag(closure));
			assert.equal(memory.readRamRecordWord(pinned + FrameField.Closure), 0);
			assert.equal(arena.occupiedBytes(), before);
			assert.equal(heap.usedBytes(), logical);
			const next = read(HeapServiceResidentField.LastPc) + INSTRUCTION_BYTES;
			assert.equal(instructionOpcode(memory.readMappedU32LE(next - INSTRUCTION_BYTES)), OpCode.CALL);
			assert.equal(pc(), next);
			if (fixed) {
				// First physical reservation is written before the inventory,
				// logical charge and caller result. Checkpoint between them.
				for (let i = 0; i < 4096 && arena.occupiedBytes() === before; ++i) assert.equal(grant(29), RunResult.Yielded);
				assert.ok(arena.occupiedBytes() > before);
			} else if (recover) {
				for (let i = 0; i < 8192 && gc.phase() === GcPhase.Strings; ++i) assert.equal(grant(57), RunResult.Yielded);
				assert.notEqual(gc.phase(), GcPhase.Strings, 'ran a real recovery quantum before the checkpoint');
			} else if (oom) {
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
				assert.equal(read(HeapServiceResidentField.SourceCount), failure ? HEAP_SERVICE_RESULT_FAULT : 1);
				if (failure) assert.equal(read(HeapServiceResidentField.SourceBase), raised);
				if (invalid) {
					assert.equal(arena.occupiedBytes(), before);
					assert.equal(heap.usedBytes(), logical);
					assert.equal(gc.white(), originalWhite);
					assert.equal(gc.phase(), GcPhase.Pause);
				}
				assert.equal(cpu.readLuaFaultReasonWord(), failure ? raised : 0);
				const resultSlot = read(HeapServiceResidentField.SourceBase);
				const word = failure ? 0 : memory.readRamRecordWord(pinnedValues + 4 * resultSlot);
				if (!failure) {
					assert.equal(pc(), next);
					assert.equal(memory.readRamRecordByte(pinnedValues + 4 * HEAP_SERVICE_VALUE_COUNT + resultSlot), ValueTag.Thread);
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
				const values = runtime.readCompletionValues();
				const thread = valueThread(word);
				assert.deepEqual(values, failure ? [valueBool(false), valueString(faultId)] : fixed ? [thread, valueInteger(183)] : [thread]);
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
			if (fixed) check(`${file}.seed`, ['X', 'K Y'], [`1 ${FRAME_RESIDENT_ACTIVATION} ${before} ${logical}`]);
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
