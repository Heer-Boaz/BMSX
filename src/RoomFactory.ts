import { Room, RoomInitDelegate } from "./room";
import { newPoint, Point, Direction } from "./bmsx/common";
import { Tile } from "./bmsx/msx";
import { Model as M, Model } from "./gamemodel";
import { GardenCandle } from "./gardencandle";
import { BitmapId } from "./bmsx/resourceids";
import { HagGenerator } from "./haggenerator";
import { ZakFoe } from "./zakfoe";
import { Candle } from "./candle";
import { Pietula } from "./pietula";
import { Controller } from "./gamecontroller";
import { model } from './bmsx/engine';

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

export const enum RoomMap {
	Debug,
	Dungeon1,
	Dungeon2,
	Town1,
}

export class RoomFactory {
	private static dirOffsets: { x: number, y: number }[] = [
		{ x: 0, y: 0 },
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
		let result: number[] = new Array(5);
		let pos = RoomFactory.posOnMap(map, id);
		for (let i = 1; i < RoomFactory.dirOffsets.length; i++) {
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
		[0, 0, 0, 0, 0, 0, 0, 0, 0,],
		[0, 1, 2, 3, 4, 5, 6, 100, 0,],
		[0, 0, 0, 0, 0, 0, 0, 0, 0,],
		[0, 0, 0, 0, 0, 0, 0, 0, 0,],
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
			"#...............",
			"#...............",
			"#...............",
			"#...............",
			"#...............",
			"#...............",
			"#...............",
			"#...............",
			"################",
			"----------------",
		];

		initFunction = (r: Room) => {
			new GardenCandle().spawn(Tile.toStagePoint(4, 7));
			new GardenCandle().spawn(Tile.toStagePoint(12, 7));
		};

		RoomFactory.rooms.set(id, new RoomDataContainer(id, tiles, imgid, map, initFunction));

		id = 2;
		map = RoomFactory.RoomMap_stage0;
		imgid = BitmapId.Garden;
		tiles = [
			"################",
			"................",
			"................",
			"................",
			"................",
			"................",
			"................",
			"................",
			"................",
			"################",
			"----------------",
		];

		initFunction = (r: Room) => {
			new GardenCandle().spawn(Tile.toStagePoint(4, 7));
			new GardenCandle().spawn(Tile.toStagePoint(12, 7));
			new ZakFoe(Direction.Left).spawn(Tile.toStagePoint(14, 8));
			new ZakFoe(Direction.Left).spawn(Tile.toStagePoint(7, 8));
		};

		RoomFactory.rooms.set(id, new RoomDataContainer(id, tiles, imgid, map, initFunction));

		id = 3;
		map = RoomFactory.RoomMap_stage0;
		imgid = BitmapId.Garden_entrance;
		tiles = [
			"################",
			"................",
			"................",
			"................",
			"................",
			"................",
			"................",
			"................",
			"................",
			"################",
			"----------------",
		];

		initFunction = (r: Room) => {
			new GardenCandle().spawn(Tile.toStagePoint(4, 7));
			new ZakFoe(Direction.Left).spawn(Tile.toStagePoint(14, 8));
		};

		RoomFactory.rooms.set(id, new RoomDataContainer(id, tiles, imgid, map, initFunction));

		id = 4;
		map = RoomFactory.RoomMap_stage0;
		imgid = undefined;
		tiles = [
			"################",
			"#...............",
			"#...............",
			"####.....#######",
			"#...............",
			"#...............",
			"#......####.....",
			"#...............",
			"#...............",
			"################",
			"################",
		];

		initFunction = (r: Room) => {
			new HagGenerator().spawn(Tile.toStagePoint(15, 1));
			new HagGenerator().spawn(Tile.toStagePoint(15, 7));
			new Candle().spawn(Tile.toStagePoint(2, 1.5));
			new Candle().spawn(Tile.toStagePoint(12, 1.5));
			new Candle().spawn(Tile.toStagePoint(2, 7));
			new Candle().spawn(Tile.toStagePoint(12, 7));
			new ZakFoe(Direction.Left).spawn(Tile.toStagePoint(10, 2));
			new ZakFoe(Direction.Left).spawn(Tile.toStagePoint(8, 8));
		};

		RoomFactory.rooms.set(id, new RoomDataContainer(id, tiles, imgid, map, initFunction));

		id = 5;
		map = RoomFactory.RoomMap_stage0;
		imgid = undefined;
		tiles = [
			"################",
			"................",
			"................",
			"#######....#####",
			"................",
			"................",
			"....############",
			"................",
			"................",
			"################",
			"################",
		];

		initFunction = (r: Room) => {
			(model as Model).spawn(new HagGenerator(Tile.toStagePoint(15, 1)));
			(model as Model).spawn(new HagGenerator(Tile.toStagePoint(15, 7)));
			(model as Model).spawn(new Candle(Tile.toStagePoint(2, 1.5)));
			(model as Model).spawn(new Candle(Tile.toStagePoint(12, 1.5)));
			(model as Model).spawn(new Candle(Tile.toStagePoint(2, 7)));
			(model as Model).spawn(new Candle(Tile.toStagePoint(12, 7)));
			(model as Model).spawn(new ZakFoe(Tile.toStagePoint(10, 2), Direction.Left));
			(model as Model).spawn(new ZakFoe(Tile.toStagePoint(8, 8), Direction.Left));
			(model as Model).spawn(new ZakFoe(Tile.toStagePoint(8, 5), Direction.Left));
		};

		RoomFactory.rooms.set(id, new RoomDataContainer(id, tiles, imgid, map, initFunction));

		id = 6;
		map = RoomFactory.RoomMap_stage0;
		imgid = undefined;
		tiles = [
			"################",
			"...............#",
			"...............#",
			"#######....#####",
			".....##.........",
			".....##.........",
			".....###########",
			"...............#",
			"...............#",
			"################",
			"################",
		];

		initFunction = (r: Room) => {
			(model as Model).spawn(new HagGenerator(Tile.toStagePoint(15, 1)));
			(model as Model).spawn(new HagGenerator(Tile.toStagePoint(15, 7)));
			(model as Model).spawn(new Candle(Tile.toStagePoint(2, 1.5)));
			(model as Model).spawn(new Candle(Tile.toStagePoint(12, 1.5)));
			(model as Model).spawn(new Candle(Tile.toStagePoint(2, 7)));
			(model as Model).spawn(new Candle(Tile.toStagePoint(12, 7)));
			(model as Model).spawn(new ZakFoe(Tile.toStagePoint(10, 8), Direction.Left));
			(model as Model).spawn(new ZakFoe(Tile.toStagePoint(5, 2), Direction.Left));
			(model as Model).spawn(new ZakFoe(Tile.toStagePoint(11, 5), Direction.Left));
		};

		RoomFactory.rooms.set(id, new RoomDataContainer(id, tiles, imgid, map, initFunction));

		id = 100;
		map = RoomFactory.RoomMap_stage0;
		imgid = undefined;
		tiles = [
			"################",
			"################",
			"#--------------#",
			"#--------------#",
			"#--------------#",
			"#--------------#",
			"#--------------#",
			"####--------####",
			"#--------------#",
			"#--------------#",
			"################",
		];

		initFunction = (r: Room) => {
			(model as Model).spawn(new Candle(Tile.toStagePoint(5, 3)));
			(model as Model).spawn(new Candle(Tile.toStagePoint(10, 3)));
			(model as Model).spawn(new Candle(Tile.toStagePoint(5, 5)));
			(model as Model).spawn(new Candle(Tile.toStagePoint(10, 5)));
			(model as Model).spawn(new Candle(Tile.toStagePoint(5, 7)));
			(model as Model).spawn(new Candle(Tile.toStagePoint(10, 7)));
			let deBaas = new Pietula();
			(model as Model).spawn(deBaas);
			Controller._.startBossFight(deBaas);
			(model as Model).Belmont.setx(Tile.toStageCoord(2));
			(model as Model).Belmont.sety(Tile.toStageCoord(8));
		};

		RoomFactory.rooms.set(id, new RoomDataContainer(id, tiles, imgid, map, initFunction));
	}
}
// (model as Model).spawn(new HagGenerator(<Point>Tile.ToCoord(0, 14)));
// (model as Model).spawn(new ZakFoe(<Point>Tile.create(1, 8), Direction.Right));
//if (!(model as Model).GetItemPickedUp("rationroom100")) {
//	var item = new Item(Item.Type.Ration, new Point(Tile.ToCoord(3), Tile.ToCoord(18))) { id = "rationroom100" };
//	(model as Model).Spawn(item);
//}
