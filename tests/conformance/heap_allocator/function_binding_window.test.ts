import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CLOSURE_BINDING_FLAGS, CLOSURE_LATCHED_PROTOTYPE, closureRecordBytes } from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { isOpen } from '../../../machine/ts/machine/cpu/upvalue';
import { ValueTag, valueBool, valueInteger, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { MAPPED_BUS_MASTER_CPU, mappedBusSignalsForCartridgeSlot } from '../../../machine/ts/machine/memory/bus_signals';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { COP0_EPC, CPU_CAUSE_CODE_FUNCTION_BINDING } from '../../../machine/ts/spec/blua32/cop0';
import {
	BLUA32_FUNCTION_ALIGNMENT, BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_MAX_STACK_OFFSET,
	BLUA32_FUNCTION_NUM_PARAMS_OFFSET, BLUA32_FUNCTION_RECORD_SIZE, BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET,
} from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { IO_RETAINED_WORD_BASE } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, CPU_INTERRUPTED_CONTEXT_ADDRESS, DYNAMIC_RAM_BASE, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { linkCartBlua32Image, rewriteResolvedABx } from '../../../toolchain/ts/rompack/blua32_linker';
import { linkRawTestSystemBlua32, writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { MANAGED_CART_LAUNCH } from '../../helpers/managed_cart_launch';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');

for (const [opt, mmio] of [[0, false], [3, true]] as const) test(`captured CLOSURE samples a mutable prototype and each ${mmio ? 'cartridge MMIO' : 'System RAM'} descriptor once at O${opt}`, t => {
	const source = `
bss raw_record: word[64]
local function make(a, b)
	halt_until_irq
	return function() return a * 100 + b end
end
return make(7, 8)()
`;
	const system = linkManagedTestSystem(mmio ? MANAGED_CART_LAUNCH : source, opt);
	const rom = writeTestBlua32Rom(system);
	const cart = mmio ? (() => {
		const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'closure-binding-cart.lua'), [], { entrySource: source, optLevel: opt });
		return linkCartBlua32Image(system.biosImports, encodeCompiledProgramObject(compiled), compiled.metadata,
			CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
	})() : null;
	const media = cart === null ? rom : writeTestBlua32Rom(cart);
	const layout = (cart ?? system).layout, base = cart === null ? SYSTEM_ROM_BASE : CART_ROM_BASE;
	const domain = cart === null ? -1 : 0;
	const target = layout.functions.find(fn => fn.upvalues.length === 2)!;
	assert.ok(target);
	const alignment = BLUA32_FUNCTION_ALIGNMENT - 1;
	const prototype = (layout.header.bssAddress + alignment) & ~alignment;
	const code = prototype + 128, descriptor = mmio ? IO_RETAINED_WORD_BASE : prototype + 64;
	let instruction = 0;
	for (let pc = layout.header.textAddress; pc < layout.header.textAddress + layout.textBytes.length;) {
		const op = decodeBlua32InstructionAtPc(media, base, pc);
		if (op.op === OpCode.CLOSURE && op.bx * BLUA32_FUNCTION_ALIGNMENT === target.address) {
			instruction = op.pc;
			assert.equal(instruction, pc + INSTRUCTION_BYTES);
			break;
		}
		pc = op.pc + INSTRUCTION_BYTES;
	}
	assert.notEqual(instruction, 0);
	rewriteResolvedABx(media, (instruction - base) / INSTRUCTION_BYTES,
		OpCode.CLOSURE, prototype / BLUA32_FUNCTION_ALIGNMENT);
	const words = [code, target.numParams, target.maxStack, target.flags, descriptor, target.upvalues.length];
	const fields = [BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_NUM_PARAMS_OFFSET, BLUA32_FUNCTION_MAX_STACK_OFFSET,
		BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET, BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET];
	const descriptors = target.upvalues.map((_, i) => readLE32(media, target.upvalueTableAddress - base + 4 * i));
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(cart === null ? null : media), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	runGuestToHalt(cpu, 4_194_304);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	cpu.clearHaltUntilIrq();
	const thread = cpu.activeThread, owner = thread.address, depth = thread.frameDepth;
	let frame = thread.currentFrame!;
	const decode = () => decodeBlua32InstructionAtPc(media, base, frame.pc);
	for (let step = 0; decode().pc !== instruction && step < 16; ++step)
		assert.equal(scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
	const issue = frame.pc, op = decode(), successor = instruction + INSTRUCTION_BYTES;
	assert.equal(op.op, OpCode.CLOSURE);
	assert.equal(op.pc, instruction);
	const original = frame.registers.get(op.a), top = frame.top, open = frame.openUpvalueHead;
	for (let offset = 0; offset < BLUA32_FUNCTION_RECORD_SIZE; offset += 4)
		memory.writeMappedWord(prototype + offset, readLE32(media, target.address - base + offset));
	for (const [index, offset] of fields.entries()) memory.writeMappedWord(prototype + offset, words[index]);
	assert.ok(code + target.codeByteCount <= layout.header.bssAddress + layout.header.bssByteCount);
	for (let offset = 0; offset < target.codeByteCount; offset += 4)
		memory.writeMappedWord(code + offset, readLE32(media, target.codeAddress - base + offset));
	for (const [index, value] of descriptors.entries()) memory.writeMappedWord(descriptor + 4 * index, value);
	const reads: number[] = [], signals: number[] = [];
	const read = memory.readMappedBusU32LE.bind(memory);
	t.mock.method(memory, 'readMappedBusU32LE', (...args: Parameters<typeof read>) => {
		if (args[0] === descriptor || args[0] === descriptor + 4) {
			reads.push(args[0]);
			signals.push(args[1]);
		}
		return read(...args);
	});
	const dir = mkdtempSync(join(tmpdir(), 'function-binding-window-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const romPath = join(dir, 'system.rom'), trace = join(dir, 'trace');
	const seed = join(dir, 'seed'), tsMid = join(dir, 'ts-mid'), cppMid = join(dir, 'cpp-mid');
	const cartPath = join(dir, 'program.rom');
	if (cart !== null) writeFileSync(cartPath, media);
	writeFileSync(romPath, rom);
	writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	const commands: string[] = ['X'], rows: string[] = [];
	if (mmio) commands.push(...descriptors.map((word, i) => `O ${descriptor + 4 * i} ${word}`));
	function observe(command: string, row?: string) {
		commands.push(command);
		if (row !== undefined) rows.push(row);
	}
	function grant(cycles: number) {
		const outcome = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		observe(`E ${cycles}`, `${outcome} ${cycles - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		return outcome;
	}
	function write(address: number, word: number) {
		memory.writeMappedWord(address, word);
		observe(`O ${address} ${word}`);
	}
	const physical = cpu.heapAllocator.occupiedBytes(), logical = cpu.luaHeap.usedBytes(), faults = memory.readBusFaultSequence();
	assert.equal(grant(1), RunResult.Yielded);
	assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[OpCode.CLOSURE]);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_FUNCTION_BINDING);
	assert.equal(cpu.readEpcWord(), issue);
	assert.equal(cpu.fixedInterruptActive(), true);
	assert.equal(cpu.heapServiceActive(), false);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
	assert.equal(cpu.readThreadFrameWord(owner, depth - 1, FrameField.Pc), successor);
	assert.equal(frame.registers.get(op.a), original);
	assert.equal(frame.top, top);
	const packet = cpu.activeThread.currentFrame!;
	assert.equal(packet.argumentCount, 11);
	assert.deepEqual(Array.from({ length: 10 }, (_, index) => packet.registers.get(index)),
		[op.a, prototype, domain, ...words, 0].map(valueInteger));
	assert.equal(valueTag(packet.registers.get(10)), ValueTag.Integer);
	assert.deepEqual(reads, []);
	observe('Z', `${CPU_CAUSE_CODE_FUNCTION_BINDING} 0 ${issue}`);
	for (const offset of fields) write(prototype + offset, 0xffffffff);
	function sample(index: number) {
		for (let step = 0; reads.length === index && step < 4096; ++step) assert.equal(grant(1), RunResult.Yielded);
		assert.equal(reads.length, index + 1);
		assert.equal(reads[index], descriptor + 4 * index);
		assert.equal(signals[index], domain < 0 ? MAPPED_BUS_MASTER_CPU : mappedBusSignalsForCartridgeSlot(domain));
		assert.equal(frame.openUpvalueHead, open, 'no cell installed while the descriptor is being sampled');
		assert.equal(frame.registers.get(op.a), original);
		assert.equal(cpu.heapAllocator.occupiedBytes(), physical);
		assert.equal(cpu.luaHeap.usedBytes(), logical);
		write(descriptor + 4 * index, 0xffffffff);
	}
	sample(0);
	writeFileSync(tsMid, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	observe(`x ${cppMid}`); observe('l'); observe('s');
	const cut = commands.length, rowCut = rows.length;
	function complete() {
		sample(1);
		for (let step = 0; cpu.fixedInterruptActive() && step < 8192; ++step) assert.equal(grant(1), RunResult.Yielded);
		assert.equal(cpu.fixedInterruptActive(), false);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.activeThread.address, owner);
		assert.equal(cpu.readFramePc(depth - 1), successor);
		assert.equal(cpu.readEpcWord(), successor);
		assert.equal(frame.top, Math.max(top, op.a + 1));
		const value = frame.registers.get(op.a), address = valuePayload(value);
		assert.equal(valueTag(value), ValueTag.Closure);
		assert.equal(memory.readRamRecordByte(address + CLOSURE_BINDING_FLAGS), CLOSURE_LATCHED_PROTOTYPE | (domain + 1));
		const binding = cpu.captureClosureBinding(address);
		assert.equal(binding.functionAddress, prototype);
		assert.deepEqual([binding.codeAddress, binding.numParams, binding.maxStack, binding.flags,
			binding.upvalueTableAddress, binding.recordUpvalueCount], words);
		assert.notEqual(frame.openUpvalueHead, open);
		assert.equal(isOpen(memory, frame.openUpvalueHead), true);
		const start = address - RAM_BASE, bytes = closureRecordBytes(words[5], true);
		observe(`H ${start} ${start + bytes}`, String(hashBytes(memory.ramData(), start, bytes)));
		assert.equal(grant(4096), RunResult.Halted);
		assert.deepEqual(runtime.readCompletionValues(), [valueInteger(708)]);
		assert.deepEqual(reads, [descriptor, descriptor + 4]);
		assert.equal(memory.readBusFaultSequence(), faults);
		observe('C', '708');
	}
	complete();
	const tail = commands.slice(cut), expected = rows.slice(rowCut);
	function replay(script: readonly string[], state: string) {
		writeFileSync(trace, script.join('\n'));
		return execFileSync(native, [romPath, trace, state, ...(cart === null ? [] : [cartPath])], { encoding: 'utf8' }).trimEnd().split('\n');
	}
	const deviceInput = mmio ? [`O ${descriptor + 4} ${descriptors[1]}`] : [];
	function compare(actual: readonly string[], expected: readonly string[], run: string) {
		const mismatch = actual.findIndex((row, index) => row !== expected[index]);
		assert.equal(mismatch, -1, `${run} row ${mismatch}: TS ${expected[mismatch]} C++ ${actual[mismatch]}`);
		assert.equal(actual.length, expected.length);
	}
	compare(replay([...commands, 'u', ...deviceInput, ...tail], seed), [...rows, ...expected], 'native rewind');
	compare(replay(['X', ...deviceInput, ...tail], tsMid), expected, 'TS to native');
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(cppMid), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	if (mmio) memory.writeMappedWord(descriptor + 4, descriptors[1]);
	frame = cpu.rootThread.frameAtDepth(depth - 1);
	reads.length = 1; signals.length = 1;
	const replayStart = rows.length;
	complete();
	assert.deepEqual(rows.slice(replayStart), expected);
});

test('noncanonical captureless CLOSURE creates distinct identities at the same instruction', t => {
	const linked = linkManagedTestSystem(`
halt_until_irq
local first, second
for i = 1, 2 do
	local f = function() return 73 end
	if i == 1 then first = f else second = f end
end
return first == second, first() + second(), first, second
`, 0);
	const rom = writeTestBlua32Rom(linked);
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	runGuestToHalt(cpu, 4_194_304);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	cpu.clearHaltUntilIrq();
	const dir = mkdtempSync(join(tmpdir(), 'captureless-function-binding-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const romPath = join(dir, 'system.rom'), trace = join(dir, 'trace'), seed = join(dir, 'seed');
	writeFileSync(romPath, rom);
	writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	const commands = ['X'], rows: string[] = [];
	function grant(cycles: number) {
		const outcome = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		commands.push(`E ${cycles}`);
		rows.push(`${outcome} ${cycles - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		return outcome;
	}
	const frame = cpu.activeThread.currentFrame!, depth = cpu.getFrameDepth();
	const decode = () => decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, frame.pc);
	const initial = cpu.luaHeap.usedBytes(), closures: ReturnType<typeof valueInteger>[] = [];
	let issue = 0;
	for (let i = 0; i < 2; ++i) {
		for (let step = 0; decode().op !== OpCode.CLOSURE && step < 64; ++step) assert.equal(grant(1), RunResult.Yielded);
		const op = decode(), successor = op.pc + INSTRUCTION_BYTES;
		assert.equal(op.op, OpCode.CLOSURE);
		if (i === 0) issue = frame.pc;
		assert.equal(frame.pc, issue);
		const before = frame.registers.get(op.a);
		assert.equal(grant(1), RunResult.Yielded);
		assert.equal(cpu.fixedInterruptActive(), true);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_FUNCTION_BINDING);
		assert.equal(cpu.readEpcWord(), issue);
		assert.equal(frame.pc, successor);
		assert.equal(frame.registers.get(op.a), before);
		const packet = cpu.activeThread.currentFrame!;
		assert.equal(packet.argumentCount, 11);
		assert.equal(packet.registers.get(0), valueInteger(op.a));
		assert.equal(packet.registers.get(1), valueInteger(op.bx * BLUA32_FUNCTION_ALIGNMENT));
		assert.equal(packet.registers.get(8), valueInteger(0));
		assert.equal(packet.registers.get(9), valueInteger(1));
		commands.push('Z');
		rows.push(`${CPU_CAUSE_CODE_FUNCTION_BINDING} 0 ${issue}`);
		for (let step = 0; cpu.fixedInterruptActive() && step < 4096; ++step) assert.equal(grant(1), RunResult.Yielded);
		assert.equal(cpu.fixedInterruptActive(), false);
		assert.equal(cpu.getFrameDepth(), depth);
		assert.equal(cpu.readFramePc(depth - 1), successor);
		assert.equal(cpu.readEpcWord(), successor);
		const closure = frame.registers.get(op.a);
		assert.equal(valueTag(closure), ValueTag.Closure);
		assert.equal(memory.readRamRecordByte(valuePayload(closure) + CLOSURE_BINDING_FLAGS), 0);
		assert.equal(cpu.luaHeap.usedBytes() - initial, (i + 1) * closureRecordBytes(0, false));
		closures.push(closure);
	}
	assert.notEqual(closures[0], closures[1]);
	assert.equal(grant(4096), RunResult.Halted);
	const result = [valueBool(false), valueInteger(146), ...closures];
	assert.deepEqual(runtime.readCompletionValues(), result);
	const output = [result.length, ...result.flatMap(v => [valueTag(v), valuePayload(v)])].join(' ');
	commands.push('c'); rows.push(output);
	writeFileSync(trace, commands.join('\n'));
	assert.deepEqual(execFileSync(native, [romPath, trace, seed], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
});

test('a bare System ROM may decline a Closure without a stock allocator', t => {
	const report = DYNAMIC_RAM_BASE - 16;
	const instructions = [
		[OpCode.KSMI, 0, 1, 9], [OpCode.WIDE, 0, 0, 0], [OpCode.CLOSURE, 0, 0, 0], [OpCode.RET, 0, 2, 0],
		[OpCode.RET, 0, 1, 0],
		// The alternate vector records the sampled prototype but leaves the
		// old destination alone. No callable object is created or published.
		[OpCode.LOADK, 11, 0, 0], [OpCode.STORE_MEM, 1, 11, MemoryAccessKind.Word],
		[OpCode.MFC0, 11, COP0_EPC, 0], [OpCode.KSMI, 12, 0, 2 * INSTRUCTION_BYTES],
		[OpCode.ADD, 11, 11, 12], [OpCode.MTC0, 11, COP0_EPC, 0], [OpCode.RFE, 0, 0, 0],
	] as const;
	const text = new Uint8Array(instructions.length * INSTRUCTION_BYTES);
	for (const [index, [op, a, b, c]] of instructions.entries()) writeInstruction(text, index, op, a, b, c);
	const rom = linkRawTestSystemBlua32({
		text, constants: [integerConstant(report)], verifiedControlFlow: true,
		closureRelocations: [{ wordIndex: 2, functionIndex: 1 }], exceptionFunctionIndex: 2,
		functions: [
			{ firstWord: 0, wordCount: 4, maxStack: 1 },
			{ firstWord: 4, wordCount: 1, staticClosure: false, maxStack: 1 },
			{ firstWord: 5, wordCount: 7, maxStack: 13, numParams: 11 },
		],
	});
	const runtime = new Runtime({ systemRomBytes: rom.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine, { heapAllocator: arena } = cpu;
	const state = arena.allocatorStateOffset(), inactive = new Uint8Array(32);
	assert.deepEqual(memory.ramData().subarray(state, state + inactive.length), inactive);
	const outcome = scheduler.runCpuSlice(0, 4096, undefined, CpuRunKind.Scheduled);
	assert.equal(outcome, RunResult.Halted);
	assert.equal(cpu.fixedInterruptActive(), false);
	assert.equal(cpu.heapServiceActive(), false);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_FUNCTION_BINDING);
	const successor = rom.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES;
	assert.equal(cpu.readEpcWord(), successor);
	assert.equal(memory.readMappedWord(report), rom.image.functions[1].address);
	assert.deepEqual(runtime.readCompletionValues(), [valueInteger(73)]);
	assert.deepEqual(memory.ramData().subarray(state, state + inactive.length), inactive);
	const dir = mkdtempSync(join(tmpdir(), 'raw-function-binding-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const romPath = join(dir, 'system.rom'), trace = join(dir, 'trace');
	writeFileSync(romPath, rom.romBytes);
	writeFileSync(trace, `E 4096\nZ\nM ${report}\nC\nH ${state} ${state + inactive.length}\n`);
	assert.deepEqual(execFileSync(native, [romPath, trace, join(dir, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n'), [
		`${outcome} ${4096 - cpu.instructionBudgetRemaining} 0 ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`,
		`${CPU_CAUSE_CODE_FUNCTION_BINDING} 0 ${successor}`, `${rom.image.functions[1].address} 0`, '73',
		String(hashBytes(inactive, 0, inactive.length)),
	]);
});
