import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { bindOpen } from '../../machine/ts/machine/cpu/upvalue';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { BUS_FAULT_UNMAPPED, IO_SYS_BUS_FAULT_CODE } from '../../machine/ts/spec/bmsx/io';
import { DYNAMIC_RAM_BASE, MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { MAPPED_PAGE_BYTE_MASK } from '../../machine/ts/machine/memory/mapped_page';
import { MAPPED_BUS_INSTRUCTION_FETCH } from '../../machine/ts/machine/memory/bus_signals';
import { integerConstant } from '../../toolchain/ts/lua/number';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValueTag, asClosure, valueBool, valueClosure, valueFloat, valueInteger, valueNil, type Value } from '../../machine/ts/machine/cpu/value';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { createTestSystemCpu, linkRawTestSystemBlua32, seedTestCapturedClosure, seedTestRomClosure } from '../helpers/blua32';
import { compileCoroutineTest } from '../helpers/coroutine';
import { runGuestToHalt } from '../helpers/cpu_test_harness';

test('copies between distinct windows of the same RAM in physical overlap order', () => {
	const { memory } = createTestSystemCpu(compileCoroutineTest('return true', 0));
	const source = new ValueSlots(0), target = new ValueSlots(0);
	const offset = DYNAMIC_RAM_BASE - RAM_BASE;
	source.bindRam(memory, offset, 8);
	target.bindRam(memory, offset + 4, 8);
	const values = [valueInteger(9), valueBool(true), valueFloat(-1.5), valueNil(), valueInteger(-13), valueBool(false)];
	for (let i = 0; i < values.length; ++i) source.set(i, values[i]);
	target.copyRangeFrom(source, 0, 0, values.length);
	assert.deepEqual(values.map((_, i) => target.get(i)), values);
	assert.equal(target.getFloat(2), -1.5);
	assert.equal(memory.ramWords[(offset >>> 2) + 1], 9);
});

test('overlapping return values move before nil padding, including at the physical RAM mirror', () => {
	const { memory } = createTestSystemCpu(compileCoroutineTest('return true', 0));
	const storage = new ValueSlots(0), window = new ValueSlots(0);
	for (const offset of [DYNAMIC_RAM_BASE - RAM_BASE, MAIN_RAM_SIZE - 8]) {
		storage.bindRam(memory, offset, 6);
		for (let i = 0; i < 6; ++i) storage.setInteger(i, i + 1);
		window.rebind(storage, 1, 4);
		window.copyRangeFrom(storage, 0, 0, 2, 2);
		assert.deepEqual(Array.from({ length: 6 }, (_, i) => storage.get(i)),
			[valueInteger(1), valueInteger(1), valueInteger(2), valueNil(), valueNil(), valueInteger(6)]);
	}
});

for (const backend of [CpuExecutionBackend.Interpreter]) {
	test(`fixed CALL reuses supplied slots and preserves only its lower caller prefix (${backend})`, () => {
		const text = new Uint8Array(8 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.K1, 0, 0, 0);
		writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 2, OpCode.CLOSURE, 4, 0, 0);
		writeInstruction(text, 3, OpCode.LOADK, 5, 0, 0);
		writeInstruction(text, 4, OpCode.CALL, 4, 2, 3);
		writeInstruction(text, 5, OpCode.RET, 4, 3, 0);
		writeInstruction(text, 6, OpCode.MOV, 2, 0, 0);
		writeInstruction(text, 7, OpCode.RET, 0, 3, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [
			{ firstWord: 0, wordCount: 6, maxStack: 128 },
			{ firstWord: 6, wordCount: 2, numParams: 2, maxStack: 8 },
		], constants: [integerConstant(37)], closureRelocations: [{ wordIndex: 2, functionIndex: 1 }] });
		const { cpu } = createTestSystemCpu(image, backend);
		seedTestRomClosure(cpu, image.symbols.functionAddresses[1]);
		const calleePc = image.image.functions[1].codeAddress;
		cpu.setExecutionHook((_domain, pc) => pc === calleePc, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.ExecutionStopped);
		const parent = cpu.rootThread.firstFrame!, child = cpu.rootThread.currentFrame!;
		assert.equal(child.stackBase, parent.stackBase + 5);
		assert.equal(cpu.rootThread.stackTop, child.stackBase + child.stackCapacity);
		assert.equal(cpu.rootThread.stackRegisters.capacity(), 128, 'callee shares the existing allocation, not an appended maxStack window');
		assert.equal(child.registers.get(0), valueInteger(37));
		assert.equal(child.registers.get(1), valueNil(), 'only the missing parameter is nil-filled');
		child.registers.setInteger(0, 41);
		assert.equal(parent.registers.get(5), valueInteger(41), 'the argument and parameter are the same physical slot');
		assert.equal(parent.registers.get(0), valueInteger(1));
		const snapshot = cpu.captureRuntimeState();
		assert.equal(cpu.memory.readRamRecordWord(cpu.rootThread.address + ThreadField.StackTop), 13, 'the thread header owns the shared stack extent');
		cpu.restoreRuntimeState(snapshot);
		assert.deepEqual(cpu.captureRuntimeState(), snapshot);
		cpu.setExecutionHook(null, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		cpu.runUntilDepth(0, 100);
		const result: Value[] = [];
		cpu.readCompletionValues(result);
		assert.deepEqual(result, [valueInteger(41), valueNil()]);
	});
}

for (const backend of [CpuExecutionBackend.Interpreter]) {
	test(`overlapping parent and child captures close with their own activation (${backend})`, () => {
		const text = new Uint8Array(13 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.SETGL, 0, 0, 0);
		writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 2, OpCode.CLOSURE, 4, 0, 0);
		writeInstruction(text, 3, OpCode.CALL, 4, 2, 1);
		writeInstruction(text, 4, OpCode.KSMI, 5, 0, 51);
		writeInstruction(text, 5, OpCode.RET, 0, 1, 0);
		writeInstruction(text, 6, OpCode.SETGL, 1, 0, 1);
		writeInstruction(text, 7, OpCode.KSMI, 0, 0, 42);
		writeInstruction(text, 8, OpCode.RET, 0, 1, 0);
		writeInstruction(text, 9, OpCode.GETUP, 0, 0, 0);
		writeInstruction(text, 10, OpCode.RET, 0, 2, 0);
		writeInstruction(text, 11, OpCode.GETUP, 0, 0, 0);
		writeInstruction(text, 12, OpCode.RET, 0, 2, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [
			{ firstWord: 0, wordCount: 6, maxStack: 6 },
			{ firstWord: 6, wordCount: 3, numParams: 1, maxStack: 2 },
			{ firstWord: 9, wordCount: 2, maxStack: 1, staticClosure: false, upvalueDescs: [{ inStack: true, index: 5 }] },
			{ firstWord: 11, wordCount: 2, maxStack: 1, staticClosure: false, upvalueDescs: [{ inStack: true, index: 0 }] },
		], globalNames: ['outer_read', 'inner_read'], closureRelocations: [{ wordIndex: 2, functionIndex: 1 }] });
		const { cpu, memory } = createTestSystemCpu(image, backend);
		seedTestRomClosure(cpu, image.symbols.functionAddresses[1]);
		const parent = cpu.rootThread.currentFrame!, outer = new Uint32Array(1);
		parent.registers.set(0, valueClosure(seedTestCapturedClosure(cpu, image.symbols.functionAddresses[2], outer)));
		parent.registers.setInteger(5, 37);
		parent.top = 6;
		bindOpen(memory, outer[0], parent.thread.address, parent.stackBase + 5, 0);
		parent.openUpvalueHead = outer[0];
		const childEntry = image.image.functions[1].codeAddress;
		cpu.setExecutionHook((_domain, pc) => pc === childEntry, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.ExecutionStopped);
		const child = cpu.rootThread.currentFrame!, inner = new Uint32Array(1);
		assert.equal(child.stackBase, parent.stackBase + 5);
		child.registers.set(1, valueClosure(seedTestCapturedClosure(cpu, image.symbols.functionAddresses[3], inner)));
		child.top = 2;
		bindOpen(memory, inner[0], child.thread.address, child.stackBase, 0);
		child.openUpvalueHead = inner[0];
		cpu.setExecutionHook(null, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		runGuestToHalt(cpu, 1000);
		for (const [name, expected] of [['outer_read', 51], ['inner_read', 42]] as const) {
			cpu.beginCompletionCall(asClosure(cpu.getGlobalByKey(cpu.stringPool.intern(name)), cpu.gc));
			runGuestToHalt(cpu, 100);
			const values: Value[] = [];
			cpu.readCompletionValues(values);
			assert.deepEqual(values, [valueInteger(expected)], name);
		}
	});
}

for (const backend of [CpuExecutionBackend.Interpreter]) for (const optLevel of [3] as const) {
	test(`shared stack closes live captures and preserves varargs through nested GC and replay (${backend}, O${optLevel})`, () => {
		const image = compileCoroutineTest(`
local collect<const> = collectgarbage
local function outer(first, ...)
 local saved = { first }
 local function read() return saved[1] end
 local function nested(value)
  local overwritten = { value }
  collect()
  return overwritten[1], read()
 end
 first = 99
 local a, b = nested(23)
 return read, a, b, ...
end
local read, a, b, c, d = outer(17, false, -0.0)
collect()
return read(), a, b, c, d
`, optLevel);
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.installBootPrimitives();
		let result = RunResult.Yielded;
		for (let step = 0; step < 2048 && result === RunResult.Yielded; ++step) {
			result = cpu.runUntilDepth(0, [13, 59, 191, 1024][step & 3]);
			const state = cpu.captureRuntimeState();
			cpu.restoreRuntimeState(state);
			assert.deepEqual(cpu.captureRuntimeState(), state);
		}
		assert.equal(result, RunResult.Halted);
		const values: Value[] = [];
		cpu.readCompletionValues(values);
		assert.deepEqual(values, [valueInteger(17), valueInteger(23), valueInteger(17), valueBool(false), valueFloat(-0)]);
	});

	test(`zero results are not one nil (${backend}, O${optLevel})`, () => {
		const image = compileCoroutineTest(`
local count<const> = select
local function empty() return end
local function implicit() end
local function nilvalue() return nil end
return count('#', empty()), count('#', implicit()), count('#', nilvalue())
`, optLevel);
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.installBootPrimitives();
		runGuestToHalt(cpu, 1_000_000);
		const values: Value[] = [];
		cpu.readCompletionValues(values);
		assert.deepEqual(values, [valueInteger(0), valueInteger(0), valueInteger(1)]);
	});
}

for (const backend of [CpuExecutionBackend.Interpreter]) for (const top of [0, 31]) {
	test(`open captures remain roots when open VARARG sets top to ${top} (${backend})`, () => {
		const text = new Uint8Array(5 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.SETGL, 0, 0, 0);
		writeInstruction(text, 1, OpCode.VARARG, top, 0, 0);
		writeInstruction(text, 2, OpCode.RET, 0, 1, 0);
		writeInstruction(text, 3, OpCode.GETUP, 0, 0, 0);
		writeInstruction(text, 4, OpCode.RET, 0, 2, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [
			{ firstWord: 0, wordCount: 3, maxStack: 4, isVararg: true },
			{ firstWord: 3, wordCount: 2, maxStack: 1, staticClosure: false, upvalueDescs: [{ inStack: true, index: 2 }] },
		], globalNames: ['read'] });
		const { cpu, memory } = createTestSystemCpu(image, backend);
		const frame = cpu.rootThread.currentFrame!, cells = new Uint32Array(1);
		frame.registers.setTable(2, cpu.createTable());
		frame.registers.set(0, valueClosure(seedTestCapturedClosure(cpu, image.symbols.functionAddresses[1], cells)));
		frame.top = 3;
		bindOpen(memory, cells[0], frame.thread.address, frame.stackBase + 2, 0);
		frame.openUpvalueHead = cells[0];
		cpu.setExecutionHook((_domain, pc) => pc === image.image.functions[0].codeAddress + 2 * INSTRUCTION_BYTES, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.ExecutionStopped);
		assert.equal(cpu.rootThread.currentFrame!.top, top);
		cpu.collectTrackedHeapBytes(); cpu.restoreRuntimeState(cpu.captureRuntimeState());
		const table = cpu.rootThread.currentFrame!.registers.get(2);
		assert.equal(cpu.rootThread.currentFrame!.registers.getTag(2), ValueTag.Table, 'capture owns its cell independently of the open result range');
		cpu.setExecutionHook(null, SYSTEM_EXECUTION_DOMAIN_MASK, 0); cpu.runUntilDepth(0, 100);
		cpu.beginCompletionCall(asClosure(cpu.getGlobalByKey(cpu.stringPool.intern('read')), cpu.gc));
		cpu.runUntilDepth(0, 100);
		const values: Value[] = []; cpu.readCompletionValues(values);
		assert.deepEqual(values, [table]);
	});
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript])
test(`an active stack stays private to the physical record port (${backend})`, () => {
	const text = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.MOV, 1, 0, 0);
	writeInstruction(text, 1, OpCode.KSMI, 2, 0, 37);
	writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 8 }] });
	const { cpu, memory } = createTestSystemCpu(image, backend);
	const fn = image.image.functions[0], thread = cpu.rootThread, regs = thread.currentFrame!.registers;
	const cycles = BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.KSMI] + BASE_CYCLES[OpCode.JMP];
	regs.setInteger(0, 41); cpu.runUntilDepth(0, 512 * cycles);
	if (backend === CpuExecutionBackend.JavaScript)
		assert.ok(thread.currentFrame!.decodedPage!.compiledBlocks!.entries[(fn.codeAddress & MAPPED_PAGE_BYTE_MASK) >>> 2],
			'the private-stack regression exercises a warmed JavaScript entry');
	const offset = thread.stackOffset(), slot = RAM_BASE + offset;
	assert.ok(slot >= memory.ramBusEnd());
	for (const address of [slot, thread.address, RAM_BASE + thread.currentFrame!.controlOffset]) {
		memory.clearBusFault();
		assert.equal(memory.readMappedBusU32LE(address, MAPPED_BUS_INSTRUCTION_FETCH), 0);
		assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED,
			'the instruction bus cannot observe the active thread or its frame and Value storage');
	}
	memory.clearBusFault(); assert.equal(memory.readMappedU32LE(slot), 0);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
	memory.clearBusFault(); memory.writeMappedU32LE(slot, 73);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
	assert.equal(regs.getInteger(0), 41, 'ordinary bus stores cannot alter a private register');
	memory.writeRamRecordWord(slot, 73);
	assert.equal(regs.getInteger(0), 73, 'the already bound Value plane is physical RAM');
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, fn.address, fn.codeAddress);
	cpu.runUntilDepth(0, cycles);
	assert.equal(regs.getInteger(1), 73, 'warmed execution reads the private physical register');
	const checkpoint = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	regs.setInteger(1, 7); memory.restoreSaveState(ram); cpu.restoreRuntimeState(checkpoint);
	assert.equal(cpu.readFrameRegister(0, 1), valueInteger(73), 'restore rebinds the active private Value plane');
});

test('physical Value windows wrap payloads and tags independently without a bus alias', () => {
	const { memory } = createTestSystemCpu(compileCoroutineTest('return true', 0));
	const regs = new ValueSlots(0); regs.bindRam(memory, MAIN_RAM_SIZE - 4, 8);
	assert.equal(regs.ramMirrored(), true);
	regs.setInteger(0, 123); regs.setFloatBits(1, 0xffc00042);
	assert.equal(memory.readRamRecordWord(MAIN_RAM_SIZE - 4), 123);
	assert.equal(memory.readRamRecordWord(0), 0xffc00042);
	assert.equal(memory.readRamRecordByte(28), ValueTag.Integer);
	assert.equal(memory.readRamRecordByte(29), ValueTag.Float);
	regs.copyWithin(1, 0, 2);
	assert.equal(regs.getInteger(1), 123);
	assert.equal(regs.getPayload(2), 0xffc00042, 'wrapped overlap copies retain memmove order and raw NaN bits');
});
