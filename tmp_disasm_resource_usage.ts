import * as fs from 'fs';
import { loadRomAssetList } from './src/bmsx/rompack/romloader';
import { loadProgramFromAssets, disassembleProgramAsset } from './scripts/rominspector/inspector_shared';

async function main() {
  const romPath = process.argv[2];
  if (!romPath) throw new Error('rom path required');
  const rombin = new Uint8Array(fs.readFileSync(romPath));
  const { assets } = await loadRomAssetList(rombin);
  const { program, metadata, sourceTextForPath } = loadProgramFromAssets(rombin, assets);
  if (!metadata) throw new Error('no metadata');
  const asm = disassembleProgramAsset(program, metadata, sourceTextForPath, { assembly: true });
  const lines = asm.split('\n');

  const markers: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes('resource_usage_gizmo.lua')) {
      markers.push(i);
    }
  }
  console.log('marker count', markers.length);
  for (let m = 0; m < Math.min(markers.length, 12); m += 1) {
    const i = markers[m];
    console.log('\n## block', m + 1, 'at line', i + 1, lines[i]);
    const start = Math.max(0, i);
    const end = Math.min(lines.length, i + 220);
    for (let j = start; j < end; j += 1) {
      const text = lines[j];
      if (text.includes('write_words') || text.includes('LOADK') || text.includes('MOV ') || text.includes('MOV\t') || text.includes('pct_text') || text.includes('resource_usage_gizmo.lua') || text.includes('proto')) {
        console.log(String(j + 1).padStart(5, ' ') + ': ' + text);
      }
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
