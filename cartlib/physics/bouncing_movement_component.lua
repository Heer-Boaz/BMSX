local clock<const> = require('cartlib/clock')
local kinematic_movement_component<const> = require('cartlib/physics/kinematic_movement_component')

-- Integer velocity and contact reflection for actors that continuously move
-- through a tile collision world. The component is a distinct scheduled
-- class so manually driven kinematic actors never pay a per-frame mode branch.
local bouncing_movement_component<const> = {}
bouncing_movement_component.__index = bouncing_movement_component
bouncing_movement_component._tick_clocks = clock.gameplay
setmetatable(bouncing_movement_component, { __index = kinematic_movement_component })

function bouncing_movement_component.new(opts, profile)
	return setmetatable(
		kinematic_movement_component.new(opts, profile),
		bouncing_movement_component
	)
end

function bouncing_movement_component.factory(profile)
	return function(opts)
		return bouncing_movement_component.new(opts, profile)
	end
end

return bouncing_movement_component
