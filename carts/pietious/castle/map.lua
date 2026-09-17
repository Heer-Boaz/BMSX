require('constants')
local scene_library<const> = require('cartlib/world/scene_library')
local bin<const> = require('cartlib/bin')
local assets<const> = require('bmsx/assets')
local shallow_copy<const> = require('cartlib/util/shallow_copy')

local castle_map<const> = {}
local room_scenes<const> = {
	[1] = require('scenes/rooms/room_001'),
	[2] = require('scenes/rooms/room_002'),
	[3] = require('scenes/rooms/room_003'),
	[4] = require('scenes/rooms/room_004'),
	[5] = require('scenes/rooms/room_005'),
	[6] = require('scenes/rooms/room_006'),
	[7] = require('scenes/rooms/room_007'),
	[8] = require('scenes/rooms/room_008'),
	[9] = require('scenes/rooms/room_009'),
	[10] = require('scenes/rooms/room_010'),
	[11] = require('scenes/rooms/room_011'),
	[12] = require('scenes/rooms/room_012'),
	[13] = require('scenes/rooms/room_013'),
	[100] = require('scenes/rooms/room_100'),
	[101] = require('scenes/rooms/room_101'),
	[102] = require('scenes/rooms/room_102'),
	[103] = require('scenes/rooms/room_103'),
	[104] = require('scenes/rooms/room_104'),
	[105] = require('scenes/rooms/room_105'),
	[106] = require('scenes/rooms/room_106'),
	[107] = require('scenes/rooms/room_107'),
	[108] = require('scenes/rooms/room_108'),
	[109] = require('scenes/rooms/room_109'),
	[110] = require('scenes/rooms/room_110'),
}

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
		world_spawn_x = 28 * room_tile_size,
		world_spawn_y = room_tile_origin_y + (15 * room_tile_size),
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

local tile_x_to_world<const> = function(tile_x)
	return tile_x * room_tile_size
end

local tile_y_to_world<const> = function(tile_y)
	return room_tile_origin_y + (tile_y * room_tile_size)
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
		y_min = room_tile_origin_y + ((first_open_row - 1) * room_tile_size),
		y_max = room_tile_origin_y + (last_open_row * room_tile_size) - 1,
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
					x = (tx - 1) * room_tile_size,
					y = room_tile_origin_y + ((ty - 1) * room_tile_size),
				}
			end
		end
	end

	error('pietious castle_map failed to find spawn tile')
end

-- These are cold indices into scene members, not copied placement records.
local categories<const> = {
	rock = 'rocks', world_item = 'items', lithograph = 'lithographs',
	room_shrine = 'shrines', world_entrance = 'world_entrances', draaideur = 'draaideuren',
}
local conditional_categories<const> = { enemies = true, items = true }
local index_members<const> = function(template, objects)
	for i = 1, #objects do
		local member<const> = objects[i]
		local definition_id<const> = member.definition_id
		local category = categories[definition_id]
		if definition_id:sub(1, 6) == 'enemy.' then category = 'enemies' end
		if category ~= nil then
			local entries<const> = template[category]
			entries[#entries + 1] = member
		elseif definition_id == 'seal' then
			template.seal = member
		end
		if member.blocks_room_collision then
			template.wall_enemies[#template.wall_enemies + 1] = member
		end
		if definition_id == 'rock' and member.options.item_type ~= nil
		and world_item_inventory[member.options.item_type] then
			template.inventory_rocks[#template.inventory_rocks + 1] = member
		end
		local conditions<const> = member.conditions
		if category ~= nil and conditional_categories[category] then
			for j = 1, #conditions do
				local condition<const> = conditions[j].key
				local dependency = template.condition_dependencies[condition]
				if dependency == nil then
					dependency = { enemies = {}, items = {}, affects_walls = false }
					template.condition_dependencies[condition] = dependency
				end
				if member.blocks_room_collision then dependency.affects_walls = true end
				if condition ~= member.destroyed_condition then
					local dependents<const> = dependency[category]
					dependents[#dependents + 1] = member
				end
			end
		end
	end
end

local load_room_templates<const> = function()
	local data<const> = bin.decode(assets.data_castle_map_addr, 'castle_map')
	local templates<const> = {}
	local condition_reveal_events<const> = {}

	for raw_room_number, room_def in pairs(data) do
		local room_number<const> = tonumber(raw_room_number)
		local room_links<const> = build_links(room_number, room_def.exits)
		local map_rows<const> = room_def.map
		local room_scene<const> = room_scenes[room_number]
		room_scene.register()
		local room_condition_reveal_events<const> = room_def.condition_reveal_events
		if room_condition_reveal_events ~= nil then
			for condition, event_name in pairs(room_condition_reveal_events) do
				condition_reveal_events[condition] = event_name
			end
		end
		local template<const> = {
			room_number = room_number,
			world_number = room_def.worldnumber or 0, -- Castle rooms belong to region 0.
			room_subtype = room_def.subtype,
			water = build_water_spec(room_number, room_def.water),
			map_rows = map_rows,
			spawn = build_spawn(map_rows),
			room_links = room_links,
			edge_gates = build_edge_gates(map_rows, room_links),
			scene_id = room_scene.id,
			scene_definition = scene_library.definition(room_scene.id),
			enemies = {}, condition_dependencies = {}, wall_enemies = {},
			rocks = {}, inventory_rocks = {}, items = {}, lithographs = {},
			shrines = {}, world_entrances = {}, draaideuren = {},
		}
		index_members(template, template.scene_definition.objects)
		templates[room_number] = template
	end

	return templates, condition_reveal_events
end

local attach_world_transition_metadata<const> = function(room_templates, transitions)
	for _, template in pairs(room_templates) do
		local world_entrances<const> = template.world_entrances
		for i = 1, #world_entrances do
			local world_entrance<const> = world_entrances[i]
			local spec<const> = transitions[world_entrance.options.target]
			spec.castle_room_number = template.room_number
			spec.castle_spawn_x = world_entrance.options.pos.x + world_entrance_trigger_x_offset
			spec.castle_spawn_y = world_entrance.options.pos.y + world_entrance_trigger_y_offset
		end
	end
end

castle_map.start_room_number = start_room_number
function castle_map.initialize()
	local rooms<const>, condition_reveal_events<const> = load_room_templates()
	local transitions<const> = {}
	local transitions_by_number<const> = {}
	for target, authored in pairs(world_transition_specs) do
		local spec<const> = shallow_copy(authored)
		transitions[target] = spec
		transitions_by_number[spec.world_number] = spec
	end
	attach_world_transition_metadata(rooms, transitions)
	castle_map.definition = {
		rooms = rooms, condition_reveal_events = condition_reveal_events,
		world_transitions = transitions, world_transitions_by_number = transitions_by_number,
	}
end
castle_map.elevator_routes = build_elevator_routes()

return castle_map
