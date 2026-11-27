import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { TableHeader, TableRecords } from '../../../machine/ts/machine/cpu/table';
import { ValueTag, valueBool, valueFloat, valueInteger, valueNil, valuePayload, valueString, valueTable, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { COP0_EPC, CPU_CAUSE_CODE_STORAGE_WINDOW } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind, VALUE_MEMORY_TAG_OFFSET } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { BASE_CYCLES, OpCode, TABLE_INDEX_VISIT_CYCLES } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, DYNAMIC_RAM_BASE, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { linkRawTestSystemBlua32, writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
	buildDirectory: join(tmpdir(), 'bmsx-native-table-window'),
	configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
});
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const cases = [
	{ label: 'SETI', op: OpCode.SETI, source: 'receiver[1] = value', read: 'target[1]', forwarded: false, refuse: false, opt: 3 },
	{ label: 'SETT canonicalizes the selected key', op: OpCode.SETT, source: 'receiver[key] = value', read: 'target[key]', forwarded: false, refuse: false, opt: 0 },
	{ label: 'SETFIELD charges and preserves __newindex selection', op: OpCode.SETFIELD, source: 'receiver.missing = value', read: 'target.missing', forwarded: true, refuse: false, opt: 0 },
	{ label: 'SETT OOM does not publish the missing entry', op: OpCode.SETT, source: 'receiver[key] = value', read: 'target[key]', forwarded: false, refuse: true, opt: 0 },
] as const;

for (const scenario of cases) test(`managed storage-window exception: ${scenario.label}`, t => {
	const rom = writeTestBlua32Rom(linkManagedTestSystem(`
local entries<const> = require('bmsx/startup')
local protect<const> = blua32.closure(entries.protected_call)
${scenario.forwarded ? "local set_meta<const> = require('kernel/set_metatable')" : ''}
local function issue(receiver, key, value)
	halt_until_irq
	${scenario.source}
	return 23
end
local target = {}
local receiver = ${scenario.forwarded ? 'set_meta({}, { __newindex = target })' : 'target'}
local key = 1025.0
local ok, result = protect(issue, receiver, key, 61)
return ok, result, ${scenario.read}
`, scenario.opt));
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine, { tables } = cpu.gc;
	runGuestToHalt(cpu, 4_194_304);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	cpu.clearHaltUntilIrq();
	const thread = cpu.activeThread, owner = thread.address, depth = thread.frameDepth, caller = thread.currentFrame!;
	const decode = () => decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, caller.pc);
	for (let i = 0; decode().op !== scenario.op && i < 16; ++i)
		assert.equal(scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
	const issuePc = caller.pc, issue = decode(), successor = issue.pc + INSTRUCTION_BYTES;
	assert.equal(issue.op, scenario.op);
	const original = valuePayload(caller.registers.get(issue.a));
	const key = issue.op === OpCode.SETFIELD ? valueString(cpu.stringPool.find('missing')!)
		: valueInteger(issue.op === OpCode.SETI ? 1 : 1025);
	if (issue.op === OpCode.SETT) assert.equal(caller.registers.get(issue.b), valueFloat(1025));
	const receiver = scenario.forwarded ? valuePayload(tables.getStringKey(
		tables.metatableAddress(original), cpu.stringPool.find('__newindex')!)) : original;
	assert.equal(tables.arrayCapacity(receiver), 0);
	assert.equal(tables.hashSize(receiver), 0);
	if (scenario.refuse) {
		cpu.gc.collect();
		cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
		while (cpu.heapAllocator.allocate(4088, true)) { /* occupy page-sized extents */ }
		while (cpu.heapAllocator.allocate(1, true)) { /* no minimum chunk is available */ }
	}

	const dir = mkdtempSync(join(tmpdir(), 'table-storage-window-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const romPath = join(dir, 'system.rom'), trace = join(dir, 'trace'), seed = join(dir, 'seed');
	writeFileSync(romPath, rom);
	writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	const commands = ['X'], expected: string[] = [];
	function grant(cycles: number) {
		const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		commands.push(`E ${cycles}`);
		expected.push(`${result} ${cycles - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		return result;
	}
	assert.equal(grant(1), RunResult.Yielded);
	assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[scenario.op] + (scenario.forwarded ? TABLE_INDEX_VISIT_CYCLES : 0));
	assert.equal(cpu.fixedInterruptActive(), true);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_STORAGE_WINDOW);
	assert.equal(cpu.readEpcWord(), issuePc);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
	assert.equal(cpu.readThreadFrameWord(owner, depth - 1, FrameField.Pc), successor);
	const packet = cpu.activeThread.currentFrame!;
	assert.equal(packet.argumentCount, 6);
	assert.deepEqual([packet.registers.get(0), packet.registers.get(1), packet.registers.get(2), packet.registers.get(3)],
		[valueTable(receiver), key, valueInteger(61), valueInteger(0)]);
	assert.equal(valueTag(packet.registers.get(4)), ValueTag.Integer);
	assert.equal(packet.registers.get(5), valueInteger(-1));
	assert.equal(tables.get(receiver, key), valueNil());
	assert.equal(tables.arrayCapacity(receiver), 0);
	assert.equal(tables.hashSize(receiver), 0);
	commands.push('Z');
	expected.push(`${CPU_CAUSE_CODE_STORAGE_WINDOW} 0 ${issuePc}`);
	let outcome = RunResult.Yielded;
	for (let step = 0; cpu.fixedInterruptActive() && step < 65_536; ++step) {
		outcome = grant(scenario.refuse ? 257 : 1);
		if (!scenario.refuse || cpu.fixedInterruptActive()) assert.equal(outcome, RunResult.Yielded);
	}
	assert.equal(cpu.fixedInterruptActive(), false);
	assert.equal(cpu.activeThread.address, owner);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
	if (!scenario.refuse) {
		assert.equal(cpu.getFrameDepth(), depth);
		assert.equal(cpu.readFramePc(depth - 1), successor, 'the firmware returns to the instruction after the original store');
		assert.equal(cpu.readEpcWord(), successor);
		assert.equal(tables.get(receiver, key), valueInteger(61));
		if (scenario.forwarded) assert.equal(tables.get(original, key), valueNil(), 'only the selected target is written');
	} else {
		assert.equal(tables.get(receiver, key), valueNil());
		assert.equal(memory.readRamRecordWord(receiver + TableHeader.ArrayStorage), 0);
		assert.equal(memory.readRamRecordWord(receiver + TableHeader.HashStorage), 0);
	}
	const offset = receiver - RAM_BASE;
	commands.push(`H ${offset} ${offset + TableRecords.HEADER_BYTES}`);
	expected.push(String(hashBytes(memory.ramData(), offset, TableRecords.HEADER_BYTES)));
	if (outcome !== RunResult.Halted) assert.equal(grant(4096), RunResult.Halted);
	const result = scenario.refuse ? [valueBool(false), valueString(cpu.stringPool.find('Out of memory.')!), valueNil()]
		: [valueBool(true), valueInteger(23), valueInteger(61)];
	assert.deepEqual(runtime.readCompletionValues(), result);
	commands.push('c');
	expected.push([result.length, ...result.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	writeFileSync(trace, commands.join('\n'));
	assert.deepEqual(execFileSync(native, [romPath, trace, seed], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
});


test('warm generated SETFIELD hands its only missing store to ordinary firmware', t => {
	const image = linkManagedTestSystem(`
local present = { grow = 1 }
local empty = {}
local receiver = present
for i = 1, 129 do
	if i == 129 then receiver = empty end
	receiver.grow = 183
end
local first = receiver.grow
receiver.grow = 14
return first + receiver.grow
`, 0);
	const rom = writeTestBlua32Rom(image);
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu } = runtime.machine;
	runGuestToHalt(cpu, 4_194_304);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_STORAGE_WINDOW);
	assert.deepEqual(runtime.readCompletionValues(), [valueInteger(197)]);
	const epc = cpu.readEpcWord();
	assert.equal(decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, epc - INSTRUCTION_BYTES).op, OpCode.SETFIELD);

	const dir = mkdtempSync(join(tmpdir(), 'native-table-storage-window-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const romPath = join(dir, 'system.rom'), trace = join(dir, 'trace');
	writeFileSync(romPath, rom);
	writeFileSync(trace, 'K F\nC\n');
	assert.deepEqual(execFileSync(native, [romPath, trace, join(dir, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n'),
		[`1 ${CPU_CAUSE_CODE_STORAGE_WINDOW} ${epc}`, '197']);
});


test('a bare System ROM controls retirement of a table store without backing', t => {
	const table = DYNAMIC_RAM_BASE - 96, slot = table + 48, report = slot + 16;
	const instructions = [
		[OpCode.LOADK, 0, 0, 0], [OpCode.LOADK, 1, 0, 1],
		[OpCode.STORE_MEM, 0, 1, MemoryAccessKind.Word],
		[OpCode.KSMI, 0, 0, ValueTag.Table], [OpCode.LOADK, 1, 0, 2],
		[OpCode.STORE_MEM, 0, 1, MemoryAccessKind.U8],
		[OpCode.LOADK, 1, 0, 1], [OpCode.LOAD_MEM, 0, 1, MemoryAccessKind.Value],
		[OpCode.KSMI, 2, 1, 27], [OpCode.SETI, 0, 1, 2],
		[OpCode.LOADK, 1, 0, 3], [OpCode.LOAD_MEM, 0, 1, MemoryAccessKind.Word],
		[OpCode.RET, 0, 2, 0],
		// Alternate firmware records the sampled operand and skips the
		// instruction without changing the Table or allocating backing.
		[OpCode.LOADK, 3, 0, 3], [OpCode.STORE_MEM, 2, 3, MemoryAccessKind.Word],
		[OpCode.MFC0, 3, COP0_EPC, 0], [OpCode.KSMI, 4, 0, INSTRUCTION_BYTES],
		[OpCode.ADD, 3, 3, 4], [OpCode.MTC0, 3, COP0_EPC, 0], [OpCode.RFE, 0, 0, 0],
	] as const;
	const text = new Uint8Array(instructions.length * INSTRUCTION_BYTES);
	for (const [index, [op, a, b, c]] of instructions.entries()) writeInstruction(text, index, op, a, b, c);
	const image = linkRawTestSystemBlua32({ text, exceptionFunctionIndex: 1, verifiedControlFlow: true,
		constants: [table, slot, slot + VALUE_MEMORY_TAG_OFFSET, report].map(integerConstant),
		functions: [{ firstWord: 0, wordCount: 13, maxStack: 3 }, { firstWord: 13, wordCount: 7, numParams: 6, maxStack: 6 }],
	});
	const runtime = new Runtime({ systemRomBytes: image.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine, { heapAllocator: arena } = cpu;
	const management = arena.allocatorStateOffset(), bytes = 32;
	assert.deepEqual(memory.ramData().subarray(management, management + bytes), new Uint8Array(bytes));
	const result = scheduler.runCpuSlice(0, 4096, undefined, CpuRunKind.Scheduled);
	assert.equal(result, RunResult.Halted);
	assert.equal(cpu.fixedInterruptActive(), false);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_STORAGE_WINDOW);
	const successor = image.image.functions[0].codeAddress + 10 * INSTRUCTION_BYTES;
	assert.equal(cpu.readEpcWord(), successor);
	assert.deepEqual(runtime.readCompletionValues(), [valueInteger(91)]);
	assert.equal(memory.readRamRecordWord(table + TableHeader.Array), 0);
	assert.deepEqual(memory.ramData().subarray(management, management + bytes), new Uint8Array(bytes));
	const dir = mkdtempSync(join(tmpdir(), 'raw-table-storage-window-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const rom = join(dir, 'system.rom'), trace = join(dir, 'trace');
	writeFileSync(rom, image.romBytes);
	const offset = table - RAM_BASE;
	writeFileSync(trace, `E 4096\nZ\nC\nH ${offset} ${offset + TableRecords.HEADER_BYTES}\nH ${management} ${management + bytes}\n`);
	assert.deepEqual(execFileSync(native, [rom, trace, join(dir, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n'), [
		`${result} ${4096 - cpu.instructionBudgetRemaining} 0 ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`,
		`${CPU_CAUSE_CODE_STORAGE_WINDOW} 0 ${successor}`, '91',
		String(hashBytes(memory.ramData(), offset, TableRecords.HEADER_BYTES)),
		String(hashBytes(memory.ramData(), management, bytes)),
	]);
});
