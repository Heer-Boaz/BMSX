import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { TableRecords } from '../../../machine/ts/machine/cpu/table';
import { valueBool, valueBuiltinFunction, valueInteger, valueNil, valuePayload, valueString, valueTable, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { BuiltinFunctionId } from '../../../machine/ts/spec/blua32/builtin';
import { LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, instructionOpcode } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import {
	HEAP_SERVICE_BIOS_CALL_OFFSET, HEAP_SERVICE_REMARK_HEAD_OFFSET, HEAP_SERVICE_VALUE_OFFSET, HeapServiceBiosCallField,
	HeapServiceBiosCallKind, HeapServiceRemarkHeadField, HeapServiceTableGrowthMode,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const source = `
local function fixed(t,k,v,raw)
 local a,b,c=raw(t,k,v)
 return a,b,c,t[k]
end
local function open(t,k,v,raw) return raw(t,k,v) end
local function nested(t,k,v,raw,pcall) return pcall(pcall,raw,t,k,v) end
local function protected(t,k,v,raw,_,xpcall,handler) return xpcall(raw,handler,t,k,v) end
local function implicit(t,k,v)
 local witness=72
 t[k]=v
 return witness,t[k]
end
local function integer(t,k,v)
 t[1]=v
 return t[1]
end
local function field(t,k,v)
 t.field=v
 return t.field
end
local function handler(err) return 431 end
return fixed,open,nested,protected,implicit,integer,field,handler
`;
const scenario = [
	{ name: 'fixed', entry: 0, opcode: OpCode.CALL, kind: HeapServiceBiosCallKind.Call, resultWord: 4, protectedDepth: 0, failure: false, scheduled: true },
	{ name: 'open', entry: 1, opcode: OpCode.CALL, kind: HeapServiceBiosCallKind.Call, resultWord: 0, protectedDepth: 0, failure: false, scheduled: true },
	{ name: 'nested', entry: 2, opcode: OpCode.CALL, kind: HeapServiceBiosCallKind.Protected, resultWord: 0, protectedDepth: 2, failure: false, scheduled: true },
	{ name: 'handler', entry: 3, opcode: OpCode.CALL, kind: HeapServiceBiosCallKind.Protected, resultWord: 0, protectedDepth: 1, failure: true, scheduled: true },
	{ name: 'implicit', entry: 4, opcode: OpCode.SETT, kind: HeapServiceBiosCallKind.Call, resultWord: 0x80000001, protectedDepth: 0, failure: false, scheduled: true },
	{ name: 'direct-index', entry: 4, opcode: OpCode.SETT, kind: HeapServiceBiosCallKind.Discard, resultWord: 0, protectedDepth: 0, failure: false, scheduled: false },
	{ name: 'direct-integer', entry: 5, opcode: OpCode.SETI, kind: HeapServiceBiosCallKind.Discard, resultWord: 0, protectedDepth: 0, failure: false, scheduled: false },
	{ name: 'direct-field', entry: 6, opcode: OpCode.SETFIELD, kind: HeapServiceBiosCallKind.Discard, resultWord: 0, protectedDepth: 0, failure: false, scheduled: false },
] as const;

const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-rawset-service-'));
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
		for (const spec of scenario) {
			const runtime = new Runtime(configuration, input);
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine, { gc, heapAllocator: arena, luaHeap: heap } = cpu, { tables } = gc;
			let boot = cpu.runUntilDepth(0, 65536);
			for (let n = 0; n < 32 && boot === RunResult.Yielded; ++n) boot = cpu.runUntilDepth(0, 65536);
			assert.equal(boot, RunResult.Halted);
			const entries = runtime.readCompletionValues();
			heap.setCollectionTarget(heap.capacity());
			const target = cpu.createTable(0, 128), receiver = valueTable(target);
			for (let n = 1; n <= 128; ++n) tables.set(target, valueInteger(-n), valueInteger(n));
			const key = spec.entry === 5 ? valueInteger(1) : spec.entry === 6 ? valueString(cpu.stringPool.intern('field')) : valueInteger(-129);
			const value = valueInteger(183), rawset = valueBuiltinFunction(BuiltinFunctionId.RawSet);
			if (spec.name === 'implicit') {
				const meta = cpu.createTable(0, 1);
				tables.set(meta, tables.newIndexKey, rawset);
				tables.setMetatableAddress(target, meta);
			}
			// In the failure case the handler must remain live throughout a real
			// physical refusal and a whole current/fresh BIOS recovery.
			const closure = valuePayload(entries[spec.entry]);
			const trailing = [rawset, valueBuiltinFunction(BuiltinFunctionId.PCall), valueBuiltinFunction(BuiltinFunctionId.XPCall), entries[7]];
			if (spec.protectedDepth !== 0) {
				cpu.beginCompletionCall(closure, [receiver, valueInteger(-1), valueInteger(1), ...trailing]);
				assert.equal(cpu.runUntilDepth(0, 65536), RunResult.Halted, 'prime controls through an ordinary non-growing protected call');
				assert.equal(runtime.readCompletionValues()[0], valueBool(true));
			}
			cpu.beginCompletionCall(closure, [receiver, key, value, ...trailing]);
			if (spec.failure) {
				for (let i = 0; i < 4096 && gc.phase() !== GcPhase.Strings; ++i)
					gc.step(receiver, entries[7], valueNil(), 0, false, 1);
				assert.equal(gc.phase(), GcPhase.Strings);
				while (arena.allocate(4088, true)) { /* exhaust full pages */ }
				while (arena.allocate(TableRecords.hashStorageBytes(256), true)) { /* exhaust admissible holes */ }
			}
			const management = arena.managementOffset(), before = arena.occupiedBytes(), logical = heap.usedBytes();
			const mailbox = management + HEAP_SERVICE_BIOS_CALL_OFFSET, head = management + HEAP_SERVICE_REMARK_HEAD_OFFSET;
			const mode = spec.scheduled ? CpuRunKind.Scheduled : CpuRunKind.Direct;
			const read = (field: HeapServiceBiosCallField) => memory.readRamRecordWord(mailbox + field);
			const depth = cpu.getFrameDepth() - 1, pc = () => cpu.readFramePc(depth);
			const seed = captureRuntimeSaveState(runtime);
			const file = join(directory, `O${optLevel}-${spec.name}`);
			const seedFile = `${file}.seed`, partialFile = `${file}.partial`, nativePartial = `${file}.native-partial`;
			writeFileSync(seedFile, encodeRuntimeSaveState(seed));
			const trace: string[] = [], expected: string[] = [];
			function observe(command: string, value: string | number) { trace.push(command); expected.push(String(value)); }
			function hash(first: number, last: number) { observe(`H ${first} ${last}`, hashBytes(memory.ramData(), first, last - first)); }
			function grant(cycles: number) {
				const result = scheduler.runCpuSlice(0, cycles, undefined, mode);
				observe(`J ${cycles} ${+spec.scheduled}`, `${result} ${cycles - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} 0 ${arena.occupiedBytes()} ${heap.usedBytes()}`);
				assert.equal(cpu.allocationParked(), false);
				assert.equal(cpu.tableRebuild.record, 0);
				return result;
			}
			const history = new RamHistory();
			history.start(memory);
			const baseline = history.capture(memory, null);
			for (let i = 0; i < 64 && !cpu.heapServiceActive(); ++i) assert.equal(grant(1), RunResult.Yielded);
			assert.equal(cpu.heapServiceActive(), true);
			assert.equal(read(HeapServiceBiosCallField.Kind), spec.kind);
			assert.equal(read(HeapServiceBiosCallField.ResultWord), spec.resultWord);
			assert.equal(cpu.rootThread.protectedDepth, spec.protectedDepth);
			assert.equal(memory.readRamRecordWord(management + HEAP_SERVICE_VALUE_OFFSET + 3 * 4), HeapServiceTableGrowthMode.General);
			assert.equal(memory.readRamRecordWord(head + HeapServiceRemarkHeadField.HasPendingAssignment), 0);
			const operandWords = [target, valueTag(key), valuePayload(key), ValueTag.Integer, 183];
			assert.deepEqual(operandWords.map((_, index) => memory.readRamRecordWord(head + HeapServiceRemarkHeadField.Receiver + index * 4)), operandWords);
			const original = read(HeapServiceBiosCallField.InstructionPc), next = read(HeapServiceBiosCallField.LastPc) + INSTRUCTION_BYTES;
			assert.equal(instructionOpcode(memory.readMappedU32LE(next - INSTRUCTION_BYTES)), spec.opcode);
			assert.equal(pc(), next);
			assert.equal(arena.occupiedBytes(), before);
			assert.equal(heap.usedBytes(), logical);
			assert.equal(tables.get(target, key), valueNil());
			hash(mailbox, mailbox + HeapServiceBiosCallField.ResultWord + 4);
			assert.equal(grant(17), RunResult.Yielded);
			assert.equal(cpu.heapServiceActive(), true);
			assert.equal(pc(), next);
			assert.equal(cpu.rootThread.protectedDepth, spec.protectedDepth);
			const checkpoint = captureRuntimeSaveState(runtime);
			const checkpointRam = history.capture(memory, baseline);
			const prefix = trace.length;
			writeFileSync(partialFile, encodeRuntimeSaveState(checkpoint));
			const visible = spec.failure ? [valueBool(false), valueInteger(431)]
				: spec.name === 'fixed' ? [receiver, valueNil(), valueNil(), value]
				: spec.name === 'open' ? [receiver]
				: spec.name === 'nested' ? [valueBool(true), valueBool(true), receiver]
				: spec.entry === 4 ? [valueInteger(72), value] : [value];
			function finish() {
				for (let i = 0; i < 8192 && cpu.heapServiceActive(); ++i) assert.equal(grant(137), RunResult.Yielded);
				assert.equal(cpu.heapServiceActive(), false);
				assert.equal(read(HeapServiceBiosCallField.Kind), HeapServiceBiosCallKind.Idle);
				assert.equal(read(HeapServiceBiosCallField.InstructionPc), original);
				assert.equal(tables.get(target, key), spec.failure ? valueNil() : value);
				assert.equal(read(HeapServiceBiosCallField.Status), spec.failure ? LUA_FAULT_REASON_OUT_OF_MEMORY + 1 : 0);
				assert.equal(cpu.readLuaFaultReasonWord(), 0, 'protected refusal does not raise a CPU trap');
				if (!spec.failure) {
					assert.equal(pc(), next);
					assert.equal(read(HeapServiceBiosCallField.Tag), ValueTag.Table);
					assert.equal(read(HeapServiceBiosCallField.Word), target);
				}
				for (let i = 0; i < 8 && grant(65536) !== RunResult.Halted; ++i) { /* retire through the ordinary protected owner */ }
				assert.equal(cpu.rootThread.protectedDepth, 0);
				const results = runtime.readCompletionValues();
				assert.deepEqual(results, visible, spec.name);
				observe('c', [results.length, ...results.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
				hash(memory.ramBusEnd() - RAM_BASE, memory.ramData().length);
			}
			finish();
			const allTrace = trace.slice(), allExpected = expected.slice();
			const runNative = (state: string, commands: readonly string[]) => {
				const traceFile = `${file}.trace`;
				writeFileSync(traceFile, commands.join('\n'));
				return execFileSync(native, [rom, traceFile, state], { encoding: 'utf8' }).trimEnd().split('\n');
			};
			function compare(actual: readonly string[], want: readonly string[]) {
				const mismatch = actual.findIndex((row, index) => row !== want[index]);
				assert.equal(mismatch, -1, `${spec.name} grant ${mismatch}: TS=${want[mismatch]} C++=${actual[mismatch]}`);
				assert.equal(actual.length, want.length);
			}
			compare(runNative(seedFile, ['X', ...allTrace.slice(0, prefix), `x ${nativePartial}`, ...allTrace.slice(prefix)]), allExpected);
			compare(runNative(partialFile, ['X', ...allTrace.slice(prefix)]), allExpected.slice(prefix));
			if (spec.name === 'fixed')
				compare(runNative(seedFile, ['X', 'K R']), [`1 ${HeapServiceBiosCallKind.Call} ${before} ${logical}`]);
			const endRam = history.capture(memory, checkpointRam);
			history.restore(memory, endRam, checkpointRam);
			applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
			trace.length = expected.length = 0;
			finish();
			assert.deepEqual(expected, allExpected.slice(prefix));
			applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePartial), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			trace.length = expected.length = 0;
			finish();
			assert.deepEqual(expected, allExpected.slice(prefix));
			console.log(`BIOS-RAWSET-GENERAL:PASS O${optLevel} ${spec.name} (${allTrace.length} exact grant/RAM observations)`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
