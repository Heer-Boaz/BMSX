local component<const> = require('cartlib/world/component')
local component_types<const> = require('cartlib/components/types')

local inputintentcomponent<const> = {}
inputintentcomponent.__index = inputintentcomponent
setmetatable(inputintentcomponent, { __index = component })

function inputintentcomponent.new(opts)
	local self<const> = setmetatable(component.new(opts, component_types.input_intent, true), inputintentcomponent)
	self.player_index = opts.player_index or 1
	self.bindings = opts.bindings or {}
	return self
end

return inputintentcomponent
