import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { load as parseYaml } from 'js-yaml';
import { decodeBinary, encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { packPietiousCollision } from '../../scripts/pietious/collision';
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
	const baseCollision = data.getUint32(stairs.base.collision, true);
	assert.deepEqual([0, 1, 2, 3].map(row => data.getUint32(baseCollision + 8 + 4 * row, true)), [6, 4, 4, 5]);
	assert.deepEqual(rowTiles(stairs.base.tape, 2, 3), ['castle_tile_blue_l', 'castle_pillar_blue_l2', 'castle_front_blue_1']);
	assert.notDeepEqual(rowTiles(stairs.stairs_open.tape, 2, 3), rowTiles(stairs.base.tape, 2, 3),
		'changed pillar bottom also changes the art selection in its adjacent row');
	assert.deepEqual(rowTiles(stairs.stairs_open.tape, 3, 3), ['castle_stairs_r', 'castle_tile_blue_l', 'castle_tile_blue_r_dark']);
	const seal = rooms[100].terrain;
	const sealWalls = (layout: { collision: number }) => {
		const at = data.getUint32(layout.collision, true);
		return [data.getUint32(at + 8, true), data.getUint32(at + 12, true)];
	};
	assert.deepEqual(sealWalls(seal.base), [3, 2]);
	assert.deepEqual(sealWalls(seal.seal_cleared), [2, 0]);
	assert.deepEqual(rowTiles(seal.base.dissolve[0], 0, 2), ['frontworld_l', 'frontworld_l']);
	assert.deepEqual(rowTiles(seal.base.dissolve[6], 0, 2), [null, 'frontworld_l']);
	assert.deepEqual(rowTiles(seal.seal_cleared.dissolve[6], 1, 2), [null, null]);
});

test('every authored room variant and rock state cooks exact wall cells, runs and staircase spans', () => {
	type ObjectCell = { type: string; x: number; y: number };
	const source = readFileSync('carts/pietious/res/data/castle_map.yaml', 'utf8');
	const rooms = parseYaml(source) as Record<string, {
		map: string[];
		objects?: ObjectCell[];
		stairs_open_rows?: Record<string, string>;
	}>;
	assert.equal(Object.keys(rooms).length, 24);
	for (const [number, room] of Object.entries(rooms)) {
		const base = room.map.map(row => [...row]);
		const rocks = [];
		const objects = room.objects ?? [];
		for (const object of objects) {
			if (object.type === 'rock') rocks.push(object);
			if (object.type === 'draaideur_blauw' || object.type === 'draaideur_rood') {
				for (let row = object.y; row < object.y + 3; ++row) base[row][object.x] = '.';
			}
		}
		const variants = [base];
		if (room.stairs_open_rows) {
			const opened = base.slice();
			for (const [y, row] of Object.entries(room.stairs_open_rows)) opened[Number(y) - 1] = [...row];
			variants.push(opened);
		}
		if (objects.some(object => object.type === 'seal'))
			variants.push(base.map(row => row.map(cell => cell === '$' ? '.' : cell)));
		for (const variant of variants) {
			const chunks: Buffer[] = [];
			let length = 0;
			const directory = packPietiousCollision(variant.map(row => row.join('')), rocks, bytes => {
				const start = length;
				length += bytes.length;
				chunks.push(bytes);
				return start;
			});
			const tape = Buffer.concat(chunks);
			for (let state = 0; state < (1 << rocks.length); ++state) {
				const context = `room ${number}, variant ${variants.indexOf(variant)}, rock state ${state}`;
				const rows = variant.map(row => row.slice());
				rocks.forEach(({ x, y }, ordinal) => {
					if ((state >>> ordinal) & 1) {
						rows[y][x] = rows[y][x + 1] = rows[y + 1][x] = rows[y + 1][x + 1] = '#';
					}
				});
				const at = tape.readUInt32LE(directory + state * 4);
				const runCount = tape.readUInt32LE(at);
				const stairCount = tape.readUInt32LE(at + 4);
				const runsAt = at + 8 + rows.length * 4;
				const stairsAt = runsAt + runCount * 4;
				const wall = (x: number, y: number) => rows[y][x] === '#' || rows[y][x] === '$';
				const covered = rows.map(row => row.map(() => false));
				for (let i = 0; i < runCount; ++i) {
					const runAt = runsAt + i * 4;
					const x = tape[runAt], y = tape[runAt + 1], width = tape[runAt + 2];
					assert.ok(width > 0 && !wall(x - 1, y) && !wall(x + width, y), context);
					for (let col = x; col < x + width; ++col) {
						assert.ok(!covered[y][col], context);
						covered[y][col] = true;
					}
				}
				for (let y = 0; y < rows.length; ++y) {
					const word = tape.readUInt32LE(at + 8 + y * 4);
					for (let x = 0; x < rows[y].length; ++x)
						assert.ok(covered[y][x] === wall(x, y) && Boolean((word >>> x) & 1) === wall(x, y), context);
				}
				const stair = (x: number, y: number) =>
					y >= 0 && y < rows.length && '-_'.includes(rows[y][x]) && '=+'.includes(rows[y][x + 1]);
				const stairCells = new Set<number>();
				let previous = -1;
				for (let i = 0; i < stairCount; ++i) {
					const span = stairsAt + i * 4;
					const x = tape[span], first = tape[span + 1], end = tape[span + 2];
					assert.ok(x * 256 + first > previous && first < end && !stair(x, first - 1) && !stair(x, end), context);
					for (let y = first; y < end; ++y) {
						assert.ok(stair(x, y), context);
						stairCells.add(x * 256 + y);
					}
					previous = x * 256 + first;
				}
				for (let y = 0; y < rows.length; ++y) {
					for (let x = 0; x + 1 < rows[y].length; ++x) assert.equal(stairCells.has(x * 256 + y), stair(x, y), context);
				}
			}
		}
	}
});
