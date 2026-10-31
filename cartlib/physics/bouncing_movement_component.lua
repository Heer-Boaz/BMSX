local clock<const> = require('cartlib/clock')
local kinematic_movement_component<const> = require('cartlib/physics/kinematic_movement_component')

-- Integer velocity and contact reflection for actors that continuously move
-- through a tile collision world. The component is a distinct scheduled
-- class so manually driven kinematic actors never pay a per-frame mode branch.
local bouncing_movement_component<const> = {}
bouncing_movement_component.__index = bouncing_movement_component
bouncing_movement_component._tick_clocks = clock.gameplay
setmetatable(bouncing_movement_component, { __index = kinematic_movement_component })

function bouncing_movement_component.new(owner, profile)
	local self<const> = setmetatable(
		kinematic_movement_component.new(owner, profile),
		bouncing_movement_component
	)
	self.speed_x_num = profile.speed_x_num
	self.speed_y_num = profile.speed_y_num
	if self.speed_x_num == nil then self.speed_x_num = 0 end
	if self.speed_y_num == nil then self.speed_y_num = 0 end
	return self
end

function bouncing_movement_component.factory(profile)
	return function(owner)
		return bouncing_movement_component.new(owner, profile)
	end
end

return bouncing_movement_component
