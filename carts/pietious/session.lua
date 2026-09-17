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

-- Explicit definition replacement. Stable authored keys retain progress;
-- removal forgets it and a renamed placement starts fresh. Player data and
-- defeated world bosses have their own identities and are not room records.
function session:rebind_rooms(templates)
	local rooms<const> = {}
	local entrances<const> = {}
	local drops<const> = {}
	for _, template in pairs(templates) do
		local previous<const> = self.rooms[template.scene_id]
		local destroyed<const> = {}
		for _, rock in ipairs(template.rocks) do
			if previous ~= nil then destroyed[rock.member_id] = previous.destroyed_rocks[rock.member_id] end
			local drop_id<const> = 'drop.' .. rock.member_id
			local drop<const> = self.region_drops[drop_id]
			if drop ~= nil and drop.scene_id == template.scene_id and drop.item_type == rock.options.item_type then
				drops[drop_id] = drop
			end
		end
		rooms[template.scene_id] = { destroyed_rocks = destroyed }
		for _, entrance in ipairs(template.world_entrances) do
			local target<const> = entrance.options.target
			entrances[target] = self.world_entrances[target] or { state = 'closed' }
		end
	end
	self.rooms = rooms
	self.world_entrances = entrances
	self.region_drops = drops
end

return session
