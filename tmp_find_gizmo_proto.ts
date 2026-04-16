import { readFileSync } from 'node:fs';
import { loadRomAssetList } from './src/bmsx/rompack/romloader';
import {
	decodeProgramAsset,
	decodeProgramSymbolsAsset,
	PROGRAM_ASSET_ID,
	PROGRAM_SYMBOLS_ASSET_ID,
	inflateProgram,
} from './src/bmsx/machine/program/program_asset';
import { disassembleProto } from './src/bmsx/machine/cpu/disassembler';

(async () => {
	const rom = new Uint8Array(readFileSync('dist/bmsx-bios.debug.rom'));
	const { assets } = await loadRomAssetList(rom);
	const programAsset = assets.find((asset) => asset.resid === PROGRAM_ASSET_ID);
	if (
		programAsset === undefined ||
		programAsset.start === undefined ||
		programAsset.end === undefined
	) {
		throw new Error('missing program asset');
	}
	const symbolsAsset = assets.find((asset) => asset.resid === PROGRAM_SYMBOLS_ASSET_ID);
	if (
		symbolsAsset === undefined ||
		symbolsAsset.start === undefined ||
		symbolsAsset.end === undefined
	) {
		throw new Error('missing symbols asset');
	}
	const programData = decodeProgramAsset(new Uint8Array(rom.slice(programAsset.start, programAsset.end)).program);
	const program = inflateProgram(programData);
	const symbols = decodeProgramSymbolsAsset(new Uint8Array(rom.slice(symbolsAsset.start, symbolsAsset.end));
	const sourceMap = new Map<string, string>();
	for (const asset of assets) {
		if (asset.start !== undefined && asset.end !== undefined && (asset.type === 'lua' || asset.type === 'luasource')) {
			const path = asset.normalized_source_path || asset.source_path || '';
			sourceMap.set(path, Buffer.from(rom.slice(asset.start, asset.end)).toString('utf8'));
		}
	}
	const protoIds = symbols.metadata.protoIds;
	const gizmoProtoIds = [] as number[];
	for (let i = 0; i < protoIds.length; i += 1) {
		if (protoIds[i].indexOf('resource_usage_gizmo.lua') >= 0) {
			gizmoProtoIds.push(i);
		}
	}
	console.log('gizmo protoIds:', JSON.stringify(gizmoProtoIds));
	for (const protoIndex of gizmoProtoIds) {
		const text = disassembleProto(program, protoIndex, symbols.metadata, {
			formatStyle: 'assembly',
			showSourceComments: true,
			showProtoHeaders: true,
			sourceTextForPath: (path: string) => {
				const source = sourceMap.get(path);
				if (source === undefined) {
					throw new Error('missing source for ' + path);
				}
				return source;
			},
		});
		console.log('--- proto', protoIndex, '---');
		console.log(text);
	}
})();
