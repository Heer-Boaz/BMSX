local constants = require('constants.lua')

local castle_map = {}

-- Castle room #3 map from XNA RoomData (castle stone).
local room_map_castle_stone_3 = {
	'..............................##',
	'..............................##',
	'..............................##',
	'........######..........########',
	'........######....##............',
	'........######..................',
	'................................',
	'................................',
	'........................##......',
	'................................',
	'................................',
	'######..........................',
	'####-=............##............',
	'####-=..........................',
	'####-=..........................',
	'####-=..........................',
	'####-=..................##......',
	'####-=..........................',
	'####-=..........................',
	'################################',
}

-- Castle room #4 map from XNA RoomData (castle garden).
local room_map_castle_garden_4 = {
	'######....................-=..##',
	'######....................-=..##',
	'######....................-=..##',
	'######....................-=..##',
	'........................########',
	'..............................##',
	'..............................##',
	'...............######.........##',
	'.................pi...........##',
	'.................ll...........##',
	'.................ar...........##',
	'.............######...........##',
	'..............................##',
	'..............................##',
	'....................############',
	'....######..........-=##########',
	'......pi............-=##########',
	'......ll............-=##########',
	'......ar............-=##########',
	'################################',
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

-- Partial castle world-map for current pietious scope.
-- This keeps room connectivity data-driven instead of hardcoding per-room exits.
local castle_world_grid = {
	{ 4, 3 },
}

local room_templates = {
	[3] = {
		room_number = 3,
		room_id = 'castle_stone_03',
		map_rows = room_map_castle_stone_3,
		spawn = {
			x = constants.player.start_x,
			y = constants.player.start_y,
		},
		edge_gates = {},
		enemies = {
			{
				id = 'meijter_03',
				x = 160,
				y = 168,
				w = 16,
				h = 16,
				facing = 1,
				damage = constants.damage.enemy_contact_damage,
				kind = 'enemy',
			},
		},
	},
	[4] = {
		room_number = 4,
		room_id = 'castle_stone_04',
		map_rows = room_map_castle_garden_4,
		spawn = {
			x = constants.room.width - constants.player.width,
			y = constants.player.start_y,
		},
		edge_gates = {},
		enemies = {
			{
				id = 'meijter_04',
				x = 88,
				y = 168,
				w = 16,
				h = 16,
				facing = -1,
				damage = constants.damage.enemy_contact_damage,
				kind = 'enemy',
			},
		},
	},
}

local room_links = build_castle_links(castle_world_grid)
for room_number, links in pairs(room_links) do
	room_templates[room_number].links = links
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

castle_map.start_room_number = 3

return castle_map
