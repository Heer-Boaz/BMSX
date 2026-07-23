import { readFile, writeFile } from 'node:fs/promises';

import { parseCartHeader } from '../../../machine/ts/rompack/format';
import { writeCartRomHeader } from '../../../machine/ts/rompack/tooling/header_encode';

async function main(): Promise<void> {
	const [inputPath, outputPath] = process.argv.slice(2);
	if (!inputPath || !outputPath) {
		throw new Error('Usage: create_data_rom.ts BOOTABLE_CART_ROM DATA_CART_ROM');
	}

	const rom = await readFile(inputPath);
	const header = parseCartHeader(rom);
	writeCartRomHeader(rom, {
		...header,
		programBootVersion: 0,
		programBootFlags: 0,
		programEntryProtoIndex: 0,
		programCodeByteCount: 0,
		programConstPoolCount: 0,
		programProtoCount: 0,
		programReserved0: 0,
		programConstRelocCount: 0,
	});
	await writeFile(outputPath, rom);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
