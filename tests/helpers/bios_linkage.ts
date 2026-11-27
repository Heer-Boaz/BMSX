import { loadHeapServiceTestModules, loadTestBiosUtilityModules } from './heap_service_system';
import { writeLE32 } from '../../machine/ts/common/endian';
import { BLUA32_FUNCTION_RECORD_SIZE, BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { buildBlua32Image } from '../../toolchain/ts/rompack/blua32_image_builder';
import { SYSTEM_KERNEL_MODULES } from '../../toolchain/ts/rompack/system';
import { BIOS_FUNCTION_EXPORTS } from '../../toolchain/ts/rompack/system';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { CART_ROM_MAGIC } from '../../machine/ts/spec/bmsx/rom_package';
import {
	BMSX_ROM_BOOT_HEADER_SIZE,
	BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET,
	BMSX_ROM_HEADER_BLUA32_IMAGE_BYTE_COUNT_OFFSET,
	BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET,
	BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET,
	BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET,
} from '../../machine/ts/spec/bmsx/rom_header';
import { parseLuaChunk } from './cpu_test_harness';

export const PUBLIC_BIOS_PROBE_SOURCE = `module<entry>
data firmware_value: word = 11
bss firmware_buffer: word[7]
local image<const> = mem32le[${BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET}]
local functions<const> = mem32le[image + ${BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET}]
local sine<const> = blua32.closure(functions)
local decode<const> = blua32.closure(functions + ${BLUA32_FUNCTION_RECORD_SIZE})
local region<const> = blua32.closure(functions + ${2 * BLUA32_FUNCTION_RECORD_SIZE})
local origin<const>, extent<const> = region()
return sine(0x40000000) == 65536 and decode(0x3fa00000, 0, 4) == 1.25,
    origin == 0x02d002c0 and extent == 0x00fc0140`;

/** Real exported firmware bodies with a small, valid texture upload record. */
export function buildPublicBiosFixture(source: string, optLevel: 0 | 3) {
	const sources = [
		{ path: 'entry', source, chunk: parseLuaChunk(source, 'entry') },
		...loadHeapServiceTestModules(),
		...loadTestBiosUtilityModules(),
	];
	const built = buildBlua32Image({
		domain: 'system',
		preloadModules: SYSTEM_KERNEL_MODULES,
		luaModules: sources.map(module => ({
			...module, displayPath: `${module.path}.lua`,
		})),
		generatedLuaModules: [],
		loadAddress: 0x100,
		ramByteCount: PSX_MACHINE_SPEC.ramBytes,
		optLevel,
		traceStatements: 'erase',
		biosExports: BIOS_FUNCTION_EXPORTS,
	});
	// Only the public boot prefix and executable: no package index or symbols.
	const rom = new Uint8Array(0x100 + built.linked.bytes.byteLength);
	rom.set(built.linked.bytes, 0x100);
	writeLE32(rom, 0, CART_ROM_MAGIC);
	writeLE32(rom, 4, BMSX_ROM_BOOT_HEADER_SIZE);
	writeLE32(rom, BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET, 0x100);
	writeLE32(rom, BMSX_ROM_HEADER_BLUA32_IMAGE_BYTE_COUNT_OFFSET, built.linked.bytes.byteLength);
	writeLE32(rom, BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET, built.linked.startupFunctionAddress);
	writeLE32(rom, BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET, built.linked.irqFunctionAddress);
	writeLE32(rom, BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET, built.linked.exceptionFunctionAddress);
	return { linked: built.linked, rom };
}
