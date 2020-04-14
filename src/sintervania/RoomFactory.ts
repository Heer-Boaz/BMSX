import { Room, RoomInitDelegate } from "./room";
import { newPoint, Point } from "../bmsx/common";
import { BitmapId } from "../bmsx/resourceids";
import * as stagedata from './data/maps.json';

export class RoomDataContainer {
	public id: number;
	public tiles: string[];
	public exits: number[];
	public imgid: BitmapId;
	public map: number[][];
	public stuff: any;
	public initFunction: RoomInitDelegate;

	public constructor(id: number, tiles: string[], imgid: BitmapId, map: number[][], stuff: any, initFunction: RoomInitDelegate) {
		this.id = id;
		this.tiles = tiles;
		this.imgid = imgid;
		this.map = map;
		this.stuff = stuff;
		this.initFunction = initFunction;

		this.exits = RoomFactory.roomExits(map, id);
	}
}

export class RoomFactory {
	private static dirOffsets: { x: number, y: number; }[] = [
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
		RoomFactory.doCoolJsonStuff();
	}

	public static RoomMap_stage0: number[][] = stagedata.maps[0].map;

	public static doCoolJsonStuff(): void {
		let tiles: string[];
		let id: number;
		let imgid: BitmapId;
		let map: number[][];
		let stuff: any;
		let initFunction: RoomInitDelegate;

		for (let room of stagedata.maps[0].rooms) {
			id = room.id;
			map = stagedata.maps[0].map;
			imgid = room.imgid ? (BitmapId[room.imgid] as unknown as BitmapId) : undefined;
			tiles = room.tiles;
			stuff = room.stuff;
			// initFunction = Function("r", room.init.join('\n')) as (r: Room) => void;

			RoomFactory.rooms.set(id, new RoomDataContainer(id, tiles, imgid, map, stuff, initFunction));
		}
	}

}