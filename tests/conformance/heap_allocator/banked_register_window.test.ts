import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { CompiledBlockExit, CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { valueInteger, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import {
	COP0_CONTEXT, COP0_STATUS, CPU_CAUSE_CODE_DATA_BUS_ERROR, CPU_CAUSE_CODE_RESERVED_INSTRUCTION, CPU_STATUS_USER_MODE_CURRENT,
} from '../../../machine/ts/spec/blua32/cop0';
import { type ExecutionDomainId, SYSTEM_EXECUTION_DOMAIN_ID } from '../../../machine/ts/spec/blua32/execution_domain';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, BLUA32_FUNCTION_CODE, BLUA32_FUNCTION_FLAGS_OFFSET } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, RegisterJumpMode, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { IO_CART_SELECT, IO_SYS_BUS_FAULT_ADDR } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, CPU_FIXED_STACK_BASE, RAM_BASE, THREAD_STACK_SLOT_BYTES } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { linkRawTestBlua32Pair, linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const word = INSTRUCTION_BYTES;
const context = CPU_FIXED_STACK_BASE - 0x4000;
const controls = context + 0x100;
const values = context + 0x300;
const slots = 64, parentWidth = 12, outerWidth = 10, innerWidth = 8, leafWidth = 4;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
type Instruction = [op: OpCode, a: number, b: number, c: number, ext?: number];

function encode(instructions: Instruction[]): Uint8Array {
	const text = new Uint8Array(instructions.length * word);
	for (const [index, instruction] of instructions.entries()) writeInstruction(text, index, ...instruction);
	return text;
}

function assemble() {
	const instructions: Instruction[] = [];
	const constants: number[] = [];
	const load = (register: number, value: number) => {
		const lane = constants.length;
		constants.push(value);
		instructions.push([OpCode.LOADK, register, lane >>> 6, lane & 63]);
		return lane;
	};
	const store = (address: number, value: number) => {
		const lane = load(0, value);
		load(1, address);
		instructions.push([OpCode.STORE_MEM, 0, 1, MemoryAccessKind.Word]);
		return lane;
	};

	// The ROM, not the harness, installs an ordinary RAM context. No heap
	// metadata or host-prepared cartridge bindings participate.
	store(context + ThreadField.StackTop, parentWidth);
	store(context + ThreadField.StackBlock, values);
	store(context + ThreadField.StackCapacity, slots);
	store(context + ThreadField.FrameCapacity, 8);
	store(context + ThreadField.FrameDepth, 1);
	store(context + ThreadField.FrameBlock, controls);
	const parentFunction = store(controls + FrameField.Function, 0);
	const parentPc = store(controls + FrameField.Pc, 0);
	store(controls + FrameField.StackCapacity, parentWidth);
	store(IO_CART_SELECT, 0);
	load(0, context);
	instructions.push([OpCode.MTC0, 0, COP0_CONTEXT, 0], [OpCode.RET, 0, 1, 0]);
	const main = instructions.length;
	instructions.push(
		[OpCode.KSMI, 6, 0, CPU_STATUS_USER_MODE_CURRENT],
		[OpCode.MTC0, 6, COP0_STATUS, 0],
		[OpCode.K0, 0, 0, 0], [OpCode.K1, 1, 0, 0], [OpCode.K1, 2, 0, 0],
	);
	const loop = instructions.length;
	instructions.push([OpCode.KSMI, 3, 0, 19]);
	const firstCart = load(7, 0);
	instructions.push(
		[OpCode.KSMI, 8, 0, 3], [OpCode.KSMI, 9, 0, outerWidth], [OpCode.K1, 10, 0, 0], [OpCode.K0, 11, 0, 0],
		[OpCode.JREG, 7, 8, RegisterJumpMode.EnterBankWindow],
		[OpCode.SUB, 2, 2, 1], [OpCode.EQ, 0, 2, 0],
	);
	const jump = loop - instructions.length - 1;
	instructions.push([OpCode.JMP, 0, (jump >>> 6) & 63, jump & 63, (jump >>> 12) & 255], [OpCode.RET, 3, 2, 0]);
	const leaf = instructions.length;
	load(2, context);
	instructions.push(
		[OpCode.KSMI, 1, 0, 7], [OpCode.ADD, 0, 0, 1], [OpCode.K1, 1, 0, 0],
		[OpCode.JREG, 63, 1, RegisterJumpMode.LeaveWindowFromRegister],
	);
	const vector = instructions.length;
	instructions.push([OpCode.RFE, 0, 0, 0]);
	const system = linkRawTestSystemBlua32({ text: encode(instructions), constants: constants.map(integerConstant),
		verifiedControlFlow: true, exceptionFunctionIndex: 3, irqFunctionIndex: 3, functions: [
			{ firstWord: 0, wordCount: main, maxStack: 2 },
			{ firstWord: main, wordCount: leaf - main, maxStack: parentWidth },
			{ firstWord: leaf, wordCount: vector - leaf, maxStack: leafWidth },
			{ firstWord: vector, wordCount: 1, maxStack: 0 },
		] });
	// Both carts begin at exactly the same physical TEXT PC. Slot0 and slot1
	// intentionally reuse the same register numbers but execute different code.
	const cart0 = linkRawTestBlua32Pair(system, {
		text: encode([
			[OpCode.KSMI, 2, 0, 11], [OpCode.LOADK, 4, 0, 0],
			[OpCode.KSMI, 5, 0, 2], [OpCode.KSMI, 6, 0, innerWidth], [OpCode.K1, 7, 0, 0], [OpCode.K1, 8, 0, 0],
			[OpCode.JREG, 4, 5, RegisterJumpMode.EnterBankWindow],
			[OpCode.ADD, 0, 0, 2], [OpCode.JREG, 63, 1, RegisterJumpMode.LeaveWindow],
		]),
		constants: [integerConstant(0)], verifiedControlFlow: true, functions: [{ firstWord: 0, wordCount: 9, maxStack: outerWidth }],
	});
	const cart1 = linkRawTestBlua32Pair(system, {
		text: encode([
			[OpCode.LOADK, 1, 0, 0],
			[OpCode.K0, 2, 0, 0], [OpCode.KSMI, 3, 0, leafWidth], [OpCode.K1, 4, 0, 0], [OpCode.BNOT, 5, 2, 0],
			[OpCode.JREG, 1, 2, RegisterJumpMode.EnterBankWindow],
			[OpCode.KSMI, 1, 0, 63], [OpCode.ADD, 0, 0, 1], [OpCode.JREG, 63, 1, RegisterJumpMode.LeaveWindow],
		]),
		constants: [integerConstant(0)], verifiedControlFlow: true, functions: [{ firstWord: 0, wordCount: 9, maxStack: innerWidth }],
	});
	const [, caller, systemLeaf, irq] = system.image.functions;
	const cartPc = cart0.cartImage.functions[0].codeAddress;
	assert.equal(cart1.cartImage.functions[0].codeAddress, cartPc);
	const put = (rom: Uint8Array, offset: number, lane: number, value: number) =>
		writeLE32(rom, offset + BLUA32_CONSTANT_RECORD_SIZE * lane + BLUA32_CONSTANT_PAYLOAD_OFFSET, value);
	put(system.romBytes, system.image.header.constantTableAddress, parentFunction, caller.address);
	put(system.romBytes, system.image.header.constantTableAddress, parentPc, caller.codeAddress);
	put(system.romBytes, system.image.header.constantTableAddress, firstCart, cartPc);
	put(cart0.cartRomBytes, cart0.cartImage.header.constantTableAddress - CART_ROM_BASE, 0, cartPc);
	put(cart1.cartRomBytes, cart1.cartImage.header.constantTableAddress - CART_ROM_BASE, 0, systemLeaf.codeAddress);
	writeLE32(system.romBytes, irq.address + BLUA32_FUNCTION_FLAGS_OFFSET, irq.flags | BLUA32_FUNCTION_CODE);
	return { system, caller, systemLeaf, irq, cart0: cart0.cartRomBytes, cart1: cart1.cartRomBytes, cartPc, firstCart,
		issue: caller.codeAddress + (loop - main + 6) * word };
}

function boot(systemRomBytes: Uint8Array, cart0: Uint8Array | null, cart1: Uint8Array | null,
	cpuExecutionBackend = CpuExecutionBackend.Interpreter) {
	const runtime = new Runtime({ systemRomBytes, cartridgeSlots: cartridgeSlots(cart0, cart1),
		machineModel: PSX_MACHINE_SPEC, cpuExecutionBackend }, input);
	runtime.boot();
	return runtime;
}

test('User bank windows run the selected socket at the same PC, preserving the data selector through NMI and restore', t => {
	const { system, caller, systemLeaf, irq, cart0, cart1, cartPc, issue } = assemble();
	const folder = mkdtempSync(join(tmpdir(), 'bmsx-banked-window-'));
	t.after(() => rmSync(folder, { recursive: true, force: true }));
	const program = join(folder, 'system.rom'), socket0 = join(folder, 'cart0.rom'), socket1 = join(folder, 'cart1.rom');
	const schedule = join(folder, 'schedule'), state = join(folder, 'checkpoint');
	writeFileSync(program, system.romBytes);
	writeFileSync(socket0, cart0);
	writeFileSync(socket1, cart1);
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner', { buildDirectory: join(folder, 'native') });
	function replay(script: string[], expected: string[], cartridges = [socket0, socket1]) {
		writeFileSync(schedule, script.join('\n'));
		assert.deepEqual(execFileSync(native, [program, schedule, state, ...cartridges], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
	}

	const runtime = boot(system.romBytes, cart0, cart1);
	const { cpu, scheduler, memory } = runtime.machine;
	const commands: string[] = [], rows: string[] = [];
	const observe = (command: string, row: string) => { commands.push(command); rows.push(row); };
	function grant(cycles: number) {
		const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		observe(`E ${cycles}`, `${result} ${cycles - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		return result;
	}
	function step(op: OpCode, result = RunResult.Yielded, extra = 0) {
		assert.equal(grant(1), result);
		assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[op] + extra);
	}
	function top(depth: number, domain: ExecutionDomainId, pc: number) {
		assert.equal(cpu.getFrameDepth(), depth);
		assert.equal(cpu.readFramePc(depth - 1), pc);
		assert.equal(cpu.readFrameExecutionDomain(depth - 1), domain);
		observe('P', `${depth} ${pc}`);
	}
	function checkSelector() {
		assert.equal(memory.readIoU32(IO_CART_SELECT), 0);
		observe(`M ${IO_CART_SELECT}`, '0 0');
	}
	function registerPlanes() {
		const begin = values - RAM_BASE;
		const bytes = slots * THREAD_STACK_SLOT_BYTES;
		observe(`H ${begin} ${begin + bytes}`, String(hashBytes(memory.ramData(), begin, bytes)));
	}
	function frameWords(depth: number) {
		const begin = controls - RAM_BASE;
		observe(`H ${begin} ${begin + depth * FRAME_CONTROL_BYTES}`, String(hashBytes(memory.ramData(), begin, depth * FRAME_CONTROL_BYTES)));
	}
	assert.equal(grant(4096), RunResult.Yielded);
	assert.equal(cpu.rootThread.address, context);
	top(1, SYSTEM_EXECUTION_DOMAIN_ID, caller.codeAddress);
	const parentOps = [OpCode.KSMI, OpCode.MTC0, OpCode.K0, OpCode.K1, OpCode.K1, OpCode.KSMI, OpCode.LOADK,
		OpCode.KSMI, OpCode.KSMI, OpCode.K1, OpCode.K0];
	for (const op of parentOps) step(op);
	top(1, SYSTEM_EXECUTION_DOMAIN_ID, issue);
	assert.equal(cpu.isUserMode(), true);
	const prewindow = memory.ramData().slice(values - RAM_BASE, values - RAM_BASE + slots * THREAD_STACK_SLOT_BYTES);
	step(OpCode.JREG);
	top(2, 0, cartPc);
	assert.deepEqual(memory.ramData().subarray(values - RAM_BASE, values - RAM_BASE + prewindow.length), prewindow, 'bank entry does not copy or clear the overlapping register lanes');
	assert.equal(cpu.readFrameFunctionAddress(1), 0);
	assert.equal(cpu.readFrameRegister(1, 0), valueInteger(19));
	checkSelector();
	for (const op of [OpCode.KSMI, OpCode.LOADK, OpCode.KSMI, OpCode.KSMI, OpCode.K1, OpCode.K1, OpCode.JREG]) step(op);
	top(3, 1, cartPc);
	assert.equal(cpu.readFrameRegister(2, 0), valueInteger(11));
	assert.equal(cpu.isUserMode(), true);
	checkSelector();
	frameWords(3);
	registerPlanes();
	const checkpoint = captureRuntimeSaveState(runtime);
	writeFileSync(state, encodeRuntimeSaveState(checkpoint));
	const scriptAt = commands.length, rowAt = rows.length;
	commands.push('S');
	function resume() {
		commands.push('N');
		cpu.requestNonMaskableInterrupt();
		assert.equal(cpu.enterPendingInterrupt(), true);
		observe('I', '1');
		assert.equal(cpu.readEpcWord(), cartPc);
		assert.equal(cpu.activeCartridgeSlot(), -1);
		assert.equal(cpu.readFramePc(cpu.getFrameDepth() - 1), irq.codeAddress);
		step(OpCode.RFE);
		top(3, 1, cartPc);
		assert.equal(cpu.isUserMode(), true);
		for (const op of [OpCode.LOADK, OpCode.K0, OpCode.KSMI, OpCode.K1, OpCode.BNOT, OpCode.JREG]) step(op);
		top(4, -1, systemLeaf.codeAddress);
		assert.equal(cpu.isUserMode(), true, 'System ROM execution does not acquire Supervisor mode');
		for (const op of [OpCode.LOADK, OpCode.KSMI, OpCode.ADD, OpCode.K1, OpCode.JREG]) step(op);
		top(3, 1, cartPc + 6 * word);
		for (const op of [OpCode.KSMI, OpCode.ADD, OpCode.JREG]) step(op);
		top(2, 0, cartPc + 7 * word);
		assert.equal(cpu.readFrameRegister(1, 2), valueInteger(81));
		step(OpCode.ADD);
		step(OpCode.JREG);
		top(1, -1, issue + word);
		assert.equal(cpu.activeThread.currentFrame!.top, 4);
		assert.equal(cpu.readFrameRegister(0, 3), valueInteger(100));
		checkSelector();
		frameWords(1);
		registerPlanes();
		step(OpCode.SUB);
		step(OpCode.EQ);
		step(OpCode.RET, RunResult.Halted, 1);
		const result = runtime.readCompletionValues();
		assert.deepEqual(result, [valueInteger(100)]);
		observe('c', [result.length, ...result.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	}
	resume();
	const scriptEnd = commands.length, rowEnd = rows.length;
	applyRuntimeSaveState(runtime, checkpoint);
	commands.push('U');
	resume();
	assert.deepEqual(rows.slice(rowEnd), rows.slice(rowAt, rowEnd));
	replay(commands, rows);
	replay(['X', ...commands.slice(scriptAt + 1, scriptEnd)], rows.slice(rowAt, rowEnd));

	// Exercise naturally warmed guest execution in both backends, without
	// host-seeding registers, invalidating a frame, or forcing an entry cell.
	const repeat = system.romBytes.slice();
	writeInstruction(repeat, caller.codeAddress / word + 4, OpCode.KSMI, 2, 0, 48);
	writeFileSync(program, repeat);
	const warm = boot(repeat, cart0, cart1, CpuExecutionBackend.JavaScript);
	const warmCpu = warm.machine.cpu;
	const systemImage = warmCpu.activeThread.currentFrame!.executionImage;
	const warmRows: string[] = [];
	for (let pulse = 0; pulse < 2; ++pulse) {
		const result = warm.machine.scheduler.runCpuSlice(0, 65536, undefined, CpuRunKind.Scheduled);
		warmRows.push(`${result} ${65536 - warmCpu.instructionBudgetRemaining} ${warm.machine.memory.ramBusEnd()} ${warmCpu.activeCartridgeSlot()}`);
	}
	assert.deepEqual(warm.readCompletionValues(), [valueInteger(100)]);
	const page = systemImage.compiledCodeLookup!.find(issue, 0);
	assert.ok(page?.compiledBlocks?.entries.some(entry => entry?.terminal.currentPc === issue
		&& entry.terminal.exit === CompiledBlockExit.RegisterWindowJump
		&& entry.terminal.exitC === RegisterJumpMode.EnterBankWindow));
	warmRows.push(`1 ${valueTag(valueInteger(100))} 100`);
	replay(['E 65536', 'E 65536', 'c'], warmRows);
});

test('Supervisor can select its current bank; forbidden bank and memory accesses do not install another window', t => {
	const { system, caller, systemLeaf, irq, cart0, cart1, issue, firstCart } = assemble();
	const folder = mkdtempSync(join(tmpdir(), 'bmsx-banked-window-faults-'));
	t.after(() => rmSync(folder, { recursive: true, force: true }));
	const romFile = join(folder, 'system.rom'), socket0 = join(folder, 'cart0.rom'), socket1 = join(folder, 'cart1.rom');
	const schedule = join(folder, 'schedule');
	writeFileSync(socket0, cart0);
	writeFileSync(socket1, cart1);
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner', { buildDirectory: join(folder, 'native') });
	for (const operation of ['same bank', 'invalid', 'missing', 'supervisor', 'protected leaf'] as const) {
		const rom = system.romBytes.slice();
		if (operation === 'invalid') writeInstruction(rom, issue / word - 1, OpCode.KSMI, 11, 0, 2);
		if (operation === 'supervisor' || operation === 'same bank') writeInstruction(rom, caller.codeAddress / word, OpCode.K0, 6, 0, 0);
		if (operation === 'same bank') {
			const lane = system.image.header.constantTableAddress + BLUA32_CONSTANT_RECORD_SIZE * firstCart + BLUA32_CONSTANT_PAYLOAD_OFFSET;
			writeLE32(rom, lane, systemLeaf.codeAddress);
			writeInstruction(rom, issue / word - 1, OpCode.BNOT, 11, 0, 0);
		}
		if (operation === 'protected leaf') writeInstruction(rom, systemLeaf.codeAddress / word + 1, OpCode.LOAD_MEM, 0, 2, MemoryAccessKind.Word);
		const noCartridges = operation === 'missing' || operation === 'same bank';
		const runtime = boot(rom, noCartridges ? null : cart0, noCartridges ? null : cart1);
		const { cpu, memory, scheduler } = runtime.machine;
		const script: string[] = [], expected: string[] = [];
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			script.push(`E ${cycles}`);
			expected.push(`${result} ${cycles - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		}
		grant(4096);
		const at = operation === 'protected leaf' ? systemLeaf.codeAddress + word : issue;
		for (let step = 0; step < 32 && cpu.readFramePc(cpu.getFrameDepth() - 1) !== at; ++step) grant(1);
		assert.equal(cpu.readFramePc(cpu.getFrameDepth() - 1), at, operation);
		const before = cpu.rootThread.frameDepth;
		grant(1);
		assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[operation === 'protected leaf' ? OpCode.LOAD_MEM : OpCode.JREG], operation);
		if (operation === 'same bank') {
			assert.equal(cpu.readFramePc(1), systemLeaf.codeAddress);
			assert.equal(cpu.isUserMode(), false);
			grant(128);
			assert.deepEqual(runtime.readCompletionValues(), [valueInteger(26)]);
			script.push('c');
			expected.push(`1 ${valueTag(valueInteger(26))} 26`);
		} else {
			const cause = operation === 'protected leaf' ? CPU_CAUSE_CODE_DATA_BUS_ERROR : CPU_CAUSE_CODE_RESERVED_INSTRUCTION;
			assert.equal(cpu.readCauseWord(), cause, operation);
			assert.equal(cpu.readEpcWord(), at, operation);
			assert.equal(cpu.rootThread.frameDepth, before, operation);
			assert.equal(cpu.readThreadFrameExecutionDomain(context, 0), -1, operation);
			assert.equal(cpu.readFramePc(cpu.getFrameDepth() - 1), irq.codeAddress, operation);
			script.push('Z', 'P');
			expected.push(`${cause} 0 ${at}`, `${cpu.getFrameDepth()} ${irq.codeAddress}`);
			if (operation === 'protected leaf') {
				assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), context);
				script.push(`M ${IO_SYS_BUS_FAULT_ADDR}`);
				expected.push(`${context} 0`);
			}
		}
		writeFileSync(romFile, rom);
		writeFileSync(schedule, script.join('\n'));
		assert.deepEqual(execFileSync(native, [romFile, schedule, schedule, ...(noCartridges ? [] : [socket0, socket1])],
			{ encoding: 'utf8' }).trimEnd().split('\n'), expected, operation);
	}
});
