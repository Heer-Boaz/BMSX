local input_actioneffect_component<const> = require('cartlib/input/actioneffect/actioneffect_component')
local input_system<const> = require('cartlib/input/input_system')
local base_system<const> = require('cartlib/world/base_system')
local clock<const> = require('cartlib/clock')
local tick_group<const> = require('cartlib/world/tick_group')

local input_actioneffect_system<const> = {}
input_actioneffect_system.__index = input_actioneffect_system
setmetatable(input_actioneffect_system, { __index = base_system })
input_actioneffect_system.gameplay_tick = {
	group = tick_group.input,
	priority = 10,
	clock_source = clock.gameplay,
	method = 'update',
	prerequisites = { input_system.gameplay_tick },
}
input_actioneffect_system.frame_tick = {
	group = tick_group.input,
	priority = 10,
	clock_source = clock.frame,
	method = 'update_frame',
	prerequisites = { input_system.frame_tick },
}

function input_actioneffect_system.new(world)
	local self<const> = setmetatable(
		base_system.new(input_actioneffect_system.gameplay_tick),
		input_actioneffect_system
	)
	self:add_tick_function(input_actioneffect_system.frame_tick)
	self._gameplay_tick_view = world:active_tick_view(input_actioneffect_component, clock.gameplay)
	self._frame_tick_view = world:active_tick_view(input_actioneffect_component, clock.frame)
	self.gameplay_frame = 0
	self.frame = 0
	return self
end

function input_actioneffect_system:update()
	local frame<const> = self.gameplay_frame + 1
	self.gameplay_frame = frame
	local components<const> = self._gameplay_tick_view.components
	for i = 1, #components do
		local component<const> = components[i]
		component.program.evaluate(component, frame)
	end
end

function input_actioneffect_system:update_frame()
	local frame<const> = self.frame + 1
	self.frame = frame
	local components<const> = self._frame_tick_view.components
	for i = 1, #components do
		local component<const> = components[i]
		component.program.evaluate(component, frame)
	end
end

return input_actioneffect_system
