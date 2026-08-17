local input_actioneffect_component<const> = require('cartlib/input/actioneffect/actioneffect_component')
local input_system<const> = require('cartlib/input/input_system')
local base_system<const> = require('cartlib/world/base_system')
local clock<const> = require('cartlib/clock')
local tick_group<const> = require('cartlib/world/tick_group')

local input_actioneffect_system<const> = {}
input_actioneffect_system.__index = input_actioneffect_system
setmetatable(input_actioneffect_system, { __index = base_system })
input_actioneffect_system.tick = {
	group = tick_group.input,
	priority = 10,
	clock_source = clock.gameplay,
	method = 'update',
	prerequisites = { input_system.tick },
}

function input_actioneffect_system.new(world)
	local self<const> = setmetatable(base_system.new(input_actioneffect_system.tick), input_actioneffect_system)
	self._component_view = world:active_component_view(input_actioneffect_component)
	self.frame = 0
	return self
end

function input_actioneffect_system:update()
	local frame<const> = self.frame + 1
	self.frame = frame
	local components<const> = self._component_view.components
	for i = 1, #components do
		local component<const> = components[i]
		component.program.evaluate(component, frame)
	end
end

return input_actioneffect_system
