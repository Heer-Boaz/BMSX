local constants = require('constants')
local romdir = require('romdir')

local castle_map = {}

local start_room_number = 1

	local world_transition_specs = {
		world_1 = {
			target = 'world_1',
			world_number = 1,
			world_room_number = 101,
		world_map_x = 2,
		world_map_y = 0,
		world_spawn_x = 28 * constants.room.tile_size,
		world_spawn_y = constants.room.tile_origin_y + (15 * constants.room.tile_size),
		world_spawn_facing = -1,
		castle_map_x = 3,
		castle_map_y = 12,
		castle_spawn_x = 152,
		castle_spawn_y = 64,
			castle_room_number = 0,
			castle_spawn_facing = 1,
		},
}

local map_world_proxies = {
	[1] = {
		{ x = 3, y = 2, room_number = 101, is_boss_room = false },
		{ x = 2, y = 2, room_number = 102, is_boss_room = false },
		{ x = 2, y = 1, room_number = 103, is_boss_room = false },
		{ x = 2, y = 0, room_number = 104, is_boss_room = false },
		{ x = 1, y = 2, room_number = 105, is_boss_room = false },
		{ x = 1, y = 3, room_number = 106, is_boss_room = false },
		{ x = 0, y = 3, room_number = 107, is_boss_room = false },
		{ x = 1, y = 4, room_number = 108, is_boss_room = false },
		{ x = 2, y = 4, room_number = 109, is_boss_room = false },
		{ x = 3, y = 4, room_number = 110, is_boss_room = false },
		{ x = 2, y = 5, room_number = 100, is_boss_room = true },
	},
}

local function tile_x_to_world(tile_x)
	return tile_x * constants.room.tile_size
end

local function tile_y_to_world(tile_y)
	return constants.room.tile_origin_y + (tile_y * constants.room.tile_size)
end

local elevator_route_specs = {
	{
		points = {
			{ room_number = 13, tile_x = 14, tile_y = 5 },
			{ room_number = 6, tile_x = 14, tile_y = 8 },
		},
		vertical_to_point = { 'up', 'down' },
		going_to = 2,
	},
}

local function build_elevator_routes()
	local routes = {}
	for i = 1, #elevator_route_specs do
		local spec = elevator_route_specs[i]
		local point1 = spec.points[1]
		local point2 = spec.points[2]
		routes[i] = {
			path = {
				{
					room_number = point1.room_number,
					x = tile_x_to_world(point1.tile_x),
					y = tile_y_to_world(point1.tile_y),
				},
				{
					room_number = point2.room_number,
					x = tile_x_to_world(point2.tile_x),
					y = tile_y_to_world(point2.tile_y),
				},
			},
			vertical_to_point = spec.vertical_to_point,
			going_to = spec.going_to,
		}
	end
	return routes
end

local function sort_room_numbers(room_table)
	local room_numbers = {}
	for room_number, _ in pairs(room_table) do
		room_numbers[#room_numbers + 1] = tonumber(room_number)
	end
	table.sort(room_numbers)
	return room_numbers
end

local function build_links(exits)
	return {
		up = exits[1],
		right = exits[2],
		down = exits[3],
		left = exits[4],
	}
end

local function build_edge_gate(map_rows, border_x)
	local first_open_row
	local last_open_row
	for y = 1, #map_rows do
		local ch = map_rows[y]:sub(border_x, border_x)
		if ch ~= '#' then
			if first_open_row == nil then
				first_open_row = y
			end
			last_open_row = y
		end
	end
	if first_open_row == nil then
		first_open_row = 1
		last_open_row = 1
	end
	return {
		y_min = constants.room.tile_origin_y + ((first_open_row - 1) * constants.room.tile_size),
		y_max = constants.room.tile_origin_y + (last_open_row * constants.room.tile_size) - 1,
	}
end

local function build_edge_gates(map_rows, links)
	local edge_gates = {}
	local row_width = #map_rows[1]

	if links.left > 0 then
		edge_gates.left = build_edge_gate(map_rows, 1)
	end

	if links.right > 0 then
		edge_gates.right = build_edge_gate(map_rows, row_width)
	end

	return edge_gates
end

local function can_spawn_at(map_rows, tx, ty)
	local row0 = map_rows[ty]
	local row1 = map_rows[ty + 1]
	local row2 = map_rows[ty + 2]

	if row0:sub(tx, tx) == '#' or row0:sub(tx + 1, tx + 1) == '#' then
		return false
	end
	if row1:sub(tx, tx) == '#' or row1:sub(tx + 1, tx + 1) == '#' then
		return false
	end

	local support_left = row2:sub(tx, tx) == '#'
	local support_right = row2:sub(tx + 1, tx + 1) == '#'
	if not support_left and not support_right then
		return false
	end

	return true
end

local function build_spawn(map_rows)
	local row_count = #map_rows
	local col_count = #map_rows[1]

	for ty = row_count - 2, 1, -1 do
		for tx = 1, col_count - 1 do
			if can_spawn_at(map_rows, tx, ty) then
				return {
					x = (tx - 1) * constants.room.tile_size,
					y = constants.room.tile_origin_y + ((ty - 1) * constants.room.tile_size),
				}
			end
		end
	end

	error('pietious castle_map failed to find spawn tile')
end

local function copy_conditions(object_def)
	local source_conditions = object_def.condition
	if source_conditions == nil then
		return {}
	end
	local conditions = {}
	for i = 1, #source_conditions do
		conditions[i] = source_conditions[i]
	end
	return conditions
end

local function split_text_lines(text)
	local lines = {}
	for line in text:gmatch('[^\r\n]+') do
		lines[#lines + 1] = line
	end
	return lines
end

local function build_enemies(room_number, object_defs)
	local enemies = {}
	local enemy_index = 0
	local supported_kinds = {
		mijterfoe = true,
		crossfoe = true,
		zakfoe = true,
		boekfoe = true,
		muziekfoe = true,
		stafffoe = true,
		cloud = true,
		marspeinenaardappel = true,
		vlokspawner = true,
	}

	for i = 1, #object_defs do
		local object_def = object_defs[i]
		local kind = object_def.type
		if supported_kinds[kind] == true then
			enemy_index = enemy_index + 1
			local enemy_x = tile_x_to_world(object_def.x or 0)
			local enemy_y = tile_y_to_world(object_def.y or 0)
			if kind == 'stafffoe' then
				enemy_y = enemy_y + 2
			end
			enemies[#enemies + 1] = {
				id = string.format('enemy_%03d_%02d', room_number, enemy_index),
				kind = kind,
				x = enemy_x,
				y = enemy_y,
				direction = object_def.direction,
				damage = constants.damage.enemy_contact_damage,
				health = object_def.health,
				speedx = object_def.speedx,
				speedy = object_def.speedy,
				trigger = object_def.trigger,
				conditions = copy_conditions(object_def),
			}
		end
	end

	return enemies
end

local function build_rocks(room_number, object_defs)
	local rocks = {}
	local rock_index = 0

	for i = 1, #object_defs do
		local object_def = object_defs[i]
		if object_def.type == 'rock' then
			rock_index = rock_index + 1
			rocks[#rocks + 1] = {
				id = string.format('rock_%03d_%02d', room_number, rock_index),
				x = tile_x_to_world(object_def.x),
				y = tile_y_to_world(object_def.y),
				item_type = object_def.item,
				conditions = copy_conditions(object_def),
			}
		end
	end

	return rocks
end

local function build_items(room_number, object_defs)
	local items = {}
	local item_index = 0

	for i = 1, #object_defs do
		local object_def = object_defs[i]
		if object_def.type == 'item' then
			item_index = item_index + 1
			items[#items + 1] = {
				id = string.format('item_%03d_%02d', room_number, item_index),
				x = tile_x_to_world(object_def.x),
				y = tile_y_to_world(object_def.y),
				item_type = object_def.itemtype,
				conditions = copy_conditions(object_def),
			}
		end
	end

	return items
end

local function build_lithographs(room_number, object_defs)
	local lithographs = {}
	local lithograph_index = 0

	for i = 1, #object_defs do
		local object_def = object_defs[i]
		if object_def.type == 'lithograph' then
			lithograph_index = lithograph_index + 1
			lithographs[#lithographs + 1] = {
				id = string.format('lithograph_%03d_%02d', room_number, lithograph_index),
				x = tile_x_to_world(object_def.x),
				y = tile_y_to_world(object_def.y),
				text = object_def.text or '',
			}
		end
	end

	return lithographs
end

local function build_shrines(room_number, object_defs)
	local shrines = {}
	local shrine_index = 0

	for i = 1, #object_defs do
		local object_def = object_defs[i]
		if object_def.type == 'shrine' then
			shrine_index = shrine_index + 1
			shrines[#shrines + 1] = {
				id = string.format('shrine_%03d_%02d', room_number, shrine_index),
				x = tile_x_to_world(object_def.x),
				y = tile_y_to_world(object_def.y),
				text_lines = split_text_lines(object_def.text),
			}
		end
	end

	return shrines
end

local function build_world_entrances(room_number, object_defs)
	local world_entrances = {}
	local entrance_index = 0

	for i = 1, #object_defs do
		local object_def = object_defs[i]
		if object_def.type == 'worldentrance' then
			entrance_index = entrance_index + 1
			local x = tile_x_to_world(object_def.x)
			local y = tile_y_to_world(object_def.y)
			world_entrances[#world_entrances + 1] = {
				id = string.format('world_entrance_%03d_%02d', room_number, entrance_index),
				x = x,
				y = y,
				target = object_def.target,
				stair_x = x + constants.world_entrance.trigger_x_offset,
				stair_y = y + constants.world_entrance.trigger_y_offset,
			}
		end
	end

	return world_entrances
end

local function load_room_templates()
	local data = assets.data[romdir.token('castle_map')]
	local room_numbers = sort_room_numbers(data)
	local templates = {}

	for i = 1, #room_numbers do
		local room_number = room_numbers[i]
		local room_def = data[tostring(room_number)]
		local world_number
		if room_def.type == 'world' then
			world_number = room_def.worldnumber
		end
		local links = build_links(room_def.exits)
		local map_rows = room_def.map
		local object_defs = room_def.objects or {}
		templates[room_number] = {
			room_number = room_number,
			space_id = room_def.type,
			world_number = world_number or 0,
			room_subtype = room_def.subtype,
			map_rows = map_rows,
			spawn = build_spawn(map_rows),
			links = links,
			edge_gates = build_edge_gates(map_rows, links),
			enemies = build_enemies(room_number, object_defs),
			rocks = build_rocks(room_number, object_defs),
			items = build_items(room_number, object_defs),
			lithographs = build_lithographs(room_number, object_defs),
			shrines = build_shrines(room_number, object_defs),
			world_entrances = build_world_entrances(room_number, object_defs),
		}
	end

	return templates
end

local function attach_world_transition_metadata(room_templates)
	for _, template in pairs(room_templates) do
		local world_entrances = template.world_entrances
		for i = 1, #world_entrances do
			local world_entrance = world_entrances[i]
			local spec = world_transition_specs[world_entrance.target]
			spec.castle_room_number = template.room_number
			spec.castle_spawn_x = world_entrance.stair_x
			spec.castle_spawn_y = world_entrance.stair_y
		end
	end
end

local function copy_world_transition(spec)
	local copied = {}
	for key, value in pairs(spec) do
		copied[key] = value
	end
	return copied
end

local room_templates = load_room_templates()
attach_world_transition_metadata(room_templates)
local elevator_routes = build_elevator_routes()

local world_transition_by_number = {}

for _, spec in pairs(world_transition_specs) do
	world_transition_by_number[spec.world_number] = spec
end

function castle_map.world_transition(target)
	local spec = world_transition_specs[target]
	return copy_world_transition(spec)
end

function castle_map.world_transition_from_world_number(world_number)
	local spec = world_transition_by_number[world_number]
	return copy_world_transition(spec)
end

castle_map.start_room_number = start_room_number
castle_map.room_templates = room_templates
castle_map.elevator_routes = elevator_routes
castle_map.map_world_proxies = map_world_proxies

return castle_map
