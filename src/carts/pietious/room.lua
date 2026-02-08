local constants = require('constants.lua')

local room = {}

local room_map_castle_stone_3 = {
	'..............................##',
	'..............................##',
	'..............................##',
	'........######..........########',
	'........######....##............',
	'........######..................',
	'................................',
	'................................',
	'........................##......',
	'................................',
	'................................',
	'######..........................',
	'####-=............##............',
	'####-=..........................',
	'####-=..........................',
	'####-=..........................',
	'####-=..................##......',
	'####-=..........................',
	'####-=..........................',
	'################################',
}

local castle_stone_tiles = {
	{ 'castle_tile_stone_1_1', 'castle_tile_stone_2_1', 'castle_tile_stone_3_1', 'castle_tile_stone_4_1' },
	{ 'castle_tile_stone_1_2', 'castle_tile_stone_2_2', 'castle_tile_stone_3_2', 'castle_tile_stone_4_2' },
	{ 'castle_tile_stone_1_3', 'castle_tile_stone_2_3', 'castle_tile_stone_3_3', 'castle_tile_stone_4_3' },
	{ 'castle_tile_stone_1_4', 'castle_tile_stone_2_4', 'castle_tile_stone_3_4', 'castle_tile_stone_4_4' },
}

local castle_stone_dark_tiles = {
	'castle_tile_stone_dark_1',
	'castle_tile_stone_dark_2',
	'castle_tile_stone_dark_3',
	'castle_tile_stone_dark_4',
}

local function build_collision_map(map_rows)
	local collision = {}
	for y = 1, #map_rows do
		local row = map_rows[y]
		local width = #row
		local collision_row = {}
		for x = 1, width do
			local ch = string.sub(row, x, x)
			if ch == '#' then
				collision_row[x] = 1
			else
				collision_row[x] = 0
			end
		end
		collision[y] = collision_row
	end
	return collision
end

local function create_tile_id(ch, x, y, collision_map)
	if ch == '#' then
		return 'castle_front_blue_1'
	end
	if ch == '-' then
		return 'castle_stairs_l'
	end
	if ch == '=' then
		return 'castle_stairs_r'
	end

	local wall_up = y > 1 and collision_map[y - 1][x] ~= 0
	if wall_up then
		local dark_index = ((x - 1) % 4) + 1
		return castle_stone_dark_tiles[dark_index]
	end

	local tx = ((x - 1) % 4) + 1
	local ty = ((y - 1) % 4) + 1
	return castle_stone_tiles[ty][tx]
end

local function build_tile_grid(map_rows, collision_map)
	local tiles = {}
	for y = 1, #map_rows do
		local row = map_rows[y]
		local width = #row
		local tile_row = {}
		for x = 1, width do
			local ch = string.sub(row, x, x)
			tile_row[x] = create_tile_id(ch, x, y, collision_map)
		end
		tiles[y] = tile_row
	end
	return tiles
end

local function build_solids(collision_map, tile_size, origin_x, origin_y)
	local solids = {}
	local rows = #collision_map
	local cols = #collision_map[1]
	for y = 1, rows do
		local run_start = 0
		for x = 1, cols + 1 do
			local is_solid = x <= cols and collision_map[y][x] ~= 0
			if is_solid and run_start == 0 then
				run_start = x
			elseif (not is_solid) and run_start ~= 0 then
				local run_width_tiles = x - run_start
				solids[#solids + 1] = {
					x = origin_x + ((run_start - 1) * tile_size),
					y = origin_y + ((y - 1) * tile_size),
					w = run_width_tiles * tile_size,
					h = tile_size,
				}
				run_start = 0
			end
		end
	end
	return solids
end

function room.create_room()
	local map_rows = room_map_castle_stone_3
	local collision_map = build_collision_map(map_rows)
	local tiles = build_tile_grid(map_rows, collision_map)
	local tile_size = constants.room.tile_size
	local tile_origin_x = constants.room.tile_origin_x
	local tile_origin_y = constants.room.tile_origin_y

	return {
		world_width = constants.room.width,
		world_height = constants.room.height,
		spawn = { x = constants.player.start_x, y = constants.player.start_y },
		tile_size = tile_size,
		tile_origin_x = tile_origin_x,
		tile_origin_y = tile_origin_y,
		tile_rows = #map_rows,
		tile_columns = #map_rows[1],
		map_rows = map_rows,
		collision_map = collision_map,
		tiles = tiles,
		solids = build_solids(collision_map, tile_size, tile_origin_x, tile_origin_y),
	}
end

return room
