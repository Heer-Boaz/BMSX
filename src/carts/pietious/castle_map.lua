local constants = require('constants.lua')
local romdir = require('romdir')

local castle_map = {}

local castle_map_asset_id = 'castle_map'
local tile_size = constants.room.tile_size
local tile_origin_y = constants.room.tile_origin_y
local start_room_number = 3

local function tile_x_to_world(tile_x)
	return tile_x * tile_size
end

local function tile_y_to_world(tile_y)
	return tile_origin_y + (tile_y * tile_size)
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
	local first_open_row = -1
	local last_open_row = -1
	for y = 1, #map_rows do
		local ch = map_rows[y]:sub(border_x, border_x)
		if ch ~= '#' then
			if first_open_row < 0 then
				first_open_row = y
			end
			last_open_row = y
		end
	end
	return {
		y_min = tile_origin_y + ((first_open_row - 1) * tile_size),
		y_max = tile_origin_y + (last_open_row * tile_size) - 1,
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
					x = (tx - 1) * tile_size,
					y = tile_origin_y + ((ty - 1) * tile_size),
				}
			end
		end
	end

	error('pietious castle_map failed to find spawn tile')
end

local function build_enemies(room_number, object_defs)
	local enemies = {}
	local enemy_index = 0

	for i = 1, #object_defs do
		local object_def = object_defs[i]
		local kind = object_def.type
		if kind == 'mijterfoe' or kind == 'crossfoe' or kind == 'zakfoe' then
			enemy_index = enemy_index + 1
			enemies[#enemies + 1] = {
				id = string.format('enemy_%03d_%02d', room_number, enemy_index),
				kind = kind,
				x = tile_x_to_world(object_def.x),
				y = tile_y_to_world(object_def.y),
				direction = object_def.direction,
				damage = constants.damage.enemy_contact_damage,
				health = object_def.health,
			}
		end
	end

	return enemies
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
				source_kind = 'map',
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

local function room_id_from_number(room_number, room_type)
	return string.format('%s_room_%03d', room_type, room_number)
end

local function load_room_templates()
	local data = assets.data[romdir.token(castle_map_asset_id)]
	local room_numbers = sort_room_numbers(data)
	local templates = {}

	for i = 1, #room_numbers do
		local room_number = room_numbers[i]
		local room_def = data[tostring(room_number)]
		local world_number = 0
		if room_def.type == constants.spaces.world then
			if room_def.worldnumber == nil then
				error('pietious castle_map missing worldnumber for world room=' .. tostring(room_number))
			end
			world_number = room_def.worldnumber
		end
		local links = build_links(room_def.exits)
		local map_rows = room_def.map
		local object_defs = room_def.objects or {}
		templates[room_number] = {
			room_number = room_number,
			room_id = room_id_from_number(room_number, room_def.type),
			space_id = room_def.type,
			world_number = world_number,
			room_subtype = room_def.subtype,
			map_rows = map_rows,
			spawn = build_spawn(map_rows),
			links = links,
			edge_gates = build_edge_gates(map_rows, links),
			enemies = build_enemies(room_number, object_defs),
			rocks = build_rocks(room_number, object_defs),
			items = build_items(room_number, object_defs),
			lithographs = build_lithographs(room_number, object_defs),
		}
	end

	return templates
end

local room_templates = load_room_templates()
local room_number_by_id = {}

for room_number, template in pairs(room_templates) do
	room_number_by_id[template.room_id] = room_number
end

function castle_map.room_number_from_id(room_id)
	return room_number_by_id[room_id]
end

function castle_map.room_template(room_number)
	return room_templates[room_number]
end

castle_map.start_room_number = start_room_number

return castle_map
