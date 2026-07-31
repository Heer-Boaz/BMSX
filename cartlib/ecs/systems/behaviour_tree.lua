-- behaviour_tree.lua
-- behaviortrees pipeline system.

local ecs<const> = require('cartlib/ecs/ecs')
local component_types<const> = require('cartlib/components/types')
local world_instance<const> = require('cartlib/world/world').instance

local tickgroup<const> = ecs.tickgroup
local ecsystem<const> = ecs.ecsystem
local behaviour_tree_component_type<const> = component_types.behaviour_tree

local behaviortreesystem<const> = {}
behaviortreesystem.__index = behaviortreesystem
setmetatable(behaviortreesystem, { __index = ecsystem })

function behaviortreesystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.input, priority), behaviortreesystem)
	return self
end

function behaviortreesystem:update()
	local components<const> = world_instance.active_space.active_components_by_type[behaviour_tree_component_type]
	for i = 1, #components do
		local component<const> = components[i]
		component.root:tick(component.parent, component)
	end
end

return {
	id = 'behaviortrees',
	group = tickgroup.input,
	create = behaviortreesystem.new,
}
