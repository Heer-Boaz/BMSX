import { readFileSync } from 'node:fs';
import { loadRomAssetList } from './src/bmsx/rompack/romloader';
import { decodeProgramAsset, PROGRAM_ASSET_ID, PROGRAM_SYMBOLS_ASSET_ID, inflateProgram } from './src/bmsx/machine/program/program_asset';

async function main() {
  const rom = new Uint8Array(readFileSync('dist/bmsx-bios.debug.rom'));
  const { assets } = await loadRomAssetList(rom);
  const programAsset = assets.find((asset) => asset.resid === PROGRAM_ASSET_ID);
  if (programAsset === undefined || programAsset.start === undefined || programAsset.end === undefined) {
    throw new Error('missing program asset');
  }
  const symbolsAsset = assets.find((asset) => asset.resid === PROGRAM_SYMBOLS_ASSET_ID);
  const programAssetData = decodeProgramAsset(new Uint8Array(rom.slice(programAsset.start, programAsset.end)));
  const program = inflateProgram(programAssetData.program);
  console.log('assets', assets.length);
  console.log('program.protos', program.protos.length);
  console.log('program.codeLen', program.codeLen);
  if (symbolsAsset) {
    console.log('symbols asset present', symbolsAsset.start, symbolsAsset.end);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
