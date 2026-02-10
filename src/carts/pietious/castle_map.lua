local constants = require('constants.lua')
local romdir = require('romdir')

local castle_map = {}

local castle_map_asset_id = 'pietious_castle_map'

local tile_size = constants.room.tile_size
local tile_origin_y = constants.room.tile_origin_y

local function tile_x_to_world(tile_x)
	return tile_x * tile_size
end

local function tile_y_to_world(tile_y)
	return tile_origin_y + (tile_y * tile_size)
end

local function enemy_def(id, kind, tile_x, tile_y, direction, health)
	return {
		id = id,
		kind = kind,
		x = tile_x_to_world(tile_x),
		y = tile_y_to_world(tile_y),
		w = 16,
		h = kind == 'crossfoe' and 24 or 16,
		direction = direction,
		damage_key = 'enemy_contact_damage',
		health = health,
	}
end

local xna_castle_enemy_defs = {
	[2] = {
		enemy_def('meijter_02_a', 'mijter', 14, 3, 'down'),
		enemy_def('meijter_02_b', 'mijter', 20, 3, 'down'),
		enemy_def('meijter_02_c', 'mijter', 16, 17, 'up'),
	},
	[3] = {
		enemy_def('meijter_03_a', 'mijter', 18, 13, 'down'),
		enemy_def('meijter_03_b', 'mijter', 27, 4, 'down'),
	},
	[4] = {
		enemy_def('meijter_04_a', 'mijter', 6, 2, 'right'),
		enemy_def('meijter_04_b', 'mijter', 19, 8, 'down'),
	},
	[6] = {
		enemy_def('crossfoe_06_a', 'crossfoe', 3, 9, 'down', 3),
		enemy_def('crossfoe_06_b', 'crossfoe', 27, 9, 'down', 3),
	},
	[7] = {
		enemy_def('crossfoe_07_a', 'crossfoe', 5, 5, 'down', 3),
		enemy_def('crossfoe_07_b', 'crossfoe', 5, 9, 'down', 3),
		enemy_def('crossfoe_07_c', 'crossfoe', 26, 9, 'down', 3),
	},
	[8] = {
		enemy_def('crossfoe_08_a', 'crossfoe', 5, 16, 'down', 3),
		enemy_def('meijter_08_a', 'mijter', 3, 5, 'down'),
		enemy_def('meijter_08_b', 'mijter', 8, 1, 'right'),
		enemy_def('meijter_08_c', 'mijter', 15, 12, 'down'),
	},
	[10] = {
		enemy_def('crossfoe_10_a', 'crossfoe', 11, 0, 'down', 3),
	},
	[11] = {
		enemy_def('crossfoe_11_a', 'crossfoe', 11, 8, 'down', 3),
		enemy_def('crossfoe_11_b', 'crossfoe', 5, 12, 'down', 3),
		enemy_def('meijter_11_a', 'mijter', 3, 3, 'down'),
		enemy_def('meijter_11_b', 'mijter', 8, 16, 'down'),
	},
}

local function build_castle_links(world_grid)
	local room_positions = {}
	for y = 1, #world_grid do
		local row = world_grid[y]
		for x = 1, #row do
			local room_number = row[x]
			if room_number > 0 then
				room_positions[room_number] = { x = x, y = y }
			end
		end
	end

	local links_by_room = {}
	for room_number, pos in pairs(room_positions) do
		local left = 0
		local right = 0
		local up = 0
		local down = 0

		if pos.x > 1 then
			left = world_grid[pos.y][pos.x - 1]
		end
		if pos.x < #world_grid[pos.y] then
			right = world_grid[pos.y][pos.x + 1]
		end
		if pos.y > 1 and pos.x <= #world_grid[pos.y - 1] then
			up = world_grid[pos.y - 1][pos.x]
		end
		if pos.y < #world_grid and pos.x <= #world_grid[pos.y + 1] then
			down = world_grid[pos.y + 1][pos.x]
		end

		links_by_room[room_number] = {
			left = left,
			right = right,
			up = up,
			down = down,
		}
	end

	return links_by_room
end

local function load_castle_map_data()
	local token = romdir.token(castle_map_asset_id)
	local data = assets.data[token]
	if data == nil then
		error("pietious castle_map missing data asset '" .. castle_map_asset_id .. "'")
	end
	return data
end

local function normalize_room_templates(room_entries)
	local templates = {}
	for i = 1, #room_entries do
		local entry = room_entries[i]
		local source_enemy_defs = xna_castle_enemy_defs[entry.room_number] or entry.enemies
		local enemies = {}
		for j = 1, #source_enemy_defs do
			local enemy_entry = source_enemy_defs[j]
			local damage = enemy_entry.damage
			if enemy_entry.damage_key ~= nil then
				damage = constants.damage[enemy_entry.damage_key]
			end
			enemies[j] = {
				id = enemy_entry.id,
				x = enemy_entry.x,
				y = enemy_entry.y,
				w = enemy_entry.w,
				h = enemy_entry.h,
				facing = enemy_entry.facing,
				direction = enemy_entry.direction,
				health = enemy_entry.health,
				damage = damage,
				kind = enemy_entry.kind,
			}
		end

		local links = entry.links

		templates[entry.room_number] = {
			room_number = entry.room_number,
			room_id = entry.room_id,
			space_id = entry.space_id or constants.spaces.castle,
			room_subtype = string.lower(entry.room_subtype),
			map_rows = entry.map_rows,
			spawn = {
				x = entry.spawn.x,
				y = entry.spawn.y,
			},
			links = links,
			edge_gates = entry.edge_gates,
			enemies = enemies,
		}
	end
	return templates
end

local loaded_data = load_castle_map_data()
local room_templates = normalize_room_templates(loaded_data.rooms)
if loaded_data.world_grid ~= nil then
	local room_links = build_castle_links(loaded_data.world_grid)
	for room_number, links in pairs(room_links) do
		local template = room_templates[room_number]
		if template == nil then
			error('pietious castle_map missing room template for room_number=' .. tostring(room_number))
		end
		template.links = links
	end
end

for room_number, template in pairs(room_templates) do
	if template.links == nil then
		error('pietious castle_map missing links for room_number=' .. tostring(room_number))
	end
	if template.room_subtype == nil then
		error('pietious castle_map missing room_subtype for room_number=' .. tostring(room_number))
	end
end

local room_number_by_id = {}
for room_number, template in pairs(room_templates) do
	room_number_by_id[template.room_id] = room_number
end

function castle_map.room_number_from_id(room_id)
	local room_number = room_number_by_id[room_id]
	if room_number == nil then
		error('pietious castle_map unknown room_id=' .. tostring(room_id))
	end
	return room_number
end

function castle_map.room_template(room_number)
	local template = room_templates[room_number]
	if template == nil then
		error('pietious castle_map unknown room_number=' .. tostring(room_number))
	end
	return template
end

castle_map.start_room_number = loaded_data.start_room_number

return castle_map
