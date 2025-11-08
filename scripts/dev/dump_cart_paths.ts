import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { getZippedRomAndRomLabelFromBlob, loadAssetList } from '../bootrom/bootresources';
import pako from 'pako';

async function main(): Promise<void> {
	const romPath = process.argv[2];
	if (!romPath) {
		console.error('Usage: npx tsx scripts/dev/dump_cart_paths.ts <path-to-rom>');
		process.exit(1);
	}
	const absoluteRomPath = path.resolve(romPath);
	const romBuffer = await readFile(absoluteRomPath);
	const arrayBuffer = romBuffer.buffer.slice(romBuffer.byteOffset, romBuffer.byteOffset + romBuffer.byteLength);
	const { zipped_rom } = await getZippedRomAndRomLabelFromBlob(arrayBuffer);
	const inflated = pako.inflate(zipped_rom).buffer;
	const { assets, projectRootPath } = await loadAssetList(inflated);

	console.log(`ROM: ${absoluteRomPath}`);
	console.log(`projectRootPath: ${projectRootPath ?? '<none>'}`);
	console.log('Assets (type -> sourcePath):');
	for (const asset of assets) {
		const label = asset.sourcePath ?? '<no source path>';
		console.log(`  ${asset.type.padEnd(8)} ${asset.resid.padEnd(20)} ${label}`);
	}
}

void main();
