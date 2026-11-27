import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FRAME_RESIDENT_ACTIVATION, FRAME_RESIDENT_PREPARED_ENTRY, FrameField, PreparedFrameField, ProtectedCallKind, ProtectedField, PROTECTED_CALL_KIND_MASK } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { MAX_THREAD_VALUE_SLOTS } from '../../../machine/ts/machine/cpu/thread_record';
import { type Value, valueBool, valueBuiltinFunction, valueInteger, valueNil, valuePayload, valueString, valueTable, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { BuiltinFunctionId } from '../../../machine/ts/spec/blua32/builtin';
import { CPU_CAUSE_CODE_REGISTER_WINDOW, CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_CALL_NON_FUNCTION, LUA_FAULT_REASON_EXPLICIT_ERROR, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_FUNCTION_MAX_STACK_OFFSET } from '../../../machine/ts/spec/blua32/image_format';
import { HEAP_SERVICE_FRAME_OFFSET, HEAP_SERVICE_PREPARED_FRAME_OFFSET, HEAP_SERVICE_RESIDENT_OFFSET, HEAP_SERVICE_RESULT_FAULT, HeapServiceResidentField } from '../../../machine/ts/spec/bmsx/heap_service';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

// Protected ingress still prepares the body activation. A failed body enters
// the fixed Trap vector instead; the handler then runs by ordinary CALL.
const extras = Array.from({ length: 96 }, (_, i) => `extra${i + 1}`).join(',');
const source = `
local pcall<const>, xpcall<const> = __bmsx_pcall, __bmsx_xpcall
local function warm() return 0 end
local function body(v,${extras}) return v, extra96 end
local function handler(v,${extras})
  handled = v
  return v, extra96
end
local function fail(v) __bmsx_error(v) end
local function protected_body(fn, payload)
  local ok,v,last = pcall(fn, payload)
  return ok,v,last
end
local function protected_handler(fn, on_error, payload)
  local ok,v = xpcall(fn, on_error, payload)
  return ok,v
end
local function implicit_handler(t, on_error) return t[on_error] end
pcall(warm)
return protected_body, protected_handler, implicit_handler, body, handler, fail
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
	buildDirectory: join(tmpdir(), 'build-native-protected-closure-admission'),
	configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON'],
});
const deadText = 'a dead String providing frame backing during synchronized recovery '.repeat(120);

for (const opt of [0, 3] as const) test(`protected Closure activations preserve the existing record at O${opt}`, async t => {
	const folder = mkdtempSync(join(tmpdir(), 'protected-closure-admission-'));
	t.after(() => rmSync(folder, { recursive: true, force: true }));
	const linked = linkManagedTestSystem(source, opt);
	const handlerIndex = linked.symbols.metadata.functionIds.findIndex(id => id.endsWith(':handler'));
	assert.ok(handlerIndex >= 0);
	const handlerRecord = linked.layout.functions[handlerIndex];
	const romBytes = writeTestBlua32Rom(linked);
	const rom = join(folder, 'system.rom');
	for (const mode of ['body-reclaim', 'body-oom', 'handler', 'detached-handler', 'handler-oom', 'handler-limit'] as const) await t.test(mode, () => {
		const bytes = romBytes.slice();
		const handlerLimit = mode === 'handler-limit';
		if (handlerLimit) {
			writeLE32(bytes, handlerRecord.address + BLUA32_FUNCTION_MAX_STACK_OFFSET, MAX_THREAD_VALUE_SLOTS);
		}
		writeFileSync(rom, bytes);
		const runtime = new Runtime({ systemRomBytes: bytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine, { gc, heapAllocator: arena, luaHeap: heap } = cpu;
		runGuestToHalt(cpu, 4_194_304);
		const entries = runtime.readCompletionValues().slice();
		const [runBody, runHandler, implicit, body, handler, fail] = entries;
		const root = cpu.rootThread;
		heap.setCollectionTarget(heap.capacity());
		const anchor = cpu.createTable(entries.length, 0);
		for (const [i, entry] of entries.entries()) gc.tables.set(anchor, valueInteger(i + 1), entry);
		cpu.setGlobalByKey(cpu.stringPool.intern('protected-control-test-anchor'), valueTable(anchor));
		const invalid = cpu.stringPool.find('Attempted to call a non-function value.')!;
		const handled = cpu.stringPool.find('handled')!;
		const errorInHandler = cpu.stringPool.find('error in error handling')!;
		const oom = cpu.stringPool.find('Out of memory.')!;
		const detached = mode === 'detached-handler';
		const pcallBody = mode === 'body-reclaim' || mode === 'body-oom';
		const exhausted = mode === 'body-oom' || mode === 'handler-oom';
		if (detached) {
			const host = cpu.createTable(0, 0), metatable = cpu.createTable(0, 1);
			gc.tables.setStringKey(metatable, cpu.stringPool.intern('__index'), valueBuiltinFunction(BuiltinFunctionId.XPCall));
			gc.tables.setMetatableAddress(host, metatable);
			cpu.beginCompletionCall(valuePayload(implicit), [valueTable(host), handler]);
		} else if (pcallBody) {
			cpu.beginCompletionCall(valuePayload(runBody), [body, valueInteger(71)]);
		} else {
			cpu.beginCompletionCall(valuePayload(runHandler), [fail, handler, valueInteger(71)]);
		}
		if (exhausted || mode === 'body-reclaim') {
			gc.collect();
			heap.setCollectionTarget(heap.capacity());
			if (mode === 'body-reclaim') assert.ok(cpu.stringPool.intern(deadText) >= RAM_BASE);
			while (arena.allocate(4088, true)) { /* hold every large extent */ }
			while (arena.allocate(24, true)) { /* force actual physical refusal */ }
		}
		const management = arena.managementOffset(), prepared = management + HEAP_SERVICE_PREPARED_FRAME_OFFSET;
		const resident = management + HEAP_SERVICE_RESIDENT_OFFSET, pinned = management + HEAP_SERVICE_FRAME_OFFSET;
		const path = (name: string) => join(folder, mode + '.' + name);
		const commands: string[] = [], expected: string[] = [];
		const record = (command: string, outcome?: string | number) => {
			commands.push(command);
			if (outcome !== undefined) expected.push(String(outcome));
		};
		const grant = (cycles: number) => {
			const state = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			record(`g ${cycles} 0`, `${state} ${cycles - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} ${arena.occupiedBytes()} ${heap.usedBytes()}`);
			assert.equal(cpu.allocationParked(), false);
			return state;
		};
		const save = (name: string) => {
			const file = path(name);
			writeFileSync(file, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			return file;
		};
		const replay = (seed: string, trace: readonly string[], want: readonly string[]) => {
			const file = path('trace');
			writeFileSync(file, ['X', ...trace].join('\n'));
			const have = execFileSync(native, [rom, file, seed], { encoding: 'utf8' }).trimEnd().split('\n');
			const mismatch = want.findIndex((line, i) => have[i] !== line);
			assert.equal(mismatch, -1, `${mode} row ${mismatch}: TS=${want[mismatch]} C++=${have[mismatch]}`);
			assert.equal(have.length, want.length);
		};
		const seed = save('seed'), oldBlock = root.stackOffset();
		let result = RunResult.Yielded;
		for (let step = 0; step < 4096; ++step) {
			result = grant(1);
			assert.equal(result, RunResult.Yielded);
			if (pcallBody ? cpu.heapServiceActive() : cpu.fixedInterruptActive()) break;
		}
		assert.equal(root.protectedDepth, 1);
		assert.equal(root.protectedWord(0, ProtectedField.Flags) & PROTECTED_CALL_KIND_MASK,
			pcallBody ? ProtectedCallKind.PCall : ProtectedCallKind.XPCallBody);

		const caller = cpu.getFrameDepth() - 1;
		if (pcallBody) {
			assert.equal(cpu.heapServiceActive(), true);
			assert.equal(memory.readRamRecordWord(pinned + FrameField.Flags), FRAME_RESIDENT_ACTIVATION | FRAME_RESIDENT_PREPARED_ENTRY);
			assert.equal(memory.readRamRecordWord(prepared + FrameField.Protected), 0);
			assert.equal(memory.readRamRecordWord(prepared + FrameField.Closure), valuePayload(body));
			assert.equal(memory.readRamRecordWord(prepared + PreparedFrameField.Supplied), 1);
			const source = memory.readRamRecordWord(prepared + PreparedFrameField.SourceSlot);
			assert.equal(root.stackRegisters.get(source), valueInteger(71));
			const next = cpu.readFramePc(caller);
			for (let step = 0; step < 16384 && cpu.heapServiceActive(); ++step) {
				if (gc.phase() !== GcPhase.Pause) break;
				assert.equal(grant(1), RunResult.Yielded);
			}
			assert.equal(cpu.heapServiceActive(), true, 'checkpoint excludes placement');
			assert.ok(gc.active());
			assert.equal(cpu.readFramePc(caller), next);
		} else {
			assert.equal(root.protectedWord(0, ProtectedField.Handler), valuePayload(handler));
			checkTrap(detached ? LUA_FAULT_REASON_CALL_NON_FUNCTION : LUA_FAULT_REASON_EXPLICIT_ERROR,
				detached ? 0 : 1, detached ? valueNil() : valueInteger(71));
		}

		const nativeMid = path('native-mid'), mid = save('mid');
		record('l'); record('s'); record(`x ${nativeMid}`);
		const split = commands.length, predicted = expected.length;
		function finish() {
			if (pcallBody) {
				for (let guard = 0; guard < 4096 && cpu.heapServiceActive(); ++guard)
					assert.equal(grant(173), RunResult.Yielded);
				assert.equal(cpu.heapServiceActive(), false);
				if (exhausted) {
					assert.equal(memory.readRamRecordWord(resident + HeapServiceResidentField.SourceCount), HEAP_SERVICE_RESULT_FAULT);
					assert.equal(memory.readRamRecordWord(resident + HeapServiceResidentField.SourceBase), LUA_FAULT_REASON_OUT_OF_MEMORY);
					assert.equal(root.stackOffset(), oldBlock);
					checkTrap(LUA_FAULT_REASON_OUT_OF_MEMORY, 0, valueNil());
				} else {
					assert.equal(cpu.getFrameDepth(), caller + 2);
					const frame = cpu.activeThread.currentFrame!;
					assert.equal(frame.protectedContinuationIndex, 0);
					assert.equal(frame.registers.get(0), valueInteger(71));
					assert.equal(frame.registers.get(96), valueNil());
					if (mode === 'body-reclaim') assert.equal(cpu.stringPool.find(deadText), undefined);
				}
			} else {
				let window = false, denied = false, called = false;
				for (let step = 0; step < 65536 && result !== RunResult.Halted; ++step) {
					result = grant(1);
					assert.equal(cpu.heapServiceActive(), false, 'the handler does not use a private activation');
					const active = cpu.activeThread.currentFrame;
					if (cpu.fixedInterruptActive()) {
						if (!window && cpu.readCauseWord() === CPU_CAUSE_CODE_REGISTER_WINDOW) {
							assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), root.address);
							window = true;
							record('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} ${cpu.readLuaFaultReasonWord()} ${cpu.readEpcWord()}`);
						} else if (!denied && cpu.readCauseWord() === CPU_CAUSE_CODE_TRAP && cpu.readLuaFaultReasonWord() === LUA_FAULT_REASON_OUT_OF_MEMORY) {
							checkTrap(LUA_FAULT_REASON_OUT_OF_MEMORY, 0, valueNil());
							denied = true;
						}
					} else if (active?.pc === handlerRecord.codeAddress) {
						assert.equal(active.protectedContinuationIndex, -1);
						assert.equal(root.protectedWord(0, ProtectedField.Flags) & PROTECTED_CALL_KIND_MASK, ProtectedCallKind.XPCallHandler);
						assert.equal(active.registers.get(0), detached ? valueString(invalid) : valueInteger(71));
						assert.equal(active.registers.get(96), valueNil());
						called = true;
					}
				}
				assert.equal(called, !exhausted && !handlerLimit);
				if (!handlerLimit) assert.ok(window, 'ordinary CALL needed a larger register window');
				if (handlerLimit) assert.ok(denied && !window, 'the function limit raises Trap without a reservation');
			}
			for (let steps = 0; steps < 128 && result !== RunResult.Halted; ++steps) result = grant(67);
			verifyCompletion();
		}
		finish();
		const tail = commands.slice(split), predictions = expected.slice(predicted);
		replay(seed, [...commands, 'u', ...tail], [...expected, ...predictions]);
		replay(mid, tail, predictions);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeMid), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		assert.equal(root.protectedDepth, 1);
		result = RunResult.Yielded;
		commands.length = expected.length = 0;
		finish();
		assert.deepEqual(expected, predictions);

		function checkTrap(reason: number, argumentCount: number, operand: Value) {
			assert.equal(cpu.fixedInterruptActive(), true);
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_TRAP);
			assert.equal(cpu.readLuaFaultReasonWord(), reason);
			assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), root.address);
			assert.equal(root.protectedDepth, 1, 'the continuation still belongs to firmware at Trap entry');
			const frame = cpu.activeThread.currentFrame!;
			assert.equal(frame.argumentCount, argumentCount);
			assert.equal(frame.registers.get(0), operand);
			record('Z', `${CPU_CAUSE_CODE_TRAP} ${reason} ${cpu.readEpcWord()}`);
			const ram = memory.ramData(), control = frame.controlOffset;
			record(`H ${control} ${control + FRAME_CONTROL_BYTES}`, hashBytes(ram, control, FRAME_CONTROL_BYTES));
		}

		function verifyCompletion() {
			assert.equal(result, RunResult.Halted);
			assert.equal(cpu.fixedInterruptActive(), false);
			assert.equal(cpu.getFrameDepth(), 0);
			assert.equal(root.protectedDepth, 0);
			const resultValues = runtime.readCompletionValues();
			if (detached) {
				assert.deepEqual(resultValues, [valueBool(false)]);
				assert.equal(cpu.getGlobalByKey(handled), valueString(invalid));
			} else {
				assert.deepEqual(resultValues, mode === 'body-reclaim' ? [valueBool(true), valueInteger(71), valueNil()]
					: mode === 'body-oom' ? [valueBool(false), valueString(oom), valueNil()]
						: mode === 'handler' ? [valueBool(false), valueInteger(71)] : [valueBool(false), valueString(errorInHandler)]);
			}
			record('c', [resultValues.length, ...resultValues.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
			const first = memory.ramBusEnd() - RAM_BASE, end = memory.ramData().length;
			record(`H ${first} ${end}`, hashBytes(memory.ramData(), first, end - first));
		}
	});
});
