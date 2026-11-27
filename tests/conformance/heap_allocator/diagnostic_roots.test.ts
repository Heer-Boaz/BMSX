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
import { asClosure, valueBool, valueInteger, valueNil, valuePayload, valueString, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { LUA_FAULT_REASON_INDEX_NAN, LUA_FAULT_REASON_INDEX_NON_TABLE } from '../../../machine/ts/spec/blua32/cop0';
import { HEAP_SERVICE_REMARK_FAULTS_OFFSET, HEAP_SERVICE_REMARK_HEAD_OFFSET, HeapServiceRemarkHeadField } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE, RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { runGuestToHalt } from '../../helpers/cpu_test_harness';
import { runCpuWithinBudget } from '../../helpers/cpu_execution';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const source = `
local set_metatable<const> = require('kernel/set_metatable')
local protected_entries<const> = require('bmsx/startup')
local pcall<const> = blua32.closure(protected_entries.protected_call)
local xpcall<const> = blua32.closure(protected_entries.protected_xcall)

sink = { old = 0, new = 0 }
function old_index(receiver, key) return 111 end
function new_index(receiver, key) return 711 end
function old_newindex(receiver, key, value) sink.old = value end
function new_newindex(receiver, key, value) sink.new = value end
function old_len(receiver) return 13 end
function new_len(receiver) return 73 end
function broken(value) return value[1] end
function broken_handler(message) return broken(62) end

meta = { __index = old_index, __newindex = old_newindex, __len = old_len }
receiver = {}
set_metatable(receiver, meta)

function probe(target, value)
	sink.old = 0
	sink.new = 0
	local got = target.missing_field
	target.missing_assignment = value
	local size = #target
	local ok, message = pcall(broken, 77)
	local xok, xmessage = xpcall(broken, broken_handler, 88)
	return got, sink.old, sink.new, size, ok, message, xok, xmessage
end
`;

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

for (const optLevel of [0, 3] as const) {
	test(`diagnostic String roots select metatable and firmware fault behavior after restore at O${optLevel}`, t => {
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
		cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
		const global = (name: string) => cpu.getGlobalByKey(cpu.stringPool.find(name)!);
		const receiver = global('receiver'), meta = valuePayload(global('meta'));
		const probe = asClosure(global('probe'), cpu.gc);
		const args = [receiver, valueInteger(41)];
		const management = cpu.heapAllocator.managementOffset();
		const head = management + HEAP_SERVICE_REMARK_HEAD_OFFSET, faults = management + HEAP_SERVICE_REMARK_FAULTS_OFFSET;
		const originalError = memory.readRamRecordWord(head + HeapServiceRemarkHeadField.Error);
		const originalFault = memory.readRamRecordWord(faults + LUA_FAULT_REASON_INDEX_NON_TABLE * 4);
		assert.equal(memory.readRamRecordWord(head + HeapServiceRemarkHeadField.FaultIds), RAM_BASE + faults);

		// Warm ordinary and protected receiving windows before the observed call.
		cpu.beginCompletionCall(probe, args);
		assert.equal(runCpuWithinBudget(cpu, 65_536), RunResult.Halted);
		const old = [valueInteger(111), valueInteger(41), valueInteger(0), valueInteger(13),
			valueBool(false), valueString(originalFault), valueBool(false), valueString(originalError)];
		assert.deepEqual(runtime.readCompletionValues(), old, 'the original metamethods remain installed alongside replacements');
		const patches: Array<readonly [number, number]> = [];
		const intern = (text: string) => {
			const id = cpu.stringPool.intern(text);
			assert.ok(isRamStringId(id), 'the replacement is a RAM String, not a ROM String identity');
			return id;
		};
		for (const [offset, name] of [
			[HeapServiceRemarkHeadField.Index, 'new_index'],
			[HeapServiceRemarkHeadField.NewIndex, 'new_newindex'],
			[HeapServiceRemarkHeadField.Length, 'new_len'],
		] as const) {
			const id = intern(`replacement diagnostic ${name}`);
			assert.notEqual(memory.readRamRecordWord(head + offset), id);
			cpu.gc.tables.setStringKey(meta, id, global(name));
			patches.push([head + offset, id]);
		}
		const error = intern('replacement protected handler failure'), fault = intern('replacement protected fault');
		const faultBytes = 4 * (LUA_FAULT_REASON_INDEX_NAN + 1);
		const alternateFaults = cpu.heapAllocator.allocate(faultBytes, false);
		assert.notEqual(alternateFaults, 0);
		for (let i = 0; i < faultBytes; i += 4) {
			memory.writeRamRecordWord(alternateFaults + i, memory.readRamRecordWord(faults + i));
		}
		// Keep the original plane and its original error intact: offset-only
		// consumers (as well as constructor-cached Ids) must give the old answer.
		memory.writeRamRecordWord(alternateFaults + LUA_FAULT_REASON_INDEX_NON_TABLE * 4, fault);
		patches.push([head + HeapServiceRemarkHeadField.FaultIds, alternateFaults],
			[head + HeapServiceRemarkHeadField.Error, error]);

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
			observe(`L ${cycles}`, [result, cycles - cpu.instructionBudgetRemaining, +cpu.heapServiceActive(), cpu.gc.fullEpochs(),
				cpu.gc.phase(), cpu.luaHeap.usedBytes()].join(' '));
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
			assert.deepEqual(values, [valueInteger(711), valueInteger(0), valueInteger(41), valueInteger(73),
				valueBool(false), valueString(fault), valueBool(false), valueString(error)],
				'live diagnostic String Ids select all three metamethods, the protected fault, and the failed handler');
			assert.equal(cpu.gc.tables.getStringKey(valuePayload(receiver), cpu.stringPool.find('missing_assignment')!), valueNil(),
				'the selected __newindex ran instead of publishing a raw field');
			observe('c', [values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
			observe('Z', [cpu.readCauseWord(), cpu.readLuaFaultReasonWord(), cpu.readEpcWord()].join(' '));
			hash(head, HeapServiceRemarkHeadField.FaultIds + 4);
			hash(alternateFaults & RAM_RECORD_WORD_MASK, faultBytes);
		}
		const atProtectedEntry = () => cpu.activeThread.currentFrame?.pc === protectedCall.codeAddress;
		for (let i = 0; !atProtectedEntry() && i < 512; ++i) assert.equal(grant(1), RunResult.Yielded);
		assert.ok(atProtectedEntry(), 'checkpoint at the ordinary protected call, before its fault');
		assert.ok(cpu.getFrameDepth() > 1);
		observe('P', `${cpu.getFrameDepth()} ${cpu.readFramePc(cpu.getFrameDepth() - 1)}`);
		hash(head, HeapServiceRemarkHeadField.FaultIds + 4);
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
		assert.deepEqual(runtime.readCompletionValues(), old, 'restoring the old words restores the original selector and fault Ids');
	});
}
