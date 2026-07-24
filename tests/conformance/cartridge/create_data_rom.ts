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
		blua32ImageOffset: 0,
		blua32ImageByteCount: 0,
		blua32StartupFunctionAddress: 0,
		blua32IrqFunctionAddress: 0,
		blua32ExceptionFunctionAddress: 0,
		blua32StaticLayoutTokenLo: 0,
		blua32StaticLayoutTokenHi: 0,
	});
	await writeFile(outputPath, rom);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
