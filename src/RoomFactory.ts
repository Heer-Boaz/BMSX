import { Room, RoomInitDelegate } from './room';
import { Point } from '../BoazEngineJS/interfaces';
import { newPoint } from '../BoazEngineJS/common';
import { Tile } from '../BoazEngineJS/msx';
import { GameModel as M } from "./sintervaniamodel";
import { GardenCandle } from './gardencandle';
import { BitmapId } from './resourceids';
import { HagGenerator } from './haggenerator';
import { Direction } from '../BoazEngineJS/direction';
import { ZakFoe } from './zakfoe';
import { Candle } from './candle';

export class RoomDataContainer {
	public id: number;
	public tiles: string[];
	public exits: number[];
	public imgid: BitmapId;
	public map: number[][];
	public initFunction: RoomInitDelegate;

	public constructor(id: number, tiles: string[], imgid: BitmapId, map: number[][], initFunction: RoomInitDelegate) {
		this.id = id;
		this.tiles = tiles;
		this.imgid = imgid;
		this.map = map;
		this.initFunction = initFunction;

		this.exits = RoomFactory.roomExits(map, id);
	}
}

export enum RoomMap {
	Debug,
	Dungeon1,
	Dungeon2,
	Town1,
}

export class RoomFactory {
	private static dirOffsets: { x: number, y: number }[] = [
		{ x: 0, y: -1 },
		{ x: 1, y: 0 },
		{ x: 0, y: 1 },
		{ x: -1, y: 0 },
	];

	protected static rooms: Map<number, RoomDataContainer>;

	public static RoomExists(id: number): boolean {
		return RoomFactory.rooms.has(id);
	}

	public static load(id: number): Room {
		if (!RoomFactory.RoomExists(id)) {
			throw Error("Room " + id + " could not be found in dictionary!");
		}

		return Room.LoadRoom(RoomFactory.rooms.get(id));
	}

	private static posOnMap(map: number[][], id: number): Point {
		for (let y = 0; (y < map.length); y++) {
			for (let x = 0; (x < map[y].length); x++) {
				if (map[y][x] === id) {
					return newPoint(x, y);
				}
			}
		}

		throw new Error("Could not find room with Id {0} on the map:" + id);
	}

	public static roomExits(map: number[][], id: number): number[] {
		let result: number[] = new Array(4);
		let pos = RoomFactory.posOnMap(map, id);
		for (let i = 0; i < RoomFactory.dirOffsets.length; i++) {
			let x: number = pos.x + RoomFactory.dirOffsets[i].x;
			let y: number = pos.y + RoomFactory.dirOffsets[i].y;
			if (x < 0 || x >= map[y].length || y < 0 || y >= map.length) {
				result[i] = Room.NO_ROOM_EXIT;
			}
			else {
				result[i] = map[y][x] || Room.NO_ROOM_EXIT;
			}

		}

		return result;
	}

	public static PrepareData() {
		RoomFactory.rooms = new Map<number, RoomDataContainer>();
		RoomFactory.PrepareStage0Data();
	}

	public static RoomMap_stage0: number[][] = [
		[0, 0, 0, 0, 0,],
		[0, 0, 1, 2, 0,],
		[0, 0, 0, 0, 0,],
		[0, 0, 0, 0, 0,],
	];

	public static PrepareStage0Data(): void {
		let tiles: string[];
		let id: number;
		let imgid: BitmapId;
		let map: number[][];
		let initFunction: RoomInitDelegate;

		id = 1;
		map = RoomFactory.RoomMap_stage0;
		imgid = BitmapId.Garden;
		tiles = [
			"################",
			"#..............#",
			"#..............#",
			"#..............#",
			"#..............#",
			"#...............",
			"#...............",
			"#...............",
			"#...............",
			"################",
			"----------------",
		];


		initFunction = (r: Room) => {
			let candle = new GardenCandle(Tile.toStagePoint(4, 7));
			M._.spawn(candle);
			let candle2 = new GardenCandle(Tile.toStagePoint(12, 7));
			M._.spawn(candle2);
		};

		RoomFactory.rooms.set(id, new RoomDataContainer(id, tiles, imgid, map, initFunction));

		id = 2;
		map = RoomFactory.RoomMap_stage0;
		imgid = undefined;
		tiles = [
			"################",
			"#..............#",
			"#..............#",
			"#..............#",
			"#..............#",
			"................",
			"................",
			"...........###..",
			"...........###..",
			"################",
			"----------------",
		];

		initFunction = (r: Room) => {
			let candle = new Candle(Tile.toStagePoint(4, 7));
			M._.spawn(candle);
			let candle2 = new Candle(Tile.toStagePoint(12, 7));
			M._.spawn(candle2);
			M._.spawn(new ZakFoe(<Point>Tile.create(8, 8), Direction.Left));
		};

		RoomFactory.rooms.set(id, new RoomDataContainer(id, tiles, imgid, map, initFunction));
	}
}

// M._.spawn(new HagGenerator(<Point>Tile.ToCoord(0, 14)));
// M._.spawn(new ZakFoe(<Point>Tile.create(1, 8), Direction.Right));
//if (!M._.GetItemPickedUp("rationroom100")) {
//	var item = new Item(Item.Type.Ration, new Point(Tile.ToCoord(3), Tile.ToCoord(18))) { id = "rationroom100" };
//	M._.Spawn(item);
//}
