-- object_fsm.lua
-- objectfsm pipeline system.

local ecs<const> = require('cartlib/ecs/index')
local world_instance<const> = require('cartlib/world/index').instance

local tickgroup<const> = ecs.tickgroup
local ecsystem<const> = ecs.ecsystem

local statemachinesystem<const> = {}
statemachinesystem.__index = statemachinesystem
setmetatable(statemachinesystem, { __index = ecsystem })

function statemachinesystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.moderesolution, priority), statemachinesystem)
	return self
end

function statemachinesystem:update(dt_ms)
	local objects<const> = world_instance.active_space.active_objects
	for i = 1, #objects do
		objects[i].sc:update(dt_ms)
	end
end

return {
	id = 'objectfsm',
	group = tickgroup.moderesolution,
	create = statemachinesystem.new,
}
