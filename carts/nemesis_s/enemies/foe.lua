local enemy<const> = require('enemies/enemy')
require('constants')

local foe<const> = {}
foe.__index = foe
foe.destroyed_event = 'enemy.small.destroyed'
setmetatable(foe, { __index = enemy })

function foe:on_destroyed(projectile)
	local pose_x<const>, pose_y<const> = self:get_global_position()
	self.scene:spawn(ids_small_explosion_def, {
		position = { x = pose_x, y = pose_y },
		stage = self.stage,
		drop_definition_id = self.drop_definition_id,
	})
	self.events:emit(self.destroyed_event)
	enemy.on_destroyed(self, projectile)
end

return foe
