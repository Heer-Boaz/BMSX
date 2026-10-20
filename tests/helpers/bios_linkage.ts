import { readFileSync } from 'node:fs';
import { writeLE32 } from '../../machine/ts/common/endian';
import { buildBlua32Image } from '../../toolchain/ts/rompack/blua32_image_builder';
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
import { parseLuaChunk } from '../lua/cpu_test_harness';

export const PUBLIC_BIOS_PROBE_SOURCE = `module<entry>
data firmware_value: word = 11
bss firmware_buffer: word[7]
local image<const> = mem32le[0x20]
local functions<const> = mem32le[image + 0x10]
local sine<const> = blua32.closure(functions)
local decode<const> = blua32.closure(functions + 0x20)
local region<const> = blua32.closure(functions + 0x40)
local origin<const>, extent<const> = region()
return sine(0x40000000) == 65536 and decode(0x3fa00000, 0, 4) == 1.25,
    origin == 0x02d002c0 and extent == 0x00fc0140`;

/** Real exported firmware bodies with a small, valid texture upload record. */
export function buildPublicBiosFixture(source: string, optLevel: 0 | 3) {
	const sources = [
		{ path: 'entry', source },
		...['math/sin', 'string/float/decode', 'gpu/system_vram_region', 'tty/layout'].map(path => ({
			path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8'),
		})),
		{ path: 'bmsx/system_assets', source: `module<const>
rodata texture: word[3] = { 0xa0000000, 0x02d002c0, 0x00fc0140 }
return { bin_gx_system_texture_addr = texture }` },
	];
	const built = buildBlua32Image({
		domain: 'system',
		luaModules: sources.map(module => ({
			...module, displayPath: `${module.path}.lua`, chunk: parseLuaChunk(module.source, module.path),
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
