-- behaviour_tree.lua
-- behaviortrees pipeline system.

local ecs<const> = require('cartlib/ecs/index')
local world_instance<const> = require('cartlib/world/index').instance

local tickgroup<const> = ecs.tickgroup
local ecsystem<const> = ecs.ecsystem

local behaviortreesystem<const> = {}
behaviortreesystem.__index = behaviortreesystem
setmetatable(behaviortreesystem, { __index = ecsystem })

function behaviortreesystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.input, priority), behaviortreesystem)
	return self
end

function behaviortreesystem:update()
	local objects<const> = world_instance.active_space.active_objects
	for i = 1, #objects do
		local obj<const> = objects[i]
		local ids<const> = obj.btree_ids
		local contexts<const> = obj.btreecontexts
		for j = 1, #ids do
			local context<const> = contexts[ids[j]]
			if context.running then
				context.root:tick(obj, context.blackboard)
			end
		end
	end
end

return {
	id = 'behaviortrees',
	group = tickgroup.input,
	create = behaviortreesystem.new,
}
