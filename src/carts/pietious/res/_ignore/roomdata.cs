using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Microsoft.Xna.Framework;

namespace Maze_of_Nicolaas_XNA {
	public class RoomData {
		public class RoomDataContainer {
			public int Number;
			public string[] Map;
			public RoomType Type;
			public RoomSubType SubType;
			public int[] Exits;
			public int WorldNumber;

			public RoomDataContainer() {
			    this.Number = 0;
			    this.Map = null;
			    this.Type = RoomType.Castle;
			    this.SubType = RoomSubType.CastleBlue;
			    this.Exits = null;
			    this.WorldNumber = World.WorldNumber_Castle;
			}

			public RoomDataContainer(int number, string[] map, RoomType type, RoomSubType subType, int[] exits, int worldNumber) {
				this.Number = number;
				this.Map = map;
				this.Type = type;
				this.SubType = subType;
				this.Exits = exits;
				this.WorldNumber = worldNumber;
			}
		}

		public static Dictionary<int, RoomDataContainer> Rooms;

		/// <summary>
		/// Place elevators and stuff
		/// </summary>
		public static void PlaceGlobalObjects() {
			GameModel.GlobalFoes.Add(new Elevator(new Vector2(14, 8), new Vector2(14, 5), 6, 13, GameSprite.Directions.Up)); // targetRoom = 9
		}

		public static void LoadRoomFromData(Room room, int number) {
			RoomDataContainer data;

			if (!RoomData.Rooms.TryGetValue(number, out data))
				throw new Exception("Room could not be found in dictionary! " + number);

			room.Number = data.Number;
			room.WorldNumber = data.WorldNumber;
			room.Type = data.Type;
			room.SubType = data.SubType;
			Room.GetTilesFromMap(data.Map, data.SubType, room.Tiles, room.CollisionMap);
			room.RoomNorth = data.Exits[0];
			room.RoomEast = data.Exits[1];
			room.RoomSouth = data.Exits[2];
			room.RoomWest = data.Exits[3];
		}

		/// <summary>
		/// Returns the room exits for the given room number (used by the Elevator)
		/// </summary>
		public static int[] RoomExits(int number) {
			RoomDataContainer data;

			if (!RoomData.Rooms.TryGetValue(number, out data))
				throw new Exception("Room could not be found in dictionary! " + number);

			return data.Exits;
		}

		public static void PrepareRoomData() {
			RoomData.Rooms = new Dictionary<int, RoomDataContainer>();
			RoomDataContainer room;

			// Empty room template
			room = new RoomDataContainer();
			room.Number = -1;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"................................", // 0
				"................................", // 1
				"................................", // 2
				"................................", // 3
				"................................", // 4
				"................................", // 5
				"................................", // 6
				"................................", // 7
				"................................", // 8
				"................................", // 9
				"................................", // 10
				"................................", // 11
				"................................", // 12
				"................................", // 13
				"................................", // 14
				"................................", // 15
				"................................", // 16
				"................................", // 17
				"................................", // 18
				"................................"  // 19
			};
			room.Type = RoomType.Castle;
			room.SubType = RoomSubType.CastleBlue;
			room.Exits = new int[] { 0, 0, 0, 0 };
			room.WorldNumber = World.WorldNumber_Castle;
			RoomData.Rooms.Add(room.Number, room);

			// Room 1
			room = new RoomDataContainer();
			room.Number = 1;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"...............-=...............", // 0
				"...............-=...............", // 1
				"...............-=...............", // 2
				"...............-=...............", // 3
				"...............-=...............", // 4
				"...............-=...............", // 5
				"...............-=...............", // 6
				"...............-=...............", // 7
				"...............-=...............", // 8
				"...............-=...............", // 9
				"...............-=...............", // 10
				"################################", // 11
				"###############-=###############", // 12
				"###############-=###############", // 13
				"###############-=###############", // 14
				"###############-=###############", // 15
				"###############-=###############", // 16
				"###############-=###############", // 17
				"###############-=###############", // 18
				"###############-=###############"  // 19
			};
			room.Type = RoomType.Castle;
			room.SubType = RoomSubType.CastleBlue;
			room.Exits = new int[] { 6, 2, 9, 8 };
			room.WorldNumber = World.WorldNumber_Castle;
			RoomData.Rooms.Add(room.Number, room);

			// Room 2
			room = new RoomDataContainer();
			room.Number = 2;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"................................", // 0
				"................................", // 1
				"............###########.........", // 2
				"................................", // 3
				"................................", // 4
				"................................", // 5
				"................................", // 6
				"................................", // 7
				"................................", // 8
				"................................", // 9
				"................................", // 10
				"################################", // 11
				"####-=...pi.........-=.pi.....##", // 12
				"####-=...ll.........-=.ll.....##", // 13
				"####-=...ar.........-=.ar.....##", // 14
				"#########################.....##", // 15
				"####-=...pi.........-=.pi.....##", // 16
				"####-=...ll.........-=.ll.....##", // 17
				"####-=...ar.........-=.ar.....##", // 18
				"#########################.....##"  // 19
			};
			room.Type = RoomType.Castle;
			room.SubType = RoomSubType.CastleBlue;
			room.Exits = new int[] { 0, 3, 11, 1 };
			room.WorldNumber = World.WorldNumber_Castle;
			RoomData.Rooms.Add(room.Number, room);

			// Room 3
			room = new RoomDataContainer();
			room.Number = 3;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"..............................##", // 0
				"..............................##", // 1
				"..............................##", // 2
				"........######..........########", // 3
				"........######....##............", // 4
				"........######..................", // 5
				"................................", // 6
				"................................", // 7
				"........................##......", // 8
				"................................", // 9
				"................................", // 10
				"######..........................", // 11
				"####-=............##............", // 12
				"####-=..........................", // 13
				"####-=..........................", // 14
				"####-=..........................", // 15
				"####-=..................##......", // 16
				"####-=..........................", // 17
				"####-=..........................", // 18
				"################################"  // 19
			};
			room.Type = RoomType.Castle;
			room.SubType = RoomSubType.CastleStone;
			room.Exits = new int[] { 1, 4, 1, 2 };
			room.WorldNumber = World.WorldNumber_Castle;
			RoomData.Rooms.Add(room.Number, room);

			// Room 4
			room = new RoomDataContainer();
			room.Number = 4;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"######....................-=..##", // 0
				"######....................-=..##", // 1
				"######....................-=..##", // 2
				"######....................-=..##", // 3
				"........................########", // 4
				"..............................##", // 5
				"..............................##", // 6
				"...............######.........##", // 7
				".................pi...........##", // 8
				".................ll...........##", // 9
				".................ar...........##", // 10
				".............######...........##", // 11
				"..............................##", // 12
				"..............................##", // 13
				"....................############", // 14
				"....######..........-=##########", // 15
				"......pi............-=##########", // 16
				"......ll............-=##########", // 17
				"......ar............-=##########", // 18
				"################################"  // 19
			};
			room.Type = RoomType.Castle;
			room.SubType = RoomSubType.CastleGarden;
			room.Exits = new int[] { 5, 1, 1, 3 };
			room.WorldNumber = World.WorldNumber_Castle;
			RoomData.Rooms.Add(room.Number, room);

			// Room 5
			room = new RoomDataContainer();
			room.Number = 5;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"..............................##", // 0
				"..............................##", // 1
				"..............................##", // 2
				"..............................##", // 3
				"################################", // 4
				"..........................-=..##", // 5
				"..........................-=..##", // 6
				"..........................-=..##", // 7
				"........................########", // 8
				"..........................-=..##", // 9
				"..........................-=..##", // 10
				"..........................-=..##", // 11
				"################################", // 12
				"........pi...........pi...-=..##", // 13
				"........ll...........ll...-=..##", // 14
				"........ar...........ar...-=..##", // 15
				"################################", // 16
				"##########################-=####", // 17
				"##########################-=####", // 18
				"##########################-=####"  // 19
			};
			room.Type = RoomType.Castle;
			room.SubType = RoomSubType.CastleRed;
			room.Exits = new int[] { 1, 1, 4, 12 };
			room.WorldNumber = World.WorldNumber_Castle;
			RoomData.Rooms.Add(room.Number, room);

			// Room 12
			room = new RoomDataContainer();
			room.Number = 12;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"#########..............####.....", // 0
				"#########..............####.....", // 1
				"#########..............####.....", // 2
				"#########..............####.....", // 3
				"################################", // 4
				"###............-=..........-=...", // 5
				"###............-=..........-=...", // 6
				"###............-=..........-=...", // 7
				"###.......############.....-=...", // 8
				"###............-=..pi......-=...", // 9
				"###............-=..ll......-=...", // 10
				"###............-=..ar......-=...", // 11
				"################################", // 12
				".........pi..........pi.........", // 13
				".........ll..........ll.........", // 14
				".........ar..........ar.........", // 15
				"################################", // 16
				"################################", // 17
				"################################", // 18
				"################################"  // 19
			};
			room.Type = RoomType.Castle;
			room.SubType = RoomSubType.CastleRed;
			room.Exits = new int[] { 0, 5, 1, 6 };
			room.WorldNumber = World.WorldNumber_Castle;
			RoomData.Rooms.Add(room.Number, room);

			// Room 6
			room = new RoomDataContainer();
			room.Number = 6;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
	            "##............................##", // 0
	            "##............................##", // 1
	            "##............................##", // 2
	            "##............................##", // 3
	            "##............................##", // 4
	            "##............................##", // 5
	            "##............................##", // 6
	            "##............................##", // 7
	            "##............................##", // 8
	            "##............................##", // 9
	            "##............................##", // 10
	            "##............................##", // 11
				"###########..........###########", // 12
	            ".........pi..........pi.........", // 13
	            ".........ll..........ll.........", // 14
	            ".........ar..........ar.........", // 15
				"################################", // 16
				"###############-=###############", // 17
				"###############-=###############", // 18
				"###############-=###############"  // 19
	        };
			room.Type = RoomType.Castle;
			room.SubType = RoomSubType.CastleGold;
			room.Exits = new int[] { 13, 12, 1, 7 };
			room.WorldNumber = World.WorldNumber_Castle;
			RoomData.Rooms.Add(room.Number, room);

			// Room 7
			room = new RoomDataContainer();
			room.Number = 7;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"################################", // 0
				"################################", // 1
				"################################", // 2
				"################################", // 3
				"################################", // 4
				"#...pi.......................###", // 5
				"#...ll.......................###", // 6
				"#...ar.......................###", // 7
				"################################", // 8
				"#.......-=.....pi............###", // 9
				"#.......-=.....ll............###", // 10
				"#.......-=.....ar............###", // 11
				"################################", // 12
				"#...pi..-=...........-=....pi...", // 13
				"#...ll..-=...........-=....ll...", // 14
				"#...ar..-=...........-=....ar...", // 15
				"################################", // 16
				"################################", // 17
				"################################", // 18
				"################################"  // 19
			};
			room.Type = RoomType.Castle;
			room.SubType = RoomSubType.CastleRed;
			room.Exits = new int[] { 0, 6, 1, 0 };
			room.WorldNumber = World.WorldNumber_Castle;
			RoomData.Rooms.Add(room.Number, room);

			// Room 8
			room = new RoomDataContainer();
			room.Number = 8;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"################################", // 0
				"########..............#####.....", // 1
				"########..............#####.....", // 2
				"########..............#####.....", // 3
				"########..............#####.....", // 4
				"#.....................#####.....", // 5
				"#............##############.....", // 6
				"#..............-=...............", // 7
				"#..............-=...............", // 8
				"#..............-=...............", // 9
				"#..............-=...............", // 10
				"#################.........######", // 11
				"#..pi...-=................-=####", // 12
				"#..ll...-=................-=####", // 13
				"#..ar...-=................-=####", // 14
				"##########................-=####", // 15
				"#..pi...-=................-=####", // 16
				"#..ll...-=................-=####", // 17
				"#..ar...-=................-=####", // 18
				"################################"  // 19
			};
			room.Type = RoomType.Castle;
			room.SubType = RoomSubType.CastleBlue;
			room.Exits = new int[] { 0, 1, 9, 0 };
			room.WorldNumber = World.WorldNumber_Castle;
			RoomData.Rooms.Add(room.Number, room);

			// Room 9
			room = new RoomDataContainer();
			room.Number = 9;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"###############-=###############", // 0
				"###############-=###############", // 1
				"###############-=###############", // 2
				"###............-=...pi.........#", // 3
				"###............-=...ll.........#", // 4
				"###............-=...ar.........#", // 5
				"#############################..#", // 6
				"#############################..#", // 7
				"#############################..#", // 8
				"...............pi.........###..#", // 9
				"...............ll.........###..#", // 10
				"...............ar.........###..#", // 11
				"#############################..#", // 12
				"#############################..#", // 13
				"#############################..#", // 14
				"#############################..#", // 15
				".......pi..............pi.......", // 16
				".......ll..............ll.......", // 17
				".......ar..............ar.......", // 18
				"################################"  // 19
			};
			room.Type = RoomType.Castle;
			room.SubType = RoomSubType.CastleBlue;
			room.Exits = new int[] { 1, 11, 0, 10 };
			room.WorldNumber = World.WorldNumber_Castle;
			RoomData.Rooms.Add(room.Number, room);

			// Room 10
			room = new RoomDataContainer();
			room.Number = 10;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"####...........pi............###", // 0
				"####...........ll............###", // 1
				"####...........ar............###", // 2
				"########################.....###", // 3
				"########-=##############.....###", // 4
				"########-=#########..........###", // 5
				"#.......-=.....####..........###", // 6
				"#.......-=.....####.....########", // 7
				"#.......-=.....####.....-=######", // 8
				"#.......-=.....####.....-=..pi..", // 9
				"#.......-=.....####.....-=..ll..", // 10
				"#.......-=.....####.....-=..ar..", // 11
				"#.......-=.....#################", // 12
				"#.......-=.....#################", // 13
				"################################", // 14
				"#-=#############################", // 15
				"#-=....pi..............pi.......", // 16
				"#-=....ll..............ll.......", // 17
				"#-=....ar..............ar.......", // 18
				"################################"  // 19
			};
			room.Type = RoomType.Castle;
			room.SubType = RoomSubType.CastleGarden;
			room.Exits = new int[] { 1, 9, 0, 10 };
			room.WorldNumber = World.WorldNumber_Castle;
			RoomData.Rooms.Add(room.Number, room);

			// Room 11
			room = new RoomDataContainer();
			room.Number = 11;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"#############-=##########.....##", // 0
				"#############-=##########.....##", // 1
				"#############-=##########.....##", // 2
				"#............-=.....pi........##", // 3
				"#............-=.....ll........##", // 4
				"#............-=.....ar........##", // 5
				"#########################.....##", // 6
				"#-=######################.....##", // 7
				"#-=###.......pi.......###.....##", // 8
				"#-=###.......ll.......###.....##", // 9
				"#-=###.......ar.......###.....##", // 10
				"#-=######################.....##", // 11
				"#-=.pi...........-=pi.###.....##", // 12
				"#-=.ll...........-=ll.###.....##", // 13
				"#-=.ar...........-=ar.###.....##", // 14
				"#########################.....##", // 15
				".............pi.....-=........##", // 16
				".............ll.....-=........##", // 17
				".............ar.....-=........##", // 18
				"################################"  // 19
			};
			room.Type = RoomType.Castle;
			room.SubType = RoomSubType.CastleStone;
			room.Exits = new int[] { 2, 0, 0, 9 };
			room.WorldNumber = World.WorldNumber_Castle;
			RoomData.Rooms.Add(room.Number, room);

			// Room 13
			room = new RoomDataContainer();
			room.Number = 13;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
	            "################################", // 0
	            "################################", // 1
	            "##............................##", // 2
	            "##............................##", // 3
	            "##............................##", // 4
	            "###########..........###########", // 5
	            "##..-=....................-=..##", // 6
	            "##..-=....................-=..##", // 7
	            "##..-=....................-=..##", // 8
	            "##..-=....................-=..##", // 9
	            "##..-=....................-=..##", // 10
	            "##..-=....................-=..##", // 11
				"########................########", // 12
	            "##............................##", // 13
	            "##............................##", // 14
	            "##............................##", // 15
				"##............................##", // 16
				"##............................##", // 17
				"##............................##", // 18
				"##............................##"  // 19
	        };
			room.Type = RoomType.Castle;
			room.SubType = RoomSubType.CastleGold;
			room.Exits = new int[] { -1, -1, 6, -1 };
			room.WorldNumber = World.WorldNumber_Castle;
			RoomData.Rooms.Add(room.Number, room);

			///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
			// WORLD 1
			///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
			// Room 101
			room = new RoomDataContainer();
			room.Number = 101;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"################################", // 0
				"################################", // 1
				"......................##########", // 2
				"......................##########", // 3
				"......................##########", // 4
				"......................##########", // 5
				"......................##########", // 6
				"......................##########", // 7
				"......................##########", // 8
				"......................##########", // 9
				"......................##########", // 10
				"....##......##........##########", // 11
				"......................##########", // 12
				"......................##########", // 13
				"........................pi......", // 14
				"........................ll......", // 15
				"........................ar......", // 16
				"################################", // 17
				"################################", // 18
				"################################"  // 19
			};

			room.Type = RoomType.World;
			room.SubType = RoomSubType.World;
			room.Exits = new int[] { 0, -1, 0, 102 };
			room.WorldNumber = 1;
			RoomData.Rooms.Add(room.Number, room);

			// Room 102
			room = new RoomDataContainer();
			room.Number = 102;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"###############-=###############", // 0
				"...............-=...............", // 1
				"...............-=...............", // 2
				"...............-=...............", // 3
				"...............-=...............", // 4
				".............######.............", // 5
				"................................", // 6
				"..######........................", // 7
				"................................", // 8
				"................................", // 9
				"................................", // 10
				"................................", // 11
				"................................", // 12
				"..######.....######.....######..", // 13
				"....pi.........pi.........pi....", // 14
				"....ll.........ll.........ll....", // 15
				"....ar.........ar.........ar....", // 16
				"################################", // 17
				"################################", // 18
				"################################"  // 19
			};

			room.Type = RoomType.World;
			room.SubType = RoomSubType.World;
			room.Exits = new int[] { 103, 101, 0, 105 };
			room.WorldNumber = 1;
			RoomData.Rooms.Add(room.Number, room);

			// Room 103
			room = new RoomDataContainer();
			room.Number = 103;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"###############-=###############", // 0
				"###############-=###############", // 1
				"###############-=###############", // 2
				"#..............-=..............#", // 3
				"#..............-=..............#", // 4
				"#..............-=..............#", // 5
				"################################", // 6
				"#####-=##################-=#####", // 7
				"#####-=##################-=#####", // 8
				"#####-=##################-=#####", // 9
				"#....-=..................-=....#", // 10
				"#....-=..................-=....#", // 11
				"#....-=..................-=....#", // 12
				"################################", // 13
				"###############-=###############", // 14
				"###############-=###############", // 15
				"###############-=###############", // 16
				"###############-=###############", // 17
				"###############-=###############", // 18
				"###############-=###############"  // 19
			};

			room.Type = RoomType.World;
			room.SubType = RoomSubType.World;
			room.Exits = new int[] { 104, 0, 102, 0 };
			room.WorldNumber = 1;
			RoomData.Rooms.Add(room.Number, room);

			// Room 104
			room = new RoomDataContainer();
			room.Number = 104;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"#..............................#", // 0
				"#..............................#", // 1
				"#..............................#", // 2
				"#............................###", // 3
				"#..............................#", // 4
				"#########......................#", // 5
				"#......................##......#", // 6
				"#..............................#", // 7
				"#..............................#", // 8
				"#..............##............###", // 9
				"#..............................#", // 10
				"#..............................#", // 11
				"#......##..............##......#", // 12
				"#..............................#", // 13
				"#..............................#", // 14
				"###..........................###", // 15
				"#..............................#", // 16
				"################################", // 17
				"###############-=###############", // 18
				"###############-=###############"  // 19
			};

			room.Type = RoomType.World;
			room.SubType = RoomSubType.World;
			room.Exits = new int[] { 0, 0, 103, 0 };
			room.WorldNumber = 1;
			RoomData.Rooms.Add(room.Number, room);

			// Room 105
			room = new RoomDataContainer();
			room.Number = 105;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"################################", // 0
				"################................", // 1
				"################................", // 2
				"################................", // 3
				"################................", // 4
				"################................", // 5
				"####....pi......................", // 6
				"####....ll......................", // 7
				"####....ar......................", // 8
				"#######################.........", // 9
				"####...............pi...........", // 10
				"####...............ll...........", // 11
				"####...............ar...........", // 12
				"####..............#######.......", // 13
				"####.................pi.........", // 14
				"####.................ll.........", // 15
				"####.................ar.........", // 16
				"################################", // 17
				"###############-=###############", // 18
				"###############-=###############"  // 19
			};

			room.Type = RoomType.World;
			room.SubType = RoomSubType.World;
			room.Exits = new int[] { 0, 102, 106, 0 };
			room.WorldNumber = 1;
			RoomData.Rooms.Add(room.Number, room);

			// Room 106
			room = new RoomDataContainer();
			room.Number = 106;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"###############-=###############", // 0
				"##########.....-=.....pi......##", // 1
				"##########.....-=.....ll......##", // 2
				"##########.....-=.....ar......##", // 3
				"################################", // 4
				"##..........................-=##", // 5
				"##..........................-=##", // 6
				"##......##.............##...-=##", // 7
				"##..........................-=##", // 8
				"##..........................-=##", // 9
				"##..##............##........-=##", // 10
				"##..........................-=##", // 11
				"##...........##.............-=##", // 12
				"##..........................-=##", // 13
				"............................-=##", // 14
				"............................-=##", // 15
				"............................-=##", // 16
				"################################", // 17
				"##########################-=####", // 18
				"##########################-=####"  // 19
			};

			room.Type = RoomType.World;
			room.SubType = RoomSubType.World;
			room.Exits = new int[] { 105, 0, 108, 107 };
			room.WorldNumber = 1;
			RoomData.Rooms.Add(room.Number, room);

			// Room 107
			room = new RoomDataContainer();
			room.Number = 107;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"################################", // 0
				"################################", // 1
				"#.....pi................pi.....#", // 2
				"#.....ll................ll.....#", // 3
				"#.....ar................ar.....#", // 4
				"################################", // 5
				"#-=......pi.#########.pi.....-=#", // 6
				"#-=......ll.#########.ll.....-=#", // 7
				"#-=......ar.#########.ar.....-=#", // 8
				"################################", // 9
				"#.pi.-=.....#########-=.pi.....#", // 10
				"#.ll.-=.....#########-=.ll.....#", // 11
				"#.ar.-=.....#########-=.ar.....#", // 12
				"##########################.....#", // 13
				"#-=...pi...........#####-=......", // 14
				"#-=...ll...........#####-=......", // 15
				"#-=...ar...........#####-=......", // 16
				"########...........#############", // 17
				"########...........#############", // 18
				"################################"  // 19
			};

			room.Type = RoomType.World;
			room.SubType = RoomSubType.World;
			room.Exits = new int[] { 0, 106, 0, 0 };
			room.WorldNumber = 1;
			RoomData.Rooms.Add(room.Number, room);

			// Room 108
			room = new RoomDataContainer();
			room.Number = 108;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"#.........................-=...#", // 0
				"#.........................-=...#", // 1
				"#.........................-=...#", // 2
				"#.....................##########", // 3
				"#.....................##########", // 4
				"#.....................##########", // 5
				"#...............................", // 6
				"#...............................", // 7
				"#............####...............", // 8
				"#............####...............", // 9
				"#............####...............", // 10
				"########..............##########", // 11
				"###-=###..............##########", // 12
				"###-=###..............##########", // 13
				"#..-=..........................#", // 14
				"#..-=..........................#", // 15
				"#..-=..........................#", // 16
				"#..-=..........................#", // 17
				"#..-=..........................#", // 18
				"################################"  // 19
			};

			room.Type = RoomType.World;
			room.SubType = RoomSubType.World;
			room.Exits = new int[] { 106, 109, 0, 0 };
			room.WorldNumber = 1;
			RoomData.Rooms.Add(room.Number, room);

			// Room 109
			room = new RoomDataContainer();
			room.Number = 109;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"############...pi.........pi...#", // 0
				"############...ll.........ll...#", // 1
				"############...ar.........ar...#", // 2
				"################################", // 3
				"############-=####-=############", // 4
				"############-=####-=############", // 5
				"............-=####-=...........#", // 6
				"............-=####-=...........#", // 7
				"............-=####-=...........#", // 8
				"............-=####-=...........#", // 9
				"............-=####-=...........#", // 10
				"######......-=####-=...........#", // 11
				"####-=......-=##########.......#", // 12
				"####-=......-=####.pi.-=........", // 13
				"####-=......-=####.ll.-=........", // 14
				"####-=......-=####.ar.-=........", // 15
				"################################", // 16
				"#..............................#", // 17
				"#..............................#", // 18
				"#..............................#"  // 19
			};

			room.Type = RoomType.World;
			room.SubType = RoomSubType.World;
			room.Exits = new int[] { 0, 110, 100, 108 };
			room.WorldNumber = 1;
			RoomData.Rooms.Add(room.Number, room);

			// Room 110
			room = new RoomDataContainer();
			room.Number = 110;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"#..............................#", // 0
				"#..............................#", // 1
				"#..............................#", // 2
				"#..............................#", // 3
				"###..####.....######.....#######", // 4
				"#....pi.........pi.......pi....#", // 5
				"#....ll.........ll.......ll....#", // 6
				"#....ar.........ar.......ar....#", // 7
				"#..####.......####.......####..#", // 8
				"#....pi.........pi.........pi..#", // 9
				"#....ll.........ll.........ll..#", // 10
				"#....ar.........ar.........ar..#", // 11
				"#######.......######.....#######", // 12
				".....pi.........pi.......pi....#", // 13
				".....ll.........ll.......ll....#", // 14
				".....ar.........ar.......ar....#", // 15
				"################################", // 16
				"################################", // 17
				"################################", // 18
				"################################"  // 19
			};

			room.Type = RoomType.World;
			room.SubType = RoomSubType.World;
			room.Exits = new int[] { 0, 0, 0, 109 };
			room.WorldNumber = 1;
			RoomData.Rooms.Add(room.Number, room);

			// Room 100
			room = new RoomDataContainer();
			room.Number = 100;
			room.Map = new string[] {
	//			 01234567890123456789012345678901
				"#############################-=#", // 0
				"#############################-=#", // 1
				"#############################-=#", // 2
				"$............................-=$", // 3
				"$............................-=$", // 4
				"$............................-=$", // 5
				"$............................-=$", // 6
				"##########............##########", // 7
				"$.......-=............-=.......$", // 8
				"$.......-=............-=.......$", // 9
				"$.......-=............-=.......$", // 10
				"$.......-=............-=.......$", // 11
				"##########............##########", // 12
				"$.......-=............-=.......$", // 13
				"$.......-=............-=.......$", // 14
				"$.......-=............-=.......$", // 15
				"$.......-=............-=.......$", // 16
				"################################", // 17
				"################################", // 18
				"################################"  // 19
			};

			room.Type = RoomType.World;
			room.SubType = RoomSubType.World;
			room.Exits = new int[] { 109, 0, 0, 0 };
			room.WorldNumber = 1;
			RoomData.Rooms.Add(room.Number, room);

		}

	}

			/// <summary>
		/// Loads a new room from the specified resourcename.
		/// In addition, considers events that have changed the structure of the room
		/// </summary>
		/// <param name="resourceName"></param>
		/// <returns></returns>
		public static Room LoadRoom(int number) {
			Room result = new Room();

			RoomData.LoadRoomFromData(result, number);
			result.Number = number; // To remember in what room an item has droppen on the floor

			Shrine shrine;
			switch (number) {
				case 1:
					break;
				case 2:
					GameModel.Foes.Add(new MijterFoe(new Vector2(14, 3) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(20, 3) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(16, 17) * Constants.TileSizeFloat, GameSprite.Directions.Up, number));
					
					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(13, 13), ItemType.None, number));
					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(18, 17), ItemType.Schoentjes, number));
					break;
				case 3:
					GameModel.Foes.Add(new MijterFoe(new Vector2(18, 13) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(27, 4) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));

					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(28, 1), ItemType.Pepernoot, number));
					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(13, 17), ItemType.None, number));
					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(10, 1), ItemType.None, number));
					break;
				case 4:
					GameController.AddFoeIfNotDestroyed(new BoekFoe(new Vector2(27, 11), GameSprite.Directions.Left, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(6, 2) * Constants.TileSizeFloat, GameSprite.Directions.Right, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(19, 8) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));

					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(6, 13), ItemType.AmmoFromRock, number));
					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(17, 5), ItemType.None, number));
					shrine = new Shrine(new Vector2(17, 5), Constants.Shrine2text);
					result.RoomObjects.Add(shrine);
					break;
				case 5:
					GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(10, 1) * Constants.TileSizeFloat, 0f, 2f, number));
					GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(14, 1) * Constants.TileSizeFloat, 2f, 2f, number));
					GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(3, 5) * Constants.TileSizeFloat, 2f, 2f, number));
					GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(10, 5) * Constants.TileSizeFloat, -2f, 2f, number));
					GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(15, 10) * Constants.TileSizeFloat, -2f, -2f, number));
					GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(3, 15) * Constants.TileSizeFloat, 2f, -2f, number));
					break;
				case 6:
					if (!GameModel.TheWorld.DestroyedFoeIdentifiers.Contains("cloud_1")) // HACKSORZ!! Make VlokSpawner appear as long as cloud_1 is alive
						GameController.AddFoeIfNotDestroyed(new VlokSpawner(number));

					GameController.AddFoeIfNotDestroyed(new CrossFoe(new Vector2(3, 9) * Constants.TileSizeFloat, number));
					GameController.AddFoeIfNotDestroyed(new CrossFoe(new Vector2(27, 9) * Constants.TileSizeFloat, number));
					break;
				case 7:
					shrine = new Shrine(new Vector2(14, 6), Constants.Shrine1text);
					result.RoomObjects.Add(shrine);

					//GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(19, 6), ItemType.AmmoFromRock, 3));
					//GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(21, 6), ItemType.AmmoFromRock, 3));
					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(25, 6), ItemType.None, number));
					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(27, 6), ItemType.Halo, number));

					if (!GameModel.Triggers[Trigger.CastleWallDestroyed]) {
						GameModel.Foes.Add(new BreakableWall(new Area(10, 5, 18, 8), 20, Trigger.CastleWallDestroyed, TileType.FrontWorld_blue_l));
					}

					GameController.AddFoeIfNotDestroyed(new CrossFoe(new Vector2(5, 5) * Constants.TileSizeFloat, number));
					GameController.AddFoeIfNotDestroyed(new CrossFoe(new Vector2(5, 9) * Constants.TileSizeFloat, number));
					GameController.AddFoeIfNotDestroyed(new CrossFoe(new Vector2(26, 9) * Constants.TileSizeFloat, number));
					break;
				case 8:
					GameController.AddFoeIfNotDestroyed(new BoekFoe(new Vector2(1, 12), GameSprite.Directions.Right, number));
					GameController.AddFoeIfNotDestroyed(new CrossFoe(new Vector2(5, 16) * Constants.TileSizeFloat, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(3, 5) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(8, 1) * Constants.TileSizeFloat, GameSprite.Directions.Right, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(15, 12) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));
					
					result.RoomObjects.Add(new WorldEntrance(new Vector2(18, 3), GameModel.Worlds[1]));
					break;
				case 9:
					GameController.AddFoeIfNotDestroyed(new BoekFoe(new Vector2(3, 3), GameSprite.Directions.Right, number));
					GameController.AddFoeIfNotDestroyed(new BoekFoe(new Vector2(23, 9), GameSprite.Directions.Left, number));

					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(20, 10), ItemType.Spyglass, number));
					break;
				case 10:
					GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(1, 7) * Constants.TileSizeFloat, 2f, 2f, number));
					GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(10, 10) * Constants.TileSizeFloat, 2f, -2f, number));
					GameController.AddFoeIfNotDestroyed(new CrossFoe(new Vector2(11, 0) * Constants.TileSizeFloat, number));

					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(24, 5), ItemType.None, number));
					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(4, 1), ItemType.None, number));
					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(14, 17), ItemType.AmmoFromRock, number));
					break;
				case 11:
					GameController.AddFoeIfNotDestroyed(new CrossFoe(new Vector2(11, 8) * Constants.TileSizeFloat, number));
					GameController.AddFoeIfNotDestroyed(new CrossFoe(new Vector2(5, 12) * Constants.TileSizeFloat, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(3, 3) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(8, 16) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));

					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(8, 9), ItemType.Lamp, number));
					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(17, 4), ItemType.None, number));
					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(13, 13), ItemType.None, number));
					break;
				case 12:
					GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(11, 6) * Constants.TileSizeFloat, 2f, 0f, number));
					GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(13, 7) * Constants.TileSizeFloat, -2f, 0f, number));

					GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(9, 10) * Constants.TileSizeFloat, -2f, 0f, number));
					GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(11, 11) * Constants.TileSizeFloat, 2f, 0f, number));
					GameController.AddFoeIfNotDestroyed(new BoekFoe(new Vector2(9, 1), GameSprite.Directions.Right, number));

					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(21, 2), ItemType.KeyWorld1, number));
					break;
				case 13:
					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(26, 10), ItemType.None, number));
					GameController.AddFoeIfNotDestroyed(new Rock(new Vector2(7, 3), ItemType.AmmoFromRock, number));

					GameController.AddFoeIfNotDestroyed(new Cloud(new Vector2(16, 10) * Constants.TileSizeFloat, Global.RandomBool(50) ? GameSprite.Directions.Left : GameSprite.Directions.Right, number));
					
					// Make vase appear if there is no cloud, the trigger has been activated and Popolon does not carry the green vase
					if (GameModel.Triggers[Trigger.CloudDestroyed] && !GameModel.InventoryItems[ItemType.GreenVase] && GameModel.Foes.Count(f => f as Cloud != null) <= 0)
						// Place green vase. Of course, this is just an ugly hack as this should be handled by Event objects and such
						GameModel.Items.Add(new Item(new Vector2(23, 3), ItemType.GreenVase));

					// Else, reset the trigger if it has been activated, Popolon is not carrying the vase and there are still clouds about
					else if (GameModel.Triggers[Trigger.CloudDestroyed] && !GameModel.InventoryItems[ItemType.GreenVase] && GameModel.Foes.Count(f => f as Cloud != null) > 0)
						GameModel.Triggers[Trigger.CloudDestroyed] = false;

					break;
				// WORLD 1
				case 100:
					if (!GameModel.BossDefeated[result.WorldNumber]) {
						result.Type = RoomType.WorldSeal;
						Seal seal = new Seal(new Vector2(12, 6), "eyndbaes");
						result.RoomObjects.Add(seal);

						result.RemoveTilesBehindSeal(seal);
					}
					break;
				case 101:
					if (!GameModel.InventoryItems[ItemType.Map_World1])
						GameModel.Items.Add(new Item(new Vector2(4, 9), ItemType.Map_World1));
					break;
				case 102:
					result.RoomObjects.Add(new Lithograph(new Vector2(2, 5), ""));
					GameModel.Foes.Add(new ZakFoe(new Vector2(2, 11) * Constants.TileSizeFloat, GameSprite.Directions.Right, number));
					GameModel.Foes.Add(new ZakFoe(new Vector2(17, 11) * Constants.TileSizeFloat, GameSprite.Directions.Left, number));
					GameModel.Foes.Add(new ZakFoe(new Vector2(4, 5) * Constants.TileSizeFloat, GameSprite.Directions.Right, number));
					break;
				case 103:
					shrine = new Shrine(new Vector2(9, 4), Constants.Shrine3text);
					result.RoomObjects.Add(shrine);
					GameController.AddFoeIfNotDestroyed(new CrossFoe(new Vector2(15, 3) * Constants.TileSizeFloat, number));
					GameController.AddFoeIfNotDestroyed(new CrossFoe(new Vector2(29, 10) * Constants.TileSizeFloat, number));
					GameController.AddFoeIfNotDestroyed(new CrossFoe(new Vector2(2, 10) * Constants.TileSizeFloat, number));
					break;
				case 104:
					GameController.AddFoeIfNotDestroyed(new MuziekFoe(new Vector2(24 * Constants.TileSizeFloat, 8 * Constants.TileSizeFloat), GameSprite.Directions.Left, number));
					GameController.AddFoeIfNotDestroyed(new StaffFoe(new Vector2(7 * Constants.TileSizeFloat, 1 * Constants.TileSizeFloat + 2), Trigger.Staff1Destroyed, number));
					break;
				case 105:
					result.RoomObjects.Add(new Lithograph(new Vector2(4, 7), ""));
					GameModel.Foes.Add(new ZakFoe(new Vector2(11, 7) * Constants.TileSizeFloat, GameSprite.Directions.Right, number));
					GameModel.Foes.Add(new ZakFoe(new Vector2(8, 15) * Constants.TileSizeFloat, GameSprite.Directions.Left, number));
					break;
				case 106:
					// 2 - 27, 5-15
					if (!GameModel.Triggers[Trigger.World1WallDisappear]) {
						GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(2, 5) * Constants.TileSizeFloat, 2f, 2f, number));
						GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(10, 15) * Constants.TileSizeFloat, -2f, 2f, number));
						GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(20, 12) * Constants.TileSizeFloat, 2f, -2f, number));
						GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(6, 10) * Constants.TileSizeFloat, -2f, -2f, number));
						GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(13, 13) * Constants.TileSizeFloat, -2f, 2f, number));
						GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(18, 8) * Constants.TileSizeFloat, -2f, -2f, number));
						GameModel.Foes.Add(new MarspeinenAardappel(new Vector2(25, 7) * Constants.TileSizeFloat, 2f, -2f, number));
						GameModel.Foes.Add(new DisappearingWall(new Area(10, 1, 15, 4), Trigger.World1WallDisappear, TileType.FrontWorld_l));
					}
					
					result.RoomObjects.Add(new Lithograph(new Vector2(10, 2), "EYNDBAES"));
					break;
				case 107:
					GameController.AddFoeIfNotDestroyed(new CrossFoe(new Vector2(5, 2) * Constants.TileSizeFloat, number));
					GameController.AddFoeIfNotDestroyed(new CrossFoe(new Vector2(10, 6) * Constants.TileSizeFloat, number));
					GameController.AddFoeIfNotDestroyed(new CrossFoe(new Vector2(29, 6) * Constants.TileSizeFloat, number));
					GameController.AddFoeIfNotDestroyed(new CrossFoe(new Vector2(1, 10) * Constants.TileSizeFloat, number));
					GameController.AddFoeIfNotDestroyed(new StaffFoe(new Vector2(15 * Constants.TileSizeFloat, 15 * Constants.TileSizeFloat + 2), Trigger.Staff2Destroyed, number));
					break;
				case 108:
					result.RoomObjects.Add(new Lithograph(new Vector2(25, 17), ""));
					GameController.AddFoeIfNotDestroyed(new MuziekFoe(new Vector2(2, 0) * Constants.TileSizeFloat, GameSprite.Directions.Right, number));
					GameController.AddFoeIfNotDestroyed(new MuziekFoe(new Vector2(8, 15) * Constants.TileSizeFloat, GameSprite.Directions.Right, number));
					GameController.AddFoeIfNotDestroyed(new MuziekFoe(new Vector2(25, 15) * Constants.TileSizeFloat, GameSprite.Directions.Left, number));
					GameController.AddFoeIfNotDestroyed(new MijterFoe(new Vector2(14, 6) * Constants.TileSizeFloat, GameSprite.Directions.Up, number));
					GameController.AddFoeIfNotDestroyed(new MijterFoe(new Vector2(17, 8) * Constants.TileSizeFloat, GameSprite.Directions.Right, number));
					
					break;
				case 109:
					GameModel.Foes.Add(new MijterFoe(new Vector2(6, 6) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(26, 6) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(22, 13) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));

					// Build stairs starting at 29, 17
					if (GameModel.Triggers[Trigger.World1StairsAppear]) {
						for (int i = 17; i <= 19; i++) {
							result.Tiles[29, i] = TileType.Stairs_l;
							result.Tiles[30, i] = TileType.Stairs_r;
						}
					}

					break;
				case 110:
					shrine = new Shrine(new Vector2(27, 2), Constants.Shrine4text);
					result.RoomObjects.Add(shrine);

					GameModel.Foes.Add(new MijterFoe(new Vector2(18, 5) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(14, 9) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(18, 13) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(7, 5) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(29, 5) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(29, 9) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));
					GameModel.Foes.Add(new MijterFoe(new Vector2(25, 13) * Constants.TileSizeFloat, GameSprite.Directions.Down, number));
					GameController.AddFoeIfNotDestroyed(new ZakFoe(new Vector2(14, 2) * Constants.TileSizeFloat, GameSprite.Directions.Right, number));
					GameController.AddFoeIfNotDestroyed(new ZakFoe(new Vector2(27, 2) * Constants.TileSizeFloat, GameSprite.Directions.Right, number));
					GameController.AddFoeIfNotDestroyed(new ZakFoe(new Vector2(27, 6) * Constants.TileSizeFloat, GameSprite.Directions.Left, number));
					GameController.AddFoeIfNotDestroyed(new ZakFoe(new Vector2(29, 10) * Constants.TileSizeFloat, GameSprite.Directions.Left, number));
					GameController.AddFoeIfNotDestroyed(new ZakFoe(new Vector2(14, 10) * Constants.TileSizeFloat, GameSprite.Directions.Right, number));
					GameController.AddFoeIfNotDestroyed(new ZakFoe(new Vector2(1, 10) * Constants.TileSizeFloat, GameSprite.Directions.Right, number));
					GameController.AddFoeIfNotDestroyed(new ZakFoe(new Vector2(16, 6) * Constants.TileSizeFloat, GameSprite.Directions.Left, number));
					GameController.AddFoeIfNotDestroyed(new ZakFoe(new Vector2(29, 14) * Constants.TileSizeFloat, GameSprite.Directions.Left, number));
					GameController.AddFoeIfNotDestroyed(new ZakFoe(new Vector2(12, 14) * Constants.TileSizeFloat, GameSprite.Directions.Right, number));
					GameController.AddFoeIfNotDestroyed(new StaffFoe(new Vector2(15 * Constants.TileSizeFloat, 0 * Constants.TileSizeFloat + 2), Trigger.Staff3Destroyed, number));
					break;
			}

			return result;
		}

		public static string[] Shrine1text = {
			"VIND DE PEPERNOTEN",
			"IN DIT KASTEEL...",
			"EEN PIET KAN NIET",
			"ZONDER ZIJN OF HAAR",
			"PEPERNOTEN!"
		};

		public static string[] Shrine2text = {
			"ZONDER VERGROOTGLAS",
			"KAN JE DE HEILIGE",
			"ZAK NIET VINDEN...",
			"DOORZOEK HET KASTEEL!",
		};

		public static string[] Shrine3text = {
			"VERNEDER DE DRIE",
			"STAFFEN VAN",
			"SINTERKLAAS OM BIJ",
			"DE ZAK TE KOMEN.",
		};

		public static string[] Shrine4text = {
			"VERNIETIG ALLE",
			"MARSPEINEN",
			"AARDAPPELTJES.",
		};
}