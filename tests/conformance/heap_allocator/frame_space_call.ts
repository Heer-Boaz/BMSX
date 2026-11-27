import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState, decodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { FRAME_RESIDENT_ACTIVATION, FRAME_RESIDENT_PREPARED_ENTRY, FrameField, PreparedFrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { valueInteger, valuePayload, valueTable } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { INSTRUCTION_BYTES, instructionOpcode } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import {
	HEAP_SERVICE_BIOS_CALL_OFFSET, HEAP_SERVICE_FRAME_OFFSET, HEAP_SERVICE_PREPARED_FRAME_OFFSET, HEAP_SERVICE_RESIDENT_OFFSET,
	HeapServiceBiosCallField, HeapServiceBiosCallKind, HeapServiceResidentField,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const program = `
local function hold(value) return value end
local function callee(a,b,...) local c,d=...; return a,b,c,d end
local function caller(f,x,y) local a,b,c,d=f(x,y,123,456); return a,b,c,d end
return hold,caller,callee
`;
mkdirSync('tmp', { recursive: true });
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
	buildDirectory: 'tmp/build-native-frame-call',
	configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
});
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

for (const level of [0, 3] as const) {
	function fixture(directory: string) {
		const linked = linkTestSystemBlua32(compileHeapServiceSystem(program, level));
		const runtime = new Runtime({ systemRomBytes: linked.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine, arena = cpu.heapAllocator;
		const file = join(directory, `O${level}`), rom = `${file}.rom`;
		writeFileSync(rom, linked.romBytes);
		const trace: string[] = [], expected: string[] = [];
		function observe(command: string, answer: string) { trace.push(command); expected.push(answer); }
		function exportCheckpoint(label: string) {
			const target = `${file}.${label}.save`;
			writeFileSync(target, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			return target;
		}
		function runNative(seed: string, commands: readonly string[], reference: readonly string[]) {
			const traceFile = `${file}.trace`;
			writeFileSync(traceFile, ['X', ...commands].join('\n'));
			const output = execFileSync(native, [rom, traceFile, seed], { encoding: 'utf8' }).trimEnd().split('\n');
			assert.equal(output.length, reference.length);
			const mismatch = output.findIndex((row, i) => row !== reference[i]);
			assert.equal(mismatch, -1, `grant ${mismatch}: TS=${reference[mismatch]} C++=${output[mismatch]}`);
		}
		runGuestToHalt(cpu, 65536);
		cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
		const [hold, caller, callee] = runtime.readCompletionValues();
		const arg = valueTable(cpu.createTable(0, 0));
		cpu.beginCompletionCall(valuePayload(hold), [valueInteger(901)]);
		cpu.beginCompletionCall(valuePayload(hold), [valueInteger(902)]);
		cpu.beginCompletionCall(valuePayload(caller), [callee, arg, valueInteger(19)]);
		const thread = cpu.activeThread, parent = thread.currentFrame!, warmSeed = exportCheckpoint('profile-seed');
		assert.equal(thread.frameDepth, 3);
		const readThread = (field: ThreadField) => memory.readRamRecordWord(thread.address + field);
		const management = arena.managementOffset();
		const armed = (field: HeapServiceBiosCallField) => memory.readRamRecordWord(management + HEAP_SERVICE_BIOS_CALL_OFFSET + field);
		const resident = (field: HeapServiceResidentField) => memory.readRamRecordWord(management + HEAP_SERVICE_RESIDENT_OFFSET + field);
		const prepared = (field: FrameField | PreparedFrameField) => memory.readRamRecordWord(management + HEAP_SERVICE_PREPARED_FRAME_OFFSET + field);
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(2, cycles, undefined, CpuRunKind.Scheduled);
			const used = cycles - cpu.instructionBudgetRemaining;
			observe(`J ${cycles} 1`, `${result} ${used} ${+cpu.heapServiceActive()} 0 ${arena.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
			return { result, used };
		}
		for (let n = 0; n < 128 && instructionOpcode(memory.readMappedU32LE(parent.pc)) !== OpCode.CALL; ++n)
			assert.equal(grant(1).result, RunResult.Yielded);
		assert.equal(instructionOpcode(memory.readMappedU32LE(parent.pc)), OpCode.CALL);
		const issue = parent.pc, depth = thread.frameDepth;
		const stack = readThread(ThreadField.StackBlock), frames = readThread(ThreadField.FrameBlock), charged = cpu.luaHeap.usedBytes();
		function launch() {
			assert.deepEqual(grant(1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.CALL] });
			assert.ok(cpu.heapServiceActive());
			assert.equal(armed(HeapServiceBiosCallField.Kind), HeapServiceBiosCallKind.Idle);
			assert.equal(memory.readRamRecordWord(management + HEAP_SERVICE_FRAME_OFFSET + FrameField.Flags),
				FRAME_RESIDENT_ACTIVATION | FRAME_RESIDENT_PREPARED_ENTRY);
			assert.equal(resident(HeapServiceResidentField.IssuePc), issue);
			assert.equal(prepared(FrameField.Closure), valuePayload(callee));
			assert.equal(prepared(PreparedFrameField.Supplied), 4);
			assert.equal(prepared(PreparedFrameField.RelocateFormals), 1);
			assert.equal(prepared(FrameField.CallSite), issue);
			assert.equal(parent.pc, issue + INSTRUCTION_BYTES);
			assert.equal(thread.frameDepth, depth);
		}
		function finishReservation() {
			const trace: number[] = [];
			for (let i = 0; i < 32768 && cpu.heapServiceActive(); ++i) {
				const { result, used } = grant(137);
				assert.equal(result, RunResult.Yielded);
				assert.ok(used > 0);
				trace.push(used);
			}
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(armed(HeapServiceBiosCallField.Kind), HeapServiceBiosCallKind.Idle);
			return trace;
		}
		return { runtime, cpu, memory, arena, thread, parent, management, issue, depth, stack, frames, charged,
			readThread, resident, prepared, launch, grant, finishReservation, arg, trace, expected, observe, exportCheckpoint, runNative, file, warmSeed };
	}
	test(`a real generated CALL handoff and bidirectional frame-space checkpoint match at O${level}`, t => {
		const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-frame-call-'));
		t.after(() => rmSync(directory, { force: true, recursive: true }));
		const f = fixture(directory), { cpu, memory, thread } = f;
		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null);
		f.trace.length = f.expected.length = 0;
		const seed = f.exportCheckpoint('seed');
		f.launch();
		assert.equal(f.readThread(ThreadField.StackBlock), f.stack);
		assert.equal(f.readThread(ThreadField.FrameBlock), f.frames);
		assert.equal(cpu.luaHeap.usedBytes(), f.charged);
		assert.equal(f.grant(17).result, RunResult.Yielded);
		assert.ok(cpu.heapServiceActive());
		const checkpoint = cpu.captureRuntimeState(), partial = history.capture(memory, baseline);
		const tsMid = f.exportCheckpoint('mid'), cppMid = `${f.file}.cpp-mid.save`, middle = f.trace.length;
		const first = memory.ramBusEnd() - RAM_BASE, last = memory.ramData().length;
		let retirement = middle;
		function end() {
			const trace = f.finishReservation();
			f.observe(`H ${first} ${last}`, String(hashBytes(memory.ramData(), first, last - first)));
			retirement = f.trace.length;
			assert.equal(thread.frameDepth, f.depth + 1);
			assert.equal(f.resident(HeapServiceResidentField.SourceCount), 0, 'resident reservation returns no Values');
			assert.equal(thread.currentFrame!.pc, f.prepared(FrameField.Pc), 'no instruction in the new frame has run');
			assert.equal(thread.currentFrame!.registers.get(0), f.arg);
			assert.equal(thread.currentFrame!.registers.get(1), valueInteger(19));
			assert.equal(thread.stackRegisters.get(thread.currentFrame!.varargBase), valueInteger(123));
			assert.equal(thread.stackRegisters.get(thread.currentFrame!.varargBase + 1), valueInteger(456));
			assert.notEqual(f.readThread(ThreadField.FrameBlock), f.frames);
			for (let i = 0; i < 8 && f.grant(32768).result !== RunResult.Halted; ++i) { /* until exact caller-parent depth */ }
			assert.equal(thread.frameDepth, 2);
			assert.deepEqual(f.runtime.readCompletionValues(), [f.arg, valueInteger(19), valueInteger(123), valueInteger(456)]);
			return trace;
		}
		const trace = end(), terminal = history.capture(memory, partial), expected = f.expected.slice(0, retirement);
		const firstRun = f.trace.slice(0, retirement);
		f.runNative(seed, [...firstRun.slice(0, middle), `x ${cppMid}`, ...firstRun.slice(middle)], expected);
		f.runNative(f.warmSeed, ['K A'], [`1 ${FRAME_RESIDENT_ACTIVATION | FRAME_RESIDENT_PREPARED_ENTRY} ${expected[0].split(' ').slice(-2).join(' ')}`]);
		f.runNative(tsMid, firstRun.slice(middle), expected.slice(middle));
		history.restore(memory, terminal, partial);
		cpu.restoreRuntimeState(checkpoint);
		assert.deepEqual(end(), trace);
		applyRuntimeSaveState(f.runtime, decodeRuntimeSaveState(readFileSync(cppMid), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		f.expected.length = f.trace.length = 0;
		assert.deepEqual(end(), trace);
		assert.deepEqual(f.expected.slice(0, retirement), expected.slice(middle));
	});
}
