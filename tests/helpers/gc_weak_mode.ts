import { admitTestHeapServiceCpu, compileTestSystemWithHeap, createTestHeapServiceCpu } from './heap_service_system';
import assert from 'node:assert/strict';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestBlua32Pair, linkTestSystemBlua32 } from './blua32';
import { cartridgeSlots } from './cartridge';
import { parseLuaChunk } from './cpu_test_harness';

const stringModule = 'kernel/string_record', weakModule = 'kernel/gc_weak_mode';
const roots = [
	[weakModule, 'weak_mode_bits'], [stringModule, 'byte_length'], [stringModule, 'byte_at'],
] as const;

export function createGcWeakModeFixture(optLevel: 0 | 3, carts: boolean) {
	const entrySource = carts ? "return 'k', 'kk', ''" : 'halt_until_irq';
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), [], { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const entries = roots.map(([path, exportPathKey]) => {
		const slot = object.sections.rodata.moduleExports.find(entry => entry.path === path && entry.exportPathKey === exportPathKey);
		assert.ok(slot, `${path}:${exportPathKey}`);
		const i = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[slot.slotName]);
		assert.ok(i >= 0);
		return i;
	});
	const { frames, valueSlots } = deriveBlua32FixedStack(linked.image, entries);
	assert.ok(frames <= CPU_FIXED_FRAME_COUNT && valueSlots <= CPU_FIXED_VALUE_COUNT);
	const addresses = entries.map(i => linked.image.functions[i].address);

	if (!carts) return { ...createTestHeapServiceCpu(linked), addresses, rom: linked.romBytes, carts: null };
	const cart = (entrySource: string) => linkTestBlua32Pair(compiled,
		compileLuaChunkToProgram(parseLuaChunk(entrySource), [], { entrySource, optLevel }));
	const slot0 = cart("return 'v', 'vv', 'k0v'"), slot1 = cart("return 'kv', 'vk', 'K'");
	const memory = new Memory({
		systemRom: linked.romBytes, cartridgeSlots: cartridgeSlots(slot0.cartRomBytes, slot1.cartRomBytes),
	}, PSX_MACHINE_SPEC.ramBytes);
	const addressSpace = new ExecutionAddressSpace(memory);
	const cpu = new CPU(memory, new IrqController(memory), addressSpace);
	cpu.reset();
	admitTestHeapServiceCpu(cpu, addressSpace);
	for (const [slot, linkedCart] of [[0, slot0], [1, slot1]] as const) {
		const { stringBucketAddress, stringBucketCount } = linkedCart.cartImage.header;
		cpu.stringPool.activateRomTable(slot, stringBucketAddress, stringBucketCount);
	}
	return { cpu, memory, addresses, rom: linked.romBytes, carts: [slot0.cartRomBytes, slot1.cartRomBytes] as const };
}
