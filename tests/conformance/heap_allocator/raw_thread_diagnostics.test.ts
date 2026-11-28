import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CLOSURE_CAPTURE_WORDS, CLOSURE_PROTOTYPE_ADDRESS } from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { CLOSURE_COUNT_SHIFT, CLOSURE_COUNT_WORD } from '../../../machine/ts/machine/cpu/closure';
import { THREAD_RECORD_KIND, ThreadField, ThreadStatus } from '../../../machine/ts/machine/cpu/thread_record';
import { UPVALUE_RECORD_KIND, UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD } from '../../../machine/ts/machine/cpu/upvalue';
import { ValueTag, valueBool, valueFloatBits, valueInteger, valuePayload, valueTag, valueThread } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { BuiltinFunctionId } from '../../../machine/ts/spec/blua32/builtin';
import { COP0_CONTEXT, COP0_EPC, CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../../machine/ts/spec/blua32/cop0';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../../machine/ts/spec/blua32/execution_domain';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, MAX_LOW_OPERAND, MAX_OPERAND_BITS, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { encodeFixedValueCount, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_FIXED_STACK_BASE, CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import type { ProgramConstant } from '../../../toolchain/ts/lua/compiler/program';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

test('Thread diagnostics use independent firmware RAM, not allocator ownership', t => {
	const owner = CPU_FIXED_STACK_BASE - 0x4000, frame = owner + 0x100, values = owner + 0x200;
	const closure = owner + 0x400, cell = owner + 0x500;
	const capacity = 32, slot = 29, input = 31, tags = values + 4 * capacity;
	const prior = valueInteger(-51), replacement = valueFloatBits(0x80000000), captured = valueFloatBits(0xffa12345);
	const code: [OpCode, number, number, number][] = [], constants: ProgramConstant[] = [];
	function emit(op: OpCode, a = 0, b = 0, c = 0) { code.push([op, a, b, c]); }
	function load(reg: number, value: ProgramConstant) {
		const index = constants.push(value) - 1;
		emit(OpCode.LOADK, reg, index >>> MAX_OPERAND_BITS, index & MAX_LOW_OPERAND);
		return index;
	}
	function int(reg: number, value: number) { return load(reg, integerConstant(value)); }
	function store(address: number, word: number, kind = MemoryAccessKind.Word) {
		const index = int(0, word);
		int(1, address);
		emit(OpCode.STORE_MEM, 0, 1, kind);
		return index;
	}
	for (const [field, word] of [
		[ThreadField.Header, THREAD_RECORD_KIND], [ThreadField.Status, ThreadStatus.Running],
		[ThreadField.StackTop, capacity], [ThreadField.StackBlock, values], [ThreadField.StackCapacity, capacity],
		[ThreadField.FrameDepth, 1], [ThreadField.FrameCapacity, 2], [ThreadField.FrameBlock, frame],
	]) store(owner + field, word);
	const pendingFunction = store(frame + FrameField.Function, 0);
	const pendingPc = store(frame + FrameField.Pc, 0);
	const pendingCallSite = store(frame + FrameField.CallSite, 0);
	store(frame + FrameField.StackCapacity, capacity);
	store(frame + FrameField.Closure, closure);
	store(closure, ValueTag.Closure);
	store(closure + CLOSURE_COUNT_WORD, 1 << CLOSURE_COUNT_SHIFT);
	const pendingPrototype = store(closure + CLOSURE_PROTOTYPE_ADDRESS, 0);
	store(closure + CLOSURE_CAPTURE_WORDS, cell);
	store(cell, UPVALUE_RECORD_KIND);
	store(cell + UPVALUE_VALUE_TAG, valueTag(captured), MemoryAccessKind.U8);
	store(cell + UPVALUE_VALUE_WORD, valuePayload(captured));
	store(values + 4 * slot, valuePayload(prior));
	store(tags + slot, valueTag(prior), MemoryAccessKind.U8);
	store(values + 4 * input, valuePayload(replacement));
	store(tags + input, valueTag(replacement), MemoryAccessKind.U8);
	int(0, owner);
	emit(OpCode.MTC0, 0, COP0_CONTEXT);
	emit(OpCode.RET, 0, encodeFixedValueCount(0));

	const body = code.length;
	function invoke(at: number, id: BuiltinFunctionId, args: number, results: number) {
		load(at, { kind: 'builtin', word: id });
		const issue = code.length - body;
		emit(OpCode.CALL, at, encodeFixedValueCount(args), encodeFixedValueCount(results));
		return issue;
	}
	invoke(0, BuiltinFunctionId.CoroutineRunning, 0, 2);
	emit(OpCode.MOV, 3, 0);
	invoke(2, BuiltinFunctionId.CoroutineStatus, 1, 1);
	emit(OpCode.MOV, 4, 0);
	invoke(3, BuiltinFunctionId.FrameCount, 1, 1);
	emit(OpCode.MOV, 5, 0);
	emit(OpCode.K0, 6);
	const header = invoke(4, BuiltinFunctionId.FrameHeader, 2, 6);
	emit(OpCode.MOV, 11, 0);
	emit(OpCode.K0, 12);
	int(13, slot);
	invoke(10, BuiltinFunctionId.GetFrameRegister, 3, 1);
	emit(OpCode.MOV, 12, 0);
	emit(OpCode.K0, 13);
	int(14, slot);
	emit(OpCode.MOV, 15, input);
	invoke(11, BuiltinFunctionId.SetFrameRegister, 4, 0);
	emit(OpCode.MOV, 12, 0);
	emit(OpCode.K0, 13);
	emit(OpCode.K0, 14);
	invoke(11, BuiltinFunctionId.GetFrameUpvalue, 3, 1);
	emit(OpCode.MOV, 12, slot);

	int(17, owner); // The same physical word with a non-Thread tag is not a Thread.
	const wrongTag = invoke(16, BuiltinFunctionId.FrameCount, 1, 0);
	emit(OpCode.MOV, 17, 0);
	emit(OpCode.K0, 18);
	int(19, capacity);
	const outside = invoke(16, BuiltinFunctionId.GetFrameRegister, 3, 0);
	emit(OpCode.RET, 0, encodeFixedValueCount(13));

	const exception = code.length;
	emit(OpCode.MFC0, 0, COP0_EPC);
	emit(OpCode.KSMI, 1, 0, INSTRUCTION_BYTES);
	emit(OpCode.ADD, 0, 0, 1);
	emit(OpCode.MTC0, 0, COP0_EPC);
	emit(OpCode.RFE);
	const text = new Uint8Array(code.length * INSTRUCTION_BYTES);
	for (const [index, op] of code.entries()) writeInstruction(text, index, ...op);
	const { image, romBytes } = linkRawTestSystemBlua32({ text, constants, verifiedControlFlow: true, exceptionFunctionIndex: 2, functions: [
		{ firstWord: 0, wordCount: body, maxStack: 2 },
		{ firstWord: body, wordCount: exception - body, maxStack: capacity, staticClosure: false, upvalueDescs: [{ inStack: true, index: 0 }] },
		{ firstWord: exception, wordCount: code.length - exception, maxStack: 2 },
	] });
	const [, receiver, vector] = image.functions;
	const constBase = image.header.constantTableAddress - SYSTEM_ROM_BASE + BLUA32_CONSTANT_PAYLOAD_OFFSET;
	for (const [index, value] of [[pendingFunction, receiver.address], [pendingPc, receiver.codeAddress],
		[pendingCallSite, receiver.codeAddress], [pendingPrototype, receiver.address]]) {
		writeLE32(romBytes, constBase + index * BLUA32_CONSTANT_RECORD_SIZE, value);
	}

	const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	const trace: string[] = [], rows: string[] = [], traps: number[] = [];
	let result = RunResult.Yielded;
	for (let grant = 0; grant < 1024 && result === RunResult.Yielded; ++grant) {
		result = scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled);
		trace.push('E 1');
		rows.push(`${result} ${1 - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		if (cpu.fixedInterruptActive() && cpu.activeThread.currentFrame!.pc === vector.codeAddress) {
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_TRAP);
			assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
			assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
			const pc = cpu.readEpcWord();
			traps.push(pc);
			trace.push('Z');
			rows.push(`${CPU_CAUSE_CODE_TRAP} ${LUA_FAULT_REASON_INVALID_ARGUMENT} ${pc}`);
		}
	}
	assert.deepEqual(traps, [wrongTag, outside].map(word => receiver.codeAddress + word * INSTRUCTION_BYTES));
	assert.equal(result, RunResult.Halted);
	assert.equal(cpu.captureRuntimeState().hardHalted, false);
	assert.equal(cpu.rootThread.address, owner);
	const expected = [valueThread(owner), valueBool(true), valueInteger(ThreadStatus.Running), valueInteger(1),
		valueInteger(receiver.address), valueInteger(receiver.codeAddress + (header + 1) * INSTRUCTION_BYTES),
		valueInteger(receiver.codeAddress), valueBool(false), valueInteger(SYSTEM_EXECUTION_DOMAIN_ID), valueBool(false),
		prior, captured, replacement];
	assert.deepEqual(runtime.readCompletionValues(), expected);
	trace.push('c');
	rows.push([expected.length, ...expected.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	const ram = memory.ramData(), allocator = nativeHeapReference(cpu).heapAllocator.allocatorStateOffset();
	assert.deepEqual(ram.subarray(allocator, allocator + 32), new Uint8Array(32), 'the stock allocator was never initialized');
	for (const [offset, length] of [[allocator, 32], [owner - RAM_BASE, cell + 16 - owner]]) {
		trace.push(`H ${offset} ${offset + length}`);
		rows.push(String(hashBytes(ram, offset, length)));
	}
	const dir = mkdtempSync(join(tmpdir(), 'bmsx-raw-thread-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const rom = join(dir, 'system.rom'), commands = join(dir, 'trace');
	writeFileSync(rom, romBytes);
	writeFileSync(commands, trace.join('\n'));
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	assert.deepEqual(execFileSync(native, [rom, commands, commands], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
});
