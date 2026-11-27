import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { COMPILED_BLOCK_THRESHOLD, CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { GC_COLOR_OFFSET, GC_RECORD_LINK, GC_RECORD_SHIFT } from '../../../machine/ts/machine/cpu/gc_object';
import { GC_CHANGED_HEAD, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_MARK_WORK_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { TableHeader } from '../../../machine/ts/machine/cpu/table';
import { asClosure, asStringId, valueBool, valueBuiltinFunction, valueInteger, valuePayload, ValueTag, valueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { BuiltinFunctionId } from '../../../machine/ts/spec/blua32/builtin';
import { HEAP_SERVICE_FRAME_OFFSET, HEAP_SERVICE_RESIDENT_OFFSET, HeapServiceResidentField } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE, RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runCompletionClosure, runGuestToHalt } from '../../helpers/cpu_test_harness';
import { compileHeapServiceSystem, residentFunctionAddress } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const source = `
local metatables<const> = require('kernel/gc_barrier')
setmetatable = metatables.set_metatable
local pcall<const> = __bmsx_pcall
receiver, replacement, prior = {}, {}, {}
old = {}
setmetatable(receiver, old)

function normal_call(operation, target, meta)
	local result, padding = operation(target, meta)
	if padding ~= nil then return nil end
	return result, 37
end

function invalid_call(operation, target, wrong)
	local ok, result = pcall(operation, target, wrong)
	return ok, result
end

function clear_call(operation, target)
	local ok, result = pcall(operation, target)
	return ok, result
end
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const folder = mkdtempSync(join('tmp', 'bmsx-setmetatable-'));
try {
	const runner = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
		buildDirectory: join('tmp', 'build-native-setmetatable'),
		configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
	});
	for (const optLevel of [0, 3] as const) {
		const system = linkTestSystemBlua32(compileHeapServiceSystem(source, optLevel));
		const entry = residentFunctionAddress(system, 'kernel/gc_barrier', 'set_metatable');
		const runtime = new Runtime({
			systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
			cpuExecutionBackend: CpuExecutionBackend.JavaScript,
		}, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		runGuestToHalt(cpu, 250_000);
		const global = (name: string) => cpu.getGlobalByKey(cpu.stringPool.find(name)!);
		const addr = (name: string) => valuePayload(global(name));
		const normal = asClosure(global('normal_call'), cpu.gc), invalid = asClosure(global('invalid_call'), cpu.gc), clear = asClosure(global('clear_call'), cpu.gc);
		const operation = global('setmetatable'), receiver = global('receiver'), replacement = global('replacement');
		assert.equal(valueTag(operation), ValueTag.ResidentFunction);
		assert.equal(valuePayload(operation), entry);
		const newAddress = valuePayload(replacement), target = valuePayload(receiver), old = addr('old');
		const args = [operation, receiver, replacement];
		const warm = [valueBuiltinFunction(BuiltinFunctionId.RawGet), receiver, replacement];
		// Admit the protected-call storage independently of the mutation under test.
		runCompletionClosure(cpu, invalid, warm, 1024);
		for (let i = 0; i <= COMPILED_BLOCK_THRESHOLD; ++i) runCompletionClosure(cpu, normal, warm, 1024);

		const control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
		const changed = control + GC_CHANGED_HEAD;
		const stringMarkWork = cpu.heapAllocator.managementOffset() + HEAP_STRING_MARK_WORK_OFFSET;
		const priorGray = (addr('prior') & RAM_RECORD_WORD_MASK) >>> GC_RECORD_SHIFT;
		const targetGray = (target & RAM_RECORD_WORD_MASK) >>> GC_RECORD_SHIFT;
		const color = target + GC_COLOR_OFFSET, link = target + GC_RECORD_LINK, metatable = target + TableHeader.Metatable;
		const visitBits = 0x80000000;
		memory.writeRamRecordByte(color, 0x83);
		memory.writeRamRecordWord(link, visitBits);
		memory.writeRamRecordWord(changed, priorGray);
		memory.writeRamRecordWord(control, GcPhase.MarkAgain);
		memory.writeRamRecordWord(stringMarkWork, 7);
		assert.equal(memory.readRamRecordWord(metatable), old);
		const work = cpu.gc.epochWork();
		const management = cpu.heapAllocator.managementOffset();
		const pinned = management + HEAP_SERVICE_FRAME_OFFSET + FrameField.Function;
		const issue = management + HEAP_SERVICE_RESIDENT_OFFSET + HeapServiceResidentField.IssuePc;
		const rom = join(folder, 'system.rom'), seed = join(folder, 'initial.state'), tsSave = join(folder, 'mid.state'), cppSave = join(folder, 'mid.cpp.state');
		const traceFile = join(folder, 'trace.txt');
		writeFileSync(rom, system.romBytes);
		cpu.beginCompletionCall(normal, args);
		writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null);
		const commands: string[] = [], expected: string[] = [];
		const observe = (command: string, output: string | number) => { commands.push(command); expected.push(String(output)); };
		const run = (cycles: number) => scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
		const grant = (cycles = 1) => {
			const result = run(cycles);
			observe(`J ${cycles} 1`, [result, cycles - cpu.instructionBudgetRemaining, +cpu.heapServiceActive(), 0,
				cpu.heapAllocator.occupiedBytes(), cpu.luaHeap.usedBytes()].join(' '));
			return result;
		};
		const completion = () => {
			const values = runtime.readCompletionValues();
			observe('c', [values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
			observe('Z', [cpu.readCauseWord(), cpu.readLuaFaultReasonWord(), cpu.readEpcWord()].join(' '));
			return values;
		};
		const hash = (first: number, end: number) => observe(`H ${first} ${end}`, hashBytes(memory.ramData(), first, end - first));
		const reproduce = (mode: string, commands: readonly string[], expected: readonly string[], state = seed) => {
			writeFileSync(traceFile, commands.join('\n'));
			const actual = execFileSync(runner, [rom, traceFile, state], { encoding: 'utf8' }).trimEnd().split('\n');
			const divergent = actual.findIndex((line, index) => line !== expected[index]);
			assert.equal(divergent, -1, `${mode} divergence line ${divergent}: TS=${expected[divergent]} C++=${actual[divergent]}`);
			assert.equal(actual.length, expected.length, mode);
		};

		const initialBudget = 256;
		assert.equal(run(initialBudget), RunResult.Yielded);
		const issued = [RunResult.Yielded, initialBudget - cpu.instructionBudgetRemaining, 1];
		assert.equal(memory.readRamRecordWord(pinned), entry);
		assert.ok(cpu.heapServiceActive());
		assert.equal(memory.readRamRecordWord(metatable), old);
		const originalPc = memory.readRamRecordWord(issue), nextPc = cpu.readFramePc(cpu.getFrameDepth() - 1);
		assert.ok(nextPc > originalPc);
		for (let i = 0; memory.readRamRecordWord(changed) === priorGray && i < 256; ++i) grant();
		assert.ok(cpu.heapServiceActive());
		assert.equal(memory.readRamRecordWord(changed), targetGray);
		assert.equal(memory.readRamRecordByte(color), 2);
		assert.equal(memory.readRamRecordWord(link), (visitBits | priorGray) >>> 0);
		assert.equal(memory.readRamRecordWord(metatable), old, 'backward barrier publishes before the new metatable');
		assert.equal(cpu.readFramePc(cpu.getFrameDepth() - 1), nextPc);
		const raw = target & RAM_RECORD_WORD_MASK;
		hash(raw, raw + TableHeader.Metatable + 4);
		hash(control, stringMarkWork + 4);
		const mid = captureRuntimeSaveState(runtime);
		const midRam = history.capture(memory, baseline);
		writeFileSync(tsSave, encodeRuntimeSaveState(mid));
		const split = commands.length;
		function finish() {
			for (let i = 0; cpu.heapServiceActive() && i < 256; ++i) grant();
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(memory.readRamRecordWord(metatable), newAddress);
			assert.equal(memory.readRamRecordWord(changed), targetGray);
			assert.equal(memory.readRamRecordWord(stringMarkWork), 7, 'a table edge never spends String mark work');
			assert.equal(cpu.gc.epochWork(), work);
			hash(raw, raw + TableHeader.Metatable + 4);
			hash(control, stringMarkWork + 4);
			assert.equal(grant(128), RunResult.Halted);
			assert.deepEqual(completion(), [receiver, valueInteger(37)]);
		}
		finish();
		const prefix = commands.slice(0, split), before = expected.slice(0, split);
		const tail = commands.slice(split), after = expected.slice(split);
		for (const native of [0, 1]) {
			const seedCommands = ['X', 'l', `& ${initialBudget} ${native}`, ...prefix, 's'];
			if (native === 1) seedCommands.push(`x ${cppSave}`);
			reproduce(native ? 'generated caller' : 'scalar caller', [...seedCommands, ...tail, 'u', ...tail],
				[[...issued, native, native, 0, 0].join(' '), ...before, ...after, ...after]);
		}
		reproduce('TS to C++', ['X', ...tail], after, tsSave);
		history.restore(memory, history.capture(memory, midRam), midRam);
		applyRuntimeCheckpointState(runtime, mid, RuntimeRestoreOrigin.HistorySeek);
		commands.length = expected.length = 0;
		finish();
		assert.deepEqual(expected, after);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(cppSave), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		commands.length = expected.length = 0;
		finish();
		assert.deepEqual(expected, after);

		// Invalid second argument reaches pcall normally without the barrier or
		// write. Check a black owner (whose barrier would otherwise be visible).
		memory.writeRamRecordByte(color, 3);
		memory.writeRamRecordWord(changed, priorGray);
		for (const [callback, invalidArgument, arguments_] of [
			[invalid, true, [operation, receiver, valueBool(false)]],
			[invalid, true, [operation, valueBool(false), replacement]],
			[clear, false, [operation, receiver]],
		] as const) {
			cpu.beginCompletionCall(callback, arguments_);
			writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			commands.length = expected.length = 0;
			let result = RunResult.Yielded;
			for (let i = 0; i < 16 && result !== RunResult.Halted; ++i) result = grant(128);
			assert.equal(result, RunResult.Halted);
			const values = completion();
			assert.equal(values[0], valueBool(!invalidArgument));
			assert.equal(cpu.readLuaFaultReasonWord(), 0, 'a protected language error is not a CP0 trap');
			if (invalidArgument) {
				assert.equal(cpu.stringPool.toString(asStringId(values[1])), 'Invalid argument.');
				assert.equal(memory.readRamRecordWord(metatable), newAddress);
				assert.equal(memory.readRamRecordWord(changed), priorGray);
				assert.equal(memory.readRamRecordByte(color), 3);
			} else {
				assert.equal(values[1], receiver);
				assert.equal(memory.readRamRecordWord(metatable), 0, 'missing metatable clears the connection');
				assert.equal(memory.readRamRecordWord(changed), targetGray);
				assert.equal(memory.readRamRecordByte(color), 2);
			}
			assert.equal(memory.readRamRecordWord(stringMarkWork), 7);
			assert.equal(cpu.gc.epochWork(), work);
			hash(raw, raw + TableHeader.Metatable + 4);
			hash(control, stringMarkWork + 4);
			reproduce(invalidArgument ? 'protected invalid' : 'protected clear', ['X', ...commands], expected);
		}
		console.log(`SETMETATABLE:PASS O${optLevel} ordinary scalar/generated CALL, Changed-before-word, rewind/portable, protected invalid and missing`);
	}
	rmSync(folder, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${folder}`);
	throw error;
}
