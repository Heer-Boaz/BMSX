local inputactioneffectcomponent<const> = require('cartlib/input/actioneffect/actioneffectcomponent')
local basesystem<const> = require('cartlib/world/basesystem')
local tickgroup<const> = require('cartlib/world/tickgroup')

local inputactioneffectsystem<const> = {}
inputactioneffectsystem.__index = inputactioneffectsystem
setmetatable(inputactioneffectsystem, { __index = basesystem })

function inputactioneffectsystem.new(world)
	local self<const> = setmetatable(basesystem.new(tickgroup.input, 10), inputactioneffectsystem)
	self._component_view = world:active_component_view(inputactioneffectcomponent)
	self.frame = 0
	return self
end

function inputactioneffectsystem:update()
	local frame<const> = self.frame + 1
	self.frame = frame
	local components<const> = self._component_view.components
	for i = 1, #components do
		local component<const> = components[i]
		component.program.evaluate(component, frame)
	end
end

return inputactioneffectsystem
