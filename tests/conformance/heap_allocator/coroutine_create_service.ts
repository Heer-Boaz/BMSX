import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { ThreadField, ThreadStatus, THREAD_HEAP_BYTES, THREAD_INITIAL_FRAMES, THREAD_INITIAL_VALUES, THREAD_STACK_SLOT_BYTES } from '../../../machine/ts/machine/cpu/thread_record';
import { valueBool, valueInteger, valueNil, valuePayload, valueString, valueTable, valueTag, valueThread, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_SYSCALL } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, instructionOpcode } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { COROUTINE_FIRMWARE_MODULES } from '../../helpers/firmware_modules';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const source = `
local create<const> = require('coroutine').create
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
return fixed,open,guarded,handler,entry,create,blua32.closure(vectors.protected_xcall)
`;
const directory = mkdtempSync(join(tmpdir(), 'bmsx-coroutine-create-'));
const deadText = 'reclaimable backing for a timed Thread create; '.repeat(112);
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
		buildDirectory: join(directory, 'native'), parallel: '4',
		configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
	});
	for (const optLevel of [0, 3] as const) {
		const system = linkManagedTestSystem(source, optLevel, COROUTINE_FIRMWARE_MODULES);
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
			const create = entries[5], badArgument = valueInteger(37), closure = invalid ? badArgument : entries[4];
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
				cpu.beginCompletionCall(valuePayload(entries[2]), [create, badArgument, entries[6], entries[3]]);
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
			const before = arena.occupiedBytes(), logical = heap.usedBytes();
			const originalWhite = gc.white();
			const faultId = failure ? cpu.stringPool.find(invalid ? 'Invalid argument.' : 'Out of memory.')! : 0;
			const owner = cpu.activeThread.address;
			const file = join(directory, `O${optLevel}-${name}`), nativePartial = `${file}.native`;
			writeFileSync(`${file}.seed`, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			const trace: string[] = [], expected: string[] = [];
			function observe(command: string, value: string | number) { trace.push(command); expected.push(String(value)); }
			function checksum(first: number, last: number) { observe(`H ${first} ${last}`, hashBytes(memory.ramData(), first, last - first)); }
			function grant(cycles: number) {
				const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
				observe(`J ${cycles} 1`, `${result} ${cycles - cpu.instructionBudgetRemaining} ${+cpu.fixedInterruptActive()} ${arena.occupiedBytes()} ${heap.usedBytes()}`);
				return result;
			}
			const history = new RamHistory();
			history.start(memory);
			const baseline = history.capture(memory, null);
			for (let i = 0; i < 256 && !cpu.fixedInterruptActive(); ++i) assert.equal(grant(1), RunResult.Yielded);
			assert.ok(cpu.fixedInterruptActive());
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_SYSCALL);
			assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
			const caller = cpu.readThreadFrameDepth(owner) - 1, next = cpu.readEpcWord();
			assert.equal(instructionOpcode(memory.readMappedU32LE(next - INSTRUCTION_BYTES)), OpCode.SVC);
			assert.equal(cpu.readThreadFrameWord(owner, caller, FrameField.Pc), next);
			const vector = cpu.activeThread.currentFrame!, destination = valuePayload(vector.registers.get(1));
			assert.equal(vector.argumentCount, 3);
			assert.equal(vector.registers.get(2), valueInteger(1));
			assert.equal(cpu.readThreadRegister(owner, caller, destination + 1), closure);
			assert.equal(arena.occupiedBytes(), before);
			assert.equal(heap.usedBytes(), logical);
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
			assert.ok(cpu.fixedInterruptActive());
			if (fixed) assert.equal(heap.usedBytes(), logical);
			assert.equal(cpu.readThreadFrameWord(owner, caller, FrameField.Pc), next);
			const partial = captureRuntimeSaveState(runtime), partialRam = history.capture(memory, baseline), prefix = trace.length;
			writeFileSync(`${file}.partial`, encodeRuntimeSaveState(partial));
			function finish() {
				let result = RunResult.Yielded;
				for (let i = 0; i < 8192 && result === RunResult.Yielded; ++i) result = grant(509);
				assert.equal(result, RunResult.Halted);
				assert.equal(cpu.fixedInterruptActive(), false);
				const values = runtime.readCompletionValues();
				if (invalid) {
					assert.equal(arena.occupiedBytes(), before);
					assert.equal(heap.usedBytes(), logical);
					assert.equal(gc.white(), originalWhite);
					assert.equal(gc.phase(), GcPhase.Pause);
				}
				const word = failure ? 0 : valuePayload(values[0]);
				if (!failure) {
					assert.equal(valueTag(values[0]), ValueTag.Thread);
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
