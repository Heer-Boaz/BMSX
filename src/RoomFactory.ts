import { Room, RoomInitDelegate } from './room';
import { Point } from '../BoazEngineJS/interfaces';
import { newPoint } from '../BoazEngineJS/common';
import { Tile } from '../BoazEngineJS/msx';
import { GameModel as M } from "./sintervaniamodel";
import { GardenCandle } from './gardencandle';

export class RoomDataContainer {
	public Id: number;
	public CollisionMap: string[];
	public Exits: number[];
	public BitmapPath: string;
	public Map: number[][];
	public InitFunction: RoomInitDelegate;

	public constructor(id: number, cmap: string[], exits: number[], bitmapPath: string, map: number[][], initFunction: RoomInitDelegate) {
		this.Id = id;
		this.CollisionMap = cmap;
		this.Exits = exits;
		this.BitmapPath = bitmapPath;
		this.Map = map;
		this.InitFunction = initFunction;
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

	public static RoomMap_debug: number[][] = [
		[0, 3, 0,],
		[2, 1, 4,],
		[0, 0, 0,],
		[0, 0, 0,],
	];

	protected static rooms: Map<number, RoomDataContainer>;

	public static RoomExists(id: number): boolean {
		return RoomFactory.rooms.has(id);
	}

	public static LoadRoom(id: number): Room {
		if (!RoomFactory.rooms.has(id)) {
			throw Error("Room " + id + " could not be found in dictionary!");
		}

		return Room.LoadRoom(RoomFactory.rooms[id]);
	}

	private static posOnMap(map: number[][], id: number): Point {
		for (let y = 0; (y < map.length); y++) {
			for (let x = 0; (x < map[y].length); x++) {
				if ((map[y][x] == id)) {
					return newPoint(x, y);
				}
			}
		}

		throw new Error("Could not find room with Id {0} on the map:" + id);
	}

	private static roomExits(map: number[][], id: number): number[] {
		let result: number[] = new Array(4);
		let pos = RoomFactory.posOnMap(map, id);
		for (let i = 0; (i < RoomFactory.dirOffsets.length); i++) {
			let x: number = (pos.x + RoomFactory.dirOffsets[i][0]);
			let y: number = (pos.y + RoomFactory.dirOffsets[i][1]);
			if (((x < 0)
				|| ((x >= map[y].length)
					|| ((y < 0)
						|| (y >= map.length))))) {
				result[i] = Room.NO_ROOM_EXIT;
			}
			else {
				result[i] = map[y][x];
			}

		}

		return result;
	}

	public static PrepareData() {
		RoomFactory.rooms = new Map<number, RoomDataContainer>();
		// PrepareStage0Data();
		// PrepareStage1Data();
		// PrepareStage2Data();
	}

	public static PrepareDummyData() {
		RoomFactory.rooms = new Map<number, RoomDataContainer>();
		let collisionData: string[];
		let id: number;
		let bitmapPath: string;
		let map: number[][];
		id = 1;
		map = RoomFactory.RoomMap_debug;
		bitmapPath = "./Resources/Graphics/Stage/Dummy/DummyRoom.png";
		collisionData = [
			"................................",
			"................................",
			"................................",
			"................................",
			"................................",
			"................................",
			".......................##.......",
			".......................##.......",
			"......................###.......",
			"......................#######...",
			"......................#######...",
			".......................#######..",
			".......................#######..",
			".......................#######..",
			".......................########.",
			".......................########.",
			".......................########.",
			".......................########.",
			".........#.............########.",
			"......######............########",
			"...#########............########",
			"...########.............########",
			"...########.....................",
			"...########.....................", // 23
		];
		RoomFactory.rooms.set(id, new RoomDataContainer(id, collisionData, RoomFactory.roomExits(map, id), bitmapPath, map, null));
		RoomFactory.rooms.set(2, new RoomDataContainer(2, collisionData, RoomFactory.roomExits(map, 2), bitmapPath, map, null));
		RoomFactory.rooms.set(3, new RoomDataContainer(3, collisionData, RoomFactory.roomExits(map, 3), bitmapPath, map, null));
		RoomFactory.rooms.set(4, new RoomDataContainer(4, collisionData, RoomFactory.roomExits(map, 4), bitmapPath, map, null));
	}

	public static RoomMap_stage0: number[][] = [
		[0, 0, 0, 0, 0,],
		[0, 0, 100, 0, 0,],
		[0, 0, 0, 0, 0,],
		[0, 0, 0, 0, 0,],
	];

	public static PrepareStage0Data(): void {
		let collisionData: string[];
		let id: number;
		let bitmapPath: string;
		let map: number[][];
		let initFunction: RoomInitDelegate;
		id = 100;
		map = RoomFactory.RoomMap_stage0;
		bitmapPath = "./Resources/Graphics/Stage/castle_entrance_3.png";
		collisionData = [
			"################################",
			"#..............................#",
			"#..............................#",
			"#..............................#",
			"#..............................#",
			"#..............................#",
			"#..............................#",
			"#..............................#",
			"#..............................#",
			"#..............................#",
			"#...............................",
			"#...............................",
			"#...............................",
			"#...............................",
			"#...............................",
			"#...............................",
			"#...............................",
			"#...............................",
			"################################",
			"################################",
			"################################",
			"################################"];

		initFunction = (r: Room) => {
			let candle = new GardenCandle(<Point>Tile.ToCoord(8, 14));
			M._.spawn(candle);
			let candle2 = new GardenCandle(<Point>Tile.ToCoord(24, 14));
			M._.spawn(candle2);

			//if (!M._.GetItemPickedUp("rationroom100")) {
			//	var item = new Item(Item.Type.Ration, new Point(Tile.ToCoord(3), Tile.ToCoord(18))) { id = "rationroom100" };
			//	M._.Spawn(item);
			//}
		};

		RoomFactory.rooms.set(id, new RoomDataContainer(id, collisionData, RoomFactory.roomExits(map, id), bitmapPath, map, initFunction));
	}
}