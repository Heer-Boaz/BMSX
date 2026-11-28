import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readLE32, writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueBool, valueFromTag, valueInteger, valuePayload, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeCheckpointState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_SYSCALL } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { BUS_FAULT_ACCESS_READ, BUS_FAULT_ACCESS_U32, BUS_FAULT_UNMAPPED, IO_CART_SELECT, IO_SYS_BUS_FAULT_ACCESS, IO_SYS_BUS_FAULT_ADDR, IO_SYS_BUS_FAULT_CODE } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { StockFirmwareOperand } from '../../../toolchain/ts/lua/compiler/program';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { FIRMWARE_DATA_OFFSET } from '../../helpers/firmware_heap_layout';
import { MANAGED_CART_LAUNCH } from '../../helpers/managed_cart_launch';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const native = nativeConformanceRunner('bmsx_machine_conformance_runner');

for (const optLevel of [0, 3] as const) test(`computed immutable Function addresses bind through the ordinary BIOS at O${optLevel}`, t => {
	const source = `
local entries<const> = require('bmsx/startup')
local computed<const> = function(address)
	return blua32.closure(address)
end
local callable<const> = blua32.code_function(entries.protected_call)
local from_address<const> = computed(entries.protected_call)
local ordinary<const> = computed(entries.protected_failure)
local rejected<const>, payload<const> = ordinary(73)
return from_address, from_address == callable, ordinary, rejected, payload
`;
	const linked = linkManagedTestSystem(source, optLevel);
	const functionNamed = (name: string) => linked.layout.functions[linked.symbols.metadata.functionDisplayNames.indexOf(name)];
	const callable = functionNamed('protected_call'), ordinary = functionNamed('protected_failure'), binder = functionNamed('computed');
	const { textBytes, header } = linked.layout;
	const syscalls: number[][] = [];
	for (let pc = binder.codeAddress; pc < binder.codeAddress + binder.codeByteCount;) {
		const instruction = decodeBlua32InstructionAtPc(textBytes, header.textAddress, pc);
		if (instruction.op === OpCode.SVC) syscalls.push([instruction.b, instruction.c]);
		pc = instruction.pc + INSTRUCTION_BYTES;
	}
	assert.deepEqual(syscalls, [[2, 0]]);
	const rom = writeTestBlua32Rom(linked);
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, scheduler } = runtime.machine;
	const commands: string[] = [];
	for (let i = 0; i < 32 && cpu.getFrameDepth() !== 0; ++i) {
		scheduler.runCpuSlice(0, 65536, undefined, CpuRunKind.Scheduled);
		commands.push('E 65536');
	}
	assert.equal(cpu.getFrameDepth(), 0);
	assert.equal(cpu.readLuaFaultReasonWord(), 0);
	const values = runtime.readCompletionValues();
	assert.equal(values.length, 5);
	assert.equal(values[0], valueFromTag(ValueTag.CodeFunction, callable.address));
	assert.equal(values[1], valueBool(true));
	assert.equal(valueTag(values[2]), ValueTag.Closure);
	assert.equal(cpu.captureClosureBinding(valuePayload(values[2])).functionAddress, ordinary.address);
	assert.deepEqual(values.slice(3), [valueBool(false), valueInteger(73)]);
	const dir = mkdtempSync(join(tmpdir(), 'bmsx-computed-function-binding-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const romPath = join(dir, 'system.rom'), trace = join(dir, 'trace');
	writeFileSync(romPath, rom);
	writeFileSync(trace, [...commands, 'c'].join('\n'));
	const rows = execFileSync(native, [romPath, trace, join(dir, 'unused')], { encoding: 'utf8' }).trimEnd().split('\n');
	assert.equal(rows.at(-1), [values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
});

// More capture entries than pinned Value slots, with the original issuer live.
const names = Array.from({ length: 513 }, (_, index) => `c${index}`);
const expected = names.length * 2;
const source = `
local function make(value)
	local ${names.join(',')} = ${names.map(() => 'value').join(',')}
	halt_until_irq
	local function keep()
		local total = 0
		${names.map(name => `total = total + ${name}`).join('\n')}
		return total
	end
	return keep
end
local closure = make(2)
return closure()
`;

// The BIOS source-map test verifies these closure_work planes.
const captureLimit = 1024;
const newCellsOffset = 4 * captureLimit;
const missingOffset = 2 * newCellsOffset;
const workspaceBytes = missingOffset + (captureLimit >>> 5) * 4;

for (const optLevel of [0, 3] as const) for (const socket of [-1, 0, 1] as const) {
	test(`compiled capture binding survives both save cuts and rewind on ${socket < 0 ? 'system' : `cart socket ${socket}`} at O${optLevel}`, t => {
		const system = linkManagedTestSystem(socket < 0 ? source : `mem[${IO_CART_SELECT}] = ${socket}\n` + MANAGED_CART_LAUNCH, optLevel);
		const systemRomBytes = writeTestBlua32Rom(system);
		const cart = socket >= 0 ? (() => {
			const program = compileLuaChunkToProgram(parseLuaChunk(source, 'wide-capture.lua'), [], { entrySource: source, optLevel });
			return linkCartBlua32Image(system.biosImports, encodeCompiledProgramObject(program), program.metadata,
				CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
		})() : null;
		const cartRomBytes = cart === null ? null : writeTestBlua32Rom(cart);
		const { layout } = cart ?? system, { textAddress } = layout.header;
		const target = layout.functions.find(fn => fn.upvalues.length === names.length)!;
		assert.ok(target);
		const alternate = socket === 1 ? cartRomBytes!.slice() : null;
		if (alternate !== null) {
			// Identical bus address, different descriptor span in the other socket.
			writeLE32(alternate, target.address - CART_ROM_BASE + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, 1);
		}
		const slots = socket === 1 ? cartridgeSlots(alternate, cartRomBytes) : cartridgeSlots(cartRomBytes);
		const runtime = new Runtime({ systemRomBytes, cartridgeSlots: slots, machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		runGuestToHalt(cpu, 4_194_304);
		assert.equal(cpu.isHaltedUntilIrq(), true);
		assert.equal(cpu.activeCartridgeSlot(), socket);
		cpu.clearHaltUntilIrq();
		const frame = cpu.activeThread.currentFrame!;
		const slice = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		let issue = decodeBlua32InstructionAtPc(layout.textBytes, textAddress, frame.pc);
		for (let i = 0; i < 16 && issue.op !== OpCode.SVC; ++i) {
			assert.equal(slice(1), RunResult.Yielded);
			issue = decodeBlua32InstructionAtPc(layout.textBytes, textAddress, frame.pc);
		}
		assert.deepEqual([issue.op, issue.b, issue.c], [OpCode.SVC, 2, 0]);
		assert.equal(frame.registers.get(issue.a), valueInteger(StockFirmwareOperand.BindFunction));
		assert.equal(frame.registers.get(issue.a + 1), valueInteger(target.address));
		const { heapAllocator: arena, luaHeap } = nativeHeapReference(cpu);
		const workspace = arena.managementOffset() + FIRMWARE_DATA_OFFSET;
		const cells = workspace + newCellsOffset, bits = workspace + missingOffset;
		const history = new RamHistory();
		history.start(memory);
		const dir = mkdtempSync(join(tmpdir(), 'bmsx-aot-closure-binding-'));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const rom = join(dir, 'system.rom'), seed = join(dir, 'seed'), trace = join(dir, 'trace');
		const stagedSeed = join(dir, 'staged'), stagedCpp = join(dir, 'staged-cpp');
		const issuedSeed = join(dir, 'issued'), issuedCpp = join(dir, 'issued-cpp');
		writeFileSync(rom, systemRomBytes);
		const cartMedia: string[] = [];
		for (const [index, media] of slots.entries()) {
			if (media === null) continue;
			const path = join(dir, `slot${index}.rom`);
			writeFileSync(path, media.rom);
			cartMedia.push(path);
		}
		writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const commands: string[] = [], rows: string[] = [];
		function grant(cycles: number) {
			const result = slice(cycles), spent = cycles - cpu.instructionBudgetRemaining;
			commands.push(`E ${cycles}`);
			rows.push(`${result} ${spent} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
			return spent;
		}
		const initialPages = history.capture(memory, null);
		const logicalBeforeReservation = luaHeap.usedBytes();
		assert.equal(grant(1), BASE_CYCLES[OpCode.SVC]);
		assert.ok(cpu.fixedInterruptActive());
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_SYSCALL);
		assert.equal(cpu.readEpcWord(), issue.pc + INSTRUCTION_BYTES);
		for (let n = 0; n < 8192 && memory.readRamRecordWord(bits + 48) === 0; ++n) grant(127);
		assert.ok(cpu.fixedInterruptActive());
		assert.equal(memory.readRamRecordWord(bits + 48), 0xffffffff, '416 descriptors staged');
		assert.equal(memory.readRamRecordWord(bits + 64), 0, 'the final descriptor is not yet staged');
		assert.equal(memory.readRamRecordWord(cells), 0, 'reservation has not issued a Cell');
		const partialState = captureRuntimeCheckpointState(runtime);
		const partialPages = history.capture(memory, initialPages);
		const partial = captureRuntimeSaveState(runtime);
		const plan = partial.ram.slice(workspace, workspace + workspaceBytes);
		writeFileSync(stagedSeed, encodeRuntimeSaveState(partial));
		const split = commands.length;
		for (let n = 0; n < 8192 && memory.readRamRecordWord(cells + 32 * 4) === 0; ++n) grant(221);
		assert.ok(cpu.fixedInterruptActive());
		assert.equal(memory.readRamRecordWord(bits + 64), 1, 'the final descriptor went into the last bitmap word');
		assert.notEqual(memory.readRamRecordWord(cells + 32 * 4), 0);
		assert.equal(memory.readRamRecordWord(cells + (names.length - 1) * 4), 0);
		const issued = captureRuntimeSaveState(runtime);
		const issuedPlan = issued.ram.slice(workspace, workspace + workspaceBytes);
		assert.equal(luaHeap.usedBytes(), logicalBeforeReservation, 'partial reservation has not published logical ownership');
		writeFileSync(issuedSeed, encodeRuntimeSaveState(issued));
		const phase = commands.length;
		function drain() {
			for (let n = 0; n < 4096 && cpu.getFrameDepth(); ++n) grant(289);
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
			assert.deepEqual(runtime.readCompletionValues(), [valueInteger(expected)]);
			commands.push('C');
			rows.push(String(expected));
			const probe = RAM_BASE + cells + 32 * 4, savedCell = memory.readRamRecordWord(probe);
			const faults = memory.readBusFaultSequence();
			assert.notEqual(savedCell, 0);
			assert.equal(memory.readMappedWord(probe), 0);
			memory.writeMappedWord(probe, 0);
			assert.equal(memory.readBusFaultSequence(), faults + 2);
			assert.equal(memory.readRamRecordWord(probe), savedCell);
			commands.push(`M ${probe}`, `O ${probe} 0`);
			rows.push('0 1');
			const first = memory.ramBusEnd() - RAM_BASE, last = memory.ramData().length;
			commands.push(`H ${first} ${last}`);
			rows.push(String(hashBytes(memory.ramData(), first, last - first)));
		}
		drain();
		const tail = commands.slice(split), after = rows.slice(split);
		function replay(script: readonly string[], state: string, expectedRows: readonly string[]) {
			writeFileSync(trace, script.join('\n'));
			const actual = execFileSync(native, [rom, trace, state, ...cartMedia], { encoding: 'utf8' }).trimEnd().split('\n');
			assert.deepEqual(actual, expectedRows);
		}
		replay(['X', ...commands.slice(0, split), `x ${stagedCpp}`, ...commands.slice(split, phase), `x ${issuedCpp}`,
			...commands.slice(phase)], seed, rows);
		replay(['X', ...commands.slice(phase)], issuedSeed, rows.slice(phase));
		const addedIssued = decodeRuntimeSaveState(readFileSync(issuedCpp), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
		assert.deepEqual(addedIssued.ram.subarray(workspace, workspace + workspaceBytes), issuedPlan);
		replay(['X', ...tail], stagedSeed, after);
		const addedStaged = decodeRuntimeSaveState(readFileSync(stagedCpp), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
		assert.deepEqual(addedStaged.ram.subarray(workspace, workspace + workspaceBytes), plan);
		replay(['X', 'l', ...commands.slice(0, split), 's', ...tail, 'u', ...tail], seed, [...rows, ...after]);
		const endPages = history.capture(memory, partialPages);
		history.restore(memory, endPages, partialPages);
		applyRuntimeCheckpointState(runtime, partialState, RuntimeRestoreOrigin.HistorySeek);
		assert.deepEqual(memory.ramData().subarray(workspace, workspace + workspaceBytes), plan);
		commands.length = rows.length = split;
		for (let i = split; i < phase; ++i) grant(221);
		drain();
		assert.deepEqual(commands.slice(split), tail);
		assert.deepEqual(rows.slice(split), after);
		for (const [restored, cut] of [[addedStaged, split], [addedIssued, phase]] as const) {
			applyRuntimeSaveState(runtime, restored);
			commands.length = rows.length = cut;
			for (let i = cut; i < phase; ++i) grant(221);
			drain();
			assert.deepEqual(rows.slice(cut), after.slice(cut - split));
		}
	});
}

for (const optLevel of [0, 3] as const) test(`ordinary capture binding validates the whole descriptor span before refusing at O${optLevel}`, async t => {
	const system = linkManagedTestSystem(`
local entries<const> = require('bmsx/startup')
local protect<const> = blua32.closure(entries.protected_call)
local function make(a, b)
	halt_until_irq
	return function() return a * 100 + b end
end
local ok<const>, result<const> = protect(make, 7, 8)
if ok then return true, result() end
return false, result == 'Out of memory.', result == 'Invalid argument.'
`, optLevel);
	const rom = writeTestBlua32Rom(system);
	const { functions, textBytes, header } = system.layout;
	const prototype = functions.find(fn => fn.upvalues.length === 2 && fn.numParams === 0)!;
	const captureA = readLE32(rom, prototype.upvalueTableAddress);
	const captureB = readLE32(rom, prototype.upvalueTableAddress + 4);
	const descriptors = (rom.length + 3) & ~3;
	for (const scenario of ['fits', 'exhausted', 'invalid', 'unmapped'] as const) await t.test(scenario, t => {
		const fits = scenario === 'fits', invalid = scenario === 'invalid', unmapped = scenario === 'unmapped';
		const count = fits ? captureLimit : captureLimit + 1;
		const media = new Uint8Array(descriptors + 4 * (count - +unmapped));
		media.set(rom);
		writeLE32(media, prototype.address + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET, descriptors);
		writeLE32(media, prototype.address + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, count);
		for (let i = 0; i < count - +unmapped; ++i)
			writeLE32(media, descriptors + 4 * i, invalid && i === count - 1 ? 0xffffffff : i === 1 ? captureB : captureA);

		const runtime = new Runtime({ systemRomBytes: media, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		runGuestToHalt(cpu, 4_194_304);
		assert.equal(cpu.isHaltedUntilIrq(), true);
		cpu.clearHaltUntilIrq();
		const frame = cpu.activeThread.currentFrame!;
		const slice = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		let issue = decodeBlua32InstructionAtPc(textBytes, header.textAddress, frame.pc);
		for (let i = 0; i < 16 && issue.op !== OpCode.SVC; ++i) {
			assert.equal(slice(1), RunResult.Yielded);
			issue = decodeBlua32InstructionAtPc(textBytes, header.textAddress, frame.pc);
		}
		assert.deepEqual([issue.op, issue.b, issue.c], [OpCode.SVC, 2, 0]);
		const token = valueInteger(StockFirmwareOperand.BindFunction);
		assert.equal(frame.registers.get(issue.a), token);
		assert.equal(frame.registers.get(issue.a + 1), valueInteger(prototype.address));
		const { heapAllocator: arena, luaHeap } = nativeHeapReference(cpu);
		const workspace = arena.managementOffset() + FIRMWARE_DATA_OFFSET;
		const oldWork = new Uint8Array(memory.ramData().subarray(workspace, workspace + workspaceBytes));
		const openHead = frame.openUpvalueHead, physical = arena.occupiedBytes(), logical = luaHeap.usedBytes();
		const bus = memory.readBusFaultSequence();
		let sampled = 0;
		const readWord = memory.readMappedBusU32LE.bind(memory);
		t.mock.method(memory, 'readMappedBusU32LE', (...args: Parameters<typeof readWord>) => {
			if (args[0] >= descriptors && args[0] < descriptors + 4 * count)
				assert.equal(args[0], descriptors + 4 * sampled++, 'one ordered sample per descriptor');
			return readWord(...args);
		});
		const dir = mkdtempSync(join(tmpdir(), 'bmsx-aot-capture-capacity-'));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const systemFile = join(dir, 'system.rom'), seed = join(dir, 'seed'), trace = join(dir, 'trace');
		writeFileSync(systemFile, media);
		writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const commands = ['X'], rows: string[] = [];
		function grant(cycles: number) {
			const result = slice(cycles), spent = cycles - cpu.instructionBudgetRemaining;
			commands.push(`E ${cycles}`);
			rows.push(`${result} ${spent} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
			return result;
		}
		assert.equal(grant(1), RunResult.Yielded);
		assert.ok(cpu.fixedInterruptActive());
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_SYSCALL);
		let outcome = RunResult.Yielded;
		for (let i = 0; i < 2048 && cpu.fixedInterruptActive() && outcome === RunResult.Yielded; ++i) {
			if (!fits) {
				assert.equal(frame.openUpvalueHead, openHead);
				assert.equal(frame.registers.get(issue.a), token);
				assert.equal(arena.occupiedBytes(), physical);
				assert.equal(luaHeap.usedBytes(), logical);
			}
			outcome = grant(1024);
		}
		assert.equal(sampled, count);
		assert.equal(memory.readBusFaultSequence(), bus + +unmapped);
		if (fits) {
			assert.equal(memory.readRamRecordWord(workspace + missingOffset + 31 * 4), 0xffffffff);
			assert.notEqual(memory.readRamRecordWord(workspace + newCellsOffset + 1023 * 4), 0);
		} else {
			assert.deepEqual(memory.ramData().subarray(workspace, workspace + workspaceBytes), oldWork);
			assert.equal(arena.occupiedBytes(), physical);
			assert.equal(luaHeap.usedBytes(), logical);
		}
		assert.equal(cpu.captureRuntimeState().hardHalted, unmapped);
		if (unmapped) {
			assert.equal(outcome, RunResult.Halted);
			for (const [address, value] of [
				[IO_SYS_BUS_FAULT_CODE, BUS_FAULT_UNMAPPED], [IO_SYS_BUS_FAULT_ADDR, descriptors + 4 * (count - 1)],
				[IO_SYS_BUS_FAULT_ACCESS, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32],
			]) {
				assert.equal(memory.readMappedWord(address), value);
				commands.push(`M ${address}`);
				rows.push(`${value} 0`);
			}
		} else {
			for (let i = 0; i < 128 && outcome === RunResult.Yielded; ++i) outcome = grant(1024);
			assert.equal(outcome, RunResult.Halted);
			const values = runtime.readCompletionValues();
			assert.deepEqual(values, fits ? [valueBool(true), valueInteger(708)] : [valueBool(false), valueBool(!invalid), valueBool(invalid)]);
			commands.push('c');
			rows.push([values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
		}
		const first = memory.ramBusEnd() - RAM_BASE, end = memory.ramData().length;
		commands.push('F', `H ${first} ${end}`);
		rows.push(String(+unmapped), String(hashBytes(memory.ramData(), first, end - first)));
		writeFileSync(trace, commands.join('\n'));
		assert.deepEqual(execFileSync(native, [systemFile, trace, seed], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
	});
});
