interface Room {
	/**
	 * Collision tiles
	 *
	 * @instance
	 * @public
	 * @memberof Demo.Room
	 * @type Array.<string>
	 */
	CollisionData: string[] | null;
	Id: number;
	/**
	 * Used at room init to easily determine whether to auto set the respawn location
	 *
	 * @instance
	 * @public
	 * @memberof Demo.Room
	 * @type Array.<number>
	 */
	Exits: number[] | null;
	BitmapPath: string | null;
	InitRoom(): void;
	TakeTurn(): void;
	/**
	 * Checks if there is a collision tile in any of the given coordinates
	 *
	 * @instance
	 * @public
	 * @this Demo.Room
	 * @memberof Demo.Room
	 * @param   {boolean}                        takeWallFoesIntoAccount
	 * @param   {Array.<System.ValueTuple$2>}    coordinatesToCheck
	 * @return  {boolean}
	 */
	AnyCollisionsTiles(takeWallFoesIntoAccount: boolean, coordinatesToCheck: System.ValueTuple$2<number, number>[] | null): boolean;
	IsCollisionTile(x: number, y: number, takeWallFoesIntoAccount: boolean): boolean;
	Paint(): void;
}
interface RoomFunc extends Function {
	prototype: Room;
	new(): Room;
	RoomWidth: number;
	RoomHeight: number;
	NO_ROOM_EXIT: number;
	LoadRoom(data: number): number;
}
var Room: RoomFunc;

/**
 * @compiler Bridge.NET 17.9.0
 */
Bridge.assembly("Demo", function ($asm, globals) {
	"use strict";

	Bridge.define("Demo.Room", {
		statics: {
			fields: {
				RoomWidth: 0,
				RoomHeight: 0,
				NO_ROOM_EXIT: 0
			},
			ctors: {
				init: function () {
					this.RoomWidth = 0;
					this.RoomHeight = 0;
					this.NO_ROOM_EXIT = 0;
				}
			},
			methods: {
				LoadRoom: function (data) {
					var result = 1;

					return result;
				}
			}
		},
		fields: {
            /**
             * Collision tiles
             *
             * @instance
             * @public
             * @memberof Demo.Room
             * @type Array.<string>
             */
			CollisionData: null,
			Id: 0,
            /**
             * Used at room init to easily determine whether to auto set the respawn location
             *
             * @instance
             * @public
             * @memberof Demo.Room
             * @type Array.<number>
             */
			Exits: null,
			initFunction: null,
			ImageID: 0,
			BitmapPath: null
		},
		methods: {
			InitRoom: function () {
				!Bridge.staticEquals(this.initFunction, null) ? this.initFunction(this) : null;
			},
			TakeTurn: function () { },
            /**
             * Checks if there is a collision tile in any of the given coordinates
             *
             * @instance
             * @public
             * @this Demo.Room
             * @memberof Demo.Room
             * @param   {boolean}                        takeWallFoesIntoAccount
             * @param   {Array.<System.ValueTuple$2>}    coordinatesToCheck
             * @return  {boolean}
             */
			AnyCollisionsTiles: function (takeWallFoesIntoAccount, coordinatesToCheck) {
				if (coordinatesToCheck === void 0) { coordinatesToCheck = []; }
				return System.Linq.Enumerable.from(coordinatesToCheck, System.ValueTuple$2(System.Int32, System.Int32)).any(Bridge.fn.bind(this, function (x) {
					return this.IsCollisionTile(x.Item1, x.Item2, takeWallFoesIntoAccount);
				}));
			},
			IsCollisionTile: function (x, y, takeWallFoesIntoAccount) {
				var TileSize = 0;
				var DirectionLeft = 0, DirectionRight = 0, DirectionUp = 0, DirectionDown = 0;
				var CSStageScreenWidthTiles = 0;
				var CSStageScreenHeightTiles = 0;
				var _x = (Bridge.Int.div(x, TileSize)) | 0;
				var _y = (Bridge.Int.div(y, TileSize)) | 0;
				if (x < 0) {
					if (this.CanLeaveRoom(DirectionLeft)) {
						_x = 0;
					} else {
						return true;
					}
				} else if (_x >= CSStageScreenWidthTiles) {
					if (this.CanLeaveRoom(DirectionRight)) {
						_x = (CSStageScreenWidthTiles - 1) | 0;
					} else {
						return true;
					}
				}
				if (_y < 1 && _y >= -1) {
					if (this.CanLeaveRoom(DirectionUp)) {
						_y = 0;
					} else {
						return true;
					}
				} else if (_y >= CSStageScreenHeightTiles) {
					if (this.CanLeaveRoom(DirectionDown)) {
						_y = (CSStageScreenHeightTiles - 1) | 0;
					} else {
						return true;
					}
				}

				if (this.CollisionData[System.Array.index(_y, this.CollisionData)].charCodeAt(_x) !== 46) {
					return true;
				}

				return false;
			},
			NearingRoomExit: function (x, y) {
				var TileSize = 0;
				var CSStageScreenWidthTiles = 0;
				var CSStageScreenHeightTiles = 0;
				var _x = (Bridge.Int.div(x, TileSize)) | 0;
				var _y = (Bridge.Int.div(y, TileSize)) | 0;
				var DirectionLeft = 0, DirectionRight = 0, DirectionUp = 0, DirectionDown = 0;
				var result = null;
				var destRoom = Demo.Room.NO_ROOM_EXIT;

				if (x < 0) {
					destRoom = this.RoomExit(DirectionLeft);
					result = new (System.ValueTuple$2(System.Int32, System.Int32)).$ctor1(destRoom, DirectionLeft);
				} else if (_x >= CSStageScreenWidthTiles) {
					destRoom = this.RoomExit(DirectionRight);
					result = new (System.ValueTuple$2(System.Int32, System.Int32)).$ctor1(destRoom, DirectionRight);
				} else if (_y < 2) {
					destRoom = this.RoomExit(DirectionUp);
					result = new (System.ValueTuple$2(System.Int32, System.Int32)).$ctor1(destRoom, DirectionUp);
				} else if (_y >= CSStageScreenHeightTiles) {
					destRoom = this.RoomExit(DirectionDown);
					result = new (System.ValueTuple$2(System.Int32, System.Int32)).$ctor1(destRoom, DirectionDown);
				}

				return System.Nullable.lift1("$clone", result);
			},
			RoomExit: function (dir) {
				var RoomExitsLocked = true;
				if (RoomExitsLocked) {
					return Demo.Room.NO_ROOM_EXIT;
				}
				return this.Exits[System.Array.index(dir, this.Exits)];
			},
			CanLeaveRoom: function (dir) {
				var RoomExitsLocked = true;
				if (RoomExitsLocked) {
					return false;
				}
				return this.RoomExit(dir) !== Demo.Room.NO_ROOM_EXIT;
			},
			Paint: function () { }
		}
	});
});

export class Room {

	public /* const */ static RoomWidth: number = 0;

	public /* const */ static RoomHeight: number = 0;

	public /* const */ static NO_ROOM_EXIT: number = 0;

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

	private initFunction: Action<Room>;

	protected ImageID: number;

	public BitmapPath: string;

	public static LoadRoom(data: number): number {
		let result = 1;
		return result;
	}

	public InitRoom() {
		Invoke(this);
	}

	public TakeTurn() {
		//  TODO: Ga dingen doen
	}

	///  <summary>Checks if there is a collision tile in any of the given coordinates</summary>
	public AnyCollisionsTiles(takeWallFoesIntoAccount: boolean): boolean {
		x: number;

		int: number;

		x.y: number;

		takeWallFoesIntoAccount: number;
	}
	publicint;
	destRoom;
, let direction: number;
UnknownQuestionNearingRoomExit(int, x, int, y);
{, DirectionRight = 0;
, DirectionUp = 0;
, DirectionDown = 0;
	int;
, let Unknown: number;
	Questionresult = null;
	if ((x < 0)) {
		//  Note: Check for x and not _x, as -1 / (...) will result in 0!
		destRoom = this.RoomExit(DirectionLeft);
		result = destRoom;
		DirectionLeft;
	}
	else if ((_x >= CSStageScreenWidthTiles)) {
		destRoom = this.RoomExit(DirectionRight);
		result = destRoom;
		DirectionRight;
	}
	else if ((_y < 2)) {
		destRoom = this.RoomExit(DirectionUp);
		result = destRoom;
		DirectionUp;
	}
	else if ((_y >= CSStageScreenHeightTiles)) {
		destRoom = this.RoomExit(DirectionDown);
		result = destRoom;
		DirectionDown;
	}

	return result;
	UnknownUnknown

    public IsCollisionTile(x: number, y: number, takeWallFoesIntoAccount: boolean): boolean {
		let TileSize = 0;
		let DirectionDown: number = 0;
		let DirectionLeft: number = 0;
		let DirectionRight: number = 0;
		let DirectionUp: number = 0;
		let CSStageScreenWidthTiles = 0;
		let CSStageScreenHeightTiles = 0;
		let _x: number = (x / TileSize);
		let _y: number = (y / TileSize);
		if ((x < 0)) {
			//  Note: Check for x and not _x, as -1 / (...) will result in 0!
			if (this.CanLeaveRoom(DirectionLeft)) {
				_x = 0;
			}
			else {
				return true;
			}

		}
		else if ((_x >= CSStageScreenWidthTiles)) {
			if (this.CanLeaveRoom(DirectionRight)) {
				_x = (CSStageScreenWidthTiles - 1);
			}
			else {
				return true;
			}

		}

		if (((_y < 1)
			&& (_y >= -1))) {
			if (this.CanLeaveRoom(DirectionUp)) {
				_y = 0;
			}
			else {
				return true;
			}

		}
		else if ((_y >= CSStageScreenHeightTiles)) {
			if (this.CanLeaveRoom(DirectionDown)) {
				_y = (CSStageScreenHeightTiles - 1);
			}
			else {
				return true;
			}

		}

		if ((this.CollisionData[_y][_x] != '.')) {
			return true;
		}

		return false;
	}

	TileSize: var = 0;

	CSStageScreenWidthTiles: var = 0;

	CSStageScreenHeightTiles: var = 0;

	_x: number = (x / TileSize);

	_y: number = (y / TileSize);

	DirectionLeft: number = 0;

	destRoom: number = NO_ROOM_EXIT;

    private RoomExit(dir: number): number {
		let RoomExitsLocked = true;
		if (RoomExitsLocked) {
			return NO_ROOM_EXIT;
		}

		return this.Exits[(<number>(dir))];
	}

    private CanLeaveRoom(dir: number): boolean {
		let RoomExitsLocked = true;
		if (RoomExitsLocked) {
			return false;
		}

		return (this.RoomExit(dir) != NO_ROOM_EXIT);
	}

    public Paint() {
		// BDX._.DrawBitmap((uint)this.ImageID, CS.GameScreenStartX, CS.GameScreenStartY);
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
// }
