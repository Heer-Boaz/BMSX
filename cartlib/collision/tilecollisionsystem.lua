-- tile_collision.lua
-- Tile-collision ECS system.

local tilecollisioncomponent<const> = require('cartlib/collision/tilecollisioncomponent')
local basesystem<const> = require('cartlib/world/basesystem')
local tickgroup<const> = require('cartlib/world/tickgroup')


local clear_map<const> = require('cartlib/util/clear_map')

local tilecollisionsystem<const> = {}
tilecollisionsystem.__index = tilecollisionsystem
setmetatable(tilecollisionsystem, { __index = basesystem })

local emit_tilecollision_event<const> = function(owner, component, event_type, phase, collision_key, payload)
	payload.phase = phase
	payload.component_id = component.id
	payload.component_local_id = component.id_local
	payload.collision_key = collision_key
	owner.events:emit(event_type, payload)
end

function tilecollisionsystem.new(world)
	local self<const> = setmetatable(basesystem.new(tickgroup.physics, 45), tilecollisionsystem)
	self._component_view = world:active_component_view(tilecollisioncomponent)
	return self
end

function tilecollisionsystem:update()
	local components<const> = self._component_view.components
	for i = 1, #components do
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

return tilecollisionsystem
