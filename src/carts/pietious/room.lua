local constants = require('constants.lua')
local castle_map = require('castle_map.lua')

local room = {}

local castle_tiles = {
	{ 'castle_tile_stone_1_1', 'castle_tile_stone_2_1', 'castle_tile_stone_3_1', 'castle_tile_stone_4_1' },
	{ 'castle_tile_stone_1_2', 'castle_tile_stone_2_2', 'castle_tile_stone_3_2', 'castle_tile_stone_4_2' },
	{ 'castle_tile_stone_1_3', 'castle_tile_stone_2_3', 'castle_tile_stone_3_3', 'castle_tile_stone_4_3' },
	{ 'castle_tile_stone_1_4', 'castle_tile_stone_2_4', 'castle_tile_stone_3_4', 'castle_tile_stone_4_4' },
}

local castle_dark_tiles = {
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
			local ch = row:sub(x, x)
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
	if ch == '-' or ch == '_' then
		return 'castle_stairs_l'
	end
	if ch == '=' or ch == '+' then
		return 'castle_stairs_r'
	end

	local wall_up = y > 1 and collision_map[y - 1][x] ~= 0
	if wall_up then
		local dark_index = ((x - 1) % 4) + 1
		return castle_dark_tiles[dark_index]
	end

	local tx = ((x - 1) % 4) + 1
	local ty = ((y - 1) % 4) + 1
	return castle_tiles[ty][tx]
end

local function build_tile_grid(map_rows, collision_map)
	local tiles = {}
	for y = 1, #map_rows do
		local row = map_rows[y]
		local width = #row
		local tile_row = {}
		for x = 1, width do
			local ch = row:sub(x, x)
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

local function build_enemies(enemy_defs)
	local enemies = {}
	for i = 1, #enemy_defs do
		local def = enemy_defs[i]
		enemies[i] = {
			id = def.id,
			x = def.x,
			y = def.y,
			w = def.w,
			h = def.h,
			facing = def.facing,
			damage = def.damage,
			kind = def.kind,
		}
	end
	return enemies
end

local function copy_links(links_def)
	return {
		left = links_def.left,
		right = links_def.right,
		up = links_def.up,
		down = links_def.down,
	}
end

local function copy_edge_gates(gates_def)
	local gates = {}
	for direction, gate in pairs(gates_def) do
		gates[direction] = {
			y_min = gate.y_min,
			y_max = gate.y_max,
		}
	end
	return gates
end

local function apply_room_template(room_state, template)
	local map_rows = template.map_rows
	local collision_map = build_collision_map(map_rows)
	local tiles = build_tile_grid(map_rows, collision_map)
	local tile_size = constants.room.tile_size
	local tile_origin_x = constants.room.tile_origin_x
	local tile_origin_y = constants.room.tile_origin_y

	room_state.room_number = template.room_number
	room_state.room_id = template.room_id
	room_state.world_width = constants.room.width
	room_state.world_height = constants.room.height
	room_state.world_top = constants.room.hud_height
	room_state.spawn = {
		x = template.spawn.x,
		y = template.spawn.y,
	}
	room_state.tile_size = tile_size
	room_state.tile_origin_x = tile_origin_x
	room_state.tile_origin_y = tile_origin_y
	room_state.tile_rows = #map_rows
	room_state.tile_columns = #map_rows[1]
	room_state.map_rows = map_rows
	room_state.collision_map = collision_map
	room_state.tiles = tiles
	room_state.solids = build_solids(collision_map, tile_size, tile_origin_x, tile_origin_y)
	room_state.enemies = build_enemies(template.enemies)
	room_state.links = copy_links(template.links)
	room_state.edge_gates = copy_edge_gates(template.edge_gates)
end

local function resolve_room_number(context_or_room_id, maybe_room_id)
	if maybe_room_id ~= nil then
		if type(maybe_room_id) == 'number' then
			return maybe_room_id
		end
		return castle_map.room_number_from_id(maybe_room_id)
	end
	if context_or_room_id == nil then
		return castle_map.start_room_number
	end
	if type(context_or_room_id) == 'number' then
		return context_or_room_id
	end
	return castle_map.room_number_from_id(context_or_room_id)
end

function room.create_room(context_or_room_id, maybe_room_id)
	local room_number = resolve_room_number(context_or_room_id, maybe_room_id)
	local room_state = {}
	apply_room_template(room_state, castle_map.room_template(room_number))
	return room_state
end

function room.switch_room(room_state, direction)
	local target_room_number = room_state.links[direction]
	if target_room_number == nil or target_room_number <= 0 then
		return nil
	end

	local from_room_number = room_state.room_number
	local from_room_id = room_state.room_id
	apply_room_template(room_state, castle_map.room_template(target_room_number))
	return {
		from_room_number = from_room_number,
		from_room_id = from_room_id,
		to_room_number = room_state.room_number,
		to_room_id = room_state.room_id,
		direction = direction,
	}
end

return room
