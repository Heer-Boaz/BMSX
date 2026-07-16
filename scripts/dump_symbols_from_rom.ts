import fs from 'fs';
import { decodeProgramSymbolsImage } from '../machine/ts/machine/program/loader';
import { normalizeCartridgeBlob, parseCartHeader } from '../machine/ts/rompack/loader';
import { decodeRomToc } from '../machine/ts/rompack/toc';

function dump(romPath: string) {
	const { payload } = normalizeCartridgeBlob(fs.readFileSync(romPath));
	const header = parseCartHeader(payload);
	const assets = decodeRomToc(payload.subarray(header.tocOffset, header.tocOffset + header.tocLength)).entries;
	const symbolsAssets = assets.filter(a => a.resid === '__program_symbols__');
	if (symbolsAssets.length === 0) {
		throw new Error('ROM has no program-symbols asset.');
	}
	for (let i = 0; i < symbolsAssets.length; i++) {
		const a = symbolsAssets[i];
		const start = a.start!;
		const end = a.end!;
		console.log(`Asset ${i}: start=${start} end=${end} size=${end - start}`);
		const metadata = decodeProgramSymbolsImage(payload.subarray(start, end));
		console.log('protoIds length:', metadata.protoIds.length);
		console.log('systemGlobalNames length:', metadata.systemGlobalNames.length);
		console.log('globalNames length:', metadata.globalNames.length);
		console.log('Sample systemGlobalNames (first 200):');
		console.log(metadata.systemGlobalNames.slice(0, 200).join('\n'));
		console.log('Sample globalNames (first 200):');
		console.log(metadata.globalNames.slice(0, 200).join('\n'));
		console.log('---');
	}
}

if (require.main === module) {
	const rom = process.argv[2] || 'dist/pietious.rom';
	dump(rom);
}
