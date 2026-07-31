-- tile_collision.lua
-- tilecollision pipeline system.

local ecs<const> = require('cartlib/ecs/ecs')
local component_types<const> = require('cartlib/components/types')
local world_instance<const> = require('cartlib/world/world').instance

local tickgroup<const> = ecs.tickgroup
local ecsystem<const> = ecs.ecsystem

local clear_map<const> = require('cartlib/util/clear_map')

local tile_collision_component_type<const> = component_types.tile_collision

local tilecollisionsystem<const> = {}
tilecollisionsystem.__index = tilecollisionsystem
setmetatable(tilecollisionsystem, { __index = ecsystem })

local emit_tilecollision_event<const> = function(owner, component, suffix, phase, collision_key, payload)
	local event<const> = component._event
	event.type = component.event_base .. '.' .. suffix
	event.emitter = owner
	event.phase = phase
	event.component_id = component.id
	event.component_local_id = component.id_local
	event.collision_key = collision_key
	event.payload = payload
	owner.events:emit_event(event)
end

function tilecollisionsystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.physics, priority), tilecollisionsystem)
	return self
end

function tilecollisionsystem:update()
	local components<const> = world_instance.active_space.active_components_by_type[tile_collision_component_type]
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
				emit_tilecollision_event(obj, component, 'end', 'end', previous_key, previous_payload)
				component.previous_collision_key = nil
			end
		else
			if previous_key == nil then
				emit_tilecollision_event(obj, component, 'begin', 'begin', current_key, current_payload)
			elseif previous_key ~= current_key then
				emit_tilecollision_event(obj, component, 'end', 'end', previous_key, previous_payload)
				emit_tilecollision_event(obj, component, 'begin', 'begin', current_key, current_payload)
			else
				emit_tilecollision_event(obj, component, 'stay', 'stay', current_key, current_payload)
			end
			component.previous_payload = current_payload
			component.current_payload = previous_payload
			component.previous_collision_key = current_key
		end
	end
end

return {
	id = 'tilecollision',
	group = tickgroup.physics,
	default_priority = 45,
	create = tilecollisionsystem.new,
}
