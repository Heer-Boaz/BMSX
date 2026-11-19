import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR } from '../../machine/ts/spec/blua32/cop0';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, readInstructionWord, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { valueInteger } from '../../machine/ts/machine/cpu/value';
import { CART_ROM_BASE, HEAP_PAGE_SIZE, MAIN_RAM_SIZE, RAM_BASE, RUNTIME_MANAGEMENT_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { createTestBlua32PairCpu, linkTestBlua32Pair } from '../helpers/blua32';
import { materializeCpuCompletionValues } from './cpu_test_harness';

const BOOT_SOURCE = `cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]`;
const CART_SOURCE = 'bss level: u8[0x20000]\nlevel[0] = 7\nreturn level[0]';

function pageRound(address: number): number {
	return (address + HEAP_PAGE_SIZE - 1) & -HEAP_PAGE_SIZE;
}

function bootPair() {
	const bios = compileLuaChunkToProgram(parseLuaChunk(BOOT_SOURCE, 'boot.lua').chunk, [], {
		entrySource: BOOT_SOURCE, optLevel: 0, programDomain: 'system',
	});
	const cart = compileLuaChunkToProgram(parseLuaChunk(CART_SOURCE, 'cart.lua').chunk, [], { entrySource: CART_SOURCE, optLevel: 0 });
	const system = createTestBlua32PairCpu(linkTestBlua32Pair(bios, cart));
	const systemEnd = system.executionAddressSpace.resolveSystemDomain().staticEnd;
	const cartEnd = system.executionAddressSpace.resolveDomain(0)!.staticEnd;
	assert.ok(cartEnd > systemEnd + HEAP_PAGE_SIZE, 'the cartridge statics extend past the system floor');
	return { ...system, systemEnd, cartEnd };
}

test('reset, EXEC and restore use the heap capacity of the active image', () => {
	const { cpu, memory, systemEnd, cartEnd } = bootPair();
	const limit = RAM_BASE + MAIN_RAM_SIZE - RUNTIME_MANAGEMENT_SIZE;
	assert.equal(cpu.heapAllocator.floorAddress(), pageRound(systemEnd));
	assert.equal(cpu.luaHeap.capacity(), limit - pageRound(systemEnd));
	const savedMemory = memory.captureSaveState();
	const savedCpu = cpu.captureRuntimeState();
	assert.equal(cpu.runUntilDepth(0, 1_000_000), RunResult.Halted, 'the cartridge clears its BSS and returns');
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(7)]);
	assert.equal(cpu.heapAllocator.floorAddress(), pageRound(cartEnd));
	assert.equal(cpu.luaHeap.capacity(), limit - pageRound(cartEnd));
	memory.restoreSaveState(savedMemory);
	cpu.restoreRuntimeState(savedCpu);
	assert.equal(cpu.luaHeap.capacity(), limit - pageRound(systemEnd));
});

test('EXEC refuses a cartridge whose statics overlap a live heap page before writing them', () => {
	const { cpu, memory, systemEnd, cartEnd } = bootPair();
	const heap = cpu.heapAllocator;
	let live: number;
	do { live = heap.allocate(HEAP_PAGE_SIZE, true); } while (live >= pageRound(cartEnd));
	assert.ok(live >= pageRound(systemEnd), 'the new static region overlaps a live allocation');
	const marker = cartEnd - 4 - RAM_BASE;
	memory.ramView.setUint32(marker & ~3, 0x5eed5eed, true);
	cpu.runUntilDepth(0, 10000);
	assert.equal(cpu.captureRuntimeState().hardHalted, true);
	assert.equal(heap.floorAddress(), pageRound(systemEnd));
	assert.equal(memory.ramView.getUint32(marker & ~3, true), 0x5eed5eed, 'cartridge BSS stays untouched');
});

test('warm RAM code is retired when the floor shrinks and WIDE obeys both fetches', () => {
	const { cpu, memory, executionAddressSpace } = bootPair();
	const pc = cpu.heapAllocator.floorAddress();
	const system = executionAddressSpace.resolveSystemDomain();
	const select = (address: number) => cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, system.startupFunctionAddress, address);
	const code = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.K1, 0, 0, 0);
	writeInstruction(code, 1, OpCode.JMP, 0, 63, 62, 255);
	memory.writeBytes(pc, code);
	assert.equal(cpu.heapAllocator.setFloor(pc + HEAP_PAGE_SIZE), true);
	select(pc);
	const loop = BASE_CYCLES[OpCode.K1] + BASE_CYCLES[OpCode.JMP];
	cpu.runUntilDepth(0, 100 * loop);
	assert.equal(cpu.readFrameRegister(0, 0), valueInteger(1));
	const page = cpu.rootThread.currentFrame!.decodedPage!;
	assert.ok(page.compiledBlocks?.entries[0], 'a warm executable page is translated');
	const ram = memory.captureSaveState(), saved = cpu.captureRuntimeState();
	assert.equal(cpu.heapAllocator.setFloor(pc), true);
	assert.ok(!page.compiledBlocks?.entries[0], 'the floor change retires coded entries');
	assert.equal(memory.readMappedU32LE(pc), readInstructionWord(code, 0));
	cpu.runUntilDepth(0, 1);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR);
	assert.equal(cpu.readEpcWord(), pc);

	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(saved);
	writeInstruction(code, 0, OpCode.K0, 0, 0, 0);
	memory.writeBytes(pc, code);
	cpu.runUntilDepth(0, loop);
	assert.equal(cpu.readFrameRegister(0, 0), valueInteger(0));

	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(saved);
	assert.equal(cpu.heapAllocator.setFloor(pc), true);
	writeInstruction(code, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(code, 1, OpCode.K1, 0, 0, 0);
	memory.writeBytes(pc - INSTRUCTION_BYTES, code);
	select(pc - INSTRUCTION_BYTES);
	cpu.runUntilDepth(0, 1);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR);
	assert.equal(cpu.readEpcWord(), pc - INSTRUCTION_BYTES);
});
