local constants<const> = require('constants')
local text<const> = require('bios/text/index')

local castle_map<const> = {}
local empty_conditions<const> = {}

-- local start_room_number = 100
-- local start_room_number = 8
local start_room_number<const> = 1

local world_transition_specs<const> = {
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
		castle_spawn_x = 19,
		castle_spawn_y = 8,
		castle_room_number = 0,
		castle_spawn_facing = 1,
	},
}

castle_map.map_world_proxies = {
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

local frontworld_blue_tiletypes<const> = {
	frontworld_blue_l = true,
	frontworld_blue_r = true,
}

local supported_enemy_kinds<const> = {
	mijterfoe = true,
	crossfoe = true,
	zakfoe = true,
	boekfoe = true,
	muziekfoe = true,
	stafffoe = true,
	cloud = true,
	marspeinenaardappel = true,
	vlokspawner = true,
	breakablewall = true,
	disappearingwall = true,
}

local wall_enemy_kinds<const> = {
	breakablewall = true,
	disappearingwall = true,
}

local draaideur_kind_by_type<const> = {
	draaideur_blauw = 1,
	draaideur_rood = 2, -- unused right now
}

local tile_x_to_world<const> = function(tile_x)
	return tile_x * constants.room.tile_size
end

local tile_y_to_world<const> = function(tile_y)
	return constants.room.tile_origin_y + (tile_y * constants.room.tile_size)
end

local elevator_route_specs<const> = {
	{
		points = {
			{ room_number = 13, tile_x = 14, tile_y = 5 },
			{ room_number = 6, tile_x = 14, tile_y = 8 },
		},
		vertical_to_point = { 'up', 'down' },
		going_to = 2,
	},
}

local build_elevator_routes<const> = function()
	local routes<const> = {}
	for i = 1, #elevator_route_specs do
		local spec<const> = elevator_route_specs[i]
		local point1<const> = spec.points[1]
		local point2<const> = spec.points[2]
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

local build_links<const> = function(room_number, exits)
	local up<const>, right<const>, down<const>, left<const> = tonumber(exits[1]), tonumber(exits[2]), tonumber(exits[3]), tonumber(exits[4])
	assert(up and right and down and left, 'pietious castle_map room ' .. tostring(room_number) .. ' has non-numeric exits')
	return { up = up, right = right, down = down, left = left, }
end

local build_water_spec<const> = function(room_number, water_def)
	if water_def == nil then
		return nil
	end
	local surface_row<const> = tonumber(water_def.surface_row)
	assert(surface_row ~= nil, 'pietious castle_map room ' .. tostring(room_number) .. ' has invalid water.surface_row')
	return {
		surface_row = surface_row,
	}
end

local build_edge_gate<const> = function(map_rows, border_x)
	local first_open_row
	local last_open_row
	for y = 1, #map_rows do
		local ch<const> = map_rows[y]:sub(border_x, border_x)
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

local build_edge_gates<const> = function(map_rows, room_links)
	local edge_gates<const> = {}
	local row_width<const> = #map_rows[1]

	if room_links.left > 0 then
		edge_gates.left = build_edge_gate(map_rows, 1)
	end

	if room_links.right > 0 then
		edge_gates.right = build_edge_gate(map_rows, row_width)
	end

	return edge_gates
end

local can_spawn_at<const> = function(map_rows, tx, ty)
	local row0<const> = map_rows[ty]
	local row1<const> = map_rows[ty + 1]
	local row2<const> = map_rows[ty + 2]

	if row0:sub(tx, tx) == '#' or row0:sub(tx + 1, tx + 1) == '#' then
		return false
	end
	if row1:sub(tx, tx) == '#' or row1:sub(tx + 1, tx + 1) == '#' then
		return false
	end

	local support_left<const> = row2:sub(tx, tx) == '#'
	local support_right<const> = row2:sub(tx + 1, tx + 1) == '#'
	if not support_left and not support_right then
		return false
	end

	return true
end

local build_spawn<const> = function(map_rows)
	local row_count<const> = #map_rows
	local col_count<const> = #map_rows[1]

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

local resolve_wall_tiletype<const> = function(room_subtype, tiletype)
	if frontworld_blue_tiletypes[tiletype] then
		if room_subtype == 'castlegold' then
			return 'castle_front_gold_1'
		end
		if room_subtype == 'world' then
			return 'frontworld_l'
		end
		return 'castle_front_blue_1'
	end
	return tiletype
end

local build_enemies<const> = function(room_number, room_subtype, object_defs)
	local enemies<const> = {}
	local enemy_index = 0

	for i = 1, #object_defs do
		local object_def<const> = object_defs[i]
		local kind<const> = object_def.type
		if supported_enemy_kinds[kind] then
			enemy_index = enemy_index + 1
			local enemy_id<const> = string.format('enemy_%03d_%02d', room_number, enemy_index)
			local raw_conditions<const> = object_def.condition or empty_conditions
			local conditions<const> = {
				{
					key = enemy_id,
					equals = false,
				},
			}
			for j = 1, #raw_conditions do
				conditions[#conditions + 1] = raw_conditions[j]
			end
			if wall_enemy_kinds[kind] then
				local area<const> = object_def.area
				local left<const> = area[1]
				local top<const> = area[2]
				local right<const> = area[3]
				local bottom<const> = area[4]
				enemies[#enemies + 1] = {
					id = enemy_id,
					kind = kind,
					x = tile_x_to_world(left),
					y = tile_y_to_world(top),
					direction = nil,
					damage = 0,
					health = object_def.hp,
					speedx = nil,
					speedy = nil,
					trigger = object_def.trigger,
					conditions = conditions,
					width_tiles = right - left,
					height_tiles = bottom - top,
					tiletype = resolve_wall_tiletype(room_subtype, object_def.tiletype),
				}
			else
				local enemy_x<const> = tile_x_to_world(object_def.x or 0)
				local enemy_y = tile_y_to_world(object_def.y or 0)
				if kind == 'stafffoe' then
					enemy_y = enemy_y + 2
				end
				enemies[#enemies + 1] = {
					id = enemy_id,
					kind = kind,
					x = enemy_x,
					y = enemy_y,
					direction = object_def.direction,
					damage = constants.damage.enemy_contact_damage,
					health = object_def.health,
					speedx = object_def.speedx,
					speedy = object_def.speedy,
					trigger = object_def.trigger,
					conditions = conditions,
				}
			end
		end
	end

	return enemies
end

local build_rocks<const> = function(room_number, object_defs)
	local rocks<const> = {}
	local inventory_rocks<const> = {}
	local rock_index = 0

	for i = 1, #object_defs do
		local object_def<const> = object_defs[i]
		if object_def.type == 'rock' then
			local item_type<const> = object_def.item
			rock_index = rock_index + 1
			local rock<const> = {
				id = string.format('rock_%03d_%02d', room_number, rock_index),
				x = tile_x_to_world(object_def.x),
				y = tile_y_to_world(object_def.y),
				item_type = item_type,
				conditions = object_def.condition or empty_conditions,
			}
			rocks[#rocks + 1] = rock
			if item_type ~= nil and constants.world_item.inventory[item_type] then
				inventory_rocks[#inventory_rocks + 1] = rock
			end
		end
	end

	return rocks, inventory_rocks
end

local build_items<const> = function(room_number, object_defs)
	local items<const> = {}
	local item_index = 0

	for i = 1, #object_defs do
		local object_def<const> = object_defs[i]
		if object_def.type == 'item' then
			item_index = item_index + 1
			items[#items + 1] = {
				id = string.format('item_%03d_%02d', room_number, item_index),
				x = tile_x_to_world(object_def.x),
				y = tile_y_to_world(object_def.y),
				item_type = object_def.itemtype,
				conditions = object_def.condition or empty_conditions,
			}
		end
	end

	return items
end

local build_lithographs<const> = function(room_number, object_defs)
	local lithographs<const> = {}
	local lithograph_index = 0

	for i = 1, #object_defs do
		local object_def<const> = object_defs[i]
		if object_def.type == 'lithograph' then
			lithograph_index = lithograph_index + 1
			lithographs[#lithographs + 1] = {
				id = string.format('lithograph_%03d_%02d', room_number, lithograph_index),
				x = tile_x_to_world(object_def.x),
				y = tile_y_to_world(object_def.y),
				text = object_def.text,
			}
		end
	end

	return lithographs
end

local build_shrines<const> = function(room_number, object_defs)
	local shrines<const> = {}
	local shrine_index = 0

	for i = 1, #object_defs do
		local object_def<const> = object_defs[i]
		if object_def.type == 'shrine' then
			shrine_index = shrine_index + 1
			shrines[#shrines + 1] = {
				id = string.format('shrine_%03d_%02d', room_number, shrine_index),
				x = tile_x_to_world(object_def.x),
				y = tile_y_to_world(object_def.y),
				text_lines = text.split_lines(object_def.text),
			}
		end
	end

	return shrines
end

local build_seal<const> = function(room_number, object_defs)
	for i = 1, #object_defs do
		local object_def<const> = object_defs[i]
		if object_def.type == 'seal' then
			return {
				id = string.format('seal_%03d_01', room_number),
				x = tile_x_to_world(object_def.x),
				y = tile_y_to_world(object_def.y),
				text = object_def.text,
				conditions = object_def.condition or empty_conditions,
			}
		end
	end
	return nil
end

local build_world_entrances<const> = function(room_number, object_defs)
	local world_entrances<const> = {}
	local entrance_index = 0

	for i = 1, #object_defs do
		local object_def<const> = object_defs[i]
		if object_def.type == 'worldentrance' then
			entrance_index = entrance_index + 1
			local x<const> = tile_x_to_world(object_def.x)
			local y<const> = tile_y_to_world(object_def.y)
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

local build_draaideuren<const> = function(room_number, object_defs)
	local draaideuren<const> = {}
	local door_index = 0

	for i = 1, #object_defs do
		local object_def<const> = object_defs[i]
		local object_type<const> = object_def.type
		local kind<const> = draaideur_kind_by_type[object_type]
		if kind ~= nil then
			door_index = door_index + 1
			draaideuren[#draaideuren + 1] = {
				id = string.format('draaideur_%03d_%02d', room_number, door_index),
				x = tile_x_to_world(object_def.x),
				y = tile_y_to_world(object_def.y),
				kind = kind,
			}
		end
	end

	return draaideuren
end

local load_room_templates<const> = function()
	local data<const> = sys_rom_data['castle_map']
	local templates<const> = {}

	for raw_room_number, room_def in pairs(data) do
		if type(room_def) == 'table' and room_def.map ~= nil then
			local room_number<const> = tonumber(raw_room_number)
				local room_links<const> = build_links(room_number, room_def.exits)
				local map_rows<const> = room_def.map
				local object_defs<const> = room_def.objects or {}
				local rocks<const>, inventory_rocks<const> = build_rocks(room_number, object_defs)
				templates[room_number] = {
						room_number = room_number,
					world_number = room_def.worldnumber or 0, -- Normalized to prevent bugs like indexing with string world numbers for events/progression
				room_subtype = room_def.subtype,
			custom = room_def.custom,
			water = build_water_spec(room_number, room_def.water),
			map_rows = map_rows,
			spawn = build_spawn(map_rows),
			room_links = room_links,
				edge_gates = build_edge_gates(map_rows, room_links),
				enemies = build_enemies(room_number, room_def.subtype, object_defs),
				rocks = rocks,
				inventory_rocks = inventory_rocks,
				items = build_items(room_number, object_defs),
			lithographs = build_lithographs(room_number, object_defs),
			shrines = build_shrines(room_number, object_defs),
				seal = build_seal(room_number, object_defs),
				world_entrances = build_world_entrances(room_number, object_defs),
				draaideuren = build_draaideuren(room_number, object_defs),
			}
		end
	end

	return templates
end

local attach_world_transition_metadata<const> = function(room_templates)
	for _, template in pairs(room_templates) do
		local world_entrances<const> = template.world_entrances
		for i = 1, #world_entrances do
			local world_entrance<const> = world_entrances[i]
			local spec<const> = world_transition_specs[world_entrance.target]
			spec.castle_room_number = template.room_number
			spec.castle_spawn_x = world_entrance.stair_x
			spec.castle_spawn_y = world_entrance.stair_y
		end
	end
end

castle_map.start_room_number = start_room_number
castle_map.room_templates = load_room_templates()
attach_world_transition_metadata(castle_map.room_templates)
castle_map.elevator_routes = build_elevator_routes()
castle_map.world_transitions = world_transition_specs
castle_map.world_transitions_by_number = {}

for _, spec in pairs(world_transition_specs) do
	castle_map.world_transitions_by_number[spec.world_number] = spec
end

return castle_map
