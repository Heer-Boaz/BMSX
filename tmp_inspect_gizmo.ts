import { promises as fs } from 'fs';
import { parseCartHeader, loadAssetList } from './src/bmsx/rompack/romloader';
import { decodeProgramAsset, decodeProgramSymbolsAsset, inflateProgram, PROGRAM_ASSET_ID, PROGRAM_SYMBOLS_ASSET_ID } from './src/bmsx/machine/program/program_asset';

(async () => {
  const path = 'dist/2025.debug.rom';
  const raw = await fs.readFile(path);
  const header = parseCartHeader(raw);
  const { assets, manifest } = await loadAssetList(raw);
  const programEntry = assets.find(a => a.resid === PROGRAM_ASSET_ID);
  if (!programEntry || programEntry.start === undefined || programEntry.end === undefined) {
    throw new Error('no program asset');
  }
  const programBytes = new Uint8Array(raw.slice(programEntry.start, programEntry.end));
  const programAsset = decodeProgramAsset(programBytes);
  const program = inflateProgram(programAsset.program);

  const symbolsEntry = assets.find(a => a.resid === PROGRAM_SYMBOLS_ASSET_ID);
  if (!symbolsEntry || symbolsEntry.start === undefined || symbolsEntry.end === undefined) {
    throw new Error('no symbols asset');
  }
  const metadata = decodeProgramSymbolsAsset(new Uint8Array(raw.slice(symbolsEntry.start, symbolsEntry.end))).metadata;

  console.log('header programProtoCount', header.programProtoCount);
  console.log('manifest?', !!manifest);
  console.log('program protons', program.protos.length);
  console.log('metadata keys', Object.keys(metadata));
  if (metadata.protoNames) {
    let count = 0;
    for (const [protoId, name] of Object.entries(metadata.protoNames)) {
      if (String(name).includes('resource_usage_gizmo')) {
        console.log('protoNames hit', protoId, name);
      }
      count += 1;
      if (count < 25) {
        // no-op
      }
    }
    console.log('protoNames total', Object.keys(metadata.protoNames).length);
  }
  if (metadata.protoIds) {
    let matches = 0;
    for (const [protoId, path] of Object.entries(metadata.protoIds)) {
      if (typeof path === 'string' && path.includes('resource_usage_gizmo')) {
        matches += 1;
        console.log('protoIds hit', protoId, path);
      }
    }
    console.log('protoIds matches', matches);
  } else {
    console.log('no protoIds in metadata');
  }
})();
