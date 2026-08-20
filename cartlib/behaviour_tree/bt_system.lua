-- bt_system.lua
-- Behaviour-tree ECS system.

local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local base_system<const> = require('cartlib/world/base_system')
local clock<const> = require('cartlib/clock')
local tick_group<const> = require('cartlib/world/tick_group')

local bt_system<const> = {}
bt_system.__index = bt_system
setmetatable(bt_system, { __index = base_system })
bt_system.tick = {
	group = tick_group.input,
	priority = 0,
	clock_source = clock.gameplay,
	method = 'update',
}

function bt_system.new(world)
	local self<const> = setmetatable(base_system.new(bt_system.tick), bt_system)
	self._component_view = world:active_tick_view(bt_component, clock.gameplay)
	return self
end

function bt_system:update()
	local components<const> = self._component_view.components
	for i = 1, #components do
		local component<const> = components[i]
		component.evaluate(component.parent, component, component.operand)
	end
end

return bt_system
