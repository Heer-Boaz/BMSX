local constants = require('constants')
local castle_map = require('castle_map')
local timeline = require('timeline')

local room = {}
local water_surface_timeline_id = 'r.ws'
local water_surface_frame_imgids = {
	'water_surface_msx',
}
local water_surface_timeline_frame_defs = {
	{ value = 1, hold = 1 },
}
for i = 1, 63 do
	local suffix = string.format('%02d', i)
	water_surface_frame_imgids[i + 1] = 'water_surface_msx_' .. suffix
	water_surface_timeline_frame_defs[i + 1] = { value = i + 1, hold = 1 }
end
local solid_tiles = {
	['#'] = true,
	['$'] = true,
}
local stair_left_tiles = {
	['-'] = true,
	['_'] = true,
}
local stair_right_tiles = {
	['='] = true,
	['+'] = true,
}
local breakable_wall_kinds = {
	breakablewall = true,
	disappearingwall = true,
}
local world_dissolve_prefix_by_tile_id = {
	backworld_ul = 'backworld_ul_dissolve_',
	backworld_ul_dark = 'backworld_ul_dissolve_',
	backworld_ur = 'backworld_ur_dissolve_',
	backworld_ur_dark = 'backworld_ur_dissolve_',
	backworld_dl = 'backworld_dl_dissolve_',
	backworld_dl_dark = 'backworld_dl_dissolve_',
	backworld_dr = 'backworld_dr_dissolve_',
	backworld_dr_dark = 'backworld_dr_dissolve_',
}

local background_themes = {
	castleblue = {
		mode = 'checker2',
		front = 'castle_front_blue_1',
		light_l = 'castle_tile_blue_l',
		light_r = 'castle_tile_blue_r',
		dark_l = 'castle_tile_blue_l_dark',
		dark_r = 'castle_tile_blue_r_dark',
	},
	castlegarden = {
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
	castlegold = {
		mode = 'checker2',
		front = 'castle_front_gold_1',
		light_l = 'castle_tile_gold_l',
		light_r = 'castle_tile_gold_r',
		dark_l = 'castle_tile_gold_l_dark',
		dark_r = 'castle_tile_gold_r_dark',
	},
	castlered = {
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
	castlestone = {
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
	world = {
		mode = 'world4',
		front = 'frontworld_l',
		ul = 'backworld_ul',
		ur = 'backworld_ur',
		dl = 'backworld_dl',
		dr = 'backworld_dr',
		ul_dark = 'backworld_ul_dark',
		ur_dark = 'backworld_ur_dark',
		dl_dark = 'backworld_dl_dark',
		dr_dark = 'backworld_dr_dark',
	},
}

local pillar_themes = {
	castleblue = {
		l1 = 'castle_pillar_blue_l1',
		r1 = 'castle_pillar_blue_r1',
		l2 = 'castle_pillar_blue_l2',
		r2 = 'castle_pillar_blue_r2',
		l3 = 'castle_pillar_blue_l3',
		r3 = 'castle_pillar_blue_r3',
	},
	castlegarden = {
		l1 = 'castle_pillar_garden_l1',
		r1 = 'castle_pillar_garden_r1',
		l2 = 'castle_pillar_garden_l2',
		r2 = 'castle_pillar_garden_r2',
		l3 = 'castle_pillar_garden_l3',
		r3 = 'castle_pillar_garden_r3',
	},
	castlegold = {
		l1 = 'castle_pillar_red_l1',
		r1 = 'castle_pillar_red_r1',
		l2 = 'castle_pillar_red_l2',
		r2 = 'castle_pillar_red_r2',
		l3 = 'castle_pillar_red_l3',
		r3 = 'castle_pillar_red_r3',
	},
	castlered = {
		l1 = 'castle_pillar_red_l1',
		r1 = 'castle_pillar_red_r1',
		l2 = 'castle_pillar_red_l2',
		r2 = 'castle_pillar_red_r2',
		l3 = 'castle_pillar_red_l3',
		r3 = 'castle_pillar_red_r3',
	},
	castlestone = {
		l1 = 'castle_pillar_stone_l1',
		r1 = 'castle_pillar_stone_r1',
		l2 = 'castle_pillar_stone_l2',
		r2 = 'castle_pillar_stone_r2',
		l3 = 'castle_pillar_stone_l3',
		r3 = 'castle_pillar_stone_r3',
	},
	world = {
		l1 = 'backworld_pillar_l1',
		r1 = 'backworld_pillar_r1',
		l2 = 'backworld_pillar_l2',
		r2 = 'backworld_pillar_r2',
		l3 = 'backworld_pillar_l3',
		r3 = 'backworld_pillar_r3',
	},
}

local function build_collision_map(map_rows)
	local collision = {}
	for y = 1, #map_rows do
		local row = map_rows[y]
		local width = #row
		local collision_row = {}
		for x = 1, width do
			local ch = row:sub(x, x)
			if solid_tiles[ch] then
				collision_row[x] = 1
			else
				collision_row[x] = 0
			end
		end
		collision[y] = collision_row
	end
	return collision
end

local function build_visual_map_rows(map_rows, draaideuren, tile_size, origin_x, origin_y)
	local visual_rows = {}
	for y = 1, #map_rows do
		visual_rows[y] = map_rows[y]
	end

	for i = 1, #draaideuren do
		local draaideur = draaideuren[i]
		local tx = math.modf((draaideur.x - origin_x) / tile_size) + 1
		local ty = math.modf((draaideur.y - origin_y) / tile_size) + 1
		for row = ty, ty + 2 do
			local line = visual_rows[row]
			visual_rows[row] = line:sub(1, tx - 1) .. '.' .. line:sub(tx + 1)
		end
	end

	return visual_rows
end

local function create_tile_id(ch, x, y, map_rows, collision_map, room_subtype)
	local background = background_themes[room_subtype]
	local pillars = pillar_themes[room_subtype]

	if ch == '#' then
		return background.front
	end
	if ch == '$' then
		if background.front_dissolve ~= nil then
			return background.front_dissolve
		end
		return background.front
	end
	if stair_left_tiles[ch] then
		return 'castle_stairs_l'
	end
	if stair_right_tiles[ch] then
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

	if background.mode == 'world4' then
		local dark = y > 1 and collision_map[y - 1][x] ~= 0
		local left_column = ((x - 1) % 2) == 0
		local row_mod = (y - 1) % 4
		if row_mod == 0 then
			if left_column then
				return dark and background.ul_dark or background.ul
			end
			return dark and background.ur_dark or background.ur
		end
		if row_mod == 1 then
			if left_column then
				return dark and background.dl_dark or background.dl
			end
			return dark and background.dr_dark or background.dr
		end
		if row_mod == 2 then
			if left_column then
				return dark and background.ur_dark or background.ur
			end
			return dark and background.ul_dark or background.ul
		end
		if left_column then
			return dark and background.dr_dark or background.dr
		end
		return dark and background.dl_dark or background.dl
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
			if stair_left_tiles[left] and stair_right_tiles[right] then
				local min_row = ty
				local max_row
				max_row = ty
				ty = ty + 1
				while ty <= row_count do
					local next_row = map_rows[ty]
					local next_left = next_row:sub(tx, tx)
					local next_right = next_row:sub(tx + 1, tx + 1)
					if not (stair_left_tiles[next_left] and stair_right_tiles[next_right]) then
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

local function water_kind_at_tile(room_state, tx, ty)
	local water = room_state.water
	if water == nil then
		return constants.water.none
	end
	if ty < water.surface_row or ty > room_state.tile_rows then
		return constants.water.none
	end
	if tx < 1 or tx > room_state.tile_columns then
		return constants.water.none
	end
	if room_state.collision_map[ty][tx] ~= 0 then
		return constants.water.none
	end
	if ty == water.surface_row then
		return constants.water.surface
	end
	return constants.water.body
end

local function player_water_kind_at_tile(room_state, tx, ty)
	local water = room_state.water
	if water == nil then
		return constants.water.none
	end
	if ty < water.surface_row or ty > room_state.tile_rows then
		return constants.water.none
	end
	if tx < 1 or tx > room_state.tile_columns then
		return constants.water.none
	end
	if ty == water.surface_row then
		return constants.water.surface
	end
	return constants.water.body
end

local function refresh_room_geometry(room_state)
	local map_rows = room_state.map_rows
	local collision_map = build_collision_map(map_rows)
	room_state.collision_map = collision_map
	room_state.tiles = build_tile_grid(map_rows, collision_map, room_state.room_subtype)
	room_state.solids = build_solids(collision_map, constants.room.tile_size, constants.room.tile_origin_x, constants.room.tile_origin_y)
	room_state.stairs = build_stairs(map_rows, constants.room.tile_size, constants.room.tile_origin_x, constants.room.tile_origin_y, constants.player.height)
end

local function apply_room_template(room_state, template)
	local map_rows = build_visual_map_rows(
		template.map_rows,
		template.draaideuren,
		constants.room.tile_size,
		constants.room.tile_origin_x,
		constants.room.tile_origin_y
	)
	local collision_map = build_collision_map(map_rows)
	local tiles = build_tile_grid(map_rows, collision_map, template.room_subtype)

	room_state.room_number = template.room_number
	room_state.world_number = template.world_number
	room_state.room_subtype = template.room_subtype
	room_state.custom = template.custom
	room_state.room_dissolve_step = 0
	room_state.seal_dissolve_step = 0
	room_state.world_width = constants.room.width
	room_state.world_height = constants.room.height
	room_state.world_top = constants.room.hud_height
	room_state.spawn = template.spawn
	room_state.tile_size = constants.room.tile_size
	room_state.tile_origin_x = constants.room.tile_origin_x
	room_state.tile_origin_y = constants.room.tile_origin_y
	room_state.tile_rows = #map_rows
	room_state.tile_columns = #map_rows[1]
	room_state.map_rows = map_rows
	room_state.collision_map = collision_map
	room_state.tiles = tiles
	room_state.water = template.water
	room_state.solids = build_solids(collision_map, constants.room.tile_size, constants.room.tile_origin_x, constants.room.tile_origin_y)
	room_state.stairs = build_stairs(map_rows, constants.room.tile_size, constants.room.tile_origin_x, constants.room.tile_origin_y, constants.player.height)
	room_state.enemies = template.enemies
	room_state.rocks = template.rocks
	room_state.items = template.items
	room_state.lithographs = template.lithographs
	room_state.shrines = template.shrines
	room_state.seal = template.seal
	room_state.world_entrances = template.world_entrances
	room_state.draaideuren = template.draaideuren
	room_state.room_links = template.room_links
	room_state.edge_gates = template.edge_gates
end

local room_object = {}
room_object.__index = room_object

function room_object:load_room(room_number)
	local target_room_number = room_number or castle_map.start_room_number
	apply_room_template(self, castle_map.room_templates[target_room_number])
end

function room_object:patch_rows(rows)
	local changed
	for i = 1, #rows do
		local patch = rows[i]
		local row_index = patch.index
		local row_value = patch.value
		if self.map_rows[row_index] ~= row_value then
			self.map_rows[row_index] = row_value
			changed = true
		end
	end
	if changed then
		refresh_room_geometry(self)
	end
	return changed
end

function room_object:apply_progression_command(command)
	if command.room_number ~= nil and command.room_number ~= object('c').current_room_number then
		return false
	end
	if command.op == 'room.patch_rows' then
		return self:patch_rows(command.rows)
	end
	error("Unsupported room progression command op '" .. tostring(command.op) .. "'.")
end

function room_object:world_to_tile(world_x, world_y)
	local tx = math.modf((world_x - self.tile_origin_x) / self.tile_size) + 1
	local ty = math.modf((world_y - self.tile_origin_y) / self.tile_size) + 1
	return tx, ty
end

function room_object:tile_to_world(tx, ty)
	local world_x = self.tile_origin_x + ((tx - 1) * self.tile_size)
	local world_y = self.tile_origin_y + ((ty - 1) * self.tile_size)
	return world_x, world_y
end

function room_object:snap_world_to_tile(world_x, world_y)
	local tx, ty = self:world_to_tile(world_x, world_y)
	return self:tile_to_world(tx, ty)
end

function room_object:base_collision_flags_at_tile(tx, ty)
	if ty < 1 or ty > self.tile_rows then
		return constants.collision_flags.none
	end
	if tx < 1 or tx > self.tile_columns then
		return constants.collision_flags.none
	end
	local collision = 0
	if self.collision_map[ty][tx] ~= 0 then
		collision = collision | constants.collision_flags.wall
	end
	if self:is_active_rock_at_tile(tx, ty) then
		collision = collision | constants.collision_flags.wall
	end
	if self:is_active_draaideur_at_tile(tx, ty) then
		collision = collision | constants.collision_flags.wall
	end
	if self:is_active_breakable_wall_at_tile(tx, ty) then
		collision = collision | constants.collision_flags.wall
	end
	return collision
end

function room_object:water_kind_at_world(world_x, world_y)
	local tx, ty = self:world_to_tile(world_x, world_y)
	return water_kind_at_tile(self, tx, ty)
end

function room_object:player_water_kind_at_world(world_x, world_y)
	local tx, ty = self:world_to_tile(world_x, world_y)
	return player_water_kind_at_tile(self, tx, ty)
end

function room_object:collision_flags_at_tile(tx, ty, include_elevator)
	local collision = self:base_collision_flags_at_tile(tx, ty)
	local use_elevator = include_elevator
	if use_elevator == nil then
		use_elevator = true
	end
	if use_elevator and self:is_active_elevator_at_tile(tx, ty) then
		collision = collision | constants.collision_flags.elevator
	end
	return collision
end

function room_object:find_active_rock_overlapping_rect(x, y, w, h)
	local rocks = self.rocks
	if #rocks == 0 then
		return nil
	end

	local destroyed_rock_ids = self.destroyed_rock_ids
	for i = 1, #rocks do
		local rock = rocks[i]
		if not destroyed_rock_ids[rock.id] then
			if rect_overlaps(x, y, w, h, rock.x, rock.y, constants.rock.width, constants.rock.height) then
				return rock
			end
		end
	end
	return nil
end

function room_object:overlaps_active_rock(x, y, w, h)
	if self:find_active_rock_overlapping_rect(x, y, w, h) ~= nil then
		return true
	end
	return false
end

function room_object:is_active_rock_at_tile(tx, ty)
	local world_x, world_y = self:tile_to_world(tx, ty)
	return self:overlaps_active_rock(world_x, world_y, self.tile_size, self.tile_size)
end

function room_object:overlaps_active_elevator(x, y, w, h)
	local elevator_count = object('c').elevator_count
	for i = 1, elevator_count do
		local platform = object('e.p' .. tostring(i))
		if platform.current_room_number == self.room_number
			and rect_overlaps(x, y, w, h, platform.x, platform.y, constants.room.tile_size4, constants.room.tile_size2)
		then
			return true
		end
	end
	return false
end

function room_object:is_active_elevator_at_tile(tx, ty)
	local world_x, world_y = self:tile_to_world(tx, ty)
	return self:overlaps_active_elevator(world_x, world_y, self.tile_size, self.tile_size)
end

function room_object:overlaps_active_breakable_wall(x, y, w, h)
	local enemy_defs = self.enemies
	for i = 1, #enemy_defs do
		local enemy_def = enemy_defs[i]
		if breakable_wall_kinds[enemy_def.kind] then
			local wall = object(enemy_def.id)
			if wall ~= nil and wall.active and wall.space_id == 'main' then
				local wall_width = enemy_def.width_tiles * self.tile_size
				local wall_height = enemy_def.height_tiles * self.tile_size
				if rect_overlaps(x, y, w, h, enemy_def.x, enemy_def.y, wall_width, wall_height) then
					return true
				end
			end
		end
	end
	return false
end

function room_object:overlaps_active_draaideur(x, y, w, h)
	local tx0, ty0 = self:world_to_tile(x, y)
	local tx1, ty1 = self:world_to_tile(x + w - 1, y + h - 1)
	if tx1 < tx0 then
		tx0, tx1 = tx1, tx0
	end
	if ty1 < ty0 then
		ty0, ty1 = ty1, ty0
	end

	for ty = ty0, ty1 do
		for tx = tx0, tx1 do
			if self:is_active_draaideur_at_tile(tx, ty) then
				return true
			end
		end
	end
	return false
end

function room_object:is_active_draaideur_at_tile(tx, ty)
	if ty < 1 or ty > self.tile_rows then
		return false
	end
	if tx < 1 or tx > self.tile_columns then
		return false
	end

	local draaideuren = self.draaideuren
	for i = 1, #draaideuren do
		local door_def = draaideuren[i]
		local door_tx = math.modf((door_def.x - self.tile_origin_x) / self.tile_size) + 1
		local door_ty = math.modf((door_def.y - self.tile_origin_y) / self.tile_size) + 1
		if tx == door_tx and ty >= door_ty and ty <= door_ty + 2 then
			local draaideur = object(door_def.id)
			if draaideur ~= nil and draaideur.state >= 0 then
				return true
			end
		end
	end
	return false
end

function room_object:is_active_breakable_wall_at_tile(tx, ty)
	local world_x, world_y = self:tile_to_world(tx, ty)
	return self:overlaps_active_breakable_wall(world_x, world_y, self.tile_size, self.tile_size)
end

function room_object:has_collision_flags_at_tile(tx, ty, mask)
	return (self:collision_flags_at_tile(tx, ty) & mask) ~= 0
end

function room_object:collision_flags_at_world(world_x, world_y, include_elevator)
	local tx, ty = self:world_to_tile(world_x, world_y)
	return self:collision_flags_at_tile(tx, ty, include_elevator)
end

function room_object:has_collision_flags_at_world(world_x, world_y, mask, include_elevator)
	return (self:collision_flags_at_world(world_x, world_y, include_elevator) & mask) ~= 0
end

function room_object:has_collision_flags_in_rect(x, y, w, h, mask, include_elevator)
	local tx0, ty0 = self:world_to_tile(x, y)
	local tx1, ty1 = self:world_to_tile(x + w - 1, y + h - 1)
	if tx1 < tx0 then
		tx0, tx1 = tx1, tx0
	end
	if ty1 < ty0 then
		ty0, ty1 = ty1, ty0
	end

	for ty = ty0, ty1 do
		for tx = tx0, tx1 do
			if (self:collision_flags_at_tile(tx, ty, include_elevator) & mask) ~= 0 then
				return true
			end
		end
	end

	return false
end

function room_object:overlaps_solid_rect(x, y, w, h)
	local solids = self.solids
	for i = 1, #solids do
		local solid = solids[i]
		if rect_overlaps(x, y, w, h, solid.x, solid.y, solid.w, solid.h) then
			return true
		end
	end
	if self:overlaps_active_rock(x, y, w, h) then
		return true
	end
	if self:overlaps_active_elevator(x, y, w, h) then
		return true
	end
	if self:overlaps_active_draaideur(x, y, w, h) then
		return true
	end
	return self:overlaps_active_breakable_wall(x, y, w, h)
end

function room_object:find_near_lithograph(player)
	local lithograph_defs = self.lithographs
	local player_left = player.x
	local player_top = player.y
	local player_right = player.x + player.width
	local player_bottom = player.y + player.height

	for i = 1, #lithograph_defs do
		local lithograph = object(lithograph_defs[i].id)
		local area_left = lithograph.x + constants.lithograph.hit_left_px
		local area_top = lithograph.y + constants.lithograph.hit_top_px
		local area_right = lithograph.x + constants.lithograph.hit_right_px
		local area_bottom = lithograph.y + constants.lithograph.hit_bottom_px
		if player_right >= area_left and player_left <= area_right and player_bottom >= area_top and player_top <= area_bottom then
			return lithograph
		end
	end

	return nil
end

function room_object:switch_room(direction)
	local from_room_number = object('c').current_room_number
	local target_room_number = self.room_links[direction]

	if target_room_number < 0 then
		return {
			from_room_number = from_room_number,
			to_room_number = target_room_number,
			direction = direction,
			outside = true,
		}
	end

	apply_room_template(self, castle_map.room_templates[target_room_number])
	return {
		from_room_number = from_room_number,
		to_room_number = target_room_number,
		direction = direction,
	}
end

function room_object:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:render_room()
	end
end

function room_object:ctor()
	self.destroyed_rock_ids = {}
	self:bind_visual()
end

function room_object:render_tiles()
	local tile_size = self.tile_size
	local origin_x = self.tile_origin_x
	local origin_y = self.tile_origin_y
	local dissolve_step = self.room_dissolve_step
	bgmap_begin(0, self.tile_columns, self.tile_rows, tile_size, tile_size, origin_x, origin_y, 0)

	for y = 1, self.tile_rows do
		local map_row = self.map_rows[y]
		local row = self.tiles[y]
		for x = 1, self.tile_columns do
			local tile_id = row[x]
			if dissolve_step > 0 then
				local dissolve_index = dissolve_step - 1
				if self.room_subtype == 'world' and map_row:sub(x, x) == '$' then
					if dissolve_index >= 6 then
						goto continue
					end
					local wall_phase = ((x + (y * 3)) % 6) + 1
					if dissolve_index >= wall_phase then
						goto continue
					end
				end
				local dissolve_prefix = world_dissolve_prefix_by_tile_id[tile_id]
				if dissolve_prefix ~= nil then
					if dissolve_index >= 6 then
						goto continue
					end
					tile_id = dissolve_prefix .. tostring(dissolve_index)
				end
			end
			bgmap_tile(0, x - 1, y - 1, tile_id)
			::continue::
		end
	end
end

function room_object:render_water()
	if self.water == nil then
		return
	end
	bgmap_begin(1, self.tile_columns, self.tile_rows, self.tile_size, self.tile_size, self.tile_origin_x, self.tile_origin_y, 0)
	local water_surface_frame = self:get_timeline(water_surface_timeline_id):value()
	local water_surface_imgid = water_surface_frame_imgids[water_surface_frame]

	for y = self.water.surface_row, self.tile_rows do
		for x = 1, self.tile_columns do
			local kind = water_kind_at_tile(self, x, y)
			if kind ~= constants.water.none then
				if kind == constants.water.surface then
					bgmap_tile(1, x - 1, y - 1, water_surface_imgid)
				else
					bgmap_tile(1, x - 1, y - 1, 'water_body_msx')
				end
			end
		end
	end
end

function room_object:render_room()
	self:render_tiles()
	self:render_water()
	if not self:has_tag('r.seal_fx') then
		return
	end
	local director = object('d')
	if not director:has_tag('d.seal.flash') then
		return
	end
	put_rectfillcolor(0, constants.room.tile_origin_y, display_width(), display_height(), 342, { r = 1, g = 1, b = 1, a = 0.5 })
end

local function room_runtime_state_name(room_state)
	local world_number = room_state.world_number or 0
	if world_number ~= 0 then
		local castle = object('c')
		if castle:has_tag('c.daemon.fight') then
			return 'daemon_fight'
		end
		if castle:has_tag('c.seal.active') then
			return 'seal'
		end
		if castle:has_tag('c.seal.sequence') then
			return 'seal'
		end
		return 'world'
	end
	return 'castle'
end

local function define_room_fsm()
	define_fsm('room', {
		initial = 'mode_state',
		on = {
			['room.switched'] = {
				emitter = 'pietolon',
				go = function(self)
					self:set_space('main')
				end,
			},
		},
		states = {
			mode_state = {
				initial = 'room',
				on = {
					['room'] = '/mode_state/room',
					['transition'] = '/mode_state/transition',
					['halo'] = '/mode_state/halo',
					['shrine'] = '/mode_state/shrine',
					['item'] = '/mode_state/item',
					['lithograph'] = '/mode_state/lithograph',
					['title'] = '/mode_state/title',
					['story'] = '/mode_state/story',
					['ending'] = '/mode_state/ending',
					['victory_dance'] = '/mode_state/victory_dance',
					['death'] = '/mode_state/death',
					['seal_dissolution'] = '/mode_state/seal_dissolution',
					['daemon_appearance'] = '/mode_state/daemon_appearance',
				},
				states = {
					room = {
						entering_state = function(self)
							self.events:emit('room_state.sync')
						end,
					},
					transition = {},
					halo = {},
					shrine = {},
					item = {},
					lithograph = {},
					title = {},
					story = {},
					ending = {},
					victory_dance = {},
					death = {},
					seal_dissolution = {},
					daemon_appearance = {},
				},
			},
			room_state = {
				is_concurrent = true,
				initial = 'unknown',
				on = {
					['room_state.sync'] = function(self)
						return '/room_state/' .. room_runtime_state_name(self)
					end,
					['room_state.changed'] = function(self)
						return '/room_state/' .. room_runtime_state_name(self)
					end,
				},
				states = {
					unknown = {},
					castle = {},
					world = {},
					seal = {},
					daemon_fight = {},
				},
			},
			fx_state = {
				is_concurrent = true,
				initial = 'active',
				on = {
					['seal_dissolution'] = '/fx_state/seal_fx',
					['daemon_appearance'] = '/fx_state/daemon_fx',
					['room'] = '/fx_state/active',
					['transition'] = '/fx_state/active',
					['halo'] = '/fx_state/active',
					['shrine'] = '/fx_state/active',
					['item'] = '/fx_state/active',
					['lithograph'] = '/fx_state/active',
					['title'] = '/fx_state/active',
					['story'] = '/fx_state/active',
					['ending'] = '/fx_state/active',
					['victory_dance'] = '/fx_state/active',
					['death'] = '/fx_state/active',
				},
				states = {
					active = {},
					seal_fx = {
						tags = { 'r.seal_fx' },
					},
					daemon_fx = {},
				},
			},
			water_state = {
				is_concurrent = true,
				initial = 'active',
				states = {
					active = {
						timelines = {
							[water_surface_timeline_id] = {
								def = {
									-- MoG `TBD06..TBD57`: surface char `0xB6` rotates on a 64-tick cycle.
									frames = timeline.build_frame_sequence(water_surface_timeline_frame_defs),
									playback_mode = 'loop',
								},
								autoplay = true,
							},
						},
					},
				},
			},
		},
	})
end

local function register_room_definition()
	define_prefab({
		def_id = 'room',
		class = room_object,
		fsms = { 'room' },
		components = { 'customvisualcomponent' },
		defaults = {
		},
	})
end

room.define_room_fsm = define_room_fsm
room.register_room_definition = register_room_definition

return room
