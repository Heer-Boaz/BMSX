local enemy<const> = require('enemies/enemy')
require('constants')

local foe<const> = {}
foe.__index = foe
foe.destroyed_event = 'enemy.small.destroyed'
setmetatable(foe, { __index = enemy })

function foe:on_destroyed(projectile)
	local pose<const> = self.spatial
	self.scene:spawn(ids_small_explosion_def, {
		stage = self.stage,
		drop_definition_id = self.drop_definition_id,
	}, { local_transform = { 1, 0, 0, 1, pose.ox, pose.oy } })
	self.events:emit(self.destroyed_event)
	enemy.on_destroyed(self, projectile)
end

return foe
