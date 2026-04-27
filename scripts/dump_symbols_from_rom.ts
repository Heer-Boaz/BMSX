import fs from 'fs';
import { decodeProgramSymbolsAsset } from '../src/bmsx/machine/program/asset';

function dump(romPath: string, resourcesJson: string) {
	const rom = fs.readFileSync(romPath);
	const assets = JSON.parse(fs.readFileSync(resourcesJson, 'utf8')) as Array<any>;
	const symbolsAssets = assets.filter(a => a.resid === '__program_symbols__');
	if (symbolsAssets.length === 0) {
		console.error('No program_symbols assets found in resources JSON');
		process.exit(1);
	}
	for (let i = 0; i < symbolsAssets.length; i++) {
		const a = symbolsAssets[i];
		const start = a.start;
		const end = a.end;
		console.log(`Asset ${i}: start=${start} end=${end} size=${end - start}`);
		const bytes = rom.slice(start, end);
		try {
			const obj = decodeProgramSymbolsAsset(bytes);
			const meta = obj.metadata;
			console.log('protoIds length:', meta.protoIds?.length ?? 0);
			console.log('systemGlobalNames length:', meta.systemGlobalNames?.length ?? 0);
			console.log('globalNames length:', meta.globalNames?.length ?? 0);
			console.log('Sample systemGlobalNames (first 200):');
			console.log((meta.systemGlobalNames || []).slice(0, 200).join('\n'));
			console.log('Sample globalNames (first 200):');
			console.log((meta.globalNames || []).slice(0, 200).join('\n'));
		} catch (err) {
			console.error('Failed to decode program symbols at', start, end, err?.message ?? err);
		}
		console.log('---');
	}
}

if (require.main === module) {
	const rom = process.argv[2] || 'dist/pietious.rom';
	const resJson = process.argv[3] || 'rom/_ignore/romresources.json';
	dump(rom, resJson);
}
