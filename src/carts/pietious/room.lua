local constants = require('constants.lua')
local castle_map = require('castle_map.lua')

local room = {}

local background_themes = {
	CastleBlue = {
		mode = 'checker2',
		front = 'castle_front_blue_1',
		light_l = 'castle_tile_blue_l',
		light_r = 'castle_tile_blue_r',
		dark_l = 'castle_tile_blue_l_dark',
		dark_r = 'castle_tile_blue_r_dark',
	},
	CastleGarden = {
		mode = 'grid4',
		front = 'castle_front_blue_1',
		tiles = {
			{ 'castle_tile_garden_1_1', 'castle_tile_garden_2_1', 'castle_tile_garden_3_1', 'castle_tile_garden_4_1' },
			{ 'castle_tile_garden_1_2', 'castle_tile_garden_2_2', 'castle_tile_garden_3_2', 'castle_tile_garden_4_2' },
			{ 'castle_tile_garden_1_3', 'castle_tile_garden_2_3', 'castle_tile_garden_3_3', 'castle_tile_garden_4_3' },
			{ 'castle_tile_garden_1_4', 'castle_tile_garden_2_4', 'castle_tile_garden_3_4', 'castle_tile_garden_4_4' },
		},
		dark_tiles = {
			'castle_tile_garden_dark_1',
			'castle_tile_garden_dark_2',
			'castle_tile_garden_dark_3',
			'castle_tile_garden_dark_4',
		},
	},
	CastleGold = {
		mode = 'checker2',
		front = 'castle_front_gold_1',
		light_l = 'castle_tile_gold_l',
		light_r = 'castle_tile_gold_r',
		dark_l = 'castle_tile_gold_l_dark',
		dark_r = 'castle_tile_gold_r_dark',
	},
	CastleRed = {
		mode = 'grid4',
		front = 'castle_front_blue_1',
		tiles = {
			{ 'castle_tile_red_1_1', 'castle_tile_red_2_1', 'castle_tile_red_3_1', 'castle_tile_red_4_1' },
			{ 'castle_tile_red_1_2', 'castle_tile_red_2_2', 'castle_tile_red_3_2', 'castle_tile_red_4_2' },
			{ 'castle_tile_red_1_3', 'castle_tile_red_2_3', 'castle_tile_red_3_3', 'castle_tile_red_4_3' },
			{ 'castle_tile_red_1_4', 'castle_tile_red_2_4', 'castle_tile_red_3_4', 'castle_tile_red_4_4' },
		},
		dark_tiles = {
			'castle_tile_red_dark_1',
			'castle_tile_red_dark_2',
			'castle_tile_red_dark_3',
			'castle_tile_red_dark_4',
		},
	},
	CastleStone = {
		mode = 'grid4',
		front = 'castle_front_blue_1',
		tiles = {
			{ 'castle_tile_stone_1_1', 'castle_tile_stone_2_1', 'castle_tile_stone_3_1', 'castle_tile_stone_4_1' },
			{ 'castle_tile_stone_1_2', 'castle_tile_stone_2_2', 'castle_tile_stone_3_2', 'castle_tile_stone_4_2' },
			{ 'castle_tile_stone_1_3', 'castle_tile_stone_2_3', 'castle_tile_stone_3_3', 'castle_tile_stone_4_3' },
			{ 'castle_tile_stone_1_4', 'castle_tile_stone_2_4', 'castle_tile_stone_3_4', 'castle_tile_stone_4_4' },
		},
		dark_tiles = {
			'castle_tile_stone_dark_1',
			'castle_tile_stone_dark_2',
			'castle_tile_stone_dark_3',
			'castle_tile_stone_dark_4',
		},
	},
}

local pillar_themes = {
	CastleBlue = {
		l1 = 'castle_pillar_blue_l1',
		r1 = 'castle_pillar_blue_r1',
		l2 = 'castle_pillar_blue_l2',
		r2 = 'castle_pillar_blue_r2',
		l3 = 'castle_pillar_blue_l3',
		r3 = 'castle_pillar_blue_r3',
	},
	CastleGarden = {
		l1 = 'castle_pillar_garden_l1',
		r1 = 'castle_pillar_garden_r1',
		l2 = 'castle_pillar_garden_l2',
		r2 = 'castle_pillar_garden_r2',
		l3 = 'castle_pillar_garden_l3',
		r3 = 'castle_pillar_garden_r3',
	},
	CastleGold = {
		l1 = 'castle_pillar_red_l1',
		r1 = 'castle_pillar_red_r1',
		l2 = 'castle_pillar_red_l2',
		r2 = 'castle_pillar_red_r2',
		l3 = 'castle_pillar_red_l3',
		r3 = 'castle_pillar_red_r3',
	},
	CastleRed = {
		l1 = 'castle_pillar_red_l1',
		r1 = 'castle_pillar_red_r1',
		l2 = 'castle_pillar_red_l2',
		r2 = 'castle_pillar_red_r2',
		l3 = 'castle_pillar_red_l3',
		r3 = 'castle_pillar_red_r3',
	},
	CastleStone = {
		l1 = 'castle_pillar_stone_l1',
		r1 = 'castle_pillar_stone_r1',
		l2 = 'castle_pillar_stone_l2',
		r2 = 'castle_pillar_stone_r2',
		l3 = 'castle_pillar_stone_l3',
		r3 = 'castle_pillar_stone_r3',
	},
}

local function get_background_theme(room_subtype)
	local theme = background_themes[room_subtype]
	if theme == nil then
		error('pietious room unknown room_subtype=' .. tostring(room_subtype))
	end
	return theme
end

local function get_pillar_theme(room_subtype)
	local theme = pillar_themes[room_subtype]
	if theme == nil then
		error('pietious room unknown pillar room_subtype=' .. tostring(room_subtype))
	end
	return theme
end

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

local function create_tile_id(ch, x, y, map_rows, collision_map, room_subtype)
	local background = get_background_theme(room_subtype)
	local pillars = get_pillar_theme(room_subtype)

	if ch == '#' then
		return background.front
	end
	if ch == '-' or ch == '_' then
		return 'castle_stairs_l'
	end
	if ch == '=' or ch == '+' then
		return 'castle_stairs_r'
	end
	if ch == 'p' then
		return pillars.l1
	end
	if ch == 'i' then
		return pillars.r1
	end
	if ch == 'l' then
		if y > 1 and y < #map_rows then
			local ch_up = map_rows[y - 1]:sub(x, x)
			local ch_down = map_rows[y + 1]:sub(x, x)
			if ch_up == 'p' and ch_down == 'a' then
				return pillars.l2
			end
			if ch_up == 'i' and ch_down == 'r' then
				return pillars.r2
			end
		end
	end
	if ch == 'a' then
		return pillars.l3
	end
	if ch == 'r' then
		return pillars.r3
	end

	if background.mode == 'grid4' then
		local wall_up = y > 1 and collision_map[y - 1][x] ~= 0
		if wall_up then
			local dark_index = ((x - 1) % 4) + 1
			return background.dark_tiles[dark_index]
		end

		local tx = ((x - 1) % 4) + 1
		local ty = ((y - 1) % 4) + 1
		return background.tiles[ty][tx]
	end

	local is_left_column = ((x - 1) % 2) == 0
	local is_top_row = ((y - 1) % 2) == 0
	if is_top_row then
		local dark = y > 1 and collision_map[y - 1][x] ~= 0
		if is_left_column then
			if dark then
				return background.dark_l
			end
			return background.light_l
		end
		if dark then
			return background.dark_r
		end
		return background.light_r
	end

	local dark = collision_map[y - 1][x] ~= 0
	if is_left_column then
		if dark then
			return background.dark_r
		end
		return background.light_r
	end
	if dark then
		return background.dark_l
	end
	return background.light_l
end

local function build_tile_grid(map_rows, collision_map, room_subtype)
	local tiles = {}
	for y = 1, #map_rows do
		local row = map_rows[y]
		local width = #row
		local tile_row = {}
		for x = 1, width do
			local ch = row:sub(x, x)
			tile_row[x] = create_tile_id(ch, x, y, map_rows, collision_map, room_subtype)
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

local function is_stair_left(ch)
	return ch == '-' or ch == '_'
end

local function is_stair_right(ch)
	return ch == '=' or ch == '+'
end

local function build_stairs(map_rows, tile_size, origin_x, origin_y, player_height)
	local stairs = {}
	local row_count = #map_rows
	local column_count = #map_rows[1]

	for tx = 1, column_count - 1 do
		local ty = 1
		while ty <= row_count do
			local row = map_rows[ty]
			local left = row:sub(tx, tx)
			local right = row:sub(tx + 1, tx + 1)
			if is_stair_left(left) and is_stair_right(right) then
				local min_row = ty
				local max_row = ty
				ty = ty + 1
				while ty <= row_count do
					local next_row = map_rows[ty]
					local next_left = next_row:sub(tx, tx)
					local next_right = next_row:sub(tx + 1, tx + 1)
					if not (is_stair_left(next_left) and is_stair_right(next_right)) then
						break
					end
					max_row = ty
					ty = ty + 1
				end

				local x = origin_x + ((tx - 1) * tile_size)
				local anchor_y = origin_y + ((min_row - 1) * tile_size)
				local top_y = origin_y + ((min_row - 2) * tile_size) - player_height
				local bottom_y = origin_y + (max_row * tile_size) - player_height
				stairs[#stairs + 1] = {
					x = x,
					anchor_y = anchor_y,
					top_y = top_y,
					bottom_y = bottom_y,
					min_row = min_row,
					max_row = max_row,
				}
			else
				ty = ty + 1
			end
		end
	end

	return stairs
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
			direction = def.direction,
			health = def.health,
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
	local tiles = build_tile_grid(map_rows, collision_map, template.room_subtype)
	local tile_size = constants.room.tile_size
	local tile_origin_x = constants.room.tile_origin_x
	local tile_origin_y = constants.room.tile_origin_y

	room_state.room_number = template.room_number
	room_state.room_id = template.room_id
	room_state.space_id = template.space_id
	room_state.room_subtype = template.room_subtype
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
	room_state.stairs = build_stairs(map_rows, tile_size, tile_origin_x, tile_origin_y, constants.player.height)
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
