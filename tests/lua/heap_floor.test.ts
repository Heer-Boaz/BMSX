import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
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
	const live = heap.allocate(heap.capacityBytes() - 2 * HEAP_PAGE_SIZE, false);
	assert.equal(live, pageRound(systemEnd) + HEAP_PAGE_SIZE, 'the run occupies every page but the lowest');
	const marker = cartEnd - 4 - RAM_BASE;
	memory.ramView.setUint32(marker & ~3, 0x5eed5eed, true);
	cpu.runUntilDepth(0, 10000);
	assert.equal(cpu.captureRuntimeState().hardHalted, true);
	assert.equal(heap.floorAddress(), pageRound(systemEnd));
	assert.equal(memory.ramView.getUint32(marker & ~3, true), 0x5eed5eed, 'cartridge BSS stays untouched');
});
