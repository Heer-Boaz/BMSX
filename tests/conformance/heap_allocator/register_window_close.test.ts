import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField, FRAME_WINDOW_MASK } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_COLOR_MASK, GC_COLOR_OFFSET, GC_GRAY_INDEX_MASK, GC_RECORD_MASK, GC_RECORD_SHIFT } from '../../../machine/ts/machine/cpu/gc_object';
import * as cell from '../../../machine/ts/machine/cpu/upvalue';
import { ValueTag, valueInteger, valuePayload, valueTag, type Value } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_REGISTER_WINDOW } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, instructionBranchTarget, instructionBx, instructionOpcode, readInstructionWord } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const source = `
function exercise(seed)
	local low = { seed }
	local keep = function() return low end
	local scoped
	while seed ~= 0 do
		local high = { seed + 1 }
		scoped = function() return high end
		halt_until_irq
		if seed < 50 then break end
		seed = seed - 100
	end
	halt_until_irq
	return keep, scoped
end
local keep, scoped = exercise(41)
return keep()[1], scoped()[1]
`;
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

for (const optLevel of [0, 3] as const) test(`ordinary JMP and RET retire only their own captures through firmware (O${optLevel})`, t => {
	const linked = linkManagedTestSystem(source, optLevel);
	const rom = writeTestBlua32Rom(linked), dir = mkdtempSync(join(tmpdir(), 'bmsx-window-close-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const romPath = join(dir, 'system.rom'), tracePath = join(dir, 'trace');
	const tsState = join(dir, 'ts.state'), cppState = join(dir, 'cpp.state');
	writeFileSync(romPath, rom);
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	const commands: string[] = [], rows: string[] = [];
	function grant(cycles: number) {
		const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
		commands.push(`E ${cycles}`);
		rows.push(`${result} ${cycles - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		return result;
	}
	function resume() {
		cpu.clearHaltUntilIrq();
		commands.push('h');
	}
	function hash(first: number, bytes: number) {
		commands.push(`H ${first} ${first + bytes}`);
		rows.push(String(hashBytes(memory.ramData(), first, bytes)));
	}
	for (let i = 0; !cpu.isHaltedUntilIrq() && i < 2048; ++i) grant(1024);
	assert.ok(cpu.isHaltedUntilIrq());
	const owner = cpu.activeThread.address, frame = cpu.activeThread.currentFrame!;
	const frameHead = frame.controlOffset + FrameField.OpenHead;
	const high = frame.openUpvalueHead & GC_RECORD_MASK;
	const low = memory.readRamRecordWord(high + cell.UPVALUE_NEXT) & GC_RECORD_MASK;
	assert.ok(cell.isOpen(memory, high) && cell.isOpen(memory, low));
	assert.equal(memory.readRamRecordWord(low + cell.UPVALUE_NEXT), 0);
	const highSlot = memory.readRamRecordWord(high + cell.UPVALUE_VALUE_WORD);
	const lowSlot = memory.readRamRecordWord(low + cell.UPVALUE_VALUE_WORD);
	const highValue = cell.load(memory, high), lowValue = cell.load(memory, low);
	assert.equal(valueTag(highValue), ValueTag.Table);
	assert.equal(valueTag(lowValue), ValueTag.Table);
	assert.ok(highSlot > lowSlot && lowSlot > 0);
	const changed = cpu.gc.changedHeadOffset(), prior = memory.readRamRecordWord(changed) & GC_GRAY_INDEX_MASK;
	// Model two already-scanned open cells, without invoking a host collector.
	for (const address of [high, low]) {
		const word = (memory.readRamRecordWord(address) & ~(GC_COLOR_MASK << (8 * GC_COLOR_OFFSET))) | (3 << (8 * GC_COLOR_OFFSET));
		memory.writeRamRecordWord(address, word);
		commands.push(`W ${address} ${word >>> 0}`);
	}
	function closed(address: number, value: Value, previous: number) {
		assert.equal(cell.isOpen(memory, address), false);
		assert.equal(memory.readRamRecordWord(address + cell.UPVALUE_OWNER), 0);
		assert.equal(memory.readRamRecordByte(address + cell.UPVALUE_VALUE_TAG), valueTag(value));
		assert.equal(memory.readRamRecordWord(address + cell.UPVALUE_VALUE_WORD), valuePayload(value));
		assert.equal(memory.readRamRecordByte(address + GC_COLOR_OFFSET), 2);
		assert.equal(memory.readRamRecordWord(address + cell.UPVALUE_NEXT), previous);
		hash(address, cell.UPVALUE_HEAP_BYTES);
	}
	function vector(op: OpCode) {
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_REGISTER_WINDOW);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
		const { registers } = cpu.activeThread.currentFrame!;
		assert.deepEqual([registers.get(0), registers.get(1)], [valueInteger(0), valueInteger(0)]);
		const instruction = valuePayload(registers.get(2));
		assert.equal(instruction & 0xff, op);
		const pc = cpu.readEpcWord();
		const word = readInstructionWord(linked.layout.textBytes, (pc - linked.layout.header.textAddress) / INSTRUCTION_BYTES);
		assert.equal(instructionOpcode(word), op);
		commands.push('Z');
		rows.push(`${cpu.readCauseWord()} ${cpu.readLuaFaultReasonWord()} ${pc}`);
		return { pc, word, operand: instruction >>> 8 };
	}

	resume();
	for (let i = 0; !cpu.fixedInterruptActive() && i < 256; ++i) grant(1);
	const branch = vector(OpCode.JMP);
	const threshold = (memory.readRamRecordWord(frame.controlOffset + FrameField.StackBase) & FRAME_WINDOW_MASK) + branch.operand - 1;
	assert.ok(lowSlot < threshold && threshold <= highSlot);
	const target = instructionBranchTarget(branch.pc, 1, instructionBx(branch.word, 0));
	assert.notEqual(target, branch.pc + INSTRUCTION_BYTES, 'the scope exit is a taken branch, not fallthrough');
	assert.equal(memory.readRamRecordWord(frame.controlOffset + FrameField.Pc), target);
	for (let i = 0; cell.isOpen(memory, high) && i < 4096; ++i) grant(1);
	assert.ok(cpu.fixedInterruptActive() && !cell.isOpen(memory, high));
	assert.equal(memory.readRamRecordWord(high + cell.UPVALUE_VALUE_WORD), highSlot, 'suspended before copying the closed Value word');
	assert.equal(memory.readRamRecordWord(frameHead) & GC_RECORD_MASK, high, 'the open-cell head has not been published');
	assert.equal(memory.readRamRecordWord(changed) & GC_GRAY_INDEX_MASK, prior);
	writeFileSync(tsState, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	commands.push(`x ${cppState}`);
	const commandCut = commands.length, rowCut = rows.length;

	function finish() {
		for (let i = 0; cpu.fixedInterruptActive() && i < 4096; ++i) grant(1);
		assert.equal(cpu.fixedInterruptActive(), false);
		assert.equal(cpu.activeThread.currentFrame!.pc, target);
		for (let i = 0; !cpu.isHaltedUntilIrq() && i < 256; ++i) grant(1);
		assert.ok(cpu.isHaltedUntilIrq(), 'JMP left a lower open capture without re-entering the exception');
		closed(high, highValue, prior);
		assert.ok(cell.isOpen(memory, low));
		assert.equal(cell.load(memory, low), lowValue);
		assert.equal(memory.readRamRecordWord(frameHead) & GC_RECORD_MASK, low);
		assert.equal(memory.readRamRecordWord(changed), high >>> GC_RECORD_SHIFT);
		hash(frameHead, 4);
		hash(low, cell.UPVALUE_HEAP_BYTES);
		hash(changed, 4);

		resume();
		for (let i = 0; !cpu.fixedInterruptActive() && i < 256; ++i) grant(1);
		const ret = vector(OpCode.RET);
		assert.equal(memory.readRamRecordWord(frame.controlOffset + FrameField.Pc), ret.pc);
		for (let i = 0; cpu.fixedInterruptActive() && i < 4096; ++i) grant(1);
		assert.equal(cpu.fixedInterruptActive(), false);
		assert.equal(cpu.activeThread.currentFrame!.pc, ret.pc, 'RET still owes the ordinary result transfer');
		assert.equal(memory.readRamRecordWord(frameHead), 0);
		closed(low, lowValue, high >>> GC_RECORD_SHIFT);
		assert.equal(memory.readRamRecordWord(changed), low >>> GC_RECORD_SHIFT);
		hash(frameHead, 4);
		hash(changed, 4);
		let result = RunResult.Yielded;
		for (let i = 0; result !== RunResult.Halted && i < 128; ++i) result = grant(128);
		assert.equal(result, RunResult.Halted);
		assert.equal(cpu.captureRuntimeState().hardHalted, false);
		const values = runtime.readCompletionValues();
		assert.deepEqual(values, [valueInteger(41), valueInteger(42)]);
		commands.push('c');
		rows.push([values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	}
	finish();
	function replay(trace: readonly string[], expected: readonly string[]) {
		writeFileSync(tracePath, trace.join('\n'));
		assert.deepEqual(execFileSync(native, [romPath, tracePath, tsState], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
	}
	replay(commands, rows);
	const tail = commands.slice(commandCut), expected = rows.slice(rowCut);
	replay(['X', ...tail], expected);
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(cppState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	commands.length = rows.length = 0;
	finish();
	assert.deepEqual(commands, tail);
	assert.deepEqual(rows, expected);
});
