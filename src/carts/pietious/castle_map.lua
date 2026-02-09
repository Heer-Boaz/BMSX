local constants = require('constants.lua')
local romdir = require('romdir')

local castle_map = {}

local castle_map_asset_id = 'pietious_castle_map'

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
		local enemies = {}
		for j = 1, #entry.enemies do
			local enemy_def = entry.enemies[j]
			local damage = enemy_def.damage
			if enemy_def.damage_key ~= nil then
				damage = constants.damage[enemy_def.damage_key]
			end
			enemies[j] = {
				id = enemy_def.id,
				x = enemy_def.x,
				y = enemy_def.y,
				w = enemy_def.w,
				h = enemy_def.h,
				facing = enemy_def.facing,
				direction = enemy_def.direction,
				health = enemy_def.health,
				damage = damage,
				kind = enemy_def.kind,
			}
		end

		local links = entry.links

		templates[entry.room_number] = {
			room_number = entry.room_number,
			room_id = entry.room_id,
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
