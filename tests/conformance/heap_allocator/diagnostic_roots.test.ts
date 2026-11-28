import { readStockGlobalValue } from '../../../toolchain/ts/firmware/stock_global_bank';
import { nativeHeapReference } from '../../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { isRamStringId } from '../../../machine/ts/machine/cpu/string_pool';
import { valueBool, valueInteger, valueNil, valuePayload, valueString, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { LUA_FAULT_REASON_INDEX_NAN, LUA_FAULT_REASON_INDEX_NON_TABLE } from '../../../machine/ts/spec/blua32/cop0';
import { GC_DIAGNOSTIC_FAULTS_OFFSET } from '../../helpers/firmware_heap_layout';
import { RAM_BASE, RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { runGuestToHalt } from '../../helpers/cpu_test_harness';
import { runCpuWithinBudget } from '../../helpers/cpu_execution';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { asClosure, GC_DIAGNOSTIC_OFFSET, GcDiagnosticField } from '../../helpers/native_heap/gc_heap';

const source = `
local set_metatable<const> = require('kernel/set_metatable')
local protected_entries<const> = require('bmsx/startup')
local pcall<const> = blua32.closure(protected_entries.protected_call)
local xpcall<const> = blua32.closure(protected_entries.protected_xcall)

sink = { written = 0 }
function index(receiver, key) return 111 end
function newindex(receiver, key, value) sink.written = value end
function length(receiver) return 13 end
function broken(value) return value[1] end
function broken_handler(message) return broken(62) end

receiver = {}
set_metatable(receiver, { __index = index, __newindex = newindex, __len = length })

function probe(target, value)
	sink.written = 0
	local got = target.missing_field
	target.missing_assignment = value
	local size = #target
	local ok, message = pcall(broken, 77)
	local xok, xmessage = xpcall(broken, broken_handler, 88)
	return got, sink.written, size, ok, message, xok, xmessage
end

-- Acquire the ordinary receiving windows before any external observation.
probe(receiver, 41)
`;

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

for (const optLevel of [0, 3] as const) {
	test(`firmware fault Strings replay without changing stock metatable selection at O${optLevel}`, t => {
		const folder = mkdtempSync(join(tmpdir(), 'diagnostic-roots-'));
		t.after(() => rmSync(folder, { recursive: true, force: true }));
		const linked = linkManagedTestSystem(source, optLevel);
		const protectedCall = linked.layout.functions[linked.symbols.metadata.functionIds.indexOf('module:kernel/protected_call/module')];
		const system = writeTestBlua32Rom(linked);
		const runtime = new Runtime({
			systemRomBytes: system, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC,
			cpuExecutionBackend: CpuExecutionBackend.JavaScript,
		}, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		runGuestToHalt(cpu, 1_000_000);
		nativeHeapReference(cpu).luaHeap.setCollectionTarget(nativeHeapReference(cpu).luaHeap.capacity());
		const global = (name: string) => readStockGlobalValue(cpu.memory, nativeHeapReference(cpu).stringPool.find(name)!);
		const receiver = global('receiver');
		const probe = asClosure(global('probe'), nativeHeapReference(cpu).gc);
		const args = [receiver, valueInteger(41)];
		const management = nativeHeapReference(cpu).heapAllocator.managementOffset();
		const head = management + GC_DIAGNOSTIC_OFFSET, faults = management + GC_DIAGNOSTIC_FAULTS_OFFSET;
		const originalError = memory.readRamRecordWord(head + GcDiagnosticField.Error);
		const originalFault = memory.readRamRecordWord(faults + LUA_FAULT_REASON_INDEX_NON_TABLE * 4);
		assert.equal(memory.readRamRecordWord(head + GcDiagnosticField.FaultIds), RAM_BASE + faults);

		// Check the loaded stock selectors with the original fault plane.
		cpu.beginCompletionCall(probe, args);
		assert.equal(runCpuWithinBudget(cpu, 65_536), RunResult.Halted);
		const methods = [valueInteger(111), valueInteger(41), valueInteger(13)];
		const old = [...methods,
			valueBool(false), valueString(originalFault), valueBool(false), valueString(originalError)];
		assert.deepEqual(runtime.readCompletionValues(), old);
		const intern = (text: string) => {
			const id = nativeHeapReference(cpu).stringPool.intern(text);
			assert.ok(isRamStringId(id), 'the replacement is a RAM String, not a ROM String identity');
			return id;
		};
		const error = intern('replacement protected handler failure'), fault = intern('replacement protected fault');
		const faultBytes = 4 * (LUA_FAULT_REASON_INDEX_NAN + 1);
		const alternateFaults = nativeHeapReference(cpu).heapAllocator.allocate(faultBytes, false);
		assert.notEqual(alternateFaults, 0);
		for (let i = 0; i < faultBytes; i += 4) {
			memory.writeRamRecordWord(alternateFaults + i, memory.readRamRecordWord(faults + i));
		}
		// Keep the original plane and its original error intact: offset-only
		// consumers (as well as constructor-cached Ids) must give the old answer.
		memory.writeRamRecordWord(alternateFaults + LUA_FAULT_REASON_INDEX_NON_TABLE * 4, fault);
		const patches = [[head + GcDiagnosticField.FaultIds, alternateFaults],
			[head + GcDiagnosticField.Error, error]];

		const rom = join(folder, 'system.rom'), initialFile = join(folder, 'initial.state');
		const tsMidFile = join(folder, 'ts-mid.state'), cppMidFile = join(folder, 'cpp-mid.state'), traceFile = join(folder, 'trace');
		writeFileSync(rom, system);
		cpu.beginCompletionCall(probe, args);
		const initial = captureRuntimeSaveState(runtime);
		writeFileSync(initialFile, encodeRuntimeSaveState(initial));
		for (const [address, word] of patches) memory.writeRamRecordWord(address, word);
		const write = patches.map(([address, word]) => `W ${address} ${word}`);

		const commands: string[] = [], results: string[] = [];
		function observe(command: string, result: number | string) {
			commands.push(command);
			results.push(String(result));
		}
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
			observe(`L ${cycles}`, [result, cycles - cpu.instructionBudgetRemaining, nativeHeapReference(cpu).gc.fullEpochs(),
				nativeHeapReference(cpu).gc.phase(), nativeHeapReference(cpu).luaHeap.usedBytes()].join(' '));
			return result;
		}
		function hash(first: number, length: number) {
			observe(`H ${first} ${first + length}`, hashBytes(memory.ramData(), first, length));
		}
		function finish() {
			let result = RunResult.Yielded;
			for (let i = 0; i < 4096 && result === RunResult.Yielded; ++i) result = grant([2, 7, 3, 13][i & 3]);
			assert.equal(result, RunResult.Halted);
			assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INDEX_NON_TABLE, 'the last caught Trap remains architecturally visible');
			assert.equal(cpu.getFrameDepth(), 0);
			const values = runtime.readCompletionValues();
			assert.deepEqual(values, [...methods,
				valueBool(false), valueString(fault), valueBool(false), valueString(error)],
				'firmware fault and handler messages change without selecting a different metamethod');
			assert.equal(cpu.tables.getStringKey(valuePayload(receiver), nativeHeapReference(cpu).stringPool.find('missing_assignment')!), valueNil(),
				'the selected __newindex ran instead of publishing a raw field');
			observe('c', [values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
			observe('Z', [cpu.readCauseWord(), cpu.readLuaFaultReasonWord(), cpu.readEpcWord()].join(' '));
			hash(head, GcDiagnosticField.FaultIds + 4);
			hash(alternateFaults & RAM_RECORD_WORD_MASK, faultBytes);
		}
		const atProtectedEntry = () => cpu.activeThread.currentFrame?.pc === protectedCall.codeAddress;
		for (let i = 0; !atProtectedEntry() && i < 512; ++i) assert.equal(grant(1), RunResult.Yielded);
		assert.ok(atProtectedEntry(), 'checkpoint at the ordinary protected call, before its fault');
		assert.ok(cpu.getFrameDepth() > 1);
		observe('P', `${cpu.getFrameDepth()} ${cpu.readFramePc(cpu.getFrameDepth() - 1)}`);
		hash(head, GcDiagnosticField.FaultIds + 4);
		const tsMid = captureRuntimeSaveState(runtime);
		writeFileSync(tsMidFile, encodeRuntimeSaveState(tsMid));
		const before = commands.splice(0), beforeResults = results.splice(0);
		finish();
		const after = commands.splice(0), afterResults = results.splice(0);
		const runner = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
			buildDirectory: 'tmp/build-native-diagnostic-roots',
			configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
		});
		function replay(label: string, state: string, commands: readonly string[], expected: readonly string[]) {
			writeFileSync(traceFile, commands.join('\n'));
			const actual = execFileSync(runner, [rom, traceFile, state], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trimEnd().split('\n');
			const divergent = actual.findIndex((line, i) => line !== expected[i]);
			assert.equal(divergent, -1, `${label} divergence line ${divergent}: TS=${expected[divergent]} C++=${actual[divergent]}`);
			assert.equal(actual.length, expected.length, label);
		}
		replay('native reads RAM patched after loading', initialFile, ['X', ...write, ...before, 'S', `x ${cppMidFile}`, ...after, 'U', ...after],
			[...beforeResults, ...afterResults, ...afterResults]);
		replay('TS to C++ during the protected call', tsMidFile, ['X', ...after], afterResults);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(cppMidFile), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		finish();
		assert.deepEqual(results, afterResults, 'C++ to TS during the protected call');

		applyRuntimeSaveState(runtime, initial);
		assert.equal(runCpuWithinBudget(cpu, 65_536), RunResult.Halted);
		assert.deepEqual(runtime.readCompletionValues(), old, 'restoring the old words restores the original fault Ids');
	});
}
