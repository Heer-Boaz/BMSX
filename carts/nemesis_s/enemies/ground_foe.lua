local world<const> = require('cartlib/world/world')
local enemy<const> = require('enemies/enemy')
local foe<const> = require('enemies/foe')
require('constants')

local ground_foe<const> = {}
ground_foe.__index = ground_foe
setmetatable(ground_foe, { __index = foe })

function ground_foe:receive_player_projectile(projectile)
	local previous_health<const> = self.health
	local consumed<const> = enemy.receive_player_projectile(self, projectile)
	if self.health > 0 and self.health < previous_health then
		self.events:emit('enemy.structure.hit')
	end
	return consumed
end

function ground_foe:on_destroyed(projectile)
	world:spawn(ids_large_explosion_def, {
		stage = self.stage,
		drop_definition_id = self.drop_definition_id,
		pos = { x = self.x, y = self.y },
	})
	self.events:emit('enemy.structure.destroyed')
	enemy.on_destroyed(self, projectile)
end

return ground_foe
