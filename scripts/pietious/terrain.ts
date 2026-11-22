import { decodeBinary, encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';

const TILE_SIZE = 8;
const SEAL_DISSOLVE_COUNT = 7;
const DOOR_HEIGHT = 3;
const doorTypes = new Set(['draaideur_blauw', 'draaideur_rood']);

type RoomObject = { type: string; x: number; y: number };
type RoomSource = {
	subtype: string;
	map: string[];
	objects?: RoomObject[];
	stairs_open_rows?: Record<string, string>;
};

type BaseTerrain = { rows: string[]; tape: number; dissolve?: number[] };
type RoomTerrain = { base: BaseTerrain; stairs_open?: BaseTerrain; seal_cleared?: BaseTerrain };

const checkerTheme = (colour: string) => ({
	kind: 'checker' as const,
	front: `castle_front_${colour}_1`,
	tile: `castle_tile_${colour}_`,
});
const gardenTheme = (colour: string) => ({
	kind: 'grid' as const,
	front: 'castle_front_blue_1',
	tile: `castle_tile_${colour}_`,
});
const background = new Map<string, { kind: 'checker' | 'grid' | 'world'; front: string; tile: string }>([
	['castleblue', checkerTheme('blue')],
	['castlegold', checkerTheme('gold')],
	['castlegarden', gardenTheme('garden')],
	['castlered', gardenTheme('red')],
	['castlestone', gardenTheme('stone')],
	['world', { kind: 'world' as const, front: 'frontworld_l', tile: 'backworld_' }],
]);
const pillar = new Map([
	['castleblue', 'castle_pillar_blue_'],
	['castlegarden', 'castle_pillar_garden_'],
	['castlegold', 'castle_pillar_red_'],
	['castlered', 'castle_pillar_red_'],
	['castlestone', 'castle_pillar_stone_'],
	['world', 'backworld_pillar_'],
]);
const worldBackground = ['ul', 'ur', 'dl', 'dr', 'ur', 'ul', 'dr', 'dl'];

function screenRows(room: RoomSource): string[] {
	const rows = room.map.slice();
	for (const object of room.objects ?? []) {
		if (!doorTypes.has(object.type)) continue;
		for (let y = object.y; y < object.y + DOOR_HEIGHT; ++y) {
			const row = rows[y];
			rows[y] = row.slice(0, object.x) + '.' + row.slice(object.x + 1);
		}
	}
	return rows;
}

function tileArtAt(rows: readonly string[], subtype: string, x: number, y: number, phase: number): string | undefined {
	const theme = background.get(subtype)!;
	const ch = rows[y][x];
	switch (ch) {
		case '#': return theme.front;
		case '$':
			// Authored walls disappear along staggered diagonal bands.
			return theme.kind === 'world' && phase - 1 >= (x + 1 + (y + 1) * 3) % 6 + 1 ? undefined : theme.front;
		case '-': case '_': return 'castle_stairs_l';
		case '=': case '+': return 'castle_stairs_r';
		case 'p': return pillar.get(subtype)! + 'l1';
		case 'i': return pillar.get(subtype)! + 'r1';
		case 'a': return pillar.get(subtype)! + 'l3';
		case 'r': return pillar.get(subtype)! + 'r3';
		case 'l': {
			if (y > 0 && y + 1 < rows.length) {
				const above = rows[y - 1][x], below = rows[y + 1][x];
				if (above === 'p' && below === 'a') return pillar.get(subtype)! + 'l2';
				if (above === 'i' && below === 'r') return pillar.get(subtype)! + 'r2';
			}
			break;
		}
	}
	const above = y === 0 ? '.' : rows[y - 1][x];
	const dark = above === '#' || above === '$';
	switch (theme.kind) {
		case 'checker':
			return theme.tile + (((x ^ y) & 1) === 0 ? 'l' : 'r') + (dark ? '_dark' : '');
		case 'grid':
			return theme.tile + (dark ? `dark_${(x & 3) + 1}` : `${(x & 3) + 1}_${(y & 3) + 1}`);
		case 'world': {
			const quadrant = worldBackground[(y & 3) * 2 + (x & 1)];
			if (phase === 0) return theme.tile + quadrant + (dark ? '_dark' : '');
			if (phase < SEAL_DISSOLVE_COUNT) return theme.tile + quadrant + '_dissolve_' + (phase - 1);
			return undefined;
		}
	}
}

/** Compile the captured authored map. The runtime reads one aligned word per
 * row and then its implicit-position u8 spans; only the atlas art projection
 * depends on where the GPU admitted the texture. */
export function cookPietiousTerrain(assets: RomAsset[]): void {
	const mapAsset = assets.find(asset => asset.type === 'data' && asset.resid === 'castle_map')!;
	const rooms = decodeBinary(mapAsset.buffer!) as Record<string, RoomSource & { terrain: RoomTerrain }>;
	const images = new Map(assets.filter(asset => asset.type === 'image').map(asset => [asset.resid, asset.imgmeta]));
	const ordinals = new Map<string, number>();
	const chunks: Buffer[] = [];
	let size = 0;
	const append = (bytes: Buffer) => {
		const offset = size;
		size += bytes.length;
		chunks.push(bytes);
		return offset;
	};
	const artOrdinal = (id: string) => {
		let ordinal = ordinals.get(id);
		if (ordinal === undefined) {
			const image = images.get(id);
			if (image?.width !== TILE_SIZE || image.height !== TILE_SIZE || image.gx_page_tiles !== undefined)
				throw new Error(`Pietious terrain art ${id} must be a single ${TILE_SIZE}x${TILE_SIZE} source.`);
			ordinal = ordinals.size + 1;
			if (ordinal > 255) throw new Error('Pietious terrain art exceeds 255 tile ordinals.');
			ordinals.set(id, ordinal);
		}
		return ordinal;
	};
	const packRows = (rows: string[], subtype: string, phase: number) => {
		append(Buffer.alloc((-size) & 3));
		const directory = Buffer.alloc(rows.length * 4);
		const start = append(directory);
		for (let y = 0; y < rows.length; ++y) {
			const bytes = [0];
			let span = 0;
			for (let x = 0; x < rows[y].length; ++x) {
				const art = tileArtAt(rows, subtype, x, y, phase);
				if (art === undefined) {
					span = 0;
				} else {
					if (span === 0) {
						span = bytes.length + 1;
						bytes.push(x, 0);
					}
					++bytes[span];
					bytes.push(artOrdinal(art));
				}
			}
			bytes[0] = bytes.length;
			directory.writeUInt32LE(append(Buffer.from(bytes)), y * 4);
		}
		return start;
	};
	const layout = (rows: string[], subtype: string, seal: boolean): BaseTerrain => {
		const tape = packRows(rows, subtype, 0);
		if (!seal) return { rows, tape };
		const dissolve = [];
		for (let phase = 1; phase <= SEAL_DISSOLVE_COUNT; ++phase) dissolve.push(packRows(rows, subtype, phase));
		return { rows, tape, dissolve };
	};

	for (const room of Object.values(rooms)) {
		const rows = screenRows(room);
		const seal = room.objects?.some(object => object.type === 'seal') === true;
		room.terrain = { base: layout(rows, room.subtype, seal) };
		if (room.stairs_open_rows !== undefined) {
			const opened = rows.slice();
			for (const [ordinal, row] of Object.entries(room.stairs_open_rows)) opened[Number(ordinal) - 1] = row;
			room.terrain.stairs_open = layout(opened, room.subtype, false);
		}
		if (seal) {
			room.terrain.seal_cleared = layout(rows.map(row => row.replaceAll('$', '.')), room.subtype, true);
		}
	}
	mapAsset.buffer = encodeBinary(rooms);
	assets.push(
		{ resid: 'pietious_terrain_art', type: 'data', buffer: encodeBinary([...ordinals.keys()]) },
		{ resid: 'pietious_terrain_tape', type: 'bin', buffer: Buffer.concat(chunks, size) },
	);
}
