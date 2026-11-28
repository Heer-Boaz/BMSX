import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameField } from '../../machine/ts/machine/cpu/call_state';
import { CompiledBlockExit, CpuExecutionBackend, compiledBlockSupports } from '../../machine/ts/machine/cpu/compiled_block';
import { CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { valueFloatBits, valueInteger } from '../../machine/ts/machine/cpu/value';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, CPU_CAUSE_CODE_RESERVED_INSTRUCTION, CPU_CAUSE_NMI } from '../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, RegisterJumpMode, ValueMoveKind, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_ROM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';

function baseProgram(backend: CpuExecutionBackend, loop = false) {
	const words: [OpCode, number, number, number, number?][] = [
		[OpCode.KSMI, 0, 0, 5],
		[OpCode.MOV, 63, 0, ValueMoveKind.SetBase],
		[OpCode.JMP, 0, loop ? 63 : 0, loop ? 63 : 0, loop ? 255 : 0],
		[OpCode.MOV, 1, 63, ValueMoveKind.ReadTop],
		[OpCode.MOV, 2, 63, ValueMoveKind.ReadBase],
		[OpCode.WIDE, 0, 63, 0],
		[OpCode.MOV, 63, 59, ValueMoveKind.AddBase, 56], // signed WIDE B = -5
		[OpCode.MOV, 63, 63, ValueMoveKind.AddBase, 56], // signed B = -1, outside the enclosure
		[OpCode.RET, 0, 1, 0],
		[OpCode.RFE, 0, 0, 0],
	];
	const text = new Uint8Array(words.length * INSTRUCTION_BYTES);
	for (const [i, instruction] of words.entries()) writeInstruction(text, i, ...instruction);
	const { romBytes, image } = linkRawTestSystemBlua32({ text, verifiedControlFlow: true, irqFunctionIndex: 1, exceptionFunctionIndex: 1,
		functions: [{ firstWord: 0, wordCount: 9, maxStack: 16 }, { firstWord: 9, wordCount: 1, maxStack: 0 }] });
	const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
		cpuExecutionBackend: backend }, { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} });
	runtime.boot();
	const { cpu, scheduler } = runtime.machine;
	const initial = image.functions[0].codeAddress, context = cpu.activeThread.address;
	const raw = (field: FrameField) => cpu.readThreadFrameWord(context, 0, field);
	const step = (op: OpCode) => {
		assert.equal(scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
		assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[op]);
	};
	return { runtime, cpu, scheduler, initial, context, raw, step };
}

test('register basis changes neither the enclosing frame nor its live prefix, including across NMI and save/restore', () => {
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const { runtime, cpu, initial, context, raw, step } = baseProgram(backend);
		const frameAddress = cpu.readThreadFrameAddress(context, 0), depth = cpu.getFrameDepth();
		const origin = raw(FrameField.StackBase), capacity = raw(FrameField.StackCapacity), end = cpu.activeThread.stackTop;
		step(OpCode.KSMI);
		step(OpCode.MOV);
		step(OpCode.JMP);
		assert.equal(raw(FrameField.RegisterBase), 5);
		assert.equal(raw(FrameField.Top), 1);
		const saved = captureRuntimeSaveState(runtime);
		cpu.requestNonMaskableInterrupt();
		assert.equal(cpu.enterPendingInterrupt(), true);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_NMI);
		assert.equal(cpu.activeThread.currentFrame!.registerBase, 0);
		step(OpCode.RFE);
		assert.equal(cpu.readFramePc(0), initial + 3 * INSTRUCTION_BYTES);
		assert.equal(raw(FrameField.Top), 1);
		assert.equal(raw(FrameField.RegisterBase), 5);
		for (let replay = 0; replay < 2; ++replay) {
			if (replay !== 0) applyRuntimeSaveState(runtime, saved);
			// The basis lies above the live prefix: ReadTop observes zero,
			// but only this instruction's write extends the physical frontier.
			step(OpCode.MOV);
			assert.equal(cpu.readFrameRegister(0, 1), valueInteger(0));
			assert.equal(raw(FrameField.Top), 7);
			step(OpCode.MOV);
			assert.equal(cpu.readFrameRegister(0, 2), valueInteger(5));
			step(OpCode.MOV);
			assert.equal(raw(FrameField.RegisterBase), 0);
			assert.equal(raw(FrameField.Top), 8);
			assert.equal(cpu.readFrameRegister(0, 0), valueInteger(5));
			assert.equal(cpu.readFrameRegister(0, 6), valueInteger(0));
			assert.equal(cpu.readFrameRegister(0, 7), valueInteger(5));
			assert.equal(cpu.getFrameDepth(), depth);
			assert.equal(cpu.readThreadFrameAddress(context, 0), frameAddress);
			assert.equal(raw(FrameField.StackBase), origin);
			assert.equal(raw(FrameField.StackCapacity), capacity);
			assert.equal(cpu.activeThread.stackTop, end);
			step(OpCode.MOV);
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
			assert.equal(cpu.readEpcWord(), initial + 7 * INSTRUCTION_BYTES);
			assert.equal(raw(FrameField.RegisterBase), 0);
		}
	}
});

test('the scalar live prefix stays physical through both basis changes in one grant', () => {
	const { cpu, scheduler, initial, raw } = baseProgram(CpuExecutionBackend.Interpreter);
	const cycles = BASE_CYCLES[OpCode.KSMI] + BASE_CYCLES[OpCode.JMP] + 4 * BASE_CYCLES[OpCode.MOV];
	assert.equal(scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
	assert.equal(cpu.instructionBudgetRemaining, 0);
	assert.equal(cpu.readFramePc(0), initial + 7 * INSTRUCTION_BYTES);
	assert.equal(raw(FrameField.RegisterBase), 0);
	assert.equal(raw(FrameField.Top), 8);
	assert.equal(cpu.readFrameRegister(0, 0), valueInteger(5));
	assert.equal(cpu.readFrameRegister(0, 6), valueInteger(0));
	assert.equal(cpu.readFrameRegister(0, 7), valueInteger(5));
});

test('SetTop publishes the selected live prefix before an observer or a reserved-instruction fault', () => {
	const words: [OpCode, number, number, number][] = [
		[OpCode.KSMI, 0, 0, 5],
		[OpCode.MOV, 63, 0, ValueMoveKind.SetBase],
		[OpCode.KSMI, 0, 0, 2],
		[OpCode.KSMI, 4, 0, 31],
		[OpCode.MOV, 63, 0, ValueMoveKind.SetTop],
		[OpCode.MOV, 1, 63, ValueMoveKind.ReadTop],
		[OpCode.MOV, 63, 4, ValueMoveKind.SetTop],
		[OpCode.RET, 0, 1, 0],
		[OpCode.RFE, 0, 0, 0],
	];
	const text = new Uint8Array(words.length * INSTRUCTION_BYTES);
	for (const [i, instruction] of words.entries()) writeInstruction(text, i, ...instruction);
	const { romBytes, image } = linkRawTestSystemBlua32({ text, verifiedControlFlow: true, exceptionFunctionIndex: 1,
		functions: [{ firstWord: 0, wordCount: 8, maxStack: 16 }, { firstWord: 8, wordCount: 1, maxStack: 0 }] });
	const first = image.functions[0].codeAddress;
	for (const observed of [false, true]) {
		const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
			cpuExecutionBackend: CpuExecutionBackend.Interpreter },
			{ sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} });
		runtime.boot();
		const { cpu, scheduler } = runtime.machine, context = cpu.activeThread.address;
		const raw = (field: FrameField) => cpu.readThreadFrameWord(context, 0, field);
		let visits = 0;
		if (observed) cpu.setInstructionObserver({
			points: [new Set([first + 5 * INSTRUCTION_BYTES]), new Set(), new Set()],
			observe: (_domain, pc, registers) => {
				assert.equal(pc, first + 5 * INSTRUCTION_BYTES);
				assert.equal(raw(FrameField.RegisterBase), 5);
				assert.equal(raw(FrameField.Top), 7);
				assert.equal(registers.get(0), valueInteger(2));
				++visits;
			},
		});
		const cycles = 3 * BASE_CYCLES[OpCode.KSMI] + 4 * BASE_CYCLES[OpCode.MOV];
		assert.equal(scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(visits, +observed);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
		assert.equal(cpu.readEpcWord(), first + 6 * INSTRUCTION_BYTES);
		assert.equal(raw(FrameField.RegisterBase), 5);
		assert.equal(raw(FrameField.Top), 7);
		assert.equal(cpu.readThreadRegister(context, 0, 0), valueInteger(2));
		assert.equal(cpu.readThreadRegister(context, 0, 1), valueInteger(2));
	}
});

test('SetTopImmediate uses unsigned wide A without touching Values, even with unused B outside the window', () => {
	const capacity = 321;
	const text = new Uint8Array(6 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 1, 63, 0);
	writeInstruction(text, 1, OpCode.MOV, 1, 63, ValueMoveKind.SetTopImmediate, 0x78); // A=321, B=32767
	writeInstruction(text, 2, OpCode.WIDE, 63, 63, 0);
	writeInstruction(text, 3, OpCode.MOV, 63, 63, ValueMoveKind.SetTopImmediate, 0xf8); // A=16383, B=32767
	writeInstruction(text, 4, OpCode.RET, 0, 1, 0);
	writeInstruction(text, 5, OpCode.RFE, 0, 0, 0);
	const { romBytes, image } = linkRawTestSystemBlua32({ text, verifiedControlFlow: true, exceptionFunctionIndex: 1,
		functions: [{ firstWord: 0, wordCount: 5, maxStack: capacity }, { firstWord: 5, wordCount: 1, maxStack: 0 }] });
	const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
		cpuExecutionBackend: CpuExecutionBackend.Interpreter },
		{ sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} });
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine, thread = cpu.rootThread;
	const frame = thread.currentFrame!, values = thread.stackRegisters, ram = memory.ramData();
	frame.registers.set(0, valueFloatBits(0x80000000));
	frame.registers.set(capacity - 1, valueInteger(73));
	const planes = (count: number) => [ram.slice(values.ramOffset(), values.ramOffset() + count * 4),
		ram.slice(values.tagRamOffset(), values.tagRamOffset() + count)];
	const originalValues = planes(values.capacity()), originalWindow = planes(capacity);
	const first = image.functions[0].codeAddress;
	const raw = (field: FrameField) => cpu.readThreadFrameWord(thread.address, 0, field);
	assert.equal(compiledBlockSupports(OpCode.MOV, capacity, ValueMoveKind.SetTopImmediate), false);
	assert.equal(scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
	assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[OpCode.MOV]);
	assert.equal(raw(FrameField.Pc), first + 2 * INSTRUCTION_BYTES);
	assert.equal(raw(FrameField.Top), capacity);
	assert.deepEqual(planes(values.capacity()), originalValues);
	assert.equal(scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
	assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[OpCode.MOV]);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
	assert.equal(cpu.readEpcWord(), first + 2 * INSTRUCTION_BYTES);
	assert.equal(raw(FrameField.Top), capacity);
	assert.deepEqual(planes(capacity), originalWindow);
});

test('scalar JAL and JREG preserve prefixed links, aliased targets and the precise fault across grants and rewind', () => {
	const words: [OpCode, number, number, number][] = [
		[OpCode.WIDE, 0, 0, 0],
		[OpCode.JAL, 2, 0, 2],
		[OpCode.RET, 0, 1, 0],
		[OpCode.RET, 0, 1, 0],
		[OpCode.WIDE, 0, 0, 0],
		[OpCode.JREG, 0, 0, RegisterJumpMode.Link],
		[OpCode.RET, 0, 1, 0],
		[OpCode.JREG, 3, 63, RegisterJumpMode.Jump],
		[OpCode.RET, 0, 1, 0],
		[OpCode.KSMI, 5, 0, 17],
		[OpCode.WIDE, 0, 0, 0],
		[OpCode.JREG, 1, 1, RegisterJumpMode.Link],
		[OpCode.RET, 0, 1, 0],
		[OpCode.RFE, 0, 0, 0],
	];
	const text = new Uint8Array(words.length * INSTRUCTION_BYTES);
	for (const [i, instruction] of words.entries()) writeInstruction(text, i, ...instruction);
	const { romBytes, image } = linkRawTestSystemBlua32({ text, verifiedControlFlow: true, exceptionFunctionIndex: 1,
		functions: [{ firstWord: 0, wordCount: 13, maxStack: 8 }, { firstWord: 13, wordCount: 1, maxStack: 0 }] });
	const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
		cpuExecutionBackend: CpuExecutionBackend.Interpreter },
		{ sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} });
	runtime.boot();
	const { cpu, scheduler } = runtime.machine, context = cpu.activeThread.address;
	const first = image.functions[0].codeAddress;
	const at = (word: number) => first + word * INSTRUCTION_BYTES;
	const invalid = at(12) + 2;
	const frame = cpu.activeThread.currentFrame!;
	frame.registers.setInteger(0, at(7));
	frame.registers.setInteger(1, invalid);
	frame.registers.setInteger(3, at(9));
	const raw = (field: FrameField) => cpu.readThreadFrameWord(context, 0, field);
	const run = (budget: number, cycles: number) => {
		assert.equal(scheduler.runCpuSlice(0, budget, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
		assert.equal(budget - cpu.instructionBudgetRemaining, cycles);
	};
	run(1, BASE_CYCLES[OpCode.JAL]);
	assert.equal(raw(FrameField.Pc), at(4));
	assert.equal(cpu.readThreadRegister(context, 0, 2), valueInteger(at(2)));
	const insideCall = BASE_CYCLES[OpCode.JAL];
	scheduler.advanceTo(insideCall);
	const history = runtime.history;
	history.start({ checkpointCapacity: 2, inputCapacity: 8, checkpointIntervalCycles: 1 });
	history.captureCheckpoint();
	run(1, BASE_CYCLES[OpCode.JREG]);
	assert.equal(raw(FrameField.Pc), at(7));
	assert.equal(cpu.readThreadRegister(context, 0, 0), valueInteger(at(6)));
	scheduler.advanceTo(insideCall + BASE_CYCLES[OpCode.JREG]);
	history.recordInputBoundary(false);
	history.captureCheckpoint();
	history.beginSeek(insideCall);
	assert.equal(scheduler.currentNowCycles(), insideCall);
	assert.equal(cpu.getFrameDepth(), 1, 'rewind does not synthesize a nested activation');
	assert.equal(raw(FrameField.Pc), at(4));
	assert.equal(cpu.readThreadRegister(context, 0, 0), valueInteger(at(7)));
	assert.equal(cpu.readThreadRegister(context, 0, 2), valueInteger(at(2)));
	history.stop();
	run(1, BASE_CYCLES[OpCode.JREG]);
	assert.equal(raw(FrameField.Pc), at(7));
	assert.equal(cpu.readThreadRegister(context, 0, 0), valueInteger(at(6)));
	const preceding = BASE_CYCLES[OpCode.JREG] + BASE_CYCLES[OpCode.KSMI];
	run(preceding + 1, preceding + BASE_CYCLES[OpCode.JREG]);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD);
	assert.equal(cpu.readBadAddressWord(), invalid);
	assert.equal(cpu.readEpcWord(), at(10));
	assert.equal(raw(FrameField.Pc), at(10));
	assert.equal(raw(FrameField.Top), 6);
	assert.equal(cpu.readThreadRegister(context, 0, 1), valueInteger(invalid));
	assert.equal(cpu.readThreadRegister(context, 0, 5), valueInteger(17));
});

test('an out-of-bank jump publishes the local frontier before the fetch-fault handler runs', () => {
	const text = new Uint8Array(5 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.KSMI, 5, 0, 17);
	writeInstruction(text, 1, OpCode.JREG, 1, 0, RegisterJumpMode.Jump);
	writeInstruction(text, 2, OpCode.RET, 0, 1, 0);
	writeInstruction(text, 3, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 4, OpCode.RFE, 0, 0, 0);
	const { romBytes, image } = linkRawTestSystemBlua32({ text, verifiedControlFlow: true, exceptionFunctionIndex: 1,
		functions: [{ firstWord: 0, wordCount: 3, maxStack: 6 }, { firstWord: 3, wordCount: 2, maxStack: 1 }] });
	const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
		cpuExecutionBackend: CpuExecutionBackend.Interpreter },
		{ sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} });
	runtime.boot();
	const { cpu, scheduler } = runtime.machine, interrupted = cpu.activeThread;
	interrupted.currentFrame!.registers.setInteger(1, SYSTEM_ROM_SIZE);
	const grant = BASE_CYCLES[OpCode.KSMI] + BASE_CYCLES[OpCode.JREG] + 1 + BASE_CYCLES[OpCode.K1];
	assert.equal(scheduler.runCpuSlice(0, grant, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
	assert.equal(cpu.instructionBudgetRemaining, 0);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR);
	assert.equal(cpu.readEpcWord(), SYSTEM_ROM_SIZE);
	assert.equal(cpu.readThreadFrameWord(interrupted.address, 0, FrameField.Top), 6);
	assert.equal(cpu.activeThread.currentFrame!.pc, image.functions[1].codeAddress + INSTRUCTION_BYTES);
	assert.equal(cpu.activeThread.currentFrame!.registers.get(0), valueInteger(1));
});

test('generated branches do not extend a live prefix below the selected register basis', () => {
	const { cpu, scheduler, initial, raw, step } = baseProgram(CpuExecutionBackend.JavaScript, true);
	step(OpCode.KSMI);
	step(OpCode.MOV);
	for (let n = 0; n < 12; ++n) assert.equal(scheduler.runCpuSlice(0, 41, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
	assert.equal(raw(FrameField.Top), 1);
	assert.equal(raw(FrameField.RegisterBase), 5);
	const pages = cpu.activeThread.currentFrame!.executionImage.decodedPages;
	const entries = [...pages.values()].flatMap(page => page.compiledBlocks?.entries ?? []);
	assert.ok(entries.some(entry => entry?.terminal.currentPc === initial + 2 * INSTRUCTION_BYTES && entry.terminal.exit === CompiledBlockExit.Continue));
});
