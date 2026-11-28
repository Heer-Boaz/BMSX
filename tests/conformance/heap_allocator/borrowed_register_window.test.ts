import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueBool, valueInteger, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, captureRuntimeCheckpointState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, CPU_CAUSE_CODE_RESERVED_INSTRUCTION } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, RegisterJumpMode, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const word = INSTRUCTION_BYTES;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const outputs = [valueInteger(42), valueBool(true)];

function assemble() {
	const instructions: [OpCode, number, number, number][] = [
		[OpCode.LOADK, 6, 0, 0],
		[OpCode.KSMI, 7, 0, 2], [OpCode.KSMI, 8, 0, 4], [OpCode.KSMI, 9, 0, 2],
		[OpCode.KSMI, 2, 0, 19], [OpCode.KSMI, 3, 0, 23],
		[OpCode.JREG, 6, 7, RegisterJumpMode.EnterWindow],
		[OpCode.RET, 2, 3, 0],
		[OpCode.ADD, 0, 0, 1], [OpCode.KTRUE, 1, 0, 0],
		[OpCode.JREG, 63, 2, RegisterJumpMode.LeaveWindow],
		[OpCode.RFE, 0, 0, 0],
	];
	const text = new Uint8Array(instructions.length * word);
	for (const [i, instruction] of instructions.entries()) writeInstruction(text, i, ...instruction);
	const { romBytes, image } = linkRawTestSystemBlua32({ text, constants: [integerConstant(0)],
		verifiedControlFlow: true, irqFunctionIndex: 2, exceptionFunctionIndex: 2, functions: [
			{ firstWord: 0, wordCount: 8, maxStack: 10 },
			{ firstWord: 8, wordCount: 3, maxStack: 4 },
			{ firstWord: 11, wordCount: 1, maxStack: 0 },
		] });
	const [parent, child, irq] = image.functions;
	const targetConstant = image.header.constantTableAddress + BLUA32_CONSTANT_PAYLOAD_OFFSET;
	writeLE32(romBytes, targetConstant, child.codeAddress);
	return { parent, child, irq, romBytes, targetConstant };
}

function boot(rom: Uint8Array) {
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	return runtime;
}

test('bare ROM borrows a value window and restores its physical continuation across IRQ and cross-core save', t => {
	const { parent, child, irq, romBytes } = assemble();
	const runtime = boot(romBytes);
	const { cpu, memory, scheduler } = runtime.machine;
	const folder = mkdtempSync(join(tmpdir(), 'bmsx-borrowed-window-'));
	t.after(() => rmSync(folder, { recursive: true, force: true }));
	const program = join(folder, 'system.rom'), trace = join(folder, 'trace'), stateFile = join(folder, 'state');
	const commands: string[] = [], rows: string[] = [];
	const observe = (command: string, row: string) => { commands.push(command); rows.push(row); };
	function step(op: OpCode, result = RunResult.Yielded, extra = 0) {
		assert.equal(scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled), result);
		const paid = 1 - cpu.instructionBudgetRemaining;
		assert.equal(paid, BASE_CYCLES[op] + extra);
		observe('E 1', `${result} ${paid} ${memory.ramBusEnd()} -1`);
	}
	function pc(depth: number, address: number) {
		assert.equal(cpu.getFrameDepth(), depth);
		assert.equal(cpu.readFramePc(depth - 1), address);
		observe('P', `${depth} ${address}`);
	}
	function ram(start: number, bytes: number) {
		observe(`H ${start} ${start + bytes}`, String(hashBytes(memory.ramData(), start, bytes)));
	}
	step(OpCode.LOADK);
	for (let i = 0; i < 5; ++i) step(OpCode.KSMI);
	const thread = cpu.activeThread;
	const parentFrame = thread.currentFrame!;
	const payload = thread.stackOffset(), slots = thread.stackRegisters.capacity();
	const valuesBefore = memory.ramData().slice(payload, payload + 5 * slots);
	const history = new RamHistory();
	history.start(memory);
	const before = history.capture(memory, null);
	commands.push('l');

	step(OpCode.JREG);
	pc(2, child.codeAddress);
	const childFrame = thread.currentFrame!;
	assert.equal(cpu.readFrameFunctionAddress(1), 0);
	assert.equal(childFrame.stackBase, parentFrame.stackBase + 2);
	assert.equal(childFrame.stackCapacity, 4);
	assert.equal(childFrame.top, 2);
	assert.equal(cpu.readFramePc(0), parent.codeAddress + 7 * word);
	assert.deepEqual(memory.ramData().subarray(payload, payload + 5 * slots), valuesBefore);
	ram(parentFrame.controlOffset, 2 * FRAME_CONTROL_BYTES);
	ram(payload, 5 * slots);
	const checkpoint = captureRuntimeCheckpointState(runtime), pages = history.capture(memory, before);
	const commandCut = commands.length, rowCut = rows.length;
	writeFileSync(stateFile, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	commands.push('s');

	function resume() {
		commands.push('N');
		cpu.requestNonMaskableInterrupt();
		assert.equal(cpu.enterPendingInterrupt(), true);
		observe('I', '1');
		assert.equal(cpu.readEpcWord(), child.codeAddress);
		pc(3, irq.codeAddress);
		step(OpCode.RFE);
		pc(2, child.codeAddress);
		step(OpCode.ADD);
		step(OpCode.KTRUE);
		step(OpCode.JREG);
		pc(1, parent.codeAddress + 7 * word);
		assert.equal(cpu.activeThread.currentFrame!.top, 4);
		assert.equal(cpu.readFrameRegister(0, 2), outputs[0]);
		assert.equal(cpu.readFrameRegister(0, 3), outputs[1]);
		ram(parentFrame.controlOffset, FRAME_CONTROL_BYTES);
		ram(payload, 5 * slots);
		step(OpCode.RET, RunResult.Halted, 2);
		const values = runtime.readCompletionValues();
		assert.deepEqual(values, outputs);
		observe('c', [values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	}
	resume();
	const commandsEnd = commands.length, rowsEnd = rows.length;
	history.restore(memory, history.capture(memory, pages), pages);
	applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
	commands.push('u');
	resume();
	assert.deepEqual(rows.slice(rowsEnd), rows.slice(rowCut, rowsEnd));

	writeFileSync(program, romBytes);
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner', { buildDirectory: join(folder, 'native') });
	function replay(script: string[], expected: string[]) {
		writeFileSync(trace, script.join('\n'));
		assert.deepEqual(execFileSync(native, [program, trace, stateFile], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
	}
	replay(commands, rows);
	replay(['X', ...commands.slice(commandCut + 1, commandsEnd)], rows.slice(rowCut, rowsEnd));
});

test('window transfer takes a precise architectural exception before changing the window', () => {
	const { parent, child, irq, romBytes, targetConstant } = assemble();
	for (const fault of ['target', 'extent', 'underflow'] as const) {
		const rom = romBytes.slice(), issue = parent.codeAddress + 6 * word;
		if (fault === 'target') writeLE32(rom, targetConstant, child.codeAddress + 2);
		if (fault === 'target' || fault === 'extent') writeInstruction(rom, parent.codeAddress / word + 2, OpCode.KSMI, 8, 0, 17);
		if (fault === 'underflow') writeInstruction(rom, issue / word, OpCode.JREG, 63, 0, RegisterJumpMode.LeaveWindow);
		const { cpu, scheduler } = boot(rom).machine;
		scheduler.runCpuSlice(0, 12, undefined, CpuRunKind.Scheduled);
		assert.equal(cpu.readFramePc(0), issue);
		scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled);
		assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[OpCode.JREG]);
		assert.equal(cpu.readEpcWord(), issue);
		assert.equal(cpu.readFramePc(1), irq.codeAddress);
		assert.equal(cpu.readCauseWord(), fault === 'target' ? CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD : CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
		if (fault === 'target') assert.equal(cpu.readBadAddressWord(), child.codeAddress + 2);
		assert.equal(cpu.activeThread.frameAtDepth(0).stackCapacity, 10);
		assert.equal(cpu.readFrameRegister(0, 2), valueInteger(19));
		assert.equal(cpu.readFrameRegister(0, 3), valueInteger(23));
	}
});
