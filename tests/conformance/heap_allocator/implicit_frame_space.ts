import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_RESIDENT_ACTIVATION, FRAME_RESIDENT_PREPARED_ENTRY, FrameField, PreparedFrameField, PREPARED_FRAME_DETACHED_SOURCE } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { ValueTag, valueInteger, valueNil, valuePayload, valueString, valueTable } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode, TABLE_INDEX_VISIT_CYCLES } from '../../../machine/ts/spec/blua32/opcode';
import { LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../../machine/ts/spec/blua32/cop0';
import {
	HEAP_SERVICE_FRAME_OFFSET, HEAP_SERVICE_PREPARED_FRAME_OFFSET, HEAP_SERVICE_RESIDENT_OFFSET,
	HEAP_SERVICE_RESULT_FAULT, HeapServiceResidentField,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const source = `
local function hold(value) return value end
local function read(table, warm)
	local prefix = #warm + 1
	return table.missing, prefix
end
local function index(receiver, ...)
	local key = ...
	return receiver.guard + #key
end
local function write(table, warm)
	local prefix = #warm + 1
	table.missing = 211
	return prefix
end
local function newindex(receiver, ...)
	local key, value = ...
	receiver.guard = #key + value
end
return hold, read, index, write, newindex
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
	buildDirectory: 'tmp/build-native-implicit-frame',
	configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
});

for (const level of [0, 3] as const) for (const scenario of ['read', 'write', 'refusal'] as const) {
	const refusal = scenario === 'refusal', writing = scenario === 'write';
	test(`implicit frame ${scenario} preserves detached arguments and continuation at O${level}`, t => {
		const root = mkdtempSync(join(process.cwd(), 'tmp', 'implicit-frame-'));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const linked = linkTestSystemBlua32(compileHeapServiceSystem(source, level));
		const rom = join(root, 'system.rom'), commands = join(root, 'trace');
		writeFileSync(rom, linked.romBytes);
		const runtime = new Runtime({ systemRomBytes: linked.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine, arena = cpu.heapAllocator, tables = cpu.gc.tables;
		runGuestToHalt(cpu, 65_536);
		cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
		const [hold, read, index, write, newindex] = runtime.readCompletionValues();
		const callerFunction = writing ? write : read, method = writing ? newindex : index;
		const object = cpu.createTable(0, 1), outer = cpu.createTable(0, 1), forward = cpu.createTable(0, 1);
		const inner = cpu.createTable(0, 1), weakness = cpu.createTable(0, 1), warm = cpu.createTable(0, 1);
		const selector = cpu.stringPool.intern(writing ? '__newindex' : '__index'), key = cpu.stringPool.intern('missing');
		const guard = cpu.stringPool.intern('guard');
		tables.setStringKey(outer, selector, valueTable(forward));
		tables.setStringKey(inner, selector, method);
		tables.setStringKey(forward, guard, valueInteger(66));
		tables.setStringKey(weakness, cpu.stringPool.intern('__mode'), valueString(cpu.stringPool.intern('v')));
		tables.setStringKey(warm, key, valueInteger(91));
		tables.setMetatableAddress(object, outer);
		tables.setMetatableAddress(outer, weakness);
		tables.setMetatableAddress(forward, inner);
		cpu.beginCompletionCall(valuePayload(hold), [valueInteger(901)]);
		cpu.beginCompletionCall(valuePayload(hold), [valueInteger(902)]);
		cpu.beginCompletionCall(valuePayload(callerFunction), [valueTable(object), valueTable(warm)]);
		const thread = cpu.activeThread, caller = thread.currentFrame!, depth = thread.frameDepth, management = arena.managementOffset();
		const prepared = management + HEAP_SERVICE_PREPARED_FRAME_OFFSET;
		// The active Thread already owns enough Values (also for its
		// exception vector); this fixture exhausts the separate Frame block.
		thread.resizeStack(128);
		const frames = memory.readRamRecordWord(thread.address + ThreadField.FrameBlock);
		const trace: string[] = [], expected: string[] = [];
		function save(name: string) {
			const file = join(root, name);
			writeFileSync(file, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			return file;
		}
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(depth - 1, cycles, undefined, CpuRunKind.Scheduled);
			const used = cycles - cpu.instructionBudgetRemaining;
			trace.push(`g ${cycles} ${depth - 1}`);
			expected.push(`${result} ${used} ${+cpu.heapServiceActive()} ${arena.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
			return { result, used };
		}
		function nativeReplay(seed: string, sequence: readonly string[], result: readonly string[]) {
			writeFileSync(commands, ['X', ...sequence].join('\n'));
			const actual = execFileSync(native, [rom, commands, seed], { encoding: 'utf8' }).trimEnd().split('\n');
			assert.equal(actual.length, result.length);
			const mismatch = result.findIndex((word, i) => word !== actual[i]);
			assert.equal(mismatch, -1, `observation ${mismatch}: TS=${result[mismatch]}, C++=${actual[mismatch]}`);
		}
		const profile = save('profile');
		const targetOp = writing ? OpCode.SETFIELD : OpCode.GETFIELD;
		const instruction = () => decodeBlua32InstructionAtPc(linked.image.textBytes, linked.image.header.textAddress, caller.pc);
		for (let i = 0; i < 128 && instruction().op !== targetOp; ++i)
			assert.equal(grant(1).result, RunResult.Yielded);
		assert.equal(instruction().op, targetOp);
		const issue = caller.pc, successor = instruction().pc + INSTRUCTION_BYTES;
		if (refusal) {
			for (let i = 0; i < 4096 && cpu.gc.phase() !== GcPhase.Atomic; ++i)
				cpu.gc.step(valueNil(), valueNil(), valueNil(), 0, false, 11);
			assert.equal(cpu.gc.phase(), GcPhase.Atomic);
			assert.equal(cpu.gc.isAlive(forward), false, 'the forwarded receiver has only a weak home at issue');
			while (arena.allocate(4088, true)) { /* occupy each large extent */ }
			while (arena.allocate(24, true)) { /* leave no frame-sized extent */ }
		}
		trace.length = expected.length = 0;
		const seed = save('before'), charged = cpu.luaHeap.usedBytes();
		assert.equal(thread.frameDepth, 3);
		const flags = FRAME_RESIDENT_ACTIVATION | FRAME_RESIDENT_PREPARED_ENTRY;
		const issueGrant = grant(1);
		assert.equal(issueGrant.result, RunResult.Yielded);
		assert.equal(issueGrant.used, BASE_CYCLES[targetOp] + TABLE_INDEX_VISIT_CYCLES);
		assert.equal(caller.pc, successor);
		assert.equal(thread.frameDepth, depth);
		assert.equal(cpu.luaHeap.usedBytes(), charged);
		assert.equal(memory.readRamRecordWord(management + HEAP_SERVICE_FRAME_OFFSET + FrameField.Flags), flags);
		assert.equal(memory.readRamRecordWord(prepared + PreparedFrameField.SourceSlot), PREPARED_FRAME_DETACHED_SOURCE);
		assert.equal(memory.readRamRecordWord(prepared + PreparedFrameField.Supplied), writing ? 3 : 2);
		assert.equal(memory.readRamRecordWord(prepared + PreparedFrameField.Payloads), forward);
		assert.equal(memory.readRamRecordWord(prepared + PreparedFrameField.Payloads + 4), key);
		assert.equal(memory.readRamRecordByte(prepared + PreparedFrameField.Tags), ValueTag.Table);
		assert.equal(memory.readRamRecordByte(prepared + PreparedFrameField.Tags + 1), ValueTag.String);
		if (writing) {
			assert.equal(memory.readRamRecordWord(prepared + PreparedFrameField.Payloads + 8), 211);
			assert.equal(memory.readRamRecordByte(prepared + PreparedFrameField.Tags + 2), ValueTag.Integer);
		}
		const occupied = arena.occupiedBytes();
		assert.equal(grant(17).result, RunResult.Yielded);
		assert.ok(cpu.heapServiceActive());
		const mid = save('mid'), nativeMid = join(root, 'native-mid'), split = trace.length;
		for (let i = 0; i < 10000 && cpu.heapServiceActive(); ++i) grant(257);
		assert.ok(!cpu.heapServiceActive());
		if (refusal) {
			assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
			assert.equal(cpu.readEpcWord(), issue);
			assert.equal(memory.readRamRecordWord(management + HEAP_SERVICE_RESIDENT_OFFSET + HeapServiceResidentField.SourceCount), HEAP_SERVICE_RESULT_FAULT);
			assert.equal(memory.readRamRecordWord(thread.address + ThreadField.FrameBlock), frames);
			assert.equal(cpu.gc.tableRecordAddress(forward), forward, 'the raw Atomic call scope preserved the otherwise unrooted receiver');
			trace.push('Z');
			expected.push(`${cpu.readCauseWord()} ${cpu.readLuaFaultReasonWord()} ${cpu.readEpcWord()}`);
		} else {
			assert.notEqual(memory.readRamRecordWord(thread.address + ThreadField.FrameBlock), frames);
			const callback = thread.currentFrame!;
			assert.equal(callback.callSitePc, issue);
			assert.equal(callback.registers.get(0), valueTable(forward));
			assert.equal(thread.stackRegisters.get(callback.varargBase), valueString(key));
			if (writing) assert.equal(thread.stackRegisters.get(callback.varargBase + 1), valueInteger(211));
			for (let step = 0; step < 32 && thread.frameDepth !== depth - 1; ++step) grant(32);
			assert.equal(thread.frameDepth, depth - 1);
			assert.deepEqual(runtime.readCompletionValues(), writing ? [valueInteger(1)] : [valueInteger(73), valueInteger(1)]);
			assert.equal(tables.getStringKey(forward, guard), valueInteger(writing ? 218 : 66));
			trace.push('C');
			expected.push(writing ? '1' : '73');
			if (!writing) nativeReplay(profile, ['K M'], [`1 ${flags} ${occupied} ${charged}`]);
		}
		const start = memory.ramBusEnd() - RAM_BASE;
		trace.push(`H ${start} ${memory.ramData().length}`);
		expected.push(String(hashBytes(memory.ramData(), start, memory.ramData().length - start)));
		nativeReplay(seed, [...trace.slice(0, split), `x ${nativeMid}`, ...trace.slice(split)], expected);
		nativeReplay(mid, trace.slice(split), expected.slice(split));
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeMid), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		assert.ok(cpu.heapServiceActive());
		assert.equal(memory.readRamRecordWord(prepared + PreparedFrameField.Payloads), forward);
	});
}
