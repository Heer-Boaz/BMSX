local constants = require('constants')
local castle_map = require('castle_map')

local room = {}

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
			if ch == '#' or ch == '$' then
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

local function is_stair_left(ch)
	return ch == '-' or ch == '_'
end

local function is_stair_right(ch)
	return ch == '=' or ch == '+'
end

local function world_entrance_sprite_id(world_entrance_state)
	if world_entrance_state == 'opening_2' then
		return 'world_entrance_half_open'
	end
	if world_entrance_state == 'open' then
		return 'world_entrance_open'
	end
	return 'world_entrance'
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
				local max_row
				max_row = ty
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

local function apply_room_template(room_state, template)
	local map_rows = template.map_rows
	local collision_map = build_collision_map(map_rows)
	local tiles = build_tile_grid(map_rows, collision_map, template.room_subtype)

	room_state.room_number = template.room_number
	room_state.space_id = template.space_id
	room_state.world_number = template.world_number
	room_state.room_subtype = template.room_subtype
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
	room_state.solids = build_solids(collision_map, constants.room.tile_size, constants.room.tile_origin_x, constants.room.tile_origin_y)
	room_state.stairs = build_stairs(map_rows, constants.room.tile_size, constants.room.tile_origin_x, constants.room.tile_origin_y, constants.player.height)
	room_state.enemies = template.enemies
	room_state.rocks = template.rocks
	room_state.items = template.items
	room_state.lithographs = template.lithographs
	room_state.shrines = template.shrines
	room_state.world_entrances = template.world_entrances
	room_state.links = template.links
	room_state.edge_gates = template.edge_gates
end

function room.create_room(room_number)
	local target_room_number = room_number or castle_map.start_room_number
	local room_state = {}
	apply_room_template(room_state, castle_map.room_templates[target_room_number])
	return room_state
end

function room.world_to_tile(room_state, world_x, world_y)
	local tx = math.modf((world_x - room_state.tile_origin_x) / room_state.tile_size) + 1
	local ty = math.modf((world_y - room_state.tile_origin_y) / room_state.tile_size) + 1
	return tx, ty
end

function room.tile_to_world(room_state, tx, ty)
	local world_x = room_state.tile_origin_x + ((tx - 1) * room_state.tile_size)
	local world_y = room_state.tile_origin_y + ((ty - 1) * room_state.tile_size)
	return world_x, world_y
end

function room.snap_world_to_tile(room_state, world_x, world_y)
	local tx, ty = room.world_to_tile(room_state, world_x, world_y)
	return room.tile_to_world(room_state, tx, ty)
end

function room.is_wall_at_tile(room_state, tx, ty)
	if ty < 1 or ty > room_state.tile_rows then
		return false
	end
	if tx < 1 or tx > room_state.tile_columns then
		return false
	end
	if room_state.collision_map[ty][tx] ~= 0 then
		return true
	end
	if room.is_active_rock_at_tile(room_state, tx, ty) then
		return true
	end
	return room.is_active_breakable_wall_at_tile(room_state, tx, ty)
end

function room.is_solid_at_tile(room_state, tx, ty)
	if ty < 1 or ty > room_state.tile_rows then
		return false
	end
	if tx < 1 or tx > room_state.tile_columns then
		return false
	end
	if room_state.collision_map[ty][tx] ~= 0 then
		return true
	end
	if room.is_active_rock_at_tile(room_state, tx, ty) then
		return true
	end
	return room.is_active_breakable_wall_at_tile(room_state, tx, ty)
end

function room.overlaps_active_rock(room_state, x, y, w, h)
	local rocks = room_state.rocks
	if #rocks == 0 then
		return false
	end

	local destroyed_rock_ids = service('r').destroyed_rock_ids
	for i = 1, #rocks do
		local rock = rocks[i]
		if destroyed_rock_ids[rock.id] ~= true then
			if rect_overlaps(x, y, w, h, rock.x, rock.y, constants.rock.width, constants.rock.height) then
				return true
			end
		end
	end
	return false
end

function room.is_active_rock_at_tile(room_state, tx, ty)
	local world_x, world_y = room.tile_to_world(room_state, tx, ty)
	return room.overlaps_active_rock(room_state, world_x, world_y, room_state.tile_size, room_state.tile_size)
end

function room.overlaps_active_breakable_wall(room_state, x, y, w, h)
	local enemy_defs = room_state.enemies
	for i = 1, #enemy_defs do
		local enemy_def = enemy_defs[i]
		if enemy_def.kind == 'breakablewall' or enemy_def.kind == 'disappearingwall' then
			local wall = object(enemy_def.id)
			if wall ~= nil and wall.active and wall.space_id == room_state.space_id then
				local wall_width = enemy_def.width_tiles * room_state.tile_size
				local wall_height = enemy_def.height_tiles * room_state.tile_size
				if rect_overlaps(x, y, w, h, enemy_def.x, enemy_def.y, wall_width, wall_height) then
					return true
				end
			end
		end
	end
	return false
end

function room.is_active_breakable_wall_at_tile(room_state, tx, ty)
	local world_x, world_y = room.tile_to_world(room_state, tx, ty)
	return room.overlaps_active_breakable_wall(room_state, world_x, world_y, room_state.tile_size, room_state.tile_size)
end

function room.is_solid_at_world(room_state, world_x, world_y)
	local tx, ty = room.world_to_tile(room_state, world_x, world_y)
	return room.is_solid_at_tile(room_state, tx, ty)
end

function room.sync_lithograph_instances(room_state)
	local lithograph_defs = room_state.lithographs
	for i = 1, #lithograph_defs do
		local lithograph_def = lithograph_defs[i]
		if object(lithograph_def.id) == nil then
			inst('lithograph.def', {
				id = lithograph_def.id,
				space_id = room_state.space_id,
				pos = { x = lithograph_def.x, y = lithograph_def.y, z = 10 },
				text = lithograph_def.text,
				room_number = room_state.room_number,
			})
		end
	end
end

function room.find_near_lithograph(room_state, player)
	room.sync_lithograph_instances(room_state)
	local lithograph_defs = room_state.lithographs
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

function room.switch_room(room_state, direction)
	local target_room_number = room_state.links[direction]
	if target_room_number == nil or target_room_number == 0 then -- TODO: force a single exit room value (either nil or 0) instead of allowing both
		return nil
	end

	local from_room_number = room_state.room_number

	if target_room_number < 0 then
		return {
			from_room_number = from_room_number,
			to_room_number = target_room_number,
			direction = direction,
			outside = true,
		}
	end

	apply_room_template(room_state, castle_map.room_templates[target_room_number])
	return {
		from_room_number = from_room_number,
		to_room_number = room_state.room_number,
		direction = direction,
	}
end

local room_object = {}
room_object.__index = room_object

local function render_elevators(room_number, elevator_routes)
	for i = 1, #elevator_routes do
		local elevator = elevator_routes[i]
		if elevator.current_room_number == room_number then
			put_sprite('elevator_platform', elevator.x, elevator.y, 21)
		end
	end
end

function room_object:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:render_room()
	end
end

function room_object:bind_events()
	self.events:on({
		event = 'room.switched',
		emitter = 'pietolon',
		subscriber = self,
		handler = function(event)
			self.space_id = event.space
			room.sync_lithograph_instances(service('c').current_room)
		end,
	})
end

function room_object:ctor()
	room.sync_lithograph_instances(service('c').current_room)
	self:bind_visual()
	self:bind_events()
end

function room_object:render_tiles(room_state)
	local tile_size = room_state.tile_size
	local origin_x = room_state.tile_origin_x
	local origin_y = room_state.tile_origin_y

	for y = 1, room_state.tile_rows do
		local draw_y = origin_y + ((y - 1) * tile_size)
		local row = room_state.tiles[y]
		for x = 1, room_state.tile_columns do
			local draw_x = origin_x + ((x - 1) * tile_size)
			put_sprite(row[x], draw_x, draw_y, 0)
		end
	end
end

function room_object:render_room_objects(room_state)
	local shrines = room_state.shrines
	for i = 1, #shrines do
		local shrine = shrines[i]
		put_sprite('shrine', shrine.x, shrine.y, 22)
	end

	local castle_service = service('c')
	local world_entrances = room_state.world_entrances
	for i = 1, #world_entrances do
		local world_entrance = world_entrances[i]
		local entrance_state = castle_service.world_entrance_states[world_entrance.target].state
		local sprite_id = world_entrance_sprite_id(entrance_state)
		put_sprite(sprite_id, world_entrance.x, world_entrance.y, 22)
	end

	local elevator_service = service('elevator_service')
	render_elevators(castle_service.current_room_number, elevator_service.elevator_routes)
end

function room_object:render_room()
	local castle_service = service('c')
	local room_state = castle_service.current_room
	self:render_tiles(room_state)
	self:render_room_objects(room_state)
end

local function define_room_fsm()
	define_fsm('room.fsm', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_room_definition()
	define_prefab({
		def_id = 'room.def',
		class = room_object,
		fsms = { 'room.fsm' },
		components = { 'customvisualcomponent' },
		defaults = {
			tick_enabled = false,
		},
	})
end

room.room_object = room_object
room.define_room_fsm = define_room_fsm
room.register_room_definition = register_room_definition

return room
