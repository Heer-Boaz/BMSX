local component<const> = require('cartlib/world/component')
local component_types<const> = require('cartlib/components/types')

local inputactioneffectcomponent<const> = {}
inputactioneffectcomponent.__index = inputactioneffectcomponent
setmetatable(inputactioneffectcomponent, { __index = component })

function inputactioneffectcomponent.new(opts)
	local self<const> = setmetatable(component.new(opts, component_types.input_action_effect, true), inputactioneffectcomponent)
	self.program = opts.program
	return self
end

return inputactioneffectcomponent
