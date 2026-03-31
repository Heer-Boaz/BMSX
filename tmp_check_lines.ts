import { loadRomAssetList } from './src/bmsx/rompack/romloader';
import { loadProgramFromAssets, disassembleProgramAsset } from './scripts/rominspector/inspector_shared';
import * as fs from 'fs';

(async () => {
	const romPath = process.argv[2] ?? 'dist/bmsx-bios.debug.rom';
	const rombin = new Uint8Array(fs.readFileSync(romPath));
	const { assets } = await loadRomAssetList(rombin);
	const loaded = loadProgramFromAssets(rombin, assets);
	const asm = disassembleProgramAsset(loaded.program, loaded.metadata, loaded.sourceTextForPath, { assembly: true });
	const protoIdx = asm.indexOf('; proto=825');
	if (protoIdx < 0) {
		console.log('protoNotFound');
		return;
	}
	const before = asm.slice(0, protoIdx);
	const lines = before.split('\n');
	const protoLine = lines.length;
	const startLine = Math.max(0, protoLine - 15);
	const endLine = protoLine + 190;
	const allLines = asm.split('\n');
	for (let i = startLine; i < Math.min(endLine, allLines.length); i += 1) {
		console.log(String(i + 1).padStart(5, ' '), allLines[i]);
	}
})();
