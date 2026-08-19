local base_component<const> = require('cartlib/component/base_component')
local clock<const> = require('cartlib/clock')

local velocity_component<const> = {}
velocity_component.__index = velocity_component
velocity_component.unique = true
velocity_component._tick_clocks = clock.gameplay
setmetatable(velocity_component, { __index = base_component })

function velocity_component.new(opts)
	return setmetatable(base_component.new(opts), velocity_component)
end

return velocity_component
