local clock<const> = require('cartlib/clock')
local kinematic_movement_component<const> = require('cartlib/physics/kinematic_movement_component')

-- Integer velocity and contact reflection for actors that continuously move
-- through a tile collision world. The component is a distinct scheduled
-- class so manually driven kinematic actors never pay a per-frame mode branch.
local bouncing_movement_component<const> = {}
bouncing_movement_component.__index = bouncing_movement_component
bouncing_movement_component._tick_clocks = clock.gameplay
setmetatable(bouncing_movement_component, { __index = kinematic_movement_component })

function bouncing_movement_component.new(context, profile)
	local self<const> = setmetatable(
		kinematic_movement_component.new(context, profile),
		bouncing_movement_component
	)
	self.speed_x_num = profile.speed_x_num
	self.speed_y_num = profile.speed_y_num
	if self.speed_x_num == nil then self.speed_x_num = 0 end
	if self.speed_y_num == nil then self.speed_y_num = 0 end
	local initial<const> = context.initial[self.id_local]
	if initial ~= nil then
		if initial.speed_x_num ~= nil then self.speed_x_num = initial.speed_x_num end
		if initial.speed_y_num ~= nil then self.speed_y_num = initial.speed_y_num end
	end
	return self
end

function bouncing_movement_component.factory(profile)
	return function(opts)
		return bouncing_movement_component.new(opts, profile)
	end
end

return bouncing_movement_component
