import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { type Value, ValueTag, valueFloatBits, valueFromTag, valueInteger, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { COP0_CONTEXT, CPU_CAUSE_CODE_REGISTER_WINDOW } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, BLUA32_FUNCTION_CODE, BLUA32_FUNCTION_FLAGS_OFFSET } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_IMAGE_FLAG } from '../../../machine/ts/spec/bmsx/heap_service';
import { CPU_FIXED_STACK_BASE, CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const word = INSTRUCTION_BYTES, owner = CPU_FIXED_STACK_BASE - 0x4000;
const control = owner + 0x100, oldBlock = owner + 0x200, newBlock = owner + 0x300, report = owner + 0x400;
const callerCapacity = 8, newCapacity = 32;
const returnWords = [17, 19, 21, 23, 25, 27, 29];
const returnValues = returnWords.map(valueInteger);
type OpcodeCase = 'CALL' | 'VARARG' | 'RET';
const args = [valueFloatBits(0xff812345), valueFromTag(ValueTag.Nil, 0x61feb09d)];
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

function assemble(operation: OpcodeCase) {
	const vararg = operation === 'VARARG', returning = operation === 'RET';
	const oldCapacity = returning ? 12 : callerCapacity;
	const ops: [OpCode, number, number, number][] = [], constants: number[] = [];
	const functions: { firstWord: number; wordCount: number; maxStack: number; numParams: number; isVararg: boolean }[] = [];
	const closures: { wordIndex: number; functionIndex: number }[] = [];
	let functionSlot = 0, pcSlot = 0, issue = 0, afterMove = 0;
	function add(op: OpCode, a = 0, b = 0, c = 0) { ops.push([op, a, b, c]); }
	function load(register: number, value: number) {
		const slot = constants.push(value) - 1;
		add(OpCode.LOADK, register, slot >>> 6, slot & 63);
	}
	function store(address: number, value: number, kind = MemoryAccessKind.Word) {
		load(2, value); load(3, address); add(OpCode.STORE_MEM, 2, 3, kind);
	}
	function functionBody(maxStack: number, body: () => void, numParams = 0, isVararg = false) {
		const firstWord = ops.length;
		body();
		functions.push({ firstWord, wordCount: ops.length - firstWord, maxStack, numParams, isVararg });
	}
	functionBody(8, () => {
		for (const [field, value] of [
			[ThreadField.StackTop, vararg ? 4 : callerCapacity],
			[ThreadField.StackBlock, oldBlock], [ThreadField.StackCapacity, oldCapacity],
			[ThreadField.FrameDepth, 1], [ThreadField.FrameCapacity, returning ? 4 : 2], [ThreadField.FrameBlock, control],
		] as const) store(owner + field, value);
		for (const [field, value] of [
			[FrameField.Protected, -1], [FrameField.Top, 0], [FrameField.StackBase, vararg ? 2 : 0],
			[FrameField.StackCapacity, vararg ? 2 : callerCapacity], [FrameField.ArgumentCount, vararg ? 2 : 0],
		] as const) store(control + field, value);
		functionSlot = constants.length; store(control + FrameField.Function, -1);
		pcSlot = constants.length; store(control + FrameField.Pc, -2);
		if (vararg) for (const [index, argument] of args.entries()) {
			store(oldBlock + word * index, valuePayload(argument));
			store(oldBlock + word * oldCapacity + index, valueTag(argument), MemoryAccessKind.U8);
		}
		load(0, owner); add(OpCode.MTC0, 0, COP0_CONTEXT);
		add(OpCode.RET, 0, 1);
	});
	functionBody(vararg ? 2 : callerCapacity, () => {
		if (!vararg) {
			add(OpCode.WIDE);
			closures.push({ wordIndex: ops.length, functionIndex: 3 });
			add(OpCode.CLOSURE, returning ? 2 : 3);
			if (!returning) load(4, 41);
		}
		if (returning) {
			add(OpCode.CALL, 2, 1, 0);
			add(OpCode.RET, 2, 0);
		} else {
			issue = ops.length - functions[0].wordCount;
			add(OpCode.WIDE);
			if (vararg) {
				add(OpCode.VARARG, 6, 3);
				add(OpCode.RET, 6, 3);
			} else {
				add(OpCode.CALL, 3, 2, 2);
				add(OpCode.RET, 3, 2);
			}
		}
	}, 0, vararg);
	functionBody(5, () => {
		for (let slot = 0; slot < 4; ++slot) {
			load(4, report + slot * word);
			add(OpCode.STORE_MEM, slot, 4, MemoryAccessKind.Word);
		}
		// Move every backing word and all the original tags; serving an
		// interrupted RET must keep the still-live callee's source window.
		function copy(from: number, to: number) {
			load(3, from); add(OpCode.LOAD_MEM, 2, 3, MemoryAccessKind.Word);
			load(3, to); add(OpCode.STORE_MEM, 2, 3, MemoryAccessKind.Word);
		}
		for (let offset = 0; offset < oldCapacity * word; offset += word) copy(oldBlock + offset, newBlock + offset);
		for (let offset = 0; offset < oldCapacity; offset += word)
			copy(oldBlock + word * oldCapacity + offset, newBlock + word * newCapacity + offset);
		store(owner + ThreadField.StackBlock, newBlock);
		afterMove = ops.length - functions[0].wordCount - functions[1].wordCount;
		store(owner + ThreadField.StackCapacity, newCapacity);
		if (operation === 'CALL') store(owner + ThreadField.FrameCapacity, 4);
		add(OpCode.RFE);
	});
	functionBody(returning ? returnWords.length : 16, () => {
		if (returning) {
			for (const [index, value] of returnWords.entries()) load(index, value);
			issue = returnWords.length;
			add(OpCode.WIDE);
			add(OpCode.RET, 0, returnWords.length + 1);
		} else {
			add(OpCode.ADD, 0, 0, 0);
			add(OpCode.RET, 0, 2);
		}
	}, returning ? 0 : 1);
	const text = new Uint8Array(ops.length * word);
	for (const [index, op] of ops.entries()) writeInstruction(text, index, ...op);
	const { image, romBytes } = linkRawTestSystemBlua32({ text, functions, constants: constants.map(integerConstant),
		closureRelocations: closures, exceptionFunctionIndex: 2, verifiedControlFlow: true });
	assert.equal(image.header.flags & HEAP_SERVICE_IMAGE_FLAG, 0);
	const [, caller, handler, child] = image.functions;
	for (const [slot, value] of [[functionSlot, caller.address], [pcSlot, caller.codeAddress]])
		writeLE32(romBytes, image.header.constantTableAddress + slot * BLUA32_CONSTANT_RECORD_SIZE + BLUA32_CONSTANT_PAYLOAD_OFFSET, value);
	writeLE32(romBytes, child.address - SYSTEM_ROM_BASE + BLUA32_FUNCTION_FLAGS_OFFSET, child.flags | BLUA32_FUNCTION_CODE);
	return { rom: romBytes, caller, child, oldCapacity, issuePc: (returning ? child.codeAddress : caller.codeAddress) + issue * word,
		handlerPc: handler.codeAddress, checkpointPc: handler.codeAddress + afterMove * word };
}

for (const operation of ['CALL', 'VARARG', 'RET'] as const) test(`bare System ROM grows backing and restarts a WIDE ${operation} exactly`, t => {
	const vararg = operation === 'VARARG', returning = operation === 'RET';
	const { rom, caller, child, oldCapacity, issuePc, handlerPc, checkpointPc } = assemble(operation);
	const boot = () => {
		const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		return runtime;
	};
	const runtime = boot(), { cpu, memory } = runtime.machine;
	const dir = mkdtempSync(join(tmpdir(), 'bmsx-window-restart-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const romPath = join(dir, 'system.rom'), trace = join(dir, 'trace'), tsState = join(dir, 'ts.state'), nativeState = join(dir, 'native.state');
	writeFileSync(romPath, rom);
	const operations: string[] = [], expected: string[] = [];
	function record(operation: string, row?: string | number) {
		operations.push(operation);
		if (row !== undefined) expected.push(String(row));
	}
	function replay() {
		writeFileSync(trace, operations.join('\n'));
		assert.deepEqual(execFileSync(native, [romPath, trace, tsState], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
	}
	function snapshot(rt: Runtime, address: number, length: number) {
		const offset = address - RAM_BASE;
		record(`H ${offset} ${offset + length}`, hashBytes(rt.machine.memory.ramData(), offset, length));
	}
	function step(rt = runtime, extra = 0, outcome = RunResult.Yielded) {
		const { cpu, scheduler, memory } = rt.machine;
		const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
		const { op } = decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, pc);
		record('P', `${depth} ${pc}`);
		assert.equal(scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled), outcome, `PC 0x${pc.toString(16)}`);
		const paid = 1 - cpu.instructionBudgetRemaining;
		assert.equal(paid, BASE_CYCLES[op] + extra, `PC 0x${pc.toString(16)}`);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.heapAllocator.occupiedBytes(), 0);
		assert.equal(cpu.luaHeap.usedBytes(), 0);
		record('E 1', `${outcome} ${paid} 0 ${memory.ramBusEnd()} -1`);
	}
	const issueDepth = returning ? 2 : 1, issuer = control + (issueDepth - 1) * FRAME_CONTROL_BYTES;
	for (let i = 0; i < 128 && cpu.readFramePc(cpu.getFrameDepth() - 1) !== issuePc; ++i) step();
	assert.equal(cpu.activeThread.address, owner);
	assert.equal(cpu.readFramePc(issueDepth - 1), issuePc);
	const valuesBefore = memory.ramData().slice(oldBlock - RAM_BASE, oldBlock - RAM_BASE + 5 * oldCapacity);
	const controlsBefore = memory.ramData().slice(control - RAM_BASE, control - RAM_BASE + issueDepth * FRAME_CONTROL_BYTES);
	const deadline = runtime.machine.scheduler.cyclesUntilDeadline();
	const { op, a } = decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, issuePc);
	const horizon = deadline === 0x7fff_ffff ? deadline : Math.max(0, deadline - BASE_CYCLES[op]);
	const operand = op | (a << 8);
	step();
	assert.equal(cpu.fixedInterruptActive(), true);
	assert.equal(cpu.readCauseWord(), 14 << 2);
	assert.equal(cpu.readEpcWord(), issuePc);
	assert.equal(cpu.readFramePc(0), handlerPc);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
	assert.equal(memory.readRamRecordWord(issuer + FrameField.Pc), issuePc);
	assert.equal(memory.readRamRecordWord(owner + ThreadField.FrameDepth), issueDepth);
	assert.deepEqual(memory.ramData().subarray(control - RAM_BASE, control - RAM_BASE + issueDepth * FRAME_CONTROL_BYTES), controlsBefore);
	assert.deepEqual(memory.ramData().subarray(oldBlock - RAM_BASE, oldBlock - RAM_BASE + 5 * oldCapacity), valuesBefore);
	snapshot(runtime, control, issueDepth * FRAME_CONTROL_BYTES);
	snapshot(runtime, oldBlock, 5 * oldCapacity);
	const values = vararg ? 10 : returning ? 16 : 20, frames = operation === 'CALL' ? 3 : 0;
	const entry = cpu.activeThread.currentFrame!;
	assert.equal(entry.argumentCount, 4);
	assert.equal(entry.top, 4);
	assert.equal(entry.registers.get(0), valueInteger(values));
	assert.equal(entry.registers.get(1), valueInteger(frames));
	assert.equal(entry.registers.get(2), valueInteger(operand));
	assert.equal(entry.registers.get(3), valueInteger(horizon));
	record('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} 0 ${issuePc}`);
	snapshot(runtime, RAM_BASE + entry.controlOffset, FRAME_CONTROL_BYTES);
	for (let i = 0; i < 96 && cpu.readFramePc(0) !== checkpointPc; ++i) step();
	assert.equal(cpu.readFramePc(0), checkpointPc);
	assert.equal(memory.readRamRecordWord(report), values);
	assert.equal(memory.readRamRecordWord(report + word), frames);
	assert.equal(memory.readRamRecordWord(report + 2 * word), operand);
	assert.equal(memory.readRamRecordWord(report + 3 * word), horizon);
	assert.equal(memory.readRamRecordWord(owner + ThreadField.StackBlock), newBlock);
	assert.equal(memory.readRamRecordWord(owner + ThreadField.StackCapacity), oldCapacity);
	snapshot(runtime, report, 4 * word);
	snapshot(runtime, newBlock, 5 * newCapacity);
	record(`x ${nativeState}`);
	writeFileSync(tsState, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	const commandCut = operations.length, rowCut = expected.length;

	function finish(rt: Runtime) {
		const { cpu, memory } = rt.machine;
		assert.equal(cpu.fixedInterruptActive(), true);
		assert.equal(cpu.readFramePc(0), checkpointPc);
		for (let i = 0; i < 8 && cpu.fixedInterruptActive(); ++i) step(rt);
		assert.equal(cpu.activeThread.address, owner);
		assert.equal(cpu.readFramePc(issueDepth - 1), issuePc);
		assert.equal(memory.readRamRecordWord(owner + ThreadField.StackCapacity), newCapacity);
		assert.equal(memory.readRamRecordWord(owner + ThreadField.FrameCapacity), vararg ? 2 : 4);
		snapshot(rt, owner, ThreadField.FrameBlock + word);
		step(rt, vararg ? 2 : returning ? returnWords.length : 0);
		const result = vararg ? args : returning ? returnValues : [valueInteger(82)];
		if (vararg) {
			assert.equal(cpu.readFramePc(0), issuePc + 2 * word);
			assert.equal(cpu.readFrameRegister(0, 6), args[0]);
			assert.equal(cpu.readFrameRegister(0, 7), args[1]);
		} else if (returning) {
			assert.equal(cpu.getFrameDepth(), 1);
			assert.equal(cpu.readFramePc(0), caller.codeAddress + 3 * word);
			assert.equal(cpu.readFrameRegister(0, 2), returnValues[0]);
			assert.equal(cpu.readFrameRegister(0, 8), returnValues[6]);
		} else {
			assert.equal(cpu.getFrameDepth(), 2);
			assert.equal(cpu.readFramePc(1), child.codeAddress);
			assert.equal(cpu.readFrameRegister(1, 0), valueInteger(41));
			step(rt); step(rt, 1);
			assert.equal(cpu.readFramePc(0), issuePc + 2 * word);
		}
		step(rt, result.length, RunResult.Halted);
		assert.deepEqual(rt.readCompletionValues(), result);
		record('c', [result.length, ...result.flatMap((value: Value) => [valueTag(value), valuePayload(value)])].join(' '));
	}
	finish(runtime);
	replay();
	const tail = operations.slice(commandCut), rows = expected.slice(rowCut);
	operations.splice(0, operations.length, 'X', ...tail);
	expected.splice(0, expected.length, ...rows);
	replay();
	const restored = boot();
	applyRuntimeSaveState(restored, decodeRuntimeSaveState(readFileSync(nativeState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	operations.length = expected.length = 0;
	finish(restored);
	assert.deepEqual(operations, tail);
	assert.deepEqual(expected, rows);
});
