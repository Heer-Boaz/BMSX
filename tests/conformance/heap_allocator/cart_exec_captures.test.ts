import { readStockGlobalValue } from '../../../toolchain/ts/firmware/stock_global_bank';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readLE32, writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { captureAddress } from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ThreadField, ThreadStatus } from '../../../machine/ts/machine/cpu/thread_record';
import { isOpen, load, UPVALUE_HEAP_BYTES } from '../../../machine/ts/machine/cpu/upvalue';
import { ValueTag, valueInteger, valuePayload } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { COP0_EXEC, CPU_CAUSE_CODE_SYSCALL } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_FUNCTION_CODE, BLUA32_FUNCTION_FLAGS_OFFSET } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, instructionLowB, instructionOpcode, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { IO_IRQ_MASK, IRQ_DMA0_DONE } from '../../../machine/ts/spec/bmsx/io';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_INTERRUPT_STATE_ADDRESS, RAM_RECORD_WORD_MASK, THREAD_STACK_SLOT_BYTES } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { parseLuaChunk } from '../../../toolchain/ts/lua/analysis/parse';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { linkRawTestSystemBlua32, linkTestCartBlua32, writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { admitTestHeapServiceCpu } from '../../helpers/heap_service_system';
import { MANAGED_CART_LAUNCH } from '../../helpers/managed_cart_launch';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

const source = `
local outer = { 31 }
saved_outer = function() return outer end
function launch(seed)
	local inner = { seed }
	saved_inner = function() return inner end
	halt_until_irq
	${MANAGED_CART_LAUNCH}
end
launch(41)
`;
const cartSource = `
bss report: word
*report = 73
halt_until_irq
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');

for (const optLevel of [0, 3] as const) test(`cartridge binding retires captures before raw EXEC (O${optLevel})`, t => {
	const system = linkManagedTestSystem(source, optLevel);
	const rom = writeTestBlua32Rom(system);
	const compiled = compileLuaChunkToProgram(parseLuaChunk(cartSource, 'cart.lua').chunk, [], { entrySource: cartSource, optLevel });
	const { cartImage, cartRomBytes } = linkTestCartBlua32(system.biosImports, compiled);
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(cartRomBytes), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	const commands: string[] = [], rows: string[] = [];
	function grant(cycles: number) {
		const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
		commands.push(`E ${cycles}`);
		rows.push(`${result} ${cycles - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		return result;
	}
	function hash(address: number, bytes: number) {
		const first = address & RAM_RECORD_WORD_MASK;
		const digest = hashBytes(memory.ramData(), first, bytes);
		commands.push(`H ${first} ${first + bytes}`);
		rows.push(String(digest));
		return digest;
	}
	for (let i = 0; i < 1024 && !cpu.isHaltedUntilIrq(); ++i) grant(1024);
	assert.ok(cpu.isHaltedUntilIrq());
	const owner = cpu.rootThread.address, depth = cpu.getFrameDepth();
	const captures = ['saved_outer', 'saved_inner'].map((name, i) => {
		const keeper = valuePayload(readStockGlobalValue(cpu.memory, nativeHeapReference(cpu).stringPool.find(name)!));
		const address = captureAddress(memory, keeper, 0);
		const frame = depth - 2 + i;
		assert.equal(cpu.readThreadFrameWord(owner, frame, FrameField.OpenHead), address);
		assert.ok(isOpen(memory, address));
		return { address, frame, value: load(memory, address) };
	});
	cpu.clearHaltUntilIrq();
	commands.push('h');
	const retired = new Set<number>();
	function atExec() {
		const word = readLE32(rom, cpu.activeThread.currentFrame!.pc);
		return instructionOpcode(word) === OpCode.MTC0 && instructionLowB(word) === COP0_EXEC;
	}
	for (let i = 0; i < 65536 && !atExec(); ++i) {
		grant(1);
		for (const { address } of captures) if (!retired.has(address) && !isOpen(memory, address)) {
			assert.ok(cpu.fixedInterruptActive(), 'the open-to-closed store happens in firmware');
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_SYSCALL);
			retired.add(address);
		}
	}
	assert.ok(atExec());
	assert.equal(retired.size, captures.length);
	assert.equal(cpu.getFrameDepth(), depth, 'firmware returned to the original EXEC issuer');
	const before = captures.map(({ address, frame, value }) => {
		assert.equal(cpu.readThreadFrameWord(owner, frame, FrameField.OpenHead), 0);
		assert.equal(load(memory, address), value);
		return hash(address, UPVALUE_HEAP_BYTES);
	});
	const backing = memory.readRamRecordWord(owner + ThreadField.StackBlock);
	const stackBytes = memory.readRamRecordWord(owner + ThreadField.StackCapacity) * THREAD_STACK_SLOT_BYTES;
	const stack = hash(backing, stackBytes);
	const occupied = nativeHeapReference(cpu).heapAllocator.occupiedBytes(), used = nativeHeapReference(cpu).luaHeap.usedBytes();
	const result = scheduler.runCpuSlice(0, 1, 0, CpuRunKind.Scheduled);
	const paid = 1 - cpu.instructionBudgetRemaining;
	assert.equal(result, RunResult.Yielded);
	assert.equal(paid, BASE_CYCLES[OpCode.MTC0]);
	assert.equal(cpu.activeCartridgeSlot(), 0);
	assert.equal(cpu.rootThread.address, owner);
	assert.equal(cpu.getFrameDepth(), 1);
	assert.equal(cpu.activeThread.currentFrame!.stackBase, 0);
	assert.equal(nativeHeapReference(cpu).heapAllocator.occupiedBytes(), occupied);
	assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), used);
	commands.push('J 1 1');
	rows.push(`${result} ${paid} 0 ${occupied} ${used}`);
	assert.deepEqual(captures.map(({ address }) => hash(address, UPVALUE_HEAP_BYTES)), before);
	assert.equal(hash(backing, stackBytes), stack, 'EXEC does not scrub the discarded register backing');
	for (let i = 0; i < 64 && !cpu.isHaltedUntilIrq(); ++i) grant(1024);
	assert.ok(cpu.isHaltedUntilIrq());
	assert.equal(cpu.captureRuntimeState().hardHalted, false);
	const report = cartImage.header.bssAddress;
	assert.equal(memory.readRamRecordWord(report), 73);
	hash(report, 4);

	const dir = mkdtempSync(join(tmpdir(), 'bmsx-exec-captures-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const systemPath = join(dir, 'system.rom'), trace = join(dir, 'trace'), cart = join(dir, 'cart.rom');
	writeFileSync(systemPath, rom);
	writeFileSync(cart, cartRomBytes);
	writeFileSync(trace, commands.join('\n'));
	assert.deepEqual(execFileSync(native, [systemPath, trace, trace, cart], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
});

test('a raw fixed IRQ vector can EXEC into its interrupted physical context', t => {
	const text = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 1, OpCode.LOADK, 0, 0, 0);
	writeInstruction(text, 2, OpCode.MTC0, 0, COP0_EXEC, 0);
	writeInstruction(text, 3, OpCode.HALT, 0, 0, 0);
	const { image, romBytes } = linkRawTestSystemBlua32({ text, constants: [integerConstant(0)], irqFunctionIndex: 1, functions: [
		{ firstWord: 0, wordCount: 1 }, { firstWord: 1, wordCount: 2 }, { firstWord: 3, wordCount: 1, maxStack: 2 },
	] });
	const [, vector, entry] = image.functions;
	const flags = vector.address + BLUA32_FUNCTION_FLAGS_OFFSET;
	writeLE32(romBytes, flags, readLE32(romBytes, flags) | BLUA32_FUNCTION_CODE);
	writeLE32(romBytes, image.header.constantTableAddress + BLUA32_CONSTANT_PAYLOAD_OFFSET, entry.address);
	const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler, executionAddressSpace, irqController } = runtime.machine;
	admitTestHeapServiceCpu(cpu, executionAddressSpace);
	const root = cpu.rootThread, owner = root.address;
	const status = owner + ThreadField.Status, error = owner + ThreadField.ErrorWord;
	memory.writeRamRecordWord(status, ThreadStatus.Suspended);
	memory.writeRamRecordPair(error, 0x76543210, ValueTag.Integer);
	root.stackRegisters.setInteger(0, 91);
	const seed = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
	memory.writeMappedWord(IO_IRQ_MASK, IRQ_DMA0_DONE);
	irqController.raise(IRQ_DMA0_DONE);
	assert.equal(cpu.enterPendingInterrupt(), true);
	const fixed = cpu.activeThread;
	assert.ok(cpu.fixedInterruptActive() && fixed.address !== owner);
	assert.equal(fixed.currentFrame!.pc, vector.codeAddress);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPT_STATE_ADDRESS), IRQ_DMA0_DONE);

	const commands = ['X', `O ${IO_IRQ_MASK} ${IRQ_DMA0_DONE}`, `i ${IRQ_DMA0_DONE}`, 'I'], rows = ['1'];
	for (const [op, active] of [[OpCode.LOADK, true], [OpCode.MTC0, false]] as const) {
		const result = scheduler.runCpuSlice(0, 1, 0, CpuRunKind.Scheduled);
		const paid = 1 - cpu.instructionBudgetRemaining;
		assert.equal(result, RunResult.Yielded, active ? 'vector LOADK' : 'vector EXEC');
		assert.equal(paid, BASE_CYCLES[op]);
		assert.equal(cpu.fixedInterruptActive(), active);
		commands.push('J 1 1');
		rows.push(`${result} ${paid} ${+active} ${nativeHeapReference(cpu).heapAllocator.occupiedBytes()} ${nativeHeapReference(cpu).luaHeap.usedBytes()}`);
	}
	assert.equal(cpu.activeThread.address, owner);
	assert.equal(root.frameDepth, 1);
	assert.equal(fixed.frameDepth, 0);
	assert.equal(fixed.stackTop, 0);
	const frame = root.currentFrame!;
	assert.deepEqual([frame.functionAddress, frame.pc, frame.stackBase, frame.closureAddress], [entry.address, entry.codeAddress, 0, 0]);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPT_STATE_ADDRESS), 0);
	assert.equal(memory.readRamRecordWord(status), ThreadStatus.Suspended);
	assert.equal(memory.readRamRecordWord(error), 0x76543210);
	assert.equal(memory.readRamRecordWord(error + 4), ValueTag.Integer);
	assert.equal(root.stackRegisters.get(0), valueInteger(91));
	for (const [address, bytes] of [[frame.controlOffset, FRAME_CONTROL_BYTES], [CPU_INTERRUPTED_CONTEXT_ADDRESS, 8],
		[fixed.address + ThreadField.FrameDepth, 4], [fixed.address + ThreadField.StackTop, 4], [status, 4], [error, 8],
		[memory.readRamRecordWord(owner + ThreadField.StackBlock), root.stackRegisters.capacity() * THREAD_STACK_SLOT_BYTES]]) {
		const offset = address & RAM_RECORD_WORD_MASK;
		commands.push(`H ${offset} ${offset + bytes}`);
		rows.push(String(hashBytes(memory.ramData(), offset, bytes)));
	}
	const dir = mkdtempSync(join(tmpdir(), 'bmsx-fixed-exec-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const rom = join(dir, 'system.rom'), trace = join(dir, 'trace'), state = join(dir, 'initial.state');
	writeFileSync(rom, romBytes);
	writeFileSync(trace, commands.join('\n'));
	writeFileSync(state, seed);
	assert.deepEqual(execFileSync(native, [rom, trace, state], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
});
