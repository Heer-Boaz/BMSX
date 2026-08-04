-- tile_collision.lua
-- Tile-collision ECS system.

local ecs<const> = require('cartlib/ecs')
local component_types<const> = require('cartlib/components/types')
local world<const> = require('cartlib/world/world')

local tick_group<const> = ecs.tick_group
local system<const> = ecs.system

local clear_map<const> = require('cartlib/util/clear_map')

local tile_collision_component_type<const> = component_types.tile_collision

local tile_collision_system<const> = {}
tile_collision_system.__index = tile_collision_system
tile_collision_system.component_types = { tile_collision_component_type }
setmetatable(tile_collision_system, { __index = system })

local emit_tilecollision_event<const> = function(owner, component, event_type, phase, collision_key, payload)
	payload.phase = phase
	payload.component_id = component.id
	payload.component_local_id = component.id_local
	payload.collision_key = collision_key
	owner.events:emit(event_type, payload)
end

function tile_collision_system.new(priority)
	local self<const> = setmetatable(system.new(tick_group.physics, priority or 45), tile_collision_system)
	return self
end

function tile_collision_system:update()
	local components<const> = world.active_space.active_components_by_type[tile_collision_component_type]
	for i = #components, 1, -1 do
		local component<const> = components[i]
		local obj<const> = component.parent
		local current_payload<const> = component.current_payload
		local previous_payload<const> = component.previous_payload
		clear_map(current_payload)
		local current_key<const> = component.query(component, obj, current_payload)
		local previous_key<const> = component.previous_collision_key
		if current_key == nil then
			if previous_key ~= nil then
				emit_tilecollision_event(obj, component, component.end_event_type, 'end', previous_key, previous_payload)
				component.previous_collision_key = nil
			end
		else
			if previous_key == nil then
				emit_tilecollision_event(obj, component, component.begin_event_type, 'begin', current_key, current_payload)
			elseif previous_key ~= current_key then
				emit_tilecollision_event(obj, component, component.end_event_type, 'end', previous_key, previous_payload)
				emit_tilecollision_event(obj, component, component.begin_event_type, 'begin', current_key, current_payload)
			else
				emit_tilecollision_event(obj, component, component.stay_event_type, 'stay', current_key, current_payload)
			end
			component.previous_payload = current_payload
			component.current_payload = previous_payload
			component.previous_collision_key = current_key
		end
	end
end

return tile_collision_system.new
