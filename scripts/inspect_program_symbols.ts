import fs from 'fs';
import { decodeBinary } from '../src/bmsx/common/serializer/binencoder';
import { PROGRAM_SYMBOLS_ASSET_ID } from '../src/bmsx/machine/program/asset';

function findAssetEntries(bytes: Uint8Array) {
	// The rompack format is custom; we'll scan for the program symbols asset by searching for the id string in the binary and then decode near it.
	// This is a lightweight inspector for debugging only.
	const text = new TextDecoder().decode(bytes);
	const idx = text.indexOf(PROGRAM_SYMBOLS_ASSET_ID);
	if (idx < 0) {
		console.error('No program symbols id found in ROM.');
		process.exit(1);
	}
	console.log('Found program symbols id at approx byte index', idx);
	// Now try a best-effort binary decode by scanning for binencoder root offset nearby.
	// Use a brute-force approach: try decoding starting at various offsets around the found index.
	for (let start = Math.max(0, idx - 512); start < Math.min(bytes.length, idx + 512); start += 1) {
		try {
			const slice = bytes.slice(start);
			const bin = decodeBinary(slice);
			if (bin && typeof bin === 'object' && bin.hasOwnProperty('metadata')) {
				console.log('Decoded program symbols asset at offset', start);
				console.log('metadata keys:', Object.keys((bin as any).metadata));
				const metadata = (bin as any).metadata;
				console.log('systemGlobalNames length=', metadata.systemGlobalNames?.length || 0);
				console.log('globalNames length=', metadata.globalNames?.length || 0);
				console.log('systemGlobalNames (sample 200 chars):\n', (metadata.systemGlobalNames || []).slice(0,200).join('\n'));
				console.log('globalNames (sample 200 chars):\n', (metadata.globalNames || []).slice(0,200).join('\n'));
				return;
			}
		} catch (err) {
			// ignore
		}
	}
	console.error('Failed to decode program symbols asset by scanning.');
}

const argv = process.argv.slice(2);
if (argv.length < 1) {
	console.error('Usage: tsx scripts/inspect_program_symbols.ts <rom-file>');
	process.exit(1);
}
const path = argv[0];
const bytes = fs.readFileSync(path);
findAssetEntries(bytes);
