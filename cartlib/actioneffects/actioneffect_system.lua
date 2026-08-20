local actioneffect_component<const> = require('cartlib/actioneffects/actioneffect_component')
local base_system<const> = require('cartlib/world/base_system')
local clock<const> = require('cartlib/clock')
local tick_group<const> = require('cartlib/world/tick_group')

local actioneffect_system<const> = {}
actioneffect_system.__index = actioneffect_system
setmetatable(actioneffect_system, { __index = base_system })
actioneffect_system.tick = {
	group = tick_group.gameplay,
	priority = 10,
	clock_source = clock.gameplay,
	method = 'update',
}

function actioneffect_system.new(world)
	local self<const> = setmetatable(base_system.new(actioneffect_system.tick), actioneffect_system)
	self._component_view = world:active_tick_view(actioneffect_component, clock.gameplay)
	return self
end

function actioneffect_system:update()
	local components<const> = self._component_view.components
	for index = 1, #components do
		components[index]:tick_periodic()
	end
end

return actioneffect_system
