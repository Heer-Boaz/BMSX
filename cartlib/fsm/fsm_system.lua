-- fsm_system.lua
-- Finite-state-machine ECS system.

local fsm_component<const> = require('cartlib/fsm/fsm_component')
local base_system<const> = require('cartlib/world/base_system')
local clock<const> = require('cartlib/clock')
local tick_group<const> = require('cartlib/world/tick_group')

local fsm_system<const> = {}
fsm_system.__index = fsm_system
setmetatable(fsm_system, { __index = base_system })
fsm_system.gameplay_tick = {
	group = tick_group.gameplay,
	priority = 0,
	clock_source = clock.gameplay,
	method = 'update',
}
fsm_system.frame_tick = {
	group = tick_group.gameplay,
	priority = 0,
	clock_source = clock.frame,
	method = 'update_frame',
}

function fsm_system.new(world)
	local self<const> = setmetatable(base_system.new(fsm_system.gameplay_tick), fsm_system)
	self:add_tick_function(fsm_system.frame_tick)
	self._gameplay_tick_view = world:active_tick_view(fsm_component, clock.gameplay)
	self._frame_tick_view = world:active_tick_view(fsm_component, clock.frame)
	return self
end

function fsm_system:update()
	local components<const> = self._gameplay_tick_view.components
	for i = 1, #components do
		components[i].update_gameplay()
	end
end

function fsm_system:update_frame()
	local components<const> = self._frame_tick_view.components
	for i = 1, #components do
		components[i].update_frame()
	end
end

return fsm_system
