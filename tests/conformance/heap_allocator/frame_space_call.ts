import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CLOSURE_PROTOTYPE_ADDRESS } from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { THREAD_HEAP_BYTES, ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { ValueTag, valueInteger, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeCheckpointState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_REGISTER_WINDOW } from '../../../machine/ts/spec/blua32/cop0';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_RESET_BANK_ADDRESS, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const args = Array.from({ length: 320 }, (_, index) => String(index + 1)).join(',');
const program = `
local function callee(a,b,...)
	local extra = a.extra
	if extra then extra(${args}) end
	local c,d = ...
	return a,b,c,d
end
local function caller(f,x)
	halt_until_irq
	return f(x,19,123,456)
end
return caller(callee, {marker = 402})
`;
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
	buildDirectory: join(tmpdir(), 'build-native-frame-window-call'),
	configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON'],
});
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

for (const level of [0, 3] as const) test(`ordinary CALL retries from EPC and retains all arguments through rewind at O${level}`, t => {
	const linked = linkManagedTestSystem(program, level);
	const romBytes = writeTestBlua32Rom(linked);
	function boot() {
		const rt = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		rt.boot();
		assert.equal(rt.machine.cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		return rt;
	}
	const runtime = boot(), { cpu, memory } = runtime.machine;
	runGuestToHalt(cpu, 4_194_304);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	const thread = cpu.activeThread, owner = thread.address, depth = thread.frameDepth, caller = thread.currentFrame!;
	cpu.clearHaltUntilIrq();
	const decode = () => decodeBlua32InstructionAtPc(romBytes, SYSTEM_ROM_BASE, caller.pc);
	for (let step = 0; step < 32 && decode().op !== OpCode.CALL; ++step)
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
	const instruction = decode();
	assert.equal(instruction.op, OpCode.CALL);
	assert.equal(instruction.b, 5);
	const issue = caller.pc;
	const entry = caller.registers.get(instruction.a), argument = caller.registers.get(instruction.a + 1);
	assert.equal(valueTag(entry), ValueTag.Closure);
	assert.equal(valueTag(argument), ValueTag.Table);
	const fn = memory.readRamRecordWord(valuePayload(entry) + CLOSURE_PROTOTYPE_ADDRESS);
	const prototype = linked.layout.functions.find(candidate => candidate.address === fn)!;
	const required = caller.stackBase + instruction.a + 1 + 4 + prototype.maxStack;
	const stack = memory.readRamRecordWord(owner + ThreadField.StackBlock);
	const charged = cpu.luaHeap.usedBytes();
	assert.ok(required > thread.stackRegisters.capacity());

	const dir = mkdtempSync(join(tmpdir(), 'frame-window-call-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const rom = join(dir, 'system.rom'), trace = join(dir, 'trace');
	const seed = join(dir, 'seed'), mid = join(dir, 'ts-mid'), nativeMid = join(dir, 'native-mid');
	writeFileSync(rom, romBytes);
	writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	const history = new RamHistory();
	history.start(memory);
	const initial = history.capture(memory, null);
	const commands: string[] = [], rows: string[] = [];
	function observe(command: string, row: string | number) {
		commands.push(command);
		rows.push(String(row));
	}
	function hash(rt: Runtime, address: number, bytes: number) {
		const start = address - RAM_BASE;
		observe(`H ${start} ${start + bytes}`, hashBytes(rt.machine.memory.ramData(), start, bytes));
	}
	function grant(rt: Runtime, budget: number) {
		const { cpu, memory, scheduler } = rt.machine;
		const result = scheduler.runCpuSlice(0, budget, undefined, CpuRunKind.Scheduled);
		const used = budget - cpu.instructionBudgetRemaining;
		observe(`E ${budget}`, `${result} ${used} ${+cpu.heapServiceActive()} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		return { result, used };
	}
	assert.deepEqual(grant(runtime, 1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.CALL] });
	assert.equal(cpu.fixedInterruptActive(), true);
	assert.equal(cpu.heapServiceActive(), false);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_REGISTER_WINDOW);
	assert.equal(cpu.readEpcWord(), issue);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
	assert.equal(cpu.readThreadFrameDepth(owner), depth);
	assert.equal(cpu.readThreadFrameWord(owner, depth - 1, FrameField.Pc), issue);
	assert.equal(memory.readRamRecordWord(owner + ThreadField.StackBlock), stack);
	assert.equal(cpu.luaHeap.usedBytes(), charged);
	const fixed = cpu.activeThread.currentFrame!;
	assert.equal(fixed.argumentCount, 4, 'a retry refers to the ordinary stopped instruction, not a detached placement');
	assert.equal(fixed.registers.get(0), valueInteger(required));
	assert.equal(fixed.registers.get(1), valueInteger(depth + 2));
	assert.equal(fixed.registers.get(2), valueInteger(OpCode.CALL | (instruction.a << 8)));
	observe('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} 0 ${issue}`);
	hash(runtime, owner, THREAD_HEAP_BYTES);
	assert.equal(grant(runtime, 17).result, RunResult.Yielded);
	assert.equal(cpu.fixedInterruptActive(), true);
	const partial = history.capture(memory, initial), checkpoint = captureRuntimeCheckpointState(runtime);
	writeFileSync(mid, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	commands.push(`x ${nativeMid}`);
	const commandCut = commands.length, rowCut = rows.length;
	function finish(rt: Runtime) {
		const { cpu, memory } = rt.machine;
		for (let step = 0; cpu.fixedInterruptActive() && step < 65_536; ++step)
			assert.equal(grant(rt, 1).result, RunResult.Yielded);
		assert.equal(cpu.fixedInterruptActive(), false);
		assert.equal(cpu.activeThread.address, owner);
		assert.equal(cpu.getFrameDepth(), depth);
		assert.equal(cpu.readFramePc(depth - 1), issue);
		assert.equal(cpu.readEpcWord(), issue);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
		assert.ok(cpu.activeThread.stackRegisters.capacity() >= required);
		assert.equal(cpu.readFrameRegister(depth - 1, instruction.a + 1), argument);
		hash(rt, owner, THREAD_HEAP_BYTES);

		assert.equal(grant(rt, 1).result, RunResult.Yielded);
		assert.equal(cpu.getFrameDepth(), depth + 1);
		const frame = cpu.activeThread.currentFrame!;
		assert.equal(frame.pc, prototype.codeAddress);
		assert.equal(frame.callSitePc, instruction.pc);
		assert.equal(frame.argumentCount, 4);
		assert.equal(frame.registers.get(0), argument);
		assert.equal(frame.registers.get(1), valueInteger(19));
		assert.equal(cpu.activeThread.stackRegisters.get(frame.varargBase), valueInteger(123));
		assert.equal(cpu.activeThread.stackRegisters.get(frame.varargBase + 1), valueInteger(456));
		hash(rt, RAM_BASE + frame.controlOffset, FRAME_CONTROL_BYTES);
		let run = RunResult.Yielded;
		for (let step = 0; step < 256 && run === RunResult.Yielded; ++step) run = grant(rt, 257).result;
		assert.equal(run, RunResult.Halted);
		assert.equal(cpu.captureRuntimeState().hardHalted, false);
		const result = rt.readCompletionValues();
		assert.deepEqual(result, [argument, valueInteger(19), valueInteger(123), valueInteger(456)]);
		observe('c', [result.length, ...result.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	}
	finish(runtime);
	const terminal = history.capture(memory, partial);
	function replay(input: string, steps: readonly string[], expected: readonly string[]) {
		writeFileSync(trace, ['X', ...steps].join('\n'));
		const actual = execFileSync(native, [rom, trace, input], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trimEnd().split('\n');
		const mismatch = actual.findIndex((row, index) => row !== expected[index]);
		assert.equal(mismatch, -1, `row ${mismatch}: C++=${actual[mismatch]}, TS=${expected[mismatch]}`);
		assert.equal(actual.length, expected.length);
	}
	replay(seed, commands, rows);
	const tail = commands.slice(commandCut), expected = rows.slice(rowCut);
	replay(mid, ['l', 's', ...tail, 'u', ...tail], [...expected, ...expected]);
	history.restore(memory, terminal, partial);
	applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
	commands.length = rows.length = 0;
	finish(runtime);
	assert.deepEqual(commands, tail);
	assert.deepEqual(rows, expected);
	const restored = boot();
	applyRuntimeSaveState(restored, decodeRuntimeSaveState(readFileSync(nativeMid), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	commands.length = rows.length = 0;
	finish(restored);
	assert.deepEqual(commands, tail);
	assert.deepEqual(rows, expected);
});
