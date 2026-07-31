-- previous_position.lua
-- preposition pipeline system.

local ecs<const> = require('cartlib/ecs/index')
local component_types<const> = require('cartlib/components/types')
local world_instance<const> = require('cartlib/world/index').instance

local tickgroup<const> = ecs.tickgroup
local ecsystem<const> = ecs.ecsystem

local previous_position_axis_type<const> = component_types.position_update_axis
local previous_position_boundary_type<const> = component_types.screen_boundary
local previous_position_tile_type<const> = component_types.tile_collision
local previous_position_prohibit_type<const> = component_types.prohibit_leaving_screen

local prepositionsystem<const> = {}
prepositionsystem.__index = prepositionsystem
setmetatable(prepositionsystem, { __index = ecsystem })

function prepositionsystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.input, priority), prepositionsystem)
	return self
end

function prepositionsystem:update()
	-- These components all share the same old-position sync, and none of them
	-- use per-component custom preprocess logic. Open-code the copy here so the
	-- frame loop stays a dense data pass instead of paying a tiny method call on
	-- every component every frame.
	local position_components<const> = world_instance.active_space.active_components_by_type[previous_position_axis_type]
	for i = 1, #position_components do
		local component<const> = position_components[i]
		local parent<const> = component.parent
		local old_pos<const> = component.old_pos
		old_pos.x = parent.x
		old_pos.y = parent.y
	end
	local boundary_components<const> = world_instance.active_space.active_components_by_type[previous_position_boundary_type]
	for i = 1, #boundary_components do
		local component<const> = boundary_components[i]
		local parent<const> = component.parent
		local old_pos<const> = component.old_pos
		old_pos.x = parent.x
		old_pos.y = parent.y
	end
	local tile_components<const> = world_instance.active_space.active_components_by_type[previous_position_tile_type]
	for i = 1, #tile_components do
		local component<const> = tile_components[i]
		local parent<const> = component.parent
		local old_pos<const> = component.old_pos
		old_pos.x = parent.x
		old_pos.y = parent.y
	end
	local prohibit_components<const> = world_instance.active_space.active_components_by_type[previous_position_prohibit_type]
	for i = 1, #prohibit_components do
		local component<const> = prohibit_components[i]
		local parent<const> = component.parent
		local old_pos<const> = component.old_pos
		old_pos.x = parent.x
		old_pos.y = parent.y
	end
end

return {
	id = 'preposition',
	group = tickgroup.input,
	default_priority = -100,
	create = prepositionsystem.new,
}
