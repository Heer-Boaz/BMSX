-- behaviour_tree_system.lua
-- Behaviour-tree ECS system.

local behaviour_tree_component<const> = require('cartlib/behaviour_tree/component')
local system<const> = require('cartlib/world/system')
local tick_group<const> = require('cartlib/world/tick_group')

local behaviour_tree_component_type<const> = behaviour_tree_component.type_name

local behaviour_tree_system<const> = {}
behaviour_tree_system.__index = behaviour_tree_system
setmetatable(behaviour_tree_system, { __index = system })

function behaviour_tree_system.new(world)
	local self<const> = setmetatable(system.new(tick_group.input, 0), behaviour_tree_system)
	self.components = world:_active_component_view(behaviour_tree_component_type)
	return self
end

function behaviour_tree_system:update()
	local components<const> = self.components.items
	for i = 1, #components do
		local component<const> = components[i]
		component.root:tick(component.parent, component)
	end
end

return behaviour_tree_system
