import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { BLUA32_STRING_ROM_SOCKET_SHIFT } from '../../machine/ts/spec/blua32/image_format';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { blua32RomStrings } from '../../toolchain/ts/rompack/blua32_rom_strings';
import { linkTestCartBlua32 } from './blua32';
import { cartridgeSlots } from './cartridge';
import { parseLuaChunk } from './cpu_test_harness';
import { linkFirmwareProbe } from './ordinary_firmware_probe';

export const enum WeakModeProbe { Bits, Length, Byte }
export const WEAK_MODE_RAM_RECORD = DYNAMIC_RAM_BASE + 0x2000;

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

export function createGcWeakModeFixture(optLevel: 0 | 3, cartridges: boolean) {
	const linked = linkFirmwareProbe(optLevel, [], [
		{ path: 'kernel/gc_weak_mode', member: 'weak_mode_bits', arity: 2 },
		{ path: 'kernel/string_record', member: 'byte_length', arity: 1 },
		{ path: 'kernel/string_record', member: 'byte_at', arity: 2 },
	], cartridges ? "return 'k', 'kk', ''" : 'return');
	const carts = cartridges ? ["return 'v', 'vv', 'k0v'", "return 'kv', 'vk', 'K'"].map(entrySource =>
		linkTestCartBlua32(linked.biosImports, compileLuaChunkToProgram(parseLuaChunk(entrySource), [], { entrySource, optLevel }))) : [];
	const [slot0, slot1] = carts.map(cart => cart.cartRomBytes);
	const ids = new Map(Array.from(blua32RomStrings(linked.image), ({ value, address }) => [value, address]));
	for (const [slot, cart] of carts.entries()) {
		for (const { value, address } of blua32RomStrings(cart.cartImage))
			ids.set(value, (address | (slot << BLUA32_STRING_ROM_SOCKET_SHIFT)) >>> 0);
	}
	const runtime = new Runtime({ systemRomBytes: linked.romBytes, cartridgeSlots: cartridgeSlots(slot0, slot1), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	return { ...runtime.machine, ids, rom: linked.romBytes, carts: [slot0, slot1] as const };
}
