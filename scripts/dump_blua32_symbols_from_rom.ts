import fs from 'fs';
import { BLUA32_SYMBOLS_IMAGE_ID } from '../machine/ts/machine/cpu/blua32_image';
import { decodeBlua32SymbolsImage } from '../machine/ts/machine/cpu/blua32_symbols';
import { parseCartHeader } from '../machine/ts/rompack/format';
import { decodeRomToc } from '../machine/ts/rompack/toc';

function dump(romPath: string) {
	const payload = fs.readFileSync(romPath);
	const header = parseCartHeader(payload);
	const assets = decodeRomToc(payload.subarray(header.tocOffset, header.tocOffset + header.tocLength)).entries;
	const symbolsAssets = assets.filter(asset => asset.resid === BLUA32_SYMBOLS_IMAGE_ID);
	if (symbolsAssets.length === 0) {
		throw new Error('ROM has no BLua32 symbols asset.');
	}
	for (let i = 0; i < symbolsAssets.length; i++) {
		const asset = symbolsAssets[i];
		const start = asset.start!;
		const end = asset.end!;
		console.log(`Asset ${i}: start=${start} end=${end} size=${end - start}`);
		const symbols = decodeBlua32SymbolsImage(payload.subarray(start, end));
		console.log('function addresses:', symbols.functionAddresses.length);
		console.log('module functions:', symbols.moduleFunctions.length);
		console.log('systemGlobalNames length:', symbols.metadata.systemGlobalNames.length);
		console.log('globalNames length:', symbols.metadata.globalNames.length);
		console.log('Sample systemGlobalNames (first 200):');
		console.log(symbols.metadata.systemGlobalNames.slice(0, 200).join('\n'));
		console.log('Sample globalNames (first 200):');
		console.log(symbols.metadata.globalNames.slice(0, 200).join('\n'));
		console.log('---');
	}
}

if (require.main === module) {
	const rom = process.argv[2] || 'dist/pietious.rom';
	dump(rom);
}
