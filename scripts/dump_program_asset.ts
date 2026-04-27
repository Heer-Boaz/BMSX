import fs from 'fs';
import { decodeProgramAsset } from '../src/bmsx/machine/program/asset';

function dump(romPath: string, resourcesJson: string) {
  const rom = fs.readFileSync(romPath);
  const assets = JSON.parse(fs.readFileSync(resourcesJson, 'utf8')) as Array<any>;
  const programAssets = assets.filter(a => a.resid === '__program__');
  if (programAssets.length === 0) {
    console.error('No __program__ assets found in resources JSON');
    process.exit(1);
  }
  for (let i = 0; i < programAssets.length; i++) {
    const a = programAssets[i];
    const start = a.start;
    const end = a.end;
    console.log(`Program Asset ${i}: start=${start} end=${end} size=${end-start}`);
    const bytes = rom.slice(start, end);
    try {
      const obj = decodeProgramAsset(bytes);
      const program = obj;
      console.log('constPool length:', program.program.constPool.length);
      for (let j = 0; j < program.program.constPool.length; j++) {
        const v = program.program.constPool[j];
        if (typeof v === 'string' && v.startsWith('modslot:')) {
          console.log(`const[${j}] = ${v}`);
        }
      }
      console.log('constRelocs length:', program.link.constRelocs.length);
      for (let j = 0; j < program.link.constRelocs.length; j++) {
        const r = program.link.constRelocs[j];
        if (r.kind === 'module') {
          console.log(`reloc[${j}] wordIndex=${r.wordIndex} kind=${r.kind} constIndex=${r.constIndex} -> const='${program.program.constPool[r.constIndex]}'`);
        }
      }
    } catch (err) {
      console.error('Failed to decode program asset at', start, end, err?.message ?? err);
    }
    console.log('---');
  }
}

if (require.main === module) {
  const rom = process.argv[2] || 'dist/pietious.rom';
  const resJson = process.argv[3] || 'rom/_ignore/romresources.json';
  dump(rom, resJson);
}
