import { loadAssetList, normalizeCartridgeBlob } from '../../src/bmsx/rompack/romloader';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function main(): Promise<void> {
	const romPath = process.argv[2];
	if (!romPath) {
		console.error('Usage: npx tsx scripts/dev/dump_cart_paths.ts <path-to-rom>');
		process.exit(1);
	}
	const absoluteRomPath = path.resolve(romPath);
	const romBuffer = await readFile(absoluteRomPath);
	const { payload } = normalizeCartridgeBlob(romBuffer);
	const { assets, projectRootPath } = await loadAssetList(payload);

	console.log(`ROM: ${absoluteRomPath}`);
	console.log(`projectRootPath: ${projectRootPath ?? '<none>'}`);
	console.log('Assets (type -> sourcePath):');
	for (const asset of assets) {
		const label = asset.source_path ?? '<no source path>';
		console.log(`  ${asset.type.padEnd(8)} ${asset.resid.padEnd(20)} ${label}`);
	}
}

void main();
