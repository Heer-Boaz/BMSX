import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_CHANGED_HEAD, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_OFFSET, GC_RECORD_SHIFT } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { isOpen, load, UPVALUE_ADDRESS_MASK, UPVALUE_HEAP_BYTES, UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD } from '../../../machine/ts/machine/cpu/upvalue';
import { ValueTag, valueInteger, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_REFERENCE_STORE } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

for (const [opt, phase] of [[0, GcPhase.MarkAgain], [3, GcPhase.Mark]] as const) test(`closed SETUP publishes its reference through the System exception at O${opt}`, t => {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
		buildDirectory: join(tmpdir(), 'bmsx-native-closed-upvalue'),
		configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
	});
	const image = linkManagedTestSystem(`
local function make_setter()
	local captured = 73
	return function(value)
		captured = value
		return captured
	end
end
local set<const> = make_setter()
local incoming<const> = { marker = 57 }
halt_until_irq
return set(incoming)
`, opt);
	const rom = writeTestBlua32Rom(image);
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine, { gc } = cpu;
	runGuestToHalt(cpu, 4_194_304);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	cpu.clearHaltUntilIrq();
	const decode = () => decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, cpu.activeThread.currentFrame!.pc);
	for (let step = 0; decode().op !== OpCode.SETUP && step < 16; ++step)
		assert.equal(scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
	const thread = cpu.activeThread, depth = thread.frameDepth, caller = thread.currentFrame!;
	const setup = decode(), closure = caller.closureAddress;
	assert.equal(setup.op, OpCode.SETUP);
	const value = caller.registers.get(setup.a), child = valuePayload(value), owner = thread.address;
	const successor = setup.pc + INSTRUCTION_BYTES, cell = caller.captureAddress(setup.b) & UPVALUE_ADDRESS_MASK;
	assert.equal(valueTag(value), ValueTag.Table);
	assert.equal(isOpen(memory, cell), false);
	assert.equal(load(memory, cell), valueInteger(73));

	// Establish the original algorithm's black-owner / white-child case
	// without a collector step that would visit the stopped caller's operand.
	const control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	memory.writeRamRecordByte(control, phase);
	const immediate = phase === GcPhase.MarkAgain, changed = control + GC_CHANGED_HEAD;
	const originalChanged = memory.readRamRecordWord(changed);
	memory.writeRamRecordByte(cell + GC_COLOR_OFFSET, 3);
	assert.equal(gc.isAlive(child), false);
	const dir = mkdtempSync(join(tmpdir(), 'bmsx-closed-upvalue-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const romPath = join(dir, 'system.rom'), trace = join(dir, 'trace');
	const seed = join(dir, 'seed'), tsMid = join(dir, 'ts-mid'), cppMid = join(dir, 'cpp-mid');
	writeFileSync(romPath, rom);
	writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	const commands: string[] = ['X'], observations: string[] = [];
	function grant(budget: number) {
		const run = scheduler.runCpuSlice(0, budget, undefined, CpuRunKind.Scheduled);
		commands.push(`E ${budget}`);
		observations.push(`${run} ${budget - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		return run;
	}
	function observeCell() {
		commands.push(`H ${cell} ${cell + UPVALUE_HEAP_BYTES}`);
		observations.push(String(hashBytes(memory.ramData(), cell, UPVALUE_HEAP_BYTES)));
	}
	assert.equal(grant(1), RunResult.Yielded);
	assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[OpCode.SETUP]);
	assert.equal(cpu.fixedInterruptActive(), true);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_REFERENCE_STORE);
	assert.equal(cpu.readBadAddressWord(), RAM_BASE + cell);
	assert.equal(cpu.readEpcWord(), successor);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
	assert.equal(cpu.readThreadFrameWord(owner, depth - 1, FrameField.Pc), successor);
	const vector = cpu.activeThread.currentFrame!;
	assert.equal(vector.argumentCount, 1);
	assert.equal(vector.registers.get(0), value);
	assert.equal(load(memory, cell), valueInteger(73), 'architectural issue writes neither cell lane');
	assert.equal(gc.isAlive(child), false, 'collector policy has not run at issue');
	commands.push('Z');
	observations.push(`${CPU_CAUSE_CODE_REFERENCE_STORE} 0 ${successor}`);
	observeCell();

	// Stop between the guest stores, after the barrier and before the
	// firmware publishes the new value tag.
	for (let step = 0; memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD) === 73 && step < 4096; ++step)
		assert.equal(grant(1), RunResult.Yielded);
	assert.equal(cpu.fixedInterruptActive(), true);
	assert.equal(memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD), child);
	assert.equal(memory.readRamRecordByte(cell + UPVALUE_VALUE_TAG), ValueTag.Integer);
	assert.equal(gc.isAlive(child), immediate);
	assert.equal(memory.readRamRecordWord(changed), immediate ? originalChanged : cell >>> GC_RECORD_SHIFT);
	observeCell();
	writeFileSync(tsMid, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	commands.push(`x ${cppMid}`, 'l', 's');
	const commandCut = commands.length, observationCut = observations.length;

	function complete() {
		for (let step = 0; cpu.fixedInterruptActive() && step < 4096; ++step) assert.equal(grant(1), RunResult.Yielded);
		assert.equal(cpu.fixedInterruptActive(), false);
		assert.equal(cpu.activeThread.address, owner);
		assert.equal(cpu.readFramePc(depth - 1), successor);
		assert.equal(load(memory, cell), value);
		assert.equal(gc.isAlive(child), immediate);
		observeCell();
		assert.equal(grant(4096), RunResult.Halted);
		assert.deepEqual(runtime.readCompletionValues(), [value]);
		commands.push('c');
		observations.push(`1 ${ValueTag.Table} ${child}`);
	}

	complete();
	const tail = commands.slice(commandCut), expectedTail = observations.slice(observationCut);
	function replay(script: readonly string[], state: string) {
		writeFileSync(trace, script.join('\n'));
		return execFileSync(native, [romPath, trace, state], { encoding: 'utf8' }).trimEnd().split('\n');
	}
	assert.deepEqual(replay([...commands, 'u', ...tail], seed), [...observations, ...expectedTail], 'C++ runs the same timed exception and rewinds the split store');
	assert.deepEqual(replay(['X', ...tail], tsMid), expectedTail, 'TS to C++ resumes between stores');
	const state = decodeRuntimeSaveState(readFileSync(cppMid), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
	assert.equal(state.cpuState.badAddressWord, RAM_BASE + cell);
	assert.equal(state.cpuState.causeWord, CPU_CAUSE_CODE_REFERENCE_STORE);
	applyRuntimeSaveState(runtime, state);
	assert.equal(load(memory, cell), valueInteger(child));
	const before = observations.length;
	complete();
	assert.deepEqual(observations.slice(before), expectedTail, 'C++ to TS resumes between stores');

	if (opt === 0) {
		// At the same program's ordinary callable entry the native runner
		// warms with a scalar, then issues the same SETUP with a reference.
		cpu.beginCompletionCall(closure, [value]);
		const warmSeed = join(dir, 'warm-seed');
		writeFileSync(warmSeed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const paid = BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.SETUP] + 2;
		for (const mode of [0, 1]) {
			assert.deepEqual(replay(['X', `! ${paid} ${mode} 1`, 'Z'], warmSeed),
				[`${RunResult.Yielded} ${paid} ${mode} ${mode} 0 0`, `${CPU_CAUSE_CODE_REFERENCE_STORE} 0 ${successor}`]);
		}
	}
});
