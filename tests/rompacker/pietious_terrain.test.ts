import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeBinary, encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { cookPietiousTerrain } from '../../scripts/pietious/terrain';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';

test('Pietious cooks door cutouts, neighbour shadows and authored stage variants into one ROM tape', () => {
	const source = {
		109: { subtype: 'castleblue', map: ['###', '#p#', '#l#', '#a#'],
			objects: [{ type: 'draaideur_blauw', x: 0, y: 0 }], stairs_open_rows: { 4: '=..' } },
		100: { subtype: 'world', map: ['$#', '.$'], objects: [{ type: 'seal', x: 0, y: 0 }] },
	};
	const ids = [
		'castle_front_blue_1', 'castle_tile_blue_l', 'castle_tile_blue_r', 'castle_tile_blue_l_dark', 'castle_tile_blue_r_dark',
		'castle_pillar_blue_l1', 'castle_pillar_blue_l2', 'castle_pillar_blue_l3', 'castle_stairs_r',
		'frontworld_l', 'backworld_ul', 'backworld_dl',
		...Array.from({ length: 6 }, (_, phase) => [`backworld_ul_dissolve_${phase}`, `backworld_dl_dissolve_${phase}`, `backworld_dr_dissolve_${phase}`]).flat(),
		'backworld_dl_dark', 'backworld_dr_dark',
	];
	const assets: RomAsset[] = [
		{ resid: 'castle_map', type: 'data', buffer: encodeBinary(source), sourcemeta: { text: 'authored' } },
		...ids.map((resid): RomAsset => ({ resid, type: 'image', imgmeta: { width: 8, height: 8, texture_u: 0, texture_v: 0 } })),
	];
	cookPietiousTerrain(assets);
	const rooms = decodeBinary(assets[0].buffer!);
	assert.equal(assets[0].sourcemeta!.text, 'authored');
	assert.deepEqual(rooms[109].map, source[109].map, 'source roles remain available to room authoring');
	const palette = decodeBinary(assets.find(asset => asset.resid === 'pietious_terrain_art')!.buffer!);
	const tape = assets.find(asset => asset.resid === 'pietious_terrain_tape')!.buffer!;
	const data = new DataView(tape.buffer, tape.byteOffset, tape.byteLength);
	const rowTiles = (directory: number, row: number, width: number) => {
		assert.equal(directory & 3, 0);
		const result = new Array<string | null>(width).fill(null);
		const start = data.getUint32(directory + 4 * row, true);
		const bytes = tape[start];
		for (let index = start + 1; index < start + bytes;) {
			const x = tape[index++], count = tape[index++];
			for (let cell = 0; cell < count; ++cell) result[x + cell] = palette[tape[index++] - 1];
		}
		return result;
	};
	const stairs = rooms[109].terrain;
	assert.deepEqual(rowTiles(stairs.base.tape, 2, 3), ['castle_tile_blue_l', 'castle_pillar_blue_l2', 'castle_front_blue_1']);
	assert.notDeepEqual(rowTiles(stairs.stairs_open.tape, 2, 3), rowTiles(stairs.base.tape, 2, 3),
		'changed pillar bottom also changes the art selection in its adjacent row');
	assert.deepEqual(rowTiles(stairs.stairs_open.tape, 3, 3), ['castle_stairs_r', 'castle_tile_blue_l', 'castle_tile_blue_r_dark']);
	const seal = rooms[100].terrain;
	assert.deepEqual(rowTiles(seal.base.dissolve[0], 0, 2), ['frontworld_l', 'frontworld_l']);
	assert.deepEqual(rowTiles(seal.base.dissolve[6], 0, 2), [null, 'frontworld_l']);
	assert.deepEqual(rowTiles(seal.seal_cleared.dissolve[6], 1, 2), [null, null]);
});
