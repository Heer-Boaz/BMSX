import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readLE32, writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { IMAGE_STRING_RAM_ORDINAL } from '../../../machine/ts/machine/cpu/execution_image';
import { HEAP_GC_CONTROL_OFFSET, HEAP_LOGICAL_OCCUPIED_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { TableHeader } from '../../../machine/ts/machine/cpu/table';
import { THREAD_HEAP_BYTES, ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { isOpen, UPVALUE_HEAP_BYTES, UPVALUE_VALUE_WORD } from '../../../machine/ts/machine/cpu/upvalue';
import { asInteger, valueInteger, valueNil, valuePayload, valueString, valueTable, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { COP0_EXEC, COP0_RAM_END, CPU_CAUSE_CODE_REGISTER_WINDOW, CPU_CAUSE_CODE_STORAGE_WINDOW, CPU_CAUSE_CODE_TRAP, CPU_STATUS_INHIBIT_RESET, LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../../machine/ts/spec/blua32/cop0';
import { EXECUTION_IMAGE_BINDINGS_OFFSET, EXECUTION_IMAGE_BINDING_RAM_STRINGS_OFFSET, EXECUTION_IMAGE_BINDING_SIZE, EXECUTION_IMAGE_BINDING_STRINGS_OFFSET, GLOBAL_BANK_OFFSET, GlobalBankField, SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_EXECUTION_DOMAIN_MASK, SYSTEM_GLOBAL_BANK_OFFSET, executionDomainBit, executionImageBindingOffset } from '../../../machine/ts/spec/blua32/execution_domain';
import { BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_MAX_STACK_OFFSET, BLUA32_IMAGE_BSS_ADDRESS_OFFSET, BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET, BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET, BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, instructionLowB, instructionOpcode, MAX_LOW_OPERAND, MAX_OPERAND_BITS } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_CLOSURE_OFFSET, HEAP_SERVICE_REMARK_HEAD_OFFSET, HEAP_SERVICE_ROOT_BANKS_OFFSET, HeapServiceRemarkHeadField } from '../../../machine/ts/spec/bmsx/heap_service';
import { IO_IRQ_FLAGS, IO_IRQ_MASK, IO_SYS_CONTROL, IO_SYS_STATUS, SYS_CONTROL_RESET, SYS_STATUS_SUPERVISOR_ACTIVE, SYS_STATUS_SUPERVISOR_RESUMABLE } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, CPU_FIXED_STACK_BASE, CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_RESET_BANK_ADDRESS, DYNAMIC_RAM_BASE, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET, BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import type { OptimizationLevel } from '../../../toolchain/ts/lua/compiler/optimizer';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { readBlua32BiosImports } from '../../../toolchain/ts/rompack/blua32_bios_imports';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = {
	sampleInputControllerSnapshot() {},
	supervisorRequestLineHigh: () => false,
	applyInputControllerVibrationEffect() {},
};
const runner = 'bmsx_heap_service_conformance_runner';
const bindingBytes = GLOBAL_BANK_OFFSET + GlobalBankField.Count + 4 - EXECUTION_IMAGE_BINDINGS_OFFSET;

function compileCartridge(system: Uint8Array, source: string, path: string, optLevel: OptimizationLevel) {
	const program = compileLuaChunkToProgram(parseLuaChunk(source, path), [], { entrySource: source, optLevel });
	return linkCartBlua32Image(readBlua32BiosImports(system), encodeCompiledProgramObject(program), program.metadata,
		CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
}

class Trace {
	readonly commands: string[] = [];
	readonly expected: string[] = [];

	constructor(private readonly native: string, private readonly path: string, private readonly cart?: string,
		private readonly otherCart?: string) {}

	observe(command: string, outcome?: string | number): void {
		this.commands.push(command);
		if (outcome !== undefined) this.expected.push(String(outcome));
	}

	replay(label: string, rom: string, state = this.path): void {
		writeFileSync(this.path, this.commands.join('\n'));
		const args = [rom, this.path, state];
		if (this.cart !== undefined) args.push(this.cart);
		if (this.otherCart !== undefined) args.push(this.otherCart);
		const actual = execFileSync(this.native, args, {
			encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
		}).trimEnd().split('\n');
		const mismatch = actual.findIndex((line, i) => line !== this.expected[i]);
		assert.equal(mismatch, -1, `${label}, observation ${mismatch}: TS=${this.expected[mismatch]}, C++=${actual[mismatch]}`);
		assert.equal(actual.length, this.expected.length, label);
	}
}

function verifySystemExec(rom: string, native: string, out: string): void {
	const system = readFileSync(rom);
	const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	const { cpu, memory, scheduler } = runtime.machine, arena = cpu.heapAllocator;
	let target = 0;
	runtime.boot();
	cpu.setExecutionHook((_domain, pc) => {
		const word = readLE32(system, pc);
		if (instructionOpcode(word) !== OpCode.MTC0 || instructionLowB(word) !== COP0_EXEC) return false;
		target = asInteger(cpu.activeThread.currentFrame!.registers.get((word >>> (2 * MAX_OPERAND_BITS)) & MAX_LOW_OPERAND));
		return true;
	}, executionDomainBit(SYSTEM_EXECUTION_DOMAIN_ID), 0);
	for (let i = 0; target === 0 && i < 4096; ++i) scheduler.runCpuSlice(0, 1024, 0, CpuRunKind.Scheduled);
	assert.ok(target > 0 && target < CART_ROM_BASE, 'the installed firmware reached its System EXEC');
	cpu.setExecutionHook(null, 0, 0);
	const root = cpu.rootThread.address;
	assert.notEqual(root, CPU_RESET_BANK_ADDRESS);
	const stack = memory.readRamRecordWord(root + ThreadField.StackCapacity);
	assert.ok(stack >= readLE32(system, target + BLUA32_FUNCTION_MAX_STACK_OFFSET),
		'the BIOS allocated startup backing before handing off the instruction');
	const wire = join(out, 'system-exec-before.state');
	writeFileSync(wire, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	const first = arena.managementOffset() + HEAP_LOGICAL_OCCUPIED_OFFSET;
	const end = arena.managementOffset() + HEAP_SERVICE_ROOT_BANKS_OFFSET;
	const ledger = memory.ramData().slice(first, end);
	const digest = hashBytes(ledger, 0, ledger.length);
	const trace = new Trace(native, join(out, 'system-exec.trace'));
	trace.observe('X');
	trace.observe(`H ${first} ${end}`, digest);
	const result = scheduler.runCpuSlice(0, 1, 0, CpuRunKind.Scheduled);
	assert.equal(result, RunResult.Yielded);
	const pc = cpu.readFramePc(0);
	assert.equal(pc, readLE32(system, target + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET));
	assert.equal(cpu.getFrameDepth(), 1);
	assert.deepEqual(memory.ramData().subarray(first, end), ledger, 'EXEC did not reserve or collect');
	trace.observe('L 1', [result, 1 - cpu.instructionBudgetRemaining, 0,
		cpu.gc.fullEpochs(), cpu.gc.phase(), cpu.luaHeap.usedBytes()].join(' '));
	trace.observe('P', `1 ${pc}`);
	trace.observe(`H ${first} ${end}`, digest);
	trace.replay('System EXEC consumption of firmware backing', rom, wire);
}

function verifyColdRefusal(rom: string, native: string, dir: string): void {
	const system = readFileSync(rom);
	const header = readLE32(system, BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET);
	// This BSS fits in public RAM, but leaves no room for the first diagnostic.
	// No test allocator writes or schedule changes manufacture the refusal.
	const bss = readLE32(system, header + BLUA32_IMAGE_BSS_ADDRESS_OFFSET);
	writeLE32(system, header + BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET, CPU_FIXED_STACK_BASE - bss);
	const systemPath = join(dir, 'cold-refusal.rom');
	writeFileSync(systemPath, system);
	const rt = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	const { cpu, memory, scheduler, systemController } = rt.machine, frames = rt.frameScheduler;
	const trace = new Trace(native, join(dir, 'cold-refusal.trace'));
	rt.boot();
	for (let i = 0; i < 256 && !cpu.isHaltedUntilIrq(); ++i) {
		const result = scheduler.runCpuSlice(0, 127, 0, CpuRunKind.Scheduled);
		trace.observe('L 127', [result, 127 - cpu.instructionBudgetRemaining, +cpu.heapServiceActive(),
			cpu.gc.fullEpochs(), cpu.gc.phase(), cpu.luaHeap.usedBytes()].join(' '));
	}
	assert.equal(cpu.isHaltedUntilIrq(), true);
	assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	assert.equal(cpu.luaHeap.usedBytes(), 0);
	assert.equal(memory.readIoU32(IO_SYS_STATUS) & (SYS_STATUS_SUPERVISOR_ACTIVE | SYS_STATUS_SUPERVISOR_RESUMABLE),
		SYS_STATUS_SUPERVISOR_ACTIVE);
	memory.writeMappedWord(IO_SYS_CONTROL, SYS_CONTROL_RESET);
	trace.observe(`O ${IO_SYS_CONTROL} ${SYS_CONTROL_RESET}`);
	const before = scheduler.nowCycles, tick = frames.lastTickSequence;
	const done = frames.runCyclesToNextLogicalTick(1);
	trace.observe('p 1', `${+done} ${scheduler.nowCycles - before} ${frames.lastTickSequence - tick} ${+cpu.heapServiceActive()} ${+cpu.isHaltedUntilIrq()}`);
	assert.equal(systemController.hasResetRequest(), false, 'cold diagnostic refusal must not retain the reset interlock');
	assert.equal(cpu.captureRuntimeState().previousRootContextWord, 0);
	assert.equal(cpu.isHaltedUntilIrq(), false);
	trace.observe('P', `${cpu.getFrameDepth()} ${cpu.readFramePc(0)}`);
	trace.replay('hardware RESET after cold diagnostic refusal', systemPath);
}

function verifySelect(rom: string, native: string, dir: string, optLevel: OptimizationLevel): void {
	const system = readFileSync(rom);
	const source = `bss report: word
mem[${IO_IRQ_MASK}] = 0
local pick = select
local function count(...) return pick('#', ...) end
local function rejected(ok, why, ...)
	assert(ok == false and why == 'Invalid argument.' and count(...) == 0)
end
local function suffix(n, first, middle, last, ...)
	assert(count(...) == n)
	local a, b, c = ...
	assert(a == first and b == middle and c == last)
end
local marker = { value = 91 }
*report = 1
while *report == 1 do end
assert(pick('#') == 0 and pick('#', 11, nil, marker, nil) == 4)
assert(pick(string.sub('x#', 2), nil, marker, nil) == 3)
assert(pick(string.char(mem[${IO_IRQ_MASK}] + 35), nil, nil) == 2)
local handled, kept, omitted = xpcall(function(value) error(value) end, function(value)
	return value, 91
end, marker)
assert(not handled and kept == marker and omitted == nil)
local implicit = setmetatable({}, { __index = pcall })
assert(implicit.missing == false)
*report = 3

suffix(4, 11, nil, marker, pick(1, 11, nil, marker, nil))
suffix(4, 11, nil, marker, pick(0, 11, nil, marker, nil))
suffix(4, 11, nil, marker, pick(-700, 11, nil, marker, nil))
suffix(3, nil, marker, nil, pick(2, 11, nil, marker, nil))
suffix(2, marker, nil, nil, pick(-2, 11, nil, marker, nil))
suffix(1, nil, nil, nil, pick(-1, 11, nil, marker, nil))
assert(count(pick(5, 11, nil, marker, nil)) == 0)
assert(count(pick(2147483647, 11)) == 0)
assert(count(pick(1)) == 0 and count(pick(0)) == 0)
local a, b, c, d = pick(2, 11, nil, marker, nil)
assert(a == nil and b == marker and c == nil and d == nil)
local first, second = pick(1, marker, nil, 13, 17)
assert(first == marker and second == nil)
pick(2, 11, nil, marker, nil)
*report = 4

suffix(2, nil, marker, nil, pick(blua32.float_from_bits(0x40000000), 11, nil, marker))
suffix(2, nil, marker, nil, pick(blua32.float_from_bits(0xc0000000), 11, nil, marker))
suffix(3, 11, nil, marker, pick(blua32.float_from_bits(0x80000000), 11, nil, marker))
suffix(3, 11, nil, marker, pick(blua32.float_from_bits(0xcf000000), 11, nil, marker))
assert(count(pick(blua32.float_from_bits(0x4effffff), 11)) == 0)
rejected(pcall(pick))
rejected(pcall(pick, nil, 11))
rejected(pcall(pick, false, 11))
rejected(pcall(pick, marker, 11))
rejected(pcall(pick, '2', 11))
rejected(pcall(pick, '##', 11))
rejected(pcall(pick, '#\\0', 11))
rejected(pcall(pick, blua32.float_from_bits(0x3fa00000), 11))
rejected(pcall(pick, blua32.float_from_bits(0xbf000000), 11))
rejected(pcall(pick, blua32.float_from_bits(0x7fc12345), 11))
rejected(pcall(pick, blua32.float_from_bits(0x7f800000), 11))
rejected(pcall(pick, blua32.float_from_bits(0xff800000), 11))
rejected(pcall(pick, blua32.float_from_bits(0x4f000000), 11))
rejected(pcall(pick, blua32.float_from_bits(0xcf000001), 11))
*report = 5

local tracked = {[1] = 19, [66] = marker, [67] = 71}
local function tail(...)
	assert(count(...) == 3)
	local x, y, z = ...
	assert(x == nil and y == marker and z == 71)
end
tail(pick(65, table.unpack(tracked, 1, 67)))
local function observed(ok, ...)
	assert(ok)
	suffix(3, nil, marker, nil, ...)
end
observed(pcall(pick, 2, 11, nil, marker, nil))
*report = 42
while *report == 42 do end
return 43, pick(2, 99, nil, 707, nil)
`;
	const linked = compileCartridge(system, source, 'select.lua', optLevel);
	const cart = writeTestBlua32Rom(linked), cartPath = join(dir, 'select.rom');
	writeFileSync(cartPath, cart);
	const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler, gxGpu } = runtime.machine, frames = runtime.frameScheduler;
	const trace = new Trace(native, join(dir, 'select.trace'), cartPath);
	const report = linked.layout.header.bssAddress;
	for (let grant = 0; grant < 2048 && memory.readMappedU32LE(report) === 0; ++grant) {
		if (gxGpu.backendCommandDrainPending()) {
			gxGpu.retireExecutedCommands();
			trace.observe('>');
		}
		const before = scheduler.nowCycles, tick = frames.lastTickSequence;
		const complete = frames.runCyclesToNextLogicalTick(65536);
		trace.observe('p 65536', [
			+complete, scheduler.nowCycles - before, frames.lastTickSequence - tick,
			+cpu.heapServiceActive(), +cpu.isHaltedUntilIrq(),
		].join(' '));
	}
	assert.equal(memory.readMappedU32LE(report), 1);
	function grant(trace: Trace, cycles: number) {
		const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
		trace.observe(`E ${cycles}`, [result, cycles - cpu.instructionBudgetRemaining, +cpu.heapServiceActive(),
			memory.ramBusEnd(), cpu.activeCartridgeSlot()].join(' '));
		return result;
	}
	memory.writeMappedWord(report, 2);
	trace.observe(`O ${report} 2`);
	for (let n = 0; n < 4096 && memory.readMappedU32LE(report) !== 42; ++n)
		if (grant(trace, 257) === RunResult.Halted) break;
	assert.equal(memory.readMappedU32LE(report), 42, `last fault reason ${cpu.readLuaFaultReasonWord()}`);
	assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
	memory.writeMappedWord(report, 43);
	trace.observe(`O ${report} 43`);

	// The final select must use its ordinary argument window through RET.
	// Neither ARGC nor choosing a suffix rewrites the argument lanes.
	const extras = [valueInteger(99), valueNil(), valueInteger(707), valueNil()];
	function assertArguments() {
		const frame = cpu.activeThread.currentFrame!;
		assert.equal(frame.argumentCount, 5, 'one selector and four extra arguments, including both nils');
		assert.equal(frame.varargCount, extras.length);
		assert.deepEqual(extras.map((_, slot) => frame.thread.stackRegisters.get(frame.varargBase + slot)), extras);
		return frame;
	}
	let argcObserved = false, returnPc = -1, varargBase = -1;
	for (let n = 0; n < 4096 && cpu.getFrameDepth() !== 0; ++n) {
		const frame = cpu.activeThread.currentFrame!;
		if (!cpu.heapServiceActive() && cpu.activeCartridgeSlot() === SYSTEM_EXECUTION_DOMAIN_ID && frame.argumentCount === 5) {
			const next = decodeBlua32InstructionAtPc(system, SYSTEM_ROM_BASE, frame.pc);
			if (next.op === OpCode.ARGC) {
				varargBase = assertArguments().varargBase;
				assert.equal(grant(trace, 1), RunResult.Yielded);
				assert.equal(frame.registers.get(next.a), valueInteger(5));
				argcObserved = true;
				continue;
			}
			if (next.op === OpCode.RET && next.c !== 0) {
				assert.ok(argcObserved);
				assert.equal(assertArguments().varargBase, varargBase);
				assert.equal(next.b, 0, 'select returns all remaining extra arguments');
				assert.equal(frame.registers.get(next.a), valueInteger(1), 'the zero-based suffix starts at the second extra');
				returnPc = frame.pc;
				break;
			}
		}
		if (grant(trace, 1) === RunResult.Halted) break;
	}
	assert.ok(returnPc >= 0, 'paused on the raw suffix RET before it consumed any arguments');
	const cutFrame = assertArguments();
	const raw = cutFrame.controlOffset + FrameField.VarargBase;
	const words = cutFrame.thread.stackOffset() + 4 * varargBase;
	const tags = cutFrame.thread.stackOffset() + 4 * cutFrame.thread.stackRegisters.capacity() + varargBase;
	trace.observe('P', `${cpu.getFrameDepth()} ${returnPc}`);
	for (const [first, end] of [[raw, raw + 8], [words, words + 4 * extras.length], [tags, tags + extras.length]]) {
		trace.observe(`H ${first} ${end}`, hashBytes(memory.ramData(), first, end - first));
	}
	const tsState = join(dir, 'select-ts.state'), cppState = join(dir, 'select-native.state');
	writeFileSync(tsState, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	trace.observe(`x ${cppState}`);
	const cut = trace.commands.length, count = trace.expected.length;

	function finish(trace: Trace) {
		assert.equal(cpu.heapServiceActive(), false);
		const frame = assertArguments();
		assert.equal(frame.pc, returnPc);
		assert.equal(frame.varargBase, varargBase);
		let result = RunResult.Yielded;
		for (let n = 0; n < 4096 && result !== RunResult.Halted; ++n) result = grant(trace, 257);
		assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
		assert.equal(result, RunResult.Halted);
		assert.equal(memory.readMappedU32LE(report), 43);
		const expected = [valueInteger(43), valueNil(), valueInteger(707), valueNil()];
		assert.deepEqual(runtime.readCompletionValues(), expected);
		trace.observe('c', `${expected.length} ${expected.map(value => `${valueTag(value)} ${valuePayload(value)}`).join(' ')}`);
	}
	finish(trace);
	trace.replay('stock select from cold boot', rom);
	const fromTs = new Trace(native, join(dir, 'select-from-ts.trace'), cartPath);
	fromTs.observe('X');
	fromTs.commands.push(...trace.commands.slice(cut));
	fromTs.expected.push(...trace.expected.slice(count));
	fromTs.replay('stock select from a TS checkpoint', rom, tsState);
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(cppState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	const fromCpp = new Trace(native, join(dir, 'select-from-native.trace'), cartPath);
	finish(fromCpp);
	assert.deepEqual(fromCpp.commands, trace.commands.slice(cut));
	assert.deepEqual(fromCpp.expected, trace.expected.slice(count));
}

function verifyStringChar(rom: string, native: string, dir: string, optLevel: OptimizationLevel): void {
	const system = readFileSync(rom);
	const source = `bss report: word
mem[${IO_IRQ_MASK}] = 0
local char = string.char
assert(type(char) == 'function' and char() == '')
local mixed = char(255.75, -0.75, 4294967296.0, 65, 128)
assert(#mixed == 5)
assert(string.byte(mixed, 1) == 255 and string.byte(mixed, 2) == 0 and string.byte(mixed, 3) == 0)
assert(string.byte(mixed, 4) == 65 and string.byte(mixed, 5) == 128)
assert(char(table.unpack({255, 0, 0, 65, 128}, 1, 5)) == mixed)
assert(char(255, 0, 0, 65, 128) == mixed)
for _, bad in ipairs({-1, 256, -1.75, 0/0, 1/0, false, '65'}) do
	assert(not pcall(char, 65, bad))
end
local ok, result = pcall(char, 23, 7)
assert(ok and #result == 2 and string.byte(result, 1) == 23 and string.byte(result, 2) == 7)
assert(utf8.char(0x10000) == char(240, 144, 128, 128))
*report = 43
halt_until_irq
`;
	const linked = compileCartridge(system, source, 'string-char.lua', optLevel);
	const cart = writeTestBlua32Rom(linked), cartPath = join(dir, 'string-char.rom');
	writeFileSync(cartPath, cart);
	const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler, gxGpu } = runtime.machine, frames = runtime.frameScheduler;
	const trace = new Trace(native, join(dir, 'string-char.trace'), cartPath);
	const report = linked.layout.header.bssAddress;
	for (let grant = 0; grant < 2048 && memory.readMappedU32LE(report) === 0; ++grant) {
		if (gxGpu.backendCommandDrainPending()) {
			gxGpu.retireExecutedCommands();
			trace.observe('>');
		}
		const before = scheduler.nowCycles, tick = frames.lastTickSequence;
		const complete = frames.runCyclesToNextLogicalTick(65536);
		trace.observe('p 65536', [
			+complete, scheduler.nowCycles - before, frames.lastTickSequence - tick,
			+cpu.heapServiceActive(), +cpu.isHaltedUntilIrq(),
		].join(' '));
	}
	assert.equal(memory.readMappedU32LE(report), 43);
	assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
	trace.observe(`M ${report}`, '43 0');
	trace.replay('stock string.char with fixed, open and protected argument windows', rom);
}

function verifyRegisterWindowGrowth(rom: string, native: string, dir: string, optLevel: OptimizationLevel): void {
	const system = readFileSync(rom);
	const width = 1100, returned = Array.from({ length: width }, (_, slot) => `input+${slot + 1}`).join(',');
	const source = `bss report: word
mem[${IO_IRQ_MASK}] = 0
local function wide(input) return ${returned} end
local functions = { wide }
*report = functions[1](41)
halt_until_irq
`;
	const linked = compileCartridge(system, source, 'window-growth.lua', optLevel);
	const cart = writeTestBlua32Rom(linked), cartPath = join(dir, 'window-growth.rom');
	writeFileSync(cartPath, cart);
	const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler, gxGpu } = runtime.machine, frames = runtime.frameScheduler;
	const trace = new Trace(native, join(dir, 'window-growth.trace'), cartPath);
	const report = linked.layout.header.bssAddress;
	const early = { issue: 0, before: 0, after: 0, required: 0, deadline: 0 };
	cpu.setExecutionHook((_domain, pc) => {
		if (cpu.readCauseWord() !== CPU_CAUSE_CODE_REGISTER_WINDOW || cpu.readEpcWord() >= CART_ROM_BASE) return false;
		const current = memory.readRamRecordWord(cpu.rootThread.address + ThreadField.StackCapacity);
		if (early.issue === 0 && cpu.fixedInterruptActive() && cpu.getFrameDepth() === 1) {
			early.issue = cpu.readEpcWord();
			early.before = current;
			early.required = asInteger(cpu.readFrameRegister(0, 0));
			early.deadline = asInteger(cpu.readFrameRegister(0, 3));
		}
		if (early.issue === pc && !cpu.fixedInterruptActive() && early.after === 0) early.after = current;
		return false;
	}, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
	for (let grant = 0; grant < 2048 && memory.readMappedU32LE(report) === 0; ++grant) {
		if (gxGpu.backendCommandDrainPending()) {
			gxGpu.retireExecutedCommands();
			trace.observe('>');
		}
		const before = scheduler.nowCycles, tick = frames.lastTickSequence;
		const complete = frames.runCyclesToNextLogicalTick(65536);
		trace.observe('p 65536', [
			+complete, scheduler.nowCycles - before, frames.lastTickSequence - tick,
			+cpu.heapServiceActive(), +cpu.isHaltedUntilIrq(),
		].join(' '));
	}
	assert.ok(early.before > 0 && early.before < early.required && early.after >= early.required,
		'the first managed System CALL faults, grows its window and retries before startup completes');
	assert.equal(decodeBlua32InstructionAtPc(system, SYSTEM_ROM_BASE, early.issue).op, OpCode.CALL);
	assert.ok(early.deadline > 0 && early.deadline < 0x7fff_ffff, 'firmware received an actual device deadline');
	assert.equal(memory.readMappedU32LE(report), 42);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_REGISTER_WINDOW);
	assert.equal(cpu.readLuaFaultReasonWord(), 0);
	assert.equal(cpu.fixedInterruptActive(), false);
	assert.equal(cpu.activeCartridgeSlot(), 0);
	const epc = cpu.readEpcWord(), root = cpu.rootThread.address, offset = root - RAM_BASE;
	assert.equal(decodeBlua32InstructionAtPc(cart, CART_ROM_BASE, epc).op, OpCode.CALL);
	assert.ok(memory.readRamRecordWord(root + ThreadField.StackCapacity) >= width);
	trace.observe(`M ${report}`, '42 0');
	trace.observe('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} 0 ${epc}`);
	trace.observe(`H ${offset} ${offset + THREAD_HEAP_BYTES}`, hashBytes(memory.ramData(), offset, THREAD_HEAP_BYTES));
	trace.replay('ordinary startup and cartridge register-window growth', rom);
}

function verifyExceptionBridge(rom: string, native: string, dir: string, optLevel: OptimizationLevel): void {
	const system = readFileSync(rom);
	const cart = writeTestBlua32Rom(compileCartridge(system,
		`error('detached trap: ' .. (mem[${IO_IRQ_MASK}] & 0xff))`, 'detached-trap.lua', optLevel));
	const cartPath = join(dir, 'detached-trap.rom');
	writeFileSync(cartPath, cart);
	const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler, gxGpu } = runtime.machine;
	const fixedTrap = () => cpu.activeThread.address === CPU_RESET_BANK_ADDRESS && cpu.readCauseWord() === CPU_CAUSE_CODE_TRAP;
	cpu.setExecutionHook(fixedTrap, executionDomainBit(SYSTEM_EXECUTION_DOMAIN_ID), 0);
	for (let grant = 0; grant < 2048 && !fixedTrap(); ++grant) {
		if (gxGpu.backendCommandDrainPending()) gxGpu.retireExecutedCommands();
		runtime.frameScheduler.runCyclesToNextLogicalTick(65536);
	}
	cpu.setExecutionHook(null, 0, 0);
	assert.ok(fixedTrap(), 'unhandled Lua error entered the fixed System vector');
	const owner = memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS);
	const argument = cpu.activeThread.currentFrame!.registers.get(0);
	assert.equal(valueTag(argument), ValueTag.String);
	const thrown = valuePayload(argument);
	assert.equal(memory.readRamRecordByte(owner + ThreadField.ErrorKind), ValueTag.Nil,
		'the CPU put the error in the exception argument, not the interrupted Thread record');
	assert.match(cpu.stringPool.toString(thrown), /^detached trap: \d+$/);
	const checkpoint = join(dir, 'detached-trap.state');
	writeFileSync(checkpoint, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	const trace = new Trace(native, join(dir, 'detached-trap.trace'), cartPath);
	trace.observe('X');
	function step() {
		const result = scheduler.runCpuSlice(0, 1, 0, CpuRunKind.Scheduled);
		trace.observe('L 1', [result, 1 - cpu.instructionBudgetRemaining, +cpu.heapServiceActive(),
			cpu.gc.fullEpochs(), cpu.gc.phase(), cpu.luaHeap.usedBytes()].join(' '));
	}
	for (let grant = 0; grant < 20000 && fixedTrap(); ++grant) step();
	assert.equal(cpu.activeThread.address, owner);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
	const frame = cpu.activeThread.currentFrame!;
	assert.equal(frame.isExceptionFrame, true);
	assert.equal(frame.registers.get(0), valueNil(), 'changing the vector does not synthesize an argument');
	assert.equal(memory.readRamRecordByte(owner + ThreadField.ErrorKind), ValueTag.String);
	assert.equal(memory.readRamRecordWord(owner + ThreadField.ErrorWord), thrown);
	const offset = owner - RAM_BASE + ThreadField.ErrorWord;
	trace.observe(`H ${offset} ${offset + 8}`, hashBytes(memory.ramData(), offset, 8));
	for (let grant = 0; grant < 2000 && memory.readRamRecordByte(owner + ThreadField.ErrorKind) !== ValueTag.Nil; ++grant) step();
	assert.equal(memory.readRamRecordByte(owner + ThreadField.ErrorKind), ValueTag.Nil, 'the guest monitor consumes the saved Value');
	assert.equal(memory.readRamRecordWord(owner + ThreadField.ErrorWord), 0);
	trace.observe(`H ${offset} ${offset + 8}`, hashBytes(memory.ramData(), offset, 8));
	trace.replay('resume the fixed firmware bridge with the original tagged trap argument', rom, checkpoint);
}

function verifyWarmReset(rom: string, native: string, dir: string, optLevel: OptimizationLevel): void {
	const sys = readFileSync(rom);
	const expectedReport = 29 * 371 + 17;
	const source = `bss cart_report: word
	local retainer
	local function running(seed)
		local captured = seed * 371 + 17
		retainer = function() return captured end
		*cart_report = captured
		halt_until_irq
		captured = captured + 71
		return captured
	end
	mem[${IO_IRQ_MASK}] = 0
	local callee = coroutine.create(running)
	local ok<const> = coroutine.resume(callee, 29)
	if not ok then *cart_report = -1 end
	`;
	const linked = compileCartridge(sys, source, 'warm-reset-cart.lua', optLevel);
	const cart = writeTestBlua32Rom(linked);
	const cartPath = join(dir, 'cart.rom');
	writeFileSync(cartPath, cart);
	const rt = new Runtime({ systemRomBytes: sys, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, input);
	const { cpu, memory, scheduler, gxGpu } = rt.machine, arena = cpu.heapAllocator, frames = rt.frameScheduler;
	const management = arena.managementOffset(), report = linked.layout.header.bssAddress;
	const nativePartial = join(dir, 'warm-native.state');
	const tsPartial = join(dir, 'warm-ts.state');
	const trace = new Trace(native, join(dir, 'warm-reset.trace'), cartPath);
	const { commands, expected } = trace;
	function fingerprint(first: number, bytes: number) {
		const digest = hashBytes(memory.ramData(), first, bytes);
		trace.observe(`H ${first} ${first + bytes}`, digest);
		return digest;
	}
	function runFrame(grant: number) {
		if (gxGpu.backendCommandDrainPending()) {
			gxGpu.retireExecutedCommands();
			trace.observe('>');
		}
		const before = scheduler.nowCycles, tick = frames.lastTickSequence;
		const done = frames.runCyclesToNextLogicalTick(grant);
		trace.observe(`p ${grant}`, `${+done} ${scheduler.nowCycles - before} ${frames.lastTickSequence - tick} ${+cpu.heapServiceActive()} ${+cpu.isHaltedUntilIrq()}`);
	}
	function runUntilCartHalt() {
		for (let i = 0; i < 2048 && (!cpu.isHaltedUntilIrq() || cpu.activeCartridgeSlot() !== 0 || memory.readMappedWord(report) !== expectedReport); ++i) runFrame(65536);
		assert.equal(cpu.activeCartridgeSlot(), 0);
		assert.equal(cpu.isHaltedUntilIrq(), true);
		assert.equal(memory.readMappedWord(report), expectedReport);
	}
	function rawGrant(cycles: number) {
		const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
		assert.equal(result, RunResult.Yielded);
		assert.equal(cpu.heapServiceActive(), false);
		trace.observe(`L ${cycles}`, [result, cycles - cpu.instructionBudgetRemaining, 0, cpu.gc.fullEpochs(), cpu.gc.phase(), cpu.luaHeap.usedBytes()].join(' '));
	}
	rt.boot();
	assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	assert.equal(cpu.heapAllocator.occupiedBytes(), 0);
	assert.equal(cpu.luaHeap.usedBytes(), 0);
	// Native executes this same trace from its own reset, not from TS's initial state.
	trace.observe('P', `1 ${cpu.readFramePc(0)}`);
	fingerprint(management + HEAP_LOGICAL_OCCUPIED_OFFSET, 4);
	fingerprint(arena.allocatorStateOffset(), 24);
	const bindings = management + EXECUTION_IMAGE_BINDINGS_OFFSET;
	fingerprint(bindings, bindingBytes);
	runUntilCartHalt();
	const root = cpu.rootThread.address, active = cpu.activeThread.address;
	assert.notEqual(root, active, 'hardware is running a real separate coroutine');
	const oldFrame = cpu.activeThread.currentFrame!.controlOffset;
	const cell = memory.readRamRecordWord(oldFrame + FrameField.OpenHead);
	assert.notEqual(cell, 0);
	assert.equal(isOpen(memory, cell), true);
	const diagnostics = management + HEAP_SERVICE_REMARK_HEAD_OFFSET + HeapServiceRemarkHeadField.Index;
	const key = memory.readRamRecordWord(diagnostics);
	const indexTag = management + HEAP_SERVICE_REMARK_HEAD_OFFSET + HeapServiceRemarkHeadField.StringIndexTag;
	const indexWord = management + HEAP_SERVICE_REMARK_HEAD_OFFSET + HeapServiceRemarkHeadField.StringIndexWord;
	const index = memory.readRamRecordWord(indexWord);
	assert.equal(memory.readRamRecordWord(indexTag), ValueTag.Table);
	assert.notEqual(index, 0);
	const orphan = cpu.stringPool.intern('warm_gc_orphan');
	trace.observe('b warm_gc_orphan', orphan);
	const canaryAddress = DYNAMIC_RAM_BASE - 4, canary = 0x5a792267;
	memory.writeMappedWord(canaryAddress, canary);
	trace.observe(`O ${canaryAddress} ${canary}`);
	const preserved = [
		[root - RAM_BASE, THREAD_HEAP_BYTES], [active - RAM_BASE, THREAD_HEAP_BYTES],
		[cell - RAM_BASE, UPVALUE_HEAP_BYTES], [bindings, bindingBytes],
	] as const;
	const beforeReset = preserved.map(([base, len]) => fingerprint(base, len));
	assert.equal(scheduler.acceptedCpuCycles, 0);
	memory.writeMappedWord(IO_SYS_CONTROL, SYS_CONTROL_RESET);
	trace.observe(`O ${IO_SYS_CONTROL} ${SYS_CONTROL_RESET}`);
	const prior = scheduler.nowCycles, tick = frames.lastTickSequence;
	const step = frames.stepInstruction(1);
	trace.observe('d', [step, scheduler.nowCycles - prior, +(frames.lastTickSequence !== tick), +cpu.heapServiceActive(),
		memory.readRamRecordWord(management + HEAP_SERVICE_CLOSURE_OFFSET), memory.readIoU32(IO_IRQ_FLAGS),
		arena.occupiedBytes(), cpu.luaHeap.usedBytes()].join(' '));
	assert.equal(scheduler.nowCycles, 0);
	assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	assert.deepEqual([cpu.captureRuntimeState().previousRootContextWord, cpu.captureRuntimeState().previousActiveContextWord], [root, active]);
	assert.equal(memory.readRamRecordWord(indexWord), index, 'hardware reset does not clear the firmware String binding');
	fingerprint(indexTag, 8);
	assert.deepEqual(preserved.map(([base, len]) => fingerprint(base, len)), beforeReset, 'hardware reset must not run the language cleanup');
	const oldSlot = memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD);
	trace.observe('l');
	for (let i = 0; i < 4096 && isOpen(memory, cell); ++i) rawGrant(1);
	assert.equal(isOpen(memory, cell), false, 'guest retired the capture open bit');
	assert.equal(memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD), oldSlot, 'the capture payload store has not issued');
	assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	assert.equal(cpu.captureRuntimeState().previousRootContextWord, root);
	assert.equal(memory.readRamRecordWord(indexTag), ValueTag.Nil);
	assert.equal(memory.readRamRecordWord(indexWord), 0, 'the reset program clears the old binding');
	fingerprint(indexTag, 8);
	trace.observe('s');
	trace.observe(`x ${nativePartial}`);
	const partial = captureRuntimeSaveState(rt);
	writeFileSync(tsPartial, encodeRuntimeSaveState(partial));
	const start = commands.length, resultsStart = expected.length;
	function finishWarmBoot() {
		runUntilCartHalt();
		assert.equal(cpu.rootThread.address, root);
		assert.equal(cpu.captureRuntimeState().previousRootContextWord, 0);
		assert.equal(memory.readRamRecordWord(diagnostics), key);
		assert.equal(memory.readRamRecordWord(indexTag), ValueTag.Table);
		assert.notEqual(memory.readRamRecordWord(indexWord), 0);
		assert.equal(cpu.stringPool.find('warm_gc_orphan'), undefined);
		assert.equal(memory.readMappedWord(canaryAddress), canary);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		trace.observe(`M ${canaryAddress}`, `${canary} 0`);
		trace.observe(`M ${report}`, `${expectedReport} 0`);
		fingerprint(diagnostics, 4);
		fingerprint(indexTag, 8);
		fingerprint(bindings, bindingBytes);
		fingerprint(root - RAM_BASE, THREAD_HEAP_BYTES);
		fingerprint(management + HEAP_GC_CONTROL_OFFSET, 80);
	}
	finishWarmBoot();
	const tail = commands.slice(start), tailResults = expected.slice(resultsStart);
	commands.push('u', ...tail); expected.push(...tailResults);
	trace.replay('independent cold boot and native hardware history', rom);
	commands.splice(0, commands.length, 'X', ...tail);
	expected.splice(0, expected.length, ...tailResults);
	trace.replay('TS to native warm retirement', rom, tsPartial);
	applyRuntimeSaveState(rt, decodeRuntimeSaveState(readFileSync(nativePartial), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	commands.length = 0;
	expected.length = 0;
	finishWarmBoot();
	assert.deepEqual(expected, tailResults, 'C++→TS partial warm retire');

	applyRuntimeSaveState(rt, partial);
	commands.splice(0, commands.length, 'X');
	expected.length = 0;
	assert.equal(cpu.captureRuntimeState().statusWord & CPU_STATUS_INHIBIT_RESET, CPU_STATUS_INHIBIT_RESET);
	for (let request = 0; request < 2; ++request) {
		memory.writeMappedWord(IO_SYS_CONTROL, SYS_CONTROL_RESET);
		trace.observe(`O ${IO_SYS_CONTROL} ${SYS_CONTROL_RESET}`);
	}
	const secondBefore = scheduler.nowCycles, secondTick = frames.lastTickSequence;
	const held = frames.stepInstruction(1);
	trace.observe('d', [held, scheduler.nowCycles - secondBefore, +(frames.lastTickSequence !== secondTick),
		+cpu.heapServiceActive(),
		memory.readRamRecordWord(management + HEAP_SERVICE_CLOSURE_OFFSET), memory.readIoU32(IO_IRQ_FLAGS),
		arena.occupiedBytes(), cpu.luaHeap.usedBytes()].join(' '));
	assert.ok(scheduler.nowCycles >= secondBefore);
	assert.equal(rt.machine.systemController.hasResetRequest(), true, 'a second RESET remains pending');
	assert.equal(cpu.captureRuntimeState().previousActiveContextWord, active);
	assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	assert.notEqual(cpu.getFrameDepth(), 1, 'the old reset vector has not been entered again');
	// The request remains coalesced until the ordinary receiving firmware
	// releases inhibit. At that boundary it resets once with a new previous bank.
	for (let i = 0; i < 4096 && rt.machine.systemController.hasResetRequest(); ++i) runFrame(1024);
	assert.equal(rt.machine.systemController.hasResetRequest(), false, `pending at cycle ${scheduler.nowCycles}, inhibit ${cpu.systemResetInhibited()}, board ${cpu.rootThread.address.toString(16)}, PC ${cpu.readFramePc(cpu.getFrameDepth()-1).toString(16)}`);
	assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	assert.equal(cpu.captureRuntimeState().previousRootContextWord, root);
	assert.equal(cpu.captureRuntimeState().previousActiveContextWord, root,
		'only the newly published context can be reset next');
	finishWarmBoot();
	trace.replay('coalesced reset waits across an interrupted RAM mutation', rom, tsPartial);
}

function verifyResetDuringTableGrowth(rom: string, native: string, dir: string, optLevel: OptimizationLevel): void {
	const system = readFileSync(rom);
	const source = `bss start_growth: word
		bss progress: word
		mem[${IO_IRQ_MASK}] = 0
		local values = {}
		for i = 1, 1024 do values[i] = i + 3 end
		*progress = 1024
		while *start_growth == 0 do end
		values[1025] = 17
		*progress = values[1] + values[1024] + values[1025]
		halt_until_irq
	`;
	const image = compileCartridge(system, source, 'reset-table-growth-cart.lua', optLevel);
	const cart = writeTestBlua32Rom(image), cartPath = join(dir, 'reset-growth-cart.rom');
	writeFileSync(cartPath, cart);
	const rt = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, input);
	const { cpu, memory, scheduler, gxGpu, systemController } = rt.machine, frames = rt.frameScheduler;
	const { heapAllocator: arena } = cpu, scratch = arena.managementOffset();
	const gate = image.layout.header.bssAddress, progress = gate + 4;
	const tsState = join(dir, 'reset-growth-ts.state'), nativeState = join(dir, 'reset-growth-native.state');
	const trace = new Trace(native, join(dir, 'reset-growth.trace'), cartPath);
	const { commands, expected } = trace;
	function grant(cycles: number) {
		if (gxGpu.backendCommandDrainPending()) {
			gxGpu.retireExecutedCommands();
			trace.observe('>');
		}
		const before = scheduler.nowCycles, tick = frames.lastTickSequence;
		const done = frames.runCyclesToNextLogicalTick(cycles);
		trace.observe(`p ${cycles}`, `${+done} ${scheduler.nowCycles - before} ${frames.lastTickSequence - tick} ${+cpu.heapServiceActive()} ${+cpu.isHaltedUntilIrq()}`);
	}
	function fingerprint(address: number, count: number) {
		const first = address - RAM_BASE;
		trace.observe(`H ${first} ${first + count}`, hashBytes(memory.ramData(), first, count));
	}
	rt.boot();
	for (let i = 0; i < 1024 && memory.readMappedWord(progress) !== 1024; ++i) grant(65536);
	assert.equal(memory.readMappedWord(progress), 1024);
	assert.equal(cpu.activeCartridgeSlot(), 0);
	assert.equal(cpu.heapServiceActive(), false);
	const root = cpu.rootThread.address;
	memory.writeMappedWord(gate, 1);
	trace.observe(`O ${gate} 1`);
	function issueGrant() {
		const result = scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled);
		trace.observe('E 1', `${result} ${1 - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		assert.equal(result, RunResult.Yielded);
	}
	const stopped = cpu.activeThread, frame = stopped.currentFrame!, depth = stopped.frameDepth;
	const decode = () => decodeBlua32InstructionAtPc(cart, CART_ROM_BASE, frame.pc);
	for (let i = 0; i < 32 && decode().op !== OpCode.SETI && decode().op !== OpCode.SETT; ++i) issueGrant();
	const issue = frame.pc, write = decode();
	assert.ok(write.op === OpCode.SETI || write.op === OpCode.SETT);
	const receiver = valuePayload(frame.registers.get(write.a));
	const successor = write.pc + INSTRUCTION_BYTES;
	assert.equal(memory.readRamRecordWord(receiver + TableHeader.Array), 1024);
	issueGrant();
	assert.equal(cpu.fixedInterruptActive(), true);
	assert.equal(cpu.heapServiceActive(), false);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_STORAGE_WINDOW);
	assert.equal(cpu.readEpcWord(), issue);
	assert.equal(cpu.readThreadFrameWord(stopped.address, depth - 1, FrameField.Pc), successor);
	const request = cpu.activeThread.currentFrame!;
	assert.equal(request.argumentCount, 5);
	assert.deepEqual([request.registers.get(0), request.registers.get(1), request.registers.get(2), request.registers.get(3)],
		[valueTable(receiver), valueInteger(1025), valueInteger(17), valueInteger(0)]);
	assert.equal(valueTag(request.registers.get(4)), ValueTag.Integer);
	trace.observe('Z', `${CPU_CAUSE_CODE_STORAGE_WINDOW} 0 ${issue}`);
	function partialTransfer() {
		if (!cpu.fixedInterruptActive()) return false;
		// The firmware's own staged rebuild job holds the candidate backing.
		// Do not infer progress from a host continuation.
		const storage = memory.readRamRecordWord(scratch + 16);
		if (memory.readRamRecordWord(scratch + 20) !== 2048 || memory.readRamRecordWord(scratch + 36) !== 1025
			|| memory.readRamRecordWord(receiver + TableHeader.Array) !== 1024) return false;
		const tags = storage + 4 * 2048;
		return (memory.readRamRecordByte(tags) === ValueTag.Integer)
			!== (memory.readRamRecordByte(tags + 1023) === ValueTag.Integer);
	}
	for (let i = 0; i < 4096 && !partialTransfer(); ++i) grant(31);
	assert.equal(partialTransfer(), true, 'stop between actual Array tag-plane stores, before publishing the new header');
	const storage = memory.readRamRecordWord(scratch + 16);
	fingerprint(receiver, 36);
	fingerprint(storage + 4 * 2048, 1024);
	memory.writeMappedWord(IO_SYS_CONTROL, SYS_CONTROL_RESET);
	trace.observe(`O ${IO_SYS_CONTROL} ${SYS_CONTROL_RESET}`);
	const beforeHeld = scheduler.nowCycles;
	for (let i = 0; i < 8 && scheduler.nowCycles === beforeHeld; ++i) grant(31);
	assert.ok(scheduler.nowCycles > beforeHeld, 'the in-flight guest instruction still consumes cycles');
	assert.equal(systemController.hasResetRequest(), true);
	assert.equal(cpu.rootThread.address, root);
	assert.equal(cpu.fixedInterruptActive(), true);
	assert.equal(cpu.heapServiceActive(), false);
	trace.observe('l');
	trace.observe('s');
	trace.observe(`x ${nativeState}`);
	const partial = captureRuntimeSaveState(rt);
	writeFileSync(tsState, encodeRuntimeSaveState(partial));
	const first = commands.length, observations = expected.length;
	function finish() {
		for (let i = 0; i < 4096 && systemController.hasResetRequest(); ++i) grant(31);
		assert.equal(systemController.hasResetRequest(), false);
		assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		assert.equal(cpu.captureRuntimeState().previousRootContextWord, root);
		assert.equal(memory.readRamRecordWord(receiver + TableHeader.ArrayStorage), storage);
		assert.equal(memory.readRamRecordWord(receiver + TableHeader.Array), 2048);
		assert.equal(cpu.gc.tables.get(receiver, valueInteger(1)), valueInteger(4));
		assert.equal(cpu.gc.tables.get(receiver, valueInteger(1024)), valueInteger(1027));
		assert.equal(cpu.gc.tables.get(receiver, valueInteger(1025)), valueInteger(17));
		fingerprint(receiver, 36);
		fingerprint(storage, 5 * 2048);
	}
	finish();
	const tail = commands.slice(first), tailResults = expected.slice(observations);
	commands.push('u', ...tail);
	expected.push(...tailResults);
	trace.replay('native hardware reset after Array publication and native rewind', rom);
	commands.splice(0, commands.length, 'X', ...tail);
	expected.splice(0, expected.length, ...tailResults);
	trace.replay('TS→C++ reset pending midway through Array tag move', rom, tsState);
	applyRuntimeSaveState(rt, decodeRuntimeSaveState(readFileSync(nativeState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	commands.length = expected.length = 0;
	finish();
	assert.deepEqual(expected, tailResults, 'C++→TS sees the same publication and reset boundary');
}

function verifyWarmFloor(rom: string, native: string, dir: string, optLevel: OptimizationLevel, retainsBlocker: boolean): void {
	const original = readFileSync(rom);
	const replacement = new Uint8Array(original);
	const image = readLE32(replacement, BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET);
	const newFloor = 0x08140000;
	const bssAddress = readLE32(replacement, image + BLUA32_IMAGE_BSS_ADDRESS_OFFSET);
	writeLE32(replacement, image + BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET, newFloor - bssAddress);
	const replacementPath = join(dir, 'replacement.rom');
	writeFileSync(replacementPath, replacement);
	const blockerText = 'J'.repeat(0x340000);
	const shortLiteral = 'Old cartridge binding is the only remaining root for this canonical RAM String.';
	const label = retainsBlocker ? 'terminal' : 'reclaimed';
	// A physical placement fixture need not match a multi-megabyte literal.
	// Put its only canonical root below the proposed floor with an ordinary
	// allocator extent, and release that extent before the binding.
	const literal = retainsBlocker ? shortLiteral + 's'.repeat(0x3000) : shortLiteral;
	const source = `bss booted: word
mem[${IO_IRQ_MASK}] = 0
local literal = "${literal}"
*booted = #literal
halt_until_irq`;
	const linked = compileCartridge(original, source, 'warm-floor-cart.lua', optLevel);
	const cart = writeTestBlua32Rom(linked);
	const cartPath = join(dir, label + '.cart');
	writeFileSync(cartPath, cart);
	const rt = new Runtime({ systemRomBytes: original, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, input);
	const { cpu, memory, scheduler, gxGpu } = rt.machine, arena = cpu.heapAllocator, frames = rt.frameScheduler;
	const management = arena.managementOffset(), cartBinding = executionImageBindingOffset(management, 0);
	const trace = new Trace(native, join(dir, label + '.trace'), cartPath);
	const { commands, expected } = trace;
	const seedPath = join(dir, label + '-cart.state');
	const tsPartial = join(dir, label + '-ts.state');
	const nativePartial = join(dir, label + '-native.state');
	function grant(cycles: number) {
		const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
		assert.equal(cpu.heapServiceActive(), false);
		trace.observe(`L ${cycles}`, [result, cycles - cpu.instructionBudgetRemaining, 0, cpu.gc.fullEpochs(), cpu.gc.phase(), cpu.luaHeap.usedBytes()].join(' '));
	}
	function fingerprint(offset: number, length: number) {
		trace.observe(`H ${offset} ${offset + length}`, hashBytes(memory.ramData(), offset, length));
	}
	rt.boot();
	let alias = 0, blocker = 0, root = 0, initialFloor = 0;
	cpu.setExecutionHook((_domain, pc) => {
		const word = readLE32(original, pc);
		if (alias === 0 && cpu.rootThread.address !== CPU_RESET_BANK_ADDRESS
			&& instructionOpcode(word) === OpCode.MTC0 && instructionLowB(word) === COP0_RAM_END) {
			root = cpu.rootThread.address;
			initialFloor = memory.ramBusEnd();
			cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
			if (retainsBlocker) {
				const spacer = arena.allocate(0x2c0000, true);
				assert.notEqual(spacer, 0);
				alias = cpu.stringPool.intern(literal);
				arena.free(spacer);
				blocker = alias;
			} else {
				alias = cpu.stringPool.intern(literal);
				blocker = cpu.stringPool.intern(blockerText);
			}
		}
		return false;
	}, executionDomainBit(SYSTEM_EXECUTION_DOMAIN_ID), 0);
	for (let i = 0; i < 2048 && (cpu.activeCartridgeSlot() !== 0 || !cpu.isHaltedUntilIrq()); ++i) {
		if (gxGpu.backendCommandDrainPending()) gxGpu.retireExecutedCommands();
		frames.runCyclesToNextLogicalTick(65536);
	}
	cpu.setExecutionHook(null, 0, 0);
	assert.ok(alias >= RAM_BASE && blocker < newFloor && blocker > initialFloor,
		'seeded an allocated blocker immediately before outgoing cart admission');
	assert.equal(cpu.activeCartridgeSlot(), 0);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	assert.equal(memory.readMappedWord(linked.layout.header.bssAddress), literal.length);
	const oldImageRecord = memory.readRamRecordWord(cartBinding);
	const outgoingStrings = memory.readRamRecordWord(cartBinding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET);
	assert.equal(outgoingStrings, oldImageRecord + 4 * (linked.layout.header.globalNameCount + linked.layout.header.systemGlobalNameCount));
	assert.equal(memory.readRamRecordWord(cartBinding + EXECUTION_IMAGE_BINDING_RAM_STRINGS_OFFSET), 1);
	assert.equal(memory.readRamRecordWord(outgoingStrings) & ~IMAGE_STRING_RAM_ORDINAL, alias, 'outgoing ROM uploaded the exact canonical RAM id');
	assert.equal(memory.readRamRecordWord(cartBinding + 4), 4 * (linked.layout.header.globalNameCount + linked.layout.header.systemGlobalNameCount + 1));
	if (!retainsBlocker) {
		cpu.gc.step(valueString(blocker), valueNil(), valueNil(), 0, false, 1);
		assert.equal(cpu.gc.phase(), GcPhase.Mark);
	}
	writeFileSync(seedPath, encodeRuntimeSaveState(captureRuntimeSaveState(rt)));
	memory.installSystemRom(replacement);
	rt.rebootSystem();
	assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	assert.equal(cpu.captureRuntimeState().previousRootContextWord, root);
	assert.equal(memory.ramBusEnd(), initialFloor);
	assert.equal(memory.readRamRecordWord(cartBinding), oldImageRecord);
	commands.push('X', `^ ${replacementPath}`);
	// The privilege handoff can consume one arbitrary cycle at a time. Cut a
	// genuine stopped collector phase, rather than its entry/return boundary.
	for (let i = 0; i < 20000 && cpu.gc.phase() !== GcPhase.Sweep; ++i) grant(64);
	assert.equal(cpu.gc.phase(), GcPhase.Sweep, 'checkpoint while the stopped collector is traversing the object list');
	assert.equal(memory.readRamRecordWord(cartBinding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET), outgoingStrings, 'stopped marking borrows the still-installed String backing');
	assert.equal(memory.ramBusEnd(), initialFloor);
	assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	trace.observe(`x ${nativePartial}`);
	writeFileSync(tsPartial, encodeRuntimeSaveState(captureRuntimeSaveState(rt)));
	const start = commands.length, before = expected.length;
	function finishFloorRecovery() {
		for (let i = 0; i < 4096 && memory.ramBusEnd() === initialFloor && !cpu.isHaltedUntilIrq(); ++i) grant(1024);
		assert.equal(cpu.gc.phase(), GcPhase.Pause, 'the stopped floor pass finished its collection');
		assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		assert.equal(memory.ramBusEnd(), retainsBlocker ? initialFloor : newFloor);
		assert.equal(cpu.isHaltedUntilIrq(), retainsBlocker);
		assert.equal(cpu.captureRuntimeState().hardHalted, false);
		trace.observe('F', 0);
		assert.equal(cpu.stringPool.find(literal), alias, 'outgoing image-only canonical root survives the stopped pass');
		if (!retainsBlocker) assert.equal(cpu.stringPool.find(blockerText), undefined);
		if (retainsBlocker) {
			assert.equal(memory.readRamRecordWord(cartBinding), oldImageRecord);
			assert.equal(memory.readIoU32(IO_SYS_STATUS) & (SYS_STATUS_SUPERVISOR_ACTIVE | SYS_STATUS_SUPERVISOR_RESUMABLE),
				SYS_STATUS_SUPERVISOR_ACTIVE, 'terminal refusal parked in a non-resumable hardware supervisor fault');
			trace.observe(`M ${IO_SYS_STATUS}`, `${memory.readIoU32(IO_SYS_STATUS)} 0`);
		}
		fingerprint(cartBinding, EXECUTION_IMAGE_BINDING_SIZE);
		fingerprint(alias - RAM_BASE, 16);
		fingerprint(management + HEAP_STRING_METADATA_OFFSET, HEAP_GC_CONTROL_OFFSET - HEAP_STRING_METADATA_OFFSET);
		fingerprint(management + HEAP_LOGICAL_OCCUPIED_OFFSET, HEAP_SERVICE_ROOT_BANKS_OFFSET - HEAP_LOGICAL_OCCUPIED_OFFSET);
	}
	finishFloorRecovery();
	const tail = commands.slice(start), tailResults = expected.slice(before);
	trace.replay(label + ': native floor from shared cart state', rom, seedPath);
	commands.splice(0, commands.length, 'X', ...tail);
	expected.splice(0, expected.length, ...tailResults);
	trace.replay(label + ': TS to native stopped floor replay', replacementPath, tsPartial);
	applyRuntimeSaveState(rt, decodeRuntimeSaveState(readFileSync(nativePartial), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	commands.length = 0;
	expected.length = 0;
	finishFloorRecovery();
	assert.deepEqual(expected, tailResults, 'native to TS cold-bank floor replay');

	if (retainsBlocker) {
		assert.equal(cpu.systemResetInhibited(), false, 'a completed refusal no longer owns the reset interlock');
		// Reinstall the original firmware; this is a fresh system reset, not
		// an exit from the terminal supervisor or a host retry of the floor.
		memory.installSystemRom(readFileSync(rom));
		rt.rebootSystem();
		commands.unshift('X');
		trace.observe(`^ ${rom}`);
		assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		assert.equal(cpu.captureRuntimeState().previousRootContextWord, root);
		assert.equal(memory.readRamRecordWord(cartBinding), oldImageRecord);
		for (let i = 0; i < 4096 && cpu.rootThread.address === CPU_RESET_BANK_ADDRESS; ++i) grant(1024);
		assert.equal(cpu.rootThread.address, root);
		assert.equal(memory.ramBusEnd(), initialFloor);
		fingerprint(cartBinding, EXECUTION_IMAGE_BINDING_SIZE);
		trace.replay('terminal refusal leaves the previous image intact for a new system reset', replacementPath, tsPartial);
	}
}

function verifyWarmBinding(rom: string, native: string, dir: string, optLevel: OptimizationLevel, reclaim: boolean): void {
	const original = readFileSync(rom);
	const header = readLE32(original, BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET);
	const globals = readLE32(original, header + BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET);
	const names = readLE32(original, header + BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET);
	assert.ok(globals > 0);
	// Enlarge the binding span without changing the program's original name
	// ordinals. Repeated Name IDs are valid and must bind to the same slot.
	const ordinals = 8192;
	const mapped = (original.length + 3) & ~3;
	const replacement = new Uint8Array(mapped + 4 * ordinals);
	replacement.set(original);
	replacement.set(original.subarray(names, names + 4 * globals), mapped);
	for (let slot = globals; slot < ordinals; ++slot) writeLE32(replacement, mapped + 4 * slot, readLE32(original, names));
	writeLE32(replacement, header + BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET, mapped);
	writeLE32(replacement, header + BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET, ordinals);
	const label = reclaim ? 'binding-reclaimed' : 'binding-terminal';
	const replacementPath = join(dir, label + '.rom');
	writeFileSync(replacementPath, replacement);
	const cart = writeTestBlua32Rom(compileCartridge(original, `mem[${IO_IRQ_MASK}] = 0\nhalt_until_irq`, 'warm-binding-cart.lua', optLevel));
	const cartPath = join(dir, label + '.cart');
	writeFileSync(cartPath, cart);
	const rt = new Runtime({ systemRomBytes: original, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, input);
	const { cpu, memory, scheduler, gxGpu } = rt.machine, arena = cpu.heapAllocator, frames = rt.frameScheduler;
	const management = arena.managementOffset(), installed = executionImageBindingOffset(management, SYSTEM_EXECUTION_DOMAIN_ID);
	const seedPath = join(dir, label + '.seed'), tsPartial = join(dir, label + '.ts'), nativePartial = join(dir, label + '.cpp');
	const trace = new Trace(native, join(dir, label + '.trace'), cartPath);
	const { commands, expected } = trace;
	function grant(cycles: number) {
		const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
		assert.equal(result, cpu.isHaltedUntilIrq() ? RunResult.Halted : RunResult.Yielded);
		assert.ok(cycles - cpu.instructionBudgetRemaining > 0, 'stopped guest work charges ordinary instructions');
		assert.equal(cpu.heapServiceActive(), false, 'the reset context itself executes the collection');
		trace.observe(`L ${cycles}`, [result, cycles - cpu.instructionBudgetRemaining, 0,
			cpu.gc.fullEpochs(), cpu.gc.phase(), cpu.luaHeap.usedBytes()].join(' '));
	}
	function fingerprint(offset: number, length: number) {
		trace.observe(`H ${offset} ${offset + length}`, hashBytes(memory.ramData(), offset, length));
	}
	rt.boot();
	for (let i = 0; i < 2048 && (cpu.activeCartridgeSlot() !== 0 || !cpu.isHaltedUntilIrq()); ++i) {
		if (gxGpu.backendCommandDrainPending()) gxGpu.retireExecutedCommands();
		frames.runCyclesToNextLogicalTick(65536);
	}
	assert.equal(cpu.activeCartridgeSlot(), 0);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	assert.equal(cpu.gc.phase(), GcPhase.Pause);
	const root = cpu.rootThread.address, floor = memory.ramBusEnd(), white = cpu.gc.white();
	cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
	const deadText = 'unreachable warm-reset binding blocker: ' + 'a'.repeat(0x28000);
	if (reclaim) assert.ok(cpu.stringPool.intern(deadText) >= RAM_BASE);
	while (arena.allocate(8192, true) !== 0) { /* non-GC allocations eliminate the remaining large free extents */ }
	assert.equal(cpu.gc.phase(), GcPhase.Pause);
	assert.equal(cpu.luaHeap.allocationDebt(4 * ordinals), 0, 'the fixture isolates physical refusal from logical admission');
	const fullEpochs = cpu.gc.fullEpochs(), oldBinding = memory.readRamRecordWord(installed);
	assert.notEqual(oldBinding, 0);
	writeFileSync(seedPath, encodeRuntimeSaveState(captureRuntimeSaveState(rt)));
	memory.installSystemRom(replacement);
	rt.rebootSystem();
	assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	assert.equal(memory.readRamRecordWord(installed), oldBinding);
	trace.observe('X');
	trace.observe('^ ' + replacementPath);
	for (let i = 0; i < 8192 && cpu.gc.phase() === GcPhase.Pause && !cpu.isHaltedUntilIrq(); ++i) grant(16);
	assert.equal(cpu.gc.phase(), GcPhase.Mark, 'the initial binding physically refused and entered guest collection');
	assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	assert.equal(memory.ramBusEnd(), floor, 'the requested floor did not need a recovery epoch');
	assert.equal(memory.readRamRecordWord(installed), 0, 'after retiring the old binding, before publishing the incoming binding');
	assert.equal(memory.readRamRecordWord(management + GLOBAL_BANK_OFFSET), 0, 'recovery precedes registering the incoming names');
	assert.equal(memory.readRamRecordWord(management + SYSTEM_GLOBAL_BANK_OFFSET), 0);
	trace.observe('l');
	trace.observe('s');
	trace.observe(`x ${nativePartial}`);
	writeFileSync(tsPartial, encodeRuntimeSaveState(captureRuntimeSaveState(rt)));
	const start = commands.length, before = expected.length;
	function finish() {
		for (let i = 0; i < 32768 && !cpu.isHaltedUntilIrq() &&
			(memory.readRamRecordWord(installed) === 0 || cpu.rootThread.address === CPU_RESET_BANK_ADDRESS); ++i) grant(2048);
		assert.equal(cpu.gc.phase(), GcPhase.Pause);
		assert.equal(cpu.gc.white(), white ^ 1, 'one fresh mark/sweep, not a second recovery epoch');
		assert.equal(cpu.gc.fullEpochs(), fullEpochs, 'allocation recovery is not an explicit Full collection');
		assert.equal(memory.ramBusEnd(), floor);
		const base = memory.readRamRecordWord(installed);
		if (reclaim) {
			assert.equal(cpu.rootThread.address, root);
			assert.ok(base >= RAM_BASE);
			assert.equal(cpu.stringPool.find(deadText), undefined);
			assert.equal(cpu.isHaltedUntilIrq(), false);
			assert.equal(memory.readRamRecordWord(base + 4 * (ordinals - 1)), memory.readRamRecordWord(base));
			fingerprint(base - RAM_BASE, 4 * ordinals);
		} else {
			assert.equal(base, 0);
			assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
			assert.equal(cpu.isHaltedUntilIrq(), true);
			const status = memory.readIoU32(IO_SYS_STATUS);
			assert.equal(status & (SYS_STATUS_SUPERVISOR_ACTIVE | SYS_STATUS_SUPERVISOR_RESUMABLE), SYS_STATUS_SUPERVISOR_ACTIVE);
			trace.observe(`M ${IO_SYS_STATUS}`, `${status} 0`);
			assert.equal(memory.readRamRecordWord(management + GLOBAL_BANK_OFFSET), 0);
		}
		fingerprint(installed, bindingBytes);
		fingerprint(management + HEAP_STRING_METADATA_OFFSET, HEAP_GC_CONTROL_OFFSET - HEAP_STRING_METADATA_OFFSET);
		fingerprint(management + HEAP_GC_CONTROL_OFFSET, HEAP_SERVICE_ROOT_BANKS_OFFSET - HEAP_GC_CONTROL_OFFSET);
	}
	finish();
	const tail = commands.slice(start), tailResults = expected.slice(before);
	commands.push('u', ...tail); expected.push(...tailResults);
	trace.replay(label + ': native reboot from the shared cartridge state and RAM rewind', rom, seedPath);
	commands.splice(0, commands.length, 'X', ...tail); expected.splice(0, expected.length, ...tailResults);
	trace.replay(label + ': TS to native initial binding replay', replacementPath, tsPartial);
	applyRuntimeSaveState(rt, decodeRuntimeSaveState(readFileSync(nativePartial), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	commands.length = 0; expected.length = 0; finish();
	assert.deepEqual(expected, tailResults, 'native to TS initial binding replay');
	if (!reclaim) {
		// Another hardware RESET must be accepted even after a boot refusal.
		// Leave the same ROM mounted: the proof is entering RESET, not giving
		// the unsuccessful image more storage or calling rebootSystem directly.
		const stopped = captureRuntimeSaveState(rt);
		writeFileSync(tsPartial, encodeRuntimeSaveState(stopped));
		commands.length = 0; expected.length = 0;
		trace.observe('X');
		memory.writeMappedWord(IO_SYS_CONTROL, SYS_CONTROL_RESET);
		trace.observe(`O ${IO_SYS_CONTROL} ${SYS_CONTROL_RESET}`);
		const before = scheduler.nowCycles, tick = frames.lastTickSequence;
		const done = frames.runCyclesToNextLogicalTick(1);
		trace.observe('p 1', `${+done} ${scheduler.nowCycles - before} ${frames.lastTickSequence - tick} ${+cpu.heapServiceActive()} ${+cpu.isHaltedUntilIrq()}`);
		assert.equal(rt.machine.systemController.hasResetRequest(), false, 'terminal binding refusal must not retain the reset interlock');
		assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		assert.equal(cpu.captureRuntimeState().previousRootContextWord, root);
		assert.equal(cpu.isHaltedUntilIrq(), false);
		trace.observe('P', `${cpu.getFrameDepth()} ${cpu.readFramePc(0)}`);
		trace.replay('hardware RESET after terminal System binding refusal', replacementPath, tsPartial);
	}
}

function verifySelectedCartFloor(rom: string, native: string, dir: string, optLevel: OptimizationLevel): void {
	const system = readFileSync(rom);
	const payload = 'socket one cartridge literal';
	const cartSource = `bss report: word[0x2000]
selected_payload = '${payload}'
report[0] = 37
report[1] = #selected_payload
mem[${IO_IRQ_MASK}] = 0
halt_until_irq
`;
	const slot0 = compileCartridge(system, cartSource.replace('0x2000', '0x4000').replace(payload, 'unselected cartridge'), 'nonbootable-slot0.lua', optLevel);
	const slot1 = compileCartridge(system, cartSource, 'selected-slot1.lua', optLevel);
	const other = writeTestBlua32Rom(slot0);
	const selected = writeTestBlua32Rom(slot1);
	// Slot 0 has a real, distinct image but no startup vector; the stock
	// scanner must launch slot 1 and use slot 1's mapped section records.
	writeLE32(other, BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET, 0);
	const cart0Path = join(dir, 'nonbootable-slot0.rom'), cart1Path = join(dir, 'selected-slot1.rom');
	writeFileSync(cart0Path, other);
	writeFileSync(cart1Path, selected);
	const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(other, selected), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler, gxGpu } = runtime.machine;
	const frames = runtime.frameScheduler;
	const installed = executionImageBindingOffset(cpu.heapAllocator.managementOffset(), 1);
	let preExec: Uint8Array | undefined;
	cpu.setExecutionHook((_domain, pc) => {
		const word = readLE32(system, pc);
		if (instructionOpcode(word) === OpCode.MTC0 && instructionLowB(word) === COP0_EXEC
			&& asInteger(cpu.activeThread.currentFrame!.registers.get((word >>> (2 * MAX_OPERAND_BITS)) & MAX_LOW_OPERAND)) >= CART_ROM_BASE) {
			assert.equal(cpu.captureRuntimeState().executionResidencyMask & executionDomainBit(1), 0,
				'the slot has no host execution image before the transfer');
			assert.ok(memory.readRamRecordWord(installed) > RAM_BASE);
			assert.ok(memory.readRamRecordWord(installed + 4) > 0);
			preExec = memory.ramData().slice(installed, installed + EXECUTION_IMAGE_BINDING_SIZE);
		}
		return false;
	}, executionDomainBit(SYSTEM_EXECUTION_DOMAIN_ID), 0);
	const trace = new Trace(native, join(dir, 'selected-slot1.trace'), cart0Path, cart1Path);
	for (let grant = 0; grant < 2048 && (cpu.activeCartridgeSlot() !== 1 || !cpu.isHaltedUntilIrq()); ++grant) {
		if (gxGpu.backendCommandDrainPending()) {
			gxGpu.retireExecutedCommands();
			trace.observe('>');
		}
		const cycles = scheduler.nowCycles, tick = frames.lastTickSequence;
		const complete = frames.runCyclesToNextLogicalTick(65536);
		trace.observe('p 65536', [ +complete, scheduler.nowCycles - cycles, frames.lastTickSequence - tick,
			+cpu.heapServiceActive(), +cpu.isHaltedUntilIrq() ].join(' '));
	}
	cpu.setExecutionHook(null, 0, 0);
	assert.equal(cpu.activeCartridgeSlot(), 1);
	assert.ok(preExec !== undefined, 'the BIOS wrote the operand binding before EXEC');
	assert.deepEqual(memory.ramData().slice(installed, installed + EXECUTION_IMAGE_BINDING_SIZE), preExec,
		'EXEC does not replace the firmware-installed operand binding');
	assert.equal(cpu.isHaltedUntilIrq(), true);
	const { bssAddress, bssByteCount } = slot1.layout.header;
	assert.equal(memory.readMappedU32LE(bssAddress), 37);
	assert.equal(memory.readMappedU32LE(bssAddress + 4), payload.length);
	const key = cpu.stringPool.find('selected_payload')!;
	const value = cpu.getGlobalByKey(key);
	assert.equal(valueTag(value), ValueTag.String);
	assert.equal(valuePayload(value) >>> 31, 1, 'the compiled cartridge read the socket-1 String record');
	const absoluteFloor = RAM_BASE + cpu.heapAllocator.floorOffset(bssAddress + bssByteCount);
	const otherFloor = RAM_BASE + cpu.heapAllocator.floorOffset(slot0.layout.header.bssAddress + slot0.layout.header.bssByteCount);
	assert.ok(absoluteFloor < otherFloor);
	assert.equal(memory.ramBusEnd(), absoluteFloor, 'the selected socket supplies the exact aperture, not the private socket-0 view');
	const result = scheduler.runCpuSlice(0, 1, 0, CpuRunKind.Scheduled);
	trace.observe('E 1', [result, 1 - cpu.instructionBudgetRemaining, +cpu.heapServiceActive(),
		memory.ramBusEnd(), cpu.activeCartridgeSlot()].join(' '));
	trace.observe(`H ${bssAddress - RAM_BASE} ${bssAddress - RAM_BASE + 8}`, hashBytes(memory.ramData(), bssAddress - RAM_BASE, 8));
	trace.observe(`H ${installed} ${installed + EXECUTION_IMAGE_BINDING_SIZE}`, hashBytes(memory.ramData(), installed, EXECUTION_IMAGE_BINDING_SIZE));
	trace.replay('stock cartridge boot from socket 1 with a different image present in socket 0', rom);
}

function verifyResetAfterRejectedExec(rom: string, native: string, dir: string, optLevel: OptimizationLevel): void {
	const system = readFileSync(rom);
	const linked = compileCartridge(system, 'bss report: word[0x2000]\nreport[0] = 37\nhalt_until_irq\n', 'rejected-exec.lua', optLevel);
	const cart = writeTestBlua32Rom(linked);
	// The physical header and image sections remain valid. The boot scanner
	// can select the card, but EXEC cannot read a function record here.
	writeLE32(cart, BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET, linked.startupFunctionAddress + 4);
	const cartPath = join(dir, 'rejected-exec.rom');
	writeFileSync(cartPath, cart);
	const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, input);
	const { cpu, memory, scheduler, gxGpu, systemController } = runtime.machine, frames = runtime.frameScheduler;
	const trace = new Trace(native, join(dir, 'rejected-exec.trace'), cartPath);
	function runFrame(grant: number) {
		if (gxGpu.backendCommandDrainPending()) {
			gxGpu.retireExecutedCommands();
			trace.observe('>');
		}
		const cycles = scheduler.nowCycles, tick = frames.lastTickSequence;
		const complete = frames.runCyclesToNextLogicalTick(grant);
		trace.observe(`p ${grant}`, [
			+complete, scheduler.nowCycles - cycles, frames.lastTickSequence - tick,
			+cpu.heapServiceActive(), +cpu.isHaltedUntilIrq(),
		].join(' '));
	}
	runtime.boot();
	const { bssAddress, bssByteCount } = linked.layout.header;
	const admittedEnd = RAM_BASE + cpu.heapAllocator.floorOffset(bssAddress + bssByteCount);
	assert.ok(admittedEnd > memory.ramBusEnd(), 'the card needs a published aperture change');
	for (let grant = 0; grant < 2048; ++grant) {
		runFrame(65536);
		if (memory.ramBusEnd() === admittedEnd && cpu.captureRuntimeState().hardHalted) break;
	}
	assert.equal(cpu.captureRuntimeState().hardHalted, true, 'EXEC rejected the malformed startup');
	assert.equal(memory.ramBusEnd(), admittedEnd, 'BIOS had already published the admitted aperture');
	assert.equal(cpu.activeCartridgeSlot(), SYSTEM_EXECUTION_DOMAIN_ID);
	assert.equal(memory.readMappedU32LE(bssAddress), 0, 'the cartridge never ran');
	trace.observe('F', 1);
	trace.observe(`M ${bssAddress}`, '0 0');
	const previousRoot = cpu.rootThread.address;
	memory.writeMappedWord(IO_SYS_CONTROL, SYS_CONTROL_RESET);
	trace.observe(`O ${IO_SYS_CONTROL} ${SYS_CONTROL_RESET}`);
	runFrame(1);
	const state = cpu.captureRuntimeState();
	trace.observe('F', +state.hardHalted);
	const depth = cpu.getFrameDepth();
	trace.observe('P', `${depth} ${cpu.readFramePc(depth - 1)}`);
	trace.replay('hardware RESET after a stock EXEC refuses an unreadable startup', rom);
	assert.equal(systemController.hasResetRequest(), false, 'a refused stock EXEC must not mask hardware RESET');
	assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	assert.equal(state.previousRootContextWord, previousRoot);
	assert.equal(state.hardHalted, false);
}

test('stock System ROM resets and admits a warm physical RAM boundary', async t => {
	mkdirSync('tmp', { recursive: true });
	const dir = mkdtempSync(join('tmp', 'stock-reset-'));
	const native = nativeConformanceRunner(runner);
	let failed = false;
	for (const optLevel of [0, 3] as const) {
		await t.test(`O${optLevel}`, async level => {
			const output = join(dir, `O${optLevel}`);
			execFileSync(process.execPath, ['--import', 'tsx', 'scripts/rompacker/rompacker.ts',
				'--mode', 'bios', '--skiptypecheck', '-respath', 'machine/bios/res', '--debug', `-O${optLevel}`,
				'--output-dir', output, '--store-dir', join(dir, 'store')], { stdio: 'inherit' });
			const rom = join(output, 'system', 'bmsx-bios.debug.rom');
			const cases = [
				['System EXEC consumes its existing frame backing', () => verifySystemExec(rom, native, output)],
				['System startup and cartridge CALL resume after register-window growth', () => verifyRegisterWindowGrowth(rom, native, output, optLevel)],
				['selected socket 1 supplies its own DATA/BSS extent', () => verifySelectedCartFloor(rom, native, output, optLevel)],
				['rejected cartridge EXEC accepts a new hardware RESET', () => verifyResetAfterRejectedExec(rom, native, output, optLevel)],
				['cold diagnostic refusal accepts a new hardware RESET', () => verifyColdRefusal(rom, native, output)],
				['string.char handles fixed, open and protected argument windows', () => verifyStringChar(rom, native, output, optLevel)],
				['select and ordinary protected calls preserve exact result windows', () => verifySelect(rom, native, output, optLevel)],
				['fixed exception bridge preserves the original tagged Lua error', () => verifyExceptionBridge(rom, native, output, optLevel)],
				['warm reset retires a live capture; native rewind and reissued reset', () => verifyWarmReset(rom, native, output, optLevel)],
				['RESET waits for the active Array tag-plane move and publication', () => verifyResetDuringTableGrowth(rom, native, output, optLevel)],
				['warm floor retries after collecting an unreachable blocker', () => verifyWarmFloor(rom, native, output, optLevel, false)],
				['warm floor refuses a second time while the mounted image still owns its String', () => verifyWarmFloor(rom, native, output, optLevel, true)],
				['warm System binding allocation uses the reclaimed extent after physical refusal', () => verifyWarmBinding(rom, native, output, optLevel, true)],
				['warm System binding allocation parks without publishing after the final physical refusal', () => verifyWarmBinding(rom, native, output, optLevel, false)],
			] as const;
			for (const [description, run] of cases) {
				await level.test(description, () => {
					try {
						run();
					} catch (error) {
						failed = true;
						throw error;
					}
				});
			}
		});
	}
	if (failed) t.diagnostic(`Stock reset artifacts retained at ${dir}`);
	else rmSync(dir, { recursive: true, force: true });
});
