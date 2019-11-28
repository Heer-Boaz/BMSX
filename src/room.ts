import { Point } from "../BoazEngineJS/interfaces";
import { TileSize } from "../BoazEngineJS/msx";
import { Direction } from "../BoazEngineJS/direction";
import { GameConstants as CS, GameConstants } from "./gameconstants";
import { view } from "../BoazEngineJS/engine";
import { RoomDataContainer } from "./RoomFactory";
import { BitmapId } from "./resourceids";
import { ResourceMaster } from './resourcemaster';

export type NearingRoomExitResult = { destRoom: number, direction: Direction } | null;
export type RoomInitDelegate = (room: Room) => void;

export class Room {
	public static RoomWidth: number = 0;
	public static RoomHeight: number = 0;
	public static NO_ROOM_EXIT: number = 0;

	///  <summary>
	///  Collision tiles
	///  </summary>
	public CollisionData: string[];
	public Id: number;

	// public M.Location RespawnLocation;
	///  <summary>
	///  Used at room init to easily determine whether to auto set the respawn location
	///  </summary>
	// public bool DefaultRespawnLocation;
	public Exits: number[];
	public initFunction: RoomInitDelegate;
	public imgid: BitmapId;

	public static LoadRoom(data: RoomDataContainer): Room {
		var result = new Room();
		result.Id = data.Id;
		result.CollisionData = data.CollisionMap;
		result.Exits = data.Exits;
		result.initFunction = data.InitFunction;
		result.imgid = data.imgid;
		// result.BitmapPath = data.BitmapPath;

		// ResourceMaster.reloadImg(BitmapId.Room, data.BitmapPath);

		return result;
	}

	public InitRoom() {
		if (this.initFunction)
			this.initFunction(this);
	}

	public TakeTurn() {
		// TODO: Ga dingen doen
	}

	///  <summary>Checks if there is a collision tile in any of the given coordinates</summary>
	public AnyCollisionsTiles(takeWallFoesIntoAccount: boolean, ...coordinatesToCheck: Point[]): boolean {
		return coordinatesToCheck.some(x => this.IsCollisionTile(x.x, x.y, takeWallFoesIntoAccount));
	}

	public NearingRoomExit(x: number, y: number): NearingRoomExitResult {
		let _x: number = ~~(x / TileSize);
		let _y: number = ~~(y / TileSize);
		let result: NearingRoomExitResult = { destRoom: Room.NO_ROOM_EXIT, direction: Direction.None };

		if (x < 0) {
			//  Note: Check for x and not _x, as -1 / (...) will result in 0!
			let dest = this.RoomExit(Direction.Left);
			result = { destRoom: dest, direction: Direction.Left };
		}
		else if (_x >= CS.StageScreenWidthTiles) {
			let dest = this.RoomExit(Direction.Right);
			result = { destRoom: dest, direction: Direction.Right };
		}
		else if (_y < 2) {
			let dest = this.RoomExit(Direction.Up);
			result = { destRoom: dest, direction: Direction.Up };
		}
		else if (_y >= CS.StageScreenHeightTiles) {
			let dest = this.RoomExit(Direction.Down);
			result = { destRoom: dest, direction: Direction.Down };
		}

		return result;
	}

	public IsCollisionTile(x: number, y: number, takeWallFoesIntoAccount: boolean): boolean {
		let _x: number = ~~(x / TileSize);
		let _y: number = ~~(y / TileSize);
		if (x < 0) {
			//  Note: Check for x and not _x, as -1 / (...) will result in 0!
			if (this.CanLeaveRoom(Direction.Left)) {
				_x = 0;
			}
			else {
				return true;
			}

		}
		else if (_x >= GameConstants.StageScreenWidthTiles) {
			if (this.CanLeaveRoom(Direction.Right)) {
				_x = (GameConstants.StageScreenWidthTiles - 1);
			}
			else {
				return true;
			}

		}

		if (_y < 1 && _y >= -1) {
			if (this.CanLeaveRoom(Direction.Up)) {
				_y = 0;
			}
			else {
				return true;
			}

		}
		else if (_y >= GameConstants.StageScreenHeightTiles) {
			if (this.CanLeaveRoom(Direction.Down)) {
				_y = GameConstants.StageScreenHeightTiles - 1;
			}
			else {
				return true;
			}

		}

		if (this.CollisionData[_y][_x] !== '.') {
			return true;
		}

		return false;
	}

	private RoomExit(dir: number): number {
		let RoomExitsLocked = true;
		if (RoomExitsLocked) {
			return Room.NO_ROOM_EXIT;
		}

		return this.Exits[(<number>(dir))];
	}

	private CanLeaveRoom(dir: number): boolean {
		let RoomExitsLocked = true;
		if (RoomExitsLocked) {
			return false;
		}

		return (this.RoomExit(dir) != Room.NO_ROOM_EXIT);
	}

	public Paint() {
		view.drawImg(this.imgid, CS.GameScreenStartX, CS.GameScreenStartY);
	}
}

// public class Room {
// 	public const int RoomWidth = 0;
// 	public const int RoomHeight = 0;
// 	public const int NO_ROOM_EXIT = 0;

// 	/// <summary>
// 	/// Collision tiles
// 	/// </summary>
// 	public string[] CollisionData;

// 	public int Id;
// 	//public M.Location RespawnLocation;
// 	/// <summary>
// 	/// Used at room init to easily determine whether to auto set the respawn location
// 	/// </summary>
// 	//public bool DefaultRespawnLocation;
// 	public int[] Exits;
// 	private Action<Room> initFunction;

// 	protected int ImageID;
// 	public string BitmapPath;

// 	public static int LoadRoom(int data) {
// 		var result = 1;

// 		return result;
// 	}

// 	public void InitRoom() {
// 		this.initFunction ?.Invoke(this);
// 	}

// 	public void TakeTurn() {
// 		// TODO: Ga dingen doen
// 	}

// 	/// <summary>Checks if there is a collision tile in any of the given coordinates</summary>
// 	public bool AnyCollisionsTiles(bool takeWallFoesIntoAccount, params (int x, int y)[] coordinatesToCheck) {
// 	return coordinatesToCheck.Any(x => this.IsCollisionTile(x.x, x.y, takeWallFoesIntoAccount));
// }

// 		public bool IsCollisionTile(int x, int y, bool takeWallFoesIntoAccount) {
// 	var TileSize = 0;
// 	int DirectionLeft = 0, DirectionRight = 0, DirectionUp = 0, DirectionDown = 0;
// 	var CSStageScreenWidthTiles = 0;
// 	var CSStageScreenHeightTiles = 0;
// 	int _x = x / TileSize;
// 	int _y = y / TileSize;
// 	if (x < 0) { // Note: Check for x and not _x, as -1 / (...) will result in 0!
// 		if (this.CanLeaveRoom(DirectionLeft))
// 			_x = 0;
// 		else return true;
// 	}
// 	else if (_x >= CSStageScreenWidthTiles) {
// 		if (this.CanLeaveRoom(DirectionRight))
// 			_x = CSStageScreenWidthTiles - 1;
// 		else return true;
// 	}
// 	if (_y < 1 && _y >= -1) {
// 		if (this.CanLeaveRoom(DirectionUp))
// 			_y = 0;
// 		else return true;
// 	}
// 	else if (_y >= CSStageScreenHeightTiles) {
// 		if (this.CanLeaveRoom(DirectionDown))
// 			_y = CSStageScreenHeightTiles - 1;
// 		else return true;
// 	}

// 	if (this.CollisionData[_y][_x] != '.') return true;

// 	return false;
// }

// public(int destRoom, int direction) ? NearingRoomExit(int x, int y) {
// 	var TileSize = 0;
// 	var CSStageScreenWidthTiles = 0;
// 	var CSStageScreenHeightTiles = 0;
// 	int _x = x / TileSize;
// 	int _y = y / TileSize;
// 	int DirectionLeft = 0, DirectionRight = 0, DirectionUp = 0, DirectionDown = 0;
// 	(int, int) ? result = null;
// 	int destRoom = NO_ROOM_EXIT;

// 	if (x < 0) { // Note: Check for x and not _x, as -1 / (...) will result in 0!
// 		destRoom = this.RoomExit(DirectionLeft);
// 		result = (destRoom, DirectionLeft);
// 	}
// 	else if (_x >= CSStageScreenWidthTiles) {
// 		destRoom = this.RoomExit(DirectionRight);
// 		result = (destRoom, DirectionRight);
// 	}
// 	else if (_y < 2) {
// 		destRoom = this.RoomExit(DirectionUp);
// 		result = (destRoom, DirectionUp);
// 	}
// 	else if (_y >= CSStageScreenHeightTiles) {
// 		destRoom = this.RoomExit(DirectionDown);
// 		result = (destRoom, DirectionDown);
// 	}

// 	return result;
// }

// 		private int RoomExit(int dir) {
// 	var RoomExitsLocked = true;
// 	if (RoomExitsLocked) return NO_ROOM_EXIT;
// 	return this.Exits[(int)dir];
// }

// 		private bool CanLeaveRoom(int dir) {
// 	var RoomExitsLocked = true;
// 	if (RoomExitsLocked) return false;
// 	return this.RoomExit(dir) != NO_ROOM_EXIT;
// }

// 		public void Paint() {
// 	//BDX._.DrawBitmap((uint)this.ImageID, CS.GameScreenStartX, CS.GameScreenStartY);
// }
