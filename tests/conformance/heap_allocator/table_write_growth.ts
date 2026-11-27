import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueInteger, valueNil, valuePayload, valueString, valueTable, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { INSTRUCTION_BYTES, instructionOpcode } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import {
	HEAP_SERVICE_BIOS_CALL_OFFSET, HEAP_SERVICE_REMARK_HEAD_OFFSET, HEAP_SERVICE_VALUE_OFFSET, HeapServiceBiosCallField,
	HeapServiceBiosCallKind, HeapServiceRemarkHeadField, HeapServiceTableGrowthMode,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const source = `
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
return implicit,integer,field
`;
const scenario = [
	{ name: 'index', entry: 0, opcode: OpCode.SETT },
	{ name: 'integer', entry: 1, opcode: OpCode.SETI },
	{ name: 'field', entry: 2, opcode: OpCode.SETFIELD },
] as const;

const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-table-write-growth-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
		buildDirectory: 'tmp/build-native-bioscall', parallel: '4',
		configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
	});
	for (const optLevel of [0, 3] as const) {
		const system = writeTestBlua32Rom(linkManagedTestSystem(source, optLevel));
		const configuration = { systemRomBytes: system, cartridgeSlots: [null, null] as [null, null], machineModel: PSX_MACHINE_SPEC };
		const rom = join(directory, `O${optLevel}.rom`);
		writeFileSync(rom, system);
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
			const key = spec.entry === 1 ? valueInteger(1) : spec.entry === 2 ? valueString(cpu.stringPool.intern('field')) : valueInteger(-129);
			const value = valueInteger(183);
			cpu.beginCompletionCall(valuePayload(entries[spec.entry]), [receiver, key, value]);
			const management = arena.managementOffset(), before = arena.occupiedBytes(), logical = heap.usedBytes();
			const mailbox = management + HEAP_SERVICE_BIOS_CALL_OFFSET, head = management + HEAP_SERVICE_REMARK_HEAD_OFFSET;
			const mode = CpuRunKind.Direct;
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
				observe(`J ${cycles} 0`, `${result} ${cycles - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} 0 ${arena.occupiedBytes()} ${heap.usedBytes()}`);
				assert.equal(cpu.allocationParked(), false);
				assert.equal(cpu.tableRebuild.record, 0);
				return result;
			}
			const history = new RamHistory();
			history.start(memory);
			const baseline = history.capture(memory, null);
			for (let i = 0; i < 64 && !cpu.heapServiceActive(); ++i) assert.equal(grant(1), RunResult.Yielded);
			assert.equal(cpu.heapServiceActive(), true);
			assert.equal(read(HeapServiceBiosCallField.Kind), HeapServiceBiosCallKind.Discard);
			assert.equal(read(HeapServiceBiosCallField.ResultWord), 0);
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
			const checkpoint = captureRuntimeSaveState(runtime);
			const checkpointRam = history.capture(memory, baseline);
			const prefix = trace.length;
			writeFileSync(partialFile, encodeRuntimeSaveState(checkpoint));
			const visible = spec.entry === 0 ? [valueInteger(72), value] : [value];
			function finish() {
				for (let i = 0; i < 8192 && cpu.heapServiceActive(); ++i) assert.equal(grant(137), RunResult.Yielded);
				assert.equal(cpu.heapServiceActive(), false);
				assert.equal(read(HeapServiceBiosCallField.Kind), HeapServiceBiosCallKind.Idle);
				assert.equal(read(HeapServiceBiosCallField.InstructionPc), original);
				assert.equal(tables.get(target, key), value);
				assert.equal(read(HeapServiceBiosCallField.Status), 0);
				assert.equal(cpu.readLuaFaultReasonWord(), 0, 'protected refusal does not raise a CPU trap');
				assert.equal(pc(), next);
				assert.equal(read(HeapServiceBiosCallField.Tag), ValueTag.Table);
				assert.equal(read(HeapServiceBiosCallField.Word), target);
				for (let i = 0; i < 8 && grant(65536) !== RunResult.Halted; ++i) { /* retire through the ordinary protected owner */ }
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
			console.log(`BIOS-TABLE-WRITE-GROWTH:PASS O${optLevel} ${spec.name} (${allTrace.length} exact grant/RAM observations)`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
