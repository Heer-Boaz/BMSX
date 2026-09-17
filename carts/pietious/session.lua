-- Game progress survives room/actor teardown. This model contains no World
-- objects, render components or event subscriptions. New Game replaces it.
local progression<const> = require('cartlib/progression')
require('constants')

local session<const> = {}
session.__index = session

function session.new(program, spawn, templates)
	local rooms<const> = {}
	local entrances<const> = {}
	for _, template in pairs(templates) do
		rooms[template.scene_id] = { destroyed_rocks = {} }
		for _, entrance in ipairs(template.world_entrances) do
			entrances[entrance.options.target] = { state = 'closed' }
		end
	end
	return setmetatable({
		progression = progression.new_state(program),
		player = {
			inventory_items = {},
			health = damage_max_health,
			max_health = damage_max_health,
			weapon_level = 0,
			spawn_x = spawn.x,
			spawn_y = spawn.y,
		},
		rooms = rooms,
		region_drops = {},
		world_entrances = entrances,
		world_boss_defeated = {},
	}, session)
end

-- Consumable rock drops last for a region visit; collected inventory and
-- destroyed rocks last for the whole game. Room replacement resets neither.
function session:clear_region_drops()
	self.region_drops = {}
end

return session
