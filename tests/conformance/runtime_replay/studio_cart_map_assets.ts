import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { generateRomAssets, finalizeRompack } from '../../../scripts/rompacker/rombuilder';
import { decodeBinary } from '../../../machine/ts/common/serializer/binencoder';
import { layoutRomPrefix } from '../../../toolchain/ts/rompack/rom_prefix_layout';
import { loadRomAssetList } from '../../../toolchain/ts/rompack/loader';

/** Separate build acceptance: Studio Save persists source; only the actual cooker publishes data. */
async function main(): Promise<void> {
	const [cart, sourcePath, originalRomPath, outputDirectory] = process.argv.slice(2);
	assert.ok(cart === 'pietious' || cart === 'nemesis_s');
	const name = cart === 'pietious' ? 'castle_map' : 'nemesis_s_stage';
	const source = await readFile(sourcePath, 'utf8');
	const originalRom = await readFile(originalRomPath);
	const originalEntries = await loadRomAssetList(originalRom, 'cart');
	const original = originalEntries.entries.find(entry => entry.type === 'data' && entry.resid === name)!;
	assert.notEqual(source, original.sourcemeta!.text, 'the build consumes the actual edited workspace bytes');
	const assets = await generateRomAssets([{
		type: 'data', name, id: 1, datatype: 'yaml', sourcePath: `res/data/${name}.yaml`, buffer: Buffer.from(source),
	}]);
	await finalizeRompack('edited-map', { debug: true, blua32: null, outputDirectory,
		layout: layoutRomPrefix(assets, true, { hardware: [{ type: 'rom' }] }) });
	const rom = await readFile(join(outputDirectory, 'edited-map.debug.rom'));
	const { entries } = await loadRomAssetList(rom, 'cart');
	const packed = entries.find(entry => entry.type === 'data' && entry.resid === name)!;
	const bytes = rom.subarray(packed.start!, packed.end!);
	const cooked = decodeBinary(bytes);
	assert.notDeepEqual(bytes, originalRom.subarray(original.start!, original.end!), 'cooked map changes only after the separate build');
	assert.equal(packed.sourcemeta!.text, source, 'debug metadata preserves every saved source byte');
	assert.deepEqual(cooked, parseYaml(source), 'the ROM contains the complete edited YAML data');
	if (cart === 'pietious') {
		const rooms = cooked as Record<string, { map: string[]; objects?: { x: number; y: number }[] }>;
		assert.equal(rooms['2'].objects![3].x, 14);
		assert.equal(rooms['2'].objects![3].y, 13);
	} else {
		const stage = cooked as { map_rows: string[] };
		assert.equal(stage.map_rows[1][257], ' ');
		assert.equal(stage.map_rows[1][258], 'm');
	}
	console.info(`STUDIO-${cart}-MAP-ASSET:PASS source=${source.length} cooked=${bytes.byteLength}`);
}

void main();
