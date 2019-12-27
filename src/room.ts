import { Candle } from './candle';
import { TileSize, Tile } from "./bmsx/msx";
import { Direction, Point, newPoint } from "./bmsx/common";
import { GameConstants as CS, GameConstants } from "./gameconstants";
import { view, IGameObject, model } from "./bmsx/engine";
import { RoomDataContainer } from "./RoomFactory";
import { BitmapId } from "./bmsx/resourceids";
import { Model } from "./gamemodel";
import { GardenCandle } from './gardencandle';
import { ZakFoe } from './zakfoe';
import { HagGenerator } from './haggenerator';
import { Pietula } from './pietula';
import { Controller } from './gamecontroller';

export type NearingRoomExitResult = { destRoom: number, direction: Direction } | null;
export type RoomInitDelegate = (room: Room) => void;

export class Room implements IGameObject {
	id: string;
	disposeFlag: boolean = false;
	priority: number = -1;
	pos: Point = null;
	disposeOnSwitchRoom: boolean = true;
	visible: boolean = true;

	public static RoomWidth: number = 0;
	public static RoomHeight: number = 0;
	public static NO_ROOM_EXIT: number = -1;

	public tiles: string[];
	public roomid: number;

	// public M.Location RespawnLocation;
	///  <summary>
	///  Used at room init to easily determine whether to auto set the respawn location
	///  </summary>
	// public bool DefaultRespawnLocation;
	public exits: number[];
	public initFunction: RoomInitDelegate;
	public imgid: BitmapId;
	protected stuff: any;

	public static LoadRoom(data: RoomDataContainer): Room {
		var result = new Room();
		result.roomid = data.id;
		result.tiles = data.tiles;
		result.exits = data.exits;
		result.stuff = data.stuff;
		result.initFunction = data.initFunction;
		result.imgid = data.imgid;

		return result;
	}

	public onspawn() {
		this.handleTheStuff();
		this.initFunction?.(this);
	}

	protected handleTheStuff(): void {
		for (let ding of this.stuff) {
			let pos: Point;
			if (ding.tpos) {
				pos = {
					x: ding.tpos[0] * TileSize,
					y: ding.tpos[1] * TileSize
				};
			}
			else if (ding.pos) {
				pos = {
					x: ding.tpos[0],
					y: ding.tpos[1]
				};
			}
			switch (ding.wat) {
				case 'gardencandle':
					new GardenCandle().spawn(pos);
					break;
				case 'candle':
					new Candle().spawn(pos);
					break;
				case 'haggenerator':
					new HagGenerator().spawn(pos);
					break;
				case 'zakfoe': {
					let dir = Direction[ding.dir as string];
					new ZakFoe(dir).spawn(pos);
					break;
				}
				case 'pietula': {
					let deBaas = new Pietula();
					(model as Model).spawn(deBaas);
					Controller._.startBossFight(deBaas);
					(model as Model).Belmont.setx(Tile.toStageCoord(2));
					(model as Model).Belmont.sety(Tile.toStageCoord(8));
					break;
				}
			}
		}
	}

	public takeTurn() {
		// TODO: Ga dingen doen
	}

	///  <summary>Checks if there is a collision tile in any of the given coordinates</summary>
	public AnyCollisionsTiles(...coordinatesToCheck: Point[]): boolean {
		return coordinatesToCheck.some(x => this.isCollisionTile(x.x, x.y));
	}

	public nearingRoomExit(x: number, y: number): NearingRoomExitResult {
		let _x: number = ~~(x / TileSize);
		let _y: number = ~~(y / TileSize);
		let result: NearingRoomExitResult = { destRoom: Room.NO_ROOM_EXIT, direction: Direction.None };

		if (x <= 0) {
			//  Note: Check for x and not _x, as -1 / (...) will result in 0!
			let dest = this.roomExit(Direction.Left);
			result = { destRoom: dest, direction: Direction.Left };
		}
		else if (_x >= CS.StageScreenWidthTiles) {
			let dest = this.roomExit(Direction.Right);
			result = { destRoom: dest, direction: Direction.Right };
		}
		else if (_y < 2) {
			let dest = this.roomExit(Direction.Up);
			result = { destRoom: dest, direction: Direction.Up };
		}
		else if (_y >= CS.StageScreenHeightTiles) {
			let dest = this.roomExit(Direction.Down);
			result = { destRoom: dest, direction: Direction.Down };
		}

		return result;
	}

	public nearestNonCollisionPoint(x: number, y: number, dir: Direction): number {
		let _x: number = ~~(x / TileSize);
		let _y: number = ~~(y / TileSize);

		let dx: number, dy: number;
		switch (dir) {
			case Direction.Up:
				dx = 0;
				dy = -1;
				break;
			case Direction.Right:
				dx = 1;
				dy = 0;
				break;
			case Direction.Down:
				dx = 0;
				dy = 1;
				break;
			case Direction.Left:
			default:
				dx = -1;
				dy = 0;
				break;
		}
		while (_x >= 0 && _x <= GameConstants.StageScreenWidthTiles - 1 && _y >= 0 && _y <= GameConstants.StageScreenStartHeightTiles + GameConstants.StageScreenHeightTiles - 1) {
			if (this.tiles[_y][_x] === '.' || this.tiles[_y][_x] === '-') {
				switch (dir) {
					case Direction.Up:
						return (_y) * TileSize;
					case Direction.Down:
						return (_y) * TileSize;
					case Direction.Left:
						return (_x) * TileSize;
					case Direction.Right:
						return (_x) * TileSize;
					default:
						return 0;
				}
			}
			_x += dx;
			_y += dy;
		}
		return 0;
	}

	public isCollisionTile(x: number, y: number): boolean {
		let _x: number = ~~(x / TileSize);
		let _y: number = ~~(y / TileSize);
		if (x < 0) {
			//  Note: Check for x and not _x, as -1 / (...) will result in 0!
			if (this.canLeaveRoom(Direction.Left)) {
				_x = 0;
			}
			else {
				return true;
			}

		}
		else if (_x >= GameConstants.StageScreenWidthTiles) {
			if (this.canLeaveRoom(Direction.Right)) {
				_x = (GameConstants.StageScreenWidthTiles - 1);
			}
			else {
				return true;
			}

		}

		if (_y < 1 && _y >= -1) {
			if (this.canLeaveRoom(Direction.Up)) {
				_y = 0;
			}
			else {
				return true;
			}

		}
		else if (_y >= GameConstants.StageScreenHeightTiles) {
			if (this.canLeaveRoom(Direction.Down)) {
				_y = GameConstants.StageScreenHeightTiles - 1;
			}
			else {
				return true;
			}

		}

		if (this.tiles[_y][_x] !== '.' && this.tiles[_y][_x] !== '-') {
			return true;
		}

		return false;
	}

	public collidesWithTile(o: IGameObject, dir: Direction): boolean {
		let startx = o.wallhitbox_sx;
		let starty = o.wallhitbox_sy;
		let endx = o.wallhitbox_ex;
		let endy = o.wallhitbox_ey;
		switch (dir) {
			case Direction.Up:
				return this.isCollisionTile(startx, starty) || this.isCollisionTile(endx, starty);
			case Direction.Right:
				return this.isCollisionTile(endx, starty) || this.isCollisionTile(endx, endy);
			case Direction.Down:
				return this.isCollisionTile(startx, endy) || this.isCollisionTile(endx, endy);
			case Direction.Left:
				return this.isCollisionTile(startx, starty) || this.isCollisionTile(startx, endy);
			case Direction.None:
				return this.isCollisionTile(startx, starty) || this.isCollisionTile(endx, endy);
			default:
				return false;
		}
	}

	private roomExit(dir: number): number {
		return (<Model>model).RoomExitsLocked ? Room.NO_ROOM_EXIT : this.exits[dir];
	}

	private canLeaveRoom(dir: number): boolean {
		if ((<Model>model).RoomExitsLocked) { return false; }

		return (this.roomExit(dir) !== Room.NO_ROOM_EXIT);
	}

	public paint() {
		if (this.imgid) { view.drawImg(this.imgid, CS.GameScreenStartX, CS.GameScreenStartY); }
		else {
			for (let y = 0; y < this.tiles.length; y++) {
				for (let x = 0; x < this.tiles[y].length; x++) {
					let img = this.tileImgid(x, y);
					if (img !== BitmapId.None)
						view.drawImg(img, CS.GameScreenStartX + x * TileSize, CS.GameScreenStartY + y * TileSize);
				}
			}
		}

		// for (let y = 0; y < this.tiles.length; y++) {
		// 	for (let x = 0; x < this.tiles[y].length; x++) {
		// 		if (this.tiles[y][x] !== '.' && this.tiles[y][x] !== '-') {
		// 			view.fillRectangle(CS.GameScreenStartX + x * TileSize, CS.GameScreenStartY + y * TileSize, CS.GameScreenStartX + (x + 1) * TileSize, CS.GameScreenStartY + (y + 1) * TileSize, { r: 255, g: 255, b: 255, a: 0.5 });
		// 		}
		// 	}
		// }
	}

	protected tileImgid(x: number, y: number): BitmapId {
		switch (this.tiles[y][x]) {
			case '#':
				let eenzaam = true;
				if (x % 2 == 0) {
					if (x + 1 < this.tiles[y].length && this.tiles[y][x + 1] === '#') {
						eenzaam = false;
					}
				}
				else if (this.tiles[y][x - 1] === '#') {
					eenzaam = false;
				}
				if (!eenzaam) return x % 2 == 0 ? BitmapId.tiles1 : BitmapId.tiles2;
				return BitmapId.tiles3;
			case '-':
				return BitmapId.None;
			case '.':
			default:
				return BitmapId.behang;
		}
	}
}
