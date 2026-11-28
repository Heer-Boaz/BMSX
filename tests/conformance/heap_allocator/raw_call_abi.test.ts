import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CLOSURE_CAPTURE_WORDS, CLOSURE_COUNT_SHIFT, CLOSURE_COUNT_WORD, CLOSURE_PROTOTYPE_ADDRESS } from '../../../machine/ts/machine/cpu/closure';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ThreadField, ThreadStatus } from '../../../machine/ts/machine/cpu/thread_record';
import { UPVALUE_RECORD_KIND, UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD } from '../../../machine/ts/machine/cpu/upvalue';
import { valueInteger, valueNil, valuePayload, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { COP0_CONTEXT } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode, BASE_CYCLES } from '../../../machine/ts/spec/blua32/opcode';
import { GC_ROOT_BANKS_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../helpers/firmware_heap_layout';
import { CPU_FIXED_STACK_BASE, CPU_RESET_BANK_ADDRESS, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

const nil = valueNil(), payload = valueInteger(707);
const cases = [
	{ name: 'fixed CALL counts arguments beyond fixed formals', supplied: 5, formals: 1, suffix: false, skip: 0, returned: 2, wanted: 0, result: [valueInteger(4)], placementCycles: 0 },
	{ name: 'open CALL counts explicit nils without counting padded formals', supplied: 0, formals: 6, suffix: false, skip: 0, returned: 2, wanted: 0, result: [valueInteger(4)], placementCycles: 2 },
	{ name: 'open suffix starts after the selected extra', supplied: 5, formals: 1, suffix: true, skip: 1, returned: 0, wanted: 0, result: [payload, nil], placementCycles: 1 },
	{ name: 'fixed suffix clips produced values', supplied: 0, formals: 1, suffix: true, skip: 1, returned: 2, wanted: 0, result: [payload], placementCycles: 1 },
	{ name: 'fixed suffix does not add padding to its produced values', supplied: 5, formals: 1, suffix: true, skip: 1, returned: 6, wanted: 0, result: [payload, nil], placementCycles: 1 },
	{ name: 'fixed receiving CALL still pads the suffix to its requested result count', supplied: 5, formals: 1, suffix: true, skip: 1, returned: 2, wanted: 4, result: [payload, nil, nil], placementCycles: 1 },
	{ name: 'unsigned suffix offset beyond its window produces nothing', supplied: 5, formals: 1, suffix: true, skip: -1, returned: 0, wanted: 0, result: [], placementCycles: 1 },
] as const;

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');

for (const scenario of cases) test(scenario.name + ' in a bare System ROM', t => {
	const { supplied, formals, suffix, skip, returned, wanted, result, placementCycles } = scenario;
	const text = new Uint8Array((suffix ? 11 : 10) * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.LOADK, 0, 0, 0);
	writeInstruction(text, 2, OpCode.KSMI, 1, 1, 35); // 99
	writeInstruction(text, 3, OpCode.KNIL, 2, 0, 0);
	writeInstruction(text, 4, OpCode.KSMI, 3, 11, 3); // 707
	writeInstruction(text, 5, OpCode.KNIL, 4, 0, 0);
	writeInstruction(text, 6, OpCode.CALL, 0, supplied, wanted);
	writeInstruction(text, 7, OpCode.RET, 0, 0, 0);
	writeInstruction(text, 8, OpCode.ARGC, 1, 0, 0);
	if (suffix) writeInstruction(text, 9, OpCode.KSMI, 0, skip >>> 6 & 63, skip & 63, skip >>> 12 & 255);
	writeInstruction(text, suffix ? 10 : 9, OpCode.RET, suffix ? 0 : 1, returned, +suffix);
	const image = linkRawTestSystemBlua32({
		text, verifiedControlFlow: true, constants: [integerConstant(0)],
		constValueRelocs: [{ constIndex: 0, kind: 'code_function', target: { kind: 'proto', protoIndex: 1 } }],
		functions: [{ firstWord: 0, wordCount: 8, maxStack: 6 }, {
			firstWord: 8, wordCount: suffix ? 3 : 2, maxStack: 6, numParams: formals, isVararg: suffix,
		}],
	});
	const caller = image.image.functions[0], callee = image.image.functions[1], rom = image.romBytes;
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	const { cpu, memory, scheduler } = runtime.machine;
	const management = nativeHeapReference(cpu).heapAllocator.managementOffset(), first = management + HEAP_STRING_METADATA_OFFSET, end = management + GC_ROOT_BANKS_OFFSET;
	const empty = new Uint8Array(end - first);
	runtime.boot();
	const commands: string[] = [], expected: string[] = [];
	function step(op: OpCode, pc: number, depth: number, extra = 0) {
		assert.equal(cpu.getFrameDepth(), depth);
		assert.equal(cpu.readFramePc(depth - 1), pc);
		commands.push('P');
		expected.push(`${depth} ${pc}`);
		const run = scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled);
		const cycles = BASE_CYCLES[op] + extra;
		assert.equal(run, depth === 1 && op === OpCode.RET ? RunResult.Halted : RunResult.Yielded);
		assert.equal(1 - cpu.instructionBudgetRemaining, cycles, `op=${op} pc=${pc.toString(16)} run=${run} cause=${cpu.readCauseWord()} next=${cpu.activeThread.currentFrame?.pc}`);
		assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		assert.equal(nativeHeapReference(cpu).heapAllocator.occupiedBytes(), 0);
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), 0);
		commands.push('E 1');
		expected.push(`${run} ${cycles} ${memory.ramBusEnd()} -1`);
	}
	const word = INSTRUCTION_BYTES;
	for (const [index, op] of [OpCode.LOADK, OpCode.KSMI, OpCode.KNIL, OpCode.KSMI, OpCode.KNIL, OpCode.CALL].entries())
		step(op, caller.codeAddress + (index === 0 ? 0 : index + 1) * word, 1, op === OpCode.CALL ? placementCycles : 0);
	const frame = cpu.activeThread.currentFrame!;
	assert.equal(frame.argumentCount, 4);
	assert.equal(frame.varargCount, suffix ? 3 : 0);
	step(OpCode.ARGC, callee.codeAddress, 2);
	assert.equal(frame.registers.get(1), valueInteger(4));
	if (suffix) step(OpCode.KSMI, callee.codeAddress + word, 2);
	step(OpCode.RET, callee.codeAddress + (suffix ? 2 : 1) * word, 2, result.length);
	step(OpCode.RET, caller.codeAddress + 7 * word, 1, result.length);
	assert.equal(cpu.getFrameDepth(), 0);
	assert.equal(cpu.readLuaFaultReasonWord(), 0);
	assert.deepEqual(runtime.readCompletionValues(), result);
	assert.deepEqual(memory.ramData().subarray(first, end), empty);
	commands.push('c', `H ${first} ${end}`);
	expected.push([result.length, ...result.flatMap(v => [valueTag(v), valuePayload(v)])].join(' '), String(hashBytes(empty, 0, empty.length)));
	const temp = mkdtempSync(join(tmpdir(), 'raw-call-abi-'));
	t.after(() => rmSync(temp, { recursive: true, force: true }));
	const nativeRom = join(temp, 'system.rom'), trace = join(temp, 'trace');
	writeFileSync(nativeRom, rom);
	writeFileSync(trace, commands.join('\n'));
	assert.deepEqual(execFileSync(native, [nativeRom, trace, join(temp, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
});

test('bare System ROM enters closures from its own private arena, including a captured value', t => {
	// This ROM uses fixed slices of a page it owns. No dlmalloc header or
	// collector metadata is needed to describe these two call targets.
	const context = CPU_FIXED_STACK_BASE - 0x1000, frames = context + 0x100, values = context + 0x200;
	const plain = context + 0x300, captured = plain + 0x10, cell = captured + 0x10;
	const slots = 16, window = 8, repetitions = 96, warmVisits = 80;
	const capturedValue = -0x12345678;
	const constants: number[] = [];
	const instructions: [OpCode, number, number, number, number?][] = [];
	const bindingLanes: { slot: number; fn: number; code: boolean }[] = [];
	function load(register: number, value: number) {
		const index = constants.length;
		constants.push(value);
		instructions.push([OpCode.LOADK, register, index >>> 6, index & 63]);
	}
	function store(address: number, value: number, kind = MemoryAccessKind.Word) {
		load(0, value); load(1, address);
		instructions.push([OpCode.STORE_MEM, 0, 1, kind]);
	}
	function bind(address: number, fn: number, code = false) {
		bindingLanes.push({ slot: constants.length, fn, code });
		store(address, -1 - constants.length);
	}
	store(context + ThreadField.Status, ThreadStatus.Running);
	store(context + ThreadField.StackTop, window);
	store(context + ThreadField.StackBlock, values);
	store(context + ThreadField.StackCapacity, slots);
	store(context + ThreadField.FrameCapacity, 4);
	store(context + ThreadField.FrameDepth, 1);
	store(context + ThreadField.FrameBlock, frames);
	bind(frames + FrameField.Function, 1);
	bind(frames + FrameField.Pc, 1, true);
	store(frames + FrameField.Top, 7);
	store(frames + FrameField.StackCapacity, window);
	store(values, plain);
	store(values + 6 * 4, captured);
	store(values + 4 * slots, ValueTag.Closure, MemoryAccessKind.U8);
	store(values + 4 * slots + 6, ValueTag.Closure, MemoryAccessKind.U8);
	store(plain, ValueTag.Closure);
	bind(plain + CLOSURE_PROTOTYPE_ADDRESS, 2);
	// This firmware uses the non-architectural record bits for its own data.
	// Neither scalar CALL/GETUP nor the warmed native edge interprets them.
	const privateHeader = ValueTag.Closure | (0xb9 << 8) | (0xf0 << 16);
	const privateCountWord = (1 << CLOSURE_COUNT_SHIFT) | 0x5d431;
	store(captured, privateHeader);
	store(captured + CLOSURE_COUNT_WORD, privateCountWord);
	bind(captured + CLOSURE_PROTOTYPE_ADDRESS, 3);
	store(captured + CLOSURE_CAPTURE_WORDS, cell);
	store(cell, UPVALUE_RECORD_KIND | (ValueTag.Integer << (UPVALUE_VALUE_TAG * 8)));
	store(cell + UPVALUE_VALUE_WORD, capturedValue);
	load(0, context);
	instructions.push([OpCode.MTC0, 0, COP0_CONTEXT, 0], [OpCode.RET, 0, 1, 0]);
	const caller = instructions.length;
	instructions.push([OpCode.CALL, 0, 1, 2], [OpCode.KSMI, 4, repetitions >>> 6, repetitions & 63], [OpCode.K1, 5, 0, 0], [OpCode.K0, 7, 0, 0]);
	// Warm the same guest CALL edge without any host completion-call inputs.
	instructions.push([OpCode.MOV, 2, 6, 0], [OpCode.CALL, 2, 1, 2], [OpCode.SUB, 4, 4, 5],
		[OpCode.EQ, 0, 4, 7], [OpCode.JMP, 0, 63, 59, 255]); // repeat while R4 != 0; displacement -5
	instructions.push([OpCode.MOV, 1, 2, 0], [OpCode.RET, 0, 3, 0]);
	const plainBody = instructions.length;
	instructions.push([OpCode.KSMI, 0, 0, 37], [OpCode.RET, 0, 2, 0]);
	instructions.push([OpCode.GETUP, 0, 0, 0], [OpCode.RET, 0, 2, 0]);
	const text = new Uint8Array(instructions.length * INSTRUCTION_BYTES);
	for (const [index, op] of instructions.entries()) writeInstruction(text, index, ...op);
	const linked = linkRawTestSystemBlua32({ text, constants: constants.map(integerConstant), verifiedControlFlow: true,
		functions: [
			{ firstWord: 0, wordCount: caller, maxStack: 2 },
			{ firstWord: caller, wordCount: plainBody - caller, maxStack: window },
			{ firstWord: plainBody, wordCount: 2, maxStack: 1 },
			{ firstWord: plainBody + 2, wordCount: 2, maxStack: 1, staticClosure: false, upvalueDescs: [{ inStack: true, index: 0 }] },
		],
	});
	const rom = linked.romBytes;
	for (const { slot, fn, code } of bindingLanes) {
		const entry = linked.image.functions[fn];
		writeLE32(rom, linked.image.header.constantTableAddress - SYSTEM_ROM_BASE
			+ BLUA32_CONSTANT_RECORD_SIZE * slot + BLUA32_CONSTANT_PAYLOAD_OFFSET, code ? entry.codeAddress : entry.address);
	}
	function exercise(cpuExecutionBackend: CpuExecutionBackend) {
		const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC, cpuExecutionBackend }, input);
		const { cpu, memory, scheduler } = runtime.machine;
		const management = nativeHeapReference(cpu).heapAllocator.managementOffset();
		const first = management + HEAP_STRING_METADATA_OFFSET, end = management + GC_ROOT_BANKS_OFFSET;
		const empty = new Uint8Array(end - first);
		assert.deepEqual(memory.ramData().subarray(first, end), empty);
		runtime.boot();
		const commands: string[] = [], rows: string[] = [];
		let result = RunResult.Yielded, plainVisits = 0, capturedVisits = 0;
		for (let n = 0; result === RunResult.Yielded && n < instructions.length + repetitions * 7; ++n) {
			const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
			if (depth === 2 && pc === linked.image.functions[2].codeAddress) ++plainVisits;
			const enteredCapture = depth === 2 && pc === linked.image.functions[3].codeAddress;
			if (enteredCapture) ++capturedVisits;
			// The final grant leaves the compiled CALL and its target room to
			// execute together, instead of always stopping at the transfer.
			const grant = enteredCapture && capturedVisits === warmVisits ? 2048 : 1;
			commands.push('P', `E ${grant}`);
			result = scheduler.runCpuSlice(0, grant, undefined, CpuRunKind.Scheduled);
			rows.push(`${depth} ${pc}`, `${result} ${grant - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} -1`);
		}
		assert.equal(result, RunResult.Halted);
		assert.equal(cpu.rootThread.address, context);
		assert.equal(cpu.readCauseWord(), 0);
		assert.equal(plainVisits, 1);
		assert.equal(capturedVisits, warmVisits);
		assert.equal(memory.readRamRecordWord(captured), privateHeader);
		assert.equal(memory.readRamRecordWord(captured + CLOSURE_COUNT_WORD), privateCountWord);
		const output = [valueInteger(37), valueInteger(capturedValue)];
		assert.deepEqual(runtime.readCompletionValues(), output);
		assert.deepEqual(memory.ramData().subarray(first, end), empty);
		const recordOffset = captured - RAM_BASE;
		commands.push('c', `H ${first} ${end}`, `H ${recordOffset} ${recordOffset + 8}`);
		rows.push([output.length, ...output.flatMap(v => [valueTag(v), valuePayload(v)])].join(' '), String(hashBytes(empty, 0, empty.length)),
			String(hashBytes(memory.ramData(), recordOffset, 8)));
		return { commands, rows };
	}
	const interpreter = exercise(CpuExecutionBackend.Interpreter);
	assert.deepEqual(exercise(CpuExecutionBackend.JavaScript), interpreter);
	const temp = mkdtempSync(join(tmpdir(), 'raw-closure-abi-'));
	t.after(() => rmSync(temp, { recursive: true, force: true }));
	const nativeRom = join(temp, 'system.rom'), trace = join(temp, 'trace');
	writeFileSync(nativeRom, rom);
	writeFileSync(trace, interpreter.commands.join('\n'));
	assert.deepEqual(execFileSync(native, [nativeRom, trace, join(temp, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n'), interpreter.rows);
});
