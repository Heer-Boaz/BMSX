-- behaviour_tree.lua
-- Behaviour-tree ECS system.

local ecs<const> = require('cartlib/ecs')
local component_types<const> = require('cartlib/components/types')
local world<const> = require('cartlib/world/world')

local tick_group<const> = ecs.tick_group
local system<const> = ecs.system
local behaviour_tree_component_type<const> = component_types.behaviour_tree

local behaviour_tree_system<const> = {}
behaviour_tree_system.__index = behaviour_tree_system
behaviour_tree_system.component_types = { behaviour_tree_component_type }
setmetatable(behaviour_tree_system, { __index = system })

function behaviour_tree_system.new(priority)
	local self<const> = setmetatable(system.new(tick_group.input, priority), behaviour_tree_system)
	return self
end

function behaviour_tree_system:update()
	local components<const> = world.active_space.active_components_by_type[behaviour_tree_component_type]
	for i = 1, #components do
		local component<const> = components[i]
		component.root:tick(component.parent, component)
	end
end

return behaviour_tree_system.new
